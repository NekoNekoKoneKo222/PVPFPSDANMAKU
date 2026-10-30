// Procedural, brand-free neon metropolis backdrop for the PvP arena.
// The decorative city geometry stays outside the server-authoritative obstacles.
export function addNeonShibuya(scene, THREE) {
  const standard = (color, emissive = 0x000000, intensity = 0) =>
    new THREE.MeshStandardMaterial({
      color, emissive, emissiveIntensity: intensity,
      roughness: 0.72, metalness: 0.16
    });
  const bright = color => new THREE.MeshBasicMaterial({ color, toneMapped: false });
  const addBox = (w, h, d, x, y, z, material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    return mesh;
  };

  // The floor has its own soft emissive tint so it remains readable at night,
  // even on mobile devices with lower-quality lighting.
  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(44, 44),
    standard(0x314454, 0x193347, 0.65)
  );
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.y = 0.035;
  scene.add(asphalt);

  const pavement = standard(0x596477, 0x293548, 0.45);
  addBox(3.4, 0.12, 44, -20.3, 0.04, 0, pavement);
  addBox(3.4, 0.12, 44, 20.3, 0.04, 0, pavement);
  addBox(38, 0.12, 3.2, 0, 0.04, -20.4, pavement);
  addBox(38, 0.12, 3.2, 0, 0.04, 20.4, pavement);

  // The illuminated crossing is split around existing combat cover.
  const zebra = bright(0xcce5ee);
  const lane = bright(0x86d8da);
  const curbLight = bright(0x35dcff);
  for (const z of [-11.4, -5.6, 5.6, 11.4]) {
    for (let i = -5; i <= 5; i++) {
      addBox(0.74, 0.016, 2.15, i * 1.04, 0.074, z, zebra);
    }
  }
  for (const x of [-13.2, 13.2]) {
    for (let i = -5; i <= 5; i++) {
      addBox(2.15, 0.016, 0.74, x, 0.075, i * 1.04, zebra);
    }
  }
  for (let i = -2; i <= 2; i++) {
    for (const side of [-1, 1]) {
      addBox(0.12, 0.018, 1.5, side * 6.4, 0.071, i * 7.5, lane);
      addBox(1.5, 0.018, 0.12, i * 7.5, 0.071, side * 6.4, lane);
    }
  }
  for (const side of [-1, 1]) {
    addBox(0.10, 0.022, 43.2, side * 18.55, 0.115, 0, curbLight);
    addBox(43.2, 0.022, 0.10, 0, 0.115, side * 18.55, curbLight);
  }

  // Glowing rain reflections, using transparent discs instead of expensive SSR.
  const puddleMat = new THREE.MeshBasicMaterial({
    color: 0x3ecfee, transparent: true, opacity: 0.13,
    depthWrite: false, side: THREE.DoubleSide
  });
  for (const [x, z, scale] of [[-4, -15, 2.4], [4, 14, 2.8], [-15, 4, 1.8], [14, -4, 1.9]]) {
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(scale, 20), puddleMat);
    puddle.rotation.x = -Math.PI / 2;
    puddle.scale.y = 0.44;
    puddle.position.set(x, 0.081, z);
    scene.add(puddle);
  }

  // Skyline outside the gameplay boundary: bold silhouettes and lit windows.
  const buildings = [];
  for (let i = -3; i <= 3; i++) {
    const x = i * 9.6;
    const z = i * 9.6;
    buildings.push({ x, z: -30, w: 8.0, d: 7.4, h: 16 + ((i + 12) * 7) % 17, face: "north" });
    buildings.push({ x, z: 30, w: 8.0, d: 7.4, h: 18 + ((i + 10) * 11) % 16, face: "south" });
    buildings.push({ x: -30, z, w: 7.5, d: 8.1, h: 14 + ((i + 11) * 9) % 18, face: "west" });
    buildings.push({ x: 30, z, w: 7.5, d: 8.1, h: 20 + ((i + 9) * 6) % 14, face: "east" });
  }
  const buildingMats = [
    standard(0x202d49, 0x102443, 0.72),
    standard(0x32354e, 0x191b32, 0.55),
    standard(0x233e4e, 0x142e39, 0.58)
  ];
  const warmWindows = [];
  const coolWindows = [];
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    addBox(b.w, b.h, b.d, b.x, b.h / 2 - 0.03, b.z, buildingMats[i % buildingMats.length]);
    addBox(b.w + 0.1, 0.16, b.d + 0.1, b.x, b.h + 0.02, b.z,
      i % 3 === 0 ? bright(0xff4ba0) : bright(0x36d8ff));
    const isXSide = b.face === "west" || b.face === "east";
    const columns = Math.max(3, Math.floor((isXSide ? b.d : b.w) / 1.45));
    const facadeDistance = isXSide ? b.w / 2 + 0.055 : b.d / 2 + 0.055;
    for (let floor = 1; floor < Math.floor((b.h - 1) / 1.9); floor++) {
      for (let c = 0; c < columns; c++) {
        if ((floor * 17 + c * 11 + i * 7) % 13 < 3) continue;
        const offset = (c - (columns - 1) / 2) * 1.32;
        const window = {
          x: isXSide ? b.x + (b.face === "west" ? facadeDistance : -facadeDistance) : b.x + offset,
          y: floor * 1.9 + 0.9,
          z: isXSide ? b.z + offset : b.z + (b.face === "north" ? facadeDistance : -facadeDistance),
          rotate: isXSide ? Math.PI / 2 : 0
        };
        ((floor + c + i) % 5 === 0 ? warmWindows : coolWindows).push(window);
      }
    }
  }
  const windowGeometry = new THREE.BoxGeometry(0.7, 0.92, 0.07);
  const tmp = new THREE.Object3D();
  for (const [windows, color] of [[coolWindows, 0x58c9f6], [warmWindows, 0xffcd75]]) {
    const batch = new THREE.InstancedMesh(windowGeometry, bright(color), windows.length);
    batch.frustumCulled = false;
    windows.forEach((w, idx) => {
      tmp.position.set(w.x, w.y, w.z);
      tmp.rotation.set(0, w.rotate, 0);
      tmp.updateMatrix();
      batch.setMatrixAt(idx, tmp.matrix);
    });
    batch.instanceMatrix.needsUpdate = true;
    scene.add(batch);
  }

  // Colorful fictional billboards; no real-world trademarks or downloaded assets.
  function billboard(label, x, y, z, width, height, facing, hue) {
    const canvas = document.createElement("canvas");
    canvas.width = 512; canvas.height = 160;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#091526"; ctx.fillRect(0, 0, 512, 160);
    ctx.strokeStyle = hue; ctx.lineWidth = 10; ctx.strokeRect(8, 8, 496, 144);
    ctx.fillStyle = hue; ctx.shadowColor = hue; ctx.shadowBlur = 16;
    ctx.font = "bold 59px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, 256, 82, 458);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({
      map: texture, transparent: false, side: THREE.DoubleSide, toneMapped: false
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    sign.position.set(x, y, z);
    sign.rotation.y = facing;
    scene.add(sign);
  }
  billboard("SHIBUYA 2099", -9.6, 12.8, -26.0, 7.0, 2.3, 0, "#ff55b9");
  billboard("NEON CITY", 9.6, 14.4, -26.0, 6.6, 2.3, 0, "#54eaf9");
  billboard("NOVA", -9.6, 11.6, 26.0, 6.0, 2.5, Math.PI, "#69f9e6");
  billboard("24H / OPEN", 9.6, 12.4, 26.0, 6.0, 2.2, Math.PI, "#ffc47d");
  billboard("CYBER", -26.0, 11.3, 0, 6.8, 2.5, Math.PI / 2, "#67ccff");
  billboard("TOKYO-X", 26.0, 13.2, 0, 6.8, 2.3, -Math.PI / 2, "#ff5a9b");
  billboard("CROSSING", 0, 7.2, -1.9, 3.75, 1.25, 0, "#94edff");

  // Soft streetlight pools illuminate the roads and nearby player models.
  const pole = standard(0x809aad, 0x172c38, 0.35);
  const lampHead = bright(0xc8faff);
  const lampPositions = [[-16, -13], [16, -13], [-16, 13], [16, 13]];
  lampPositions.forEach(([x, z], i) => {
    addBox(0.16, 5.0, 0.16, x, 2.5, z, pole);
    addBox(1.3, 0.25, 0.45, x + (x > 0 ? -0.58 : 0.58), 5.1, z, lampHead);
    const light = new THREE.PointLight(i % 2 ? 0x8bdfff : 0xffe3ba, 32, 15, 2);
    light.position.set(x, 4.9, z);
    scene.add(light);
  });
  for (const [x, z] of [[-13, -13], [13, 13]]) {
    addBox(0.18, 3.1, 0.18, x, 1.55, z, pole);
    addBox(0.8, 1.25, 0.36, x, 3.35, z, standard(0x172438));
    addBox(0.27, 0.27, 0.05, x, 3.68, z + 0.21, bright(0xff4c67));
    addBox(0.27, 0.27, 0.05, x, 3.30, z + 0.21, bright(0xffc95c));
    addBox(0.27, 0.27, 0.05, x, 2.93, z + 0.21, bright(0x65ffa3));
  }
}
