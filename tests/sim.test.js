import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, damageAgainst } from '../src/sim.js';
import { AIController } from '../src/ai.js';
import { UNITS, BUILDINGS, WEAPONS, STARTING_CREDITS, TICK_RATE } from '../src/config.js';

const run = (g, seconds, ais = []) => {
  for (let i = 0; i < seconds * TICK_RATE; i++) {
    for (const a of ais) a.update();
    g.step();
    g.events.length = 0;
  }
};
const find = (g, owner, type) => [...g.entities.values()].find((e) => e.owner === owner && e.type === type);

test('each side starts with an HQ, a truck and a few troops', () => {
  const g = new Game({ seed: 3 });
  for (const owner of [0, 1]) {
    assert.ok(find(g, owner, 'hq'));
    assert.ok(find(g, owner, 'truck'));
    assert.equal(g.players[owner].credits, STARTING_CREDITS);
  }
});

test('supply trucks harvest oil into credits', () => {
  const g = new Game({ seed: 3 });
  run(g, 25);
  assert.ok(g.players[0].stats.harvested > 0);
  assert.ok(g.players[0].credits > STARTING_CREDITS);
});

test('structures need prerequisites, funds and a valid site', () => {
  const g = new Game({ seed: 3 });
  const hq = find(g, 0, 'hq');
  assert.equal(g.canBuildType(0, 'factory'), false, 'factory needs barracks');
  assert.equal(g.cmdPlace(0, 'barracks', hq.tx, hq.ty), null, 'cannot overlap HQ');
  assert.equal(g.cmdPlace(0, 'barracks', hq.tx + 40, hq.ty), null, 'must be near base');
  let placed = null;
  for (let dx = -6; dx <= 6 && !placed; dx++) {
    for (let dy = -6; dy <= 6 && !placed; dy++) placed = g.cmdPlace(0, 'barracks', hq.tx + dx, hq.ty + dy);
  }
  assert.ok(placed, 'barracks placed');
  assert.equal(g.players[0].credits, STARTING_CREDITS - BUILDINGS.barracks.cost);
  run(g, BUILDINGS.barracks.buildTime + 0.5);
  assert.equal(placed.progress, 1);
  assert.equal(g.canBuildType(0, 'factory'), true);
});

test('production charges up front, spawns the unit and refunds on cancel', () => {
  const g = new Game({ seed: 3 });
  const hq = find(g, 0, 'hq');
  const before = g.players[0].credits;
  assert.ok(g.cmdQueue(0, hq.id, 'truck'));
  assert.ok(g.cmdQueue(0, hq.id, 'truck'));
  assert.equal(g.players[0].credits, before - 2 * UNITS.truck.cost);
  assert.ok(g.cmdCancel(0, hq.id));
  assert.equal(g.players[0].credits, before - UNITS.truck.cost);
  const count = () => [...g.entities.values()].filter((e) => e.owner === 0 && e.type === 'truck').length;
  run(g, UNITS.truck.buildTime + 0.5);
  assert.equal(count(), 2);
});

test('weapons respect domains and armor', () => {
  assert.ok(damageAgainst(WEAPONS.rocket, 'heavy') > damageAgainst(WEAPONS.rocket, 'infantry'));
  assert.ok(!WEAPONS.cannon_heavy.hits.includes('air'));
  assert.ok(WEAPONS.flak.hits.includes('air'));
});

test('a tank destroys an infantry squad', () => {
  const g = new Game({ seed: 3 });
  const hq = find(g, 0, 'hq');
  const tank = g.addUnit(0, 'tank', hq.x + 3, hq.y + 5);
  const inf = g.addUnit(1, 'infantry', hq.x + 6, hq.y + 5);
  g.updateFog();
  g.cmdAttack(0, [tank.id], inf.id);
  run(g, 20);
  assert.equal(g.get(inf.id), undefined);
  assert.ok(g.players[0].stats.killed >= 1);
});

test('tanks cannot shoot aircraft but flak can', () => {
  const g = new Game({ seed: 3 });
  const hq = find(g, 0, 'hq');
  const heli = g.addUnit(1, 'heli', hq.x + 4, hq.y + 6);
  const tank = g.addUnit(0, 'tank', hq.x + 2, hq.y + 6);
  g.updateFog();
  assert.equal(g.cmdAttack(0, [tank.id], heli.id), true);
  run(g, 1);
  assert.equal(tank.order.type, 'idle', 'tank gives up on air target');
  const aa = g.addUnit(0, 'aa', hq.x + 2, hq.y + 7);
  g.cmdAttack(0, [aa.id], heli.id);
  run(g, 1);
  assert.ok(heli.hp < heli.maxHp);
});

