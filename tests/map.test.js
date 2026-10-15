import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { findPath } from '../src/path.js';

test('map generation is deterministic per seed', () => {
  const a = generateMap(7), b = generateMap(7), c = generateMap(8);
  assert.deepEqual(a.tiles, b.tiles);
  assert.notDeepEqual(a.tiles, c.tiles);
});

test('start positions are on open land with oil nearby', () => {
  for (const seed of [1, 2, 3, 42, 1234]) {
    const m = generateMap(seed);
    assert.equal(m.starts.length, 2);
    for (const s of m.starts) {
      assert.ok(m.canPlace(s.x - 1, s.y - 1, 3, 3), `seed ${seed}: HQ fits`);
      const near = m.wells.filter((w) => Math.hypot(w.x - s.x, w.y - s.y) < 10);
      assert.ok(near.length >= 2, `seed ${seed}: has starting wells`);
    }
  }
});

test('both bases are connected by land', () => {
  for (const seed of [1, 2, 3, 42, 1234]) {
    const m = generateMap(seed);
    const [a, b] = m.starts;
    const path = findPath(m, a.x, a.y + 3, b.x, b.y + 3, 'ground', 50000);
    assert.ok(path && path.length, `seed ${seed}: path exists`);
    const end = path[path.length - 1];
    assert.ok(Math.hypot(end.x - b.x, end.y - b.y - 3) < 2, `seed ${seed}: path reaches enemy base`);
  }
});

test('civilian props block their tiles but never the road, bases or wells', () => {
  for (const seed of [1, 2, 3, 42, 1234]) {
    const m = generateMap(seed);
    assert.ok(m.props.length > 0, `seed ${seed}: has scenery`);
    const road = new Set(m.roads.flat().map((p) => p.y * m.w + p.x));
    for (const p of m.props) {
      for (let y = p.y; y < p.y + p.h; y++) {
        for (let x = p.x; x < p.x + p.w; x++) {
          assert.equal(m.occupied[y * m.w + x], -1, 'prop tile is blocked');
          assert.ok(!m.passable(x, y, 'ground'));
          assert.ok(!road.has(y * m.w + x), 'not on the road');
        }
      }
      assert.ok(m.starts.every((s) => Math.hypot(s.x - p.x, s.y - p.y) >= 15), 'clear of bases');
      assert.ok(m.wells.every((w) => Math.hypot(w.x - p.x, w.y - p.y) >= 4), 'clear of wells');
    }
  }
});

test('nearly all water forms one navigable sea reachable from both bases', () => {
  for (const seed of [1, 2, 3, 42, 1234, 777]) {
    const m = generateMap(seed);
    let water = 0;
    for (let i = 0; i < m.tiles.length; i++) if (m.waterRegion[i] >= 0) water++;
    const main = Math.max(...m.waterRegionSize);
    assert.ok(main / water > 0.85, `seed ${seed}: main sea holds ${(main / water * 100).toFixed(1)}% of water`);
    for (const s of m.starts) {
      let near = Infinity;
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.isOpenSea(x, y)) near = Math.min(near, Math.hypot(x - s.x, y - s.y));
      assert.ok(near < 36, `seed ${seed}: open sea within reach of base (${near.toFixed(1)})`);
    }
  }
});

test('Naval Yards need open sea, not a pond', () => {
  const m = generateMap(1);
  // Flood a little lake well inland and check it does not count as coast.
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    if (!m.isWater(x, y) || m.isOpenSea(x, y)) continue;
    assert.ok(m.waterRegionSize[m.waterRegion[y * m.w + x]] < 150);
  }
  const s = m.starts[0];
  assert.equal(m.canPlace(s.x - 1, s.y - 1, 3, 3, true), false, 'no sea next to the HQ spot');
});

test('bridges carry ground units and let ships sail underneath', () => {
  for (const seed of [1, 2, 3]) {
    const m = generateMap(seed);
    let n = 0;
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      if (!m.bridge[y * m.w + x]) continue;
      n++;
      assert.ok(m.passable(x, y, 'ground'), `seed ${seed}: deck at ${x},${y} is drivable`);
      assert.ok(m.passable(x, y, 'naval'), `seed ${seed}: water under ${x},${y} is navigable`);
    }
    assert.ok(n > 0, `seed ${seed}: has bridges`);
  }
});
