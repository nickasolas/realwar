import * as THREE from 'three';
import { cached, teamColors, gable, extrudeOutline, C } from './modelkit.js';

// Structure, scenery and oil-well models. Footprints are centred on the
// origin (a 3x3 structure spans -1.5..1.5) and face +Z ("south", toward the
// camera) with their main doors.

const PI = Math.PI;

// ------------------------------------------------------------ helpers

// Concrete foundation that extends below ground so it sits cleanly on slopes.
function slab(p, w, d, color = C.concrete) {
  p.box(w + 0.1, 1.2, d + 0.1, C.concreteDark, { y: -0.52, surf: 'concrete' });
  p.box(w, 0.05, d, color, { y: 0.1, surf: 'concrete' });
}

// Gravel pad for field camps.
function gravel(p, w, d) {
  p.box(w + 0.1, 1.2, d + 0.1, '#6f6352', { y: -0.52, surf: 'concrete' });
  p.box(w, 0.04, d, '#8a7c62', { y: 0.1, surf: 'concrete' });
}

// A row of sandbags from (x0, z0) to (x1, z1), `rows` high, staggered.
function sandbags(p, x0, z0, x1, z1, rows = 2) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 0.1));
  const ang = Math.atan2(z1 - z0, x1 - x0);
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < n - (r % 2); i++) {
      const t = (i + 0.5 + (r % 2) * 0.5) / n;
      p.cbox(0.1, 0.045, 0.06, C.sandbag, { x: x0 + (x1 - x0) * t, y: 0.145 + r * 0.042, z: z0 + (z1 - z0) * t, ry: -ang, surf: 'canvas' }, 0.012);
    }
  }
}

function flag(p, x, z, h = 0.9) {
  p.cyl(0.012, 0.015, h, C.white, { x, y: 0.12 + h / 2, z }, 6);
  p.box(0.26, 0.16, 0.006, 'team', { x: x + 0.14, y: 0.12 + h - 0.1, z, surf: 'canvas' });
}

// Ridge tent along X.
function tent(p, x, z, len, w, h) {
  p.box(len, h * 0.42, w, C.canvas, { x, y: 0.12 + h * 0.21, z, surf: 'canvas' });
  p.add(gable(w * 1.08, h * 0.58, len * 1.02), C.canvas, { x, y: 0.12 + h * 0.42, z, surf: 'canvas' });
  p.box(0.004, h * 0.4, w * 0.3, '#3d3a2c', { x: x + len / 2 + 0.002, y: 0.12 + h * 0.2, z });
  for (const s of [-1, 1]) p.rod([x + s * len * 0.4, 0.12 + h, z], [x + s * len * 0.4, 0.12, z + w * 0.9], 0.003, '#5a5240');
}

function crate(p, x, z, s = 0.1, y = 0.12) {
  p.cbox(s, s * 0.8, s * 0.8, C.wood, { x, y: y + s * 0.4, z, ry: (x * 7 + z * 3) % 1 }, 0.008);
}

function drums(p, x, z) {
  for (const [dx, dz] of [[0, 0], [0.07, 0.02], [0.03, 0.07]]) p.cyl(0.03, 0.03, 0.09, '#3f6b8a', { x: x + dx, y: 0.165, z: z + dz }, 10);
}

function windows(p, x0, x1, y, z, n, h = 0.06) {
  for (let i = 0; i < n; i++) {
    const x = x0 + ((i + 0.5) * (x1 - x0)) / n;
    p.box(((x1 - x0) / n) * 0.6, h, 0.006, C.glass, { x, y, z, surf: 'glass' });
  }
}

// ------------------------------------------------------------ structures

