"use strict";

const ARENA = 22;
const MAX_PLAYERS = 5;
const MAX_BULLETS = 450;
const PLAYER_RADIUS = 0.52;
const PLAYER_SPEED = 7.2;
const BULLET_TYPES = {
  pulse: { speed: 24, damage: 12, life: 1.9, radius: 0.24 },
  fan: { speed: 16, damage: 7, life: 2.4, radius: 0.27 },
  burst: { speed: 12, damage: 5, life: 2.8, radius: 0.24 }
};
const OBSTACLES = [
  { x: -8, z: -7, w: 3.6, d: 3.6, h: 3.1 },
  { x: 8, z: -7, w: 3.6, d: 3.6, h: 3.1 },
  { x: -8, z: 7, w: 3.6, d: 3.6, h: 3.1 },
  { x: 8, z: 7, w: 3.6, d: 3.6, h: 3.1 },
  { x: 0, z: 0, w: 4.3, d: 4.3, h: 4.3 },
  { x: 0, z: -14, w: 7, d: 2.2, h: 2.5 },
  { x: 0, z: 14, w: 7, d: 2.2, h: 2.5 }
];
const SPAWNS = [
  [-16, -16], [16, 16], [16, -16], [-16, 16],
  [0, -18], [0, 18], [-18, 0], [18, 0]
];
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function cleanName(value) {
  if (typeof value !== "string") return "PILOT";
  const name = value.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 16);
  return name || "PILOT";
}

function collidesObstacle(x, z, radius = PLAYER_RADIUS) {
  return OBSTACLES.some(o =>
    x + radius > o.x - o.w / 2 &&
    x - radius < o.x + o.w / 2 &&
    z + radius > o.z - o.d / 2 &&
    z - radius < o.z + o.d / 2);
}

function spawnPosition(room) {
  const living = [...room.players.values()].filter(p => p.alive);
  const available = SPAWNS.map(([x, z]) => {
    let min = Infinity;
    for (const p of living) min = Math.min(min, Math.hypot(x - p.x, z - p.z));
    return { x, z, min };
  }).sort((a, b) => b.min - a.min);
  const top = available.slice(0, Math.min(3, available.length));
  return top[Math.floor(Math.random() * top.length)];
}

function newPlayer(id, name, room) {
  const spawn = spawnPosition(room);
  return {
    id, name: cleanName(name), x: spawn.x, y: 0, z: spawn.z,
    vy: 0, yaw: 0, pitch: 0,
    hp: 100, kills: 0, deaths: 0, alive: true,
    respawnAt: 0, invulnerableUntil: Date.now() / 1000 + 1.8,
    fireAt: 0, altAt: 0, burstAt: 0, dashAt: 0, dashUntil: 0,
    dashX: 0, dashZ: 0,
    input: { mx: 0, mz: 0, yaw: 0, pitch: 0, fire: false, alt: false, burst: false, dash: false, jump: false }
  };
}

function updateInput(p, data) {
  if (!data || typeof data !== "object") return;
  const mx = Number(data.mx);
  const mz = Number(data.mz);
  const yaw = Number(data.yaw);
  const pitch = Number(data.pitch);
  if (![mx, mz, yaw, pitch].every(Number.isFinite)) return;
  p.input = {
    mx: clamp(mx, -1, 1),
    mz: clamp(mz, -1, 1),
    yaw: clamp(yaw, -Math.PI * 100, Math.PI * 100),
    pitch: clamp(pitch, -1.32, 1.32),
    fire: data.fire === true,
    alt: data.alt === true,
    burst: data.burst === true,
    dash: data.dash === true,
    jump: data.jump === true
  };
}

function spawnProjectile(room, p, kind, yaw, pitch, now) {
  if (room.bullets.length >= MAX_BULLETS) return;
  const spec = BULLET_TYPES[kind];
  const cosine = Math.cos(pitch);
  const dx = Math.sin(yaw) * cosine;
  const dy = Math.sin(pitch);
  const dz = -Math.cos(yaw) * cosine;
  room.bullets.push({
    id: room.nextBulletId++, owner: p.id, kind,
    x: p.x + dx * 0.85, y: p.y + 1.45 + dy * 0.85, z: p.z + dz * 0.85,
    vx: dx * spec.speed, vy: dy * spec.speed, vz: dz * spec.speed,
    damage: spec.damage, radius: spec.radius, expires: now + spec.life
  });
}

function shoot(room, p, now) {
  const input = p.input;
  if (input.fire && now >= p.fireAt) {
    p.fireAt = now + 0.17;
    spawnProjectile(room, p, "pulse", p.yaw, p.pitch, now);
  }
  if (input.alt && now >= p.altAt) {
    p.altAt = now + 4;
    for (let i = -3; i <= 3; i++) {
      spawnProjectile(room, p, "fan", p.yaw + i * 0.105, p.pitch, now);
    }
  }
  if (input.burst && now >= p.burstAt) {
    p.burstAt = now + 8;
    for (let i = 0; i < 32; i++) {
      spawnProjectile(room, p, "burst", i * Math.PI * 2 / 32, 0, now);
    }
  }
}

