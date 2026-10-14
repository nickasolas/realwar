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
  const prevCompile = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    prevCompile.call(material, shader, renderer);
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
  material.customProgramCacheKey = () => prevKey() + '|fow' + (clouds ? 'c' : '');
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

// Splat channels: x = grass, y = dirt, z = rock, w = sand.
const SPLAT = { grass: 0, dirt: 1, rock: 2, sand: 3 };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function buildTerrain(map, hf, seed, textures) {
  const { vw, vh, heights } = hf;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(vw * vh * 3);
  for (let j = 0; j < vh; j++) {
    for (let i = 0; i < vw; i++) {
      const k = j * vw + i;
      pos[k * 3] = i / RES;
      pos[k * 3 + 1] = heights[k];
      pos[k * 3 + 2] = j / RES;
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
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();

  // Distance from each vertex to the nearest road centre line, in tiles.
  const roadDist = new Float32Array(vw * vh).fill(99);
  for (const road of map.roads) {
    for (const rp of road) {
      const cx = rp.x + 1, cy = rp.y + 1; // carved 2x2, centred on the tile corner
      for (let j = Math.max(0, (cy - 2) * RES); j <= Math.min(vh - 1, (cy + 2) * RES); j++) {
        for (let i = Math.max(0, (cx - 2) * RES); i <= Math.min(vw - 1, (cx + 2) * RES); i++) {
          const d = Math.hypot(i / RES - cx, j / RES - cy);
          const k = j * vw + i;
          if (d < roadDist[k]) roadDist[k] = d;
        }
      }
    }
  }

  // Splat weights and a macro tint per vertex.
  const nrm = geo.attributes.normal.array;
  const splat = new Float32Array(vw * vh * 4);
  const col = new Float32Array(vw * vh * 3);
  const rng = createRng(seed + 99);
  const patch = makePatchNoise(seed);
  const patch2 = makePatchNoise(seed + 31);
  const tint = new THREE.Color();
  const deep = new THREE.Color('#1c3b52'), shallow = new THREE.Color('#5f8f86');
  for (let j = 0; j < vh; j++) {
    for (let i = 0; i < vw; i++) {
      const k = j * vw + i;
      const h = heights[k];
      const slope = 1 - nrm[k * 3 + 1];
      const tx = Math.min(map.w - 1, Math.floor(i / RES)), ty = Math.min(map.h - 1, Math.floor(j / RES));
      const t = map.get(tx, ty);
      const n = patch(i / RES, j / RES), n2 = patch2(i / RES * 2.3, j / RES * 2.3);
      let g = 1, dt = 0, rk = 0, sd = 0;
      // Beaches and anything near or under the waterline.
      const beach = Math.max(t === Terrain.SAND ? 0.85 : 0, 1 - smooth(0.12, 0.34, h));
      sd = beach; g = 1 - beach;
      // Worn, patchy ground: bare earth shows through the meadow here and there.
      const bare = smooth(0.35, 0.75, n2) * 0.55 + (t === Terrain.FOREST ? 0.3 : 0);
      dt = g * bare; g -= dt;
      // Dirt road with a ragged edge.
      const road = 1 - smooth(0.55, 1.05, roadDist[k] + (n2 - 0.5) * 0.35);
      if (road > 0) { const r = road * (1 - sd * 0.5); g *= 1 - r; dt = dt * (1 - r) + r; }
      // Rock on cliffs and mountains.
      rk = Math.min(1, smooth(0.16, 0.42, slope) + (t === Terrain.ROCK ? 0.75 : 0));
      if (h < 0.05) rk *= 0.3;
      g *= 1 - rk; dt *= 1 - rk; sd *= 1 - rk;
      splat[k * 4] = g; splat[k * 4 + 1] = dt; splat[k * 4 + 2] = rk; splat[k * 4 + 3] = sd;

      // Macro tint: meadow hue drift, shaded forest floor, wet sand, water depth.
      tint.setRGB(1, 1, 1);
      tint.multiplyScalar(0.9 + n * 0.14 + n2 * 0.06 + (rng.next() - 0.5) * 0.04);
      if (t === Terrain.FOREST) tint.multiplyScalar(0.72);
      if (h < 0.18) tint.multiplyScalar(0.78 + smooth(-0.1, 0.18, h) * 0.22);
      if (h < -0.05) tint.lerp(shallow, Math.min(1, -h * 0.9)).lerp(deep, smooth(0.4, 1.6, -h));
      if (h > 3.4) tint.lerp(new THREE.Color('#f2efe8'), Math.min(0.6, (h - 3.4) * 0.5));
      col[k * 3] = tint.r; col[k * 3 + 1] = tint.g; col[k * 3 + 2] = tint.b;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const splatAttr = new THREE.BufferAttribute(splat, 4);
  splatAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('splat', splatAttr);

  const mat = patchFow(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 }));
  const fowCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    fowCompile(shader, r);
    shader.uniforms.tGrass = { value: textures.grass };
    shader.uniforms.tDirt = { value: textures.dirt };
    shader.uniforms.tRock = { value: textures.rock };
    shader.uniforms.tSand = { value: textures.sand };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tGrass, tDirt, tRock, tSand;
        varying vec4 vSplat;
        // Two scales per texture hide the tiling grid.
        vec3 groundTex(sampler2D t, vec2 p) {
          vec3 c = mix(texture2D(t, p * 0.5).rgb, texture2D(t, p * 0.11 + 0.31).rgb, 0.4);
          // Broad light/dark mottling every few tiles, like sun-bleached and lush ground.
          float lum = dot(texture2D(t, p * 0.035 + 0.57).rgb, vec3(0.33));
          return c * (0.72 + lum * 0.75);
        }`)
      .replace('#include <map_fragment>', `
        vec4 sw = vSplat / max(1e-4, vSplat.x + vSplat.y + vSplat.z + vSplat.w);
        vec3 ground = vec3(0.0);
        if (sw.x > 0.01) ground += groundTex(tGrass, vFowXZ) * sw.x;
        if (sw.y > 0.01) ground += groundTex(tDirt, vFowXZ * 0.9) * sw.y;
        if (sw.z > 0.01) ground += groundTex(tRock, vFowXZ * 0.6) * sw.z;
        if (sw.w > 0.01) ground += groundTex(tSand, vFowXZ) * sw.w;
        diffuseColor.rgb *= ground;`);
  };
  mat.customProgramCacheKey = () => 'terrain-splat|fowc';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;

  // Paint worn earth around a footprint (structures, craters). Returns nothing;
  // the GPU buffer is refreshed on the next frame.
  mesh.userData.paintDirt = (x0, y0, w, h, margin = 0.9, strength = 1) => {
    const i0 = Math.max(0, Math.floor((x0 - margin - 0.5) * RES)), i1 = Math.min(vw - 1, Math.ceil((x0 + w + margin + 0.5) * RES));
    const j0 = Math.max(0, Math.floor((y0 - margin - 0.5) * RES)), j1 = Math.min(vh - 1, Math.ceil((y0 + h + margin + 0.5) * RES));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = i / RES, y = j / RES;
        const dx = Math.max(x0 - x, 0, x - (x0 + w)), dy = Math.max(y0 - y, 0, y - (y0 + h));
        const edge = (patch2(x * 3.1, y * 3.1) - 0.5) * 0.7;
        const a = (1 - smooth(margin * 0.35, margin, Math.hypot(dx, dy) + edge)) * strength;
        if (a <= 0) continue;
        const k = j * vw + i;
        if (heights[k] < 0.05) continue;
        const keepRock = splat[k * 4 + 2];
        const s = 1 - a;
        splat[k * 4] *= s; splat[k * 4 + 3] *= s;
        splat[k * 4 + 1] = splat[k * 4 + 1] * s + a * (1 - keepRock);
        splat[k * 4 + 2] = keepRock;
      }
    }
    splatAttr.needsUpdate = true;
  };
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

// Tree parts are built in a neutral colour so each instance can be tinted.
function coniferCrown() {
  const parts = [];
  [[0.27, 0.42, 0.34], [0.22, 0.38, 0.55], [0.16, 0.32, 0.74], [0.09, 0.22, 0.9]].forEach(([r, h, y], i) => {
    const g = new THREE.ConeGeometry(r, h, 8).translate(0, y, 0);
    parts.push(colored(g, ['#cfcfcf', '#dadada', '#e4e4e4', '#efefef'][i]));
  });
  return mergeGeometries(parts);
}

function broadleafCrown(seed) {
  const rng = createRng(seed);
  const parts = [];
  // A cluster of lumpy blobs reads as a real canopy rather than a ball.
  const blobs = [[0, 0.62, 0, 0.3], [0.16, 0.55, 0.08, 0.22], [-0.14, 0.56, -0.1, 0.22], [0.02, 0.78, -0.04, 0.2], [-0.06, 0.52, 0.16, 0.18]];
  blobs.forEach(([x, y, z, r], bi) => {
    // Only the main blob gets the finer mesh; the others stay low-poly.
    const g = new THREE.IcosahedronGeometry(r, bi === 0 ? 1 : 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const sc = 0.82 + rng.next() * 0.32;
      p.setXYZ(i, p.getX(i) * sc, p.getY(i) * sc * 0.85, p.getZ(i) * sc);
    }
    g.translate(x, y, z);
    g.computeVertexNormals();
    parts.push(colored(g, rng.next() < 0.5 ? '#e0e0e0' : '#f2f2f2'));
  });
  return mergeGeometries(parts);
}

function trunk(height, r) {
  const g = new THREE.CylinderGeometry(r * 0.7, r, height, 6).translate(0, height / 2, 0);
  return colored(g, '#5a4433');
}

function shrub(seed) {
  const rng = createRng(seed);
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.IcosahedronGeometry(0.16 + rng.next() * 0.06, 0);
    g.scale(1, 0.7, 1).translate((rng.next() - 0.5) * 0.18, 0.08, (rng.next() - 0.5) * 0.18);
    parts.push(colored(g, '#e8e8e8'));
  }
  return mergeGeometries(parts);
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
    const sc = cache.get(key);
    p.setXYZ(i, p.getX(i) * sc, p.getY(i) * sc * 0.7, p.getZ(i) * sc);
  }
  g.computeVertexNormals();
  return colored(g, '#8a8275');
}

const FOLIAGE = {
  conifer: ['#2c4a22', '#33532a', '#3a5b2c', '#2a4424'],
  summer: ['#4d7a2c', '#5a8632', '#44702a', '#668f38', '#3f6627'],
  autumn: ['#c2621d', '#a8401b', '#d49a2a', '#8f4a1e', '#b8781f', '#9c5a24'],
};

export function buildVegetation(map, hf, seed) {
  const rng = createRng(seed + 1234);
  const autumnField = makePatchNoise(seed + 77);
  const trees = { conifer: [], broadleaf: [] };
  const shrubs = [];
  const rocks = [];
  const occupiedByProp = (x, y) => map.occupied[y * map.w + x] === -1;
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const t = map.get(x, y);
      if (occupiedByProp(x, y)) continue;
      if (t === Terrain.FOREST) {
        const n = 3 + rng.int(0, 2);
        for (let k = 0; k < n; k++) {
          const px = x + rng.range(0.1, 0.9), pz = y + rng.range(0.1, 0.9);
          (rng.next() < 0.45 ? trees.conifer : trees.broadleaf).push([px, pz, rng.range(0.75, 1.2), rng.next() * Math.PI * 2]);
        }
        if (rng.next() < 0.5) shrubs.push([x + rng.next(), y + rng.next(), rng.range(0.8, 1.4), rng.next() * 6.28]);
      } else if (t === Terrain.GRASS && !nearWell(map, x, y)) {
        const r = rng.next();
        if (r < 0.03) (rng.next() < 0.35 ? trees.conifer : trees.broadleaf).push([x + rng.range(0.2, 0.8), y + rng.range(0.2, 0.8), rng.range(0.8, 1.15), rng.next() * 6.28]);
        else if (r < 0.09) shrubs.push([x + rng.next(), y + rng.next(), rng.range(0.6, 1.2), rng.next() * 6.28]);
      } else if (t === Terrain.ROCK && rng.next() < 0.35) {
        rocks.push([x + rng.range(0.1, 0.9), y + rng.range(0.1, 0.9), rng.range(0.4, 1.1), rng.next() * 6.28]);
      } else if ((t === Terrain.GRASS || t === Terrain.SAND) && rng.next() < 0.012) {
        rocks.push([x + rng.range(0.2, 0.8), y + rng.range(0.2, 0.8), rng.range(0.12, 0.3), rng.next() * 6.28]);
      }
    }
  }
  const group = new THREE.Group();
  const mat = patchFow(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true }));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();
  // Which instances stand on each tile, so building over a tile can clear it.
  const byTile = new Map();
  const place = (geo, list, tintFn, scaleY = 1) => {
    if (!list.length) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach(([x, z, s, rot], i) => {
      const key = Math.floor(z) * map.w + Math.floor(x);
      if (!byTile.has(key)) byTile.set(key, []);
      byTile.get(key).push([mesh, i]);
      q.setFromAxisAngle(up, rot);
      sc.set(s, s * scaleY, s);
      v.set(x, hf.heightAt(x, z) - 0.03, z);
      m4.compose(v, q, sc);
      mesh.setMatrixAt(i, m4);
      if (tintFn) mesh.setColorAt(i, tintFn(tint, x, z));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const pick = (list) => list[Math.floor(rng.next() * list.length)];
  const vary = (c) => c.offsetHSL((rng.next() - 0.5) * 0.02, (rng.next() - 0.5) * 0.1, (rng.next() - 0.5) * 0.06);
  const broadTint = (c, x, z) => {
    // Stands of autumn colour drift across the woods.
    const autumn = autumnField(x * 0.8, z * 0.8) > 0.25 && rng.next() < 0.8;
    return vary(c.set(pick(autumn ? FOLIAGE.autumn : FOLIAGE.summer)));
  };
  place(trunk(0.42, 0.045), trees.conifer, null);
  place(coniferCrown(), trees.conifer, (c) => vary(c.set(pick(FOLIAGE.conifer))));
  place(trunk(0.42, 0.055), trees.broadleaf, null);
  place(broadleafCrown(seed), trees.broadleaf, broadTint);
  // Shrubs stay green in the open; only those inside woodland turn.
  place(shrub(seed + 5), shrubs, (c, x, z) => {
    const inWoods = map.get(Math.floor(x), Math.floor(z)) === Terrain.FOREST;
    return vary(c.set(pick(inWoods && autumnField(x * 0.8, z * 0.8) > 0.25 ? FOLIAGE.autumn : FOLIAGE.summer)));
  });
  place(boulder(seed), rocks, (c) => c.setHSL(0.08, 0.08, rng.range(0.7, 1.0)));
  // Remove trees, shrubs and rocks from a footprint (roads, structures).
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  group.userData.clear = (tx, ty, w = 1, h = 1) => {
    const touched = new Set();
    // Include a half-tile margin so canopies don't overhang the footprint.
    for (let y = ty - 1; y <= ty + h; y++) {
      for (let x = tx - 1; x <= tx + w; x++) {
        for (const [mesh, i] of byTile.get(y * map.w + x) || []) {
          mesh.getMatrixAt(i, m4);
          v.setFromMatrixPosition(m4);
          if (v.x < tx - 0.3 || v.x > tx + w + 0.3 || v.z < ty - 0.3 || v.z > ty + h + 0.3) continue;
          mesh.setMatrixAt(i, hidden);
          touched.add(mesh);
        }
      }
    }
    for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
  };
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
