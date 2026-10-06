import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Terrain } from '../config.js';
import { createRng } from '../rng.js';
import { RES, WATER_LEVEL } from './heightfield.js';

// ----------------------------------------------------------- fog of war

// Shared uniforms so every patched material samples the same texture.
export const fowUniforms = {
  fowTex: { value: null },
  fowSize: { value: new THREE.Vector2(1, 1) },
  fowEnabled: { value: 1 },
  time: { value: 0 },
};

// Darken unexplored/remembered areas in any lit material. Works with
// instancing. `extraFragment` lets callers append more shader code.
export function patchFow(material, { clouds = true } = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fowUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFowXZ;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 fowWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fowWp = instanceMatrix * fowWp;
        #endif
        fowWp = modelMatrix * fowWp;
        vFowXZ = fowWp.xz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vFowXZ;
        uniform sampler2D fowTex;
        uniform vec2 fowSize;
        uniform float fowEnabled;
        uniform float time;
        float cloudNoise(vec2 p) {
          return sin(p.x * 0.11 + time * 0.05) * sin(p.y * 0.13 - time * 0.04) * 0.5
               + sin(p.x * 0.23 - p.y * 0.17 + time * 0.07) * 0.25;
        }`)
      .replace('#include <fog_fragment>', `
        ${clouds ? '// Drifting cloud shadows.\n        gl_FragColor.rgb *= 0.9 + 0.1 * smoothstep(-0.4, 0.4, cloudNoise(vFowXZ));' : ''}
        if (fowEnabled > 0.5) {
          float fv = texture2D(fowTex, vFowXZ / fowSize).r;
          vec3 grey = vec3(dot(gl_FragColor.rgb, vec3(0.3, 0.59, 0.11)));
          vec3 remembered = mix(gl_FragColor.rgb, grey, 0.55) * 0.45;
          // Unexplored land sits under a drifting layer of cloud.
          float cl = cloudNoise(vFowXZ * 2.3) + 0.5 * cloudNoise(vFowXZ * 5.1 + 17.0);
          vec3 hidden = mix(vec3(0.035, 0.045, 0.06), vec3(0.11, 0.125, 0.15), smoothstep(-0.6, 0.6, cl));
          gl_FragColor.rgb = fv < 0.5 ? mix(hidden, remembered, fv * 2.0) : mix(remembered, gl_FragColor.rgb, fv * 2.0 - 1.0);
        }
        #include <fog_fragment>`);
  };
  material.customProgramCacheKey = () => 'fow' + (clouds ? 'c' : '');
  return material;
}

