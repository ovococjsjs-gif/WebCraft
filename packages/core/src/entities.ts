import { definition, sameKind, stack, type ItemStack } from './inventory';
import { copyEnchantments, type Enchantments } from './item-metadata';
import type { VoxelWorld } from './world';
import { pointInWorld } from './collision';
import type { Vec3 } from './coordinates';
export const ITEM_DESPAWN_TICKS = 6000;
export const ITEM_MERGE_RADIUS = 0.6;
/** Half a second before a fresh drop can be collected, so it does not fly back instantly. */
export const ITEM_PICKUP_DELAY = 10;
export interface ItemEntity {
  id: number;
  item: string;
  count: number;
  damage: number;
  enchantments?: Enchantments;
  position: Vec3;
  velocity: Vec3;
  age: number;
  pickupDelay: number;
}
export type SavedItemEntity = [
  item: string,
  count: number,
  damage: number,
  x: number,
  y: number,
  z: number,
  age: number,
  enchantments?: Enchantments,
];
export interface PickupSink {
  /** Returns how many items were accepted; the rest stays on the ground. */
  (stack: ItemStack): number;
}
function solidAt(world: VoxelWorld, x: number, y: number, z: number): boolean {
  if (!world.isLoaded(Math.floor(x), Math.floor(z))) return true;
  if (y < 0) return false;
  return pointInWorld(world, x, y, z);
}
export class ItemEntityStore {
  private nextId = 1;
  readonly list: ItemEntity[] = [];
  spawn(
    item: string,
    count: number,
    position: Vec3,
    damage = 0,
    velocity: Vec3 = { x: 0, y: 0, z: 0 },
    enchantments?: Enchantments,
  ): ItemEntity {
    if (!Number.isInteger(count) || count < 1) throw new RangeError(`Bad drop count ${count}`);
    stack(item, 1, damage, enchantments);
    const entity: ItemEntity = {
      id: this.nextId++,
      item,
      count,
      damage,
      ...(enchantments ? { enchantments: copyEnchantments(enchantments) } : {}),
      position: { ...position },
      velocity: { ...velocity },
      age: 0,
      pickupDelay: ITEM_PICKUP_DELAY,
    };
    this.list.push(entity);
    return entity;
  }
  spawnStack(value: ItemStack, position: Vec3, velocity?: Vec3): ItemEntity {
    return this.spawn(
      value.item,
      value.count,
      position,
      value.damage ?? 0,
      velocity,
      value.enchantments,
    );
  }
  /** Deterministic scatter so drops do not all land in one spot. */
  spawnDrops(
    drops: readonly { item: string; count: number }[],
    x: number,
    y: number,
    z: number,
    random: () => number,
  ): void {
    for (const drop of drops) {
      const spread = () => (random() - 0.5) * 0.22;
      this.spawn(
        drop.item,
        drop.count,
        { x: x + 0.5 + spread(), y: y + 0.35, z: z + 0.5 + spread() },
        0,
        {
          x: spread(),
          y: 0.12,
          z: spread(),
        },
      );
    }
  }
  get size(): number {
    return this.list.length;
  }
  clear(): void {
    this.list.length = 0;
  }
  free(entityId: number): void {
    const index = this.list.findIndex((entity) => entity.id === entityId);
    if (index >= 0) this.list.splice(index, 1);
  }
  /**
   * One tick of item physics: gravity, drag, simple block collision, merging,
   * despawn and pickup. `sink` decides how much of a stack fits in the inventory.
   */
  tick(world: VoxelWorld, sink: PickupSink, canPickup: (entity: ItemEntity) => boolean): number {
    let picked = 0;
    for (const entity of [...this.list]) {
      // Unloaded chunks freeze their items instead of dropping them: the save keeps them.
      if (!world.isLoaded(Math.floor(entity.position.x), Math.floor(entity.position.z))) continue;
      entity.age++;
      if (entity.age > ITEM_DESPAWN_TICKS) {
        this.free(entity.id);
        continue;
      }
      entity.velocity.y -= 0.04;
      entity.velocity.x *= 0.98;
      entity.velocity.z *= 0.98;
      entity.velocity.y *= 0.98;
      this.move(world, entity, 'x');
      this.move(world, entity, 'y');
      this.move(world, entity, 'z');
      // Ground friction, so a drop lands next to the block it came from instead of sliding away.
      if (solidAt(world, entity.position.x, entity.position.y - 0.08, entity.position.z)) {
        entity.velocity.x *= 0.6;
        entity.velocity.z *= 0.6;
      }
      if (entity.position.y < -16) {
        this.free(entity.id);
        continue;
      }
      if (entity.pickupDelay > 0) entity.pickupDelay--;
      if (entity.pickupDelay > 0) continue;
      if (!canPickup(entity)) continue;
      const accepted = sink({
        item: entity.item,
        count: entity.count,
        damage: entity.damage,
        ...(entity.enchantments ? { enchantments: entity.enchantments } : {}),
      });
      if (accepted <= 0) continue;
      picked += accepted;
      if (accepted >= entity.count) this.free(entity.id);
      else entity.count -= accepted;
    }
    this.mergeSimilar();
    return picked;
  }
  private move(world: VoxelWorld, entity: ItemEntity, axis: 'x' | 'y' | 'z'): void {
    const step = entity.velocity[axis];
    if (step === 0) return;
    const next = entity.position[axis] + step;
    const probe = {
      x: axis === 'x' ? next : entity.position.x,
      y: axis === 'y' ? next : entity.position.y,
      z: axis === 'z' ? next : entity.position.z,
    };
    if (solidAt(world, probe.x, probe.y, probe.z)) {
      if (axis === 'y') {
        entity.velocity.y = 0;
        return;
      }
      entity.velocity[axis] = 0;
      return;
    }
    entity.position[axis] = next;
  }
  private mergeSimilar(): void {
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i];
      const limit = definition({ item: a.item, count: 1 } as ItemStack).maxStack;
      for (let j = i + 1; j < this.list.length && a.count < limit; j++) {
        const b = this.list[j];
        if (!sameKind(a, b)) continue;
        if (Math.abs(a.position.x - b.position.x) > ITEM_MERGE_RADIUS) continue;
        if (Math.abs(a.position.y - b.position.y) > ITEM_MERGE_RADIUS) continue;
        if (Math.abs(a.position.z - b.position.z) > ITEM_MERGE_RADIUS) continue;
        const moved = Math.min(limit - a.count, b.count);
        a.count += moved;
        b.count -= moved;
        if (b.count === 0) this.free(b.id);
      }
    }
  }
  snapshot(): SavedItemEntity[] {
    return this.list.map(
      (entity): SavedItemEntity =>
        [
          entity.item,
          entity.count,
          entity.damage,
          entity.position.x,
          entity.position.y,
          entity.position.z,
          entity.age,
          ...(entity.enchantments ? [copyEnchantments(entity.enchantments)] : []),
        ] as SavedItemEntity,
    );
  }
  restore(data: readonly SavedItemEntity[]): void {
    this.clear();
    for (const [item, count, damage, x, y, z, age, enchantments] of data) {
      const entity = this.spawn(item, count, { x, y, z }, damage, undefined, enchantments);
      entity.age = age;
      // A restored item may be picked up immediately; it was already on the ground before.
      entity.pickupDelay = 0;
    }
  }
  /** Rounded positions for the renderer, oldest first. */
  renderPositions(limit = 256): { id: number; item: string; x: number; y: number; z: number }[] {
    return this.list.slice(0, limit).map((entity) => ({
      id: entity.id,
      item: entity.item,
      x: entity.position.x,
      y: entity.position.y,
      z: entity.position.z,
    }));
  }
}
/** Pickup box: the player's own box grown by one block. */
export function withinPickupRange(playerPosition: Vec3, entity: ItemEntity): boolean {
  const dx = Math.abs(entity.position.x - playerPosition.x);
  const dz = Math.abs(entity.position.z - playerPosition.z);
  const dy = entity.position.y - (playerPosition.y - 0.5);
  return dx <= 1.0 && dz <= 1.0 && dy > -1.5 && dy < 2.5;
}
