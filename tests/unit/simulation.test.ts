import expectedFixture from '../../fixtures/foundation-v1.json';
import { describe, it, expect } from 'vitest';
import { VoxelWorld, ChunkColumn } from '../../packages/core/src/world';
import { generateColumn, spawnPoint } from '../../packages/core/src/terrain';
import { Simulation } from '../../packages/core/src/simulation';
import { EMPTY_INPUT, sanitizeInput, playerOverlapsBlock } from '../../packages/core/src/player';
import { raycast } from '../../packages/core/src/raycast';
import { BLOCK } from '../../packages/content/src/blocks';
import { runCoreFixture } from '../../packages/core/src/fixture';
function setup() {
  const world = new VoxelWorld('test');
  for (let x = -2; x <= 2; x++)
    for (let z = -2; z <= 2; z++) world.addColumn(generateColumn(x, z, 'test', 'flat'));
  const sim = new Simulation(world, spawnPoint('test', 'flat'));
  for (let i = 0; i < 5; i++) sim.step();
  return sim;
}
describe('player controller and authoritative interactions', () => {
  it('lands and stands on a solid surface without sinking', () => {
    const s = setup();
    for (let i = 0; i < 100; i++) s.step();
    expect(s.player.position.y).toBeCloseTo(9);
    expect(s.player.onGround).toBe(true);
  });
  it('jumps and returns to the same floor', () => {
    const s = setup();
    s.setInput({ ...EMPTY_INPUT, jump: true });
    s.step();
    s.setInput(EMPTY_INPUT);
    for (let i = 0; i < 3; i++) s.step();
    expect(s.player.position.y).toBeGreaterThan(9.5);
    for (let i = 0; i < 60; i++) s.step();
    expect(s.player.position.y).toBeCloseTo(9);
  });
  it('moves with input and stops against a full-height wall', () => {
    const s = setup();
    for (let x = 0; x < 16; x++)
      for (let y = 9; y < 13; y++) s.world.setBlock(x, y, 5, BLOCK.STONE);
    s.setInput({ ...EMPTY_INPUT, forward: 1 });
    for (let i = 0; i < 80; i++) s.step();
    expect(s.player.position.z).toBeCloseTo(6.3);
    expect(s.player.position.y).toBeCloseTo(9);
  });
  it('cannot enter ungenerated space', () => {
    const s = setup();
    s.setInput({ ...EMPTY_INPUT, forward: 1, sprint: true });
    for (let i = 0; i < 500; i++) s.step();
    expect(s.player.position.z).toBeGreaterThanOrEqual(-31.700001);
  });
  it('sanitizes malformed input', () => {
    expect(
      sanitizeInput({ ...EMPTY_INPUT, forward: 12, strafe: -8, yaw: Infinity, pitch: NaN }),
    ).toMatchObject({ forward: 1, strafe: -1, yaw: 0, pitch: 0 });
  });
  it('rejects palette selections that have no item', () => {
    const s = setup();
    expect(s.creativeSelect(BLOCK.AIR)).toBe(false);
    expect(s.creativeSelect(BLOCK.WATER)).toBe(false);
    expect(s.creativeSelect(BLOCK.GLASS)).toBe(true);
    expect(s.heldItem?.item).toBe('lab:glass');
  });
  it('places and removes a reachable block through the item model', () => {
    const s = setup();
    s.setInput({ ...EMPTY_INPUT, pitch: -1.1 });
    s.creativeSelect(BLOCK.GLASS);
    const placed = s.use();
    expect(placed.ok).toBe(true);
    expect(placed.edit?.state).toBe(BLOCK.GLASS);
    expect(s.heldItem?.count).toBe(63);
    const at = placed.edit!;
    const removed = s.hitBlock();
    expect(removed.ok).toBe(true);
    expect(s.mining?.ticks).toBeGreaterThan(1);
    s.setMining(true);
    for (let i = 0; i < 30 && s.world.getBlock(at.x, at.y, at.z) !== BLOCK.AIR; i++) s.step();
    s.setMining(false);
    expect(s.world.getBlock(at.x, at.y, at.z)).toBe(BLOCK.AIR);
    expect(s.entities.list.some((entity) => entity.item === 'lab:glass')).toBe(true);
    expect(s.heldItem?.count).toBe(63);
  });
  it('shift-clicks a crafting ingredient back into the inventory', () => {
    const s = setup();
    s.grant('lab:oak_log', 4);
    s.openCrafting();
    s.slotClick(null, 0, 0); // Take the stack onto the cursor.
    s.slotClick('grid', 0, 2); // Right click leaves one log in the grid.
    s.slotClick(null, 1, 0); // The rest goes back to the hotbar.
    expect(s.containerFor('grid')!.get(0)?.count).toBe(1);
    expect(s.amountOf('lab:oak_log')).toBe(3);
    expect(s.slotClick('grid', 0, 0, { shift: true }).ok).toBe(true);
    expect(s.containerFor('grid')!.get(0)).toBeNull();
    expect(s.amountOf('lab:oak_log')).toBe(4);
    expect(s.cursor).toBeNull();
    // An empty grid cell keeps the shift-click a no-op.
    expect(s.slotClick('grid', 1, 0, { shift: true }).ok).toBe(true);
    expect(s.amountOf('lab:oak_log')).toBe(4);
  });
  it('rejects placing a block inside the player', () => {
    const s = setup();
    s.setInput({ ...EMPTY_INPUT, pitch: -1.54 });
    s.creativeSelect(BLOCK.GLASS);
    expect(s.use()).toMatchObject({
      ok: false,
      reason: 'Нельзя поставить блок внутри игрока',
    });
  });
  it('protects the bottom foundation', () => {
    const w = new VoxelWorld('base');
    const c = new ChunkColumn(0, 0);
    c.status = 'ready';
    w.addColumn(c);
    w.setBlock(0, 0, 0, BLOCK.BEDROCK);
    const s = new Simulation(w, { x: 0.5, y: 2, z: 0.5 });
    s.setInput({ ...EMPTY_INPUT, pitch: -1.54 });
    expect(s.breakBlock(0, 0, 0)).toBe(false);
    expect(w.getBlock(0, 0, 0)).toBe(BLOCK.BEDROCK);
  });
  it('respawns without keeping falling velocity', () => {
    const s = setup();
    s.player.position.y = -100;
    s.player.velocity.y = -30;
    s.respawn();
    expect(s.player.position).toEqual(s.spawn);
    expect(s.player.velocity).toEqual({ x: 0, y: 0, z: 0 });
  });
  it('has correct strict overlap at a touching boundary', () => {
    const s = setup();
    s.player.position = { x: 0.7, y: 9, z: 0.5 };
    expect(playerOverlapsBlock(s.player, 1, 9, 0)).toBe(false);
    s.player.position.x = 0.71;
    expect(playerOverlapsBlock(s.player, 1, 9, 0)).toBe(true);
  });
});
describe('voxel DDA picking', () => {
  it('crosses zero into a negative-coordinate target with the correct face', () => {
    const s = setup();
    s.world.setBlock(-1, 10, 0, BLOCK.STONE);
    const hit = raycast(s.world, { x: 0.5, y: 10.5, z: 0.5 }, { x: -1, y: 0, z: 0 });
    expect(hit).toMatchObject({ x: -1, y: 10, z: 0, distance: 0.5, normal: { x: 1, y: 0, z: 0 } });
  });
  it('respects maximum reach', () => {
    const s = setup();
    s.world.setBlock(0, 10, -10, BLOCK.STONE);
    expect(raycast(s.world, { x: 0.5, y: 10.5, z: 0.5 }, { x: 0, y: 0, z: -1 }, 6)).toBe(null);
  });
  it('handles zero and invalid directions without looping', () => {
    const s = setup();
    expect(raycast(s.world, { x: 0, y: 10, z: 0 }, { x: 0, y: 0, z: 0 })).toBe(null);
    expect(raycast(s.world, { x: 0, y: 10, z: 0 }, { x: NaN, y: 0, z: 0 })).toBe(null);
  });
});
describe('headless replay', () => {
  it('reproduces a fixed input trace deterministically', () => {
    expect(runCoreFixture()).toEqual(runCoreFixture());
    expect(runCoreFixture()).toEqual(expectedFixture);
    expect(runCoreFixture().tick).toBe(120);
  });
});
