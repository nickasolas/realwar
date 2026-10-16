import { DT, UNITS, BUILDINGS, BUILD_ORDER_MENU, FORTIFICATION_MENU, ROAD, WEAPONS, TECHS, TECH_ORDER, RESEARCH, MAP_SIZES, CHEATS } from './config.js';
import { lineTiles } from './map.js';
import { Game, cargoSize } from './sim.js';
import { AIController } from './ai.js';
import { Renderer3D, CAMERA } from './gfx/renderer3d.js';
import { Audio } from './audio.js';

const ME = 0;
const $ = (id) => document.getElementById(id);

const view = $('view');
const overlay = $('overlay');
const minimap = $('minimap');
const mctx = minimap.getContext('2d');
const audio = new Audio();

let game, renderer, ais = [];
let running = false, paused = false, speed = 1;
// Camera target in tile coordinates; zoom is the camera distance.
const cam = { x: 0, y: 0, zoom: CAMERA.defaultDist };
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
  const quality = $('quality').value;
  const seedInput = $('seed').value.trim();
  const seed = seedInput ? hashSeed(seedInput) : Math.floor(Math.random() * 1e9);
  $('loading').classList.remove('hidden');
  // Let the loading text paint before the heavy world build.
  setTimeout(() => {
    const opponents = Number($('opponents').value) || 1;
    const players = [{ ai: false }, ...Array.from({ length: opponents }, () => ({ ai: true }))];
    game = new Game({ seed, mapSize: MAP_SIZES[$('map-size').value] || MAP_SIZES.medium, mapType: $('map-type').value, players });
    ais = players.slice(1).map((_, i) => new AIController(game, i + 1, difficulty));
    renderer?.dispose();
    renderer = new Renderer3D(view, overlay, game, ME, quality);
    resize();
    ui.selected.clear();
    ui.placing = null;
    ui.groups = {};
    sidebar.build._html = sidebar.fort._html = sidebar.units._html = sidebar.research._html = null;
    const hq = [...game.entities.values()].find((e) => e.owner === ME && e.type === 'hq');
    cam.zoom = CAMERA.defaultDist;
    centerOn(hq.x + 1, hq.y + 2);
    $('loading').classList.add('hidden');
    $('menu').classList.add('hidden');
    $('endscreen').classList.add('hidden');
    toggleCheats(false);
    running = true;
    paused = false;
    audio.unlock();
    notify(`Commander, the ${game.players[ME].faction.name} awaits your orders. Seed ${seed}.`);
  }, 30);
}

function hashSeed(str) {
  if (/^\d+$/.test(str)) return Number(str) >>> 0;
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

function resize() {
  if (renderer) renderer.resize(view.clientWidth, view.clientHeight);
}
window.addEventListener('resize', resize);

// ----------------------------------------------------------------- camera

function clampCamera() {
  if (!game) return;
  cam.zoom = Math.max(CAMERA.minDist, Math.min(CAMERA.maxDist, cam.zoom));
  cam.x = Math.max(2, Math.min(game.map.w - 2, cam.x));
  cam.y = Math.max(2, Math.min(game.map.h + 2, cam.y));
}

function centerOn(tx, ty) {
  cam.x = tx;
  cam.y = ty;
  clampCamera();
}

// Screen pixel -> tile coordinates on the ground.
function screenToWorld(sx, sy) {
  return renderer.pickGround(sx, sy) || { x: cam.x, y: cam.y };
}

function updateCamera(dt) {
  const pan = cam.zoom * 1.1 * dt;
  if (keys.has('ArrowLeft')) cam.x -= pan;
  if (keys.has('ArrowRight')) cam.x += pan;
  if (keys.has('ArrowUp')) cam.y -= pan;
  if (keys.has('ArrowDown')) cam.y += pan;
  if (keys.has('PageUp')) cam.zoom -= cam.zoom * dt;
  if (keys.has('PageDown')) cam.zoom += cam.zoom * dt;
  if (mouse.inside && mouse.x >= 0 && !ui.drag && !mouse.middle && document.hasFocus()) {
    const m = 10;
    if (mouse.x < m) cam.x -= pan;
    if (mouse.x > view.clientWidth - m) cam.x += pan;
    if (mouse.y < m) cam.y -= pan;
    if (mouse.y > view.clientHeight - m) cam.y += pan;
  }
  clampCamera();
}

// -------------------------------------------------------------- selection

function entityAt(sx, sy) {
  return renderer.entityAt(sx, sy);
}

function wellAt(wx, wy) {
  return game.map.wells.findIndex((w) => w.amount > 0 && Math.hypot(w.x + 0.5 - wx, w.y + 0.5 - wy) < 0.9);
}

function selectedEntities() {
  return [...ui.selected].map((id) => game.get(id)).filter(Boolean);
}

function myUnits() {
  return selectedEntities().filter((e) => e.kind === 'unit' && e.owner === ME);
}

function boxSelect(x0, y0, x1, y1, additive) {
  const picked = renderer.unitsInRect(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), ME);
  // Prefer combat units when trucks are mixed in.
  const combat = picked.filter((e) => !e.def.harvester);
  const final = combat.length ? combat : picked;
  if (!additive) ui.selected.clear();
  for (const e of final) ui.selected.add(e.id);
}

