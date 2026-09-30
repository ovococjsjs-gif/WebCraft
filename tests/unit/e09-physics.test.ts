import { JavaRandom } from '../../packages/core/src/random';
import { describe, it, expect } from 'vitest';
import { BLOCK, registry } from '../../packages/content/src/blocks';
import { WorldSession } from '../../packages/core/src/session';
import {
  FLUID_BUDGET,
  LAVA_DELAY,
  LAVA_MAX_LEVEL,
  WATER_DELAY,
  WATER_MAX_LEVEL,
  fluidLevelOf,
  isFluidSource,
} from '../../packages/core/src/fluids';
import { FALLING_START_DELAY, FIRE_LIFETIME, TNT_FUSE } from '../../packages/core/src/blocksim';

/**
 * Acceptance suite for E09 «физика блоков, жидкости, огонь и взрывы». Every check is a number
 * or a state comparison on the real systems, not an animation: levels of a flow, ticks between
 * two fluid steps, how many blocks a blast removes and what the lava leaves behind.
 */
function session(seed = 'e09-physics', columns = 1): WorldSession {
  const world = new WorldSession(seed, 'flat');
  for (let x = -columns; x <= columns; x++)
    for (let z = -columns; z <= columns; z++) world.loadColumn(x, z);
  return world;
}
/** Writes a block through the simulation, so fluids, fire and redstone notice the change. */
function put(world: WorldSession, x: number, y: number, z: number, state: number): void {
  world.simulation.setBlockState(x, y, z, state);
}
/** Ticks the world systems the given number of times. */
function run(world: WorldSession, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    world.world.tick++;
    world.simulation['tickWorldSystems']();
  }
}