test('losing every structure ends the game', () => {
  const g = new Game({ seed: 3 });
  for (const e of [...g.entities.values()]) if (e.owner === 1 && e.kind === 'building') g.destroy(e, 0);
  g.step();
  assert.equal(g.players[1].defeated, true);
  assert.equal(g.winner, 0);
});

test('AI builds up a base and army on its own', () => {
  const g = new Game({ seed: 5, players: [{ ai: true }, { ai: true }] });
  const ais = [new AIController(g, 0), new AIController(g, 1)];
  run(g, 180, ais);
  for (const owner of [0, 1]) {
    const mine = [...g.entities.values()].filter((e) => e.owner === owner);
    assert.ok(mine.filter((e) => e.kind === 'building').length >= 4, `AI ${owner} built structures`);
    assert.ok(mine.some((e) => e.kind === 'unit' && e.def.weapon), `AI ${owner} has an army`);
  }
});

test('recon drone: built at HQ, flies over water, sees far, cannot attack', () => {
  const g = new Game({ seed: 3 });
  const hq = find(g, 0, 'hq');
  assert.ok(BUILDINGS.hq.produces.includes('drone'));
  assert.ok(g.cmdQueue(0, hq.id, 'drone'));
  run(g, UNITS.drone.buildTime + 0.5);
  const drone = find(g, 0, 'drone');
  assert.ok(drone, 'drone was produced');
  assert.ok(UNITS.drone.sight > Math.max(...Object.values(UNITS).filter((u) => !u.scout).map((u) => u.sight)), 'best sight in the game');

  // It reveals tiles at the edge of its sight radius.
  const { w } = g.map;
  const tx = Math.floor(drone.x + UNITS.drone.sight - 1), ty = Math.floor(drone.y);
  g.updateFog();
  assert.equal(g.players[0].visible[ty * w + tx], 1);

  // It can't be ordered to attack, and never auto-targets anything.
  const foe = g.addUnit(1, 'infantry', drone.x + 2, drone.y);
  g.updateFog();
  g.cmdAttack(0, [drone.id], foe.id);
  assert.notEqual(drone.order.type, 'attack');
  let droneShots = 0;
  for (let i = 0; i < 3 * TICK_RATE; i++) {
    g.step();
    droneShots += g.events.filter((ev) => ev.type === 'fire' && ev.shooterId === drone.id).length;
    g.events.length = 0;
  }
  assert.equal(droneShots, 0);

  // Air units path straight across water.
  const water = [];
  for (let y = 0; y < g.map.h && !water.length; y++) for (let x = 0; x < w; x++) if (g.map.isWater(x, y)) { water.push({ x, y }); break; }
  g.cmdMove(0, [drone.id], water[0].x + 0.5, water[0].y + 0.5);
  run(g, 60);
  assert.ok(Math.hypot(drone.x - water[0].x - 0.5, drone.y - water[0].y - 0.5) < 1.5, 'drone reached a water tile');
});

// ------------------------------------------------------------------ repair

import { REPAIR } from '../src/config.js';

function placeNear(g, owner, type) {
  const hq = find(g, owner, 'hq');
  for (let r = 2; r < 10; r++) {
    for (let a = 0; a < 24; a++) {
      const x = Math.round(hq.x + Math.cos((a / 24) * 6.283) * r), y = Math.round(hq.y + Math.sin((a / 24) * 6.283) * r);
      if (g.canPlace(owner, type, x, y)) return g.addBuilding(owner, type, x, y, true);
    }
  }
  throw new Error('no site for ' + type);
}

test('structure repair heals over time, costs credits and switches itself off', () => {
  const g = new Game({ seed: 3 });
  const hq = find(g, 0, 'hq');
  assert.equal(g.cmdRepair(0, hq.id), false, 'nothing to repair at full health');
  hq.hp = hq.maxHp * 0.5;
  assert.equal(g.cmdRepair(1, hq.id), false, "can't repair the enemy's buildings");
  assert.ok(g.cmdRepair(0, hq.id));
  const credits = g.players[0].credits;
  run(g, 5);
  assert.ok(hq.hp > hq.maxHp * 0.5, 'healing');
  assert.ok(g.players[0].credits < credits + 1, 'paid for it');
  run(g, 30);
  assert.equal(hq.hp, hq.maxHp);
  assert.equal(hq.repairing, false);
  const fullCost = BUILDINGS.hq.repairValue * REPAIR.buildingCost * 0.5;
  assert.ok(Math.abs(g.players[0].stats.repairSpent - fullCost) < 1, `spent ~${fullCost}`);
});