function clickSelect(sx, sy, additive, double) {
  const e = entityAt(sx, sy);
  if (!additive) ui.selected.clear();
  if (!e) return;
  if (double && e.owner === ME) {
    // Select every unit of this type on screen.
    for (const o of game.entities.values()) {
      if (o.owner === ME && o.type === e.type && renderer.onScreen(o)) ui.selected.add(o.id);
    }
    return;
  }
  if (additive && ui.selected.has(e.id)) ui.selected.delete(e.id);
  else ui.selected.add(e.id);
}

// ---------------------------------------------------------------- orders

function issueContextOrder(wx, wy, target = null) {
  const units = myUnits();
  const sel = selectedEntities();
  if (!units.length) {
    // Only structures selected: right-click sets their rally point.
    setRally(wx, wy);
    return;
  }
  // Transports take a new drop zone; everything else carries on below.
  const planes = units.filter((u) => u.def.transport);
  if (planes.length && game.cmdParadrop(ME, planes.map((u) => u.id), wx, wy)) marker(wx, wy, '#7dff8a');
  if (planes.length === units.length) return;
  // Ground units right-clicking our landing craft climb aboard.
  if (target && target.owner === ME && target.kind === 'unit' && target.def.capacity) {
    const riders = units.filter((u) => cargoSize(u) > 0);
    if (riders.length && game.cmdBoard(ME, riders.map((u) => u.id), target.id)) {
      marker(target.x, target.y, '#5fd0ff');
      notify(`${riders.length} unit${riders.length > 1 ? 's' : ''} boarding the ${target.def.name}.`);
      return;
    }
  }
  // Loaded landing craft ordered onto land sail to the nearest beach and unload.
  const onLand = game.map.passable(Math.floor(wx), Math.floor(wy), 'ground');
  const landers = units.filter((u) => u.def.capacity && u.passengers?.length);
  if (onLand && !target && landers.length && game.cmdUnload(ME, landers.map((u) => u.id), wx, wy)) {
    marker(wx, wy, '#5fd0ff');
    const rest = units.filter((u) => !landers.includes(u));
    if (!rest.length) return;
    units.splice(0, units.length, ...rest);
  }
  const ids = units.map((u) => u.id);
  if (target && target.owner === ME && target.kind === 'building' && target.def.repairs) {
    const sent = game.cmdService(ME, ids, target.id);
    if (sent) {
      marker(target.x, target.y, '#5fd0ff');
      const others = units.filter((u) => game.repairDomain(u) !== target.def.repairs).map((u) => u.id);
      if (others.length) game.cmdMove(ME, others, wx, wy);
      return;
    }
  }
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

function marker(x, y, color) { ui.markers.push({ x, y, color }); }

function selectedProducers() {
  return selectedEntities().filter((e) => e.kind === 'building' && e.owner === ME && e.def.produces);
}

// Point every selected production structure at (wx, wy).
function setRally(wx, wy) {
  const producers = selectedProducers();
  if (!producers.length) return false;
  const results = producers.map((b) => game.cmdRally(ME, b.id, wx, wy));
  const onWell = producers.some((b) => b.rally?.well != null);
  if (results.every((r) => r === 'cleared')) notify('Rally point cleared.');
  else {
    const n = producers.length > 1 ? ` for ${producers.length} structures` : '';
    notify(onWell ? `Rally point set on an oil well${n}: new trucks will harvest it.` : `Rally point set${n}. New units will deploy there.`);
    marker(wx, wy, onWell ? '#ffd34d' : '#7dff8a');
  }
  refreshSidebar(true);
  return true;
}

// ICBM targeting: pick a silo's target on the map.
function startLaunchMode() {
  const silo = selectedEntities().find((e) => e.owner === ME && e.def.missile && e.progress >= 1);
  if (!silo) return;
  if (silo.charge < 1) { notify(`Missile not ready: ${Math.round(silo.charge * 100)}% charged.`, true); return; }
  ui.launchSilo = silo.id;
  view.classList.add('cursor-attack');
  notify('Select the missile target. Right-click or Esc to cancel.', true);
}

function endLaunchMode() {
  ui.launchSilo = null;
  view.classList.remove('cursor-attack');
}

function launchAt(wx, wy) {
  if (game.cmdLaunch(ME, ui.launchSilo, wx, wy)) {
    marker(wx, wy, '#ff3030');
    notify('Missile launched.', true);
  }
  endLaunchMode();
  refreshSidebar(true);
}

function startRallyMode() {
  if (!selectedProducers().length) return;
  ui.rallyMode = true;
  view.classList.add('cursor-attack');
  notify('Click where new units should deploy. Right-click or Esc to cancel.');
}

function endRallyMode() {
  ui.rallyMode = false;
  view.classList.remove('cursor-attack');
}

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
  if (!game || !renderer) return;
  if (mouse.middle) {
    // Keep the grabbed ground point under the cursor.
    const g = renderer.pickGround(e.offsetX, e.offsetY);
    if (g) { cam.x += mouse.middle.gx - g.x; cam.y += mouse.middle.gy - g.y; clampCamera(); renderer.applyCamera(cam); }
  }
  if (ui.drag) { ui.drag.x1 = e.offsetX; ui.drag.y1 = e.offsetY; }
  if (ui.placing) {
    const w = screenToWorld(e.offsetX, e.offsetY);
    const def = BUILDINGS[ui.placing] || { w: 1, h: 1 };
    ui.placeTile = { tx: Math.round(w.x - def.w / 2), ty: Math.round(w.y - def.h / 2) };
    if (ui.lineStart) ui.lineTiles = lineTiles(ui.lineStart, { x: ui.placeTile.tx, y: ui.placeTile.ty }, ui.placing === 'road');
  }
  const hov = entityAt(e.offsetX, e.offsetY);
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
    mouse.middle = { gx: w.x, gy: w.y };
    e.preventDefault();
    return;
  }
  if (e.button === 2) {
    if (ui.placing) { ui.placing = null; ui.lineStart = ui.lineTiles = null; return; }
    if (ui.attackMove) { ui.attackMove = false; view.classList.remove('cursor-attack'); return; }
    if (ui.rallyMode) { endRallyMode(); return; }
    if (ui.launchSilo) { endLaunchMode(); return; }
    issueContextOrder(w.x, w.y, entityAt(e.offsetX, e.offsetY));
    return;
  }
  if (ui.placing) {
    const { tx, ty } = ui.placeTile;
    // Walls and roads are dragged out as lines and placed on release.
    if (isLineTool(ui.placing)) {
      ui.lineStart = { x: tx, y: ty };
      ui.lineTiles = [{ x: tx, y: ty }];
      return;
    }
    const b = game.cmdPlace(ME, ui.placing, tx, ty);
    if (b) {
      audio.blip(660);
      // Fortification tools stay active; other structures need Shift.
      if (!BUILDINGS[ui.placing].segment && (!e.shiftKey || game.players[ME].constructing)) ui.placing = null;
    } else {
      notify(placeFailReason(ui.placing, tx, ty), true);
    }
    return;
  }
  if (ui.attackMove) { attackMoveTo(w.x, w.y); return; }
  if (ui.rallyMode) { setRally(w.x, w.y); endRallyMode(); return; }
  if (ui.launchSilo) { launchAt(w.x, w.y); return; }
  ui.drag = { x0: e.offsetX, y0: e.offsetY, x1: e.offsetX, y1: e.offsetY, shift: e.shiftKey };
});

