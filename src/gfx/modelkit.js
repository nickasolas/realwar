import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FACTIONS } from '../config.js';

// Shared toolkit for the procedural models: materials, a surface shader that
// gives each part a material look (camouflage paint, concrete, corrugated
// metal, canvas, track links, glass), and geometry helpers.
//
// Static parts of each model are merged into one vertex-coloured mesh (one
// draw call); moving parts are separate children. Models face +X; one tile is
// one unit. Every vertex carries a `surf` id that selects its surface pattern.

export const SURF = { plain: 0, paint: 1, concrete: 2, metal: 3, canvas: 4, track: 5, glass: 6, rubber: 7 };

export const materials = {
  body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1 }),
  glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
};

// Patterns are computed in model space so they stick to a vehicle as it
// moves and turns. All noise is procedural; there are no texture files.
materials.body.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      attribute float surf;
      varying float vSurf;
      varying vec3 vObj;
      varying vec3 vObjN;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vSurf = surf;
      vObj = position;
      vObjN = normal;`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      varying float vSurf;
      varying vec3 vObj;
      varying vec3 vObjN;
      float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float vn(vec3 x) {
        vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
      }
      // 2D coordinates on the plane facing the dominant normal axis.
      vec2 planar(vec3 p, vec3 n) { vec3 a = abs(n); return a.x > a.y && a.x > a.z ? p.zy : (a.y > a.z ? p.xz : p.xy); }
      float grid(vec2 uv, float s) { vec2 g = abs(fract(uv / s) - 0.5) * 2.0; return smoothstep(0.9, 0.98, max(g.x, g.y)); }`)
    .replace('#include <color_fragment>', `#include <color_fragment>
      int sType = int(vSurf + 0.5);
      vec2 pl = planar(vObj, vObjN);
      float m = 1.0;
      if (sType == 1) {
        // Three-tone camouflage, panel seams and fine speckle.
        float c1 = vn(vObj * 6.5), c2 = vn(vObj * 5.5 + 17.0);
        vec3 tone = c1 > 0.62 ? vec3(0.62, 0.6, 0.52) : (c2 > 0.64 ? vec3(1.14, 1.1, 0.96) : vec3(1.0));
        diffuseColor.rgb *= tone;
        m *= 1.0 - 0.1 * grid(pl, 0.23);
        m *= 0.93 + 0.12 * vn(vObj * 90.0);
      } else if (sType == 2) {
        // Concrete: slab joints, grain, stains and rain streaks.
        m *= 0.84 + 0.22 * vn(vObj * 2.5);
        m *= 0.9 + 0.16 * vn(vObj * 70.0);
        m *= 1.0 - 0.22 * grid(pl, 0.5);
        if (abs(vObjN.y) < 0.5) m *= 0.9 + 0.12 * vn(vec3(vObj.x * 9.0, vObj.y * 0.7, vObj.z * 9.0));
      } else if (sType == 3) {
        // Corrugated sheet metal with rust runs.
        m *= 0.84 + 0.16 * (0.5 + 0.5 * sin(pl.x * 150.0));
        float rust = smoothstep(0.62, 0.8, vn(vec3(vObj.x * 7.0, vObj.y * 1.6, vObj.z * 7.0)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.25, 0.14), rust * 0.55);
        m *= 0.94 + 0.1 * vn(vObj * 60.0);
      } else if (sType == 4) {
        // Canvas: tight weave and soft folds.
        m *= 0.92 + 0.14 * vn(vObj * 140.0);
        m *= 0.84 + 0.24 * vn(vObj * 5.0);
      } else if (sType == 5) {
        // Track links.
        m *= 0.6 + 0.4 * step(0.45, fract(vObj.x * 48.0));
        m *= 0.85 + 0.2 * vn(vObj * 80.0);
      } else if (sType == 6) {
        // Glass: sky reflection on upward faces.
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.68, 0.78), clamp(vObjN.y, 0.0, 1.0) * 0.5);
      } else if (sType == 7) {
        m *= 0.85 + 0.2 * vn(vObj * 50.0);
      } else {
        m *= 0.93 + 0.1 * vn(vObj * 40.0);
      }
      // Dust and grime collect low down.
      if (sType != 6) m *= 0.84 + 0.16 * smoothstep(0.0, 0.3, vObj.y);
      diffuseColor.rgb *= m;`)
    .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      metalnessFactor = sType == 3 ? 0.45 : (sType == 1 ? 0.2 : (sType == 6 ? 0.3 : 0.02));`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = sType == 6 ? 0.12 : (sType == 3 ? 0.5 : (sType == 1 ? 0.62 : (sType == 7 ? 0.95 : 0.88)));`);
};
materials.body.customProgramCacheKey = () => 'surf-v2';

