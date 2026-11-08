/**
 * Preload for the click-through desktop hands overlay.
 * Narrow IPC surface — landmark frames in, control clicks out.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jarvisOverlay", {
  onFrame: (cb) => {
    const wrapped = (_e, frame) => cb(frame);
    ipcRenderer.on("jarvis:overlay-frame", wrapped);
    return () => ipcRenderer.removeListener("jarvis:overlay-frame", wrapped);
  },
  onMeta: (cb) => {
    const wrapped = (_e, meta) => cb(meta);
    ipcRenderer.on("jarvis:overlay-meta", wrapped);
    return () => ipcRenderer.removeListener("jarvis:overlay-meta", wrapped);
  },
  send: (action, payload) => {
    ipcRenderer.send("jarvis:overlay-action", { action, ...(payload || {}) });
  },
});
