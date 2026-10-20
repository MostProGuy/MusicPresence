(() => {
  const browserApi = globalThis.browser;
  const KEEPALIVE_MS = 20000; // reenvia o estado mesmo sem mudança (mantém a ponte e o card vivos durante pausas)
  let lastKey = "";
  let lastSentAt = 0;
  let throttle = null;
  let intervalId = null;
  let observer = null;

  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();

  const text = (selectors, root = document) => {
    for (const selector of selectors) {
      const value = clean(root.querySelector(selector)?.textContent);
      if (value) return value;
    }
    return "";
  };

  const secondsFromClock = (clock) => clock.split(":").reduce((total, unit) => total * 60 + Number(unit), 0);
  const splitByline = (value) => value.split(/\s*[•·]\s*/).map((part) => part.trim()).filter(Boolean);
  const mainArtist = (value) => splitByline(value)[0] || "";

  function readPlayerTime(media) {
    // The player-bar clock changes with the track immediately; hidden media
    // elements can briefly keep the previous track's position.
    const timeInfo = text([
      "ytmusic-player-bar .time-info",
      "ytmusic-player-bar #time-info",
      "ytmusic-player-bar .time-info-wrapper"
    ]);
    const match = timeInfo.match(/(\d{1,2}:\d{2}(?::\d{2})?)\s*\/\s*(\d{1,2}:\d{2}(?::\d{2})?)/);
    if (match) return { currentTime: secondsFromClock(match[1]), duration: secondsFromClock(match[2]) };

    if (Number.isFinite(media?.duration) && media.duration > 0) {
      return { currentTime: media.currentTime || 0, duration: media.duration };
    }

    const slider = document.querySelector("ytmusic-player-bar #progress-bar");
    const current = Number(slider?.value ?? slider?.getAttribute("value"));
    const duration = Number(slider?.max ?? slider?.getAttribute("max"));
    if (Number.isFinite(current) && Number.isFinite(duration) && duration > 0) return { currentTime: current, duration };
    return { currentTime: media?.currentTime || 0, duration: Number.isFinite(media?.duration) ? media.duration : 0 };
  }

  // Álbum: link do álbum na linha de artista (MPREb_...) > Media Session > "Artista • Álbum • Ano".
  function readAlbum(byline, metadata) {
    const link = clean(document.querySelector('ytmusic-player-bar .byline a[href*="MPREb"]')?.textContent);
    if (link) return link;
    const fromMedia = clean(metadata?.album);
    if (fromMedia) return fromMedia;
    const parts = splitByline(byline);
    if (parts.length >= 3 && /^\d{4}$/.test(parts[2])) return parts[1]; // músicas têm ano; vídeos têm views/likes
    return "";
  }

  // Playlist (opcional): só quando a faixa toca dentro de uma lista (watch?v=...&list=...).
  const GENERIC_LABEL = /^(up next|a seguir|próximas?|playing from|tocando de|tocando a partir de|reproduzindo de|reproduzindo a partir de|continuing from|autoplay|reprodução automática|lyrics|letras|related|relacionados?)$/i;
  const FROM_LABEL = /^(?:playing from|tocando de|tocando a partir de|reproduzindo de|reproduzindo a partir de)\s*:?\s*(.*)$/i;
  function readPlaylist() {
    if (!new URLSearchParams(location.search).has("list")) return "";
    const queue = document.querySelector("ytmusic-player-queue");
    if (!queue) return "";
    const direct = text([
      "ytmusic-queue-header-renderer .title",
      "ytmusic-queue-header-renderer yt-formatted-string.title",
      "#queue-title",
      ".queue-title"
    ], queue);
    if (direct && !GENERIC_LABEL.test(direct)) return direct.slice(0, 128);
    // Plano B: rótulo "Playing from / Tocando de" seguido do nome.
    for (const node of queue.querySelectorAll("yt-formatted-string, span, div")) {
      if (node.childElementCount > 0) continue;
      const match = clean(node.textContent).match(FROM_LABEL);
      if (!match) continue;
      const name = match[1] || clean((node.nextElementSibling || node.parentElement?.nextElementSibling)?.textContent);
      if (name && !GENERIC_LABEL.test(name)) return name.slice(0, 128);
    }
    return "";
  }

  // O player bar usa miniaturas de 60 px; pede a capa em 544 px.
  function betterImage(url) {
    if (!url) return "";
    if (/googleusercontent\.com|ggpht\.com/.test(url)) return url.replace(/=(?:w\d+-h\d+|s\d+)[^/?#]*$/, "=w544-h544-l90-rj");
    if (url.includes("ytimg.com") && url.length > 280) return url.split("?")[0]; // Discord limita a URL da imagem
    return url;
  }

  function contextAlive() {
    try { return Boolean(browserApi.runtime?.id); } catch (_) { return false; }
  }

  function stop() {
    clearInterval(intervalId);
    observer?.disconnect();
  }

  function push(state) {
    try {
      browserApi.runtime.sendMessage({ type: "track-update", state }).catch(() => {});
    } catch (_) {
      stop(); // extensão recarregada: este script ficou órfão, recarregue a aba
    }
  }

  function readTrack() {
    if (!contextAlive()) { stop(); return; }
    const media = document.querySelector("video.html5-main-video, video") || document.querySelector("audio");
    const metadata = navigator.mediaSession?.metadata;
    const playButton = document.querySelector("ytmusic-player-bar #play-pause-button, ytmusic-player-bar [aria-label*='Pause'], ytmusic-player-bar [aria-label*='Pausar'], ytmusic-player-bar [title*='Pause'], ytmusic-player-bar [title*='Pausar']");
    const buttonLabel = ["aria-label", "title", "data-tooltip-text"]
      .map((attribute) => playButton?.getAttribute(attribute) || "")
      .join(" ")
      .toLowerCase();
    const buttonState = buttonLabel.includes("pause") || buttonLabel.includes("pausar") ? true
      : buttonLabel.includes("play") || buttonLabel.includes("reproduzir") ? false
      : null;
    const domTitle = text([
      "ytmusic-player-bar .title",
      "ytmusic-player-bar .content-info-wrapper .title",
      "ytmusic-player-bar yt-formatted-string.title"
    ]);
    const domByline = text([
      "ytmusic-player-bar .byline",
      "ytmusic-player-bar .subtitle",
      "ytmusic-player-bar .content-info-wrapper .byline"
    ]);
    const title = (domTitle && domTitle !== "YouTube Music" ? domTitle : metadata?.title) || document.title.replace(/\s+-\s+YouTube Music$/i, "").trim();
    const artist = mainArtist(domByline || metadata?.artist || "");
    const album = readAlbum(domByline, metadata);
    const playlist = readPlaylist();
    const candidates = [document.querySelector("ytmusic-player-bar img")?.src, metadata?.artwork?.at(-1)?.src];
    const image = betterImage(candidates.find((src) => /^https:/.test(src || "")) || "");
    // YouTube Music can keep more than one audio element. Media Session is
    // the browser-level state published by the active player, so use it first.
    const mediaState = navigator.mediaSession?.playbackState;
    const mediaPlaying = mediaState === "playing" ? true : mediaState === "paused" ? false : null;
    const playing = mediaPlaying ?? buttonState ?? Boolean(media && !media.paused && !media.ended);
    const timing = readPlayerTime(media);
    const state = {
      title: title || "YouTube Music",
      artist: artist || "",
      album,
      playlist,
      image,
      url: location.href,
      playing,
      currentTime: timing.currentTime,
      duration: timing.duration,
      updatedAt: Date.now()
    };
    const key = JSON.stringify([state.title, state.artist, state.album, state.playlist, state.image, state.playing, Math.floor(state.currentTime)]);
    const now = Date.now();
    if (key !== lastKey || now - lastSentAt >= KEEPALIVE_MS) {
      lastKey = key;
      lastSentAt = now;
      push(state);
    }
  }

  // O observer dispara dezenas de vezes por segundo: agrupa em no máximo ~3 leituras/s.
  function scheduleRead() {
    if (throttle) return;
    throttle = setTimeout(() => { throttle = null; readTrack(); }, 300);
  }

  browserApi.runtime.onMessage.addListener((message) => {
    const media = document.querySelector("video.html5-main-video, video") || document.querySelector("audio");
    if (!media) return;
    if (message.type === "toggle") {
      if (media.paused) media.play().catch(() => {});
      else media.pause();
    }
    if (message.type === "seek" && Number.isFinite(message.time)) media.currentTime = message.time;
  });

  // Saiu do YouTube Music (ou recarregou): o background confere se ainda há alguma aba aberta.
  window.addEventListener("pagehide", () => {
    try { browserApi.runtime.sendMessage({ type: "page-gone" }).catch(() => {}); } catch (_) {}
  });

  intervalId = setInterval(readTrack, 1000);
  observer = new MutationObserver(scheduleRead);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  ["play", "pause", "loadedmetadata", "durationchange"].forEach((event) => {
    document.addEventListener(event, scheduleRead, true);
  });
  readTrack();
})();
