const {
  app, BrowserWindow, screen, Tray, Menu, nativeImage, ipcMain, protocol, net, shell, dialog,
} = require("electron");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { createBody, releaseVelocity, DEFAULTS: PHYSICS } = require("./physics");
const { createPets } = require("./pets");
const { writeZip, readZip } = require("./zip");

// Tamanho inicial da janela em DIP. O renderer pede o tamanho certo
// (pet:resize) assim que mede as imagens do pet: cabe a maior delas, com
// folga para pulo e balanço. O resto é transparente e o clique atravessa.
const SIZE = 240;
const MAX_SIZE = 1200;
const DRAG_TICK_MS = 16;
const PHYSICS_TICK_MS = 16;
const LEAVE_POLL_MS = 100;
const CLICK_MOVE = 4;   // px: soltou mexendo menos que isso...
const CLICK_MS = 350;   // ...e mais rápido que isso = clique, não arraste
const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");

// Janelas transparentes + aceleração de hardware têm histórico de artefato
// no Windows (retângulo preto, flicker). Se acontecer, descomente:
// app.disableHardwareAcceleration();

// Pets moram fora do app (em %APPDATA%), não ao lado do código: depois de
// empacotado o código vira um .asar somente-leitura e "../sprites" não existe.
const PETS_DIR = path.join(app.getPath("userData"), "pets");
const pets = createPets(PETS_DIR);

// Precisa acontecer antes do 'ready'. corsEnabled + o header ACAO no handler
// deixam o renderer ler os pixels da imagem (getImageData) sem "tainted canvas"
// — é isso que permite clicar só onde o pet é opaco.
protocol.registerSchemesAsPrivileged([
  { scheme: "pet", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

let win = null;
let calibrator = null;
let tray = null;
let size = { w: SIZE, h: SIZE };
// Geometria do pet a partir dos pés, medida pelo renderer (pet:resize):
// foot = pés -> base da janela; side/up = meia largura e altura visíveis.
let geom = { foot: 14, side: 60, up: 120 };
let dragTimer = null;
let drag = null;        // { t0, start: {x,y}, samples: [{t,x,y}] }
let leaveTimer = null;
let physTimer = null;
const body = createBody();

// ---------------------------------------------------------------------------
// Preferências (posição e gravidade)
// ---------------------------------------------------------------------------

// Arquivo próprio em vez de electron-store: são duas chaves.
let settings = { gravity: true, feet: null, activePet: "default" };
try {
  settings = { ...settings, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) };
} catch {}

let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch {}
}
function saveSettingsSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 500);
}

// ---------------------------------------------------------------------------
// Posição: tudo gira em torno do ponto dos PÉS (o tamanho da janela muda com
// as imagens do pet, os pés não)
// ---------------------------------------------------------------------------

function feetOf(b = win.getBounds(), foot = geom.foot) {
  return { x: b.x + b.width / 2, y: b.y + b.height - foot };
}

function boundsForFeet(fx, fy) {
  return {
    x: Math.round(fx - size.w / 2),
    y: Math.round(fy - size.h + geom.foot),
    width: size.w,
    height: size.h,
  };
}

// setBounds com tamanho explícito, NÃO setPosition: no Windows, com
// resizable:false, cada setPosition faz a janela crescer alguns px (bug do
// Electron). A 60Hz ela dobrava de tamanho em meio segundo.
function moveTo(b, airborne = false) {
  win.setBounds(b);
  // A malha precisa do movimento da janela para balançar como gelatina;
  // g avisa que é queda livre (tudo cai junto, nada deforma).
  win.webContents.send("pet:moved", { x: b.x, y: b.y, g: airborne ? PHYSICS.gravity : 0 });
}

// workArea do monitor onde estão os pés: o chão é o topo da barra de tarefas
// DAQUELE monitor (multi-monitor com alturas e barras diferentes).
function areaAt(p) {
  return screen.getDisplayNearestPoint({ x: Math.round(p.x), y: Math.round(p.y) }).workArea;
}

