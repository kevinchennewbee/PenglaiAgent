import { contextBridge, ipcRenderer } from "electron";
import { PRELOAD_API } from "./preload.js";
import { installPenglaiDocumentTitle } from "./product-title.js";

installPenglaiDocumentTitle(document, MutationObserver);

const api: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
for (const name of PRELOAD_API) {
  api[name] = (...args: unknown[]) => ipcRenderer.invoke(name, ...args);
}
contextBridge.exposeInMainWorld("penglai", api);
