/**
 * pieces.js — every piece of Clubhouse furniture, as a builder function.
 *
 * A builder takes a style (theme-bound materials, see kit.js) and the layout piece's props, and returns a THREE.Group built
 * around its own origin on the floor, facing local +z. It never decides where it stands: layout.js does, and `buildPiece`
 * applies the position and rotation. Colours come from theme tokens; only natural materials (cork, paper, fur) are literal.
 */
import {
  THREE, M, at, rbox, cyl, ball, torus, capsule, glow, glass, canvasTexture, rrectPath, rng, card, cardTexture, labelTexture, paintNoise, weave,
} from './kit.js';
import { RoomMaterial } from '../look/simpleMaterial.js';

// ── textures drawn from the theme ─────────────────────────────────────────
function printTex(C, seed) {
  const pal = [[C.wallLow, C.amber], [C.coral, C.cream], [C.mint, C.wall], [C.amber, C.teal]][seed % 4];
  return canvasTexture(256, 320, (c, W, H) => {
    c.fillStyle = C.cream; c.fillRect(0, 0, W, H);
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, pal[0]); g.addColorStop(1, pal[1]); c.fillStyle = g; c.fillRect(22, 22, W - 44, H - 44);
    c.save(); c.beginPath(); c.rect(22, 22, W - 44, H - 44); c.clip();
    const k = seed % 3;
    if (k === 0) { c.fillStyle = 'rgba(255,240,200,0.9)'; c.beginPath(); c.arc(150, 120, 46, 0, 7); c.fill(); c.fillStyle = 'rgba(15,60,60,0.7)'; c.beginPath(); c.moveTo(0, H); c.lineTo(80, 190); c.lineTo(150, 250); c.lineTo(210, 170); c.lineTo(W, H); c.fill(); }
    if (k === 1) { for (let i = 0; i < 6; i++) { c.fillStyle = `rgba(255,255,255,${0.15 + i * 0.1})`; c.beginPath(); c.arc(128, 170, 90 - i * 14, 0, 7); c.fill(); } }
    if (k === 2) { c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 5; for (let i = 0; i < 7; i++) { c.beginPath(); c.moveTo(0, 90 + i * 28); for (let x = 0; x <= W; x += 16) c.lineTo(x, 90 + i * 28 + Math.sin(x * 0.05 + i) * 10); c.stroke(); } }
    c.restore();
  });
}
const corkTex = () => canvasTexture(512, 300, (c, W, H) => { c.fillStyle = '#C9A26B'; c.fillRect(0, 0, W, H); const R = rng(2); for (let i = 0; i < 1800; i++) { c.fillStyle = R() > 0.5 ? 'rgba(120,80,30,0.25)' : 'rgba(255,230,180,0.25)'; c.beginPath(); c.arc(R() * W, R() * H, 1 + R() * 2, 0, 7); c.fill(); } });
const rugTex = (C, w, d) => canvasTexture(1100, Math.round((1100 * d) / w), (c, W, H) => {
  c.fillStyle = C.rugBase; rrectPath(c, 6, 6, W - 12, H - 12, 24); c.fill();
  c.strokeStyle = C.teal; c.lineWidth = 34; rrectPath(c, 52, 52, W - 104, H - 104, 14); c.stroke();
  c.strokeStyle = C.coral; c.lineWidth = 12; rrectPath(c, 100, 100, W - 200, H - 200, 8); c.stroke();
  c.fillStyle = 'rgba(27,94,102,0.12)'; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { c.save(); c.translate(170 + x * 108, 170 + y * 108 * (H / 1536)); c.rotate(Math.PI / 4); c.fillRect(-18, -18, 36, 36); c.restore(); }
  c.fillStyle = C.coral; c.beginPath(); c.arc(W / 2, H / 2, 130, 0, 7); c.fill(); c.fillStyle = C.cream; c.beginPath(); c.arc(W / 2, H / 2, 96, 0, 7); c.fill(); c.fillStyle = C.teal; c.beginPath(); c.arc(W / 2, H / 2, 54, 0, 7); c.fill();
  c.strokeStyle = 'rgba(80,50,20,0.5)'; c.lineWidth = 4; for (let x = 20; x < W - 20; x += 14) { c.beginPath(); c.moveTo(x, 6); c.lineTo(x, -6); c.moveTo(x, H - 6); c.lineTo(x, H + 6); c.stroke(); }
});
const stripeTex = (a, b) => canvasTexture(256, 256, (c, W, H) => { c.fillStyle = a; c.fillRect(0, 0, W, H); c.fillStyle = b; for (let y = 20; y < H; y += 64) c.fillRect(0, y, W, 22); });
const pagesTex = (C, seeds) => canvasTexture(1024, 720, (c, W, H) => {
  c.fillStyle = C.teal; c.fillRect(0, 0, W, H);
  for (let p = 0; p < 2; p++) {
    const x0 = p * 512 + 14; c.fillStyle = '#f3ead6'; c.fillRect(x0, 12, 484, H - 24);
    for (let r = 0; r < 3; r++) for (let col = 0; col < 3; col++) {
      const x = x0 + 2 + col * 160; const y = 24 + r * 225; c.fillStyle = 'rgba(150,170,175,0.28)'; c.fillRect(x, y, 156, 218);
      c.drawImage(cardTexture(seeds[(p * 9 + r * 3 + col) % seeds.length]).image, x + 8, y + 10, 140, 196);
    }
  }
});
const clockTex = (C) => canvasTexture(256, 256, (c, W) => { c.fillStyle = C.cream; c.fillRect(0, 0, W, W); c.fillStyle = C.ink; for (let i = 0; i < 12; i++) { c.save(); c.translate(128, 128); c.rotate((i * Math.PI) / 6); c.fillRect(-4, -112, 8, i % 3 ? 14 : 24); c.restore(); } c.lineCap = 'round'; c.lineWidth = 10; c.beginPath(); c.moveTo(128, 128); c.lineTo(86, 84); c.stroke(); c.lineWidth = 7; c.beginPath(); c.moveTo(128, 128); c.lineTo(190, 70); c.stroke(); c.fillStyle = C.coral; c.beginPath(); c.arc(128, 128, 9, 0, 7); c.fill(); });
const noteTex = (col) => canvasTexture(128, 128, (c, W) => { c.fillStyle = col; c.fillRect(0, 0, W, W); c.fillStyle = 'rgba(16,40,44,0.5)'; for (let i = 0; i < 4; i++) c.fillRect(14, 22 + i * 26, 60 + (i % 2) * 36, 6); });
const photoTex = (C) => canvasTexture(128, 150, (c, W, H) => { c.fillStyle = '#FBF6EA'; c.fillRect(0, 0, W, H); const gg = c.createLinearGradient(0, 0, 0, 110); gg.addColorStop(0, '#7CC4D8'); gg.addColorStop(1, C.leaf); c.fillStyle = gg; c.fillRect(10, 10, W - 20, 110); });

