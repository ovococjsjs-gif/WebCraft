import { describe, it, expect } from 'vitest';
import { BLOCK } from '../../packages/content/src/blocks';
import { WorldSession } from '../../packages/core/src/session';
import { SAVED_FLUID_LIMIT } from '../../packages/core/src/fluids';

/**
 * Settled water must fall asleep. Touching one block of a lake used to wake the whole connected
 * body for good: every evaluated cell re-marked itself and its neighbours, so the active set grew
 * with every loaded ocean chunk, the world slowed down over minutes and saves failed validation.
 */
function lake(size: number): WorldSession {
  const s = new WorldSession('fluid-settle', 'flat');
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) s.loadColumn(x, z);
  const sim = s.simulation;
  const y = 10;
  for (let x = 0; x < size; x++)
    for (let z = 0; z < size; z++) {
      sim.world.setBlock(x, y - 1, z, BLOCK.STONE);
      sim.world.setBlock(x, y, z, BLOCK.WATER);
    }
  for (let i = -1; i <= size; i++)
    for (const [x, z] of [
      [i, -1],
      [i, size],
      [-1, i],
      [size, i],
    ])
      sim.world.setBlock(x, y, z, BLOCK.STONE);
  sim.fluids.clear();
  return s;
}
function run(s: WorldSession, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    s.world.tick++;
    s.simulation['tickWorldSystems']();
  }
}

describe('fluids settle', () => {
  it('a still lake goes back to sleep after a block next to it changes', () => {
    const s = lake(40);
    s.simulation.setBlockState(-1, 10, 5, BLOCK.DIRT);
    run(s, 200);
    expect(s.simulation.fluids.size).toBe(0);
  });
  it('opening the lake lets water out and the flow still settles', () => {
    const s = lake(12);
    s.simulation.setBlockState(-1, 10, 5, BLOCK.AIR);
    run(s, 600);
    expect(s.world.getBlock(-1, 10, 5)).not.toBe(BLOCK.AIR);
    // It pours down the hole and spreads over the grass below.
    expect(s.world.getBlock(-3, 9, 5)).not.toBe(BLOCK.AIR);
    expect(s.simulation.fluids.size).toBe(0);
  });
  it('never writes more pending cells into a save than the format accepts', () => {
    const s = lake(4);
    for (let i = 0; i < SAVED_FLUID_LIMIT + 500; i++)
      s.simulation.fluids.active.add(`${i % 64},20,${Math.floor(i / 64)}`);
    expect(s.simulation.fluids.snapshot().length).toBeLessThanOrEqual(SAVED_FLUID_LIMIT);
  });
});
