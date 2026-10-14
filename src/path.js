// A* over the tile grid with 8-way movement (no corner cutting).

class MinHeap {
  constructor() { this.items = []; this.prio = []; }
  get size() { return this.items.length; }
  clear() { this.items.length = 0; this.prio.length = 0; }
  push(item, p) {
    const a = this.items, q = this.prio;
    let i = a.length;
    a.push(item); q.push(p);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (q[parent] <= p) break;
      a[i] = a[parent]; q[i] = q[parent];
      i = parent;
    }
    a[i] = item; q[i] = p;
  }
  pop() {
    const a = this.items, q = this.prio;
    const top = a[0];
    const lastItem = a.pop(), lastP = q.pop();
    if (a.length) {
      let i = 0;
      const n = a.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && q[c + 1] < q[c]) c++;
        if (q[c] >= lastP) break;
        a[i] = a[c]; q[i] = q[c];
        i = c;
      }
      a[i] = lastItem; q[i] = lastP;
    }
    return top;
  }
}

// Per-size scratch buffers shared by all searches (the game is single-threaded).
let SCRATCH = null;
function scratch(n) {
  if (!SCRATCH || SCRATCH.n !== n) {
    SCRATCH = { n, g: new Float64Array(n), came: new Int32Array(n), seen: new Uint32Array(n), closed: new Uint32Array(n), gen: 0, heap: new MinHeap() };
  }
  if (++SCRATCH.gen >= 0xffffffff) { SCRATCH.seen.fill(0); SCRATCH.closed.fill(0); SCRATCH.gen = 1; }
  return SCRATCH;
}

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

// Find the passable tile closest to (tx, ty), searching outward in rings.
export function nearestPassable(map, tx, ty, domain, maxRadius = 12, owner = -1) {
  if (map.passable(tx, ty, domain, owner)) return { x: tx, y: ty };
  for (let r = 1; r <= maxRadius; r++) {
    let best = null, bestD = Infinity;
    for (let y = ty - r; y <= ty + r; y++) {
      for (let x = tx - r; x <= tx + r; x++) {
        if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) !== r) continue;
        if (!map.passable(x, y, domain, owner)) continue;
        const d = (x - tx) ** 2 + (y - ty) ** 2;
        if (d < bestD) { bestD = d; best = { x, y }; }
      }
    }
    if (best) return best;
  }
  return null;
}

// Returns an array of {x, y} tiles from start (exclusive) to goal (inclusive),
// or the path to the closest reachable tile when the goal is unreachable.
// Returns [] when already at the goal, null when nothing is reachable.
export function findPath(map, sx, sy, gx, gy, domain, maxNodes = 12000, smooth = true, owner = -1) {
  const w = map.w;
  if (domain === 'air') return [{ x: gx, y: gy }];
  const goal = nearestPassable(map, gx, gy, domain, 12, owner);
  if (!goal) return null;
  gx = goal.x; gy = goal.y;
  if (sx === gx && sy === gy) return [];

  const start = sy * w + sx;
  // Reusable typed-array bookkeeping; a generation stamp marks which
  // entries belong to this search, so nothing needs clearing between calls.
  const S = scratch(w * map.h);
  const gen = S.gen;
  const open = S.heap;
  open.clear();
  S.g[start] = 0; S.seen[start] = gen; S.came[start] = -1;
  const h = (x, y) => {
    const dx = Math.abs(x - gx), dy = Math.abs(y - gy);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  open.push(start, h(sx, sy));
  let bestNode = start, bestH = h(sx, sy);
  let expanded = 0;

  while (open.size) {
    const cur = open.pop();
    if (S.closed[cur] === gen) continue;
    S.closed[cur] = gen;
    const cx = cur % w, cy = (cur - cx) / w;
    if (cx === gx && cy === gy) { bestNode = cur; break; }
    const ch = h(cx, cy);
    if (ch < bestH) { bestH = ch; bestNode = cur; }
    if (++expanded > maxNodes) break;
    const g = S.g[cur];
    for (let k = 0; k < 8; k++) {
      const dx = DIRS[k][0], dy = DIRS[k][1];
      const nx = cx + dx, ny = cy + dy;
      const n = ny * w + nx;
      if (S.closed[n] === gen && nx >= 0 && nx < w) continue;
      if (!map.passable(nx, ny, domain, owner)) continue;
      if (dx && dy && (!map.passable(cx + dx, cy, domain, owner) || !map.passable(cx, cy + dy, domain, owner))) continue;
      const ng = g + DIRS[k][2] * map.moveCost(nx, ny, domain);
      if (S.seen[n] !== gen || ng < S.g[n]) {
        S.seen[n] = gen;
        S.g[n] = ng;
        S.came[n] = cur;
        open.push(n, ng + h(nx, ny));
      }
    }
  }

  const path = [];
  let n = bestNode;
  while (n !== start) {
    path.push({ x: n % w, y: Math.floor(n / w) });
    if (S.seen[n] !== gen) return null;
    n = S.came[n];
    if (n < 0) return null;
  }
  path.reverse();
  return smooth ? smoothPath(map, sx, sy, path, domain, owner) : path;
}

// Drop intermediate waypoints that have direct line of travel.
function smoothPath(map, sx, sy, path, domain, owner) {
  if (path.length < 3) return path;
  const out = [];
  let ax = sx, ay = sy;
  let i = 0;
  while (i < path.length) {
    let j = path.length - 1;
    while (j > i && !lineClear(map, ax, ay, path[j].x, path[j].y, domain, owner)) j--;
    out.push(path[j]);
    ax = path[j].x; ay = path[j].y;
    i = j + 1;
  }
  return out;
}

// Conservative check: samples the segment and requires every touched tile
// (including a unit-radius band) to be passable.
export function lineClear(map, x0, y0, x1, y1, domain, owner = -1) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.ceil(dist * 3);
  for (let s = 0; s <= steps; s++) {
    const t = steps ? s / steps : 0;
    const px = x0 + 0.5 + (x1 - x0) * t, py = y0 + 0.5 + (y1 - y0) * t;
    for (const [ox, oy] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
      if (!map.passable(Math.floor(px + ox), Math.floor(py + oy), domain, owner)) return false;
    }
  }
  return true;
}
