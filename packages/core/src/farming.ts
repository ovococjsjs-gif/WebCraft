/**
 * Farming and plant growth: tilling, hydration, crops, saplings, cane and cacti.
 *
 * Active plant positions are indexed with their columns. Gameplay uses a fixed simulation
 * radius and staggered 128-tick opportunities, not render-distance-dependent empty-space samples.
 */
import { BLOCK, BLOCK_X, registry, isSoil, type WoodKind } from '../../content/src/blocks';
import { PLANT_TICK_PERIOD, type VoxelWorld } from './world';
import type { LightEngine } from './lighting';

export const CROP_MIN_LIGHT = 9;
/** Chance in percent that a hydrated crop advances one stage on a random tick. */
export const CROP_GROWTH_CHANCE = 12;
/** Unwatered farmland makes growth slow down instead of stopping it, as in the reference. */
export const CROP_DRY_CHANCE = 5;
export const FARMLAND_WATER_RANGE = 4;
/** Farmland without a crop on top turns back into dirt after this many random ticks. */
export const FARMLAND_REVERT_CHANCE = 2;
export const CANE_MAX_HEIGHT = 3;
export const CACTUS_MAX_HEIGHT = 3;
export const SAPLING_GROWTH_CHANCE = 4;
export const TREE_HEIGHT = 5;

const SUGAR_CANE_ITEM = 'lab:sugar_cane';
/** Log and leaves of each kind of tree. */
const TREE_BLOCKS: Record<WoodKind, [number, number]> = {
  oak: [BLOCK.LOG, BLOCK.LEAVES],
  birch: [BLOCK.BIRCH, BLOCK_X.BIRCH_LEAVES],
  spruce: [BLOCK_X.SPRUCE_LOG, BLOCK_X.SPRUCE_LEAVES],
  jungle: [BLOCK_X.JUNGLE_LOG, BLOCK_X.JUNGLE_LEAVES],
  acacia: [BLOCK_X.ACACIA_LOG, BLOCK_X.ACACIA_LEAVES],
  dark_oak: [BLOCK_X.DARK_OAK_LOG, BLOCK_X.DARK_OAK_LEAVES],
};

export interface PlantTickContext {
  readonly world: VoxelWorld;
  readonly light: LightEngine;
  /** Evaluated per tick: the world clock moves while the system lives. */
  readonly isNight: () => boolean;
  readonly random: () => number;
}

