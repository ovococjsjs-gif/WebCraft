import { BLOCK, registry } from '../../content/src/blocks';
import {
  ItemContainer,
  encodeSlots,
  decodeSlots,
  type Container,
  type Slot,
  type SlotData,
} from './inventory';
import { smeltingFor, fuelTicks } from './crafting';
import type { VoxelWorld } from './world';
export const CHEST_SLOTS = 27;
export const FURNACE_SLOTS = 3;
/** A hopper holds five slots and passes one item at a time. */
export const HOPPER_SLOTS = 5;
/** A dispenser and a dropper hold nine slots in a 3x3 grid. */
export const DISPENSER_SLOTS = 9;
/** Chests pair on both horizontal axes, so these are the four neighbours that can form a double. */
const CHEST_NEIGHBOURS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;
/** The half that owns slots 0..26: the western chest, or the northern one. */
const CHEST_LOWER_HALF = [
  [-1, 0],
  [0, -1],
] as const;
/** The half that owns slots 27..53: the eastern chest, or the southern one. */
const CHEST_UPPER_HALF = [
  [1, 0],
  [0, 1],
] as const;
export const FURNACE_INPUT = 0,
  FURNACE_FUEL = 1,
  FURNACE_OUTPUT = 2;
/** Container region naming shared by every block container. */
export const CONTAINER_VIEW_REGIONS = (containerSize: number) => [
  { name: 'container', from: 0, to: containerSize },
  { name: 'hotbar', from: containerSize, to: containerSize + 9 },
  { name: 'main', from: containerSize + 9, to: containerSize + 36 },
];
export function positionKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}
export function parsePositionKey(key: string): { x: number; y: number; z: number } {
  const [x, y, z] = key.split(',').map(Number);
  if (![x, y, z].every(Number.isFinite)) throw new Error(`Bad container key ${key}`);
  return { x, y, z };
}
export interface FurnaceState {
  burn: number; // ticks of fuel left
  burnTotal: number; // ticks the current fuel item provides, for the flame icon
  cook: number; // progress towards one smelt
  lit: boolean;
  /** Experience banked by this furnace; awarded to the player when the output is taken out. */
  xp: number;
  /** Experience one finished item is worth, recorded when it was smelted. */
  perItem: number;
}
export interface ContainerBlock {
  kind: 'chest' | 'furnace' | 'hopper' | 'dispenser';
  slots: ItemContainer;
  furnace?: FurnaceState;
}
/** Adjacent chests share one interface, exactly like the reference double chest. */
export class DoubleChest implements Container {
  readonly size = CHEST_SLOTS * 2;
  constructor(
    readonly first: ItemContainer,
    readonly second: ItemContainer,
  ) {
    if (first.size !== CHEST_SLOTS || second.size !== CHEST_SLOTS)
      throw new Error('Double chest halves must have 27 slots each');
    this.regions = CONTAINER_VIEW_REGIONS(this.size);
  }
  readonly regions: { name: string; from: number; to: number }[];
  private half(index: number): { container: ItemContainer; local: number } {
    if (index < CHEST_SLOTS) return { container: this.first, local: index };
    return { container: this.second, local: index - CHEST_SLOTS };
  }
  get(index: number): Slot {
    const { container, local } = this.half(index);
    return container.get(local);
  }
  set(index: number, slot: Slot): void {
    const { container, local } = this.half(index);
    container.set(local, slot);
  }
}
export class ContainerStore {
  private readonly blocks = new Map<string, ContainerBlock>();
  private readonly order: string[] = [];
  get size(): number {
    return this.blocks.size;
  }
  keys(): string[] {
    return [...this.order];
  }
  entries(): [string, ContainerBlock][] {
    return this.order.map((key) => [key, this.blocks.get(key)!]);
  }
  snapshotEntries(): {
    key: string;
    kind: 'chest' | 'furnace' | 'hopper' | 'dispenser';
    slots: SlotData[];
    furnace?: {
      burn: number;
      burnTotal: number;
      cook: number;
      xp: number;
      perItem?: number;
    };
  }[] {
    return this.entries().map(([key, block]) => ({
      key,
      kind: block.kind,
      slots: encodeSlots(block.slots.slots),
      ...(block.furnace
        ? {
            furnace: {
              burn: block.furnace.burn,
              burnTotal: block.furnace.burnTotal,
              cook: block.furnace.cook,
              xp: block.furnace.xp,
              perItem: block.furnace.perItem,
            },
          }
        : {}),
    }));
  }
  get(x: number, y: number, z: number): ContainerBlock | undefined {
    return this.blocks.get(positionKey(x, y, z));
  }
  /** Creates the block container the first time it is used. */
  ensure(
    kind: 'chest' | 'furnace' | 'hopper' | 'dispenser',
    x: number,
    y: number,
    z: number,
  ): ContainerBlock {
    const key = positionKey(x, y, z);
    const existing = this.blocks.get(key);
    if (existing) {
      if (existing.kind !== kind) throw new Error(`Container at ${key} is a ${existing.kind}`);
      return existing;
    }
    const size =
      kind === 'chest'
        ? CHEST_SLOTS
        : kind === 'hopper'
          ? HOPPER_SLOTS
          : kind === 'dispenser'
            ? DISPENSER_SLOTS
            : FURNACE_SLOTS;
    const created: ContainerBlock = {
      kind,
      slots: new ItemContainer(size, [{ name: 'container', from: 0, to: size }]),
      ...(kind === 'furnace'
        ? { furnace: { burn: 0, burnTotal: 0, cook: 0, lit: false, xp: 0, perItem: 0 } }
        : {}),
    };
    this.blocks.set(key, created);
    this.order.push(key);
    return created;
  }
  remove(x: number, y: number, z: number): ContainerBlock | undefined {
    const key = positionKey(x, y, z);
    const block = this.blocks.get(key);
    if (block) {
      this.blocks.delete(key);
      const index = this.order.indexOf(key);
      if (index >= 0) this.order.splice(index, 1);
    }
    return block;
  }
  clear(): void {
    this.blocks.clear();
    this.order.length = 0;
  }
  /**
   * The chest partner on either horizontal axis. The block in the world decides, so a chest
   * placed next to another one joins it even when neither half has been opened before.
   */
  doubleChestFor(world: VoxelWorld, x: number, y: number, z: number): ContainerBlock | undefined {
    for (const [dx, dz] of CHEST_NEIGHBOURS) {
      if (registry.get(world.getBlock(x + dx, y, z + dz)).opens !== 'chest') continue;
      return this.ensure('chest', x + dx, y, z + dz);
    }
    return undefined;
  }
  /**
   * A view of one or both chest halves. Slots 0..26 are the western half of an east-west pair or
   * the northern half of a north-south pair, so the layout never depends on the opened half.
   */
  chestView(world: VoxelWorld, x: number, y: number, z: number): Container {
    const self = this.ensure('chest', x, y, z);
    const blocked = (dx: number, dz: number) =>
      registry.get(world.getBlock(x + dx, y, z + dz)).opens === 'chest';
    for (const [dx, dz] of CHEST_LOWER_HALF) {
      if (!blocked(dx, dz)) continue;
      const first = this.ensure('chest', x + dx, y, z + dz);
      return new DoubleChest(first.slots, self.slots);
    }
    for (const [dx, dz] of CHEST_UPPER_HALF) {
      if (!blocked(dx, dz)) continue;
      const second = this.ensure('chest', x + dx, y, z + dz);
      return new DoubleChest(self.slots, second.slots);
    }
    return new ChestProxy(self);
  }
  snapshot(): Record<string, SlotData[]> {
    const result: Record<string, SlotData[]> = {};
    for (const key of this.order) {
      const block = this.blocks.get(key)!;
      result[key] = encodeSlots(block.slots.slots);
    }
    return result;
  }
  restoreEntries(
    entries: readonly {
      key: string;
      kind: 'chest' | 'furnace' | 'hopper' | 'dispenser';
      slots: SlotData[];
      furnace?: {
        burn: number;
        burnTotal: number;
        cook: number;
        xp?: number;
        perItem?: number;
      };
    }[],
  ): void {
    this.clear();
    for (const entry of entries) {
      const { x, y, z } = parsePositionKey(entry.key);
      const block = this.ensure(entry.kind, x, y, z);
      if (entry.slots.length !== block.slots.size)
        throw new Error(
          `Container ${entry.key} has ${entry.slots.length} slots, expected ${block.slots.size}`,
        );
      block.slots.slots.splice(0, block.slots.size, ...decodeSlots(entry.slots));
      if (block.furnace && entry.furnace) {
        block.furnace.burn = entry.furnace.burn;
        block.furnace.burnTotal = entry.furnace.burnTotal;
        block.furnace.cook = entry.furnace.cook;
        block.furnace.xp = entry.furnace.xp ?? 0;
        block.furnace.perItem = entry.furnace.perItem ?? 0;
        block.furnace.lit = entry.furnace.burn > 0;
      }
    }
  }
}
/** A chest cannot be opened when a solid block sits directly above its lid. */
export function chestObstructed(
  store: ContainerStore,
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
): boolean {
  void store;
  return registry.get(world.getBlock(x, y + 1, z)).solid;
}
/** Refuses a third chest in one cluster, exactly like the two-half limit of the reference game. */
export function chestPlacementAllowed(
  store: ContainerStore,
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
): boolean {
  const neighbours = CHEST_NEIGHBOURS.filter(
    ([dx, dz]) => registry.get(world.getBlock(x + dx, y, z + dz)).opens === 'chest',
  ).map(([dx, dz]) => [x + dx, z + dz] as const);
  if (neighbours.length === 0) return true;
  if (neighbours.length > 1) return false;
  const [neighbourX, neighbourZ] = neighbours[0];
  return !store.doubleChestFor(world, neighbourX, y, neighbourZ);
}
/** Live view of a single chest's own slots. */
class ChestProxy implements Container {
  readonly regions = [{ name: 'container', from: 0, to: CHEST_SLOTS }];
  readonly size = CHEST_SLOTS;
  constructor(private readonly block: ContainerBlock) {}
  get(index: number): Slot {
    return this.block.slots.get(index);
  }
  set(index: number, slot: Slot): void {
    this.block.slots.set(index, slot);
  }
}
export interface FurnaceTickResult {
  readonly smelted: number;
  readonly litChanged: boolean;
}
/**
 * One furnace tick. Fuel is only consumed when there is something to smelt and the
 * output has room, which is why a furnace does not burn through coal while idle.
 */
