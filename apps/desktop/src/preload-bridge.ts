import { contextBridge, ipcRenderer } from "electron";
import { PRELOAD_API } from "./preload.js";
import {
  applyRecoveryDiagnostic,
  RECOVERY_DIAGNOSTIC_CHANNEL,
} from "./recovery-diagnostic.js";

ipcRenderer.on(RECOVERY_DIAGNOSTIC_CHANNEL, (_event, payload: unknown) => {
  applyRecoveryDiagnostic(document, payload);
});

const api: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
for (const name of PRELOAD_API) {
  api[name] = (...args: unknown[]) => ipcRenderer.invoke(name, ...args);
}
contextBridge.exposeInMainWorld("penglai", api);
