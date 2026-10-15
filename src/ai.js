import { BUILDINGS, UNITS, WEAPONS, TICK_RATE, TECHS, TECH_ORDER } from './config.js';
import { lineTiles } from './map.js';

// Scripted opponent. It issues the same commands a human would through the
// Game command API, so it plays by the same economic rules.
// Steps that need research (the ICBM Silo) are skipped until it's done.
const BUILD_PLAN = ['refinery', 'barracks', 'factory', 'turret', 'depot', 'shipyard', 'samsite', 'airfield', 'lab', 'refinery', 'turret', 'samsite', 'silo'];

// Production rotations; units that still need research are skipped.
const ARMY_MIX = {
  barracks: ['infantry', 'infantry', 'rocketeer', 'commando'],
  factory: ['tank', 'tank', 'scout', 'aa', 'artillery'],
  airfield: ['heli', 'strikedrone', 'fighter', 'paratroopers', 'heli', 'bomber'],
  shipyard: ['submarine', 'gunboat', 'gunboat', 'destroyer'],
};

// wallAfter: how many build-plan steps must be done before the AI starts
// walling its base (null = never). wallMargin: tiles of room inside the wall.
const DIFFICULTY = {
  easy: { thinkEvery: 2.0, attackSize: 14, maxTrucks: 3, incomeBonus: 0, wallAfter: null },
  normal: { thinkEvery: 1.0, attackSize: 10, maxTrucks: 4, incomeBonus: 0, wallAfter: BUILD_PLAN.length, wallMargin: 2 },
  hard: { thinkEvery: 0.5, attackSize: 8, maxTrucks: 6, incomeBonus: 2, wallAfter: 5, wallMargin: 4 },
};

const MIX_PATIENCE = 40; // seconds a producer waits to afford one unit before skipping it
const LAB_FLOAT = 500; // research only runs with at least this much spare cash
const WALL_RESERVE = 450; // production holds this back while the wall is unfinished
const WALL_FLOAT = 100; // walls never spend the last of the money
const WALL_BATCH = 10; // most segments placed per think

export class AIController {
  constructor(game, playerId, difficulty = 'normal') {
    this.game = game;
    this.id = playerId;
    this.cfg = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.planIndex = 0;
    this.mixIndex = {};
    this.mixWait = {};
    this.nextThink = 0;
    this.wave = 0;
    this.lastAttack = 0;
    this.savingFor = 0;
  }

  get player() { return this.game.players[this.id]; }

  mine(filter) {
    const out = [];
    for (const e of this.game.entities.values()) if (e.owner === this.id && filter(e)) out.push(e);
    return out;
  }

  update() {
    const g = this.game;
    if (this.player.defeated) return;
    // Hard AI gets a trickle of extra credits to compensate for its simplicity.
    if (this.cfg.incomeBonus) this.player.credits += this.cfg.incomeBonus / TICK_RATE * 10;
    if (g.time < this.nextThink) return;
    this.nextThink = g.time + this.cfg.thinkEvery;

    // With no trucks, every credit goes toward the next one (the Command
    // Center's income or its emergency truck will get the economy going).
    if (this.manageEconomy()) {
      for (const b of this.mine((e) => e.kind === 'building' && e.repairing)) g.cmdRepair(this.id, b.id, false);
      for (const b of this.mine((e) => e.kind === 'building' && e.def.research && !e.researchPaused)) g.cmdLabToggle(this.id, b.id, false);
      this.manageArmy();
      this.manageScouting();
      return;
    }
    this.manageResearch();
    this.manageConstruction();
    this.manageProduction();
    this.manageStrategic();
    this.manageRepairs();
    this.manageArmy();
    this.manageScouting();
    this.manageFortifications();
  }

