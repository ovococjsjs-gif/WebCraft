/**
 * Where each biome lies. This is our own layout with the shape of the 1.12 world:
 *
 * - a continental field splits ocean, deep ocean and land, with rare mushroom islands far out;
 * - four climate zones (warm, temperate, cool, icy) change slowly across thousands of blocks;
 * - land is divided into domain-warped Voronoi cells of about 180 blocks, and each cell takes a
 *   biome from its zone's weighted list, with a one-in-thirteen "special" pick (mesa, jungle,
 *   mega taiga) as in the reference;
 * - small sub-cells turn a third of the biomes into their hills variant;
 * - rivers are the zero lines of a ridged field, frozen in the icy zone;
 * - beaches line the coast: stony next to mountains, snowy in the cold, none at swamps.
 *
 * Every answer depends only on the seed and the coordinates, so any column can be asked alone.
 */
import { Fbm, ImprovedNoise } from './perlin';
import { Rng, hashInts, hashUnit } from './rng';
import { B, biomeV5, biomeV5ByKey } from './biomes-v5';

export type Climate = 'warm' | 'temperate' | 'cool' | 'icy';
const ZONE_BIOMES: Record<Climate, readonly (readonly [number, number])[]> = {
  warm: [
    [B.DESERT, 3],
    [B.SAVANNA, 2],
    [B.PLAINS, 1],
  ],
  temperate: [
    [B.FOREST, 2],
    [B.ROOFED_FOREST, 1],
    [B.EXTREME_HILLS, 1],
    [B.PLAINS, 1],
    [B.BIRCH_FOREST, 1],
    [B.SWAMP, 1],
  ],
  cool: [
    [B.FOREST, 1],
    [B.EXTREME_HILLS, 1],
    [B.TAIGA, 1],
    [B.PLAINS, 1],
  ],
  icy: [
    [B.ICE_PLAINS, 3],
    [B.COLD_TAIGA, 1],
  ],
};
const SPECIAL: Partial<Record<Climate, readonly (readonly [number, number])[]>> = {
  warm: [
    [B.MESA_PLATEAU_F, 1],
    [B.MESA_PLATEAU, 2],
  ],
  temperate: [[B.JUNGLE, 1]],
  cool: [[B.MEGA_TAIGA, 1]],
};
/** Rare variants that replace a whole cell, like the reference's mutated biomes. */
const RARE: Partial<Record<number, number>> = {
  [B.FOREST]: B.FLOWER_FOREST,
  [B.ICE_PLAINS]: B.ICE_SPIKES,
  [B.MESA_PLATEAU]: B.MESA,
};
function pick(list: readonly (readonly [number, number])[], r: number): number {
  const total = list.reduce((sum, [, w]) => sum + w, 0);
  let t = r * total;
  for (const [id, w] of list) {
    if ((t -= w) < 0) return id;
  }
  return list[list.length - 1][0];
}

interface Cell {
  i: number;
  j: number;
  x: number;
  z: number;
  biome: number;
  climate: Climate;
}
export interface LayoutSample {
  biome: number;
  /** Continental value: below zero is sea. Exposed for spawn search and structures. */
  continent: number;
  climate: Climate;
}

