import * as THREE from 'three';

// CPU-simulated particles drawn as soft point sprites in a single draw call
// per blend mode. Additive for fire/sparks, normal blending for smoke/dust.

const VERT = `
  attribute float size;
  attribute vec4 rgba;
  varying vec4 vColor;
  uniform float scale;
  void main() {
    vColor = rgba;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * scale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

const FRAG = `
  varying vec4 vColor;
  uniform float softness;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d >= 1.0) discard;
    // Gaussian-ish falloff for soft puffs; tighter core for sparks.
    float a = softness > 0.5 ? exp(-d * d * 3.5) * (1.0 - d * d) : 1.0 - smoothstep(0.2, 1.0, d);
    gl_FragColor = vec4(vColor.rgb, vColor.a * a);
  }`;

class Pool {
  constructor(max, additive) {
    this.max = max;
    this.count = 0;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.c0 = new Float32Array(max * 4);
    this.c1 = new Float32Array(max * 4);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('size', this.sizeAttr);
    geo.setAttribute('rgba', this.colAttr);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { scale: { value: 600 }, softness: { value: additive ? 0.0 : 1.0 } },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
  }

  spawn(o) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.p.set([o.x, o.y, o.z], i * 3);
    this.v.set([o.vx || 0, o.vy || 0, o.vz || 0], i * 3);
    this.life[i] = this.maxLife[i] = o.life;
    this.size0[i] = o.size;
    this.size1[i] = o.size1 ?? o.size;
    this.c0.set(o.color, i * 4);
    this.c1.set(o.color1 || [o.color[0], o.color[1], o.color[2], 0], i * 4);
    this.drag[i] = o.drag ?? 1;
    this.grav[i] = o.gravity ?? 0;
  }

  update(dt) {
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      // Compact live particles to the front.
      if (n !== i) {
        this.p.copyWithin(n * 3, i * 3, i * 3 + 3);
        this.v.copyWithin(n * 3, i * 3, i * 3 + 3);
        this.c0.copyWithin(n * 4, i * 4, i * 4 + 4);
        this.c1.copyWithin(n * 4, i * 4, i * 4 + 4);
        this.life[n] = this.life[i]; this.maxLife[n] = this.maxLife[i];
        this.size0[n] = this.size0[i]; this.size1[n] = this.size1[i];
        this.drag[n] = this.drag[i]; this.grav[n] = this.grav[i];
      }
      const d = Math.pow(this.drag[n], dt);
      this.v[n * 3] *= d; this.v[n * 3 + 1] = this.v[n * 3 + 1] * d - this.grav[n] * dt; this.v[n * 3 + 2] *= d;
      this.p[n * 3] += this.v[n * 3] * dt; this.p[n * 3 + 1] += this.v[n * 3 + 1] * dt; this.p[n * 3 + 2] += this.v[n * 3 + 2] * dt;
      n++;
    }
    this.count = n;
    const pos = this.posAttr.array, size = this.sizeAttr.array, col = this.colAttr.array;
    for (let i = 0; i < n; i++) {
      const t = 1 - this.life[i] / this.maxLife[i];
      pos[i * 3] = this.p[i * 3]; pos[i * 3 + 1] = this.p[i * 3 + 1]; pos[i * 3 + 2] = this.p[i * 3 + 2];
      size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      for (let k = 0; k < 4; k++) col[i * 4 + k] = this.c0[i * 4 + k] + (this.c1[i * 4 + k] - this.c0[i * 4 + k]) * t;
    }
    this.posAttr.needsUpdate = this.sizeAttr.needsUpdate = this.colAttr.needsUpdate = true;
    this.points.geometry.setDrawRange(0, n);
  }
}

const rnd = (a, b) => a + Math.random() * (b - a);

export class Particles {
  constructor(scene) {
    this.smoke = new Pool(5000, false);
    this.fire = new Pool(5000, true);
    scene.add(this.smoke.points, this.fire.points);
  }

  setScale(px) {
    this.smoke.material.uniforms.scale.value = px;
    this.fire.material.uniforms.scale.value = px;
  }

  update(dt) {
    this.smoke.update(dt);
    this.fire.update(dt);
  }

  flash(x, y, z, size = 0.35) {
    this.fire.spawn({ x, y, z, life: 0.07, size, size1: size * 0.6, color: [1, 0.85, 0.5, 1], color1: [1, 0.4, 0.1, 0] });
  }

  spark(x, y, z, n = 4, speed = 2) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.fire.spawn({
        x, y, z, vx: Math.cos(a) * rnd(0.3, 1) * speed, vy: rnd(0.5, 1.5) * speed, vz: Math.sin(a) * rnd(0.3, 1) * speed,
        life: rnd(0.2, 0.45), size: 0.06, size1: 0.02, gravity: 6, drag: 0.3,
        color: [1, 0.8, 0.4, 1], color1: [1, 0.3, 0.05, 0],
      });
    }
  }

  dust(x, y, z, n = 3, size = 0.25) {
    for (let i = 0; i < n; i++) {
      this.smoke.spawn({
        x: x + rnd(-0.1, 0.1), y, z: z + rnd(-0.1, 0.1), vx: rnd(-0.3, 0.3), vy: rnd(0.1, 0.4), vz: rnd(-0.3, 0.3),
        life: rnd(0.5, 1.0), size, size1: size * 2.5, drag: 0.4,
        color: [0.55, 0.48, 0.38, 0.45], color1: [0.55, 0.5, 0.42, 0],
      });
    }
  }

  trail(x, y, z) {
    this.smoke.spawn({
      x, y, z, vy: 0.15, life: 0.7, size: 0.1, size1: 0.35, drag: 0.5,
      color: [0.85, 0.85, 0.85, 0.5], color1: [0.7, 0.7, 0.7, 0],
    });
  }

  projectile(x, y, z, kind) {
    const big = kind === 'artillery' || kind === 'bomb';
    this.fire.spawn({
      x, y, z, life: 0.05, size: big ? 0.28 : kind === 'bullet' ? 0.09 : 0.16, size1: 0.05,
      color: kind === 'flak' ? [1, 0.9, 0.5, 1] : [1, 0.75, 0.35, 1], color1: [1, 0.4, 0.1, 0],
    });
  }

  explosion(x, y, z, size = 1) {
    const s = Math.max(0.6, size);
    this.fire.spawn({ x, y: y + 0.2, z, life: 0.25, size: 1.6 * s, size1: 2.6 * s, color: [1, 0.95, 0.7, 1], color1: [1, 0.5, 0.1, 0] });
    for (let i = 0; i < 14 * s; i++) {
      const a = Math.random() * Math.PI * 2, sp = rnd(0.4, 2.2) * s;
      this.fire.spawn({
        x, y: y + 0.15, z, vx: Math.cos(a) * sp, vy: rnd(0.5, 2.5) * s, vz: Math.sin(a) * sp,
        life: rnd(0.3, 0.7), size: rnd(0.4, 0.8) * s, size1: 0.1, drag: 0.15, gravity: 1,
        color: [1, rnd(0.55, 0.8), 0.2, 1], color1: [0.8, 0.2, 0.05, 0],
      });
      this.smoke.spawn({
        x: x + rnd(-0.2, 0.2) * s, y: y + rnd(0.1, 0.4), z: z + rnd(-0.2, 0.2) * s,
        vx: Math.cos(a) * sp * 0.25, vy: rnd(0.4, 1.0), vz: Math.sin(a) * sp * 0.25,
        life: rnd(1.5, 3.0), size: rnd(0.4, 0.7) * s, size1: rnd(1.4, 2.2) * s, drag: 0.5,
        color: [0.18, 0.16, 0.14, 0.75], color1: [0.4, 0.38, 0.36, 0],
      });
    }
    this.spark(x, y + 0.2, z, 10 * s, 3 * s);
    // Debris.
    for (let i = 0; i < 6 * s; i++) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.spawn({
        x, y: y + 0.2, z, vx: Math.cos(a) * rnd(1, 3), vy: rnd(2, 4), vz: Math.sin(a) * rnd(1, 3),
        life: rnd(0.6, 1.0), size: 0.08, size1: 0.06, gravity: 9, drag: 0.6,
        color: [0.1, 0.09, 0.08, 1], color1: [0.1, 0.09, 0.08, 0.8],
      });
    }
  }

  impact(x, y, z, splash) {
    if (splash > 0) {
      this.fire.spawn({ x, y: y + 0.15, z, life: 0.2, size: splash * 1.6, size1: splash * 2.2, color: [1, 0.85, 0.55, 1], color1: [1, 0.4, 0.1, 0] });
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2;
        this.smoke.spawn({
          x, y: y + 0.1, z, vx: Math.cos(a) * rnd(0.3, 1.2), vy: rnd(0.6, 1.8), vz: Math.sin(a) * rnd(0.3, 1.2),
          life: rnd(1, 2), size: 0.4, size1: 1.4, drag: 0.4,
          color: [0.35, 0.3, 0.24, 0.7], color1: [0.5, 0.47, 0.42, 0],
        });
      }
      this.spark(x, y + 0.1, z, 8, 2.5);
    } else {
      this.spark(x, y + 0.05, z, 3, 1.2);
      this.dust(x, y, z, 2, 0.12);
    }
  }

  airBurst(x, y, z) {
    this.fire.spawn({ x, y, z, life: 0.12, size: 0.4, size1: 0.6, color: [1, 0.85, 0.5, 1], color1: [1, 0.4, 0.1, 0] });
    this.smoke.spawn({ x, y, z, life: 0.9, size: 0.3, size1: 0.7, drag: 0.5, color: [0.12, 0.12, 0.12, 0.7], color1: [0.2, 0.2, 0.2, 0] });
  }

  // Ongoing emitters for damaged things and chimneys.
  damageSmoke(x, y, z, heavy) {
    this.smoke.spawn({
      x: x + rnd(-0.15, 0.15), y, z: z + rnd(-0.15, 0.15), vx: 0.25, vy: rnd(0.5, 0.9), vz: 0.1,
      life: rnd(1.5, 2.5), size: 0.25, size1: 1.0, drag: 0.7,
      color: heavy ? [0.08, 0.08, 0.08, 0.7] : [0.3, 0.3, 0.3, 0.5], color1: [0.35, 0.35, 0.35, 0],
    });
    if (heavy && Math.random() < 0.5) {
      this.fire.spawn({ x: x + rnd(-0.1, 0.1), y, z: z + rnd(-0.1, 0.1), vy: 0.6, life: 0.4, size: 0.3, size1: 0.1, color: [1, 0.6, 0.15, 0.9], color1: [1, 0.2, 0, 0] });
    }
  }

  chimney(x, y, z) {
    this.smoke.spawn({
      x, y, z, vx: 0.2, vy: rnd(0.4, 0.6), vz: 0.08, life: rnd(2.5, 3.5), size: 0.18, size1: 0.9, drag: 0.8,
      color: [0.75, 0.74, 0.72, 0.45], color1: [0.85, 0.85, 0.85, 0],
    });
  }

  blood(x, y, z) {
    for (let i = 0; i < 4; i++) this.smoke.spawn({ x, y, z, vx: rnd(-0.5, 0.5), vy: rnd(0.3, 0.8), vz: rnd(-0.5, 0.5), life: 0.4, size: 0.08, size1: 0.12, gravity: 3, color: [0.4, 0.05, 0.05, 0.9], color1: [0.3, 0.03, 0.03, 0] });
    this.dust(x, y, z, 3, 0.15);
  }
}
