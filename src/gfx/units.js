import * as THREE from 'three';
import { Parts, cached, teamColors, trackLoop, C } from './modelkit.js';

// Unit models. Each returns { root, body, ...animated parts } where `root`
// is positioned by the renderer and `body` tilts with terrain/banking.
// Scale: the hull of a battle tank is about one tile long.

const PI = Math.PI;

// ----------------------------------------------------------- chassis

// Tracks, road wheels, side skirts and fenders for a tracked vehicle.
function trackedChassis(p, len, width) {
  const tz = width / 2 - 0.07;
  p.box(len * 0.9, 0.1, width - 0.24, 'teamDark', { y: 0.1 });
  for (const s of [-1, 1]) {
    p.add(trackLoop(len, 0.15, 0.12), C.track, { y: 0.085, z: s * tz, surf: 'track' });
    const n = 6;
    for (let i = 0; i < n; i++) {
      const x = -len / 2 + 0.13 + (i * (len - 0.26)) / (n - 1);
      p.cyl(0.05, 0.05, 0.026, C.steel, { x, y: 0.075, z: s * (tz + 0.06), rx: PI / 2 }, 12);
      p.cyl(0.018, 0.018, 0.03, C.gunmetal, { x, y: 0.075, z: s * (tz + 0.065), rx: PI / 2 }, 8);
    }
    p.cyl(0.058, 0.058, 0.03, C.gunmetal, { x: -len / 2 + 0.07, y: 0.1, z: s * (tz + 0.055), rx: PI / 2 }, 10);
    p.cyl(0.05, 0.05, 0.03, C.gunmetal, { x: len / 2 - 0.07, y: 0.1, z: s * (tz + 0.055), rx: PI / 2 }, 10);
    // Side skirt with bolted panels (seams come from the paint shader).
    p.cbox(len * 0.86, 0.075, 0.02, 'body', { x: 0.03, y: 0.168, z: s * (tz + 0.075) }, 0.005);
    p.box(len * 0.98, 0.014, 0.15, 'body', { y: 0.208, z: s * tz });
  }
}

function headlights(p, x, y, z) {
  for (const s of [-1, 1]) {
    p.box(0.02, 0.025, 0.035, C.gunmetal, { x, y, z: s * z });
    p.light(0.012, C.light, { x: x + 0.012, y, z: s * z });
  }
}

// Small square team marking on a side face.
function mark(p, x, y, z, size = 0.05) {
  for (const s of [-1, 1]) p.box(size, size * 0.8, 0.004, 'team', { x, y, z: s * z });
}

// ------------------------------------------------------------ units

function tank(p) {
  const len = 0.96;
  trackedChassis(p, len, 0.5);
  // Hull with a sloped glacis and short rear slope.
  p.profile([[-0.48, 0.12], [0.36, 0.12], [0.5, 0.2], [0.3, 0.27], [-0.46, 0.27], [-0.49, 0.22]], 0.42, 'body', {});
  // Engine deck grilles, stowage, tow cable.
  p.box(0.24, 0.006, 0.3, C.gunmetal, { x: -0.3, y: 0.274 });
  for (let i = 0; i < 7; i++) p.box(0.006, 0.01, 0.28, C.steel, { x: -0.41 + i * 0.035, y: 0.278 });
  for (const s of [-1, 1]) p.cbox(0.16, 0.05, 0.05, 'teamDark', { x: -0.1, y: 0.24, z: s * 0.24 }, 0.006);
  p.rod([0.28, 0.275, -0.17], [-0.42, 0.275, -0.17], 0.006, C.gunmetal);
  headlights(p, 0.42, 0.2, 0.15);
  mark(p, -0.3, 0.22, 0.212, 0.045);
}

function tankTurret(p) {
  p.plan([[0.24, 0], [0.17, 0.16], [-0.16, 0.19], [-0.3, 0.15], [-0.3, -0.15], [-0.16, -0.19], [0.17, -0.16]], 0.11, 'body', {}, 0.01);
  p.cbox(0.08, 0.075, 0.14, 'body', { x: 0.25, y: 0.055 }, 0.008);
  // Main gun with fume extractor and muzzle.
  p.cyl(0.019, 0.022, 0.6, C.gunmetal, { x: 0.57, y: 0.06, rz: PI / 2 }, 12);
  p.cyl(0.03, 0.03, 0.1, 'body', { x: 0.52, y: 0.06, rz: PI / 2 }, 12);
  p.cyl(0.024, 0.024, 0.04, C.gunmetal, { x: 0.86, y: 0.06, rz: PI / 2 }, 10);
  // Commander's cupola and machine gun, gunner's sight, antenna.
  p.cyl(0.045, 0.05, 0.04, 'body', { x: -0.08, y: 0.13, z: 0.08 }, 12);
  p.cyl(0.035, 0.035, 0.012, C.gunmetal, { x: -0.08, y: 0.155, z: 0.08 }, 12);
  p.rod([-0.04, 0.17, 0.08], [0.12, 0.17, 0.08], 0.006, C.gunmetal);
  p.cbox(0.06, 0.045, 0.045, 'body', { x: 0.05, y: 0.13, z: -0.09 }, 0.006);
  p.box(0.004, 0.025, 0.035, C.glass, { x: 0.081, y: 0.135, z: -0.09, surf: 'glass' });
  p.rod([-0.24, 0.11, -0.12], [-0.24, 0.46, -0.12], 0.004, C.gunmetal);
  // Smoke dischargers and rear bustle rack.
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) p.cyl(0.012, 0.012, 0.05, C.gunmetal, { x: 0.13 - i * 0.025, y: 0.09, z: s * 0.18, rx: s * 0.9 }, 6);
  p.box(0.08, 0.05, 0.3, C.gunmetal, { x: -0.34, y: 0.06 });
  p.box(0.06, 0.035, 0.26, C.canvas, { x: -0.34, y: 0.1, surf: 'canvas' });
  mark(p, -0.08, 0.055, 0.19, 0.045);
}