// ── workspace ─────────────────────────────────────────────────────────────
function desk(S) {
  const { C, oak, lac, fab, brass, night } = S;
  const g = new THREE.Group(); const wood = oak(); const dark = oak(C.oakDark);
  g.add(at(rbox(1.9, 0.05, 0.7, 0.02, wood), 0, 0.745, 0)); g.add(at(rbox(0.05, 0.72, 0.62, 0.015, dark), -0.9, 0.36, 0));
  g.add(at(rbox(0.52, 0.7, 0.64, 0.02, dark), 0.62, 0.35, 0)); g.add(at(rbox(1.2, 0.3, 0.02, 0.01, dark), -0.3, 0.55, -0.3));
  [0.13, 0.35, 0.57].forEach((y, i) => { g.add(at(rbox(0.46, 0.19, 0.02, 0.01, lac([C.teal, C.coral, C.mint][i])), 0.62, y + 0.02, 0.325)); g.add(at(ball(0.018, brass(), 12), 0.62, y + 0.02, 0.343)); });
  const y0 = 0.77;
  // open binder with card pages
  g.add(at(rbox(0.66, 0.02, 0.48, 0.01, lac(C.teal)), -0.4, y0 + 0.01, 0.02));
  const pages = M(new THREE.PlaneGeometry(0.6, 0.42), new RoomMaterial({ map: pagesTex(C, [3, 8, 14, 19, 22, 27, 31, 5, 11, 16, 20, 25]), roughness: 0.5 }), { cast: false }); pages.rotation.x = -Math.PI / 2; pages.position.set(-0.4, y0 + 0.022, 0.02); g.add(pages);
  // sleeves and deck boxes
  [0, 1, 2].forEach((k) => g.add(at(rbox(0.1, 0.012, 0.14, 0.004, new RoomMaterial({ color: ['#F3E7D0', '#CFE9E1', '#F5D8B0'][k], roughness: 0.3, transparent: true, opacity: 0.85 })), 0.04, y0 + 0.008 + k * 0.014, 0.17)));
  [[C.coral, 0.2], [C.teal, 0.29], [C.amber, 0.38]].forEach(([c, x]) => g.add(at(rbox(0.07, 0.1, 0.095, 0.012, lac(c)), x, y0 + 0.05, 0.12)));
  g.add(at(rbox(0.07, 0.1, 0.095, 0.012, lac(C.mint)), 0.245, y0 + 0.15, 0.12));
  // desk lamp, a visible light source
  const lamp = new THREE.Group(); lamp.position.set(0.68, y0, -0.2);
  lamp.add(at(cyl(0.09, 0.1, 0.03, lac(C.ink)), 0, 0.015, 0)); const a1 = cyl(0.008, 0.008, 0.42, lac(C.ink), 12); a1.position.set(0.05, 0.22, 0); a1.rotation.z = -0.35; lamp.add(a1);
  const a2 = cyl(0.008, 0.008, 0.4, lac(C.ink), 12); a2.position.set(-0.04, 0.5, 0); a2.rotation.z = 0.9; lamp.add(a2);
  const head = cyl(0.04, 0.1, 0.12, new RoomMaterial({ color: C.coral, emissive: C.amber, emissiveIntensity: night ? 1.6 : 0.5, roughness: 0.5 }), 24); head.position.set(-0.16, 0.6, 0); head.rotation.z = 0.5; lamp.add(head);
  if (S.lights) { const dl = new THREE.PointLight('#ffb15e', night ? 2.2 : 0.35, 2.4, 2); dl.position.set(-0.2, 0.55, 0); lamp.add(dl); }
  g.add(lamp);
  // mug, pen cup, notepad, loupe
  g.add(at(cyl(0.04, 0.04, 0.09, lac(C.cream), 20), -0.78, y0 + 0.045, -0.2)); g.add(at(cyl(0.04, 0.036, 0.1, lac(C.teal), 20), 0.05, y0 + 0.05, -0.25));
  [0, 1, 2].forEach((k) => { const pen = cyl(0.005, 0.005, 0.16, lac([C.coral, C.amber, C.ink][k]), 8); pen.position.set(0.04 + k * 0.012, y0 + 0.14, -0.25); pen.rotation.z = 0.12 * (k - 1); g.add(pen); });
  g.add(at(rbox(0.15, 0.012, 0.2, 0.004, lac(C.cream)), -0.78, y0 + 0.006, 0.12));
  const loupe = torus(0.035, 0.006, brass(), Math.PI * 2, 24); loupe.rotation.x = -Math.PI / 2; loupe.position.set(-0.62, y0 + 0.012, 0.2); g.add(loupe);
  const handle = cyl(0.005, 0.005, 0.09, brass(), 8); handle.position.set(-0.57, y0 + 0.012, 0.25); handle.rotation.set(0, 0.6, Math.PI / 2); g.add(handle);
  // a row of reference books and two dice jars at the back of the desk
  [C.coral, C.teal, C.amber, C.mint, '#BF5A47', C.cream, C.teal].forEach((c, i) => { const h = 0.17 + (i % 3) * 0.025; g.add(at(rbox(0.028, h, 0.1, 0.006, lac(c)), 0.83 - i * 0.031, y0 + h / 2, -0.23)); });
  const leaning = at(rbox(0.03, 0.2, 0.1, 0.006, lac(C.amber)), 0.58, 0.87, -0.23); leaning.rotation.z = 0.16; g.add(leaning);
  [[0.25, '#E8786A'], [0.17, '#8FCDB0']].forEach(([x, col]) => { g.add(at(cyl(0.032, 0.032, 0.07, glass(col, 0.5), 18), x, 0.805, -0.21)); g.add(at(cyl(0.034, 0.034, 0.012, lac(C.ink), 18), x, 0.846, -0.21)); });
  // chair, and a small round rug under it
  const chair = new THREE.Group(); chair.position.set(-0.4, 0, 0.55); chair.rotation.y = Math.PI;
  chair.add(at(rbox(0.5, 0.07, 0.48, 0.03, fab(C.teal)), 0, 0.46, 0));
  const back = rbox(0.5, 0.5, 0.06, 0.03, fab(C.teal)); back.position.set(0, 0.74, -0.22); back.rotation.x = 0.08; chair.add(back);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => chair.add(at(cyl(0.02, 0.016, 0.44, oak(C.oakDark), 12), sx * 0.21, 0.22, sz * 0.2))); g.add(chair);
  const rugT = canvasTexture(256, 256, (c, W) => { for (let i = 0; i < 6; i++) { c.fillStyle = i % 2 ? C.cream : C.teal; c.beginPath(); c.arc(W / 2, W / 2, W / 2 - i * 20, 0, 7); c.fill(); } });
  const rug = M(new THREE.CircleGeometry(0.62, 40), new RoomMaterial({ map: rugT, roughness: 1, bumpMap: weave(), bumpScale: 1.2 }), { cast: false }); rug.rotation.x = -Math.PI / 2; rug.position.set(-0.4, 0.01, 0.6); g.add(rug);
  return g;
}

