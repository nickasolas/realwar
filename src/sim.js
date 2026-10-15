import {
  DT, TICK_RATE, UNITS, BUILDINGS, WEAPONS, FACTIONS, STARTING_CREDITS,
  TRUCK_CAPACITY, HARVEST_RATE, BUILD_RADIUS, REPAIR, ROAD, MAX_LINE,
} from './config.js';
import { generateMap } from './map.js';
import { Terrain } from './config.js';
import { findPath } from './path.js';
import { createRng } from './rng.js';

const MAX_QUEUE = 5;
const FOG_INTERVAL = 4; // ticks between visibility refreshes
const REPAIR_INTERVAL = 5; // ticks between repair updates
const PATHS_PER_TICK = 4; // group orders path at most this many units per tick
// Each well has loading bays on opposite sides of the pumpjack.
const WELL_BAYS = 3;
const BAY_OFFSETS = [[0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]];
const BUSY_WELL_PENALTY = 7; // tiles of extra travel a truck accepts per truck ahead of it

export function damageAgainst(weapon, armor) {
  return weapon.damage * (weapon.vs?.[armor] ?? 1);
}

export function canHit(weapon, target) {
  const domain = target.kind === 'building' ? 'ground' : target.def.domain;
  return weapon.hits.includes(domain);
}

export class Game {
  constructor({ seed = 1, mapSize = 96, players = [{ ai: false }, { ai: true }] } = {}) {
    this.seed = seed;
    this.rng = createRng(seed ^ 0x9e3779b9);
    this.map = generateMap(seed, mapSize, mapSize);
    this.tick = 0;
    this.time = 0;
    this.nextId = 1;
    this.entities = new Map();
    this.projectiles = [];
    this.events = []; // consumed by the renderer each frame
    this.winner = null;
    this.players = players.map((p, i) => ({
      id: i,
      faction: FACTIONS[i],
      ai: !!p.ai,
      credits: STARTING_CREDITS,
      defeated: false,
      constructing: null, // id of the structure currently being built
      visible: new Uint8Array(this.map.w * this.map.h),
      explored: new Uint8Array(this.map.w * this.map.h),
      stats: { killed: 0, lost: 0, harvested: 0, repairSpent: 0 },
    }));
    for (const p of this.players) this.setupBase(p);
    this.updateFog();
  }

  // ---------------------------------------------------------------- setup

  setupBase(player) {
    const s = this.map.starts[player.id];
    const hq = this.addBuilding(player.id, 'hq', s.x - 1, s.y - 1, true);
    const dir = s.x < this.map.w / 2 ? 1 : -1;
    const truck = this.addUnit(player.id, 'truck', s.x + 3 * dir + 0.5, s.y + 2.5);
    this.addUnit(player.id, 'infantry', s.x - 2 * dir + 0.5, s.y + 3.5);
    this.addUnit(player.id, 'infantry', s.x - 1 * dir + 0.5, s.y + 3.5);
    this.addUnit(player.id, 'scout', s.x + 0.5, s.y + 3.5);
    hq.rally = null;
    this.cmdHarvest(player.id, [truck.id], this.chooseWell(truck));
  }

  addUnit(owner, type, x, y) {
    const def = UNITS[type];
    const u = {
      id: this.nextId++, kind: 'unit', type, def, owner,
      x, y, angle: owner === 0 ? 0.8 : -2.3,
      hp: def.hp, maxHp: def.hp, radius: def.radius,
      order: { type: 'idle' }, path: null, pathGoal: null, repathAt: 0,
      cooldown: 0, cooldown2: 0, target: null,
      cargo: 0, harvestState: null, well: null,
      altitude: def.domain === 'air' ? 1 : 0,
      lastProgress: 0, stuckTicks: 0,
    };
    this.entities.set(u.id, u);
    return u;
  }

  addBuilding(owner, type, tx, ty, complete = false) {
    const def = BUILDINGS[type];
    const b = {
      id: this.nextId++, kind: 'building', type, def, owner,
      tx, ty, w: def.w, h: def.h, x: tx + def.w / 2, y: ty + def.h / 2,
      hp: complete ? def.hp : def.hp * 0.1, maxHp: def.hp, radius: Math.max(def.w, def.h) / 2,
      progress: complete ? 1 : 0, queue: [], rally: null, cooldown: 0, target: null,
    };
    this.map.setOccupied(tx, ty, def.w, def.h, b.id);
    if (def.gate) this.setGate(b, owner);
    this.entities.set(b.id, b);
    return b;
  }

  // ------------------------------------------------------------- queries

  get(id) { return this.entities.get(id); }

  isEnemy(a, b) { return a.owner !== b.owner; }

  // Edge-to-edge distance in tiles between an entity and a target.
  distTo(a, b) {
    if (b.kind === 'building') {
      const dx = Math.max(b.tx - a.x, 0, a.x - (b.tx + b.w));
      const dy = Math.max(b.ty - a.y, 0, a.y - (b.ty + b.h));
      return Math.hypot(dx, dy);
    }
    return Math.max(0, Math.hypot(a.x - b.x, a.y - b.y) - b.radius);
  }

  hasBuilding(owner, type, completeOnly = true) {
    for (const e of this.entities.values()) {
      if (e.kind === 'building' && e.owner === owner && e.type === type && (!completeOnly || e.progress >= 1)) return true;
    }
    return false;
  }

  canBuildType(owner, type) {
    const def = BUILDINGS[type];
    if (!def || def.buildable === false) return false;
    return (def.requires || []).every((r) => this.hasBuilding(owner, r));
  }