function aa(p) {
  trackedChassis(p, 0.94, 0.5);
  p.profile([[-0.47, 0.12], [0.38, 0.12], [0.48, 0.22], [0.36, 0.28], [-0.45, 0.28], [-0.48, 0.22]], 0.42, 'body', {});
  p.box(0.2, 0.006, 0.28, C.gunmetal, { x: -0.3, y: 0.284 });
  headlights(p, 0.42, 0.21, 0.15);
  mark(p, -0.3, 0.22, 0.212, 0.045);
}

function aaTurret(p) {
  p.cbox(0.34, 0.16, 0.3, 'body', { x: -0.02, y: 0.08 }, 0.012);
  // Twin cannons in external mounts, angled skyward.
  for (const s of [-1, 1]) {
    p.cbox(0.14, 0.08, 0.06, 'teamDark', { x: 0.04, y: 0.1, z: s * 0.18 }, 0.008);
    p.cyl(0.011, 0.012, 0.42, C.gunmetal, { x: 0.25, y: 0.22, z: s * 0.18, rz: PI / 2 - 0.55 }, 8);
    p.cyl(0.016, 0.016, 0.04, C.gunmetal, { x: 0.42, y: 0.34, z: s * 0.18, rz: PI / 2 - 0.55 }, 8);
  }
  // Tracking radar on the front.
  p.sphere(0.05, C.steel, { x: 0.16, y: 0.13, sx: 0.6 }, 12, 8);
  p.rod([-0.16, 0.16, 0], [-0.16, 0.3, 0], 0.012, C.gunmetal);
  mark(p, -0.08, 0.08, 0.152, 0.045);
}

function aaRadar(p) {
  p.cyl(0.11, 0.11, 0.014, C.white, { rx: PI / 2 - 0.25 }, 18);
  p.box(0.02, 0.05, 0.02, C.gunmetal, { y: -0.03 });
}

function artillery(p) {
  trackedChassis(p, 1.02, 0.5);
  p.profile([[-0.51, 0.12], [0.4, 0.12], [0.51, 0.19], [0.36, 0.26], [-0.5, 0.26]], 0.42, 'body', {});
  // Recoil spades at the rear and a barrel travel lock up front.
  for (const s of [-1, 1]) p.box(0.02, 0.12, 0.1, C.gunmetal, { x: -0.53, y: 0.12, z: s * 0.12, rz: -0.3 });
  p.rod([0.38, 0.26, 0], [0.42, 0.36, 0], 0.01, C.gunmetal);
  headlights(p, 0.44, 0.19, 0.15);
}

function artilleryTurret(p) {
  p.plan([[0.2, 0.17], [-0.32, 0.19], [-0.32, -0.19], [0.2, -0.17]], 0.2, 'body', {}, 0.012);
  p.cbox(0.1, 0.12, 0.14, 'body', { x: 0.23, y: 0.11 }, 0.01);
  // Long howitzer barrel, slightly elevated, with muzzle brake.
  const el = 0.12;
  p.cyl(0.024, 0.028, 0.78, C.gunmetal, { x: 0.25 + 0.39 * Math.cos(el), y: 0.11 + 0.39 * Math.sin(el), rz: PI / 2 + el }, 12);
  p.cyl(0.034, 0.034, 0.08, C.gunmetal, { x: 0.25 + 0.6 * Math.cos(el), y: 0.11 + 0.6 * Math.sin(el), rz: PI / 2 + el }, 12);
  p.cbox(0.07, 0.045, 0.07, C.gunmetal, { x: 0.25 + 0.79 * Math.cos(el), y: 0.11 + 0.79 * Math.sin(el), rz: el }, 0.006);
  p.cyl(0.04, 0.045, 0.035, 'body', { x: -0.12, y: 0.215, z: 0.1 }, 12);
  p.rod([-0.1, 0.24, 0.1], [0.04, 0.24, 0.1], 0.006, C.gunmetal);
  p.box(0.004, 0.12, 0.1, C.gunmetal, { x: -0.322, y: 0.1 });
  mark(p, -0.1, 0.1, 0.19, 0.05);
}

function wheel(p, x, z, r, w) {
  p.cyl(r, r, w, C.rubber, { x, y: r, z, rx: PI / 2, surf: 'rubber' }, 14);
  p.cyl(r * 0.55, r * 0.55, w + 0.006, C.steel, { x, y: r, z, rx: PI / 2 }, 10);
}

