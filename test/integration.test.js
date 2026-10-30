"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const { spawn } = require("node:child_process");
const WebSocket = require("ws");

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function portAvailable() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function health(port) {
  return new Promise((resolve, reject) => {
    http.get("http://127.0.0.1:" + port + "/healthz", res => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on("error", reject);
  });
}
async function connected(port) {
  const ws = new WebSocket("ws://127.0.0.1:" + port + "/ws");
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return ws;
}
function until(ws, type, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error("Timeout waiting for " + type)); }, timeout);
    function cleanup() { clearTimeout(timer); ws.off("message", onMessage); }
    function onMessage(buf) {
      let data;
      try { data = JSON.parse(buf.toString()); } catch { return; }
      if (data.type !== type) return;
      cleanup(); resolve(data);
    }
    ws.on("message", onMessage);
  });
}

test("HTTP health, real room creation, five joiners and full-room rejection", { timeout: 20000 }, async () => {
  const port = await portAvailable();
  const child = spawn(process.execPath, ["server/index.js"], {
    env: { ...process.env, PORT: String(port) }, stdio: "ignore"
  });
  const clients = [];
  try {
    let ready = false;
    for (let attempt = 0; attempt < 70; attempt++) {
      try { if ((await health(port)).ok) { ready = true; break; } } catch {}
      await delay(80);
    }
    assert.equal(ready, true, "Server should boot and answer /healthz");
    const owner = await connected(port);
    clients.push(owner);
    const created = until(owner, "joined");
    owner.send(JSON.stringify({ type: "create", name: "Host" }));
    const room = await created;
    assert.match(room.code, /^[A-Z2-9]{6}$/);
    for (let i = 1; i < 5; i++) {
      const ws = await connected(port);
      clients.push(ws);
      const joined = until(ws, "joined");
      ws.send(JSON.stringify({ type: "join", code: room.code, name: "Player" + i }));
      assert.equal((await joined).code, room.code);
    }
    assert.equal((await health(port)).players, 5);
    const extra = await connected(port);
    clients.push(extra);
    const rejected = until(extra, "error");
    extra.send(JSON.stringify({ type: "join", code: room.code, name: "Extra" }));
    assert.match((await rejected).text, /満員/);
    assert.equal((await health(port)).players, 5);
  } finally {
    for (const ws of clients) ws.close();
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
  }
});
