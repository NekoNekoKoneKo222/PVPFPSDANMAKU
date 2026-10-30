import * as THREE from "/vendor/three.js";
import { addNeonShibuya } from "/city.js";

const $ = id => document.getElementById(id);
const lobby = $("lobby");
const root = $("gameRoot");
const connection = $("connection");
const keys = new Set();
let ws = null;
let myId = "";
let roomCode = "";
let inGame = false;
let latestPlayers = [];
let camera, renderer, scene, worldReady = false;
let self = null, selfPosition = new THREE.Vector3(0, 0, 0);
let yaw = 0, pitch = 0;
let verticalVelocity = 0;
let mouseFire = false, mouseAlt = false;
const touchHeld = { fire: false, alt: false, burst: false, dash: false, jump: false };
const stick = { x: 0, y: 0 };
const others = new Map();
const projectiles = new Map();
let snapshotTime = 0;
let lastFrame = performance.now();
let noticesTimeout = null;
const ARENA = 22;
const OBSTACLES = [
  { x: -8, z: -7, w: 3.6, d: 3.6, h: 3.1 },
  { x: 8, z: -7, w: 3.6, d: 3.6, h: 3.1 },
  { x: -8, z: 7, w: 3.6, d: 3.6, h: 3.1 },
  { x: 8, z: 7, w: 3.6, d: 3.6, h: 3.1 },
  { x: 0, z: 0, w: 4.3, d: 4.3, h: 4.3 },
  { x: 0, z: -14, w: 7, d: 2.2, h: 2.5 },
  { x: 0, z: 14, w: 7, d: 2.2, h: 2.5 }
];

function setConnection(text, ready = false) {
  connection.textContent = text;
  connection.classList.toggle("ready", ready);
  $("createBtn").disabled = !ready;
  $("joinBtn").disabled = !ready;
}
function notice(text, duration = 2600) {
  $("toast").textContent = text;
  if (noticesTimeout) clearTimeout(noticesTimeout);
  noticesTimeout = setTimeout(() => { $("toast").textContent = ""; }, duration);
}
function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(protocol + "//" + location.host + "/ws");
  setConnection("サーバーに接続中…");
  ws.addEventListener("open", () => setConnection("ONLINE — サーバー接続済み", true));
  ws.addEventListener("message", event => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    onMessage(data);
  });
  ws.addEventListener("close", () => {
    setConnection("オフライン — 再接続しています");
    if (inGame) {
      backToLobby();
      setConnection("接続が切れました。部屋が失われた可能性があります");
    }
    setTimeout(connect, 1600);
  });
  ws.addEventListener("error", () => {});
}
function send(data) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function onMessage(data) {
  switch (data.type) {
    case "hello":
      myId = data.id;
      break;
    case "joined":
      myId = data.id;
      roomCode = data.code;
      enterGame();
      break;
    case "state":
      if (inGame) applyState(data);
      break;
    case "notice":
      if (inGame) notice(data.text, 1800);
      break;
    case "hit":
      $("damageFlash").style.opacity = ".85";
      setTimeout(() => { $("damageFlash").style.opacity = "0"; }, 160);
      break;
    case "kill":
      addKill(data.text);
      break;
    case "error":
      if (inGame) notice(data.text, 3200);
      else setConnection(data.text, ws?.readyState === WebSocket.OPEN);
      break;
    case "left":
      break;
  }
}

$("createBtn").addEventListener("click", () => {
  send({ type: "create", name: $("playerName").value || "PILOT" });
});
$("joinBtn").addEventListener("click", joinRoom);
$("joinCode").addEventListener("keydown", event => {
  if (event.key === "Enter") joinRoom();
});
function joinRoom() {
  const code = $("joinCode").value.trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(code)) { setConnection("6桁の部屋コードを入力してください", true); return; }
  send({ type: "join", code, name: $("playerName").value || "PILOT" });
}
$("copyCode").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(roomCode);
    notice("部屋コードをコピーしました：" + roomCode);
  } catch {
    notice("部屋コード：" + roomCode);
  }
});
$("leaveBtn").addEventListener("click", () => {
  send({ type: "leave" });
  backToLobby();
});

