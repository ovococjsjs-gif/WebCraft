import { itemRegistry } from '../../content/src/items';
import { BLOCK } from '../../content/src/blocks';
import { hash3, seedHash } from './random';
import { stack, type ItemStack } from './inventory';
import type { ContainerStore } from './containers';
import type { ChunkColumn, VoxelWorld } from './world';

/** One line of a loot table: an item, its weight, and how many of it a draw gives. */
type Entry = readonly [item: string, weight: number, min: number, max: number];
interface Table {
  /** How many draws a chest gets: between `rolls[0]` and `rolls[1]`. */
  readonly rolls: readonly [number, number];
  readonly entries: readonly Entry[];
}
/**
 * Loot tables after the reference's, limited to the items this game has. A chest's contents
 * are drawn from its position and the world seed, so they never change between loads.
 */
const TABLES: Record<string, Table> = {
  dungeon: {
    rolls: [4, 8],
    entries: [
      ['lab:bone', 10, 1, 8],
      ['lab:rotten_flesh', 10, 1, 8],
      ['lab:gunpowder', 10, 1, 8],
      ['lab:string', 10, 1, 8],
      ['lab:bread', 15, 1, 1],
      ['lab:wheat', 10, 1, 4],
      ['lab:iron_ingot', 10, 1, 4],
      ['lab:gold_ingot', 5, 1, 4],
      ['lab:redstone', 5, 1, 4],
      ['lab:bucket', 10, 1, 1],
      ['lab:golden_apple', 3, 1, 1],
      ['lab:book', 6, 1, 1],
      ['lab:potion_healing', 2, 1, 1],
      ['lab:diamond', 1, 1, 1],
    ],
  },
  mineshaft: {
    rolls: [3, 6],
    entries: [
      ['lab:rail', 20, 4, 8],
      ['lab:torch', 15, 1, 16],
      ['lab:bread', 15, 1, 3],
      ['lab:coal', 10, 3, 8],
      ['lab:iron_ingot', 10, 1, 5],
      ['lab:gold_ingot', 5, 1, 3],
      ['lab:redstone', 5, 4, 9],
      ['lab:lapis', 5, 4, 9],
      ['lab:seeds', 10, 2, 4],
      ['lab:powered_rail', 5, 1, 4],
      ['lab:diamond', 3, 1, 2],
      ['lab:golden_apple', 1, 1, 1],
      ['lab:iron_pickaxe', 1, 1, 1],
    ],
  },
  village_smith: {
    rolls: [3, 8],
    entries: [
      ['lab:iron_ingot', 10, 1, 5],
      ['lab:bread', 15, 1, 3],
      ['lab:apple', 15, 1, 3],
      ['lab:iron_pickaxe', 5, 1, 1],
      ['lab:iron_sword', 5, 1, 1],
      ['lab:iron_chestplate', 5, 1, 1],
      ['lab:iron_helmet', 5, 1, 1],
      ['lab:iron_leggings', 5, 1, 1],
      ['lab:iron_boots', 5, 1, 1],
      ['lab:obsidian', 5, 3, 7],
      ['lab:oak_sapling', 5, 3, 7],
      ['lab:gold_ingot', 5, 1, 3],
      ['lab:diamond', 3, 1, 3],
    ],
  },
  village_house: {
    rolls: [2, 5],
    entries: [
      ['lab:bread', 15, 1, 4],
      ['lab:apple', 15, 1, 3],
      ['lab:wheat', 10, 2, 6],
      ['lab:seeds', 10, 2, 6],
      ['lab:carrot', 8, 1, 4],
      ['lab:torch', 8, 2, 6],
      ['lab:paper', 5, 1, 3],
      ['lab:book', 3, 1, 1],
      ['lab:feather', 5, 1, 3],
      ['lab:leather', 5, 1, 3],
      ['lab:iron_ingot', 3, 1, 2],
    ],
  },
  desert_temple: {
    rolls: [2, 5],
    entries: [
      ['lab:bone', 25, 4, 6],
      ['lab:rotten_flesh', 25, 3, 7],
      ['lab:spider_eye', 25, 1, 3],
      ['lab:gold_ingot', 15, 2, 7],
      ['lab:iron_ingot', 15, 1, 5],
      ['lab:diamond', 5, 1, 3],
      ['lab:golden_apple', 5, 1, 1],
      ['lab:book', 10, 1, 1],
      ['lab:ender_pearl', 3, 1, 1],
    ],
  },
  jungle_temple: {
    rolls: [2, 6],
    entries: [
      ['lab:bone', 20, 4, 6],
      ['lab:rotten_flesh', 16, 3, 7],
      ['lab:gold_ingot', 15, 2, 7],
      ['lab:iron_ingot', 15, 1, 5],
      ['lab:diamond', 3, 1, 3],
      ['lab:book', 5, 1, 1],
      ['lab:arrow', 10, 4, 12],
      ['lab:bow', 3, 1, 1],
    ],
  },
  igloo: {
    rolls: [2, 5],
    entries: [
      ['lab:apple', 15, 1, 3],
      ['lab:coal', 15, 1, 4],
      ['lab:gold_ingot', 10, 1, 3],
      ['lab:stone_axe', 2, 1, 1],
      ['lab:rotten_flesh', 10, 1, 1],
      ['lab:wheat', 10, 2, 3],
      ['lab:golden_apple', 1, 1, 1],
    ],
  },
  witch_hut: {
    rolls: [2, 4],
    entries: [
      ['lab:potion_healing', 10, 1, 1],
      ['lab:potion_swiftness', 8, 1, 1],
      ['lab:potion_fire_resistance', 6, 1, 1],
      ['lab:potion_poison', 8, 1, 1],
      ['lab:spider_eye', 10, 1, 3],
      ['lab:sugar', 10, 1, 4],
      ['lab:redstone', 10, 2, 6],
      ['lab:glowstone', 4, 1, 2],
      ['lab:nether_wart', 5, 1, 3],
    ],
  },
  stronghold_corridor: {
    rolls: [2, 4],
    entries: [
      ['lab:ender_pearl', 10, 1, 1],
      ['lab:diamond', 3, 1, 3],
      ['lab:iron_ingot', 10, 1, 5],
      ['lab:gold_ingot', 5, 1, 3],
      ['lab:redstone', 5, 4, 9],
      ['lab:bread', 15, 1, 3],
      ['lab:apple', 15, 1, 3],
      ['lab:iron_pickaxe', 5, 1, 1],
      ['lab:iron_sword', 5, 1, 1],
      ['lab:iron_chestplate', 5, 1, 1],
      ['lab:golden_apple', 1, 1, 1],
    ],
  },
  stronghold_crossing: {
    rolls: [1, 4],
    entries: [
      ['lab:iron_ingot', 10, 1, 5],
      ['lab:gold_ingot', 5, 1, 3],
      ['lab:redstone', 5, 4, 9],
      ['lab:coal', 10, 3, 8],
      ['lab:bread', 15, 1, 3],
      ['lab:apple', 15, 1, 3],
      ['lab:iron_pickaxe', 1, 1, 1],
    ],
  },
  stronghold_library: {
    rolls: [2, 10],
    entries: [
      ['lab:book', 20, 1, 3],
      ['lab:paper', 20, 2, 7],
      ['lab:eye_of_ender', 3, 1, 1],
      ['lab:ender_pearl', 5, 1, 1],
    ],
  },
};

