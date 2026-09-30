import { describe, it, expect } from 'vitest';
import { VoxelWorld } from '../../packages/core/src/world';
import { generateColumn, spawnPoint } from '../../packages/core/src/terrain';
import { Simulation } from '../../packages/core/src/simulation';
import { EMPTY_INPUT } from '../../packages/core/src/player';
import { BLOCK } from '../../packages/content/src/blocks';
import { ITEMS } from '../../packages/content/src/items';
import { CREATIVE_TABS, creativeItems, creativeTab } from '../../packages/content/src/creative';

function setup(mode: 'creative' | 'survival' = 'creative') {
  const world = new VoxelWorld('test');
  for (let x = -2; x <= 2; x++)
    for (let z = -2; z <= 2; z++) world.addColumn(generateColumn(x, z, 'test', 'flat'));
  const sim = new Simulation(world, spawnPoint('test', 'flat'));
  sim.gameMode = mode;
  for (let i = 0; i < 5; i++) sim.step();
  return sim;
}
/** Looks at the ground in front of the player: a column of blocks to break. */
function lookDown(sim: Simulation) {
  sim.setInput({ ...EMPTY_INPUT, pitch: -1.1 });
}

describe('creative catalogue', () => {
  it('puts every obtainable item into exactly one tab and hides technical blocks', () => {
    const listed = CREATIVE_TABS.flatMap((tab) => creativeItems(tab.id));
    expect(new Set(listed.map((item) => item.key)).size).toBe(listed.length);
    expect(listed.length).toBe(creativeItems('search').length);
    expect(listed.length).toBeGreaterThan(200);
    for (const key of ['lab:nether_portal', 'lab:end_portal', 'lab:lava', 'lab:farmland'])
      expect(creativeTab(ITEMS.find((item) => item.key === key)!)).toBeNull();
    for (const tab of CREATIVE_TABS) expect(creativeItems(tab.id).length).toBeGreaterThan(0);
    expect(creativeItems('building').some((item) => item.key === 'lab:stone')).toBe(true);
    expect(creativeItems('combat').some((item) => item.key === 'lab:iron_sword')).toBe(true);
  });
  it('searches by the Russian name', () => {
    const found = creativeItems('search', 'алмаз');
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((item) => item.name.toLowerCase().includes('алмаз'))).toBe(true);
  });
  it('takes a stack, one item, or straight into the inventory, and deletes on a second click', () => {
    const sim = setup();
    expect(sim.creativeTake('lab:stone', 'stack').ok).toBe(true);
    expect(sim.cursor).toMatchObject({ item: 'lab:stone', count: 64 });
    // Clicking the catalogue while carrying something deletes it.
    sim.creativeTake('lab:glass', 'stack');
    expect(sim.cursor).toBeNull();
    sim.creativeTake('lab:glass', 'one');
    sim.creativeTake('lab:glass', 'one');
    expect(sim.cursor).toMatchObject({ item: 'lab:glass', count: 2 });
    sim.creativeTrash();
    expect(sim.cursor).toBeNull();
    const before = sim.amountOf('lab:diamond');
    expect(sim.creativeTake('lab:diamond', 'inventory').ok).toBe(true);
    expect(sim.amountOf('lab:diamond')).toBe(before + 64);
    sim.creativeTrash(true);
    expect(sim.amountOf('lab:diamond')).toBe(0);
  });
  it('is closed to survival players', () => {
    const sim = setup('survival');
    expect(sim.creativeTake('lab:diamond', 'stack').ok).toBe(false);
    expect(sim.cursor).toBeNull();
  });
});

describe('creative interaction', () => {
  it('breaks without drops and pick block conjures the block', () => {
    const sim = setup();
    lookDown(sim);
    const hit = sim.target()!;
    expect(hit.state).toBe(BLOCK.GRASS);
    expect(sim.hitBlock().ok).toBe(true);
    expect(sim.world.getBlock(hit.x, hit.y, hit.z)).toBe(BLOCK.AIR);
    for (let i = 0; i < 3; i++) sim.step();
    expect(sim.entities.list.some((entity) => entity.item)).toBe(false);
    // Middle click on dirt gives a full stack even with an empty inventory.
    const below = sim.target()!;
    expect(below.state).toBe(BLOCK.DIRT);
    const picked = sim.pick();
    expect(picked.ok).toBe(true);
    expect(sim.heldItem).toMatchObject({ item: 'lab:dirt', count: 64 });
  });
  it('waits between blocks while the button is held', () => {
    const sim = setup();
    lookDown(sim);
    sim.setMining(true);
    let broken = 0;
    let last = sim.target();
    for (let i = 0; i < 24; i++) {
      sim.step();
      const now = sim.target();
      if (last && (!now || now.y !== last.y || now.x !== last.x || now.z !== last.z)) broken++;
      last = now;
    }
    sim.setMining(false);
    // Twenty-four ticks at one block per five or six ticks: four or five blocks, not 24.
    expect(broken).toBeGreaterThanOrEqual(3);
    expect(broken).toBeLessThanOrEqual(5);
  });
  it('does not break blocks with a sword', () => {
    const sim = setup();
    sim.grant('lab:iron_sword', 1);
    sim.select(0);
    lookDown(sim);
    const hit = sim.target()!;
    expect(sim.hitBlock().ok).toBe(false);
    sim.setMining(true);
    for (let i = 0; i < 10; i++) sim.step();
    expect(sim.world.getBlock(hit.x, hit.y, hit.z)).toBe(hit.state);
  });
  it('lands out of flight when descending onto the ground', () => {
    const sim = setup();
    sim.player.flying = true;
    sim.player.position.y += 3;
    sim.setInput({ ...EMPTY_INPUT, crouch: true });
    for (let i = 0; i < 40 && sim.player.flying; i++) sim.step();
    expect(sim.player.flying).toBe(false);
  });
});
