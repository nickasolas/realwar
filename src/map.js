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

// Ground units move about 1.6x faster on player-built roads.
export const ROAD_COST = 0.62;

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
    // Cosmetic dirt roads (lists of tiles) and civilian props such as
    // farmhouses and windmills, which block movement like structures do.
    this.roads = [];
    this.props = [];
    // Player-built roads (speed bonus) and gates (passable for their owner).
    this.road = new Uint8Array(w * h);
    this.roadVersion = 0;
    // Bridge tiles: still water underneath (ships sail under), but ground
    // units can drive across the deck.
    this.bridge = new Uint8Array(w * h);
    // Connected bodies of navigable water: region id per tile, size per id.
    this.waterRegion = new Int32Array(w * h).fill(-1);
    this.waterRegionSize = [];
    this.gateOwner = new Int8Array(w * h).fill(-1);
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

  // Water that belongs to a body big enough to sail on (not a pond).
  isOpenSea(x, y) {
    if (!this.inBounds(x, y) || !this.isWater(x, y)) return false;
    const r = this.waterRegion[y * this.w + x];
    return r >= 0 && this.waterRegionSize[r] >= MIN_SEA;
  }

  // Can an entity of the given domain stand on this tile?
  // `owner` lets a player's own ground units pass through their gates.
  passable(x, y, domain, owner = -1) {
    if (!this.inBounds(x, y)) return false;
    if (domain === 'air') return true;
    const i = y * this.w + x;
    if (this.occupied[i] && !(domain === 'ground' && owner >= 0 && this.gateOwner[i] === owner)) return false;
    if (domain === 'naval') return this.isWater(x, y);
    return this.isLand(x, y) || this.bridge[i] === 1;
  }

  // Slower movement through forest and sand.
  moveCost(x, y, domain) {
    if (domain !== 'ground') return 1;
    if (this.road[y * this.w + x] || this.bridge[y * this.w + x]) return ROAD_COST;
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
          if (this.isOpenSea(x, y)) { touchesWater = true; break; }
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

// Map types offered in the menu.
export const MAP_TYPES = {
  continental: { name: 'Continental', desc: 'Land masses split by sea channels, joined by bridges.' },
  islands: { name: 'Islands', desc: 'Every base on its own island: no land route, so navy and air decide it.' },
};

// Symmetry so every player gets an equivalent position. Two players: point
// symmetry (opposite corners). Three or four: four-fold rotation (one base
// per corner; with three players one corner is left empty).
function symmetry(players, w, h) {
  if (players <= 2) {
    return {
      norm: [([x, y]) => [x, y], ([x, y]) => [1 - x, 1 - y]],
      tile: [(x, y) => [x, y], (x, y) => [w - 1 - x, h - 1 - y]],
      // Footprint (x, y, fw, fh) under each transform: [x, y, fw, fh, quarter turns].
      rect: [(x, y, fw, fh) => [x, y, fw, fh, 0], (x, y, fw, fh) => [w - x - fw, h - y - fh, fw, fh, 2]],
    };
  }
  return {
    norm: [([x, y]) => [x, y], ([x, y]) => [1 - y, x], ([x, y]) => [1 - x, 1 - y], ([x, y]) => [y, 1 - x]],
    tile: [(x, y) => [x, y], (x, y) => [w - 1 - y, x], (x, y) => [w - 1 - x, h - 1 - y], (x, y) => [y, h - 1 - x]],
    rect: [
      (x, y, fw, fh) => [x, y, fw, fh, 0],
      (x, y, fw, fh) => [w - y - fh, x, fh, fw, 1],
      (x, y, fw, fh) => [w - x - fw, h - y - fh, fw, fh, 2],
      (x, y, fw, fh) => [y, h - x - fw, fh, fw, 3],
    ],
  };
}

// Generates a map for 2-4 players. `type` is a MAP_TYPES key.
// Continental: land split by sea channels with bridges, so ground, naval and
// air forces all matter. Islands: each base on its own island.
export function generateMap(seed, w = 96, h = 96, { players = 2, type = 'continental' } = {}) {
  if (players > 2 && w !== h) throw new Error('maps for more than two players must be square');
  const rng = createRng(seed);
  const map = new GameMap(w, h);
  map.type = MAP_TYPES[type] ? type : 'continental';
  const islands = map.type === 'islands';
  const elev = makeNoise(rng, 64);
  const moist = makeNoise(rng, 64);
  const sym = symmetry(players, w, h);
  const four = sym.norm.length === 4;
  const scale = w / 96; // features sized in tiles grow with the map

  let first = four ? [0.18, 0.18] : [0.16, 0.2];
  // Islands keep a fixed size in tiles so the shore stays within building
  // range of the base; the base sits toward its island's inner shore.
  const homeIsle = four ? [0.2, 0.2] : [0.18, 0.21];
  const homeR = Math.min(four ? 0.18 : 0.2, (four ? 24 : 26) / w);
  if (islands) {
    const toCentre = Math.atan2(0.5 - homeIsle[1], 0.5 - homeIsle[0]);
    first = [homeIsle[0] + Math.cos(toCentre) * homeR * 0.35, homeIsle[1] + Math.sin(toCentre) * homeR * 0.35];
  }
  const starts = sym.norm.map((f) => {
    const [x, y] = f(first);
    return { x: Math.round(x * (w - 1)), y: Math.round(y * (h - 1)) };
  });

  // Islands: one per base plus a few neutral ones, all symmetric.
  const isles = [];
  if (islands) {
    const add = (x, y, r) => { for (const f of sym.norm) { const [ix, iy] = f([x, y]); isles.push({ x: ix, y: iy, r }); } };
    add(homeIsle[0], homeIsle[1], homeR);
    if (four) add(0.5, 0.13, Math.min(0.07, 13 / w));
    else add(0.8, 0.2, Math.min(0.11, 15 / w));
    isles.push({ x: 0.5, y: 0.5, r: Math.min(four ? 0.1 : 0.09, 14 / w) });
    // Bigger seas get scattered islets to break up the open water.
    if (w >= 128) {
      add(0.4, 0.27, 7 / w);
      add(0.27, 0.42, 6 / w);
    }
  }
  // Average noise over the symmetry so every position is equivalent; more
  // samples flatten the noise, so stretch the contrast to match.
  const contrast = four ? 2.1 : 1.6;
  const symNoise = (noise, nx, ny, freq, oct) => {
    let e = 0;
    for (const f of sym.norm) { const [x, y] = f([nx, ny]); e += fractal(noise, x * freq, y * freq, oct); }
    return e / sym.norm.length;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = x / (w - 1), ny = y / (h - 1);
      let e = 0.5 + (symNoise(elev, nx, ny, 6, 4) - 0.5) * contrast;
      if (islands) {
        // Land only where an island's (noise-wobbled) radius reaches.
        let f = -1;
        for (const is of isles) f = Math.max(f, 1 - Math.hypot(nx - is.x, ny - is.y) / is.r);
        // Ragged coastlines from finer noise; gentle hills inland, few crags.
        f += (symNoise(moist, nx, ny, 14, 3) - 0.5) * 0.9 + (e - 0.5) * 0.3;
        e = f > 0 ? 0.45 + Math.min(f, 0.6) * 0.45 + (e - 0.5) * 0.35 : 0.4 + f * 0.6;
      } else if (four) {
        // Sea channels along both centre lines split the map into quarters.
        const d = Math.min(Math.abs(nx - 0.5), Math.abs(ny - 0.5));
        e += Math.min(d * 2.6, 0.55) - 0.42;
      } else {
        // A diagonal sea channel from top-right to bottom-left.
        const diag = Math.abs((nx + ny) - 1) / Math.SQRT2;
        e += Math.min(diag * 2.2, 0.55) - 0.42;
      }
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
        let m = 0;
        for (const f of sym.norm) { const [sx, sy] = f([nx, ny]); m = Math.max(m, fractal(moist, sx * 9, sy * 9, 3)); }
        t = m > (four ? 0.7 : 0.66) ? Terrain.FOREST : Terrain.GRASS;
      }
      map.tiles[y * w + x] = t;
      map.elev[y * w + x] = e;
    }
  }

  // Bridges across the channels so ground armies can meet. Water under them
  // stays water, so ships can still sail through.
  const bridge = (cx, cy, dx, dy, len) => {
    for (let i = -len; i <= len; i++) {
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const x = cx + i * dx + ox, y = cy + i * dy + oy;
          if (!map.inBounds(x, y)) continue;
          if (map.isWater(x, y)) map.bridge[y * w + x] = 1;
          else if (map.get(x, y) === Terrain.ROCK) map.tiles[y * w + x] = Terrain.SAND;
        }
      }
    }
  };
  const span = Math.round(10 * scale);
  if (!islands && four) {
    // One bridge across each arm of the cross, rotated into all four.
    for (const f of sym.tile) {
      const [cx, cy] = f(Math.round((w - 1) / 2), Math.round((h - 1) * 0.27));
      const [ex, ey] = f(Math.round((w - 1) / 2) + 1, Math.round((h - 1) * 0.27));
      bridge(cx, cy, ex - cx, ey - cy, span);
    }
  } else if (!islands) {
    for (const b of [0.3, 0.5, 0.7]) bridge(Math.round(w * b), Math.round(h * (1 - b)), 1, 1, span);
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
  // Roads: between the two bases, or around the ring of four. Islands have none.
  if (!islands) {
    const pairs = four ? starts.map((s, i) => [s, starts[(i + 1) % 4]]) : [[starts[0], starts[1]]];
    for (const [a, b] of pairs) {
      const road = carveRoad(map, a, b);
      if (road) map.roads.push(road);
    }
  }

  // Oil wells: a pair near each base, then contested ones around the map,
  // every one copied into each symmetric position.
  const wellSpots = [];
  const addSym = (x, y) => { for (const f of sym.tile) { const [sx, sy] = f(x, y); wellSpots.push({ x: sx, y: sy }); } };
  const s0 = starts[0];
  addSym(s0.x + 6, s0.y + 2);
  addSym(s0.x + 2, s0.y + 6);
  // On islands, oil only counts where trucks can reach it: the base islands.
  const reach = islands ? groundReach(map, s0) : null;
  const target = Math.round(14 * scale * scale);
  let attempts = 0;
  while (wellSpots.length < target && attempts++ < 4000) {
    const x = rng.int(4, w - 5), y = rng.int(4, h - 5);
    if (map.get(x, y) !== Terrain.GRASS) continue;
    if (reach && !reach[y * w + x]) continue;
    const spots = sym.tile.map((f) => f(x, y));
    if (spots.some(([sx, sy]) => wellSpots.some((p) => Math.hypot(p.x - sx, p.y - sy) < (islands ? 7 : 12)))) continue;
    if (spots.some(([sx, sy]) => starts.some((p) => Math.hypot(p.x - sx, p.y - sy) < (islands ? 8 : 12)))) continue;
    if (spots.some(([sx, sy]) => map.get(sx, sy) !== Terrain.GRASS)) continue;
    addSym(x, y);
  }
  for (const p of wellSpots) {
    if (!map.inBounds(p.x, p.y)) continue;
    map.tiles[p.y * w + p.x] = Terrain.GRASS;
    map.wells.push({ x: p.x, y: p.y, amount: OIL_PER_WELL });
  }
  // Later passes (wells, base clearings) may have filled some bridged water.
  for (let i = 0; i < w * h; i++) if (map.bridge[i] && !map.isWater(i % w, Math.floor(i / w))) map.bridge[i] = 0;
  labelWaterRegions(map);
  digCanals(map, starts);
  placeProps(map, rng, sym, Math.round(5 * scale * scale));
  return map;
}