function hq(p) {
  slab(p, 3, 3);
  // Two-storey command block with window bands and a parapet.
  p.cbox(1.6, 0.5, 1.1, C.concrete, { x: -0.25, y: 0.37, z: -0.25, surf: 'concrete' }, 0.015);
  windows(p, -1.0, 0.5, 0.42, 0.302, 8);
  p.box(1.62, 0.04, 0.03, 'team', { x: -0.25, y: 0.6, z: 0.31 });
  p.cbox(0.9, 0.34, 0.7, C.concrete, { x: -0.5, y: 0.79, z: -0.4, surf: 'concrete' }, 0.015);
  windows(p, -0.9, -0.1, 0.84, -0.048, 5);
  for (const [x, z] of [[0.2, 0.0], [0.38, -0.1], [-0.1, -0.12]]) p.cbox(0.12, 0.07, 0.1, C.tin, { x, y: 0.66, z, surf: 'metal' }, 0.008);
  // Comms tower: lattice legs, braces and a beacon.
  const tx = 1.05, tz = -1.05, top = 1.75;
  for (const [dx, dz] of [[-0.15, -0.15], [0.15, -0.15], [0.15, 0.15], [-0.15, 0.15]]) p.rod([tx + dx, 0.12, tz + dz], [tx + dx * 0.2, top, tz + dz * 0.2], 0.01, '#8a8d86');
  for (let i = 1; i < 6; i++) {
    const y = 0.12 + (i * (top - 0.12)) / 6, k = 1 - (i / 6) * 0.8;
    p.rod([tx - 0.15 * k, y, tz - 0.15 * k], [tx + 0.15 * k, y, tz + 0.15 * k], 0.006, '#8a8d86');
    p.rod([tx + 0.15 * k, y, tz - 0.15 * k], [tx - 0.15 * k, y, tz + 0.15 * k], 0.006, '#8a8d86');
  }
  p.rod([tx, top, tz], [tx, top + 0.3, tz], 0.008, '#8a8d86');
  p.light(0.03, '#ff3030', { x: tx, y: top + 0.32, z: tz });
  // Helipad.
  p.cyl(0.42, 0.42, 0.03, C.concreteDark, { x: 0.85, y: 0.135, z: 0.85, surf: 'concrete' }, 28);
  p.cyl(0.36, 0.36, 0.031, '#d6d2c0', { x: 0.85, y: 0.136, z: 0.85 }, 28);
  p.cyl(0.33, 0.33, 0.032, C.concreteDark, { x: 0.85, y: 0.137, z: 0.85, surf: 'concrete' }, 28);
  for (const dx of [-0.1, 0.1]) p.box(0.04, 0.005, 0.26, '#e8e6dc', { x: 0.85 + dx, y: 0.155, z: 0.85 });
  p.box(0.2, 0.005, 0.04, '#e8e6dc', { x: 0.85, y: 0.155, z: 0.85 });
  // Sandbag perimeter with an entrance, camouflaged vehicle bay, generator.
  sandbags(p, -1.42, 1.42, -0.2, 1.42);
  sandbags(p, 0.25, 1.42, 0.35, 1.42);
  sandbags(p, -1.42, -1.42, -1.42, 1.42);
  p.cone(0.62, 0.4, 'body', { x: -1.0, y: 0.32, z: 0.85, ry: PI / 4, surf: 'canvas' }, 4);
  for (const [x, z] of [[-1.38, 0.43], [-0.62, 0.43], [-1.38, 1.27], [-0.62, 1.27]]) p.rod([x, 0.12, z], [x, 0.36, z], 0.01, C.wood);
  p.cbox(0.22, 0.14, 0.14, C.steel, { x: 0.55, y: 0.19, z: -1.2 }, 0.01);
  drums(p, 0.85, -1.25);
  flag(p, -1.25, -1.2, 1.0);
}

function hqDish(p) {
  p.cyl(0.26, 0.08, 0.06, C.white, { rz: 1.0 }, 20);
  p.rod([0, 0, 0], [0.16, 0.12, 0], 0.008, C.gunmetal);
  p.cyl(0.04, 0.06, 0.1, C.gunmetal, { y: -0.08 }, 10);
}

function refinery(p) {
  slab(p, 2, 2);
  for (const [x, z, r, h] of [[-0.45, -0.4, 0.36, 0.72], [0.45, -0.45, 0.3, 0.6], [-0.45, 0.45, 0.28, 0.55]]) {
    p.cyl(r, r, h, C.tin, { x, y: 0.12 + h / 2, z, surf: 'metal' }, 24);
    p.cone(r * 1.02, 0.08, '#7d7f78', { x, y: 0.16 + h, z, surf: 'metal' }, 24);
    for (let i = 1; i < 3; i++) p.cyl(r + 0.004, r + 0.004, 0.02, '#77796f', { x, y: 0.12 + (h * i) / 3, z }, 24);
    p.cyl(r + 0.006, r + 0.006, 0.04, 'team', { x, y: 0.12 + h * 0.85, z }, 24);
    // Ladder up the side.
    for (const dz of [-0.03, 0.03]) p.rod([x + r + 0.02, 0.12, z + dz], [x + r + 0.02, 0.12 + h, z + dz], 0.004, C.gunmetal);
    for (let k = 1; k < 6; k++) p.rod([x + r + 0.02, 0.12 + (h * k) / 6, z - 0.03], [x + r + 0.02, 0.12 + (h * k) / 6, z + 0.03], 0.003, C.gunmetal);
  }
  // Pump house, pipework and fuel bladders.
  p.cbox(0.5, 0.3, 0.38, C.concrete, { x: 0.45, y: 0.27, z: 0.45, surf: 'concrete' }, 0.012);
  p.box(0.52, 0.03, 0.4, C.tin, { x: 0.45, y: 0.435, z: 0.45, surf: 'metal' });
  p.box(0.1, 0.18, 0.006, '#3d3a32', { x: 0.45, y: 0.21, z: 0.643 });
  windows(p, 0.25, 0.65, 0.32, 0.643, 2, 0.05);
  p.rod([-0.45, 0.25, -0.4], [0.45, 0.25, -0.45], 0.03, '#77796f');
  p.rod([-0.45, 0.2, 0.45], [-0.45, 0.2, -0.4], 0.03, '#77796f');
  p.rod([0.45, 0.2, 0.2], [0.45, 0.2, -0.45], 0.025, '#77796f');
  p.cbox(0.34, 0.06, 0.22, C.rubber, { x: 0.0, y: 0.15, z: 0.82, surf: 'rubber' }, 0.025);
}

function barracks(p) {
  gravel(p, 2, 2);
  tent(p, -0.15, -0.5, 1.4, 0.5, 0.42);
  tent(p, -0.15, 0.2, 1.4, 0.5, 0.42);
  tent(p, 0.7, 0.75, 0.42, 0.34, 0.3);
  sandbags(p, -0.95, 0.95, 0.35, 0.95);
  sandbags(p, -0.95, -0.95, -0.95, 0.95);
  crate(p, 0.75, -0.2); crate(p, 0.82, -0.08, 0.08); crate(p, 0.75, -0.2, 0.08, 0.2);
  drums(p, 0.75, 0.3);
  flag(p, 0.85, -0.85);
}

