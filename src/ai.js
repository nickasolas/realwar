import { BUILDINGS, UNITS, TICK_RATE } from './config.js';

// Scripted opponent. It issues the same commands a human would through the
// Game command API, so it plays by the same economic rules.
const BUILD_PLAN = ['refinery', 'barracks', 'factory', 'turret', 'depot', 'shipyard', 'samsite', 'airfield', 'refinery', 'turret', 'samsite'];

const ARMY_MIX = {
  barracks: ['infantry', 'infantry', 'rocketeer'],
  factory: ['tank', 'tank', 'scout', 'aa', 'artillery'],
  airfield: ['heli', 'fighter', 'heli', 'bomber'],
  shipyard: ['gunboat', 'gunboat', 'destroyer'],
};

const DIFFICULTY = {
  easy: { thinkEvery: 2.0, attackSize: 14, maxTrucks: 3, incomeBonus: 0 },
  normal: { thinkEvery: 1.0, attackSize: 10, maxTrucks: 4, incomeBonus: 0 },
  hard: { thinkEvery: 0.5, attackSize: 8, maxTrucks: 6, incomeBonus: 2 },
};

export class AIController {
  constructor(game, playerId, difficulty = 'normal') {
    this.game = game;
    this.id = playerId;
    this.cfg = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.planIndex = 0;
    this.mixIndex = {};
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

    this.manageEconomy();
    this.manageConstruction();
    this.manageProduction();
    this.manageRepairs();
    this.manageArmy();
    this.manageScouting();
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
        const well = this.game.nearestWell(t);
        if (well >= 0) this.game.cmdHarvest(this.id, [t.id], well);
      }
    }
    const hq = this.mine((e) => e.type === 'hq')[0];
    if (hq && trucks.length < this.cfg.maxTrucks && hq.queue.length === 0 && this.player.credits >= UNITS.truck.cost) {
      this.game.cmdQueue(this.id, hq.id, 'truck');
    }
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
    for (const type of BUILD_PLAN) {
      wanted[type] = (wanted[type] || 0) + 1;
      if ((counts[type] || 0) >= wanted[type]) continue;
      if (!this.game.canBuildType(this.id, type)) return;
      const spot = this.findSpot(type);
      if (!spot) continue;
      const def = BUILDINGS[type];
      if (p.credits < def.cost + 200) { this.savingFor = def.cost; return; }
      this.game.cmdPlace(this.id, type, spot.x, spot.y);
      return;
    }
  }

  findSpot(type) {
    const g = this.game;
    const def = BUILDINGS[type];
    const hq = this.mine((e) => e.type === 'hq')[0] || this.mine((e) => e.kind === 'building')[0];
    if (!hq) return null;
    const enemyStart = g.map.starts[1 - this.id] || g.map.starts[0];
    const towardEnemy = Math.atan2(enemyStart.y - hq.y, enemyStart.x - hq.x);
    let best = null, bestScore = Infinity;
    for (let r = 2; r <= (def.coastal ? 16 : 9); r++) {
      for (let a = 0; a < 24; a++) {
        const ang = (a / 24) * Math.PI * 2;
        const x = Math.round(hq.x + Math.cos(ang) * r - def.w / 2);
        const y = Math.round(hq.y + Math.sin(ang) * r - def.h / 2);
        if (!g.canPlace(this.id, type, x, y)) continue;
        // Leave a one-tile lane around every structure so units can get out.
        if (!this.hasClearance(x, y, def.w, def.h)) continue;
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
    const producers = this.mine((e) => e.kind === 'building' && e.progress >= 1 && ARMY_MIX[e.type]);
    // Save up for the next structure, but never stall an empty factory for long.
    const reserve = this.savingFor || 0;
    for (const b of producers) {
      if (b.queue.length >= (reserve ? 1 : 2)) continue;
      if (reserve && b.queue.length === 0 && this.game.time % 20 > this.cfg.thinkEvery) continue;
      const mix = ARMY_MIX[b.type];
      const i = this.mixIndex[b.id] || 0;
      const type = mix[i % mix.length];
      if (this.player.credits - UNITS[type].cost < reserve) continue;
      if (g.cmdQueue(this.id, b.id, type)) this.mixIndex[b.id] = i + 1;
    }
  }

  manageArmy() {
    const g = this.game;
    // Units heading to (or sitting at) a repair facility sit out attacks.
    const army = this.mine((e) => e.kind === 'unit' && !e.def.harvester && !e.def.scout && !e.aiServicing);
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
      const stray = ready.filter((u) => u.def.domain !== 'naval' && Math.hypot(u.x - rx, u.y - ry) > 5);
      if (stray.length) g.cmdMove(this.id, stray.map((u) => u.id), rx, ry);
    }
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
      if (e.owner === this.id || e.kind !== 'building') continue;
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
