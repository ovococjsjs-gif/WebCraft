import { describe, expect, it } from 'vitest';
import { BLOCK, BLOCK_X, registry } from '../../packages/content/src/blocks';
import { EMPTY_INPUT } from '../../packages/core/src/player';
import { WorldSession } from '../../packages/core/src/session';
import { rollDrops } from '../../packages/core/src/mining';
import {
  INGREDIENT_TAGS,
  RECIPES,
  SMELTING,
  gridResult,
  smeltingFor,
} from '../../packages/core/src/crafting';
import { itemRegistry } from '../../packages/content/src/items';
import type { ItemStack } from '../../packages/core/src/inventory';

/** Regressions found by playing the game the way a player does: real clicks, no shortcuts. */
function session(seed = 'playthrough') {
  const world = new WorldSession(seed, 'flat', undefined, 'survival');
  world.simulation.naturalSpawns = false;
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) world.loadColumn(x, z);
  return world;
}
/** Puts a block right in front of the player's eyes and looks at it. */
function lookAtBlock(world: WorldSession, state: number) {
  const sim = world.simulation;
  const p = sim.player.position;
  const x = Math.floor(p.x),
    y = Math.floor(p.y + 1.5),
    z = Math.floor(p.z) - 2;
  world.world.setBlock(x, y, z, state);
  sim.setInput({ ...EMPTY_INPUT, yaw: 0, pitch: 0 });
  sim.step();
  return { x, y, z };
}

describe('stations opened with the use button', () => {
  it('a crafting table opens the 3×3 grid, not the 2×2 of the inventory', () => {
    const world = session();
    const sim = world.simulation;
    const at = lookAtBlock(world, BLOCK.CRAFTING_TABLE);
    expect(sim.target()).toMatchObject(at);
    const result = sim.use();
    expect(result.ok).toBe(true);
    expect(sim.open).toMatchObject({ kind: 'crafting_table', gridSize: 3 });
  });
  it('a furnace and a chest open as themselves', () => {
    for (const [state, kind] of [
      [BLOCK.FURNACE, 'furnace'],
      [BLOCK.CHEST, 'chest'],
    ] as const) {
      const world = session(`playthrough-${kind}`);
      lookAtBlock(world, state);
      expect(world.simulation.use().ok).toBe(true);
      expect(world.simulation.open?.kind).toBe(kind);
    }
  });
});

describe('what plants give by hand and with shears', () => {
  /** Tallies a thousand rolls with a fixed pseudo-random sequence. */
  function tally(state: number, held: ItemStack | null) {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const counts: Record<string, number> = {};
    for (let i = 0; i < 4000; i++)
      for (const drop of rollDrops(state, held, random))
        counts[drop.item] = (counts[drop.item] ?? 0) + drop.count;
    return counts;
  }
  const shears: ItemStack = { item: 'lab:shears', count: 1 };
  it('leaves broken by hand never drop themselves, only a sapling or an apple now and then', () => {
    const hand = tally(BLOCK.LEAVES, null);
    expect(hand['lab:oak_leaves']).toBeUndefined();
    expect(hand['lab:oak_sapling']).toBeGreaterThan(120);
    expect(hand['lab:oak_sapling']).toBeLessThan(290);
    expect(hand['lab:apple'] ?? 0).toBeLessThan(60);
    expect(tally(BLOCK.LEAVES, shears)).toEqual({ 'lab:oak_leaves': 4000 });
    // Every tree's leaves give its own sapling, and sometimes a stick, never the leaves.
    const spruce = tally(BLOCK_X.SPRUCE_LEAVES, null);
    expect(Object.keys(spruce).sort()).toEqual(['lab:spruce_sapling', 'lab:stick']);
    expect(spruce['lab:spruce_sapling']).toBeGreaterThan(120);
    expect(spruce['lab:spruce_sapling']).toBeLessThan(290);
  });
  it('grass and ferns are the early source of wheat seeds', () => {
    for (const state of [BLOCK.TALL_GRASS, BLOCK_X.FERN]) {
      const hand = tally(state, null);
      expect(Object.keys(hand)).toEqual(['lab:seeds']);
      expect(hand['lab:seeds']).toBeGreaterThan(380);
      expect(hand['lab:seeds']).toBeLessThan(620);
    }
    expect(tally(BLOCK.TALL_GRASS, shears)).toEqual({ 'lab:tall_grass': 4000 });
  });
});

