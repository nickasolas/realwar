import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { HeightField, DECK_LEVEL } from '../src/gfx/heightfield.js';
import { Terrain } from '../src/config.js';

test('terrain relief keeps water low and mountains high', () => {
  const map = generateMap(42);
  const hf = new HeightField(map, 42);
  let deepSum = 0, deepN = 0, rockSum = 0, rockN = 0, landBelow = 0, landN = 0;
  for (let y = 1; y < map.h - 1; y++) {
    for (let x = 1; x < map.w - 1; x++) {
      const t = map.get(x, y), h = hf.heightAt(x + 0.5, y + 0.5);
      if (t === Terrain.DEEP) { deepSum += h; deepN++; }
      if (t === Terrain.ROCK) { rockSum += h; rockN++; }
      if (t === Terrain.GRASS) { landN++; if (h < 0) landBelow++; }
    }
  }
  assert.ok(deepSum / deepN < -1);
  if (rockN) assert.ok(rockSum / rockN > 1.5);
  assert.ok(landBelow / landN < 0.02, 'grass is almost never under water');
  assert.ok(hf.groundAt(0, 0) > 0);
});

test('ground units ride on bridge decks above the water', () => {
  const m = generateMap(1);
  const hf = new HeightField(m, 1);
  let checked = 0;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    if (!m.bridge[y * m.w + x]) continue;
    const g = hf.groundAt(x + 0.5, y + 0.5);
    assert.ok(g > 0.05 && g <= DECK_LEVEL + 0.01, `deck at ${x},${y} is ${g}`);
    checked++;
  }
  assert.ok(checked > 0);
});

test('the drawn shoreline matches the tiles ships can sail on', () => {
  for (const seed of [1, 42]) {
    const m = generateMap(seed);
    const hf = new HeightField(m, seed);
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      // Sample each tile's centre and just inside each edge (corners are
      // rounded off a little): land must be dry, water wet.
      for (const [u, v] of [[0.5, 0.5], [0.5, 0.2], [0.5, 0.8], [0.2, 0.5], [0.8, 0.5]]) {
        const h = hf.heightAt(x + u, y + v);
        if (m.isWater(x, y)) assert.ok(h < 0, `seed ${seed}: water tile ${x},${y} drawn as land`);
        else assert.ok(h > 0, `seed ${seed}: land tile ${x},${y} drawn under water`);
      }
    }
  }
});
