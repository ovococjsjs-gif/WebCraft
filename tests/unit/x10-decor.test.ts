import { describe, expect, it } from 'vitest';
import { BLOCK, BLOCK_I, blockBoxes, registry } from '../../packages/content/src/blocks';
import { itemRegistry } from '../../packages/content/src/items';
import { creativeTab } from '../../packages/content/src/creative';
import {
  EXTRA_TILE_BASE,
  I_TILE_NAMES,
  NEW_TERRACOTTA,
  TILE,
  WOOL_COLORS,
} from '../../packages/content/src/tiles';
import { extraTilePixels } from '../../packages/renderer/src/block-art';
import { GLAZE_MOTIFS, I_PAINTERS } from '../../packages/renderer/src/block-art-i';
import { RECIPES, SMELTING, findRecipe, recipeById } from '../../packages/core/src/crafting';
import { WorldSession } from '../../packages/core/src/session';
import type { Slot } from '../../packages/core/src/inventory';
import { MAX_HEALTH } from '../../packages/core/src/survival';
import { defaultClient, sealWorld } from '../../packages/storage/src/format';

const COLORS = WOOL_COLORS.map(([key]) => key);
const paint = (name: string) =>
  (I_PAINTERS as Record<string, () => { data: Uint8ClampedArray }>)[name]().data;
const stack = (item: string, count = 1): Slot => ({ item, count });

describe('x10 round I · the colour families', () => {
  it('has sixteen of each family, keyed by colour', () => {
    for (const family of [
      BLOCK_I.CONCRETE,
      BLOCK_I.CONCRETE_POWDER,
      BLOCK_I.STAINED_GLASS,
      BLOCK_I.STAINED_GLASS_PANE,
      BLOCK_I.GLAZED_TERRACOTTA,
    ])
      expect(new Set(family).size).toBe(16);
    expect(BLOCK_I.TERRACOTTA.length).toBe(NEW_TERRACOTTA.length);
    COLORS.forEach((color, i) => {
      expect(registry.get(BLOCK_I.CONCRETE[i]).key).toBe(`lab:${color}_concrete`);
      expect(registry.get(BLOCK_I.CONCRETE_POWDER[i]).key).toBe(`lab:${color}_concrete_powder`);
      expect(registry.get(BLOCK_I.STAINED_GLASS[i]).key).toBe(`lab:${color}_stained_glass`);
      expect(registry.get(BLOCK_I.STAINED_GLASS_PANE[i]).key).toBe(
        `lab:${color}_stained_glass_pane`,
      );
      expect(registry.get(BLOCK_I.GLAZED_TERRACOTTA[i]).key).toBe(`lab:${color}_glazed_terracotta`);
      // All sixteen terracottas exist: the mesa ones kept their keys, the rest are new.
      expect(
        registry.find(color === 'white' ? 'lab:terracotta_white' : `lab:terracotta_${color}`),
      ).toBeDefined();
    });
  });

  it('gives every placeable block of the round an item, and a creative tab', () => {
    for (const def of registry.list()) {
      if (def.id < BLOCK_I.CONCRETE[0] || def.placeable === false) continue;
      const item = itemRegistry.find(def.key);
      expect(item, def.key).toBeDefined();
      expect(item?.block).toBe(def.id);
      expect(creativeTab(item!), def.key).not.toBeNull();
    }
    expect(creativeTab(itemRegistry.find('lab:red_stained_glass')!)).toBe('decoration');
    expect(creativeTab(itemRegistry.find('lab:red_stained_glass_pane')!)).toBe('decoration');
    expect(creativeTab(itemRegistry.find('lab:red_concrete')!)).toBe('building');
    expect(creativeTab(itemRegistry.find('lab:sea_lantern')!)).toBe('decoration');
  });

  it('makes powder fall and set into the concrete of its own colour', () => {
    COLORS.forEach((color, i) => {
      const powder = registry.get(BLOCK_I.CONCRETE_POWDER[i]);
      expect(powder.falling).toBe(true);
      expect(powder.hardensTo).toBe(BLOCK_I.CONCRETE[i]);
      const concrete = registry.get(BLOCK_I.CONCRETE[i]);
      expect(concrete.falling).toBeUndefined();
      expect(concrete.solid && concrete.occludes).toBe(true);
      expect(concrete.tool).toBe('pickaxe');
      expect(powder.tool).toBe('shovel');
      expect(color.length).toBeGreaterThan(2);
    });
  });

  it('draws stained glass translucent and joins panes to every glass', () => {
    for (const id of BLOCK_I.STAINED_GLASS) {
      const def = registry.get(id);
      expect(def.layer).toBe('transparent');
      expect(def.occludes).toBe(false);
      expect(def.flatShade).toBe(true);
    }
    const pane = BLOCK_I.STAINED_GLASS_PANE[0];
    const render = (near: (x: number) => number) =>
      blockBoxes(pane, (x) => near(x), 0, 0, 0, 'render');
    // A lone pane is a cross; beside a stained glass it is a post and one arm that reaches it.
    expect(render(() => BLOCK.AIR).length).toBe(5);
    const east = render((x) => (x === 1 ? BLOCK_I.STAINED_GLASS[5] : BLOCK.AIR));
    expect(east.length).toBe(2);
    expect(Math.max(...east.map((box) => box[3]))).toBe(1);
    // Between plain glass and stained glass it runs across both ways.
    const both = render((x) =>
      x === 1 ? BLOCK_I.STAINED_GLASS[5] : x === -1 ? BLOCK.GLASS : BLOCK.AIR,
    );
    expect(both.length).toBe(3);
    expect(Math.min(...both.map((box) => box[0]))).toBe(0);
    expect(Math.max(...both.map((box) => box[3]))).toBe(1);
  });
});

