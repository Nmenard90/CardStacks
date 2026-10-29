/**
 * shell.js — the room itself: floor, two walls with wainscot and trim, the window with its garden view, and the curtains.
 *
 * Architecture is fixed (the window is part of the room, not a movable piece; layout.js keeps pieces clear of it), but every
 * colour comes from the theme. The room is a cutaway: two walls and a floor slab, open to the camera.
 */
import { THREE, M, at, rbox, cyl, ball, glass, canvasTexture, rng, rrShape } from './kit.js';
import { ROOM } from './layout.js';

/** Wood-plank floor drawn in neutral wood tones; the theme's floor colour tints it. */
let FLOOR;
function floorTexture() {
  return FLOOR ??= canvasTexture(2048, 1536, (c, W, H) => {
    const rows = 27; const rh = H / rows; const R = rng(12);
    for (let i = 0; i < rows; i++) {
      let x = -R() * 600;
      while (x < W) {
        const len = 520 + R() * 700; const t = 0.94 + R() * 0.1; c.fillStyle = `rgb(${178 * t},${144 * t},${104 * t})`; c.fillRect(x, i * rh, len, rh);
        for (let k = 0; k < 5; k++) { c.strokeStyle = `rgba(120,70,20,${0.05 + R() * 0.07})`; c.lineWidth = 1 + R() * 1.5; const gy = i * rh + R() * rh; c.beginPath(); c.moveTo(x, gy); for (let gx = 0; gx <= len; gx += 40) c.lineTo(x + gx, gy + Math.sin(gx * 0.02 + k) * 2); c.stroke(); }
        c.fillStyle = 'rgba(90,50,15,0.45)'; c.fillRect(x, i * rh, 2.5, rh); x += len;
      }
      c.fillStyle = 'rgba(90,50,15,0.38)'; c.fillRect(0, i * rh, W, 2.5);
    }
  });
}

/** A wall: painted upper, an oak chair rail and cream wainscot panels. `len` metres wide, `h` high. */
function wallTexture(C, len, h) {
  const W = 2048; const H = Math.round((2048 * h) / len); const ppm = W / len;
  const t = canvasTexture(W, H, (c) => {
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, C.wall); g.addColorStop(1, C.wallLow); c.fillStyle = g; c.fillRect(0, 0, W, H);
    const R = rng(9); for (let i = 0; i < 4000; i++) { c.fillStyle = R() > 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.04)'; c.fillRect(R() * W, R() * H, 2, 2); }
    const wh = 1.05 * ppm; const y0 = H - wh;
    c.fillStyle = C.wainscot; c.fillRect(0, y0, W, wh);
    const pw = 0.78 * ppm; const gap = 0.14 * ppm;
    for (let x = gap / 2; x < W; x += pw + gap) { const py = y0 + 0.22 * ppm; const ph = wh - 0.34 * ppm; c.fillStyle = C.wainscotPanel; c.fillRect(x, py, pw, ph); c.strokeStyle = 'rgba(110,80,40,0.38)'; c.lineWidth = 3; c.strokeRect(x, py, pw, ph); c.fillStyle = 'rgba(255,255,255,0.4)'; c.fillRect(x + 3, py + 3, pw - 6, 3); }
    c.fillStyle = C.rail; c.fillRect(0, y0 - 0.05 * ppm, W, 0.07 * ppm); c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(0, y0 + 0.02 * ppm, W, 5);
  });
  t.repeat.set(1 / len, 1 / h); t.offset.set(0.5, 0.5);
  return t;
}

function gardenTexture(night) {
  return canvasTexture(1024, 512, (c, W, H) => {
    const g = c.createLinearGradient(0, 0, 0, H * 0.7);
    if (night) { g.addColorStop(0, '#0d2c40'); g.addColorStop(1, '#245b6b'); } else { g.addColorStop(0, '#7CC4D8'); g.addColorStop(1, '#F3E9CE'); }
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    if (night) { const R = rng(3); c.fillStyle = '#fff4cc'; for (let i = 0; i < 60; i++) c.fillRect(R() * W, R() * H * 0.4, 3, 3); c.beginPath(); c.arc(820, 90, 34, 0, 7); c.fill(); c.fillStyle = '#0f3347'; c.beginPath(); c.arc(836, 84, 32, 0, 7); c.fill(); }
    else { c.fillStyle = '#FFE08A'; c.beginPath(); c.arc(840, 100, 46, 0, 7); c.fill(); c.fillStyle = 'rgba(255,255,255,0.9)'; [[200, 110], [520, 80]].forEach(([x, y]) => { c.beginPath(); c.arc(x, y, 28, 0, 7); c.arc(x + 34, y - 10, 36, 0, 7); c.arc(x + 70, y, 26, 0, 7); c.fill(); }); }
    [[0.62, night ? '#2b7a6c' : '#5FAE86', 0.07], [0.74, night ? '#1f6a5c' : '#3F9272', 0.05]].forEach(([yy, col, amp], i) => { c.fillStyle = col; c.beginPath(); c.moveTo(0, H); for (let x = 0; x <= W; x += 16) c.lineTo(x, H * yy + Math.sin(x * 0.009 + i * 2) * H * amp); c.lineTo(W, H); c.fill(); });
    [[130, 0.7], [330, 0.82], [700, 0.78], [930, 0.7]].forEach(([x, s]) => { c.fillStyle = night ? '#16503f' : '#2F7E58'; c.beginPath(); c.arc(x, H * 0.68, 46 * s, 0, 7); c.fill(); c.fillStyle = night ? '#1b2b2b' : '#7a5a38'; c.fillRect(x - 5, H * 0.68, 10, 60 * s); });
    c.fillStyle = night ? '#1d5a49' : '#4a9a6e'; c.fillRect(0, H * 0.9, W, H * 0.1);
  });
}

