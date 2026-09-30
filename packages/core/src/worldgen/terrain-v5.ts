/**
 * Density terrain of the v5 generator, following the 1.12 overworld: a 5×33×5 grid of density
 * samples per chunk from three large 3D octave noises and one 2D depth noise, blended over the
 * 5×5 neighbourhood of biome heights and interpolated down to blocks. Then the surface builder
 * lays grass, sand, gravel, sandstone and the mesa bands exactly where the reference would.
 */
import { BLOCK, BLOCK_X } from '../../../content/src/blocks';
import { Octaves } from './perlin';
import { Rng, hashInts, hashUnit } from './rng';
import { B, biomeV5, type BiomeV5 } from './biomes-v5';
import type { BiomeLayout } from './layout';

export const SEA_LEVEL = 63;
export const CHUNK_VOLUME = 16 * 16 * 256;
/** Index of a block inside a chunk buffer: the same order as a column's sections. */
export const idx = (x: number, y: number, z: number) => x | (z << 4) | (y << 8);

const COORD_SCALE = 684.412;
const HEIGHT_SCALE = 684.412;
const BASE_SIZE = 8.5;
const STRETCH_Y = 12;
const BIOME_WEIGHTS = new Float64Array(25);
for (let i = -2; i <= 2; i++)
  for (let j = -2; j <= 2; j++)
    BIOME_WEIGHTS[i + 2 + (j + 2) * 5] = 10 / Math.sqrt(i * i + j * j + 0.2);

export interface BaseChunk {
  readonly blocks: Uint16Array;
  /** Biome of every column, x + z * 16. */
  readonly biomes: Uint8Array;
}

export class DensityTerrain {
  private readonly minLimit: Octaves;
  private readonly maxLimit: Octaves;
  private readonly main: Octaves;
  private readonly depth: Octaves;
  private readonly surface: Octaves;
  private readonly swampNoise: Octaves;
  private readonly bands: Uint16Array;
  private readonly bandOffset: Octaves;
  private readonly pillarNoise: Octaves;
  private readonly pillarRoof: Octaves;
  constructor(
    readonly seed: number,
    readonly layout: BiomeLayout,
    readonly amplified: boolean,
  ) {
    const rng = Rng.of(seed, 0x7e44);
    this.minLimit = new Octaves(rng, 16);
    this.maxLimit = new Octaves(rng, 16);
    this.main = new Octaves(rng, 8);
    this.surface = new Octaves(rng, 4);
    this.depth = new Octaves(rng, 16);
    this.swampNoise = new Octaves(rng, 1);
    this.bandOffset = new Octaves(rng, 1);
    this.pillarNoise = new Octaves(rng, 4);
    this.pillarRoof = new Octaves(rng, 1);
    this.bands = mesaBands(Rng.of(seed, 0xba4d));
  }

  /** Biomes on the quarter-resolution grid the density blends over, 10×10 around the chunk. */
  private biomeGrid(cx: number, cz: number): Uint8Array {
    const grid = new Uint8Array(100);
    for (let j = 0; j < 10; j++)
      for (let i = 0; i < 10; i++)
        grid[i + j * 10] = this.layout.biomeAt((cx * 4 - 2 + i) * 4 + 2, (cz * 4 - 2 + j) * 4 + 2);
    return grid;
  }