describe('leaf decay', () => {
  /** A trunk of three logs with a 3×3×2 crown on top, at the given corner. */
  function tree(world: WorldSession, x: number, z: number) {
    const w = world.world;
    const base = 5;
    for (let y = 0; y < 3; y++) w.setBlock(x, base + y, z, BLOCK.LOG);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (let dy = 2; dy <= 3; dy++)
          if (dx || dz || dy === 3) w.setBlock(x + dx, base + dy, z + dz, BLOCK.LEAVES);
    return base;
  }
  function leavesAround(world: WorldSession, x: number, z: number) {
    let n = 0;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (let y = 5; y <= 9; y++)
          if (world.world.getBlock(x + dx, y, z + dz) === BLOCK.LEAVES) n++;
    return n;
  }
  it('a crown without its trunk falls apart within half a minute; a standing tree and a hedge stay', () => {
    const world = session('leaf-decay');
    const sim = world.simulation;
    tree(world, 4, 4);
    tree(world, 10, 4);
    // A hedge a player planted away from any tree.
    for (let x = -6; x <= -3; x++) world.world.setBlock(x, 5, 8, BLOCK.LEAVES);
    const crown = leavesAround(world, 4, 4);
    expect(crown).toBe(17);
    for (let y = 5; y <= 7; y++) expect(sim.breakBlock(4, y, 4)).toBe(true);
    // Nothing happens at once: the crown thins out over the next seconds.
    sim.step();
    expect(leavesAround(world, 4, 4)).toBe(crown);
    for (let i = 0; i < 520; i++) sim.step();
    expect(leavesAround(world, 4, 4)).toBe(0);
    expect(leavesAround(world, 10, 4)).toBe(17);
    for (let x = -6; x <= -3; x++) expect(world.world.getBlock(x, 5, 8)).toBe(BLOCK.LEAVES);
  });
  it('a log put back in time saves the crown', () => {
    const world = session('leaf-decay-save');
    const sim = world.simulation;
    tree(world, 4, 4);
    expect(sim.breakBlock(4, 7, 4)).toBe(true);
    sim.setBlockState(4, 7, 4, BLOCK.LOG);
    for (let i = 0; i < 520; i++) sim.step();
    expect(leavesAround(world, 4, 4)).toBe(17);
  });
});