function pinboard(S) {
  const { C, oak, lac } = S;
  const g = new THREE.Group();
  g.add(at(rbox(1.7, 0.98, 0.05, 0.02, oak(C.oakDark)), 0, 0, 0));
  const cork = M(new THREE.PlaneGeometry(1.6, 0.88), new RoomMaterial({ map: corkTex(), roughness: 0.95 }), { cast: false }); cork.position.z = 0.027; g.add(cork);
  const sheet = (map, w, h, x, y, rot, c) => { const m = M(new THREE.PlaneGeometry(w, h), new RoomMaterial({ map, roughness: 0.6 }), { cast: false }); m.position.set(x, y, 0.034); m.rotation.z = rot; g.add(m); g.add(at(ball(0.014, lac(c), 10), x, y + h / 2 - 0.02, 0.045)); };
  sheet(cardTexture(5), 0.24, 0.34, -0.62, 0.12, 0.05, C.coral); sheet(cardTexture(11), 0.24, 0.34, -0.33, 0.16, -0.04, C.mint); sheet(cardTexture(17), 0.24, 0.34, 0.5, 0.08, 0.06, C.amber);
  sheet(printTex(C, 2), 0.34, 0.42, 0.1, 0.06, -0.03, C.teal);
  [[-0.28, -0.22, 0.08, '#F5E3A0'], [0.34, -0.26, -0.06, '#CDEBDD'], [-0.62, -0.26, -0.05, '#F5E3A0'], [0.64, -0.22, 0.07, '#F4D1C2']].forEach(([x, y, r, col]) => sheet(noteTex(col), 0.16, 0.16, x, y, r, C.coral));
  sheet(photoTex(C), 0.16, 0.19, 0.0, -0.26, 0.04, C.teal);
  return g;
}

