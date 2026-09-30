import { describe, it, expect } from 'vitest';
import { BLOCK } from '../../packages/content/src/blocks';
import { VoxelWorld } from '../../packages/core/src/world';
import { generateColumn } from '../../packages/core/src/terrain';
import {
  ContainerStore,
  CHEST_SLOTS,
  FURNACE_INPUT,
  FURNACE_FUEL,
  FURNACE_OUTPUT,
  chestObstructed,
  chestPlacementAllowed,
  tickFurnace,
  tickFurnaces,
} from '../../packages/core/src/containers';
import { clickSlot, stack } from '../../packages/core/src/inventory';

function flatWorld(): VoxelWorld {
  const world = new VoxelWorld('containers');
  for (let x = -1; x <= 1; x++)
    for (let z = -1; z <= 1; z++) world.addColumn(generateColumn(x, z, 'containers', 'flat'));
  return world;
}
const ground = 8;

describe('chest containers', () => {
  it('keeps a single chest at 27 slots and shares slots with a double chest', () => {
    const store = new ContainerStore();
    const world = flatWorld();
    const single = store.chestView(world, 0, ground, 0);
    expect(single.size).toBe(CHEST_SLOTS);
    single.set(0, stack('lab:coal', 12));
    expect(store.get(0, ground, 0)!.slots.get(0)).toEqual(stack('lab:coal', 12));
    world.setBlock(1, ground, 0, BLOCK.CHEST);
    const double = store.chestView(world, 0, ground, 0);
    expect(double.size).toBe(54);
    expect(double.get(0)).toEqual(stack('lab:coal', 12));
    double.set(27 + 5, stack('lab:iron_ingot', 3));
    expect(store.get(1, ground, 0)!.slots.get(5)).toEqual(stack('lab:iron_ingot', 3));
    expect(double.get(32)).toEqual(stack('lab:iron_ingot', 3));
  });
  it('keeps the same west-to-east layout no matter which half is opened', () => {
    const store = new ContainerStore();
    const world = flatWorld();
    world.setBlock(2, ground, 4, BLOCK.CHEST);
    world.setBlock(3, ground, 4, BLOCK.CHEST);
    store.ensure('chest', 2, ground, 4).slots.set(0, stack('lab:coal', 1));
    store.ensure('chest', 3, ground, 4).slots.set(0, stack('lab:iron_ingot', 1));
    const west = store.chestView(world, 2, ground, 4);
    const east = store.chestView(world, 3, ground, 4);
    // Slot 0..26 is always the western half, so the interface never reshuffles.
    expect(west.get(0)?.item).toBe('lab:coal');
    expect(west.get(27)?.item).toBe('lab:iron_ingot');
    expect(east.get(0)?.item).toBe('lab:coal');
    expect(east.get(27)?.item).toBe('lab:iron_ingot');
  });
  it('pairs chests along the north-south axis and keeps the northern half first', () => {
    const store = new ContainerStore();
    const world = flatWorld();
    world.setBlock(0, ground, 0, BLOCK.CHEST);
    world.setBlock(0, ground, 1, BLOCK.CHEST);
    const south = store.chestView(world, 0, ground, 1);
    expect(south.size).toBe(2 * CHEST_SLOTS);
    south.set(CHEST_SLOTS + 4, stack('lab:coal', 12));
    expect(store.get(0, ground, 1)!.slots.get(4)).toEqual(stack('lab:coal', 12));
    const north = store.chestView(world, 0, ground, 0);
    expect(north.get(CHEST_SLOTS + 4)).toEqual(stack('lab:coal', 12));
    // A third chest cannot join the finished pair from either end.
    expect(chestPlacementAllowed(store, world, 0, ground, -1)).toBe(false);
    expect(chestPlacementAllowed(store, world, 0, ground, 2)).toBe(false);
  });
  it('blocks opening a chest with a solid block above it and refuses a third chest in one cluster', () => {
    const store = new ContainerStore();
    const world = flatWorld();
    world.setBlock(4, ground, 4, BLOCK.CHEST);
    expect(chestObstructed(store, world, 4, ground, 4)).toBe(false);
    world.setBlock(4, ground + 1, 4, BLOCK.STONE);
    expect(chestObstructed(store, world, 4, ground, 4)).toBe(true);
    world.setBlock(5, ground, 4, BLOCK.CHEST);
    expect(chestPlacementAllowed(store, world, 6, ground, 4)).toBe(false);
    expect(chestPlacementAllowed(store, world, 4, ground, 6)).toBe(true);
    expect(chestPlacementAllowed(store, world, 4, ground + 1, 4)).toBe(true);
  });
  it('hands the contents over when a chest is destroyed', () => {
    const store = new ContainerStore();
    const world = flatWorld();
    const chest = store.ensure('chest', 0, ground, 0);
    chest.slots.set(3, stack('lab:coal', 5));
    expect(store.remove(1, ground, 1)).toBeUndefined();
    expect(store.get(0, ground, 0)).toBeTruthy();
    const removed = store.remove(0, ground, 0)!;
    expect(removed.slots.get(3)).toEqual(stack('lab:coal', 5));
    expect(store.size).toBe(0);
    void world;
  });
  it('roundtrips containers through the save representation', () => {
    const store = new ContainerStore();
    const chest = store.ensure('chest', 0, ground, 0);
    chest.slots.set(0, stack('lab:coal', 7));
    const furnace = store.ensure('furnace', 2, ground, 0);
    furnace.slots.set(FURNACE_INPUT, stack('lab:iron_ore', 3));
    const snapshot = store.snapshotEntries();
    const restored = new ContainerStore();
    restored.restoreEntries(snapshot);
    expect(restored.snapshotEntries()).toEqual(snapshot);
    expect(restored.get(0, ground, 0)!.slots.get(0)).toEqual(stack('lab:coal', 7));
  });
});

