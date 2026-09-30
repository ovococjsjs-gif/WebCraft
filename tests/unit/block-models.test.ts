import { describe, it, expect } from 'vitest';
import {
  BLOCK,
  BLOCK_X,
  BLOCKS,
  blockBoxes,
  doorState,
  isSoil,
  registry,
  slabState,
  stairsState,
  toggledDoor,
} from '../../packages/content/src/blocks';
import { itemRegistry } from '../../packages/content/src/items';
import { EXTRA_TILE_BASE, EXTRA_TILE_NAMES } from '../../packages/content/src/tiles';
import { facingOfYaw } from '../../packages/content/src/shapes';
import { extraTilePixels } from '../../packages/renderer/src/block-art';
import { ATLAS_COLS, ATLAS_ROWS, meshSection } from '../../packages/renderer/src/mesher';
import { VoxelWorld, ChunkColumn } from '../../packages/core/src/world';
import { WorldSession } from '../../packages/core/src/session';
import { raycast } from '../../packages/core/src/raycast';
import { boxHitsWorld, bodyBox, sweepAxis } from '../../packages/core/src/collision';
import { tickPlayer } from '../../packages/core/src/player';

/**
 * 0.10 block models: every oriented state is its own id, the model boxes drive drawing,
 * collision and picking, and placement picks the state from the aimed face and the view.
 */
function emptyWorld(): VoxelWorld {
  const w = new VoxelWorld('models');
  for (let x = -1; x <= 1; x++)
    for (let z = -1; z <= 1; z++) {
      const c = new ChunkColumn(x, z);
      c.status = 'ready';
      w.addColumn(c);
    }
  return w;
}
function floor(w: VoxelWorld, y = 0): void {
  for (let x = -8; x < 24; x++) for (let z = -8; z < 24; z++) w.setBlock(x, y, z, BLOCK.STONE);
}

describe('0.10 block registry', () => {
  it('appends new blocks after the 0.9 ids and keeps keys unique', () => {
    const keys = new Set(BLOCKS.map((def) => def.key));
    expect(keys.size).toBe(BLOCKS.length);
    expect(registry.get(128).key).toBe(BLOCKS.find((def) => def.id === 128)!.key);
    expect(BLOCK_X.SNOW_LAYER).toBe(129);
    expect(new Set(BLOCKS.map((def) => def.id)).size).toBe(BLOCKS.length);
    const added = BLOCKS.filter((def) => def.id > 128).map((def) => def.id);
    added.forEach((id, index) => expect(id).toBe(129 + index));
  });
  it('gives every placeable block an item and resolves oriented states to it', () => {
    for (const def of BLOCKS) {
      if (def.id <= 128 || def.placeable === false) continue;
      expect(itemRegistry.find(def.key)?.block, def.key).toBe(def.id);
    }
    const top = stairsState(BLOCK_X.OAK_STAIRS, 'west', 'top');
    expect(itemRegistry.ofBlock(top)?.key).toBe('lab:oak_stairs');
    expect(itemRegistry.ofBlock(doorState(BLOCK_X.OAK_DOOR, 'south', true, true))?.key).toBe(
      'lab:oak_door',
    );
  });
  it('paints every new tile inside the atlas without transparent solid blocks', () => {
    // Extra block tiles stop where the second item sprite run begins (tile 768).
    expect(EXTRA_TILE_BASE + EXTRA_TILE_NAMES.length).toBeLessThanOrEqual(768);
    expect(ATLAS_COLS * ATLAS_ROWS).toBe(1024);
    for (const def of BLOCKS)
      for (const tile of def.textures)
        if (tile >= EXTRA_TILE_BASE) {
          const pixels = extraTilePixels(tile);
          expect(pixels, def.key).not.toBeNull();
          if (def.layer === 'opaque' && !def.model)
            for (let i = 3; i < pixels!.length; i += 4) expect(pixels![i], def.key).toBe(255);
        }
  });
  it('treats grass-like ground as soil', () => {
    for (const state of [BLOCK.GRASS, BLOCK.DIRT, BLOCK_X.PODZOL, BLOCK_X.GRASS_SNOWY])
      expect(isSoil(state)).toBe(true);
    expect(isSoil(BLOCK.STONE)).toBe(false);
  });
});