function wallShelf(S) {
  const { C, oak, lac, brass } = S;
  const g = new THREE.Group();
  g.add(at(rbox(1.6, 0.045, 0.24, 0.015, oak()), 0, 0, 0));
  [-0.65, 0.65].forEach((x) => g.add(at(rbox(0.04, 0.16, 0.18, 0.01, oak(C.oakDark)), x, -0.1, -0.02)));
  [[-0.62, C.coral, 0.2], [-0.54, C.teal, 0.24], [-0.47, C.amber, 0.18], [-0.4, C.mint, 0.22]].forEach(([x, c, h]) => g.add(at(rbox(0.06, h, 0.17, 0.008, lac(c)), x, 0.022 + h / 2, 0)));
  g.add(at(cyl(0.07, 0.055, 0.1, lac(C.cream), 20), 0.1, 0.07, 0));
  for (let i = 0; i < 6; i++) { const lf = ball(0.05, lac(i % 2 ? C.green : C.leaf), 12); lf.scale.set(0.5, 1.2, 0.3); lf.position.set(0.1 + (i - 2.5) * 0.02, 0.18 + (i % 3) * 0.03, 0); lf.rotation.z = (i - 2.5) * 0.25; g.add(lf); }
  for (let i = 0; i < 5; i++) g.add(at(ball(0.03, lac(C.leaf), 8), 0.2 + i * 0.012, -i * 0.07, 0.03));
  const trophy = new THREE.Group(); trophy.position.set(0.55, 0.0225, 0);
  trophy.add(at(cyl(0.05, 0.06, 0.03, lac(C.oakDark), 18), 0, 0.015, 0)); trophy.add(at(cyl(0.012, 0.012, 0.08, brass(), 8), 0, 0.07, 0)); trophy.add(at(cyl(0.06, 0.03, 0.09, brass(), 20), 0, 0.15, 0)); g.add(trophy);
  return g;
}

function drawerCart(S) {
  const { C, oak, lac } = S;
  const g = new THREE.Group();
  g.add(at(rbox(0.5, 0.7, 0.5, 0.025, oak()), 0, 0.42, 0));
  [['Sleeves', C.teal], ['Deck Boxes', C.coral], ['Dice', C.amber]].forEach(([name, col], i) => {
    g.add(at(rbox(0.44, 0.19, 0.02, 0.01, lac(col)), 0, 0.2 + i * 0.21, 0.255));
    const plate = M(new THREE.PlaneGeometry(0.28, 0.07), new RoomMaterial({ map: labelTexture(name, C.cream, C.ink, 256, 80), roughness: 0.6 }), { cast: false }); plate.position.set(0, 0.2 + i * 0.21, 0.267); g.add(plate);
  });
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => g.add(at(ball(0.035, lac(C.ink), 10), sx * 0.2, 0.04, sz * 0.2)));
  g.add(at(rbox(0.3, 0.02, 0.22, 0.008, oak(C.oakDark)), 0, 0.78, 0)); [0, 1].forEach((k) => g.add(at(rbox(0.08, 0.06, 0.1, 0.01, lac([C.mint, C.coral][k])), -0.07 + k * 0.1, 0.82, 0)));
  return g;
}

// ── seating ───────────────────────────────────────────────────────────────
function sofa(S) {
  const { C, oak, fab } = S;
  const g = new THREE.Group(); const body = fab(C.sofa); const seat = fab(C.sofaSeat);
  g.add(at(rbox(2.1, 0.3, 0.9, 0.1, body), 0, 0.26, 0.02)); g.add(at(rbox(2.1, 0.62, 0.24, 0.1, body), 0, 0.62, -0.34));
  [-1, 1].forEach((s) => g.add(at(rbox(0.22, 0.56, 0.92, 0.1, body), s * 0.99, 0.52, 0.02)));
  [-1, 1].forEach((s) => { g.add(at(rbox(0.88, 0.17, 0.72, 0.08, seat), s * 0.46, 0.5, 0.08)); const bk = rbox(0.88, 0.42, 0.2, 0.09, seat); bk.position.set(s * 0.46, 0.8, -0.2); bk.rotation.x = -0.13; g.add(bk); });
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => g.add(at(cyl(0.035, 0.025, 0.12, oak(C.oakDark), 10), sx * 0.95, 0.06, sz * 0.38)));
  [[-0.62, C.cream, 0.15, 0.2], [-0.2, C.teal, -0.12, -0.12], [0.62, C.amber, -0.1, 0.18]].forEach(([x, col, rz, ry]) => { const p = rbox(0.42, 0.4, 0.13, 0.07, fab(col)); p.position.set(x, 0.78, -0.02); p.rotation.set(-0.15, ry, rz); g.add(p); });
  const throwTex = stripeTex('#EDE0C4', C.teal); throwTex.wrapS = throwTex.wrapT = THREE.RepeatWrapping;
  const blanket = new RoomMaterial({ map: throwTex, roughness: 1 });
  g.add(at(rbox(0.3, 0.035, 0.62, 0.014, blanket), 0.99, 0.815, 0.1)); g.add(at(rbox(0.035, 0.52, 0.62, 0.014, blanket), 1.14, 0.56, 0.1));
  return g;
}

