import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/sim.js';
import { TICK_RATE, UNITS } from '../src/config.js';

const run = (g, seconds) => {
  for (let i = 0; i < seconds * TICK_RATE; i++) { g.step(); g.events.length = 0; }
};
const find = (g, owner, type) => [...g.entities.values()].find((e) => e.owner === owner && e.type === type);

// An islands map: the only way to the enemy island is by sea.
function setup() {
  const g = new Game({ seed: 5, mapSize: 96, mapType: 'islands' });
  const hq = find(g, 0, 'hq');
  const l = g.addUnit(0, 'lander', 0, 0);
  const beach = g.beachNear(l, hq.x, hq.y, 30);
  l.x = beach.x; l.y = beach.y;
  return { g, hq, l };
}

test('ground units board a landing craft up to its capacity', () => {
  const { g, l } = setup();
  const near = (i) => ({ x: l.x + (i % 3) - 1, y: l.y + Math.floor(i / 3) - 1 });
  const units = [];
  for (let i = 0; i < 6; i++) {
    const type = i < 3 ? 'tank' : 'infantry';
    const sp = g.beachNear(l, l.x, l.y) && near(i);
    const u = g.addUnit(0, type, sp.x, sp.y);
    // Make sure each starts on land near the craft.
    for (let r = 0; r < 6 && !g.map.passable(Math.floor(u.x), Math.floor(u.y), 'ground'); r++) { u.x += 1; }
    units.push(u);
  }
  const truck = find(g, 0, 'truck');
  assert.equal(g.cmdBoard(0, [truck.id], l.id), false, 'trucks stay ashore');
  g.cmdBoard(0, units.map((u) => u.id), l.id);
  run(g, 25);
  assert.equal(g.load(l), 3 * 2 + 2, '3 tanks (2 each) + 2 squads fill 8 slots');
  assert.equal(l.passengers.length, 5);
  for (const u of l.passengers) assert.equal(g.get(u.id), undefined, 'aboard units leave the map');
  const left = units.filter((u) => g.get(u.id));
  assert.equal(left.length, 1, 'one squad did not fit');
  assert.equal(left[0].order.type, 'idle');
});

test('a landing craft carries troops to another island and puts them ashore', () => {
  const { g, l } = setup();
  for (let i = 0; i < 3; i++) (l.passengers ||= []).push(g.addUnit(0, 'infantry', 0, 0));
  for (const u of l.passengers) g.entities.delete(u.id);
  const foe = find(g, 1, 'hq');
  assert.ok(g.cmdUnload(0, [l.id], foe.x, foe.y));
  run(g, 120);
  assert.equal(l.passengers.length, 0, 'everyone landed');
  const troops = [...g.entities.values()].filter((e) => e.owner === 0 && e.type === 'infantry' && Math.hypot(e.x - foe.x, e.y - foe.y) < 25);
  assert.ok(troops.length > 0, 'troops ashore on the enemy island');
});

test('troops aboard go down with a sunk landing craft', () => {
  const { g, l } = setup();
  l.passengers = [g.addUnit(0, 'tank', 0, 0)];
  g.entities.delete(l.passengers[0].id);
  const lost = g.players[0].stats.lost;
  g.applyDamage(l, 9999, 1);
  assert.equal(g.players[0].stats.lost - lost, 2);
});

test('attack submarines fire cruise missiles at targets ashore', () => {
  const { g, hq } = setup();
  const beach = g.beachNear({ x: 0, y: 0 }, hq.x, hq.y, 30) || null;
  const m = g.map;
  // Put an enemy sub just off our coast and see it hit the base.
  let spot = null, bestD = Infinity;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    if (!m.isOpenSea(x, y)) continue;
    const d = Math.hypot(x - hq.x, y - hq.y);
    if (d < bestD) { bestD = d; spot = { x, y }; }
  }
  assert.ok(spot && beach !== undefined);
  const sub = g.addUnit(1, 'submarine', spot.x + 0.5, spot.y + 0.5);
  g.players[1].explored.fill(1);
  const before = hq.hp;
  g.cmdAttack(1, [sub.id], hq.id);
  run(g, 30);
  assert.ok(hq.hp < before, `HQ took ${before - hq.hp} from the submarine`);
  assert.equal(UNITS.submarine.secondary, 'sub_missile');
});