function draw(table: Table, roll: (salt: number) => number): ItemStack[] {
  const [lo, hi] = table.rolls;
  const count = lo + Math.floor(roll(1) * (hi - lo + 1));
  const total = table.entries.reduce((a, e) => a + e[1], 0);
  const out: ItemStack[] = [];
  for (let i = 0; i < count; i++) {
    let pick = roll(100 + i * 3) * total;
    const entry = table.entries.find((e) => (pick -= e[1]) < 0) ?? table.entries[0];
    const [item, , min, max] = entry;
    const limit = itemRegistry.find(item)?.maxStack ?? 1;
    const n = Math.min(limit, min + Math.floor(roll(101 + i * 3) * (max - min + 1)));
    const same = out.findIndex((s) => s.item === item && s.count + n <= limit);
    if (same >= 0) out[same] = stack(item, out[same].count + n);
    else out.push(stack(item, n));
  }
  return out;
}

/** Coordinate-owned loot. Opening, chunk eviction or a save reload can never reroll a chest. */
export function structureLoot(
  seed: string,
  x: number,
  y: number,
  z: number,
  kind?: string,
): ItemStack[] {
  const h = seedHash(seed),
    roll = (salt: number) => hash3(x, y, z, h + salt);
  const table = kind ? TABLES[kind] : undefined;
  if (table) return draw(table, (salt) => roll(700 + salt));
  // The chests of the generators before v5 keep their original contents.
  const loot: ItemStack[] = [
    stack('lab:bread', 2 + Math.floor(roll(501) * 4)),
    stack('lab:iron_ingot', 1 + Math.floor(roll(509) * 4)),
    stack('lab:coal', 3 + Math.floor(roll(521) * 6)),
  ];
  const rare = ['lab:book', 'lab:lapis', 'lab:gold_ingot', 'lab:bow', 'lab:diamond'] as const;
  const item = rare[Math.min(rare.length - 1, Math.floor(roll(523) * rare.length))];
  loot.push(stack(item, item === 'lab:lapis' ? 3 : 1));
  if (roll(541) > 0.45) loot.push(stack('lab:arrow', 4 + Math.floor(roll(547) * 9)));
  return loot;
}
export const LOOT_TABLES: readonly string[] = Object.keys(TABLES);

export function populateStructureLoot(
  world: VoxelWorld,
  column: ChunkColumn,
  containers: ContainerStore,
  overridden: (x: number, y: number, z: number) => boolean,
): number {
  let count = 0;
  for (const index of column.chests) {
    const x = column.cx * 16 + (index & 15),
      y = index >> 8,
      z = column.cz * 16 + ((index >> 4) & 15);
    if (world.getBlock(x, y, z) !== BLOCK.CHEST || overridden(x, y, z) || containers.get(x, y, z))
      continue;
    const chest = containers.ensure('chest', x, y, z);
    (world.dimensionID === 'end'
      ? [stack('lab:elytra'), stack('lab:diamond', 3), stack('lab:gold_ingot', 8)]
      : structureLoot(world.seed, x, y, z, column.chestLoot?.get(index))
    ).forEach((item, slot) => chest.slots.set(slot, item));
    count++;
  }
  return count;
}