function movePlayer(p, dt, now) {
  const input = p.input;
  p.yaw = input.yaw;
  p.pitch = input.pitch;
  let localX = input.mx;
  let localZ = input.mz;
  const magnitude = Math.hypot(localX, localZ);
  if (magnitude > 1) { localX /= magnitude; localZ /= magnitude; }

  const forwardX = Math.sin(p.yaw), forwardZ = -Math.cos(p.yaw);
  const rightX = Math.cos(p.yaw), rightZ = Math.sin(p.yaw);
  let dx = rightX * localX + forwardX * localZ;
  let dz = rightZ * localX + forwardZ * localZ;

  if (input.dash && now >= p.dashAt) {
    if (Math.hypot(dx, dz) < 0.01) { dx = forwardX; dz = forwardZ; }
    p.dashX = dx;
    p.dashZ = dz;
    p.dashUntil = now + 0.19;
    p.dashAt = now + 3;
  }
  const dashing = now < p.dashUntil;
  const stepX = (dashing ? p.dashX * 22 : dx * PLAYER_SPEED) * dt;
  const stepZ = (dashing ? p.dashZ * 22 : dz * PLAYER_SPEED) * dt;
  const nextX = clamp(p.x + stepX, -ARENA + 0.8, ARENA - 0.8);
  if (!collidesObstacle(nextX, p.z)) p.x = nextX;
  const nextZ = clamp(p.z + stepZ, -ARENA + 0.8, ARENA - 0.8);
  if (!collidesObstacle(p.x, nextZ)) p.z = nextZ;

  if (p.y <= 0 && input.jump) p.vy = 8.4;
  p.vy -= 21 * dt;
  p.y = Math.max(0, p.y + p.vy * dt);
  if (p.y === 0) p.vy = 0;
}

function tickRoom(room, dt, now = Date.now() / 1000) {
  const events = [];
  for (const p of room.players.values()) {
    if (!p.alive) {
      if (now >= p.respawnAt) {
        const spawn = spawnPosition(room);
        p.x = spawn.x; p.z = spawn.z; p.y = 0; p.vy = 0;
        p.hp = 100; p.alive = true; p.invulnerableUntil = now + 1.6;
        p.input.fire = false; p.input.alt = false; p.input.burst = false;
      }
      continue;
    }
    movePlayer(p, dt, now);
    shoot(room, p, now);
  }

  const surviving = [];
  bulletLoop: for (const b of room.bullets) {
    if (b.expires <= now) continue;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (Math.abs(b.x) > ARENA - 0.2 || Math.abs(b.z) > ARENA - 0.2 || b.y < 0.2 || b.y > 10) continue;
    if (OBSTACLES.some(o => b.y <= o.h && Math.abs(b.x - o.x) < o.w / 2 + b.radius && Math.abs(b.z - o.z) < o.d / 2 + b.radius)) continue;
    for (const p of room.players.values()) {
      if (!p.alive || p.id === b.owner) continue;
      const dist = Math.hypot(b.x - p.x, b.y - (p.y + 1.35), b.z - p.z);
      if (dist < b.radius + PLAYER_RADIUS) {
        if (now >= p.invulnerableUntil) {
          p.hp = Math.max(0, p.hp - b.damage);
          events.push({ type: "hit", victim: p.id, from: b.owner, hp: p.hp });
          if (p.hp === 0) {
            p.alive = false;
            p.deaths++;
            p.respawnAt = now + 2.6;
            const attacker = room.players.get(b.owner);
            if (attacker) attacker.kills++;
            events.push({ type: "kill", victim: p.name, by: attacker ? attacker.name : "UNKNOWN" });
          }
        }
        continue bulletLoop;
      }
    }
    surviving.push(b);
  }
  room.bullets = surviving;
  return events;
}

function snapshot(room, now = Date.now() / 1000) {
  return {
    type: "state",
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, x: p.x, y: p.y, z: p.z,
      yaw: p.yaw, hp: p.hp, kills: p.kills, deaths: p.deaths, alive: p.alive,
      invulnerable: now < p.invulnerableUntil,
      respawn: p.alive ? 0 : Math.max(0, p.respawnAt - now),
      altCd: Math.max(0, p.altAt - now), burstCd: Math.max(0, p.burstAt - now),
      dashCd: Math.max(0, p.dashAt - now)
    })),
    bullets: room.bullets.map(b => ({
      id: b.id, kind: b.kind, x: b.x, y: b.y, z: b.z,
      vx: b.vx, vy: b.vy, vz: b.vz
    }))
  };
}

module.exports = {
  ARENA, MAX_PLAYERS, MAX_BULLETS, OBSTACLES, PLAYER_SPEED,
  clamp, cleanName, collidesObstacle, newPlayer, updateInput,
  tickRoom, snapshot
};