// Join every sizeable pond to the main sea with a short two-tile canal, so
// ships built on any decent stretch of water can reach open sea. Canals
// avoid bases and wells, and are bridged wherever they cross the road.
const MIN_POND = 20; // smaller puddles are left alone
const MAX_CANAL = 24; // longest canal (in land tiles) worth digging
const CANAL_CROSSING = 5; // a bridge across the canal every this many tiles

function digCanals(map, starts) {
  const { w, h } = map;
  // The carved road is two tiles wide (each path tile plus its +x/+y neighbours).
  const roadTiles = new Set();
  for (const p of map.roads.flat()) for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) roadTiles.add((p.y + dy) * w + p.x + dx);
  for (let pass = 0; pass < 12; pass++) {
    const sizes = map.waterRegionSize;
    let main = 0;
    for (let r = 1; r < sizes.length; r++) if (sizes[r] > sizes[main]) main = r;
    const target = sizes.findIndex((n, r) => r !== main && n >= MIN_POND && !map.canalTried?.has(r));
    if (target < 0) return;
    (map.canalTried ||= new Set()).add(target);
    const path = canalPath(map, main, target, starts);
    if (!path) continue;
    const before = groundReach(map, starts[0]);
    const dug = [];
    path.forEach((i, k) => {
      // A crossing every few tiles keeps the land on either side connected.
      const crossing = k % CANAL_CROSSING === Math.floor(CANAL_CROSSING / 2);
      for (const j of [i, i + 1]) {
        const x = j % w, y = Math.floor(j / w);
        if (!map.inBounds(x, y) || map.isWater(x, y) || map.occupied[j]) continue;
        if (map.wells.some((wl) => wl.x === x && wl.y === y)) continue;
        map.tiles[j] = Terrain.WATER;
        dug.push(j);
        if (crossing || roadTiles.has(j)) map.bridge[j] = 1;
      }
    });
    // Never strand a well that the bases could reach before: if the canal
    // did, bridge it end to end (ships still pass underneath).
    const after = groundReach(map, starts[0]);
    if (map.wells.some((wl) => before[wl.y * w + wl.x] && !after[wl.y * w + wl.x])) for (const j of dug) map.bridge[j] = 1;
    // Relabel after each canal; ids change, so forget which were tried.
    map.waterRegion.fill(-1);
    map.waterRegionSize = [];
    map.canalTried = null;
    labelWaterRegions(map);
  }
}

