import * as THREE from 'three';
import type { WeatherSnapshot } from '../../core/src/weather';
import { WEATHER_GRID_RADIUS } from '../../core/src/weather';

const MAX_DROPS = 1100;
const RADIUS = 11;

/**
 * Rain and snow around the camera, and lightning. Drops live in world space, fall to the top
 * rain-stopping block the simulation reported for their column, and are recycled above the
 * player — so it rains outside a window but not under a roof. Presentation only.
 */
export class WeatherView {
  readonly drops: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  private readonly bolt: THREE.Group;
  private readonly boltMaterial: THREE.MeshBasicMaterial;
  private readonly x = new Float32Array(MAX_DROPS);
  private readonly y = new Float32Array(MAX_DROPS);
  private readonly z = new Float32Array(MAX_DROPS);
  private readonly phase = new Float32Array(MAX_DROPS);
  private readonly matrix = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private state: WeatherSnapshot | null = null;
  private seed = 0x2545f491;
  private lastStrike = -1;
  private boltLeft = 0;
  private kind: 'rain' | 'snow' | 'none' = 'none';
  private eyeY = 64;
  /** 0..1, the sky flash of the latest strike; the atmosphere adds it to the light. */
  flash = 0;
  /** Where drops land close by; the scene turns these into little splashes. */
  onSplash: ((x: number, y: number, z: number) => void) | null = null;
  /** A new strike: where it hit, for thunder. */
  onStrike: ((x: number, z: number) => void) | null = null;