describe('x10 round I · tile art', () => {
  it('paints every new tile, inside the atlas band before the second sprite run', () => {
    expect(I_TILE_NAMES.length).toBeGreaterThanOrEqual(100);
    const seen = new Set<number>();
    for (const name of I_TILE_NAMES) {
      const tile = (TILE as Record<string, number>)[name];
      expect(tile, name).toBeGreaterThanOrEqual(EXTRA_TILE_BASE);
      expect(tile, name).toBeLessThan(768);
      expect(seen.has(tile), name).toBe(false);
      seen.add(tile);
      const pixels = extraTilePixels(tile);
      expect(pixels, name).not.toBeNull();
      expect(pixels!.length).toBe(16 * 16 * 4);
      let opaque = 0;
      for (let i = 3; i < pixels!.length; i += 4) if (pixels![i] > 0) opaque++;
      expect(opaque, name).toBeGreaterThan(40);
      expect(I_PAINTERS[name]().data).toEqual(pixels);
    }
  });

  it('keeps concrete flat, powder grainy and every glazed pattern different', () => {
    const colours = (name: string) => {
      const data = paint(name);
      const set = new Set<number>();
      for (let i = 0; i < data.length; i += 4)
        set.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      return set.size;
    };
    for (const color of COLORS) {
      expect(colours(`concrete_${color}`)).toBeLessThanOrEqual(3);
      expect(colours(`concrete_powder_${color}`)).toBeGreaterThan(8);
    }
    const hashes = new Set(COLORS.map((color) => Array.from(paint(`glazed_${color}`)).join(',')));
    expect(hashes.size).toBe(16);
    expect(GLAZE_MOTIFS.length).toBe(16);
    // A motif uses at least three of the four glaze tones, so none is a plain slab.
    for (let m = 0; m < GLAZE_MOTIFS.length; m++) {
      const tones = new Set<number>();
      for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) tones.add(GLAZE_MOTIFS[m].at(a, b));
      expect(tones.size, `motif ${m}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('paints stained glass with a see-through middle and an almost solid rim', () => {
    for (const color of COLORS) {
      const data = paint(`stained_glass_${color}`);
      const alpha = (x: number, y: number) => data[(y * 16 + x) * 4 + 3];
      expect(alpha(8, 8)).toBeGreaterThan(100);
      expect(alpha(8, 8)).toBeLessThan(200);
      expect(alpha(0, 8)).toBeGreaterThan(220);
    }
  });
});

describe('x10 round I · recipes', () => {
  it('refers only to items that exist', () => {
    const round = RECIPES.filter((recipe) =>
      /concrete|stained_glass|terracotta|polished|prismarine|sea_lantern|sponge|slime|bone_block|wart|door|trapdoor|gate|dye_(gray|brown|black)|rabbit|leather_from/.test(
        recipe.id,
      ),
    );
    expect(round.length).toBeGreaterThan(90);
    for (const recipe of round) {
      expect(itemRegistry.find(recipe.result[0]), recipe.id).toBeDefined();
      const ingredients =
        recipe.kind === 'shaped' ? Object.values(recipe.key) : [...recipe.ingredients];
      for (const item of ingredients)
        expect(
          item.startsWith('#') || itemRegistry.find(item),
          `${recipe.id}: ${item}`,
        ).toBeTruthy();
    }
    for (const recipe of SMELTING) {
      expect(itemRegistry.find(recipe.input), recipe.id).toBeDefined();
      expect(itemRegistry.find(recipe.result[0]), recipe.id).toBeDefined();
    }
  });

  it('crafts concrete powder from sand, gravel and a dye, eight at a time', () => {
    const grid: Slot[] = [
      ...Array.from({ length: 4 }, () => stack('lab:sand')),
      ...Array.from({ length: 4 }, () => stack('lab:gravel')),
      stack('lab:red_dye'),
    ];
    const recipe = findRecipe(grid, 3);
    expect(recipe?.result).toEqual(['lab:red_concrete_powder', 8]);
    grid[8] = stack('lab:bone_meal');
    expect(findRecipe(grid, 3)?.result).toEqual(['lab:white_concrete_powder', 8]);
    grid[8] = stack('lab:lapis');
    expect(findRecipe(grid, 3)?.result).toEqual(['lab:blue_concrete_powder', 8]);
  });

  it('dyes glass and terracotta around a dye, and cuts panes from the glass', () => {
    const ring = (centre: string, material: string): Slot[] =>
      Array.from({ length: 9 }, (_, i) => stack(i === 4 ? centre : material));
    expect(findRecipe(ring('lab:green_dye', 'lab:glass'), 3)?.result).toEqual([
      'lab:green_stained_glass',
      8,
    ]);
    expect(findRecipe(ring('lab:black_dye', 'lab:terracotta'), 3)?.result).toEqual([
      'lab:terracotta_black',
      8,
    ]);
    expect(findRecipe(ring('lab:orange_dye', 'lab:terracotta'), 3)?.result).toEqual([
      'lab:terracotta_orange',
      8,
    ]);
    const panes = [...Array.from({ length: 6 }, () => stack('lab:cyan_stained_glass'))];
    expect(findRecipe(panes, 3)?.result).toEqual(['lab:cyan_stained_glass_pane', 16]);
  });

  it('glazes every terracotta colour in the furnace', () => {
    for (const color of COLORS) {
      const recipe = SMELTING.find((entry) => entry.input === `lab:terracotta_${color}`);
      expect(recipe?.result, color).toEqual([`lab:${color}_glazed_terracotta`, 1]);
    }
    expect(SMELTING.find((entry) => entry.input === 'lab:wet_sponge')?.result[0]).toBe(
      'lab:sponge',
    );
  });

  it('mixes the dyes round H left out and makes rabbit food', () => {
    expect(findRecipe([stack('lab:black_dye'), stack('lab:bone_meal')], 2)?.result).toEqual([
      'lab:gray_dye',
      2,
    ]);
    expect(findRecipe([stack('lab:red_dye'), stack('lab:green_dye')], 2)?.result).toEqual([
      'lab:brown_dye',
      2,
    ]);
    expect(findRecipe([stack('lab:ink_sac')], 2)?.result).toEqual(['lab:black_dye', 1]);
    expect(SMELTING.find((entry) => entry.input === 'lab:raw_rabbit')?.result).toEqual([
      'lab:cooked_rabbit',
      1,
    ]);
    expect(recipeById('birch_door')?.result).toEqual(['lab:birch_door', 3]);
    expect(recipeById('jungle_trapdoor')?.result).toEqual(['lab:jungle_trapdoor', 2]);
    expect(recipeById('dark_oak_fence_gate')?.result).toEqual(['lab:dark_oak_fence_gate', 1]);
  });
});

function session(): WorldSession {
  const world = new WorldSession('x10-decor', 'flat');
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) world.loadColumn(x, z);
  return world;
}
function put(world: WorldSession, x: number, y: number, z: number, state: number): void {
  world.simulation.setBlockState(x, y, z, state);
}
function run(world: WorldSession, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    world.world.tick++;
    world.simulation['tickWorldSystems']();
  }
}

describe('x10 round I · in the world', () => {
  it('sets powder into concrete when a neighbouring water source appears', () => {
    const world = session();
    const y = 20;
    put(world, 0, y - 1, 0, BLOCK.STONE);
    put(world, 0, y, 0, BLOCK_I.CONCRETE_POWDER[14]);
    run(world, 10);
    expect(world.world.getBlock(0, y, 0)).toBe(BLOCK_I.CONCRETE_POWDER[14]);
    put(world, 1, y, 0, BLOCK.WATER);
    run(world, 2);
    expect(world.world.getBlock(0, y, 0)).toBe(BLOCK_I.CONCRETE[14]);
  });

  it('sets powder placed beside water at once, and leaves dry powder alone', () => {
    const world = session();
    const y = 20;
    put(world, 5, y - 1, 5, BLOCK.STONE);
    put(world, 5, y, 6, BLOCK.WATER);
    put(world, 5, y, 5, BLOCK_I.CONCRETE_POWDER[1]);
    expect(world.world.getBlock(5, y, 5)).toBe(BLOCK_I.CONCRETE[1]);
    put(world, -6, y - 1, -6, BLOCK.STONE);
    put(world, -6, y, -6, BLOCK_I.CONCRETE_POWDER[2]);
    run(world, 30);
    expect(world.world.getBlock(-6, y, -6)).toBe(BLOCK_I.CONCRETE_POWDER[2]);
  });

  it('lets powder fall like sand until it lands on the ground', () => {
    const world = session();
    let ground = 40;
    while (registry.get(world.world.getBlock(8, ground, 8)).solid === false) ground--;
    put(world, 8, ground + 11, 8, BLOCK.STONE);
    put(world, 8, ground + 12, 8, BLOCK_I.CONCRETE_POWDER[0]);
    run(world, 5);
    expect(world.world.getBlock(8, ground + 12, 8)).toBe(BLOCK_I.CONCRETE_POWDER[0]);
    put(world, 8, ground + 11, 8, BLOCK.AIR);
    run(world, 1);
    expect(world.simulation.blockSim.fallingCount).toBe(1);
    run(world, 120);
    expect(world.world.getBlock(8, ground + 1, 8)).toBe(BLOCK_I.CONCRETE_POWDER[0]);
    expect(world.world.getBlock(8, ground + 12, 8)).toBe(BLOCK.AIR);
    expect(world.simulation.blockSim.fallingCount).toBe(0);
  });

  it('lets a sponge drink the water around it, and turn wet', () => {
    const world = session();
    const y = 20;
    for (let x = 10; x <= 14; x++)
      for (let z = 10; z <= 14; z++) {
        put(world, x, y - 1, z, BLOCK.STONE);
        put(world, x, y, z, BLOCK.WATER);
      }
    put(world, 12, y, 12, BLOCK_I.SPONGE);
    expect(world.world.getBlock(12, y, 12)).toBe(BLOCK_I.WET_SPONGE);
    // Every water cell within reach is gone, including the far corners.
    expect(world.world.getBlock(11, y, 12)).toBe(BLOCK.AIR);
    expect(world.world.getBlock(10, y, 10)).toBe(BLOCK.AIR);
    // A sponge with no water near it stays dry.
    put(world, -12, y - 1, -12, BLOCK.STONE);
    put(world, -12, y, -12, BLOCK_I.SPONGE);
    expect(world.world.getBlock(-12, y, -12)).toBe(BLOCK_I.SPONGE);
  });

  it('throws a falling body back up off slime without a scratch, unless it crouches', () => {
    for (const crouch of [false, true]) {
      const world = session();
      const sim = world.simulation;
      for (let i = 0; i < 5; i++) sim.step();
      const ground = Math.floor(sim.player.position.y);
      const px = Math.floor(sim.player.position.x),
        pz = Math.floor(sim.player.position.z);
      for (let x = px - 2; x <= px + 2; x++)
        for (let z = pz - 2; z <= pz + 2; z++) {
          world.world.setBlock(x, ground - 1, z, BLOCK_I.SLIME_BLOCK);
          for (let y = ground; y <= ground + 16; y++) world.world.setBlock(x, y, z, BLOCK.AIR);
        }
      sim.player.position.y = ground + 12;
      sim.player.velocity.y = 0;
      sim.player.onGround = false;
      sim.setInput({ forward: 0, strafe: 0, jump: false, crouch, sprint: false, yaw: 0, pitch: 0 });
      let bounced = false,
        thrown = 0,
        guard = 0;
      while (guard++ < 200 && !(sim.player.onGround && guard > 5)) {
        sim.step();
        if (sim.body.bounced && !bounced) {
          bounced = true;
          thrown = sim.player.velocity.y;
        }
      }
      if (crouch) {
        // Crouching on slime is a plain landing: no bounce, and the fall hurts as usual.
        expect(bounced).toBe(false);
        expect(sim.survival.health).toBeLessThan(MAX_HEALTH);
      } else {
        expect(bounced).toBe(true);
        expect(sim.survival.health).toBe(MAX_HEALTH);
        expect(thrown).toBeGreaterThan(5);
      }
    }
  });

  it('still saves a world after the body has been simulated (the player record is exact)', () => {
    const world = session();
    const sim = world.simulation;
    for (let i = 0; i < 12; i++) sim.step();
    expect(Object.keys(sim.player).sort()).toEqual([
      'flying',
      'inWater',
      'onGround',
      'position',
      'velocity',
    ]);
    put(world, 4, 20, 4, BLOCK_I.SLIME_BLOCK);
    put(world, 5, 20, 4, BLOCK_I.RED_SANDSTONE);
    const file = sealWorld({
      name: 'Round I',
      createdAt: 1,
      savedAt: 2,
      core: world.checkpoint(),
      client: defaultClient(),
    });
    expect(file).toBeTruthy();
    expect(JSON.stringify(file)).toContain('lab:slime_block');
  });

  it('keeps a sea lantern shining at full strength', () => {
    expect(registry.get(BLOCK_I.SEA_LANTERN).light).toBe(15);
  });
});
