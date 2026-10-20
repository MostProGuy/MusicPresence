const api = globalThis.browser;

const translations = {
  en: {
    presence: "DISCORD RICH PRESENCE", nothing: "Nothing playing", openMusic: "Open YouTube Music",
    playing: "Playing", paused: "Paused", setup: "Setup required", discordMissing: "Discord not detected",
    connected: "Discord connected", settings: "Settings", open: "Open", play: "Play / pause",
    setupHint: "Open Settings to finish setup", save: "Save settings", saved: "Saved!", language: "Language",
    clientId: "Discord Application ID", largeAsset: "Large asset key (optional)", smallAsset: "Small asset key (optional)",
    settingsIntro: "Create a Discord application, upload your assets, then paste its Application ID here.",
    installHint: "First run the setup script from the project folder, then reload the extension in Firefox.",
    install: "Companion installed", noClient: "Add your Discord Application ID in Settings.", rpcEnabled: "Show Rich Presence", showPlaylist: "Show playlist name (when available)",
  },
  pt: {
    presence: "RICH PRESENCE DO DISCORD", nothing: "Nada tocando", openMusic: "Abra o YouTube Music",
    playing: "Tocando", paused: "Pausado", setup: "Configuração necessária", discordMissing: "Discord não encontrado",
    connected: "Discord conectado", settings: "Configurações", open: "Abrir", play: "Reproduzir / pausar",
    setupHint: "Abra as configurações para terminar", save: "Salvar configurações", saved: "Salvo!", language: "Idioma",
    clientId: "Application ID do Discord", largeAsset: "Asset grande (opcional)", smallAsset: "Asset pequeno (opcional)",
    settingsIntro: "Crie uma aplicação no Discord, envie seus assets e cole o Application ID aqui.",
    installHint: "Primeiro rode o script de setup na pasta do projeto e recarregue a extensão no Firefox.",
    install: "Ponte instalada", noClient: "Adicione o Application ID do Discord nas configurações.", rpcEnabled: "Mostrar Rich Presence", showPlaylist: "Mostrar nome da playlist (quando disponível)",
  }
};

async function getLanguage() {
  const { language } = await api.storage.local.get({ language: "en" });
  return language === "pt" ? "pt" : "en";
}

function t(key, language = "en") { return translations[language]?.[key] || translations.en[key] || key; }

function formatTime(value) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}