  constructor(scene: THREE.Scene) {
    this.drops = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({
        color: '#9db2cf',
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      }),
      MAX_DROPS,
    );
    this.drops.count = 0;
    this.drops.visible = false;
    this.drops.frustumCulled = false;
    this.drops.renderOrder = 2;
    this.drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.drops);
    this.boltMaterial = new THREE.MeshBasicMaterial({
      color: '#eef4ff',
      fog: false,
      transparent: true,
    });
    this.bolt = new THREE.Group();
    this.bolt.visible = false;
    for (let i = 0; i < 14; i++)
      this.bolt.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.boltMaterial));
    scene.add(this.bolt);
    for (let i = 0; i < MAX_DROPS; i++) this.y[i] = -1e9;
  }
  private random() {
    // xorshift: presentation-only noise, never the gameplay RNG.
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }
  sync(weather: WeatherSnapshot | undefined, tick: number) {
    this.state = weather ?? null;
    const strike = weather?.lightning;
    if (strike && strike.tick !== this.lastStrike) {
      const fresh = this.lastStrike >= 0 || tick - strike.tick < 3;
      this.lastStrike = strike.tick;
      if (fresh && tick - strike.tick < 6) this.strike(strike.x, strike.z);
    }
  }
  /** Where a drop in this column stops: the reported top, or well below the eye when unknown. */
  private floorAt(x: number, z: number, eye: number) {
    const w = this.state;
    if (!w?.tops) return eye - 14;
    const r = WEATHER_GRID_RADIUS,
      gx = Math.floor(x) - w.ox + r,
      gz = Math.floor(z) - w.oz + r;
    if (gx < 0 || gz < 0 || gx > 2 * r || gz > 2 * r) return eye - 14;
    return w.tops[gz * (2 * r + 1) + gx];
  }
  private strike(x: number, z: number) {
    this.flash = 1;
    this.boltLeft = 0.32;
    const ground = this.floorAt(x, z, this.eyeY);
    let px = x + 0.5,
      pz = z + 0.5,
      py = ground + 70;
    const step = (py - ground) / this.bolt.children.length;
    for (const segment of this.bolt.children) {
      const nx = px + (this.random() - 0.5) * 3.2,
        nz = pz + (this.random() - 0.5) * 3.2,
        ny = py - step;
      const m = segment as THREE.Mesh;
      m.position.set((px + nx) / 2, (py + ny) / 2, (pz + nz) / 2);
      const length = Math.hypot(nx - px, step, nz - pz);
      m.scale.set(0.22, length, 0.22);
      m.lookAt(nx, ny, nz);
      m.rotateX(Math.PI / 2);
      px = nx;
      pz = nz;
      py = ny;
    }
    this.bolt.visible = true;
    this.onStrike?.(x, z);
  }
  advance(dt: number, time: number, camera: THREE.Camera, amount: number, reduced: boolean) {
    const w = this.state;
    this.eyeY = camera.position.y;
    this.flash = Math.max(0, this.flash - dt * 2.6);
    if (this.boltLeft > 0) {
      this.boltLeft -= dt;
      // The bolt flickers: two bright beats, then gone.
      this.boltMaterial.opacity = Math.sin(this.boltLeft * 40) > -0.3 ? 1 : 0.15;
      if (this.boltLeft <= 0) this.bolt.visible = false;
    }
    const kind = w && w.rain > 0 ? w.kind : 'none';
    const count = reduced || kind === 'none' ? 0 : Math.floor(MAX_DROPS * amount * (w?.rain ?? 0));
    if (kind !== this.kind) {
      this.kind = kind;
      this.drops.material.color.set(kind === 'snow' ? '#f4f7fb' : '#9db2cf');
      this.drops.material.opacity = kind === 'snow' ? 0.92 : 0.5;
      for (let i = 0; i < MAX_DROPS; i++) this.y[i] = -1e9;
    }
    this.drops.visible = count > 0;
    if (!count) {
      this.drops.count = 0;
      return;
    }
    const eye = camera.position;
    this.eyeY = eye.y;
    const snow = kind === 'snow',
      fall = snow ? 1.6 : 17,
      thunder = w?.thunder ?? 0,
      wind = snow ? 0.3 : 1.4 + thunder * 2.2;
    let shown = 0;
    for (let i = 0; i < count; i++) {
      let floor = this.floorAt(this.x[i], this.z[i], eye.y);
      const far = Math.hypot(this.x[i] - eye.x, this.z[i] - eye.z) > RADIUS;
      if (this.y[i] <= floor || far || this.y[i] < eye.y - 14) {
        if (!far && this.y[i] > -1e8 && this.y[i] <= floor && !snow && this.random() < 0.18) {
          const d = Math.hypot(this.x[i] - eye.x, this.z[i] - eye.z);
          if (d < 7) this.onSplash?.(this.x[i], floor, this.z[i]);
        }
        // Respawn in a disc around the eye, from above; spread the first fall over the height.
        const a = this.random() * Math.PI * 2,
          r = Math.sqrt(this.random()) * RADIUS;
        this.x[i] = eye.x + Math.cos(a) * r;
        this.z[i] = eye.z + Math.sin(a) * r;
        this.y[i] = eye.y + 6 + this.random() * 12;
        this.phase[i] = this.random() * Math.PI * 2;
        floor = this.floorAt(this.x[i], this.z[i], eye.y);
        // The column is roofed above the drop: it never shows here.
        if (floor >= this.y[i]) continue;
      }
      this.y[i] -= fall * dt;
      this.x[i] += (snow ? Math.sin(time * 1.3 + this.phase[i]) * 0.5 : wind) * dt;
      this.z[i] += (snow ? Math.cos(time * 1.1 + this.phase[i]) * 0.4 : wind * 0.35) * dt;
      if (this.y[i] <= floor) continue;
      // Right at the eyes a drop would fill the screen: those are skipped, as in the reference.
      if ((this.x[i] - eye.x) ** 2 + (this.y[i] - eye.y) ** 2 + (this.z[i] - eye.z) ** 2 < 2.2)
        continue;
      this.p.set(this.x[i], this.y[i], this.z[i]);
      if (snow) {
        this.s.setScalar(0.05 + (i % 3) * 0.012);
        this.q.setFromEuler(this.e.set(this.phase[i] + time, this.phase[i] * 2, 0));
      } else {
        this.s.set(0.03, 0.7 + (i % 4) * 0.08, 0.03);
        this.q.setFromEuler(this.e.set(0.05 + thunder * 0.08, 0, -0.08 - thunder * 0.1));
      }
      this.matrix.compose(this.p, this.q, this.s);
      this.drops.setMatrixAt(shown++, this.matrix);
    }
    this.drops.count = shown;
    this.drops.instanceMatrix.clearUpdateRanges();
    this.drops.instanceMatrix.addUpdateRange(0, shown * 16);
    this.drops.instanceMatrix.needsUpdate = true;
  }
  reset() {
    for (let i = 0; i < MAX_DROPS; i++) this.y[i] = -1e9;
    this.drops.count = 0;
    this.drops.visible = false;
    this.bolt.visible = false;
    this.flash = 0;
    this.lastStrike = -1;
  }
  dispose() {
    this.drops.removeFromParent();
    this.drops.geometry.dispose();
    this.drops.material.dispose();
    this.bolt.removeFromParent();
    for (const c of this.bolt.children) (c as THREE.Mesh).geometry.dispose();
    this.boltMaterial.dispose();
  }
}