function onSomeDisplay(p) {
  return screen.getAllDisplays().some(({ bounds: d }) =>
    p.x >= d.x && p.x < d.x + d.width && p.y >= d.y && p.y <= d.y + d.height);
}

function defaultFeet() {
  const a = screen.getPrimaryDisplay().workArea;
  return { x: a.x + a.width - 160, y: a.y + a.height };
}

function stopPhysics() {
  clearInterval(physTimer);
  physTimer = null;
}

// Deixa o corpo seguir a física a partir de onde está (e com a velocidade
// que tiver) até parar no chão. Sem gravidade, fica onde foi solto.
function settle() {
  if (!win || win.isDestroyed() || dragTimer) return;
  if (!settings.gravity) {
    settings.feet = { x: body.x, y: body.y };
    return saveSettingsSoon();
  }
  if (physTimer) return;
  let last = performance.now();
  physTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return stopPhysics();
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const r = body.step(dt, areaAt(body), geom);
    moveTo(boundsForFeet(body.x, body.y), r.airborne);
    if (r.impact > 80) win.webContents.send("pet:landed", r.impact);
    if (r.resting) {
      stopPhysics();
      settings.feet = { x: body.x, y: body.y };
      saveSettingsSoon();
    }
  }, PHYSICS_TICK_MS);
}

// Monitor desconectado, resolução ou barra de tarefas mudou: se os pés
// ficaram fora de qualquer tela, volta para o canto do monitor principal;
// em todo caso, cai (ou sobe) até o chão novo.
function reanchor() {
  if (!win || win.isDestroyed() || dragTimer) return;
  stopPhysics();
  let f = feetOf();
  if (!onSomeDisplay(f)) {
    f = defaultFeet();
    win.setBounds(boundsForFeet(f.x, f.y));
  }
  body.place(f.x, f.y);
  settle();
}

// Pet ativo: o da última vez, se a pasta ainda existe; senão "default".
function activePet() {
  return pets.exists(settings.activePet) ? settings.activePet : "default";
}

// Avisa overlay e editor que o pet (imagens, pet.json ou qual pet) mudou.
function notifyPetChanged() {
  for (const w of [win, calibrator])
    if (w && !w.isDestroyed()) w.webContents.send("pet:sprites-changed");
}

function setActivePet(pet) {
  if (!pets.exists(pet)) throw new Error("pet não existe: " + pet);
  settings.activePet = pet;
  saveSettings();
  watchPetDir();
  rebuildTray();
  notifyPetChanged();
}

// pet://p/<pet>/<arquivo>  ->  %APPDATA%/perch/pets/<pet>/<arquivo>
// O nome do pet vai no caminho, não no host: o host de um esquema "standard"
// é normalizado (minúsculas, sem espaço) e "Pássaro Azul" viraria outra coisa.
function registerPetProtocol() {
  protocol.handle("pet", async (req) => {
    const { pathname } = new URL(req.url);
    const file = path.resolve(PETS_DIR, "." + decodeURIComponent(pathname));

    // Sem isto, pet://p/../../../Windows/... leria qualquer arquivo.
    if (!file.startsWith(PETS_DIR + path.sep)) return new Response(null, { status: 403 });

    const res = await net.fetch(pathToFileURL(file).toString()).catch(() => null);
    if (!res || !res.ok) return new Response(null, { status: 404 });

    return new Response(res.body, {
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "image/png",
        "Access-Control-Allow-Origin": "*",
        // O usuário troca o arquivo e clica Recarregar: cache mostraria o antigo.
        "Cache-Control": "no-store",
      },
    });
  });
}