describe('E09 · fluids', () => {
  it('spreads water eight blocks at seven levels and stops at the same delay each step', () => {
    const world = session();
    const surface = 9;
    for (let x = -4; x <= 10; x++) world.loadColumn(Math.floor(x / 16), 0);
    put(world, 0, surface, 0, BLOCK.WATER);
    run(world, 200);
    expect(isFluidSource(world.world.getBlock(0, surface, 0))).toBe(true);
    // The first step away from the source carries level one, the eighth carries seven.
    expect(fluidLevelOf(world.world.getBlock(1, surface, 0))).toBe(1);
    expect(fluidLevelOf(world.world.getBlock(7, surface, 0))).toBe(WATER_MAX_LEVEL);
    // Nothing moves beyond seven blocks: the flow has no level eight.
    expect(world.world.getBlock(8, surface, 0)).toBe(BLOCK.AIR);
    expect(WATER_MAX_LEVEL).toBe(7);
    expect(WATER_DELAY).toBe(5);
  });

  it('drops a waterfall straight down instead of spending its level sideways', () => {
    const world = session();
    // A source high above the ground: every block underneath has to fill with water.
    put(world, 0, 14, 0, BLOCK.WATER);
    run(world, 120);
    for (let y = 13; y >= 9; y--)
      expect(registry.get(world.world.getBlock(0, y, 0)).fluid).toBe('water');
    // The falling column does not run along the top: a free drop takes the whole flow.
    expect(world.world.getBlock(1, 14, 0)).toBe(BLOCK.AIR);
    // Where the fall lands, the water finally spreads sideways on the ground.
    expect(registry.get(world.world.getBlock(1, 9, 0)).fluid).toBe('water');
  });

  it('makes a new spring from two neighbouring sources over a solid floor', () => {
    const world = session();
    const surface = 9;
    put(world, 0, surface, 0, BLOCK.WATER);
    put(world, 2, surface, 0, BLOCK.WATER);
    run(world, 40);
    expect(world.world.getBlock(1, surface, 0)).toBe(BLOCK.WATER);
    expect(isFluidSource(world.world.getBlock(1, surface, 0))).toBe(true);
  });

  it('drains a flow whose source disappeared and keeps the budget bounded', () => {
    const world = session();
    const surface = 9;
    put(world, 0, surface, 0, BLOCK.WATER);
    run(world, 60);
    expect(registry.get(world.world.getBlock(3, surface, 0)).fluid).toBe('water');
    world.simulation.setBlockState(0, surface, 0, BLOCK.AIR);
    run(world, 60);
    expect(world.world.getBlock(1, surface, 0)).toBe(BLOCK.AIR);
    expect(world.world.getBlock(3, surface, 0)).toBe(BLOCK.AIR);
    expect(FLUID_BUDGET).toBe(4096);
    // A flood of cells never processes more than the budget in one tick.
    for (let x = 0; x < 200; x++) put(world, x, surface, 5, BLOCK.WATER);
    run(world, 1);
    expect(world.simulation.fluids.lastProcessed).toBeLessThanOrEqual(FLUID_BUDGET);
  });

  it('stops lava after three blocks, slower than water, and lets it cool into stone', () => {
    const world = session();
    const surface = 9;
    put(world, 0, surface, 0, BLOCK.LAVA);
    run(world, 300);
    expect(fluidLevelOf(world.world.getBlock(1, surface, 0))).toBe(1);
    expect(fluidLevelOf(world.world.getBlock(3, surface, 0))).toBe(LAVA_MAX_LEVEL);
    expect(world.world.getBlock(4, surface, 0)).toBe(BLOCK.AIR);
    expect(LAVA_MAX_LEVEL).toBe(3);
    expect(LAVA_DELAY).toBe(30);
    // Water touching a lava source turns that source into obsidian.
    const obsidianWorld = session('e09-obsidian');
    put(obsidianWorld, 0, 9, 0, BLOCK.LAVA);
    put(obsidianWorld, 1, 9, 0, BLOCK.WATER);
    run(obsidianWorld, 120);
    expect(obsidianWorld.world.getBlock(0, 9, 0)).toBe(BLOCK.OBSIDIAN);
    // Water meeting a flowing lava turns the flow into cobblestone instead.
    const cobbleWorld = session('e09-cobble');
    put(cobbleWorld, 0, 9, 0, BLOCK.LAVA);
    run(cobbleWorld, 120);
    expect(registry.get(cobbleWorld.world.getBlock(1, 9, 0)).fluid).toBe('lava');
    // The water is poured beside the flow; the flow cools, not the water.
    put(cobbleWorld, 1, 9, 1, BLOCK.WATER);
    run(cobbleWorld, 120);
    expect(cobbleWorld.world.getBlock(1, 9, 0)).toBe(BLOCK.COBBLE);
  });
});

describe('E09 · falling blocks', () => {
  it('drops gravel one block at a time until it lands on something solid', () => {
    const world = session();
    put(world, 2, 9, 2, BLOCK.GRAVEL);
    put(world, 2, 8, 2, BLOCK.AIR);
    put(world, 2, 7, 2, BLOCK.AIR);
    run(world, 1);
    expect(world.simulation.blockSim.fallingCount).toBe(1);
    run(world, 40);
    expect(world.world.getBlock(2, 7, 2)).toBe(BLOCK.GRAVEL);
    expect(world.world.getBlock(2, 9, 2)).toBe(BLOCK.AIR);
    expect(world.simulation.blockSim.fallingCount).toBe(0);
    expect(FALLING_START_DELAY).toBe(2);
  });

  it('keeps sand in place while it is supported and drops it once the support is gone', () => {
    const world = session();
    put(world, 3, 9, 3, BLOCK.SAND);
    run(world, 20);
    expect(world.world.getBlock(3, 9, 3)).toBe(BLOCK.SAND);
    expect(world.simulation.blockSim.fallingCount).toBe(0);
    // Digging the block underneath leaves the sand hanging in the air for two ticks.
    world.simulation.setBlockState(3, 8, 3, BLOCK.AIR);
    run(world, 1);
    expect(world.simulation.blockSim.fallingCount).toBe(1);
    run(world, 60);
    expect(world.world.getBlock(3, 9, 3)).toBe(BLOCK.AIR);
    expect(world.world.getBlock(3, 8, 3)).toBe(BLOCK.SAND);
    expect(world.simulation.blockSim.fallingCount).toBe(0);
  });
});

