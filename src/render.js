import { TILE, Terrain, WEAPONS, BUILDINGS, UNITS, OIL_PER_WELL } from './config.js';
import { createRng } from './rng.js';

const TERRAIN_COLORS = {
  [Terrain.DEEP]: [22, 52, 92],
  [Terrain.WATER]: [36, 86, 130],
  [Terrain.SAND]: [196, 178, 128],
  [Terrain.GRASS]: [86, 118, 62],
  [Terrain.FOREST]: [58, 88, 46],
  [Terrain.ROCK]: [112, 106, 98],
};

export class Renderer {
  constructor(canvas, game, viewer = 0) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.viewer = viewer;
    this.particles = [];
    this.floaters = [];
    this.memory = new Map(); // last-seen enemy structures under fog
    this.terrain = this.buildTerrain();
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = game.map.w;
    this.fogCanvas.height = game.map.h;
    this.fogCtx = this.fogCanvas.getContext('2d');
    this.fogImage = this.fogCtx.createImageData(game.map.w, game.map.h);
    this.time = 0;
  }

  buildTerrain() {
    const { map } = this.game;
    const c = document.createElement('canvas');
    c.width = map.w * TILE;
    c.height = map.h * TILE;
    const ctx = c.getContext('2d');
    const rng = createRng(this.game.seed + 17);
    const img = ctx.createImageData(c.width, c.height);
    const d = img.data;
    // Per-pixel color with bilinear blending between tile colors so coasts look soft.
    const colorAt = (x, y) => {
      const tx = Math.min(map.w - 1, Math.max(0, x)), ty = Math.min(map.h - 1, Math.max(0, y));
      return TERRAIN_COLORS[map.get(tx, ty)];
    };
    for (let py = 0; py < c.height; py++) {
      const fy = py / TILE - 0.5;
      const y0 = Math.floor(fy), ty = fy - y0;
      for (let px = 0; px < c.width; px++) {
        const fx = px / TILE - 0.5;
        const x0 = Math.floor(fx), tx = fx - x0;
        const a = colorAt(x0, y0), b = colorAt(x0 + 1, y0), cc = colorAt(x0, y0 + 1), dd = colorAt(x0 + 1, y0 + 1);
        const n = (rng.next() - 0.5) * 10;
        const i = (py * c.width + px) * 4;
        for (let k = 0; k < 3; k++) {
          const top = a[k] + (b[k] - a[k]) * tx;
          const bot = cc[k] + (dd[k] - cc[k]) * tx;
          d[i + k] = top + (bot - top) * ty + n;
        }
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Decorations.
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const t = map.get(x, y);
        const cx = x * TILE, cy = y * TILE;
        if (t === Terrain.FOREST) {
          for (let k = 0; k < 3; k++) {
            const ox = cx + rng.range(6, 26), oy = cy + rng.range(6, 26), r = rng.range(5, 9);
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.beginPath(); ctx.arc(ox + 2, oy + 3, r, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = `rgb(${34 + rng.int(0, 20)},${64 + rng.int(0, 24)},${30 + rng.int(0, 12)})`;
            ctx.beginPath(); ctx.arc(ox, oy, r, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.beginPath(); ctx.arc(ox - r * 0.3, oy - r * 0.3, r * 0.5, 0, Math.PI * 2); ctx.fill();
          }
        } else if (t === Terrain.ROCK) {
          // Irregular boulders with a lit top edge.
          for (let k = 0; k < 2; k++) {
            const ox = cx + rng.range(4, 28), oy = cy + rng.range(4, 28), r = rng.range(6, 13);
            const pts = [];
            for (let a = 0; a < 7; a++) {
              const ang = (a / 7) * Math.PI * 2, rr = r * rng.range(0.7, 1.1);
              pts.push([ox + Math.cos(ang) * rr, oy + Math.sin(ang) * rr * 0.8]);
            }
            const poly = (dx, dy) => { ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px + dx, py + dy) : ctx.moveTo(px + dx, py + dy))); ctx.closePath(); };
            ctx.fillStyle = 'rgba(0,0,0,0.3)'; poly(3, 4); ctx.fill();
            const shade = rng.int(95, 130);
            ctx.fillStyle = `rgb(${shade},${shade - 4},${shade - 10})`; poly(0, 0); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            ctx.beginPath(); ctx.ellipse(ox - r * 0.2, oy - r * 0.3, r * 0.5, r * 0.25, 0, 0, Math.PI * 2); ctx.fill();
          }
        } else if (t === Terrain.GRASS && rng.next() < 0.08) {
          ctx.fillStyle = 'rgba(30,50,20,0.35)';
          ctx.fillRect(cx + rng.range(2, 28), cy + rng.range(2, 28), 2, 4);
        } else if (t === Terrain.WATER && rng.next() < 0.15) {
          ctx.strokeStyle = 'rgba(255,255,255,0.10)';
          ctx.beginPath();
          const wy = cy + rng.range(8, 24), wx = cx + rng.range(2, 14);
          ctx.moveTo(wx, wy); ctx.quadraticCurveTo(wx + 6, wy - 3, wx + 12, wy); ctx.stroke();
        }
      }
    }
    return c;
  }

  // Minimap terrain, one pixel per tile.
  buildMinimapTerrain() {
    const { map } = this.game;
    const c = document.createElement('canvas');
    c.width = map.w; c.height = map.h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(map.w, map.h);
    for (let i = 0; i < map.w * map.h; i++) {
      const col = TERRAIN_COLORS[map.tiles[i]];
      img.data[i * 4] = col[0]; img.data[i * 4 + 1] = col[1]; img.data[i * 4 + 2] = col[2]; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // ------------------------------------------------------------- events

  consumeEvents(audio) {
    for (const ev of this.game.events) {
      const seen = this.isTileVisible(ev.x, ev.y);
      switch (ev.type) {
        case 'fire':
          if (seen) {
            this.particles.push({ kind: 'flash', x: ev.x, y: ev.y, life: 0.08, max: 0.08, size: ev.fx === 'artillery' ? 0.6 : 0.3 });
            audio?.play(ev.fx, ev.x, ev.y);
          }
          break;
        case 'impact':
          if (seen) this.spawnImpact(ev);
          break;
        case 'explode':
          if (seen) {
            this.spawnExplosion(ev.x, ev.y, ev.size, ev.infantry);
            audio?.play(ev.infantry ? 'die' : 'explode', ev.x, ev.y, ev.size);
          }
          break;
        case 'credits':
          if (ev.owner === this.viewer) this.floaters.push({ text: `+$${ev.amount}`, x: ev.x, y: ev.y, life: 1.4, color: '#7dff8a' });
          break;
      }
    }
  }

  spawnImpact(ev) {
    const big = ev.splash > 0;
    const n = big ? 10 : 3;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * (big ? 2.5 : 1.2);
      this.particles.push({ kind: 'spark', x: ev.x, y: ev.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.25 + Math.random() * 0.2, max: 0.45 });
    }
    if (big) {
      this.particles.push({ kind: 'ring', x: ev.x, y: ev.y, life: 0.35, max: 0.35, size: ev.splash });
      this.particles.push({ kind: 'scorch', x: ev.x, y: ev.y, life: 12, max: 12, size: ev.splash * 0.6 });
    }
    if (ev.air) this.particles.push({ kind: 'puff', x: ev.x, y: ev.y - 0.4, life: 0.6, max: 0.6, size: 0.4 });
  }

  spawnExplosion(x, y, size, infantry) {
    if (infantry) {
      this.particles.push({ kind: 'blood', x, y, life: 8, max: 8, size: 0.25 });
      return;
    }
    this.particles.push({ kind: 'fireball', x, y, life: 0.7, max: 0.7, size: size * 0.7 });
    this.particles.push({ kind: 'scorch', x, y, life: 20, max: 20, size: size * 0.5 });
    for (let i = 0; i < 8 + size * 4; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * 3 * Math.sqrt(size);
      this.particles.push({ kind: 'smoke', x, y, vx: Math.cos(a) * s * 0.4, vy: Math.sin(a) * s * 0.4 - 0.3, life: 1 + Math.random(), max: 2, size: 0.3 + Math.random() * 0.4 * size });
      this.particles.push({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.4 + Math.random() * 0.3, max: 0.7 });
    }
  }

  isTileVisible(x, y) {
    const { map } = this.game;
    const tx = Math.floor(x), ty = Math.floor(y);
    if (!map.inBounds(tx, ty)) return false;
    return this.game.players[this.viewer].visible[ty * map.w + tx] === 1;
  }

  // -------------------------------------------------------------- frame

  render(cam, ui, alpha, dt) {
    const { ctx, canvas, game } = this;
    this.time += dt;
    const z = cam.zoom;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);
    ctx.imageSmoothingEnabled = true;

    // Only draw the visible slice of the terrain.
    const vw = canvas.width / z, vh = canvas.height / z;
    const sx = Math.max(0, cam.x), sy = Math.max(0, cam.y);
    const sw = Math.min(this.terrain.width - sx, vw), sh = Math.min(this.terrain.height - sy, vh);
    if (sw > 0 && sh > 0) ctx.drawImage(this.terrain, sx, sy, sw, sh, sx, sy, sw, sh);

    const view = { x0: cam.x / TILE - 2, y0: cam.y / TILE - 2, x1: (cam.x + vw) / TILE + 2, y1: (cam.y + vh) / TILE + 2 };
    const onScreen = (x, y) => x > view.x0 && x < view.x1 && y > view.y0 && y < view.y1;

    this.drawGroundParticles(dt, onScreen);
    this.drawWells(onScreen);

    const visibleEnts = [];
    for (const e of game.entities.values()) {
      const isMine = e.owner === this.viewer;
      if (!isMine && !game.isVisibleTo(this.viewer, e)) continue;
      if (!onScreen(e.x, e.y)) continue;
      visibleEnts.push(e);
    }
    this.updateMemory();
    this.drawMemory(onScreen);

    const ground = visibleEnts.filter((e) => e.kind === 'building');
    const units = visibleEnts.filter((e) => e.kind === 'unit');
    const air = units.filter((u) => u.def.domain === 'air');
    const surface = units.filter((u) => u.def.domain !== 'air');

    for (const b of ground) this.drawBuilding(b, ui.selected.has(b.id));
    for (const u of surface) this.drawUnit(u, alpha, ui.selected.has(u.id));
    this.drawProjectiles(onScreen);
    for (const u of air) this.drawUnit(u, alpha, ui.selected.has(u.id));
    this.drawAirParticles(dt, onScreen);

    this.drawFog();

    // Overlays drawn above fog.
    for (const e of visibleEnts) {
      const sel = ui.selected.has(e.id);
      if (sel || e.hp < e.maxHp || ui.hoverId === e.id) this.drawHealth(e, alpha);
    }
    this.drawRallyAndPaths(ui);
    this.drawFloaters(dt);
    if (ui.placing) this.drawPlacement(ui);
    if (ui.drag) this.drawDragBox(ui.drag);
    this.drawOrderMarkers(ui, dt);
  }

  lerpPos(e, alpha) {
    if (e.px === undefined) return { x: e.x, y: e.y };
    return { x: e.px + (e.x - e.px) * alpha, y: e.py + (e.y - e.py) * alpha };
  }

  drawWells(onScreen) {
    const { ctx } = this;
    const explored = this.game.players[this.viewer].explored;
    for (const w of this.game.map.wells) {
      if (!onScreen(w.x, w.y) || !explored[w.y * this.game.map.w + w.x]) continue;
      const cx = (w.x + 0.5) * TILE, cy = (w.y + 0.5) * TILE;
      const frac = w.amount / OIL_PER_WELL;
      ctx.fillStyle = 'rgba(10,8,6,0.75)';
      ctx.beginPath(); ctx.ellipse(cx, cy + 4, 14 * (0.4 + frac * 0.6), 9 * (0.4 + frac * 0.6), 0, 0, Math.PI * 2); ctx.fill();
      if (w.amount <= 0) continue;
      // Pumpjack.
      const bob = Math.sin(this.time * 3 + w.x) * 3;
      ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx - 6, cy + 6); ctx.lineTo(cx, cy - 6); ctx.lineTo(cx + 6, cy + 6); ctx.stroke();
      ctx.strokeStyle = '#d9a12b'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx - 11, cy - 6 + bob); ctx.lineTo(cx + 11, cy - 6 - bob); ctx.stroke();
      ctx.fillStyle = '#d9a12b';
      ctx.fillRect(cx - 13, cy - 8 + bob, 4, 6);
    }
  }

  updateMemory() {
    const { game } = this;
    for (const e of game.entities.values()) {
      if (e.kind === 'building' && e.owner !== this.viewer && game.isVisibleTo(this.viewer, e)) {
        this.memory.set(e.id, { type: e.type, owner: e.owner, tx: e.tx, ty: e.ty, w: e.w, h: e.h, x: e.x, y: e.y, progress: e.progress, hp: e.hp, maxHp: e.maxHp });
      }
    }
    for (const [id, m] of this.memory) {
      const e = game.get(id);
      if (!e && game.isVisibleTo(this.viewer, { kind: 'building', ...m })) this.memory.delete(id);
    }
  }

  drawMemory(onScreen) {
    for (const [id, m] of this.memory) {
      const e = this.game.get(id);
      if (e && this.game.isVisibleTo(this.viewer, e)) continue;
      if (!onScreen(m.x, m.y)) continue;
      this.drawBuilding({ ...m, def: BUILDINGS[m.type], kind: 'building', queue: [] }, false, true);
    }
  }

  teamColor(owner) { return this.game.players[owner].faction.color; }
  teamDark(owner) { return this.game.players[owner].faction.dark; }

  drawBuilding(b, selected, ghost = false) {
    const { ctx } = this;
    const x = b.tx * TILE, y = b.ty * TILE, w = b.w * TILE, h = b.h * TILE;
    const col = this.teamColor(b.owner), dark = this.teamDark(b.owner);
    ctx.save();
    if (ghost) ctx.globalAlpha = 0.55;
    // Shadow + concrete pad.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x + 5, y + 6, w, h);
    ctx.fillStyle = '#6d6f6c';
    ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    ctx.strokeStyle = '#3e403e'; ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

    const cx = x + w / 2, cy = y + h / 2;
    const built = b.progress >= 1;
    if (!built) {
      // Scaffolding fills as construction progresses.
      ctx.save();
      ctx.beginPath(); ctx.rect(x + 2, y + h - 2 - (h - 4) * b.progress, w - 4, (h - 4) * b.progress); ctx.clip();
    }
    switch (b.type) {
      case 'hq':
        ctx.fillStyle = '#8c8f88'; ctx.fillRect(x + 8, y + 8, w - 16, h - 16);
        ctx.fillStyle = dark; ctx.fillRect(x + 14, y + 14, w - 28, h - 28);
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx, cy, 14, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx + 20, cy - 20); ctx.lineTo(cx + 34, cy - 34); ctx.stroke();
        ctx.save(); ctx.translate(cx + 30, cy - 30); ctx.rotate(this.time * 1.5);
        ctx.strokeStyle = '#eee'; ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(7, 0); ctx.stroke(); ctx.restore();
        break;
      case 'refinery':
        for (const [ox, oy] of [[18, 20], [44, 44]]) {
          ctx.fillStyle = '#b7b9b2'; ctx.beginPath(); ctx.arc(x + ox, y + oy, 12, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(x + ox, y + oy, 6, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = col; ctx.fillRect(x + 36, y + 8, 18, 14);
        break;
      case 'barracks':
        ctx.fillStyle = '#7a7d5a'; ctx.fillRect(x + 6, y + 8, w - 12, h - 20);
        ctx.fillStyle = dark; ctx.fillRect(x + 6, y + 8, w - 12, 8);
        ctx.fillStyle = col; ctx.fillRect(x + 24, y + h - 14, 16, 10);
        break;
      case 'factory':
        ctx.fillStyle = '#80837d'; ctx.fillRect(x + 6, y + 6, w - 12, h - 26);
        for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? '#6c6f69' : '#93968f'; ctx.fillRect(x + 8 + i * 20, y + 8, 18, h - 30); }
        ctx.fillStyle = '#333'; ctx.fillRect(x + 28, y + h - 22, 40, 18);
        ctx.fillStyle = col; ctx.fillRect(x + 8, y + h - 18, 16, 12);
        break;
      case 'airfield':
        ctx.fillStyle = '#4b4d4a'; ctx.fillRect(x + 4, y + 36, w - 8, 24);
        ctx.strokeStyle = '#e6e6e6'; ctx.setLineDash([8, 6]); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x + 8, y + 48); ctx.lineTo(x + w - 8, y + 48); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#868980'; ctx.fillRect(x + 8, y + 6, 40, 26);
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + 72, y + 18, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ddd'; ctx.fillRect(x + 70, y + 8, 4, 20);
        break;
      case 'shipyard':
        ctx.fillStyle = '#5c6b78'; ctx.fillRect(x + 8, y + 8, w - 16, h - 16);
        ctx.fillStyle = '#2b4f72'; ctx.fillRect(x + 20, y + 14, w - 40, h - 28);
        ctx.fillStyle = col; ctx.fillRect(x + 8, y + 8, 14, 14);
        ctx.strokeStyle = '#d4b23a'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x + w - 14, y + h - 10); ctx.lineTo(x + w - 14, y + 10); ctx.lineTo(x + w / 2, y + 10); ctx.stroke();
        break;
      case 'turret':
      case 'samsite': {
        ctx.fillStyle = '#585a57'; ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.fill();
        const t = b.target != null ? this.game.get(b.target) : null;
        const ang = t ? Math.atan2(t.y - b.y, t.x - b.x) : -Math.PI / 4;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
        ctx.fillStyle = col; ctx.fillRect(-7, -7, 14, 14);
        ctx.fillStyle = '#222';
        if (b.type === 'turret') ctx.fillRect(4, -2, 14, 4);
        else { ctx.fillRect(2, -6, 12, 3); ctx.fillRect(2, 3, 12, 3); }
        ctx.restore();
        break;
      }
    }
    if (!built) {
      ctx.restore();
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.strokeStyle = 'rgba(240,200,60,0.7)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = -h; i < w; i += 10) { ctx.moveTo(x + i, y); ctx.lineTo(x + i + h, y + h); }
      ctx.stroke();
      ctx.restore();
    }
    // Team stripe.
    ctx.fillStyle = col;
    ctx.fillRect(x + 2, y + 2, w - 4, 3);
    if (selected) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      const m = 4;
      for (const [px, py, dx, dy] of [[x - m, y - m, 1, 1], [x + w + m, y - m, -1, 1], [x - m, y + h + m, 1, -1], [x + w + m, y + h + m, -1, -1]]) {
        ctx.beginPath(); ctx.moveTo(px + dx * 10, py); ctx.lineTo(px, py); ctx.lineTo(px, py + dy * 10); ctx.stroke();
      }
    }
    // Production progress bar.
    if (!ghost && b.queue?.length && built) {
      const item = b.queue[0];
      const f = Math.min(1, item.elapsed / UNITS[item.type].buildTime);
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x + 4, y + h - 8, w - 8, 4);
      ctx.fillStyle = '#ffd34d'; ctx.fillRect(x + 4, y + h - 8, (w - 8) * f, 4);
    }
    ctx.restore();
  }

  drawUnit(u, alpha, selected) {
    const { ctx } = this;
    const p = this.lerpPos(u, alpha);
    const x = p.x * TILE, y = p.y * TILE;
    const col = this.teamColor(u.owner), dark = this.teamDark(u.owner);
    const r = u.radius * TILE;
    const air = u.def.domain === 'air';
    const alt = air ? 14 : 0;

    if (selected) {
      ctx.strokeStyle = 'rgba(120,255,120,0.9)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(x, y, r + 4, (r + 4) * 0.75, 0, 0, Math.PI * 2); ctx.stroke();
    }
    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(x + (air ? 8 : 2), y + (air ? 10 : 3), r, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.translate(x, y - alt);
    if (u.def.domain === 'naval') {
      // Wake.
      const sp = u.px !== undefined ? Math.hypot(u.x - u.px, u.y - u.py) : 0;
      if (sp > 0.01) {
        ctx.save(); ctx.rotate(u.angle);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-r, -r * 0.4); ctx.lineTo(-r * 2.4, -r * 0.9); ctx.moveTo(-r, r * 0.4); ctx.lineTo(-r * 2.4, r * 0.9); ctx.stroke();
        ctx.restore();
      }
    }
    ctx.rotate(u.angle);
    switch (u.type) {
      case 'infantry':
      case 'rocketeer':
        for (const [ox, oy] of [[0, -5], [-4, 3], [4, 3]]) {
          ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(ox, oy, 3.5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = col; ctx.beginPath(); ctx.arc(ox, oy, 2.3, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#222'; ctx.fillRect(ox + 1, oy - 0.7, u.type === 'rocketeer' ? 6 : 5, u.type === 'rocketeer' ? 2.2 : 1.4);
        }
        break;
      case 'truck':
        ctx.fillStyle = dark; ctx.fillRect(-11, -7, 22, 14);
        ctx.fillStyle = col; ctx.fillRect(4, -6, 7, 12);
        ctx.fillStyle = '#555'; ctx.fillRect(-10, -5, 13, 10);
        if (u.cargo > 0) { ctx.fillStyle = '#1a1a1a'; ctx.fillRect(-9, -4, 11 * (u.cargo / 150), 8); }
        break;
      case 'scout':
        ctx.fillStyle = dark; ctx.fillRect(-9, -7, 18, 14);
        ctx.fillStyle = '#222'; for (const [ox, oy] of [[-6, -8], [5, -8], [-6, 6], [5, 6]]) ctx.fillRect(ox, oy, 4, 2.5);
        ctx.fillStyle = col; ctx.fillRect(-5, -4, 9, 8);
        ctx.fillStyle = '#333'; ctx.fillRect(0, -1, 11, 2);
        break;
      case 'tank':
      case 'aa':
      case 'artillery': {
        ctx.fillStyle = '#2d2d2b'; ctx.fillRect(-14, -11, 28, 5); ctx.fillRect(-14, 6, 28, 5);
        ctx.fillStyle = dark; ctx.fillRect(-12, -8, 24, 16);
        // Turret aims independently at the current target.
        const t = u.target != null ? this.game.get(u.target) : null;
        ctx.save();
        if (t) ctx.rotate(Math.atan2(t.y - u.y, t.x - u.x) - u.angle);
        ctx.fillStyle = col;
        if (u.type === 'tank') { ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#222'; ctx.fillRect(4, -1.8, 15, 3.6); }
        else if (u.type === 'aa') { ctx.fillRect(-6, -6, 12, 12); ctx.fillStyle = '#222'; ctx.fillRect(4, -5, 12, 2); ctx.fillRect(4, 3, 12, 2); }
        else { ctx.fillRect(-8, -6, 12, 12); ctx.fillStyle = '#222'; ctx.fillRect(2, -2, 22, 4); }
        ctx.restore();
        break;
      }
      case 'heli': {
        ctx.fillStyle = dark; ctx.beginPath(); ctx.ellipse(2, 0, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(-18, -1.5, 14, 3);
        ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(5, 0, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.save(); ctx.rotate(this.time * 25 + u.id);
        ctx.strokeStyle = 'rgba(30,30,30,0.7)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(16, 0); ctx.moveTo(0, -16); ctx.lineTo(0, 16); ctx.stroke();
        ctx.restore();
        break;
      }
      case 'fighter':
        ctx.fillStyle = dark;
        ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, -12); ctx.lineTo(-6, 0); ctx.lineTo(-10, 12); ctx.closePath(); ctx.fill();
        ctx.fillStyle = col; ctx.fillRect(-12, -2, 24, 4);
        ctx.fillStyle = '#9fd3ff'; ctx.fillRect(6, -1.5, 5, 3);
        break;
      case 'bomber':
        ctx.fillStyle = dark;
        ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-4, -20); ctx.lineTo(-10, -20); ctx.lineTo(-4, 0); ctx.lineTo(-10, 20); ctx.lineTo(-4, 20); ctx.closePath(); ctx.fill();
        ctx.fillStyle = col; ctx.fillRect(-16, -3, 32, 6);
        break;
      case 'gunboat':
        ctx.fillStyle = '#ccc';
        ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(8, -8); ctx.lineTo(-14, -8); ctx.lineTo(-14, 8); ctx.lineTo(8, 8); ctx.closePath(); ctx.fill();
        ctx.fillStyle = col; ctx.fillRect(-8, -5, 10, 10);
        ctx.fillStyle = '#333'; ctx.fillRect(6, -1.5, 9, 3);
        break;
      case 'destroyer':
        ctx.fillStyle = '#b8bcbf';
        ctx.beginPath(); ctx.moveTo(28, 0); ctx.lineTo(16, -10); ctx.lineTo(-22, -10); ctx.lineTo(-24, 0); ctx.lineTo(-22, 10); ctx.lineTo(16, 10); ctx.closePath(); ctx.fill();
        ctx.fillStyle = dark; ctx.fillRect(-12, -6, 16, 12);
        ctx.fillStyle = col; ctx.fillRect(-4, -4, 6, 8);
        ctx.fillStyle = '#333'; ctx.fillRect(10, -4, 8, 3); ctx.fillRect(10, 1, 8, 3); ctx.fillRect(-20, -2, 6, 4);
        break;
    }
    ctx.restore();
  }

  drawHealth(e, alpha) {
    const { ctx } = this;
    const p = e.kind === 'unit' ? this.lerpPos(e, alpha) : e;
    const w = e.kind === 'building' ? e.w * TILE - 8 : Math.max(18, e.radius * TILE * 2);
    const top = e.kind === 'building' ? e.ty * TILE - 7 : p.y * TILE - e.radius * TILE - (e.kind === 'unit' && e.def.domain === 'air' ? 24 : 9);
    const x = p.x * TILE - w / 2;
    const f = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x - 1, top - 1, w + 2, 5);
    ctx.fillStyle = f > 0.6 ? '#4ee36a' : f > 0.3 ? '#f2c94c' : '#eb5757';
    ctx.fillRect(x, top, w * f, 3);
  }

  drawProjectiles(onScreen) {
    const { ctx } = this;
    for (const p of this.game.projectiles) {
      if (!onScreen(p.x, p.y) || !this.isTileVisible(p.x, p.y)) continue;
      const w = WEAPONS[p.weapon];
      let x = p.x * TILE, y = p.y * TILE;
      if (w.arc) {
        const total = Math.hypot(p.tx - p.sx, p.ty - p.sy) || 1;
        const t = 1 - Math.hypot(p.tx - p.x, p.ty - p.y) / total;
        y -= Math.sin(Math.max(0, Math.min(1, t)) * Math.PI) * Math.min(80, total * 6);
      }
      if (p.air) y -= 14;
      const ang = Math.atan2(p.ty - p.y, p.tx - p.x);
      switch (w.fx) {
        case 'bullet':
          ctx.strokeStyle = '#ffe9a0'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(ang) * 6, y - Math.sin(ang) * 6); ctx.stroke();
          break;
        case 'flak':
          ctx.fillStyle = '#ffd36b'; ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
          break;
        case 'rocket':
          ctx.strokeStyle = 'rgba(220,220,220,0.5)'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(ang) * 14, y - Math.sin(ang) * 14); ctx.stroke();
          ctx.fillStyle = '#ff8a3d'; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
          break;
        case 'bomb':
          ctx.fillStyle = '#222'; ctx.beginPath(); ctx.ellipse(x, y, 5, 3, ang, 0, Math.PI * 2); ctx.fill();
          break;
        default:
          ctx.fillStyle = '#fff3c4'; ctx.beginPath(); ctx.arc(x, y, w.fx === 'artillery' ? 3.5 : 2.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  drawGroundParticles(dt, onScreen) {
    const { ctx } = this;
    for (const p of this.particles) {
      if (p.kind !== 'scorch' && p.kind !== 'blood') continue;
      p.life -= dt;
      if (!onScreen(p.x, p.y)) continue;
      const a = Math.min(1, p.life / 3);
      ctx.fillStyle = p.kind === 'blood' ? `rgba(90,10,10,${0.5 * a})` : `rgba(20,16,12,${0.45 * a})`;
      ctx.beginPath(); ctx.arc(p.x * TILE, p.y * TILE, p.size * TILE, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawAirParticles(dt, onScreen) {
    const { ctx } = this;
    const keep = [];
    for (const p of this.particles) {
      if (p.kind !== 'scorch' && p.kind !== 'blood') p.life -= dt;
      if (p.life <= 0) continue;
      keep.push(p);
      if (p.vx !== undefined) { p.x += p.vx * dt; p.y += p.vy * dt; }
      if (!onScreen(p.x, p.y)) continue;
      const t = 1 - p.life / p.max;
      const x = p.x * TILE, y = p.y * TILE;
      switch (p.kind) {
        case 'flash':
          ctx.fillStyle = `rgba(255,230,140,${1 - t})`;
          ctx.beginPath(); ctx.arc(x, y, p.size * TILE * (1 - t * 0.5), 0, Math.PI * 2); ctx.fill();
          break;
        case 'spark':
          ctx.fillStyle = `rgba(255,${180 - t * 120},60,${1 - t})`;
          ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
          break;
        case 'smoke':
          ctx.fillStyle = `rgba(60,58,55,${0.5 * (1 - t)})`;
          ctx.beginPath(); ctx.arc(x, y, p.size * TILE * (0.6 + t), 0, Math.PI * 2); ctx.fill();
          break;
        case 'puff':
          ctx.fillStyle = `rgba(40,40,40,${0.6 * (1 - t)})`;
          ctx.beginPath(); ctx.arc(x, y, p.size * TILE * (0.5 + t), 0, Math.PI * 2); ctx.fill();
          break;
        case 'ring':
          ctx.strokeStyle = `rgba(255,220,150,${1 - t})`; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, y, p.size * TILE * t, 0, Math.PI * 2); ctx.stroke();
          break;
        case 'fireball': {
          const g = ctx.createRadialGradient(x, y, 0, x, y, p.size * TILE * (0.6 + t));
          g.addColorStop(0, `rgba(255,250,200,${1 - t})`);
          g.addColorStop(0.4, `rgba(255,150,40,${0.9 * (1 - t)})`);
          g.addColorStop(1, 'rgba(120,30,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(x, y, p.size * TILE * (0.6 + t), 0, Math.PI * 2); ctx.fill();
          break;
        }
      }
    }
    this.particles = keep;
  }

  drawFog() {
    const { game, fogImage } = this;
    const p = game.players[this.viewer];
    const d = fogImage.data;
    for (let i = 0; i < p.visible.length; i++) {
      d[i * 4 + 3] = p.visible[i] ? 0 : p.explored[i] ? 130 : 255;
    }
    this.fogCtx.putImageData(fogImage, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(this.fogCanvas, 0, 0, game.map.w * TILE, game.map.h * TILE);
  }

  drawRallyAndPaths(ui) {
    const { ctx } = this;
    for (const id of ui.selected) {
      const e = this.game.get(id);
      if (!e || e.owner !== this.viewer) continue;
      if (e.kind === 'building' && e.rally) {
        ctx.strokeStyle = 'rgba(120,255,120,0.6)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(e.x * TILE, e.y * TILE); ctx.lineTo(e.rally.x * TILE, e.rally.y * TILE); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#7dff8a'; ctx.fillRect(e.rally.x * TILE - 1, e.rally.y * TILE - 14, 2, 14);
        ctx.fillRect(e.rally.x * TILE, e.rally.y * TILE - 14, 8, 5);
      }
    }
  }

  drawFloaters(dt) {
    const { ctx } = this;
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    this.floaters = this.floaters.filter((f) => (f.life -= dt) > 0);
    for (const f of this.floaters) {
      ctx.fillStyle = f.color;
      ctx.globalAlpha = Math.min(1, f.life);
      ctx.fillText(f.text, f.x * TILE, f.y * TILE - 16 - (1.4 - f.life) * 16);
    }
    ctx.globalAlpha = 1;
  }

  drawPlacement(ui) {
    const { ctx } = this;
    const def = BUILDINGS[ui.placing];
    const { tx, ty } = ui.placeTile;
    const ok = this.game.canPlace(this.viewer, ui.placing, tx, ty);
    ctx.fillStyle = ok ? 'rgba(80,255,120,0.3)' : 'rgba(255,60,60,0.35)';
    ctx.fillRect(tx * TILE, ty * TILE, def.w * TILE, def.h * TILE);
    ctx.strokeStyle = ok ? '#5f5' : '#f55'; ctx.lineWidth = 2;
    ctx.strokeRect(tx * TILE, ty * TILE, def.w * TILE, def.h * TILE);
  }

  drawDragBox(drag) {
    const { ctx } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = '#7dff8a'; ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(125,255,138,0.08)';
    const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1);
    ctx.fillRect(x, y, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
    ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
    ctx.restore();
  }

  drawOrderMarkers(ui, dt) {
    const { ctx } = this;
    ui.markers = ui.markers.filter((m) => (m.life -= dt) > 0);
    for (const m of ui.markers) {
      const t = 1 - m.life / 0.6;
      ctx.strokeStyle = m.color; ctx.globalAlpha = 1 - t; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(m.x * TILE, m.y * TILE, 4 + t * 10, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Sidebar icons are drawn with the same code as the battlefield.
  iconFor(kind, type) {
    this.icons ||= {};
    const key = kind + ':' + type;
    if (this.icons[key]) return this.icons[key];
    const size = 48;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ictx = c.getContext('2d');
    const saved = this.ctx;
    this.ctx = ictx;
    if (kind === 'unit') {
      const def = UNITS[type];
      const scale = { infantry: 2.4, rocketeer: 2.4, truck: 1.6, scout: 1.8, tank: 1.35, aa: 1.35, artillery: 1.2, heli: 1.25, fighter: 1.3, bomber: 1.0, gunboat: 1.15, destroyer: 0.8 }[type] || 1;
      ictx.translate(size / 2, size / 2 + (def.domain === 'air' ? 8 : 0));
      ictx.scale(scale, scale);
      this.drawUnit({ id: 1, x: 0, y: 0, angle: -Math.PI / 4, type, def, owner: this.viewer, radius: def.radius, target: null, cargo: 0 }, 1, false);
    } else {
      const def = BUILDINGS[type];
      const scale = (size - 6) / (Math.max(def.w, def.h) * TILE);
      ictx.translate(3, 3);
      ictx.scale(scale, scale);
      this.drawBuilding({ tx: 0, ty: 0, w: def.w, h: def.h, x: def.w / 2, y: def.h / 2, type, def, owner: this.viewer, progress: 1, queue: [], target: null }, false);
    }
    this.ctx = saved;
    this.icons[key] = c.toDataURL();
    return this.icons[key];
  }

  // ------------------------------------------------------------ minimap

  renderMinimap(mctx, size, cam, viewW, viewH) {
    const { game } = this;
    if (!this.miniTerrain) this.miniTerrain = this.buildMinimapTerrain();
    const s = size / game.map.w;
    mctx.imageSmoothingEnabled = false;
    mctx.drawImage(this.miniTerrain, 0, 0, size, size);
    for (const w of game.map.wells) {
      if (w.amount <= 0 || !game.players[this.viewer].explored[w.y * game.map.w + w.x]) continue;
      mctx.fillStyle = '#d9a12b'; mctx.fillRect(w.x * s - 1, w.y * s - 1, 3, 3);
    }
    for (const [, m] of this.memory) {
      mctx.fillStyle = this.teamColor(m.owner);
      mctx.fillRect(m.tx * s, m.ty * s, m.w * s, m.h * s);
    }
    for (const e of game.entities.values()) {
      if (e.owner !== this.viewer && !game.isVisibleTo(this.viewer, e)) continue;
      mctx.fillStyle = this.teamColor(e.owner);
      if (e.kind === 'building') mctx.fillRect(e.tx * s, e.ty * s, e.w * s, e.h * s);
      else mctx.fillRect(e.x * s - 1, e.y * s - 1, 2.5, 2.5);
    }
    mctx.imageSmoothingEnabled = true;
    mctx.drawImage(this.fogCanvas, 0, 0, size, size);
    mctx.strokeStyle = '#fff'; mctx.lineWidth = 1;
    mctx.strokeRect((cam.x / TILE) * s + 0.5, (cam.y / TILE) * s + 0.5, (viewW / TILE) * s, (viewH / TILE) * s);
  }
}
