import { describe, expect, it } from 'vitest';
import { BLOCK } from '../../packages/content/src/blocks';
import { ITEMS } from '../../packages/content/src/items';
import { WorldSession } from '../../packages/core/src/session';
import { countItem, addItems } from '../../packages/core/src/inventory';
import {
  TRADES,
  TRADE_MAX_USES,
  VILLAGER_PROFESSIONS,
  tradesFor,
} from '../../packages/core/src/trading';
import { generatorV5 } from '../../packages/core/src/worldgen/generator-v5';
import {
  villageHomes,
  villageFootprints,
} from '../../packages/core/src/worldgen/structures/villages';
import { farPatchV5 } from '../../packages/core/src/worldgen/far-v5';
import { validateCore } from '../../packages/storage/src/format';

/** Round H: villages get their villagers, and villagers trade for emeralds as in 1.12. */
function flat() {
  const session = new WorldSession('villagers', 'flat');
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) session.loadColumn(x, z);
  const sim = session.simulation;
  const w = session.world;
  for (let x = -4; x < 12; x++)
    for (let z = -4; z < 12; z++) {
      w.setBlock(x, 10, z, BLOCK.STONE);
      for (let y = 11; y < 20; y++) w.setBlock(x, y, z, BLOCK.AIR);
    }
  sim.player.position = { x: 4.5, y: 11, z: 8.5 };
  sim.gameMode = 'survival';
  sim.input.yaw = 0; // looking north, towards −z
  sim.input.pitch = 0;
  return { session, sim, w };
}

