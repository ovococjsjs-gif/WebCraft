/**
 * The biome-based surface generator: relief, rivers, oceans, caves, ore veins and vegetation.
 * Everything here is a pure function of the world coordinates and the seed, so a column generated
 * on its own is byte for byte the same as the same column generated between its neighbours — the
 * property E14-11 asks for, and the reason caves and trees are allowed to cross column borders.
 */
import { BLOCK } from '../../content/src/blocks';
import { hash2, hash3 } from './random';
import { biomeById, selectBiome, type Biome, type BiomeId, type Climate } from './biomes';

/** Sea level of the biome worlds. The scenic valley preset keeps its own, lower water line. */
export const SEA_LEVEL = 30;
/** Height at which the mountain biome starts, and where its rock surface begins. */
export const MOUNTAIN_START = 92;
export const ORE_REGION = 4;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
/** Two-dimensional value noise: smooth, deterministic, and the base of every field below. */
export function noise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x),
    iz = Math.floor(z),
    fx = smooth(x - ix),
    fz = smooth(z - iz);
  return (
    lerp(
      lerp(hash2(ix, iz, seed), hash2(ix + 1, iz, seed), fx),
      lerp(hash2(ix, iz + 1, seed), hash2(ix + 1, iz + 1, seed), fx),
      fz,
    ) *
      2 -
    1
  );
}
/** Three-dimensional value noise, the building block of the cave tunnels. */
export function noise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  const fx = smooth(x - ix),
    fy = smooth(y - iy),
    fz = smooth(z - iz);
  const corner = (dx: number, dy: number, dz: number) => hash3(ix + dx, iy + dy, iz + dz, seed);
  const lower = lerp(
    lerp(corner(0, 0, 0), corner(1, 0, 0), fx),
    lerp(corner(0, 1, 0), corner(1, 1, 0), fx),
    fy,
  );
  const upper = lerp(
    lerp(corner(0, 0, 1), corner(1, 0, 1), fx),
    lerp(corner(0, 1, 1), corner(1, 1, 1), fx),
    fy,
  );
  return lerp(lower, upper, fz) * 2 - 1;
}
/** The three biome worlds of the generator, in the order the menu lists them. */
export const BIOME_PRESETS = ['overworld', 'large-biomes', 'amplified'] as const;
export type BiomePreset = (typeof BIOME_PRESETS)[number];
export function isBiomePreset(preset: string): preset is BiomePreset {
  return (BIOME_PRESETS as readonly string[]).includes(preset);
}
export interface ColumnProfile {
  readonly height: number;
  readonly biome: BiomeId;
  readonly climate: Climate;
  /** True when the column belongs to a river bed, so its biome is water and not land. */
  readonly river: boolean;
}
/** Region a biome family is drawn from: four times larger with the large-biomes preset. */
function biomeSpread(preset: BiomePreset): number {
  return preset === 'large-biomes' ? 4 : 1;
}
function reliefScale(preset: BiomePreset): number {
  return preset === 'amplified' ? 1.9 : 1;
}
/**
 * Two octaves per field: the long one decides which climate zone a region belongs to, the short
 * one breaks the zone up so a single view already holds more than one biome.
 */