function scout(p) {
  for (const x of [0.24, -0.22]) for (const s of [-1, 1]) wheel(p, x, s * 0.19, 0.08, 0.07);
  p.box(0.6, 0.05, 0.3, C.gunmetal, { y: 0.1 });
  // Low, wide body: hood, cabin and cargo bed.
  p.profile([[-0.34, 0.12], [0.36, 0.12], [0.38, 0.21], [0.13, 0.23], [0.07, 0.33], [-0.18, 0.33], [-0.2, 0.25], [-0.34, 0.25]], 0.36, 'body', {}, 0.012);
  // Windscreen and side windows.
  p.profile([[0.075, 0.24], [0.12, 0.24], [0.068, 0.325], [0.04, 0.325]], 0.3, C.glass, { surf: 'glass' }, 0);
  for (const s of [-1, 1]) p.box(0.16, 0.06, 0.004, C.glass, { x: -0.05, y: 0.29, z: s * 0.181, surf: 'glass' });
  // Brush guard, lights, spare wheel, antenna.
  p.rod([0.39, 0.13, -0.14], [0.39, 0.13, 0.14], 0.008, C.gunmetal);
  p.rod([0.39, 0.13, -0.1], [0.37, 0.21, -0.1], 0.007, C.gunmetal);
  p.rod([0.39, 0.13, 0.1], [0.37, 0.21, 0.1], 0.007, C.gunmetal);
  headlights(p, 0.37, 0.19, 0.13);
  wheel(p, -0.36, 0, 0.065, 0.06);
  p.rod([-0.3, 0.25, 0.15], [-0.3, 0.55, 0.15], 0.003, C.gunmetal);
  mark(p, -0.02, 0.2, 0.182, 0.05);
}

function scoutTurret(p) {
  p.cyl(0.07, 0.07, 0.025, C.gunmetal, { y: 0.012 }, 14);
  p.cbox(0.02, 0.07, 0.14, 'body', { x: 0.06, y: 0.06 }, 0.004);
  p.cyl(0.012, 0.012, 0.26, C.gunmetal, { x: 0.15, y: 0.06, rz: PI / 2 }, 8);
  p.box(0.06, 0.04, 0.04, C.gunmetal, { x: 0.02, y: 0.06 });
}

function truck(p) {
  p.box(0.82, 0.05, 0.24, C.gunmetal, { y: 0.12 });
  for (const x of [0.3, -0.13, -0.29]) for (const s of [-1, 1]) wheel(p, x, s * 0.16, 0.075, x > 0 ? 0.06 : 0.09);
  // Cab with windscreen and door windows.
  p.profile([[0.16, 0.13], [0.44, 0.13], [0.46, 0.22], [0.42, 0.24], [0.38, 0.38], [0.16, 0.38]], 0.34, 'body', {}, 0.012);
  p.profile([[0.37, 0.25], [0.405, 0.25], [0.375, 0.365], [0.34, 0.365]], 0.3, C.glass, { surf: 'glass' }, 0);
  for (const s of [-1, 1]) p.box(0.12, 0.08, 0.004, C.glass, { x: 0.26, y: 0.31, z: s * 0.171, surf: 'glass' });
  p.box(0.012, 0.06, 0.2, C.gunmetal, { x: 0.465, y: 0.18 });
  headlights(p, 0.455, 0.2, 0.13);
  // Fuel tank with end caps, reinforcing rings, catwalk and ladder.
  p.cyl(0.14, 0.14, 0.52, C.tin, { x: -0.11, y: 0.29, rz: PI / 2, surf: 'metal' }, 18);
  for (const x of [0.15, -0.37]) p.sphere(0.14, C.tin, { x, y: 0.29, sx: 0.25 }, 16, 10);
  for (const x of [-0.3, -0.11, 0.08]) p.cyl(0.145, 0.145, 0.02, 'body', { x, y: 0.29, rz: PI / 2 }, 18);
  p.box(0.4, 0.008, 0.06, C.gunmetal, { x: -0.11, y: 0.43 });
  p.cyl(0.03, 0.03, 0.03, C.gunmetal, { x: -0.11, y: 0.44 }, 10);
  p.rod([0.13, 0.16, 0.15], [0.13, 0.42, 0.13], 0.005, C.gunmetal);
  mark(p, 0.27, 0.21, 0.171, 0.05);
}

function soldier(p, x, z, rocket) {
  for (const s of [-1, 1]) p.box(0.028, 0.11, 0.032, '#4a4c3c', { x, y: 0.055, z: z + s * 0.02 });
  p.cbox(0.06, 0.1, 0.08, 'body', { x, y: 0.15, z }, 0.008);
  p.box(0.064, 0.05, 0.084, 'teamDark', { x, y: 0.16, z });
  p.box(0.05, 0.07, 0.06, C.canvas, { x: x - 0.045, y: 0.16, z, surf: 'canvas' });
  p.sphere(0.026, '#c9a07a', { x: x + 0.004, y: 0.225, z }, 8, 6);
  p.sphere(0.034, 'body', { x, y: 0.238, z, sy: 0.7 }, 10, 6);
  // Arms reach forward to the weapon.
  for (const s of [-1, 1]) p.rod([x, 0.19, z + s * 0.045], [x + 0.06, 0.15, z + s * 0.02], 0.012, 'body');
  if (rocket) {
    p.cyl(0.024, 0.024, 0.3, '#4c5236', { x: x - 0.01, y: 0.23, z: z + 0.05, rz: PI / 2 }, 10);
    p.cyl(0.03, 0.024, 0.04, C.gunmetal, { x: x + 0.15, y: 0.23, z: z + 0.05, rz: PI / 2 }, 10);
  } else {
    p.rod([x + 0.02, 0.15, z], [x + 0.16, 0.16, z], 0.007, C.gunmetal);
  }
  p.box(0.004, 0.006, 0.004, 'team', { x: x - 0.002, y: 0.2, z: z + 0.042 });
}