function factory(p) {
  slab(p, 3, 3);
  // Main shed: concrete plinth walls, corrugated steel above.
  const sx = 0, sz = -0.35, L = 2.5, Wd = 1.7;
  p.cbox(L, 0.24, Wd, C.concrete, { x: sx, y: 0.24, z: sz, surf: 'concrete' }, 0.01);
  p.box(L - 0.02, 0.36, Wd - 0.02, C.tin, { x: sx, y: 0.54, z: sz, surf: 'metal' });
  // Sawtooth roof with glazing on the north-light faces.
  for (let i = 0; i < 5; i++) {
    const x0 = -L / 2 + i * (L / 5);
    p.add(extrudeOutline([[0, 0], [L / 5, 0], [L / 5, 0.26]], Wd), '#7c7e77', { x: x0, y: 0.72, z: sz, surf: 'metal' });
    p.box(0.012, 0.22, Wd - 0.06, C.glass, { x: x0 + L / 5 - 0.01, y: 0.84, z: sz, surf: 'glass' });
  }
  p.box(L + 0.02, 0.03, 0.03, 'team', { x: sx, y: 0.7, z: sz + Wd / 2 + 0.01 });
  // Roller doors with hazard-striped frames.
  for (const x of [-0.6, 0.45]) {
    p.box(0.66, 0.46, 0.012, '#5d5f58', { x, y: 0.35, z: sz + Wd / 2 + 0.006, surf: 'metal' });
    for (const s of [-1, 1]) for (let k = 0; k < 5; k++) p.box(0.03, 0.09, 0.016, k % 2 ? '#222' : C.yellow, { x: x + s * 0.345, y: 0.16 + k * 0.09, z: sz + Wd / 2 + 0.008 });
  }
  // Chimneys.
  p.cyl(0.1, 0.13, 1.15, '#7a5a48', { x: 1.15, y: 0.7, z: -1.05, surf: 'concrete' }, 14);
  p.cyl(0.105, 0.105, 0.06, 'team', { x: 1.15, y: 1.22, z: -1.05 }, 14);
  p.cyl(0.075, 0.095, 0.85, '#7a5a48', { x: 0.85, y: 0.55, z: -1.15, surf: 'concrete' }, 14);
  // Yard: gantry crane, steel plate stacks, crates.
  for (const s of [-1, 1]) {
    p.box(0.06, 0.5, 0.06, C.yellow, { x: s * 1.3, y: 0.37, z: 1.15 });
  }
  p.box(2.66, 0.06, 0.08, C.yellow, { y: 0.63, z: 1.15 });
  p.box(0.12, 0.06, 0.14, C.gunmetal, { x: 0.3, y: 0.57, z: 1.15 });
  p.rod([0.3, 0.55, 1.15], [0.3, 0.32, 1.15], 0.004, '#222');
  for (let k = 0; k < 4; k++) p.box(0.4, 0.018, 0.22, C.rust, { x: -0.8, y: 0.135 + k * 0.02, z: 1.05, surf: 'metal' });
  crate(p, 0.9, 0.95, 0.12); crate(p, 1.05, 1.0, 0.1);
}

function depot(p) {
  slab(p, 2, 2);
  // Open-fronted service bay with a corrugated roof on steel columns.
  p.cbox(1.3, 0.55, 0.08, C.concrete, { x: -0.15, y: 0.4, z: -0.72, surf: 'concrete' }, 0.01);
  for (const x of [-0.78, 0.48]) p.box(0.06, 0.55, 0.9, C.tin, { x, y: 0.4, z: -0.3, surf: 'metal' });
  for (const x of [-0.78, 0.48]) p.box(0.06, 0.55, 0.06, C.gunmetal, { x, y: 0.4, z: 0.15 });
  p.box(1.4, 0.04, 1.0, '#7c7e77', { x: -0.15, y: 0.69, z: -0.28, rx: 0.08, surf: 'metal' });
  p.box(1.42, 0.05, 0.04, 'team', { x: -0.15, y: 0.66, z: 0.21 });
  // Vehicle lift with hazard stripes, tool bench, tyres, drums.
  p.box(0.9, 0.04, 0.5, '#3c3e38', { x: -0.15, y: 0.14, z: -0.3 });
  for (let i = 0; i < 6; i++) p.box(0.07, 0.005, 0.06, i % 2 ? '#222' : C.yellow, { x: -0.5 + i * 0.14, y: 0.165, z: 0.02 });
  for (const x of [-0.5, 0.2]) p.box(0.05, 0.22, 0.05, C.yellow, { x, y: 0.25, z: -0.3 });
  p.cbox(0.4, 0.12, 0.1, C.wood, { x: -0.3, y: 0.18, z: -0.62 }, 0.008);
  for (let i = 0; i < 4; i++) p.cyl(0.09, 0.09, 0.045, C.rubber, { x: -0.75, y: 0.145 + i * 0.045, z: 0.72, surf: 'rubber' }, 14);
  drums(p, 0.62, 0.55);
  // Wrench sign.
  p.box(0.05, 0.22, 0.02, 'team', { x: -0.15, y: 0.86, z: 0.2, rz: 0.6 });
  p.cyl(0.06, 0.06, 0.02, 'team', { x: -0.09, y: 0.95, z: 0.2, rx: PI / 2 }, 12);
}

function depotCrane(p) {
  p.cyl(0.05, 0.06, 0.6, C.yellow, { y: 0.3 }, 10);
  p.box(0.7, 0.05, 0.05, C.yellow, { x: -0.3, y: 0.6 });
  p.rod([-0.6, 0.6, 0], [-0.6, 0.32, 0], 0.005, '#222');
  p.box(0.06, 0.04, 0.06, '#333', { x: -0.6, y: 0.3 });
}