describe('crafting the way a player does it', () => {
  const s = (item: string, count = 1): ItemStack => ({ item: `lab:${item}`, count });
  it('a whole stack in the grid still crafts, one set at a time', () => {
    expect(gridResult([s('oak_log', 5), null, null, null], 2)?.item).toBe('lab:oak_planks');
    const planks = s('oak_planks', 8);
    expect(gridResult([planks, planks, planks, planks], 2)?.item).toBe('lab:crafting_table');
  });
  it('shift-clicking the result turns a stack of logs into planks in one go', () => {
    const world = session('stack-craft');
    const sim = world.simulation;
    sim.grant('lab:spruce_log', 5);
    sim.openCrafting();
    const from = sim.inventoryData().findIndex((slot) => slot?.[0] === 'lab:spruce_log');
    sim.slotClick(null, from, 0);
    sim.slotClick('grid', 0, 0);
    expect(sim.slotClick('result', 0, 0, { shift: true }).ok).toBe(true);
    expect(sim.amountOf('lab:spruce_planks')).toBe(20);
    expect(sim.amountOf('lab:spruce_log')).toBe(0);
  });
  it('every tree gives planks, and planks of any tree make sticks, tables and tools', () => {
    for (const wood of ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'])
      expect(gridResult([s(`${wood}_log`), null, null, null], 2)?.item).toBe(`lab:${wood}_planks`);
    expect(gridResult([s('spruce_planks'), null, s('birch_planks'), null], 2)?.item).toBe(
      'lab:stick',
    );
    const p = s('jungle_planks'),
      k = s('stick');
    expect(gridResult([p, p, p, null, k, null, null, k, null], 3)?.item).toBe('lab:wood_pickaxe');
  });
  it('a bed is three wool over three planks', () => {
    const w = s('wool'),
      p = s('acacia_planks');
    expect(gridResult([w, w, w, p, p, p, null, null, null], 3)?.item).toBe('lab:bed');
  });
  it('the furnace cooks meat and bakes cobblestone back into stone', () => {
    expect(smeltingFor(s('beef'))?.result[0]).toBe('lab:cooked_beef');
    expect(smeltingFor(s('chicken'))?.result[0]).toBe('lab:cooked_chicken');
    expect(smeltingFor(s('cobblestone'))?.result[0]).toBe('lab:stone');
    expect(smeltingFor(s('gold_ore'))?.result[0]).toBe('lab:gold_ingot');
    expect(smeltingFor(s('dark_oak_log'))?.result[0]).toBe('lab:charcoal');
    expect(itemRegistry.find('lab:cooked_beef')?.food?.nutrition).toBeGreaterThan(
      itemRegistry.find('lab:beef')!.food!.nutrition,
    );
    expect(itemRegistry.find('lab:carrot')?.food).toBeTruthy();
  });
  it('every recipe is made of items that exist and gives an item that exists', () => {
    const exists = (key: string) =>
      key.startsWith('#') ? key in INGREDIENT_TAGS : itemRegistry.find(key) !== undefined;
    for (const recipe of RECIPES) {
      const parts = recipe.kind === 'shaped' ? Object.values(recipe.key) : recipe.ingredients;
      for (const part of parts) expect(exists(part), `${recipe.id}: ${part}`).toBe(true);
      expect(exists(recipe.result[0]), recipe.id).toBe(true);
    }
    for (const recipe of SMELTING) {
      expect(exists(recipe.input), recipe.id).toBe(true);
      expect(exists(recipe.result[0]), recipe.id).toBe(true);
    }
    for (const members of Object.values(INGREDIENT_TAGS))
      for (const item of members.items) expect(exists(item), item).toBe(true);
  });
});

describe('shift-click with a chest or a furnace open', () => {
  function open(state: number, seed: string) {
    const world = session(seed);
    const sim = world.simulation;
    lookAtBlock(world, state);
    expect(sim.use().ok).toBe(true);
    return sim;
  }
  const slotOf = (sim: WorldSession['simulation'], item: string) =>
    sim.inventoryData().findIndex((slot) => slot?.[0] === item);
  const contents = (sim: WorldSession['simulation']) =>
    (sim.containerView() as unknown as { container: (unknown[] | null)[] }).container;
  it('moves a stack into the chest and back out', () => {
    const sim = open(BLOCK.CHEST, 'shift-chest');
    sim.grant('lab:cobblestone', 10);
    sim.slotClick(null, slotOf(sim, 'lab:cobblestone'), 0, { shift: true });
    expect(sim.amountOf('lab:cobblestone')).toBe(0);
    expect(contents(sim)[0]).toEqual(['lab:cobblestone', 10, 0]);
    sim.slotClick(sim.open!.key, 0, 0, { shift: true });
    expect(sim.amountOf('lab:cobblestone')).toBe(10);
    expect(contents(sim)[0]).toBeNull();
  });
  it('sends ore to the furnace input, coal to the fuel and takes the ingots out with xp', () => {
    const sim = open(BLOCK.FURNACE, 'shift-furnace');
    sim.grant('lab:iron_ore', 2);
    sim.grant('lab:coal', 1);
    sim.slotClick(null, slotOf(sim, 'lab:iron_ore'), 0, { shift: true });
    sim.slotClick(null, slotOf(sim, 'lab:coal'), 0, { shift: true });
    expect(contents(sim)[0]).toEqual(['lab:iron_ore', 2, 0]);
    expect(contents(sim)[1]).toEqual(['lab:coal', 1, 0]);
    for (let i = 0; i < 420; i++) sim.step();
    expect(contents(sim)[2]).toEqual(['lab:iron_ingot', 2, 0]);
    sim.slotClick(sim.open!.key, 2, 0, { shift: true });
    expect(sim.amountOf('lab:iron_ingot')).toBe(2);
    expect(contents(sim)[2]).toBeNull();
    expect(sim.survival.xp + sim.survival.level).toBeGreaterThan(0);
  });
});

describe('water, doors and saplings the way a player meets them', () => {
  const stateOf = (key: string) => {
    for (let state = 0; state < 4096; state++)
      if (registry.has(state) && registry.get(state).key === key) return state;
    throw new Error(key);
  };
  it('the crosshair looks through fluids and an empty bucket scoops the still water', () => {
    const world = session('bucket');
    const sim = world.simulation;
    const at = lookAtBlock(world, BLOCK.STONE);
    world.world.setBlock(at.x, at.y, at.z - 1, BLOCK.STONE);
    world.world.setBlock(at.x, at.y, at.z, BLOCK.WATER);
    world.world.setBlock(at.x, at.y, at.z + 1, stateOf('lab:water_flow_3'));
    expect(sim.target()).toMatchObject({ x: at.x, y: at.y, z: at.z - 1 });
    sim.grant('lab:bucket', 1);
    sim.select(sim.inventoryData().findIndex((slot) => slot?.[0] === 'lab:bucket'));
    expect(sim.use()).toMatchObject({ ok: true });
    expect(sim.amountOf('lab:water_bucket')).toBe(1);
    expect(world.world.getBlock(at.x, at.y, at.z)).toBe(BLOCK.AIR);
  });
  it('an empty bucket reaches water with nothing behind it', () => {
    const world = session('bucket-lake');
    const sim = world.simulation;
    const at = lookAtBlock(world, BLOCK.WATER);
    expect(sim.target()).toBeNull();
    sim.grant('lab:bucket', 1);
    sim.select(sim.inventoryData().findIndex((slot) => slot?.[0] === 'lab:bucket'));
    expect(sim.use()).toMatchObject({ ok: true });
    expect(world.world.getBlock(at.x, at.y, at.z)).toBe(BLOCK.AIR);
  });
  it('a door drops one door whichever half is broken', () => {
    for (const half of [0, 1]) {
      const world = session(`door-${half}`);
      const sim = world.simulation;
      const p = sim.player.position;
      const x = Math.floor(p.x),
        y = Math.floor(p.y),
        z = Math.floor(p.z) - 2;
      sim.setInput({
        ...EMPTY_INPUT,
        yaw: 0,
        pitch: Math.atan2(y - (p.y + 1.62), z + 0.5 - p.z === 0 ? 1 : p.z - (z + 0.5)),
      });
      sim.step();
      sim.grant('lab:oak_door', 1);
      sim.select(sim.inventoryData().findIndex((slot) => slot?.[0] === 'lab:oak_door'));
      expect(sim.use()).toMatchObject({ ok: true });
      expect(registry.get(world.world.getBlock(x, y, z)).model?.kind).toBe('door');
      expect(sim.breakBlock(x, y + half, z)).toBe(true);
      expect(world.world.getBlock(x, y, z)).toBe(BLOCK.AIR);
      expect(world.world.getBlock(x, y + 1, z)).toBe(BLOCK.AIR);
      const drops = sim.entities.list.filter((entity) => entity.item === 'lab:oak_door');
      expect(drops.reduce((sum, entity) => sum + entity.count, 0)).toBe(1);
    }
  });
  it('bone meal grows a sapling into a tree within a few doses', () => {
    const world = session('sapling');
    const sim = world.simulation;
    const p = sim.player.position;
    const x = Math.floor(p.x),
      y = Math.floor(p.y),
      z = Math.floor(p.z) - 2;
    world.world.setBlock(x, y, z, BLOCK.OAK_SAPLING);
    sim.setInput({
      ...EMPTY_INPUT,
      yaw: 0,
      pitch: Math.atan2(y + 0.4 - (p.y + 1.62), p.z - (z + 0.5)),
    });
    sim.step();
    expect(sim.target()).toMatchObject({ x, y, z });
    sim.grant('lab:bone_meal', 30);
    sim.select(sim.inventoryData().findIndex((slot) => slot?.[0] === 'lab:bone_meal'));
    let doses = 0;
    while (world.world.getBlock(x, y, z) === BLOCK.OAK_SAPLING && doses < 30) {
      expect(sim.use().ok).toBe(true);
      doses++;
    }
    expect(world.world.getBlock(x, y, z)).toBe(BLOCK.LOG);
    expect(sim.amountOf('lab:bone_meal')).toBe(30 - doses);
  });
});

describe('diamonds have a use', () => {
  const grid = (pattern: (string | null)[]): (ItemStack | null)[] =>
    pattern.map((item) => (item ? { item, count: 1 } : null));
  const D = 'lab:diamond',
    S = 'lab:stick';
  it('diamonds craft the whole tool set and the armour', () => {
    expect(gridResult(grid([D, D, D, null, S, null, null, S, null]), 3)?.item).toBe(
      'lab:diamond_pickaxe',
    );
    expect(gridResult(grid([D, null, null, D, null, null, S, null, null]), 3)?.item).toBe(
      'lab:diamond_sword',
    );
    expect(gridResult(grid([D, D, D, D, null, D, null, null, null]), 3)?.item).toBe(
      'lab:diamond_helmet',
    );
    for (const key of ['axe', 'shovel', 'hoe', 'chestplate', 'leggings', 'boots'])
      expect(itemRegistry.find(`lab:diamond_${key}`)).toBeTruthy();
  });
  it('obsidian needs a diamond pickaxe, as in 1.12', () => {
    expect(rollDrops(BLOCK.OBSIDIAN, { item: 'lab:iron_pickaxe', count: 1 })).toEqual([]);
    expect(rollDrops(BLOCK.OBSIDIAN, { item: 'lab:diamond_pickaxe', count: 1 })).toEqual([
      { item: 'lab:obsidian', count: 1 },
    ]);
    expect(rollDrops(BLOCK.DIAMOND_ORE, { item: 'lab:iron_pickaxe', count: 1 })).toEqual([
      { item: 'lab:diamond', count: 1 },
    ]);
  });
  it('the enchanting table takes diamonds, obsidian and a book', () => {
    const B = 'lab:book',
      O = 'lab:obsidian';
    expect(gridResult(grid([null, B, null, D, O, D, O, O, O]), 3)?.item).toBe(
      'lab:enchanting_table',
    );
  });
});

describe('the way into brewing', () => {
  it('three glass make three bottles', () => {
    const G = { item: 'lab:glass', count: 1 };
    expect(gridResult([G, null, G, null, G, null, null, null, null], 3)).toMatchObject({
      item: 'lab:glass_bottle',
      count: 3,
    });
  });
  it('a bottle aimed at water fills and the water stays; drinking hands the bottle back', () => {
    const world = session('bottle');
    const sim = world.simulation;
    const at = lookAtBlock(world, BLOCK.WATER);
    sim.grant('lab:glass_bottle', 2);
    sim.select(sim.inventoryData().findIndex((slot) => slot?.[0] === 'lab:glass_bottle'));
    expect(sim.use()).toMatchObject({ ok: true });
    expect(sim.amountOf('lab:potion_water')).toBe(1);
    expect(sim.amountOf('lab:glass_bottle')).toBe(1);
    expect(world.world.getBlock(at.x, at.y, at.z)).toBe(BLOCK.WATER);
    world.world.setBlock(at.x, at.y, at.z, BLOCK.AIR);
    sim.select(sim.inventoryData().findIndex((slot) => slot?.[0] === 'lab:potion_water'));
    expect(sim.use()).toMatchObject({ ok: true });
    expect(sim.amountOf('lab:potion_water')).toBe(0);
    expect(sim.amountOf('lab:glass_bottle')).toBe(2);
  });
});

describe('flint for the flint and steel', () => {
  it('gravel gives flint instead of itself about one time in ten', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    let flint = 0,
      gravel = 0;
    for (let i = 0; i < 1000; i++) {
      const drops = rollDrops(BLOCK.GRAVEL, null, random);
      expect(drops).toHaveLength(1);
      if (drops[0].item === 'lab:flint') flint++;
      else if (drops[0].item === 'lab:gravel') gravel++;
    }
    expect(flint + gravel).toBe(1000);
    expect(flint).toBeGreaterThan(60);
    expect(flint).toBeLessThan(140);
  });
});