export function tickFurnace(
  block: ContainerBlock,
  world?: VoxelWorld,
  x = 0,
  y = 0,
  z = 0,
): FurnaceTickResult {
  if (block.kind !== 'furnace' || !block.furnace) return { smelted: 0, litChanged: false };
  const state = block.furnace;
  const input = block.slots.get(FURNACE_INPUT);
  const output = block.slots.get(FURNACE_OUTPUT);
  const recipe = smeltingFor(input);
  const outputRoom = recipe
    ? !output || (output.item === recipe.result[0] && output.count + recipe.result[1] <= 64)
    : false;
  const wasLit = state.lit;
  // 1. Light up: fuel is only consumed when there is something to smelt and room for it.
  if (state.burn === 0 && recipe && outputRoom) {
    const fuel = block.slots.get(FURNACE_FUEL);
    const ticks = fuel ? fuelTicks(fuel.item) : 0;
    if (fuel && ticks > 0) {
      state.burn = ticks;
      state.burnTotal = ticks;
      block.slots.set(FURNACE_FUEL, fuel.count > 1 ? { ...fuel, count: fuel.count - 1 } : null);
    }
  }
  // 2. Cook, then spend one tick of fuel. 1600 fuel ticks therefore smelt exactly 8 items.
  let smelted = 0;
  if (state.burn > 0) {
    if (recipe && outputRoom) {
      state.cook++;
      if (state.cook >= recipe.ticks) {
        state.cook = 0;
        smelted++;
        state.xp += recipe.xp;
        state.perItem = recipe.xp;
        block.slots.set(
          FURNACE_INPUT,
          input!.count > 1 ? { ...input!, count: input!.count - 1 } : null,
        );
        block.slots.set(
          FURNACE_OUTPUT,
          output
            ? { ...output, count: output.count + recipe.result[1] }
            : { item: recipe.result[0], count: recipe.result[1] },
        );
      }
    } else {
      state.cook = Math.max(0, state.cook - 2);
    }
    state.burn--;
  }
  state.lit = state.burn > 0;
  const litChanged = state.lit !== wasLit;
  if (litChanged && world && world.isLoaded(x, z)) applyLitState(world, x, y, z, state.lit);
  return { smelted, litChanged };
}
function applyLitState(world: VoxelWorld, x: number, y: number, z: number, lit: boolean): void {
  const current = world.getBlock(x, y, z);
  const def = registry.get(current);
  if (lit && current === BLOCK.FURNACE) world.setBlock(x, y, z, BLOCK.FURNACE_LIT);
  else if (!lit && current === BLOCK.FURNACE_LIT) world.setBlock(x, y, z, BLOCK.FURNACE);
  else if (def.opens !== 'furnace' && def.opens !== undefined) return;
}
/** Ticks every loaded furnace; unloaded ones resume from their saved counters later. */
export function tickFurnaces(store: ContainerStore, world: VoxelWorld): number {
  let smelted = 0;
  for (const [key, block] of store.entries()) {
    if (block.kind !== 'furnace') continue;
    const { x, y, z } = parsePositionKey(key);
    if (!world.isLoaded(x, z)) continue;
    smelted += tickFurnace(block, world, x, y, z).smelted;
  }
  return smelted;
}
/** Removes containers whose block is gone, and drops their contents into the world. */
export function pruneContainers(
  store: ContainerStore,
  world: VoxelWorld,
  onDrop: (item: string, count: number, damage: number, x: number, y: number, z: number) => void,
): void {
  for (const key of store.keys()) {
    const { x, y, z } = parsePositionKey(key);
    const def = registry.get(world.getBlock(x, y, z));
    if (def.opens === 'chest' || def.opens === 'furnace') continue;
    const block = store.remove(x, y, z)!;
    for (const slot of block.slots.slots)
      if (slot) onDrop(slot.item, slot.count, slot.damage ?? 0, x + 0.5, y + 0.5, z + 0.5);
  }
}
