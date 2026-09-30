import { describe, it, expect } from 'vitest';
import { WorldSession } from '../../packages/core/src/session';
import { BLOCK } from '../../packages/content/src/blocks';
import { EMPTY_INPUT } from '../../packages/core/src/player';
import { sealWorld, defaultClient } from '../../packages/storage/src/format';

describe('consistent checkpoints and unloaded chunks', () => {
  it('persists mutations made through the world API, not only mouse actions', () => {
    const s = new WorldSession('s', 'flat');
    s.loadColumn(0, 0);
    s.world.setBlock(3, 10, 4, BLOCK.LOG);
    expect(s.checkpoint().overrides).toEqual([[3, 10, 4, 'lab:oak_log']]);
  });
  it('retains changes after eviction and reload at negative chunk boundaries', () => {
    const s = new WorldSession('s', 'flat');
    s.loadColumn(-1, -1);
    s.world.setBlock(-1, 9, -16, BLOCK.GLASS);
    s.world.setBlock(-16, 8, -1, BLOCK.AIR);
    s.world.removeColumn(-1, -1);
    const checkpoint = s.checkpoint();
    expect(s.world.columns.size).toBe(0);
    const r = new WorldSession('s', 'flat', checkpoint);
    r.loadColumn(-1, -1);
    expect(r.world.getBlock(-1, 9, -16)).toBe(BLOCK.GLASS);
    expect(r.world.getBlock(-16, 8, -1)).toBe(BLOCK.AIR);
    expect(r.overrides.size).toBe(2);
  });
  it('replays saved overrides without adding duplicate mutations', () => {
    const s = new WorldSession('s', 'flat');
    s.loadColumn(0, 0);
    s.world.setBlock(1, 9, 1, BLOCK.PLANKS);
    s.world.removeColumn(0, 0);
    s.loadColumn(0, 0);
    expect(s.overrides.size).toBe(1);
  });
  it('only keeps the final value at a coordinate, including AIR', () => {
    const s = new WorldSession('s', 'flat');
    s.loadColumn(0, 0);
    s.world.setBlock(1, 9, 1, BLOCK.PLANKS);
    s.world.setBlock(1, 9, 1, BLOCK.AIR);
    expect(s.checkpoint().overrides).toEqual([[1, 9, 1, 'lab:air']]);
  });
  it('restores velocity, flight, look, spawn, tick, selected block and event queue', () => {
    const s = new WorldSession('s', 'flat');
    s.loadColumn(0, 0);
    s.simulation.player.flying = true;
    s.simulation.player.velocity = { x: 2, y: 3, z: 4 };
    s.simulation.player.position = { x: 2, y: 25, z: 4 };
    s.simulation.setInput({ ...EMPTY_INPUT, yaw: 2, pitch: 0.4 });
    s.simulation.select(BLOCK.GLASS);
    s.world.tick = 71;
    s.world.scheduler.schedule(80, 'pending', { x: 1 });
    const file = s.checkpoint();
    const r = new WorldSession('s', 'flat', file);
    expect(r.checkpoint()).toEqual(file);
    expect(r.simulation.input.forward).toBe(0);
  });
  it('continues a paused mid-air simulation with the same result', () => {
    const s = new WorldSession('s', 'flat');
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) s.loadColumn(x, z);
    for (let i = 0; i < 5; i++) s.simulation.step();
    s.simulation.setInput({ ...EMPTY_INPUT, jump: true });
    s.simulation.step();
    s.simulation.setInput(EMPTY_INPUT);
    const saved = s.checkpoint(),
      r = new WorldSession('s', 'flat', saved);
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) r.loadColumn(x, z);
    for (let i = 0; i < 40; i++) {
      s.simulation.step();
      r.simulation.step();
    }
    expect(r.simulation.player).toEqual(s.simulation.player);
    expect(r.world.tick).toBe(s.world.tick);
  });
  it('does not retain mutable references to live state', () => {
    const s = new WorldSession('s', 'flat');
    const snapshot = s.checkpoint();
    s.simulation.player.position.x += 10;
    expect(snapshot.player.position.x).not.toBe(s.simulation.player.position.x);
  });
  it('serializes only persistent data, not meshes, loaded cache or controls', () => {
    const s = new WorldSession('s', 'flat');
    s.loadColumn(0, 0);
    const file = sealWorld({
      name: 'World',
      createdAt: 1,
      savedAt: 2,
      core: s.checkpoint(),
      client: defaultClient(),
    });
    const text = JSON.stringify(file);
    expect(text).not.toContain('indices');
    expect(text).not.toContain('mesh');
    expect(text).not.toContain('forward');
    expect(text.length).toBeLessThan(2000);
  });
});
