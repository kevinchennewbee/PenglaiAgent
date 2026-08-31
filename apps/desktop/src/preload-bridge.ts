import { contextBridge, ipcRenderer } from "electron";
import { PRELOAD_API } from "./preload.js";
import {
  applyRecoveryDiagnostic,
  RECOVERY_DIAGNOSTIC_CHANNEL,
} from "./recovery-diagnostic.js";
import { normalizePenglaiDocumentTitle } from "./product-title.js";

function keepProductDocumentTitle(): void {
  const normalized = normalizePenglaiDocumentTitle(document.title);
  if (normalized !== document.title) document.title = normalized;
}

window.addEventListener("DOMContentLoaded", () => {
  keepProductDocumentTitle();
  const head = document.head;
  if (!head) return;
  new MutationObserver(keepProductDocumentTitle).observe(head, {
    childList: true,
    subtree: true,
    characterData: true,
  });
});

ipcRenderer.on(RECOVERY_DIAGNOSTIC_CHANNEL, (_event, payload: unknown) => {
  applyRecoveryDiagnostic(document, payload);
});

const api: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
for (const name of PRELOAD_API) {
  api[name] = (...args: unknown[]) => ipcRenderer.invoke(name, ...args);
}
contextBridge.exposeInMainWorld("penglai", api);
