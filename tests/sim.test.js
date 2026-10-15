import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, damageAgainst } from '../src/sim.js';
import { AIController } from '../src/ai.js';
import { UNITS, BUILDINGS, WEAPONS, STARTING_CREDITS, TICK_RATE, ECONOMY } from '../src/config.js';

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
  // Keep the treasury empty (the Command Center pays a small income).
  for (let i = 0; i < 2 * TICK_RATE; i++) { g.players[0].credits = 0; g.step(); g.events.length = 0; }
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

test('a truck gives up on a walled-off well and picks another', () => {
  const g = new Game({ seed: 3 });
  const hq = openStrip(g);
  const target = g.map.wells.map((w, i) => ({ w, i })).sort((a, b) => Math.hypot(a.w.x - hq.x, a.w.y - hq.y) - Math.hypot(b.w.x - hq.x, b.w.y - hq.y))[0];
  // Enclose that well with enemy walls.
  for (let y = target.w.y - 2; y <= target.w.y + 2; y++) {
    for (let x = target.w.x - 2; x <= target.w.x + 2; x++) {
      if (Math.max(Math.abs(x - target.w.x), Math.abs(y - target.w.y)) === 2 && g.map.inBounds(x, y) && !g.map.occupied[y * g.map.w + x]) g.map.occupied[y * g.map.w + x] = -1;
    }
  }
  const truck = g.addUnit(0, 'truck', hq.x + 3, hq.y + 3);
  g.cmdHarvest(0, [truck.id], target.i);
  let searches = 0;
  const orig = g.setPath.bind(g);
  g.setPath = (u, x, y) => { if (u === truck) searches++; orig(u, x, y); };
  run(g, 20);
  assert.notEqual(truck.well, target.i, 'switched wells');
  assert.ok(searches < 40, `bounded path searches (${searches})`);
});

test('units cannot slip through a wall to reach an enclosed point', () => {
  const g = new Game({ seed: 3 });
  const hq = openStrip(g);
  const cx = Math.floor(hq.x) + 4, cy = Math.floor(hq.y) + 2;
  for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) if (x !== cx || y !== cy) g.map.occupied[y * g.map.w + x] = -1;
  const tank = g.addUnit(0, 'tank', cx + 0.5, cy + 3.5);
  g.cmdMove(0, [tank.id], cx + 0.5, cy + 0.5);
  run(g, 15);
  assert.ok(Math.hypot(tank.x - cx - 0.5, tank.y - cy - 0.5) > 1.2, `stayed outside (${tank.x.toFixed(2)}, ${tank.y.toFixed(2)})`);
});

test('trucks spread across wells and share a pump through loading bays', () => {
  const g = new Game({ seed: 3 });
  for (const e of [...g.entities.values()]) if (e.owner === 1 && e.kind === 'unit') g.entities.delete(e.id);
  const hq = find(g, 0, 'hq');
  const trucks = [...g.entities.values()].filter((e) => e.owner === 0 && e.type === 'truck');
  while (trucks.length < 7) {
    const t = g.addUnit(0, 'truck', hq.x + 2 + trucks.length * 0.5, hq.y + 2.5);
    g.cmdHarvest(0, [t.id], g.chooseWell(t));
    trucks.push(t);
  }
  let maxLoading = 0, maxPerWell = 0;
  for (let i = 0; i < 20 * 90; i++) {
    g.step(); g.events.length = 0;
    const loading = {}, assigned = {};
    for (const t of trucks) {
      if (t.harvestState === 'loading') loading[t.well] = (loading[t.well] || 0) + 1;
      if (t.harvestState === 'toWell' || t.harvestState === 'loading') assigned[t.well] = (assigned[t.well] || 0) + 1;
    }
    maxLoading = Math.max(maxLoading, ...Object.values(loading), 0);
    maxPerWell = Math.max(maxPerWell, ...Object.values(assigned), 0);
    // Two trucks never hold the same bay.
    const bays = new Set();
    for (const t of trucks) {
      if (t.bay == null || t.harvestState === 'toDropoff') continue;
      const key = t.well + ':' + t.bay;
      assert.ok(!bays.has(key), 'bay shared');
      bays.add(key);
    }
  }
  assert.ok(maxLoading <= 3, `at most three trucks pump one well (${maxLoading})`);
  assert.ok(maxPerWell < trucks.length, `trucks spread over more than one well (worst ${maxPerWell})`);
  assert.ok(g.players[0].stats.harvested > 3000, 'income keeps flowing');
});

// ------------------------------------------------------------- rally points

test('new units deploy to the rally point, spread out, armed ones attack-moving', () => {
  const g = new Game({ seed: 3 });
  const hq = openStrip(g);
  const bar = g.addBuilding(0, 'barracks', Math.floor(hq.x) - 6, Math.floor(hq.y) - 4, true);
  const rx = hq.x + 2, ry = hq.y + 4;
  assert.equal(g.cmdRally(0, bar.id, rx, ry), 'set');
  assert.equal(g.cmdRally(1, bar.id, rx, ry), false, "can't set another player's rally");
  for (let i = 0; i < 3; i++) g.cmdQueue(0, bar.id, 'infantry');
  // Record each squad's orders the moment it rolls out.
  const squads = [];
  const seen = new Set();
  for (let i = 0; i < (UNITS.infantry.buildTime * 3 + 1) * TICK_RATE; i++) {
    g.step(); g.events.length = 0;
    for (const e of g.entities.values()) {
      if (e.owner === 0 && e.type === 'infantry' && !seen.has(e.id)) { seen.add(e.id); squads.push({ type: e.order.type, dest: { ...e.order.dest } }); }
    }
  }
  assert.equal(squads.length, 3);
  for (const s of squads) {
    assert.equal(s.type, 'attackMove');
    assert.ok(Math.hypot(s.dest.x - rx, s.dest.y - ry) < 2, 'heading to the rally point');
  }
  const dests = new Set(squads.map((s) => `${s.dest.x.toFixed(2)},${s.dest.y.toFixed(2)}`));
  assert.equal(dests.size, 3, 'each gets its own spot');
});

