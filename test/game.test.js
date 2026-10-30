"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { cleanName, newPlayer, updateInput, tickRoom, snapshot, collidesObstacle, MAX_PLAYERS } = require("../server/game");

function room() { return { players: new Map(), bullets: [], nextBulletId: 1 }; }
test("name sanitation and room limit constant", () => {
  assert.equal(cleanName("<bad>\n"), "bad");
  assert.equal(cleanName(""), "PILOT");
  assert.equal(MAX_PLAYERS, 5);
});
test("bad aim and movement values are rejected", () => {
  const r = room(), p = newPlayer("a", "A", r);
  updateInput(p, { mx: 100, mz: -100, yaw: 0, pitch: 4 });
  assert.equal(p.input.mx, 1);
  assert.equal(p.input.pitch, 1.32);
  updateInput(p, { mx: Infinity, mz: 0, yaw: 0, pitch: 0 });
  assert.equal(p.input.mx, 1);
});
test("walls and obstacles stop movement", () => {
  const r = room(), p = newPlayer("a", "A", r);
  p.x = 0; p.z = 6; r.players.set(p.id, p);
  updateInput(p, { mx: 0, mz: 1, yaw: 0, pitch: 0 });
  for (let i = 0; i < 180; i++) tickRoom(r, 1 / 30, 100 + i / 30);
  assert.ok(p.z >= -22 && p.z <= 22);
  assert.equal(collidesObstacle(p.x, p.z), false);
});
test("server projectiles damage another player and award kills", () => {
  const r = room();
  const a = newPlayer("a", "Alpha", r), b = newPlayer("b", "Beta", r);
  a.x = 0; a.z = 10; a.yaw = 0;
  b.x = 0; b.z = 7; b.hp = 12; b.invulnerableUntil = 0;
  r.players.set(a.id, a); r.players.set(b.id, b);
  updateInput(a, { mx: 0, mz: 0, yaw: 0, pitch: 0, fire: true });
  const events = [];
  for (let i = 0; i < 10; i++) events.push(...tickRoom(r, 1 / 30, 100 + i / 30));
  assert.ok(events.some(e => e.type === "kill"));
  assert.equal(a.kills, 1);
  assert.equal(b.alive, false);
  assert.equal(snapshot(r, 101).players.length, 2);
});
