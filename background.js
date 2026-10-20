const api = globalThis.browser;

const SETTINGS_DEFAULTS = { clientId: "", assetKey: "", smallAssetKey: "", language: "en", enabled: true, showPlaylist: true };
const EMPTY_STATE = { title: "", artist: "", album: "", playlist: "", image: "", playing: false, currentTime: 0, duration: 0 };

// Anti rate limit: o Discord aceita ~5 atualizações a cada 20 s.
const DEBOUNCE_MS = 1500;          // espera a troca de faixa "assentar" (título, artista e capa mudam em momentos diferentes)
const MIN_INTERVAL_MS = 5000;      // no máximo 1 mudança real a cada 5 s
const HEARTBEAT_MS = 30000;        // reenvio barato: o host ignora se nada mudou e reconecta se o Discord caiu
const ERROR_BACKOFF_MS = 10000;
const RATE_LIMIT_BACKOFF_MS = 30000;

let currentState = { ...EMPTY_STATE };
let nativePort = null;
let lastStatus = null;
let lastSentKey = "";
let lastSentAt = 0;
let lastChangeAt = 0;
let backoffUntil = 0;
let syncTimer = null;
let rpcVisible = false;
let lastTrackLabel = "";
let settingsPromise = null;
const logs = [];

const getSettings = () => (settingsPromise ??= api.storage.local.get(SETTINGS_DEFAULTS));
const notify = (message) => api.runtime.sendMessage(message).catch(() => {});

function log(level, message, data = "") {
  const entry = { time: new Date().toISOString(), level, message, data: data ? JSON.stringify(data) : "" };
  logs.push(entry);
  if (logs.length > 300) logs.shift();
  notify({ type: "log-entry", entry });
}

function nativeStatus(message) {
  log("ERROR", message);
  lastStatus = { ok: false, message };
  notify({ type: "native-status", status: lastStatus });
}

const hasTrack = (state) => Boolean(state.title) && !(state.title === "YouTube Music" && !state.artist);
const presenceKey = (state) => JSON.stringify([state.title, state.artist, state.album, state.playlist, state.image, state.playing]);

function onHostMessage(message) {
  const wasOk = lastStatus?.ok;
  lastStatus = { ok: Boolean(message.ok), message: message.message || "" };
  notify({ type: "native-status", status: lastStatus });
  if (message.ok) {
    if (!wasOk) log("INFO", `Resposta do host: ${lastStatus.message || "ok"}`);
    return;
  }
  log("ERROR", `Resposta do host: ${lastStatus.message || "sem mensagem"}`);
  lastSentKey = ""; // tenta de novo depois do backoff
  backoffUntil = Date.now() + (message.rateLimited ? RATE_LIMIT_BACKOFF_MS : ERROR_BACKOFF_MS);
  if (message.rateLimited) log("ERROR", `Rate limit do Discord: nova tentativa em ${RATE_LIMIT_BACKOFF_MS / 1000} s.`);
  scheduleSync();
}

function connectNative() {
  if (nativePort) return nativePort;
  try {
    log("INFO", "Iniciando Native Messaging: ytmusic_discord_rpc");
    const port = api.runtime.connectNative("ytmusic_discord_rpc");
    nativePort = port;
    port.onMessage.addListener(onHostMessage);
    port.onDisconnect.addListener((p) => {
      // No Firefox o motivo real fica em port.error (runtime.lastError só existe no Chrome).
      const reason = p.error?.message || api.runtime.lastError?.message || "Native Messaging host desconectado.";
      if (nativePort === port) nativePort = null;
      rpcVisible = false;
      lastSentKey = "";
      backoffUntil = Date.now() + ERROR_BACKOFF_MS;
      const hint = /no such native application|not found/i.test(reason) ? " Rode ./setup.sh e recarregue a extensão." : "";
      nativeStatus(`${reason}${hint}`);
    });
  } catch (error) {
    nativePort = null;
    nativeStatus(`Não foi possível iniciar a ponte: ${error.message || error}`);
  }
  return nativePort;
}

