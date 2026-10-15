import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/sim.js';
import { AIController } from '../src/ai.js';
import { UNITS, TECHS, RESEARCH, TICK_RATE, BUILDINGS } from '../src/config.js';

const run = (g, seconds, ais = []) => {
  for (let i = 0; i < seconds * TICK_RATE; i++) {
    for (const a of ais) a.update();
    g.step();
    g.events.length = 0;
  }
};
const find = (g, owner, type) => [...g.entities.values()].find((e) => e.owner === owner && e.type === type);

function placeNear(g, owner, type) {
  const hq = find(g, owner, 'hq');
  for (let r = 2; r < 12; r++) {
    for (let a = 0; a < 24; a++) {
      const x = Math.round(hq.x + Math.cos((a / 24) * 6.283) * r), y = Math.round(hq.y + Math.sin((a / 24) * 6.283) * r);
      if (g.canPlace(owner, type, x, y)) return g.addBuilding(owner, type, x, y, true);
    }
  }
  throw new Error('no site for ' + type);
}

test('a Research Lab turns credits into research points and can be paused', () => {
  const g = new Game({ seed: 3 });
  const p = g.players[0];
  const lab = placeNear(g, 0, 'lab');
  p.credits = 1000;
  run(g, 10);
  assert.equal(p.research.points, 10 * RESEARCH.rate);
  g.cmdLabToggle(0, lab.id, false);
  run(g, 5);
  assert.equal(p.research.points, 10 * RESEARCH.rate, 'paused lab makes nothing');
  g.cmdLabToggle(0, lab.id, true);
  p.credits = 0;
  // Keep the treasury empty (the Command Center pays a small income).
  for (let i = 0; i < 3 * TICK_RATE; i++) { p.credits = Math.min(p.credits, RESEARCH.cost - 1); g.step(); g.events.length = 0; }
  assert.equal(p.research.points, 10 * RESEARCH.rate, 'no research without funds');
  assert.equal(lab.researchStalled, true);
});

test('researched techs unlock units and structures', () => {
  const g = new Game({ seed: 3 });
  const p = g.players[0];
  const barracks = placeNear(g, 0, 'barracks');
  p.credits = 10000;
  assert.equal(g.cmdQueue(0, barracks.id, 'commando'), false, 'locked before research');
  assert.equal(g.cmdResearch(0, 'specops'), false, 'not enough points');
  p.research.points = TECHS.specops.points;
  assert.equal(g.cmdResearch(0, 'specops'), true);
  assert.equal(p.research.points, 0);
  assert.equal(g.cmdQueue(0, barracks.id, 'commando'), true);
  // The silo needs its prerequisite tech, then its own.
  placeNear(g, 0, 'barracks');
  placeNear(g, 0, 'factory');
  placeNear(g, 0, 'lab');
  assert.equal(g.canBuildType(0, 'silo'), false);
  p.research.points = 1000;
  assert.equal(g.cmdResearch(0, 'icbm'), false, 'requires Advanced Optics');
  assert.ok(g.cmdResearch(0, 'optics'));
  assert.ok(g.cmdResearch(0, 'icbm'));
  assert.equal(g.canBuildType(0, 'silo'), true);
});

test('Advanced Optics extends sight; Composite Armor reduces vehicle damage', () => {
  const g = new Game({ seed: 3 });
  const tank = g.addUnit(0, 'tank', 20.5, 20.5);
  const inf = g.addUnit(0, 'infantry', 22.5, 20.5);
  assert.equal(g.sightOf(tank), UNITS.tank.sight);
  g.players[0].research.done.add('optics').add('armor');
  assert.equal(g.sightOf(tank), UNITS.tank.sight + TECHS.optics.sightBonus);
  g.applyDamage(tank, 100, 1);
  g.applyDamage(inf, 50, 1);
  assert.equal(tank.hp, UNITS.tank.hp - 80);
  assert.equal(inf.hp, UNITS.infantry.hp - 50, 'infantry unaffected');
});