function infantry(p, rocket) {
  soldier(p, 0.08, 0, rocket);
  soldier(p, -0.08, -0.11, rocket);
  soldier(p, -0.1, 0.11, rocket);
}

function heli(p) {
  // Narrow fuselage with tandem cockpit.
  p.profile([[0.44, 0.02], [0.3, -0.06], [-0.1, -0.07], [-0.25, -0.02], [-0.28, 0.1], [-0.1, 0.16], [0.12, 0.17], [0.3, 0.12]], 0.16, 'body', {}, 0.02);
  p.sphere(0.075, C.glass, { x: 0.26, y: 0.12, sx: 1.4, sy: 0.75, surf: 'glass' }, 12, 8);
  p.sphere(0.075, C.glass, { x: 0.1, y: 0.17, sx: 1.4, sy: 0.75, surf: 'glass' }, 12, 8);
  // Tail boom, fin, stabiliser.
  p.cyl(0.026, 0.05, 0.64, 'body', { x: -0.55, y: 0.06, rz: PI / 2 }, 10);
  p.profile([[-0.92, 0.04], [-0.8, 0.04], [-0.84, 0.24], [-0.93, 0.26]], 0.024, 'body', {}, 0.004);
  p.box(0.12, 0.012, 0.26, 'body', { x: -0.84, y: 0.05 });
  // Engine nacelles with intakes and exhausts.
  for (const s of [-1, 1]) {
    p.cyl(0.045, 0.045, 0.24, 'body', { x: -0.02, y: 0.13, z: s * 0.11, rz: PI / 2 }, 12);
    p.cyl(0.03, 0.03, 0.02, C.gunmetal, { x: 0.105, y: 0.13, z: s * 0.11, rz: PI / 2 }, 10);
    p.cyl(0.032, 0.032, 0.04, C.gunmetal, { x: -0.15, y: 0.15, z: s * 0.11, rz: PI / 2 + 0.4 }, 10);
  }
  // Stub wings with rocket pods and missile rails.
  p.box(0.14, 0.016, 0.52, 'body', { x: 0.02, y: 0.03 });
  for (const s of [-1, 1]) {
    p.cyl(0.035, 0.035, 0.16, '#5c6050', { x: 0.03, y: -0.02, z: s * 0.2, rz: PI / 2 }, 12);
    p.cyl(0.03, 0.03, 0.005, C.gunmetal, { x: 0.112, y: -0.02, z: s * 0.2, rz: PI / 2 }, 12);
    for (const k of [-1, 1]) p.rod([-0.04, -0.03, s * 0.12 + k * 0.018], [0.1, -0.03, s * 0.12 + k * 0.018], 0.01, C.white);
  }
  // Chin gun, mast, landing gear.
  p.sphere(0.03, C.gunmetal, { x: 0.32, y: -0.06 }, 8, 6);
  p.rod([0.33, -0.08, 0], [0.45, -0.08, 0], 0.007, C.gunmetal);
  p.cyl(0.03, 0.035, 0.08, C.gunmetal, { x: 0.02, y: 0.21 }, 10);
  for (const s of [-1, 1]) {
    p.rod([0.18, -0.06, s * 0.06], [0.18, -0.12, s * 0.09], 0.006, C.gunmetal);
    p.cyl(0.025, 0.025, 0.018, C.rubber, { x: 0.18, y: -0.13, z: s * 0.09, rx: PI / 2, surf: 'rubber' }, 10);
  }
  p.light(0.012, '#ff3030', { x: -0.93, y: 0.26 });
  mark(p, -0.5, 0.07, 0.05, 0.05);
}

function heliRotor(p) {
  for (let k = 0; k < 4; k++) p.box(0.7, 0.008, 0.045, '#1b1b1b', { x: Math.cos((k * PI) / 2) * 0.36, z: Math.sin((k * PI) / 2) * 0.36, ry: -(k * PI) / 2 });
  p.cyl(0.04, 0.04, 0.03, C.gunmetal, {}, 10);
}

