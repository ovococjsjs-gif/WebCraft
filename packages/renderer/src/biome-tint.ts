/**
 * Biome colour of grass and leaves, as in the reference: the same texture is multiplied by the
 * grass or foliage colour of the biome, so a savanna is straw-yellow, a swamp dark olive and a
 * taiga blue-green. Our tiles are painted in colour already, so the multiplier is the biome
 * colour divided by the tile's own average (in linear light): the tile keeps its pattern and its
 * average becomes the biome's colour times a darkening that matches the reference textures.
 */
import { classicTilePixels } from './tile-art';
import { extraTilePixels } from './block-art';
import { terrainPixels } from './pixel-art';

/** Grass top, tall grass, fern. */
export const GRASS_TINT_TILES: ReadonlySet<number> = new Set([0, 15, 355]);
/** Oak, jungle, acacia and dark oak leaves (spruce and birch keep their fixed colour). */
export const FOLIAGE_TINT_TILES: ReadonlySet<number> = new Set([7, 346, 350, 354]);
/** How bright the tinted tile ends up relative to the biome colour (reference textures). */
const GRASS_STRENGTH = 0.8,
  FOLIAGE_STRENGTH = 0.62;
export const DEFAULT_GRASS = 0x91bd59,
  DEFAULT_FOLIAGE = 0x77ab2f;

export const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

const averages = new Map<number, readonly [number, number, number]>();
/** Average linear colour of the opaque pixels of a tile. */
export function tileAverage(tile: number): readonly [number, number, number] {
  let hit = averages.get(tile);
  if (hit) return hit;
  const pixels = classicTilePixels(tile) ?? extraTilePixels(tile) ?? terrainPixels(tile);
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  if (pixels)
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 128) continue;
      r += toLinear(pixels[i] / 255);
      g += toLinear(pixels[i + 1] / 255);
      b += toLinear(pixels[i + 2] / 255);
      n++;
    }
  hit = n ? [r / n, g / n, b / n] : [0.5, 0.5, 0.5];
  averages.set(tile, hit);
  return hit;
}
const rgb = (hex: number, strength: number) =>
  [
    toLinear((((hex >> 16) & 255) / 255) * strength),
    toLinear((((hex >> 8) & 255) / 255) * strength),
    toLinear(((hex & 255) / 255) * strength),
  ] as const;

/** Linear multiplier for `tile` under these biome colours, or null for tiles that keep theirs. */
export function tileTint(
  tile: number,
  grass: number,
  foliage: number,
): readonly [number, number, number] | null {
  const kind = GRASS_TINT_TILES.has(tile) ? 1 : FOLIAGE_TINT_TILES.has(tile) ? 2 : 0;
  if (!kind) return null;
  const target = kind === 1 ? rgb(grass, GRASS_STRENGTH) : rgb(foliage, FOLIAGE_STRENGTH),
    average = tileAverage(tile);
  return [target[0] / average[0], target[1] / average[1], target[2] / average[2]];
}

/** Blends two packed colours component-wise (for smoothing across biome borders). */
export function averageColors(colors: readonly number[]): number {
  let r = 0,
    g = 0,
    b = 0;
  for (const c of colors) {
    r += (c >> 16) & 255;
    g += (c >> 8) & 255;
    b += c & 255;
  }
  const n = colors.length || 1;
  return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
}