function coffeeTable(S) {
  const { C, oak, lac } = S;
  const g = new THREE.Group();
  g.add(at(rbox(1.2, 0.05, 0.7, 0.025, oak()), 0, 0.42, 0)); g.add(at(rbox(1.0, 0.03, 0.5, 0.012, oak(C.oakDark)), 0, 0.14, 0));
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => g.add(at(cyl(0.03, 0.022, 0.4, oak(C.oakDark), 10), sx * 0.52, 0.2, sz * 0.28)));
  const y0 = 0.445;
  g.add(at(rbox(0.36, 0.055, 0.26, 0.012, lac(C.teal)), -0.35, y0 + 0.028, -0.12)); g.add(at(rbox(0.34, 0.05, 0.24, 0.012, lac(C.coral)), -0.35, y0 + 0.08, -0.12));
  g.add(at(rbox(0.5, 0.02, 0.32, 0.01, oak(C.oakDark)), 0.2, y0 + 0.01, 0.1));
  [[C.amber, 0.06], [C.teal, 0.15], [C.coral, 0.24]].forEach(([c, x]) => g.add(at(rbox(0.07, 0.1, 0.095, 0.012, lac(c)), x, y0 + 0.07, 0.1)));
  g.add(at(rbox(0.07, 0.1, 0.095, 0.012, lac(C.mint)), 0.15, y0 + 0.17, 0.1));
  [0, 1, 2].forEach((k) => { const c = card([6, 12, 24][k], { w: 0.12, h: 0.17 }); c.position.set(-0.28 + k * 0.05, y0 + 0.13, 0.06); c.rotation.set(-0.25, 0, 0.12 * (k - 1)); g.add(c); });
  g.add(at(cyl(0.04, 0.034, 0.09, lac(C.cream), 18), 0.45, y0 + 0.045, -0.2));
  const succ = new THREE.Group(); succ.position.set(0.42, y0, 0.12); succ.add(at(cyl(0.07, 0.055, 0.09, lac(C.cream), 18), 0, 0.045, 0));
  for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; const lf = ball(0.04, lac(C.leaf), 8); lf.scale.set(0.5, 1.3, 0.35); lf.position.set(Math.cos(a) * 0.04, 0.13, Math.sin(a) * 0.04); lf.rotation.z = Math.cos(a) * 0.7; lf.rotation.x = -Math.sin(a) * 0.7; succ.add(lf); }
  g.add(succ);
  // cosy things on the table: a candle with a real light, a steaming mug, an open book
  g.add(at(cyl(0.032, 0.032, 0.075, lac(C.cream), 20), 0.35, 0.4825, 0.22));
  const flame = ball(0.012, glow('#FFD27A', 3), 10); flame.scale.set(0.8, 1.7, 0.8); flame.position.set(0.35, 0.545, 0.22); g.add(flame);
  if (S.lights) { const cl = new THREE.PointLight('#ffb86a', S.night ? 1.8 : 0.9, 1.8, 2); cl.position.set(0.35, 0.57, 0.22); g.add(cl); }
  g.add(at(cyl(0.04, 0.036, 0.09, lac(C.coral), 18), 0.25, 0.49, -0.17));
  for (let i = 0; i < 3; i++) {
    const wisp = M(new THREE.SphereGeometry(0.014 + i * 0.005, 8, 8), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.22 - i * 0.05, depthWrite: false }), { cast: false });
    wisp.position.set(0.25, 0.56 + i * 0.04, -0.17 + (i % 2 ? 0.01 : -0.01)); g.add(wisp);
  }
  const book = new THREE.Group(); book.position.set(-0.25, 0.445, -0.07); book.rotation.y = 0.35 - Math.PI / 2;
  book.add(at(rbox(0.2, 0.018, 0.14, 0.004, lac('#BF5A47')), 0, 0.009, 0));
  const pageBlock = rbox(0.185, 0.014, 0.125, 0.003, lac('#F6EEDB')); pageBlock.position.set(0, 0.025, 0); book.add(pageBlock); g.add(book);
  return g;
}

function rug(S, props) {
  const { C } = S; const w = props.w ?? 2.6; const d = props.d ?? 3.0;
  const g = new THREE.Group();
  const plane = M(new THREE.PlaneGeometry(w, d), new RoomMaterial({ map: rugTex(C, w, d), roughness: 1, transparent: true }), { cast: false });
  plane.rotation.x = -Math.PI / 2; plane.position.y = 0.012; g.add(plane);
  return g;
}

function pouf(S) {
  const { fab, C } = S;
  const g = new THREE.Group();
  g.add(at(cyl(0.3, 0.32, 0.36, fab(C.amber), 32), 0, 0.18, 0)); const rim = torus(0.3, 0.03, fab(C.amber)); rim.rotation.x = Math.PI / 2; rim.position.y = 0.36; g.add(rim); g.add(at(cyl(0.27, 0.27, 0.03, fab(C.amber), 32), 0, 0.375, 0));
  return g;
}

function floorCushions(S) {
  const { fab, C } = S; const g = new THREE.Group();
  [[-0.1, -0.125, 0.4, C.teal], [0.1, 0.125, -0.2, C.mint]].forEach(([x, z, ry, col]) => { const c = rbox(0.55, 0.12, 0.55, 0.06, fab(col)); c.position.set(x, 0.07, z); c.rotation.y = ry; g.add(c); });
  return g;
}

function floorLamp(S) {
  const { C, lac, night } = S; const g = new THREE.Group();
  g.add(at(cyl(0.16, 0.18, 0.03, lac(C.ink), 24), 0, 0.015, 0)); g.add(at(cyl(0.012, 0.012, 1.5, lac(C.ink), 8), 0, 0.78, 0));
  const shade = cyl(0.2, 0.26, 0.34, new RoomMaterial({ color: C.cream, emissive: C.amber, emissiveIntensity: night ? 1.8 : 0.45, roughness: 0.85 }), 32); shade.position.y = 1.66; g.add(shade);
  if (S.lights) { const l = new THREE.PointLight('#ffc477', night ? 8 : 3.2, 5, 1.7); l.position.set(0.1, 1.6, 0); g.add(l); }
  return g;
}

