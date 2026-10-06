import { TILE, DT, UNITS, BUILDINGS, BUILD_ORDER_MENU, WEAPONS } from './config.js';
import { Game } from './sim.js';
import { AIController } from './ai.js';
import { Renderer } from './render.js';
import { Audio } from './audio.js';

const ME = 0;
const $ = (id) => document.getElementById(id);

const view = $('view');
const minimap = $('minimap');
const mctx = minimap.getContext('2d');
const audio = new Audio();

let game, renderer, ai;
let running = false, paused = false, speed = 1;
const cam = { x: 0, y: 0, zoom: 1 };
const ui = {
  selected: new Set(), drag: null, placing: null, placeTile: { tx: 0, ty: 0 },
  attackMove: false, markers: [], hoverId: null, groups: {}, lastGroupKey: null, lastGroupTime: 0,
};
const keys = new Set();
const mouse = { x: -1, y: -1, inside: false, middle: null };
let lastUnderAttack = -999;

// ------------------------------------------------------------------ setup

function startGame() {
  const difficulty = $('difficulty').value;
  const seedInput = $('seed').value.trim();
  const seed = seedInput ? hashSeed(seedInput) : Math.floor(Math.random() * 1e9);
  game = new Game({ seed, players: [{ ai: false }, { ai: true }] });
  ai = new AIController(game, 1, difficulty);
  renderer = new Renderer(view, game, ME);
  ui.selected.clear();
  ui.placing = null;
  ui.groups = {};
  const hq = [...game.entities.values()].find((e) => e.owner === ME && e.type === 'hq');
  centerOn(hq.x, hq.y);
  $('menu').classList.add('hidden');
  $('endscreen').classList.add('hidden');
  running = true;
  paused = false;
  audio.unlock();
  notify(`Commander, the ${game.players[ME].faction.name} awaits your orders. Seed ${seed}.`);
}

