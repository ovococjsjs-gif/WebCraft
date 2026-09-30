/**
 * Rails and minecarts.
 *
 * A cart is an entity that lives on the rail line: it looks for the rail under it, follows the
 * line, and takes its speed from a detector for straight runs, a powered rail for acceleration
 * and a plain rail for friction. Riding means the player's position is driven by the cart, and
 * stepping out puts the player next to the rails.
 */
import { BLOCK, registry } from '../../content/src/blocks';
import type { Vec3 } from './coordinates';
import type { VoxelWorld } from './world';

/** Top speed of a cart pushed by a powered rail, in blocks per second. */
export const CART_MAX_SPEED = 8;
export const CART_ACCELERATION = 0.6;
export const CART_FRICTION = 0.04;
/** Speed under which a cart is considered stopped. */
export const CART_STOP_SPEED = 0.02;
export const CART_MAX = 64;

export type CartKind = 'ride' | 'chest';
export interface SavedCart {
  readonly kind: CartKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
}
export interface CartEntity {
  id: number;
  kind: CartKind;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
}
export interface CartHooks {
  /** True while the rail at this position carries a redstone signal. */
  readonly powered: (x: number, y: number, z: number) => boolean;
  /** The player's position, so a ride can carry them along. */
  readonly riderPosition?: () => Vec3;
  readonly moveRider?: (position: Vec3) => void;
}

export class CartStore {
  private nextId = 1;
  readonly list: CartEntity[] = [];
  /** Cart the player rides, if any. */
  riderId: number | null = null;

