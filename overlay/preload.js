// Ponte mínima renderer -> main. O renderer não tem Node (contextIsolation),
// então só enxerga estas funções.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("overlay", {
  setInteractive: (on) => ipcRenderer.send("pet:interactive", !!on),
  dragStart: () => ipcRenderer.send("pet:drag-start"),
  dragEnd: () => ipcRenderer.invoke("pet:drag-end"),          // { click }
  onMouseLeft: (fn) => ipcRenderer.on("pet:mouse-left", () => fn()),
  onMoved: (fn) => ipcRenderer.on("pet:moved", (_e, p) => fn(p)),     // { x, y, g }
  onLanded: (fn) => ipcRenderer.on("pet:landed", (_e, v) => fn(v)),   // velocidade de pouso
  listSprites: () => ipcRenderer.invoke("pet:list"),          // [{ name, mtime }]
  readConfig: () => ipcRenderer.invoke("pet:config"),          // pet.json ou {}
  saveConfig: (cfg) => ipcRenderer.invoke("pet:save-config", cfg),
  resizeWindow: (geom) => ipcRenderer.send("pet:resize", geom),    // { w, h, foot, side, up }
  onSpritesChanged: (fn) => ipcRenderer.on("pet:sprites-changed", () => fn()),
});