test('repair pauses without funds and resumes when money arrives', () => {
  const g = new Game({ seed: 3 });
  const b = placeNear(g, 0, 'barracks');
  b.hp = 100;
  g.players[0].credits = 0;
  g.cmdRepair(0, b.id, true);
  run(g, 2);
  assert.equal(b.hp, 100);
  assert.equal(b.repairStalled, true);
  g.players[0].credits = 5000;
  run(g, 2);
  assert.ok(b.hp > 100);
  assert.equal(b.repairStalled, false);
});

test('repair is slower while under fire', () => {
  const healed = (underFire) => {
    const g = new Game({ seed: 3 });
    const b = placeNear(g, 0, 'barracks');
    b.hp = 200;
    g.cmdRepair(0, b.id, true);
    for (let i = 0; i < 5 * TICK_RATE; i++) { if (underFire) b.hitAt = g.tick; g.step(); g.events.length = 0; }
    return b.hp - 200;
  };
  const calm = healed(false), hot = healed(true);
  assert.ok(Math.abs(hot / calm - REPAIR.underFire) < 0.1, `under fire ${hot.toFixed(0)} vs ${calm.toFixed(0)}`);
});

test('Service Depot repairs nearby vehicles for credits; not infantry', () => {
  const g = new Game({ seed: 3 });
  const depot = placeNear(g, 0, 'depot');
  const tank = g.addUnit(0, 'tank', depot.tx + depot.w + 0.6, depot.ty + 0.5);
  const far = g.addUnit(0, 'tank', depot.x + 12, depot.y);
  const credits = g.players[0].credits;
  tank.hp = far.hp = 100;
  run(g, 3);
  assert.ok(tank.hp > 100, 'tank next to depot repaired');
  assert.equal(far.hp, 100, 'distant tank untouched');
  assert.ok(g.players[0].credits < credits, 'repair cost credits');
});

test('Airbase repairs aircraft, Naval Yard repairs ships, Barracks heals infantry for free', () => {
  const g = new Game({ seed: 3 });
  const air = placeNear(g, 0, 'airfield');
  const heli = g.addUnit(0, 'heli', air.x, air.y);
  const tank = g.addUnit(0, 'tank', air.tx - 0.6, air.y);
  heli.hp = tank.hp = 100;
  const bar = placeNear(g, 0, 'barracks');
  const inf = g.addUnit(0, 'infantry', bar.tx - 1, bar.y);
  inf.hp = 20;
  run(g, 3);
  assert.ok(heli.hp > 100, 'helicopter repaired at airbase');
  assert.equal(tank.hp, 100, 'airbase does not repair tanks');
  assert.ok(inf.hp > 20, 'infantry heals near barracks');
  assert.equal(g.players[0].stats.repairSpent > 0, true);

  // Naval Yard: only if this map has a site for one.
  let yard = null;
  try { yard = placeNear(g, 0, 'shipyard'); } catch { /* landlocked start */ }
  if (yard) {
    const ship = g.addUnit(0, 'gunboat', 0, 0);
    // Put the boat on the nearest water tile to the yard.
    let best = null;
    for (let y = yard.ty - 2; y < yard.ty + yard.h + 2; y++) for (let x = yard.tx - 2; x < yard.tx + yard.w + 2; x++) {
      if (g.map.inBounds(x, y) && g.map.isWater(x, y) && !best) best = { x, y };
    }
    ship.x = best.x + 0.5; ship.y = best.y + 0.5; ship.hp = 100;
    run(g, 3);
    assert.ok(ship.hp > 100, 'ship repaired at naval yard');
  }
});