  spawn(kind: CartKind, position: Vec3): CartEntity {
    if (this.list.length >= CART_MAX) throw new RangeError('Too many carts');
    const cart: CartEntity = {
      id: this.nextId++,
      kind,
      position: { ...position },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: 0,
    };
    this.list.push(cart);
    return cart;
  }
  byId(id: number): CartEntity | undefined {
    return this.list.find((cart) => cart.id === id);
  }
  remove(id: number): void {
    const index = this.list.findIndex((cart) => cart.id === id);
    if (index >= 0) this.list.splice(index, 1);
    if (this.riderId === id) this.riderId = null;
  }
  clear(): void {
    this.list.length = 0;
    this.riderId = null;
  }
  get size(): number {
    return this.list.length;
  }
  /** Nearest cart within reach of a position, for mounting. */
  nearest(position: Vec3, radius = 2): CartEntity | undefined {
    let best: CartEntity | undefined;
    let bestDistance = radius;
    for (const cart of this.list) {
      const distance = Math.hypot(
        cart.position.x - position.x,
        cart.position.y - position.y,
        cart.position.z - position.z,
      );
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = cart;
      }
    }
    return best;
  }
  /** Id of the cart the player is sitting in, or null when nobody is riding. */
  get riding(): number | null {
    return this.riderId;
  }
  mount(id: number): boolean {
    if (!this.byId(id)) return false;
    this.riderId = id;
    return true;
  }
  dismount(): CartEntity | undefined {
    if (this.riderId === null) return undefined;
    const cart = this.byId(this.riderId);
    this.riderId = null;
    return cart;
  }

  /** One tick for every cart: rail following, powered rails and friction. */
  tick(world: VoxelWorld, hooks: CartHooks): void {
    for (const cart of this.list) {
      const railY = this.railUnder(world, cart.position);
      if (railY === null) {
        // Off the rails a cart falls like a block, which is the reference behaviour.
        cart.velocity.y -= 1.6;
        cart.position.y += cart.velocity.y * 0.05;
        cart.position.x += cart.velocity.x * 0.05;
        cart.position.z += cart.velocity.z * 0.05;
        cart.velocity.x *= 0.98;
        cart.velocity.z *= 0.98;
        if (cart.position.y < -16) this.remove(cart.id);
        continue;
      }
      cart.position.y = railY + 0.0625;
      cart.velocity.y = 0;
      const path = this.pathAt(world, cart.position);
      const direction = { ...cart.velocity };
      const speed = Math.hypot(direction.x, direction.z);
      if (path.length === 0) {
        cart.velocity.x = 0;
        cart.velocity.z = 0;
        continue;
      }
      // Pick the exit that continues the current heading, or any exit when stopped.
      let chosen = path[0];
      let bestDot = -Infinity;
      for (const option of path) {
        const dot =
          speed > 0.01 ? option.x * (direction.x / speed) + option.z * (direction.z / speed) : 0;
        if (dot > bestDot) {
          bestDot = dot;
          chosen = option;
        }
      }
      const next = {
        x: cart.position.x + chosen.x,
        y: cart.position.y,
        z: cart.position.z + chosen.z,
      };
      const railState = world.getBlock(Math.floor(next.x), railY, Math.floor(next.z));
      const railKind = registry.get(railState);
      cart.yaw = Math.atan2(-chosen.x, -chosen.z);
      // A powered rail pushes the cart while it stands on it or rolls onto it, as in the reference.
      const hereX = Math.floor(cart.position.x);
      const hereZ = Math.floor(cart.position.z);
      const accelerating =
        hooks.powered(hereX, railY, hereZ) ||
        hooks.powered(Math.floor(next.x), railY, Math.floor(next.z));
      let target = speed;
      if (accelerating) target = Math.min(CART_MAX_SPEED, Math.max(2, speed) + CART_ACCELERATION);
      else target = Math.max(0, speed - CART_FRICTION);
      const railBlock = railKind.key.includes('rail');
      if (!railBlock) target = Math.max(0, target - CART_FRICTION * 2);
      if (target <= CART_STOP_SPEED) {
        // A cart that has lost its speed stands still instead of hopping to the next rail.
        cart.velocity.x = 0;
        cart.velocity.z = 0;
        if (this.riderId === cart.id && hooks.moveRider)
          hooks.moveRider({ x: cart.position.x, y: cart.position.y + 0.4, z: cart.position.z });
        continue;
      }
      // Speed is blocks per second and a tick is a twentieth of one, so the step follows.
      const step = target * 0.05;
      cart.position.x += chosen.x * step;
      cart.position.z += chosen.z * step;
      // Rolling into the next rail cell returns the cart to the middle of the line.
      if (chosen.z === 0 && Math.floor(cart.position.x) !== hereX)
        cart.position.z = Math.floor(cart.position.z) + 0.5;
      if (chosen.x === 0 && Math.floor(cart.position.z) !== hereZ)
        cart.position.x = Math.floor(cart.position.x) + 0.5;
      cart.velocity.x = chosen.x * target;
      cart.velocity.z = chosen.z * target;
      if (this.riderId === cart.id && hooks.moveRider) {
        hooks.moveRider({
          x: cart.position.x,
          y: cart.position.y + 0.4,
          z: cart.position.z,
        });
      }
    }
  }

  /** Position of the rail block a cart is standing on, or null when it is off the line. */
  private railUnder(world: VoxelWorld, position: Vec3): number | null {
    for (const dy of [0, 1]) {
      const y = Math.floor(position.y) - dy;
      if (this.isRail(world.getBlock(Math.floor(position.x), y, Math.floor(position.z)))) return y;
    }
    return null;
  }
  private isRail(state: number): boolean {
    return !!registry.get(state).key.includes('rail');
  }
  /** Directions a rail connects to, in the four horizontal axes. */
  private pathAt(world: VoxelWorld, position: Vec3): { x: number; z: number }[] {
    const x = Math.floor(position.x),
      z = Math.floor(position.z);
    const railY = this.railUnder(world, position);
    if (railY === null) return [];
    const options: { x: number; z: number }[] = [];
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const here = this.isRail(world.getBlock(x + dx, railY, z + dz));
      const above = this.isRail(world.getBlock(x + dx, railY + 1, z + dz));
      const below = this.isRail(world.getBlock(x + dx, railY - 1, z + dz));
      if (here || above || below) options.push({ x: dx, z: dz });
    }
    return options;
  }

  renderPositions(): {
    id: number;
    kind: CartKind;
    x: number;
    y: number;
    z: number;
    yaw: number;
  }[] {
    return this.list.map((cart) => ({
      id: cart.id,
      kind: cart.kind,
      x: cart.position.x,
      y: cart.position.y,
      z: cart.position.z,
      yaw: cart.yaw,
    }));
  }
  snapshot(): SavedCart[] {
    return this.list.map((cart) => ({
      kind: cart.kind,
      x: cart.position.x,
      y: cart.position.y,
      z: cart.position.z,
      vx: cart.velocity.x,
      vz: cart.velocity.z,
    }));
  }
  restore(data: readonly SavedCart[]): number {
    this.clear();
    let skipped = 0;
    for (const entry of data) {
      if (entry.kind !== 'ride' && entry.kind !== 'chest') {
        skipped++;
        continue;
      }
      const cart = this.spawn(entry.kind, { x: entry.x, y: entry.y, z: entry.z });
      cart.velocity.x = entry.vx;
      cart.velocity.z = entry.vz;
    }
    return skipped;
  }
}

/** Rails only connect to rails, so a line is built from the four neighbours of each rail. */
export function railConnections(world: VoxelWorld, x: number, y: number, z: number): number {
  let mask = 0;
  const directions = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  directions.forEach(([dx, dz], index) => {
    if (registry.get(world.getBlock(x + dx, y, z + dz)).key.includes('rail')) mask |= 1 << index;
  });
  return mask;
}

export const RAIL_BLOCK = BLOCK.RAIL;
