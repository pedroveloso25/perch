/**
 * Zip mínimo para exportar/importar pets, sem dependência: escrita sem
 * compressão (os PNGs já são comprimidos) e leitura de "stored" e "deflate"
 * (o que qualquer compactador gera). Nada de zip64, criptografia ou
 * multivolume: um pet tem poucas imagens.
 *
 * O zip vem de fora (alguém compartilhou), então a leitura desconfia de tudo:
 * limite de entradas e de bytes descomprimidos (zip bomb) e nome de arquivo
 * validado por quem chama (ver main.js).
 */
const zlib = require("zlib");

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @param entries [{ name, data: Buffer }] -> Buffer do .zip */
function writeZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  const DOS_TIME = 0, DOS_DATE = (2024 - 1980) << 9 | 1 << 5 | 1; // data fixa: zip reproduzível
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);        // versão necessária
    local.writeUInt16LE(0x0800, 6);    // flag: nome em UTF-8
    local.writeUInt16LE(0, 8);         // método: stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/**
 * @returns [{ name, data: Buffer }] — diretórios ignorados.
 * Lança Error com mensagem legível se o arquivo não for um zip aceitável.
 */
function readZip(buf, { maxEntries = 200, maxTotal = 200 * 1024 * 1024 } = {}) {
  // O "end of central directory" fica nos últimos 22 bytes + comentário (até 64KB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("não é um arquivo .zip");
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count > maxEntries) throw new Error(`zip com arquivos demais (${count})`);

  const out = [];
  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error("zip corrompido");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString(flags & 0x0800 ? "utf8" : "latin1", p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;

    if (name.endsWith("/")) continue;
    if (flags & 1) throw new Error("zip com senha não é suportado");
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error("zip corrompido");
    total += usize;
    if (total > maxTotal) throw new Error("zip grande demais");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    // maxOutputLength: o tamanho declarado pode mentir (zip bomb).
    else if (method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(usize, 1) });
    else throw new Error(`compressão não suportada (método ${method})`);
    if (data.length !== usize || crc32(data) !== crc) throw new Error(`arquivo corrompido no zip: ${name}`);
    out.push({ name, data });
  }
  return out;
}

module.exports = { writeZip, readZip, crc32 };
