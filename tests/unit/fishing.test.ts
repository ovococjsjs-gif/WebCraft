import { describe, expect, it } from 'vitest';
import { BLOCK } from '../../packages/content/src/blocks';
import { ITEMS } from '../../packages/content/src/items';
import { WorldSession } from '../../packages/core/src/session';
import { addItems, countItem } from '../../packages/core/src/inventory';
import { FISHING_LOOT, fishingCatch } from '../../packages/core/src/fishing';

/** Round H: the fishing rod casts a bobber, a fish bites after a while, pulling then catches it. */
function pond() {
  const session = new WorldSession('fishing', 'flat');
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) session.loadColumn(x, z);
  const sim = session.simulation;
  const w = session.world;
  for (let x = -4; x < 14; x++)
    for (let z = -8; z < 12; z++) {
      w.setBlock(x, 8, z, BLOCK.STONE);
      w.setBlock(x, 9, z, BLOCK.STONE);
      w.setBlock(x, 10, z, z < 4 ? BLOCK.WATER : BLOCK.STONE);
      for (let y = 11; y < 20; y++) w.setBlock(x, y, z, BLOCK.AIR);
    }
  sim.player.position = { x: 4.5, y: 11, z: 7.5 };
  sim.gameMode = 'survival';
  sim.input.yaw = 0;
  sim.input.pitch = -0.2;
  addItems(sim.inventory, 'lab:fishing_rod', 1);
  sim.inventory.selected = 0;
  return { sim, w };
}
type Snap = { bobber: { x: number; y: number; z: number; bite: boolean } | null };

describe('round H · fishing', () => {
  it('catches only things that exist', () => {
    const keys = new Set(ITEMS.map((item) => item.key));
    for (const table of Object.values(FISHING_LOOT))
      for (const [item] of table) expect(keys, item).toContain(item);
    let fish = 0;
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < 1000; i++) if (fishingCatch(random).kind === 'fish') fish++;
    expect(fish).toBeGreaterThan(780);
    expect(fish).toBeLessThan(920);
  });

  it('casts, waits for a bite on the water and pulls the catch in', () => {
    const { sim } = pond();
    expect(sim.use().message).toMatch(/заброшена/);
    let s = sim.snapshot() as unknown as Snap;
    expect(s.bobber).not.toBeNull();
    // It lands in the pond and floats at the surface.
    for (let i = 0; i < 60; i++) sim.step();
    s = sim.snapshot() as unknown as Snap;
    expect(s.bobber!.z).toBeLessThan(4);
    expect(s.bobber!.y).toBeGreaterThan(10.5);
    expect(s.bobber!.y).toBeLessThan(11.2);
    // Pulling too early brings nothing.
    const early = sim.use();
    expect(early.message).toMatch(/Сорвалось/);
    expect((sim.snapshot() as unknown as Snap).bobber).toBeNull();
    sim.use();
    let bit = false;
    for (let i = 0; i < 800 && !bit; i++) {
      sim.step();
      bit = (sim.snapshot() as unknown as Snap).bobber?.bite ?? false;
    }
    expect(bit).toBe(true);
    const before = sim.inventory.get(0)!.damage ?? 0;
    const result = sim.use();
    expect(result.message).toMatch(/Улов|Сокровище/);
    const got = ITEMS.filter((i) => i.key !== 'lab:fishing_rod').some(
      (i) => countItem(sim.inventory, i.key) > 0,
    );
    expect(got || countItem(sim.inventory, 'lab:fishing_rod') > 1).toBe(true);
    expect(sim.inventory.get(0)!.damage ?? 0).toBe(before + 1);
  });

  it('reels the line in when the rod leaves the hand', () => {
    const { sim } = pond();
    sim.use();
    sim.step();
    sim.inventory.selected = 3;
    sim.step();
    expect((sim.snapshot() as unknown as Snap).bobber).toBeNull();
  });
});
