/**
 * Biomes of the surface generator. This is our own climate model, not the reference algorithm:
 * temperature and humidity drive the choice, height and water override it, and every biome
 * carries the surface it builds and the vegetation it plants. Heights below are block counts of
 * the generator, not vanilla biome parameters, so the E14 conformance stage can replace the
 * numbers without touching the generator's structure.
 */
import { BLOCK } from '../../content/src/blocks';

export type BiomeId =
  | 'ocean'
  | 'beach'
  | 'river'
  | 'plains'
  | 'forest'
  | 'taiga'
  | 'snow'
  | 'desert'
  | 'savanna'
  | 'mountains'
  | 'swamp';

export interface Biome {
  readonly id: BiomeId;
  readonly name: string;
  /** Layer below the surface layer. */
  readonly filler: number;
  /** Top block of the terrain, or -1 when the biome keeps whatever the height rules give. */
  readonly surface: number;
  /** Chance per column that a tree takes root here. */
  readonly treeChance: number;
  /** Share of the trees that are birch instead of oak. */
  readonly birchShare: number;
  /** Trees taller than this are the cold, conifer-like ones of the generator. */
  readonly tallTrees: boolean;
  /** Chance per column of a cactus. */
  readonly cactusChance: number;
  /** Chance per column of a pumpkin. */
  readonly pumpkinChance: number;
  /** Chance per column of a flower or a daisy. */
  readonly flowerChance: number;
  readonly grassChance: number;
  /** Snow cover on the surface layer and ice on the water. */
  readonly cold: boolean;
  /** Wet ground: the swamp fills its hollows with water and grows cane on the shore. */
  readonly wet: boolean;
  readonly surfaceBlockLight: number;
}

const biome = (entry: Biome): Biome => Object.freeze(entry);

