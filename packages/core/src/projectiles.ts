/**
 * Projectiles (arrows, blaze fireballs, thrown eggs) and experience orbs. Both are light entities: a few numbers, gravity and a
 * collision test, kept out of the item store so their rules stay readable.
 */
import { registry } from '../../content/src/blocks';
import type { Vec3 } from './coordinates';
import type { VoxelWorld } from './world';
import { ARROW_DRAG, ARROW_GRAVITY, ARROW_LIFETIME, BOW_CHARGE_TICKS } from './combat';
export const ARROW_HIT_RADIUS = 0.3;
export const ARROW_STUCK_LIFETIME = 1200;
export const ARROW_PICKUP_DELAY = 10;
/** Small fireballs fly straight, without gravity, and burn out after five seconds. */
export const FIREBALL_LIFETIME = 100;
export const EGG_GRAVITY = 0.03;
/** A ghast's fireball: bigger, slower to burn out, and it explodes. A blow sends it back. */
export const GHAST_FIREBALL_LIFETIME = 240;
export const GHAST_FIREBALL_DAMAGE = 6;
export type ProjectileKind = 'arrow' | 'fireball' | 'egg' | 'ghast_fireball';
/** Fireballs fly straight, without gravity or drag. */
export const isFireball = (kind: ProjectileKind) =>
  kind === 'fireball' || kind === 'ghast_fireball';