export class BiomeLayout {
  private readonly continent: Fbm;
  private readonly climate: Fbm;
  private readonly warpX: Fbm;
  private readonly warpZ: Fbm;
  private readonly river: Fbm;
  private readonly riverWarp: ImprovedNoise;
  private readonly islandNoise: ImprovedNoise;
  private readonly cellSize: number;
  private readonly subSize: number;
  private readonly continentScale: number;
  private readonly climateScale: number;
  private readonly riverScale: number;
  private readonly cells = new Map<number, Cell>();
  constructor(
    readonly seed: number,
    readonly large: boolean,
  ) {
    const rng = Rng.of(seed, 0x1a70);
    this.continent = new Fbm(rng, 6, 0.5);
    this.climate = new Fbm(rng, 3, 0.5);
    this.warpX = new Fbm(rng, 3, 0.5);
    this.warpZ = new Fbm(rng, 3, 0.5);
    this.river = new Fbm(rng, 4, 0.45);
    this.riverWarp = new ImprovedNoise(rng);
    this.islandNoise = new ImprovedNoise(rng);
    const s = large ? 4 : 1;
    this.cellSize = 180 * s;
    this.subSize = 60 * s;
    this.continentScale = 1400 * (large ? 2.5 : 1);
    this.climateScale = 2200 * s;
    this.riverScale = 560 * (large ? 2 : 1);
  }
  /** Continental field in about [-1, 1]; the coast is at 0. */
  continentAt(x: number, z: number): number {
    const k = this.continentScale;
    const wx = x + this.warpX.sample(x / 700, z / 700) * 160,
      wz = z + this.warpZ.sample(x / 700 + 31.7, z / 700 - 12.3) * 160;
    // A slight bias towards land near the origin keeps new worlds from starting at sea.
    const bias = Math.max(0, 0.45 - Math.hypot(x, z) / 3000);
    return this.continent.sample(wx / k, wz / k) * 1.6 + 0.15 + bias;
  }
  climateAt(x: number, z: number): Climate {
    const t = this.climate.sample(x / this.climateScale + 7.1, z / this.climateScale - 3.3) * 2.2;
    return t > 0.3 ? 'warm' : t > -0.12 ? 'temperate' : t > -0.5 ? 'cool' : 'icy';
  }
  private cell(i: number, j: number): Cell {
    const key = ((i & 0xffff) << 16) | (j & 0xffff);
    const hit = this.cells.get(key);
    if (hit && hit.i === i && hit.j === j) return hit;
    const size = this.cellSize;
    const x = (i + 0.15 + 0.7 * hashUnit(this.seed, 11, i, j)) * size,
      z = (j + 0.15 + 0.7 * hashUnit(this.seed, 12, i, j)) * size;
    const climate = this.climateAt(x, z);
    const r = hashUnit(this.seed, 13, i, j);
    let biome: number;
    const special = SPECIAL[climate];
    if (special && hashUnit(this.seed, 14, i, j) < 1 / 13) biome = pick(special, r);
    else biome = pick(ZONE_BIOMES[climate], r);
    const rare = RARE[biome];
    if (rare !== undefined && hashUnit(this.seed, 15, i, j) < 0.12) biome = rare;
    const entry: Cell = { i, j, x, z, biome, climate };
    if (this.cells.size > 8192) this.cells.clear();
    this.cells.set(key, entry);
    return entry;
  }
  /** The land cell a point belongs to, after warping so borders meander. */
  private landCell(x: number, z: number): { biome: number; climate: Climate } {
    const size = this.cellSize;
    const wx = x + this.warpX.sample(x / (size * 0.9), z / (size * 0.9)) * size * 0.45,
      wz = z + this.warpZ.sample(x / (size * 0.9) + 5.2, z / (size * 0.9) + 9.4) * size * 0.45;
    const ci = Math.floor(wx / size),
      cj = Math.floor(wz / size);
    let best = this.cell(ci, cj),
      bestD = Infinity;
    for (let i = ci - 1; i <= ci + 1; i++)
      for (let j = cj - 1; j <= cj + 1; j++) {
        const c = this.cell(i, j);
        const d = (c.x - wx) ** 2 + (c.z - wz) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    return best;
  }
  /** Whether the hills sub-cell around a point is one of the chosen ones. */
  private hillsAt(x: number, z: number): { hills: boolean; r: number } {
    const size = this.subSize;
    const wx = x + this.warpZ.sample(x / size, z / size) * size * 0.4,
      wz = z + this.warpX.sample(x / size - 3.3, z / size + 8.8) * size * 0.4;
    const ci = Math.floor(wx / size),
      cj = Math.floor(wz / size);
    let best = 0,
      bestD = Infinity,
      bi = ci,
      bj = cj;
    for (let i = ci - 1; i <= ci + 1; i++)
      for (let j = cj - 1; j <= cj + 1; j++) {
        const px = (i + 0.2 + 0.6 * hashUnit(this.seed, 21, i, j)) * size,
          pz = (j + 0.2 + 0.6 * hashUnit(this.seed, 22, i, j)) * size;
        const d = (px - wx) ** 2 + (pz - wz) ** 2;
        if (d < bestD) {
          bestD = d;
          best = hashUnit(this.seed, 23, i, j);
          bi = i;
          bj = j;
        }
      }
    return { hills: best < 0.3, r: hashUnit(this.seed, 24, bi, bj) };
  }
  /** Ridged river field: zero along the river's centre line. */
  riverAt(x: number, z: number): number {
    const k = this.riverScale;
    const wx = x + this.riverWarp.sample(x / 90, 0.3, z / 90) * 22,
      wz = z + this.riverWarp.sample(x / 90 + 40, 1.7, z / 90 - 40) * 22;
    return Math.abs(this.river.sample(wx / k, wz / k));
  }
  private mushroomIsland(x: number, z: number): 0 | 1 | 2 {
    const size = this.large ? 2400 : 900;
    const ci = Math.floor(x / size),
      cj = Math.floor(z / size);
    for (let i = ci - 1; i <= ci + 1; i++)
      for (let j = cj - 1; j <= cj + 1; j++) {
        if (hashUnit(this.seed, 31, i, j) > 0.14) continue;
        const px = (i + 0.25 + 0.5 * hashUnit(this.seed, 32, i, j)) * size,
          pz = (j + 0.25 + 0.5 * hashUnit(this.seed, 33, i, j)) * size;
        const radius = (this.large ? 150 : 50) + 30 * hashUnit(this.seed, 34, i, j);
        const d =
          Math.hypot(x - px, z - pz) * (1 + 0.25 * this.islandNoise.sample(x / 30, 0.5, z / 30));
        if (d < radius) return 1;
        if (d < radius + 7) return 2;
      }
    return 0;
  }
  sample(x: number, z: number): LayoutSample {
    const continent = this.continentAt(x, z);
    if (continent < 0) {
      const island = continent < -0.12 ? this.mushroomIsland(x, z) : 0;
      if (island === 1) return { biome: B.MUSHROOM_ISLAND, continent, climate: 'temperate' };
      if (island === 2) return { biome: B.MUSHROOM_SHORE, continent, climate: 'temperate' };
      const climate = this.climateAt(x, z);
      const deep = continent < -0.3;
      return {
        biome: deep ? B.DEEP_OCEAN : climate === 'icy' ? B.FROZEN_OCEAN : B.OCEAN,
        continent,
        climate,
      };
    }
    const cell = this.landCell(x, z);
    let biome = cell.biome;
    const hills = biomeV5(biome).hills;
    if (hills) {
      const h = this.hillsAt(x, z);
      if (h.hills) {
        // Plains grow woods instead of hills, as in the reference.
        const target = biome === B.PLAINS ? (h.r < 0.5 ? 'forest' : 'forest_hills') : hills;
        biome = biomeV5ByKey(target)?.id ?? biome;
      }
    }
    const land = biomeV5(biome);
    // Rivers cut through every land biome down to the sea; they narrow in the mountains.
    const riverWidth = land.depth >= 0.9 ? 0.016 : 0.024;
    if (this.riverAt(x, z) < riverWidth && biome !== B.MUSHROOM_ISLAND)
      return {
        biome: cell.climate === 'icy' ? B.FROZEN_RIVER : B.RIVER,
        continent,
        climate: cell.climate,
      };
    if (continent < 0.028 && biome !== B.SWAMP) {
      const beach =
        land.surface === 'extreme_hills'
          ? B.STONE_BEACH
          : cell.climate === 'icy' || land.temperature < 0.2
            ? B.COLD_BEACH
            : land.surface === 'mesa' || land.surface === 'mesa_forest'
              ? biome
              : B.BEACH;
      return { biome: beach, continent, climate: cell.climate };
    }
    return { biome, continent, climate: cell.climate };
  }
  biomeAt(x: number, z: number): number {
    return this.sample(x, z).biome;
  }
}
const layouts = new Map<string, BiomeLayout>();
export function layoutFor(seed: number, large: boolean): BiomeLayout {
  const key = `${seed}:${large ? 1 : 0}`;
  let layout = layouts.get(key);
  if (!layout) {
    if (layouts.size > 8) layouts.clear();
    layout = new BiomeLayout(seed, large);
    layouts.set(key, layout);
  }
  return layout;
}
export { hashInts };
