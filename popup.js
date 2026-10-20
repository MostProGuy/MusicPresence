let state = {};
let language = "en";

// O popup pode ser aberto com outra aba ativa: procura a aba do YouTube Music (prefere a que está tocando).
async function findMusicTab() {
  const tabs = await browser.tabs.query({ url: "https://music.youtube.com/*" });
  return tabs.find((tab) => tab.audible) || tabs.find((tab) => tab.active) || tabs[0] || null;
}

async function sendToMusicTab(payload) {
  const tab = await findMusicTab();
  if (!tab) return;
  try {
    await browser.tabs.sendMessage(tab.id, payload);
  } catch (_) {
    // Aba aberta antes de a extensão ser carregada: recarregue o YouTube Music.
  }
}

async function init() {
  language = await getLanguage();
  const response = await browser.runtime.sendMessage({ type: "get-state" });
  state = response?.state || {};
  const settings = await browser.storage.local.get({ clientId: "" });
  const status = document.querySelector("#status");
  if (!settings.clientId) status.textContent = t("noClient", language);
  else status.textContent = response?.status?.message || "";
  render();
}
function render() {
  const title = state.title || t("nothing", language);
  document.querySelector("#title").textContent = title;
  document.querySelector("#artist").textContent = state.artist || t("openMusic", language);
  document.querySelector("#eyebrow").textContent = t("presence", language);
  document.querySelector("#current").textContent = formatTime(state.currentTime);
  document.querySelector("#duration").textContent = formatTime(state.duration);
  const seek = document.querySelector("#seek"); seek.max = state.duration || 100; seek.value = Math.min(state.currentTime || 0, state.duration || 100);
  document.querySelector("#toggle").textContent = state.playing ? "Ⅱ" : "▶";
  document.querySelector("#dot").classList.toggle("on", Boolean(state.playing));
  const cover = document.querySelector("#cover"); cover.src = state.image || ""; cover.classList.toggle("visible", Boolean(state.image));
  document.querySelector("#cover-fallback").style.display = state.image ? "none" : "grid";
}
document.querySelector("#toggle").addEventListener("click", () => sendToMusicTab({ type: "toggle" }));
document.querySelector("#seek").addEventListener("change", (event) => sendToMusicTab({ type: "seek", time: Number(event.target.value) }));
document.querySelector("#back").addEventListener("click", async () => {
  const tab = await findMusicTab();
  if (tab) {
    await browser.tabs.update(tab.id, { active: true });
    await browser.windows.update(tab.windowId, { focused: true });
  } else {
    await browser.tabs.create({ url: "https://music.youtube.com/" });
  }
  window.close();
});
document.querySelector("#settings").addEventListener("click", () => browser.runtime.openOptionsPage());
browser.runtime.onMessage.addListener((message) => {
  if (message.type === "native-status") document.querySelector("#status").textContent = message.status?.message || t("connected", language);
  if (message.type === "state-update") { state = message.state; render(); }
});
init();