view.addEventListener('pointerup', (e) => {
  if (e.button === 1) { mouse.middle = null; return; }
  if (e.button === 0 && ui.lineStart) { finishLine(); return; }
  if (e.button !== 0 || !ui.drag) return;
  const d = ui.drag;
  ui.drag = null;
  if (Math.abs(d.x1 - d.x0) > 5 || Math.abs(d.y1 - d.y0) > 5) {
    boxSelect(d.x0, d.y0, d.x1, d.y1, d.shift);
  } else {
    const now = performance.now();
    const dbl = now - lastClick.t < 320 && Math.abs(lastClick.x - e.offsetX) < 6 && Math.abs(lastClick.y - e.offsetY) < 6;
    lastClick = { t: now, x: e.offsetX, y: e.offsetY };
    clickSelect(e.offsetX, e.offsetY, d.shift, dbl);
  }
  refreshSidebar(true);
});

view.addEventListener('wheel', (e) => {
  if (!game || !renderer) return;
  e.preventDefault();
  // Zoom toward the point under the cursor.
  const before = screenToWorld(e.offsetX, e.offsetY);
  const f = e.deltaY < 0 ? 1 / 1.12 : 1.12;
  const old = cam.zoom;
  cam.zoom = Math.max(CAMERA.minDist, Math.min(CAMERA.maxDist, cam.zoom * f));
  const k = 1 - cam.zoom / old;
  cam.x += (before.x - cam.x) * k;
  cam.y += (before.y - cam.y) * k;
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
      if (ui.placing || ui.attackMove || ui.rallyMode || ui.launchSilo) {
        ui.placing = null; ui.attackMove = false; ui.rallyMode = false; ui.launchSilo = null; ui.lineStart = ui.lineTiles = null; view.classList.remove('cursor-attack');
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
    case 'r': {
      // Buildings: toggle repair. Units: go to the nearest repair facility.
      const blds = selectedEntities().filter((x) => x.kind === 'building' && x.owner === ME && x.progress >= 1);
      if (blds.length) {
        const turnOn = blds.some((b) => !b.repairing && b.hp < b.maxHp);
        for (const b of blds) game.cmdRepair(ME, b.id, turnOn && b.hp < b.maxHp);
        notify(turnOn ? 'Repairing.' : 'Repair stopped.');
      } else if (myUnits().length) {
        const n = sendForRepair(myUnits());
        notify(n ? `${n} unit${n > 1 ? 's' : ''} heading for repairs.` : 'No damaged units with a repair facility available.', !n);
      }
      refreshSidebar(true);
      break;
    }
    case 'l':
      startLaunchMode();
      break;
    case '`':
      toggleCheats();
      break;
    case 'u': {
      const landers = myUnits().filter((u) => u.def.capacity && u.passengers?.length);
      if (landers.length) notify(game.cmdUnload(ME, landers.map((u) => u.id)) ? 'Unloading.' : 'No beach within reach to unload.', false);
      break;
    }
    case 'delete': {
      const b = selectedEntities().find((x) => x.kind === 'building' && x.owner === ME);
      if (b) game.cmdSell(ME, b.id);
      break;
    }
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key));
window.addEventListener('blur', () => keys.clear());

function isLineTool(type) {
  return type === 'wall' || type === 'road';
}

// Place the dragged-out wall or road and report what it cost.
function finishLine() {
  const tiles = ui.lineTiles || [];
  const type = ui.placing;
  ui.lineStart = ui.lineTiles = null;
  if (!type || !tiles.length) return;
  const before = game.players[ME].credits;
  const n = type === 'road' ? game.cmdBuildRoad(ME, tiles) : game.cmdPlaceLine(ME, type, tiles);
  const spent = Math.round(before - game.players[ME].credits);
  if (n) {
    audio.blip(660);
    const what = type === 'road' ? `${n} road tile${n > 1 ? 's' : ''}` : `${n} wall segment${n > 1 ? 's' : ''}`;
    notify(`Built ${what} for $${spent}.${n < tiles.length ? ` ${tiles.length - n} skipped (blocked or out of range/funds).` : ''}`, n < tiles.length);
  } else {
    const t = tiles[0];
    notify(type === 'road' ? roadFailReason(t.x, t.y) : placeFailReason(type, t.x, t.y), true);
  }
}

function roadFailReason(x, y) {
  if (game.players[ME].credits < ROAD.cost) return 'Insufficient funds.';
  if (!game.inBuildRadius(ME, x, y, 1, 1)) return 'Too far from your base.';
  return 'Roads need dry land that is not built on.';
}

function placeFailReason(type, tx, ty) {
  const def = BUILDINGS[type];
  const p = game.players[ME];
  if (p.constructing && !def.segment) return 'Already constructing a structure.';
  if (p.credits < def.cost) return 'Insufficient funds.';
  if (!game.inBuildRadius(ME, tx, ty, def.w, def.h)) return 'Too far from your base.';
  if (def.coastal) return 'Naval Yard must be built on the shoreline.';
  return 'Cannot build there.';
}

// ---------------------------------------------------------------- sidebar

const sidebar = {
  build: $('build-list'), fort: $('fort-list'), units: $('unit-list'), sel: $('selection'),
  credits: $('credits'), clock: $('clock'), status: $('status'), research: $('research-list'),
};
let lastSidebarKey = '';

function refreshSidebar(force = false) {
  if (!game) return;
  const p = game.players[ME];
  sidebar.credits.textContent = `$${Math.floor(p.credits).toLocaleString()}`;
  // While stranded (broke, no trucks), count down to the free truck.
  const left = p.emergencyAt != null ? Math.max(0, Math.ceil(p.emergencyAt - game.time)) : 0;
  const fundsLabel = p.emergencyAt != null ? `Funds · truck ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Funds';
  if ($('funds-label').textContent !== fundsLabel) $('funds-label').textContent = fundsLabel;
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
    const req = !unlocked ? requirementText(def) : '';
    html += `<button class="${cls}" data-build="${type}" title="${def.name} — $${def.cost}${req ? '\n' + req : ''}">
      <img class="icon" src="${renderer.iconFor('building', type)}" alt=""><span class="name">${def.name}</span><span class="cost">$${def.cost}</span>
      ${isBuilding ? `<span class="prog" style="width:${Math.round(constructing.progress * 100)}%"></span>` : ''}
    </button>`;
  }
  if (html !== sidebar.build._html) { sidebar.build.innerHTML = html; sidebar.build._html = html; }

  // Fortifications: built in parallel with other construction.
  html = '';
  for (const type of FORTIFICATION_MENU) {
    const def = type === 'road' ? ROAD : BUILDINGS[type];
    const unlocked = def.requires.every((r) => game.hasBuilding(ME, r));
    const afford = p.credits >= def.cost;
    const unit = type === 'gate' ? '' : type === 'road' ? '/tile' : '/seg';
    const how = type === 'gate' ? 'Click to place in a wall line' : 'Click and drag to draw a line';
    const extra = { wall: 'Blocks ground units', gate: 'Your units pass, enemies are blocked', road: 'Ground units move ~1.6x faster' }[type];
    const cls = ['btn', !unlocked && 'locked', unlocked && !afford && 'poor', ui.placing === type && 'active'].filter(Boolean).join(' ');
    html += `<button class="${cls}" data-fort="${type}" title="${def.name} — $${def.cost}${unit}\n${extra}\n${how}">
      <img class="icon" src="${renderer.iconFor('building', type)}" alt=""><span class="name">${def.name}</span><span class="cost">$${def.cost}${unit}</span>
    </button>`;
  }
  if (html !== sidebar.fort._html) { sidebar.fort.innerHTML = html; sidebar.fort._html = html; }

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
      const avail = game.unitAvailable(ME, utype);
      const weapon = def.weapon ? WEAPONS[def.weapon] : null;
      const second = def.secondary ? `, plus ${WEAPONS[def.secondary].hits.join('/')} with its secondary` : '';
      const role = weapon ? `\nTargets: ${weapon.hits.join(', ')}${second}` : def.scout ? '\nUnarmed scout' : def.transport ? `\nDrops ${def.drop.count} paratrooper squads at the Airbase rally point`
        : def.capacity ? `\nCarries ${def.capacity} slots of ground troops (infantry 1, vehicles 2)` : '';
      const extra = def.stealth ? '\nStealthy: hidden unless enemies are close' : '';
      const how = avail ? 'Left-click: queue · Right-click: cancel' : `Research ${TECHS[def.tech].name} at a Research Lab to unlock`;
      const tip = `${def.name} — $${def.cost}\nHP ${def.hp} · Speed ${def.speed} · Sight ${def.sight}${role}${extra}\n${how}`;
      html += `<button class="btn${!avail ? ' locked' : afford ? '' : ' poor'}" data-unit="${utype}" data-producer="${btype}" title="${tip}">
        <img class="icon" src="${renderer.iconFor('unit', utype)}" alt=""><span class="name">${def.name}</span><span class="cost">$${def.cost}</span>
        ${queued ? `<span class="badge">${queued}</span>` : ''}
        ${prog > 0 ? `<span class="prog" style="width:${Math.round(prog * 100)}%"></span>` : ''}
      </button>`;
    }
  }
  if (!html) html = '<div class="hint">Build a Barracks to train troops.</div>';
  if (html !== sidebar.units._html) { sidebar.units.innerHTML = html; sidebar.units._html = html; }

  // Research: points from labs, spent on technologies.
  const res = p.research;
  const labs = [...game.entities.values()].filter((e) => e.owner === ME && e.def.research && e.progress >= 1);
  const running = labs.filter((b) => !b.researchPaused && !b.researchStalled).length;
  html = `<div class="research-head"><span>${Math.floor(res.points)} pts</span><span class="hint">${labs.length
    ? `+${running * RESEARCH.rate}/s · $${running * RESEARCH.cost}/s`
    : game.canBuildType(ME, 'lab') ? 'Build a Research Lab' : 'Research Lab requires a Vehicle Plant'}</span></div>`;
  for (const key of TECH_ORDER) {
    const t = TECHS[key];
    const done = res.done.has(key);
    const open = game.canResearch(ME, key);
    const ready = open && res.points >= t.points;
    const icon = t.unit ? renderer.iconFor('unit', t.unit) : t.building ? renderer.iconFor('building', t.building) : renderer.iconFor('unit', key === 'armor' ? 'tank' : 'drone');
    const reqs = (t.requires || []).filter((r) => !res.done.has(r)).map((r) => TECHS[r].name);
    const tip = `${t.name} — ${t.points} research points\n${t.desc}${reqs.length ? `\nRequires ${reqs.join(', ')}` : ''}${done ? '\nResearched' : ''}`;
    const cls = ['btn', done && 'done', !done && !open && 'locked', open && !ready && 'poor'].filter(Boolean).join(' ');
    const prog = open && !ready ? `<span class="prog" style="width:${Math.round((100 * res.points) / t.points)}%"></span>` : '';
    html += `<button class="${cls}" data-tech="${key}" title="${tip}">
      <img class="icon" src="${icon}" alt=""><span class="name">${t.name}</span><span class="cost">${done ? '✓ Done' : `${t.points} pts`}</span>${prog}
    </button>`;
  }
  if (html !== sidebar.research._html) { sidebar.research.innerHTML = html; sidebar.research._html = html; }

  // Selection panel.
  const sel = selectedEntities();
  const key = sel.map((e) => `${e.id}:${Math.ceil(e.hp / 10)}:${e.order?.type}:${e.harvestState}:${Math.round(e.cargo || 0)}:${e.repairing}:${e.repairStalled}:${e.rally ? e.rally.x.toFixed(1) + ',' + e.rally.y.toFixed(1) + ',' + e.rally.well : '-'}:${game.tick - (e.repairedAt ?? -1e9) < 10}:${e.researchPaused}:${e.researchStalled}:${Math.floor((e.charge || 0) * 100)}:${e.dropT > 0}:${e.passengers?.length}`).join('|');
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
      else if (e.def.scout) detail += `<div>Unarmed scout · sight ${e.def.sight}</div>`;
      if (e.def.harvester) detail += `<div>Cargo: ${Math.round(e.cargo)} / 150</div>`;
      if (e.def.transport && e.owner === ME) detail += `<div class="hint">${e.order.dropped ? 'Returning to base' : 'Right-click to change the drop zone'}</div>`;
      if (e.def.stealth) detail += '<div class="hint">Stealthy: hidden unless enemies are within a few tiles</div>';
      if (e.def.capacity) {
        const counts = {};
        for (const p of e.passengers || []) counts[p.def.name] = (counts[p.def.name] || 0) + 1;
        const list = Object.entries(counts).map(([n, c]) => `${c} × ${n}`).join(', ');
        detail += `<div>Cargo: ${game.load(e)} / ${e.def.capacity} slots${list ? ` (${list})` : ''}</div>`;
        if (e.owner === ME) {
          detail += e.passengers?.length
            ? `<div class="btn-row"><button class="small" data-unload="${e.id}">Unload here (U)</button></div><div class="hint">Or right-click land to unload there</div>`
            : '<div class="hint">Select ground units and right-click this craft to board (infantry 1 slot, vehicles 2)</div>';
        }
      }
      if (e.owner === ME && e.hp < e.maxHp) detail += `<div class="hint">${repairHint(e)}</div>`;
    } else {
      if (e.progress < 1) detail += `<div>Under construction: ${Math.round(e.progress * 100)}%</div>`;
      if (e.queue?.length) detail += `<div>Queue: ${e.queue.map((q) => UNITS[q.type].name).join(', ')}</div>`;
      if (e.def.repairs) detail += `<div class="hint">Repairs ${{ ground: 'vehicles', air: 'aircraft', naval: 'ships' }[e.def.repairs]} nearby</div>`;
      if (e.def.research && e.progress >= 1 && e.owner === ME) {
        const state = e.researchPaused ? '<span class="warn-text">Paused</span>'
          : e.researchStalled ? '<span class="warn-text">Stalled: insufficient funds</span>'
            : `<span class="ok-text">Researching: +${RESEARCH.rate} pt/s for $${RESEARCH.cost}/s</span>`;
        detail += `<div>${state}</div><div class="btn-row"><button class="small" data-lab="${e.id}">${e.researchPaused ? 'Resume research' : 'Pause research'}</button></div>`;
      }
      if (e.def.missile && e.progress >= 1) {
        detail += e.charge >= 1 ? '<div class="warn-text">Missile ready</div>' : `<div>Missile charging: ${Math.floor(e.charge * 100)}%</div>`;
        if (e.owner === ME) detail += `<div class="btn-row"><button class="small"${e.charge >= 1 ? '' : ' disabled'} data-launch="${e.id}">Launch missile (L)</button></div>`;
      }
      if (e.owner === ME && e.def.produces) {
        const status = !e.rally ? 'none' : e.rally.well != null ? 'oil well (new trucks harvest it)' : 'set';
        detail += `<div>Rally point: ${status}</div>`;
        detail += `<div class="btn-row"><button class="small" data-rallyset="1">Set rally point</button>${e.rally ? '<button class="small" data-rallyclear="1">Clear</button>' : ''}</div>`;
      }
      if (e.owner === ME && e.progress >= 1) {
        if (e.repairing) detail += `<div class="${e.repairStalled ? 'warn-text' : 'ok-text'}">${e.repairStalled ? 'Repair paused: insufficient funds' : 'Repairing…'}</div>`;
        let btns = '';
        if (e.repairing) btns += `<button class="small" data-repair="${e.id}">Stop repair (R)</button>`;
        else if (e.hp < e.maxHp) btns += `<button class="small" data-repair="${e.id}">Repair (R)</button>`;
        if (e.type !== 'hq') btns += `<button class="small" data-sell="${e.id}">Sell (Del)</button>`;
        if (btns) detail += `<div class="btn-row">${btns}</div>`;
      }
    }
    sidebar.sel.innerHTML = `<div class="sel-title" style="color:${owner.color}">${e.def.name}</div>
      <div class="hpbar"><span style="width:${(100 * e.hp) / e.maxHp}%"></span></div>
      <div class="sel-hp">${Math.ceil(e.hp)} / ${e.maxHp}</div>${detail}`;
  } else {
    const counts = {};
    for (const e of sel) counts[e.def.name] = (counts[e.def.name] || 0) + 1;
    const producers = selectedProducers();
    sidebar.sel.innerHTML = `<div class="sel-title">${sel.length} selected</div>` +
      Object.entries(counts).map(([n, c]) => `<div>${c} × ${n}</div>`).join('') +
      (producers.length && producers.length === sel.length
        ? `<div class="btn-row"><button class="small" data-rallyset="1">Set rally point (${producers.length})</button><button class="small" data-rallyclear="1">Clear</button></div>`
        : '<div class="hint">A: attack-move · S: stop · Ctrl+1-9: group</div>');
  }
}

// What a locked structure still needs: prerequisite buildings and research.
function requirementText(def) {
  const parts = [];
  const missing = def.requires.filter((r) => !game.hasBuilding(ME, r));
  if (missing.length || !def.tech) parts.push(`Requires ${def.requires.map((r) => BUILDINGS[r].name).join(', ')}`);
  if (def.tech && !game.hasTech(ME, def.tech)) parts.push(`Research ${TECHS[def.tech].name} at a Research Lab`);
  return parts.join(' · ');
}

function repairHint(u) {
  const kind = game.repairDomain(u);
  if (kind === 'infantry') return 'Heals near a Barracks or Command Center';
  const where = { ground: 'Service Depot', air: 'Airbase', naval: 'Naval Yard' }[kind];
  return `Repair at a ${where}: press R or right-click it`;
}

// Send selected damaged units to the nearest facility that can repair them.
function sendForRepair(units) {
  let sent = 0;
  for (const u of units) {
    if (u.hp >= u.maxHp) continue;
    const kind = game.repairDomain(u);
    let best = null, bestD = Infinity;
    for (const b of game.entities.values()) {
      if (b.owner !== ME || b.kind !== 'building' || b.progress < 1) continue;
      if (kind === 'infantry' ? !b.def.healsInfantry : b.def.repairs !== kind) continue;
      const d = Math.hypot(b.x - u.x, b.y - u.y);
      if (d < bestD) { bestD = d; best = b; }
    }
    if (!best) continue;
    if (kind === 'infantry') game.cmdMove(ME, [u.id], best.x, best.y + best.h / 2 + 1);
    else game.cmdService(ME, [u.id], best.id);
    sent++;
  }
  return sent;
}

function describeOrder(u) {
  if (u.dropT > 0) return 'Parachuting';
  if (u.order.type === 'paradrop') return u.order.dropped ? 'Returning' : 'Flying to drop zone';
  if (game.tick - (u.repairedAt ?? -1e9) < 10) return u.def.armor === 'infantry' ? 'Healing' : 'Being repaired';
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
  if (btn.dataset.fort) {
    const type = btn.dataset.fort;
    const def = type === 'road' ? ROAD : BUILDINGS[type];
    if (!def.requires.every((r) => game.hasBuilding(ME, r))) return notify('Requires a Command Center.', true);
    if (game.players[ME].credits < def.cost) return notify('Insufficient funds.', true);
    ui.placing = ui.placing === type ? null : type;
    ui.lineStart = ui.lineTiles = null;
    if (ui.placing) notify(type === 'gate' ? 'Click to place a gate in your wall. Right-click to finish.' : `Click and drag to lay a ${def.name.toLowerCase()}. Right-click to finish.`);
  } else if (btn.dataset.build) {
    const type = btn.dataset.build;
    const def = BUILDINGS[type];
    if (!game.canBuildType(ME, type)) return notify(`${requirementText(def)}.`, true);
    if (game.players[ME].constructing) return notify('Already constructing a structure.', true);
    if (game.players[ME].credits < def.cost) return notify('Insufficient funds.', true);
    ui.placing = ui.placing === type ? null : type;
    if (ui.placing) notify(`Place ${def.name}. Right-click to cancel.`);
  } else if (btn.dataset.unit) {
    const type = btn.dataset.unit, btype = btn.dataset.producer;
    if (!game.unitAvailable(ME, type)) return notify(`Research ${TECHS[UNITS[type].tech].name} at a Research Lab first.`, true);
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
  } else if (btn.dataset.tech) {
    const key = btn.dataset.tech, t = TECHS[key];
    const res = game.players[ME].research;
    if (res.done.has(key)) return notify(`${t.name} already researched.`);
    if (!game.canResearch(ME, key)) return notify(`Requires ${t.requires.map((r) => TECHS[r].name).join(', ')}.`, true);
    if (res.points < t.points) return notify(`Need ${t.points - Math.floor(res.points)} more research points.`, true);
    game.cmdResearch(ME, key);
  } else if (btn.dataset.unload) {
    if (!game.cmdUnload(ME, [Number(btn.dataset.unload)])) notify('No beach within reach to unload.', true);
  } else if (btn.dataset.lab) {
    game.cmdLabToggle(ME, Number(btn.dataset.lab));
  } else if (btn.dataset.launch) {
    startLaunchMode();
  } else if (btn.dataset.rallyset) {
    startRallyMode();
  } else if (btn.dataset.rallyclear) {
    for (const b of selectedProducers()) b.rally = null;
    notify('Rally point cleared.');
  } else if (btn.dataset.repair) {
    game.cmdRepair(ME, Number(btn.dataset.repair));
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
    if (ev.type === 'defeated' && ev.owner !== ME) {
      const f = game.players[ev.owner].faction;
      const left = game.players.filter((p) => p.id !== ME && !p.defeated).length;
      notify(`${f.name} has been eliminated.${left ? ` ${left} enem${left > 1 ? 'ies' : 'y'} remain${left > 1 ? '' : 's'}.` : ''}`);
      audio.blip(880);
    }
    // Enemy missile launches are detected wherever they happen.
    if (ev.type === 'launch' && ev.owner !== ME) {
      notify('Warning: enemy missile launch detected!', true);
      marker(ev.tx, ev.ty, '#ff3030');
      audio.blip(300);
    }
    if (ev.owner !== ME) continue;
    if (ev.type === 'built') { notify(`${BUILDINGS[ev.building].name} complete.`); audio.blip(740); }
    else if (ev.type === 'unitReady') audio.blip(1100);
    else if (ev.type === 'stranded') { notify(`Out of funds and trucks. Command is sending a Supply Truck in ${ev.delay}s.`, true); audio.blip(440); }
    else if (ev.type === 'emergencyTruck') { notify('Emergency Supply Truck has arrived.'); audio.blip(880); }
    else if (ev.type === 'researched') { notify(`Research complete: ${TECHS[ev.tech].name}.`); audio.blip(1200); }
    else if (ev.type === 'missileReady') { notify('Missile ready. Select the silo and press L to launch.', true); audio.blip(520); }
    else if (ev.type === 'paradrop') notify('Paratroopers away!');
    else if (ev.type === 'landed') { notify(`${ev.count} unit${ev.count > 1 ? 's' : ''} ashore.`); audio.blip(700); }
    else if (ev.type === 'boarded') audio.blip(950);
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
  const t = Math.floor(game.time);
  $('end-title').textContent = win ? 'VICTORY' : 'DEFEAT';
  $('end-title').className = win ? 'win' : 'lose';
  // One column per side: you, then each opponent in its faction colour.
  const ps = game.players;
  const head = ps.map((p) => `<th style="color:${p.faction.color}">${p.id === ME ? 'You' : p.faction.name}</th>`).join('');
  const row = (label, f) => `<tr><td>${label}</td>${ps.map((p) => `<td>${f(p.stats)}</td>`).join('')}</tr>`;
  $('end-stats').innerHTML = `
    <tr><th></th>${head}</tr>
    ${row('Enemies destroyed', (s) => s.killed)}
    ${row('Losses', (s) => s.lost)}
    ${row('Oil harvested', (s) => `$${s.harvested}`)}
    ${row('Spent on repairs', (s) => `$${Math.round(s.repairSpent)}`)}
    ${ps.some((p) => p.stats.cheated) ? row('Cheats used', (s) => (s.cheated ? 'Yes' : 'No')) : ''}
    <tr><td>Mission time</td><td colspan="${ps.length}">${Math.floor(t / 60)}m ${t % 60}s</td></tr>`;
  $('endscreen').classList.remove('hidden');
}

// ----------------------------------------------------------------- loop

let acc = 0, last = performance.now(), sidebarTimer = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (game && renderer) {
    updateCamera(dt);
    if (running && !paused) {
      acc += dt * speed;
      let steps = 0;
      while (acc >= DT && steps < 8) {
        for (const e of game.entities.values()) { e.px = e.x; e.py = e.y; }
        for (const a of ais) a.update();
        game.step();
        handleGameEvents();
        renderer.consumeEvents(audio);
        game.events.length = 0;
        acc -= DT;
        steps++;
        // The mission ends when one side is left, or when you are knocked out.
        if (game.winner !== null || game.players[ME].defeated) { showEnd(); break; }
      }
    }
    audio.setListener(cam.x, cam.y, cam.zoom * 1.4);
    for (const id of ui.selected) if (!game.get(id)) ui.selected.delete(id);
    renderer.render(cam, ui, paused ? 1 : Math.min(1, acc / DT), paused ? 0 : dt);
    renderer.renderMinimap(mctx, minimap.width);
    sidebarTimer -= dt;
    if (sidebarTimer <= 0) { refreshSidebar(); sidebarTimer = 0.15; }
    $('status').textContent = paused ? 'PAUSED' : speed !== 1 ? `${speed}x` : '';
  }
  requestAnimationFrame(frame);
}

$('start').addEventListener('click', startGame);
$('again').addEventListener('click', () => { $('endscreen').classList.add('hidden'); $('menu').classList.remove('hidden'); });
// ------------------------------------------------------------- cheats

let cheatCount = CHEATS.counts[1];
function renderCheats() {
  $('cheat-money').innerHTML = CHEATS.credits.map((c) => `<button class="small" data-cheat-money="${c}">+$${c.toLocaleString()}</button>`).join('');
  $('cheat-count').innerHTML = CHEATS.counts.map((n) => `<button class="small${n === cheatCount ? ' on' : ''}" data-cheat-count="${n}">×${n}</button>`).join('');
  $('cheat-units').innerHTML = CHEATS.units.map((t) => `<button class="small" data-cheat-unit="${t}">${UNITS[t].name}${cheatCount > 1 ? 's' : ''}</button>`).join('');
}
function toggleCheats(show) {
  const el = $('cheats');
  const open = show ?? el.classList.contains('hidden');
  el.classList.toggle('hidden', !open);
  if (open) renderCheats();
}
$('btn-cheats').addEventListener('click', () => { if (game) toggleCheats(); });
$('cheats').addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  const b = e.target.closest('button');
  if (!b || !game) return;
  if (b.dataset.cheatClose) toggleCheats(false);
  else if (b.dataset.cheatMoney) {
    const amt = Number(b.dataset.cheatMoney);
    if (game.cmdCheatCredits(ME, amt)) { notify(`Cheat: +$${amt.toLocaleString()}.`); audio.blip(1300); refreshSidebar(true); }
  } else if (b.dataset.cheatCount) {
    cheatCount = Number(b.dataset.cheatCount);
    renderCheats();
  } else if (b.dataset.cheatUnit) {
    const type = b.dataset.cheatUnit;
    const placed = game.cmdCheatUnits(ME, type, cheatCount);
    if (placed.length) {
      notify(`Cheat: ${placed.length} × ${UNITS[type].name} deployed.`);
      // Select the new arrivals so they're ready for orders.
      ui.selected.clear();
      for (const u of placed) ui.selected.add(u.id);
      refreshSidebar(true);
    } else notify('No room to deploy units.', true);
  }
});

$('btn-menu').addEventListener('click', () => {
  paused = true;
  $('menu').classList.remove('hidden');
  $('resume').classList.toggle('hidden', !running);
});
$('resume').addEventListener('click', () => { $('menu').classList.add('hidden'); paused = false; });

resize();
requestAnimationFrame(frame);

// Exposed for debugging from the console.
window.__rw = { get game() { return game; }, get renderer() { return renderer; }, get ais() { return ais; }, cam, ui };
