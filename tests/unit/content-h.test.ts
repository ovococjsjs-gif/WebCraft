import { describe, expect, it } from 'vitest';
import { BLOCK, BLOCK_H, BLOCK_X, registry } from '../../packages/content/src/blocks';
import { ITEMS, itemRegistry } from '../../packages/content/src/items';
import { creativeTab } from '../../packages/content/src/creative';
import { RECIPES, SMELTING, recipeById } from '../../packages/core/src/crafting';
import { woolItem } from '../../packages/core/src/mobs';
import { WorldSession } from '../../packages/core/src/session';
import type { PlantSystem } from '../../packages/core/src/farming';

/** Round H: the missing 1.12 items and blocks behave like the reference ones. */
function setup() {
  const session = new WorldSession('content-h', 'flat');
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) session.loadColumn(x, z);
  const sim = session.simulation;
  const w = session.world;
  for (let x = -4; x < 14; x++)
    for (let z = -4; z < 14; z++) {
      w.setBlock(x, 10, z, BLOCK.GRASS);
      for (let y = 11; y < 40; y++) w.setBlock(x, y, z, BLOCK.AIR);
    }
  sim.player.position = { x: 0.5, y: 11, z: 12.5 };
  sim.gameMode = 'survival';
  const plants = (sim as unknown as { plants: PlantSystem }).plants;
  return { sim, w, plants };
}
type Sim = ReturnType<typeof setup>['sim'];
const hold = (sim: Sim, item: string, count = 1) =>
  sim.inventory.set(sim.selected, { item, count, damage: 0 });
/** Stands `back` blocks south of the cell (x, z), `side` across it, and looks down at it. */
function lookAt(sim: Sim, x: number, y: number, z: number, pitch = -1, back = 1.55, side = 0.5) {
  sim.player.position = { x: x + side, y, z: z + back };
  sim.player.velocity = { x: 0, y: 0, z: 0 };
  sim.setInput({ ...sim.input, yaw: 0, pitch, forward: 0, strafe: 0, jump: false, crouch: false });
}
const dropped = (sim: Sim, item: string) =>
  sim.entities.list.filter((e) => e.item === item).reduce((n, e) => n + e.count, 0);

describe('round H · crops and trees', () => {
  it('plants a carrot into farmland and drops carrots when it is ripe', () => {
    const { sim, w } = setup();
    w.setBlock(4, 10, 4, BLOCK.FARMLAND);
    lookAt(sim, 4, 11, 4);
    hold(sim, 'lab:carrot', 3);
    const result = sim.use();
    expect(result.ok, result.reason).toBe(true);
    expect(w.getBlock(4, 11, 4)).toBe(BLOCK_H.CARROTS);
    expect(sim.heldItem?.count).toBe(2);
    w.setBlock(4, 11, 4, BLOCK_H.CARROTS + 7);
    expect(sim.breakBlock(4, 11, 4)).toBe(true);
    expect(dropped(sim, 'lab:carrot')).toBeGreaterThanOrEqual(1);
  });
  it('replants a harvested crop as the first stage of the same crop', () => {
    const { w, plants } = setup();
    w.setBlock(6, 10, 6, BLOCK.FARMLAND);
    w.setBlock(6, 11, 6, BLOCK_H.BEETROOTS + 7);
    expect(plants.harvest(6, 11, 6)).toBe('ripe');
    expect(w.getBlock(6, 11, 6)).toBe(BLOCK_H.BEETROOTS);
  });
  it('a ripe melon stem sets a melon beside itself', () => {
    const { w, plants } = setup();
    w.setBlock(5, 10, 5, BLOCK.FARMLAND);
    w.setBlock(5, 11, 5, BLOCK_H.MELON_STEM + 7);
    for (let i = 0; i < 400; i++) plants.tickAt(5, 11, 5);
    const around = [
      w.getBlock(6, 11, 5),
      w.getBlock(4, 11, 5),
      w.getBlock(5, 11, 6),
      w.getBlock(5, 11, 4),
    ].filter((state) => state === BLOCK.MELON);
    expect(around).toHaveLength(1);
    expect(w.getBlock(5, 11, 5)).toBe(BLOCK_H.MELON_STEM + 7);
  });
  it('grows every sapling into its own tree', () => {
    const { w, plants } = setup();
    const kinds = [
      ['spruce', BLOCK_X.SPRUCE_LOG, BLOCK_X.SPRUCE_LEAVES],
      ['birch', BLOCK.BIRCH, BLOCK_X.BIRCH_LEAVES],
      ['jungle', BLOCK_X.JUNGLE_LOG, BLOCK_X.JUNGLE_LEAVES],
      ['acacia', BLOCK_X.ACACIA_LOG, BLOCK_X.ACACIA_LEAVES],
      ['dark_oak', BLOCK_X.DARK_OAK_LOG, BLOCK_X.DARK_OAK_LEAVES],
    ] as const;
    for (const [kind, log, leaf] of kinds) {
      for (let x = -3; x < 12; x++)
        for (let z = -3; z < 12; z++) for (let y = 11; y < 30; y++) w.setBlock(x, y, z, BLOCK.AIR);
      expect(plants.buildTree(4, 11, 4, kind), kind).toBe(true);
      expect(w.getBlock(4, 11, 4), kind).toBe(log);
      let leaves = 0;
      for (let x = -3; x < 12; x++)
        for (let z = -3; z < 12; z++)
          for (let y = 11; y < 30; y++) if (w.getBlock(x, y, z) === leaf) leaves++;
      expect(leaves, kind).toBeGreaterThan(8);
      if (kind === 'dark_oak') expect(w.getBlock(5, 11, 5)).toBe(log);
    }
  });
  it('bone meal grows a birch sapling on the spot', () => {
    const { sim, w } = setup();
    w.setBlock(4, 11, 4, BLOCK_H.BIRCH_SAPLING);
    lookAt(sim, 4, 11, 4, -0.9);
    let grown = false;
    for (let i = 0; i < 40 && !grown; i++) {
      hold(sim, 'lab:bone_meal', 1);
      sim.use();
      grown = w.getBlock(4, 11, 4) === BLOCK.BIRCH;
    }
    expect(grown).toBe(true);
  });
});