export interface ArrowEntity {
  kind: ProjectileKind;
  id: number;
  position: Vec3;
  velocity: Vec3;
  /** Damage rolled at release, before armour. */
  damage: number;
  owner: 'player' | 'mob';
  age: number;
  stuck: boolean;
  pickupDelay: number;
  critical: boolean;
}
export type SavedArrow = [
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
  damage: number,
  owner: string,
  age: number,
  stuck: number,
  critical: number,
  kind?: ProjectileKind,
];
export interface ArrowTarget {
  readonly id: number;
  readonly kind: 'mob' | 'player' | 'boss' | 'crystal';
  readonly position: Vec3;
  readonly halfWidth: number;
  readonly height: number;
}
export interface ArrowHit {
  readonly target: ArrowTarget;
  readonly damage: number;
  readonly critical: boolean;
  readonly from: Vec3;
  readonly kind: ProjectileKind;
}
export interface ProjectileLanding {
  readonly kind: ProjectileKind;
  /** Last free position before the block. */
  readonly position: Vec3;
  /** The solid cell it struck. */
  readonly cell: { x: number; y: number; z: number };
}
export interface ArrowTickContext {
  readonly world: VoxelWorld;
  readonly targets: readonly ArrowTarget[];
  readonly hit: (hit: ArrowHit) => void;
  /** A fireball or an egg struck a block (arrows simply stick). */
  readonly landed?: (landing: ProjectileLanding) => void;
}
function solidAt(world: VoxelWorld, x: number, y: number, z: number): boolean {
  if (y < 0) return false;
  if (!world.isLoaded(x, z)) return false;
  return registry.get(world.getBlock(x, y, z)).solid;
}
export class ArrowStore {
  private nextId = 1;
  readonly list: ArrowEntity[] = [];
  spawn(
    position: Vec3,
    velocity: Vec3,
    damage: number,
    owner: 'player' | 'mob' = 'player',
    critical = false,
    kind: ProjectileKind = 'arrow',
  ): ArrowEntity {
    const arrow: ArrowEntity = {
      kind,
      id: this.nextId++,
      position: { ...position },
      velocity: { ...velocity },
      damage,
      owner,
      age: 0,
      stuck: false,
      pickupDelay: ARROW_PICKUP_DELAY,
      critical,
    };
    this.list.push(arrow);
    return arrow;
  }
  clear(): void {
    this.list.length = 0;
  }
  get size(): number {
    return this.list.length;
  }
  free(id: number): boolean {
    const index = this.list.findIndex((arrow) => arrow.id === id);
    if (index < 0) return false;
    this.list.splice(index, 1);
    return true;
  }
  /**
   * A blow at a ghast's fireball in front of the eye (within `reach`, about 35° of the look)
   * sends it back along the look, as the player's own. Returns the fireball, if one was struck.
   */
  deflect(eye: Vec3, look: Vec3, reach = 4.5): ArrowEntity | null {
    for (const arrow of this.list) {
      if (arrow.kind !== 'ghast_fireball' || arrow.owner !== 'mob') continue;
      const vx = arrow.position.x - eye.x,
        vy = arrow.position.y - eye.y,
        vz = arrow.position.z - eye.z,
        d = Math.hypot(vx, vy, vz);
      if (d > reach || (vx * look.x + vy * look.y + vz * look.z) / Math.max(d, 1e-6) < 0.82)
        continue;
      const speed = Math.max(0.9, Math.hypot(arrow.velocity.x, arrow.velocity.y, arrow.velocity.z));
      arrow.velocity = { x: look.x * speed, y: look.y * speed, z: look.z * speed };
      arrow.owner = 'player';
      arrow.age = 0;
      return arrow;
    }
    return null;
  }
  /** Arrows the player may collect again. */
  collectable(position: Vec3, range = 1): ArrowEntity[] {
    return this.list.filter(
      (arrow) =>
        arrow.stuck &&
        arrow.kind === 'arrow' &&
        arrow.owner === 'player' &&
        arrow.pickupDelay <= 0 &&
        Math.hypot(
          arrow.position.x - position.x,
          arrow.position.y - position.y,
          arrow.position.z - position.z,
        ) <= range,
    );
  }
  tick(context: ArrowTickContext): void {
    for (const arrow of [...this.list]) {
      arrow.age++;
      if (arrow.pickupDelay > 0) arrow.pickupDelay--;
      if (arrow.stuck) {
        if (arrow.age > ARROW_STUCK_LIFETIME) this.free(arrow.id);
        continue;
      }
      const lifetime =
        arrow.kind === 'ghast_fireball'
          ? GHAST_FIREBALL_LIFETIME
          : arrow.kind === 'fireball'
            ? FIREBALL_LIFETIME
            : ARROW_LIFETIME;
      if (arrow.age > lifetime) {
        this.free(arrow.id);
        continue;
      }
      if (!isFireball(arrow.kind)) {
        arrow.velocity.y -= arrow.kind === 'egg' ? EGG_GRAVITY : ARROW_GRAVITY;
        arrow.velocity.x *= ARROW_DRAG;
        arrow.velocity.y *= ARROW_DRAG;
        arrow.velocity.z *= ARROW_DRAG;
      }
      const steps = Math.max(
        1,
        Math.ceil(Math.hypot(arrow.velocity.x, arrow.velocity.y, arrow.velocity.z) / 0.25),
      );
      for (let step = 0; step < steps; step++) {
        const previous = { ...arrow.position };
        const move = {
          x: arrow.velocity.x / steps,
          y: arrow.velocity.y / steps,
          z: arrow.velocity.z / steps,
        };
        arrow.position.x += move.x;
        arrow.position.y += move.y;
        arrow.position.z += move.z;
        const hitTarget = this.firstTarget(context.targets, arrow, previous);
        if (hitTarget) {
          context.hit({
            target: hitTarget,
            damage: arrow.damage,
            critical: arrow.critical,
            from: previous,
            kind: arrow.kind,
          });
          this.free(arrow.id);
          break;
        }
        if (
          solidAt(
            context.world,
            Math.floor(arrow.position.x),
            Math.floor(arrow.position.y),
            Math.floor(arrow.position.z),
          )
        ) {
          arrow.position = previous;
          if (arrow.kind !== 'arrow') {
            context.landed?.({
              kind: arrow.kind,
              position: previous,
              cell: {
                x: Math.floor(previous.x + move.x),
                y: Math.floor(previous.y + move.y),
                z: Math.floor(previous.z + move.z),
              },
            });
            this.free(arrow.id);
            break;
          }
          arrow.stuck = true;
          arrow.velocity = { x: 0, y: 0, z: 0 };
          break;
        }
      }
      if (arrow.position.y < -16) this.free(arrow.id);
    }
  }
  /** Segment-box test against creatures; the player is a target as well. */
  private firstTarget(
    targets: readonly ArrowTarget[],
    arrow: ArrowEntity,
    previous: Vec3,
  ): ArrowTarget | null {
    for (const target of targets) {
      if (target.kind === 'mob' && arrow.owner === 'mob') continue;
      // An arrow starts inside its shooter, so the shooter is ignored for the first ticks.
      if (target.kind === 'player' && arrow.owner === 'player' && arrow.age < 3) continue;
      const min = {
        x: target.position.x - target.halfWidth,
        y: target.position.y,
        z: target.position.z - target.halfWidth,
      };
      const max = {
        x: target.position.x + target.halfWidth,
        y: target.position.y + target.height,
        z: target.position.z + target.halfWidth,
      };
      const inside = (point: Vec3, grow: number) =>
        point.x >= min.x - grow &&
        point.x <= max.x + grow &&
        point.y >= min.y - grow &&
        point.y <= max.y + grow &&
        point.z >= min.z - grow &&
        point.z <= max.z + grow;
      if (inside(arrow.position, ARROW_HIT_RADIUS) || inside(previous, ARROW_HIT_RADIUS))
        return target;
    }
    return null;
  }
  snapshot(): SavedArrow[] {
    return this.list.map((arrow) => [
      arrow.position.x,
      arrow.position.y,
      arrow.position.z,
      arrow.velocity.x,
      arrow.velocity.y,
      arrow.velocity.z,
      arrow.damage,
      arrow.owner,
      arrow.age,
      arrow.stuck ? 1 : 0,
      arrow.critical ? 1 : 0,
      arrow.kind,
    ]);
  }
  restore(data: readonly SavedArrow[]): number {
    this.clear();
    let skipped = 0;
    for (const entry of data) {
      const [x, y, z, vx, vy, vz, damage, owner, age, stuck, critical, kind] = entry;
      if (owner !== 'player' && owner !== 'mob') {
        skipped++;
        continue;
      }
      if (![x, y, z, vx, vy, vz, damage].every((value) => Number.isFinite(value))) {
        skipped++;
        continue;
      }
      const known =
        kind === 'fireball' || kind === 'egg' || kind === 'ghast_fireball' ? kind : 'arrow';
      const arrow = this.spawn(
        { x, y, z },
        { x: vx, y: vy, z: vz },
        damage,
        owner,
        !!critical,
        known,
      );
      arrow.age = Math.max(0, Math.floor(age));
      arrow.stuck = !!stuck;
      arrow.pickupDelay = 0;
    }
    return skipped;
  }
  renderPositions(): {
    id: number;
    kind: ProjectileKind;
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
  }[] {
    return this.list.map((arrow) => ({
      id: arrow.id,
      kind: arrow.kind,
      x: arrow.position.x,
      y: arrow.position.y,
      z: arrow.position.z,
      yaw: Math.atan2(-arrow.velocity.x, -arrow.velocity.z),
      pitch: Math.atan2(-arrow.velocity.y, Math.hypot(arrow.velocity.x, arrow.velocity.z)),
    }));
  }
}
export const BOW_FULL_CHARGE = BOW_CHARGE_TICKS;
export const ORB_DESPAWN_TICKS = 6000;
export const ORB_MERGE_RADIUS = 0.6;
export const ORB_ATTRACT_RANGE = 8;
/** Orbs travel to the player instead of waiting to be stepped on. */
export const ORB_ATTRACT_SPEED = 0.35;
export interface XpOrb {
  id: number;
  value: number;
  position: Vec3;
  velocity: Vec3;
  age: number;
  pickupDelay: number;
}
export type SavedOrb = [value: number, x: number, y: number, z: number, age: number];
export interface OrbTickContext {
  readonly world: VoxelWorld;
  readonly playerPosition: Vec3;
  readonly playerAlive: boolean;
  /** Returns how many experience points were accepted. */
  readonly sink: (value: number) => number;
}
function orbSolid(world: VoxelWorld, x: number, y: number, z: number): boolean {
  if (y < 0) return false;
  if (!world.isLoaded(x, z)) return true;
  return registry.get(world.getBlock(x, y, z)).solid;
}
export class OrbStore {
  private nextId = 1;
  readonly list: XpOrb[] = [];
  spawn(value: number, position: Vec3, velocity: Vec3 = { x: 0, y: 0, z: 0 }): XpOrb {
    if (!Number.isInteger(value) || value < 1) throw new RangeError(`Bad orb value ${value}`);
    const orb: XpOrb = {
      id: this.nextId++,
      value,
      position: { ...position },
      velocity: { ...velocity },
      age: 0,
      pickupDelay: 0,
    };
    this.list.push(orb);
    return orb;
  }
  /** Splits a payout into orb-sized pieces, exactly like a dropped experience bar. */
  spawnSplit(total: number, position: Vec3, random: () => number): number {
    let left = Math.max(0, Math.floor(total));
    let spawned = 0;
    while (left > 0 && spawned < 100) {
      const size = left >= 16 ? 7 + Math.floor(random() * 10) : left >= 3 ? 3 : 1;
      const value = Math.min(left, size);
      const spread = () => (random() - 0.5) * 0.3;
      this.spawn(
        value,
        { x: position.x + spread(), y: position.y + 0.2, z: position.z + spread() },
        { x: spread() * 0.4, y: 0.1, z: spread() * 0.4 },
      );
      left -= value;
      spawned++;
    }
    return total - left;
  }
  clear(): void {
    this.list.length = 0;
  }
  get size(): number {
    return this.list.length;
  }
  get total(): number {
    let sum = 0;
    for (const orb of this.list) sum += orb.value;
    return sum;
  }
  tick(context: OrbTickContext): number {
    let collected = 0;
    for (const orb of [...this.list]) {
      if (!context.world.isLoaded(Math.floor(orb.position.x), Math.floor(orb.position.z))) continue;
      orb.age++;
      if (orb.age > ORB_DESPAWN_TICKS) {
        this.free(orb.id);
        continue;
      }
      const dx = context.playerPosition.x - orb.position.x;
      const dy = context.playerPosition.y + 0.9 - orb.position.y;
      const dz = context.playerPosition.z - orb.position.z;
      const distance = Math.hypot(dx, dy, dz);
      if (context.playerAlive && distance <= ORB_ATTRACT_RANGE) {
        const pull = ORB_ATTRACT_SPEED / Math.max(0.5, distance);
        orb.velocity.x += dx * pull * 0.3;
        orb.velocity.y += dy * pull * 0.3;
        orb.velocity.z += dz * pull * 0.3;
      }
      orb.velocity.y -= 0.03;
      orb.velocity.x *= 0.92;
      orb.velocity.y *= 0.92;
      orb.velocity.z *= 0.92;
      this.move(context.world, orb, 'x');
      this.move(context.world, orb, 'y');
      this.move(context.world, orb, 'z');
      if (orb.position.y < -16) {
        this.free(orb.id);
        continue;
      }
      if (!context.playerAlive) continue;
      if (distance <= 1.2) {
        const accepted = context.sink(orb.value);
        if (accepted >= orb.value) {
          collected += orb.value;
          this.free(orb.id);
        } else if (accepted > 0) {
          orb.value -= accepted;
          collected += accepted;
        }
      }
    }
    this.mergeSimilar();
    return collected;
  }
  private move(world: VoxelWorld, orb: XpOrb, axis: 'x' | 'y' | 'z'): void {
    const step = orb.velocity[axis];
    if (step === 0) return;
    const next = orb.position[axis] + step;
    const probe = { ...orb.position, [axis]: next };
    if (orbSolid(world, Math.floor(probe.x), Math.floor(probe.y), Math.floor(probe.z))) {
      orb.velocity[axis] = 0;
      return;
    }
    orb.position[axis] = next;
  }
  private mergeSimilar(): void {
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i];
      for (let j = i + 1; j < this.list.length; j++) {
        const b = this.list[j];
        if (Math.abs(a.position.x - b.position.x) > ORB_MERGE_RADIUS) continue;
        if (Math.abs(a.position.y - b.position.y) > ORB_MERGE_RADIUS) continue;
        if (Math.abs(a.position.z - b.position.z) > ORB_MERGE_RADIUS) continue;
        a.value += b.value;
        this.free(b.id);
      }
    }
  }
  free(id: number): boolean {
    const index = this.list.findIndex((orb) => orb.id === id);
    if (index < 0) return false;
    this.list.splice(index, 1);
    return true;
  }
  snapshot(): SavedOrb[] {
    return this.list.map((orb) => [
      orb.value,
      orb.position.x,
      orb.position.y,
      orb.position.z,
      orb.age,
    ]);
  }
  restore(data: readonly SavedOrb[]): number {
    this.clear();
    let skipped = 0;
    for (const entry of data) {
      const [value, x, y, z, age] = entry;
      if (!Number.isInteger(value) || value < 1 || !Number.isFinite(x + y + z)) {
        skipped++;
        continue;
      }
      const orb = this.spawn(value, { x, y, z });
      orb.age = Math.max(0, Math.floor(age));
    }
    return skipped;
  }
  renderPositions(): { id: number; x: number; y: number; z: number }[] {
    return this.list.map((orb) => ({
      id: orb.id,
      x: orb.position.x,
      y: orb.position.y,
      z: orb.position.z,
    }));
  }
}