function airfield(p) {
  slab(p, 6, 2, '#8f8c80');
  const L = 5.8;
  p.box(L, 0.02, 0.86, '#3d3e3a', { y: 0.13, z: 0.46, surf: 'concrete' });
  for (let i = 0; i < 12; i++) p.box(0.24, 0.005, 0.035, '#e8e8e2', { x: -L / 2 + 0.55 + i * ((L - 1.1) / 11), y: 0.142, z: 0.46 });
  for (const end of [-1, 1]) {
    for (let k = 0; k < 6; k++) p.box(0.2, 0.005, 0.05, '#e8e8e2', { x: end * (L / 2 - 0.16), y: 0.142, z: 0.16 + k * 0.12 });
    p.box(0.04, 0.005, 0.8, '#e8e8e2', { x: end * (L / 2 - 0.34), y: 0.142, z: 0.46 });
  }
  for (let i = 0; i <= 14; i++) {
    const x = -L / 2 + (i * L) / 14;
    p.light(0.02, '#7fd0ff', { x, y: 0.16, z: 0.05 });
    p.light(0.02, '#7fd0ff', { x, y: 0.16, z: 0.87 });
  }
  for (const end of [-1, 1]) for (let k = 0; k < 4; k++) p.light(0.022, end < 0 ? '#5dff7a' : '#ff5a4f', { x: end * (L / 2 + 0.02), y: 0.16, z: 0.2 + k * 0.17 });
  p.box(3.9, 0.015, 0.22, '#55574f', { x: -0.6, y: 0.13, z: -0.12, surf: 'concrete' });
  for (let i = 0; i < 9; i++) p.box(0.16, 0.004, 0.02, C.yellow, { x: -2.4 + i * 0.45, y: 0.14, z: -0.12 });
  // Arched corrugated hangars facing the runway.
  for (const x of [-2.25, -1.25]) {
    p.add(new THREE.CylinderGeometry(0.4, 0.4, 0.66, 20, 1, false, 0, PI), C.tin, { x, y: 0.12, z: -0.6, rz: PI / 2, ry: PI / 2, surf: 'metal' });
    p.box(0.62, 0.32, 0.02, '#4a4c46', { x, y: 0.28, z: -0.26, surf: 'metal' });
    p.box(0.66, 0.03, 0.03, 'team', { x, y: 0.45, z: -0.26 });
  }
  // Control tower and operations block.
  p.cbox(0.5, 0.3, 0.4, C.concrete, { x: 0.25, y: 0.27, z: -0.66, surf: 'concrete' }, 0.01);
  windows(p, 0.05, 0.45, 0.3, -0.457, 3);
  p.cyl(0.1, 0.13, 0.75, C.concrete, { x: 0.55, y: 0.5, z: -0.7, surf: 'concrete' }, 12);
  p.cyl(0.22, 0.18, 0.18, C.glass, { x: 0.55, y: 0.95, z: -0.7, surf: 'glass' }, 12);
  p.cyl(0.24, 0.24, 0.04, 'team', { x: 0.55, y: 1.06, z: -0.7 }, 12);
  p.light(0.03, '#ff3030', { x: 0.55, y: 1.13, z: -0.7 });
  for (const [x, z] of [[1.45, -0.72], [1.85, -0.72]]) {
    p.cyl(0.16, 0.16, 0.3, C.tin, { x, y: 0.27, z, surf: 'metal' }, 18);
    p.cyl(0.165, 0.165, 0.04, 'team', { x, y: 0.33, z }, 18);
  }
  p.cyl(0.03, 0.04, 0.6, '#77756c', { x: 2.55, y: 0.42, z: -0.7 }, 6);
  p.cyl(0.012, 0.012, 0.4, C.white, { x: 2.75, y: 0.32, z: -0.05 }, 4);
  p.cone(0.04, 0.18, '#ff7a1a', { x: 2.84, y: 0.49, z: -0.05, rz: PI / 2, surf: 'canvas' }, 8);
}

function airfieldDish(p) {
  p.cyl(0.18, 0.08, 0.05, C.white, { rz: 1.1 }, 16);
  p.box(0.04, 0.06, 0.04, '#555', { y: -0.04 });
}