describe('E09 · fire and explosions', () => {
  it('lights a flammable block, spreads to its neighbours and burns out', () => {
    const world = session();
    // The gameplay RNG defaults to Math.random: an unlucky first consumption used to make
    // this assertion fail randomly even in 0.8. Keep the same spread/burnout expectations,
    // but exercise them with a fixed stream instead of relying on chance.
    const random = new JavaRandom(9009);
    world.simulation['random'] = () => random.nextDouble();
    put(world, 4, 9, 4, BLOCK.PLANKS);
    put(world, 5, 9, 4, BLOCK.PLANKS);
    expect(world.simulation.blockSim.ignite(4, 9, 4)).toBe(true);
    run(world, 40);
    expect(world.simulation.blockSim.fireCount).toBeGreaterThanOrEqual(2);
    run(world, FIRE_LIFETIME + 20);
    expect(world.simulation.blockSim.fireCount).toBe(0);
  });

  it('primes TNT, waits the reference fuse and leaves a crater with drops', () => {
    const world = session();
    // A stone floor for the blast to bite into.
    for (let x = 0; x < 9; x++)
      for (let z = 0; z < 9; z++) put(world, 2 + x, 8, 2 + z, BLOCK.STONE);
    for (let x = 0; x < 9; x++) for (let z = 0; z < 9; z++) put(world, 2 + x, 9, 2 + z, BLOCK.AIR);
    put(world, 6, 9, 6, BLOCK.TNT);
    const before = world.world.getBlock(6, 9, 6);
    expect(before).toBe(BLOCK.TNT);
    world.simulation.blockSim.prime(6, 9, 6);
    expect(world.simulation.blockSim.fuseLeft(6, 9, 6)).toBe(TNT_FUSE);
    run(world, TNT_FUSE - 1);
    expect(world.world.getBlock(6, 9, 6)).toBe(BLOCK.TNT);
    run(world, 2);
    expect(world.world.getBlock(6, 9, 6)).toBe(BLOCK.AIR);
    // The blast removed the floor under it and dropped cobblestone from the stone.
    let removed = 0;
    for (let x = 2; x < 11; x++)
      for (let z = 2; z < 11; z++) if (world.world.getBlock(x, 8, z) === BLOCK.AIR) removed++;
    expect(removed).toBeGreaterThan(8);
    expect(world.simulation.entities.list.length).toBeGreaterThan(0);
  });

  it('leaves obsidian standing where a blast would take stone apart', () => {
    const world = session();
    for (let x = 0; x < 7; x++)
      for (let z = 0; z < 7; z++) put(world, 4 + x, 8, 4 + z, BLOCK.OBSIDIAN);
    const result = world.simulation.blockSim.explode(7, 9, 7, 4);
    expect(result.removed.filter((entry) => entry.state === BLOCK.OBSIDIAN).length).toBe(0);
    expect(world.world.getBlock(7, 8, 7)).toBe(BLOCK.OBSIDIAN);
    expect(registry.get(BLOCK.OBSIDIAN).hardness).toBeGreaterThan(8);
  });

  it('damages the player inside the blast radius and pushes them away', () => {
    const world = session();
    const sim = world.simulation;
    sim.player.position.x = 8.5;
    sim.player.position.y = 9;
    sim.player.position.z = 8.5;
    const blast = { x: 9.5, y: 9.5, z: 8.5 };
    const result = sim['blockSim'].explode(blast.x, blast.y, blast.z, 4);
    sim['applyExplosion'](blast, 4, result.pushed);
    expect(sim.survival.health).toBeLessThan(20);
    expect(sim.player.velocity.x).toBeLessThan(0);
  });
});