describe('furnace smelting', () => {
  const furnaceAt = (store: ContainerStore) => store.ensure('furnace', 0, ground, 0);
  it('burns fuel only while there is something to smelt', () => {
    const store = new ContainerStore();
    const world = flatWorld();
    const furnace = furnaceAt(store);
    for (let i = 0; i < 40; i++) tickFurnace(furnace, world, 0, ground, 0);
    expect(furnace.slots.get(FURNACE_FUEL)).toBeNull();
    expect(furnace.furnace!.lit).toBe(false);
    furnace.slots.set(FURNACE_INPUT, stack('lab:iron_ore', 5));
    for (let i = 0; i < 3; i++) tickFurnace(furnace, world, 0, ground, 0);
    expect(furnace.furnace!.burn).toBe(0);
    furnace.slots.set(FURNACE_FUEL, stack('lab:coal', 1));
    for (let i = 0; i < 3; i++) tickFurnace(furnace, world, 0, ground, 0);
    expect(furnace.furnace!.burn).toBeGreaterThan(1500);
    expect(furnace.slots.get(FURNACE_FUEL)).toBeNull();
    expect(furnace.furnace!.lit).toBe(true);
  });
  it('turns iron ore into an ingot after exactly 200 burning ticks', () => {
    const store = new ContainerStore();
    const world = flatWorld();
    const furnace = furnaceAt(store);
    furnace.slots.set(FURNACE_INPUT, stack('lab:iron_ore', 2));
    furnace.slots.set(FURNACE_FUEL, stack('lab:coal', 1));
    world.setBlock(0, ground, 0, BLOCK.FURNACE);
    let smelted = 0;
    for (let i = 0; i < 199; i++) smelted += tickFurnace(furnace, world, 0, ground, 0).smelted;
    expect(smelted).toBe(0);
    expect(furnace.slots.get(FURNACE_OUTPUT)).toBeNull();
    smelted += tickFurnace(furnace, world, 0, ground, 0).smelted;
    expect(smelted).toBe(1);
    expect(furnace.slots.get(FURNACE_OUTPUT)).toEqual(stack('lab:iron_ingot', 1));
    expect(furnace.slots.get(FURNACE_INPUT)).toEqual(stack('lab:iron_ore', 1));
    expect(furnace.furnace!.xp).toBeCloseTo(0.7);
    for (let i = 0; i < 200; i++) tickFurnace(furnace, world, 0, ground, 0);
    expect(furnace.slots.get(FURNACE_OUTPUT)).toEqual(stack('lab:iron_ingot', 2));
    expect(furnace.slots.get(FURNACE_INPUT)).toBeNull();
    expect(furnace.furnace!.cook).toBe(0);
  });
  it('relights the block while burning and restores it afterwards', () => {
    const store = new ContainerStore();
    const world = flatWorld();
    const furnace = furnaceAt(store);
    world.setBlock(0, ground, 0, BLOCK.FURNACE);
    furnace.slots.set(FURNACE_INPUT, stack('lab:sand', 1));
    furnace.slots.set(FURNACE_FUEL, stack('lab:stick', 1));
    tickFurnace(furnace, world, 0, ground, 0);
    expect(world.getBlock(0, ground, 0)).toBe(BLOCK.FURNACE_LIT);
    for (let i = 0; i < 120; i++) tickFurnace(furnace, world, 0, ground, 0);
    expect(world.getBlock(0, ground, 0)).toBe(BLOCK.FURNACE);
    expect(furnace.furnace!.lit).toBe(false);
  });
  it('keeps smelting blocked while the output is full without losing items', () => {
    const store = new ContainerStore();
    const world = flatWorld();
    const furnace = furnaceAt(store);
    furnace.slots.set(FURNACE_INPUT, stack('lab:sand', 2));
    furnace.slots.set(FURNACE_FUEL, stack('lab:coal', 1));
    furnace.slots.set(FURNACE_OUTPUT, stack('lab:glass', 64));
    for (let i = 0; i < 100; i++) tickFurnace(furnace, world, 0, ground, 0);
    expect(furnace.slots.get(FURNACE_OUTPUT)!.count).toBe(64);
    expect(furnace.slots.get(FURNACE_INPUT)!.count).toBe(2);
    expect(furnace.furnace!.cook).toBe(0);
    expect(furnace.furnace!.burn).toBeLessThanOrEqual(1600);
  });
  it('smelts every fuel-free ore type and keeps leftovers in the fuel slot', () => {
    const store = new ContainerStore();
    const world = flatWorld();
    const furnace = furnaceAt(store);
    furnace.slots.set(FURNACE_INPUT, stack('lab:oak_log', 1));
    furnace.slots.set(FURNACE_FUEL, stack('lab:oak_planks', 3));
    for (let i = 0; i < 200; i++) tickFurnace(furnace, world, 0, ground, 0);
    expect(furnace.slots.get(FURNACE_OUTPUT)).toEqual(stack('lab:charcoal', 1));
    expect(furnace.slots.get(FURNACE_FUEL)).toEqual(stack('lab:oak_planks', 2));
  });
  it('only ticks furnaces whose column is loaded', () => {
    const store = new ContainerStore();
    const world = flatWorld();
    const loaded = store.ensure('furnace', 0, ground, 0);
    const unloaded = store.ensure('furnace', 400, ground, 0);
    for (const furnace of [loaded, unloaded]) {
      furnace.slots.set(FURNACE_INPUT, stack('lab:iron_ore', 1));
      furnace.slots.set(FURNACE_FUEL, stack('lab:coal', 1));
    }
    for (let i = 0; i < 220; i++) tickFurnaces(store, world);
    expect(loaded.slots.get(FURNACE_OUTPUT)).toEqual(stack('lab:iron_ingot', 1));
    expect(unloaded.slots.get(FURNACE_OUTPUT)).toBeNull();
  });
  it('never lets a click move items between two different furnaces', () => {
    const store = new ContainerStore();
    const first = store.ensure('furnace', 0, ground, 0);
    const second = store.ensure('furnace', 0, ground, 4);
    const carried = stack('lab:coal', 4);
    const ignored = clickSlot(first.slots, FURNACE_FUEL, carried, {
      shift: true,
      quickOrder: ['container'],
    });
    expect(ignored.cursor).toEqual(carried);
    expect(first.slots.get(FURNACE_FUEL)).toBeNull();
    const placed = clickSlot(first.slots, FURNACE_FUEL, carried, {});
    expect(placed.cursor).toBeNull();
    expect(first.slots.get(FURNACE_FUEL)).toEqual(carried);
    expect(second.slots.get(FURNACE_FUEL)).toBeNull();
  });
});
