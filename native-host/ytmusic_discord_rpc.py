#!/usr/bin/env python3
"""Firefox Native Messaging bridge for Discord Rich Presence.

Mantém UMA conexão IPC aberta com o Discord (em vez de reconectar a cada
atualização) e só envia SET_ACTIVITY quando o conteúdo do card muda de verdade.
Isso evita o rate limit do Discord.
"""
import json
import os
import re
import select
import socket
import struct
import sys
import uuid

OP_HANDSHAKE, OP_FRAME, OP_CLOSE, OP_PING, OP_PONG = 0, 1, 2, 3, 4
SOCKET_TIMEOUT = 3

# --- Aparência do card (edite aqui se quiser trocar) -------------------------
ICON_PLAYING = "▶"
ICON_PAUSED = "⏸"
TEXT = {
    "pt": {"playing": "Tocando", "paused": "Pausado", "playlist": "Playlist", "album": "Álbum"},
    "en": {"playing": "Playing", "paused": "Paused", "playlist": "Playlist", "album": "Album"},
}
# -----------------------------------------------------------------------------


# ---------------------------- Native Messaging I/O ---------------------------
def read_message():
    raw_size = sys.stdin.buffer.read(4)
    if len(raw_size) != 4:
        return None
    size = struct.unpack("=I", raw_size)[0]
    body = sys.stdin.buffer.read(size)
    if len(body) != size:
        return None
    return json.loads(body.decode("utf-8"))


def send_message(payload):
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(raw)) + raw)
    sys.stdout.buffer.flush()


# ------------------------------- Discord IPC ---------------------------------
def ipc_paths():
    """Caminhos possíveis do socket (Linux nativo, Flatpak, Snap, macOS)."""
    bases = []
    for var in ("XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"):
        value = os.environ.get(var)
        if value:
            bases.append(value)
    bases += [f"/run/user/{os.getuid()}", "/tmp"]
    subdirs = (
        "",
        "app/com.discordapp.Discord",
        "app/com.discordapp.DiscordCanary",
        "app/dev.vencord.Vesktop",
        "snap.discord",
        "snap.discord-canary",
    )
    seen = set()
    for base in bases:
        for sub in subdirs:
            for index in range(10):
                path = os.path.join(base, sub, f"discord-ipc-{index}")
                if path not in seen:
                    seen.add(path)
                    yield path


def send_frame(sock, op, data):
    body = json.dumps(data, separators=(",", ":")).encode("utf-8")
    sock.sendall(struct.pack("<II", op, len(body)) + body)


def recv_exact(sock, size):
    data = b""
    while len(data) < size:
        chunk = sock.recv(size - len(data))
        if not chunk:
            raise OSError("Discord fechou a conexão")
        data += chunk
    return data


def recv_frame(sock):
    op, size = struct.unpack("<II", recv_exact(sock, 8))
    body = recv_exact(sock, size)
    return op, (json.loads(body.decode("utf-8")) if body else {})


def as_dict(value):
    return value if isinstance(value, dict) else {}


RATE_LIMIT_RE = re.compile(r"rate.?limit|too many|ratelimit", re.IGNORECASE)