export function climateAt(x: number, z: number, seed: number, preset: BiomePreset): Climate {
  const spread = biomeSpread(preset);
  const sx = x / spread,
    sz = z / spread;
  return {
    temperature:
      0.62 * noise(sx / 230 + 12.5, sz / 230 - 4.5, seed + 271) +
      0.38 * noise(sx / 62 - 8.5, sz / 62 + 21.5, seed + 307),
    humidity:
      0.62 * noise(sx / 190 - 31.5, sz / 190 + 53.5, seed + 613) +
      0.38 * noise(sx / 54 + 3.5, sz / 54 - 9.5, seed + 719),
  };
}
/** The river course; a second octave makes it wind instead of running straight across a cell. */
function riverCourse(x: number, z: number, seed: number, preset: BiomePreset): number {
  const spread = biomeSpread(preset);
  const sx = x / spread,
    sz = z / spread;
  return (
    0.72 * noise(sx / 190 + 91.5, sz / 190 + 17.5, seed + 907) +
    0.28 * noise(sx / 72 - 4.5, sz / 72 + 33.5, seed + 971)
  );
}
export const RIVER_WIDTH = 0.06;
/** True when the column lies in a river band; the width comes from the same noise as the course. */
export function riverAt(x: number, z: number, seed: number, preset: BiomePreset): boolean {
  return Math.abs(riverCourse(x, z, seed, preset)) < RIVER_WIDTH;
}
export function profileAt(x: number, z: number, seed: number, preset: BiomePreset): ColumnProfile {
  const spread = biomeSpread(preset);
  const amp = reliefScale(preset);
  const continental = noise(x / (190 * spread), z / (190 * spread), seed);
  const hills = noise(x / (64 * spread) + 7.5, z / (64 * spread) - 2.5, seed + 7);
  const detail = noise(x / 23, z / 23, seed + 29);
  const base = 36 + continental * 12 + hills * 6.5 + detail * 2.2;
  let lifted = base;
  // A ridge field raises the peaks; with the amplified preset the same ridges climb much higher.
  const ridge = noise(x / (150 * spread) + 41.5, z / (150 * spread) - 20.5, seed + 131);
  if (ridge > 0.55) lifted += (ridge - 0.55) * 230;
  // Deep water: the continental field drops away well below sea level.
  const depth = noise(x / (210 * spread) + 7.5, z / (210 * spread) - 3.5, seed + 353);
  if (depth < -0.42) lifted -= (-0.42 - depth) * 58;
  // The amplified preset scales every deviation from the sea-level plateau, once.
  lifted = 34 + (lifted - 34) * amp;
  let height = Math.max(2, Math.min(200, Math.floor(lifted)));
  const river = riverAt(x, z, seed, preset);
  if (river && height > SEA_LEVEL - 3) {
    // The bed is carved towards the sea floor, deepest in the middle of the band.
    const course = Math.abs(riverCourse(x, z, seed, preset));
    const strength = smooth(Math.min(1, (RIVER_WIDTH - course) / RIVER_WIDTH));
    height = Math.floor(lerp(height, SEA_LEVEL - 3, strength));
  }
  const climate = climateAt(x, z, seed, preset);
  const biome = selectBiome(climate, height, SEA_LEVEL, river);
  return { height, biome, climate, river };
}
/** Nested tunnels: two ridged noise fields agree, so caves are long and connected, not blobs. */
export function isCave(x: number, y: number, z: number, seed: number): boolean {
  if (y < 1) return false;
  const first = noise3(x / 26, y / 15, z / 26, seed + 401);
  if (Math.abs(first) > 0.052) return false;
  const second = noise3(x / 26 + 37.5, y / 15 - 11.5, z / 26 - 19.5, seed + 733);
  return Math.abs(second) < 0.075;
}
/** Lava stands in the deepest caves instead of air, as it does in the reference. */
export const LAVA_LEVEL = 10;
export interface OreRule {
  readonly block: number;
  readonly minY: number;
  readonly maxY: number;
  /** Chance that a 4x4x4 region holds a vein of this ore. */
  readonly chance: number;
  readonly radius: number;
}
/** Ore mix and depth bands. Coal is common and shallow, diamond rare and deep. */
export const ORE_RULES: readonly OreRule[] = Object.freeze([
  { block: BLOCK.COAL_ORE, minY: 5, maxY: 128, chance: 0.09, radius: 2.1 },
  { block: BLOCK.IRON_ORE, minY: 5, maxY: 64, chance: 0.048, radius: 1.7 },
  { block: BLOCK.GRAVEL, minY: 20, maxY: 120, chance: 0.02, radius: 2 },
  { block: BLOCK.DIRT, minY: 20, maxY: 120, chance: 0.02, radius: 2 },
  { block: BLOCK.GOLD_ORE, minY: 5, maxY: 32, chance: 0.02, radius: 1.4 },
  { block: BLOCK.REDSTONE_ORE, minY: 5, maxY: 16, chance: 0.032, radius: 1.5 },
  { block: BLOCK.LAPIS_ORE, minY: 5, maxY: 32, chance: 0.014, radius: 1.4 },
  { block: BLOCK.DIAMOND_ORE, minY: 5, maxY: 16, chance: 0.009, radius: 1.3 },
]);
export interface Vein {
  readonly block: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
}
/** The vein a region holds, if any: one deterministic draw per region and rule. */
export function veinOfRegion(rx: number, ry: number, rz: number, seed: number): Vein | undefined {
  for (const [index, rule] of ORE_RULES.entries()) {
    const draw = hash3(rx, ry, rz, seed + 8101 + index * 977);
    if (draw >= rule.chance) continue;
    return {
      block: rule.block,
      x: rx * ORE_REGION + 0.5 + hash3(rx, ry, rz, seed + 31 + index) * ORE_REGION,
      y: ry * ORE_REGION + 0.5 + hash3(rx, ry, rz, seed + 67 + index) * ORE_REGION,
      z: rz * ORE_REGION + 0.5 + hash3(rx, ry, rz, seed + 101 + index) * ORE_REGION,
      radius: rule.radius,
    };
  }
  return undefined;
}
/** Every vein whose body can reach the given column box; the generator asks once per column. */
/** Widest vein body, plus one; how far a vein can reach out of its own region. */
export const VEIN_REACH = Math.ceil(Math.max(...ORE_RULES.map((rule) => rule.radius))) + 1;
export function veinsNear(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  seed: number,
): Vein[] {
  const reach = VEIN_REACH;
  const found: Vein[] = [];
  for (
    let rx = Math.floor((x0 - reach) / ORE_REGION);
    rx <= Math.floor((x1 + reach) / ORE_REGION);
    rx++
  )
    for (
      let ry = Math.floor((y0 - reach) / ORE_REGION);
      ry <= Math.floor((y1 + reach) / ORE_REGION);
      ry++
    )
      for (
        let rz = Math.floor((z0 - reach) / ORE_REGION);
        rz <= Math.floor((z1 + reach) / ORE_REGION);
        rz++
      ) {
        const vein = veinOfRegion(rx, ry, rz, seed);
        if (!vein) continue;
        const rule = ORE_RULES.find((entry) => entry.block === vein.block)!;
        if (vein.y < rule.minY || vein.y > rule.maxY) continue;
        found.push(vein);
      }
  return found;
}
/** True when the block sits inside the vein body. */
export function inVein(vein: Vein, x: number, y: number, z: number): boolean {
  const dx = x + 0.5 - vein.x,
    dy = y + 0.5 - vein.y,
    dz = z + 0.5 - vein.z;
  // A slightly squashed ellipsoid: veins lie in flat beds more often than in spheres.
  const dy2 = dy / 0.8;
  return dx * dx + dy2 * dy2 + dz * dz <= vein.radius * vein.radius;
}
export interface TreePlan {
  readonly x: number;
  readonly z: number;
  readonly trunkHeight: number;
  readonly birch: boolean;
  readonly tall: boolean;
}
/**
 * Tree roots are planned on a fixed grid, not per column: the plan of a root belongs to the grid
 * cell, so every column that the crown reaches agrees about the same tree.
 */
