"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");
const {
  MAX_PLAYERS, OBSTACLES, newPlayer, updateInput, tickRoom, snapshot
} = require("./game");

const PORT = Number(process.env.PORT) || 3000;
const rooms = new Map();
const clients = new Set();
const PUBLIC = path.resolve(__dirname, "../public");
const THREE_MODULE = require.resolve("three/build/three.module.js");
const MIMES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function serveFile(res, file) {
  fs.stat(file, (err, stats) => {
    if (err || !stats.isFile()) { res.writeHead(404); res.end("Not found"); return; }
    res.setHeader("Content-Type", MIMES[path.extname(file)] || "application/octet-stream");
    res.setHeader("Cache-Control", file.endsWith("index.html") ? "no-cache" : "public, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'");
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  if (pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((n,r) => n + r.players.size, 0) }));
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
  if (pathname === "/vendor/three.js") { serveFile(res, THREE_MODULE); return; }
  let relative;
  try { relative = decodeURIComponent(pathname); } catch { res.writeHead(400); res.end(); return; }
  const absolute = path.resolve(PUBLIC, "." + relative, relative.endsWith("/") ? "index.html" : "");
  if (absolute !== PUBLIC && !absolute.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403); res.end(); return;
  }
  serveFile(res, absolute);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
server.on("upgrade", (req, socket, head) => {
  try {
    const endpoint = new URL(req.url || "/", "http://localhost").pathname;
    const origin = req.headers.origin;
    if (endpoint !== "/ws" || (origin && new URL(origin).host !== req.headers.host) || clients.size >= 150) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
  } catch { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws));
});

function send(ws, value) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value));
}
function broadcast(room, value) {
  for (const socket of room.sockets) send(socket, value);
}
function codeForRoom() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 30; attempt++) {
    const code = Array.from(crypto.randomBytes(6), b => chars[b % chars.length]).join("");
    if (!rooms.has(code)) return code;
  }
  return null;
}
function leave(ws) {
  const room = ws.room;
  if (!room) return;
  room.sockets.delete(ws);
  room.players.delete(ws.playerId);
  ws.room = null;
  if (room.sockets.size === 0) {
    rooms.delete(room.code);
  } else {
    broadcast(room, { type: "notice", text: "プレイヤーが退室しました" });
  }
}
function enter(ws, room, name) {
  if (room.players.size >= MAX_PLAYERS) { send(ws, { type: "error", text: "この部屋は満員です（最大5人）" }); return; }
  leave(ws);
  const player = newPlayer(ws.playerId, name, room);
  room.players.set(player.id, player);
  room.sockets.add(ws);
  ws.room = room;
  send(ws, {
    type: "joined", code: room.code, id: player.id,
    limit: MAX_PLAYERS, obstacles: OBSTACLES
  });
  broadcast(room, { type: "notice", text: player.name + " が参加しました" });
}
wss.on("connection", ws => {
  ws.playerId = crypto.randomUUID();
  ws.room = null;
  ws.alive = true;
  ws.windowStart = Date.now();
  ws.messageCount = 0;
  ws.lastLobbyAction = 0;
  clients.add(ws);
  send(ws, { type: "hello", id: ws.playerId });
  ws.on("pong", () => { ws.alive = true; });
  ws.on("message", message => {
    const now = Date.now();
    if (now - ws.windowStart >= 1000) { ws.windowStart = now; ws.messageCount = 0; }
    if (++ws.messageCount > 65) { ws.close(1008, "Rate limit"); return; }
    let data;
    try { data = JSON.parse(message.toString()); } catch { return; }
    if (!data || typeof data !== "object" || typeof data.type !== "string") return;
    if (data.type === "input") {
      const player = ws.room?.players.get(ws.playerId);
      if (player) updateInput(player, data);
      return;
    }
    if (data.type === "leave") { leave(ws); send(ws, { type: "left" }); return; }
    if (now - ws.lastLobbyAction < 800) return;
    ws.lastLobbyAction = now;

    if (data.type === "create") {
      if (ws.room) { send(ws, { type: "error", text: "先に現在の部屋から退出してください" }); return; }
      if (rooms.size >= 100) { send(ws, { type: "error", text: "現在これ以上部屋を作れません" }); return; }
      const code = codeForRoom();
      if (!code) { send(ws, { type: "error", text: "部屋の生成に失敗しました" }); return; }
      const room = { code, sockets: new Set(), players: new Map(), bullets: [], nextBulletId: 1 };
      rooms.set(code, room);
      enter(ws, room, data.name);
    } else if (data.type === "join") {
      if (ws.room) { send(ws, { type: "error", text: "先に現在の部屋から退出してください" }); return; }
      const code = typeof data.code === "string" ? data.code.trim().toUpperCase() : "";
      const room = rooms.get(code);
      if (!room) { send(ws, { type: "error", text: "部屋が見つかりません。コードを確認してください" }); return; }
      enter(ws, room, data.name);
    }
  });
  ws.on("close", () => { leave(ws); clients.delete(ws); });
  ws.on("error", () => {});
});

let tickCount = 0;
let lastTick = process.hrtime.bigint();
const simulation = setInterval(() => {
  const newTick = process.hrtime.bigint();
  const dt = Math.min(0.05, Number(newTick - lastTick) / 1e9);
  lastTick = newTick;
  const now = Date.now() / 1000;
  for (const room of rooms.values()) {
    for (const event of tickRoom(room, dt, now)) {
      if (event.type === "hit") {
        const ws = [...room.sockets].find(s => s.playerId === event.victim);
        if (ws) send(ws, { type: "hit", hp: event.hp });
      } else if (event.type === "kill") {
        broadcast(room, { type: "kill", text: event.by + "  →  " + event.victim });
      }
    }
    if (tickCount % 3 === 0) broadcast(room, snapshot(room, now));
  }
  tickCount++;
}, 1000 / 30);
simulation.unref();

const heartbeat = setInterval(() => {
  for (const ws of clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 30000);
heartbeat.unref();

server.listen(PORT, "0.0.0.0", () => {
  console.log("BULLET BREAK listening on port " + PORT);
});
process.on("SIGTERM", () => {
  clearInterval(simulation); clearInterval(heartbeat);
  for (const ws of clients) ws.close(1001, "Server restarting");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10000).unref();
});