function createWindow() {
  // Onde o pet estava da última vez, se esse ponto ainda existe em algum
  // monitor; senão, no chão (topo da barra de tarefas) do monitor principal.
  const saved = settings.feet;
  const feet = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && onSomeDisplay(saved)
    ? saved : defaultFeet();
  body.place(feet.x, feet.y);
  const start = boundsForFeet(feet.x, feet.y);

  win = new BrowserWindow({
    width: start.width,
    height: start.height,
    x: start.x,
    y: start.y,

    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,

    // Mantém fora do Alt+Tab e da barra de tarefas.
    skipTaskbar: true,

    // No Windows equivale a WS_EX_NOACTIVATE: a janela nunca rouba o foco.
    // Continua valendo com o pet clicável: clicar/arrastar não tira o cursor
    // do seu editor. Por isso o arraste é feito à mão (setBounds) e não com
    // -webkit-app-region, que exige ativar a janela.
    focusable: false,

    alwaysOnTop: true,

    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 'screen-saver' é o nível mais alto de always-on-top do Electron.
  // Ainda assim NÃO desenha sobre app em fullscreen exclusivo — isso é
  // limitação do Windows, não do Electron.
  win.setAlwaysOnTop(true, "screen-saver");

  // Começa atravessável. forward:true mantém o mousemove chegando no renderer,
  // que testa se o cursor está sobre um pixel opaco e pede para virar clicável
  // (pet:interactive). Ligar o mouse na janela inteira faria o quadrado
  // transparente de 160px bloquear cliques no que está atrás.
  win.setIgnoreMouseEvents(true, { forward: true });

  win.loadFile(path.join(__dirname, "index.html"));
}

function stopDrag() {
  clearInterval(dragTimer);
  dragTimer = null;
}

function cursorInsideWindow() {
  const p = screen.getCursorScreenPoint();
  const b = win.getBounds();
  return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
}

function stopLeaveWatch() {
  clearInterval(leaveTimer);
  leaveTimer = null;
}

function registerIpc() {
  ipcMain.on("pet:interactive", (_e, on) => {
    if (!win) return;
    win.setIgnoreMouseEvents(!on, { forward: true });

    // Rede de segurança: com a janela clicável, um movimento rápido que pula
    // a borda transparente num frame só sai sem disparar NENHUM evento no
    // renderer (nem mousemove, nem mouseout). Sem isto o pet ficava preso em
    // interactive e o quadrado transparente engolia cliques do que está atrás.
    stopLeaveWatch();
    if (on) {
      leaveTimer = setInterval(() => {
        if (!win || win.isDestroyed()) return stopLeaveWatch();
        if (dragTimer || cursorInsideWindow()) return;
        stopLeaveWatch();
        win.setIgnoreMouseEvents(true, { forward: true });
        win.webContents.send("pet:mouse-left");
      }, LEAVE_POLL_MS);
    }
  });

  // O main segue o cursor (em vez de o renderer mandar deltas) porque o
  // renderer perde o mousemove assim que o cursor escapa dos 160px da janela
  // num movimento rápido; screen.getCursorScreenPoint não tem esse limite.
  ipcMain.on("pet:drag-start", () => {
    if (!win) return;
    stopDrag();
    stopPhysics(); // pegou no ar: para de cair
    const cursor = screen.getCursorScreenPoint();
    const [wx, wy] = win.getPosition();
    const off = { x: cursor.x - wx, y: cursor.y - wy };
    drag = { t0: Date.now(), start: cursor, samples: [] };
    dragTimer = setInterval(() => {
      if (!win || win.isDestroyed()) return stopDrag();
      const p = screen.getCursorScreenPoint();
      drag.samples.push({ t: Date.now(), x: p.x, y: p.y });
      if (drag.samples.length > 12) drag.samples.shift();
      moveTo({ x: p.x - off.x, y: p.y - off.y, width: size.w, height: size.h });
    }, DRAG_TICK_MS);
  });

  // Soltou: se mal mexeu, foi um clique (o renderer reage); senão o pet sai
  // com a velocidade do gesto e a gravidade faz o resto.
  ipcMain.handle("pet:drag-end", () => {
    if (!dragTimer || !win) return { click: false };
    stopDrag();
    const p = screen.getCursorScreenPoint();
    const click = Math.hypot(p.x - drag.start.x, p.y - drag.start.y) < CLICK_MOVE
      && Date.now() - drag.t0 < CLICK_MS;
    const f = feetOf();
    body.place(f.x, f.y);
    if (!click) {
      const v = releaseVelocity(drag.samples);
      body.throw(v.vx, v.vy);
    }
    drag = null;
    settle();
    return { click };
  });

  // O renderer não lista diretórios (pet:// só serve arquivo); quem sabe
  // quais PNGs existem é o main.
  // mtime vai junto para o renderer saber quando reanalisar uma imagem.
  ipcMain.handle("pet:list", () => {
    const pet = activePet();
    return { pet, files: pets.files(pet) };
  });

  ipcMain.handle("pet:config", () => pets.readConfig(activePet()));

  // Só o editor grava (pets.js valida: o overlay relê o arquivo a cada
  // mudança na pasta e ele não pode virar lixo).
  ipcMain.handle("pet:save-config", (_e, cfg) => {
    pets.writeConfig(activePet(), cfg);
    return true;
  });

  // --- Editor de pet (Fase 3). Erros voltam como { error } para a tela. ---
  const guard = (fn) => async (_e, ...args) => {
    try { return { ok: await fn(...args) }; } catch (err) { return { error: err.message }; }
  };

  ipcMain.handle("pet:pets", () => ({ active: activePet(), pets: pets.list() }));
  ipcMain.handle("pet:set-active", guard((pet) => setActivePet(pet)));
  ipcMain.handle("pet:create", guard((pet) => {
    if (pets.exists(pet)) throw new Error("já existe um pet com esse nome");
    pets.ensure(pet);
    setActivePet(pet);
    return pet;
  }));
  ipcMain.handle("pet:add-image", guard((base, bytes) =>
    pets.addImage(activePet(), base, Buffer.from(bytes))));
  ipcMain.handle("pet:rename-image", guard((file, base) => pets.renameImage(activePet(), file, base)));
  // Lixeira, não apagar: o usuário pode se arrepender.
  ipcMain.handle("pet:remove-image", guard((file) =>
    pets.removeImage(activePet(), file, (p) => shell.trashItem(p))));

  ipcMain.handle("pet:export", guard(async () => {
    const pet = activePet();
    const { canceled, filePath } = await dialog.showSaveDialog(calibrator || undefined, {
      title: "Exportar pet",
      defaultPath: path.join(app.getPath("documents"), pet + ".zip"),
      filters: [{ name: "Pet do perch", extensions: ["zip"] }],
    });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, writeZip(pets.exportEntries(pet)));
    return filePath;
  }));

  ipcMain.handle("pet:import", guard(async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(calibrator || undefined, {
      title: "Importar pet",
      filters: [{ name: "Pet do perch", extensions: ["zip"] }],
      properties: ["openFile"],
    });
    if (canceled || !filePaths?.length) return null;
    const zip = filePaths[0];
    if (fs.statSync(zip).size > 300 * 1024 * 1024) throw new Error("arquivo grande demais");
    const pet = pets.importEntries(readZip(fs.readFileSync(zip)), path.basename(zip, path.extname(zip)));
    setActivePet(pet);
    return pet;
  }));

  // Novo tamanho mantendo os PÉS no mesmo ponto da tela. A janela pode
  // passar da borda ou cobrir a barra de tarefas: a parte de fora é
  // transparente e atravessável; quem respeita as bordas é o corpo (physics).
  ipcMain.on("pet:resize", (e, req) => {
    if (!win || e.sender !== win.webContents) return;
    const num = (v, min, max, def) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def);
    const feet = feetOf();
    size = { w: Math.round(num(req.w, 80, MAX_SIZE, SIZE)), h: Math.round(num(req.h, 80, MAX_SIZE, SIZE)) };
    geom = {
      foot: num(req.foot, 0, size.h, geom.foot),
      side: num(req.side, 0, size.w / 2, geom.side),
      up: num(req.up, 0, size.h, geom.up),
    };
    win.setBounds(boundsForFeet(feet.x, feet.y));
    if (!dragTimer && !physTimer) {
      body.place(feet.x, feet.y);
      settle(); // primeira medição ao abrir: confere se está no chão
    }
  });
}