describe('round H · ladders, trapdoors, gates and cake', () => {
  it('hangs a ladder on a wall and drops it when the wall goes', () => {
    const { sim, w } = setup();
    for (let y = 11; y <= 14; y++) w.setBlock(4, y, 3, BLOCK.STONE);
    hold(sim, 'lab:ladder', 4);
    sim.player.position = { x: 4.5, y: 11, z: 6.5 };
    const placed = sim.placeBlock({
      x: 4,
      y: 11,
      z: 3,
      state: BLOCK.STONE,
      normal: { x: 0, y: 0, z: 1 },
      distance: 2,
    });
    expect(placed.ok, placed.reason).toBe(true);
    const ladder = w.getBlock(4, 11, 4);
    expect(registry.get(ladder).climbable).toBe(true);
    // No ladder on the floor: it needs a wall behind it.
    const floor = sim.placeBlock({
      x: 8,
      y: 10,
      z: 8,
      state: BLOCK.GRASS,
      normal: { x: 0, y: 1, z: 0 },
      distance: 2,
    });
    expect(floor.ok).toBe(false);
    expect(sim.breakBlock(4, 11, 3)).toBe(true);
    expect(w.getBlock(4, 11, 4)).toBe(BLOCK.AIR);
    expect(dropped(sim, 'lab:ladder')).toBe(1);
  });
  it('climbs a ladder while walking into it and slides down slowly without fall damage', () => {
    const { sim, w } = setup();
    for (let y = 11; y <= 20; y++) {
      w.setBlock(4, y, 3, BLOCK.STONE);
      w.setBlock(4, y, 4, BLOCK_H.LADDER);
    }
    sim.player.position = { x: 4.5, y: 11, z: 4.5 };
    sim.player.velocity = { x: 0, y: 0, z: 0 };
    sim.setInput({ ...sim.input, yaw: 0, pitch: 0, forward: 1, strafe: 0 });
    for (let i = 0; i < 40; i++) sim.step();
    const top = sim.player.position.y;
    expect(top).toBeGreaterThan(14);
    const health = sim.survival.health;
    sim.setInput({ ...sim.input, forward: 0 });
    let fastest = 0;
    for (let i = 0; i < 120; i++) {
      sim.step();
      fastest = Math.min(fastest, sim.player.velocity.y);
    }
    expect(sim.player.position.y).toBeLessThan(11.2);
    expect(fastest).toBeGreaterThanOrEqual(-3.01);
    expect(sim.survival.health).toBe(health);
  });
  it('opens and shuts a trapdoor and a fence gate by hand', () => {
    const { sim, w } = setup();
    w.setBlock(4, 11, 4, BLOCK_H.OAK_TRAPDOOR);
    // From a little further, so the ray meets both the shut lid and the open one.
    lookAt(sim, 4, 11, 4, -0.6, 2.5);
    sim.inventory.set(sim.selected, null);
    expect(sim.use().ok).toBe(true);
    expect(w.getBlock(4, 11, 4)).toBe(BLOCK_H.OAK_TRAPDOOR + 4);
    expect(sim.use().ok).toBe(true);
    expect(w.getBlock(4, 11, 4)).toBe(BLOCK_H.OAK_TRAPDOOR);
    w.setBlock(4, 11, 4, BLOCK_H.OAK_FENCE_GATE);
    lookAt(sim, 4, 11, 4, -0.54, 2.5);
    expect(sim.use().ok).toBe(true);
    expect(w.getBlock(4, 11, 4)).toBe(BLOCK_H.OAK_FENCE_GATE + 4);
  });
  it('eats a cake slice by slice, two food points each', () => {
    const { sim, w } = setup();
    w.setBlock(4, 11, 4, BLOCK_H.CAKE);
    lookAt(sim, 4, 11, 4, -0.8);
    sim.inventory.set(sim.selected, null);
    sim.survival.food = 6;
    expect(sim.use().ok).toBe(true);
    expect(sim.survival.food).toBe(8);
    expect(w.getBlock(4, 11, 4)).toBe(BLOCK_H.CAKE + 1);
    sim.survival.food = 0;
    // The cake loses slices from its west side: aim at what is left of it.
    lookAt(sim, 4, 11, 4, -0.8, 1.55, 0.85);
    for (let i = 0; i < 6; i++) expect(sim.use().ok, `slice ${i + 2}`).toBe(true);
    expect(w.getBlock(4, 11, 4)).toBe(BLOCK.AIR);
  });
  it('the compass and the clock tell the way home and the hour', () => {
    const { sim } = setup();
    hold(sim, 'lab:compass');
    expect(sim.use().ok).toBe(true);
    hold(sim, 'lab:clock');
    const clock = sim.use();
    expect(clock.ok).toBe(true);
    expect(clock.message).toMatch(/\d/);
  });
});

