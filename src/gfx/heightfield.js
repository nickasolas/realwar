import { Terrain } from '../config.js';
import { createRng } from '../rng.js';

// Cosmetic terrain relief derived from the tile map. Pure data (no three.js)
// so it can be tested headlessly. Water level is y = 0; one tile = 1 unit.

export const RES = 3; // vertices per tile edge
export const WATER_LEVEL = 0;
// Nudges the drawn shore seaward so rounding never eats into sailable water.
const SHORE_BIAS = 0.1;
export const DECK_LEVEL = 0.62; // bridge deck height over open water

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
    this.buildDecks();
  }

  // Bridge decks: one height per tile corner. Corners over water sit at deck
  // level; corners touching land ramp down to meet the bank.
  buildDecks() {
    const { map } = this;
    const cw = map.w + 1;
    this.deck = new Float32Array(cw * (map.h + 1));
    for (let y = 0; y <= map.h; y++) {
      for (let x = 0; x <= map.w; x++) {
        let land = -Infinity, bridged = false;
        for (const [tx, ty] of [[x - 1, y - 1], [x, y - 1], [x - 1, y], [x, y]]) {
          if (!map.inBounds(tx, ty)) continue;
          if (map.bridge[ty * map.w + tx]) bridged = true;
          else if (map.isLand(tx, ty)) land = Math.max(land, this.heightAt(tx + 0.5, ty + 0.5));
        }
        if (bridged) this.deck[y * cw + x] = land > -Infinity ? Math.max(WATER_LEVEL + 0.08, Math.min(DECK_LEVEL, land + 0.06)) : DECK_LEVEL;
      }
    }
  }

  // Deck height at a world position, or null when not on a bridge.
  deckAt(x, z) {
    const { map } = this;
    const tx = Math.floor(x), ty = Math.floor(z);
    if (!map.inBounds(tx, ty) || !map.bridge[ty * map.w + tx]) return null;
    const cw = map.w + 1, d = this.deck;
    const fx = x - tx, fz = z - ty;
    const a = d[ty * cw + tx], b = d[ty * cw + tx + 1], c = d[(ty + 1) * cw + tx], e = d[(ty + 1) * cw + tx + 1];
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + e * fx) * fz;
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
    this.fitShoreline();
  }

  // Smoothing drags coastal land under the waterline (and shallows above
  // it), so the visible shore would not match where ships can sail. Pin the
  // shoreline to the tile boundary: land rises and water sinks with
  // distance from the coast.
  fitShoreline() {
    const { map, vw, vh, heights } = this;
    const wet = (x, y) => map.isWater(Math.min(map.w - 1, Math.max(0, x)), Math.min(map.h - 1, Math.max(0, y)));
    // Signed distance to the coast: positive on land, negative over water,
    // zero on the tile edges between them.
    const sd = new Float32Array(vw * vh);
    for (let j = 0; j < vh; j++) {
      for (let i = 0; i < vw; i++) {
        const x = i / RES, z = j / RES;
        const tx = Math.floor(x), tz = Math.floor(z);
        let dw = 3, dl = 3;
        for (let y = tz - 3; y <= tz + 2; y++) {
          for (let xx = tx - 3; xx <= tx + 2; xx++) {
            const dx = Math.max(xx - x, 0, x - (xx + 1)), dz = Math.max(y - z, 0, z - (y + 1));
            const d = Math.hypot(dx, dz);
            if (wet(xx, y)) dw = Math.min(dw, d); else dl = Math.min(dl, d);
          }
        }
        sd[j * vw + i] = dw - dl;
      }
    }
    // A light blur rounds off the square tile corners (both ways, so the
    // shore stays within a fraction of a tile of the real boundary).
    const tmp = new Float32Array(sd.length);
    for (let pass = 0; pass < 1; pass++) {
      for (let j = 0; j < vh; j++) {
        for (let i = 0; i < vw; i++) {
          let sum = 0, n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const x = i + dx, y = j + dy;
              if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
              sum += sd[y * vw + x]; n++;
            }
          }
          tmp[j * vw + i] = sum / n;
        }
      }
      sd.set(tmp);
    }
    for (let k = 0; k < sd.length; k++) {
      const d = sd[k] + SHORE_BIAS;
      // Land rises from the shore (capped near it so high ground doesn't
      // overhang the water); water deepens away from it.
      heights[k] = d > 0 ? Math.min(Math.max(heights[k], 0.04 + d * 0.6), 0.06 + d * 2.4) : Math.min(heights[k], -0.02 + d * 0.9);
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

  // Height for a ground unit: on a bridge deck, else never below the waterline.
  groundAt(x, z) {
    const h = Math.max(WATER_LEVEL + 0.04, this.heightAt(x, z));
    const d = this.deck ? this.deckAt(x, z) : null;
    return d == null ? h : Math.max(h, d);
  }

  // Highest point under a footprint, used to seat structures.
  maxOver(tx, ty, w, h) {
    let m = -Infinity;
    for (let y = ty; y <= ty + h; y += 0.5) for (let x = tx; x <= tx + w; x += 0.5) m = Math.max(m, this.heightAt(x, y));
    return m;
  }
}