// Tiles a ground unit can reach from `start` (4-connected flood fill).
function groundReach(map, start) {
  const { w } = map;
  const seen = new Uint8Array(w * map.h);
  const first = (start.y + 3) * w + start.x;
  const stack = [first];
  seen[first] = 1;
  while (stack.length) {
    const c = stack.pop();
    const x = c % w, y = (c - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, i = ny * w + nx;
      if (map.inBounds(nx, ny) && !seen[i] && (map.isLand(nx, ny) || map.bridge[i])) { seen[i] = 1; stack.push(i); }
    }
  }
  return seen;
}

// Cheapest 4-connected route of land from the main sea to a target body.
function canalPath(map, main, target, starts) {
  const { w, h } = map;
  const n = w * h;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const landSteps = new Int32Array(n);
  const heap = [];
  const push = (i, d) => { heap.push([d, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { let c = 2 * k + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= heap[k][0]) break; [heap[c], heap[k]] = [heap[k], heap[c]]; k = c; } } return top; };
  for (let i = 0; i < n; i++) if (map.waterRegion[i] === main) { dist[i] = 0; push(i, 0); }
  const blocked = (x, y) => starts.some((s) => Math.hypot(s.x - x, s.y - y) < 9)
    || map.wells.some((wl) => Math.abs(wl.x - x) <= 1 && Math.abs(wl.y - y) <= 1)
    || map.occupied[y * w + x] !== 0;
  while (heap.length) {
    const [d, i] = pop();
    if (d > dist[i]) continue;
    if (map.waterRegion[i] === target) {
      const path = [];
      for (let c = i; c >= 0 && map.waterRegion[c] !== main; c = prev[c]) if (!map.isWater(c % w, Math.floor(c / w))) path.push(c);
      return path;
    }
    const x = i % w, y = (i - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 1 || ny < 1 || nx >= w - 2 || ny >= h - 2) continue;
      const j = ny * w + nx;
      const water = map.isWater(nx, ny);
      if (!water && blocked(nx, ny)) continue;
      const steps = landSteps[i] + (water ? 0 : 1);
      if (steps > MAX_CANAL) continue;
      const t = map.get(nx, ny);
      const cost = water ? 1 : t === Terrain.ROCK ? 14 : 5;
      if (d + cost < dist[j]) { dist[j] = d + cost; prev[j] = i; landSteps[j] = steps; push(j, d + cost); }
    }
  }
  return null;
}