describe('model geometry', () => {
  it('joins fences to fences and full blocks, not to air', () => {
    const w = emptyWorld();
    w.setBlock(4, 1, 4, BLOCK_X.OAK_FENCE);
    expect(blockBoxes(BLOCK_X.OAK_FENCE, w.getBlock.bind(w), 4, 1, 4, 'collision')).toHaveLength(1);
    w.setBlock(5, 1, 4, BLOCK_X.OAK_FENCE);
    w.setBlock(4, 1, 3, BLOCK.STONE);
    const boxes = blockBoxes(BLOCK_X.OAK_FENCE, w.getBlock.bind(w), 4, 1, 4, 'collision');
    expect(boxes).toHaveLength(3);
    expect(Math.max(...boxes.map((b) => b[4]))).toBe(1.5);
  });
  it('meshes a slab as half a cube and hides faces against opaque neighbours', () => {
    const w = emptyWorld();
    w.setBlock(4, 4, 4, BLOCK_X.STONE_SLAB);
    const alone = meshSection(w, 0, 0, 0);
    expect(alone.faces).toBe(6);
    const ys = alone.layers.opaque!.positions.filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(4.5);
    w.setBlock(4, 3, 4, BLOCK.STONE);
    // The slab's bottom is hidden by the stone; the stone's top still shows beside the slab.
    expect(meshSection(w, 0, 0, 0).faces).toBe(5 + 5 + 1);
  });
  it('picks the orientation from the view direction', () => {
    expect(facingOfYaw(0)).toBe('north');
    expect(facingOfYaw(Math.PI / 2)).toBe('west');
    expect(facingOfYaw(Math.PI)).toBe('south');
    expect(facingOfYaw(-Math.PI / 2)).toBe('east');
  });
});

describe('collision and picking', () => {
  it('lets a ray pass over a bottom slab and stops on its top', () => {
    const w = emptyWorld();
    w.setBlock(4, 1, 4, BLOCK_X.STONE_SLAB);
    const over = raycast(w, { x: 2.5, y: 1.75, z: 4.5 }, { x: 1, y: 0, z: 0 }, 5);
    expect(over).toBeNull();
    const down = raycast(w, { x: 4.5, y: 3, z: 4.5 }, { x: 0, y: -1, z: 0 }, 5)!;
    expect(down.state).toBe(BLOCK_X.STONE_SLAB);
    expect(down.distance).toBeCloseTo(1.5);
    expect(down.normal).toEqual({ x: 0, y: 1, z: 0 });
  });
  it('stops bodies at fence height and walks the player up a slab', () => {
    const w = emptyWorld();
    floor(w);
    w.setBlock(6, 1, 4, BLOCK_X.OAK_FENCE);
    expect(boxHitsWorld(w, bodyBox({ x: 6.5, y: 2.2, z: 4.5 }, 0.6, 1.8))).toBe(true);
    expect(boxHitsWorld(w, bodyBox({ x: 6.5, y: 2.5, z: 4.5 }, 0.6, 1.8))).toBe(false);
    expect(sweepAxis(w, bodyBox({ x: 6.5, y: 3, z: 4.5 }, 0.6, 1.8), 'y', -2)).toBeCloseTo(-0.5);

    for (let z = 0; z < 10; z++) w.setBlock(3, 1, z, BLOCK_X.STONE_SLAB);
    const player = {
      position: { x: 1.5, y: 1, z: 4.5 },
      velocity: { x: 0, y: 0, z: 0 },
      onGround: true,
      flying: false,
      inWater: false,
    };
    // Yaw -π/2 walks towards +x (east).
    for (let i = 0; i < 20; i++)
      tickPlayer(w, player as never, {
        forward: 1,
        strafe: 0,
        yaw: -Math.PI / 2,
        pitch: 0,
        jump: false,
        crouch: false,
        sprint: false,
      });
    expect(player.position.x).toBeGreaterThan(3.5);
    expect(player.position.y).toBeGreaterThanOrEqual(1);
  });
  it('still needs a jump for a full block', () => {
    const w = emptyWorld();
    floor(w);
    for (let z = 0; z < 10; z++) w.setBlock(3, 1, z, BLOCK.STONE);
    const player = {
      position: { x: 1.5, y: 1, z: 4.5 },
      velocity: { x: 0, y: 0, z: 0 },
      onGround: true,
      flying: false,
      inWater: false,
    };
    for (let i = 0; i < 20; i++)
      tickPlayer(w, player as never, {
        forward: 1,
        strafe: 0,
        yaw: -Math.PI / 2,
        pitch: 0,
        jump: false,
        crouch: false,
        sprint: false,
      });
    expect(player.position.x).toBeLessThanOrEqual(2.7 + 1e-6);
  });
});

