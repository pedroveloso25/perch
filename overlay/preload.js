// Ponte mínima renderer -> main. O renderer não tem Node (contextIsolation),
// então só enxerga estas funções.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("overlay", {
  setInteractive: (on) => ipcRenderer.send("pet:interactive", !!on),
  dragStart: () => ipcRenderer.send("pet:drag-start"),
  dragEnd: () => ipcRenderer.invoke("pet:drag-end"),          // { click }
  petMenu: () => ipcRenderer.send("pet:menu"),                 // botão direito
  onMouseLeft: (fn) => ipcRenderer.on("pet:mouse-left", () => fn()),
  onMoved: (fn) => ipcRenderer.on("pet:moved", (_e, p) => fn(p)),     // { x, y, g }
  onLanded: (fn) => ipcRenderer.on("pet:landed", (_e, v) => fn(v)),   // velocidade de pouso
  // Cérebro (Fase 4): o main decide a atividade no ócio; o renderer reporta o estado do Claude.
  getMode: () => ipcRenderer.invoke("pet:mode"),                      // { petMode, activity }
  onMode: (fn) => ipcRenderer.on("pet:mode", (_e, on) => fn(on)),
  onActivity: (fn) => ipcRenderer.on("pet:activity", (_e, a) => fn(a)), // rest | walk | sleep | wake
  reportState: (state) => ipcRenderer.send("pet:claude-state", state),
  wakePet: () => ipcRenderer.send("pet:wake"),                        // reação externa acorda o pet
  listSprites: () => ipcRenderer.invoke("pet:list"),          // { pet, files: [{ name, mtime }] }
  // Editor de pet. Os que mudam algo devolvem { ok } ou { error: mensagem }.
  listPets: () => ipcRenderer.invoke("pet:pets"),              // { active, pets: [nome] }
  setActivePet: (pet) => ipcRenderer.invoke("pet:set-active", pet),
  createPet: (pet) => ipcRenderer.invoke("pet:create", pet),
  addImage: (base, bytes) => ipcRenderer.invoke("pet:add-image", base, bytes), // bytes: Uint8Array PNG
  renameImage: (file, base) => ipcRenderer.invoke("pet:rename-image", file, base),
  removeImage: (file) => ipcRenderer.invoke("pet:remove-image", file),
  exportPet: () => ipcRenderer.invoke("pet:export"),
  // Configurações (Fase 5).
  getConfig: () => ipcRenderer.invoke("cfg:get"),
  setConfig: (patch) => ipcRenderer.invoke("cfg:set", patch),       // { ok: snapshot } | { error }
  claudeHooks: (action) => ipcRenderer.invoke("cfg:claude", action), // "connect" | "disconnect"
  openThing: (what) => ipcRenderer.invoke("cfg:open", what),         // "editor" | "pets" | "claude"
  importPet: () => ipcRenderer.invoke("pet:import"),
  readConfig: () => ipcRenderer.invoke("pet:config"),          // pet.json ou {}
  saveConfig: (cfg) => ipcRenderer.invoke("pet:save-config", cfg),
  resizeWindow: (geom) => ipcRenderer.send("pet:resize", geom),    // { w, h, foot, side, up }
  onSpritesChanged: (fn) => ipcRenderer.on("pet:sprites-changed", () => fn()),
});