function shipyard(p) {
  slab(p, 3, 3);
  // Dry dock basin with walls.
  p.box(2.0, 0.04, 1.0, '#2b5a72', { x: 0.2, y: 0.125, z: 0.4 });
  p.cbox(2.1, 0.12, 0.08, C.concreteDark, { x: 0.2, y: 0.17, z: -0.12, surf: 'concrete' }, 0.01);
  p.cbox(2.1, 0.12, 0.08, C.concreteDark, { x: 0.2, y: 0.17, z: 0.92, surf: 'concrete' }, 0.01);
  for (let i = 0; i < 6; i++) p.cyl(0.025, 0.03, 0.06, '#222', { x: -0.7 + i * 0.36, y: 0.26, z: 0.92 }, 8);
  // Corrugated warehouse.
  p.cbox(1.0, 0.5, 0.7, C.tin, { x: -0.9, y: 0.37, z: -0.85, surf: 'metal' }, 0.01);
  p.add(gable(0.74, 0.18, 1.04), '#7c7e77', { x: -0.9, y: 0.62, z: -0.85, surf: 'metal' });
  p.box(0.36, 0.34, 0.012, '#4a4c46', { x: -0.9, y: 0.29, z: -0.494, surf: 'metal' });
  p.box(1.02, 0.03, 0.03, 'team', { x: -0.9, y: 0.6, z: -0.49 });
  // Gantry crane straddling the dock.
  for (const z of [-0.2, 1.0]) for (const x of [0.8, 1.0]) p.box(0.06, 1.2, 0.06, C.yellow, { x, y: 0.72, z });
  p.box(0.3, 0.1, 1.3, C.yellow, { x: 0.9, y: 1.3, z: 0.4 });
  p.box(1.4, 0.08, 0.08, C.yellow, { x: 0.4, y: 1.32, z: 0.4 });
  p.box(0.14, 0.1, 0.12, C.gunmetal, { x: 0.0, y: 1.26, z: 0.4 });
  p.rod([0.0, 1.22, 0.4], [0.0, 0.7, 0.4], 0.005, '#222');
  // Shipping containers.
  const box = (x, z, y, c) => p.cbox(0.4, 0.17, 0.17, c, { x, y, z, surf: 'metal' }, 0.006);
  box(0.6, -1.15, 0.205, '#8a3b2a'); box(1.05, -1.15, 0.205, '#2f5d7c'); box(0.82, -1.15, 0.375, '#4e6b3a');
  box(0.6, -0.93, 0.205, '#b07a2a');
}

function turret(p) {
  slab(p, 1, 1, C.concreteDark);
  p.cyl(0.38, 0.45, 0.26, C.concrete, { y: 0.25, surf: 'concrete' }, 8);
  p.cyl(0.39, 0.39, 0.03, C.concreteDark, { y: 0.39, surf: 'concrete' }, 8);
  p.box(0.2, 0.05, 0.02, '#1c1c1c', { y: 0.27, z: 0.43 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * PI * 2;
    p.cbox(0.13, 0.05, 0.07, C.sandbag, { x: Math.cos(a) * 0.47, y: 0.145, z: Math.sin(a) * 0.47, ry: -a + PI / 2, surf: 'canvas' }, 0.012);
  }
}

function turretGun(p) {
  p.sphere(0.2, 'body', { sy: 0.62 }, 16, 10);
  p.cbox(0.12, 0.08, 0.12, 'body', { x: 0.14, y: 0.04 }, 0.01);
  p.cyl(0.025, 0.03, 0.46, C.gunmetal, { x: 0.38, y: 0.04, rz: PI / 2 }, 10);
  p.cyl(0.032, 0.032, 0.05, C.gunmetal, { x: 0.6, y: 0.04, rz: PI / 2 }, 10);
  p.box(0.06, 0.05, 0.005, 'team', { x: -0.04, y: 0.06, z: 0.19 });
}

function samsite(p) {
  slab(p, 1, 1, C.concreteDark);
  p.cyl(0.36, 0.42, 0.14, C.concrete, { y: 0.19, surf: 'concrete' }, 10);
  p.cbox(0.16, 0.12, 0.12, C.steel, { x: -0.3, y: 0.32, z: 0.3 }, 0.01);
  p.cyl(0.08, 0.04, 0.03, C.white, { x: -0.3, y: 0.4, z: 0.3, rx: -0.8 }, 12);
}

function samLauncher(p) {
  p.cyl(0.1, 0.12, 0.08, C.gunmetal, { y: 0.04 }, 12);
  p.cbox(0.1, 0.1, 0.14, 'body', { y: 0.12 }, 0.01);
  // Rail with four ready missiles, elevated.
  const el = 0.55;
  p.cbox(0.48, 0.03, 0.34, 'body', { x: 0.04, y: 0.2, rz: el }, 0.008);
  for (const z of [-0.12, -0.04, 0.04, 0.12]) {
    const cx = 0.04, cy = 0.24;
    p.cyl(0.022, 0.022, 0.44, C.white, { x: cx, y: cy, z, rz: el - PI / 2 }, 10);
    p.cone(0.022, 0.06, C.red, { x: cx + 0.25 * Math.cos(el), y: cy + 0.25 * Math.sin(el), z, rz: el - PI / 2 }, 10);
  }
  p.box(0.08, 0.05, 0.005, 'team', { x: -0.06, y: 0.12, z: 0.073 });
}

// Research Lab (3x2): white laboratory block with ribbon windows, an
// observatory dome, a rooftop plant room and a rotating dish.
function lab(p) {
  slab(p, 3, 2);
  p.cbox(1.9, 0.5, 1.3, '#e3e2dc', { x: -0.45, y: 0.37, surf: 'concrete' }, 0.02);
  for (const y of [0.3, 0.5]) {
    p.box(1.86, 0.08, 0.005, C.glass, { x: -0.45, y, z: 0.653, surf: 'glass' });
    p.box(0.005, 0.08, 1.26, C.glass, { x: -1.403, y, surf: 'glass' });
  }
  p.box(1.9, 0.03, 0.05, 'team', { x: -0.45, y: 0.6, z: 0.63 });
  p.box(0.3, 0.26, 0.02, '#2c3236', { x: 0.1, y: 0.25, z: 0.655 }); // entrance
  p.box(0.42, 0.03, 0.18, '#cfcdc4', { x: 0.1, y: 0.4, z: 0.72 }); // canopy
  p.cbox(0.6, 0.16, 0.5, '#b9b8b0', { x: -0.8, y: 0.7, z: -0.2 }, 0.01); // plant room
  for (let i = 0; i < 3; i++) p.cyl(0.07, 0.07, 0.06, C.steel, { x: -1.0 + i * 0.2, y: 0.8, z: 0.2 }, 12);
  // Observatory wing with dome.
  p.cyl(0.5, 0.52, 0.42, '#d9d8d1', { x: 1.0, y: 0.33, z: 0.0, surf: 'concrete' }, 20);
  p.sphere(0.5, '#eeeeea', { x: 1.0, y: 0.54, sy: 0.75 }, 20, 10);
  p.box(0.12, 0.3, 0.02, '#2c3236', { x: 1.0, y: 0.78, z: 0.25, rx: -0.5 }); // dome slit
  // Antenna mast.
  p.rod([-0.2, 0.6, -0.45], [-0.2, 1.3, -0.45], 0.01, C.gunmetal);
  for (const y of [0.9, 1.1]) p.rod([-0.3, y, -0.45], [-0.1, y, -0.45], 0.006, C.gunmetal);
  p.light(0.016, '#ff3030', { x: -0.2, y: 1.31, z: -0.45 });
  crate(p, 1.25, 0.8, 0.08);
}

function labDish(p) {
  p.cyl(0.02, 0.03, 0.14, C.gunmetal, { y: 0.07 }, 8);
  p.sphere(0.18, C.white, { y: 0.2, x: 0.04, sx: 0.35, rz: -0.6 }, 14, 8);
  p.rod([0.06, 0.2, 0], [0.18, 0.28, 0], 0.005, C.gunmetal);
}

// ICBM Silo (2x2): hardened pad with a round launch tube, two blast doors
// (animated), a control bunker and hazard stripes.
function silo(p) {
  slab(p, 2, 2, C.concreteDark);
  p.cyl(0.62, 0.7, 0.18, C.concrete, { y: 0.2, surf: 'concrete' }, 24);
  p.cyl(0.42, 0.42, 0.02, '#151515', { y: 0.3 }, 24); // tube mouth
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * PI * 2;
    p.box(0.1, 0.012, 0.05, i % 2 ? '#151515' : C.yellow, { x: Math.cos(a) * 0.55, y: 0.296, z: Math.sin(a) * 0.55, ry: -a });
  }
  p.cbox(0.5, 0.2, 0.28, C.concrete, { x: -0.6, y: 0.2, z: 0.72, surf: 'concrete' }, 0.02); // bunker
  p.box(0.12, 0.1, 0.01, '#2c3236', { x: -0.6, y: 0.18, z: 0.865 });
  p.box(0.3, 0.02, 0.16, 'team', { x: -0.6, y: 0.31, z: 0.72 });
  p.rod([0.75, 0.12, -0.75], [0.75, 0.75, -0.75], 0.01, C.gunmetal);
  p.light(0.016, '#ff3030', { x: 0.75, y: 0.76, z: -0.75 });
}

