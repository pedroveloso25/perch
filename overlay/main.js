const {
  app, BrowserWindow, screen, Tray, Menu, nativeImage, ipcMain, protocol, net, shell,
} = require("electron");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

// Tamanho inicial da janela em DIP. O renderer pede o tamanho certo
// (pet:resize) assim que mede as imagens do pet: cabe a maior delas, com
// folga para pulo e balanço. O resto é transparente e o clique atravessa.
const SIZE = 240;
const MAX_SIZE = 1200;
const MARGIN = 10; // distância da borda da área de trabalho
const DRAG_TICK_MS = 16;
const LEAVE_POLL_MS = 100;

// Janelas transparentes + aceleração de hardware têm histórico de artefato
// no Windows (retângulo preto, flicker). Se acontecer, descomente:
// app.disableHardwareAcceleration();

// Pets moram fora do app (em %APPDATA%), não ao lado do código: depois de
// empacotado o código vira um .asar somente-leitura e "../sprites" não existe.
const PETS_DIR = path.join(app.getPath("userData"), "pets");
const ACTIVE_PET = "default";

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
let dragTimer = null;
let leaveTimer = null;

function ensurePetDir() {
  const dir = path.join(PETS_DIR, ACTIVE_PET);
  fs.mkdirSync(dir, { recursive: true });
  const readme = path.join(dir, "LEIA-ME.txt");
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, [
      "Coloque aqui os PNGs do pet (fundo transparente). Nomes aceitos:",
      "",
      "  pensando   (ou working, trabalhando)   o Claude está trabalhando",
      "  permissao  (ou blocked, bloqueado)     esperando você",
      "  finalizado (ou done, pronto)           terminou",
      "  parado     (ou idle)                   opcional, o pet some em repouso",
      "",
      "  Opcionais por ferramenta: lendo/sherlock (Read, Grep, Glob),",
      "  terminal/cooking (Bash), editando (Edit, Write).",
      "",
      "Variações numeradas (pensando1.png, pensando2.png...) são sorteadas.",
      "O recorte, o tamanho e o alinhamento pelos pés são automáticos; para",
      "ajustar, use 'Calibrar tamanho' no ícone da bandeja (grava pet.json).",
      "Arquivos novos aparecem sozinhos; sem imagem, aparece um quadrado laranja.",
      "",
    ].join("\r\n"));
  }
}

