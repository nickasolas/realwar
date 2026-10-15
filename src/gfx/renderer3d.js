import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BUILDINGS, UNITS, WEAPONS, OIL_PER_WELL, Terrain } from '../config.js';
import { HeightField, WATER_LEVEL } from './heightfield.js';
import { buildTerrain, buildWater, buildVegetation, buildSky, FogOfWar, fowUniforms, patchFow } from './world.js';
import { buildUnit, buildStructure, buildWell, buildProp, materials } from './models.js';
import { buildGroundTextures, buildRoadTexture } from './textures.js';
import { buildBridges } from './bridges.js';
import { Particles } from './particles.js';

patchFow(materials.body, { clouds: true });

export const CAMERA = { minDist: 7, maxDist: 58, defaultDist: 24 };
const DECAL_LIFE = 30; // seconds a scorch mark stays on the ground
const DECAL_FADE = 8; // seconds spent fading out at the end
const SUN_DIR = new THREE.Vector3(-0.55, 1.0, -0.42).normalize();
const AIR_ALT = { drone: 3.4, heli: 1.9, fighter: 2.9, bomber: 3.2, strikedrone: 2.6, paratroopers: 3.6 };
// Units are drawn larger than their footprint so they read at strategy zoom.
const UNIT_SCALE = { lander: 1.15, commando: 1.35, para: 1.35, strikedrone: 1.25, submarine: 1.15, paratroopers: 1.35, drone: 1.4, infantry: 1.35, rocketeer: 1.35, truck: 1.15, scout: 1.15, tank: 1.15, aa: 1.15, artillery: 1.1, heli: 1.15, fighter: 1.05, bomber: 0.9, gunboat: 1.1, destroyer: 1.05 };

