import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FACTIONS } from '../config.js';

// Procedural low-poly models. Static parts of each model are merged into a
// single vertex-coloured mesh (one draw call); moving parts such as turrets
// and rotors are separate child objects. Models face +X. One tile = 1 unit.

export const materials = {
  body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.28 }),
  glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
};

const geoCache = new Map();

// Military paint per faction: desert tan for the Coalition, olive drab for
// the Liberation Front. Bright team colour is kept to small markings.
const PAINT = [
  { body: '#a89d76', dark: '#6e6650' },
  { body: '#5f6a41', dark: '#3c4430' },
];

function teamColors(owner) {
  const f = FACTIONS[owner] || FACTIONS[0];
  const paint = PAINT[owner] || PAINT[0];
  return { accent: new THREE.Color(f.color), body: new THREE.Color(paint.body), dark: new THREE.Color(paint.dark) };
}

// Camouflage blotches and weathering, computed in model space so the
// pattern sticks to the vehicle as it moves. Applies to 'body' paint only.
materials.body.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float camo;\nvarying float vCamo;\nvarying vec3 vObj;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCamo = camo;\nvObj = position;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vCamo;\nvarying vec3 vObj;')
    .replace('#include <color_fragment>', `#include <color_fragment>
      if (vCamo > 0.5) {
        float n1 = sin(vObj.x * 23.0 + sin(vObj.z * 17.0) * 1.7) * sin(vObj.z * 19.0 + sin(vObj.y * 29.0 + vObj.x * 7.0) * 1.3);
        float n2 = sin(vObj.x * 13.0 - vObj.z * 21.0 + sin(vObj.y * 31.0) * 2.0);
        diffuseColor.rgb *= n1 > 0.32 ? vec3(0.66, 0.64, 0.58) : (n2 > 0.6 ? vec3(1.12, 1.08, 0.94) : vec3(1.0));
      }
      // Dust and grime collect low down.
      diffuseColor.rgb *= 0.86 + 0.14 * smoothstep(0.0, 0.35, vObj.y);`);
};
materials.body.customProgramCacheKey = () => 'camo';

class Parts {
  constructor(team) {
    this.list = [];
    this.glow = [];
    this.team = team;
  }

  color(c) {
    if (c === 'team') return this.team.accent;
    if (c === 'body') return this.team.body;
    if (c === 'teamDark') return this.team.dark;
    return new THREE.Color(c);
  }

  add(geo, color, o = {}, glow = false) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone());
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(o.x || 0, o.y || 0, o.z || 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0)),
      new THREE.Vector3(o.sx || 1, o.sy || 1, o.sz || 1),
    );
    g.applyMatrix4(m);
    const c = this.color(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.setAttribute('camo', new THREE.BufferAttribute(new Float32Array(n).fill(color === 'body' ? 1 : 0), 1));
    if (g.attributes.uv) g.deleteAttribute('uv');
    (glow ? this.glow : this.list).push(g);
    return this;
  }

  box(w, h, d, color, o) { return this.add(new THREE.BoxGeometry(w, h, d), color, o); }
  cyl(rt, rb, h, color, o, seg = 12) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, o); }
  sphere(r, color, o, ws = 12, hs = 8) { return this.add(new THREE.SphereGeometry(r, ws, hs), color, o); }
  cone(r, h, color, o, seg = 10) { return this.add(new THREE.ConeGeometry(r, h, seg), color, o); }
  light(r, color, o) { return this.add(new THREE.SphereGeometry(r, 6, 4), color, o, true); }
  glowBox(w, h, d, color, o) { return this.add(new THREE.BoxGeometry(w, h, d), color, o, true); }

  // Build (and cache) the merged mesh.
  build(key) {
    let entry = geoCache.get(key);
    if (!entry) {
      entry = {
        body: this.list.length ? mergeGeometries(this.list) : null,
        glow: this.glow.length ? mergeGeometries(this.glow) : null,
      };
      entry.body?.computeBoundingSphere();
      geoCache.set(key, entry);
    }
    const group = new THREE.Group();
    if (entry.body) {
      const m = new THREE.Mesh(entry.body, materials.body);
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
    }
    if (entry.glow) group.add(new THREE.Mesh(entry.glow, materials.glow));
    return group;
  }
}

// Build a part set only if it isn't cached yet.
function cached(key, team, fn) {
  if (geoCache.has(key)) return new Parts(team).build(key);
  const p = new Parts(team);
  fn(p);
  return p.build(key);
}

function extrudeOutline(points, depth) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}

// Hull outline (top view) extruded upward, for boats and aircraft.
function hullFromOutline(points, height) {
  return extrudeOutline(points, height).rotateX(Math.PI / 2).translate(0, height / 2, 0);
}

// --------------------------------------------------------------- units

function tracks(p, len, width, y = 0.08) {
  for (const z of [-width / 2, width / 2]) {
    p.box(len, 0.13, 0.15, '#2b2b28', { y, z });
    for (let i = 0; i < 4; i++) p.cyl(0.06, 0.06, 0.16, '#3a3a36', { x: -len / 2 + 0.1 + (i * (len - 0.2)) / 3, y: y - 0.01, z, rx: Math.PI / 2 }, 8);
    p.box(len * 0.92, 0.04, 0.17, 'body', { y: y + 0.08, z });
  }
}

function wheels(p, xs, z, r = 0.075) {
  for (const x of xs) for (const s of [-1, 1]) p.cyl(r, r, 0.07, '#202020', { x, y: r, z: z * s, rx: Math.PI / 2 }, 10);
}

function soldier(p, x, z, rocket) {
  p.box(0.06, 0.12, 0.08, '#3d4033', { x, y: 0.06, z });
  p.box(0.07, 0.12, 0.11, 'body', { x, y: 0.17, z });
  p.sphere(0.035, '#c99a74', { x: x + 0.005, y: 0.26, z }, 8, 6);
  p.sphere(0.042, '#3b4430', { x, y: 0.275, z, sy: 0.7 }, 8, 6);
  p.box(0.02, 0.02, 0.02, 'team', { x: x - 0.04, y: 0.2, z });
  if (rocket) p.cyl(0.025, 0.025, 0.26, '#4a4f3b', { x: x - 0.01, y: 0.25, z: z + 0.05, rz: Math.PI / 2 }, 8);
  else p.box(0.16, 0.018, 0.018, '#1c1c1c', { x: x + 0.07, y: 0.17, z: z + 0.04 });
}