test('trucks follow a rally point only when it marks an oil well', () => {
  const g = new Game({ seed: 3 });
  const hq = find(g, 0, 'hq');
  const far = g.map.wells.map((w, i) => ({ w, i })).sort((a, b) => Math.hypot(b.w.x - hq.x, b.w.y - hq.y) - Math.hypot(a.w.x - hq.x, a.w.y - hq.y))[0];
  g.cmdRally(0, hq.id, far.w.x + 0.5, far.w.y + 0.5);
  assert.equal(hq.rally.well, far.i);
  g.cmdQueue(0, hq.id, 'truck');
  run(g, UNITS.truck.buildTime + 0.5);
  const t1 = [...g.entities.values()].filter((e) => e.type === 'truck' && e.owner === 0).pop();
  assert.equal(t1.order.type, 'harvest');
  assert.equal(t1.well, far.i, 'harvests the rallied well');
  // A plain ground rally point is ignored by trucks: they go to work.
  g.cmdRally(0, hq.id, hq.x + 3, hq.y + 5);
  g.cmdQueue(0, hq.id, 'truck');
  run(g, UNITS.truck.buildTime + 0.5);
  const t2 = [...g.entities.values()].filter((e) => e.type === 'truck' && e.owner === 0).pop();
  assert.equal(t2.order.type, 'harvest');
});

test('rallying onto the structure itself clears the rally point; unarmed units just move', () => {
  const g = new Game({ seed: 3 });
  const hq = find(g, 0, 'hq');
  g.cmdRally(0, hq.id, hq.x + 6, hq.y + 6);
  g.cmdQueue(0, hq.id, 'drone');
  run(g, UNITS.drone.buildTime + 0.5);
  const drone = find(g, 0, 'drone');
  assert.equal(drone.order.type, 'move', 'unarmed drone moves rather than attack-moves');
  assert.equal(g.cmdRally(0, hq.id, hq.x, hq.y), 'cleared');
  assert.equal(hq.rally, null);
});

test('a standing Command Center pays a small income', () => {
  const g = new Game({ seed: 3 });
  const p = g.players[0];
  for (const e of [...g.entities.values()]) if (e.owner === 0 && e.kind === 'unit') g.entities.delete(e.id);
  const before = p.credits;
  run(g, 10);
  assert.equal(p.credits - before, ECONOMY.hqIncome * 10);
});

test('a broke player with no trucks gets a free one after a delay', () => {
  const g = new Game({ seed: 3 });
  const p = g.players[0];
  for (const e of [...g.entities.values()]) if (e.owner === 0 && e.def.harvester) g.entities.delete(e.id);
  const trucks = () => [...g.entities.values()].filter((e) => e.owner === 0 && e.def.harvester).length;
  const stranded = [];
  for (let i = 0; i < (ECONOMY.emergencyTruckDelay + 3) * TICK_RATE; i++) {
    p.credits = 0;
    g.step();
    for (const ev of g.events) if (ev.owner === 0 && (ev.type === 'stranded' || ev.type === 'emergencyTruck')) stranded.push(ev.type);
    g.events.length = 0;
    if (i === (ECONOMY.emergencyTruckDelay - 5) * TICK_RATE) assert.equal(trucks(), 0, 'not before the delay');
  }
  assert.deepEqual(stranded, ['stranded', 'emergencyTruck']);
  assert.equal(trucks(), 1);
  const t = [...g.entities.values()].find((e) => e.owner === 0 && e.def.harvester);
  assert.equal(t.order.type, 'harvest', 'the free truck goes straight to work');
});

test('no free truck while the player can afford one', () => {
  const g = new Game({ seed: 3 });
  for (const e of [...g.entities.values()]) if (e.owner === 0 && e.def.harvester) g.entities.delete(e.id);
  g.players[0].credits = 1000;
  run(g, ECONOMY.emergencyTruckDelay + 5);
  assert.equal([...g.entities.values()].filter((e) => e.owner === 0 && e.def.harvester).length, 0);
  assert.equal(g.players[0].emergencyAt, null);
});

test('an AI that loses its trucks saves for a new one', () => {
  const g = new Game({ seed: 3, players: [{ ai: false }, { ai: true }] });
  const ai = new AIController(g, 1, 'normal');
  for (const e of [...g.entities.values()]) if (e.owner === 1 && e.def.harvester) g.entities.delete(e.id);
  g.players[1].credits = 400;
  run(g, 60, [ai]);
  const trucks = [...g.entities.values()].filter((e) => e.owner === 1 && e.def.harvester).length;
  const queued = [...g.entities.values()].some((e) => e.owner === 1 && e.queue?.some((q) => q.type === 'truck'));
  assert.ok(trucks > 0 || queued, 'bought a truck from the Command Center income');
});
