/* Gera os PNGs do mascote de fábrica e os ícones em overlay/assets/.
   Uso (em overlay/):  npx electron tools/make-assets.js
   O desenho fica em tools/bird.js e roda numa janela oculta do próprio
   Electron (canvas 2D de navegador, sem dependência nativa). Os PNGs gerados
   vão para o repo: são arte própria e entram no instalador. */
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "assets");

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false });
    await win.loadURL("data:text/html,<!doctype html><meta charset=utf-8>");
    const code = fs.readFileSync(path.join(__dirname, "bird.js"), "utf8");
    const files = await win.webContents.executeJavaScript(`${code}\n;renderAll()`);
    for (const [name, dataUrl] of Object.entries(files)) {
      const file = path.join(OUT, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
      console.log("gerado", path.relative(path.join(__dirname, ".."), file));
    }
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
  app.quit();
});