export function treeRootsNear(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  seed: number,
  preset: BiomePreset,
): TreePlan[] {
  const cell = 6;
  const plans: TreePlan[] = [];
  for (let gx = Math.floor((x0 - 4) / cell); gx <= Math.floor((x1 + 4) / cell); gx++)
    for (let gz = Math.floor((z0 - 4) / cell); gz <= Math.floor((z1 + 4) / cell); gz++) {
      const draw = hash2(gx, gz, seed + 137);
      const x = gx * cell + Math.floor(hash2(gx, gz, seed + 331) * cell);
      const z = gz * cell + Math.floor(hash2(gx, gz, seed + 729) * cell);
      const biome = biomeAtForTree(x, z, seed, preset);
      if (!biome || draw > biome.treeChance * cell * cell) continue;
      plans.push({
        x,
        z,
        trunkHeight: biome.tallTrees
          ? 7 + Math.floor(hash2(gx, gz, seed + 83) * 4)
          : 4 + Math.floor(hash2(gx, gz, seed + 83) * 2),
        birch: hash2(gx, gz, seed + 669) < biome.birchShare,
        tall: biome.tallTrees,
      });
    }
  return plans;
}
/**
 * The biome used for vegetation. It is the surface biome of the column, so a tree never grows out
 * of the water: the profile already answers that.
 */
function biomeAtForTree(
  x: number,
  z: number,
  seed: number,
  preset: BiomePreset,
): Biome | undefined {
  const profile = profileAt(x, z, seed, preset);
  if (profile.height <= SEA_LEVEL + 2) return undefined;
  return biomeById(profile.biome);
}
