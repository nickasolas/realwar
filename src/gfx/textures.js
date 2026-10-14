import * as THREE from 'three';
import { createRng } from '../rng.js';

// Procedurally painted, seamlessly tiling ground textures. Everything is
// generated at load time; there are no image assets.

const SIZE = 512;

// Periodic value noise: lattice of `cells` per side wraps exactly at SIZE.
function periodicNoise(rng, cells) {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rng.next();
  return (u, v) => {
    const x = u * cells, y = v * cells;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const tx = x - x0, ty = y - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const at = (a, b) => g[(((b % cells) + cells) % cells) * cells + (((a % cells) + cells) % cells)];
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

function fbm(layers, u, v) {
  let s = 0, amp = 1, norm = 0;
  for (const n of layers) { s += n(u, v) * amp; norm += amp; amp *= 0.55; }
  return s / norm;
}

function canvas() {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  return c;
}

// Fill every pixel from a colour function of (u, v) in [0, 1).
function paint(ctx, fn) {
  const img = ctx.createImageData(SIZE, SIZE);
  const d = img.data;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b] = fn(x / SIZE, y / SIZE);
      const i = (y * SIZE + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Draw a shape at (x, y) and at its wrapped copies so the texture tiles.
function wrapped(ctx, x, y, r, draw) {
  for (const ox of [-SIZE, 0, SIZE]) {
    for (const oy of [-SIZE, 0, SIZE]) {
      const px = x + ox, py = y + oy;
      if (px < -r || py < -r || px > SIZE + r || py > SIZE + r) continue;
      draw(px, py);
    }
  }
}

const mix = (a, b, t) => a + (b - a) * t;
const clamp = (v) => Math.max(0, Math.min(255, v));

function grass(seed) {
  const rng = createRng(seed);
  const c = canvas();
  const ctx = c.getContext('2d');
  const macro = [periodicNoise(rng, 4), periodicNoise(rng, 8), periodicNoise(rng, 16)];
  const fine = [periodicNoise(rng, 64), periodicNoise(rng, 128)];
  paint(ctx, (u, v) => {
    const m = fbm(macro, u, v), f = fbm(fine, u, v);
    // Olive-green meadow: darker lush clumps and drier, yellower patches.
    const dry = Math.max(0, (m - 0.5) * 2.4), lush = Math.max(0, (0.45 - m) * 2.4);
    const r = mix(108, 150, dry) - lush * 34 + (f - 0.5) * 46;
    const g = mix(132, 148, dry) - lush * 26 + (f - 0.5) * 50;
    const b = mix(54, 66, dry) - lush * 14 + (f - 0.5) * 24;
    return [clamp(r), clamp(g), clamp(b)];
  });
  // Blades and clover: thousands of short strokes in varied greens.
  for (let i = 0; i < 26000; i++) {
    const x = rng.next() * SIZE, y = rng.next() * SIZE;
    const len = 2 + rng.next() * 5, ang = -Math.PI / 2 + (rng.next() - 0.5) * 1.2;
    const light = rng.next();
    ctx.strokeStyle = light > 0.55
      ? `rgba(${170 + rng.int(0, 40)},${185 + rng.int(0, 35)},${80 + rng.int(0, 30)},0.55)`
      : `rgba(${40 + rng.int(0, 25)},${70 + rng.int(0, 30)},${25 + rng.int(0, 15)},0.5)`;
    ctx.lineWidth = 1;
    wrapped(ctx, x, y, 8, (px, py) => {
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len); ctx.stroke();
    });
  }
  // A few small flowers and bare specks.
  for (let i = 0; i < 500; i++) {
    const x = rng.next() * SIZE, y = rng.next() * SIZE;
    ctx.fillStyle = rng.next() < 0.5 ? 'rgba(230,220,120,0.6)' : 'rgba(120,96,64,0.5)';
    wrapped(ctx, x, y, 2, (px, py) => ctx.fillRect(px, py, 1.5, 1.5));
  }
  return c;
}

function dirt(seed) {
  const rng = createRng(seed);
  const c = canvas();
  const ctx = c.getContext('2d');
  const macro = [periodicNoise(rng, 4), periodicNoise(rng, 8), periodicNoise(rng, 16)];
  const fine = [periodicNoise(rng, 64), periodicNoise(rng, 128), periodicNoise(rng, 256)];
  paint(ctx, (u, v) => {
    const m = fbm(macro, u, v), f = fbm(fine, u, v);
    // Reddish-brown earth, darker where damp.
    const r = mix(112, 156, m) + (f - 0.5) * 50;
    const g = mix(80, 112, m) + (f - 0.5) * 40;
    const b = mix(54, 74, m) + (f - 0.5) * 30;
    return [clamp(r), clamp(g), clamp(b)];
  });
  // Pebbles with a lit top and a shadow.
  for (let i = 0; i < 2600; i++) {
    const x = rng.next() * SIZE, y = rng.next() * SIZE, r = 0.8 + rng.next() * 2.4;
    const t = rng.int(110, 190);
    wrapped(ctx, x, y, 4, (px, py) => {
      ctx.fillStyle = 'rgba(40,28,18,0.45)';
      ctx.beginPath(); ctx.arc(px + 0.8, py + 0.8, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgb(${t},${t - 18},${t - 34})`;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
    });
  }
  // Tyre ruts and cracks.
  ctx.lineWidth = 1;
  for (let i = 0; i < 160; i++) {
    let x = rng.next() * SIZE, y = rng.next() * SIZE;
    ctx.strokeStyle = 'rgba(60,40,26,0.35)';
    for (let k = 0; k < 6; k++) {
      const nx = x + (rng.next() - 0.5) * 18, ny = y + (rng.next() - 0.5) * 18;
      wrapped(ctx, x, y, 20, (px, py) => { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + nx - x, py + ny - y); ctx.stroke(); });
      x = nx; y = ny;
    }
  }
  return c;
}

function rock(seed) {
  const rng = createRng(seed);
  const c = canvas();
  const ctx = c.getContext('2d');
  const macro = [periodicNoise(rng, 4), periodicNoise(rng, 8)];
  const strata = periodicNoise(rng, 32);
  const fine = [periodicNoise(rng, 64), periodicNoise(rng, 128), periodicNoise(rng, 256)];
  paint(ctx, (u, v) => {
    const m = fbm(macro, u, v), f = fbm(fine, u, v);
    // Layered sedimentary rock with lichen-tinted patches.
    const band = Math.sin((v + strata(u, v) * 0.15) * Math.PI * 2 * 9) * 0.5 + 0.5;
    const base = mix(104, 150, m) + band * 18 + (f - 0.5) * 60;
    const lichen = Math.max(0, (m - 0.62) * 3);
    return [clamp(base - lichen * 14), clamp(base - 6 + lichen * 6), clamp(base - 16 - lichen * 20)];
  });
  return c;
}

function sand(seed) {
  const rng = createRng(seed);
  const c = canvas();
  const ctx = c.getContext('2d');
  const macro = [periodicNoise(rng, 4), periodicNoise(rng, 8)];
  const ripple = periodicNoise(rng, 16);
  const fine = [periodicNoise(rng, 128), periodicNoise(rng, 256)];
  paint(ctx, (u, v) => {
    const m = fbm(macro, u, v), f = fbm(fine, u, v);
    const rp = Math.sin((u * 0.4 + v + ripple(u, v) * 0.12) * Math.PI * 2 * 24) * 0.5 + 0.5;
    const base = mix(190, 220, m) + rp * 12 + (f - 0.5) * 36;
    return [clamp(base), clamp(base - 14), clamp(base - 50)];
  });
  return c;
}

function asphalt(seed) {
  const rng = createRng(seed);
  const c = canvas();
  const ctx = c.getContext('2d');
  const macro = [periodicNoise(rng, 4), periodicNoise(rng, 8)];
  const fine = [periodicNoise(rng, 128), periodicNoise(rng, 256)];
  paint(ctx, (u, v) => {
    const m = fbm(macro, u, v), f = fbm(fine, u, v);
    // Worn grey tarmac with lighter aggregate.
    const base = mix(78, 104, m) + (f - 0.5) * 34;
    return [clamp(base + 2), clamp(base + 1), clamp(base - 2)];
  });
  for (let i = 0; i < 9000; i++) {
    const x = rng.next() * SIZE, y = rng.next() * SIZE, t = rng.int(90, 150);
    ctx.fillStyle = `rgba(${t},${t},${t - 6},0.55)`;
    wrapped(ctx, x, y, 2, (px, py) => ctx.fillRect(px, py, 1.3, 1.3));
  }
  // Patched cracks.
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 40; i++) {
    let x = rng.next() * SIZE, y = rng.next() * SIZE;
    ctx.strokeStyle = 'rgba(25,25,24,0.55)';
    for (let k = 0; k < 8; k++) {
      const nx = x + (rng.next() - 0.5) * 22, ny = y + (rng.next() - 0.5) * 22;
      wrapped(ctx, x, y, 24, (px, py) => { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + nx - x, py + ny - y); ctx.stroke(); });
      x = nx; y = ny;
    }
  }
  return c;
}

export function buildRoadTexture(seed, renderer) {
  return toTexture(asphalt(seed + 9), renderer);
}

function toTexture(c, renderer) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export function buildGroundTextures(seed, renderer) {
  return {
    grass: toTexture(grass(seed + 1), renderer),
    dirt: toTexture(dirt(seed + 2), renderer),
    rock: toTexture(rock(seed + 3), renderer),
    sand: toTexture(sand(seed + 4), renderer),
  };
}