  /** The 5×33×5 density samples of a chunk. */
  private densities(cx: number, cz: number, grid: Uint8Array): Float64Array {
    const out = new Float64Array(5 * 5 * 33);
    for (let k = 0; k < 5; k++)
      for (let l = 0; l < 5; l++)
        this.densityColumn(
          cx * 4 + k,
          cz * 4 + l,
          (a, b) => grid[k + a + 2 + (l + b + 2) * 10],
          out,
          (k * 5 + l) * 33,
        );
    return out;
  }
  /** The 33 density samples of one grid column; `biome(a, b)` is the biome `a`, `b` grid steps away. */
  private densityColumn(
    gx: number,
    gz: number,
    biome: (a: number, b: number) => number,
    out: Float64Array,
    offset: number,
  ): void {
    let variation = 0,
      height = 0,
      total = 0;
    const centre = biomeV5(biome(0, 0));
    for (let a = -2; a <= 2; a++)
      for (let b = -2; b <= 2; b++) {
        const other = biomeV5(biome(a, b));
        let d = other.depth,
          s = other.scale;
        if (this.amplified && d > 0) {
          d = 1 + d * 2;
          s = 1 + s * 4;
        }
        let w = BIOME_WEIGHTS[a + 2 + (b + 2) * 5] / (d + 2);
        if (other.depth > centre.depth) w /= 2;
        variation += s * w;
        height += d * w;
        total += w;
      }
    variation = (variation / total) * 0.9 + 0.1;
    height = ((height / total) * 4 - 1) / 8;
    let depthNoise = this.depth.sample(gx, 10, gz, 200, 1, 200) / 8000;
    if (depthNoise < 0) depthNoise = -depthNoise * 0.3;
    depthNoise = depthNoise * 3 - 2;
    if (depthNoise < 0) {
      depthNoise /= 2;
      if (depthNoise < -1) depthNoise = -1;
      depthNoise /= 1.4;
      depthNoise /= 2;
    } else {
      if (depthNoise > 1) depthNoise = 1;
      depthNoise /= 8;
    }
    let h = height + depthNoise * 0.2;
    h = (h * BASE_SIZE) / 8;
    const level = BASE_SIZE + h * 4;
    for (let y = 0; y < 33; y++) {
      let falloff = ((y - level) * STRETCH_Y * 128) / 256 / variation;
      if (falloff < 0) falloff *= 4;
      const t =
        (this.main.sample(gx, y, gz, COORD_SCALE / 80, HEIGHT_SCALE / 160, COORD_SCALE / 80) / 10 +
          1) /
        2;
      // Only the limit(s) the selector actually uses are evaluated: same result, far fewer octaves.
      const lo =
        t < 1 ? this.minLimit.sample(gx, y, gz, COORD_SCALE, HEIGHT_SCALE, COORD_SCALE) / 512 : 0;
      const hi =
        t > 0 ? this.maxLimit.sample(gx, y, gz, COORD_SCALE, HEIGHT_SCALE, COORD_SCALE) / 512 : 0;
      let value = (t <= 0 ? lo : t >= 1 ? hi : lo + (hi - lo) * t) - falloff;
      if (y > 29) {
        const slide = (y - 29) / 3;
        value = value * (1 - slide) - 10 * slide;
      }
      out[offset++] = value;
    }
  }

  private readonly gridBiomes = new Map<number, number>();
  private readonly gridColumns = new Map<number, Float64Array>();
  private gridBiome(gx: number, gz: number): number {
    const key = gx * 131072 + gz;
    let b = this.gridBiomes.get(key);
    if (b === undefined) {
      if (this.gridBiomes.size > 200000) this.gridBiomes.clear();
      b = this.layout.biomeAt(gx * 4 + 2, gz * 4 + 2);
      this.gridBiomes.set(key, b);
    }
    return b;
  }
  private gridColumn(gx: number, gz: number): Float64Array {
    const key = gx * 131072 + gz;
    let column = this.gridColumns.get(key);
    if (!column) {
      if (this.gridColumns.size > 50000) this.gridColumns.clear();
      column = new Float64Array(33);
      this.densityColumn(gx, gz, (a, b) => this.gridBiome(gx + a, gz + b), column, 0);
      this.gridColumns.set(key, column);
    }
    return column;
  }
  /**
   * First air above the density terrain at a column, straight from the density field: no
   * surface, caves or features, and no chunk needs to exist. Structures use it to agree on the
   * floor of a piece that spans several chunks, whichever of them is generated first.
   */
  groundHeight(x: number, z: number): number {
    const gx = Math.floor(x / 4),
      gz = Math.floor(z / 4);
    const fx = (x - gx * 4) / 4,
      fz = (z - gz * 4) / 4;
    const c00 = this.gridColumn(gx, gz),
      c10 = this.gridColumn(gx + 1, gz),
      c01 = this.gridColumn(gx, gz + 1),
      c11 = this.gridColumn(gx + 1, gz + 1);
    const at = (s: number) =>
      (c00[s] * (1 - fx) + c10[s] * fx) * (1 - fz) + (c01[s] * (1 - fx) + c11[s] * fx) * fz;
    for (let s = 31; s >= 0; s--) {
      const lo = at(s),
        hi = at(s + 1);
      if (lo <= 0 && hi <= 0) continue;
      for (let dy = 7; dy >= 0; dy--) if (lo + ((hi - lo) * dy) / 8 > 0) return s * 8 + dy + 1;
    }
    return 0;
  }