function clearDiscord(settings, reason) {
  const port = connectNative();
  if (!port) return;
  log("INFO", reason);
  try { port.postMessage({ type: "clear_activity", settings }); } catch (_) { nativePort = null; }
  rpcVisible = false;
  lastSentKey = "";
}

function scheduleSync() {
  if (syncTimer) return; // já agendado: na hora de rodar ele lê o estado mais recente
  const now = Date.now();
  const wait = Math.max(DEBOUNCE_MS, lastChangeAt + MIN_INTERVAL_MS - now, backoffUntil - now);
  syncTimer = setTimeout(syncDiscord, wait);
}

async function syncDiscord() {
  syncTimer = null;
  const settings = await getSettings();
  const state = currentState;

  if (!settings.enabled) {
    if (rpcVisible) clearDiscord(settings, "Ocultando Rich Presence.");
    return;
  }
  // A página mostra o título genérico durante a troca de faixa: mantém o card atual.
  if (!hasTrack(state)) return;

  const key = presenceKey(state);
  const now = Date.now();
  const changed = key !== lastSentKey;
  if (!changed && now - lastSentAt < HEARTBEAT_MS) return;
  if (now < backoffUntil || (changed && now < lastChangeAt + MIN_INTERVAL_MS)) { scheduleSync(); return; }

  const port = connectNative();
  if (!port) return;
  if (changed) {
    lastChangeAt = now;
    const where = state.playlist ? ` [playlist: ${state.playlist}]` : "";
    log("INFO", `Enviando atividade (${state.playing ? "tocando" : "pausado"}): ${state.title} — ${state.artist || "sem artista"}${state.album ? ` — ${state.album}` : ""}${where}`);
  }
  lastSentKey = key;
  lastSentAt = now;
  const { title, artist, album, playlist, image, playing } = state;
  try {
    port.postMessage({ type: "set_activity", state: { title, artist, album, playlist, image, playing }, settings });
    rpcVisible = true;
  } catch (_) {
    nativePort = null;
    lastSentKey = "";
  }
}

// Qualquer mudança nas configurações (inclusive ligar/desligar) força um novo envio.
api.storage.onChanged.addListener((_changes, area) => {
  if (area !== "local") return;
  settingsPromise = null;
  lastSentKey = "";
  lastChangeAt = 0;
  log("INFO", "Configurações alteradas.");
  scheduleSync();
});

api.runtime.onMessage.addListener((message) => {
  if (message.type === "track-update") {
    currentState = message.state;
    const trackLabel = `${currentState.title} — ${currentState.artist}`;
    if (trackLabel !== lastTrackLabel) {
      lastTrackLabel = trackLabel;
      log("INFO", `Faixa detectada: ${trackLabel}`);
    }
    notify({ type: "state-update", state: currentState });
    if (presenceKey(currentState) !== lastSentKey || Date.now() - lastSentAt >= HEARTBEAT_MS) scheduleSync();
    return Promise.resolve({ state: currentState });
  }
  if (message.type === "page-gone") { setTimeout(checkMusicTabs, 2000); return; }
  if (message.type === "get-state") return Promise.resolve({ state: currentState, status: lastStatus });
  if (message.type === "get-logs") return Promise.resolve({ logs });
  if (message.type === "clear-logs") { logs.length = 0; log("INFO", "Logs limpos pelo usuário"); return Promise.resolve({ ok: true }); }
});

// Fechou (ou saiu de) todas as abas do YouTube Music: remove o card.
async function checkMusicTabs() {
  const tabs = await api.tabs.query({ url: "https://music.youtube.com/*" });
  if (tabs.length > 0 || !nativePort) return; // sem ponte aberta = o Discord já removeu o card
  currentState = { ...EMPTY_STATE };
  lastTrackLabel = "";
  if (rpcVisible) clearDiscord(await getSettings(), "YouTube Music fechado: ocultando Rich Presence.");
  notify({ type: "state-update", state: currentState });
}
api.tabs.onRemoved.addListener(() => { checkMusicTabs(); });
