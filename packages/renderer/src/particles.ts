import * as THREE from 'three';
import type { VisualEvent } from '../../core/src/visual-events';
import { pixelNoise } from './pixel-art';
export type AmbientKind =
  | 'fire'
  | 'portal'
  | 'lava'
  | 'trail'
  | 'drip-water'
  | 'drip-lava'
  | 'bubble'
  | 'splash'
  /** A small red heart rising over an animal in love. */
  | 'heart'
  /** Grey smoke curling off a burning creature. */
  | 'smoke';
/** Fixed-size recyclable voxel particles. No individual meshes, timers or gameplay RNG use. */
export class VoxelParticles {
  readonly mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly position = new Float32Array(320 * 3);
  private readonly velocity = new Float32Array(320 * 3);
  private readonly life = new Float32Array(320);
  private readonly total = new Float32Array(320);
  private readonly size = new Float32Array(320);
  private readonly floor = new Float32Array(320);
  private readonly gravity = new Float32Array(320);
  private readonly colors = new Float32Array(320 * 3);
  /** 0: shrinks away at the end of its life; 1: smoke, grows as it fades; 2: holds, then drops. */
  private readonly mode = new Uint8Array(320);
  private cursor = 0;
  private sequence = 0;
  private eventId = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly color = new THREE.Color();
  limit = 160;
  enabled = true;
  active = 0;
  constructor(
    scene: THREE.Scene,
    geometry: THREE.BufferGeometry,
    private readonly blockColor: (id: number) => THREE.Color,
  ) {
    this.mesh = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshBasicMaterial({
        vertexColors: false,
        transparent: true,
        opacity: 0.86,
        depthWrite: false,
      }),
      320,
    );
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, this.color);
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
  }
  consume(events: readonly VisualEvent[], tick: number, camera: THREE.Vector3) {
    for (const e of events) {
      if (e.id <= this.eventId) continue;
      this.eventId = e.id;
      if (
        !this.enabled ||
        tick - e.tick > 12 ||
        (e.x - camera.x) ** 2 + (e.y - camera.y) ** 2 + (e.z - camera.z) ** 2 > 48 ** 2
      )
        continue;
      this.emit(e);
    }
  }
  emit(e: VisualEvent) {
    if (!this.enabled) return;
    if (e.kind === 'teleport') {
      // Purple motes drifting out of the space an enderman just left or filled.
      for (let i = 0; i < Math.min(this.limit, 28); i++) {
        const n = this.sequence + 1,
          r = (k: number) => pixelNoise(n, 40 + k);
        this.place(
          e.x + (r(0) - 0.5) * 0.9,
          e.y + (r(1) - 0.5) * 2.6,
          e.z + (r(2) - 0.5) * 0.9,
          this.vary(r(3) < 0.5 ? '#c85cf0' : '#7b2fa8', 0.2),
          {
            vx: (r(4) - 0.5) * 0.6,
            vy: (r(5) - 0.3) * 0.5,
            vz: (r(6) - 0.5) * 0.6,
            life: 0.6 + r(7) * 0.6,
            size: 0.07,
            gravity: 0,
          },
        );
      }
      return;
    }
    const counts = {
      break: 14,
      place: 4,
      hit: 9,
      death: 18,
      explosion: 36,
      splash: 14,
      land: 8,
      crystal: 28,
      pickup: 4,
      sound: 0,
      teleport: 0,
    };
    const color =
      e.block === undefined
        ? this.color.set(
            e.kind === 'crystal'
              ? '#c48ff2'
              : e.kind === 'hit'
                ? '#f3d69a'
                : e.kind === 'splash'
                  ? '#79c7db'
                  : e.kind === 'explosion'
                    ? '#e6b776'
                    : '#d5dfd0',
          )
        : this.blockColor(e.block);
    for (let i = 0; i < Math.min(this.limit, counts[e.kind]); i++)
      this.spawn(
        e.x,
        e.y,
        e.z,
        color,
        e.kind === 'splash' ? 2.2 : e.kind === 'explosion' ? 3.8 : e.kind === 'hit' ? 2 : 1.7,
        e.kind === 'explosion' ? 1.1 : 0.65,
        e.kind === 'hit' ? 0.05 : 0.065,
        e.kind === 'crystal' ? -1 : 6,
        e.strength,
      );
  }
  private spawn(
    x: number,
    y: number,
    z: number,
    color: THREE.Color,
    speed: number,
    lifetime: number,
    size: number,
    gravity: number,
    strength = 1,
  ) {
    const i = this.cursor++ % Math.max(1, this.limit),
      n = ++this.sequence,
      a = pixelNoise(n, 1) * Math.PI * 2,
      v = 0.5 + pixelNoise(n, 2),
      s = speed * Math.min(2, Math.sqrt(strength));
    this.position.set(
      [x + (pixelNoise(n, 3) - 0.5) * 0.3, y, z + (pixelNoise(n, 4) - 0.5) * 0.3],
      i * 3,
    );
    this.velocity.set(
      [Math.cos(a) * s * v, (0.7 + pixelNoise(n, 5)) * s, Math.sin(a) * s * v],
      i * 3,
    );
    this.life[i] = this.total[i] = lifetime * (0.65 + pixelNoise(n, 6) * 0.65);
    this.size[i] = size * (0.65 + pixelNoise(n, 7) * 0.7);
    this.floor[i] = y - 0.48;
    this.gravity[i] = gravity;
    this.mode[i] = 0;
    this.colors.set([color.r, color.g, color.b], i * 3);
    return i;
  }
  /** A particle with an exact start: no burst velocity, a set drift and a set look. */
  private place(
    x: number,
    y: number,
    z: number,
    color: THREE.Color,
    o: {
      vx?: number;
      vy?: number;
      vz?: number;
      life: number;
      size: number;
      gravity: number;
      mode?: number;
      floor?: number;
    },
  ) {
    const i = this.spawn(x, y, z, color, 0, o.life, o.size, o.gravity);
    this.position.set([x, y, z], i * 3);
    const n = this.sequence;
    this.velocity.set(
      [
        (o.vx ?? 0) + (pixelNoise(n, 8) - 0.5) * 0.05,
        o.vy ?? 0,
        (o.vz ?? 0) + (pixelNoise(n, 9) - 0.5) * 0.05,
      ],
      i * 3,
    );
    this.mode[i] = o.mode ?? 0;
    this.floor[i] = o.floor ?? -1e9;
    return i;
  }
  /** Shade a colour by up to ±amount, so a stream of particles is not one flat tint. */
  private vary(hex: string, amount: number) {
    const k = 1 + (pixelNoise(this.sequence + 1, 11) - 0.5) * 2 * amount;
    return this.color.set(hex).multiplyScalar(k);
  }
  /** Bits of the block being mined, knocked off the face being hit. */
  chip(x: number, y: number, z: number, block: number) {
    if (!this.enabled) return;
    const c = this.color.copy(this.blockColor(block));
    this.spawn(x, y, z, c, 1.1, 0.45, 0.08, 9);
  }
  ambient(x: number, y: number, z: number, kind: AmbientKind) {
    if (!this.enabled) return;
    const n = this.sequence + 1,
      r = (k: number) => pixelNoise(n, 20 + k);
    switch (kind) {
      case 'fire':
        // A flame licking up, and every few flames a puff of smoke rising on from it.
        this.place(
          x + (r(0) - 0.5) * 0.08,
          y,
          z + (r(1) - 0.5) * 0.08,
          this.vary('#ffb13b', 0.18),
          {
            vy: 0.18 + r(2) * 0.12,
            life: 0.35 + r(3) * 0.25,
            size: 0.1,
            gravity: 0,
          },
        );
        if (r(4) < 0.35)
          this.place(x, y + 0.12, z, this.vary('#5b5753', 0.2), {
            vy: 0.45 + r(5) * 0.2,
            life: 1.1 + r(6) * 0.6,
            size: 0.12,
            gravity: 0,
            mode: 1,
          });
        return;
      case 'lava':
        // Lava pops: a bright ember thrown up that falls back, now and then with smoke.
        if (r(0) < 0.55) {
          this.place(x + (r(1) - 0.5) * 0.6, y, z + (r(2) - 0.5) * 0.6, this.vary('#ff8a24', 0.2), {
            vx: (r(3) - 0.5) * 1.2,
            vy: 2.2 + r(4) * 1.6,
            vz: (r(5) - 0.5) * 1.2,
            life: 1.1,
            size: 0.1,
            gravity: 9,
            floor: y - 0.35,
          });
        } else
          this.place(
            x + (r(1) - 0.5) * 0.6,
            y + 0.1,
            z + (r(2) - 0.5) * 0.6,
            this.vary('#4a4643', 0.2),
            {
              vy: 0.5,
              life: 1.4,
              size: 0.13,
              gravity: 0,
              mode: 1,
            },
          );
        return;
      case 'portal':
        this.place(
          x + (r(0) - 0.5) * 0.9,
          y - 0.6 + r(1) * 0.9,
          z + (r(2) - 0.5) * 0.9,
          this.vary(r(3) < 0.5 ? '#bd94e6' : '#8b5fd6', 0.15),
          {
            vx: (r(4) - 0.5) * 0.5,
            vy: (r(5) - 0.3) * 0.6,
            vz: (r(6) - 0.5) * 0.5,
            life: 0.9 + r(7) * 0.6,
            size: 0.07,
            gravity: 0,
          },
        );
        return;
      case 'drip-water':
      case 'drip-lava':
        // A drop gathers under the block, hangs a moment, then falls.
        this.place(x, y, z, this.vary(kind === 'drip-water' ? '#4f86d6' : '#ff7a1c', 0.1), {
          life: 1.6,
          size: 0.07,
          gravity: 0,
          mode: 2,
        });
        return;
      case 'bubble':
        this.place(x, y, z, this.vary('#cfe6ef', 0.1), {
          vx: (r(0) - 0.5) * 0.2,
          vy: 0.9 + r(1) * 0.5,
          vz: (r(2) - 0.5) * 0.2,
          life: 0.9 + r(3) * 0.8,
          size: 0.07,
          gravity: 0,
        });
        return;
      case 'splash':
        this.place(x, y + 0.02, z, this.vary('#9fb8d8', 0.1), {
          vx: (r(0) - 0.5) * 1.2,
          vy: 1.1 + r(1) * 0.8,
          vz: (r(2) - 0.5) * 1.2,
          life: 0.3,
          size: 0.05,
          gravity: 12,
          floor: y,
        });
        return;
      case 'heart':
        this.place(x + (r(0) - 0.5) * 0.5, y, z + (r(1) - 0.5) * 0.5, this.vary('#e8384f', 0.1), {
          vy: 0.45 + r(2) * 0.2,
          life: 1.1,
          size: 0.13,
          gravity: 0,
        });
        return;
      case 'smoke':
        this.place(x, y, z, this.vary('#3b3a3a', 0.2), {
          vx: (r(0) - 0.5) * 0.2,
          vy: 0.5 + r(1) * 0.4,
          vz: (r(2) - 0.5) * 0.2,
          life: 0.8 + r(3) * 0.5,
          size: 0.09,
          gravity: 0,
        });
        return;
      case 'trail':
      default:
        this.color.set('#d7cba4');
        this.spawn(x, y, z, this.color, 0.04, 0.25, 0.025, -0.15);
    }
  }
  advance(dt: number) {
    let count = 0;
    for (let i = 0; i < 320; i++) {
      if (i >= this.limit || !this.enabled) {
        this.life[i] = 0;
        continue;
      }
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      const o = i * 3;
      // A drop hangs for its first half second, then drops like a stone.
      if (this.mode[i] === 2 && this.total[i] - this.life[i] > 0.5) this.gravity[i] = 18;
      this.velocity[o + 1] -= this.gravity[i] * dt;
      for (let j = 0; j < 3; j++) this.position[o + j] += this.velocity[o + j] * dt;
      if (this.position[o + 1] < this.floor[i] && this.gravity[i] > 0) {
        this.position[o + 1] = this.floor[i];
        this.velocity[o + 1] *= -0.18;
        this.velocity[o] *= 0.72;
        this.velocity[o + 2] *= 0.72;
      }
      this.p.fromArray(this.position, o);
      const left = this.life[i] / this.total[i];
      this.s.setScalar(
        this.size[i] *
          (this.mode[i] === 1 ? (1.6 - left) * Math.min(1, left * 4) : Math.min(1, left * 3)),
      );
      this.matrix.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(count, this.matrix);
      this.color.fromArray(this.colors, o);
      this.mesh.setColorAt(count, this.color);
      count++;
    }
    this.mesh.count = this.active = count;
    this.mesh.visible = count > 0;
    if (count) {
      this.mesh.instanceMatrix.clearUpdateRanges();
      this.mesh.instanceMatrix.addUpdateRange(0, count * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor!.clearUpdateRanges();
      this.mesh.instanceColor!.addUpdateRange(0, count * 3);
      this.mesh.instanceColor!.needsUpdate = true;
    }
  }
  reset() {
    this.life.fill(0);
    this.mesh.count = this.active = 0;
    this.mesh.visible = false;
    this.eventId = 0;
  }
  dispose() {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.mesh.material.dispose();
  }
}