export const BIOMES: readonly Biome[] = Object.freeze([
  biome({
    id: 'ocean',
    name: 'Океан',
    filler: BLOCK.SAND,
    surface: BLOCK.SAND,
    treeChance: 0,
    birchShare: 0,
    tallTrees: false,
    cactusChance: 0,
    pumpkinChance: 0,
    flowerChance: 0,
    grassChance: 0,
    cold: false,
    wet: true,
    surfaceBlockLight: 0,
  }),
  biome({
    id: 'beach',
    name: 'Пляж',
    filler: BLOCK.SAND,
    surface: BLOCK.SAND,
    treeChance: 0.004,
    birchShare: 0,
    tallTrees: false,
    cactusChance: 0,
    pumpkinChance: 0,
    flowerChance: 0.002,
    grassChance: 0,
    cold: false,
    wet: true,
    surfaceBlockLight: 0,
  }),
  biome({
    id: 'river',
    name: 'Река',
    filler: BLOCK.SAND,
    surface: BLOCK.SAND,
    treeChance: 0.01,
    birchShare: 0.3,
    tallTrees: false,
    cactusChance: 0,
    pumpkinChance: 0,
    flowerChance: 0.004,
    grassChance: 0.01,
    cold: false,
    wet: true,
    surfaceBlockLight: 0,
  }),
  biome({
    id: 'plains',
    name: 'Луга',
    filler: BLOCK.DIRT,
    surface: BLOCK.GRASS,
    treeChance: 0.008,
    birchShare: 0.15,
    tallTrees: false,
    cactusChance: 0,
    pumpkinChance: 0.002,
    flowerChance: 0.02,
    grassChance: 0.16,
    cold: false,
    wet: false,
    surfaceBlockLight: 0,
  }),
  biome({
    id: 'forest',
    name: 'Лес',
    filler: BLOCK.DIRT,
    surface: BLOCK.GRASS,
    treeChance: 0.096,
    birchShare: 0.25,
    tallTrees: false,
    cactusChance: 0,
    pumpkinChance: 0.001,
    flowerChance: 0.02,
    grassChance: 0.2,
    cold: false,
    wet: false,
    surfaceBlockLight: 0,
  }),
  biome({
    id: 'taiga',
    name: 'Тайга',
    filler: BLOCK.DIRT,
    surface: BLOCK.GRASS,
    treeChance: 0.07,
    birchShare: 0,
    tallTrees: true,
    cactusChance: 0,
    pumpkinChance: 0,
    flowerChance: 0.004,
    grassChance: 0.06,
    cold: true,
    wet: false,
    surfaceBlockLight: 0,
  }),
  biome({
    id: 'snow',
    name: 'Снежная равнина',
    filler: BLOCK.DIRT,
    surface: BLOCK.GRASS,
    treeChance: 0.006,
    birchShare: 0,
    tallTrees: true,
    cactusChance: 0,
    pumpkinChance: 0,
    flowerChance: 0,
    grassChance: 0.002,
    cold: true,
    wet: false,
    surfaceBlockLight: 0,
  }),
  biome({
    id: 'desert',
    name: 'Пустыня',
    filler: BLOCK.SANDSTONE,
    surface: BLOCK.SAND,
    treeChance: 0,
    birchShare: 0,
    tallTrees: false,
    cactusChance: 0.02,
    pumpkinChance: 0,
    flowerChance: 0,
    grassChance: 0.01,
    cold: false,
    wet: false,
    surfaceBlockLight: 0,
  }),
  biome({
    id: 'savanna',
    name: 'Саванна',
    filler: BLOCK.DIRT,
    surface: BLOCK.GRASS,
    treeChance: 0.012,
    birchShare: 0,
    tallTrees: false,
    cactusChance: 0.001,
    pumpkinChance: 0,
    flowerChance: 0.004,
    grassChance: 0.3,
    cold: false,
    wet: false,
    surfaceBlockLight: 0,
  }),
  biome({
    id: 'mountains',
    name: 'Горы',
    filler: BLOCK.STONE,
    surface: BLOCK.STONE,
    treeChance: 0.01,
    birchShare: 0,
    tallTrees: true,
    cactusChance: 0,
    pumpkinChance: 0,
    flowerChance: 0.002,
    grassChance: 0.01,
    cold: false,
    wet: false,
    surfaceBlockLight: 0,
  }),
  biome({
    id: 'swamp',
    name: 'Болото',
    filler: BLOCK.DIRT,
    surface: BLOCK.GRASS,
    treeChance: 0.03,
    birchShare: 0.1,
    tallTrees: false,
    cactusChance: 0,
    pumpkinChance: 0.002,
    flowerChance: 0.006,
    grassChance: 0.18,
    cold: false,
    wet: true,
    surfaceBlockLight: 0,
  }),
]);

const BY_ID = new Map<BiomeId, Biome>(BIOMES.map((entry) => [entry.id, entry]));
export function biomeById(id: BiomeId): Biome {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown biome ${id}`);
  return found;
}
/** Normalised climate of a column: both values are -1..1. */
export interface Climate {
  readonly temperature: number;
  readonly humidity: number;
}
/**
 * Picks the biome of a column from its climate, height and water. Written as one pure function of
 * the world coordinates, so a column generated alone is identical to the same column generated
 * between its neighbours.
 */
export function selectBiome(
  climate: Climate,
  height: number,
  seaLevel: number,
  river: boolean,
): BiomeId {
  if (river) return 'river';
  if (height <= seaLevel - 4) return 'ocean';
  if (height <= seaLevel + 1) return 'beach';
  if (height >= 92) return 'mountains';
  const { temperature, humidity } = climate;
  if (temperature < -0.3) return 'snow';
  if (temperature < -0.02) return 'taiga';
  if (temperature > 0.24 && humidity < -0.05) return 'desert';
  if (temperature > 0.2 && humidity < 0.26) return 'savanna';
  if (humidity > 0.36) return wetOrForest(temperature);
  if (humidity > 0.0) return 'forest';
  return 'plains';
}
function wetOrForest(temperature: number): BiomeId {
  // Warm and very wet ground turns into a swamp, cool and wet into a forest.
  return temperature > 0.05 ? 'swamp' : 'forest';
}