test('submarines are hidden until enemies get close or they fire', () => {
  const g = new Game({ seed: 3 });
  // Find open sea far from both bases.
  const m = g.map;
  let spot = null;
  for (let y = 0; y < m.h && !spot; y++) for (let x = 0; x < m.w && !spot; x++) {
    if (m.isOpenSea(x, y) && m.starts.every((s) => Math.hypot(s.x - x, s.y - y) > 20)
      && [[-2, 0], [2, 0], [0, 2], [0, -2], [5, 0], [-5, 0]].every(([dx, dy]) => m.isOpenSea(x + dx, y + dy))) spot = { x, y };
  }
  const sub = g.addUnit(1, 'submarine', spot.x + 0.5, spot.y + 0.5);
  const boat = g.addUnit(0, 'gunboat', spot.x + 5.5, spot.y + 0.5); // within sight, outside sonar
  g.updateDetection(); g.updateFog();
  assert.equal(g.isVisibleTo(0, sub), false, 'out of detection range');
  boat.x = spot.x + 3.5;
  g.updateDetection(); g.updateFog();
  assert.equal(g.isVisibleTo(0, sub), true, 'within sonar range');
  g.fire(sub, { speed: 8, fx: 'torpedo' }, boat, 'torpedo');
  boat.x = spot.x + 5.5;
  g.updateDetection(); g.updateFog();
  assert.equal(g.isVisibleTo(0, sub), true, 'revealed for a moment after firing');
  // A drone overhead sees the water but not the sub (and can't be torpedoed).
  g.entities.delete(boat.id);
  const drone = g.addUnit(0, 'drone', spot.x + 4.5, spot.y + 0.5);
  drone.order = { type: 'idle' };
  run(g, 3);
  assert.equal(g.players[0].visible[spot.y * m.w + spot.x], 1, 'the drone can see the tile');
  assert.equal(g.isVisibleTo(0, sub), false, 'hidden again');
});

test('paratroopers fly to the rally point, drop, and the transport flies home', () => {
  const g = new Game({ seed: 3 });
  const p = g.players[0];
  p.credits = 10000;
  p.research.done.add('airborne');
  placeNear(g, 0, 'barracks');
  placeNear(g, 0, 'factory');
  const air = placeNear(g, 0, 'airfield');
  const hq = find(g, 0, 'hq');
  const zone = { x: hq.x + 12, y: hq.y + 6 };
  air.rally = { x: zone.x, y: zone.y };
  assert.ok(g.cmdQueue(0, air.id, 'paratroopers'));
  let dropped = false;
  for (let i = 0; i < 60 * TICK_RATE; i++) {
    g.step();
    if (g.events.some((e) => e.type === 'paradrop')) dropped = true;
    g.events.length = 0;
  }
  assert.ok(dropped, 'troops were dropped');
  const paras = [...g.entities.values()].filter((e) => e.owner === 0 && e.type === 'para');
  assert.equal(paras.length, UNITS.paratroopers.drop.count);
  for (const u of paras) {
    assert.ok(Math.hypot(u.x - zone.x, u.y - zone.y) < 6, 'landed in the drop zone');
    assert.ok(!(u.dropT > 0), 'on the ground');
  }
  assert.equal(find(g, 0, 'paratroopers'), undefined, 'transport left after returning');
});

test('a charged ICBM silo launches anywhere and devastates the target', () => {
  const g = new Game({ seed: 3 });
  const p = g.players[0];
  p.research.done.add('optics').add('icbm');
  placeNear(g, 0, 'barracks');
  placeNear(g, 0, 'factory');
  placeNear(g, 0, 'lab');
  const silo = placeNear(g, 0, 'silo');
  const foe = find(g, 1, 'hq');
  assert.equal(g.cmdLaunch(0, silo.id, foe.x, foe.y), false, 'not charged yet');
  run(g, BUILDINGS.silo.missile.charge + 1);
  assert.equal(silo.charge, 1);
  const hp = foe.hp;
  assert.ok(g.cmdLaunch(0, silo.id, foe.x, foe.y));
  assert.equal(silo.charge, 0);
  run(g, 30);
  assert.ok(foe.hp < hp - 1000, `HQ took ${hp - foe.hp}`);
});

test('the AI researches and fields new technology', () => {
  const g = new Game({ seed: 3 });
  const ais = [new AIController(g, 0, 'hard'), new AIController(g, 1, 'hard')];
  run(g, 900, ais);
  const done = g.players.map((p) => p.research.done.size);
  assert.ok(Math.max(...done) >= 3, `techs researched: ${done}`);
});
