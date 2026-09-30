/**
 * Far terrain for generator 5: the land beyond the loaded chunks, sampled straight from the
 * generator instead of from chunks (unlike the reference mods, a place does not have to be
 * visited to show on the horizon, because the world is fully determined by its seed).
 *
 * One sample per `stride` blocks gives the height of the ground from the density field (no caves,
 * no features), the block that tops it by the biome's surface rules, snow and ice where it is
 * cold, water depth, and a stand-in for the tree canopy of the biome. Coarse strides land exactly
 * on the 4-block density grid, so a sample then costs one density column.
 *
 * Player edits and most structures do not show at this distance; the real chunks replace the far
 * terrain as soon as they are loaded. Villages do: their roofs and roads are stamped on the
 * nearer rings, so a village can be spotted on the horizon and walked to.
 */
import { BLOCK, BLOCK_X } from '../../../content/src/blocks';
import { biomeV5, SNOW_TEMPERATURE, temperatureAt, type BiomeV5, type TreeKind } from './biomes-v5';
import { generatorV5, type PresetV5 } from './generator-v5';
import { hashUnit } from './rng';
import { SEA_LEVEL } from './terrain-v5';
import { villageFootprints } from './structures/villages';
/** Villages show on the far terrain up to this stride (coarser rings are too far to matter). */
const FAR_VILLAGE_STRIDE = 8;

/** What stands on a canopy cell (the renderer picks the leaf colour from it). */
export const FAR_LEAVES = {
  none: 0,
  foliage: 1,
  spruce: 2,
  birch: 3,
  jungle: 4,
  acacia: 5,
  darkOak: 6,
  mushroom: 7,
} as const;

export interface FarPatch {
  /** Samples per side, including a one-sample border all round (cells + 2). */
  readonly side: number;
  /** Top of the surface (first air above ground, or of the water). */
  readonly heights: Int16Array;
  /** Block that tops the surface. */
  readonly tops: Uint16Array;
  readonly biomes: Uint8Array;
  /** Blocks of water above the ground (0 on land). */
  readonly depth: Uint8Array;
  /** Height of the tree canopy above the surface (0: no tree). */
  readonly canopy: Uint8Array;
  readonly leaves: Uint8Array;
  /** 1 where a trunk stands in the cell (finest stride only). */
  readonly trunk: Uint8Array;
}

const CANOPY: Record<TreeKind, readonly [height: number, leaves: number]> = {
  oak: [6, FAR_LEAVES.foliage],
  fancy_oak: [9, FAR_LEAVES.foliage],
  birch: [7, FAR_LEAVES.birch],
  tall_birch: [10, FAR_LEAVES.birch],
  spruce: [9, FAR_LEAVES.spruce],
  pine: [10, FAR_LEAVES.spruce],
  mega_spruce: [18, FAR_LEAVES.spruce],
  mega_pine: [17, FAR_LEAVES.spruce],
  jungle: [9, FAR_LEAVES.jungle],
  mega_jungle: [20, FAR_LEAVES.jungle],
  jungle_bush: [2, FAR_LEAVES.jungle],
  acacia: [7, FAR_LEAVES.acacia],
  dark_oak: [8, FAR_LEAVES.darkOak],
  swamp_oak: [6, FAR_LEAVES.foliage],
  huge_brown_mushroom: [7, FAR_LEAVES.mushroom],
  huge_red_mushroom: [7, FAR_LEAVES.mushroom],
};
const dominantTree = new Map<number, readonly [number, number] | null>();
function treeOf(biome: BiomeV5): readonly [number, number] | null {
  let hit = dominantTree.get(biome.id);
  if (hit !== undefined) return hit;
  let best: TreeKind | null = null,
    weight = -1;
  for (const [kind, w] of biome.treeKinds)
    if (w > weight) {
      best = kind;
      weight = w;
    }
  hit = best ? CANOPY[best] : null;
  dominantTree.set(biome.id, hit);
  return hit;
}

/**
 * Samples a square of `cells`×`cells` cells of `stride` blocks whose first cell starts at
 * (`x0`, `z0`), plus a border of one cell (for the walls between cells).
 */