export class Renderer3D {
  constructor(canvas, overlay, game, viewer = 0, quality = 'high') {
    this.canvas = canvas;
    this.overlay = overlay;
    this.octx = overlay.getContext('2d');
    this.game = game;
    this.viewer = viewer;
    this.quality = quality;
    this.time = 0;
    this.views = new Map();
    this.floaters = [];
    this.markers = [];
    this.decals = [];
    this.decalPool = [];

    const high = quality === 'high';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !high, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#cdd8dc', 40, 140);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.3, 1200);

    this.buildWorld();
    this.buildLights();
    this.particles = new Particles(this.scene);
    this.buildOverlayObjects();

    if (high) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.gtao = new GTAOPass(this.scene, this.camera, 1, 1);
      this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.2, samples: 12 });
      this.gtao.blendIntensity = 0.85;
      this.composer.addPass(this.gtao);
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.4, 0.9);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
  }

  // ------------------------------------------------------------- world

  buildWorld() {
    const { game } = this;
    this.hf = new HeightField(game.map, game.seed);
    this.fow = new FogOfWar(game.map);
    this.scene.add(buildSky());
    this.terrain = buildTerrain(game.map, this.hf, game.seed, buildGroundTextures(game.seed, this.renderer));
    this.paintDirt = this.terrain.userData.paintDirt;
    // Farmsteads and windmills, each on a patch of trodden earth.
    this.sails = [];
    for (const pr of game.map.props) {
      const m = buildProp(pr.kind);
      const cx = pr.x + pr.w / 2, cz = pr.y + pr.h / 2;
      m.root.position.set(cx, this.hf.maxOver(pr.x, pr.y, pr.w, pr.h) - 0.03, cz);
      m.root.rotation.y = pr.rot;
      if (m.sails) this.sails.push(m.sails);
      this.scene.add(m.root);
      this.paintDirt(pr.x, pr.y, pr.w, pr.h, 0.7, 0.55);
    }
    this.water = buildWater(game.map);
    this.vegetation = buildVegetation(game.map, this.hf, game.seed);
    this.scene.add(this.terrain, this.water, this.vegetation);
    this.roadTex = buildRoadTexture(game.seed, this.renderer);
    this.bridges = buildBridges(game.map, this.hf, patchFow(new THREE.MeshStandardMaterial({
      map: this.roadTex, vertexColors: true, roughness: 0.9,
    }), { clouds: true }));
    if (this.bridges) this.scene.add(this.bridges);
    // Keep the ground around each well clear for the trucks' loading bays.
    for (const w of game.map.wells) this.vegetation.userData.clear(w.x - 1, w.y - 1, 3, 3);
    this.wells = game.map.wells.map((w) => {
      const v = buildWell();
      v.root.position.set(w.x + 0.5, this.hf.heightAt(w.x + 0.5, w.y + 0.5), w.y + 0.5);
      v.root.rotation.y = (w.x * 7 + w.y * 3) % 6;
      v.root.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
      this.scene.add(v.root);
      return v;
    });
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight('#dde9f5', '#6b5a40', 1.0);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff4e2', 2.9);
    this.sun.castShadow = true;
    const res = this.quality === 'high' ? 4096 : 2048;
    this.sun.shadow.mapSize.set(res, res);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 200;
    this.scene.add(this.sun, this.sun.target);
  }

  buildOverlayObjects() {
    // Pools of ground-hugging rings for selection and order markers.
    this.ringGeo = new THREE.RingGeometry(0.88, 1, 40).rotateX(-Math.PI / 2);
    this.frameGeos = new Map();
    this.selMat = new THREE.MeshBasicMaterial({ color: '#7dff8a', transparent: true, opacity: 0.9, depthTest: false });
    this.enemySelMat = new THREE.MeshBasicMaterial({ color: '#ff6a5f', transparent: true, opacity: 0.9, depthTest: false });
    this.ringPool = [];
    this.visionGeo = new THREE.RingGeometry(0.985, 1, 96).rotateX(-Math.PI / 2);
    this.visionMat = new THREE.MeshBasicMaterial({ color: '#9fd8ff', transparent: true, opacity: 0.35, depthTest: false });
    this.markerPool = [];

    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#5f5', transparent: true, opacity: 0.35, depthWrite: false }));
    this.ghostEdges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: '#5f5' }));
    this.ghost.add(this.ghostEdges);
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    // Rally markers (flag + dashed line) are pooled: one per selected structure.
    this.rallyPool = [];

    // Scorch decals.
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, 'rgba(10,8,6,0.9)'); g.addColorStop(0.6, 'rgba(20,16,12,0.5)'); g.addColorStop(1, 'rgba(20,16,12,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    this.decalTex = new THREE.CanvasTexture(c);
    this.decalGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  }

  // Flat rectangular outline hugging a w x h footprint, even line width.
  frameGeo(w, h) {
    const key = w + 'x' + h;
    let g = this.frameGeos.get(key);
    if (!g) {
      const m = 0.12, t = 0.08;
      const ox = w / 2 + m, oy = h / 2 + m, ix = ox - t, iy = oy - t;
      const shape = new THREE.Shape([new THREE.Vector2(-ox, -oy), new THREE.Vector2(ox, -oy), new THREE.Vector2(ox, oy), new THREE.Vector2(-ox, oy)]);
      shape.holes.push(new THREE.Path([new THREE.Vector2(-ix, -iy), new THREE.Vector2(-ix, iy), new THREE.Vector2(ix, iy), new THREE.Vector2(ix, -iy)]));
      g = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
      this.frameGeos.set(key, g);
    }
    return g;
  }

  // ------------------------------------------------------------ camera

  resize(w, h) {
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    this.overlay.width = w * pr;
    this.overlay.height = h * pr;
    this.octx.setTransform(pr, 0, 0, pr, 0, 0);
    this.particles.setScale((h * pr) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))));
  }

  applyCamera(cam) {
    const t = (cam.zoom - CAMERA.minDist) / (CAMERA.maxDist - CAMERA.minDist);
    // A fairly high, steady angle like classic RTS games; flattens a little up close.
    const pitch = THREE.MathUtils.lerp(0.8, 1.08, Math.min(1, Math.max(0, t)) ** 0.8);
    const ty = Math.max(WATER_LEVEL, this.hf.heightAt(cam.x, cam.y)) * 0.5;
    this.camera.position.set(cam.x, ty + Math.sin(pitch) * cam.zoom, cam.y + Math.cos(pitch) * cam.zoom);
    this.camera.lookAt(cam.x, ty, cam.y);
    this.camera.updateMatrixWorld();
    this.scene.fog.near = cam.zoom * 1.6;
    this.scene.fog.far = cam.zoom * 5 + 40;

    // Keep the shadow frustum tight around the view, snapped to texels.
    const span = cam.zoom * 1.25 + 6;
    const sc = this.sun.shadow.camera;
    sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span;
    sc.updateProjectionMatrix();
    const texel = (span * 2) / this.sun.shadow.mapSize.x;
    const cx = Math.round(cam.x / texel) * texel, cz = Math.round((cam.y - cam.zoom * 0.15) / texel) * texel;
    this.sun.target.position.set(cx, 0, cz);
    this.sun.position.set(cx + SUN_DIR.x * 80, SUN_DIR.y * 80, cz + SUN_DIR.z * 80);
  }

  // Screen pixel -> tile coordinates on the terrain surface (ray-marched).
  pickGround(sx, sy) {
    const ray = this.screenRay(sx, sy);
    const o = ray.origin, d = ray.direction;
    if (d.y >= 0) return null;
    let tPrev = 0;
    const step = 0.35;
    for (let t = step; t < 400; t += step) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const h = Math.max(WATER_LEVEL, this.hf.heightAt(x, z));
      if (y <= h) {
        // Refine by bisection.
        let a = tPrev, b = t;
        for (let i = 0; i < 10; i++) {
          const m = (a + b) / 2;
          const mx = o.x + d.x * m, my = o.y + d.y * m, mz = o.z + d.z * m;
          if (my <= Math.max(WATER_LEVEL, this.hf.heightAt(mx, mz))) b = m; else a = m;
        }
        return { x: o.x + d.x * b, y: o.z + d.z * b };
      }
      tPrev = t;
    }
    // Fall back to the water plane.
    const t = (WATER_LEVEL - o.y) / d.y;
    return { x: o.x + d.x * t, y: o.z + d.z * t };
  }

  screenRay(sx, sy) {
    this.ndc.set((sx / this.width) * 2 - 1, -(sy / this.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster.ray;
  }

  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.width, y: (-v.y * 0.5 + 0.5) * this.height, on: v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 };
  }

  // World-space anchor point of an entity (for picking and health bars).
  anchor(e) {
    const view = this.views.get(e.id);
    if (view) return view.root.position;
    return new THREE.Vector3(e.x, this.hf.groundAt(e.x, e.y), e.y);
  }

  // Ground-plane quadrilateral of the current view, for the minimap.
  viewQuad() {
    return [[0, 0], [this.width, 0], [this.width, this.height], [0, this.height]].map(([x, y]) => {
      const ray = this.screenRay(x, y);
      const t = ray.direction.y < -0.01 ? (WATER_LEVEL + 0.5 - ray.origin.y) / ray.direction.y : 300;
      return { x: ray.origin.x + ray.direction.x * Math.min(t, 300), y: ray.origin.z + ray.direction.z * Math.min(t, 300) };
    });
  }

  isVisible(e) {
    return e.owner === this.viewer || this.game.isVisibleTo(this.viewer, e);
  }

  // Unit under the cursor (screen-space), else a structure under the ground point.
  entityAt(sx, sy) {
    let best = null, bestD = Infinity;
    for (const e of this.game.entities.values()) {
      if (e.kind !== 'unit' || !this.isVisible(e)) continue;
      const a = this.anchor(e);
      const p = this.project(a.x, a.y + 0.2, a.z);
      if (!p.on) continue;
      const pxPerUnit = this.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.position.distanceTo(a));
      const r = Math.max(12, e.radius * pxPerUnit * 1.3);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < r && d < bestD) { bestD = d; best = e; }
    }
    if (best) return best;
    const g = this.pickGround(sx, sy);
    if (!g) return null;
    for (const e of this.game.entities.values()) {
      if (e.kind !== 'building') continue;
      if (e.owner !== this.viewer && !this.views.get(e.id)?.root.visible) continue;
      if (g.x >= e.tx && g.x < e.tx + e.w && g.y >= e.ty && g.y < e.ty + e.h) return e;
    }
    return null;
  }

  unitsInRect(x0, y0, x1, y1, owner) {
    const out = [];
    for (const e of this.game.entities.values()) {
      if (e.kind !== 'unit' || e.owner !== owner) continue;
      const a = this.anchor(e);
      const p = this.project(a.x, a.y, a.z);
      if (p.on && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) out.push(e);
    }
    return out;
  }

  onScreen(e) {
    const a = this.anchor(e);
    return this.project(a.x, a.y, a.z).on;
  }

  // ------------------------------------------------------------ events

  heightFor(x, y, air) {
    return air ? this.hf.groundAt(x, y) + 2.2 : this.hf.groundAt(x, y) + 0.2;
  }

  consumeEvents(audio) {
    const P = this.particles;
    for (const ev of this.game.events) {
      const vis = this.tileVisible(ev.x, ev.y);
      switch (ev.type) {
        case 'fire': {
          if (!vis) break;
          const v = this.views.get(ev.shooterId);
          const pos = v ? v.root.position : new THREE.Vector3(ev.x, this.heightFor(ev.x, ev.y, false), ev.y);
          const ang = v ? -v.root.rotation.y + (v.parts.turret ? -v.parts.turret.rotation.y : 0) : 0;
          const reach = ev.fx === 'artillery' ? 0.8 : 0.45;
          P.flash(pos.x + Math.cos(ang) * reach, pos.y + 0.32, pos.z + Math.sin(ang) * reach, ev.fx === 'artillery' ? 0.8 : ev.fx === 'bullet' ? 0.2 : 0.4);
          if (ev.fx === 'artillery' || ev.fx === 'shell') P.dust(pos.x + Math.cos(ang) * reach, pos.y + 0.2, pos.z + Math.sin(ang) * reach, 2, 0.2);
          audio?.play(ev.fx, ev.x, ev.y);
          break;
        }
        case 'impact': {
          if (!vis && ev.fx !== 'icbm') break; // a missile strike is seen from afar
          if (ev.fx === 'icbm') {
            const h = this.hf.groundAt(ev.x, ev.y);
            P.mushroom(ev.x, h, ev.y, ev.splash);
            this.addDecal(ev.x, ev.y, ev.splash * 1.6);
            this.paintDirt(ev.x - 0.5, ev.y - 0.5, 1, 1, ev.splash * 1.1, 0.95);
            audio?.play('explode', ev.x, ev.y, 6);
          } else if (ev.air) P.airBurst(ev.x, this.heightFor(ev.x, ev.y, true), ev.y);
          else {
            const h = this.hf.groundAt(ev.x, ev.y);
            P.impact(ev.x, h, ev.y, ev.splash);
            if (ev.splash) {
              this.addDecal(ev.x, ev.y, ev.splash * 1.2);
              this.paintDirt(ev.x - 0.1, ev.y - 0.1, 0.2, 0.2, ev.splash * 0.6, 0.45);
            }
          }
          break;
        }
        case 'explode': {
          if (!vis) break;
          const h = ev.air ? this.heightFor(ev.x, ev.y, true) : this.hf.groundAt(ev.x, ev.y);
          if (ev.infantry) { P.blood(ev.x, h + 0.1, ev.y); audio?.play('die', ev.x, ev.y); }
          else {
            P.explosion(ev.x, h, ev.y, ev.size * 0.8);
            if (!ev.air) {
              this.addDecal(ev.x, ev.y, ev.size * 1.1);
              if (ev.size >= 1.5) this.paintDirt(ev.x - 0.2, ev.y - 0.2, 0.4, 0.4, ev.size * 0.45, 0.8);
            }
            audio?.play('explode', ev.x, ev.y, ev.size);
          }
          break;
        }
        case 'launch':
          P.launchPlume(ev.x, this.hf.groundAt(ev.x, ev.y) + 0.4, ev.y);
          audio?.play('launch', ev.x, ev.y);
          break;
        case 'built':
          if (ev.owner === this.viewer) {
            const def = BUILDINGS[ev.building];
            for (let i = 0; i < 12; i++) P.dust(ev.x + (Math.random() - 0.5) * def.w, this.hf.groundAt(ev.x, ev.y) + 0.1, ev.y + (Math.random() - 0.5) * def.h, 1, 0.4);
          }
          break;
        case 'credits':
          if (ev.owner === this.viewer) this.floaters.push({ text: `+$${ev.amount}`, x: ev.x, y: ev.y, life: 1.4 });
          break;
      }
    }
  }

  tileVisible(x, y) {
    const { map } = this.game;
    const tx = Math.floor(x), ty = Math.floor(y);
    return map.inBounds(tx, ty) && this.game.players[this.viewer].visible[ty * map.w + tx] === 1;
  }

  addDecal(x, y, size) {
    let d = this.decals.length >= 80 ? this.decals.shift() : this.decalPool.pop();
    if (!d) {
      const mat = patchFow(new THREE.MeshBasicMaterial({ map: this.decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }), { clouds: false });
      d = { mesh: new THREE.Mesh(this.decalGeo, mat) };
      d.mesh.renderOrder = 1;
      this.scene.add(d.mesh);
    }
    d.life = DECAL_LIFE;
    d.mesh.visible = true;
    d.mesh.material.opacity = 1;
    d.mesh.position.set(x, this.hf.groundAt(x, y) + 0.03, y);
    d.mesh.rotation.y = Math.random() * 6.28;
    d.mesh.scale.setScalar(size);
    this.decals.push(d);
  }

  // Fade scorch marks out, then recycle them. Opacity must stay within
  // [0, 1]: a negative alpha brightens the ground instead of darkening it.
  updateDecals(dt) {
    this.decals = this.decals.filter((d) => {
      d.life -= dt;
      if (d.life <= 0) {
        d.mesh.visible = false;
        this.decalPool.push(d);
        return false;
      }
      d.mesh.material.opacity = Math.min(1, d.life / DECAL_FADE);
      return true;
    });
  }

  // ------------------------------------------------------------- frame

  render(cam, ui, alpha, dt) {
    this.time += dt;
    fowUniforms.time.value = this.time;
    this.applyCamera(cam);
    this.fow.update(this.game.players[this.viewer], dt);
    this.water.userData.normal.offset.set(this.time * 0.012, this.time * 0.008);
    for (const sl of this.sails) sl.rotation.z += dt * 0.7;

    this.syncEntities(alpha, dt);
    this.updateWells(dt);
    this.updateRoads();
    this.updateProjectiles();
    this.particles.update(dt);
    this.updateDecals(dt);
    this.updateSelection(ui, dt);
    this.updatePlacement(ui);

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.drawOverlay(ui, dt);
  }

  syncEntities(alpha, dt) {
    const { game } = this;
    const seen = new Set();
    for (const e of game.entities.values()) {
      seen.add(e.id);
      let v = this.views.get(e.id);
      if (!v) {
        v = this.createView(e);
        this.views.set(e.id, v);
      }
      v.ent = e;
      const visible = this.isVisible(e);
      if (e.kind === 'building') {
        if (visible && !v.seen) {
          v.seen = true;
          // Construction churns up the ground; only paint it once it is seen.
          if (!e.def.segment) this.paintDirt(e.tx, e.ty, e.w, e.h, 0.75, 0.9);
          this.vegetation.userData.clear(e.tx, e.ty, e.w, e.h);
        }
        v.root.visible = visible || !!v.seen;
        if (visible) this.updateBuilding(v, e, dt);
      } else {
        v.root.visible = visible;
        if (visible) this.updateUnit(v, e, alpha, dt);
      }
    }
    // Remove views for dead entities, but keep remembered enemy structures
    // until their location is scouted again.
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      const e = v.ent;
      if (e.kind === 'building' && e.owner !== this.viewer && v.seen && !this.game.isVisibleTo(this.viewer, e)) continue;
      this.scene.remove(v.root);
      this.views.delete(id);
    }
  }

  createView(e) {
    const m = e.kind === 'unit' ? buildUnit(e.type, e.owner) : buildStructure(e.type, e.owner, e.w, e.h);
    const v = { root: m.root, body: m.body, parts: m, smokeT: 0, bank: 0, alt: 0, seen: false };
    if (e.kind === 'building') {
      v.root.position.set(e.x, this.hf.maxOver(e.tx, e.ty, e.w, e.h) - 0.08, e.y);
      v.scaffold = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(e.w * 0.95, 1.1, e.h * 0.95, e.w * 2, 3, e.h * 2)),
        new THREE.LineBasicMaterial({ color: '#e0b030' }),
      );
      v.scaffold.position.y = 0.6;
      v.root.add(v.scaffold);
    } else {
      v.root.position.set(e.x, this.hf.groundAt(e.x, e.y), e.y);
      v.root.scale.setScalar(UNIT_SCALE[e.type] || 1.2);
      v.alt = e.def.domain === 'air' ? AIR_ALT[e.type] || 2 : 0;
    }
    this.scene.add(v.root);
    return v;
  }

  // Is the tile at (x, y) a wall or gate belonging to `owner`?
  isFortification(x, y, owner) {
    const { map } = this.game;
    if (!map.inBounds(x, y)) return false;
    const id = map.occupied[y * map.w + x];
    const o = id > 0 ? this.game.get(id) : null;
    return !!o && o.owner === owner && o.def.segment;
  }

  updateFortification(v, e, dt) {
    const at = (dx, dy) => this.isFortification(e.tx + dx, e.ty + dy, e.owner);
    if (v.parts.arms) {
      v.parts.dirs.forEach(([dx, dy], i) => {
        // Diagonal arms only where the corner isn't already closed off.
        v.parts.arms[i].visible = at(dx, dy) && (!dx || !dy || (!at(dx, 0) && !at(0, dy)));
      });
    }
    if (v.parts.leaf) {
      const alongX = at(1, 0) || at(-1, 0) || !(at(0, 1) || at(0, -1));
      v.body.rotation.y = alongX ? 0 : Math.PI / 2;
      let open = 0;
      for (const u of this.game.entities.values()) {
        if (u.kind === 'unit' && u.owner === e.owner && u.def.domain === 'ground' && Math.hypot(u.x - e.x, u.y - e.y) < 1.5) { open = 1; break; }
      }
      v.gateOpen = (v.gateOpen ?? 0) + (open - (v.gateOpen ?? 0)) * Math.min(1, dt * 5);
      v.parts.leaf.position.y = -0.48 * v.gateOpen;
    }
  }

  updateBuilding(v, e, dt) {
    const built = e.progress >= 1;
    v.body.scale.y = built ? 1 : Math.max(0.05, e.progress);
    v.scaffold.visible = !built;
    if (e.def.segment) { this.updateFortification(v, e, dt); return; }
    const P = this.particles;
    if (v.parts.dish) v.parts.dish.rotation.y += dt * 0.8;
    const servicing = this.game.tick - (e.servicingAt ?? -1e9) < 10;
    if (v.parts.crane) v.parts.crane.rotation.y = Math.sin(this.time * (servicing ? 1.6 : 0.3)) * (servicing ? 1.1 : 0.4);
    // Welding sparks dance over a structure while it is being repaired.
    if (this.recentlyRepaired(e) && Math.random() < dt * 10) {
      const base = v.root.position;
      this.particles.weld(base.x + (Math.random() - 0.5) * e.w * 0.8, base.y + 0.3 + Math.random() * 0.7, base.z + (Math.random() - 0.5) * e.h * 0.8);
    }
    if (v.parts.doors) {
      // Blast doors open and the missile rises once it's charged.
      const ready = built && e.charge >= 1 ? 1 : 0;
      v.siloOpen = (v.siloOpen ?? 0) + (ready - (v.siloOpen ?? 0)) * Math.min(1, dt * 1.5);
      v.parts.doors.forEach((d, i) => { d.position.x = (i ? 1 : -1) * (0.46 + v.siloOpen * 0.44); });
      v.parts.missile.position.y = -0.6 + v.siloOpen * 1.55;
    }
    if (v.parts.turret && e.target != null) {
      const t = this.game.get(e.target);
      if (t) v.parts.turret.rotation.y = approachAngle(v.parts.turret.rotation.y, -Math.atan2(t.y - e.y, t.x - e.x), dt * 4);
    }
    v.smokeT -= dt;
    if (v.smokeT <= 0) {
      v.smokeT = 0.12;
      const base = v.root.position;
      if (built && v.parts.smoke) {
        const busy = e.queue?.length > 0;
        if (busy || Math.random() < 0.3) for (const s of v.parts.smoke) P.chimney(base.x + s.x, base.y + s.y, base.z + s.z);
      }
      const f = e.hp / e.maxHp;
      if (built && f < 0.55) P.damageSmoke(base.x + (Math.random() - 0.5) * e.w * 0.6, base.y + 0.6, base.z + (Math.random() - 0.5) * e.h * 0.6, f < 0.3);
      if (!built && Math.random() < 0.4) P.dust(base.x + (Math.random() - 0.5) * e.w, base.y + 0.15, base.z + (Math.random() - 0.5) * e.h, 1, 0.25);
    }
  }

  updateUnit(v, e, alpha, dt) {
    const x = e.px !== undefined ? e.px + (e.x - e.px) * alpha : e.x;
    const z = e.py !== undefined ? e.py + (e.y - e.py) * alpha : e.y;
    const domain = e.def.domain;
    const speed = e.px !== undefined ? Math.hypot(e.x - e.px, e.y - e.py) * 20 : 0;
    const ang = e.angle;
    const r = v.root;
    const prevAngle = v.lastAngle ?? ang;
    v.lastAngle = ang;
    r.rotation.y = -ang;
    const P = this.particles;

    if (domain === 'air') {
      const ground = this.hf.groundAt(x, z);
      const targetY = ground + v.alt + Math.sin(this.time * 1.7 + e.id) * 0.06;
      r.position.set(x, r.position.y ? r.position.y + (targetY - r.position.y) * Math.min(1, dt * 3) : targetY, z);
      const turn = angleDiff(ang, prevAngle) / Math.max(dt, 1e-3);
      v.bank += (Math.max(-0.6, Math.min(0.6, turn * 0.25)) - v.bank) * Math.min(1, dt * 4);
      v.body.rotation.x = v.bank;
      if (e.type === 'heli') {
        v.body.rotation.z = -Math.min(0.22, speed * 0.05);
        v.parts.rotor.rotation.y += dt * 28;
        v.parts.tailRotor.rotation.z += dt * 40;
      }
      if (v.parts.props) for (const pr of v.parts.props) pr.rotation.x += dt * 40;
      if (v.parts.rotors) {
        v.parts.rotors.forEach((rt, i) => { rt.rotation.y += dt * (i % 2 ? -45 : 45); });
        v.body.rotation.z = -Math.min(0.3, speed * 0.05);
      }
      if (e.type !== 'heli' && !e.def.scout && speed > 0.5 && Math.random() < dt * 20) {
        const back = new THREE.Vector3(-0.55, 0, 0).applyEuler(r.rotation).add(r.position);
        P.trail(back.x, back.y, back.z);
      }
    } else if (domain === 'naval') {
      const draft = e.def.stealth ? -0.07 : 0; // submarines run low in the water
      if (v.parts.cargo) {
        // One tarp bundle per two slots in use.
        const shown = Math.ceil(this.game.load(e) / 2);
        v.parts.cargo.forEach((c, i) => { c.visible = i < shown; });
      }
      r.position.set(x, WATER_LEVEL + draft + Math.sin(this.time * 1.3 + e.id) * 0.025, z);
      v.body.rotation.x = Math.sin(this.time * 1.1 + e.id) * 0.03;
      v.body.rotation.z = Math.sin(this.time * 0.9 + e.id * 2) * 0.02;
      if (speed > 0.3 && Math.random() < dt * 25) {
        const back = new THREE.Vector3(-e.radius * 1.1, 0, (Math.random() - 0.5) * 0.4).applyEuler(r.rotation).add(r.position);
        P.smoke.spawn({ x: back.x, y: 0.05, z: back.z, vx: (Math.random() - 0.5) * 0.3, vy: 0.05, vz: (Math.random() - 0.5) * 0.3, life: 1.6, size: 0.15, size1: 0.6, drag: 0.5, color: [0.95, 0.97, 1, 0.55], color1: [0.9, 0.95, 1, 0] });
      }
    } else {
      const h = this.hf.groundAt(x, z);
      const bob = e.def.armor === 'infantry' && speed > 0.2 ? Math.abs(Math.sin(this.time * 12 + e.id)) * 0.03 : 0;
      // Paratroopers drift down under canopy until they land.
      const fall = e.dropT > 0 ? e.dropT * 2.2 : 0;
      if (v.parts.chute) v.parts.chute.visible = fall > 0;
      r.position.set(x, h + bob + fall, z);
      // Tilt vehicles to follow the slope.
      const ca = Math.cos(ang), sa = Math.sin(ang), d = 0.35;
      const hf = this.hf.groundAt(x + ca * d, z + sa * d), hb = this.hf.groundAt(x - ca * d, z - sa * d);
      const hr = this.hf.groundAt(x - sa * d, z + ca * d), hl = this.hf.groundAt(x + sa * d, z - ca * d);
      const pitch = Math.atan2(hf - hb, 2 * d), roll = -Math.atan2(hr - hl, 2 * d);
      v.body.rotation.z += (pitch - v.body.rotation.z) * Math.min(1, dt * 8);
      v.body.rotation.x += (roll - v.body.rotation.x) * Math.min(1, dt * 8);
      if (speed > 0.8 && e.def.armor !== 'infantry' && Math.random() < dt * 8) P.dust(x - ca * e.radius, h + 0.05, z - sa * e.radius, 1, 0.18);
    }

    if (v.parts.radar) v.parts.radar.rotation.y += dt * 2;
    if (v.parts.turret) {
      const t = e.target != null ? this.game.get(e.target) : null;
      const want = t ? -(Math.atan2(t.y - e.y, t.x - e.x) - ang) : 0;
      v.parts.turret.rotation.y = approachAngle(v.parts.turret.rotation.y, want, dt * 5);
    }
    if (this.recentlyRepaired(e) && e.def.armor !== 'infantry' && Math.random() < dt * 8) {
      this.particles.weld(r.position.x + (Math.random() - 0.5) * 0.4, r.position.y + 0.3, r.position.z + (Math.random() - 0.5) * 0.4);
    }
    // Burning wrecks-to-be.
    v.smokeT -= dt;
    if (v.smokeT <= 0 && e.hp / e.maxHp < 0.4 && e.def.armor !== 'infantry') {
      v.smokeT = 0.15;
      P.damageSmoke(r.position.x, r.position.y + 0.35, r.position.z, e.hp / e.maxHp < 0.2);
    }
  }

  recentlyRepaired(e) {
    return this.game.tick - (e.repairedAt ?? -1e9) < 10;
  }

  // Round badge with a wrench: blue while repairing, red when out of funds.
  drawRepairBadge(ctx, x, y, stalled) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = stalled ? '#7a1f1a' : '#173a52';
    ctx.strokeStyle = stalled ? '#ff6a5f' : '#5fd0ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = '#e8f4ff';
    ctx.fillRect(-1.3, -1, 2.6, 7);
    ctx.beginPath(); ctx.arc(0, -3, 3.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = stalled ? '#7a1f1a' : '#173a52';
    ctx.fillRect(-1.1, -7, 2.2, 4);
    ctx.restore();
  }

  updateWells(dt) {
    const explored = this.game.players[this.viewer].explored;
    this.game.map.wells.forEach((w, i) => {
      const v = this.wells[i];
      v.root.visible = explored[w.y * this.game.map.w + w.x] === 1;
      if (w.amount > 0) v.beam.rotation.z = Math.sin(this.time * 2.2 + i) * 0.28;
      v.root.scale.setScalar(0.6 + 0.4 * (w.amount / OIL_PER_WELL));
    });
  }

  updateProjectiles() {
    const P = this.particles;
    for (const p of this.game.projectiles) {
      if (p.weapon !== 'icbm' && !this.tileVisible(p.x, p.y)) continue;
      const w = WEAPONS[p.weapon];
      const total = Math.hypot(p.tx - p.sx, p.ty - p.sy) || 1;
      const t = Math.max(0, Math.min(1, 1 - Math.hypot(p.tx - p.x, p.ty - p.y) / total));
      const y0 = p.fromAir ? this.heightFor(p.sx, p.sy, true) : this.hf.groundAt(p.sx, p.sy) + 0.35;
      const y1 = p.air ? this.heightFor(p.tx, p.ty, true) : this.hf.groundAt(p.tx, p.ty) + 0.2;
      let y = y0 + (y1 - y0) * t;
      if (w.arc) y += Math.sin(t * Math.PI) * (w.arcHeight ?? Math.min(6, total * 0.45));
      if (w.fx === 'torpedo') {
        // Runs just under the surface, leaving a bubble wake.
        P.projectile(p.x, WATER_LEVEL - 0.02, p.y, 'bullet');
        P.trail(p.x, WATER_LEVEL + 0.02, p.y);
        continue;
      }
      P.projectile(p.x, y, p.y, w.fx);
      if (w.fx === 'rocket' || w.fx === 'artillery') P.trail(p.x, y, p.y);
      if (w.fx === 'icbm') P.missileTrail(p.x, y, p.y);
    }
  }

  updateSelection(ui, dt) {
    let n = 0;
    const take = (geo, mat) => {
      let m = this.ringPool[n];
      if (!m) { m = new THREE.Mesh(this.ringGeo, this.selMat); m.renderOrder = 5; this.scene.add(m); this.ringPool.push(m); }
      m.geometry = geo; m.material = mat; m.visible = true;
      n++;
      return m;
    };
    for (const id of ui.selected) {
      const e = this.game.get(id);
      const v = this.views.get(id);
      if (!e || !v || !v.root.visible) continue;
      const mat = e.owner === this.viewer ? this.selMat : this.enemySelMat;
      if (e.kind === 'building') {
        const m = take(this.frameGeo(e.w, e.h), mat);
        m.position.set(e.x, v.root.position.y + 0.14, e.y);
        m.scale.setScalar(1);
      } else {
        const m = take(this.ringGeo, mat);
        const gy = e.def.domain === 'air' ? this.hf.groundAt(v.root.position.x, v.root.position.z) : e.def.domain === 'naval' ? WATER_LEVEL : v.root.position.y;
        m.position.set(v.root.position.x, gy + 0.04, v.root.position.z);
        m.scale.setScalar(e.radius * 0.95 + 0.15);
        // Scouts also show how far they can see.
        if (e.def.scout && e.owner === this.viewer) {
          const vr = take(this.visionGeo, this.visionMat);
          vr.position.set(v.root.position.x, Math.max(WATER_LEVEL, gy) + 0.05, v.root.position.z);
          vr.scale.setScalar(e.def.sight);
        }
      }
    }
    for (let i = n; i < this.ringPool.length; i++) this.ringPool[i].visible = false;

    // Order markers.
    for (const mk of ui.markers.splice(0)) this.markers.push({ ...mk, t: 0 });
    let k = 0;
    this.markers = this.markers.filter((m) => (m.t += dt) < 0.6);
    for (const mk of this.markers) {
      let m = this.markerPool[k];
      if (!m) { m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ transparent: true, depthTest: false })); m.renderOrder = 6; this.scene.add(m); this.markerPool.push(m); }
      m.visible = true;
      m.material.color.set(mk.color);
      m.material.opacity = 1 - mk.t / 0.6;
      m.position.set(mk.x, this.hf.groundAt(mk.x, mk.y) + 0.05, mk.y);
      m.scale.setScalar(0.2 + mk.t * 0.9);
      k++;
    }
    for (let i = k; i < this.markerPool.length; i++) this.markerPool[i].visible = false;

    // Rally points of every selected structure: green, or gold on an oil well.
    let r = 0;
    for (const id of ui.selected) {
      const e = this.game.get(id);
      if (!e || e.kind !== 'building' || e.owner !== this.viewer || !e.rally) continue;
      const m = this.rallyMarker(r++);
      const gold = e.rally.well != null;
      m.line.material.color.set(gold ? '#ffd34d' : '#7dff8a');
      m.cloth.material.color.set(gold ? '#ffd34d' : '#7dff8a');
      const a = new THREE.Vector3(e.x, (this.views.get(e.id)?.root.position.y ?? 0) + 0.5, e.y);
      const c = new THREE.Vector3(e.rally.x, this.hf.groundAt(e.rally.x, e.rally.y), e.rally.y);
      m.line.geometry.setFromPoints([a, c.clone().setY(c.y + 0.2)]);
      m.line.computeLineDistances();
      m.flag.position.copy(c);
      m.cloth.rotation.y = Math.sin(this.time * 3 + r) * 0.25;
      m.line.visible = m.flag.visible = true;
    }
    for (let i = r; i < this.rallyPool.length; i++) this.rallyPool[i].line.visible = this.rallyPool[i].flag.visible = false;
  }

  // Rebuild the road surface mesh when the map's roads change.
  updateRoads() {
    const { map } = this.game;
    if (this.roadVersion === map.roadVersion) return;
    this.roadVersion = map.roadVersion;
    if (!this.roadMat) {
      this.roadMat = patchFow(new THREE.MeshStandardMaterial({
        map: this.roadTex, vertexColors: true, roughness: 0.95,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }), { clouds: true });
    }
    if (this.roadMesh) { this.scene.remove(this.roadMesh); this.roadMesh.geometry.dispose(); }
    this.clearedRoad ||= new Set();
    const pos = [], uv = [], col = [], idx = [];
    const N = 3; // subdivisions per tile so the surface follows the terrain
    const isRoad = (x, y) => map.inBounds(x, y) && map.road[y * map.w + x];
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        if (!isRoad(tx, ty)) continue;
        if (!this.clearedRoad.has(ty * map.w + tx)) {
          this.clearedRoad.add(ty * map.w + tx);
          this.vegetation.userData.clear(tx, ty);
        }
        const base = pos.length / 3;
        for (let j = 0; j <= N; j++) {
          for (let i = 0; i <= N; i++) {
            const x = tx + i / N, z = ty + j / N;
            pos.push(x, Math.max(0.02, this.hf.heightAt(x, z)) + 0.03, z);
            uv.push(x * 0.5, z * 0.5);
            // Dusty verges along edges with no neighbouring road.
            const edge = (i === 0 && !isRoad(tx - 1, ty)) || (i === N && !isRoad(tx + 1, ty)) || (j === 0 && !isRoad(tx, ty - 1)) || (j === N && !isRoad(tx, ty + 1));
            const c = edge ? 0.72 : 1;
            col.push(c * (edge ? 1.12 : 1), c, c * (edge ? 0.9 : 1));
          }
        }
        for (let j = 0; j < N; j++) {
          for (let i = 0; i < N; i++) {
            const a = base + j * (N + 1) + i, b = a + 1, c2 = a + N + 1, d = c2 + 1;
            idx.push(a, c2, b, b, c2, d);
          }
        }
      }
    }
    if (!idx.length) { this.roadMesh = null; return; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.roadMesh = new THREE.Mesh(geo, this.roadMat);
    this.roadMesh.receiveShadow = true;
    this.roadMesh.renderOrder = 1;
    this.scene.add(this.roadMesh);
  }

  rallyMarker(i) {
    if (!this.rallyPool[i]) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineDashedMaterial({ color: '#7dff8a', dashSize: 0.3, gapSize: 0.2, depthTest: false, transparent: true }));
      line.renderOrder = 6;
      const flag = new THREE.Group();
      flag.add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 6).translate(0, 0.4, 0), new THREE.MeshBasicMaterial({ color: '#ddd' })));
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.22).translate(0.18, 0.68, 0), new THREE.MeshBasicMaterial({ color: '#7dff8a', side: THREE.DoubleSide }));
      flag.add(cloth);
      this.scene.add(line, flag);
      this.rallyPool[i] = { line, flag, cloth };
    }
    return this.rallyPool[i];
  }

  updatePlacement(ui) {
    this.updateLineGhosts(ui);
    if (!ui.placing || ui.lineTiles) { this.ghost.visible = false; return; }
    const def = BUILDINGS[ui.placing] || { w: 1, h: 1 };
    const { tx, ty } = ui.placeTile;
    const ok = ui.placing === 'road' ? this.game.canBuildRoad(this.viewer, tx, ty) : this.game.canPlace(this.viewer, ui.placing, tx, ty);
    const color = ok ? '#5f5' : '#f44';
    this.ghost.material.color.set(color);
    this.ghostEdges.material.color.set(color);
    const hgt = ui.placing === 'road' ? 0.06 : 0.8;
    this.ghost.scale.set(def.w, hgt, def.h);
    this.ghost.position.set(tx + def.w / 2, this.hf.maxOver(tx, ty, def.w, def.h) + hgt / 2, ty + def.h / 2);
    this.ghost.visible = true;
  }

  // One translucent tile per segment while dragging out a wall or road.
  updateLineGhosts(ui) {
    if (!this.lineGhost) {
      this.lineGhost = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false }), 64);
      this.lineGhost.frustumCulled = false;
      this.scene.add(this.lineGhost);
    }
    const tiles = ui.placing && ui.lineTiles ? ui.lineTiles : [];
    const road = ui.placing === 'road';
    const m4 = new THREE.Matrix4(), c = new THREE.Color();
    let n = 0;
    for (const t of tiles.slice(0, 64)) {
      const ok = road ? this.game.canBuildRoad(this.viewer, t.x, t.y) : this.game.canPlace(this.viewer, ui.placing, t.x, t.y);
      const h = road ? 0.06 : 0.6;
      m4.makeScale(0.96, h, 0.96).setPosition(t.x + 0.5, this.hf.groundAt(t.x + 0.5, t.y + 0.5) + h / 2, t.y + 0.5);
      this.lineGhost.setMatrixAt(n, m4);
      this.lineGhost.setColorAt(n, c.set(ok ? '#5f5' : '#f44'));
      n++;
    }
    this.lineGhost.count = n;
    this.lineGhost.visible = n > 0;
    this.lineGhost.instanceMatrix.needsUpdate = true;
    if (this.lineGhost.instanceColor) this.lineGhost.instanceColor.needsUpdate = true;
  }

  // 2D overlay: health bars, floating text, selection box.
  drawOverlay(ui, dt) {
    const ctx = this.octx;
    ctx.clearRect(0, 0, this.width, this.height);
    for (const e of this.game.entities.values()) {
      const sel = ui.selected.has(e.id);
      if (!sel && e.hp >= e.maxHp && ui.hoverId !== e.id) continue;
      const v = this.views.get(e.id);
      if (!v || !v.root.visible) continue;
      if (e.owner !== this.viewer && !this.game.isVisibleTo(this.viewer, e)) continue;
      const top = e.kind === 'building' ? 1.6 : e.def.domain === 'air' ? 0.6 : e.def.domain === 'naval' ? 0.8 : 0.65;
      const p = this.project(v.root.position.x, v.root.position.y + top, v.root.position.z);
      if (!p.on) continue;
      const scale = Math.max(0.5, Math.min(1.4, 22 / this.camera.position.distanceTo(v.root.position)));
      const w = (e.kind === 'building' ? 26 * e.w : Math.max(26, e.radius * 64)) * scale;
      const f = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(p.x - w / 2 - 1, p.y - 1, w + 2, 6);
      ctx.fillStyle = f > 0.6 ? '#4ee36a' : f > 0.3 ? '#f2c94c' : '#eb5757';
      ctx.fillRect(p.x - w / 2, p.y, w * f, 4);
      if (e.kind === 'building' && e.queue?.length && e.progress >= 1 && e.owner === this.viewer) {
        const q = e.queue[0];
        ctx.fillStyle = '#ffd34d';
        ctx.fillRect(p.x - w / 2, p.y + 6, w * Math.min(1, q.elapsed / UNITS[q.type].buildTime), 3);
      }
      if (this.recentlyRepaired(e) || (e.repairing && e.owner === this.viewer)) {
        this.drawRepairBadge(ctx, p.x + w / 2 + 12, p.y + 2, !!e.repairStalled && !this.recentlyRepaired(e));
      }
    }
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    this.floaters = this.floaters.filter((f) => (f.life -= dt) > 0);
    for (const f of this.floaters) {
      const p = this.project(f.x, this.hf.groundAt(f.x, f.y) + 0.8 + (1.4 - f.life) * 0.6, f.y);
      if (!p.on) continue;
      ctx.globalAlpha = Math.min(1, f.life);
      ctx.fillStyle = '#000';
      ctx.fillText(f.text, p.x + 1, p.y + 1);
      ctx.fillStyle = '#8dff9a';
      ctx.fillText(f.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    if (ui.drag) {
      const d = ui.drag;
      const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1), w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
      ctx.fillStyle = 'rgba(125,255,138,0.08)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#7dff8a';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    }
  }

  // ------------------------------------------------------------ minimap

  buildMinimapTerrain(size) {
    const { map } = this.game;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const cols = {
      [Terrain.DEEP]: [30, 62, 84], [Terrain.WATER]: [52, 112, 132], [Terrain.SAND]: [205, 186, 136],
      [Terrain.GRASS]: [104, 142, 70], [Terrain.FOREST]: [58, 96, 46], [Terrain.ROCK]: [128, 120, 106],
    };
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const x = (px + 0.5) / size * map.w, y = (py + 0.5) / size * map.h;
        const t = map.get(Math.floor(x), Math.floor(y));
        const col = cols[t];
        // Hill shading from the height field.
        const dh = this.hf.heightAt(x + 0.5, y + 0.5) - this.hf.heightAt(x - 0.5, y - 0.5);
        const shade = t === Terrain.WATER || t === Terrain.DEEP ? 1 : Math.max(0.6, Math.min(1.35, 1 - dh * 0.35));
        const i = (py * size + px) * 4;
        img.data[i] = col[0] * shade; img.data[i + 1] = col[1] * shade; img.data[i + 2] = col[2] * shade; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  renderMinimap(mctx, size) {
    const { game } = this;
    const map = game.map;
    if (!this.miniTerrain) {
      this.miniTerrain = this.buildMinimapTerrain(size);
      this.miniFog = document.createElement('canvas');
      this.miniFog.width = map.w; this.miniFog.height = map.h;
      this.miniFogCtx = this.miniFog.getContext('2d');
      this.miniFogImg = this.miniFogCtx.createImageData(map.w, map.h);
    }
    const s = size / map.w;
    mctx.drawImage(this.miniTerrain, 0, 0);
    const p = game.players[this.viewer];
    mctx.fillStyle = '#4a4a46';
    for (let i = 0; i < map.road.length; i++) {
      if ((map.road[i] || map.bridge[i]) && p.explored[i]) mctx.fillRect((i % map.w) * s, Math.floor(i / map.w) * s, Math.ceil(s), Math.ceil(s));
    }
    for (const w of map.wells) {
      if (w.amount <= 0 || !p.explored[w.y * map.w + w.x]) continue;
      mctx.fillStyle = '#ffcf3d'; mctx.fillRect(w.x * s - 1.5, w.y * s - 1.5, 3, 3);
    }
    for (const [, v] of this.views) {
      const e = v.ent;
      if (!v.root.visible) continue;
      mctx.fillStyle = game.players[e.owner].faction.color;
      if (e.kind === 'building') mctx.fillRect(e.tx * s, e.ty * s, e.w * s, e.h * s);
      else mctx.fillRect(e.x * s - 1.5, e.y * s - 1.5, 3, 3);
    }
    const d = this.miniFogImg.data;
    for (let i = 0; i < p.visible.length; i++) {
      d[i * 4] = 26; d[i * 4 + 1] = 32; d[i * 4 + 2] = 40;
      d[i * 4 + 3] = p.visible[i] ? 0 : p.explored[i] ? 110 : 235;
    }
    this.miniFogCtx.putImageData(this.miniFogImg, 0, 0);
    mctx.imageSmoothingEnabled = true;
    mctx.drawImage(this.miniFog, 0, 0, size, size);
    const q = this.viewQuad();
    mctx.strokeStyle = 'rgba(255,255,255,0.9)';
    mctx.lineWidth = 1;
    mctx.beginPath();
    q.forEach((pt, i) => (i ? mctx.lineTo(pt.x * s, pt.y * s) : mctx.moveTo(pt.x * s, pt.y * s)));
    mctx.closePath();
    mctx.stroke();
  }

  // -------------------------------------------------------------- icons

  iconFor(kind, type) {
    this.icons ||= {};
    const key = kind + ':' + type;
    if (this.icons[key]) return this.icons[key];
    if (!this.iconRenderer) {
      this.iconRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.iconRenderer.setSize(96, 96, false);
      this.iconRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.iconRenderer.outputColorSpace = THREE.SRGBColorSpace;
      this.iconScene = new THREE.Scene();
      this.iconScene.add(new THREE.HemisphereLight('#ffffff', '#555048', 1.6));
      const sun = new THREE.DirectionalLight('#fff3dd', 2.4);
      sun.position.set(-2, 4, 3);
      this.iconScene.add(sun);
      this.iconCam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    }
    const bdef = BUILDINGS[type] || { w: 1, h: 1 };
    const m = kind === 'unit' ? buildUnit(type, this.viewer) : buildStructure(type, this.viewer, bdef.w, bdef.h);
    m.root.rotation.y = kind === 'unit' ? -0.6 : 0.25;
    if (m.blur) m.blur.visible = false;
    if (m.arms) { m.arms[0].visible = true; m.arms[4].visible = true; }
    this.iconScene.add(m.root);
    const box = new THREE.Box3().setFromObject(m.root);
    if (kind === 'building') box.min.y = Math.max(box.min.y, 0);
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(15)) * 0.92;
    this.iconCam.position.set(center.x + dist * 0.45, center.y + dist * 0.62, center.z + dist * 0.65);
    this.iconCam.lookAt(center);
    fowUniforms.fowEnabled.value = 0;
    this.iconRenderer.render(this.iconScene, this.iconCam);
    fowUniforms.fowEnabled.value = 1;
    this.iconScene.remove(m.root);
    this.icons[key] = this.iconRenderer.domElement.toDataURL();
    return this.icons[key];
  }

  dispose() {
    this.renderer.dispose();
    this.iconRenderer?.dispose();
    this.composer?.dispose?.();
  }
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function approachAngle(cur, target, step) {
  const d = angleDiff(target, cur);
  return cur + Math.max(-step, Math.min(step, d));
}