function plant(S, props) {
  const { C, lac, plain, tok } = S; const s = props.scale ?? 1; const tall = props.tall ?? 1; const R = rng(props.seed ?? 1);
  const g = new THREE.Group(); g.scale.setScalar(s);
  const pot = tok(props.pot ?? 'cream');
  g.add(at(cyl(0.22, 0.17, 0.42, lac(pot), 24), 0, 0.21, 0)); const rim = torus(0.22, 0.028, lac(pot)); rim.rotation.x = Math.PI / 2; rim.position.y = 0.42; g.add(rim);
  g.add(at(cyl(0.013, 0.013, 0.8 * tall, plain('#6a4a2a'), 8), 0, 0.82, 0));
  for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2 + R(); const lf = ball(0.18, plain(i % 3 ? C.green : C.leaf, { roughness: 0.55 }), 14); lf.scale.set(0.5, 1.15, 0.12); lf.position.set(Math.cos(a) * 0.18, (0.95 + R() * 0.6) * tall, Math.sin(a) * 0.18); lf.rotation.z = -Math.cos(a) * 0.9; lf.rotation.x = Math.sin(a) * 0.9; g.add(lf); }
  return g;
}

function gameTable(S) {
  const { C, oak, lac, fab } = S; const g = new THREE.Group();
  g.add(at(cyl(0.85, 0.85, 0.05, oak(), 44), 0, 0.74, 0)); g.add(at(cyl(0.08, 0.1, 0.7, oak(C.oakDark), 16), 0, 0.37, 0)); g.add(at(cyl(0.38, 0.42, 0.04, oak(C.oakDark), 32), 0, 0.02, 0));
  g.add(at(cyl(0.62, 0.62, 0.006, fab(C.felt), 36), 0, 0.768, 0));
  const y0 = 0.775;
  [[0.2, 0.1, 0.2, 6], [-0.1, 0.25, -0.3, 14], [0.32, -0.12, 0.5, 20], [-0.28, -0.1, -0.1, 3], [0.0, -0.3, 0.7, 25]].forEach(([x, z, r, s]) => { const c = card(s, { w: 0.13, h: 0.18 }); c.rotation.set(-Math.PI / 2, 0, r); c.position.set(x, y0 + 0.008, z); g.add(c); });
  [[0.38, 0.28, C.cream], [0.46, 0.2, C.coral], [-0.45, 0.1, C.cream]].forEach(([x, z, col]) => g.add(at(rbox(0.04, 0.04, 0.04, 0.006, lac(col)), x, y0 + 0.022, z)));
  [C.coral, C.amber, C.teal].forEach((c, k) => g.add(at(rbox(0.07, 0.1, 0.095, 0.012, lac(c)), -0.55 + k * 0.08, y0 + 0.05, -0.38)));
  [[0.1, 0.12], [0.14, 0.12], [0.12, 0.16]].forEach(([x, z], i) => g.add(at(cyl(0.022, 0.022, 0.012 + i * 0.001, lac(C.amber), 14), x + 0.38, y0 + 0.006 + i * 0.012, z - 0.4)));
  g.add(at(cyl(0.04, 0.036, 0.1, glass('#dff7f1', 0.4), 18), 0.55, y0 + 0.05, -0.1));
  [[-1.0, 0.0, C.teal], [0.5, 1.2, C.coral], [0.5, -1.2, C.amber]].forEach(([cx, cz, col]) => {
    const ch = new THREE.Group(); ch.position.set(cx, 0, cz); ch.rotation.y = Math.atan2(-cx, -cz);
    ch.add(at(rbox(0.46, 0.07, 0.44, 0.03, fab(col)), 0, 0.45, 0)); const bk = rbox(0.46, 0.46, 0.06, 0.03, fab(col)); bk.position.set(0, 0.72, -0.2); bk.rotation.x = 0.06; ch.add(bk);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => ch.add(at(cyl(0.02, 0.016, 0.43, oak(C.oakDark), 10), sx * 0.19, 0.215, sz * 0.18))); g.add(ch);
  });
  return g;
}

// ── walls ─────────────────────────────────────────────────────────────────
function frame(S, props) {
  const { C, oak, lac } = S; const w = props.w ?? 0.5; const h = props.h ?? 0.66;
  const [kind, n] = String(props.art ?? 'print:1').split(':'); const seed = Number(n) || 1;
  const g = new THREE.Group();
  g.add(at(rbox(w, h, 0.05, 0.015, oak(C.oakDark)), 0, 0, 0)); g.add(at(rbox(w - 0.08, h - 0.08, 0.02, 0.01, lac(C.cream)), 0, 0, 0.02));
  const art = M(new THREE.PlaneGeometry(w - 0.2, h - 0.22), new RoomMaterial({ map: kind === 'card' ? cardTexture(seed) : printTex(C, seed), roughness: 0.5 }), { cast: false }); art.position.z = 0.032; g.add(art);
  return g;
}

function clock(S) {
  const { C, oak } = S; const g = new THREE.Group();
  const face = M(new THREE.CircleGeometry(0.22, 36), new RoomMaterial({ map: clockTex(C), roughness: 0.6 }), { cast: false }); face.position.z = 0.02; g.add(face); g.add(torus(0.23, 0.028, oak(C.oakDark), Math.PI * 2, 36));
  return g;
}

function slatPanel(S, props) {
  const { oak } = S; const g = new THREE.Group(); const n = props.count ?? 22;
  for (let i = 0; i < n; i++) g.add(at(M(new THREE.BoxGeometry(0.07, 3.3, 0.05), oak('#B98B52')), -(n - 1) * 0.05 + i * 0.1, 0, 0));
  return g;
}