function wallMesh(w, h, d, hole, map) {
  const s = rrShape(w, h, 0.02);
  if (hole) { const [hx, hy, hw, hh] = hole; const p = new THREE.Path(); p.moveTo(hx - hw / 2, hy - hh / 2); p.lineTo(hx + hw / 2, hy - hh / 2); p.lineTo(hx + hw / 2, hy + hh / 2); p.lineTo(hx - hw / 2, hy + hh / 2); p.closePath(); s.holes.push(p); }
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }); g.translate(0, 0, -d / 2);
  return M(g, new THREE.MeshStandardMaterial({ map, roughness: 0.9 }));
}

export function buildShell(S) {
  const { C, oak, lac, night } = S;
  const g = new THREE.Group(); const { h } = ROOM;
  const slab = rbox(9.4, 0.3, 7.4, 0.06, new THREE.MeshStandardMaterial({ color: '#8E7250', roughness: 0.55 })); slab.position.set(0, -0.15, 0); g.add(slab);
  const floor = M(new THREE.PlaneGeometry(ROOM.w, ROOM.d), new THREE.MeshStandardMaterial({ map: floorTexture(), color: C.floor, roughness: 0.5 }), { cast: false }); floor.rotation.x = -Math.PI / 2; floor.position.y = 0.003; g.add(floor);
  const back = wallMesh(ROOM.w, h, 0.2, null, wallTexture(C, ROOM.w, h)); back.position.set(0, h / 2, ROOM.z0 - 0.1); g.add(back);
  const left = wallMesh(ROOM.d, h, 0.2, [-0.1, 0.15, 1.5, 1.6], wallTexture(C, ROOM.d, h)); left.rotation.y = Math.PI / 2; left.position.set(ROOM.x0 - 0.1, h / 2, 0); g.add(left);

  const view = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.2), new THREE.MeshBasicMaterial({ map: gardenTexture(night), toneMapped: false })); view.rotation.y = Math.PI / 2; view.position.set(-4.95, 2.05, 0.1); g.add(view);

  // baseboards and crown moulding
  const trim = oak(C.trim);
  g.add(at(rbox(9, 0.14, 0.04, 0.012, trim), 0, 0.07, ROOM.z0 + 0.02)); g.add(at(rbox(0.04, 0.14, 7, 0.012, trim), ROOM.x0 + 0.02, 0.07, 0));
  g.add(at(rbox(9, 0.13, 0.1, 0.02, trim), 0, h - 0.065, ROOM.z0 + 0.05)); g.add(at(rbox(0.1, 0.13, 7, 0.02, trim), ROOM.x0 + 0.05, h - 0.065, 0));

  // window: trim, sill, glazing bars and glass
  const win = new THREE.Group(); win.position.set(-4.47, 2.05, 0.1); win.rotation.y = Math.PI / 2;
  win.add(at(rbox(1.66, 0.08, 0.1, 0.02, trim), 0, 0.84, 0)); win.add(at(rbox(1.66, 0.08, 0.1, 0.02, trim), 0, -0.84, 0));
  [-1, 1].forEach((s) => win.add(at(rbox(0.08, 1.7, 0.1, 0.02, trim), s * 0.79, 0, 0)));
  win.add(at(rbox(0.04, 1.6, 0.06, 0.012, trim), 0, 0, 0)); win.add(at(rbox(1.5, 0.04, 0.06, 0.012, trim), 0, 0, 0));
  win.add(at(rbox(1.9, 0.06, 0.24, 0.02, trim), 0, -0.9, 0.1));
  const pane = M(new THREE.PlaneGeometry(1.5, 1.6), glass('#e9fffb', 0.07), { cast: false }); pane.position.z = 0.02; win.add(pane); g.add(win);

  // curtains on a rod
  const rod = cyl(0.018, 0.018, 3.0, oak(C.oakDark), 12); rod.rotation.x = Math.PI / 2; rod.position.set(-4.36, 3.22, 0.1); g.add(rod);
  [-1.5, 1.5].forEach((s) => g.add(at(ball(0.04, oak(C.oakDark), 12), -4.36, 3.22, 0.1 + s)));
  [-1, 1].forEach((s) => {
    const geo = new THREE.PlaneGeometry(0.62, 2.8, 36, 1); const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) / 0.62) * Math.PI * 6) * 0.035);
    geo.computeVertexNormals();
    const cur = M(geo, new THREE.MeshStandardMaterial({ color: C.curtain, roughness: 0.95, side: THREE.DoubleSide })); cur.rotation.y = Math.PI / 2; cur.position.set(-4.36, 1.78, 0.1 + s * 1.02); g.add(cur);
  });

  // a small cactus on the window sill
  const cp = new THREE.Group(); cp.position.set(-4.3, 1.17, -0.45);
  cp.add(at(cyl(0.05, 0.04, 0.07, lac(C.coral), 16), 0, 0.035, 0)); cp.add(at(cyl(0.028, 0.03, 0.16, lac(C.green), 14), 0, 0.15, 0)); cp.add(at(ball(0.028, lac(C.green), 12), 0, 0.23, 0));
  const arm = cyl(0.014, 0.014, 0.07, lac(C.green), 10); arm.position.set(0.04, 0.17, 0); arm.rotation.z = -0.9; cp.add(arm); g.add(cp);
  return g;
}