// One sliding blast door leaf, from its outer edge (x = 0) inward.
function siloDoor(p) {
  p.box(0.44, 0.06, 0.86, '#6d6b62', { x: 0.22, surf: 'concrete' });
  p.box(0.06, 0.07, 0.86, C.yellow, { x: 0.41 });
}

// The missile, nose up; raised into view once it's ready.
function siloMissile(p) {
  p.cyl(0.13, 0.13, 1.1, C.white, { y: -0.2 }, 16);
  p.cone(0.13, 0.36, C.white, { y: 0.53 }, 16);
  p.cyl(0.135, 0.135, 0.05, 'team', { y: 0.2 }, 16);
  p.cyl(0.135, 0.135, 0.03, '#151515', { y: -0.1 }, 16);
}

// Concrete T-wall: a centre post plus an arm toward each connected
// neighbour (E, SE, S, SW, W, NW, N, NE). The renderer toggles arms.
const WALL_DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

function wallPost(p) {
  p.box(0.62, 1.2, 0.62, C.concreteDark, { y: -0.52, surf: 'concrete' });
  p.cbox(0.26, 0.5, 0.26, C.concrete, { y: 0.35, surf: 'concrete' }, 0.015);
  p.cbox(0.3, 0.04, 0.3, C.concreteDark, { y: 0.61, surf: 'concrete' }, 0.008);
  p.box(0.27, 0.03, 0.27, 'team', { y: 0.5 });
}

function wallArm(p, len) {
  // Slab from the post centre to the tile edge (or corner), with a coil of
  // razor wire along the top.
  p.cbox(len, 0.42, 0.14, C.concrete, { x: len / 2, y: 0.31, surf: 'concrete' }, 0.012);
  p.box(len, 0.06, 0.24, C.concreteDark, { x: len / 2, y: 0.13, surf: 'concrete' });
  for (let i = 0; i < Math.round(len / 0.07); i++) {
    p.rod([0.035 + i * 0.07, 0.53, -0.03], [0.07 + i * 0.07, 0.56, 0.03], 0.004, '#8a8d86');
  }
}

function gatePosts(p) {
  p.box(1.0, 0.04, 0.62, C.concreteDark, { y: 0.11, surf: 'concrete' });
  for (const s of [-1, 1]) {
    p.box(0.3, 1.2, 0.62, C.concreteDark, { x: s * 0.42, y: -0.52, surf: 'concrete' });
    p.cbox(0.18, 0.62, 0.3, C.concrete, { x: s * 0.42, y: 0.41, surf: 'concrete' }, 0.015);
    p.box(0.19, 0.04, 0.31, 'team', { x: s * 0.42, y: 0.66 });
    p.light(0.025, '#ffb43a', { x: s * 0.42, y: 0.75 });
  }
  for (let k = 0; k < 6; k++) p.box(0.1, 0.005, 0.12, k % 2 ? '#222' : C.yellow, { x: -0.28 + k * 0.11, y: 0.135 });
}