// Flood-fill navigable water into connected bodies (same movement rules as
// ship pathfinding), so placement can tell the open sea from a pond.
export const MIN_SEA = 150; // tiles of water a Naval Yard needs to be useful

function labelWaterRegions(map) {
  const { w, h } = map;
  const ok = (x, y) => map.inBounds(x, y) && map.isWater(x, y);
  for (let s = 0; s < w * h; s++) {
    if (map.waterRegion[s] >= 0 || !ok(s % w, Math.floor(s / w))) continue;
    const r = map.waterRegionSize.length;
    let n = 0;
    const stack = [s];
    map.waterRegion[s] = r;
    while (stack.length) {
      const c = stack.pop();
      n++;
      const cx = c % w, cy = (c - cx) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!ok(nx, ny)) continue;
        if (dx && dy && (!ok(cx + dx, cy) || !ok(cx, cy + dy))) continue;
        const ni = ny * w + nx;
        if (map.waterRegion[ni] >= 0) continue;
        map.waterRegion[ni] = r;
        stack.push(ni);
      }
    }
    map.waterRegionSize.push(n);
  }
}

// Civilian scenery: farmsteads and windmills on open grassland, mirrored for
// fairness, kept clear of bases, wells and the road. They block movement.
const PROP_KINDS = [
  { kind: 'house', w: 1, h: 1 },
  { kind: 'house', w: 1, h: 1 },
  { kind: 'barn', w: 2, h: 1 },
  { kind: 'windmill', w: 1, h: 1 },
  { kind: 'silo', w: 1, h: 1 },
];

