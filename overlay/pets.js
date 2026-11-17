/**
 * Pastas de pet: cada pet é uma pasta em %APPDATA%/perch/pets com PNGs e um
 * pet.json opcional (tamanho e chão por imagem, ver mesh.js → place). Só fs,
 * sem Electron: o diretório base é injetado e os testes usam uma pasta
 * temporária (pets.test.js).
 *
 * Tudo que vem de fora (renderer, zip compartilhado) passa pelas validações
 * daqui antes de virar caminho no disco.
 */
const fs = require("fs");
const path = require("path");

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_IMAGE = 25 * 1024 * 1024;
const IMAGE_RE = /^[^\\/:*?"<>|\x00-\x1f.][^\\/:*?"<>|\x00-\x1f]*\.png$/i;
const BASE_RE = /^[a-z]{2,20}$/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

const README = [
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
  "Mais fácil: bandeja → 'Editar pet…' adiciona imagens (remove o fundo),",
  "ajusta tamanho e chão (grava pet.json) e exporta o pet em .zip.",
  "",
].join("\r\n");

function isPng(buf) {
  return Buffer.isBuffer(buf) && buf.length > PNG_SIG.length && buf.subarray(0, 8).equals(PNG_SIG);
}

function validPetName(name) {
  return typeof name === "string"
    && /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,39}$/u.test(name)
    && !/\s$/.test(name)
    && !WINDOWS_RESERVED.test(name);
}

const validImageName = (name) => typeof name === "string" && IMAGE_RE.test(name);

/** "Meu Pet!!" -> "Meu Pet"; vazio vira "pet". */
function sanitizePetName(name) {
  const s = String(name || "").normalize("NFC").replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 40).trim();
  return validPetName(s) ? s : "pet";
}

function sanitizeConfig(cfg) {
  const out = { version: 1, images: {} };
  if (Number.isFinite(cfg?.height) && cfg.height > 0) out.height = cfg.height;
  for (const [name, e] of Object.entries(cfg?.images || {})) {
    if (!validImageName(name)) continue;
    if (!Number.isFinite(e?.scale) || e.scale <= 0 || !Number.isFinite(e?.floor)) continue;
    out.images[name] = { scale: e.scale, floor: e.floor };
  }
  return out;
}

function createPets(root) {
  fs.mkdirSync(root, { recursive: true });

  function dirOf(pet) {
    if (!validPetName(pet)) throw new Error(`nome de pet inválido: ${pet}`);
    return path.join(root, pet);
  }
  function fileOf(pet, file) {
    if (!validImageName(file) && file !== "pet.json") throw new Error(`nome de arquivo inválido: ${file}`);
    return path.join(dirOf(pet), file);
  }

  const api = {
    root,

    list() {
      return fs.readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && validPetName(d.name))
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b, "pt-BR"));
    },

    exists: (pet) => validPetName(pet) && fs.existsSync(dirOf(pet)),

    ensure(pet) {
      const dir = dirOf(pet);
      fs.mkdirSync(dir, { recursive: true });
      const readme = path.join(dir, "LEIA-ME.txt");
      if (!fs.existsSync(readme)) fs.writeFileSync(readme, README);
      return dir;
    },

    dirOf,

    files(pet) {
      const dir = dirOf(pet);
      try {
        return fs.readdirSync(dir)
          .filter(validImageName)
          .map((name) => ({ name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }));
      } catch {
        return [];
      }
    },

    readConfig(pet) {
      try {
        return JSON.parse(fs.readFileSync(fileOf(pet, "pet.json"), "utf8"));
      } catch {
        return {}; // sem pet.json (ou inválido): tudo no palpite automático
      }
    },

    writeConfig(pet, cfg) {
      const out = sanitizeConfig(cfg);
      fs.writeFileSync(fileOf(pet, "pet.json"), JSON.stringify(out, null, 2));
      return out;
    },

    /** Próximo nome livre para a base: pensando -> pensando4.png se já há 1..3. */
    nextName(pet, base) {
      if (!BASE_RE.test(base)) throw new Error(`estado inválido: ${base}`);
      const taken = new Set();
      for (const { name } of api.files(pet)) {
        const m = name.toLowerCase().match(/^([a-z]+?)[\s_-]*(\d*)\.png$/);
        if (m && m[1] === base) taken.add(m[2] ? +m[2] : 1);
      }
      let n = 1;
      while (taken.has(n)) n++;
      return `${base}${n}.png`;
    },

    addImage(pet, base, png) {
      if (!isPng(png)) throw new Error("não é um PNG");
      if (png.length > MAX_IMAGE) throw new Error("imagem grande demais");
      api.ensure(pet);
      const name = api.nextName(pet, base);
      fs.writeFileSync(fileOf(pet, name), png, { flag: "wx" }); // wx: nunca sobrescreve
      return name;
    },

    /** Troca o estado de uma imagem (renomeia) levando junto o ajuste do pet.json. */
    renameImage(pet, file, base) {
      const from = fileOf(pet, file);
      if (!fs.existsSync(from)) throw new Error(`não existe: ${file}`);
      const name = api.nextName(pet, base);
      fs.renameSync(from, fileOf(pet, name));
      const cfg = api.readConfig(pet);
      if (cfg.images?.[file]) {
        cfg.images[name] = cfg.images[file];
        delete cfg.images[file];
        api.writeConfig(pet, cfg);
      }
      return name;
    },

    /** @param trash (caminho) => Promise — o main passa shell.trashItem: recuperável. */
    async removeImage(pet, file, trash) {
      await trash(fileOf(pet, file));
      const cfg = api.readConfig(pet);
      if (cfg.images?.[file]) {
        delete cfg.images[file];
        api.writeConfig(pet, cfg);
      }
    },

    /** Conteúdo do .zip de compartilhamento: imagens + pet.json. */
    exportEntries(pet) {
      const entries = api.files(pet).map(({ name }) => ({ name, data: fs.readFileSync(fileOf(pet, name)) }));
      const cfg = api.readConfig(pet);
      if (cfg.images) entries.push({ name: "pet.json", data: Buffer.from(JSON.stringify(sanitizeConfig(cfg), null, 2)) });
      return entries;
    },

    /**
     * Cria um pet novo a partir das entradas de um zip. Pastas dentro do zip
     * são achatadas; o que não for PNG válido ou pet.json é ignorado.
     * @returns nome do pet criado (nunca sobrescreve um existente)
     */
    importEntries(entries, suggested) {
      const images = [];
      let cfg = null;
      for (const { name, data } of entries) {
        const file = name.split(/[\\/]/).pop();
        if (file.toLowerCase() === "pet.json") {
          try { cfg = JSON.parse(data.toString("utf8")); } catch {}
        } else if (validImageName(file) && isPng(data) && data.length <= MAX_IMAGE
                   && !images.some((i) => i.file.toLowerCase() === file.toLowerCase())) {
          images.push({ file, data });
        }
      }
      if (!images.length) throw new Error("o zip não tem nenhuma imagem PNG");

      const base = sanitizePetName(suggested);
      let pet = base;
      for (let n = 2; fs.existsSync(path.join(root, pet)); n++) pet = `${base} ${n}`;
      api.ensure(pet);
      for (const { file, data } of images) fs.writeFileSync(fileOf(pet, file), data);
      if (cfg) api.writeConfig(pet, cfg);
      return pet;
    },
  };
  return api;
}

module.exports = { createPets, validPetName, validImageName, sanitizePetName, sanitizeConfig, isPng };