// ── small floor things ────────────────────────────────────────────────────
function slippers(S) {
  const { fab, C } = S; const g = new THREE.Group();
  [[-0.065, -0.075, 0.2], [0.065, 0.075, 0.05]].forEach(([x, z, r]) => {
    const sl = new THREE.Group(); sl.position.set(x, 0, z); sl.rotation.y = r;
    sl.add(at(rbox(0.09, 0.035, 0.2, 0.016, fab(C.mint)), 0, 0.018, 0)); sl.add(at(rbox(0.09, 0.05, 0.09, 0.022, fab(C.cream)), 0, 0.04, -0.045)); g.add(sl);
  });
  return g;
}

function basket(S) {
  const { C, lac, fab } = S; const g = new THREE.Group();
  g.add(at(cyl(0.2, 0.17, 0.3, new RoomMaterial({ color: '#C99C62', roughness: 0.95, bumpMap: weave(), bumpScale: 2 }), 28), 0, 0.15, 0));
  const rim = at(torus(0.2, 0.014, lac(C.oakDark), Math.PI * 2, 28), 0, 0.3, 0); rim.rotation.x = Math.PI / 2; g.add(rim);
  const blanket = at(rbox(0.3, 0.1, 0.22, 0.04, fab(C.teal)), 0, 0.33, 0); blanket.rotation.y = 0.4; g.add(blanket);
  return g;
}

// ── Graton ────────────────────────────────────────────────────────────────
/** A sleeping dog, curled up on his side: black back and ears, tan cheeks, brows and legs, white chest with black flecks. */
function sleepingDog() {
  const g = new THREE.Group();
  const fur = (c, r = 0.85) => new RoomMaterial({ color: c, roughness: r, bumpMap: paintNoise(), bumpScale: 0.5 });
  const BLACK = fur('#17120f'); const TAN = fur('#a4622f'); const WHITE = fur('#f1ebe0'); const NOSE = fur('#0c0a09', 0.35);
  const ell = (rx, ry, rz, m, x, y, z, seg = 20) => { const e = ball(1, m, seg); e.scale.set(rx, ry, rz); e.position.set(x, y, z); return e; };
  g.add(ell(0.3, 0.16, 0.2, BLACK, 0, 0.18, 0));
  g.add(ell(0.18, 0.15, 0.17, BLACK, -0.2, 0.16, 0.04));
  const hind = ell(0.13, 0.055, 0.06, TAN, -0.16, 0.06, 0.2); hind.rotation.y = -0.3; g.add(hind);
  g.add(ell(0.045, 0.04, 0.05, WHITE, -0.04, 0.045, 0.27));
  g.add(ell(0.14, 0.13, 0.085, WHITE, 0.2, 0.17, 0.14));
  const R = rng(21);
  for (let i = 0; i < 26; i++) {
    const dx = (R() - 0.5) * 0.17; const dy = (R() - 0.5) * 0.15;
    const z = 0.14 + 0.085 * Math.sqrt(Math.max(0, 1 - (dx / 0.14) ** 2 - (dy / 0.13) ** 2));
    g.add(ell(0.0075 + R() * 0.003, 0.0065 + R() * 0.003, 0.003, BLACK, 0.2 + dx, 0.17 + dy, z + 0.002, 8));
  }
  [[0.23, 0.17], [0.28, 0.07]].forEach(([x, z]) => {
    const l = ell(0.15, 0.05, 0.05, TAN, x + 0.08, 0.055, z); l.rotation.y = z > 0.1 ? 0.12 : -0.1; g.add(l);
    g.add(ell(0.055, 0.04, 0.05, WHITE, x + 0.22, 0.045, z + (z > 0.1 ? 0.02 : -0.01)));
  });
  g.add(ell(0.17, 0.13, 0.125, BLACK, 0.39, 0.14, 0.16));
  g.add(ell(0.105, 0.07, 0.08, TAN, 0.51, 0.1, 0.165));
  g.add(ell(0.05, 0.03, 0.035, WHITE, 0.545, 0.075, 0.165));
  g.add(ell(0.035, 0.028, 0.035, NOSE, 0.605, 0.12, 0.165));
  [-1, 1].forEach((s) => {
    g.add(ell(0.06, 0.055, 0.03, TAN, 0.42, 0.115, 0.165 + s * 0.108));
    g.add(ell(0.018, 0.012, 0.01, TAN, 0.47, 0.215, 0.165 + s * 0.065));
    const eye = torus(0.022, 0.004, NOSE, Math.PI, 20); eye.position.set(0.5, 0.175, 0.165 + s * 0.089); eye.rotation.set(0, s > 0 ? 0 : Math.PI, Math.PI); g.add(eye);
    const ear = ell(0.05, 0.125, 0.03, BLACK, 0.31, 0.29, 0.165 + s * 0.105); ear.rotation.set(-s * 0.35, 0, s * 0.2 - 0.15); g.add(ear);
  });
  const curve = new THREE.CatmullRomCurve3([[-0.33, 0.14, 0.02], [-0.37, 0.08, 0.17], [-0.3, 0.055, 0.28], [-0.16, 0.05, 0.3]].map((p) => new THREE.Vector3(...p)));
  g.add(M(new THREE.TubeGeometry(curve, 32, 0.03, 16, false), BLACK));
  g.add(ell(0.03, 0.028, 0.03, WHITE, -0.14, 0.05, 0.3));
  return g;
}

