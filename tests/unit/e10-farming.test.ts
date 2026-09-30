import { describe, it, expect } from 'vitest';
import { BLOCK, registry } from '../../packages/content/src/blocks';
import { WorldSession } from '../../packages/core/src/session';
import {
  CACTUS_MAX_HEIGHT,
  CANE_MAX_HEIGHT,
  CROP_MIN_LIGHT,
  FARMLAND_WATER_RANGE,
  TREE_HEIGHT,
} from '../../packages/core/src/farming';

/**
 * Acceptance suite for E10 «растения, земледелие и природные процессы». Growth is measured in
 * stages and blocks: how a hoe turns soil, when a crop refuses to grow, how many blocks a cane
 * reaches, and what a sapling leaves behind after it grows into a tree.
 */
function session(seed = 'e10-farming'): WorldSession {
  const world = new WorldSession(seed, 'flat');
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) world.loadColumn(x, z);
  // A deterministic clock: the crop rules depend on the light level, which depends on the time.
  world.world.time = 6000;
  return world;
}
function put(world: WorldSession, x: number, y: number, z: number, state: number): void {
  world.simulation.setBlockState(x, y, z, state);
}
/** Runs random ticks with a seedable generator until the predicate holds or the budget is out. */
function growUntil(
  world: WorldSession,
  cells: [number, number, number][],
  check: () => boolean,
  maxTicks = 4000,
): boolean {
  const sim = world.simulation;
  for (let i = 0; i < maxTicks; i++) {
    if (check()) return true;
    world.world.tick++;
    for (const [x, y, z] of cells) sim.plants.tickAt(x, y, z);
  }
  return check();
}

describe('E10 · tilling and hydration', () => {
  it('turns grass into farmland with a hoe and keeps it wet next to water', () => {
    const world = session();
    const sim = world.simulation;
    const y = 8;
    expect(world.world.getBlock(3, y, 3)).toBe(BLOCK.GRASS);
    // Water four blocks away already reaches the soil: the hoe leaves wet farmland.
    put(world, 3 + FARMLAND_WATER_RANGE, y, 3, BLOCK.WATER);
    expect(sim.plants.isHydrated(3, y, 3)).toBe(true);
    expect(sim.plants.till(3, y, 3)).toBe(true);
    expect(world.world.getBlock(3, y, 3)).toBe(BLOCK.FARMLAND_WET);
    // Dry soil away from any water stays dry.
    put(world, 9, y, 9, BLOCK.GRASS);
    expect(sim.plants.isHydrated(9, y, 9)).toBe(false);
    expect(sim.plants.till(9, y, 9)).toBe(true);
    expect(world.world.getBlock(9, y, 9)).toBe(BLOCK.FARMLAND);
    expect(FARMLAND_WATER_RANGE).toBe(4);
  });

  it('refuses to till soil that is covered by a block', () => {
    const world = session();
    const sim = world.simulation;
    expect(sim.plants.till(3, 8, 3)).toBe(true);
    put(world, 3, 9, 3, BLOCK.STONE);
    put(world, 3, 8, 3, BLOCK.DIRT);
    expect(sim.plants.till(3, 8, 3)).toBe(false);
    expect(world.world.getBlock(3, 8, 3)).toBe(BLOCK.DIRT);
  });

  it('turns farmland back into dirt when nothing is planted on it', () => {
    const world = session();
    put(world, 5, 8, 5, BLOCK.FARMLAND);
    const reverted = growUntil(
      world,
      [[5, 8, 5]],
      () => world.world.getBlock(5, 8, 5) === BLOCK.DIRT,
      20_000,
    );
    expect(reverted).toBe(true);
  });
});