export function buildUnit(type, owner) {
  const team = teamColors(owner);
  const key = `u:${type}:${owner}`;
  const parts = {};
  let root;
  switch (type) {
    case 'infantry':
    case 'rocketeer': {
      const rocket = type === 'rocketeer';
      root = cached(key, team, (p) => {
        soldier(p, 0.08, 0, rocket);
        soldier(p, -0.1, -0.12, rocket);
        soldier(p, -0.1, 0.12, rocket);
      });
      break;
    }
    case 'truck':
      root = cached(key, team, (p) => {
        p.box(0.78, 0.07, 0.32, '#2e2e2a', { y: 0.12 });
        p.box(0.24, 0.24, 0.34, 'body', { x: 0.27, y: 0.26 });
        p.box(0.1, 0.006, 0.1, 'team', { x: 0.27, y: 0.383 });
        p.box(0.02, 0.1, 0.28, '#9fc6de', { x: 0.39, y: 0.32 });
        p.cyl(0.15, 0.15, 0.48, '#b9bcb5', { x: -0.12, y: 0.3, rz: Math.PI / 2 }, 14);
        p.cyl(0.152, 0.152, 0.04, 'team', { x: -0.12, y: 0.3, rz: Math.PI / 2 }, 14);
        p.cyl(0.04, 0.04, 0.06, '#666', { x: -0.12, y: 0.47 });
        wheels(p, [0.27, -0.05, -0.25], 0.17);
        p.light(0.025, '#fff7cf', { x: 0.4, y: 0.2, z: 0.12 });
        p.light(0.025, '#fff7cf', { x: 0.4, y: 0.2, z: -0.12 });
      });
      break;
    case 'scout':
      root = cached(key, team, (p) => {
        p.box(0.6, 0.12, 0.34, 'body', { y: 0.18 });
        p.box(0.2, 0.08, 0.3, 'body', { x: 0.2, y: 0.27, rz: -0.2 });
        for (const z of [-0.13, 0.13]) {
          p.cyl(0.015, 0.015, 0.3, '#222', { x: -0.03, y: 0.36, z, rz: Math.PI / 2 });
          p.cyl(0.015, 0.015, 0.2, '#222', { x: 0.1, y: 0.3, z, rz: 0.9 });
        }
        wheels(p, [0.2, -0.2], 0.2, 0.09);
      });
      parts.turret = cached(key + ':t', team, (p) => {
        p.cyl(0.06, 0.07, 0.06, '#333', { y: 0.03 });
        p.box(0.24, 0.035, 0.035, '#1c1c1c', { x: 0.12, y: 0.04 });
      });
      parts.turret.position.set(-0.05, 0.36, 0);
      root.add(parts.turret);
      break;
    case 'tank':
    case 'aa':
    case 'artillery': {
      const len = type === 'artillery' ? 1.0 : 0.92;
      root = cached(key, team, (p) => {
        tracks(p, len, 0.46);
        p.box(len * 0.82, 0.16, 0.42, 'body', { y: 0.24 });
        p.add(extrudeOutline([[0, 0], [0.16, 0], [0, 0.14]], 0.42), 'body', { x: len * 0.41, y: 0.17 });
        p.box(0.16, 0.05, 0.3, '#3a3d33', { x: -len * 0.3, y: 0.34 });
        p.box(0.06, 0.02, 0.43, 'team', { x: -len * 0.12, y: 0.32 });
        p.light(0.02, '#fff7cf', { x: len * 0.5, y: 0.26, z: 0.16 });
        p.light(0.02, '#fff7cf', { x: len * 0.5, y: 0.26, z: -0.16 });
      });
      parts.turret = cached(key + ':t', team, (p) => {
        if (type === 'tank') {
          p.add(extrudeOutline([[-0.22, -0.16], [0.14, -0.16], [0.22, -0.08], [0.22, 0.08], [0.14, 0.16], [-0.22, 0.16]], 0.14).rotateX(Math.PI / 2), 'body', { y: 0.07 });
          p.box(0.08, 0.02, 0.08, 'team', { x: -0.12, y: 0.145 });
          p.cyl(0.03, 0.035, 0.55, '#2d2f29', { x: 0.45, y: 0.06, rz: Math.PI / 2 }, 10);
          p.cyl(0.045, 0.045, 0.08, '#2d2f29', { x: 0.7, y: 0.06, rz: Math.PI / 2 }, 10);
          p.cyl(0.05, 0.05, 0.04, '#3a3d33', { x: -0.06, y: 0.16, z: 0.07 }, 10);
          p.cyl(0.006, 0.006, 0.35, '#111', { x: -0.18, y: 0.3, z: -0.1 }, 4);
        } else if (type === 'aa') {
          p.box(0.3, 0.16, 0.3, 'body', { y: 0.08 });
          for (const z of [-0.1, 0.1]) p.cyl(0.02, 0.02, 0.4, '#222', { x: 0.3, y: 0.18, z, rz: Math.PI / 2 - 0.5 }, 8);
          p.cyl(0.11, 0.11, 0.015, '#ccc', { x: -0.14, y: 0.3, rx: 1.1 }, 14);
          p.cyl(0.012, 0.012, 0.12, '#444', { x: -0.14, y: 0.22 });
          p.box(0.07, 0.02, 0.07, 'team', { x: -0.08, y: 0.165 });
        } else {
          p.box(0.42, 0.22, 0.36, 'body', { x: -0.06, y: 0.11 });
          p.box(0.08, 0.02, 0.08, 'team', { x: -0.18, y: 0.225 });
          p.cyl(0.04, 0.05, 0.85, '#2d2f29', { x: 0.45, y: 0.22, rz: Math.PI / 2 - 0.35 }, 10);
          p.cyl(0.06, 0.06, 0.1, '#2d2f29', { x: 0.82, y: 0.36, rz: Math.PI / 2 - 0.35 }, 10);
        }
      });
      parts.turret.position.set(type === 'artillery' ? -0.12 : -0.02, 0.32, 0);
      root.add(parts.turret);
      break;
    }
    case 'heli':
      root = cached(key, team, (p) => {
        p.sphere(0.2, 'body', { x: 0.08, y: 0, sx: 1.6, sy: 0.85, sz: 0.85 }, 14, 10);
        p.sphere(0.12, '#20323d', { x: 0.28, y: 0.06, sx: 1.2, sy: 0.7, sz: 0.85 }, 10, 6);
        p.cyl(0.05, 0.08, 0.7, 'body', { x: -0.48, y: 0.03, rz: Math.PI / 2 }, 8);
        p.box(0.16, 0.18, 0.02, 'team', { x: -0.8, y: 0.1 });
        p.box(0.12, 0.02, 0.32, 'body', { x: -0.72, y: 0.04 });
        p.box(0.1, 0.03, 0.62, 'teamDark', { x: 0.05, y: -0.04 });
        for (const z of [-0.29, 0.29]) {
          p.cyl(0.04, 0.04, 0.22, '#2a2a2a', { x: 0.05, y: -0.08, z, rz: Math.PI / 2 }, 8);
          p.cyl(0.012, 0.012, 0.55, '#222', { x: 0.02, y: -0.24, z: z * 0.6, rz: Math.PI / 2 }, 4);
        }
        p.box(0.06, 0.08, 0.4, '#333', { x: 0.02, y: -0.18 });
        p.cyl(0.04, 0.05, 0.1, '#333', { x: 0.03, y: 0.2 });
        p.box(0.06, 0.02, 0.06, 'team', { x: 0.0, y: 0.15 });
        p.light(0.02, '#ff3030', { x: -0.86, y: 0.2 });
      });
      parts.rotor = cached(key + ':r', team, (p) => {
        p.box(1.4, 0.012, 0.06, '#1b1b1b', {});
        p.box(0.06, 0.012, 1.4, '#1b1b1b', {});
        // Translucent blur disc.
      });
      parts.rotor.position.set(0.03, 0.26, 0);
      parts.blur = new THREE.Mesh(new THREE.CircleGeometry(0.72, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#222', transparent: true, opacity: 0.18, depthWrite: false }));
      parts.blur.position.set(0.03, 0.255, 0);
      parts.tailRotor = cached(key + ':tr', team, (p) => { p.box(0.02, 0.28, 0.03, '#1b1b1b', {}); });
      parts.tailRotor.position.set(-0.82, 0.1, 0.03);
      root.add(parts.rotor, parts.blur, parts.tailRotor);
      break;
    case 'drone': {
      // Quadcopter with a camera gimbal; the four rotors spin separately.
      const arms = [[0.22, 0.22], [0.22, -0.22], [-0.22, 0.22], [-0.22, -0.22]];
      root = cached(key, team, (p) => {
        p.box(0.26, 0.07, 0.16, 'body', { y: 0.02 });
        p.box(0.2, 0.02, 0.17, 'team', { y: 0.065 });
        p.sphere(0.055, '#1c1c1c', { x: 0.1, y: -0.05 }, 10, 8);
        p.sphere(0.03, '#2f6fa8', { x: 0.145, y: -0.05 }, 8, 6);
        for (const [x, z] of arms) {
          p.box(Math.hypot(x, z) * 1.05, 0.025, 0.035, '#2b2d28', { x: x / 2, y: 0.03, z: z / 2, ry: -Math.atan2(z, x) });
          p.cyl(0.03, 0.03, 0.05, '#333', { x, y: 0.05, z }, 8);
          for (const s of [-1, 1]) p.box(0.012, 0.09, 0.012, '#222', { x: x * 0.5, y: -0.05, z: z * 0.5 + s * 0.01 });
        }
        p.light(0.018, '#3cff6a', { x: 0.13, y: 0.03, z: 0.08 });
        p.light(0.018, '#ff3030', { x: 0.13, y: 0.03, z: -0.08 });
      });
      parts.rotors = arms.map(([x, z], i) => {
        const r = cached(key + ':r', team, (p) => { p.box(0.22, 0.008, 0.03, '#151515', {}); });
        r.position.set(x, 0.085, z);
        r.rotation.y = i * 0.7;
        root.add(r);
        return r;
      });
      break;
    }
    case 'fighter':
      root = cached(key, team, (p) => {
        p.cyl(0.07, 0.09, 0.9, 'body', { x: -0.05, rz: Math.PI / 2 }, 10);
        p.cone(0.07, 0.3, 'body', { x: 0.55, rz: -Math.PI / 2 }, 10);
        p.sphere(0.06, '#1f3a4d', { x: 0.3, y: 0.06, sx: 2.2, sy: 0.9 }, 10, 6);
        p.add(hullFromOutline([[0.15, 0], [-0.3, 0.55], [-0.42, 0.55], [-0.35, 0]], 0.025), 'body', {});
        p.add(hullFromOutline([[0.15, 0], [-0.3, -0.55], [-0.42, -0.55], [-0.35, 0]], 0.025), 'body', {});
        for (const z of [-0.1, 0.1]) p.add(extrudeOutline([[0, 0], [0.2, 0], [0.05, 0.25], [-0.04, 0.25]], 0.02), 'team', { x: -0.48, y: 0.04, z, rx: z * 2 });
        for (const z of [-0.4, 0.4]) p.box(0.08, 0.03, 0.08, 'team', { x: -0.3, y: 0.015, z });
        p.glowBox(0.03, 0.08, 0.08, '#ffb060', { x: -0.51, y: 0 });
      });
      break;
    case 'bomber':
      root = cached(key, team, (p) => {
        p.add(hullFromOutline([[0.75, 0], [0.1, 0.95], [-0.15, 0.95], [-0.35, 0.45], [-0.5, 0.45], [-0.5, -0.45], [-0.35, -0.45], [-0.15, -0.95], [0.1, -0.95]], 0.07), 'body', {});
        p.sphere(0.14, 'body', { x: 0.25, y: 0.03, sx: 3, sy: 0.6 }, 12, 8);
        p.sphere(0.06, '#1f3a4d', { x: 0.55, y: 0.08, sx: 1.8, sy: 0.7 }, 8, 6);
        for (const z of [-0.7, 0.7]) p.box(0.12, 0.08, 0.12, 'team', { x: -0.05, y: 0.04, z });
        for (const z of [-0.2, 0.2]) p.glowBox(0.03, 0.06, 0.1, '#ffb060', { x: -0.51, y: 0.03, z });
      });
      break;
    case 'gunboat':
      root = cached(key, team, (p) => {
        p.add(hullFromOutline([[0.6, 0], [0.32, 0.2], [-0.5, 0.2], [-0.52, 0], [-0.5, -0.2], [0.32, -0.2]], 0.16), '#8c949a', { y: -0.06 });
        p.add(hullFromOutline([[0.58, 0], [0.31, 0.19], [-0.49, 0.19], [-0.49, -0.19], [0.31, -0.19]], 0.02), '#5b6166', { y: 0.11 });
        p.box(0.34, 0.16, 0.26, 'body', { x: -0.08, y: 0.2 });
        p.box(0.03, 0.06, 0.24, '#20323d', { x: 0.1, y: 0.25 });
        p.box(0.08, 0.02, 0.27, 'team', { x: -0.2, y: 0.29 });
        p.cyl(0.01, 0.01, 0.3, '#333', { x: -0.15, y: 0.42 }, 4);
      });
      parts.turret = cached(key + ':t', team, (p) => {
        p.cyl(0.07, 0.08, 0.07, '#5b6166', { y: 0.035 });
        p.box(0.22, 0.03, 0.03, '#222', { x: 0.12, y: 0.04 });
      });
      parts.turret.position.set(0.32, 0.12, 0);
      root.add(parts.turret);
      break;
    case 'destroyer':
      root = cached(key, team, (p) => {
        p.add(hullFromOutline([[1.0, 0], [0.6, 0.27], [-0.8, 0.27], [-0.88, 0.15], [-0.88, -0.15], [-0.8, -0.27], [0.6, -0.27]], 0.22), '#8c949a', { y: -0.08 });
        p.add(hullFromOutline([[0.98, 0], [0.59, 0.26], [-0.86, 0.26], [-0.86, -0.26], [0.59, -0.26]], 0.02), '#5b6166', { y: 0.15 });
        p.box(0.5, 0.2, 0.36, 'body', { x: -0.05, y: 0.26 });
        p.box(0.25, 0.16, 0.28, 'body', { x: 0.05, y: 0.44 });
        p.box(0.03, 0.05, 0.27, '#20323d', { x: 0.18, y: 0.48 });
        p.box(0.08, 0.02, 0.37, 'team', { x: -0.25, y: 0.365 });
        p.cyl(0.015, 0.02, 0.45, '#444', { x: -0.05, y: 0.75 }, 6);
        p.box(0.02, 0.02, 0.24, '#444', { x: -0.05, y: 0.85 });
        p.cyl(0.07, 0.08, 0.18, '#4d5257', { x: -0.4, y: 0.33 }, 10);
        // Vertical launch cells.
        for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) p.box(0.06, 0.02, 0.06, '#2b2f33', { x: -0.62 + i * 0.07, y: 0.17, z: -0.04 + j * 0.08 });
        p.light(0.025, '#ff3030', { x: -0.05, y: 0.99 });
      });
      parts.turret = cached(key + ':t', team, (p) => {
        p.box(0.2, 0.09, 0.18, '#5b6166', { y: 0.045 });
        p.cyl(0.025, 0.03, 0.35, '#222', { x: 0.22, y: 0.05, rz: Math.PI / 2 }, 8);
      });
      parts.turret.position.set(0.56, 0.16, 0);
      parts.radar = cached(key + ':d', team, (p) => { p.box(0.04, 0.08, 0.28, '#ddd', {}); });
      parts.radar.position.set(-0.05, 0.68, 0);
      root.add(parts.turret, parts.radar);
      break;
    default:
      root = cached(key, team, (p) => p.box(0.5, 0.3, 0.5, 'team', { y: 0.15 }));
  }
  const wrap = new THREE.Group();
  wrap.add(root);
  return { root: wrap, body: root, ...parts };
}

// ---------------------------------------------------------- structures

function slab(p, w, d) {
  // Foundation that extends below ground so it sits cleanly on slopes.
  p.box(w + 0.1, 1.2, d + 0.1, '#7d7b72', { y: -0.52 });
  p.box(w, 0.05, d, '#9a978c', { y: 0.1 });
}

function windowsRow(p, x0, x1, y, z, n, rotY = 0) {
  for (let i = 0; i < n; i++) {
    const x = x0 + ((i + 0.5) * (x1 - x0)) / n;
    p.glowBox(0.07, 0.06, 0.01, '#ffe6a0', rotY ? { x: z, y, z: x, ry: rotY } : { x, y, z });
  }
}

export function buildStructure(type, owner, w, h) {
  const team = teamColors(owner);
  const key = `b:${type}:${owner}`;
  const parts = {};
  const W = w, D = h;
  let root;
  switch (type) {
    case 'hq':
      root = cached(key, team, (p) => {
        slab(p, W, D);
        p.box(2.0, 0.6, 1.7, '#a9a596', { x: -0.2, y: 0.42, z: 0.2 });
        p.box(2.04, 0.05, 1.74, '#6d6a60', { x: -0.2, y: 0.72, z: 0.2 });
        p.box(2.06, 0.03, 0.04, 'team', { x: -0.2, y: 0.74, z: 1.07 });
        p.box(1.2, 0.5, 1.1, '#bab6a6', { x: -0.4, y: 0.97, z: 0.25 });
        p.box(1.24, 0.04, 1.14, '#6e6b62', { x: -0.4, y: 1.24, z: 0.25 });
        windowsRow(p, -1.1, 0.7, 0.5, 1.06, 7);
        windowsRow(p, -0.9, 0.1, 1.0, 0.81, 4);
        // Comms tower.
        p.cyl(0.05, 0.08, 1.4, '#7a786f', { x: 0.95, y: 0.8, z: -0.95 }, 6);
        p.light(0.04, '#ff3030', { x: 0.95, y: 1.52, z: -0.95 });
        // Helipad.
        p.cyl(0.42, 0.42, 0.04, '#55574f', { x: 0.85, y: 0.14, z: 0.85 }, 24);
        p.box(0.06, 0.01, 0.34, '#eee', { x: 0.73, y: 0.165, z: 0.85 });
        p.box(0.06, 0.01, 0.34, '#eee', { x: 0.97, y: 0.165, z: 0.85 });
        p.box(0.22, 0.01, 0.06, '#eee', { x: 0.85, y: 0.165, z: 0.85 });
        // Flag.
        p.cyl(0.015, 0.015, 0.9, '#ddd', { x: -1.25, y: 0.55, z: -1.25 }, 6);
        p.box(0.3, 0.18, 0.01, 'team', { x: -1.09, y: 0.9, z: -1.25 });
        // Sandbags / perimeter.
        for (let i = 0; i < 6; i++) p.box(0.4, 0.12, 0.1, '#8a7d5c', { x: -1.25 + i * 0.5, y: 0.17, z: -1.42 });
      });
      parts.dish = cached(key + ':d', team, (p) => {
        p.cyl(0.32, 0.12, 0.08, '#e3e1d8', { rz: 0.9 }, 18);
        p.cyl(0.015, 0.015, 0.2, '#555', { x: 0.1, y: 0.06, rz: 0.9 });
      });
      parts.dish.position.set(-0.4, 1.4, 0.25);
      root.add(parts.dish);
      break;
    case 'refinery':
      root = cached(key, team, (p) => {
        slab(p, W, D);
        for (const [x, z, r, hh] of [[-0.45, -0.4, 0.38, 0.75], [0.45, -0.45, 0.32, 0.6], [-0.45, 0.45, 0.3, 0.55]]) {
          p.cyl(r, r, hh, '#d9d6cc', { x, y: 0.12 + hh / 2, z }, 20);
          p.cyl(r * 0.98, r, 0.06, '#9b988e', { x, y: 0.15 + hh, z }, 20);
          p.cyl(r + 0.005, r + 0.005, 0.06, 'team', { x, y: 0.12 + hh * 0.7, z }, 20);
        }
        p.box(0.5, 0.35, 0.4, '#a9a596', { x: 0.45, y: 0.3, z: 0.45 });
        p.box(0.52, 0.03, 0.42, '#6d6a60', { x: 0.45, y: 0.49, z: 0.45 });
        p.cyl(0.04, 0.04, 1.1, '#6f6c64', { x: 0, y: 0.35, rz: Math.PI / 2 }, 6);
        p.cyl(0.04, 0.04, 1.1, '#6f6c64', { z: 0, y: 0.25, rx: Math.PI / 2 }, 6);
        windowsRow(p, 0.27, 0.63, 0.32, 0.655, 3);
      });
      break;
    case 'barracks':
      root = cached(key, team, (p) => {
        slab(p, W, D);
        // Two quonset huts.
        for (const z of [-0.42, 0.38]) {
          p.add(new THREE.CylinderGeometry(0.32, 0.32, 1.5, 14, 1, false, 0, Math.PI), '#7c805f', { y: 0.12, z, rz: Math.PI / 2, ry: Math.PI / 2 });
          p.box(0.02, 0.18, 0.18, '#3b3d30', { x: 0.75, y: 0.22, z });
          p.box(1.5, 0.03, 0.06, 'team', { y: 0.43, z });
        }
        p.cyl(0.015, 0.015, 0.8, '#ddd', { x: -0.85, y: 0.5, z: 0.85 }, 6);
        p.box(0.26, 0.16, 0.01, 'team', { x: -0.72, y: 0.82, z: 0.85 });
        for (let i = 0; i < 4; i++) p.box(0.3, 0.1, 0.1, '#8a7d5c', { x: -0.6 + i * 0.4, y: 0.17, z: 0.92 });
      });
      break;
    case 'factory':
      root = cached(key, team, (p) => {
        slab(p, W, D);
        p.box(2.4, 0.7, 1.7, '#9a988e', { x: 0, y: 0.47, z: -0.3 });
        // Sawtooth roof.
        for (let i = 0; i < 5; i++) {
          p.add(extrudeOutline([[0, 0], [0.48, 0], [0.48, 0.28]], 1.7), i % 2 ? '#7f7d75' : '#8c8a81', { x: -1.2 + i * 0.48, y: 0.82, z: -0.3 });
          p.glowBox(0.01, 0.2, 1.6, '#cfe6ff', { x: -0.73 + i * 0.48, y: 0.94, z: -0.3 });
        }
        p.box(2.42, 0.06, 1.72, '#77746a', { y: 0.55, z: -0.3 });
        p.box(2.44, 0.03, 0.04, 'team', { y: 0.56, z: 0.56 });
        p.cyl(0.015, 0.015, 0.8, '#ddd', { x: -1.3, y: 0.5, z: 0.75 }, 6);
        p.box(0.26, 0.16, 0.01, 'team', { x: -1.17, y: 0.82, z: 0.75 });
        // Garage doors.
        for (const x of [-0.6, 0.4]) {
          p.box(0.7, 0.5, 0.02, '#3c3e38', { x, y: 0.38, z: 0.56 });
          for (let k = 0; k < 5; k++) p.box(0.7, 0.01, 0.025, '#55574f', { x, y: 0.18 + k * 0.1, z: 0.56 });
        }
        // Chimneys.
        p.cyl(0.11, 0.14, 1.1, '#6e6a62', { x: 1.15, y: 0.95, z: -1.0 }, 12);
        p.cyl(0.115, 0.115, 0.08, 'team', { x: 1.15, y: 1.35, z: -1.0 }, 12);
        p.cyl(0.08, 0.1, 0.8, '#6e6a62', { x: 0.85, y: 0.8, z: -1.1 }, 12);
        // Crane rail over the yard.
        p.box(0.06, 0.5, 0.06, '#d1a43a', { x: -1.3, y: 0.37, z: 1.2 });
        p.box(0.06, 0.5, 0.06, '#d1a43a', { x: 1.3, y: 0.37, z: 1.2 });
        p.box(2.66, 0.06, 0.08, '#d1a43a', { y: 0.63, z: 1.2 });
      });
      parts.smoke = [new THREE.Vector3(1.15, 1.45, -1.0), new THREE.Vector3(0.85, 1.25, -1.1)];
      break;
    case 'airfield':
      // Long east-west strip: runway along the south edge, hangars, tower
      // and fuel along the north apron. Footprint is 6 x 2 tiles.
      root = cached(key, team, (p) => {
        slab(p, W, D);
        const L = W - 0.2;
        // Runway with centre-line dashes, threshold stripes and edge lights.
        p.box(L, 0.02, 0.86, '#353633', { y: 0.13, z: 0.46 });
        for (let i = 0; i < 12; i++) p.box(0.24, 0.005, 0.035, '#e8e8e2', { x: -L / 2 + 0.55 + i * ((L - 1.1) / 11), y: 0.142, z: 0.46 });
        for (const end of [-1, 1]) {
          for (let k = 0; k < 6; k++) p.box(0.2, 0.005, 0.05, '#e8e8e2', { x: end * (L / 2 - 0.16), y: 0.142, z: 0.16 + k * 0.12 });
          p.box(0.04, 0.005, 0.8, '#e8e8e2', { x: end * (L / 2 - 0.34), y: 0.142, z: 0.46 });
        }
        for (let i = 0; i <= 14; i++) {
          const x = -L / 2 + (i * L) / 14;
          p.light(0.022, '#7fd0ff', { x, y: 0.16, z: 0.05 });
          p.light(0.022, '#7fd0ff', { x, y: 0.16, z: 0.87 });
        }
        for (const end of [-1, 1]) for (let k = 0; k < 4; k++) p.light(0.024, end < 0 ? '#5dff7a' : '#ff5a4f', { x: end * (L / 2 + 0.02), y: 0.16, z: 0.2 + k * 0.17 });
        // Taxiway linking the apron to the runway.
        p.box(3.9, 0.015, 0.22, '#55574f', { x: -0.6, y: 0.13, z: -0.12 });
        p.box(0.22, 0.015, 0.3, '#55574f', { x: -2.4, y: 0.13, z: 0.05 });
        p.box(0.22, 0.015, 0.3, '#55574f', { x: 1.2, y: 0.13, z: 0.05 });
        for (let i = 0; i < 9; i++) p.box(0.16, 0.004, 0.02, '#e0b030', { x: -2.4 + i * 0.45, y: 0.14, z: -0.12 });
        // Two arched hangars with doors facing the runway.
        for (const x of [-2.25, -1.25]) {
          p.add(new THREE.CylinderGeometry(0.4, 0.4, 0.66, 18, 1, false, 0, Math.PI), '#8b8d86', { x, y: 0.12, z: -0.6, rz: Math.PI / 2, ry: Math.PI / 2 });
          p.box(0.06, 0.03, 0.68, 'team', { x, y: 0.53, z: -0.6 });
          p.box(0.62, 0.32, 0.02, '#2e302b', { x, y: 0.28, z: -0.26 });
          p.box(0.66, 0.03, 0.03, 'team', { x, y: 0.45, z: -0.26 });
        }
        // Control tower.
        p.box(0.5, 0.3, 0.4, '#a9a596', { x: 0.25, y: 0.27, z: -0.66 });
        windowsRow(p, 0.05, 0.45, 0.3, -0.455, 3);
        p.cyl(0.1, 0.13, 0.75, '#bdb9aa', { x: 0.55, y: 0.5, z: -0.7 }, 10);
        p.cyl(0.22, 0.18, 0.18, '#203646', { x: 0.55, y: 0.95, z: -0.7 }, 10);
        p.glowBox(0.27, 0.05, 0.27, '#9fd4ff', { x: 0.55, y: 0.95, z: -0.7 });
        p.cyl(0.24, 0.24, 0.04, 'team', { x: 0.55, y: 1.06, z: -0.7 }, 10);
        p.light(0.032, '#ff3030', { x: 0.55, y: 1.13, z: -0.7 });
        // Fuel farm.
        for (const [x, z] of [[1.45, -0.72], [1.85, -0.72]]) {
          p.cyl(0.16, 0.16, 0.3, '#d9d6cc', { x, y: 0.27, z }, 16);
          p.cyl(0.165, 0.165, 0.04, 'team', { x, y: 0.33, z }, 16);
        }
        // Radar mast and windsock.
        p.cyl(0.03, 0.04, 0.6, '#77756c', { x: 2.55, y: 0.42, z: -0.7 }, 6);
        p.cyl(0.012, 0.012, 0.4, '#ddd', { x: 2.75, y: 0.32, z: -0.05 }, 4);
        p.cone(0.04, 0.18, '#ff7a1a', { x: 2.84, y: 0.49, z: -0.05, rz: Math.PI / 2 }, 8);
      });
      parts.dish = cached(key + ':d', team, (p) => {
        p.cyl(0.18, 0.08, 0.05, '#e3e1d8', { rz: 1.1 }, 14);
        p.box(0.04, 0.06, 0.04, '#555', { y: -0.04 });
      });
      parts.dish.position.set(2.55, 0.78, -0.7);
      root.add(parts.dish);
      break;
    case 'shipyard':
      root = cached(key, team, (p) => {
        slab(p, W, D);
        // Dry dock basin.
        p.box(2.0, 0.04, 1.0, '#2b5a72', { x: 0.2, y: 0.125, z: 0.4 });
        p.box(2.1, 0.12, 0.08, '#77756c', { x: 0.2, y: 0.17, z: -0.12 });
        p.box(2.1, 0.12, 0.08, '#77756c', { x: 0.2, y: 0.17, z: 0.92 });
        // Warehouse.
        p.box(1.0, 0.5, 0.7, '#a2a094', { x: -0.9, y: 0.37, z: -0.85 });
        p.box(1.02, 0.04, 0.72, '#6d6a60', { x: -0.9, y: 0.6, z: -0.85 });
        p.box(1.04, 0.03, 0.03, 'team', { x: -0.9, y: 0.61, z: -0.49 });
        windowsRow(p, -1.3, -0.5, 0.4, -0.495, 4);
        // Gantry crane.
        for (const z of [-0.2, 1.0]) p.box(0.08, 1.2, 0.08, '#d1a43a', { x: 0.9, y: 0.72, z });
        p.box(0.1, 0.1, 1.3, '#d1a43a', { x: 0.9, y: 1.3, z: 0.4 });
        p.box(1.4, 0.08, 0.08, '#d1a43a', { x: 0.4, y: 1.32, z: 0.4 });
        p.cyl(0.01, 0.01, 0.8, '#333', { x: 0.0, y: 0.9, z: 0.4 }, 4);
      });
      break;
    case 'depot':
      root = cached(key, team, (p) => {
        slab(p, W, D);
        // Open-fronted service bay.
        p.box(1.2, 0.5, 0.06, '#9a988e', { x: -0.15, y: 0.37, z: -0.72 });
        p.box(0.06, 0.5, 0.9, '#9a988e', { x: -0.72, y: 0.37, z: -0.3 });
        p.box(0.06, 0.5, 0.9, '#9a988e', { x: 0.42, y: 0.37, z: -0.3 });
        p.box(1.26, 0.05, 1.0, '#7f7d75', { x: -0.15, y: 0.64, z: -0.28 });
        p.box(1.27, 0.06, 0.04, 'team', { x: -0.15, y: 0.6, z: 0.2 });
        // Vehicle lift with hazard stripes.
        p.box(0.9, 0.04, 0.5, '#3c3e38', { x: -0.15, y: 0.14, z: -0.3 });
        for (let i = 0; i < 5; i++) p.box(0.08, 0.005, 0.5, i % 2 ? '#222' : '#e0b030', { x: -0.5 + i * 0.18, y: 0.165, z: 0.02, sz: 0.1 });
        for (const x of [-0.5, 0.2]) p.box(0.05, 0.22, 0.05, '#d1a43a', { x, y: 0.25, z: -0.3 });
        // Wrench sign on the roof.
        p.box(0.06, 0.26, 0.02, 'team', { x: -0.15, y: 0.82, z: 0.18, rz: 0.6 });
        p.cyl(0.07, 0.07, 0.02, 'team', { x: -0.08, y: 0.93, z: 0.18, rx: Math.PI / 2 }, 10);
        // Drums and tyres around the yard.
        for (const [x, z] of [[0.75, 0.6], [0.62, 0.72], [0.78, 0.38]]) p.cyl(0.07, 0.07, 0.18, '#3f6b8a', { x, y: 0.21, z }, 10);
        for (let i = 0; i < 3; i++) p.cyl(0.1, 0.1, 0.05, '#1c1c1c', { x: -0.72, y: 0.15 + i * 0.05, z: 0.68 }, 12);
      });
      // Crane arm that swings while repairing.
      parts.crane = cached(key + ':c', team, (p) => {
        p.cyl(0.05, 0.06, 0.6, '#d1a43a', { y: 0.3 }, 8);
        p.box(0.7, 0.05, 0.05, '#d1a43a', { x: -0.3, y: 0.6 });
        p.cyl(0.006, 0.006, 0.3, '#222', { x: -0.6, y: 0.45 }, 4);
        p.box(0.06, 0.04, 0.06, '#333', { x: -0.6, y: 0.3 });
      });
      parts.crane.position.set(0.72, 0.12, -0.6);
      root.add(parts.crane);
      break;
    case 'turret':
      root = cached(key, team, (p) => {
        slab(p, W, D);
        p.cyl(0.4, 0.46, 0.25, '#8c897e', { y: 0.24 }, 10);
        p.cyl(0.41, 0.41, 0.04, '#77746a', { y: 0.36 }, 10);
        p.cyl(0.415, 0.415, 0.02, 'team', { y: 0.33 }, 10);
        for (let i = 0; i < 8; i++) p.box(0.14, 0.1, 0.1, '#8a7d5c', { x: Math.cos((i / 8) * 6.28) * 0.47, y: 0.16, z: Math.sin((i / 8) * 6.28) * 0.47, ry: -(i / 8) * 6.28 });
      });
      parts.turret = cached(key + ':t', team, (p) => {
        p.sphere(0.24, 'body', { sy: 0.6 }, 12, 8);
        p.cyl(0.035, 0.04, 0.5, '#2d2f29', { x: 0.32, y: 0.04, rz: Math.PI / 2 }, 8);
        p.box(0.1, 0.02, 0.3, 'team', { x: -0.05, y: 0.14 });
      });
      parts.turret.position.set(0, 0.42, 0);
      root.add(parts.turret);
      break;
    case 'samsite':
      root = cached(key, team, (p) => {
        slab(p, W, D);
        p.cyl(0.38, 0.44, 0.18, '#8c897e', { y: 0.2 }, 10);
        p.cyl(0.39, 0.39, 0.04, '#77746a', { y: 0.29 }, 10);
        p.cyl(0.395, 0.395, 0.02, 'team', { y: 0.26 }, 10);
      });
      parts.turret = cached(key + ':t', team, (p) => {
        p.cyl(0.12, 0.14, 0.12, '#55574f', { y: 0.06 });
        p.box(0.3, 0.2, 0.42, 'body', { y: 0.25, rz: 0.5 });
        for (const z of [-0.12, 0.12]) for (const y of [0.17, 0.33]) p.glowBox(0.02, 0.06, 0.06, '#ff6040', { x: 0.13 + (y - 0.17) * 0.5, y: y + 0.07, z });
        p.box(0.32, 0.02, 0.43, 'team', { y: 0.36, rz: 0.5, x: -0.05 });
      });
      parts.turret.position.set(0, 0.3, 0);
      root.add(parts.turret);
      break;
    default:
      root = cached(key, team, (p) => { slab(p, W, D); p.box(W * 0.8, 0.6, D * 0.8, 'team', { y: 0.4 }); });
  }
  const wrap = new THREE.Group();
  wrap.add(root);
  return { root: wrap, body: root, ...parts };
}

// Gabled roof: a triangular prism spanning `len` along X.
function gable(width, height, len) {
  return extrudeOutline([[-width / 2, 0], [width / 2, 0], [0, height]], len).rotateY(Math.PI / 2);
}

// Civilian scenery. Neutral colours; footprint centred on the origin.
export function buildProp(kind) {
  const team = teamColors(0);
  const parts = {};
  let root;
  switch (kind) {
    case 'house':
      root = cached('prop:house', team, (p) => {
        p.box(0.95, 0.03, 0.95, '#7d6a4c', { y: 0.015 });
        p.box(0.62, 0.34, 0.44, '#d8ccb0', { y: 0.2 });
        p.add(gable(0.54, 0.26, 0.7), '#4b4038', { y: 0.37 });
        p.box(0.08, 0.2, 0.08, '#8a4b35', { x: 0.18, y: 0.6, z: -0.08 });
        p.box(0.09, 0.17, 0.01, '#4a3526', { x: -0.12, y: 0.12, z: 0.225 });
        for (const x of [0.08, 0.22]) p.box(0.08, 0.08, 0.01, '#33414a', { x, y: 0.24, z: 0.225 });
        for (const x of [-0.18, 0.12]) p.box(0.08, 0.08, 0.01, '#33414a', { x, y: 0.24, z: -0.225 });
        // Picket fence along the front.
        for (let i = 0; i < 9; i++) p.box(0.02, 0.09, 0.02, '#e6e0d0', { x: -0.42 + i * 0.105, y: 0.06, z: 0.44 });
        p.box(0.86, 0.015, 0.015, '#e6e0d0', { y: 0.08, z: 0.44 });
      });
      break;
    case 'barn':
      root = cached('prop:barn', team, (p) => {
        p.box(1.9, 0.03, 0.95, '#7d6a4c', { y: 0.015 });
        p.box(1.5, 0.42, 0.66, '#7c3a28', { y: 0.24 });
        p.add(gable(0.76, 0.3, 1.56), '#5a5650', { y: 0.45 });
        p.box(0.34, 0.32, 0.01, '#5e2a1d', { x: -0.3, y: 0.2, z: 0.335 });
        p.box(0.34, 0.015, 0.012, '#eee', { x: -0.3, y: 0.36, z: 0.338 });
        p.box(0.015, 0.32, 0.012, '#eee', { x: -0.3, y: 0.2, z: 0.338 });
        // Hay bales and a water trough.
        for (const [x, z] of [[0.5, 0.42], [0.66, 0.4], [0.58, 0.48]]) p.cyl(0.07, 0.07, 0.1, '#c9a856', { x, y: 0.07, z, rx: Math.PI / 2 }, 10);
        p.box(0.22, 0.06, 0.08, '#6a5a45', { x: 0.82, y: 0.06, z: -0.2 });
      });
      break;
    case 'silo':
      root = cached('prop:silo', team, (p) => {
        p.box(0.9, 0.03, 0.9, '#7d6a4c', { y: 0.015 });
        p.cyl(0.2, 0.2, 0.9, '#b8b3a7', { x: -0.1, y: 0.47, z: -0.1 }, 16);
        p.sphere(0.2, '#9d988c', { x: -0.1, y: 0.92, z: -0.1, sy: 0.6 }, 16, 8);
        for (let i = 0; i < 4; i++) p.cyl(0.203, 0.203, 0.015, '#8a867c', { x: -0.1, y: 0.2 + i * 0.2, z: -0.1 }, 16);
        p.box(0.3, 0.22, 0.28, '#8f8a7c', { x: 0.24, y: 0.13, z: 0.2 });
        p.add(gable(0.32, 0.1, 0.34), '#5a5650', { x: 0.24, y: 0.24, z: 0.2 });
      });
      break;
    case 'windmill':
    default:
      root = cached('prop:windmill', team, (p) => {
        p.box(0.95, 0.03, 0.95, '#7d6a4c', { y: 0.015 });
        p.cyl(0.18, 0.3, 1.0, '#8d8070', { y: 0.52 }, 8);
        p.cyl(0.19, 0.19, 0.04, '#5b4a3a', { y: 0.42 }, 8);
        p.cone(0.24, 0.26, '#4b4038', { y: 1.15 }, 8);
        p.box(0.09, 0.16, 0.01, '#4a3526', { y: 0.1, z: 0.29 });
        p.box(0.07, 0.07, 0.01, '#33414a', { y: 0.62, z: 0.23 });
      });
      // Four lattice sails on a hub facing +Z.
      parts.sails = cached('prop:windmill:sails', team, (p) => {
        p.cyl(0.04, 0.04, 0.12, '#3d3226', { rx: Math.PI / 2 }, 8);
        for (let k = 0; k < 4; k++) {
          const a = (k * Math.PI) / 2;
          const cx = Math.cos(a), cy = Math.sin(a);
          p.box(0.025, 0.62, 0.02, '#5a4632', { x: cx * 0.31, y: cy * 0.31, rz: a - Math.PI / 2 });
          p.box(0.12, 0.48, 0.008, '#d8cfb8', { x: cx * 0.36 - cy * 0.07, y: cy * 0.36 + cx * 0.07, rz: a - Math.PI / 2 });
        }
      });
      parts.sails.position.set(0, 1.0, 0.27);
      root.add(parts.sails);
  }
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, ...parts };
}

// Oil well pumpjack (neutral) with an animated beam.
export function buildWell() {
  const team = teamColors(0);
  const base = cached('well', team, (p) => {
    p.cyl(0.42, 0.48, 0.05, '#1c1915', { y: 0.02 }, 16);
    p.box(0.7, 0.06, 0.2, '#4b4740', { y: 0.06 });
    p.add(extrudeOutline([[-0.12, 0], [0.12, 0], [0.02, 0.48], [-0.02, 0.48]], 0.14), '#3d3a35', { y: 0.06 });
    p.cyl(0.08, 0.08, 0.12, '#8a5a2a', { x: 0.24, y: 0.15, rx: Math.PI / 2 });
    p.cyl(0.03, 0.03, 0.2, '#333', { x: -0.3, y: 0.15 }, 6);
  });
  const beam = cached('well:beam', team, (p) => {
    p.box(0.7, 0.05, 0.05, '#d9a12b', {});
    p.box(0.08, 0.16, 0.1, '#d9a12b', { x: -0.36, y: -0.04 });
  });
  beam.position.set(0, 0.55, 0);
  base.add(beam);
  return { root: base, beam };
}