  /**
   * `groundHeight` at a corner of the 4-block density grid, from that one column alone: the far
   * terrain samples every 4th block or coarser and needs no interpolation there.
   */
  gridGroundHeight(gx: number, gz: number): number {
    const c = this.gridColumn(gx, gz);
    for (let s = 31; s >= 0; s--) {
      const lo = c[s],
        hi = c[s + 1];
      if (lo <= 0 && hi <= 0) continue;
      for (let dy = 7; dy >= 0; dy--) if (lo + ((hi - lo) * dy) / 8 > 0) return s * 8 + dy + 1;
    }
    return 0;
  }
  /** The surface noise the topsoil rules read (same scale as the surface pass). */
  surfaceNoise(x: number, z: number): number {
    return this.surface.sample2(x, z, 0.0625, 0.0625);
  }
  /** Stone, water and air of a chunk, plus the biome of every column. */
  fill(cx: number, cz: number): BaseChunk {
    const blocks = new Uint16Array(CHUNK_VOLUME);
    const grid = this.biomeGrid(cx, cz);
    const d = this.densities(cx, cz, grid);
    const at = (k: number, l: number, y: number) => d[(k * 5 + l) * 33 + y];
    for (let k = 0; k < 4; k++)
      for (let l = 0; l < 4; l++)
        for (let s = 0; s < 32; s++) {
          let d000 = at(k, l, s),
            d010 = at(k, l + 1, s),
            d100 = at(k + 1, l, s),
            d110 = at(k + 1, l + 1, s);
          const s000 = (at(k, l, s + 1) - d000) / 8,
            s010 = (at(k, l + 1, s + 1) - d010) / 8,
            s100 = (at(k + 1, l, s + 1) - d100) / 8,
            s110 = (at(k + 1, l + 1, s + 1) - d110) / 8;
          for (let dy = 0; dy < 8; dy++) {
            let a = d000,
              b = d010;
            const ax = (d100 - d000) / 4,
              bx = (d110 - d010) / 4;
            for (let dx = 0; dx < 4; dx++) {
              let v = a;
              const vz = (b - a) / 4;
              for (let dz = 0; dz < 4; dz++) {
                const y = s * 8 + dy;
                const i = idx(k * 4 + dx, y, l * 4 + dz);
                if (v > 0) blocks[i] = BLOCK.STONE;
                else if (y < SEA_LEVEL) blocks[i] = BLOCK.WATER;
                v += vz;
              }
              a += ax;
              b += bx;
            }
            d000 += s000;
            d010 += s010;
            d100 += s100;
            d110 += s110;
          }
        }
    const biomes = new Uint8Array(256);
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++)
        biomes[x + z * 16] = this.layout.biomeAt(cx * 16 + x, cz * 16 + z);
    this.buildSurface(cx, cz, blocks, biomes);
    return { blocks, biomes };
  }

  /** The reference's surface pass: topsoil of each biome, gravel under deep water, bedrock. */
  private buildSurface(cx: number, cz: number, blocks: Uint16Array, biomes: Uint8Array): void {
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const wx = cx * 16 + x,
          wz = cz * 16 + z;
        const biome = biomeV5(biomes[x + z * 16]);
        const noise = this.surface.sample2(wx, wz, 0.0625, 0.0625);
        const r = Rng.of(this.seed, 0x5eed, wx, wz);
        if (biome.surface === 'mesa' || biome.surface === 'mesa_forest')
          this.mesaColumn(blocks, x, z, wx, wz, biome, noise, r);
        else this.column(blocks, x, z, biome, noise, r, wx, wz);
      }
  }

  private column(
    blocks: Uint16Array,
    x: number,
    z: number,
    biome: BiomeV5,
    noise: number,
    r: Rng,
    wx: number,
    wz: number,
  ): void {
    let top = biome.top,
      filler = biome.filler;
    // Family rules that pick a different topsoil from the noise.
    if (biome.surface === 'extreme_hills' && noise > 1) top = filler = BLOCK.STONE;
    if (biome.surface === 'mega_taiga') {
      if (noise > 1.75) top = BLOCK_X.COARSE_DIRT;
      else if (noise > -0.95) top = BLOCK_X.PODZOL;
    }
    if (biome.surface === 'swamp') {
      const puddle = this.swampNoise.sample2(wx * 0.25, wz * 0.25, 1, 1);
      if (puddle > 0)
        for (let y = 255; y >= 0; y--) {
          const state = blocks[idx(x, y, z)];
          if (state === BLOCK.AIR) continue;
          if (y === 62 && state !== BLOCK.WATER) {
            blocks[idx(x, y, z)] = BLOCK.WATER;
            if (puddle < 0.12) blocks[idx(x, y + 1, z)] = BLOCK_X.LILY_PAD;
          }
          break;
        }
    }
    const baseTop = top,
      baseFiller = filler;
    let run = -1;
    const depth = Math.floor(noise / 3 + 3 + r.nextDouble() * 0.25);
    for (let y = 255; y >= 0; y--) {
      const i = idx(x, y, z);
      if (y <= r.nextInt(5)) {
        blocks[i] = BLOCK.BEDROCK;
        continue;
      }
      const state = blocks[i];
      if (state === BLOCK.AIR) {
        run = -1;
        continue;
      }
      if (state !== BLOCK.STONE) continue;
      if (run === -1) {
        if (depth <= 0) {
          top = BLOCK.AIR;
          filler = BLOCK.STONE;
        } else if (y >= SEA_LEVEL - 4 && y <= SEA_LEVEL + 1) {
          top = baseTop;
          filler = baseFiller;
        }
        if (y < SEA_LEVEL && top === BLOCK.AIR)
          top = biome.temperature < 0.15 ? BLOCK.ICE : BLOCK.WATER;
        run = depth;
        if (y >= SEA_LEVEL - 1) blocks[i] = top;
        else if (y < SEA_LEVEL - 7 - depth) {
          top = BLOCK.AIR;
          filler = BLOCK.STONE;
          blocks[i] = BLOCK.GRAVEL;
        } else blocks[i] = filler;
      } else if (run > 0) {
        run--;
        blocks[i] = filler;
        if (run === 0 && filler === BLOCK.SAND && depth > 1) {
          run = r.nextInt(4) + Math.max(0, y - 63);
          filler = BLOCK.SANDSTONE;
        }
        if (run === 0 && filler === BLOCK_X.RED_SAND && depth > 1) {
          run = r.nextInt(4) + Math.max(0, y - 63);
          filler = BLOCK_X.TERRACOTTA_ORANGE;
        }
      }
    }
  }

  /** Mesa: red sand over banded terracotta, with a grassy crown on the wooded plateau. */
  private mesaColumn(
    blocks: Uint16Array,
    x: number,
    z: number,
    wx: number,
    wz: number,
    biome: BiomeV5,
    noise: number,
    r: Rng,
  ): void {
    let run = -1,
      stained = false;
    const depth = Math.floor(noise / 3 + 3 + r.nextDouble() * 0.25);
    const top = biome.top;
    const filler = biome.filler;
    const forest = biome.surface === 'mesa_forest';
    // The plain mesa grows terracotta pillars out of the desert floor, as in the "bryce" variant.
    if (biome.id === B.MESA) {
      const p = Math.min(Math.abs(noise), this.pillarNoise.sample2(wx * 0.25, wz * 0.25, 1, 1));
      if (p > 0) {
        const roof = Math.abs(this.pillarRoof.sample2(wx * 0.001953125, wz * 0.001953125, 1, 1));
        const height = Math.min(p * p * 2.5, Math.ceil(roof * 50) + 14) + 64;
        for (let y = Math.floor(height); y > 63; y--)
          if (blocks[idx(x, y, z)] === BLOCK.AIR) blocks[idx(x, y, z)] = BLOCK.STONE;
      }
    }
    for (let y = 255; y >= 0; y--) {
      const i = idx(x, y, z);
      if (y <= r.nextInt(5)) {
        blocks[i] = BLOCK.BEDROCK;
        continue;
      }
      const state = blocks[i];
      if (state === BLOCK.AIR) {
        run = -1;
        continue;
      }
      if (state !== BLOCK.STONE) continue;
      if (run === -1) {
        stained = false;
        run = depth + Math.max(0, y - SEA_LEVEL);
        if (depth <= 0) {
          blocks[i] = this.band(wx, y, wz);
        } else if (y >= SEA_LEVEL - 4 && y <= SEA_LEVEL + 1) {
          blocks[i] = top;
        } else if (y >= SEA_LEVEL - 1) {
          if (forest && y > 86 + depth * 2)
            blocks[i] = depth > 1 ? BLOCK_X.COARSE_DIRT : BLOCK.GRASS;
          else if (y > SEA_LEVEL + 3 + depth) {
            blocks[i] = this.band(wx, y, wz);
            stained = true;
          } else blocks[i] = top;
        } else blocks[i] = filler;
      } else if (run > 0) {
        run--;
        blocks[i] = stained
          ? this.band(wx, y, wz)
          : run > 0 && y > SEA_LEVEL
            ? this.band(wx, y, wz)
            : filler;
      } else {
        blocks[i] = y > SEA_LEVEL - 16 ? this.band(wx, y, wz) : BLOCK.STONE;
      }
    }
  }
  band(x: number, y: number, z: number): number {
    const offset = Math.round(this.bandOffset.sample2(x / 512, z / 512, 1, 1) * 2);
    return this.bands[(((y + offset + 64) % 64) + 64) % 64];
  }
}
/** The 64 layers of the mesa: terracotta with orange, yellow, brown, red, white and grey bands. */
function mesaBands(r: Rng): Uint16Array {
  const bands = new Uint16Array(64).fill(BLOCK_X.TERRACOTTA);
  for (let i = 0; i < 64; i++) {
    i += r.nextInt(5) + 1;
    if (i < 64) bands[i] = BLOCK_X.TERRACOTTA_ORANGE;
  }
  const strip = (count: number, state: number, min: number, spread: number) => {
    for (let n = 0; n < count; n++) {
      const len = r.nextInt(spread) + min;
      const start = r.nextInt(64);
      for (let k = 0; start + k < 64 && k < len; k++) bands[start + k] = state;
    }
  };
  strip(r.nextInt(4) + 2, BLOCK_X.TERRACOTTA_YELLOW, 1, 3);
  strip(r.nextInt(4) + 2, BLOCK_X.TERRACOTTA_BROWN, 2, 3);
  strip(r.nextInt(4) + 2, BLOCK_X.TERRACOTTA_RED, 1, 3);
  let at = 0;
  for (let n = r.nextInt(3) + 3; n > 0 && at < 64; n--) {
    at += r.nextInt(16) + 4;
    if (at >= 64) break;
    bands[at] = BLOCK_X.TERRACOTTA_WHITE;
    if (at > 1 && r.nextBoolean()) bands[at - 1] = BLOCK_X.TERRACOTTA_LIGHT_GRAY;
    if (at < 63 && r.nextBoolean()) bands[at + 1] = BLOCK_X.TERRACOTTA_LIGHT_GRAY;
  }
  return bands;
}
export { hashInts, hashUnit };