describe('placing oriented blocks', () => {
  function setup() {
    const session = new WorldSession('models', 'flat');
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) session.loadColumn(x, z);
    const sim = session.simulation;
    const w = session.world;
    // A clean stone floor at y = 10 with air above, whatever the flat preset holds.
    for (let x = -4; x < 12; x++)
      for (let z = -4; z < 12; z++) {
        w.setBlock(x, 10, z, BLOCK.STONE);
        for (let y = 11; y < 16; y++) w.setBlock(x, y, z, BLOCK.AIR);
      }
    sim.player.position = { x: 0.5, y: 11, z: 6.5 };
    sim.input.yaw = 0;
    return { sim, w };
  }
  const hitTop = (x: number, y: number, z: number, state: number) => ({
    x,
    y,
    z,
    state,
    normal: { x: 0, y: 1, z: 0 },
    distance: 2,
  });
  it('turns stairs to the view and completes a slab placed on a slab', () => {
    const { sim, w } = setup();
    sim.inventory.set(sim.inventory.selected, { item: 'lab:oak_stairs', count: 4 });
    sim.input.yaw = Math.PI; // looking south
    expect(sim.placeBlock(hitTop(4, 10, 2, BLOCK.STONE)).ok).toBe(true);
    expect(w.getBlock(4, 11, 2)).toBe(stairsState(BLOCK_X.OAK_STAIRS, 'south', 'bottom'));

    sim.inventory.set(sim.inventory.selected, { item: 'lab:stone_slab', count: 4 });
    expect(sim.placeBlock(hitTop(5, 10, 2, BLOCK.STONE)).ok).toBe(true);
    expect(w.getBlock(5, 11, 2)).toBe(slabState(BLOCK_X.STONE_SLAB, 'bottom'));
    expect(sim.placeBlock(hitTop(5, 11, 2, BLOCK_X.STONE_SLAB)).ok).toBe(true);
    expect(w.getBlock(5, 11, 2)).toBe(BLOCK.SMOOTH_STONE);
    // Under a ceiling the slab goes upside down.
    expect(
      sim.placeBlock({ ...hitTop(6, 13, 2, BLOCK.STONE), normal: { x: 0, y: -1, z: 0 } }).ok,
    ).toBe(true);
    expect(w.getBlock(6, 12, 2)).toBe(slabState(BLOCK_X.STONE_SLAB, 'top'));
  });
  it('places a two-block door, opens both halves and removes both when broken', () => {
    const { sim, w } = setup();
    sim.inventory.set(sim.inventory.selected, { item: 'lab:oak_door', count: 1 });
    expect(sim.placeBlock(hitTop(4, 10, 4, BLOCK.STONE)).ok).toBe(true);
    const lower = doorState(BLOCK_X.OAK_DOOR, 'north', false, false);
    expect(w.getBlock(4, 11, 4)).toBe(lower);
    expect(w.getBlock(4, 12, 4)).toBe(doorState(BLOCK_X.OAK_DOOR, 'north', false, true));
    expect(toggledDoor(toggledDoor(lower))).toBe(lower);
    sim['toggleDoor'](4, 12, 4, w.getBlock(4, 12, 4));
    expect(w.getBlock(4, 11, 4)).toBe(doorState(BLOCK_X.OAK_DOOR, 'north', true, false));
    expect(sim.breakBlock(4, 12, 4)).toBe(true);
    expect(w.getBlock(4, 11, 4)).toBe(BLOCK.AIR);
  });
  it('replaces snow cover and turns snowy grass back when the cover is dug', () => {
    const { sim, w } = setup();
    w.setBlock(2, 10, 2, BLOCK_X.GRASS_SNOWY);
    w.setBlock(2, 11, 2, BLOCK_X.SNOW_LAYER);
    sim.inventory.set(sim.inventory.selected, { item: 'lab:cobblestone', count: 1 });
    expect(sim.placeBlock(hitTop(2, 11, 2, BLOCK_X.SNOW_LAYER)).ok).toBe(true);
    expect(w.getBlock(2, 11, 2)).toBe(BLOCK.COBBLE);
    w.setBlock(3, 10, 2, BLOCK_X.GRASS_SNOWY);
    w.setBlock(3, 11, 2, BLOCK_X.SNOW_LAYER);
    expect(sim.breakBlock(3, 11, 2)).toBe(true);
    expect(w.getBlock(3, 10, 2)).toBe(BLOCK.GRASS);
  });
});
