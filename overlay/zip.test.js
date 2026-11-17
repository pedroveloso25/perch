const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const { writeZip, readZip, crc32 } = require("./zip");

test("crc32 bate com o valor conhecido", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("ida e volta preserva nomes (inclusive acento) e bytes", () => {
  const entries = [
    { name: "pensando1.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) },
    { name: "permissão.png", data: Buffer.alloc(5000, 7) },
    { name: "pet.json", data: Buffer.from('{"version":1}') },
  ];
  const back = readZip(writeZip(entries));
  assert.deepEqual(back.map((e) => e.name), entries.map((e) => e.name));
  back.forEach((e, i) => assert.ok(e.data.equals(entries[i].data)));
});

// Monta à mão um zip com uma entrada deflate, como o compactador do Windows faz.
function deflateZip(name, data, { lieSize } = {}) {
  const comp = zlib.deflateRawSync(data);
  const nameBuf = Buffer.from(name);
  const usize = lieSize ?? data.length;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(usize, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(usize, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + nameBuf.length, 12);
  end.writeUInt32LE(30 + nameBuf.length + comp.length, 16);
  return Buffer.concat([local, nameBuf, comp, central, nameBuf, end]);
}

test("lê entrada comprimida com deflate", () => {
  const data = Buffer.alloc(100_000, "a");
  const [e] = readZip(deflateZip("pet/finalizado.png", data));
  assert.equal(e.name, "pet/finalizado.png");
  assert.ok(e.data.equals(data));
});

test("zip bomb: tamanho declarado menor que o real é recusado", () => {
  const data = Buffer.alloc(1_000_000, 0);
  assert.throws(() => readZip(deflateZip("bomba.png", data, { lieSize: 10 })));
});

test("limite de bytes totais", () => {
  const big = writeZip([{ name: "a.png", data: Buffer.alloc(2000) }]);
  assert.throws(() => readZip(big, { maxTotal: 1000 }), /grande demais/);
});

test("arquivo que não é zip dá erro legível", () => {
  assert.throws(() => readZip(Buffer.from("isto não é um zip, é texto qualquer")), /não é um arquivo .zip/);
});

test("crc errado é detectado", () => {
  const z = writeZip([{ name: "a.png", data: Buffer.from("conteudo") }]);
  z[30 + 5] ^= 0xff; // estraga um byte dos dados
  assert.throws(() => readZip(z), /corrompido/);
});
