const defaults = { clientId: "", assetKey: "", smallAssetKey: "", language: "en", enabled: true, showPlaylist: true };

function paint(language) {
  document.querySelector("#intro").textContent = t("settingsIntro", language);
  document.querySelector("#install").textContent = t("installHint", language);
  document.querySelector("#languageLabel").textContent = t("language", language);
  document.querySelector("#enabledLabel").textContent = t("rpcEnabled", language);
  document.querySelector("#showPlaylistLabel").textContent = t("showPlaylist", language);
  document.querySelector("#clientIdLabel").textContent = t("clientId", language);
  document.querySelector("#assetKeyLabel").textContent = t("largeAsset", language);
  document.querySelector("#smallAssetKeyLabel").textContent = t("smallAsset", language);
  document.querySelector("#save").textContent = t("save", language);
}

browser.storage.local.get(defaults).then((settings) => {
  document.querySelector("#clientId").value = settings.clientId;
  document.querySelector("#assetKey").value = settings.assetKey;
  document.querySelector("#smallAssetKey").value = settings.smallAssetKey;
  document.querySelector("#language").value = settings.language;
  document.querySelector("#enabled").checked = settings.enabled;
  document.querySelector("#showPlaylist").checked = settings.showPlaylist;
  paint(settings.language);
});

document.querySelector("#language").addEventListener("change", (event) => paint(event.target.value));
document.querySelector("#save").addEventListener("click", async () => {
  const settings = {
    clientId: document.querySelector("#clientId").value.trim(),
    assetKey: document.querySelector("#assetKey").value.trim(),
    smallAssetKey: document.querySelector("#smallAssetKey").value.trim(),
    language: document.querySelector("#language").value,
    enabled: document.querySelector("#enabled").checked,
    showPlaylist: document.querySelector("#showPlaylist").checked
  };
  await browser.storage.local.set(settings);
  document.querySelector("#saved").textContent = t("saved", settings.language);
  setTimeout(() => document.querySelector("#saved").textContent = "", 1800);
});
document.querySelector("#logs").addEventListener("click", () => browser.tabs.create({ url: browser.runtime.getURL("logs.html") }));