function enterGame() {
  inGame = true;
  self = null;
  latestPlayers = [];
  selfPosition.set(0, 0, 0);
  selfPosition.userDataInitialized = false;
  verticalVelocity = 0;
  yaw = 0; pitch = 0;
  $("activeCode").textContent = roomCode;
  $("killFeed").replaceChildren();
  $("respawnOverlay").classList.add("hidden");
  root.classList.remove("hidden");
  lobby.classList.add("hidden");
  if (!worldReady) buildWorld();
  for (const entry of others.values()) scene.remove(entry.group);
  others.clear();
  for (const entry of projectiles.values()) scene.remove(entry.mesh);
  projectiles.clear();
  const touchMode = window.matchMedia("(any-pointer: coarse)").matches;
  $("focusHint").classList.toggle("hidden", touchMode);
  resize();
  notice("ルームに接続しました！ コード：" + roomCode, 3200);
}

function backToLobby() {
  inGame = false;
  self = null;
  roomCode = "";
  mouseFire = false;
  mouseAlt = false;
  keys.clear();
  for (const name of Object.keys(touchHeld)) touchHeld[name] = false;
  stick.x = stick.y = 0;
  updateStickVisual();
  lobby.classList.remove("hidden");
  root.classList.add("hidden");
  if (document.pointerLockElement) document.exitPointerLock();
}

function addKill(text) {
  if (!inGame) return;
  const div = document.createElement("div");
  div.textContent = text;
  $("killFeed").prepend(div);
  setTimeout(() => div.remove(), 3600);
  while ($("killFeed").children.length > 4) $("killFeed").lastChild.remove();
}

function buildWorld() {
  worldReady = true;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x17253c);
  scene.fog = new THREE.FogExp2(0x243753, 0.010);
  camera = new THREE.PerspectiveCamera(78, 1, 0.06, 180);
  renderer = new THREE.WebGLRenderer({ antialias: !matchMedia("(any-pointer: coarse)").matches, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.72;
  $("scene").appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xd1f0ff, 0x45516c, 3.2));
  scene.add(new THREE.AmbientLight(0x9ab8ff, 0.65));
  const sun = new THREE.DirectionalLight(0xdcefff, 2.3);
  sun.position.set(-10, 24, 16);
  scene.add(sun);
  const accent = new THREE.PointLight(0xff679e, 45, 35);
  accent.position.set(11, 8, -13);
  scene.add(accent);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(44, 44),
    new THREE.MeshStandardMaterial({ color: 0x37465a, emissive: 0x1b3244, emissiveIntensity: 0.65, metalness: 0.2, roughness: 0.8 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.015;
  scene.add(floor);
  const grid = new THREE.GridHelper(44, 22, 0x3fa7c0, 0x355769);
  grid.position.y = 0.01;
  scene.add(grid);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x10263c, metalness: 0.7, roughness: 0.32, emissive: 0x08162a });
  const neonMat = new THREE.MeshBasicMaterial({ color: 0x38e7ff, toneMapped: false });
  const pinkMat = new THREE.MeshBasicMaterial({ color: 0xff4a9f, toneMapped: false });
  for (let edge = 0; edge < 4; edge++) {
    const alongX = edge < 2;
    const barrier = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 44 : 0.5, 4, alongX ? 0.5 : 44), wallMat);
    barrier.position.set(alongX ? 0 : (edge === 2 ? -22 : 22), 2,
      alongX ? (edge === 0 ? -22 : 22) : 0);
    scene.add(barrier);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 44 : 0.15, 0.12, alongX ? 0.15 : 44), edge % 2 ? pinkMat : neonMat);
    stripe.position.copy(barrier.position);
    stripe.position.y = 3.75;
    scene.add(stripe);
  }

  OBSTACLES.forEach((o, i) => {
    const box = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d),
      new THREE.MeshStandardMaterial({ color: 0x172941, metalness: 0.75, roughness: 0.35, emissive: i % 2 ? 0x171225 : 0x061e2b }));
    box.position.set(o.x, o.h / 2, o.z);
    scene.add(box);
    const edges = new THREE.EdgesGeometry(box.geometry);
    const outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: i % 2 ? 0xff5ca3 : 0x28bde0 }));
    outline.position.copy(box.position);
    scene.add(outline);
    const top = new THREE.Mesh(new THREE.BoxGeometry(o.w + 0.09, 0.07, o.d + 0.09),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff4b92 : 0x29d9ff, toneMapped: false }));
    top.position.set(o.x, o.h + 0.03, o.z);
    scene.add(top);
  });

  addNeonShibuya(scene, THREE);

  const ringGeo = new THREE.TorusGeometry(2.5, 0.035, 6, 100);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x15caeb, transparent: true, opacity: 0.3 });
  for (const [x, z] of [[-16, -16], [16, 16], [-16, 16], [16, -16]]) {
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.16, z);
    scene.add(ring);
  }

  const stars = [];
  for (let i = 0; i < 350; i++) {
    const radius = 25 + Math.random() * 75;
    const angle = Math.random() * Math.PI * 2;
    stars.push(Math.cos(angle) * radius, 12 + Math.random() * 80, Math.sin(angle) * radius);
  }
  const points = new THREE.BufferGeometry();
  points.setAttribute("position", new THREE.Float32BufferAttribute(stars, 3));
  scene.add(new THREE.Points(points, new THREE.PointsMaterial({ color: 0x62b9ef, size: 0.26 })));
}