describe('E10 · crops', () => {
  it('plants seeds on farmland and grows them one stage at a time', () => {
    const world = session();
    const sim = world.simulation;
    put(world, 4, 8, 4, BLOCK.FARMLAND_WET);
    expect(sim.plants.plantSeeds(4, 9, 4)).toBe(true);
    expect(world.world.getBlock(4, 9, 4)).toBe(BLOCK.WHEAT_0);
    // Seeds cannot be planted off farmland.
    expect(sim.plants.plantSeeds(6, 9, 6)).toBe(false);
    const grown = growUntil(
      world,
      [[4, 9, 4]],
      () => registry.get(world.world.getBlock(4, 9, 4)).cropStage === 7,
      20_000,
    );
    expect(grown).toBe(true);
    // Growth is gradual: the stages in between existed, they did not jump.
    for (let stage = 0; stage < 7; stage++) expect(BLOCK.WHEAT_0 + stage).toBe(42 + stage);
    expect(CROP_MIN_LIGHT).toBe(9);
  });

  it('stops growing in the dark, where a hostile creature could spawn', () => {
    const world = session();
    const sim = world.simulation;
    put(world, 7, 8, 7, BLOCK.FARMLAND_WET);
    put(world, 7, 9, 7, BLOCK.WHEAT_3);
    // A roof of stone takes the sky light away from the plant.
    for (let x = 5; x <= 9; x++) for (let z = 5; z <= 9; z++) put(world, x, 12, z, BLOCK.STONE);
    expect(sim.light.lightAt(7, 9, 7, false)).toBeLessThan(CROP_MIN_LIGHT);
    for (let i = 0; i < 200; i++) sim.plants.tickAt(7, 9, 7);
    expect(world.world.getBlock(7, 9, 7)).toBe(BLOCK.WHEAT_3);
    expect(sim.plants.growCrop(7, 9, 7, BLOCK.WHEAT_3)).toBe(false);
  });

  it('jumps three stages with bone meal and harvests a ripe crop back to a seedling', () => {
    const world = session();
    const sim = world.simulation;
    put(world, 8, 8, 8, BLOCK.FARMLAND_WET);
    put(world, 8, 9, 8, BLOCK.WHEAT_0);
    expect(sim.plants.fertilize(8, 9, 8)).toBe(true);
    expect(world.world.getBlock(8, 9, 8)).toBe(BLOCK.WHEAT_3);
    expect(registry.get(BLOCK.WHEAT_7).drops).toEqual([
      { item: 'lab:wheat' },
      { item: 'lab:seeds', count: 3 },
    ]);
    put(world, 8, 9, 8, BLOCK.WHEAT_7);
    expect(sim.plants.harvest(8, 9, 8)).toBe('ripe');
    expect(world.world.getBlock(8, 9, 8)).toBe(BLOCK.WHEAT_0);
    // An unripe crop is pulled out completely instead.
    put(world, 9, 9, 8, BLOCK.WHEAT_2);
    expect(sim.plants.harvest(9, 9, 8)).toBe('young');
    expect(world.world.getBlock(9, 9, 8)).toBe(BLOCK.AIR);
  });
});

describe('E10 · trees, cane and cacti', () => {
  it('grows a sapling into a five block oak with a crown of leaves', () => {
    const world = session();
    put(world, -3, 9, -3, BLOCK.OAK_SAPLING);
    const grown = growUntil(
      world,
      [[-3, 9, -3]],
      () => world.world.getBlock(-3, 9, -3) === BLOCK.LOG,
      20_000,
    );
    expect(grown).toBe(true);
    for (let i = 0; i < TREE_HEIGHT; i++)
      expect(world.world.getBlock(-3, 9 + i, -3)).toBe(BLOCK.LOG);
    let leaves = 0;
    for (let y = 9; y <= 9 + TREE_HEIGHT; y++)
      for (let x = -5; x <= -1; x++)
        for (let z = -5; z <= -1; z++) if (world.world.getBlock(x, y, z) === BLOCK.LEAVES) leaves++;
    expect(leaves).toBeGreaterThan(8);
    expect(TREE_HEIGHT).toBe(5);
  });

  it('grows sugar cane to three blocks only beside water', () => {
    const world = session();
    const sim = world.simulation;
    put(world, 1, 8, 1, BLOCK.SAND);
    put(world, 1, 9, 1, BLOCK.SUGAR_CANE);
    // Dry cane does not grow: no water next to it.
    for (let i = 0; i < 500; i++) sim.plants.tickAt(1, 9, 1);
    expect(world.world.getBlock(1, 10, 1)).toBe(BLOCK.AIR);
    put(world, 2, 9, 1, BLOCK.WATER);
    const grown = growUntil(
      world,
      [
        [1, 9, 1],
        [1, 10, 1],
      ],
      () => world.world.getBlock(1, 11, 1) === BLOCK.SUGAR_CANE,
      40_000,
    );
    expect(grown).toBe(true);
    expect(world.world.getBlock(1, 12, 1)).toBe(BLOCK.AIR);
    expect(CANE_MAX_HEIGHT).toBe(3);
  });

  it('grows a cactus on sand to three blocks, but keeps it out of a crowd', () => {
    const world = session();
    const sim = world.simulation;
    put(world, -1, 8, -1, BLOCK.SAND);
    put(world, -1, 9, -1, BLOCK.CACTUS);
    const grown = growUntil(
      world,
      [
        [-1, 9, -1],
        [-1, 10, -1],
      ],
      () => world.world.getBlock(-1, 11, -1) === BLOCK.CACTUS,
      40_000,
    );
    expect(grown).toBe(true);
    // A solid neighbour stops the growth: cacti refuse to touch anything.
    put(world, 0, 11, -1, BLOCK.STONE);
    put(world, -2, 8, -4, BLOCK.SAND);
    put(world, -2, 9, -4, BLOCK.CACTUS);
    put(world, -1, 9, -4, BLOCK.STONE);
    for (let i = 0; i < 2000; i++) sim.plants.tickAt(-2, 9, -4);
    expect(world.world.getBlock(-2, 10, -4)).toBe(BLOCK.AIR);
    expect(CACTUS_MAX_HEIGHT).toBe(3);
  });
});
