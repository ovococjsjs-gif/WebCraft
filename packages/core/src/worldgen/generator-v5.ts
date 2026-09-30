/**
 * The v5 overworld generator: 1.12-style density terrain, carvers and decoration, assembled per
 * column without depending on which columns were generated before.
 *
 * 1. A base chunk is terrain + surface + caves + ravines. It is a pure function of the seed and
 *    the chunk coordinates, cached in a small LRU because every column also reads its eight
 *    neighbours' base chunks.
 * 2. The four source chunks whose decoration square covers the column plant their features.
 * 3. Snow and ice settle on the finished column, by temperature at each column's height.
 */
import { BLOCK, BLOCK_X, registry } from '../../../content/src/blocks';
import { ChunkColumn } from '../world';
import { seedHash } from '../random';
import { carveCaves, carveRavines } from './carvers';
import { decorate, LEAVES, type Sink, type WorldView } from './features';
import { biomeV5, SNOW_TEMPERATURE, temperatureAt, type BiomeV5 } from './biomes-v5';
import { layoutFor, type BiomeLayout } from './layout';
import { CHUNK_VOLUME, DensityTerrain, idx, SEA_LEVEL, type BaseChunk } from './terrain-v5';
import { ImprovedNoise } from './perlin';
import { Rng } from './rng';
import { StructuresV5 } from './structures';
import { isOpen, type Box, type Canvas } from './structures/pieces';

export type PresetV5 = 'overworld' | 'large-biomes' | 'amplified';
export interface FinishedChunk {
  readonly blocks: Uint16Array;
  readonly biomes: Uint8Array;
  /** Loot table of every generated chest and the creature of every spawner, by block index. */
  readonly chestLoot: ReadonlyMap<number, string>;
  readonly spawners: ReadonlyMap<number, string>;
}
const LOGS = new Set<number>([
  BLOCK.LOG,
  BLOCK.BIRCH,
  BLOCK_X.SPRUCE_LOG,
  BLOCK_X.JUNGLE_LOG,
  BLOCK_X.ACACIA_LOG,
  BLOCK_X.DARK_OAK_LOG,
  BLOCK_X.MUSHROOM_STEM,
  BLOCK_X.BROWN_MUSHROOM_BLOCK,
  BLOCK_X.RED_MUSHROOM_BLOCK,
  BLOCK.CACTUS,
  BLOCK.PUMPKIN,
  BLOCK.MELON,
]);

interface Base extends BaseChunk {
  /** First air above the highest block of each column (x + z * 16). */
  readonly heights: Uint8Array;
}