function fighter(p) {
  p.cyl(0.055, 0.065, 0.8, 'body', { x: -0.05, rz: PI / 2 }, 14);
  p.cone(0.055, 0.28, 'body', { x: 0.49, rz: -PI / 2 }, 14);
  p.cbox(0.3, 0.06, 0.1, 'body', { x: 0.12, y: -0.05 }, 0.01);
  p.sphere(0.05, C.glass, { x: 0.26, y: 0.05, sx: 2.6, sy: 0.9, surf: 'glass' }, 12, 8);
  // Cropped-delta wings, tailplanes and a single fin.
  for (const s of [-1, 1]) {
    p.plan([[0.18, s * 0.05], [-0.16, s * 0.46], [-0.26, s * 0.46], [-0.24, s * 0.05]], 0.016, 'body', { y: -0.01 });
    p.plan([[-0.32, s * 0.05], [-0.44, s * 0.22], [-0.5, s * 0.22], [-0.47, s * 0.05]], 0.012, 'body', { y: -0.01 });
    p.rod([-0.1, -0.01, s * 0.47], [-0.32, -0.01, s * 0.47], 0.01, C.white);
    p.cyl(0.03, 0.03, 0.005, 'team', { x: -0.12, y: 0.01, z: s * 0.3 }, 12);
  }
  p.profile([[-0.48, 0.05], [-0.28, 0.05], [-0.42, 0.28], [-0.5, 0.28]], 0.016, 'body', {}, 0.003);
  p.cyl(0.05, 0.045, 0.06, C.gunmetal, { x: -0.47, rz: PI / 2 }, 12);
  p.glowBox(0.01, 0.06, 0.06, '#ffb060', { x: -0.505 });
}

function bomber(p) {
  // Flying wing with a sawtooth trailing edge.
  const half = [[0.55, 0], [-0.1, 0.95], [-0.24, 0.95], [-0.16, 0.62], [-0.32, 0.44], [-0.2, 0.24], [-0.34, 0.06], [-0.34, 0]];
  const outline = [...half, ...half.slice(1, -1).reverse().map(([x, z]) => [x, -z])];
  p.plan(outline, 0.05, 'body', { y: -0.02 }, 0.015);
  p.sphere(0.16, 'body', { x: 0.18, y: 0.02, sx: 2.6, sy: 0.5 }, 16, 10);
  for (const s of [-1, 1]) {
    p.box(0.012, 0.03, 0.05, C.glass, { x: 0.46, y: 0.07, z: s * 0.035, rz: -0.6, surf: 'glass' });
    p.cbox(0.16, 0.05, 0.14, 'body', { x: 0.0, y: 0.05, z: s * 0.2 }, 0.02);
    p.box(0.06, 0.012, 0.1, C.gunmetal, { x: -0.1, y: 0.075, z: s * 0.2 });
    p.cyl(0.04, 0.04, 0.005, 'team', { x: -0.05, y: 0.035, z: s * 0.62 }, 12);
  }
}

function hull(p, len, beam, height, color = '#8f979c') {
  const bow = len / 2, stern = -len / 2;
  const outline = [[bow, 0], [bow - len * 0.22, beam / 2], [stern + 0.04, beam / 2], [stern, beam * 0.3], [stern, -beam * 0.3], [stern + 0.04, -beam / 2], [bow - len * 0.22, -beam / 2]];
  p.plan(outline, height, color, { y: -0.08 }, 0.012);
  // Dark deck and a boot-topping stripe at the waterline.
  const deck = outline.map(([x, z]) => [x * 0.98, z * 0.94]);
  p.plan(deck, 0.01, '#767c80', { y: height - 0.075 }, 0);
  p.plan(outline.map(([x, z]) => [x * 1.003, z * 1.03]), 0.025, '#3a2a26', { y: -0.04 }, 0);
}

function gunboat(p) {
  hull(p, 1.12, 0.4, 0.2);
  p.cbox(0.32, 0.14, 0.26, '#a7aeb2', { x: -0.08, y: 0.19 }, 0.012);
  p.cbox(0.2, 0.08, 0.24, '#a7aeb2', { x: -0.02, y: 0.3 }, 0.01);
  p.box(0.004, 0.035, 0.2, C.glass, { x: 0.081, y: 0.31, surf: 'glass' });
  for (const s of [-1, 1]) p.box(0.14, 0.03, 0.004, C.glass, { x: -0.02, y: 0.31, z: s * 0.121, surf: 'glass' });
  p.rod([-0.06, 0.34, 0], [-0.06, 0.56, 0], 0.008, '#5b6166');
  p.box(0.02, 0.012, 0.18, '#5b6166', { x: -0.06, y: 0.52 });
  for (const s of [-1, 1]) p.cyl(0.03, 0.03, 0.1, C.white, { x: -0.3, y: 0.15, z: s * 0.15, rz: PI / 2 }, 10);
  p.rod([-0.42, 0.13, 0], [-0.42, 0.22, 0], 0.01, C.gunmetal);
  p.rod([-0.42, 0.22, 0], [-0.32, 0.22, 0], 0.006, C.gunmetal);
  p.box(0.08, 0.006, 0.18, 'team', { x: -0.18, y: 0.262 });
  p.light(0.012, '#ff3030', { x: -0.06, y: 0.57 });
}

function gunboatTurret(p) {
  p.cyl(0.06, 0.075, 0.07, '#a7aeb2', { y: 0.035 }, 14);
  p.cbox(0.1, 0.05, 0.09, '#a7aeb2', { x: 0.02, y: 0.08 }, 0.01);
  p.cyl(0.014, 0.016, 0.24, C.gunmetal, { x: 0.18, y: 0.08, rz: PI / 2 }, 10);
}

