import { Terrain } from '../config.js';
import { createRng } from '../rng.js';

// Cosmetic terrain relief derived from the tile map. Pure data (no three.js)
// so it can be tested headlessly. Water level is y = 0; one tile = 1 unit.

export const RES = 3; // vertices per tile edge
export const WATER_LEVEL = 0;

function tileBaseHeight(map, i) {
  const t = map.tiles[i];
  const e = map.elev[i];
  switch (t) {
    case Terrain.DEEP: return -1.8;
    case Terrain.WATER: return -0.7;
    case Terrain.SAND: return 0.18;
    case Terrain.ROCK: return 2.6 + Math.max(0, e - 0.86) * 14;
    default: return 0.35 + Math.min(1.3, Math.max(0, e - 0.46) * 3.2);
  }
}

// Tileable-free value noise for small surface detail.
function makeDetail(seed, size) {
  const rng = createRng(seed);
  const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i++) g[i] = rng.next() * 2 - 1;
  const at = (x, y) => g[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  return (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

export class HeightField {
  constructor(map, seed = 1) {
    this.map = map;
    this.vw = map.w * RES + 1;
    this.vh = map.h * RES + 1;
    this.heights = new Float32Array(this.vw * this.vh);
    this.build(seed);
  }

  build(seed) {
    const { map, vw, vh } = this;
    const base = new Float32Array(map.w * map.h);
    for (let i = 0; i < base.length; i++) base[i] = tileBaseHeight(map, i);
    const tileH = (x, y) => base[Math.min(map.h - 1, Math.max(0, y)) * map.w + Math.min(map.w - 1, Math.max(0, x))];
    const tileT = (x, y) => map.tiles[Math.min(map.h - 1, Math.max(0, y)) * map.w + Math.min(map.w - 1, Math.max(0, x))];
    const detail = makeDetail(seed, 97);
    const raw = new Float32Array(vw * vh);
    for (let j = 0; j < vh; j++) {
      for (let i = 0; i < vw; i++) {
        // Bilinear between tile centres.
        const fx = i / RES - 0.5, fy = j / RES - 0.5;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0;
        const top = tileH(x0, y0) * (1 - tx) + tileH(x0 + 1, y0) * tx;
        const bot = tileH(x0, y0 + 1) * (1 - tx) + tileH(x0 + 1, y0 + 1) * tx;
        let h = top * (1 - ty) + bot * ty;
        const t = tileT(Math.floor(i / RES), Math.floor(j / RES));
        const d = detail(i * 0.35, j * 0.35) * 0.5 + detail(i * 0.9, j * 0.9) * 0.25;
        h += t === Terrain.ROCK ? d * 1.2 + Math.abs(detail(i * 1.7, j * 1.7)) * 0.8 : d * 0.08;
        raw[j * vw + i] = h;
      }
    }
    // One smoothing pass to soften tile edges, keeping peaks a bit sharper.
    for (let j = 0; j < vh; j++) {
      for (let i = 0; i < vw; i++) {
        let sum = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const x = i + dx, y = j + dy;
            if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
            sum += raw[y * vw + x]; n++;
          }
        }
        this.heights[j * vw + i] = raw[j * vw + i] * 0.4 + (sum / n) * 0.6;
      }
    }
  }

  // Height at world position (x = tile x, z = tile y), bilinear.
  heightAt(x, z) {
    const { vw, vh, heights } = this;
    const fx = Math.min(vw - 1.001, Math.max(0, x * RES));
    const fz = Math.min(vh - 1.001, Math.max(0, z * RES));
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const a = heights[j * vw + i], b = heights[j * vw + i + 1];
    const c = heights[(j + 1) * vw + i], d = heights[(j + 1) * vw + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  // Height for a ground unit: never below the waterline.
  groundAt(x, z) { return Math.max(WATER_LEVEL + 0.04, this.heightAt(x, z)); }

  // Highest point under a footprint, used to seat structures.
  maxOver(tx, ty, w, h) {
    let m = -Infinity;
    for (let y = ty; y <= ty + h; y += 0.5) for (let x = tx; x <= tx + w; x += 0.5) m = Math.max(m, this.heightAt(x, y));
    return m;
  }
}
