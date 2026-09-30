import * as THREE from 'three';
import { itemRegistry } from '../../content/src/items';
import type { EntityModels } from './entity-models';

/**
 * The player's own body, seen in the third-person views and the inventory. Poses follow the
 * reference's ModelBiped maths (1.12), converted to this renderer's axes (front −z; a positive
 * x rotation swings a hanging limb forward, so every reference x and y angle changes sign):
 * distance-driven limb swing, a body that lags the head and turns towards the walking direction,
 * sneaking lean, the six-tick arm swing, bow aiming, shield blocking and eating.
 */
export type CameraMode = 'first' | 'back' | 'front';
export interface AvatarFrame {
  /** Feet position this frame (interpolated). */
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  onGround: boolean;
  flying: boolean;
  crouching: boolean;
  sprinting: boolean;
  riding: boolean;
  /** 'eat' | 'bow' | 'block' | null */
  using: 'eat' | 'bow' | 'block' | null;
  /** Main-hand item key, off-hand item key. */
  held: string | null;
  offhand: string | null;
  /** Worn armour item keys: head, chest, legs, feet. */
  armor: readonly (string | null)[];
  mining: boolean;
  dead: boolean;
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Reference per-tick easing turned into a frame-rate independent factor. */
const perTick = (k: number, dt: number) => 1 - Math.pow(1 - k, dt * 20);
const SWING_SECONDS = 0.3;

export interface HeldModel {
  geometry: THREE.BufferGeometry;
  kind: 'block' | 'sprite' | 'tool';
}

export class PlayerAvatar {
  group: THREE.Group;
  variant = -1;
  private joints = new Map<string, THREE.Object3D>();
  private armorMeshes: THREE.Mesh[] = [];
  private bodyYaw = 0;
  private headYaw = 0;
  private limbSwing = 0;
  private limbAmount = 0;
  private speed = 0;
  private last = new THREE.Vector3();
  private placed = false;
  private swingTime = -1;
  private deadFor = 0;
  private crouch = 0;
  /** Items in the hands: real meshes of the terrain atlas, placed on the hand joints each frame. */
  readonly heldMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  readonly offhandMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  private heldKey: string | null = null;
  private offhandKey: string | null = null;
  private readonly spriteMaterial: THREE.MeshLambertMaterial;
  private readonly blockMaterial: THREE.MeshLambertMaterial;
  private readonly shield: THREE.Group;
  private readonly shieldMaterials: THREE.MeshLambertMaterial[] = [];
  private readonly tmp = new THREE.Matrix4();
  private readonly offset = new THREE.Matrix4();
  constructor(
    private readonly models: EntityModels,
    atlas: THREE.Texture,
    private readonly heldModel: (key: string) => HeldModel | null,
    variant = 0,
  ) {
    this.group = new THREE.Group();
    this.spriteMaterial = new THREE.MeshLambertMaterial({
      map: atlas,
      vertexColors: true,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
    });
    this.blockMaterial = new THREE.MeshLambertMaterial({
      map: atlas,
      vertexColors: true,
      alphaTest: 0.35,
    });
    this.heldMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.spriteMaterial);
    this.offhandMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.spriteMaterial);
    for (const m of [this.heldMesh, this.offhandMesh]) {
      m.matrixAutoUpdate = false;
      m.visible = false;
      m.frustumCulled = false;
    }
    // A shield on the off-hand forearm: wooden face with an iron rim, like the first-person one.
    this.shield = new THREE.Group();
    this.shield.matrixAutoUpdate = false;
    this.shield.visible = false;
    const box = (w: number, h: number, d: number, color: string, z: number) => {
      const material = new THREE.MeshLambertMaterial({ color });
      this.shieldMaterials.push(material);
      const mesh = new THREE.Mesh(models.geometry, material);
      mesh.scale.set(w, h, d);
      mesh.position.z = z;
      this.shield.add(mesh);
    };
    box(0.08, 0.72, 0.5, '#84969a', 0);
    box(0.1, 0.64, 0.42, '#a28a63', 0);
    this.setVariant(variant);
  }
  /** Swaps the rig for another skin (or the uploaded one after a repaint). */
  setVariant(variant: number) {
    if (variant === this.variant) return;
    this.variant = variant;
    this.group = this.models.mob('lab:player', variant);
    this.joints.clear();
    this.armorMeshes = [];
    this.group.traverse((o) => {
      if (o.name) this.joints.set(o.name, o);
      if (o instanceof THREE.Mesh && o.userData.armor) this.armorMeshes.push(o);
    });
    this.heldKey = this.offhandKey = null;
  }
  /** Starts the six-tick arm swing (a punch, a placed block, an attack). */
  punch(time: number) {
    const progress = this.swingTime < 0 ? 1 : (time - this.swingTime) / SWING_SECONDS;
    // A swing already under way is not restarted before its midpoint, like the reference.
    if (progress >= 0.5) this.swingTime = time;
  }
  /** Hand items for this frame; meshes are only rebuilt when the item changes. */
  private syncItems(held: string | null, offhand: string | null) {
    if (held !== this.heldKey) {
      this.heldKey = held;
      const model = held && itemRegistry.find(held)?.use !== 'shield' ? this.heldModel(held) : null;
      this.heldMesh.visible = !!model;
      if (model) {
        this.heldMesh.geometry = model.geometry;
        this.heldMesh.material = model.kind === 'block' ? this.blockMaterial : this.spriteMaterial;
        this.heldMesh.userData.kind = model.kind;
      }
    }
    if (offhand !== this.offhandKey) this.offhandKey = offhand;
    const shieldHeld = held && itemRegistry.find(held)?.use === 'shield';
    this.shield.visible = offhand === 'lab:shield' || !!shieldHeld;
    this.shield.userData.side = shieldHeld ? 1 : -1;
    this.offhandMesh.visible = false;
  }
  /** Poses the rig for this frame and returns it; the caller batches `group`. */
  update(f: AvatarFrame, dt: number, time: number, reduced: boolean): THREE.Group {
    const g = this.group,
      m = reduced ? 0 : 1;
    // Walking speed from the interpolated feet, so the stride matches what is on screen.
    if (!this.placed) {
      this.last.set(f.x, f.y, f.z);
      this.bodyYaw = this.headYaw = f.yaw;
      this.placed = true;
    }
    const dx = f.x - this.last.x,
      dz = f.z - this.last.z;
    this.last.set(f.x, f.y, f.z);
    const moved = Math.hypot(dx, dz);
    if (moved > 3) {
      this.bodyYaw = f.yaw;
      this.speed = 0;
    } else if (dt > 0) this.speed += (moved / dt - this.speed) * Math.min(1, dt * 14);
    // Reference limb swing: the amount eases towards four times the distance per tick.
    const tickDistance = f.riding ? 0 : this.speed / 20;
    const target = Math.min(1, tickDistance * 4) * m * (f.flying ? 0.35 : 1);
    this.limbAmount += (target - this.limbAmount) * perTick(0.4, dt);
    this.limbSwing += this.limbAmount * dt * 20;
    const swing = this.limbAmount,
      phase = this.limbSwing * 0.6662;
    // Body yaw: faces the direction of travel (or its opposite when backing up), otherwise stays
    // put until the head turns more than 50°; never more than 75° from the head.
    this.headYaw = f.yaw;
    let bodyTarget = this.bodyYaw;
    if (this.speed > 0.4 && moved > 0) {
      const travel = Math.atan2(-dx, -dz);
      const back = Math.abs(wrap(travel - f.yaw)) > Math.PI * 0.55;
      bodyTarget = back ? travel + Math.PI : travel;
      // Strafing sideways the body turns only half way, as in the reference.
      const off = wrap(bodyTarget - f.yaw);
      bodyTarget = f.yaw + clamp(off, -Math.PI / 4, Math.PI / 4);
    }
    const swinging = this.swingTime >= 0 && time - this.swingTime < SWING_SECONDS;
    if (swinging || f.using === 'bow') bodyTarget = f.yaw;
    this.bodyYaw += wrap(bodyTarget - this.bodyYaw) * (reduced ? 1 : perTick(0.3, dt));
    const idleLimit = (50 * Math.PI) / 180,
      hardLimit = (75 * Math.PI) / 180;
    let rel = wrap(f.yaw - this.bodyYaw);
    if (this.speed <= 0.4 && Math.abs(rel) > idleLimit) {
      this.bodyYaw = f.yaw - Math.sign(rel) * idleLimit;
      rel = wrap(f.yaw - this.bodyYaw);
    }
    if (Math.abs(rel) > hardLimit) {
      this.bodyYaw = f.yaw - Math.sign(rel) * hardLimit;
      rel = wrap(f.yaw - this.bodyYaw);
    }
    this.crouch = reduced
      ? Number(f.crouching)
      : this.crouch + (Number(f.crouching) - this.crouch) * Math.min(1, dt * 16);
    const c = this.crouch;
    // Arm swing progress (0..1) and the reference's eased copy of it.
    const sp =
      swinging || f.mining ? ((time - Math.max(0, this.swingTime)) / SWING_SECONDS) % 1 : 0;
    if (f.mining && !swinging) this.swingTime = time - sp * SWING_SECONDS;
    const s1 = 1 - Math.pow(1 - sp, 4);
    const twist = sp > 0 ? -Math.sin(Math.sqrt(sp) * Math.PI * 2) * 0.2 * m : 0;
    const s = 1 / 16;
    this.deadFor = f.dead ? this.deadFor + dt : 0;
    const heldItem = !!f.held;
    for (const [name, p] of this.joints) {
      const rest = p.userData.restPosition as THREE.Vector3 | undefined,
        restRot = p.userData.restRotation as THREE.Euler | undefined;
      if (!rest || !restRot) continue;
      p.position.copy(rest);
      p.rotation.copy(restRot);
      if (name === 'head') {
        p.rotation.y = rel;
        p.rotation.x = f.pitch;
        p.position.y -= c * 1 * s;
      } else if (name === 'body') {
        p.rotation.y = twist;
        p.rotation.x = -0.5 * c;
      } else if (name.startsWith('leg-')) {
        const right = name === 'leg-1-0';
        p.rotation.x = Math.cos(phase + (right ? 0 : Math.PI)) * 1.4 * swing;
        p.position.z += 4 * s * c;
        p.position.y += 3 * s * c;
        if (f.riding) {
          p.rotation.x = 1.4137;
          p.rotation.y = (right ? -1 : 1) * (Math.PI / 10);
        }
      } else if (name.startsWith('arm-')) {
        const right = name === 'arm-1',
          side = right ? 1 : -1;
        let x = Math.cos(phase + (right ? Math.PI : 0)) * swing,
          y = 0,
          z = 0;
        if (f.riding) x = Math.PI / 5;
        // Holding something: the main arm comes up a little (reference: x·0.5 − π/10).
        if (right && heldItem) x = x * 0.5 + Math.PI / 10;
        // Idle breathing sway, outwards.
        z += side * (Math.cos(time * 1.8) * 0.05 + 0.05) * m;
        x += side * Math.sin(time * 1.34) * 0.05 * m;
        if (f.using === 'block') {
          const shieldHand = this.shield.userData.side === 1 ? right : !right;
          if (shieldHand) {
            x = x * 0.5 + 0.94;
            y = side * 0.52;
          }
        }
        if (f.using === 'bow') {
          x = Math.PI / 2 + f.pitch;
          y = rel + (right ? 0.1 : -0.5);
          z = 0;
        }
        if (f.using === 'eat' && right) {
          // Hand to the mouth, bobbing with each bite.
          x = 1.25 + Math.sin(time * 16) * 0.12 * m + f.pitch * 0.5;
          y = 0.45;
          z = 0;
        }
        if (right && sp > 0) {
          x += Math.sin(s1 * Math.PI) * 1.2 + Math.sin(sp * Math.PI) * (f.pitch + 0.7) * 0.75;
          y += twist * 2;
          z -= Math.sin(sp * Math.PI) * 0.4;
        }
        // Shoulders follow the body's twist.
        if (twist) {
          const px = rest.x;
          p.position.x = px * Math.cos(twist);
          p.position.z = rest.z - px * Math.sin(twist);
        }
        p.rotation.set(x - 0.4 * c, y, z);
      }
    }
    // The whole body turns with the body yaw and sinks two pixels when sneaking.
    g.position.set(f.x, f.y - c * 2 * s, f.z);
    g.rotation.set(0, this.bodyYaw, 0);
    if (this.deadFor > 0) g.rotation.z = Math.min(1, Math.sqrt(this.deadFor * 1.6)) * Math.PI * 0.5;
    // Armour: show each worn piece in its own material.
    for (const mesh of this.armorMeshes) {
      const a = mesh.userData.armor as { slot: number; material: string };
      const key = f.armor[a.slot];
      mesh.visible = !!key && armorMaterial(key) === a.material;
    }
    this.syncItems(f.held, f.offhand);
    g.updateMatrixWorld(true);
    this.placeItems(f);
    return g;
  }
  private placeItems(f: AvatarFrame) {
    const hand = this.joints.get('hand-1'),
      off = this.joints.get('hand--1');
    if (hand && this.heldMesh.visible) {
      const kind = this.heldMesh.userData.kind as HeldModel['kind'];
      if (kind === 'block') {
        // Blocks sit in the fist at the reference's 3/8 scale, turned 45°.
        this.offset.compose(
          new THREE.Vector3(0, -0.06, -0.12),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, Math.PI / 4, 0)),
          new THREE.Vector3(0.375, 0.375, 0.375),
        );
      } else {
        // A sprite held edge-on: the diagonal (handle → tip) points forward along the forearm's
        // normal, the handle in the fist. Tools are larger than plain items.
        const size = kind === 'tool' ? 0.78 : 0.5;
        const q = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            kind === 'tool' ? -Math.PI / 4 : -Math.PI / 2 + 0.2,
            Math.PI / 2,
            0,
            'YXZ',
          ),
        );
        const grip = new THREE.Vector3(0, 0, kind === 'tool' ? -0.707 * size * 0.78 : -0.2);
        this.offset.compose(
          grip.add(new THREE.Vector3(0, -0.02, 0)),
          q,
          new THREE.Vector3(size, size, size),
        );
      }
      this.tmp.multiplyMatrices(hand.matrixWorld, this.offset);
      this.heldMesh.matrix.copy(this.tmp);
      this.heldMesh.matrixWorld.copy(this.tmp);
    }
    const holder = this.shield.userData.side === 1 ? hand : off;
    if (holder && this.shield.visible) {
      const side = this.shield.userData.side as number;
      this.offset.compose(
        new THREE.Vector3(side * 0.04, 0.12, -0.06),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)),
        new THREE.Vector3(1, 1, 1),
      );
      this.shield.matrix.multiplyMatrices(holder.matrixWorld, this.offset);
      this.shield.updateMatrixWorld(true);
    }
    void f;
  }
  /** Meshes that live outside the instanced rig batches (items in hand, the shield). */
  get extras(): THREE.Object3D[] {
    return [this.heldMesh, this.offhandMesh, this.shield];
  }
  reset() {
    this.placed = false;
    this.swingTime = -1;
    this.deadFor = 0;
  }
  dispose() {
    this.spriteMaterial.dispose();
    this.blockMaterial.dispose();
    for (const m of this.shieldMaterials) m.dispose();
  }
}
/** `lab:iron_helmet` → 'iron'; unknown materials show as iron. */
export function armorMaterial(key: string): string {
  const m = /^lab:(leather|chain|chainmail|iron|gold|golden|diamond)_/.exec(key);
  if (!m) return 'iron';
  return m[1] === 'golden' ? 'gold' : m[1] === 'chainmail' ? 'chain' : m[1];
}