export function farPatchV5(
  seedText: string,
  preset: PresetV5,
  x0: number,
  z0: number,
  stride: number,
  cells: number,
): FarPatch {
  const g = generatorV5(seedText, preset),
    density = g.density,
    layout = g.layout;
  const side = cells + 2,
    count = side * side;
  const patch: FarPatch = {
    side,
    heights: new Int16Array(count),
    tops: new Uint16Array(count),
    biomes: new Uint8Array(count),
    depth: new Uint8Array(count),
    canopy: new Uint8Array(count),
    leaves: new Uint8Array(count),
    trunk: new Uint8Array(count),
  };
  const aligned = stride % 4 === 0 && x0 % 4 === 0 && z0 % 4 === 0;
  const span = side * stride;
  const houses =
    stride <= FAR_VILLAGE_STRIDE
      ? g.structures
          .near(
            Math.floor((x0 - stride) / 16),
            Math.floor((z0 - stride) / 16),
            Math.floor((x0 + span) / 16),
            Math.floor((z0 + span) / 16),
            ['village'],
          )
          .flatMap((village) => villageFootprints(village.pieces))
          .filter(
            ({ box }) =>
              box.x1 >= x0 - stride &&
              box.x0 <= x0 + span &&
              box.z1 >= z0 - stride &&
              box.z0 <= z0 + span,
          )
      : [];
  for (let j = 0; j < side; j++)
    for (let i = 0; i < side; i++) {
      const x = x0 + (i - 1) * stride,
        z = z0 + (j - 1) * stride,
        k = i + j * side;
      const ground = aligned
        ? density.gridGroundHeight(x >> 2, z >> 2)
        : density.groundHeight(x, z);
      const id = layout.biomeAt(x, z),
        biome = biomeV5(id);
      patch.biomes[k] = id;
      if (ground < SEA_LEVEL) {
        patch.heights[k] = SEA_LEVEL;
        patch.depth[k] = Math.min(255, SEA_LEVEL - ground);
        patch.tops[k] = biome.temperature < SNOW_TEMPERATURE ? BLOCK.ICE : BLOCK.WATER;
        continue;
      }
      patch.heights[k] = ground;
      patch.tops[k] = topsoil(biome, x, ground, z, density);
      if (houses.length) {
        // The middle of the cell decides, so a house is as wide on the horizon as it is.
        const mx = x + (stride >> 1),
          mz = z + (stride >> 1);
        const house = houses.find(
          ({ box }) => mx >= box.x0 && mx <= box.x1 && mz >= box.z0 && mz <= box.z1,
        );
        if (house) {
          patch.tops[k] = house.top;
          if (house.height !== undefined) patch.heights[k] = Math.max(ground, house.height);
          continue;
        }
      }
      if (temperatureAt(biome, ground) < SNOW_TEMPERATURE) {
        patch.tops[k] = BLOCK_X.SNOW_LAYER;
      }
      const tree = biome.kind === 'land' ? treeOf(biome) : null;
      if (!tree) continue;
      const perBlock = (biome.trees + biome.extraTreeChance) / 256;
      if (perBlock <= 0) continue;
      if (stride <= 4) {
        // Fine strides: real crowns — one tree at a jittered spot in every 6×6 cell that has
        // one, a disc of leaves about five blocks wide around it.
        const crown = crownAt(
          x + stride / 2,
          z + stride / 2,
          g.seed,
          Math.min(0.95, perBlock * 36),
        );
        if (crown < 0) continue;
        patch.canopy[k] = tree[0] + (crown & 7);
        // One block wide, so only the finest stride shows the trunk under the crown.
        if (stride === 1 && crown & 8) patch.trunk[k] = 1;
      } else {
        // Coarse strides: the share of the cell under leaves.
        const cover = Math.min(0.9, perBlock * 14);
        if (hashUnit(g.seed, 0xfa7, Math.floor(x / stride), Math.floor(z / stride)) >= cover)
          continue;
        patch.canopy[k] = tree[0];
      }
      patch.leaves[k] = tree[1];
    }
  return patch;
}

function topsoil(
  biome: BiomeV5,
  x: number,
  ground: number,
  z: number,
  density: ReturnType<typeof generatorV5>['density'],
): number {
  const surface = biome.surface;
  if (surface === 'mesa' || surface === 'mesa_forest') {
    if (surface === 'mesa_forest' && ground > 86) return BLOCK.GRASS;
    return ground - 1 >= SEA_LEVEL + 3 ? density.band(x, ground - 1, z) : biome.top;
  }
  if (surface === 'extreme_hills' || surface === 'mega_taiga') {
    const noise = density.surfaceNoise(x, z);
    if (surface === 'extreme_hills') return noise > 1 ? BLOCK.STONE : biome.top;
    if (noise > 1.75) return BLOCK_X.COARSE_DIRT;
    if (noise > -0.95) return BLOCK_X.PODZOL;
  }
  return biome.top;
}

/**
 * The crown over (x, z): the extra height (0–2) of the tree whose leaves cover it, plus 8 when
 * its trunk stands in the block at (x, z); or -1. Trees stand at jittered spots of a 6-block
 * grid, each cell holding one with the given chance.
 */
function crownAt(x: number, z: number, seed: number, chance: number): number {
  const cx = Math.floor(x / 6),
    cz = Math.floor(z / 6);
  for (let b = cz - 1; b <= cz + 1; b++)
    for (let a = cx - 1; a <= cx + 1; a++) {
      if (hashUnit(seed, 0xfa8, a, b) >= chance) continue;
      const tx = a * 6 + 1 + hashUnit(seed, 0xfa9, a, b) * 4,
        tz = b * 6 + 1 + hashUnit(seed, 0xfaa, a, b) * 4;
      if ((x - tx) ** 2 + (z - tz) ** 2 <= 6.5)
        return (
          Math.floor(hashUnit(seed, 0xfab, a, b) * 3) +
          (Math.floor(tx) === Math.floor(x) && Math.floor(tz) === Math.floor(z) ? 8 : 0)
        );
    }
  return -1;
}