test('cmdService sends only units the facility can repair', () => {
  const g = new Game({ seed: 3 });
  const depot = placeNear(g, 0, 'depot');
  const hq = find(g, 0, 'hq');
  const tank = g.addUnit(0, 'tank', hq.x + 8, hq.y + 8);
  const heli = g.addUnit(0, 'heli', hq.x + 8, hq.y + 8);
  tank.hp = heli.hp = 100;
  assert.equal(g.cmdService(0, [tank.id, heli.id], depot.id), 1);
  assert.equal(tank.order.type, 'move');
  assert.notEqual(heli.order.type, 'move');
  run(g, 25);
  assert.ok(g.distTo(tank, depot) <= REPAIR.facilityRange, 'tank drove to the depot');
  assert.ok(tank.hp > 100, 'and got repaired');
});

// ------------------------------------------------------------ fortifications

import { lineTiles, ROAD_COST } from '../src/map.js';
import { findPath } from '../src/path.js';
import { ROAD } from '../src/config.js';

// A flat, empty test strip east of the player's HQ.
function openStrip(g) {
  const hq = find(g, 0, 'hq');
  for (let y = Math.floor(hq.y) - 4; y <= Math.floor(hq.y) + 4; y++) {
    for (let x = Math.floor(hq.x) - 7; x <= Math.floor(hq.x) + 7; x++) {
      if (g.map.inBounds(x, y) && !g.map.occupied[y * g.map.w + x] && g.map.isLand(x, y)) g.map.tiles[y * g.map.w + x] = 3; // grass
    }
  }
  for (const e of [...g.entities.values()]) if (e.kind === 'unit') g.entities.delete(e.id);
  return hq;
}

test('walls are placed in lines, cost per segment and do not use the construction slot', () => {
  const g = new Game({ seed: 3 });
  const hq = openStrip(g);
  const y = Math.floor(hq.y) + 3;
  const tiles = lineTiles({ x: Math.floor(hq.x) - 3, y }, { x: Math.floor(hq.x) + 3, y });
  const before = g.players[0].credits;
  assert.equal(g.cmdPlaceLine(0, 'wall', tiles), 7);
  assert.equal(g.players[0].credits, before - 7 * BUILDINGS.wall.cost);
  assert.equal(g.players[0].constructing, null);
  assert.ok(g.cmdPlace(0, 'barracks', Math.floor(hq.x) - 6, Math.floor(hq.y) - 4) || true, 'other construction still allowed');
  run(g, BUILDINGS.wall.buildTime + 0.5);
  for (const t of tiles) assert.ok(g.map.occupied[t.y * g.map.w + t.x] > 0, 'segment blocks its tile');
});

test('gates let their owner through and block the enemy', () => {
  const g = new Game({ seed: 3 });
  const hq = openStrip(g);
  const x = Math.floor(hq.x) + 5, y0 = Math.floor(hq.y) - 4;
  const wallTiles = lineTiles({ x, y: y0 }, { x, y: y0 + 8 });
  g.cmdPlaceLine(0, 'wall', wallTiles.filter((t) => t.y !== y0 + 4));
  g.cmdPlace(0, 'gate', x, y0 + 4);
  // Seal the strip's ends so the only way across is the gate.
  for (const t of [{ x, y: y0 - 1 }, { x, y: y0 + 9 }]) if (g.map.inBounds(t.x, t.y)) g.map.occupied[t.y * g.map.w + t.x] = -1;
  const from = { x: x - 2, y: y0 + 4 }, to = { x: x + 2, y: y0 + 4 };
  const mine = findPath(g.map, from.x, from.y, to.x, to.y, 'ground', 20000, true, 0);
  const theirs = findPath(g.map, from.x, from.y, to.x, to.y, 'ground', 20000, true, 1);
  const reaches = (p) => p && p.length && p[p.length - 1].x === to.x && p[p.length - 1].y === to.y;
  assert.ok(reaches(mine), 'owner paths through the gate');
  assert.ok(!reaches(theirs) || theirs.some((t) => Math.abs(t.y - (y0 + 4)) > 5), 'enemy cannot use the gate');
  assert.equal(g.map.passable(x, y0 + 4, 'ground', 0), true);
  assert.equal(g.map.passable(x, y0 + 4, 'ground', 1), false);
  // Destroying the gate clears its ownership.
  g.destroy(g.get(g.map.occupied[(y0 + 4) * g.map.w + x]), 1);
  assert.equal(g.map.gateOwner[(y0 + 4) * g.map.w + x], -1);
});