  // Switch on repair for damaged structures and pull badly hurt vehicles,
  // aircraft and ships back to a facility that can fix them.
  manageRepairs() {
    const g = this.game;
    const p = this.player;
    for (const b of this.mine((e) => e.kind === 'building' && e.progress >= 1)) {
      if (!b.repairing && b.hp < b.maxHp * 0.75 && p.credits > 300) g.cmdRepair(this.id, b.id, true);
    }
    const facilities = this.mine((e) => e.kind === 'building' && e.progress >= 1 && e.def.repairs);
    for (const u of this.mine((e) => e.kind === 'unit' && !e.def.harvester)) {
      if (u.aiServicing) {
        // Done, or the facility is gone: rejoin the army.
        const kind = g.repairDomain(u);
        if (u.hp >= u.maxHp * 0.95 || !facilities.some((b) => b.def.repairs === kind)) u.aiServicing = false;
        continue;
      }
      if (u.hp > u.maxHp * 0.4 || u.order.type !== 'idle') continue;
      const kind = g.repairDomain(u);
      let best = null, bestD = Infinity;
      for (const b of facilities) {
        if (b.def.repairs !== kind) continue;
        const d = Math.hypot(b.x - u.x, b.y - u.y);
        if (d < bestD) { bestD = d; best = b; }
      }
      if (best && g.cmdService(this.id, [u.id], best.id)) u.aiServicing = true;
    }
  }

  // Keep one recon drone flying between oil fields and the enemy base.
  manageScouting() {
    const g = this.game;
    const drones = this.mine((e) => e.kind === 'unit' && e.def.scout);
    const hq = this.mine((e) => e.type === 'hq' && e.progress >= 1)[0];
    const trucks = this.mine((e) => e.kind === 'unit' && e.def.harvester).length;
    const queued = hq?.queue.some((q) => UNITS[q.type].scout);
    if (!drones.length && hq && !queued && trucks >= 2 && this.player.credits >= UNITS.drone.cost + 300) {
      g.cmdQueue(this.id, hq.id, 'drone');
    }
    for (const d of drones) {
      if (d.order.type !== 'idle') continue;
      const spots = [g.map.starts[1 - this.id], ...g.map.wells];
      const s = g.rng.pick(spots);
      g.cmdMove(this.id, [d.id], s.x + 0.5, s.y + 0.5);
    }
  }

  manageEconomy() {
    const trucks = this.mine((e) => e.kind === 'unit' && e.def.harvester);
    for (const t of trucks) {
      if (t.order.type === 'idle') {
        const well = this.game.chooseWell(t);
        if (well >= 0) this.game.cmdHarvest(this.id, [t.id], well);
      }
    }
    // Trucks come from the Command Center, or a Vehicle Plant if it's gone.
    const yards = this.mine((e) => e.kind === 'building' && e.progress >= 1 && e.def.produces?.includes('truck'));
    const yard = yards.find((b) => b.type === 'hq') || yards[0];
    const queued = yards.some((b) => b.queue.some((q) => UNITS[q.type].harvester));
    if (yard && trucks.length < this.cfg.maxTrucks && !queued && yard.queue.length === 0 && this.player.credits >= UNITS.truck.cost) {
      this.game.cmdQueue(this.id, yard.id, 'truck');
    }
    // True when the economy has stalled: no trucks working or on order.
    return trucks.length === 0 && !yards.some((b) => b.queue.some((q) => UNITS[q.type].harvester));
  }

  manageConstruction() {
    const p = this.player;
    this.savingFor = 0;
    if (p.constructing) return;
    // Walk the plan in order (rebuilding anything lost), skipping steps that
    // can't be sited right now, e.g. a Naval Yard with no shoreline nearby.
    const counts = {};
    for (const b of this.mine((e) => e.kind === 'building')) counts[b.type] = (counts[b.type] || 0) + 1;
    const wanted = {};
    for (let i = 0; i < BUILD_PLAN.length; i++) {
      const type = BUILD_PLAN[i];
      wanted[type] = (wanted[type] || 0) + 1;
      if ((counts[type] || 0) >= wanted[type]) continue;
      if (BUILDINGS[type].tech && !this.game.hasTech(this.id, BUILDINGS[type].tech)) continue;
      this.planProgress = i;
      if (!this.game.canBuildType(this.id, type)) return;
      const spot = this.findSpot(type);
      if (!spot) continue; // can't be sited here (e.g. no coast): treat as done
      const def = BUILDINGS[type];
      if (p.credits < def.cost + 200) { this.savingFor = def.cost; return; }
      this.game.cmdPlace(this.id, type, spot.x, spot.y);
      return;
    }
    this.planProgress = BUILD_PLAN.length;
  }