export class FogOfWar {
  constructor(map) {
    this.w = map.w; this.h = map.h;
    this.data = new Uint8Array(map.w * map.h * 4);
    this.tex = new THREE.DataTexture(this.data, map.w, map.h, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    // Smoothed values so revealed areas fade in rather than pop.
    this.current = new Float32Array(map.w * map.h);
    fowUniforms.fowTex.value = this.tex;
    fowUniforms.fowSize.value.set(map.w, map.h);
  }

  update(player, dt) {
    const k = Math.min(1, dt * 6);
    for (let i = 0; i < this.current.length; i++) {
      const target = player.visible[i] ? 1 : player.explored[i] ? 0.5 : 0;
      const c = this.current[i] += (target - this.current[i]) * k;
      this.data[i * 4] = Math.round(c * 255);
    }
    this.tex.needsUpdate = true;
  }
}

// ------------------------------------------------------- procedural textures

function tileableNoiseCanvas(size, seed, octaves = 5) {
  const rng = createRng(seed);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const layers = [];
  for (let o = 0; o < octaves; o++) {
    const n = 4 << o;
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = rng.next();
    layers.push({ n, g });
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0, amp = 0.5, norm = 0;
      for (const { n, g } of layers) {
        const fx = (x / size) * n, fy = (y / size) * n;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const at = (a, b) => g[(b % n) * n + (a % n)];
        const a = at(x0, y0), b = at(x0 + 1, y0), cc = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
        v += (a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy) * amp;
        norm += amp; amp *= 0.55;
      }
      v /= norm;
      const i = (y * size + x) * 4;
      const g8 = Math.round(170 + (v - 0.5) * 150);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = g8;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function waterNormalCanvas(size) {
  // Sum of integer-frequency waves so the texture tiles seamlessly.
  const waves = [[3, 1, 0.5], [-2, 4, 0.35], [5, -3, 0.2], [1, 7, 0.15], [8, 5, 0.1], [-9, 2, 0.08]];
  const hgt = (x, y) => {
    let h = 0;
    for (const [a, b, amp] of waves) h += Math.sin(((a * x + b * y) / size) * Math.PI * 2 + a * 1.7) * amp;
    return h;
  };
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = hgt(x + 1, y) - hgt(x - 1, y), dy = hgt(x, y + 1) - hgt(x, y - 1);
      const nx = -dx * 6, ny = -dy * 6, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      img.data[i] = ((nx / l) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// --------------------------------------------------------------- terrain

const C = (hex) => new THREE.Color(hex);
const PALETTE = {
  deep: C('#1d3b4f'), shallow: C('#3f8a8a'), sand: C('#d8c48e'), wetSand: C('#a99561'),
  grass: C('#6f9a43'), grassDry: C('#9da653'), grassLush: C('#4f8236'), forest: C('#3f6a2c'),
  rock: C('#8b8375'), rockDark: C('#5f584e'), cliff: C('#7a6f60'), peak: C('#c9c4b8'),
};

export function buildTerrain(map, hf, seed) {
  const { vw, vh, heights } = hf;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(vw * vh * 3);
  const uv = new Float32Array(vw * vh * 2);
  for (let j = 0; j < vh; j++) {
    for (let i = 0; i < vw; i++) {
      const k = j * vw + i;
      pos[k * 3] = i / RES;
      pos[k * 3 + 1] = heights[k];
      pos[k * 3 + 2] = j / RES;
      uv[k * 2] = i / RES / 2.5;
      uv[k * 2 + 1] = j / RES / 2.5;
    }
  }
  const idx = new Uint32Array((vw - 1) * (vh - 1) * 6);
  let p = 0;
  for (let j = 0; j < vh - 1; j++) {
    for (let i = 0; i < vw - 1; i++) {
      const a = j * vw + i, b = a + 1, c = a + vw, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b;
      idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();

  // Vertex colours from terrain type, height, slope and patchy noise.
  const nrm = geo.attributes.normal.array;
  const col = new Float32Array(vw * vh * 3);
  const rng = createRng(seed + 99);
  const patch = makePatchNoise(seed);
  const tmp = new THREE.Color();
  for (let j = 0; j < vh; j++) {
    for (let i = 0; i < vw; i++) {
      const k = j * vw + i;
      const h = heights[k];
      const slope = 1 - nrm[k * 3 + 1];
      const tx = Math.min(map.w - 1, Math.floor(i / RES)), ty = Math.min(map.h - 1, Math.floor(j / RES));
      const t = map.get(tx, ty);
      const n = patch(i / RES, j / RES);
      if (h < -0.05) {
        tmp.copy(PALETTE.wetSand).lerp(PALETTE.shallow, Math.min(1, -h * 1.2)).lerp(PALETTE.deep, Math.min(1, Math.max(0, -h - 0.6)));
      } else if (h < 0.22 || t === Terrain.SAND) {
        tmp.copy(PALETTE.wetSand).lerp(PALETTE.sand, Math.min(1, h / 0.15));
      } else {
        tmp.copy(PALETTE.grass).lerp(PALETTE.grassDry, Math.max(0, n) * 0.9).lerp(PALETTE.grassLush, Math.max(0, -n) * 0.9);
        if (t === Terrain.FOREST) tmp.lerp(PALETTE.forest, 0.7);
        if (h < 0.3) tmp.lerp(PALETTE.sand, (0.3 - h) / 0.08);
      }
      // Steep ground and mountains show bare rock; high peaks are pale.
      const rockAmt = Math.min(1, Math.max(0, (slope - 0.18) * 3.5) + (t === Terrain.ROCK ? 0.6 : 0));
      if (rockAmt > 0 && h > 0) {
        const rc = PALETTE.rock.clone().lerp(PALETTE.rockDark, rng.next() * 0.5 + Math.max(0, n) * 0.3);
        if (h > 3.4) rc.lerp(PALETTE.peak, Math.min(1, (h - 3.4) * 0.8));
        tmp.lerp(rc, rockAmt);
      }
      const jitter = 1 + (rng.next() - 0.5) * 0.06;
      col[k * 3] = tmp.r * jitter; col[k * 3 + 1] = tmp.g * jitter; col[k * 3 + 2] = tmp.b * jitter;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

  const detail = new THREE.CanvasTexture(tileableNoiseCanvas(256, seed + 5));
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  detail.colorSpace = THREE.SRGBColorSpace;
  detail.anisotropy = 8;
  const bump = new THREE.CanvasTexture(tileableNoiseCanvas(256, seed + 11, 6));
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  const mat = patchFow(new THREE.MeshStandardMaterial({
    vertexColors: true, map: detail, bumpMap: bump, bumpScale: 1.2, roughness: 0.95, metalness: 0,
  }));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

function makePatchNoise(seed) {
  const rng = createRng(seed + 7);
  const size = 32;
  const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i++) g[i] = rng.next() * 2 - 1;
  const at = (x, y) => g[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  const smooth = (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  return (x, y) => smooth(x * 0.12, y * 0.12) * 0.7 + smooth(x * 0.4, y * 0.4) * 0.3;
}

// ----------------------------------------------------------------- water

export function buildWater(map) {
  const normal = new THREE.CanvasTexture(waterNormalCanvas(256));
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  normal.repeat.set(map.w / 5, map.h / 5);
  const mat = patchFow(new THREE.MeshStandardMaterial({
    color: '#2a6f8c', roughness: 0.32, metalness: 0.0, transparent: true, opacity: 0.8,
    normalMap: normal, normalScale: new THREE.Vector2(0.35, 0.35), depthWrite: false,
  }), { clouds: true });
  const size = Math.max(map.w, map.h) * 4;
  const geo = new THREE.PlaneGeometry(size, size);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(map.w / 2, WATER_LEVEL, map.h / 2);
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  // Ocean floor beyond the map edge so the world doesn't end in a void.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
    patchFow(new THREE.MeshStandardMaterial({ color: '#173246', roughness: 1 }), { clouds: false }),
  );
  floor.position.set(map.w / 2, -2.2, map.h / 2);
  const group = new THREE.Group();
  group.add(floor, mesh);
  group.userData.normal = normal;
  return group;
}

// ------------------------------------------------------------ vegetation

function colored(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

function conifer() {
  const parts = [colored(new THREE.CylinderGeometry(0.035, 0.05, 0.3, 5).translate(0, 0.15, 0), '#5a4030')];
  [[0.28, 0.42, 0.3], [0.22, 0.36, 0.52], [0.15, 0.3, 0.72]].forEach(([r, h, y], i) => {
    parts.push(colored(new THREE.ConeGeometry(r, h, 7).translate(0, y, 0), ['#2f5a2a', '#356530', '#3c6f35'][i]));
  });
  return mergeGeometries(parts);
}

function broadleaf() {
  const trunk = colored(new THREE.CylinderGeometry(0.04, 0.06, 0.4, 5).translate(0, 0.2, 0), '#5d4532');
  const crown = new THREE.IcosahedronGeometry(0.3, 1);
  const p = crown.attributes.position;
  const rng = createRng(3);
  for (let i = 0; i < p.count; i++) {
    const s = 0.85 + rng.next() * 0.3;
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.85, p.getZ(i) * s);
  }
  crown.translate(0, 0.55, 0);
  crown.computeVertexNormals();
  return mergeGeometries([trunk, colored(crown, '#4a7a34')]);
}

function boulder(seed) {
  const g = new THREE.DodecahedronGeometry(0.5, 1);
  const p = g.attributes.position;
  const rng = createRng(seed);
  // Deform consistently per shared vertex position so there are no cracks.
  const cache = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!cache.has(key)) cache.set(key, 0.75 + rng.next() * 0.45);
    const s = cache.get(key);
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.7, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  return colored(g, '#8a8275');
}

export function buildVegetation(map, hf, seed) {
  const rng = createRng(seed + 1234);
  const trees = { conifer: [], broadleaf: [] };
  const rocks = [];
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const t = map.get(x, y);
      if (t === Terrain.FOREST) {
        const n = 3 + rng.int(0, 2);
        for (let k = 0; k < n; k++) {
          const px = x + rng.range(0.1, 0.9), pz = y + rng.range(0.1, 0.9);
          (rng.next() < 0.55 ? trees.conifer : trees.broadleaf).push([px, pz, rng.range(0.7, 1.15), rng.next() * Math.PI * 2]);
        }
      } else if (t === Terrain.GRASS && rng.next() < 0.035 && !nearWell(map, x, y)) {
        trees.broadleaf.push([x + rng.range(0.2, 0.8), y + rng.range(0.2, 0.8), rng.range(0.75, 1.1), rng.next() * 6.28]);
      } else if (t === Terrain.ROCK && rng.next() < 0.35) {
        rocks.push([x + rng.range(0.1, 0.9), y + rng.range(0.1, 0.9), rng.range(0.4, 1.1), rng.next() * 6.28]);
      } else if ((t === Terrain.GRASS || t === Terrain.SAND) && rng.next() < 0.012) {
        rocks.push([x + rng.range(0.2, 0.8), y + rng.range(0.2, 0.8), rng.range(0.12, 0.3), rng.next() * 6.28]);
      }
    }
  }
  const group = new THREE.Group();
  const mat = patchFow(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();
  const place = (geo, list, tintFn) => {
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach(([x, z, sc, rot], i) => {
      q.setFromAxisAngle(up, rot);
      s.set(sc, sc * rng.range(0.9, 1.15), sc);
      v.set(x, hf.heightAt(x, z) - 0.03, z);
      m4.compose(v, q, s);
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, tintFn(tint));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  const greenTint = (c) => c.setHSL(0.25 + rng.range(-0.05, 0.06), rng.range(0.25, 0.6), rng.range(0.75, 1.0));
  place(conifer(), trees.conifer, greenTint);
  place(broadleaf(), trees.broadleaf, (c) => (rng.next() < 0.12 ? c.setHSL(0.09, 0.6, 0.85) : greenTint(c)));
  place(boulder(seed), rocks, (c) => c.setHSL(0.08, 0.08, rng.range(0.7, 1.0)));
  return group;
}

function nearWell(map, x, y) {
  return map.wells.some((w) => Math.abs(w.x - x) <= 1 && Math.abs(w.y - y) <= 1);
}

export function buildSky() {
  const geo = new THREE.SphereGeometry(900, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#6f9fd0') }, bottom: { value: new THREE.Color('#d9e4ea') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.05, 0.5, vP.y)), 1.0); }',
  });
  return new THREE.Mesh(geo, mat);
}
