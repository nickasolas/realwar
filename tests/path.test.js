import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameMap } from '../src/map.js';
import { findPath } from '../src/path.js';
import { Terrain } from '../src/config.js';

function grid(rows) {
  const m = new GameMap(rows[0].length, rows.length);
  rows.forEach((r, y) => [...r].forEach((c, x) => { m.tiles[y * m.w + x] = c === '#' ? Terrain.ROCK : c === '~' ? Terrain.WATER : Terrain.GRASS; }));
  return m;
}

test('ground path routes around a wall', () => {
  const m = grid([
    '.....',
    '.###.',
    '...#.',
    '.###.',
    '.....',
  ]);
  const path = findPath(m, 0, 2, 2, 2, 'ground');
  assert.ok(path.length > 0);
  assert.deepEqual(path[path.length - 1], { x: 2, y: 2 });
});

test('naval units stay on water and air flies straight', () => {
  const m = grid([
    '~~~..',
    '~~~..',
    '~~~..',
  ]);
  const naval = findPath(m, 0, 0, 4, 2, 'naval');
  for (const p of naval) assert.ok(m.isWater(p.x, p.y));
  assert.deepEqual(findPath(m, 0, 0, 4, 2, 'air'), [{ x: 4, y: 2 }]);
});

test('unreachable goal gets as close as possible', () => {
  const m = grid([
    '..#..',
    '..#..',
    '..#..',
  ]);
  const path = findPath(m, 0, 1, 4, 1, 'ground');
  assert.ok(path.length > 0);
  assert.equal(path[path.length - 1].x, 1);
});

test('buildings block movement', () => {
  const m = grid(['.....', '.....', '.....']);
  m.setOccupied(2, 0, 1, 3, 99);
  const path = findPath(m, 0, 1, 4, 1, 'ground');
  assert.notEqual(path?.[path.length - 1]?.x, 4);
});