export class PlantSystem {
  private pending: { x: number; y: number; z: number }[] = [];
  private readonly queued = new Set<string>();
  constructor(private readonly context: PlantTickContext) {}
  /** Fixed 2-column simulation radius, independent of the renderer's radius. Each active plant
   * gets an attempt every 128 ticks (~6.4s), not one random pick out of 254 empty heights.
   * The queue is fair and capped at 128 updates per simulation tick for very large farms.
   */
  tickActive(tick: number, player: { x: number; z: number }): number {
    const world = this.context.world,
      cx = Math.floor(player.x / 16),
      cz = Math.floor(player.z / 16);
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        const column = world.column(cx + dx, cz + dz);
        if (!column) continue;
        for (const index of column.plantBuckets.get(tick % PLANT_TICK_PERIOD) ?? []) {
          const point = {
            x: column.cx * 16 + (index & 15),
            y: index >> 8,
            z: column.cz * 16 + ((index >> 4) & 15),
          };
          const key = `${point.x},${point.y},${point.z}`;
          if (!this.queued.has(key)) {
            this.pending.push(point);
            this.queued.add(key);
          }
        }
      }
    const batch = this.pending.splice(0, 128);
    for (const { x, y, z } of batch) {
      this.queued.delete(`${x},${y},${z}`);
      if (
        Math.abs(Math.floor(x / 16) - cx) <= 2 &&
        Math.abs(Math.floor(z / 16) - cz) <= 2 &&
        world.isLoaded(x, z)
      )
        this.tickAt(x, y, z);
    }
    return batch.length;
  }
  get backlog() {
    return this.pending.length;
  }

  /**
   * One random tick at a chosen position. `randomTick` uses it internally, and a test or a
   * scripted event can call it directly to get a deterministic result for one block.
   */
  tickAt(x: number, y: number, z: number): boolean {
    const state = this.context.world.getBlock(x, y, z);
    const def = registry.get(state);
    if (def.stem !== undefined && def.cropStage === 7) return this.growFruit(x, y, z, def.stem);
    if (def.cropStage !== undefined) return this.growCrop(x, y, z, state);
    if (def.sapling !== undefined) {
      this.tickSapling(x, y, z, def.sapling);
      return true;
    }
    if (state === BLOCK.FARMLAND || state === BLOCK.FARMLAND_WET) {
      this.tickFarmland(x, y, z, state);
      return true;
    }
    if (state === BLOCK.SUGAR_CANE) {
      this.tickCane(x, y, z);
      return true;
    }
    if (state === BLOCK.CACTUS) {
      this.tickCactus(x, y, z);
      return true;
    }
    return false;
  }

  /** Random ticks: `count` positions are drawn from the loaded columns. */
  randomTick(count: number): void {
    const columns = [...this.context.world.columns.values()].filter((c) => c.status === 'ready');
    if (!columns.length) return;
    for (let i = 0; i < count; i++) {
      const column = columns[Math.floor(this.context.random() * columns.length)];
      const x = column.cx * 16 + Math.floor(this.context.random() * 16);
      const z = column.cz * 16 + Math.floor(this.context.random() * 16);
      const y = 1 + Math.floor(this.context.random() * 254);
      this.tickAt(x, y, z);
    }
  }

  /** Hoe on grass or dirt makes farmland; the reference refuses when a block sits on top. */
  till(x: number, y: number, z: number): boolean {
    const above = this.context.world.getBlock(x, y + 1, z);
    if (above !== BLOCK.AIR && registry.get(above).solid) return false;
    const state = this.context.world.getBlock(x, y, z);
    if (state !== BLOCK.GRASS && state !== BLOCK.DIRT) return false;
    return this.context.world.setBlock(
      x,
      y,
      z,
      this.isHydrated(x, y, z) ? BLOCK.FARMLAND_WET : BLOCK.FARMLAND,
    );
  }

  /** Water within four blocks on the same level or one above keeps farmland wet. */
  isHydrated(x: number, y: number, z: number): boolean {
    for (let dx = -FARMLAND_WATER_RANGE; dx <= FARMLAND_WATER_RANGE; dx++)
      for (let dz = -FARMLAND_WATER_RANGE; dz <= FARMLAND_WATER_RANGE; dz++)
        for (const dy of [0, 1, -1])
          if (registry.get(this.context.world.getBlock(x + dx, y + dy, z + dz)).fluid === 'water')
            return true;
    return false;
  }

  private tickFarmland(x: number, y: number, z: number, state: number): void {
    const hydrated = this.isHydrated(x, y, z);
    const wanted = hydrated ? BLOCK.FARMLAND_WET : BLOCK.FARMLAND;
    if (state !== wanted) this.context.world.setBlock(x, y, z, wanted);
    const above = this.context.world.getBlock(x, y + 1, z);
    const cropAbove = registry.get(above).cropStage !== undefined;
    if (!cropAbove && this.context.random() * 100 < FARMLAND_REVERT_CHANCE)
      this.context.world.setBlock(x, y, z, BLOCK.DIRT);
  }

  /** Wheat and the crops that behave like it: one stage at a time, light and water needed. */
  growCrop(x: number, y: number, z: number, state: number): boolean {
    const def = registry.get(state);
    if (def.cropStage === undefined) return false;
    if (def.cropStage >= 7) return false;
    const light = this.context.light.lightAt(x, y, z, this.context.isNight());
    if (light < CROP_MIN_LIGHT) return false;
    const below = this.context.world.getBlock(x, y - 1, z);
    const wet = below === BLOCK.FARMLAND_WET;
    const chance = wet ? CROP_GROWTH_CHANCE : CROP_DRY_CHANCE;
    if (this.context.random() * 100 >= chance) return false;
    const next = def.cropNext;
    if (next === undefined) return false;
    return this.context.world.setBlock(x, y, z, next);
  }

  /** Bone meal: three stages at once, which is the reference behaviour for wheat. */
  fertilize(x: number, y: number, z: number, stages = 3): boolean {
    let changed = false;
    for (let i = 0; i < stages; i++) {
      const state = this.context.world.getBlock(x, y, z);
      const def = registry.get(state);
      if (def.cropStage === undefined || def.cropNext === undefined) break;
      if (!this.context.world.setBlock(x, y, z, def.cropNext)) break;
      changed = true;
    }
    return changed;
  }

  /** A ripe stem sets a melon or a pumpkin on a free neighbour standing on dirt or grass. */
  private growFruit(x: number, y: number, z: number, fruit: 'melon' | 'pumpkin'): boolean {
    const world = this.context.world;
    const light = this.context.light.lightAt(x, y, z, this.context.isNight());
    if (light < CROP_MIN_LIGHT) return false;
    if (this.context.random() * 100 >= CROP_GROWTH_CHANCE) return false;
    const block = fruit === 'melon' ? BLOCK.MELON : BLOCK.PUMPKIN;
    const sides = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const;
    // One fruit per stem at a time, as in the reference.
    for (const [dx, dz] of sides) if (world.getBlock(x + dx, y, z + dz) === block) return false;
    const [dx, dz] = sides[Math.floor(this.context.random() * 4)];
    if (world.getBlock(x + dx, y, z + dz) !== BLOCK.AIR) return false;
    const ground = world.getBlock(x + dx, y - 1, z + dz);
    if (!isSoil(ground) && ground !== BLOCK.FARMLAND && ground !== BLOCK.FARMLAND_WET) return false;
    return world.setBlock(x + dx, y, z + dz, block);
  }

  private tickSapling(x: number, y: number, z: number, kind: WoodKind = 'oak'): void {
    const light = this.context.light.lightAt(x, y, z, this.context.isNight());
    if (light < CROP_MIN_LIGHT) return;
    if (this.context.random() * 100 >= SAPLING_GROWTH_CHANCE) return;
    const below = this.context.world.getBlock(x, y - 1, z);
    if (!isSoil(below)) return;
    this.buildTree(x, y, z, kind);
  }

  /**
   * Grows the tree of a sapling, placed only where the trunk has room: a round oak or birch, a
   * cone of spruce, a tall jungle tree, an acacia leaning to one side, a squat dark oak.
   */
  buildTree(x: number, y: number, z: number, kind: WoodKind = 'oak'): boolean {
    const world = this.context.world,
      random = this.context.random;
    const [log, leaf] = TREE_BLOCKS[kind];
    const height =
      kind === 'oak'
        ? TREE_HEIGHT
        : kind === 'birch'
          ? 5 + Math.floor(random() * 2)
          : kind === 'spruce'
            ? 6 + Math.floor(random() * 3)
            : kind === 'jungle'
              ? 7 + Math.floor(random() * 4)
              : kind === 'acacia'
                ? 5 + Math.floor(random() * 2)
                : 6;
    for (let i = 1; i < height + 2; i++) {
      const state = world.getBlock(x, y + i, z);
      if (state !== BLOCK.AIR && registry.get(state).solid) return false;
    }
    const leafAt = (lx: number, ly: number, lz: number) => {
      if (world.getBlock(lx, ly, lz) === BLOCK.AIR) world.setBlock(lx, ly, lz, leaf);
    };
    const logAt = (lx: number, ly: number, lz: number) => {
      const state = world.getBlock(lx, ly, lz);
      if (state === BLOCK.AIR || !registry.get(state).solid || registry.get(state).sapling)
        world.setBlock(lx, ly, lz, log);
    };
    world.setBlock(x, y, z, BLOCK.AIR);
    if (kind === 'spruce') {
      for (let i = 0; i < height; i++) logAt(x, y + i, z);
      // Rings that shrink towards the top, with a pointed tip.
      for (let dy = 2; dy <= height; dy++) {
        // Alternating wide and narrow rings, narrow near the top.
        const r = dy >= height - 1 ? 1 : (height - dy) % 2 === 0 ? 2 : 1;
        for (let dx = -r; dx <= r; dx++)
          for (let dz = -r; dz <= r; dz++)
            if (Math.abs(dx) + Math.abs(dz) <= r + (r > 1 ? 1 : 0)) leafAt(x + dx, y + dy, z + dz);
      }
      leafAt(x, y + height, z);
      return true;
    }
    if (kind === 'acacia') {
      const [ox, oz] = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ][Math.floor(random() * 4)];
      let tx = x,
        tz = z;
      for (let i = 0; i < height; i++) {
        if (i >= height - 3) {
          tx += ox;
          tz += oz;
        }
        logAt(tx, y + i, tz);
      }
      const top = y + height;
      for (let dx = -2; dx <= 2; dx++)
        for (let dz = -2; dz <= 2; dz++) {
          if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
          leafAt(tx + dx, top - 1, tz + dz);
          if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) leafAt(tx + dx, top, tz + dz);
        }
      return true;
    }
    if (kind === 'dark_oak') {
      // A 2×2 trunk under a wide flat crown.
      for (let i = 0; i < height; i++)
        for (const [dx, dz] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ] as const)
          logAt(x + dx, y + i, z + dz);
      for (let dy = height - 2; dy <= height; dy++) {
        const r = dy === height ? 2 : 3;
        for (let dx = -r; dx <= r + 1; dx++)
          for (let dz = -r; dz <= r + 1; dz++) {
            const corner = (dx === -r || dx === r + 1) && (dz === -r || dz === r + 1);
            if (!corner) leafAt(x + dx, y + dy, z + dz);
          }
      }
      return true;
    }
    for (let i = 0; i < height; i++) logAt(x, y + i, z);
    const crown = kind === 'jungle' ? 2 : 3;
    for (let dy = height - crown; dy <= height; dy++) {
      const radius = dy === height ? 1 : 2;
      for (let dx = -radius; dx <= radius; dx++)
        for (let dz = -radius; dz <= radius; dz++) {
          if (dx === 0 && dz === 0 && dy < height) continue;
          if (Math.abs(dx) === radius && Math.abs(dz) === radius && random() < 0.5) continue;
          leafAt(x + dx, y + dy, z + dz);
        }
    }
    return true;
  }

  /** Sugar cane needs water next to it and grows to three blocks. */
  private tickCane(x: number, y: number, z: number): void {
    let base = y;
    while (base > 0 && this.context.world.getBlock(x, base - 1, z) === BLOCK.SUGAR_CANE) base--;
    if (!this.hasWaterNearby(x, base, z)) return;
    if (this.context.random() * 100 >= CROP_DRY_CHANCE) return;
    const above = this.context.world.getBlock(x, y + 1, z);
    if (above !== BLOCK.AIR) return;
    let height = 1;
    for (let dy = 1; dy < CANE_MAX_HEIGHT; dy++)
      if (this.context.world.getBlock(x, y - dy, z) === BLOCK.SUGAR_CANE) height++;
    if (height >= CANE_MAX_HEIGHT) return;
    this.context.world.setBlock(x, y + 1, z, BLOCK.SUGAR_CANE);
  }

  private hasWaterNearby(x: number, y: number, z: number): boolean {
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const)
      for (const dy of [0, -1])
        if (registry.get(this.context.world.getBlock(x + dx, y + dy, z + dz)).fluid === 'water')
          return true;
    return false;
  }

  /** Cacti grow on sand and refuse to be crowded by their neighbours. */
  private tickCactus(x: number, y: number, z: number): void {
    const below = this.context.world.getBlock(x, y - 1, z);
    if (below !== BLOCK.SAND && below !== BLOCK.CACTUS) return;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const)
      if (registry.get(this.context.world.getBlock(x + dx, y, z + dz)).solid) return;
    if (this.context.random() * 100 >= CROP_DRY_CHANCE) return;
    if (this.context.world.getBlock(x, y + 1, z) !== BLOCK.AIR) return;
    let height = 1;
    for (let dy = 1; dy < CACTUS_MAX_HEIGHT; dy++)
      if (this.context.world.getBlock(x, y - dy, z) === BLOCK.CACTUS) height++;
    if (height >= CACTUS_MAX_HEIGHT) return;
    this.context.world.setBlock(x, y + 1, z, BLOCK.CACTUS);
  }

  /** Seeds plant a crop: the reference requires farmland below and light above. */
  plantSeeds(x: number, y: number, z: number, crop: number = BLOCK.WHEAT_0): boolean {
    const below = this.context.world.getBlock(x, y - 1, z);
    if (below !== BLOCK.FARMLAND && below !== BLOCK.FARMLAND_WET) return false;
    if (this.context.world.getBlock(x, y, z) !== BLOCK.AIR) return false;
    return this.context.world.setBlock(x, y, z, crop);
  }

  /** Harvest: a grown crop returns its drops and turns back into a fresh seedling. */
  harvest(x: number, y: number, z: number): 'ripe' | 'young' | 'none' {
    const state = this.context.world.getBlock(x, y, z);
    const def = registry.get(state);
    if (def.cropStage === undefined || def.stem !== undefined) return 'none';
    if (def.cropStage >= 7) {
      // Each crop's eight stages are consecutive states: the first one is the seedling.
      this.context.world.setBlock(x, y, z, state - def.cropStage);
      return 'ripe';
    }
    this.context.world.setBlock(x, y, z, BLOCK.AIR);
    return 'young';
  }

  /** Right-clicking sugar cane or a crop with a hoe or hand: the reference has no such use. */
  caneItem(): string {
    return SUGAR_CANE_ITEM;
  }
}