/**
 * Cells that stop the camera near the eye, from the core's 11³ bit grid. A third-person camera
 * casts five rays (centre and four corners of the near plane, like the reference) and stops
 * just short of the first solid cell.
 */
export class CameraRoom {
  private grid: { x: number; y: number; z: number; size: number; bits: Uint8Array } | null = null;
  set(grid: { x: number; y: number; z: number; size: number; bits: Uint8Array } | undefined) {
    if (grid) this.grid = grid;
  }
  private solid(x: number, y: number, z: number) {
    const g = this.grid;
    if (!g) return false;
    const i = x - g.x,
      j = y - g.y,
      k = z - g.z;
    if (i < 0 || j < 0 || k < 0 || i >= g.size || j >= g.size || k >= g.size) return false;
    const n = (j * g.size + k) * g.size + i;
    return (g.bits[n >> 3] & (1 << (n & 7))) !== 0;
  }
  /** Distance along a ray until the first solid cell (Amanatides–Woo voxel walk). */
  private cast(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    max: number,
  ) {
    let x = Math.floor(ox),
      y = Math.floor(oy),
      z = Math.floor(oz);
    if (this.solid(x, y, z)) return 0;
    const sx = Math.sign(dx),
      sy = Math.sign(dy),
      sz = Math.sign(dz);
    const tdx = sx ? Math.abs(1 / dx) : Infinity,
      tdy = sy ? Math.abs(1 / dy) : Infinity,
      tdz = sz ? Math.abs(1 / dz) : Infinity;
    let tx = sx ? (sx > 0 ? x + 1 - ox : ox - x) * tdx : Infinity,
      ty = sy ? (sy > 0 ? y + 1 - oy : oy - y) * tdy : Infinity,
      tz = sz ? (sz > 0 ? z + 1 - oz : oz - z) * tdz : Infinity;
    let t = 0;
    while (t < max) {
      if (tx < ty && tx < tz) {
        t = tx;
        tx += tdx;
        x += sx;
      } else if (ty < tz) {
        t = ty;
        ty += tdy;
        y += sy;
      } else {
        t = tz;
        tz += tdz;
        z += sz;
      }
      if (t >= max) break;
      if (this.solid(x, y, z)) return t;
    }
    return max;
  }
  /** How far the camera may back away from `eye` along `dir` (unit), at most `max`. */
  distance(eye: THREE.Vector3, dir: THREE.Vector3, max: number) {
    let best = max;
    const right = new THREE.Vector3(dir.z, 0, -dir.x);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    for (const [a, b] of [
      [0, 0],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const ox = eye.x + (right.x * a + up.x * b) * 0.1,
        oy = eye.y + (right.y * a + up.y * b) * 0.1,
        oz = eye.z + (right.z * a + up.z * b) * 0.1;
      best = Math.min(best, this.cast(ox, oy, oz, dir.x, dir.y, dir.z, max) - 0.1);
    }
    return Math.max(0, best);
  }
}
