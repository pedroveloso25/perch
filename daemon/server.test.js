const test = require("node:test");
const assert = require("node:assert/strict");
const { startDaemon } = require("./server");

const quiet = () => {};

async function post(port, body) {
  const res = await fetch(`http://127.0.0.1:${port}/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.status;
}

test("sobe numa porta, recebe evento e devolve o estado", async () => {
  const d = await startDaemon({ port: 0, log: quiet });
  const { port } = d.server.address();
  try {
    assert.equal(await post(port, { session_id: "s", event: "working", tool: "Bash" }), 204);
    const st = await (await fetch(`http://127.0.0.1:${port}/state`)).json();
    assert.equal(st.state, "working");
    assert.equal(st.tool, "Bash");
    assert.equal(await post(port, { event: "react", kind: "celebrate" }), 204);
    assert.equal(await post(port, { event: "react", kind: "nada" }), 400);
    assert.equal(await post(port, { event: "inexistente" }), 400);
  } finally {
    d.close();
  }
});

test("porta ocupada rejeita com EADDRINUSE (o app usa o daemon que já existe)", async () => {
  const a = await startDaemon({ port: 0, log: quiet });
  try {
    await assert.rejects(startDaemon({ port: a.server.address().port, log: quiet }), { code: "EADDRINUSE" });
  } finally {
    a.close();
  }
});
