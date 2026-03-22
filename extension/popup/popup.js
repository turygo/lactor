import { loadConfig, createConfig } from "../config.js";

const portInput = document.getElementById("port");
const saveBtn = document.getElementById("save");
const statusDiv = document.getElementById("status");
const extIdEl = document.getElementById("ext-id");

extIdEl.textContent = browser.runtime.id;

browser.storage.local.get("port").then((result) => {
  if (result.port) portInput.value = result.port;
});

saveBtn.addEventListener("click", async () => {
  const port = parseInt(portInput.value, 10);
  if (port < 1024 || port > 65535) {
    showStatus("Invalid port (1024-65535)", false);
    return;
  }
  await browser.storage.local.set({ port });
  showStatus("Saved!", true);
  checkHealth(createConfig({ backendPort: port }));
});

function showStatus(msg, ok) {
  statusDiv.textContent = msg;
  statusDiv.className = "status " + (ok ? "ok" : "err");
  statusDiv.style.display = "block";
}

async function checkHealth(config) {
  try {
    const resp = await fetch(config.httpUrl("/health"));
    if (resp.ok) {
      showStatus(`Connected to backend on port ${config.backendPort}`, true);
    } else {
      showStatus(`Backend responded with ${resp.status}`, false);
    }
  } catch {
    showStatus(
      `Backend not running. Start with: lactor serve --port ${config.backendPort} --extension-id ${browser.runtime.id}`,
      false
    );
  }
}

loadConfig(browser.storage.local).then(checkHealth);
