import { describe, it, expect } from 'vitest';
import { BLOCK } from '../../packages/content/src/blocks';
import { VoxelWorld, ChunkColumn } from '../../packages/core/src/world';
import { createPlayer, tickPlayer } from '../../packages/core/src/player';

/** A pool whose surface sits `rise` blocks below the top of the shore to the east. */
function pool(rise: number): VoxelWorld {
  const w = new VoxelWorld('water-exit');
  for (let x = -1; x <= 1; x++)
    for (let z = -1; z <= 1; z++) {
      const c = new ChunkColumn(x, z);
      c.status = 'ready';
      w.addColumn(c);
    }
  for (let x = -8; x < 16; x++)
    for (let z = -8; z < 16; z++) {
      w.setBlock(x, 0, z, BLOCK.STONE);
      if (x < 4) for (let y = 1; y <= 3; y++) w.setBlock(x, y, z, BLOCK.WATER);
      else for (let y = 1; y <= 3 + rise; y++) w.setBlock(x, y, z, BLOCK.STONE);
    }
  return w;
}
function swimEast(w: VoxelWorld, jump: boolean, ticks = 80) {
  const player = createPlayer({ x: 1.5, y: 3.2, z: 4.5 });
  for (let i = 0; i < ticks; i++)
    tickPlayer(w, player, {
      forward: 1,
      strafe: 0,
      yaw: -Math.PI / 2,
      pitch: 0,
      jump,
      crouch: false,
      sprint: false,
    });
  return player;
}

describe('climbing out of water', () => {
  it('reaches a shore one block above the surface while swimming up', () => {
    const p = swimEast(pool(1), true);
    expect(p.position.x).toBeGreaterThan(4.3);
    expect(p.position.y).toBeGreaterThanOrEqual(5 - 1e-6);
  });
  it('reaches a shore level with the surface', () => {
    const p = swimEast(pool(0), true);
    expect(p.position.y).toBeGreaterThanOrEqual(4 - 1e-6);
    expect(p.position.x).toBeGreaterThan(4.3);
  });
  it('does not climb a full block from shallow water without a jump', () => {
    const w = pool(0);
    for (let x = -8; x < 4; x++)
      for (let z = -8; z < 16; z++)
        for (let y = 1; y <= 3; y++) w.setBlock(x, y, z, y === 3 ? 10 : 3);
    const p = createPlayer({ x: 1.5, y: 3, z: 4.5 });
    for (let i = 0; i < 40; i++)
      tickPlayer(w, p, {
        forward: 1,
        strafe: 0,
        yaw: -Math.PI / 2,
        pitch: 0,
        jump: false,
        crouch: false,
        sprint: false,
      });
    expect(p.position.x).toBeLessThan(4);
  });
  it('still cannot climb a two-block wall out of the water', () => {
    const p = swimEast(pool(2), true);
    expect(p.position.x).toBeLessThan(4);
  });
});