function destroyer(p) {
  hull(p, 1.9, 0.52, 0.24);
  // Forward superstructure and bridge.
  p.cbox(0.42, 0.18, 0.4, '#a7aeb2', { x: 0.18, y: 0.24 }, 0.014);
  p.cbox(0.3, 0.12, 0.36, '#a7aeb2', { x: 0.2, y: 0.39 }, 0.012);
  p.box(0.004, 0.04, 0.32, C.glass, { x: 0.351, y: 0.41, surf: 'glass' });
  // Lattice mast.
  for (const [x, z] of [[0.12, 0.07], [0.12, -0.07], [0.2, 0.07], [0.2, -0.07]]) p.rod([x, 0.45, z], [0.16, 0.86, 0], 0.007, '#5b6166');
  p.box(0.14, 0.012, 0.012, '#5b6166', { x: 0.16, y: 0.7 });
  // Funnel, aft superstructure and helicopter hangar.
  p.cbox(0.16, 0.2, 0.16, '#a7aeb2', { x: -0.16, y: 0.27, rz: 0.12 }, 0.02);
  p.box(0.13, 0.02, 0.13, '#2a2c2e', { x: -0.17, y: 0.38 });
  p.cbox(0.36, 0.16, 0.38, '#a7aeb2', { x: -0.45, y: 0.23 }, 0.014);
  // Vertical launch cells, CIWS dome, flight deck marking.
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) p.box(0.05, 0.012, 0.05, '#2b2f33', { x: 0.52 + i * 0.06, y: 0.172, z: -0.06 + j * 0.06 });
  p.cyl(0.04, 0.05, 0.05, C.white, { x: -0.3, y: 0.33 }, 12);
  p.sphere(0.04, C.white, { x: -0.3, y: 0.37 }, 12, 8);
  p.cyl(0.12, 0.12, 0.004, C.white, { x: -0.8, y: 0.168 }, 24);
  p.cyl(0.11, 0.11, 0.006, '#4f5357', { x: -0.8, y: 0.169 }, 24);
  for (const s of [-1, 1]) p.cyl(0.03, 0.03, 0.12, C.white, { x: -0.1, y: 0.2, z: s * 0.22, rz: PI / 2 }, 10);
  p.box(0.08, 0.006, 0.36, 'team', { x: -0.45, y: 0.312 });
  p.light(0.014, '#ff3030', { x: 0.16, y: 0.88 });
}

function destroyerTurret(p) {
  p.plan([[0.13, 0.07], [0.13, -0.07], [-0.1, -0.1], [-0.1, 0.1]], 0.08, '#a7aeb2', {}, 0.012);
  p.cyl(0.018, 0.022, 0.34, C.gunmetal, { x: 0.28, y: 0.045, rz: PI / 2 }, 10);
}

function radarBar(p) {
  p.cbox(0.04, 0.08, 0.3, C.white, {}, 0.008);
  p.box(0.012, 0.02, 0.02, C.gunmetal, { y: -0.05 });
}

function drone(p) {
  const arms = [[0.22, 0.22], [0.22, -0.22], [-0.22, 0.22], [-0.22, -0.22]];
  p.cbox(0.26, 0.07, 0.16, 'body', { y: 0.02 }, 0.012);
  p.box(0.1, 0.006, 0.1, 'team', { y: 0.058 });
  p.sphere(0.05, '#1c1c1c', { x: 0.1, y: -0.045 }, 10, 8);
  p.sphere(0.028, '#2f6fa8', { x: 0.14, y: -0.045, surf: 'glass' }, 8, 6);
  for (const [x, z] of arms) {
    p.rod([0, 0.03, 0], [x, 0.03, z], 0.015, C.gunmetal);
    p.cyl(0.03, 0.03, 0.05, '#333', { x, y: 0.05, z }, 10);
    p.rod([x * 0.5, 0.0, z * 0.5], [x * 0.5, -0.07, z * 0.5], 0.006, '#222');
  }
  p.light(0.016, '#3cff6a', { x: 0.13, y: 0.03, z: 0.08 });
  p.light(0.016, '#ff3030', { x: 0.13, y: 0.03, z: -0.08 });
}

// ------------------------------------------------- researched units

// Special forces: two operators in dark fatigues and berets, long rifles.
function operator(p, x, z) {
  for (const s of [-1, 1]) p.box(0.028, 0.11, 0.032, '#24261f', { x, y: 0.055, z: z + s * 0.02 });
  p.cbox(0.06, 0.1, 0.08, '#2c2f27', { x, y: 0.15, z }, 0.008);
  p.box(0.066, 0.055, 0.086, '#1d1f1a', { x, y: 0.165, z }); // plate carrier
  p.box(0.045, 0.06, 0.055, '#3a3d31', { x: x - 0.045, y: 0.17, z });
  p.sphere(0.026, '#b58c66', { x: x + 0.004, y: 0.225, z }, 8, 6);
  p.cyl(0.034, 0.03, 0.018, 'teamDark', { x: x - 0.004, y: 0.25, z, rz: -0.25 }, 10); // beret
  p.box(0.006, 0.012, 0.05, '#111', { x: x + 0.027, y: 0.228, z }); // goggles
  for (const s of [-1, 1]) p.rod([x, 0.19, z + s * 0.045], [x + 0.06, 0.17, z + s * 0.02], 0.012, '#2c2f27');
  // Long rifle with scope and suppressor.
  p.rod([x - 0.02, 0.17, z + 0.01], [x + 0.22, 0.18, z + 0.01], 0.008, C.gunmetal);
  p.cyl(0.011, 0.011, 0.06, '#111', { x: x + 0.06, y: 0.195, z: z + 0.01, rz: PI / 2 }, 8);
  p.cyl(0.011, 0.011, 0.05, '#111', { x: x + 0.24, y: 0.18, z: z + 0.01, rz: PI / 2 }, 8);
  p.box(0.004, 0.006, 0.004, 'team', { x: x - 0.002, y: 0.2, z: z + 0.042 });
}