class Discord:
    def __init__(self):
        self.sock = None
        self.client_id = None
        self.last_key = None  # atividade enviada com sucesso nesta conexão (None = nenhuma)

    def close(self):
        if self.sock:
            try:
                self.sock.close()
            except OSError:
                pass
        self.sock = None
        self.last_key = None

    def connect(self, client_id):
        """Conecta e faz o handshake. Retorna None se deu certo, senão a mensagem de erro."""
        error = "Discord não encontrado. Abra o Discord desktop."
        for path in ipc_paths():
            if not os.path.exists(path):
                continue
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            sock.settimeout(SOCKET_TIMEOUT)
            try:
                sock.connect(path)
                send_frame(sock, OP_HANDSHAKE, {"v": 1, "client_id": client_id})
                while True:
                    op, payload = recv_frame(sock)
                    if op == OP_PING:
                        send_frame(sock, OP_PONG, payload)
                        continue
                    break
            except (OSError, ValueError) as exc:
                sock.close()
                error = f"Falha no handshake com o Discord ({type(exc).__name__}): {exc}"
                continue
            if op == OP_CLOSE or payload.get("evt") == "ERROR":
                message = (
                    payload.get("message")
                    or as_dict(payload.get("data")).get("message")
                    or "Application ID recusado pelo Discord"
                )
                sock.close()
                return message
            self.sock = sock
            self.client_id = client_id
            self.last_key = None
            return None
        return error

    def alive(self):
        """Confere (sem bloquear) se o Discord ainda está na outra ponta; responde pings."""
        if not self.sock:
            return False
        try:
            while select.select([self.sock], [], [], 0)[0]:
                op, payload = recv_frame(self.sock)
                if op == OP_PING:
                    send_frame(self.sock, OP_PONG, payload)
                elif op == OP_CLOSE:
                    raise OSError("Discord fechou a conexão")
            return True
        except (OSError, ValueError):
            self.close()
            return False

    def request(self, activity):
        nonce = str(uuid.uuid4())
        send_frame(
            self.sock,
            OP_FRAME,
            {"cmd": "SET_ACTIVITY", "args": {"pid": os.getpid(), "activity": activity}, "nonce": nonce},
        )
        while True:
            op, payload = recv_frame(self.sock)
            if op == OP_PING:
                send_frame(self.sock, OP_PONG, payload)
            elif op == OP_CLOSE:
                raise OSError(payload.get("message") or "Discord fechou a conexão")
            elif payload.get("nonce") == nonce:
                return payload

    def update(self, client_id, activity):
        key = None if activity is None else json.dumps(activity, sort_keys=True)
        if self.client_id != client_id:
            self.close()
        # Nada mudou e a conexão está viva: não toca no Discord (zero rate limit).
        if self.alive() and key == self.last_key:
            return {"ok": True, "message": "Discord conectado"}
        error = "Falha ao falar com o Discord."
        for _attempt in range(2):  # 2ª tentativa = reconexão (ex.: Discord foi reiniciado)
            if not self.sock:
                connect_error = self.connect(client_id)
                if connect_error:
                    return {"ok": False, "message": connect_error}
            try:
                response = self.request(activity)
            except (OSError, ValueError) as exc:
                self.close()
                error = f"Falha no Discord: {exc}"
                continue
            if response.get("evt") == "ERROR":
                data = as_dict(response.get("data"))
                message = data.get("message") or "Discord recusou a atividade."
                limited = data.get("code") == 429 or bool(RATE_LIMIT_RE.search(message))
                return {"ok": False, "message": message, "rateLimited": limited}
            self.last_key = key
            return {"ok": True, "message": "Discord conectado"}
        return {"ok": False, "message": error}

    def clear(self, client_id):
        if self.client_id != client_id:
            self.close()
        if not self.alive():
            # Sem conexão = sem atividade (o Discord remove ao fechar o socket).
            return {"ok": True, "message": "Rich Presence removido"}
        result = self.update(client_id, None)
        if result.get("ok"):
            result["message"] = "Rich Presence removido"
        return result


# ------------------------------ Montagem do card -----------------------------
def clean(value):
    return " ".join(str(value or "").split())


def shorten(value, limit):
    return value if len(value) <= limit else value[: limit - 1].rstrip() + "…"


def field(value, limit=128):
    """Campos de texto do Discord aceitam de 2 a 128 caracteres."""
    value = shorten(clean(value), limit)
    return value.ljust(2, "\u00a0") if value else ""


def build_activity(state, settings):
    text = TEXT.get(settings.get("language"), TEXT["en"])
    playing = bool(state.get("playing"))
    status = text["playing"] if playing else text["paused"]
    icon = ICON_PLAYING if playing else ICON_PAUSED

    title = clean(state.get("title")) or "YouTube Music"
    artist = clean(state.get("artist"))
    album = clean(state.get("album"))
    playlist = clean(state.get("playlist")) if settings.get("showPlaylist", True) else ""

    # Linha 1: título | Linha 2: "▶ Artista • Álbum" (ícone = estado da música)
    byline = " • ".join(part for part in (shorten(artist, 40), album) if part)
    line = f"{icon} {byline}" if byline else f"{icon} {status}"

    # Texto que aparece ao passar o mouse na capa
    if playlist:
        hover = f"{text['playlist']}: {playlist}"
    elif album:
        hover = f"{text['album']}: {album}"
    else:
        hover = title

    activity = {"type": 2, "details": field(title), "state": field(line)}
    assets = {}
    image = str(state.get("image") or "")
    if image.startswith("https://") and len(image) <= 300:
        assets["large_image"] = image
    elif settings.get("assetKey"):
        assets["large_image"] = settings["assetKey"]
    if "large_image" in assets:
        assets["large_text"] = field(hover)
    if settings.get("smallAssetKey"):
        assets["small_image"] = settings["smallAssetKey"]
        assets["small_text"] = field(f"{icon} {status}")
    if assets:
        activity["assets"] = assets
    return activity


def handle(discord, message):
    settings = as_dict(message.get("settings"))
    client_id = str(settings.get("clientId", "")).strip()
    if not client_id:
        return {"ok": False, "message": "Configure o Application ID do Discord."}
    kind = message.get("type")
    if kind == "set_activity":
        return discord.update(client_id, build_activity(as_dict(message.get("state")), settings))
    if kind == "clear_activity":
        return discord.clear(client_id)
    return {"ok": False, "message": f"Mensagem desconhecida: {kind}"}


def main():
    discord = Discord()
    try:
        while True:
            try:
                message = read_message()
            except (ValueError, OSError):
                break
            if message is None:
                break
            try:
                send_message(handle(discord, message))
            except Exception as error:  # noqa: BLE001 - nunca derrubar a ponte
                send_message({"ok": False, "message": f"Erro interno do host ({type(error).__name__}): {error}"})
    finally:
        discord.close()


if __name__ == "__main__":
    main()