function gateLeaf(p) {
  // Steel bar gate that sinks into the ground to open.
  p.box(0.66, 0.04, 0.05, C.steel, { y: 0.48, surf: 'metal' });
  p.box(0.66, 0.04, 0.05, C.steel, { y: 0.16, surf: 'metal' });
  for (let i = 0; i < 9; i++) p.box(0.022, 0.36, 0.022, C.steel, { x: -0.3 + i * 0.075, y: 0.32 });
  p.rod([-0.3, 0.16, 0], [0.3, 0.48, 0], 0.012, C.steel);
}

function roadIcon(p) {
  p.box(1.2, 0.05, 1.2, '#7a6a52', { y: 0.0 });
  p.box(0.6, 0.06, 1.2, '#3b3c39', { y: 0.01, surf: 'concrete' });
  for (const z of [-0.4, 0, 0.4]) p.box(0.04, 0.065, 0.2, '#e8e2c8', { y: 0.012, z });
}

const STRUCTURES = {
  wall: { body: wallPost },
  gate: { body: gatePosts },
  road: { body: roadIcon },
  hq: { body: hq, dish: [hqDish, 0.25, 0.72, -0.5] },
  refinery: { body: refinery },
  barracks: { body: barracks },
  factory: { body: factory, smoke: [[1.15, 1.3, -1.05], [0.85, 1.0, -1.15]] },
  depot: { body: depot, crane: [depotCrane, 0.72, 0.12, -0.6] },
  airfield: { body: airfield, dish: [airfieldDish, 2.55, 0.78, -0.7] },
  shipyard: { body: shipyard },
  turret: { body: turret, turret: [turretGun, 0, 0.44, 0] },
  samsite: { body: samsite, turret: [samLauncher, 0.05, 0.26, 0] },
  lab: { body: lab, dish: [labDish, 0.5, 0.58, -0.5] },
  silo: { body: silo },
};

export function buildStructure(type, owner, w, h) {
  const team = teamColors(owner);
  const key = `b2:${type}:${owner}`;
  const spec = STRUCTURES[type] || { body: (p) => { slab(p, w, h); p.box(w * 0.8, 0.6, h * 0.8, 'team', { y: 0.4 }); } };
  const root = cached(key, team, spec.body);
  const parts = {};
  for (const name of ['dish', 'crane', 'turret']) {
    if (!spec[name]) continue;
    const [fn, x, y, z] = spec[name];
    parts[name] = cached(`${key}:${name}`, team, fn);
    parts[name].position.set(x, y, z);
    root.add(parts[name]);
  }
  if (spec.smoke) parts.smoke = spec.smoke.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  if (type === 'wall') {
    parts.arms = WALL_DIRS.map(([dx, dz], i) => {
      const diag = dx !== 0 && dz !== 0;
      const arm = cached(`${key}:arm${diag ? 'd' : 'o'}`, team, (p) => wallArm(p, diag ? Math.SQRT2 * 0.5 : 0.5));
      arm.rotation.y = -Math.atan2(dz, dx);
      arm.visible = false;
      root.add(arm);
      return arm;
    });
    parts.dirs = WALL_DIRS;
  }
  if (type === 'silo') {
    parts.doors = [-1, 1].map((side) => {
      const d = cached(`${key}:door`, team, siloDoor);
      d.position.set(side * 0.46, 0.33, 0);
      d.rotation.y = side < 0 ? 0 : PI;
      root.add(d);
      return d;
    });
    parts.missile = cached(`${key}:missile`, team, siloMissile);
    parts.missile.position.set(0, -0.6, 0);
    root.add(parts.missile);
  }
  if (type === 'gate') {
    parts.leaf = cached(`${key}:leaf`, team, gateLeaf);
    root.add(parts.leaf);
  }
  const wrap = new THREE.Group();
  wrap.add(root);
  return { root: wrap, body: root, ...parts };
}

// ------------------------------------------------------------- scenery