function colorFromId(id) {
  let n = 0;
  for (const char of id) n = (n * 31 + char.charCodeAt(0)) >>> 0;
  return new THREE.Color().setHSL((n % 360) / 360, 0.8, 0.62);
}
function makeEnemy(p) {
  const group = new THREE.Group();
  const color = colorFromId(p.id);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 1.1, 6, 10),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, metalness: 0.5, roughness: 0.25 }));
  body.position.y = 1.05;
  group.add(body);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.21, 0.24),
    new THREE.MeshBasicMaterial({ color: 0xd8ffff, toneMapped: false }));
  visor.position.set(0, 1.62, -0.48);
  group.add(visor);
  const light = new THREE.Mesh(new THREE.TorusGeometry(0.67, 0.035, 5, 32),
    new THREE.MeshBasicMaterial({ color: 0x5ffffc }));
  light.rotation.x = -Math.PI / 2;
  light.position.y = 0.05;
  group.add(light);
  scene.add(group);
  return { group, target: new THREE.Vector3(p.x, p.y, p.z) };
}
const bulletGeo = new THREE.SphereGeometry(0.24, 9, 7);
const bulletMaterials = {
  pulse: new THREE.MeshBasicMaterial({ color: 0x4feeff, transparent: true, opacity: 0.94, blending: THREE.AdditiveBlending, toneMapped: false }),
  fan: new THREE.MeshBasicMaterial({ color: 0xff63b5, transparent: true, opacity: 0.97, blending: THREE.AdditiveBlending, toneMapped: false }),
  burst: new THREE.MeshBasicMaterial({ color: 0xffdb54, transparent: true, opacity: 0.96, blending: THREE.AdditiveBlending, toneMapped: false })
};
function applyState(data) {
  snapshotTime = performance.now();
  latestPlayers = data.players || [];
  self = latestPlayers.find(p => p.id === myId) || null;
  if (self) {
    const target = new THREE.Vector3(self.x, self.y, self.z);
    if (!selfPosition.userDataInitialized || selfPosition.distanceTo(target) > 6 || !self.alive) {
      selfPosition.copy(target);
      selfPosition.userDataInitialized = true;
      verticalVelocity = self.alive ? (self.vy || 0) : 0;
      if (camera) camera.position.set(self.x, self.y + 1.55, self.z);
    } else {
      selfPosition.x = THREE.MathUtils.lerp(selfPosition.x, target.x, 0.34);
      selfPosition.z = THREE.MathUtils.lerp(selfPosition.z, target.z, 0.34);
      const heightError = target.y - selfPosition.y;
      if (Math.abs(heightError) > 1.2) {
        selfPosition.y = target.y;
        verticalVelocity = self.vy || 0;
      } else {
        selfPosition.y += heightError * 0.19;
        verticalVelocity = THREE.MathUtils.lerp(verticalVelocity, self.vy || 0, 0.13);
      }
    }
    const hp = Math.max(0, self.hp);
    $("healthText").textContent = hp;
    $("healthFill").style.width = hp + "%";
    $("healthFill").style.background = hp < 30 ? "#ff355e" : "linear-gradient(90deg,#ff5f79,#ffdd73)";
    $("killsCount").textContent = self.kills;
    $("deathCount").textContent = self.deaths;
    $("fanCd").textContent = self.altCd > 0.1 ? self.altCd.toFixed(1) + "s" : "READY";
    $("burstCd").textContent = self.burstCd > 0.1 ? self.burstCd.toFixed(1) + "s" : "READY";
    $("dashCd").textContent = self.dashCd > 0.1 ? self.dashCd.toFixed(1) + "s" : "READY";
    $("respawnOverlay").classList.toggle("hidden", self.alive);
    $("respawnCountdown").textContent = "リスポーンまで " + Math.ceil(self.respawn) + " 秒";
  }

  const livingIds = new Set();
  for (const p of latestPlayers) {
    if (p.id === myId) continue;
    livingIds.add(p.id);
    let view = others.get(p.id);
    if (!view) { view = makeEnemy(p); others.set(p.id, view); view.group.position.set(p.x, p.y, p.z); }
    view.group.visible = p.alive;
    view.target.set(p.x, p.y, p.z);
    view.group.rotation.y = p.yaw;
  }
  for (const [id, entry] of others) {
    if (!livingIds.has(id)) { scene.remove(entry.group); others.delete(id); }
  }

  const seen = new Set();
  for (const bullet of data.bullets || []) {
    seen.add(bullet.id);
    let entry = projectiles.get(bullet.id);
    if (!entry) {
      const mesh = new THREE.Mesh(bulletGeo, bulletMaterials[bullet.kind] || bulletMaterials.pulse);
      const scale = bullet.kind === "fan" ? 1.3 : bullet.kind === "burst" ? 1.1 : 1;
      mesh.scale.setScalar(scale);
      scene.add(mesh);
      entry = { mesh, bullet };
      projectiles.set(bullet.id, entry);
    }
    entry.bullet = bullet;
  }
  for (const [id, entry] of projectiles) {
    if (!seen.has(id)) { scene.remove(entry.mesh); projectiles.delete(id); }
  }
  latestPlayers.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  $("playerCount").textContent = latestPlayers.length + "/5";
  $("occupancy").textContent = latestPlayers.length + "/5";
  const rows = $("scoreRows");
  rows.replaceChildren();
  for (const p of latestPlayers) {
    const row = document.createElement("div");
    row.className = "score-row" + (p.id === myId ? " me" : "");
    const name = document.createElement("b");
    name.textContent = p.name + (p.id === myId ? " (YOU)" : "");
    const score = document.createElement("span");
    score.textContent = p.kills + " K / " + p.deaths + " D";
    row.append(name, score);
    rows.append(row);
  }
}

