/**
 * Geometry of one far-terrain tile: a height field of block columns (tops, and walls down to
 * lower neighbours), coloured with the average colour of each top block's texture and the
 * biome tint, shaded like the chunks. Runs in the far worker; no DOM, no three.js.
 *
 * Vertex format: Int16 positions relative to the tile corner (y absolute), Uint8 sRGB colour
 * with the kind in alpha (255 land, 128 canopy, 0 water), and the Uint16 atlas tile of the face
 * (NO_TILE for water; LEAF_FLAG marks see-through leaves) — 12 bytes a vertex. The shader lays
 * the real block texture over the colour in world space, so the near rings read as blocks and
 * the far ones fade to the tile averages through the mip chain.
 */
import { BLOCK, BLOCK_X, registry } from '../../content/src/blocks';
import { biomeV5 } from '../../core/src/worldgen/biomes-v5';
import { FAR_LEAVES, type FarPatch } from '../../core/src/worldgen/far-v5';
import { tileAverage, tileTint } from './biome-tint';

export const NO_TILE = 0xffff,
  LEAF_FLAG = 0x8000;
export interface FarMesh {
  positions: Int16Array;
  colors: Uint8Array;
  tiles: Uint16Array;
  indices: Uint16Array | Uint32Array;
  /** Lowest and highest y, for the bounding volume. */
  minY: number;
  maxY: number;
}