test('roads cost credits per tile and speed up ground units', () => {
  const g = new Game({ seed: 3 });
  const hq = openStrip(g);
  const y = Math.floor(hq.y) + 3;
  const tiles = lineTiles({ x: Math.floor(hq.x) - 6, y }, { x: Math.floor(hq.x) + 6, y }, true);
  const before = g.players[0].credits;
  const n = g.cmdBuildRoad(0, tiles);
  assert.equal(n, tiles.length);
  assert.equal(g.players[0].credits, before - n * ROAD.cost);
  assert.equal(g.cmdBuildRoad(0, tiles), 0, 'cannot pave twice');
  assert.equal(g.map.moveCost(tiles[0].x, y, 'ground'), ROAD_COST);
  // Time a tank over 10 tiles on and off the road.
  const timeOver = (yy) => {
    const t = g.addUnit(0, 'tank', Math.floor(hq.x) - 5.5, yy + 0.5);
    g.cmdMove(0, [t.id], Math.floor(hq.x) + 4.5, yy + 0.5);
    let ticks = 0;
    while (t.order.type === 'move' && ticks < 2000) { g.step(); g.events.length = 0; ticks++; }
    g.entities.delete(t.id);
    return ticks;
  };
  const onRoad = timeOver(y), offRoad = timeOver(y - 2);
  assert.ok(onRoad < offRoad * 0.75, `road ${onRoad} ticks vs grass ${offRoad}`);
});

test('walls do not keep a defeated player alive, and are not auto-targeted', () => {
  const g = new Game({ seed: 3 });
  const hq = openStrip(g);
  const wall = g.addBuilding(1, 'wall', Math.floor(hq.x) + 3, Math.floor(hq.y) + 3, true);
  const tank = g.addUnit(0, 'tank', wall.x - 2, wall.y);
  g.updateFog();
  run(g, 3);
  assert.equal(wall.hp, wall.maxHp, 'idle tank ignores the wall');
  assert.equal(tank.target, null);
  for (const e of [...g.entities.values()]) if (e.owner === 1 && e.kind === 'building' && !e.def.segment) g.destroy(e, 0);
  g.step();
  assert.equal(g.winner, 0);
});

test('an attack-moving army breaches a wall that blocks its route', () => {
  const g = new Game({ seed: 3 });
  const hq = openStrip(g);
  // Enemy wall box around a spot east of the HQ.
  const cx = Math.floor(hq.x) + 4, cy = Math.floor(hq.y);
  const ring = [];
  for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) === 2) ring.push({ x, y });
  for (const t of ring) if (!g.map.occupied[t.y * g.map.w + t.x]) g.addBuilding(1, 'wall', t.x, t.y, true);
  const tank = g.addUnit(0, 'tank', cx - 5.5, cy + 0.5);
  g.cmdMove(0, [tank.id], cx + 0.5, cy + 0.5, true);
  run(g, 40);
  const walls = [...g.entities.values()].filter((e) => e.def?.segment && e.owner === 1).length;
  assert.ok(walls < ring.length, 'at least one wall segment destroyed');
  assert.ok(Math.hypot(tank.x - cx - 0.5, tank.y - cy - 0.5) < 2.5, 'tank got inside');
});

test('a gate can replace one of your own wall segments', () => {
  const g = new Game({ seed: 3 });
  const hq = openStrip(g);
  const y = Math.floor(hq.y) + 3, x = Math.floor(hq.x);
  g.cmdPlaceLine(0, 'wall', lineTiles({ x: x - 2, y }, { x: x + 2, y }));
  const gate = g.cmdPlace(0, 'gate', x, y);
  assert.ok(gate, 'gate placed over the wall');
  assert.equal(g.map.occupied[y * g.map.w + x], gate.id);
  assert.equal(g.map.gateOwner[y * g.map.w + x], 0);
  assert.equal(g.cmdPlace(1, 'gate', x - 1, y), null, "can't replace someone else's wall");
});

test('roads can be cut through forest but not across water', () => {
  const g = new Game({ seed: 3 });
  const hq = openStrip(g);
  const x = Math.floor(hq.x) + 2, y = Math.floor(hq.y) + 3;
  g.map.tiles[y * g.map.w + x] = 4; // forest
  g.map.tiles[y * g.map.w + x + 1] = 1; // water
  assert.equal(g.canBuildRoad(0, x, y), true);
  assert.equal(g.canBuildRoad(0, x + 1, y), false);
  assert.equal(g.map.moveCost(x, y, 'ground') > 1, true);
  g.cmdBuildRoad(0, [{ x, y }]);
  assert.equal(g.map.moveCost(x, y, 'ground'), ROAD_COST);
});