function isDown(code) { return keys.has(code); }
function controls() {
  const mx = (isDown("KeyD") ? 1 : 0) - (isDown("KeyA") ? 1 : 0) + stick.x;
  const mz = (isDown("KeyW") ? 1 : 0) - (isDown("KeyS") ? 1 : 0) - stick.y;
  return {
    type: "input", mx: THREE.MathUtils.clamp(mx, -1, 1),
    mz: THREE.MathUtils.clamp(mz, -1, 1), yaw, pitch,
    fire: isDown("KeyJ") || mouseFire || touchHeld.fire,
    alt: isDown("KeyK") || mouseAlt || touchHeld.alt,
    burst: isDown("KeyL") || isDown("KeyE") || touchHeld.burst,
    dash: isDown("ShiftLeft") || isDown("ShiftRight") || touchHeld.dash,
    jump: isDown("Space") || touchHeld.jump
  };
}
function localCollision(x, z) {
  const radius = 0.52;
  return OBSTACLES.some(o =>
    x + radius > o.x - o.w / 2 && x - radius < o.x + o.w / 2 &&
    z + radius > o.z - o.d / 2 && z - radius < o.z + o.d / 2);
}
function predictSelf(dt) {
  if (!self?.alive) { verticalVelocity = 0; return; }
  const input = controls();
  // Predict vertical motion at the rendering frame rate instead of
  // stepping only when the server sends a position snapshot.
  if (selfPosition.y < 0.025 && input.jump) verticalVelocity = 8.4;
  verticalVelocity -= 21 * dt;
  selfPosition.y = Math.max(0, selfPosition.y + verticalVelocity * dt);
  if (selfPosition.y === 0) verticalVelocity = 0;
  let mx = input.mx, mz = input.mz;
  const magnitude = Math.hypot(mx, mz);
  if (magnitude > 1) { mx /= magnitude; mz /= magnitude; }
  const forwardX = Math.sin(yaw), forwardZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw), rightZ = Math.sin(yaw);
  const dx = (rightX * mx + forwardX * mz) * 7.2 * dt;
  const dz = (rightZ * mx + forwardZ * mz) * 7.2 * dt;
  const nextX = THREE.MathUtils.clamp(selfPosition.x + dx, -21.2, 21.2);
  if (!localCollision(nextX, selfPosition.z)) selfPosition.x = nextX;
  const nextZ = THREE.MathUtils.clamp(selfPosition.z + dz, -21.2, 21.2);
  if (!localCollision(selfPosition.x, nextZ)) selfPosition.z = nextZ;
}
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (!inGame || !renderer) return;

  if (isDown("ArrowLeft")) yaw -= dt * 2.5;
  if (isDown("ArrowRight")) yaw += dt * 2.5;
  if (isDown("ArrowUp")) pitch += dt * 1.8;
  if (isDown("ArrowDown")) pitch -= dt * 1.8;
  pitch = THREE.MathUtils.clamp(pitch, -1.32, 1.32);
  predictSelf(dt);

  if (self) {
    camera.position.x = selfPosition.x;
    camera.position.z = selfPosition.z;
    camera.position.y = THREE.MathUtils.damp(camera.position.y, selfPosition.y + 1.55, 15, dt);
    camera.rotation.order = "YXZ";
    camera.rotation.y = -yaw;
    camera.rotation.x = pitch;
  }
  for (const view of others.values()) view.group.position.lerp(view.target, Math.min(1, dt * 13));
  const age = Math.min(0.14, (performance.now() - snapshotTime) / 1000);
  for (const entry of projectiles.values()) {
    const b = entry.bullet;
    entry.mesh.position.set(b.x + b.vx * age, b.y + b.vy * age, b.z + b.vz * age);
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);
setInterval(() => {
  if (inGame && ws?.readyState === WebSocket.OPEN) send(controls());
}, 50);