  // ------------------------------------------------------------ walls

  // Wall in the base once the build plan is far enough along: a ring a few
  // tiles outside the outermost structures, gates toward the enemy, the
  // home oil wells and the main road, built enemy-side first, a few
  // segments at a time from spare money. Lost segments are rebuilt.
  manageFortifications() {
    const g = this.game;
    const p = this.player;
    if (this.cfg.wallAfter == null || (this.planProgress ?? 0) < this.cfg.wallAfter) return;
    if (!this.wallPlan) this.wallPlan = this.planWalls();
    if (!this.wallPlan) return;
    let budget = p.credits - WALL_FLOAT - (this.savingFor || 0);
    let placed = 0;
    this.wallsPending = false;
    for (const t of this.wallPlan.tiles) {
      if (placed >= WALL_BATCH || budget < BUILDINGS.wall.cost) break;
      const id = g.map.occupied[t.y * g.map.w + t.x];
      const there = id > 0 ? g.get(id) : null;
      if (there && there.owner === this.id && there.def.segment) continue;
      this.wallsPending = true;
      const type = t.gate ? 'gate' : 'wall';
      if (budget < BUILDINGS[type].cost) continue;
      if (g.cmdPlace(this.id, type, t.x, t.y)) { budget -= BUILDINGS[type].cost; placed++; }
    }
    // Pave a road from the Command Center out through the main gate.
    if (!this.roadBuilt && this.wallPlan.mainGate && p.credits > WALL_FLOAT + 300) {
      const hq = this.mine((e) => e.type === 'hq')[0];
      if (hq) {
        const gt = this.wallPlan.mainGate;
        const start = { x: Math.round(hq.x + Math.sign(gt.x - hq.x) * 2), y: Math.round(hq.y + Math.sign(gt.y - hq.y) * 2) };
        const out = { x: gt.x + Math.sign(gt.x - hq.x) * 2, y: gt.y + Math.sign(gt.y - hq.y) * 2 };
        g.cmdBuildRoad(this.id, [...lineTiles(start, gt, true), ...lineTiles(gt, out, true)]);
        this.roadBuilt = true;
      }
    }
  }

  planWalls() {
    const g = this.game;
    const m = g.map;
    const blds = this.mine((e) => e.kind === 'building' && !e.def.segment);
    if (!blds.length) return null;
    const margin = this.cfg.wallMargin ?? 2;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of blds) {
      x0 = Math.min(x0, b.tx); y0 = Math.min(y0, b.ty);
      x1 = Math.max(x1, b.tx + b.w - 1); y1 = Math.max(y1, b.ty + b.h - 1);
    }
    x0 = Math.max(1, x0 - margin); y0 = Math.max(1, y0 - margin);
    x1 = Math.min(m.w - 2, x1 + margin); y1 = Math.min(m.h - 2, y1 + margin);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;

    // Perimeter tiles in walking order, keeping only buildable land.
    const ring = [];
    for (let x = x0; x <= x1; x++) ring.push({ x, y: y0 });
    for (let y = y0 + 1; y <= y1; y++) ring.push({ x: x1, y });
    for (let x = x1 - 1; x >= x0; x--) ring.push({ x, y: y1 });
    for (let y = y1 - 1; y > y0; y--) ring.push({ x: x0, y });
    const land = ring.filter((t) => m.isLand(t.x, t.y) && m.occupied[t.y * m.w + t.x] >= 0
      && !m.wells.some((w) => w.x === t.x && w.y === t.y));
    if (land.length < 4) return null;