// Military paint per faction: desert tan for the Coalition, olive drab for
// the Liberation Front. Bright team colour is kept to small markings.
const PAINT = [
  { body: '#a89d76', dark: '#6e6650' },
  { body: '#5f6a41', dark: '#3c4430' },
];

export function teamColors(owner) {
  const f = FACTIONS[owner] || FACTIONS[0];
  const paint = PAINT[owner] || PAINT[0];
  return { accent: new THREE.Color(f.color), body: new THREE.Color(paint.body), dark: new THREE.Color(paint.dark) };
}

// Common colours.
export const C = {
  steel: '#55584f', gunmetal: '#2f312c', rubber: '#1e1e1c', track: '#3a3832', glass: '#26353f',
  concrete: '#a3a093', concreteDark: '#7e7b70', sandbag: '#9c8b62', canvas: '#8d8763', tin: '#8a8c86',
  rust: '#7a5236', wood: '#6b5034', white: '#e4e2da', red: '#b03a2e', yellow: '#d6a531', light: '#fff2c6',
};

const geoCache = new Map();

export class Parts {
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

  // o: position x/y/z, rotation rx/ry/rz, scale sx/sy/sz, surf name.
  add(geo, color, o = {}, glow = false) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
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
    const surf = o.surf ?? (color === 'body' || color === 'teamDark' ? 'paint' : 'plain');
    g.setAttribute('surf', new THREE.BufferAttribute(new Float32Array(n).fill(SURF[surf]), 1));
    if (g.attributes.uv) g.deleteAttribute('uv');
    if (g.attributes.uv1) g.deleteAttribute('uv1');
    (glow ? this.glow : this.list).push(g);
    return this;
  }

  box(w, h, d, color, o) { return this.add(new THREE.BoxGeometry(w, h, d), color, o); }
  // Box with chamfered edges that catch the light.
  cbox(w, h, d, color, o, bevel = 0.012) {
    const b = Math.min(bevel, w / 4, h / 4, d / 4);
    return this.add(bevelExtrude([[-w / 2 + b, -h / 2 + b], [w / 2 - b, -h / 2 + b], [w / 2 - b, h / 2 - b], [-w / 2 + b, h / 2 - b]], d, b), color, o);
  }
  cyl(rt, rb, h, color, o, seg = 14) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, o); }
  sphere(r, color, o, ws = 14, hs = 10) { return this.add(new THREE.SphereGeometry(r, ws, hs), color, o); }
  cone(r, h, color, o, seg = 12) { return this.add(new THREE.ConeGeometry(r, h, seg), color, o); }
  // Side profile (x forward, y up) extruded across `width` along Z.
  profile(points, width, color, o, bevel = 0.01) { return this.add(bevelExtrude(points, width, bevel), color, o); }
  // Top-view outline (x forward, y = z) extruded upward by `height`.
  plan(points, height, color, o, bevel = 0.006) { return this.add(planExtrude(points, height, bevel), color, o); }
  light(r, color, o) { return this.add(new THREE.SphereGeometry(r, 6, 4), color, o, true); }
  glowBox(w, h, d, color, o) { return this.add(new THREE.BoxGeometry(w, h, d), color, o, true); }

  // A thin rod between two points.
  rod(a, b, r, color, o = {}) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const g = new THREE.CylinderGeometry(r, r, len, 5);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
    g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    return this.add(g, color, o);
  }

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
export function cached(key, team, fn) {
  if (geoCache.has(key)) return new Parts(team).build(key);
  const p = new Parts(team);
  fn(p);
  return p.build(key);
}

// ------------------------------------------------------------- geometry

// XY polygon extruded along Z, centred on Z, with optional chamfer.
export function bevelExtrude(points, depth, bevel = 0) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const b = Math.max(0, Math.min(bevel, depth / 3));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, depth - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: 10,
  });
  g.translate(0, 0, -depth / 2 + b);
  return g;
}

// Top-view outline (points as [x, z]) extruded up from y = 0 to `height`.
export function planExtrude(points, height, bevel = 0) {
  return bevelExtrude(points.map(([x, z]) => [x, -z]), height, bevel).rotateX(-Math.PI / 2).translate(0, height / 2, 0);
}

export function extrudeOutline(points, depth) {
  return bevelExtrude(points, depth, 0);
}

// Gabled roof: a triangular prism spanning `len` along X.
export function gable(width, height, len) {
  return bevelExtrude([[-width / 2, 0], [width / 2, 0], [0, height]], len, 0).rotateY(Math.PI / 2);
}

// Rounded loop for a tank track, length along X.
export function trackLoop(len, height, width) {
  const r = height / 2;
  const s = new THREE.Shape();
  s.moveTo(-len / 2 + r, -r);
  s.lineTo(len / 2 - r, -r);
  s.absarc(len / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(-len / 2 + r, r);
  s.absarc(-len / 2 + r, 0, r, Math.PI / 2, Math.PI * 1.5, false);
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -width / 2);
  return g;
}