  // Is tile (tx,ty) footprint within build radius of a finished friendly structure?
  inBuildRadius(owner, tx, ty, w, h) {
    for (const e of this.entities.values()) {
      if (e.kind !== 'building' || e.owner !== owner || e.progress < 1) continue;
      const dx = Math.max(e.tx - (tx + w), 0, tx - (e.tx + e.w));
      const dy = Math.max(e.ty - (ty + h), 0, ty - (e.ty + e.h));
      if (Math.max(dx, dy) <= BUILD_RADIUS) return true;
    }
    return false;
  }

  canPlace(owner, type, tx, ty) {
    const def = BUILDINGS[type];
    if (def.segment) {
      // Walls and gates can also go through woodland; water and rock stay natural barriers.
      if (!this.map.inBounds(tx, ty) || this.map.occupied[ty * this.map.w + tx] || !this.map.isLand(tx, ty)) return false;
    } else if (!this.map.canPlace(tx, ty, def.w, def.h, def.coastal)) return false;
    if (!this.inBuildRadius(owner, tx, ty, def.w, def.h)) return false;
    for (const well of this.map.wells) {
      if (well.x >= tx && well.x < tx + def.w && well.y >= ty && well.y < ty + def.h) return false;
    }
    // Don't drop a structure on top of units.
    for (const e of this.entities.values()) {
      if (e.kind !== 'unit' || e.def.domain === 'air') continue;
      if (e.x > tx - 0.2 && e.x < tx + def.w + 0.2 && e.y > ty - 0.2 && e.y < ty + def.h + 0.2) return false;
    }
    return true;
  }

  isVisibleTo(playerId, e) {
    const vis = this.players[playerId].visible;
    if (e.kind === 'building') {
      for (let y = e.ty; y < e.ty + e.h; y++) {
        for (let x = e.tx; x < e.tx + e.w; x++) if (vis[y * this.map.w + x]) return true;
      }
      return false;
    }
    const tx = Math.floor(e.x), ty = Math.floor(e.y);
    return this.map.inBounds(tx, ty) && vis[ty * this.map.w + tx] === 1;
  }

  // ------------------------------------------------------------ commands

  ownedUnits(playerId, ids) {
    return ids.map((id) => this.get(id)).filter((e) => e && e.owner === playerId && e.kind === 'unit');
  }

  cmdMove(playerId, ids, x, y, attackMove = false) {
    const units = this.ownedUnits(playerId, ids);
    const slots = formationSlots(units.length);
    // Spread the group so it doesn't fight over one tile.
    units.forEach((u, i) => {
      const s = slots[i];
      const dest = { x: x + s.x, y: y + s.y };
      u.order = { type: attackMove ? 'attackMove' : 'move', dest };
      u.target = null;
      u.harvestState = null;
      // Big groups spread their path searches over a few ticks so a whole
      // army being ordered at once doesn't stall a single frame.
      if (i < PATHS_PER_TICK) this.setPath(u, dest.x, dest.y);
      else { u.path = null; u.pendingPath = { at: this.tick + Math.floor(i / PATHS_PER_TICK) }; }
    });
    return units.length > 0;
  }

  cmdAttack(playerId, ids, targetId) {
    const target = this.get(targetId);
    if (!target) return false;
    const units = this.ownedUnits(playerId, ids);
    for (const u of units) {
      if (!u.def.weapon) continue;
      u.order = { type: 'attack', targetId };
      u.pendingPath = null;
      u.target = targetId;
      u.harvestState = null;
      u.path = null;
      u.repathAt = 0;
    }
    return units.length > 0;
  }

  cmdHarvest(playerId, ids, wellIndex) {
    const units = this.ownedUnits(playerId, ids).filter((u) => u.def.harvester);
    for (const u of units) {
      u.order = { type: 'harvest' };
      u.pendingPath = null;
      this.releaseBay(u);
      u.well = wellIndex;
      u.harvestState = u.cargo >= TRUCK_CAPACITY ? 'toDropoff' : 'toWell';
      u.path = null;
      u.repathAt = 0;
    }
    return units.length > 0;
  }

  cmdStop(playerId, ids) {
    for (const u of this.ownedUnits(playerId, ids)) {
      u.order = { type: 'idle' };
      u.pendingPath = null;
      u.path = null;
      u.target = null;
      u.harvestState = null;
    }
  }

  cmdQueue(playerId, buildingId, unitType) {
    const b = this.get(buildingId);
    if (!b || b.owner !== playerId || b.kind !== 'building') return false;
    if (!b.def.produces?.includes(unitType)) return false;
    if (b.queue.length >= MAX_QUEUE) return false;
    const def = UNITS[unitType];
    const p = this.players[playerId];
    if (p.credits < def.cost) return false;
    p.credits -= def.cost;
    b.queue.push({ type: unitType, elapsed: 0 });
    return true;
  }

  cmdCancel(playerId, buildingId, index = -1) {
    const b = this.get(buildingId);
    if (!b || b.owner !== playerId || !b.queue.length) return false;
    const i = index < 0 ? b.queue.length - 1 : index;
    const [item] = b.queue.splice(i, 1);
    if (item) this.players[playerId].credits += UNITS[item.type].cost;
    return !!item;
  }

  // Toggle paid repair on a damaged, finished structure.
  cmdRepair(playerId, buildingId, on) {
    const b = this.get(buildingId);
    if (!b || b.owner !== playerId || b.kind !== 'building' || b.progress < 1) return false;
    const want = on ?? !b.repairing;
    if (want && b.hp >= b.maxHp) return false;
    b.repairing = want;
    if (!want) b.repairStalled = false;
    return true;
  }