function hashSeed(str) {
  if (/^\d+$/.test(str)) return Number(str) >>> 0;
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

function resize() {
  const dpr = 1; // keep pixel-art-ish crispness and performance predictable
  view.width = view.clientWidth * dpr;
  view.height = view.clientHeight * dpr;
  clampCamera();
}
window.addEventListener('resize', resize);

// ----------------------------------------------------------------- camera

function viewSize() { return { w: view.width / cam.zoom, h: view.height / cam.zoom }; }

function clampCamera() {
  if (!game) return;
  const { w, h } = viewSize();
  const mw = game.map.w * TILE, mh = game.map.h * TILE;
  cam.x = Math.max(-64, Math.min(mw - w + 64, cam.x));
  cam.y = Math.max(-64, Math.min(mh - h + 64, cam.y));
}

function centerOn(tx, ty) {
  const { w, h } = viewSize();
  cam.x = tx * TILE - w / 2;
  cam.y = ty * TILE - h / 2;
  clampCamera();
}

function screenToWorld(sx, sy) {
  return { x: (sx / cam.zoom + cam.x) / TILE, y: (sy / cam.zoom + cam.y) / TILE };
}

function updateCamera(dt) {
  const pan = 900 * dt / cam.zoom;
  if (keys.has('ArrowLeft')) cam.x -= pan;
  if (keys.has('ArrowRight')) cam.x += pan;
  if (keys.has('ArrowUp')) cam.y -= pan;
  if (keys.has('ArrowDown')) cam.y += pan;
  if (mouse.inside && mouse.x >= 0 && !ui.drag && !mouse.middle && document.hasFocus()) {
    const m = 10;
    if (mouse.x < m) cam.x -= pan;
    if (mouse.x > view.width - m) cam.x += pan;
    if (mouse.y < m) cam.y -= pan;
    if (mouse.y > view.height - m) cam.y += pan;
  }
  clampCamera();
}

// -------------------------------------------------------------- selection

function entityAt(wx, wy) {
  let best = null, bestD = Infinity;
  for (const e of game.entities.values()) {
    if (e.owner !== ME && !game.isVisibleTo(ME, e)) continue;
    if (e.kind === 'unit') {
      const air = e.def.domain === 'air' ? 14 / TILE : 0;
      const d = Math.hypot(e.x - wx, e.y + -air - wy);
      if (d < e.radius + 0.35 && d < bestD) { bestD = d; best = e; }
    }
  }
  if (best) return best;
  for (const e of game.entities.values()) {
    if (e.kind !== 'building') continue;
    if (e.owner !== ME && !game.isVisibleTo(ME, e)) continue;
    if (wx >= e.tx && wx < e.tx + e.w && wy >= e.ty && wy < e.ty + e.h) return e;
  }
  return null;
}

function wellAt(wx, wy) {
  return game.map.wells.findIndex((w) => w.amount > 0 && Math.hypot(w.x + 0.5 - wx, w.y + 0.5 - wy) < 0.8);
}

function selectedEntities() {
  return [...ui.selected].map((id) => game.get(id)).filter(Boolean);
}

function myUnits() {
  return selectedEntities().filter((e) => e.kind === 'unit' && e.owner === ME);
}

function boxSelect(x0, y0, x1, y1, additive) {
  const a = screenToWorld(Math.min(x0, x1), Math.min(y0, y1));
  const b = screenToWorld(Math.max(x0, x1), Math.max(y0, y1));
  const picked = [];
  for (const e of game.entities.values()) {
    if (e.owner !== ME || e.kind !== 'unit') continue;
    if (e.x >= a.x && e.x <= b.x && e.y >= a.y && e.y <= b.y) picked.push(e);
  }
  // Prefer combat units when trucks are mixed in.
  const combat = picked.filter((e) => !e.def.harvester);
  const final = combat.length ? combat : picked;
  if (!additive) ui.selected.clear();
  for (const e of final) ui.selected.add(e.id);
}

function clickSelect(wx, wy, additive, double) {
  const e = entityAt(wx, wy);
  if (!additive) ui.selected.clear();
  if (!e) return;
  if (double && e.owner === ME) {
    // Select every unit of this type on screen.
    const { w, h } = viewSize();
    const x0 = cam.x / TILE, y0 = cam.y / TILE, x1 = x0 + w / TILE, y1 = y0 + h / TILE;
    for (const o of game.entities.values()) {
      if (o.owner === ME && o.type === e.type && o.x >= x0 && o.x <= x1 && o.y >= y0 && o.y <= y1) ui.selected.add(o.id);
    }
    return;
  }
  if (additive && ui.selected.has(e.id)) ui.selected.delete(e.id);
  else ui.selected.add(e.id);
}

// ---------------------------------------------------------------- orders

function issueContextOrder(wx, wy) {
  const units = myUnits();
  const sel = selectedEntities();
  const target = entityAt(wx, wy);
  if (!units.length) {
    const b = sel.find((e) => e.kind === 'building' && e.owner === ME && e.def.produces);
    if (b) { game.cmdRally(ME, b.id, wx, wy); marker(wx, wy, '#7dff8a'); }
    return;
  }
  const ids = units.map((u) => u.id);
  if (target && target.owner !== ME) {
    game.cmdAttack(ME, ids, target.id);
    marker(target.x, target.y, '#ff5a4f');
    const rest = units.filter((u) => !u.def.weapon).map((u) => u.id);
    if (rest.length) game.cmdMove(ME, rest, wx, wy);
    return;
  }
  const trucks = units.filter((u) => u.def.harvester);
  const others = units.filter((u) => !u.def.harvester);
  const well = wellAt(wx, wy);
  if (trucks.length && well >= 0) {
    game.cmdHarvest(ME, trucks.map((u) => u.id), well);
    marker(wx, wy, '#ffd34d');
  } else if (trucks.length && target && target.owner === ME && target.def.dropoff) {
    for (const t of trucks) {
      game.cmdHarvest(ME, [t.id], t.well ?? game.nearestWell(t));
      if (t.cargo > 0) t.harvestState = 'toDropoff';
    }
    marker(wx, wy, '#ffd34d');
  } else if (trucks.length) {
    game.cmdMove(ME, trucks.map((u) => u.id), wx, wy);
  }
  if (others.length) {
    game.cmdMove(ME, others.map((u) => u.id), wx, wy, false);
    marker(wx, wy, '#7dff8a');
  }
}

function marker(x, y, color) { ui.markers.push({ x, y, color, life: 0.6 }); }

function attackMoveTo(wx, wy) {
  const ids = myUnits().filter((u) => u.def.weapon).map((u) => u.id);
  if (ids.length) { game.cmdMove(ME, ids, wx, wy, true); marker(wx, wy, '#ff9a3d'); }
  ui.attackMove = false;
  view.classList.remove('cursor-attack');
}

// ------------------------------------------------------------ input wiring

view.addEventListener('contextmenu', (e) => e.preventDefault());

view.addEventListener('pointermove', (e) => {
  mouse.x = e.offsetX; mouse.y = e.offsetY; mouse.inside = true;
  if (!game) return;
  if (mouse.middle) {
    cam.x = mouse.middle.cx - (e.offsetX - mouse.middle.x) / cam.zoom;
    cam.y = mouse.middle.cy - (e.offsetY - mouse.middle.y) / cam.zoom;
    clampCamera();
  }
  if (ui.drag) { ui.drag.x1 = e.offsetX; ui.drag.y1 = e.offsetY; }
  const w = screenToWorld(e.offsetX, e.offsetY);
  if (ui.placing) {
    const def = BUILDINGS[ui.placing];
    ui.placeTile = { tx: Math.round(w.x - def.w / 2), ty: Math.round(w.y - def.h / 2) };
  }
  const hov = entityAt(w.x, w.y);
  ui.hoverId = hov ? hov.id : null;
  view.classList.toggle('cursor-target', !!(hov && hov.owner !== ME && myUnits().length));
});
view.addEventListener('pointerleave', () => { mouse.inside = false; });
view.addEventListener('pointerenter', (e) => { mouse.x = e.offsetX; mouse.y = e.offsetY; mouse.inside = true; });

let lastClick = { t: 0, x: 0, y: 0 };
view.addEventListener('pointerdown', (e) => {
  if (!running) return;
  audio.unlock();
  view.setPointerCapture(e.pointerId);
  const w = screenToWorld(e.offsetX, e.offsetY);
  if (e.button === 1) {
    mouse.middle = { x: e.offsetX, y: e.offsetY, cx: cam.x, cy: cam.y };
    e.preventDefault();
    return;
  }
  if (e.button === 2) {
    if (ui.placing) { ui.placing = null; return; }
    if (ui.attackMove) { ui.attackMove = false; view.classList.remove('cursor-attack'); return; }
    issueContextOrder(w.x, w.y);
    return;
  }
  if (ui.placing) {
    const { tx, ty } = ui.placeTile;
    const b = game.cmdPlace(ME, ui.placing, tx, ty);
    if (b) {
      audio.blip(660);
      if (!e.shiftKey || game.players[ME].constructing) ui.placing = null;
    } else {
      notify(placeFailReason(ui.placing, tx, ty), true);
    }
    return;
  }
  if (ui.attackMove) { attackMoveTo(w.x, w.y); return; }
  ui.drag = { x0: e.offsetX, y0: e.offsetY, x1: e.offsetX, y1: e.offsetY, shift: e.shiftKey };
});

view.addEventListener('pointerup', (e) => {
  if (e.button === 1) { mouse.middle = null; return; }
  if (e.button !== 0 || !ui.drag) return;
  const d = ui.drag;
  ui.drag = null;
  if (Math.abs(d.x1 - d.x0) > 5 || Math.abs(d.y1 - d.y0) > 5) {
    boxSelect(d.x0, d.y0, d.x1, d.y1, d.shift);
  } else {
    const now = performance.now();
    const dbl = now - lastClick.t < 320 && Math.abs(lastClick.x - e.offsetX) < 6 && Math.abs(lastClick.y - e.offsetY) < 6;
    lastClick = { t: now, x: e.offsetX, y: e.offsetY };
    const w = screenToWorld(e.offsetX, e.offsetY);
    clickSelect(w.x, w.y, d.shift, dbl);
  }
  refreshSidebar(true);
});

view.addEventListener('wheel', (e) => {
  if (!game) return;
  e.preventDefault();
  const before = screenToWorld(e.offsetX, e.offsetY);
  cam.zoom = Math.max(0.45, Math.min(1.6, cam.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
  cam.x = before.x * TILE - e.offsetX / cam.zoom;
  cam.y = before.y * TILE - e.offsetY / cam.zoom;
  clampCamera();
}, { passive: false });

function minimapPointer(e) {
  if (!game) return;
  const rect = minimap.getBoundingClientRect();
  const tx = ((e.clientX - rect.left) / rect.width) * game.map.w;
  const ty = ((e.clientY - rect.top) / rect.height) * game.map.h;
  if (e.button === 2 || e.buttons === 2) issueContextOrder(tx, ty);
  else centerOn(tx, ty);
}
minimap.addEventListener('pointerdown', (e) => { minimap.setPointerCapture(e.pointerId); minimapPointer(e); });
minimap.addEventListener('pointermove', (e) => { if (e.buttons === 1) minimapPointer(e); });
minimap.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  keys.add(e.key);
  if (!running) return;
  const k = e.key.toLowerCase();
  if (/^[0-9]$/.test(e.key)) {
    if (e.ctrlKey || e.metaKey) {
      ui.groups[e.key] = [...ui.selected];
      notify(`Group ${e.key} assigned.`);
    } else if (ui.groups[e.key]) {
      ui.selected = new Set(ui.groups[e.key].filter((id) => game.get(id)));
      const now = performance.now();
      if (ui.lastGroupKey === e.key && now - ui.lastGroupTime < 400) {
        const first = game.get([...ui.selected][0]);
        if (first) centerOn(first.x, first.y);
      }
      ui.lastGroupKey = e.key; ui.lastGroupTime = now;
      refreshSidebar(true);
    }
    e.preventDefault();
    return;
  }
  switch (k) {
    case 'a':
      if (myUnits().length) { ui.attackMove = true; view.classList.add('cursor-attack'); }
      break;
    case 's':
      game.cmdStop(ME, myUnits().map((u) => u.id));
      break;
    case 'escape':
      if (ui.placing || ui.attackMove) {
        ui.placing = null; ui.attackMove = false; view.classList.remove('cursor-attack');
      } else {
        ui.selected.clear();
      }
      break;
    case 'h': {
      const hq = [...game.entities.values()].find((x) => x.owner === ME && x.type === 'hq');
      if (hq) centerOn(hq.x, hq.y);
      break;
    }
    case 'p':
      paused = !paused;
      notify(paused ? 'Paused.' : 'Resumed.');
      break;
    case 'm':
      audio.muted = !audio.muted;
      notify(audio.muted ? 'Sound off.' : 'Sound on.');
      break;
    case '+': case '=':
      speed = Math.min(3, speed + 0.5); notify(`Game speed ${speed}x`);
      break;
    case '-':
      speed = Math.max(0.5, speed - 0.5); notify(`Game speed ${speed}x`);
      break;
    case 'delete': {
      const b = selectedEntities().find((x) => x.kind === 'building' && x.owner === ME);
      if (b) game.cmdSell(ME, b.id);
      break;
    }
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key));
window.addEventListener('blur', () => keys.clear());

function placeFailReason(type, tx, ty) {
  const def = BUILDINGS[type];
  const p = game.players[ME];
  if (p.constructing) return 'Already constructing a structure.';
  if (p.credits < def.cost) return 'Insufficient funds.';
  if (!game.inBuildRadius(ME, tx, ty, def.w, def.h)) return 'Too far from your base.';
  if (def.coastal) return 'Naval Yard must be built on the shoreline.';
  return 'Cannot build there.';
}

// ---------------------------------------------------------------- sidebar

const sidebar = {
  build: $('build-list'), units: $('unit-list'), sel: $('selection'),
  credits: $('credits'), clock: $('clock'), status: $('status'),
};
let lastSidebarKey = '';

function refreshSidebar(force = false) {
  if (!game) return;
  const p = game.players[ME];
  sidebar.credits.textContent = `$${Math.floor(p.credits).toLocaleString()}`;
  const t = Math.floor(game.time);
  sidebar.clock.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;

  // Structures.
  const constructing = p.constructing ? game.get(p.constructing) : null;
  let html = '';
  for (const type of BUILD_ORDER_MENU) {
    const def = BUILDINGS[type];
    const unlocked = game.canBuildType(ME, type);
    const afford = p.credits >= def.cost;
    const isBuilding = constructing && constructing.type === type;
    const cls = ['btn', !unlocked && 'locked', unlocked && !afford && 'poor', ui.placing === type && 'active', isBuilding && 'busy'].filter(Boolean).join(' ');
    const req = !unlocked ? `Requires ${def.requires.map((r) => BUILDINGS[r].name).join(', ')}` : '';
    html += `<button class="${cls}" data-build="${type}" title="${def.name} — $${def.cost}${req ? '\n' + req : ''}">
      <img class="icon" src="${renderer.iconFor('building', type)}" alt=""><span class="name">${def.name}</span><span class="cost">$${def.cost}</span>
      ${isBuilding ? `<span class="prog" style="width:${Math.round(constructing.progress * 100)}%"></span>` : ''}
    </button>`;
  }
  if (html !== sidebar.build._html) { sidebar.build.innerHTML = html; sidebar.build._html = html; }

  // Units, grouped by the structures that produce them.
  const producers = {};
  for (const e of game.entities.values()) {
    if (e.owner === ME && e.kind === 'building' && e.progress >= 1 && e.def.produces) (producers[e.type] ||= []).push(e);
  }
  html = '';
  for (const btype of ['hq', 'barracks', 'factory', 'airfield', 'shipyard']) {
    if (!producers[btype]) continue;
    html += `<div class="group-label">${BUILDINGS[btype].name}${producers[btype].length > 1 ? ` ×${producers[btype].length}` : ''}</div>`;
    for (const utype of BUILDINGS[btype].produces) {
      if (btype === 'factory' && utype === 'truck') continue;
      const def = UNITS[utype];
      let queued = 0, prog = 0;
      for (const b of producers[btype]) {
        for (const [i, q] of b.queue.entries()) {
          if (q.type !== utype) continue;
          queued++;
          if (i === 0) prog = Math.max(prog, q.elapsed / def.buildTime);
        }
      }
      const afford = p.credits >= def.cost;
      const weapon = def.weapon ? WEAPONS[def.weapon] : null;
      const tip = `${def.name} — $${def.cost}\nHP ${def.hp} · Speed ${def.speed}${weapon ? `\nTargets: ${weapon.hits.join(', ')}` : ''}\nLeft-click: queue · Right-click: cancel`;
      html += `<button class="btn${afford ? '' : ' poor'}" data-unit="${utype}" data-producer="${btype}" title="${tip}">
        <img class="icon" src="${renderer.iconFor('unit', utype)}" alt=""><span class="name">${def.name}</span><span class="cost">$${def.cost}</span>
        ${queued ? `<span class="badge">${queued}</span>` : ''}
        ${prog > 0 ? `<span class="prog" style="width:${Math.round(prog * 100)}%"></span>` : ''}
      </button>`;
    }
  }
  if (!html) html = '<div class="hint">Build a Barracks to train troops.</div>';
  if (html !== sidebar.units._html) { sidebar.units.innerHTML = html; sidebar.units._html = html; }

  // Selection panel.
  const sel = selectedEntities();
  const key = sel.map((e) => `${e.id}:${Math.ceil(e.hp / 10)}:${e.order?.type}:${e.harvestState}:${Math.round(e.cargo || 0)}`).join('|');
  if (!force && key === lastSidebarKey) return;
  lastSidebarKey = key;
  if (!sel.length) { sidebar.sel.innerHTML = '<div class="hint">Nothing selected.</div>'; return; }
  if (sel.length === 1) {
    const e = sel[0];
    const owner = game.players[e.owner].faction;
    let detail = '';
    if (e.kind === 'unit') {
      const w = e.def.weapon ? WEAPONS[e.def.weapon] : null;
      detail += `<div>Status: ${describeOrder(e)}</div>`;
      if (w) detail += `<div>Weapon range ${w.range} · hits ${w.hits.join('/')}</div>`;
      if (e.def.harvester) detail += `<div>Cargo: ${Math.round(e.cargo)} / 150</div>`;
    } else {
      if (e.progress < 1) detail += `<div>Under construction: ${Math.round(e.progress * 100)}%</div>`;
      if (e.queue?.length) detail += `<div>Queue: ${e.queue.map((q) => UNITS[q.type].name).join(', ')}</div>`;
      if (e.owner === ME && e.type !== 'hq') detail += `<button class="small" data-sell="${e.id}">Sell (Del)</button>`;
    }
    sidebar.sel.innerHTML = `<div class="sel-title" style="color:${owner.color}">${e.def.name}</div>
      <div class="hpbar"><span style="width:${(100 * e.hp) / e.maxHp}%"></span></div>
      <div class="sel-hp">${Math.ceil(e.hp)} / ${e.maxHp}</div>${detail}`;
  } else {
    const counts = {};
    for (const e of sel) counts[e.def.name] = (counts[e.def.name] || 0) + 1;
    sidebar.sel.innerHTML = `<div class="sel-title">${sel.length} units</div>` +
      Object.entries(counts).map(([n, c]) => `<div>${c} × ${n}</div>`).join('') +
      '<div class="hint">A: attack-move · S: stop · Ctrl+1-9: group</div>';
  }
}

function describeOrder(u) {
  if (u.order.type === 'harvest') return { toWell: 'Heading to oil', loading: 'Pumping oil', toDropoff: 'Returning cargo' }[u.harvestState] || 'Harvesting';
  if (u.order.type === 'attack') return 'Attacking';
  if (u.order.type === 'attackMove') return 'Attack-moving';
  if (u.order.type === 'move') return 'Moving';
  return u.target ? 'Engaging' : 'Idle';
}

$('sidebar').addEventListener('pointerdown', (e) => {
  if (!game) return;
  audio.unlock();
  const btn = e.target.closest('button');
  if (!btn) return;
  e.preventDefault();
  if (btn.dataset.build) {
    const type = btn.dataset.build;
    const def = BUILDINGS[type];
    if (!game.canBuildType(ME, type)) return notify(`Requires ${def.requires.map((r) => BUILDINGS[r].name).join(', ')}.`, true);
    if (game.players[ME].constructing) return notify('Already constructing a structure.', true);
    if (game.players[ME].credits < def.cost) return notify('Insufficient funds.', true);
    ui.placing = ui.placing === type ? null : type;
    if (ui.placing) notify(`Place ${def.name}. Right-click to cancel.`);
  } else if (btn.dataset.unit) {
    const type = btn.dataset.unit, btype = btn.dataset.producer;
    const blds = [...game.entities.values()].filter((b) => b.owner === ME && b.type === btype && b.progress >= 1);
    if (e.button === 2) {
      const b = blds.find((x) => x.queue.some((q) => q.type === type));
      if (b) {
        const idx = b.queue.map((q) => q.type).lastIndexOf(type);
        game.cmdCancel(ME, b.id, idx);
      }
    } else {
      // Queue at the least busy structure of that type.
      blds.sort((a, b) => a.queue.length - b.queue.length);
      const n = e.shiftKey ? 5 : 1;
      let ok = false;
      for (let i = 0; i < n; i++) {
        blds.sort((a, b) => a.queue.length - b.queue.length);
        if (blds[0] && game.cmdQueue(ME, blds[0].id, type)) ok = true;
      }
      if (!ok) notify(game.players[ME].credits < UNITS[type].cost ? 'Insufficient funds.' : 'Production queue full.', true);
      else audio.blip(990);
    }
  } else if (btn.dataset.sell) {
    game.cmdSell(ME, Number(btn.dataset.sell));
    ui.selected.clear();
  }
  refreshSidebar(true);
});
$('sidebar').addEventListener('contextmenu', (e) => e.preventDefault());

// ----------------------------------------------------------- notifications

let notifyTimer = null;
function notify(text, warn = false) {
  const el = $('message');
  el.textContent = text;
  el.classList.toggle('warn', warn);
  el.classList.add('show');
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function handleGameEvents() {
  for (const ev of game.events) {
    if (ev.owner !== ME) continue;
    if (ev.type === 'built') { notify(`${BUILDINGS[ev.building].name} complete.`); audio.blip(740); }
    else if (ev.type === 'unitReady') audio.blip(1100);
    else if (ev.type === 'underAttack' && game.time - lastUnderAttack > 12) {
      lastUnderAttack = game.time;
      notify('Our base is under attack!', true);
      audio.blip(330);
    }
  }
}

function showEnd() {
  running = false;
  const win = game.winner === ME;
  const me = game.players[ME].stats, foe = game.players[1].stats;
  const t = Math.floor(game.time);
  $('end-title').textContent = win ? 'VICTORY' : 'DEFEAT';
  $('end-title').className = win ? 'win' : 'lose';
  $('end-stats').innerHTML = `
    <tr><th></th><th>You</th><th>Enemy</th></tr>
    <tr><td>Enemies destroyed</td><td>${me.killed}</td><td>${foe.killed}</td></tr>
    <tr><td>Losses</td><td>${me.lost}</td><td>${foe.lost}</td></tr>
    <tr><td>Oil harvested</td><td>$${me.harvested}</td><td>$${foe.harvested}</td></tr>
    <tr><td>Mission time</td><td colspan="2">${Math.floor(t / 60)}m ${t % 60}s</td></tr>`;
  $('endscreen').classList.remove('hidden');
}

// ----------------------------------------------------------------- loop

let acc = 0, last = performance.now(), sidebarTimer = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (game) {
    updateCamera(dt);
    if (running && !paused) {
      acc += dt * speed;
      let steps = 0;
      while (acc >= DT && steps < 8) {
        for (const e of game.entities.values()) { e.px = e.x; e.py = e.y; }
        ai.update();
        game.step();
        handleGameEvents();
        renderer.consumeEvents(audio);
        game.events.length = 0;
        acc -= DT;
        steps++;
        if (game.winner !== null) { showEnd(); break; }
      }
    }
    const { w, h } = viewSize();
    audio.setListener((cam.x + w / 2) / TILE, (cam.y + h / 2) / TILE, Math.max(w, h) / TILE);
    for (const id of ui.selected) if (!game.get(id)) ui.selected.delete(id);
    renderer.render(cam, ui, paused ? 1 : Math.min(1, acc / DT), paused ? 0 : dt);
    renderer.renderMinimap(mctx, minimap.width, cam, w, h);
    sidebarTimer -= dt;
    if (sidebarTimer <= 0) { refreshSidebar(); sidebarTimer = 0.15; }
    $('status').textContent = paused ? 'PAUSED' : speed !== 1 ? `${speed}x` : '';
  }
  requestAnimationFrame(frame);
}

$('start').addEventListener('click', startGame);
$('again').addEventListener('click', () => { $('endscreen').classList.add('hidden'); $('menu').classList.remove('hidden'); });
$('btn-menu').addEventListener('click', () => {
  paused = true;
  $('menu').classList.remove('hidden');
  $('resume').classList.toggle('hidden', !running);
});
$('resume').addEventListener('click', () => { $('menu').classList.add('hidden'); paused = false; });

resize();
requestAnimationFrame(frame);

// Exposed for debugging from the console.
window.__rw = { get game() { return game; }, cam, ui };
