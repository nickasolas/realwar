import * as THREE from 'three';
import { DECK_LEVEL } from './heightfield.js';

// Bridge decks over every bridge tile: a tarmac deck that ramps down onto
// the banks, concrete fascia and parapets along open water, and piers at
// the edges so the channel down the middle stays clear for shipping.
// Bridges laid along a diagonal would have stair-stepped sides, so the
// steps are filled with triangular infill to give straight edges.

const SKIRT = 0.2; // deck slab thickness
const RAIL_H = 0.12, RAIL_W = 0.07;
const DECK = [0.82, 0.82, 0.8], CONCRETE = [1.55, 1.5, 1.42];
const SIDES = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// The two corners of a tile side.
function sideCorners(tx, ty, dx, dy) {
  if (dx === 1) return [[tx + 1, ty], [tx + 1, ty + 1]];
  if (dx === -1) return [[tx, ty], [tx, ty + 1]];
  if (dy === 1) return [[tx, ty + 1], [tx + 1, ty + 1]];
  return [[tx, ty], [tx + 1, ty]];
}

export function buildBridges(map, hf, material) {
  const pos = [], uv = [], col = [];
  const cw = map.w + 1;
  const H = (c) => hf.deck[c[1] * cw + c[0]];
  const isBridge = (x, y) => map.inBounds(x, y) && map.bridge[y * map.w + x] === 1;
  const openWater = (x, y) => map.inBounds(x, y) && !isBridge(x, y) && !map.isLand(x, y);

  const tri = (a, b, c, rgb) => {
    for (const p of [a, b, c]) {
      pos.push(p[0], p[1], p[2]);
      uv.push(p[0] * 0.5 + p[1] * 0.5, p[2] * 0.5);
      col.push(rgb[0], rgb[1], rgb[2]);
    }
  };
  const quad = (a, b, c, d, rgb) => { tri(a, b, c, rgb); tri(a, c, d, rgb); };
  // Upward-facing deck triangle from tile corners.
  const deckTri = (a, b, c) => {
    const A = [a[0], H(a), a[1]], B = [b[0], H(b), b[1]], C = [c[0], H(c), c[1]];
    const cross = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
    if (cross > 0) tri(A, B, C, DECK); else tri(A, C, B, DECK);
  };
  // Vertical strip along p→q from the top heights down by `drop`; faces to
  // the right of the direction of travel.
  const strip = (p, q, hp, hq, drop) => {
    quad([p[0], hp - drop, p[1]], [q[0], hq - drop, q[1]], [q[0], hq, q[1]], [p[0], hp, p[1]], CONCRETE);
  };

  // Notches: open water with bridge on two adjacent sides gets filled.
  const notch = new Map(); // tile index -> [side a, side b]
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      if (!openWater(tx, ty)) continue;
      const b = SIDES.map(([dx, dy]) => isBridge(tx + dx, ty + dy));
      const w = SIDES.map(([dx, dy]) => openWater(tx + dx, ty + dy));
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) % 4;
        if (b[k] && b[k2] && w[(k + 2) % 4] && w[(k + 3) % 4]) notch.set(ty * map.w + tx, [SIDES[k], SIDES[k2]]);
      }
    }
  }
  const notchCovers = (x, y, dx, dy) => {
    const n = notch.get(y * map.w + x);
    return !!n && n.some((s) => s[0] === -dx && s[1] === -dy);
  };

  const piers = new Set();
  // An outward-facing edge between corners a and b: fascia, parapet, piers.
  const edge = (a, b, nx, nz) => {
    // Order so the strip faces outward (to the right of travel).
    let p = a, q = b;
    if ((q[0] - p[0]) * nz - (q[1] - p[1]) * nx < 0) [p, q] = [q, p];
    const hp = H(p), hq = H(q);
    strip(p, q, hp, hq, SKIRT);
    const len = Math.hypot(nx, nz), ix = -nx / len * RAIL_W, iz = -nz / len * RAIL_W;
    const pi = [p[0] + ix, p[1] + iz], qi = [q[0] + ix, q[1] + iz];
    strip(p, q, hp + RAIL_H, hq + RAIL_H, RAIL_H);
    strip(qi, pi, hq + RAIL_H, hp + RAIL_H, RAIL_H);
    quad([p[0], hp + RAIL_H, p[1]], [q[0], hq + RAIL_H, q[1]], [qi[0], hq + RAIL_H, qi[1]], [pi[0], hp + RAIL_H, pi[1]], CONCRETE);
    for (const c of [p, q]) if (H(c) >= DECK_LEVEL - 0.01 && (c[0] + c[1]) % 2 === 0) piers.add(c[1] * cw + c[0]);
  };

  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      if (isBridge(tx, ty)) {
        deckTri([tx, ty], [tx + 1, ty], [tx + 1, ty + 1]);
        deckTri([tx, ty], [tx + 1, ty + 1], [tx, ty + 1]);
        for (const [dx, dy] of SIDES) {
          const nx = tx + dx, ny = ty + dy;
          if (!openWater(nx, ny) || notchCovers(nx, ny, dx, dy)) continue;
          const [a, b] = sideCorners(tx, ty, dx, dy);
          edge(a, b, dx, dy);
        }
      }
      const n = notch.get(ty * map.w + tx);
      if (n) {
        // Triangle between the two bridged sides; its long edge faces the water.
        const [s1, s2] = n;
        const c1 = sideCorners(tx, ty, ...s1), c2 = sideCorners(tx, ty, ...s2);
        const shared = c1.find((c) => c2.some((d) => d[0] === c[0] && d[1] === c[1]));
        const o1 = c1.find((c) => c !== shared), o2 = c2.find((c) => c[0] !== shared[0] || c[1] !== shared[1]);
        deckTri(shared, o1, o2);
        edge(o1, o2, -(s1[0] + s2[0]), -(s1[1] + s2[1]));
      }
    }
  }

  // Square concrete piers from the seabed up to the underside of the deck.
  const P = 0.11;
  for (const k of piers) {
    const x = k % cw, z = (k - x) / cw;
    const top = DECK_LEVEL - SKIRT, bot = -1.4;
    const c = [[x - P, z - P], [x + P, z - P], [x + P, z + P], [x - P, z + P]];
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4];
      quad([b[0], bot, b[1]], [a[0], bot, a[1]], [a[0], top, a[1]], [b[0], top, b[1]], CONCRETE);
    }
  }

  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