const toSrgb = (c: number) =>
  Math.round(255 * Math.min(1, c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
type Rgb = readonly [number, number, number];
const packed = (linear: Rgb) =>
  (toSrgb(linear[0]) << 16) | (toSrgb(linear[1]) << 8) | toSrgb(linear[2]);
const multiply = (a: Rgb, b: Rgb | null): Rgb => (b ? [a[0] * b[0], a[1] * b[1], a[2] * b[2]] : a);

const colorCache = new Map<number, number>();
/** Packed sRGB colour of a face of `state` (0 top, 1 side) under the biome. */
function blockColor(state: number, face: 0 | 1, biomeId: number): number {
  const key = (state * 2 + face) * 256 + biomeId;
  let hit = colorCache.get(key);
  if (hit !== undefined) return hit;
  const def = registry.get(state),
    biome = biomeV5(biomeId);
  const tile = def.textures[face === 0 ? 0 : 1] ?? def.textures[0];
  hit = packed(multiply(tileAverage(tile), tileTint(tile, biome.grassColor, biome.foliageColor)));
  colorCache.set(key, hit);
  return hit;
}
/** Atlas tile of a face of `state` (0 top, 1 side). */
function blockTile(state: number, face: 0 | 1): number {
  const def = registry.get(state);
  return def.textures[face === 0 ? 0 : 1] ?? def.textures[0];
}
const LOG_OF: Record<number, number> = {
  [FAR_LEAVES.foliage]: BLOCK.LOG,
  [FAR_LEAVES.spruce]: BLOCK_X.SPRUCE_LOG,
  [FAR_LEAVES.birch]: BLOCK.BIRCH,
  [FAR_LEAVES.jungle]: BLOCK_X.JUNGLE_LOG,
  [FAR_LEAVES.acacia]: BLOCK_X.ACACIA_LOG,
  [FAR_LEAVES.darkOak]: BLOCK_X.DARK_OAK_LOG,
  [FAR_LEAVES.mushroom]: BLOCK_X.MUSHROOM_STEM,
};
/** The first block under the topsoil (up to three deep), as a cliff shows it. */
function subsoil(top: number): number {
  if (
    top === BLOCK.GRASS ||
    top === BLOCK_X.PODZOL ||
    top === BLOCK_X.MYCELIUM ||
    top === BLOCK_X.SNOW_LAYER ||
    top === BLOCK_X.COARSE_DIRT ||
    top === BLOCK_X.GRASS_SNOWY
  )
    return BLOCK.DIRT;
  return top;
}
/** The rock under the subsoil. */
function bedrockOf(top: number): number {
  if (top === BLOCK.SAND) return BLOCK.SANDSTONE;
  if (top === BLOCK_X.RED_SAND) return BLOCK_X.TERRACOTTA_ORANGE;
  const key = registry.get(top).key;
  if (key.includes('terracotta')) return top;
  // Village houses on the far terrain: walls of the same wood or stone as the roof.
  if (/planks|log|cobble|fence|sandstone/.test(key)) return top;
  return BLOCK.STONE;
}
const LEAF_TILE: Record<number, number> = {
  [FAR_LEAVES.foliage]: 7,
  [FAR_LEAVES.spruce]: 339,
  [FAR_LEAVES.birch]: 342,
  [FAR_LEAVES.jungle]: 346,
  [FAR_LEAVES.acacia]: 350,
  [FAR_LEAVES.darkOak]: 354,
};
function leafColor(leaves: number, biomeId: number): number {
  const key = -(leaves * 256 + biomeId) - 1;
  let hit = colorCache.get(key);
  if (hit !== undefined) return hit;
  if (leaves === FAR_LEAVES.mushroom) hit = 0x8a6a4e;
  else {
    const biome = biomeV5(biomeId),
      tile = LEAF_TILE[leaves] ?? 7;
    // Canopy seen from afar is mostly shadowed leaves: a little darker than one lit face.
    const base = multiply(tileAverage(tile), tileTint(tile, biome.grassColor, biome.foliageColor));
    hit = packed([base[0] * 0.8, base[1] * 0.8, base[2] * 0.8]);
  }
  colorCache.set(key, hit);
  return hit;
}
function waterColor(depth: number, ice: boolean): number {
  const key = -100000 - depth * 2 - (ice ? 1 : 0);
  let hit = colorCache.get(key);
  if (hit !== undefined) return hit;
  if (ice) hit = packed(tileAverage(registry.get(BLOCK.ICE).textures[0]));
  else {
    // The teal of the near water over its sandy shallows, deepening to blue.
    const t = Math.min(1, depth / 24);
    hit = packed([(0.3 - 0.17 * t) ** 2.2, (0.62 - 0.3 * t) ** 2.2, (0.72 - 0.22 * t) ** 2.2]);
  }
  colorCache.set(key, hit);
  return hit;
}

export function buildFarMesh(patch: FarPatch, stride: number, cells: number): FarMesh {
  const side = patch.side;
  const pos: number[] = [],
    col: number[] = [],
    til: number[] = [],
    idx: number[] = [];
  let minY = 255,
    maxY = 0;
  const quad = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    dx: number,
    dy: number,
    dz: number,
    color: number,
    shade: number,
    kind: number,
    tile: number,
  ) => {
    const base = pos.length / 3;
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
    const r = Math.round(((color >> 16) & 255) * shade),
      g = Math.round(((color >> 8) & 255) * shade),
      b = Math.round((color & 255) * shade);
    for (let i = 0; i < 4; i++) col.push(r, g, b, kind);
    til.push(tile, tile, tile, tile);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    minY = Math.min(minY, ay, by, cy, dy);
    maxY = Math.max(maxY, ay, by, cy, dy);
  };
  const at = (i: number, j: number) => i + 1 + (j + 1) * side;
  const groundColor = (k: number) =>
    patch.depth[k]
      ? waterColor(patch.depth[k], patch.tops[k] === BLOCK.ICE)
      : blockColor(patch.tops[k], 0, patch.biomes[k]);
  const groundTile = (k: number) =>
    patch.depth[k]
      ? patch.tops[k] === BLOCK.ICE
        ? blockTile(BLOCK.ICE, 0)
        : NO_TILE
      : blockTile(patch.tops[k], 0);
  const canopyTop = (k: number) => patch.heights[k] + patch.canopy[k];
  const canopyBottom = (k: number) =>
    patch.heights[k] + Math.max(1, patch.canopy[k] - (patch.canopy[k] > 10 ? 6 : 4));
  /**
   * Greedy rectangles over the cells: one quad for every run of equal (height, colour), grown
   * along x and then along z. Plains and seas collapse to a handful of quads.
   */
  const greedy = (
    height: (k: number) => number,
    color: (k: number) => number,
    include: (k: number) => boolean,
    emit: (i0: number, j0: number, i1: number, j1: number, h: number, c: number, k: number) => void,
  ) => {
    const done = new Uint8Array(cells * cells);
    for (let j = 0; j < cells; j++)
      for (let i = 0; i < cells; i++) {
        if (done[i + j * cells]) continue;
        const k = at(i, j);
        if (!include(k)) continue;
        const h = height(k),
          c = color(k);
        const same = (a: number, b: number) => {
          const n = at(a, b);
          return !done[a + b * cells] && include(n) && height(n) === h && color(n) === c;
        };
        let w = 1;
        while (i + w < cells && same(i + w, j)) w++;
        let d = 1;
        grow: while (j + d < cells) {
          for (let a = i; a < i + w; a++) if (!same(a, j + d)) break grow;
          d++;
        }
        for (let b = j; b < j + d; b++) for (let a = i; a < i + w; a++) done[a + b * cells] = 1;
        emit(i, j, i + w, j + d, h, c, k);
      }
  };
  // Ground and water tops.
  // Colour and tile together decide what can merge (two blocks of one average colour stay apart).
  greedy(
    (k) => patch.heights[k],
    (k) => groundColor(k) * 1024 + (groundTile(k) & 1023),
    () => true,
    (i0, j0, i1, j1, h, _c, k) => {
      const x0 = i0 * stride,
        x1 = i1 * stride,
        z0 = j0 * stride,
        z1 = j1 * stride;
      quad(
        x0,
        h,
        z0,
        x0,
        h,
        z1,
        x1,
        h,
        z1,
        x1,
        h,
        z0,
        groundColor(k),
        1,
        patch.depth[k] ? 0 : 255,
        groundTile(k),
      );
    },
  );
  // Canopy: floating slabs of leaves (tops and undersides) — trunks do not show from afar.
  const hasCanopy = (k: number) => patch.canopy[k] > 0;
  const leaf = (k: number) => leafColor(patch.leaves[k], patch.biomes[k]);
  const leafTile = (k: number) =>
    patch.leaves[k] === FAR_LEAVES.mushroom
      ? NO_TILE
      : (LEAF_TILE[patch.leaves[k]] ?? 7) | LEAF_FLAG;
  greedy(canopyTop, leaf, hasCanopy, (i0, j0, i1, j1, h, c, k) => {
    const x0 = i0 * stride,
      x1 = i1 * stride,
      z0 = j0 * stride,
      z1 = j1 * stride;
    quad(x0, h, z0, x0, h, z1, x1, h, z1, x1, h, z0, c, 1, 128, leafTile(k));
  });
  greedy(canopyBottom, leaf, hasCanopy, (i0, j0, i1, j1, h, c, k) => {
    const x0 = i0 * stride,
      x1 = i1 * stride,
      z0 = j0 * stride,
      z1 = j1 * stride;
    quad(x0, h, z0, x1, h, z0, x1, h, z1, x0, h, z1, c, 0.5, 128, leafTile(k));
  });
  // Walls towards lower neighbours; at the tile edge they reach a little lower (a skirt), so the
  // seam to a tile of another stride never shows sky.
  const sides = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  for (let j = 0; j < cells; j++)
    for (let i = 0; i < cells; i++) {
      const k = at(i, j),
        h = patch.heights[k];
      for (const [dx, dz] of sides) {
        const ni = i + dx,
          nj = j + dz,
          n = at(ni, nj),
          edge = ni < 0 || nj < 0 || ni >= cells || nj >= cells;
        const shade = dx !== 0 ? 0.6 : 0.8;
        // The face lies on the border between the two cells.
        const x0 = dx === 1 ? (i + 1) * stride : i * stride,
          z0 = dz === 1 ? (j + 1) * stride : j * stride;
        const wall = (from: number, to: number, color: number, kind: number, tile: number) => {
          if (to <= from) return;
          // Counter-clockwise from the side the wall faces (back faces are culled).
          const x1 = x0,
            z1 = z0 + stride;
          if (dx === 1)
            quad(x0, from, z0, x0, to, z0, x1, to, z1, x1, from, z1, color, shade, kind, tile);
          else if (dx === -1)
            quad(x1, from, z1, x1, to, z1, x0, to, z0, x0, from, z0, color, shade, kind, tile);
          else if (dz === 1)
            quad(
              x0,
              from,
              z0,
              x0 + stride,
              from,
              z0,
              x0 + stride,
              to,
              z0,
              x0,
              to,
              z0,
              color,
              shade,
              kind,
              tile,
            );
          else
            quad(
              x0,
              to,
              z0,
              x0 + stride,
              to,
              z0,
              x0 + stride,
              from,
              z0,
              x0,
              from,
              z0,
              color,
              shade,
              kind,
              tile,
            );
        };
        let low = patch.heights[n];
        if (edge) low = Math.min(low, h) - stride * 2;
        if (low < h) {
          if (patch.depth[k]) wall(low, h, groundColor(k), 0, groundTile(k));
          else {
            // As a cliff shows it: the topsoil's own side (grass edge, snow), the subsoil up to
            // three blocks deeper, then the rock.
            const top = patch.tops[k],
              biome = patch.biomes[k];
            const edge = top === BLOCK_X.SNOW_LAYER ? BLOCK_X.GRASS_SNOWY : top,
              sub = subsoil(top),
              rock = bedrockOf(top);
            wall(Math.max(low, h - 1), h, blockColor(edge, 1, biome), 255, blockTile(edge, 1));
            wall(Math.max(low, h - 4), h - 1, blockColor(sub, 1, biome), 255, blockTile(sub, 1));
            wall(low, h - 4, blockColor(rock, 1, biome), 255, blockTile(rock, 1));
          }
        }
        if (patch.canopy[k]) {
          const top = canopyTop(k),
            bottom = canopyBottom(k);
          const cover = patch.canopy[n] ? canopyTop(n) : bottom;
          wall(
            Math.max(bottom, patch.canopy[n] ? Math.min(cover, top) : bottom),
            top,
            leaf(k),
            128,
            leafTile(k),
          );
        }
        if (patch.trunk[k]) {
          const log = LOG_OF[patch.leaves[k]] ?? BLOCK.LOG;
          wall(h, canopyBottom(k), blockColor(log, 1, patch.biomes[k]), 255, blockTile(log, 1));
        }
      }
    }
  const vertices = pos.length / 3;
  return {
    positions: new Int16Array(pos),
    colors: new Uint8Array(col),
    tiles: new Uint16Array(til),
    indices: vertices > 65535 ? new Uint32Array(idx) : new Uint16Array(idx),
    minY,
    maxY,
  };
}
