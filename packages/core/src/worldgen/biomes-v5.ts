/**
 * Biomes of the v5 generator, modelled on the 1.12 set: the same families, the same base
 * height and variation that drive the density terrain, the same temperatures that decide snow,
 * and a per-biome decoration budget in the reference's "per chunk" units.
 */
import { BLOCK, BLOCK_X } from '../../../content/src/blocks';

export type TreeKind =
  | 'oak'
  | 'fancy_oak'
  | 'birch'
  | 'tall_birch'
  | 'spruce'
  | 'pine'
  | 'mega_spruce'
  | 'mega_pine'
  | 'jungle'
  | 'mega_jungle'
  | 'jungle_bush'
  | 'acacia'
  | 'dark_oak'
  | 'swamp_oak'
  | 'huge_brown_mushroom'
  | 'huge_red_mushroom';

export interface BiomeV5 {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  /** Base height and variation of the density terrain (the reference "depth" and "scale"). */
  readonly depth: number;
  readonly scale: number;
  readonly temperature: number;
  readonly rainfall: number;
  readonly top: number;
  readonly filler: number;
  readonly kind: 'ocean' | 'river' | 'beach' | 'land';
  /** Trees per chunk; the reference adds one more one time in ten. */
  readonly trees: number;
  readonly extraTreeChance: number;
  readonly treeKinds: readonly (readonly [TreeKind, number])[];
  readonly grass: number;
  readonly ferns: number;
  readonly flowers: number;
  readonly flowerKinds: readonly number[];
  readonly deadBushes: number;
  readonly cacti: number;
  readonly reeds: number;
  readonly mushrooms: number;
  readonly lilyPads: number;
  readonly clay: number;
  readonly sandPatches: number;
  readonly gravelPatches: number;
  readonly bigMushrooms: number;
  readonly boulders?: boolean;
  readonly pumpkins?: boolean;
  readonly melons?: boolean;
  /** Colours of grass and leaves in this climate, for the renderer's tint. */
  readonly grassColor: number;
  readonly foliageColor: number;
  /** The variant that small patches of this biome turn into ("hills"). */
  readonly hills?: string;
  /** Surface rule of the family, read by the surface builder. */
  readonly surface?:
    'mesa' | 'mesa_forest' | 'extreme_hills' | 'mega_taiga' | 'swamp' | 'savanna_mutated';
}

const DEFAULTS = {
  depth: 0.1,
  scale: 0.2,
  temperature: 0.5,
  rainfall: 0.5,
  top: BLOCK.GRASS as number,
  filler: BLOCK.DIRT as number,
  kind: 'land' as const,
  trees: 0,
  extraTreeChance: 0.1,
  treeKinds: [
    ['oak', 9],
    ['fancy_oak', 1],
  ] as readonly (readonly [TreeKind, number])[],
  grass: 1,
  ferns: 0,
  flowers: 2,
  flowerKinds: [BLOCK.FLOWER as number, BLOCK_X.POPPY],
  deadBushes: 0,
  cacti: 0,
  reeds: 0,
  mushrooms: 0,
  lilyPads: 0,
  clay: 1,
  sandPatches: 3,
  gravelPatches: 1,
  bigMushrooms: 0,
  grassColor: 0x91bd59,
  foliageColor: 0x77ab2f,
};
type Spec = Partial<Omit<BiomeV5, 'id' | 'key' | 'name'>>;
const list: BiomeV5[] = [];
function def(key: string, name: string, spec: Spec): number {
  const id = list.length;
  list.push(Object.freeze({ ...DEFAULTS, ...spec, id, key, name }));
  return id;
}
const oceanSpec: Spec = {
  depth: -1,
  scale: 0.1,
  kind: 'ocean',
  top: BLOCK.SAND,
  filler: BLOCK.SAND,
  flowers: 0,
  grass: 0,
  grassColor: 0x8eb971,
  foliageColor: 0x71a74d,
};
const forestTrees: readonly (readonly [TreeKind, number])[] = [
  ['oak', 36],
  ['fancy_oak', 4],
  ['birch', 10],
];
const taigaTrees: readonly (readonly [TreeKind, number])[] = [
  ['spruce', 2],
  ['pine', 1],
];
const hillsSpec: Spec = { depth: 0.45, scale: 0.3 };