describe('round H · items and recipes', () => {
  it('coloured sheep give wool of their colour, white keeps the old key', () => {
    expect(woolItem(0)).toBe('lab:wool');
    expect(woolItem(1)).toBe('lab:black_wool');
    expect(woolItem(3)).toBe('lab:light_gray_wool');
    for (let v = 0; v < 6; v++) expect(itemRegistry.find(woolItem(v))).toBeDefined();
  });
  it('every recipe names real items, and the cake gives the buckets back', () => {
    const known = (key: string) => key.startsWith('#') || itemRegistry.find(key) !== undefined;
    for (const recipe of RECIPES) {
      expect(known(recipe.result[0]), recipe.id).toBe(true);
      const parts = recipe.kind === 'shaped' ? Object.values(recipe.key) : recipe.ingredients;
      for (const part of parts) expect(known(part), `${recipe.id}: ${part}`).toBe(true);
    }
    for (const recipe of SMELTING) {
      expect(known(recipe.input), recipe.id).toBe(true);
      expect(known(recipe.result[0]), recipe.id).toBe(true);
    }
    expect(recipeById('cake')?.remainder?.swap['lab:milk_bucket']).toBe('lab:bucket');
  });
  it('every new item can be crafted, smelted or found, and sits in a creative tab', () => {
    const made = new Set([
      ...RECIPES.map((recipe) => recipe.result[0]),
      ...SMELTING.map((recipe) => recipe.result[0]),
    ]);
    // Found in the world, dropped by blocks and mobs, fished or traded, as in the reference.
    const found = new Set([
      'lab:emerald',
      'lab:emerald_ore',
      'lab:clay_ball',
      'lab:glowstone_dust',
      'lab:potato',
      'lab:poisonous_potato',
      'lab:beetroot',
      'lab:beetroot_seeds',
      'lab:melon_slice',
      'lab:cookie',
      'lab:fish',
      'lab:salmon',
      'lab:chainmail_helmet',
      'lab:chainmail_chestplate',
      'lab:chainmail_leggings',
      'lab:chainmail_boots',
      'lab:gray_wool',
      'lab:brown_wool',
      'lab:black_wool',
      'lab:spruce_sapling',
      'lab:birch_sapling',
      'lab:jungle_sapling',
      'lab:acacia_sapling',
      'lab:dark_oak_sapling',
    ]);
    const missing: string[] = [];
    for (const item of ITEMS) {
      if (item.id < 244) continue;
      if (!made.has(item.key) && !found.has(item.key)) missing.push(item.key);
      expect(creativeTab(item), item.key).not.toBeNull();
    }
    expect(missing).toEqual([]);
  });
});