function resize() {
  if (!renderer || !camera) return;
  const width = window.innerWidth, height = window.innerHeight;
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}
addEventListener("resize", resize);
addEventListener("orientationchange", () => setTimeout(resize, 300));
function adjustAim(dx, dy, scale = 0.0027) {
  yaw -= dx * scale;
  pitch = THREE.MathUtils.clamp(pitch - dy * scale, -1.32, 1.32);
}
document.addEventListener("mousemove", event => {
  if (inGame && document.pointerLockElement) adjustAim(event.movementX, event.movementY);
});
document.addEventListener("keydown", event => {
  if (!inGame) return;
  if (["Space","ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (event.code === "Escape" && document.pointerLockElement) document.exitPointerLock();
});
document.addEventListener("keyup", event => keys.delete(event.code));
window.addEventListener("blur", () => {
  keys.clear();
  mouseFire = mouseAlt = false;
  for (const key of Object.keys(touchHeld)) touchHeld[key] = false;
});
document.addEventListener("mousedown", event => {
  if (!inGame) return;
  if (event.button === 0) mouseFire = true;
  if (event.button === 2) mouseAlt = true;
});
document.addEventListener("mouseup", event => {
  if (event.button === 0) mouseFire = false;
  if (event.button === 2) mouseAlt = false;
});
document.addEventListener("contextmenu", event => { if (inGame) event.preventDefault(); });
document.addEventListener("dblclick", event => {
  if (inGame && event.cancelable) event.preventDefault();
}, { passive: false });
$("scene").addEventListener("pointerdown", event => {
  if (!inGame || event.pointerType === "touch" || matchMedia("(any-pointer: coarse)").matches) return;
  if (!document.pointerLockElement) $("scene").requestPointerLock?.();
});
$("lookZone").addEventListener("pointerdown", event => {
  if (!inGame) return;
  if (event.pointerType !== "touch" && !matchMedia("(any-pointer: coarse)").matches) {
    if (!document.pointerLockElement) $("scene").requestPointerLock?.();
    return;
  }
  $("lookZone").setPointerCapture(event.pointerId);
  lookPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
});
let lookPointer = null;
$("lookZone").addEventListener("pointermove", event => {
  if (!lookPointer || event.pointerId !== lookPointer.id) return;
  adjustAim(event.clientX - lookPointer.x, event.clientY - lookPointer.y, 0.005);
  lookPointer.x = event.clientX; lookPointer.y = event.clientY;
});
for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
  $("lookZone").addEventListener(eventName, event => {
    if (lookPointer?.id === event.pointerId) lookPointer = null;
  });
}
let stickPointer = null;
function updateStickVisual() {
  const size = $("joystick").getBoundingClientRect().width;
  const center = size / 2 - 25;
  $("stick").style.left = center + stick.x * (size * 0.28) + "px";
  $("stick").style.top = center + stick.y * (size * 0.28) + "px";
}
function updateStick(event) {
  const rect = $("joystick").getBoundingClientRect();
  const radius = rect.width * 0.34;
  let x = (event.clientX - rect.left - rect.width / 2) / radius;
  let y = (event.clientY - rect.top - rect.height / 2) / radius;
  const length = Math.max(1, Math.hypot(x, y));
  stick.x = x / length;
  stick.y = y / length;
  updateStickVisual();
}
$("joystick").addEventListener("pointerdown", event => {
  if (!inGame) return;
  stickPointer = event.pointerId;
  $("joystick").setPointerCapture(event.pointerId);
  updateStick(event);
});
$("joystick").addEventListener("pointermove", event => {
  if (event.pointerId === stickPointer) updateStick(event);
});
for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
  $("joystick").addEventListener(eventName, event => {
    if (event.pointerId !== stickPointer) return;
    stickPointer = null; stick.x = stick.y = 0;
    updateStickVisual();
  });
}
for (const [id, key] of [
  ["touchFire", "fire"], ["touchFan", "alt"], ["touchBurst", "burst"],
  ["touchDash", "dash"], ["touchJump", "jump"]
]) {
  const btn = $(id);
  btn.addEventListener("pointerdown", event => {
    if (!inGame) return;
    event.preventDefault();
    btn.setPointerCapture(event.pointerId);
    touchHeld[key] = true;
    btn.classList.add("active");
  });
  const release = () => { touchHeld[key] = false; btn.classList.remove("active"); };
  btn.addEventListener("pointerup", release);
  btn.addEventListener("pointercancel", release);
  btn.addEventListener("lostpointercapture", release);
}
updateStickVisual();
connect();
