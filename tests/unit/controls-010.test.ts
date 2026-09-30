import { describe, it, expect } from 'vitest';
import { VoxelWorld } from '../../packages/core/src/world';
import { generateColumn, spawnPoint } from '../../packages/core/src/terrain';
import { Simulation } from '../../packages/core/src/simulation';
import { EMPTY_INPUT } from '../../packages/core/src/player';
import { BLOCK } from '../../packages/content/src/blocks';
import { ControlScheme } from '../../packages/ui/src/controls';

function setup() {
  const world = new VoxelWorld('test');
  for (let x = -3; x <= 3; x++)
    for (let z = -3; z <= 3; z++) world.addColumn(generateColumn(x, z, 'test', 'flat'));
  const sim = new Simulation(world, spawnPoint('test', 'flat'));
  sim.gameMode = 'creative';
  for (let i = 0; i < 10; i++) sim.step();
  return sim;
}
const speed = (sim: Simulation) => Math.hypot(sim.player.velocity.x, sim.player.velocity.z);

describe('controls 0.10 · the reference sprint', () => {
  it('latches: a tap of the sprint key keeps the run going while moving forward', () => {
    const sim = setup();
    sim.setInput({ ...EMPTY_INPUT, forward: 1, sprint: true });
    sim.step();
    sim.setInput({ ...EMPTY_INPUT, forward: 1 });
    for (let i = 0; i < 10; i++) sim.step();
    expect(sim.sprinting).toBe(true);
    expect(speed(sim)).toBeGreaterThan(5.4);
    expect(sim.snapshot().motion.sprinting).toBe(true);
    sim.setInput({ ...EMPTY_INPUT });
    sim.step();
    expect(sim.sprinting).toBe(false);
  });
  it('never sprints backwards or sideways, and sneaking or hunger ends it', () => {
    const sim = setup();
    sim.setInput({ ...EMPTY_INPUT, forward: -1, sprint: true });
    for (let i = 0; i < 10; i++) sim.step();
    expect(sim.sprinting).toBe(false);
    expect(speed(sim)).toBeLessThan(4.4);
    sim.setInput({ ...EMPTY_INPUT, forward: 1, sprint: true });
    sim.step();
    expect(sim.sprinting).toBe(true);
    sim.setInput({ ...EMPTY_INPUT, forward: 1, crouch: true });
    sim.step();
    expect(sim.sprinting).toBe(false);
    sim.gameMode = 'survival';
    sim.survival.food = 6;
    sim.setInput({ ...EMPTY_INPUT, forward: 1, sprint: true });
    sim.step();
    expect(sim.sprinting).toBe(false);
  });
  it('a wall ends the run', () => {
    const sim = setup();
    const p = sim.player.position;
    for (let x = -4; x <= 4; x++)
      for (let y = 9; y < 12; y++)
        sim.world.setBlock(Math.floor(p.x) + x, y, Math.floor(p.z) - 3, BLOCK.STONE);
    sim.setInput({ ...EMPTY_INPUT, forward: 1, sprint: true });
    sim.step();
    sim.setInput({ ...EMPTY_INPUT, forward: 1 });
    for (let i = 0; i < 30; i++) sim.step();
    expect(sim.sprinting).toBe(false);
  });
  it('a sprint jump carries further than a sprint on foot', () => {
    const run = (jump: boolean) => {
      const sim = setup();
      const z0 = sim.player.position.z;
      sim.setInput({ ...EMPTY_INPUT, forward: 1, sprint: true });
      for (let i = 0; i < 5; i++) sim.step();
      sim.setInput({ ...EMPTY_INPUT, forward: 1, sprint: true, jump });
      for (let i = 0; i < 40; i++) sim.step();
      return z0 - sim.player.position.z;
    };
    const walk = run(false),
      hop = run(true);
    expect(hop).toBeGreaterThan(walk * 1.12);
    expect(hop).toBeLessThan(walk * 1.5);
  });
});

describe('controls 0.10 · double tap forward', () => {
  it('sprints after two quick presses and stops when forward is released', () => {
    const c = new ControlScheme();
    const keys = new Set(['KeyW']);
    c.keyDown('KeyW', false, 1000);
    expect(c.read(keys).sprint).toBe(false);
    c.keyDown('KeyW', false, 1200);
    expect(c.read(keys).sprint).toBe(true);
    expect(c.read(new Set()).sprint).toBe(false);
    expect(c.read(keys).sprint).toBe(false);
    c.keyDown('KeyW', false, 2000);
    expect(c.read(keys).sprint).toBe(false);
  });
});