    // Gates: toward the enemy, toward each home well outside the wall, and
    // wherever the main road crosses the ring. Keep them apart.
    const gates = [];
    const addGateToward = (tx, ty) => {
      const ang = Math.atan2(ty - cy, tx - cx);
      let best = null, bestD = Infinity;
      for (const t of land) {
        const d = Math.abs(Math.atan2(Math.sin(Math.atan2(t.y - cy, t.x - cx) - ang), Math.cos(Math.atan2(t.y - cy, t.x - cx) - ang)));
        if (d < bestD) { bestD = d; best = t; }
      }
      if (best && !gates.some((gt) => Math.hypot(gt.x - best.x, gt.y - best.y) < 5)) gates.push(best);
      return best;
    };
    const enemy = m.starts[1 - this.id] || { x: m.w / 2, y: m.h / 2 };
    const mainGate = addGateToward(enemy.x, enemy.y);
    for (const w of m.wells) {
      const inside = w.x >= x0 && w.x <= x1 && w.y >= y0 && w.y <= y1;
      if (!inside && Math.hypot(w.x - cx, w.y - cy) < 16) addGateToward(w.x, w.y);
    }
    const roadSet = new Set(m.roads.flat().map((rp) => rp.y * m.w + rp.x));
    for (const t of land) {
      if (roadSet.has(t.y * m.w + t.x) && !gates.some((gt) => Math.hypot(gt.x - t.x, gt.y - t.y) < 5)) gates.push(t);
    }
    // Build the side facing the enemy first.
    const tiles = land.map((t) => ({ ...t, gate: gates.includes(t) }));
    tiles.sort((a, b) => Math.hypot(a.x - mainGate.x, a.y - mainGate.y) - Math.hypot(b.x - mainGate.x, b.y - mainGate.y));
    return { tiles, mainGate, rect: { x0, y0, x1, y1 } };
  }

  findSpot(type) {
    const g = this.game;
    const def = BUILDINGS[type];
    const hq = this.mine((e) => e.type === 'hq')[0] || this.mine((e) => e.kind === 'building')[0];
    if (!hq) return null;
    const enemyStart = g.map.starts[1 - this.id] || g.map.starts[0];
    const towardEnemy = Math.atan2(enemyStart.y - hq.y, enemyStart.x - hq.x);
    // Big or coastal footprints need a wider search; sample every tile of each ring.
    const maxR = def.coastal || def.w * def.h > 9 ? 16 : 9;
    // Prefer sites with a one-tile lane all round; accept a tight fit rather than none.
    return this.searchSpot(type, hq, towardEnemy, maxR, true) || this.searchSpot(type, hq, towardEnemy, maxR, false);
  }

  searchSpot(type, hq, towardEnemy, maxR, needClearance) {
    const g = this.game;
    const def = BUILDINGS[type];
    let best = null, bestScore = Infinity;
    for (let r = 2; r <= maxR; r++) {
      const steps = Math.max(24, Math.ceil(Math.PI * 2 * r));
      for (let a = 0; a < steps; a++) {
        const ang = (a / steps) * Math.PI * 2;
        const x = Math.round(hq.x + Math.cos(ang) * r - def.w / 2);
        const y = Math.round(hq.y + Math.sin(ang) * r - def.h / 2);
        if (!g.canPlace(this.id, type, x, y)) continue;
        // Leave a one-tile lane around every structure so units can get out.
        if (needClearance && !this.hasClearance(x, y, def.w, def.h)) continue;
        let score = r;
        // Defenses face the enemy; production buildings stay behind.
        const facing = Math.cos(ang - towardEnemy);
        score += def.weapon ? -facing * 4 : facing * 2;
        if (score < bestScore) { bestScore = score; best = { x, y }; }
      }
      if (best && r > 4) break;
    }
    return best;
  }

  hasClearance(x, y, w, h) {
    const m = this.game.map;
    for (let yy = y - 1; yy <= y + h; yy++) {
      for (let xx = x - 1; xx <= x + w; xx++) {
        if (!m.inBounds(xx, yy)) return false;
        if (m.occupied[yy * m.w + xx]) return false;
      }
    }
    return true;
  }

  manageProduction() {
    const g = this.game;
    // Pricier producers order first so cheap infantry doesn't soak up every credit.
    const rank = { airfield: 0, shipyard: 1, factory: 2, barracks: 3 };
    const producers = this.mine((e) => e.kind === 'building' && e.progress >= 1 && ARMY_MIX[e.type])
      .sort((a, b) => rank[a.type] - rank[b.type]);
    // Save up for the next structure (or the wall), but never stall an
    // empty factory for long.
    const reserve = this.savingFor || (this.wallsPending ? WALL_RESERVE : 0);
    for (const b of producers) {
      if (b.queue.length >= (reserve ? 1 : 2)) continue;
      if (reserve && b.queue.length === 0 && this.game.time % 20 > this.cfg.thinkEvery) continue;
      const mix = ARMY_MIX[b.type].filter((t) => g.unitAvailable(this.id, t));
      const i = this.mixIndex[b.id] || 0;
      const type = mix[i % mix.length];
      if (this.player.credits - UNITS[type].cost < reserve) {
        // Don't wait forever on one pricey item: move on to the next.
        this.mixWait[b.id] ??= g.time;
        if (g.time - this.mixWait[b.id] > MIX_PATIENCE) { this.mixIndex[b.id] = i + 1; this.mixWait[b.id] = null; }
        continue;
      }
      this.mixWait[b.id] = null;
      if (g.cmdQueue(this.id, b.id, type)) this.mixIndex[b.id] = i + 1;
    }
  }

  manageArmy() {
    const g = this.game;
    // Units heading to (or sitting at) a repair facility sit out attacks.
    const army = this.mine((e) => e.kind === 'unit' && !e.def.harvester && !e.def.scout && !e.def.transport && !(e.dropT > 0) && !e.aiServicing);
    const hq = this.mine((e) => e.type === 'hq')[0] || this.mine((e) => e.kind === 'building')[0];

    // Defend: if enemies are near our base, everyone idle responds.
    if (hq) {
      const threat = this.findThreatNear(hq, 14);
      if (threat) {
        const idle = army.filter((u) => u.order.type !== 'attack' && Math.hypot(u.x - hq.x, u.y - hq.y) < 25);
        if (idle.length) g.cmdMove(this.id, idle.map((u) => u.id), threat.x, threat.y, true);
        return;
      }
    }

    const ready = army.filter((u) => u.order.type === 'idle');
    const needed = this.cfg.attackSize + this.wave * 2;
    if (ready.length >= needed && g.time - this.lastAttack > 30) {
      const target = this.pickTarget();
      if (target) {
        this.wave++;
        this.lastAttack = g.time;
        // Ships can only reach coastal targets; send them at the nearest one.
        const groups = { ground: [], naval: [], air: [] };
        for (const u of ready) groups[u.def.domain].push(u.id);
        if (groups.ground.length) g.cmdMove(this.id, groups.ground, target.x, target.y, true);
        if (groups.air.length) g.cmdMove(this.id, groups.air, target.x, target.y, true);
        if (groups.naval.length) {
          const coast = this.pickTarget(true) || target;
          g.cmdMove(this.id, groups.naval, coast.x, coast.y, true);
        }
      }
    } else if (hq) {
      // Gather idle units at a rally point in front of the base.
      const enemyStart = g.map.starts[1 - this.id];
      const ang = Math.atan2(enemyStart.y - hq.y, enemyStart.x - hq.x);
      const rx = hq.x + Math.cos(ang) * 7, ry = hq.y + Math.sin(ang) * 7;
      // New units head straight there.
      for (const pb of this.mine((e) => e.kind === 'building' && e.def.produces && e.type !== 'hq' && e.type !== 'shipyard')) {
        if (!pb.rally || Math.hypot(pb.rally.x - rx, pb.rally.y - ry) > 2) g.cmdRally(this.id, pb.id, rx, ry);
      }
      const stray = ready.filter((u) => u.def.domain !== 'naval' && Math.hypot(u.x - rx, u.y - ry) > 5);
      if (stray.length) g.cmdMove(this.id, stray.map((u) => u.id), rx, ry);
    }
  }

  // Research in a fixed order. Labs only run on spare cash, so building
  // and the army come first.
  manageResearch() {
    const g = this.game;
    const on = this.player.credits - (this.savingFor || 0) > LAB_FLOAT;
    for (const b of this.mine((e) => e.kind === 'building' && e.def.research && !e.researchPaused !== on)) g.cmdLabToggle(this.id, b.id, on);
    const next = TECH_ORDER.find((k) => g.canResearch(this.id, k));
    if (next && this.player.research.points >= TECHS[next].points) g.cmdResearch(this.id, next);
  }

  // Missile strikes, drop zones for paratroopers, and orders for troops
  // that have just landed.
  manageStrategic() {
    const g = this.game;
    for (const silo of this.mine((e) => e.def.missile && e.progress >= 1 && e.charge >= 1)) {
      const t = this.pickMissileTarget(silo.def.missile.weapon);
      if (t) g.cmdLaunch(this.id, silo.id, t.x, t.y);
    }
    for (const u of this.mine((e) => e.def.transport && e.order.type === 'paradrop' && !e.order.dropped && !e.aiAimed)) {
      // Drop on the enemy economy: a Supply Depot if there is one, else the base.
      const foes = [...g.entities.values()].filter((e) => e.owner !== this.id && e.kind === 'building' && !e.def.segment);
      const t = foes.find((e) => e.type === 'refinery') || foes.find((e) => e.type === 'hq') || foes[0];
      if (t) g.cmdParadrop(this.id, [u.id], t.x + t.w / 2 + 2, t.y + t.h / 2 + 2);
      u.aiAimed = true;
    }
    const landed = this.mine((e) => e.type === 'para' && !(e.dropT > 0) && e.order.type === 'guard');
    if (landed.length) {
      let best = null, bestD = Infinity;
      for (const e of g.entities.values()) {
        if (e.owner === this.id || e.kind !== 'building' || e.def.segment) continue;
        const d = Math.hypot(e.x - landed[0].x, e.y - landed[0].y);
        if (d < bestD) { bestD = d; best = e; }
      }
      if (best) g.cmdMove(this.id, landed.map((u) => u.id), best.x, best.y, true);
    }
  }

  // The enemy structure whose blast would wreck the most value.
  pickMissileTarget(weaponKey) {
    const g = this.game;
    const splash = WEAPONS[weaponKey].splash;
    const foes = [...g.entities.values()].filter((e) => e.owner !== this.id && e.kind === 'building' && !e.def.segment);
    let best = null, bestV = 0;
    for (const c of foes) {
      let v = 0;
      for (const o of foes) if (g.distTo({ x: c.x, y: c.y }, o) <= splash) v += o.def.repairValue ?? o.def.cost;
      if (v > bestV) { bestV = v; best = c; }
    }
    return best;
  }

  findThreatNear(center, radius) {
    for (const e of this.game.entities.values()) {
      if (e.owner === this.id) continue;
      if (Math.hypot(e.x - center.x, e.y - center.y) < radius && this.game.isVisibleTo(this.id, e)) return e;
    }
    return null;
  }

  // The AI knows roughly where the enemy base is, like a scouting report.
  pickTarget(coastal = false) {
    const g = this.game;
    let best = null, bestD = Infinity;
    const home = g.map.starts[this.id];
    for (const e of g.entities.values()) {
      if (e.owner === this.id || e.kind !== 'building' || e.def.segment) continue;
      if (coastal && !this.nearWater(e)) continue;
      const d = Math.hypot(e.x - home.x, e.y - home.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  nearWater(b) {
    const m = this.game.map;
    for (let y = b.ty - 3; y < b.ty + b.h + 3; y++) {
      for (let x = b.tx - 3; x < b.tx + b.w + 3; x++) if (m.inBounds(x, y) && m.isWater(x, y)) return true;
    }
    return false;
  }
}