const nameplateTexture = (label) => canvasTexture(512, 160, (c, W, H) => {
  c.fillStyle = '#E8D9B8'; rrectPath(c, 4, 4, W - 8, H - 8, 26); c.fill();
  c.strokeStyle = '#8a5a2b'; c.lineWidth = 7; rrectPath(c, 12, 12, W - 24, H - 24, 20); c.stroke();
  c.fillStyle = '#3b2a1c'; c.beginPath(); c.ellipse(92, H / 2 + 16, 22, 17, 0, 0, 7); c.fill();
  [[-26, -16], [-9, -30], [9, -30], [26, -16]].forEach(([dx, dy]) => { c.beginPath(); c.ellipse(92 + dx, H / 2 + dy + 10, 7.5, 10, 0, 0, 7); c.fill(); });
  c.font = "800 78px 'Nunito', system-ui, sans-serif"; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, W / 2 + 56, H / 2 + 6);
});

function dogBed(S, props) {
  const { C, oak, lac, fab } = S; const name = String(props.name ?? 'GRATON').slice(0, 12).toUpperCase(); const g = new THREE.Group();
  const bedMat = new RoomMaterial({ color: C.bed, roughness: 0.95, bumpMap: weave(), bumpScale: 1.4 });
  g.add(at(cyl(0.6, 0.6, 0.05, fab('#E8D9B8'), 44), 0, 0.025, 0));
  const pillow = ball(1, fab(C.bedCushion), 32); pillow.scale.set(0.48, 0.07, 0.48); pillow.position.set(0, 0.08, 0); g.add(pillow);
  const rim = torus(0.53, 0.075, bedMat, Math.PI * 2, 44); rim.rotation.x = Math.PI / 2; rim.position.y = 0.085; g.add(rim);
  const dog = sleepingDog(); dog.position.set(-0.12, 0.1, -0.02); dog.rotation.y = 0.75; dog.scale.setScalar(0.72); g.add(dog);
  const plateAngle = 0.5; // where on the rim it sits, measured from the bed's front (+z) toward +x
  const plate = new THREE.Group(); plate.position.set(Math.sin(plateAngle) * 0.535, 0.162, Math.cos(plateAngle) * 0.535); plate.rotation.set(-0.95, plateAngle, 0, 'YXZ'); // leans back on the rim's top, like a placard
  plate.add(at(rbox(0.25, 0.085, 0.014, 0.006, oak(C.oakDark)), 0, 0, 0));
  const face = M(new THREE.PlaneGeometry(0.235, 0.0725), new RoomMaterial({ map: nameplateTexture(name), roughness: 0.55 }), { cast: false }); face.position.z = 0.0075; plate.add(face); g.add(plate);
  const bowl = new THREE.Group(); bowl.position.set(0.8, 0, 0.5); bowl.rotation.y = -2.56;
  const band = canvasTexture(1024, 256, (c, W, H) => {
    c.fillStyle = C.teal; c.fillRect(0, 0, W, H); c.fillStyle = '#E8D9B8'; c.fillRect(0, H * 0.3, W, H * 0.42);
    c.fillStyle = C.ink; c.font = "800 120px 'Nunito', system-ui, sans-serif"; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(name, W / 2, H * 0.52);
    [W / 2 - 280, W / 2 + 280].forEach((x) => { c.beginPath(); c.ellipse(x, H * 0.57, 20, 16, 0, 0, 7); c.fill(); [[-22, -20], [-8, -32], [8, -32], [22, -20]].forEach(([dx, dy]) => { c.beginPath(); c.ellipse(x + dx, H * 0.57 + dy + 8, 6, 8, 0, 0, 7); c.fill(); }); });
  });
  bowl.add(at(M(new THREE.CylinderGeometry(0.11, 0.085, 0.06, 36, 1, true), new RoomMaterial({ map: band, roughness: 0.5, side: THREE.DoubleSide })), 0, 0.03, 0));
  bowl.add(at(cyl(0.085, 0.085, 0.006, lac(C.teal), 36), 0, 0.003, 0));
  bowl.add(at(cyl(0.1, 0.1, 0.004, new RoomMaterial({ color: '#8fd0e0', roughness: 0.12 }), 36), 0, 0.045, 0)); g.add(bowl);
  g.add(at(ball(0.035, new RoomMaterial({ color: '#C9D94A', roughness: 0.9 }), 16), 0.7, 0.035, -0.5));
  const bone = capsule(0.014, 0.1, lac(C.cream)); bone.position.set(0.95, 0.025, -0.35); bone.rotation.set(0, 0.6, Math.PI / 2); g.add(bone);
  return g;
}

/** Pieces that must stay individually pickable: they are merged inside themselves, never into the rest of the room. */
export const INTERACTIVE = new Set(['dogBed', 'desk', 'pinboard', 'coffeeTable', 'gameTable']); // merged only within themselves, so a click can tell which piece was hit

/** Builders by piece type. The collection furniture (binders, boxes, display cabinet) is not here: the app draws those. */
export const BUILDERS = { desk, pinboard, wallShelf, drawerCart, sofa, coffeeTable, rug, pouf, floorCushions, floorLamp, plant, gameTable, frame, clock, slatPanel, slippers, basket, dogBed };

/** Build one layout piece, placed and turned as the layout says. Returns null for types the app draws itself. */
export function buildPiece(piece, style) {
  const build = BUILDERS[piece.type];
  if (!build) return null;
  const group = build(style, piece.props ?? {});
  group.position.set(piece.x, piece.y ?? 0, piece.z);
  group.rotation.y = piece.rot ?? 0;
  group.userData.pieceId = piece.id; group.userData.pieceType = piece.type;
  return group;
}
