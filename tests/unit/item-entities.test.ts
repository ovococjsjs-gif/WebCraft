import { describe, it, expect } from 'vitest';
import { VoxelWorld } from '../../packages/core/src/world';
import { generateColumn } from '../../packages/core/src/terrain';
import {
  ItemEntityStore,
  ITEM_DESPAWN_TICKS,
  ITEM_PICKUP_DELAY,
  withinPickupRange,
  type PickupSink,
} from '../../packages/core/src/entities';
import { stack, type ItemStack } from '../../packages/core/src/inventory';

function flatWorld(): VoxelWorld {
  const world = new VoxelWorld('items');
  for (let x = -1; x <= 1; x++)
    for (let z = -1; z <= 1; z++) world.addColumn(generateColumn(x, z, 'items', 'flat'));
  return world;
}
/** Sink that accepts nothing, used when the test only cares about physics. */
const acceptAll: PickupSink = () => 0;
const collectAll = (bag: ItemStack[]) => (item: ItemStack) => {
  bag.push({ item: item.item, count: item.count });
  return item.count;
};

describe('dropped items in the world', () => {
  it('spawns a drop above the block and lets it fall onto the ground', () => {
    const world = flatWorld();
    const store = new ItemEntityStore();
    const entity = store.spawn('lab:coal', 3, { x: 0.5, y: 12, z: 0.5 }, 0, { x: 0.2, y: 0, z: 0 });
    expect(entity.age).toBe(0);
    expect(entity.pickupDelay).toBe(ITEM_PICKUP_DELAY);
    for (let i = 0; i < 200; i++) store.tick(world, acceptAll, () => false);
    expect(entity.position.y).toBeGreaterThan(8.9);
    expect(entity.position.y).toBeLessThan(9.4);
    expect(Math.abs(entity.velocity.y)).toBeLessThan(0.05);
    expect(store.size).toBe(1);
  });
  it('collects a stack only after the pickup delay', () => {
    const world = flatWorld();
    const store = new ItemEntityStore();
    store.spawn('lab:coal', 5, { x: 0.5, y: 9.2, z: 0.5 });
    const bag: ItemStack[] = [];
    for (let i = 0; i < ITEM_PICKUP_DELAY - 1; i++) store.tick(world, collectAll(bag), () => true);
    expect(bag).toEqual([]);
    store.tick(world, collectAll(bag), () => true);
    expect(bag).toEqual([stack('lab:coal', 5)]);
    expect(store.size).toBe(0);
  });
  it('keeps the remainder in the world when the sink only accepts part of a stack', () => {
    const world = flatWorld();
    const store = new ItemEntityStore();
    const entity = store.spawn('lab:coal', 10, { x: 0.5, y: 9.2, z: 0.5 });
    entity.pickupDelay = 0;
    const accepted: number[] = [];
    store.tick(
      world,
      (item) => {
        accepted.push(item.count);
        return 4;
      },
      () => true,
    );
    expect(accepted).toEqual([10]);
    expect(entity.count).toBe(6);
    store.tick(
      world,
      () => 6,
      () => true,
    );
    expect(store.size).toBe(0);
  });
  it('merges nearby identical stacks without touching different items or damage', () => {
    const world = flatWorld();
    const store = new ItemEntityStore();
    const a = store.spawn('lab:coal', 20, { x: 0.5, y: 9.2, z: 0.5 });
    store.spawn('lab:coal', 20, { x: 0.7, y: 9.2, z: 0.5 });
    store.spawn('lab:charcoal', 20, { x: 0.6, y: 9.2, z: 0.5 });
    store.spawn('lab:iron_pickaxe', 1, { x: 0.5, y: 9.2, z: 0.5 }, 5);
    store.tick(world, acceptAll, () => false);
    expect(store.list.map((entity) => [entity.item, entity.count])).toEqual([
      ['lab:coal', 40],
      ['lab:charcoal', 20],
      ['lab:iron_pickaxe', 1],
    ]);
    expect(a.count).toBe(40);
  });
  it('despawns only after the reference lifetime', () => {
    const world = flatWorld();
    const store = new ItemEntityStore();
    const entity = store.spawn('lab:coal', 1, { x: 0.5, y: 9.2, z: 0.5 });
    entity.age = ITEM_DESPAWN_TICKS - 1;
    store.tick(world, acceptAll, () => false);
    expect(store.size).toBe(1);
    entity.age = ITEM_DESPAWN_TICKS;
    store.tick(world, acceptAll, () => false);
    expect(store.size).toBe(0);
  });
  it('freezes items in unloaded chunks instead of deleting or collecting them', () => {
    const world = flatWorld();
    const store = new ItemEntityStore();
    const far = store.spawn('lab:coal', 2, { x: 400.5, y: 40, z: 400.5 });
    store.spawn('lab:coal', 2, { x: 0.5, y: 9.2, z: 0.5 });
    const bag: ItemStack[] = [];
    for (let i = 0; i < 40; i++) store.tick(world, collectAll(bag), () => true);
    expect(far.age).toBe(0);
    expect(far.position.y).toBe(40);
    expect(store.list.some((entity) => entity.item === 'lab:coal')).toBe(true);
    expect(bag).toEqual([stack('lab:coal', 2)]);
  });
  it('drops items that fall out of the world', () => {
    const world = flatWorld();
    const store = new ItemEntityStore();
    store.spawn('lab:coal', 1, { x: 0.5, y: -20, z: 0.5 });
    store.tick(world, acceptAll, () => false);
    expect(store.size).toBe(0);
  });
  it('roundtrips through the save representation with damage intact', () => {
    const store = new ItemEntityStore();
    store.spawn('lab:iron_pickaxe', 1, { x: 0.5, y: 9.2, z: 0.5 }, 12);
    store.spawn('lab:coal', 7, { x: 3.5, y: 9.2, z: 1.5 });
    store.list[0].age = 42;
    const snapshot = store.snapshot();
    const restored = new ItemEntityStore();
    restored.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
    expect(restored.list.every((entity) => entity.pickupDelay === 0)).toBe(true);
  });
  it('refuses malformed drops before they reach the world', () => {
    const store = new ItemEntityStore();
    expect(() => store.spawn('lab:coal', 0, { x: 0, y: 0, z: 0 })).toThrow(RangeError);
    expect(() => store.spawn('lab:coal', 1.5, { x: 0, y: 0, z: 0 })).toThrow(RangeError);
    expect(() => store.spawn('lab:nothing', 1, { x: 0, y: 0, z: 0 })).toThrow();
    expect(() => store.spawn('lab:iron_pickaxe', 1, { x: 0, y: 0, z: 0 }, 250)).toThrow(RangeError);
  });
  it('uses the reference pickup box around the player', () => {
    const store = new ItemEntityStore();
    const entity = store.spawn('lab:coal', 1, { x: 1.9, y: 9.2, z: 0.5 });
    expect(withinPickupRange({ x: 1, y: 8.7, z: 0.5 }, entity)).toBe(true);
    entity.position.x = 2.4;
    expect(withinPickupRange({ x: 1, y: 8.7, z: 0.5 }, entity)).toBe(false);
    entity.position.x = 1.2;
    entity.position.y = 12;
    expect(withinPickupRange({ x: 1, y: 8.7, z: 0.5 }, entity)).toBe(false);
  });
  it('renders drops as rounded positions for the viewport', () => {
    const store = new ItemEntityStore();
    const entity = store.spawn('lab:coal', 1, { x: 1.25, y: 9.5, z: -2.5 });
    const positions = store.renderPositions();
    expect(positions).toEqual([{ id: entity.id, item: 'lab:coal', x: 1.25, y: 9.5, z: -2.5 }]);
  });
});
