const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createPets, validPetName, validImageName, sanitizePetName } = require("./pets");

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("resto")]);

function tmpPets() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perch-pets-"));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return createPets(dir);
}

test("nomes de pet: aceita acento e espaço, recusa caminho e reservado", () => {
  for (const ok of ["default", "Clawd", "Pássaro Azul", "gato_2", "a-b"]) assert.ok(validPetName(ok), ok);
  for (const bad of ["", "..", "../x", "a/b", "a\\b", "CON", "nul", " x", "x ", "a".repeat(41), "x:y"])
    assert.ok(!validPetName(bad), JSON.stringify(bad));
});

test("nomes de imagem: só .png simples", () => {
  assert.ok(validImageName("pensando1.png"));
  assert.ok(validImageName("permissão.png"));
  for (const bad of ["../x.png", "a/b.png", ".png", "x.jpg", "x.png.exe", "pet.json", "c:x.png"])
    assert.ok(!validImageName(bad), bad);
});

test("sanitizePetName limpa o nome sugerido pelo arquivo .zip", () => {
  assert.equal(sanitizePetName("Meu Pet!!"), "Meu Pet");
  assert.equal(sanitizePetName("../../etc"), "etc");
  assert.equal(sanitizePetName("???"), "pet");
  assert.equal(sanitizePetName("CON"), "pet");
});

test("addImage numera a partir do que existe (inclusive sem número)", () => {
  const pets = tmpPets();
  pets.ensure("default");
  fs.writeFileSync(path.join(pets.dirOf("default"), "permissao.png"), PNG);
  fs.writeFileSync(path.join(pets.dirOf("default"), "pensando1.png"), PNG);
  fs.writeFileSync(path.join(pets.dirOf("default"), "pensando3.png"), PNG);
  assert.equal(pets.addImage("default", "permissao", PNG), "permissao2.png");
  assert.equal(pets.addImage("default", "pensando", PNG), "pensando2.png");
  assert.equal(pets.addImage("default", "pensando", PNG), "pensando4.png");
  assert.equal(pets.addImage("default", "finalizado", PNG), "finalizado1.png");
});

test("addImage recusa o que não é PNG e estado inválido", () => {
  const pets = tmpPets();
  assert.throws(() => pets.addImage("default", "pensando", Buffer.from("GIF89a...")), /PNG/);
  assert.throws(() => pets.addImage("default", "../x", PNG), /estado/);
  assert.throws(() => pets.addImage("../fora", "pensando", PNG), /inválido/);
});

test("renameImage troca o estado e leva o ajuste do pet.json junto", () => {
  const pets = tmpPets();
  const name = pets.addImage("p", "pensando", PNG);
  pets.writeConfig("p", { height: 100, images: { [name]: { scale: 0.5, floor: 3 } } });
  const novo = pets.renameImage("p", name, "finalizado");
  assert.equal(novo, "finalizado1.png");
  assert.deepEqual(pets.files("p").map((f) => f.name), ["finalizado1.png"]);
  assert.deepEqual(pets.readConfig("p").images, { "finalizado1.png": { scale: 0.5, floor: 3 } });
});

test("removeImage usa a lixeira injetada e limpa o pet.json", async () => {
  const pets = tmpPets();
  const name = pets.addImage("p", "pensando", PNG);
  pets.writeConfig("p", { images: { [name]: { scale: 1, floor: 0 } } });
  const trashed = [];
  await pets.removeImage("p", name, async (p) => { trashed.push(p); fs.rmSync(p); });
  assert.equal(path.basename(trashed[0]), name);
  assert.deepEqual(pets.readConfig("p").images, {});
});

test("writeConfig descarta lixo", () => {
  const pets = tmpPets();
  pets.ensure("p");
  const out = pets.writeConfig("p", {
    height: 120,
    images: { "ok.png": { scale: 0.3, floor: 2 }, "../mau.png": { scale: 1, floor: 0 }, "x.png": { scale: -1, floor: 0 } },
    extra: "ignorado",
  });
  assert.deepEqual(out, { version: 1, images: { "ok.png": { scale: 0.3, floor: 2 } }, height: 120 });
});

test("exportar e importar: novo pet, nunca sobrescreve, ignora intrusos", () => {
  const pets = tmpPets();
  pets.addImage("Clawd", "pensando", PNG);
  pets.writeConfig("Clawd", { height: 90, images: { "pensando1.png": { scale: 2, floor: 1 } } });
  const entries = pets.exportEntries("Clawd");
  assert.deepEqual(entries.map((e) => e.name).sort(), ["pensando1.png", "pet.json"]);

  const intrusos = [
    ...entries.map((e) => ({ ...e, name: "pasta/" + e.name })),
    { name: "../../fora.png", data: PNG },          // achatado para fora.png, dentro do pet
    { name: "virus.exe", data: Buffer.from("MZ") },
    { name: "falso.png", data: Buffer.from("não sou png") },
  ];
  const pet = pets.importEntries(intrusos, "Clawd");
  assert.equal(pet, "Clawd 2");
  assert.deepEqual(pets.files(pet).map((f) => f.name).sort(), ["fora.png", "pensando1.png"]);
  assert.equal(pets.readConfig(pet).height, 90);
  assert.ok(!fs.existsSync(path.join(pets.root, "..", "fora.png")));
});

test("importar zip sem PNG falha sem criar pasta", () => {
  const pets = tmpPets();
  assert.throws(() => pets.importEntries([{ name: "a.txt", data: Buffer.from("x") }], "vazio"), /nenhuma imagem/);
  assert.deepEqual(pets.list(), []);
});