// pet://<nome-do-pet>/<arquivo>  ->  %APPDATA%/perch/pets/<nome>/<arquivo>
function registerPetProtocol() {
  protocol.handle("pet", async (req) => {
    const { host, pathname } = new URL(req.url);
    const file = path.resolve(PETS_DIR, host, "." + decodeURIComponent(pathname));

    // Sem isto, pet://default/../../../Windows/... leria qualquer arquivo.
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
  // workArea (e não bounds) respeita a barra de tarefas: o pet não fica
  // escondido atrás dela quando ancorado no canto inferior direito.
  const { workArea } = screen.getPrimaryDisplay();

  win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    x: workArea.x + workArea.width - SIZE - MARGIN,
    y: workArea.y + workArea.height - SIZE - MARGIN,

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
    const cursor = screen.getCursorScreenPoint();
    const [wx, wy] = win.getPosition();
    const off = { x: cursor.x - wx, y: cursor.y - wy };
    dragTimer = setInterval(() => {
      if (!win || win.isDestroyed()) return stopDrag();
      const p = screen.getCursorScreenPoint();
      // setBounds com tamanho explícito, NÃO setPosition: no Windows, com
      // resizable:false, cada setPosition faz a janela crescer alguns px
      // (bug do Electron). A 60Hz ela dobrava de tamanho em meio segundo.
      const x = p.x - off.x, y = p.y - off.y;
      win.setBounds({ x, y, width: size.w, height: size.h });
      // A malha precisa da aceleração da janela para balançar como gelatina.
      win.webContents.send("pet:moved", { x, y });
    }, DRAG_TICK_MS);
  });

  ipcMain.on("pet:drag-end", stopDrag);

  // O renderer não lista diretórios (pet:// só serve arquivo); quem sabe
  // quais PNGs existem é o main.
  // mtime vai junto para o renderer saber quando reanalisar uma imagem.
  ipcMain.handle("pet:list", () => {
    const dir = path.join(PETS_DIR, ACTIVE_PET);
    try {
      return fs.readdirSync(dir)
        .filter((f) => /\.png$/i.test(f))
        .map((name) => ({ name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }));
    } catch {
      return [];
    }
  });

  ipcMain.handle("pet:config", () => {
    try {
      return JSON.parse(fs.readFileSync(path.join(PETS_DIR, ACTIVE_PET, "pet.json"), "utf8"));
    } catch {
      return {}; // sem pet.json (ou inválido): tudo no palpite automático
    }
  });

  // Só o calibrador grava. Valida o formato: o overlay relê o arquivo a cada
  // mudança na pasta e ele não pode virar lixo.
  ipcMain.handle("pet:save-config", (_e, cfg) => {
    const out = { version: 1, images: {} };
    if (Number.isFinite(cfg?.height) && cfg.height > 0) out.height = cfg.height;
    for (const [name, e] of Object.entries(cfg?.images || {})) {
      if (!/^[^\\/:*?"<>|]+\.png$/i.test(name)) continue;
      if (!Number.isFinite(e?.scale) || e.scale <= 0 || !Number.isFinite(e?.floor)) continue;
      out.images[name] = { scale: e.scale, floor: e.floor };
    }
    fs.writeFileSync(path.join(PETS_DIR, ACTIVE_PET, "pet.json"), JSON.stringify(out, null, 2));
    return true;
  });

  // Novo tamanho mantendo os pés (centro da base) no mesmo lugar da tela,
  // sem sair da área de trabalho. setBounds com tamanho explícito, como no
  // arraste.
  ipcMain.on("pet:resize", (e, req) => {
    if (!win || e.sender !== win.webContents) return;
    const w = Math.round(Math.min(MAX_SIZE, Math.max(80, req.w)));
    const h = Math.round(Math.min(MAX_SIZE, Math.max(80, req.h)));
    const b = win.getBounds();
    const area = screen.getDisplayMatching(b).workArea;
    const x = Math.round(b.x + b.width / 2 - w / 2);
    const y = b.y + b.height - h;
    size = { w, h };
    win.setBounds({
      x: Math.min(Math.max(x, area.x), area.x + area.width - w),
      y: Math.min(Math.max(y, area.y), area.y + area.height - h),
      width: w,
      height: h,
    });
  });
}

function openCalibrator() {
  if (calibrator && !calibrator.isDestroyed()) return calibrator.focus();
  calibrator = new BrowserWindow({
    width: 1100,
    height: 760,
    title: "Perch · calibrar tamanho",
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
// copiar um arquivo dispara vários eventos seguidos.
function watchPetDir() {
  let timer = null;
  try {
    fs.watch(path.join(PETS_DIR, ACTIVE_PET), () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const w of [win, calibrator])
          if (w && !w.isDestroyed()) w.webContents.send("pet:sprites-changed");
      }, 300);
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
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Abrir pasta do pet", click: () => shell.openPath(path.join(PETS_DIR, ACTIVE_PET)) },
      { label: "Calibrar tamanho…", click: openCalibrator },
      { label: "Recarregar", click: () => win && win.reload() },
      { type: "separator" },
      { label: "Sair", click: () => app.quit() },
    ])
  );
}

app.whenReady().then(() => {
  ensurePetDir();
  registerPetProtocol();
  registerIpc();
  createWindow();
  watchPetDir();
  createTray();
  if (process.argv.includes("--calibrate")) openCalibrator(); // atalho de desenvolvimento
});

// Sem isto o app morre ao fechar a janela; aqui ele deve viver no tray.
app.on("window-all-closed", (e) => e.preventDefault());