export const B = {
  OCEAN: def('ocean', 'Океан', oceanSpec),
  DEEP_OCEAN: def('deep_ocean', 'Глубокий океан', {
    ...oceanSpec,
    depth: -1.8,
    top: BLOCK.GRAVEL,
    filler: BLOCK.GRAVEL,
  }),
  FROZEN_OCEAN: def('frozen_ocean', 'Замёрзший океан', { ...oceanSpec, temperature: 0 }),
  RIVER: def('river', 'Река', {
    depth: -0.5,
    scale: 0,
    kind: 'river',
    top: BLOCK.SAND,
    filler: BLOCK.SAND,
    flowers: 0,
    grass: 0,
    reeds: 4,
  }),
  FROZEN_RIVER: def('frozen_river', 'Замёрзшая река', {
    depth: -0.5,
    scale: 0,
    kind: 'river',
    temperature: 0,
    top: BLOCK.SAND,
    filler: BLOCK.SAND,
    flowers: 0,
    grass: 0,
    grassColor: 0x80b497,
    foliageColor: 0x60a17b,
  }),
  BEACH: def('beach', 'Пляж', {
    depth: 0,
    scale: 0.025,
    kind: 'beach',
    temperature: 0.8,
    rainfall: 0.4,
    top: BLOCK.SAND,
    filler: BLOCK.SAND,
    flowers: 0,
    grass: 0,
    reeds: 2,
  }),
  COLD_BEACH: def('cold_beach', 'Заснеженный пляж', {
    depth: 0,
    scale: 0.025,
    kind: 'beach',
    temperature: 0.05,
    rainfall: 0.3,
    top: BLOCK.SAND,
    filler: BLOCK.SAND,
    flowers: 0,
    grass: 0,
    grassColor: 0x80b497,
    foliageColor: 0x60a17b,
  }),
  STONE_BEACH: def('stone_beach', 'Каменистый берег', {
    depth: 0.1,
    scale: 0.8,
    kind: 'beach',
    temperature: 0.2,
    rainfall: 0.3,
    top: BLOCK.STONE,
    filler: BLOCK.STONE,
    flowers: 0,
    grass: 0,
    grassColor: 0x8ab689,
    foliageColor: 0x6da36b,
  }),
  PLAINS: def('plains', 'Равнины', {
    depth: 0.125,
    scale: 0.05,
    temperature: 0.8,
    rainfall: 0.4,
    trees: 0,
    extraTreeChance: 0.05,
    flowers: 4,
    grass: 10,
    flowerKinds: [BLOCK.FLOWER, BLOCK_X.POPPY, BLOCK.DAISY, BLOCK_X.RED_TULIP],
    pumpkins: true,
  }),
  DESERT: def('desert', 'Пустыня', {
    depth: 0.125,
    scale: 0.05,
    temperature: 2,
    rainfall: 0,
    top: BLOCK.SAND,
    filler: BLOCK.SAND,
    extraTreeChance: 0,
    flowers: 0,
    grass: 0,
    deadBushes: 2,
    reeds: 50,
    cacti: 10,
    clay: 0,
    grassColor: 0xbfb755,
    foliageColor: 0xaea42a,
    hills: 'desert_hills',
  }),
  DESERT_HILLS: def('desert_hills', 'Пустынные холмы', {
    ...hillsSpec,
    temperature: 2,
    rainfall: 0,
    top: BLOCK.SAND,
    filler: BLOCK.SAND,
    extraTreeChance: 0,
    flowers: 0,
    grass: 0,
    deadBushes: 2,
    reeds: 50,
    cacti: 10,
    clay: 0,
    grassColor: 0xbfb755,
    foliageColor: 0xaea42a,
  }),
  EXTREME_HILLS: def('extreme_hills', 'Горы', {
    depth: 1,
    scale: 0.5,
    temperature: 0.2,
    rainfall: 0.3,
    extraTreeChance: 0.3,
    treeKinds: [
      ['spruce', 2],
      ['oak', 1],
    ],
    surface: 'extreme_hills',
    grassColor: 0x8ab689,
    foliageColor: 0x6da36b,
    hills: 'extreme_hills_forest',
  }),
  EXTREME_HILLS_FOREST: def('extreme_hills_forest', 'Лесистые горы', {
    depth: 1,
    scale: 0.5,
    temperature: 0.2,
    rainfall: 0.3,
    trees: 3,
    treeKinds: [
      ['spruce', 2],
      ['oak', 1],
    ],
    surface: 'extreme_hills',
    grassColor: 0x8ab689,
    foliageColor: 0x6da36b,
  }),
  FOREST: def('forest', 'Лес', {
    temperature: 0.7,
    rainfall: 0.8,
    trees: 10,
    grass: 2,
    treeKinds: forestTrees,
    grassColor: 0x79c05a,
    foliageColor: 0x59ae30,
    hills: 'forest_hills',
  }),
  FOREST_HILLS: def('forest_hills', 'Лесистые холмы', {
    ...hillsSpec,
    temperature: 0.7,
    rainfall: 0.8,
    trees: 10,
    grass: 2,
    treeKinds: forestTrees,
    grassColor: 0x79c05a,
    foliageColor: 0x59ae30,
  }),
  FLOWER_FOREST: def('flower_forest', 'Цветочный лес', {
    temperature: 0.7,
    rainfall: 0.8,
    trees: 6,
    grass: 2,
    flowers: 60,
    flowerKinds: [
      BLOCK.FLOWER,
      BLOCK_X.POPPY,
      BLOCK_X.ALLIUM,
      BLOCK_X.RED_TULIP,
      BLOCK.DAISY,
      BLOCK_X.BLUE_ORCHID,
    ],
    treeKinds: forestTrees,
    grassColor: 0x79c05a,
    foliageColor: 0x59ae30,
  }),
  BIRCH_FOREST: def('birch_forest', 'Березняк', {
    temperature: 0.6,
    rainfall: 0.6,
    trees: 10,
    grass: 2,
    treeKinds: [
      ['birch', 9],
      ['tall_birch', 1],
    ],
    grassColor: 0x88bb67,
    foliageColor: 0x6ba941,
    hills: 'birch_forest_hills',
  }),
  BIRCH_FOREST_HILLS: def('birch_forest_hills', 'Берёзовые холмы', {
    ...hillsSpec,
    temperature: 0.6,
    rainfall: 0.6,
    trees: 10,
    grass: 2,
    treeKinds: [['birch', 1]],
    grassColor: 0x88bb67,
    foliageColor: 0x6ba941,
  }),
  ROOFED_FOREST: def('roofed_forest', 'Тёмный лес', {
    temperature: 0.7,
    rainfall: 0.8,
    trees: 0,
    extraTreeChance: 0,
    grass: 2,
    bigMushrooms: 0,
    treeKinds: [['dark_oak', 1]],
    grassColor: 0x507a32,
    foliageColor: 0x59ae30,
    hills: 'plains',
  }),
  TAIGA: def('taiga', 'Тайга', {
    depth: 0.2,
    scale: 0.2,
    temperature: 0.25,
    rainfall: 0.8,
    trees: 10,
    grass: 1,
    ferns: 4,
    treeKinds: taigaTrees,
    grassColor: 0x86b783,
    foliageColor: 0x68a464,
    hills: 'taiga_hills',
  }),
  TAIGA_HILLS: def('taiga_hills', 'Таёжные холмы', {
    ...hillsSpec,
    temperature: 0.25,
    rainfall: 0.8,
    trees: 10,
    grass: 1,
    ferns: 4,
    treeKinds: taigaTrees,
    grassColor: 0x86b783,
    foliageColor: 0x68a464,
  }),
  COLD_TAIGA: def('cold_taiga', 'Заснеженная тайга', {
    depth: 0.2,
    scale: 0.2,
    temperature: -0.5,
    rainfall: 0.4,
    trees: 10,
    grass: 1,
    ferns: 3,
    treeKinds: taigaTrees,
    grassColor: 0x80b497,
    foliageColor: 0x60a17b,
    hills: 'cold_taiga_hills',
  }),
  COLD_TAIGA_HILLS: def('cold_taiga_hills', 'Заснеженные таёжные холмы', {
    ...hillsSpec,
    temperature: -0.5,
    rainfall: 0.4,
    trees: 10,
    grass: 1,
    ferns: 3,
    treeKinds: taigaTrees,
    grassColor: 0x80b497,
    foliageColor: 0x60a17b,
  }),
  MEGA_TAIGA: def('mega_taiga', 'Мегатайга', {
    depth: 0.2,
    scale: 0.2,
    temperature: 0.3,
    rainfall: 0.8,
    trees: 10,
    grass: 3,
    ferns: 6,
    mushrooms: 3,
    boulders: true,
    treeKinds: [
      ['mega_spruce', 1],
      ['mega_pine', 2],
      ['spruce', 3],
      ['pine', 3],
    ],
    surface: 'mega_taiga',
    grassColor: 0x86b87f,
    foliageColor: 0x68a55f,
    hills: 'mega_taiga_hills',
  }),
  MEGA_TAIGA_HILLS: def('mega_taiga_hills', 'Холмы мегатайги', {
    ...hillsSpec,
    temperature: 0.3,
    rainfall: 0.8,
    trees: 10,
    grass: 3,
    ferns: 6,
    mushrooms: 3,
    boulders: true,
    treeKinds: [
      ['mega_spruce', 1],
      ['mega_pine', 2],
      ['spruce', 3],
      ['pine', 3],
    ],
    surface: 'mega_taiga',
    grassColor: 0x86b87f,
    foliageColor: 0x68a55f,
  }),
  SWAMP: def('swamp', 'Болото', {
    depth: -0.2,
    scale: 0.1,
    temperature: 0.8,
    rainfall: 0.9,
    trees: 2,
    grass: 5,
    flowers: 1,
    flowerKinds: [BLOCK_X.BLUE_ORCHID],
    deadBushes: 1,
    mushrooms: 8,
    reeds: 10,
    lilyPads: 4,
    sandPatches: 0,
    gravelPatches: 0,
    treeKinds: [['swamp_oak', 1]],
    surface: 'swamp',
    grassColor: 0x6a7039,
    foliageColor: 0x6a7039,
  }),
  ICE_PLAINS: def('ice_plains', 'Снежная равнина', {
    depth: 0.125,
    scale: 0.05,
    temperature: 0,
    rainfall: 0.5,
    extraTreeChance: 0.05,
    treeKinds: [['spruce', 1]],
    flowers: 0,
    grassColor: 0x80b497,
    foliageColor: 0x60a17b,
    hills: 'ice_mountains',
  }),
  ICE_MOUNTAINS: def('ice_mountains', 'Ледяные горы', {
    ...hillsSpec,
    temperature: 0,
    rainfall: 0.5,
    extraTreeChance: 0.05,
    treeKinds: [['spruce', 1]],
    flowers: 0,
    grassColor: 0x80b497,
    foliageColor: 0x60a17b,
  }),
  ICE_SPIKES: def('ice_spikes', 'Ледяные шипы', {
    depth: 0.425,
    scale: 0.45,
    temperature: 0,
    rainfall: 0.5,
    extraTreeChance: 0,
    flowers: 0,
    grass: 0,
    top: BLOCK.SNOW,
    grassColor: 0x80b497,
    foliageColor: 0x60a17b,
  }),
  MUSHROOM_ISLAND: def('mushroom_island', 'Грибной остров', {
    depth: 0.2,
    scale: 0.3,
    temperature: 0.9,
    rainfall: 1,
    top: BLOCK_X.MYCELIUM,
    extraTreeChance: 0,
    flowers: 0,
    grass: 0,
    mushrooms: 1,
    bigMushrooms: 1,
    grassColor: 0x55c93f,
    foliageColor: 0x2bbb0f,
  }),
  MUSHROOM_SHORE: def('mushroom_shore', 'Грибной берег', {
    depth: 0,
    scale: 0.025,
    temperature: 0.9,
    rainfall: 1,
    top: BLOCK_X.MYCELIUM,
    extraTreeChance: 0,
    flowers: 0,
    grass: 0,
    mushrooms: 1,
    bigMushrooms: 1,
    grassColor: 0x55c93f,
    foliageColor: 0x2bbb0f,
  }),
  JUNGLE: def('jungle', 'Джунгли', {
    temperature: 0.95,
    rainfall: 0.9,
    trees: 50,
    grass: 25,
    ferns: 6,
    flowers: 4,
    melons: true,
    treeKinds: [
      ['mega_jungle', 4],
      ['jungle_bush', 20],
      ['fancy_oak', 4],
      ['jungle', 12],
    ],
    grassColor: 0x59c93c,
    foliageColor: 0x30bb0b,
    hills: 'jungle_hills',
  }),
  JUNGLE_HILLS: def('jungle_hills', 'Холмы джунглей', {
    ...hillsSpec,
    temperature: 0.95,
    rainfall: 0.9,
    trees: 50,
    grass: 25,
    ferns: 6,
    flowers: 4,
    melons: true,
    treeKinds: [
      ['mega_jungle', 4],
      ['jungle_bush', 20],
      ['fancy_oak', 4],
      ['jungle', 12],
    ],
    grassColor: 0x59c93c,
    foliageColor: 0x30bb0b,
  }),
  JUNGLE_EDGE: def('jungle_edge', 'Окраина джунглей', {
    temperature: 0.95,
    rainfall: 0.8,
    trees: 2,
    grass: 25,
    flowers: 4,
    treeKinds: [
      ['jungle_bush', 10],
      ['jungle', 6],
      ['fancy_oak', 2],
    ],
    grassColor: 0x64c73f,
    foliageColor: 0x3eb80f,
  }),
  SAVANNA: def('savanna', 'Саванна', {
    depth: 0.125,
    scale: 0.05,
    temperature: 1.2,
    rainfall: 0,
    trees: 1,
    grass: 20,
    flowers: 4,
    treeKinds: [
      ['acacia', 4],
      ['oak', 1],
    ],
    grassColor: 0xbfb755,
    foliageColor: 0xaea42a,
    hills: 'savanna_plateau',
  }),
  SAVANNA_PLATEAU: def('savanna_plateau', 'Плато саванны', {
    depth: 1.5,
    scale: 0.025,
    temperature: 1,
    rainfall: 0,
    trees: 1,
    grass: 20,
    flowers: 4,
    treeKinds: [
      ['acacia', 4],
      ['oak', 1],
    ],
    grassColor: 0xbfb755,
    foliageColor: 0xaea42a,
  }),
  MESA: def('mesa', 'Столовые горы', {
    temperature: 2,
    rainfall: 0,
    top: BLOCK_X.RED_SAND,
    filler: BLOCK_X.TERRACOTTA_ORANGE,
    extraTreeChance: 0,
    flowers: 0,
    grass: 0,
    deadBushes: 20,
    reeds: 3,
    cacti: 5,
    clay: 0,
    surface: 'mesa',
    grassColor: 0x90814d,
    foliageColor: 0x9e814d,
  }),
  MESA_PLATEAU_F: def('mesa_plateau_f', 'Лесистое плато', {
    depth: 1.5,
    scale: 0.025,
    temperature: 2,
    rainfall: 0,
    top: BLOCK_X.RED_SAND,
    filler: BLOCK_X.TERRACOTTA_ORANGE,
    trees: 5,
    treeKinds: [['oak', 1]],
    flowers: 0,
    grass: 0,
    deadBushes: 20,
    reeds: 3,
    cacti: 5,
    clay: 0,
    surface: 'mesa_forest',
    grassColor: 0x90814d,
    foliageColor: 0x9e814d,
    hills: 'mesa',
  }),
  MESA_PLATEAU: def('mesa_plateau', 'Плато', {
    depth: 1.5,
    scale: 0.025,
    temperature: 2,
    rainfall: 0,
    top: BLOCK_X.RED_SAND,
    filler: BLOCK_X.TERRACOTTA_ORANGE,
    extraTreeChance: 0,
    flowers: 0,
    grass: 0,
    deadBushes: 20,
    reeds: 3,
    cacti: 5,
    clay: 0,
    surface: 'mesa',
    grassColor: 0x90814d,
    foliageColor: 0x9e814d,
    hills: 'mesa',
  }),
};
export const BIOMES_V5: readonly BiomeV5[] = Object.freeze(list);
export function biomeV5(id: number): BiomeV5 {
  return BIOMES_V5[id] ?? BIOMES_V5[B.PLAINS];
}
export function biomeV5ByKey(key: string): BiomeV5 | undefined {
  return BIOMES_V5.find((biome) => biome.key === key);
}
/** Temperature at a height: the air cools above the sea, which is why peaks carry snow. */
export function temperatureAt(biome: BiomeV5, y: number, jitter = 0): number {
  if (y <= 64) return biome.temperature;
  return biome.temperature - ((jitter * 8 + y - 64) * 0.05) / 30;
}
export const SNOW_TEMPERATURE = 0.15;
