import { Terrain, OIL_PER_WELL } from './config.js';
import { createRng } from './rng.js';
import { findPath } from './path.js';

// Value noise with smooth interpolation, layered into fractal noise.
function makeNoise(rng, size) {
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = rng.next();
  const at = (x, y) => grid[((y % size + size) % size) * size + ((x % size + size) % size)];
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = smooth(x - x0), fy = smooth(y - y0);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

function fractal(noise, x, y, octaves) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export class GameMap {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.tiles = new Uint8Array(w * h);
    // Raw generator elevation (0..1), used for cosmetic terrain relief.
    this.elev = new Float32Array(w * h);
    // Building occupancy: entity id + 1 for each covered tile, 0 when free.
    this.occupied = new Int32Array(w * h);
    this.wells = [];
    this.starts = [];
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x, y) {
    return this.tiles[y * this.w + x];
  }

  isWater(x, y) {
    const t = this.get(x, y);
    return t === Terrain.WATER || t === Terrain.DEEP;
  }

  isLand(x, y) {
    const t = this.get(x, y);
    return t === Terrain.SAND || t === Terrain.GRASS || t === Terrain.FOREST;
  }

  // Can an entity of the given domain stand on this tile?
  passable(x, y, domain) {
    if (!this.inBounds(x, y)) return false;
    if (domain === 'air') return true;
    if (this.occupied[y * this.w + x]) return false;
    if (domain === 'naval') return this.isWater(x, y);
    return this.isLand(x, y);
  }

  // Slower movement through forest and sand.
  moveCost(x, y, domain) {
    if (domain !== 'ground') return 1;
    const t = this.get(x, y);
    if (t === Terrain.FOREST) return 1.8;
    if (t === Terrain.SAND) return 1.2;
    return 1;
  }

  canPlace(tx, ty, w, h, coastal) {
    let touchesWater = false;
    for (let y = ty; y < ty + h; y++) {
      for (let x = tx; x < tx + w; x++) {
        if (!this.inBounds(x, y) || this.occupied[y * this.w + x]) return false;
        const t = this.get(x, y);
        if (t !== Terrain.GRASS && t !== Terrain.SAND) return false;
      }
    }
    if (coastal) {
      for (let y = ty - 1; y <= ty + h && !touchesWater; y++) {
        for (let x = tx - 1; x <= tx + w; x++) {
          if (this.inBounds(x, y) && this.isWater(x, y)) { touchesWater = true; break; }
        }
      }
      if (!touchesWater) return false;
    }
    return true;
  }

  setOccupied(tx, ty, w, h, value) {
    for (let y = ty; y < ty + h; y++) {
      for (let x = tx; x < tx + w; x++) this.occupied[y * this.w + x] = value;
    }
  }
}

// Generates a two-player map: a continent split by a central sea channel with
// land bridges, so ground, naval and air forces all matter.
export function generateMap(seed, w = 96, h = 96) {
  const rng = createRng(seed);
  const map = new GameMap(w, h);
  const elev = makeNoise(rng, 64);
  const moist = makeNoise(rng, 64);

  const starts = [
    { x: Math.round(w * 0.16), y: Math.round(h * 0.2) },
    { x: Math.round(w * 0.84), y: Math.round(h * 0.8) },
  ];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = x / w, ny = y / h;
      // Average with the point-mirrored sample so both sides are equally fair.
      let e = (fractal(elev, nx * 6, ny * 6, 4) + fractal(elev, (1 - nx) * 6, (1 - ny) * 6, 4)) / 2;
      e = 0.5 + (e - 0.5) * 1.6;
      // A diagonal sea channel from top-right to bottom-left.
      const diag = Math.abs((nx + ny) - 1) / Math.SQRT2;
      e += Math.min(diag * 2.2, 0.55) - 0.42;
      // Map edges fall off into ocean.
      const edge = Math.min(nx, ny, 1 - nx, 1 - ny);
      if (edge < 0.06) e -= (0.06 - edge) * 6;
      // Guarantee flat land around each start.
      for (const s of starts) {
        const d = Math.hypot(x - s.x, y - s.y);
        if (d < 10) e = Math.max(e, 0.62 - d * 0.004);
      }
      let t;
      if (e < 0.30) t = Terrain.DEEP;
      else if (e < 0.40) t = Terrain.WATER;
      else if (e < 0.44) t = Terrain.SAND;
      else if (e > 0.86) t = Terrain.ROCK;
      else {
        const m = Math.max(fractal(moist, nx * 9, ny * 9, 3), fractal(moist, (1 - nx) * 9, (1 - ny) * 9, 3));
        t = m > 0.66 ? Terrain.FOREST : Terrain.GRASS;
      }
      map.tiles[y * w + x] = t;
      map.elev[y * w + x] = e;
    }
  }

  // Land bridges across the channel so ground armies can meet.
  const bridges = [0.3, 0.5, 0.7];
  for (const b of bridges) {
    const cx = Math.round(w * b), cy = Math.round(h * (1 - b));
    for (let i = -10; i <= 10; i++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + i + dx, y = cy + i + dy;
          if (map.inBounds(x, y) && (map.isWater(x, y) || map.get(x, y) === Terrain.ROCK)) map.tiles[y * w + x] = Terrain.SAND;
        }
      }
    }
  }

  // Keep start areas clear of forest and rock so the base fits.
  for (const s of starts) {
    for (let y = s.y - 6; y <= s.y + 6; y++) {
      for (let x = s.x - 6; x <= s.x + 6; x++) {
        if (map.inBounds(x, y) && !map.isWater(x, y)) map.tiles[y * w + x] = Terrain.GRASS;
      }
    }
  }
  map.starts = starts;
  carveRoad(map, starts[0], starts[1]);

  // Oil wells: a pair near each base, then contested ones around the map.
  const wellSpots = [];
  for (const s of starts) {
    const dir = s.x < w / 2 ? 1 : -1;
    wellSpots.push({ x: s.x + 6 * dir, y: s.y + 2 }, { x: s.x + 2, y: s.y + 6 * dir });
  }
  let attempts = 0;
  while (wellSpots.length < 14 && attempts++ < 2000) {
    const x = rng.int(4, w - 5), y = rng.int(4, h - 5);
    if (map.get(x, y) !== Terrain.GRASS) continue;
    if (wellSpots.some((p) => Math.hypot(p.x - x, p.y - y) < 12)) continue;
    if (starts.some((p) => Math.hypot(p.x - x, p.y - y) < 12)) continue;
    wellSpots.push({ x, y });
    // Mirror for fairness.
    wellSpots.push({ x: w - 1 - x, y: h - 1 - y });
  }
  for (const p of wellSpots) {
    if (!map.inBounds(p.x, p.y)) continue;
    map.tiles[p.y * w + p.x] = Terrain.GRASS;
    map.wells.push({ x: p.x, y: p.y, amount: OIL_PER_WELL });
  }
  return map;
}

// Guarantee the bases are linked by land: find the cheapest route where water
// and rock are allowed but expensive, then turn those tiles into sand.
function carveRoad(map, a, b) {
  const costMap = {
    w: map.w,
    h: map.h,
    passable: (x, y) => map.inBounds(x, y),
    moveCost: (x, y) => (map.isLand(x, y) ? 1 : 8),
  };
  const path = findPath(costMap, a.x, a.y, b.x, b.y, 'ground', map.w * map.h * 4, false);
  if (!path) return;
  for (const p of path) {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const x = p.x + dx, y = p.y + dy;
        if (map.inBounds(x, y) && !map.isLand(x, y)) map.tiles[y * map.w + x] = Terrain.SAND;
      }
    }
  }
}