describe('round H · villagers', () => {
  it('trades only in items that exist', () => {
    const keys = new Set(ITEMS.map((item) => item.key));
    for (const profession of VILLAGER_PROFESSIONS) {
      expect(TRADES[profession].length).toBeGreaterThanOrEqual(3);
      for (const trade of TRADES[profession]) {
        for (const [item, count] of trade.give) {
          expect(keys, `${profession}: ${item}`).toContain(item);
          expect(count).toBeGreaterThan(0);
        }
        expect(keys, `${profession}: ${trade.get[0]}`).toContain(trade.get[0]);
      }
      // Every career both buys something for emeralds and sells something for them.
      expect(TRADES[profession].some((t) => t.get[0] === 'lab:emerald')).toBe(true);
      expect(TRADES[profession].some((t) => t.give.some(([i]) => i === 'lab:emerald'))).toBe(true);
    }
  });

  it('opens the offers of the villager in front and makes the exchange', () => {
    const { sim } = flat();
    const mob = sim.mobs.spawn('lab:villager', { x: 4.5, y: 11, z: 6.5 });
    mob.variant = VILLAGER_PROFESSIONS.indexOf('farmer');
    mob.yaw = 0;
    const opened = sim.use();
    expect(opened.ok).toBe(true);
    const view = sim.containerView();
    expect(view?.kind).toBe('trade');
    expect(view?.trade?.offers.length).toBe(tradesFor(mob.variant).length);
    const index = tradesFor(mob.variant).findIndex((t) => t.get[0] === 'lab:emerald');
    const trade = tradesFor(mob.variant)[index];
    expect(view!.trade!.offers[index].affordable).toBe(false);
    expect(sim.trade(index).ok).toBe(false);
    const [item, count] = trade.give[0];
    addItems(sim.inventory, item, count * 2);
    expect(sim.containerView()!.trade!.offers[index].affordable).toBe(true);
    const result = sim.trade(index);
    expect(result.ok, result.reason).toBe(true);
    expect(countItem(sim.inventory, item)).toBe(count);
    expect(countItem(sim.inventory, 'lab:emerald')).toBe(trade.get[1]);
    // Nothing extra falls to the ground.
    expect(sim.entities.list.filter((e) => e.item === 'lab:emerald')).toHaveLength(0);
    expect(mob.tradeUses[index]).toBe(1);
    expect(sim.containerView()!.trade!.offers[index].left).toBe(TRADE_MAX_USES - 1);
  });

  it('stops an offer after its uses until the villager restocks', () => {
    const { sim } = flat();
    const mob = sim.mobs.spawn('lab:villager', { x: 4.5, y: 11, z: 6.5 });
    mob.variant = VILLAGER_PROFESSIONS.indexOf('librarian');
    sim.use();
    const index = 0;
    const trade = tradesFor(mob.variant)[index];
    for (const [item, count] of trade.give) addItems(sim.inventory, item, count * 10);
    for (let i = 0; i < TRADE_MAX_USES; i++) expect(sim.trade(index).ok).toBe(true);
    expect(sim.trade(index).ok).toBe(false);
  });

  it('keeps a villager’s home and trades in the save', () => {
    const { session, sim } = flat();
    const mob = sim.mobs.spawn('lab:villager', { x: 4.5, y: 11, z: 6.5 });
    mob.variant = 3;
    mob.home = { x: 100.5, y: 70, z: -40.5 };
    mob.tradeUses = [2, 0, 5];
    const saved = session.checkpoint();
    const checked = validateCore(JSON.parse(JSON.stringify(saved)));
    const again = new WorldSession('villagers', 'flat', checked);
    const back = again.simulation.mobs.list.find((m) => m.kind === 'lab:villager')!;
    expect(back.variant).toBe(3);
    expect(back.home).toEqual({ x: 100.5, y: 70, z: -40.5 });
    expect(back.tradeUses.slice(0, 3)).toEqual([2, 0, 5]);
  });

  it('settles a generated village with its careers when the player comes near', () => {
    const seed = 'villagers-live';
    const g = generatorV5(seed, 'overworld');
    const village = g.structures
      .near(-40, -40, 40, 40, ['village'])
      .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
    expect(village).toBeDefined();
    const homes = villageHomes(village.pieces);
    expect(homes.length).toBeGreaterThan(0);
    const session = new WorldSession(seed, 'overworld');
    const cx = Math.floor(village.x / 16),
      cz = Math.floor(village.z / 16);
    for (let x = cx - 4; x <= cx + 4; x++)
      for (let z = cz - 4; z <= cz + 4; z++) session.loadColumn(x, z);
    const sim = session.simulation;
    sim.naturalSpawns = true;
    sim.gameMode = 'creative';
    sim.player.position = { x: village.x + 0.5, y: 120, z: village.z + 0.5 };
    sim.player.flying = true;
    for (let i = 0; i < 90; i++) sim.step();
    const residents = sim.mobs.list.filter((m) => m.kind === 'lab:villager');
    expect(residents.length).toBeGreaterThanOrEqual(3);
    for (const r of residents) {
      expect(r.home).toBeDefined();
      expect(Math.hypot(r.position.x - village.x, r.position.z - village.z)).toBeLessThan(80);
    }
    const count = residents.length;
    for (let i = 0; i < 200; i++) sim.step();
    // A full village does not keep filling up.
    expect(sim.mobs.list.filter((m) => m.kind === 'lab:villager').length).toBe(count);
    // And the compass knows where it is.
    const marks = sim.snapshot().landmarks;
    expect(marks.some((m) => Math.hypot(m.x - village.x, m.z - village.z) < 2)).toBe(true);
  });

  it('shows village roofs on the far terrain', () => {
    const seed = 'villagers-live';
    const g = generatorV5(seed, 'overworld');
    const village = g.structures.near(-40, -40, 40, 40, ['village'])[0];
    const house = villageFootprints(village.pieces).find((f) => f.height !== undefined)!;
    const x0 = house.box.x0 & ~3,
      z0 = house.box.z0 & ~3;
    const patch = farPatchV5(seed, 'overworld', x0, z0, 1, 16);
    const i = house.box.x0 - x0 + 1,
      j = house.box.z0 - z0 + 1;
    expect(patch.tops[i + j * patch.side]).toBe(house.top);
    expect(patch.heights[i + j * patch.side]).toBe(house.height);
  });
});
