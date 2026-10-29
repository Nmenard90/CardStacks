import * as THREE from 'three';
import { drawableArtUrl } from './room/artUrl.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

// Warm light-oak plank texture for the floor, used with MeshReflectorMaterial.
export function makeFloorTexture() {
  const size = 2048;
  const [c, ctx] = canvas(size, size);
  ctx.fillStyle = '#d8b07d';
  ctx.fillRect(0, 0, size, size);
  const plankH = 256;
  for (let y = 0; y < size; y += plankH) {
    const shade = 5 + Math.sin(y * 0.011) * 5;
    ctx.fillStyle = `rgba(${118 + shade},${78 + shade * 0.7},${42 + shade * 0.35},0.13)`;
    ctx.fillRect(0, y, size, plankH);
    ctx.strokeStyle = 'rgba(70,46,24,0.35)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
    for (let g = 0; g < 34; g++) {
      const wave = Math.sin(g * 2.17 + y * 0.003);
      ctx.strokeStyle = `rgba(75,45,22,${0.025 + (g % 5) * 0.009})`;
      ctx.lineWidth = 1 + (g % 3) * 0.45;
      ctx.beginPath();
      const gy = y + 10 + ((g * 37) % (plankH - 20));
      ctx.moveTo(0, gy);
      for (let x = 0; x <= size; x += 48) {
        ctx.lineTo(x, gy + Math.sin(x * 0.018 + wave * 4) * (3 + (g % 4)));
      }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,240,206,0.15)';
    ctx.lineWidth = 2;
    ctx.strokeRect(4, y + 4, size - 8, plankH - 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.8, 3.6);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeWallTexture(tone = 'back') {
  const size = 1024;
  const [c, ctx] = canvas(size, size);
  ctx.fillStyle = tone === 'left' ? '#eaf3fb' : '#fdf3e4';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 5200; i++) {
    const x = (i * 83) % size;
    const y = (i * 197) % size;
    const alpha = 0.018 + (i % 7) * 0.003;
    ctx.fillStyle = i % 3 === 0 ? `rgba(170,190,210,${alpha})` : `rgba(255,255,255,${alpha})`;
    ctx.fillRect(x, y, 1 + (i % 2), 1 + ((i + 1) % 2));
  }

  const glow = ctx.createRadialGradient(300, 180, 0, 300, 180, 700);
  glow.addColorStop(0, 'rgba(255,250,230,0.3)');
  glow.addColorStop(1, 'rgba(255,250,230,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.4, 1.2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Soft pastel radiating hexagon/petal inlay, laid as a decal above the floor.
export function makeFloorInlayTexture() {
  const [c, ctx] = canvas(1024, 1024);
  ctx.clearRect(0, 0, 1024, 1024);
  const cx = 512, cy = 512;
  const colors = ['#f4c768', '#7fd9c4', '#c9a6f2', '#f6a9a0', '#9fd98a'];
  const petals = 8;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const r = 430;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, -40);
    ctx.quadraticCurveTo(r * 0.5, -60, r, 0);
    ctx.quadraticCurveTo(r * 0.5, 60, 0, 40);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.globalAlpha = 0.16;
    ctx.fill();
    ctx.restore();
  }
  ctx.strokeStyle = 'rgba(230,180,90,0.55)';
  ctx.lineWidth = 5;
  for (let rr = 140; rr <= 460; rr += 160) {
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Soft blue daylight sky with distant stylized mountains, used on the window-wall backdrop.
export function makeSkyTexture() {
  const [c, ctx] = canvas(1024, 640);
  const grad = ctx.createLinearGradient(0, 0, 0, 640);
  grad.addColorStop(0, '#8fd4f0');
  grad.addColorStop(0.55, '#c9ecf5');
  grad.addColorStop(1, '#eaf7ee');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 640);

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (const [x, y, s] of [[160, 110, 70], [520, 150, 90], [820, 95, 60]]) {
    ctx.beginPath();
    ctx.ellipse(x, y, s, s * 0.45, 0, 0, Math.PI * 2);
    ctx.ellipse(x + s * 0.6, y + 8, s * 0.7, s * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function range(baseY, amp, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 640);
    let y = baseY;
    for (let x = 0; x <= 1024; x += 32) {
      y = baseY + Math.sin(x * 0.006 + baseY) * amp + Math.sin(x * 0.02) * amp * 0.25;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(1024, 640);
    ctx.closePath();
    ctx.fill();
  }
  range(430, 50, '#a9c7d6');
  range(480, 40, '#8fb6c9');
  range(540, 35, '#79c48f');

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Prismatic holographic foil texture for the floating pack-reveal card.
export function makeHoloCardTexture(cardOrSeed = 0) {
  const card = typeof cardOrSeed === 'object' ? cardOrSeed : null;
  const seed = card?.seed ?? cardOrSeed;
  const width = 768;
  const height = 1072;
  const [c, ctx] = canvas(width, height);
  const palettes = [
    ['#ff8cb8', '#ffd36b', '#74dcc0', '#71bfff'],
    ['#a98bff', '#68d9ff', '#ffb66e', '#ff7497'],
    ['#72e0c1', '#d9ff75', '#ffd36b', '#7f9dff'],
    ['#ff916e', '#ffd778', '#8ce0ff', '#bb8fff'],
    ['#67cfff', '#75dfc6', '#d5a0ff', '#ff9eb4'],
  ];
  const colors = palettes[((seed % palettes.length) + palettes.length) % palettes.length];
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, colors[0]);
  grad.addColorStop(0.34, colors[1]);
  grad.addColorStop(0.67, colors[2]);
  grad.addColorStop(1, colors[3]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = 'rgba(255,249,232,0.92)';
  ctx.beginPath();
  ctx.roundRect(30, 30, width - 60, height - 60, 34);
  ctx.fill();

  const art = ctx.createRadialGradient(width * 0.48, 360, 20, width * 0.48, 360, 380);
  art.addColorStop(0, colors[(seed + 2) % colors.length]);
  art.addColorStop(1, colors[seed % colors.length]);
  ctx.fillStyle = art;
  ctx.beginPath();
  ctx.roundRect(70, 150, width - 140, 540, 26);
  ctx.fill();

  ctx.fillStyle = 'rgba(24,31,43,0.9)';
  ctx.font = '700 50px system-ui, sans-serif';
  ctx.fillText(card?.name ?? ['Nova Lynx', 'Emberwing', 'Tide Warden', 'Moss Titan', 'Prism Fox'][seed % 5], 72, 112);
  ctx.font = '700 30px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${110 + seed * 10} HP`, width - 72, 110);
  ctx.textAlign = 'left';

  ctx.save();
  ctx.translate(width / 2, 410);
  ctx.rotate(seed * 0.24 - 0.35);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.moveTo(-125, 55);
  ctx.quadraticCurveTo(-45, -150, 15, -90);
  ctx.quadraticCurveTo(120, -130, 142, -5);
  ctx.quadraticCurveTo(165, 115, 30, 155);
  ctx.quadraticCurveTo(-100, 175, -125, 55);
  ctx.fill();
  ctx.fillStyle = colors[(seed + 1) % colors.length];
  ctx.beginPath();
  ctx.arc(18, 0, 54, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = 'rgba(31,37,46,0.88)';
  ctx.font = '700 36px system-ui, sans-serif';
  ctx.fillText(card?.rarity ?? ['Starlight Rush', 'Cinder Spiral', 'Current Shield', 'Ancient Bloom', 'Spectrum Dash'][seed % 5], 78, 770);
  ctx.font = '25px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(31,37,46,0.68)';
  ctx.fillText(card ? `${card.setName} · ${card.number}` : 'A collector-grade companion with a radiant finish.', 78, 820);
  ctx.fillText(`CARDSTACKS · ${(card?.edition ?? 'FIRST EDITION').toUpperCase()}`, 78, 954);

  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.translate(88 + i * 46, 882);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(-12, -12, 24, 24);
    ctx.restore();
  }

  ctx.save();
  ctx.translate(width / 2, height / 2);
  const spokes = 18;
  for (let i = 0; i < spokes; i++) {
    ctx.rotate((Math.PI * 2) / spokes);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(120, -18, 360, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 4;
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.roundRect(26, 26, width - 52, height - 52, 38);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (card?.imageUrl) {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);
      tex.needsUpdate = true;
    };
    image.src = drawableArtUrl(card.imageUrl) ?? '';
  }
  return tex;
}