export function buildProp(kind) {
  const team = teamColors(0);
  const parts = {};
  let root;
  switch (kind) {
    case 'house':
      root = cached('prop2:house', team, (p) => {
        p.box(0.95, 0.03, 0.95, '#7d6a4c', { y: 0.015 });
        p.cbox(0.62, 0.34, 0.44, '#d8ccb0', { y: 0.2 }, 0.008);
        p.add(gable(0.54, 0.26, 0.7), '#4b4038', { y: 0.37 });
        p.cbox(0.08, 0.2, 0.08, '#8a4b35', { x: 0.18, y: 0.6, z: -0.08, surf: 'concrete' }, 0.006);
        p.box(0.09, 0.17, 0.01, '#4a3526', { x: -0.12, y: 0.12, z: 0.225 });
        for (const x of [0.08, 0.22]) p.box(0.08, 0.08, 0.01, C.glass, { x, y: 0.24, z: 0.225, surf: 'glass' });
        for (const x of [-0.18, 0.12]) p.box(0.08, 0.08, 0.01, C.glass, { x, y: 0.24, z: -0.225, surf: 'glass' });
        for (let i = 0; i < 9; i++) p.box(0.02, 0.09, 0.02, '#e6e0d0', { x: -0.42 + i * 0.105, y: 0.06, z: 0.44 });
        p.box(0.86, 0.015, 0.015, '#e6e0d0', { y: 0.08, z: 0.44 });
      });
      break;
    case 'barn':
      root = cached('prop2:barn', team, (p) => {
        p.box(1.9, 0.03, 0.95, '#7d6a4c', { y: 0.015 });
        p.cbox(1.5, 0.42, 0.66, '#7c3a28', { y: 0.24 }, 0.008);
        p.add(gable(0.76, 0.3, 1.56), '#5a5650', { y: 0.45, surf: 'metal' });
        p.box(0.34, 0.32, 0.01, '#5e2a1d', { x: -0.3, y: 0.2, z: 0.335 });
        p.box(0.34, 0.015, 0.012, '#eee', { x: -0.3, y: 0.36, z: 0.338 });
        p.box(0.015, 0.32, 0.012, '#eee', { x: -0.3, y: 0.2, z: 0.338 });
        for (const [x, z] of [[0.5, 0.42], [0.66, 0.4], [0.58, 0.48]]) p.cyl(0.07, 0.07, 0.1, '#c9a856', { x, y: 0.07, z, rx: PI / 2, surf: 'canvas' }, 12);
        p.box(0.22, 0.06, 0.08, '#6a5a45', { x: 0.82, y: 0.06, z: -0.2 });
      });
      break;
    case 'silo':
      root = cached('prop2:silo', team, (p) => {
        p.box(0.9, 0.03, 0.9, '#7d6a4c', { y: 0.015 });
        p.cyl(0.2, 0.2, 0.9, '#b8b3a7', { x: -0.1, y: 0.47, z: -0.1, surf: 'metal' }, 18);
        p.sphere(0.2, '#9d988c', { x: -0.1, y: 0.92, z: -0.1, sy: 0.6 }, 18, 8);
        for (let i = 0; i < 4; i++) p.cyl(0.203, 0.203, 0.015, '#8a867c', { x: -0.1, y: 0.2 + i * 0.2, z: -0.1 }, 18);
        p.cbox(0.3, 0.22, 0.28, '#8f8a7c', { x: 0.24, y: 0.13, z: 0.2 }, 0.008);
        p.add(gable(0.32, 0.1, 0.34), '#5a5650', { x: 0.24, y: 0.24, z: 0.2, surf: 'metal' });
      });
      break;
    case 'windmill':
    default:
      root = cached('prop2:windmill', team, (p) => {
        p.box(0.95, 0.03, 0.95, '#7d6a4c', { y: 0.015 });
        p.cyl(0.18, 0.3, 1.0, '#8d8070', { y: 0.52, surf: 'concrete' }, 8);
        p.cyl(0.19, 0.19, 0.04, '#5b4a3a', { y: 0.42 }, 8);
        p.cone(0.24, 0.26, '#4b4038', { y: 1.15 }, 8);
        p.box(0.09, 0.16, 0.01, '#4a3526', { y: 0.1, z: 0.29 });
        p.box(0.07, 0.07, 0.01, C.glass, { y: 0.62, z: 0.23, surf: 'glass' });
      });
      parts.sails = cached('prop2:windmill:sails', team, (p) => {
        p.cyl(0.04, 0.04, 0.12, '#3d3226', { rx: PI / 2 }, 8);
        for (let k = 0; k < 4; k++) {
          const a = (k * PI) / 2;
          const cx = Math.cos(a), cy = Math.sin(a);
          p.box(0.025, 0.62, 0.02, '#5a4632', { x: cx * 0.31, y: cy * 0.31, rz: a - PI / 2 });
          p.box(0.12, 0.48, 0.008, '#d8cfb8', { x: cx * 0.36 - cy * 0.07, y: cy * 0.36 + cx * 0.07, rz: a - PI / 2, surf: 'canvas' });
        }
      });
      parts.sails.position.set(0, 1.0, 0.27);
      root.add(parts.sails);
  }
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, ...parts };
}

// Oil well pumpjack (neutral) with an animated walking beam.
export function buildWell() {
  const team = teamColors(0);
  const base = cached('well2', team, (p) => {
    p.cyl(0.42, 0.48, 0.05, '#1c1915', { y: 0.02 }, 18);
    p.cbox(0.72, 0.06, 0.22, C.concreteDark, { y: 0.06, surf: 'concrete' }, 0.01);
    p.add(extrudeOutline([[-0.12, 0], [0.12, 0], [0.02, 0.48], [-0.02, 0.48]], 0.14), '#3d3a35', { y: 0.06, surf: 'metal' });
    p.cbox(0.16, 0.12, 0.12, '#8a5a2a', { x: 0.24, y: 0.15 }, 0.01);
    p.cyl(0.03, 0.03, 0.22, '#333', { x: -0.3, y: 0.15 }, 8);
    p.rod([-0.3, 0.12, 0.05], [-0.3, 0.12, 0.4], 0.02, '#4a4740');
  });
  const beam = cached('well2:beam', team, (p) => {
    p.cbox(0.7, 0.05, 0.05, C.yellow, {}, 0.008);
    p.cbox(0.08, 0.16, 0.1, C.yellow, { x: -0.36, y: -0.04 }, 0.01);
    p.cyl(0.1, 0.1, 0.03, '#2d2b26', { x: 0.3, y: -0.04, rx: PI / 2 }, 14);
  });
  beam.position.set(0, 0.55, 0);
  base.add(beam);
  return { root: base, beam };
}
