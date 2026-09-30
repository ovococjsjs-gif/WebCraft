import { describe, expect, it } from 'vitest';
import { BLOCK, BLOCK_X } from '../../packages/content/src/blocks';
import { WorldSession } from '../../packages/core/src/session';
import { isSupported, supportRule } from '../../packages/core/src/support';

/** Round H: plants, torches and rails pop off when what holds them goes, as in 1.12. */
function setup() {
  const session = new WorldSession('support', 'flat');
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) session.loadColumn(x, z);
  const sim = session.simulation;
  const w = session.world;
  for (let x = -4; x < 12; x++)
    for (let z = -4; z < 12; z++) {
      w.setBlock(x, 10, z, BLOCK.STONE);
      for (let y = 11; y < 20; y++) w.setBlock(x, y, z, BLOCK.AIR);
    }
  sim.player.position = { x: 0.5, y: 11, z: 9.5 };
  sim.gameMode = 'survival';
  return { sim, w };
}
const dropped = (sim: ReturnType<typeof setup>['sim'], item: string) =>
  sim.entities.list.filter((e) => e.item === item).reduce((n, e) => n + e.count, 0);
const hitTop = (x: number, y: number, z: number, state: number) => ({
  x,
  y,
  z,
  state,
  normal: { x: 0, y: 1, z: 0 },
  distance: 2,
});

describe('round H · support', () => {
  it('brings a whole stalk of sugar cane down when its lowest block breaks', () => {
    const { sim, w } = setup();
    w.setBlock(4, 11, 4, BLOCK.SAND);
    w.setBlock(5, 11, 4, BLOCK.WATER);
    for (let y = 12; y <= 14; y++) w.setBlock(4, y, 4, BLOCK.SUGAR_CANE);
    expect(sim.breakBlock(4, 12, 4)).toBe(true);
    for (let y = 12; y <= 14; y++) expect(w.getBlock(4, y, 4)).toBe(BLOCK.AIR);
    expect(dropped(sim, 'lab:sugar_cane')).toBe(3);
  });
  it('drops the cane when the sand under it goes, and a flower when its grass goes', () => {
    const { sim, w } = setup();
    w.setBlock(4, 11, 4, BLOCK.SAND);
    w.setBlock(5, 11, 4, BLOCK.WATER);
    w.setBlock(4, 12, 4, BLOCK.SUGAR_CANE);
    w.setBlock(4, 13, 4, BLOCK.SUGAR_CANE);
    expect(sim.breakBlock(4, 11, 4)).toBe(true);
    expect(w.getBlock(4, 12, 4)).toBe(BLOCK.AIR);
    expect(w.getBlock(4, 13, 4)).toBe(BLOCK.AIR);
    w.setBlock(7, 11, 7, BLOCK.GRASS);
    w.setBlock(7, 12, 7, BLOCK.FLOWER);
    expect(sim.breakBlock(7, 11, 7)).toBe(true);
    expect(w.getBlock(7, 12, 7)).toBe(BLOCK.AIR);
    expect(dropped(sim, 'lab:dandelion')).toBe(1);
  });
  it('pops a torch whose block is gone, but keeps one held by a wall', () => {
    const { sim, w } = setup();
    w.setBlock(2, 11, 2, BLOCK.COBBLE);
    w.setBlock(2, 12, 2, BLOCK.TORCH);
    w.setBlock(6, 11, 6, BLOCK.COBBLE);
    w.setBlock(6, 12, 6, BLOCK.COBBLE);
    w.setBlock(7, 12, 6, BLOCK.TORCH);
    expect(sim.breakBlock(2, 11, 2)).toBe(true);
    expect(w.getBlock(2, 12, 2)).toBe(BLOCK.AIR);
    expect(dropped(sim, 'lab:torch')).toBe(1);
    // The wall torch keeps its wall: breaking the block under it is not enough.
    w.setBlock(7, 11, 6, BLOCK.COBBLE);
    expect(sim.breakBlock(7, 11, 6)).toBe(true);
    expect(w.getBlock(7, 12, 6)).toBe(BLOCK.TORCH);
  });
  it('refuses a flower on stone and cane away from water', () => {
    const { sim, w } = setup();
    sim.inventory.set(sim.inventory.selected, { item: 'lab:dandelion', count: 2 });
    const onStone = sim.placeBlock(hitTop(3, 10, 3, BLOCK.STONE));
    expect(onStone.ok).toBe(false);
    w.setBlock(3, 11, 3, BLOCK.GRASS);
    expect(sim.placeBlock(hitTop(3, 11, 3, BLOCK.GRASS)).ok).toBe(true);
    sim.inventory.set(sim.inventory.selected, { item: 'lab:sugar_cane', count: 2 });
    w.setBlock(8, 11, 8, BLOCK.SAND);
    expect(sim.placeBlock(hitTop(8, 11, 8, BLOCK.SAND)).ok).toBe(false);
    w.setBlock(9, 11, 8, BLOCK.WATER);
    expect(sim.placeBlock(hitTop(8, 11, 8, BLOCK.SAND)).ok).toBe(true);
  });
  it('breaks a cactus when a block is put beside it, and wheat when its farmland goes', () => {
    const { sim, w } = setup();
    w.setBlock(4, 11, 4, BLOCK.SAND);
    w.setBlock(4, 12, 4, BLOCK.CACTUS);
    w.setBlock(4, 13, 4, BLOCK.CACTUS);
    sim.inventory.set(sim.inventory.selected, { item: 'lab:cobblestone', count: 4 });
    w.setBlock(5, 12, 4, BLOCK.COBBLE);
    expect(sim.placeBlock(hitTop(5, 12, 4, BLOCK.COBBLE)).ok).toBe(true);
    expect(w.getBlock(4, 13, 4)).toBe(BLOCK.AIR);
    w.setBlock(7, 11, 7, BLOCK.FARMLAND);
    w.setBlock(7, 12, 7, BLOCK.WHEAT_7);
    expect(sim.breakBlock(7, 11, 7)).toBe(true);
    expect(w.getBlock(7, 12, 7)).toBe(BLOCK.AIR);
    expect(dropped(sim, 'lab:wheat')).toBeGreaterThan(0);
  });
  it('knows which blocks need support', () => {
    expect(supportRule(BLOCK.SUGAR_CANE)).toBe('cane');
    expect(supportRule(BLOCK.STONE)).toBeNull();
    expect(supportRule(BLOCK_X.SNOW_LAYER)).toBe('floor');
    const air = () => BLOCK.AIR;
    expect(isSupported(air, 0, 1, 0, BLOCK.RAIL)).toBe(false);
    expect(isSupported(air, 0, 1, 0, BLOCK.STONE)).toBe(true);
  });
});
