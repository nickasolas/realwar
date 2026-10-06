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