function commando(p) {
  operator(p, 0.06, 0.06);
  operator(p, -0.08, -0.08);
}

// Parachute canopy and rigging, shown while paratroopers descend.
function parachute(p) {
  p.sphere(0.36, '#6f7552', { y: 0.95, sy: 0.45 }, 18, 8);
  p.cyl(0.36, 0.36, 0.01, '#4d5238', { y: 0.95 }, 18);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    p.rod([Math.cos(a) * 0.34, 0.94, Math.sin(a) * 0.34], [0, 0.26, 0], 0.003, '#d8d4c4');
  }
}

// MQ-9 style armed drone: slender fuselage, long straight wings, V-tail,
// pusher propeller, a missile under each wing.
function strikedrone(p) {
  p.cyl(0.04, 0.03, 0.7, 'body', { x: -0.02, rz: PI / 2 }, 12);
  p.sphere(0.06, 'body', { x: 0.3, y: 0.01, sx: 1.6, sy: 0.8 }, 12, 8); // sensor bulge
  p.sphere(0.035, '#1c1c1c', { x: 0.28, y: -0.05 }, 10, 8); // targeting turret
  p.sphere(0.018, '#2f6fa8', { x: 0.305, y: -0.055, surf: 'glass' }, 8, 6);
  for (const s of [-1, 1]) {
    p.plan([[0.07, s * 0.03], [0.03, s * 0.62], [-0.04, s * 0.62], [-0.06, s * 0.03]], 0.014, 'body', { y: 0.02 });
    p.cyl(0.022, 0.022, 0.005, 'team', { x: 0, y: 0.03, z: s * 0.4 }, 10);
    // Missile on a pylon.
    p.box(0.05, 0.03, 0.01, C.gunmetal, { x: 0.01, y: 0, z: s * 0.28 });
    p.cyl(0.015, 0.015, 0.2, C.white, { x: 0.02, y: -0.03, z: s * 0.28, rz: PI / 2 }, 8);
    p.cone(0.015, 0.04, C.red, { x: 0.14, y: -0.03, z: s * 0.28, rz: -PI / 2 }, 8);
    // V-tail.
    p.plan([[-0.3, 0], [-0.44, s * 0.16], [-0.48, s * 0.16], [-0.4, 0]], 0.01, 'body', { y: 0.03, rx: s * -0.6 });
  }
  p.cyl(0.02, 0.02, 0.04, C.gunmetal, { x: -0.39, rz: PI / 2 }, 8);
}

function strikedroneProp(p) {
  p.box(0.006, 0.2, 0.02, '#151515', {});
  p.box(0.006, 0.02, 0.2, '#151515', {});
}

// Attack submarine: mostly submerged teardrop hull, sail with dive planes,
// cruciform tail.
function submarine(p) {
  const dark = '#22262a';
  p.sphere(0.5, dark, { y: -0.02, sx: 1.0, sy: 0.14, sz: 0.16 }, 20, 10);
  p.box(0.6, 0.02, 0.1, '#2b3035', { y: 0.05 }); // deck casing
  p.cbox(0.2, 0.17, 0.07, dark, { x: 0.12, y: 0.13 }, 0.02); // sail
  p.box(0.12, 0.012, 0.22, dark, { x: 0.13, y: 0.17 }); // sail planes
  p.rod([0.16, 0.2, 0], [0.16, 0.32, 0], 0.006, C.gunmetal); // periscope
  p.rod([0.1, 0.2, 0.012], [0.1, 0.28, 0.012], 0.005, C.gunmetal); // mast
  p.box(0.06, 0.03, 0.074, 'team', { x: 0.12, y: 0.08 });
  p.box(0.08, 0.008, 0.28, dark, { x: -0.44, y: 0.01 }); // stern planes
  p.box(0.08, 0.2, 0.008, dark, { x: -0.44, y: 0.02 }); // rudder
  p.light(0.01, '#ff3030', { x: 0.13, y: 0.22 });
}