  // Send units to a structure that services their domain (Service Depot,
  // Airbase, Naval Yard). Returns how many units were sent.
  cmdService(playerId, ids, buildingId) {
    const b = this.get(buildingId);
    if (!b || b.owner !== playerId || b.kind !== 'building' || !b.def.repairs) return 0;
    const units = this.ownedUnits(playerId, ids).filter((u) => this.repairDomain(u) === b.def.repairs);
    if (units.length) this.cmdMove(playerId, units.map((u) => u.id), b.x, b.y);
    return units.length;
  }

  // Which facility kind can repair this unit ('ground' | 'air' | 'naval'),
  // or 'infantry' for units healed for free near barracks.
  repairDomain(u) {
    return u.def.armor === 'infantry' ? 'infantry' : u.def.domain;
  }

  // Set where a production structure sends new units. A point on an oil
  // well also tells new trucks which well to work; a point on the structure
  // itself clears the rally. Returns 'set', 'cleared' or false.
  cmdRally(playerId, buildingId, x, y) {
    const b = this.get(buildingId);
    if (!b || b.owner !== playerId || b.kind !== 'building' || !b.def.produces) return false;
    if (x >= b.tx && x < b.tx + b.w && y >= b.ty && y < b.ty + b.h) {
      b.rally = null;
      return 'cleared';
    }
    const well = this.map.wells.findIndex((w) => Math.hypot(w.x + 0.5 - x, w.y + 0.5 - y) < 0.9);
    b.rally = { x, y, well: well >= 0 ? well : null };
    b.rallyCount = 0;
    return 'set';
  }

  cmdPlace(playerId, type, tx, ty) {
    const p = this.players[playerId];
    const def = BUILDINGS[type];
    if (!def || (p.constructing && !def.segment)) return null;
    if (!this.canBuildType(playerId, type)) return null;
    if (p.credits < def.cost) return null;
    // A gate dropped onto one of your own wall segments replaces it.
    if (def.gate && this.map.inBounds(tx, ty)) {
      const under = this.get(this.map.occupied[ty * this.map.w + tx]);
      if (under && under.owner === playerId && under.type === 'wall') this.destroy(under, null, true);
    }
    if (!this.canPlace(playerId, type, tx, ty)) return null;
    p.credits -= def.cost;
    const b = this.addBuilding(playerId, type, tx, ty, false);
    if (!def.segment) p.constructing = b.id;
    return b;
  }

  // Place a run of wall (or gate) segments along a list of tiles. Skips
  // tiles that can't be built on and stops when funds run out.
  cmdPlaceLine(playerId, type, tiles) {
    const def = BUILDINGS[type];
    if (!def?.segment) return 0;
    let n = 0;
    for (const { x, y } of tiles.slice(0, MAX_LINE)) {
      if (this.players[playerId].credits < def.cost) break;
      if (this.cmdPlace(playerId, type, x, y)) n++;
    }
    return n;
  }

  canBuildRoad(playerId, x, y) {
    const m = this.map;
    if (!m.inBounds(x, y) || m.road[y * m.w + x] || m.occupied[y * m.w + x]) return false;
    const t = m.get(x, y);
    if (t !== Terrain.GRASS && t !== Terrain.SAND && t !== Terrain.FOREST) return false;
    return this.inBuildRadius(playerId, x, y, 1, 1);
  }

  // Lay road tiles (instant). Returns how many were built.
  cmdBuildRoad(playerId, tiles) {
    const p = this.players[playerId];
    if (!ROAD.requires.every((r) => this.hasBuilding(playerId, r))) return 0;
    let n = 0;
    for (const { x, y } of tiles.slice(0, MAX_LINE)) {
      if (p.credits < ROAD.cost) break;
      if (!this.canBuildRoad(playerId, x, y)) continue;
      p.credits -= ROAD.cost;
      this.map.road[y * this.map.w + x] = 1;
      n++;
    }
    if (n) {
      this.map.roadVersion++;
      this.events.push({ type: 'roadBuilt', owner: playerId, count: n });
    }
    return n;
  }

  setGate(b, owner) {
    for (let y = b.ty; y < b.ty + b.h; y++) for (let x = b.tx; x < b.tx + b.w; x++) this.map.gateOwner[y * this.map.w + x] = owner;
  }

