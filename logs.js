const terminal = document.querySelector("#terminal");
let entries = [];
function render() {
  terminal.innerHTML = entries.length ? entries.map((entry) => {
    const line = `[${entry.time}] [${entry.level}] ${entry.message}${entry.data ? ` ${entry.data}` : ""}`;
    const safe = line.replace(/[&<>]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
    return `<span class="${entry.level === "ERROR" ? "error" : ""}">${safe}</span>`;
  }).join("\n") : '<span class="muted">Waiting for logs…</span>';
  terminal.scrollTop = terminal.scrollHeight;
}
browser.runtime.sendMessage({ type: "get-logs" }).then((response) => { entries = response.logs || []; render(); });
browser.runtime.onMessage.addListener((message) => { if (message.type === "log-entry") { entries.push(message.entry); render(); } });
document.querySelector("#clear").addEventListener("click", () => browser.runtime.sendMessage({ type: "clear-logs" }).then(() => { entries = []; render(); }));
document.querySelector("#copy").addEventListener("click", async () => { await navigator.clipboard.writeText(entries.map((entry) => `[${entry.time}] [${entry.level}] ${entry.message} ${entry.data || ""}`).join("\n")); document.querySelector("#copy").textContent = "Copied!"; setTimeout(() => document.querySelector("#copy").textContent = "Copy logs", 1500); });