const LRU_SIZE = 160;
export class GeneratorV5 {
  readonly seed: number;
  readonly layout: BiomeLayout;
  private readonly terrain: DensityTerrain;
  private readonly cache = new Map<string, Base>();
  private readonly frost: ImprovedNoise;
  constructor(
    seedText: string,
    readonly preset: PresetV5,
  ) {
    this.seed = seedHash(seedText);
    this.layout = layoutFor(this.seed, preset === 'large-biomes');
    this.terrain = new DensityTerrain(this.seed, this.layout, preset === 'amplified');
    this.frost = new ImprovedNoise(Rng.of(this.seed, 0xf405));
    const terrain = this.terrain,
      layout = this.layout;
    this.structures = new StructuresV5({
      seed: this.seed,
      ground: (x, z) => terrain.groundHeight(x, z),
      biome: (x, z) => biomeV5(layout.biomeAt(x, z)),
    });
  }
  readonly structures: StructuresV5;
  /** The density terrain, for the far-terrain sampler (read only). */
  get density(): DensityTerrain {
    return this.terrain;
  }
  base(cx: number, cz: number): Base {
    const key = `${cx},${cz}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const chunk = this.terrain.fill(cx, cz);
    const target = { cx, cz, blocks: chunk.blocks, biomes: chunk.biomes };
    carveCaves(target, this.seed);
    carveRavines(target, this.seed);
    const heights = new Uint8Array(256);
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        let y = 255;
        while (y > 0 && chunk.blocks[idx(x, y, z)] === BLOCK.AIR) y--;
        heights[x + z * 16] = Math.min(255, y + 1);
      }
    const base: Base = { ...chunk, heights };
    this.cache.set(key, base);
    while (this.cache.size > LRU_SIZE) this.cache.delete(this.cache.keys().next().value!);
    return base;
  }
  private view(claims: readonly Box[] = []): WorldView {
    return {
      base: (x, y, z) => {
        const b = this.base(x >> 4, z >> 4);
        return b.blocks[idx(x & 15, y, z & 15)];
      },
      height: (x, z) => this.base(x >> 4, z >> 4).heights[(x & 15) + (z & 15) * 16],
      biome: (x, z) => this.base(x >> 4, z >> 4).biomes[(x & 15) + (z & 15) * 16],
      reserved: claims.length
        ? (x, z) => {
            for (const b of claims)
              if (x >= b.x0 - 1 && x <= b.x1 + 1 && z >= b.z0 - 1 && z <= b.z1 + 1) return true;
            return false;
          }
        : undefined,
    };
  }
  /** Blocks and biomes of a finished chunk, without the ChunkColumn wrapper. */
  chunk(cx: number, cz: number): FinishedChunk {
    const base = this.base(cx, cz);
    const blocks = new Uint16Array(CHUNK_VOLUME);
    blocks.set(base.blocks);
    const ox = cx * 16,
      oz = cz * 16;
    const chestLoot = new Map<number, string>();
    const spawners = new Map<number, string>();
    const inside = (x: number, y: number, z: number) =>
      x >= ox && x < ox + 16 && z >= oz && z < oz + 16 && y >= 0 && y < 256;
    const at = (x: number, y: number, z: number) => idx(x - ox, y, z - oz);
    const sink: Sink = {
      bounds: { minX: ox, minZ: oz, maxX: ox + 15, maxZ: oz + 15 },
      current: (x, y, z) => (inside(x, y, z) ? blocks[at(x, y, z)] : undefined),
      put: (x, y, z, state) => {
        if (inside(x, y, z)) blocks[at(x, y, z)] = state;
      },
      chest: (x, y, z, loot) => {
        if (inside(x, y, z)) chestLoot.set(at(x, y, z), loot);
      },
      spawner: (x, y, z, mob) => {
        if (inside(x, y, z)) spawners.set(at(x, y, z), mob);
      },
    };
    const view = this.view(this.structures.claims(cx, cz));
    for (const [sx, sz] of [
      [cx - 1, cz - 1],
      [cx, cz - 1],
      [cx - 1, cz],
      [cx, cz],
    ] as const)
      decorate(view, sink, this.seed, sx, sz);
    const canvas: Canvas = {
      cx,
      cz,
      contains: (x, z) => x >= ox && x < ox + 16 && z >= oz && z < oz + 16,
      get: (x, y, z) => (inside(x, y, z) ? blocks[at(x, y, z)] : BLOCK.AIR),
      set: (x, y, z, state) => {
        if (!inside(x, y, z)) return;
        const i = at(x, y, z);
        blocks[i] = state;
        chestLoot.delete(i);
        spawners.delete(i);
      },
      chest: (x, y, z, loot) => {
        if (!inside(x, y, z)) return;
        blocks[at(x, y, z)] = BLOCK.CHEST;
        chestLoot.set(at(x, y, z), loot);
      },
      spawner: (x, y, z, mob) => {
        if (!inside(x, y, z)) return;
        blocks[at(x, y, z)] = BLOCK.SPAWNER;
        spawners.set(at(x, y, z), mob);
      },
      surface: (x, z) => {
        if (!inside(x, 0, z)) return -1;
        for (let y = 254; y > 0; y--) {
          const s = blocks[at(x, y, z)];
          if (s === BLOCK.AIR || LEAVES.has(s) || LOGS.has(s) || isOpen(s)) continue;
          return y;
        }
        return -1;
      },
    };
    this.structures.draw(canvas);
    this.freeze(cx, cz, blocks, base.biomes);
    return { blocks, biomes: base.biomes, chestLoot, spawners };
  }
  /** Ice on cold water and a thin snow cover on cold ground, as the reference does per column. */
  private freeze(cx: number, cz: number, blocks: Uint16Array, biomes: Uint8Array): void {
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const biome = biomeV5(biomes[x + z * 16]);
        let y = 255;
        while (y > 0) {
          const s = blocks[idx(x, y, z)];
          if (s !== BLOCK.AIR && (registry.get(s).solid || registry.get(s).fluid || LEAVES.has(s)))
            break;
          y--;
        }
        const jitter = this.frost.sample((cx * 16 + x) / 8, 0.5, (cz * 16 + z) / 8);
        if (!cold(biome, y + 1, jitter)) continue;
        const top = blocks[idx(x, y, z)];
        if (top === BLOCK.WATER) {
          blocks[idx(x, y, z)] = BLOCK.ICE;
          continue;
        }
        if (top === BLOCK.LAVA || top === BLOCK.ICE || top === BLOCK_X.PACKED_ICE) continue;
        if (y >= 255 || blocks[idx(x, y + 1, z)] !== BLOCK.AIR) continue;
        if (!registry.get(top).occludes && !LEAVES.has(top)) continue;
        blocks[idx(x, y + 1, z)] = BLOCK_X.SNOW_LAYER;
        if (top === BLOCK.GRASS) blocks[idx(x, y, z)] = BLOCK_X.GRASS_SNOWY;
      }
  }
  column(cx: number, cz: number): ChunkColumn {
    const { blocks, biomes, chestLoot, spawners } = this.chunk(cx, cz);
    const column = new ChunkColumn(cx, cz);
    column.status = 'generating';
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      const state = blocks[i];
      if (state !== BLOCK.AIR) column.set(i & 15, i >> 8, (i >> 4) & 15, state);
    }
    column.biomes = biomes;
    if (chestLoot.size) column.chestLoot = chestLoot;
    if (spawners.size) column.spawners = spawners;
    column.status = 'ready';
    return column;
  }
}
function cold(biome: BiomeV5, y: number, jitter: number): boolean {
  return temperatureAt(biome, y, jitter) < SNOW_TEMPERATURE;
}

const generators = new Map<string, GeneratorV5>();
export function generatorV5(seedText: string, preset: PresetV5): GeneratorV5 {
  const key = `${preset}:${seedText}`;
  let g = generators.get(key);
  if (!g) {
    if (generators.size > 4) generators.clear();
    g = new GeneratorV5(seedText, preset);
    generators.set(key, g);
  }
  return g;
}
export function generateColumnV5(
  cx: number,
  cz: number,
  seedText: string,
  preset: PresetV5,
): ChunkColumn {
  return generatorV5(seedText, preset).column(cx, cz);
}

/**
 * The player starts on dry, open ground: the layout proposes land columns near the origin
 * (spiralling outwards), and the finished chunk confirms a solid, non-leaf top with two blocks of
 * air above it. A world with no land in reach falls back to the highest top found.
 */
export function spawnPointV5(
  seedText: string,
  preset: PresetV5,
): { x: number; y: number; z: number } {
  const g = generatorV5(seedText, preset);
  let fallback = { x: 8.5, y: 0, z: 8.5 };
  const top = (x: number, z: number) => {
    const { blocks } = g.chunk(x >> 4, z >> 4);
    const lx = x & 15,
      lz = z & 15;
    let y = 254;
    while (y > 0) {
      const s = blocks[idx(lx, y, lz)];
      if (s !== BLOCK.AIR && (registry.get(s).solid || registry.get(s).fluid || LEAVES.has(s)))
        break;
      y--;
    }
    return { y, state: blocks[idx(lx, y, lz)] };
  };
  for (let ring = 0; ring <= 40; ring++)
    for (let dx = -ring; dx <= ring; dx++)
      for (let dz = -ring; dz <= ring; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        const x = 8 + dx * 4,
          z = 8 + dz * 4;
        if (biomeV5(g.layout.biomeAt(x, z)).kind !== 'land') continue;
        const { y, state } = top(x, z);
        if (y + 1.01 > fallback.y) fallback = { x: x + 0.5, y: y + 1.01, z: z + 0.5 };
        const def = registry.get(state);
        if (!def.solid || def.fluid || LEAVES.has(state) || y < SEA_LEVEL || y >= 200) continue;
        return { x: x + 0.5, y: y + 1.01, z: z + 0.5 };
      }
  return fallback;
}