  // Nearest enemy wall or gate, used by armies to breach a blocked route.
  findBlockingWall(u, radius = 8) {
    let best = null, bestD = radius;
    for (const e of this.entities.values()) {
      if (e.kind !== 'building' || !e.def.segment || e.owner === u.owner) continue;
      const d = this.distTo(u, e);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  // Sell a structure for half its cost.
  cmdSell(playerId, buildingId) {
    const b = this.get(buildingId);
    if (!b || b.owner !== playerId || b.kind !== 'building' || b.type === 'hq') return false;
    this.players[playerId].credits += Math.floor(b.def.cost * 0.5 * (b.hp / b.maxHp));
    this.destroy(b, null, true);
    return true;
  }

  // ------------------------------------------------------------ movement

  setPath(u, x, y) {
    const sx = Math.floor(u.x), sy = Math.floor(u.y);
    const gx = Math.floor(x), gy = Math.floor(y);
    const path = findPath(this.map, sx, sy, gx, gy, u.def.domain, undefined, true, u.owner);
    u.pathGoal = { x, y };
    if (!path) { u.path = []; return; }
    const pts = path.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 }));
    // End on the exact requested point when it lies in the final tile.
    const last = path[path.length - 1];
    if (u.def.domain === 'air' || (last && last.x === gx && last.y === gy)) {
      if (pts.length) pts[pts.length - 1] = { x, y };
    }
    // Already in the goal tile: step to the exact point. (An empty path from
    // anywhere else means the goal can't be reached, e.g. it's walled off.)
    if (!pts.length && sx === gx && sy === gy) pts.push({ x, y });
    u.path = pts;
    u.repathAt = this.tick + TICK_RATE * 2 + (u.id % 13); // jitter so groups don't repath together
  }

  // Advance a unit along its path. Returns true once the path is exhausted.
  followPath(u) {
    if (!u.path || !u.path.length) return true;
    const wp = u.path[0];
    // Re-route if a new structure now blocks the way.
    if (u.def.domain !== 'air' && !this.map.passable(Math.floor(wp.x), Math.floor(wp.y), u.def.domain, u.owner)) {
      const goal = u.path[u.path.length - 1];
      this.setPath(u, goal.x, goal.y);
      return !u.path.length;
    }
    const dx = wp.x - u.x, dy = wp.y - u.y;
    const d = Math.hypot(dx, dy);
    const tx = Math.floor(u.x), ty = Math.floor(u.y);
    const speed = u.def.speed / (this.map.inBounds(tx, ty) ? this.map.moveCost(tx, ty, u.def.domain) : 1);
    const step = speed * DT;
    if (d > 0.001) turnToward(u, Math.atan2(dy, dx), u.def.domain === 'air' ? 8 : 6);
    if (d <= step) {
      u.x = wp.x; u.y = wp.y;
      u.path.shift();
      return !u.path.length;
    }
    u.x += (dx / d) * step;
    u.y += (dy / d) * step;
    return false;
  }

  moveToward(u, x, y) {
    // Repath if we have no path, it's stale, or the goal moved. An empty path
    // means "as close as we can get" (e.g. the goal is walled off), so wait
    // for the normal repath interval instead of searching again every tick.
    const goalMoved = !u.pathGoal || Math.hypot(u.pathGoal.x - x, u.pathGoal.y - y) > 1.5;
    if (!u.path || goalMoved || this.tick >= u.repathAt) this.setPath(u, x, y);
    this.followPath(u);
  }

  separate(units) {
    // Gentle pairwise push so units don't stack. Air units only push air.
    const n = units.length;
    for (let i = 0; i < n; i++) {
      const a = units[i];
      for (let j = i + 1; j < n; j++) {
        const b = units[j];
        if ((a.def.domain === 'air') !== (b.def.domain === 'air')) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const min = (a.radius + b.radius) * 0.9;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = Math.min((min - d) * 0.5, 0.08);
        const nx = d2 ? dx / d : this.rng.range(-1, 1), ny = d2 ? dy / d : this.rng.range(-1, 1);
        this.nudge(a, -nx * push, -ny * push);
        this.nudge(b, nx * push, ny * push);
      }
    }
  }

  nudge(u, dx, dy) {
    if (u.harvestState === 'loading' && u.order.type === 'harvest') return;
    const nx = u.x + dx, ny = u.y + dy;
    if (this.map.passable(Math.floor(nx), Math.floor(ny), u.def.domain, u.owner)) { u.x = nx; u.y = ny; }
  }

  // --------------------------------------------------------------- combat

  findTarget(e, weapon, radius) {
    let best = null, bestScore = Infinity;
    for (const o of this.entities.values()) {
      if (o.owner === e.owner || !canHit(weapon, o)) continue;
      if (o.kind === 'building' && o.def.segment) continue;
      const d = this.distTo(e, o);
      if (d > radius) continue;
      if (!this.isVisibleTo(e.owner, o)) continue;
      // Prefer armed threats over structures and harmless units.
      let score = d;
      if (o.kind === 'building') score += o.def.weapon ? 1 : 4;
      else if (!o.def.weapon) score += 2;
      if (score < bestScore) { bestScore = score; best = o; }
    }
    return best;
  }

  fire(shooter, weapon, target, weaponKey) {
    const tx = target.x, ty = target.y;
    this.projectiles.push({
      x: shooter.x, y: shooter.y, sx: shooter.x, sy: shooter.y,
      tx, ty, targetId: target.id, owner: shooter.owner, weapon: weaponKey,
      speed: weapon.speed, homing: !weapon.arc,
      air: target.kind === 'unit' && target.def.domain === 'air',
      fromAir: shooter.kind === 'unit' && shooter.def.domain === 'air',
      shooterId: shooter.id,
    });
    this.events.push({ type: 'fire', fx: weapon.fx, x: shooter.x, y: shooter.y, owner: shooter.owner, shooterId: shooter.id });
  }

  // Try to shoot `target` with the entity's weapons. Returns true if in range.
  engage(e, target) {
    let inRange = false;
    const keys = [e.def.weapon, e.def.secondary].filter(Boolean);
    keys.forEach((key, idx) => {
      const w = WEAPONS[key];
      if (!canHit(w, target)) return;
      const d = this.distTo(e, target);
      if (d > w.range || (w.minRange && d < w.minRange)) return;
      inRange = true;
      const cdKey = idx === 0 ? 'cooldown' : 'cooldown2';
      if (e.kind === 'unit') turnToward(e, Math.atan2(target.y - e.y, target.x - e.x), 10);
      if (e[cdKey] <= 0) {
        this.fire(e, w, target, key);
        e[cdKey] = w.cooldown;
      }
    });
    return inRange;
  }

  primaryWeaponFor(e, target) {
    for (const key of [e.def.weapon, e.def.secondary]) {
      if (key && canHit(WEAPONS[key], target)) return WEAPONS[key];
    }
    return null;
  }

  applyDamage(target, amount, attackerOwner) {
    if (target.hp <= 0) return;
    target.hp -= amount;
    if (target.owner !== attackerOwner) target.hitAt = this.tick;
    if (target.kind === 'building') this.events.push({ type: 'underAttack', owner: target.owner, x: target.x, y: target.y });
    if (target.hp <= 0) this.destroy(target, attackerOwner);
  }

  destroy(e, killerOwner, sold = false) {
    if (!this.entities.has(e.id)) return;
    this.entities.delete(e.id);
    e.hp = 0;
    if (e.kind === 'building') {
      this.map.setOccupied(e.tx, e.ty, e.w, e.h, 0);
      if (e.def.gate) this.setGate(e, -1);
      const p = this.players[e.owner];
      if (p.constructing === e.id) p.constructing = null;
    }
    if (!sold) {
      this.players[e.owner].stats.lost++;
      if (killerOwner != null && killerOwner !== e.owner) this.players[killerOwner].stats.killed++;
    }
    this.events.push({
      type: 'explode', x: e.x, y: e.y,
      size: e.kind === 'building' ? Math.max(e.w, e.h) : e.radius * 2,
      air: e.kind === 'unit' && e.def.domain === 'air',
      infantry: e.kind === 'unit' && e.def.armor === 'infantry',
    });
  }

  updateProjectiles() {
    const keep = [];
    for (const p of this.projectiles) {
      const target = this.get(p.targetId);
      if (p.homing && target) { p.tx = target.x; p.ty = target.y; }
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      const step = p.speed * DT;
      if (d > step) {
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
        keep.push(p);
        continue;
      }
      const w = WEAPONS[p.weapon];
      if (w.splash) {
        for (const o of [...this.entities.values()]) {
          if (o.owner === p.owner || !canHit(w, o)) continue;
          const dist = this.distTo({ x: p.tx, y: p.ty }, o);
          if (dist <= w.splash) this.applyDamage(o, damageAgainst(w, o.kind === 'building' ? 'building' : o.def.armor) * (1 - 0.5 * dist / w.splash), p.owner);
        }
      } else if (target) {
        this.applyDamage(target, damageAgainst(w, target.kind === 'building' ? 'building' : target.def.armor), p.owner);
      }
      this.events.push({ type: 'impact', fx: w.fx, x: p.tx, y: p.ty, splash: w.splash || 0, air: p.air });
    }
    this.projectiles = keep;
  }

  // ---------------------------------------------------------- per-entity

  updateUnit(u) {
    if (u.cooldown > 0) u.cooldown -= DT;
    if (u.cooldown2 > 0) u.cooldown2 -= DT;
    if (u.pendingPath) {
      if (this.tick < u.pendingPath.at) return;
      u.pendingPath = null;
      if (u.order.dest) this.setPath(u, u.order.dest.x, u.order.dest.y);
    }
    const o = u.order;
    const weapon = u.def.weapon ? WEAPONS[u.def.weapon] : null;

    switch (o.type) {
      case 'move': {
        if (this.followPath(u)) u.order = { type: 'idle', home: { x: u.x, y: u.y } };
        break;
      }
      case 'attack': {
        const t = this.get(o.targetId);
        if (!t) {
          // Breach made: carry on to where we were going.
          if (o.resume) { u.order = { type: 'attackMove', dest: o.resume }; this.setPath(u, o.resume.x, o.resume.y); } else u.order = { type: 'idle' };
          u.path = o.resume ? u.path : null;
          break;
        }
        const w = this.primaryWeaponFor(u, t);
        if (!w) { u.order = { type: 'idle' }; break; }
        const d = this.distTo(u, t);
        if (w.minRange && d < w.minRange) {
          // Too close for artillery: back off.
          const ang = Math.atan2(u.y - t.y, u.x - t.x);
          this.moveToward(u, u.x + Math.cos(ang) * 3, u.y + Math.sin(ang) * 3);
        } else if (!this.engage(u, t)) {
          this.moveToward(u, t.x, t.y);
        } else {
          u.path = null;
        }
        break;
      }
      case 'attackMove':
      case 'idle':
      case 'guard': {
        if (weapon || u.def.secondary) {
          // Units that were just shot at look further afield to retaliate.
          const provoked = this.tick - (u.hitAt ?? -1e9) < TICK_RATE * 2;
          let sight = o.type === 'attackMove' ? u.def.sight : (weapon ? weapon.range + 1.5 : u.def.sight);
          if (provoked) sight = Math.max(sight, u.def.sight + 3);
          let t = u.target ? this.get(u.target) : null;
          if (t && (this.distTo(u, t) > u.def.sight + 2 || !this.isVisibleTo(u.owner, t))) t = null;
          if (!t) {
            t = this.findTarget(u, weapon || WEAPONS[u.def.secondary], sight);
            if (!t && u.def.secondary) t = this.findTarget(u, WEAPONS[u.def.secondary], sight);
          }
          u.target = t ? t.id : null;
          if (t) {
            const w = this.primaryWeaponFor(u, t);
            const inRange = this.engage(u, t);
            // Idle units chase a little way, attack-moving units fully engage.
            if (!inRange && w) {
              const home = o.home || { x: u.x, y: u.y };
              if (!o.home && o.type === 'idle') o.home = home;
              const leash = o.type === 'attackMove' ? Infinity : 6;
              if (Math.hypot(u.x - home.x, u.y - home.y) < leash) this.moveToward(u, t.x, t.y);
              else { u.target = null; this.moveToward(u, home.x, home.y); }
            }
            break;
          }
        }
        if (o.type === 'attackMove') {
          if (!u.path || u.pathGoal?.x !== o.dest.x || u.pathGoal?.y !== o.dest.y) this.setPath(u, o.dest.x, o.dest.y);
          if (this.followPath(u)) {
            // Walled off short of the goal: knock down the nearest enemy wall.
            const wall = u.def.domain === 'ground' && u.def.weapon && Math.hypot(u.x - o.dest.x, u.y - o.dest.y) > 2.5 ? this.findBlockingWall(u) : null;
            u.order = wall ? { type: 'attack', targetId: wall.id, resume: o.dest } : { type: 'idle', home: { x: u.x, y: u.y } };
          }
        } else if (o.home && Math.hypot(u.x - o.home.x, u.y - o.home.y) > 0.6) {
          this.moveToward(u, o.home.x, o.home.y);
        }
        break;
      }
      case 'harvest':
        this.updateHarvester(u);
        break;
    }
  }

  nearestWell(u, exclude = -1) {
    let best = -1, bestD = Infinity;
    this.map.wells.forEach((w, i) => {
      if (w.amount <= 0 || i === exclude) return;
      if ((u.avoidWells?.[i] ?? 0) > this.tick) return; // recently found unreachable
      const d = Math.hypot(w.x + 0.5 - u.x, w.y + 0.5 - u.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  // Loading bay positions for a well: the first WELL_BAYS sides that a
  // ground vehicle can stand on.
  wellBays(i) {
    const w = this.map.wells[i];
    const bays = [];
    for (const [ox, oy] of BAY_OFFSETS) {
      const x = w.x + 0.5 + ox, y = w.y + 0.5 + oy;
      if (this.map.passable(Math.floor(x), Math.floor(y), 'ground')) bays.push({ x, y });
      if (bays.length === WELL_BAYS) break;
    }
    return bays;
  }

  // Trucks currently holding a bay at well i, as [bayIndex] -> truck.
  bayHolders(i) {
    const holders = [];
    for (const t of this.entities.values()) {
      if (t.kind !== 'unit' || !t.def.harvester || t.well !== i || t.bay == null) continue;
      if (t.order.type !== 'harvest' || (t.harvestState !== 'toWell' && t.harvestState !== 'loading')) continue;
      holders[t.bay] = t;
    }
    return holders;
  }

  claimBay(u) {
    if (u.bay != null) return true;
    const holders = this.bayHolders(u.well);
    const n = this.wellBays(u.well).length;
    for (let b = 0; b < n; b++) if (!holders[b]) { u.bay = b; return true; }
    return false;
  }

  releaseBay(u) { u.bay = null; }

  // Pick a well by travel distance plus how busy it is, so trucks spread
  // out instead of crowding one pump. A small bonus keeps them on their
  // current well unless another is clearly better.
  chooseWell(u) {
    const demand = new Map();
    for (const t of this.entities.values()) {
      if (t === u || t.kind !== 'unit' || !t.def.harvester || t.order.type !== 'harvest') continue;
      if (t.harvestState === 'toWell' || t.harvestState === 'loading') demand.set(t.well, (demand.get(t.well) || 0) + 1);
    }
    let best = -1, bestScore = Infinity;
    this.map.wells.forEach((w, i) => {
      if (w.amount <= 0 || (u.avoidWells?.[i] ?? 0) > this.tick) return;
      const bays = this.wellBays(i).length;
      if (!bays) return;
      const queue = Math.max(0, (demand.get(i) || 0) - bays + 1);
      const score = Math.hypot(w.x + 0.5 - u.x, w.y + 0.5 - u.y) + queue * BUSY_WELL_PENALTY + (i === u.well ? -1.5 : 0);
      if (score < bestScore) { bestScore = score; best = i; }
    });
    return best;
  }

  nearestDropoff(u) {
    let best = null, bestD = Infinity;
    for (const e of this.entities.values()) {
      if (e.kind !== 'building' || e.owner !== u.owner || !e.def.dropoff || e.progress < 1) continue;
      const d = this.distTo(u, e);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  updateHarvester(u) {
    const p = this.players[u.owner];
    switch (u.harvestState) {
      case 'toWell': {
        let well = this.map.wells[u.well];
        if (!well || well.amount <= 0 || !this.wellBays(u.well).length) {
          this.releaseBay(u);
          u.well = this.chooseWell(u);
          well = this.map.wells[u.well];
          if (!well) { u.order = { type: 'idle' }; return; }
        }
        // Claim a loading bay; if the well is full, see whether another
        // well is now the better bet before queueing here.
        if (!this.claimBay(u)) {
          const alt = this.chooseWell(u);
          if (alt >= 0 && alt !== u.well) { u.well = alt; u.path = null; well = this.map.wells[alt]; this.claimBay(u); }
        }
        const wx = well.x + 0.5, wy = well.y + 0.5;
        let tx, ty;
        if (u.bay != null) {
          const bay = this.wellBays(u.well)[u.bay];
          tx = bay.x; ty = bay.y;
        } else {
          // Wait beside the well, out of the bays' way.
          const d = Math.hypot(u.x - wx, u.y - wy) || 1;
          tx = wx + ((u.x - wx) / d) * 2.2; ty = wy + ((u.y - wy) / d) * 2.2;
        }
        const dist = Math.hypot(u.x - tx, u.y - ty);
        if (u.bay != null && dist < 0.3) { u.harvestState = 'loading'; u.path = null; u.wellStuck = 0; break; }
        if (u.bay == null && dist < 0.6) { u.path = null; break; }
        this.moveToward(u, tx, ty);
        // Holding a bay but no route to it: the well is cut off (e.g. inside
        // enemy walls), so try another for a minute. Trucks waiting for a
        // bay have none and aren't counted.
        u.wellStuck = u.bay != null && u.path && !u.path.length ? (u.wellStuck || 0) + 1 : 0;
        if (u.wellStuck > TICK_RATE * 3) {
          (u.avoidWells ||= {})[u.well] = this.tick + TICK_RATE * 60;
          u.wellStuck = 0;
          this.releaseBay(u);
          u.well = this.chooseWell(u);
          u.path = null;
          if (u.well < 0) u.order = { type: 'idle' };
        }
        break;
      }
      case 'loading': {
        const well = this.map.wells[u.well];
        if (!well || well.amount <= 0) { this.releaseBay(u); u.harvestState = u.cargo > 0 ? 'toDropoff' : 'toWell'; break; }
        turnToward(u, Math.atan2(well.y + 0.5 - u.y, well.x + 0.5 - u.x) + Math.PI / 2, 4);
        const amt = Math.min(HARVEST_RATE * DT, well.amount, TRUCK_CAPACITY - u.cargo);
        well.amount -= amt;
        u.cargo += amt;
        if (u.cargo >= TRUCK_CAPACITY - 0.001) { this.releaseBay(u); u.harvestState = 'toDropoff'; }
        break;
      }
      case 'toDropoff': {
        const dep = this.nearestDropoff(u);
        if (!dep) { u.order = { type: 'idle' }; return; }
        if (this.distTo(u, dep) < 0.9) {
          const amt = Math.round(u.cargo);
          p.credits += amt;
          p.stats.harvested += amt;
          u.cargo = 0;
          u.harvestState = 'toWell';
          // Re-pick each trip so trucks rebalance across wells.
          const next = this.chooseWell(u);
          if (next >= 0) u.well = next;
          this.events.push({ type: 'credits', x: u.x, y: u.y, amount: amt, owner: u.owner });
          u.path = null;
        } else {
          // Head for the nearest point on the structure's edge rather than
          // its centre, so trucks spread around it instead of converging.
          const ex = Math.max(dep.tx - 0.5, Math.min(dep.tx + dep.w + 0.5, u.x));
          const ey = Math.max(dep.ty - 0.5, Math.min(dep.ty + dep.h + 0.5, u.y));
          this.moveToward(u, ex, ey);
        }
        break;
      }
      default:
        u.harvestState = 'toWell';
    }
  }

  updateBuilding(b) {
    const p = this.players[b.owner];
    if (b.progress < 1) {
      b.progress = Math.min(1, b.progress + DT / b.def.buildTime);
      b.hp = Math.min(b.maxHp, b.hp + (b.maxHp * 0.9 * DT) / b.def.buildTime);
      if (b.progress >= 1) {
        p.constructing = null;
        this.events.push({ type: 'built', owner: b.owner, building: b.type, x: b.x, y: b.y });
      }
      return;
    }
    if (b.cooldown > 0) b.cooldown -= DT;
    if (b.def.weapon) {
      const w = WEAPONS[b.def.weapon];
      let t = b.target ? this.get(b.target) : null;
      if (!t || this.distTo(b, t) > w.range) t = this.findTarget(b, w, w.range);
      b.target = t ? t.id : null;
      if (t) this.engage(b, t);
    }
    if (b.queue.length) {
      const item = b.queue[0];
      item.elapsed += DT;
      if (item.elapsed >= UNITS[item.type].buildTime) {
        if (this.spawnFrom(b, item.type)) b.queue.shift();
        else item.elapsed = UNITS[item.type].buildTime; // blocked exit: hold until clear
      }
    }
  }

  spawnFrom(b, type) {
    const def = UNITS[type];
    const spot = this.findExit(b, def.domain);
    if (!spot) return false;
    const u = this.addUnit(b.owner, type, spot.x + 0.5, spot.y + 0.5);
    this.events.push({ type: 'unitReady', owner: b.owner, unit: type, x: u.x, y: u.y });
    const r = b.rally;
    if (def.harvester) {
      // Trucks only take a rally point that marks a well; otherwise they go to work.
      const want = r && r.well != null && this.map.wells[r.well]?.amount > 0 ? r.well : this.chooseWell(u);
      if (want >= 0) this.cmdHarvest(b.owner, [u.id], want);
    } else if (r) {
      // Spread arrivals in a spiral around the rally point so they don't stack;
      // armed units attack-move so they fight anything they meet on the way.
      const k = b.rallyCount = (b.rallyCount || 0) + 1;
      const n = (k - 1) % 16, rad = n ? 0.8 * Math.sqrt(n) : 0, ang = n * 2.39996;
      this.cmdMove(b.owner, [u.id], r.x + Math.cos(ang) * rad, r.y + Math.sin(ang) * rad, !!def.weapon);
    } else {
      // Step off the doorstep.
      u.order = { type: 'move' };
      this.setPath(u, spot.x + 0.5 + (b.owner === 0 ? 1 : -1), spot.y + 1.5);
    }
    return true;
  }

  findExit(b, domain) {
    if (domain === 'air') return { x: Math.floor(b.x), y: Math.floor(b.y) };
    // Walk rings around the footprint, preferring the south side.
    for (let r = 1; r <= 4; r++) {
      const cands = [];
      for (let y = b.ty - r; y < b.ty + b.h + r; y++) {
        for (let x = b.tx - r; x < b.tx + b.w + r; x++) {
          const onRing = x === b.tx - r || x === b.tx + b.w + r - 1 || y === b.ty - r || y === b.ty + b.h + r - 1;
          if (!onRing || !this.map.passable(x, y, domain)) continue;
          cands.push({ x, y, score: (y < b.ty ? 2 : 0) + Math.abs(x + 0.5 - b.x) * 0.1 });
        }
      }
      if (cands.length) {
        cands.sort((a, c) => a.score - c.score);
        return cands[0];
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ fog

  updateFog() {
    const { w, h } = this.map;
    for (const p of this.players) p.visible.fill(0);
    for (const e of this.entities.values()) {
      const p = this.players[e.owner];
      const r = e.kind === 'building' && e.progress < 1 ? 3 : e.def.sight;
      const cx = e.x, cy = e.y;
      const r2 = r * r;
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          if (dx * dx + dy * dy <= r2) {
            p.visible[y * w + x] = 1;
            p.explored[y * w + x] = 1;
          }
        }
      }
    }
  }

  // ----------------------------------------------------------------- tick

  step() {
    this.tick++;
    this.time += DT;
    const units = [];
    for (const e of [...this.entities.values()]) {
      if (!this.entities.has(e.id)) continue;
      if (e.kind === 'unit') { this.updateUnit(e); units.push(e); } else this.updateBuilding(e);
    }
    this.separate(units.filter((u) => this.entities.has(u.id)));
    this.updateProjectiles();
    if (this.tick % REPAIR_INTERVAL === 0) this.updateRepairs();
    if (this.tick % FOG_INTERVAL === 0) this.updateFog();
    this.checkVictory();
  }

  // --------------------------------------------------------------- repair

  updateRepairs() {
    const dt = DT * REPAIR_INTERVAL;
    const facilities = [];
    for (const b of this.entities.values()) {
      if (b.kind !== 'building' || b.progress < 1) continue;
      if (b.def.repairs || b.def.healsInfantry) facilities.push(b);
      if (!b.repairing) continue;
      if (b.hp >= b.maxHp) { b.repairing = false; continue; }
      this.heal(b, REPAIR.buildingRate, (b.def.repairValue ?? b.def.cost) * REPAIR.buildingCost, dt);
      if (b.hp >= b.maxHp) b.repairing = false;
    }
    if (!facilities.length) return;
    for (const u of this.entities.values()) {
      if (u.kind !== 'unit' || u.hp >= u.maxHp) continue;
      const kind = this.repairDomain(u);
      const range = kind === 'infantry' ? REPAIR.infantryRange : REPAIR.facilityRange;
      const at = facilities.find((b) => b.owner === u.owner
        && (kind === 'infantry' ? b.def.healsInfantry : b.def.repairs === kind)
        && this.distTo(u, b) <= range);
      if (!at) continue;
      const ok = kind === 'infantry' ? this.heal(u, REPAIR.infantryRate, 0, dt) : this.heal(u, REPAIR.unitRate, u.def.cost * REPAIR.unitCost, dt);
      if (ok) at.servicingAt = this.tick;
    }
  }

  // Restore HP at `rate` (fraction of max per second), paying `fullCost`
  // pro rata. Slower while under fire; pauses when the owner can't pay.
  heal(e, rate, fullCost, dt) {
    const p = this.players[e.owner];
    const underFire = this.tick - (e.hitAt ?? -1e9) < REPAIR.underFireWindow * TICK_RATE;
    const amount = Math.min(e.maxHp - e.hp, e.maxHp * rate * dt * (underFire ? REPAIR.underFire : 1));
    if (amount <= 0) return false;
    const cost = (fullCost * amount) / e.maxHp;
    if (p.credits < cost) { e.repairStalled = true; return false; }
    p.credits -= cost;
    p.stats.repairSpent += cost;
    e.hp += amount;
    e.repairStalled = false;
    e.repairedAt = this.tick;
    return true;
  }

  checkVictory() {
    if (this.winner !== null) return;
    for (const p of this.players) {
      if (p.defeated) continue;
      let hasBuilding = false;
      for (const e of this.entities.values()) {
        if (e.owner === p.id && e.kind === 'building' && !e.def.segment) { hasBuilding = true; break; }
      }
      if (!hasBuilding) {
        p.defeated = true;
        this.events.push({ type: 'defeated', owner: p.id });
      }
    }
    const alive = this.players.filter((p) => !p.defeated);
    if (alive.length <= 1) this.winner = alive.length ? alive[0].id : -1;
  }
}

export function turnToward(u, target, rate) {
  let diff = target - u.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const maxStep = rate * DT;
  u.angle += Math.max(-maxStep, Math.min(maxStep, diff));
}

// Offsets (in tiles) arranged in a compact spiral-ish block.
export function formationSlots(n) {
  const slots = [];
  const cols = Math.ceil(Math.sqrt(n));
  const spacing = 1.1;
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    slots.push({ x: (c - (cols - 1) / 2) * spacing, y: (r - (Math.ceil(n / cols) - 1) / 2) * spacing });
  }
  return slots;
}