// C-130 style transport: high wing, four turboprops, raised tail.
function transport(p) {
  p.cyl(0.11, 0.11, 1.1, 'body', { x: 0.0, y: 0.0, rz: PI / 2 }, 16);
  p.sphere(0.11, 'body', { x: 0.55, sx: 1.4 }, 16, 10); // nose
  p.cone(0.11, 0.5, 'body', { x: -0.79, y: 0.05, rz: PI / 2, sy: 1 }, 16); // tapering rear
  p.box(0.12, 0.04, 0.16, C.glass, { x: 0.6, y: 0.07, surf: 'glass' }); // cockpit
  p.plan([[0.2, -0.85], [0.2, 0.85], [0.02, 0.85], [-0.02, 0.0], [0.02, -0.85]], 0.03, 'body', { y: 0.1 });
  for (const z of [-0.6, -0.32, 0.32, 0.6]) {
    p.cyl(0.04, 0.035, 0.24, 'body', { x: 0.2, y: 0.07, z, rz: PI / 2 }, 10);
    p.cyl(0.022, 0.022, 0.02, C.gunmetal, { x: 0.33, y: 0.07, z, rz: PI / 2 }, 8);
  }
  for (const s of [-1, 1]) p.cyl(0.03, 0.03, 0.004, 'team', { x: 0.1, y: 0.13, z: s * 0.55 }, 12);
  p.profile([[-0.78, 0.08], [-0.55, 0.08], [-0.82, 0.42], [-0.92, 0.42]], 0.02, 'body', {}, 0.004); // fin
  p.box(0.14, 0.015, 0.6, 'body', { x: -0.86, y: 0.12 }); // tailplane
  p.box(0.08, 0.05, 0.002, 'team', { x: -0.2, y: 0.04, z: 0.111 });
  p.light(0.012, '#ff3030', { x: 0.1, y: 0.13, z: -0.86 });
  p.light(0.012, '#3cff6a', { x: 0.1, y: 0.13, z: 0.86 });
}

function transportProp(p) {
  p.box(0.006, 0.22, 0.02, '#151515', {});
  p.box(0.006, 0.02, 0.22, '#151515', {});
}

// ------------------------------------------------------------- build

const BUILDERS = {
  tank: { body: tank, turret: [tankTurret, -0.04, 0.27] },
  aa: { body: aa, turret: [aaTurret, -0.04, 0.28], radar: [aaRadar, -0.2, 0.32, 'turret'] },
  artillery: { body: artillery, turret: [artilleryTurret, -0.12, 0.26] },
  scout: { body: scout, turret: [scoutTurret, -0.06, 0.33] },
  truck: { body: truck },
  infantry: { body: (p) => infantry(p, false) },
  rocketeer: { body: (p) => infantry(p, true) },
  heli: { body: heli },
  fighter: { body: fighter },
  bomber: { body: bomber },
  gunboat: { body: gunboat, turret: [gunboatTurret, 0.3, 0.12] },
  destroyer: { body: destroyer, turret: [destroyerTurret, 0.6, 0.16], radar: [radarBar, 0.16, 0.8] },
  drone: { body: drone },
  commando: { body: commando },
  para: { body: (p) => infantry(p, false) },
  strikedrone: { body: strikedrone },
  submarine: { body: submarine },
  paratroopers: { body: transport },
};

export function buildUnit(type, owner) {
  const team = teamColors(owner);
  const key = `u2:${type}:${owner}`;
  const spec = BUILDERS[type] || { body: (p) => p.box(0.5, 0.3, 0.5, 'team', { y: 0.15 }) };
  const root = cached(key, team, spec.body);
  const parts = {};
  if (spec.turret) {
    const [fn, x, y] = spec.turret;
    parts.turret = cached(key + ':t', team, fn);
    parts.turret.position.set(x, y, 0);
    root.add(parts.turret);
  }
  if (spec.radar) {
    const [fn, x, y, parent] = spec.radar;
    parts.radar = cached(key + ':d', team, fn);
    parts.radar.position.set(x, y, 0);
    (parent === 'turret' ? parts.turret : root).add(parts.radar);
  }
  if (type === 'heli') {
    parts.rotor = cached(key + ':r', team, heliRotor);
    parts.rotor.position.set(0.02, 0.26, 0);
    parts.blur = new THREE.Mesh(new THREE.CircleGeometry(0.72, 28).rotateX(-PI / 2), new THREE.MeshBasicMaterial({ color: '#222', transparent: true, opacity: 0.16, depthWrite: false }));
    parts.blur.position.set(0.02, 0.255, 0);
    // Two blades in the vertical plane; the renderer spins them about Z.
    parts.tailRotor = cached(key + ':tr', team, (p) => { p.box(0.26, 0.022, 0.012, '#1b1b1b', {}); p.box(0.022, 0.26, 0.012, '#1b1b1b', {}); });
    parts.tailRotor.position.set(-0.86, 0.14, 0.03);
    root.add(parts.rotor, parts.blur, parts.tailRotor);
  }
  if (type === 'drone') {
    const arms = [[0.22, 0.22], [0.22, -0.22], [-0.22, 0.22], [-0.22, -0.22]];
    parts.rotors = arms.map(([x, z], i) => {
      const r = cached(key + ':r', team, (p) => { p.box(0.22, 0.008, 0.03, '#151515', {}); });
      r.position.set(x, 0.085, z);
      r.rotation.y = i * 0.7;
      root.add(r);
      return r;
    });
  }
  if (type === 'strikedrone') {
    parts.props = [cached(key + ':p', team, strikedroneProp)];
    parts.props[0].position.set(-0.42, 0, 0);
    root.add(parts.props[0]);
  }
  if (type === 'paratroopers') {
    parts.props = [-0.6, -0.32, 0.32, 0.6].map((z) => {
      const pr = cached(key + ':p', team, transportProp);
      pr.position.set(0.345, 0.07, z);
      root.add(pr);
      return pr;
    });
  }
  if (type === 'para') {
    parts.chute = cached(key + ':c', team, parachute);
    parts.chute.visible = false;
    root.add(parts.chute);
  }
  const wrap = new THREE.Group();
  wrap.add(root);
  return { root: wrap, body: root, ...parts };
}