function openCalibrator() {
  if (calibrator && !calibrator.isDestroyed()) return calibrator.focus();
  calibrator = new BrowserWindow({
    width: 1100,
    height: 760,
    title: "Perch · editar pet",
    autoHideMenuBar: true,
    backgroundColor: "#14161f",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  calibrator.loadFile(path.join(__dirname, "calibrate.html"));
}

// Imagem nova ou trocada na pasta aparece sem reiniciar. Debounce porque
// copiar um arquivo dispara vários eventos seguidos. Trocou de pet: vigia a
// pasta nova.
let watcher = null;
function watchPetDir() {
  watcher?.close();
  watcher = null;
  let timer = null;
  try {
    watcher = fs.watch(pets.ensure(activePet()), () => {
      clearTimeout(timer);
      timer = setTimeout(notifyPetChanged, 300);
    });
  } catch {}
}

// Quadrado laranja 16x16 gerado em memória. nativeImage.createEmpty() deixava
// o ícone invisível na bandeja — e a bandeja é a única forma de fechar o app.
function trayIcon() {
  const n = 16;
  const buf = Buffer.alloc(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const corner = (x < 2 || x > n - 3) && (y < 2 || y > n - 3);
      const i = (y * n + x) * 4; // BGRA
      buf[i] = 0x57; buf[i + 1] = 0x77; buf[i + 2] = 0xd9; buf[i + 3] = corner ? 0 : 255;
    }
  }
  return nativeImage.createFromBitmap(buf, { width: n, height: n });
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip("Perch");
  rebuildTray();
}

// Reconstruído quando a lista de pets ou o ativo muda (o submenu é estático).
function rebuildTray() {
  if (!tray) return;
  const active = activePet();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Pet",
        submenu: pets.list().map((pet) => ({
          label: pet,
          type: "radio",
          checked: pet === active,
          click: () => setActivePet(pet),
        })),
      },
      { label: "Editar pet…", click: openCalibrator },
      { label: "Abrir pasta do pet", click: () => shell.openPath(pets.dirOf(active)) },
      {
        label: "Gravidade",
        type: "checkbox",
        checked: settings.gravity,
        click: (item) => {
          settings.gravity = item.checked;
          saveSettings();
          reanchor(); // ligou: cai de onde está
        },
      },
      { label: "Recarregar", click: () => win && win.reload() },
      { type: "separator" },
      { label: "Sair", click: () => app.quit() },
    ])
  );
}

app.whenReady().then(() => {
  pets.ensure("default");
  registerPetProtocol();
  registerIpc();
  createWindow();
  watchPetDir();
  createTray();
  if (process.argv.includes("--calibrate")) openCalibrator(); // atalho de desenvolvimento

  // Monitor plugado/desplugado, resolução, escala ou barra de tarefas mudou.
  for (const ev of ["display-added", "display-removed", "display-metrics-changed"])
    screen.on(ev, () => setTimeout(reanchor, 300)); // espera o Windows terminar de rearrumar
});

app.on("before-quit", () => {
  if (win && !win.isDestroyed() && !dragTimer) settings.feet = feetOf();
  saveSettings();
});

// Sem isto o app morre ao fechar a janela; aqui ele deve viver no tray.
app.on("window-all-closed", (e) => e.preventDefault());