function placeProps(map, rng, sym, maxClusters = 5) {
  const roadTiles = new Set();
  for (const road of map.roads) for (const p of road) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) roadTiles.add((p.y + dy) * map.w + (p.x + dx));
  const free = (x, y, w, h) => {
    for (let yy = y - 1; yy <= y + h; yy++) {
      for (let xx = x - 1; xx <= x + w; xx++) {
        if (!map.inBounds(xx, yy) || map.get(xx, yy) !== Terrain.GRASS || map.occupied[yy * map.w + xx]) return false;
        if (roadTiles.has(yy * map.w + xx)) return false;
      }
    }
    if (map.starts.some((s) => Math.hypot(s.x - x, s.y - y) < 15)) return false;
    if (map.wells.some((wl) => Math.hypot(wl.x - x, wl.y - y) < 4)) return false;
    if (map.props.some((p) => Math.hypot(p.x - x, p.y - y) < 2.5)) return false;
    return true;
  };
  const add = (kind, x, y, w, h, rot) => {
    map.props.push({ kind, x, y, w, h, rot });
    map.setOccupied(x, y, w, h, -1);
  };
  let clusters = 0;
  for (let attempt = 0; attempt < 80 * maxClusters && clusters < maxClusters; attempt++) {
    // A farmstead: two to four buildings near each other.
    const cx = rng.int(6, map.w - 7), cy = rng.int(6, map.h - 7);
    // Too close to its own symmetric copies and they'd overlap.
    if (sym.tile.slice(1).some((f) => { const [mx, my] = f(cx, cy); return Math.hypot(cx - mx, cy - my) < 10; })) continue;
    const n = rng.int(2, 4);
    const placed = [];
    for (let k = 0; k < n * 6 && placed.length < n; k++) {
      const t = rng.pick(PROP_KINDS);
      const x = cx + rng.int(-3, 3), y = cy + rng.int(-3, 3);
      const copies = sym.rect.map((f) => f(x, y, t.w, t.h));
      if (!copies.every(([cx2, cy2, fw, fh]) => free(cx2, cy2, fw, fh))) continue;
      const rot = (t.w === t.h ? rng.int(0, 3) : rng.int(0, 1) * 2) * (Math.PI / 2);
      for (const [cx2, cy2, fw, fh, q] of copies) add(t.kind, cx2, cy2, fw, fh, rot - q * (Math.PI / 2));
      placed.push(t);
    }
    if (placed.length) clusters++;
  }
}

// Guarantee the bases are linked by land: find the cheapest route where water
// and rock are allowed but expensive, then turn those tiles into sand.
function carveRoad(map, a, b) {
  const costMap = {
    w: map.w,
    h: map.h,
    passable: (x, y) => map.inBounds(x, y),
    moveCost: (x, y) => (map.isLand(x, y) || map.bridge[y * map.w + x] ? 1 : 8),
  };
  const path = findPath(costMap, a.x, a.y, b.x, b.y, 'ground', map.w * map.h * 4, false);
  if (!path) return null;
  for (const p of path) {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const x = p.x + dx, y = p.y + dy;
        if (!map.inBounds(x, y)) continue;
        // Water is bridged, rock is cut through, forest along the road is cleared.
        if (map.isWater(x, y)) map.bridge[y * map.w + x] = 1;
        else if (!map.isLand(x, y)) map.tiles[y * map.w + x] = Terrain.SAND;
        else if (map.get(x, y) === Terrain.FOREST) map.tiles[y * map.w + x] = Terrain.GRASS;
      }
    }
  }
  return path;
}

// Tiles on a straight line from a to b (inclusive). Eight-connected by
// default; `fourConnected` steps only orthogonally, so road strips join up
// edge to edge.
export function lineTiles(a, b, fourConnected = false) {
  const tiles = [{ x: a.x, y: a.y }];
  let x = a.x, y = a.y;
  const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
  const sx = Math.sign(b.x - a.x), sy = Math.sign(b.y - a.y);
  if (fourConnected) {
    let err = 0;
    for (let i = 0; i < dx + dy; i++) {
      // Step along whichever axis keeps us closest to the true line.
      if (err + dy <= 0 || (dx && Math.abs(err + dy) < Math.abs(err - dx))) { x += sx; err += dy; } else { y += sy; err -= dx; }
      tiles.push({ x, y });
    }
    return tiles;
  }
  let err = dx - dy;
  while (x !== b.x || y !== b.y) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
    tiles.push({ x, y });
  }
  return tiles;
}
