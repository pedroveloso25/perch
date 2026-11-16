// Ponte mínima renderer -> main. O renderer não tem Node (contextIsolation),
// então só enxerga estas funções.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("overlay", {
  setInteractive: (on) => ipcRenderer.send("pet:interactive", !!on),
  dragStart: () => ipcRenderer.send("pet:drag-start"),
  dragEnd: () => ipcRenderer.send("pet:drag-end"),
  onMouseLeft: (fn) => ipcRenderer.on("pet:mouse-left", () => fn()),
});
