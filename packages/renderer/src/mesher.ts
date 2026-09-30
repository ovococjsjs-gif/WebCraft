import { biomeV5 } from '../../core/src/worldgen/biomes-v5';
import { averageColors, DEFAULT_FOLIAGE, DEFAULT_GRASS, tileTint } from './biome-tint';
import { LightEngine } from '../../core/src/lighting';
import { BLOCK, BLOCK_X, blockBoxes, registry, type RenderLayer } from '../../content/src/blocks';
import { sectionKey } from '../../core/src/coordinates';
import type { VoxelWorld } from '../../core/src/world';
const BLOCK_BRIGHTNESS = Float32Array.from({ length: 16 }, (_, i) => Math.pow(i / 15, 1.35));
export const TILE_SIZE = 16,
  TILE_STRIDE = 18,
  /** Sixteen columns hold every block tile in one row, so item sprites get a clean block. */
  ATLAS_COLS = 16,
  /**
   * Twelve rows of block textures (192 tiles), then item sprites and animated frames, then the
   * extra block tiles; round H doubled the sheet so the rows from 48 on hold a second sprite run.
   */
  ATLAS_ROWS = 64,
  /** Block textures live below this tile index; item sprites start exactly here. */
  ITEM_TILE_BASE = 192,
  BLOCK_TILE_COUNT = ITEM_TILE_BASE,
  /** The first sprite run holds 96 sprites; later sprites continue from this tile. */
  ITEM_SPRITES_FIRST_RUN = 96,
  ITEM_TILE_BASE_2 = 768;
/** Atlas tile of an item sprite, across both sprite runs. */
export function spriteTile(sprite: number): number {
  return sprite < ITEM_SPRITES_FIRST_RUN
    ? ITEM_TILE_BASE + sprite
    : ITEM_TILE_BASE_2 + sprite - ITEM_SPRITES_FIRST_RUN;
}
/** True for tiles that hold an item sprite (they bleed transparently in the atlas). */
export function isSpriteTile(tile: number): boolean {
  return (
    (tile >= ITEM_TILE_BASE && tile < ITEM_TILE_BASE + ITEM_SPRITES_FIRST_RUN) ||
    tile >= ITEM_TILE_BASE_2
  );
}
export interface MeshLayer {
  positions: Float32Array;
  normals: Float32Array | Int8Array;
  uvs: Float32Array | Uint16Array;
  colors: Float32Array | Uint8Array;
  lights: Float32Array | Uint8Array;
  visuals: Uint8Array;
  indices: Uint32Array | Uint16Array;
}
/** Every kind of leaves sways in the wind, not only the oak's. */
const SWAYING_LEAVES = new Set<number>([
  BLOCK.LEAVES,
  BLOCK_X.BIRCH_LEAVES,
  BLOCK_X.SPRUCE_LEAVES,
  BLOCK_X.JUNGLE_LEAVES,
  BLOCK_X.ACACIA_LEAVES,
  BLOCK_X.DARK_OAK_LEAVES,
]);
export interface MeshEmitter {
  x: number;
  y: number;
  z: number;
  kind: 'fire' | 'portal' | 'lava' | 'drip-water' | 'drip-lava';
}
export interface SectionMesh {
  emitters?: readonly MeshEmitter[];
  key: string;
  cx: number;
  sy: number;
  cz: number;
  revision: number;
  layers: Partial<Record<RenderLayer, MeshLayer>>;
  faces: number;
}
interface Builder {
  visualKind: number;
  visuals: number[];
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  indices: number[];
}
type Triple = readonly [number, number, number];
const FACES: readonly { n: Triple; v: readonly Triple[]; texture: 0 | 1 | 2; shade: number }[] = [
  {
    n: [1, 0, 0],
    v: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
    texture: 1,
    shade: 0.6,
  },
  {
    n: [-1, 0, 0],
    v: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
    texture: 1,
    shade: 0.6,
  },
  {
    n: [0, 1, 0],
    v: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
    texture: 0,
    shade: 1,
  },
  {
    n: [0, -1, 0],
    v: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
    texture: 2,
    shade: 0.5,
  },
  {
    n: [0, 0, 1],
    v: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
    texture: 1,
    shade: 0.8,
  },
  {
    n: [0, 0, -1],
    v: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
    texture: 1,
    shade: 0.8,
  },
];
const fresh = (): Builder => ({
  visualKind: 0,
  visuals: [],
  positions: [],
  normals: [],
  uvs: [],
  colors: [],
  indices: [],
});
function pushQuad(
  b: Builder,
  vertices: readonly Triple[],
  n: Triple,
  x: number,
  y: number,
  z: number,
  tile: number,
  shades: number[],
  water = false,
  /** Fractions of the tile for each vertex, so a partial box shows the matching part. */
  fractions?: readonly (readonly [number, number])[] | 'face',
) {
  const index = b.positions.length / 3;
  const tint = tintOf(tile);
  const col = tile % ATLAS_COLS,
    row = Math.floor(tile / ATLAS_COLS);
  const u0 = (col * TILE_STRIDE + 1.5) / (ATLAS_COLS * TILE_STRIDE),
    u1 = (col * TILE_STRIDE + 16.5) / (ATLAS_COLS * TILE_STRIDE);
  const v0 = 1 - (row * TILE_STRIDE + 16.5) / (ATLAS_ROWS * TILE_STRIDE),
    v1 = 1 - (row * TILE_STRIDE + 1.5) / (ATLAS_ROWS * TILE_STRIDE);
  const uv = [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ];
  vertices.forEach((v, i) => {
    b.positions.push(x + v[0], y + v[1] * (water ? 0.88 : 1), z + v[2]);
    b.normals.push(...n);
    b.visuals.push(
      b.visualKind,
      b.visualKind === 1 && !water
        ? 0
        : b.visualKind === 7
          ? 48
          : b.visualKind === 5
            ? Math.round(v[1] * 255)
            : v[1] > 0.8
              ? 255
              : 0,
    );
    if (fractions) {
      const [fu, fv] = fractions === 'face' ? faceFraction(n, v) : fractions[i];
      b.uvs.push(u0 + (u1 - u0) * fu, v0 + (v1 - v0) * fv);
    } else b.uvs.push(...uv[i]);
    // Face shade and ambient occlusion act on display colour in the reference, not on linear
    // light: the same 0.6 of a side face is much darker there. Raise to the display gamma.
    const shade = Math.pow(shades[i], SHADE_GAMMA);
    if (tint) b.colors.push(shade * tint[0], shade * tint[1], shade * tint[2]);
    else b.colors.push(shade, shade, shade);
  });
  // Select AO diagonal to reduce the most visible interpolation seam.
  if (shades[0] + shades[2] > shades[1] + shades[3])
    b.indices.push(index, index + 1, index + 3, index + 1, index + 2, index + 3);
  else b.indices.push(index, index + 1, index + 2, index, index + 2, index + 3);
}
const SHADE_GAMMA = 2.2;
/** Biome colours of the block being meshed (set per block by meshSection). */
let grassNow = DEFAULT_GRASS,
  foliageNow = DEFAULT_FOLIAGE;
const tints = new Map<number, readonly [number, number, number] | null>();
function tintOf(tile: number) {
  if (tile !== 0 && tile !== 15 && tile !== 355 && tile !== 7 && tile < 346) return null;
  const key = tile * 16777216 * 16 + (tile === 7 || tile >= 346 ? foliageNow : grassNow);
  let hit = tints.get(key);
  if (hit === undefined) {
    if (tints.size > 4096) tints.clear();
    hit = tileTint(tile, grassNow, foliageNow);
    tints.set(key, hit);
  }
  return hit;
}
/** Grass and foliage colour of every column of a chunk, blended over 3×3 columns. */
function biomeColors(world: VoxelWorld, cx: number, cz: number) {
  const grass = new Int32Array(256),
    foliage = new Int32Array(256);
  const raw = (wx: number, wz: number) => {
    const id = world.column(wx >> 4, wz >> 4)?.biomes?.[(wx & 15) + (wz & 15) * 16];
    return id === undefined ? null : biomeV5(id);
  };
  const g: number[] = [],
    f: number[] = [];
  for (let z = 0; z < 16; z++)
    for (let x = 0; x < 16; x++) {
      g.length = f.length = 0;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const biome = raw(cx * 16 + x + dx, cz * 16 + z + dz);
          g.push(biome ? biome.grassColor : DEFAULT_GRASS);
          f.push(biome ? biome.foliageColor : DEFAULT_FOLIAGE);
        }
      grass[x + z * 16] = averageColors(g);
      foliage[x + z * 16] = averageColors(f);
    }
  return { grass, foliage };
}
/** Tile coordinates of a vertex on a face, matching the orientation of the full-cube faces. */
function faceFraction(n: Triple, p: Triple): [number, number] {
  if (n[0] === 1) return [1 - p[2], p[1]];
  if (n[0] === -1) return [p[2], p[1]];
  if (n[2] === 1) return [p[0], p[1]];
  if (n[2] === -1) return [1 - p[0], p[1]];
  if (n[1] === 1) return [p[0], 1 - p[2]];
  return [p[0], p[2]];
}
/**
 * Slabs, stairs, fences, panes, doors and snow layers: every box of the model is drawn with
 * the part of the texture it covers. A face lying on the cell border is hidden by an opaque
 * neighbour exactly like a cube face.
 */
function meshModel(
  b: Builder,
  world: VoxelWorld,
  id: number,
  x: number,
  y: number,
  z: number,
  wx: number,
  wy: number,
  wz: number,
): number {
  const def = registry.get(id);
  const boxes = blockBoxes(id, (bx, by, bz) => world.getBlock(bx, by, bz), wx, wy, wz, 'render');
  let count = 0;
  for (const box of boxes)
    for (const face of FACES) {
      const axis = face.n[0] ? 0 : face.n[1] ? 1 : 2,
        positive = face.n[axis] > 0,
        plane = positive ? box[axis + 3] : box[axis];
      if (positive ? plane >= 1 : plane <= 0) {
        const neighbour = world.getBlock(wx + face.n[0], wy + face.n[1], wz + face.n[2]);
        if (registry.get(neighbour).occludes) continue;
      }
      const vertices = face.v.map(
        (v) => [v[0] ? box[3] : box[0], v[1] ? box[4] : box[1], v[2] ? box[5] : box[2]] as const,
      );
      pushQuad(
        b,
        vertices,
        face.n,
        x,
        y,
        z,
        def.textures[face.texture],
        [face.shade, face.shade, face.shade, face.shade],
        false,
        vertices.map((p) => faceFraction(face.n, p)),
      );
      count++;
    }
  return count;
}
export function meshSection(
  world: VoxelWorld,
  cx: number,
  sy: number,
  cz: number,
  light = new LightEngine(world),
): SectionMesh {
  const builders: Record<RenderLayer, Builder> = {
    opaque: fresh(),
    cutout: fresh(),
    transparent: fresh(),
  };
  const ox = cx * 16,
    oy = sy * 16,
    oz = cz * 16,
    section = world.column(cx, cz)?.sections.get(sy);
  const occupied = (p: number[]) =>
    registry.get(world.getBlock(p[0], p[1], p[2])).occludes ? 1 : 0;
  let faces = 0;
  const emitters: MeshEmitter[] = [];
  let drips = 0;
  const colors = section ? biomeColors(world, cx, cz) : null;
  if (section)
    for (let y = 0; y < 16; y++)
      for (let z = 0; z < 16; z++)
        for (let x = 0; x < 16; x++) {
          const id = section.get(x | (z << 4) | (y << 8));
          if (id === BLOCK.AIR) continue;
          grassNow = colors!.grass[x + z * 16];
          foliageNow = colors!.foliage[x + z * 16];
          const def = registry.get(id),
            b = builders[def.layer],
            wx = ox + x,
            wy = oy + y,
            wz = oz + z;
          b.visualKind =
            def.fluid === 'water'
              ? 1
              : def.fluid === 'lava'
                ? 2
                : id === BLOCK.FIRE
                  ? 3
                  : id === BLOCK.END_PORTAL
                    ? 6
                    : SWAYING_LEAVES.has(id)
                      ? 7
                      : id === BLOCK.NETHER_PORTAL
                        ? 4
                        : def.shape === 'cross' && !def.key.includes('portal')
                          ? 5
                          : 0;
          if (
            emitters.length < 8 &&
            ((def.shape === 'torch' && def.light) ||
              id === BLOCK.SPAWNER ||
              b.visualKind === 3 ||
              b.visualKind === 4 ||
              b.visualKind === 6 ||
              (b.visualKind === 2 && world.getBlock(wx, wy + 1, wz) === BLOCK.AIR))
          )
            emitters.push({
              x: wx + 0.5,
              // A torch flame is the top of a 10/16 post; other emitters sit near the top.
              y: wy + (def.shape === 'torch' ? 0.68 : 0.85),
              z: wz + 0.5,
              kind:
                b.visualKind === 4 || b.visualKind === 6
                  ? 'portal'
                  : b.visualKind === 2
                    ? 'lava'
                    : 'fire',
            });
          // Water or lava soaking through a ceiling drips from its underside.
          if (drips < 4 && def.solid && def.fluid === undefined && wy > 0) {
            const above = registry.get(world.getBlock(wx, wy + 1, wz)).fluid;
            if (above && world.getBlock(wx, wy - 1, wz) === BLOCK.AIR) {
              const h = (wx * 73856093) ^ (wz * 19349663) ^ (wy * 83492791);
              emitters.push({
                x: wx + 0.2 + ((h >>> 3) & 7) * 0.085,
                y: wy - 0.03,
                z: wz + 0.2 + ((h >>> 7) & 7) * 0.085,
                kind: above === 'water' ? 'drip-water' : 'drip-lava',
              });
              drips++;
            }
          }
          if (def.shape === 'flat') {
            // A thin plate on the floor: wires, rails, plates, levers and buttons.
            const h = def.redstone === 'wire' ? 0.0625 : 0.125;
            pushQuad(
              b,
              [
                [0, h, 1],
                [1, h, 1],
                [1, h, 0],
                [0, h, 0],
              ],
              [0, 1, 0],
              x,
              y,
              z,
              def.textures[0],
              [1, 1, 1, 1],
              false,
              'face',
            );
            pushQuad(
              b,
              [
                [0, 0, 1],
                [1, 0, 1],
                [1, h, 1],
                [0, h, 1],
              ],
              [0, 0, 1],
              x,
              y,
              z,
              def.textures[1],
              [0.8, 0.8, 0.8, 0.8],
              false,
              'face',
            );
            pushQuad(
              b,
              [
                [1, 0, 0],
                [0, 0, 0],
                [0, h, 0],
                [1, h, 0],
              ],
              [0, 0, -1],
              x,
              y,
              z,
              def.textures[1],
              [0.7, 0.7, 0.7, 0.7],
              false,
              'face',
            );
            pushQuad(
              b,
              [
                [1, 0, 1],
                [1, 0, 0],
                [1, h, 0],
                [1, h, 1],
              ],
              [1, 0, 0],
              x,
              y,
              z,
              def.textures[1],
              [0.83, 0.83, 0.83, 0.83],
              false,
              'face',
            );
            pushQuad(
              b,
              [
                [0, 0, 0],
                [0, 0, 1],
                [0, h, 1],
                [0, h, 0],
              ],
              [-1, 0, 0],
              x,
              y,
              z,
              def.textures[1],
              [0.74, 0.74, 0.74, 0.74],
              false,
              'face',
            );
            faces += 5;
            continue;
          }
          if (def.shape === 'torch') {
            // Two pixels thick and ten tall, like the reference torch; each face samples the
            // matching strip of the tile (cols 7–8, rows 6–15), so the flame sits on top.
            const lo = 7 / 16,
              hi = 9 / 16,
              top = 10 / 16;
            pushQuad(
              b,
              [
                [lo, top, 1 - lo],
                [hi, top, 1 - lo],
                [hi, top, lo],
                [lo, top, lo],
              ],
              [0, 1, 0],
              x,
              y,
              z,
              def.textures[0],
              [1, 1, 1, 1],
              false,
              'face',
            );
            pushQuad(
              b,
              [
                [lo, 0, 1 - lo],
                [hi, 0, 1 - lo],
                [hi, top, 1 - lo],
                [lo, top, 1 - lo],
              ],
              [0, 0, 1],
              x,
              y,
              z,
              def.textures[1],
              [0.85, 0.85, 0.95, 0.95],
              false,
              'face',
            );
            pushQuad(
              b,
              [
                [hi, 0, lo],
                [lo, 0, lo],
                [lo, top, lo],
                [hi, top, lo],
              ],
              [0, 0, -1],
              x,
              y,
              z,
              def.textures[1],
              [0.75, 0.75, 0.85, 0.85],
              false,
              'face',
            );
            pushQuad(
              b,
              [
                [hi, 0, 1 - lo],
                [hi, 0, lo],
                [hi, top, lo],
                [hi, top, 1 - lo],
              ],
              [1, 0, 0],
              x,
              y,
              z,
              def.textures[1],
              [0.9, 0.9, 0.9, 0.9],
              false,
              'face',
            );
            pushQuad(
              b,
              [
                [lo, 0, lo],
                [lo, 0, 1 - lo],
                [lo, top, 1 - lo],
                [lo, top, lo],
              ],
              [-1, 0, 0],
              x,
              y,
              z,
              def.textures[1],
              [0.8, 0.8, 0.9, 0.9],
              false,
              'face',
            );
            faces += 5;
            continue;
          }
          if (def.model) {
            faces += meshModel(b, world, id, x, y, z, wx, wy, wz);
            continue;
          }
          if (def.shape === 'cross') {
            pushQuad(
              b,
              [
                [0.12, 0, 0.12],
                [0.88, 0, 0.88],
                [0.88, 1, 0.88],
                [0.12, 1, 0.12],
              ],
              [-0.707, 0, 0.707],
              x,
              y,
              z,
              def.textures[0],
              [0.9, 0.9, 1, 1],
            );
            pushQuad(
              b,
              [
                [0.88, 0, 0.12],
                [0.12, 0, 0.88],
                [0.12, 1, 0.88],
                [0.88, 1, 0.12],
              ],
              [0.707, 0, 0.707],
              x,
              y,
              z,
              def.textures[0],
              [0.9, 0.9, 1, 1],
            );
            faces += 2;
            continue;
          }
          for (const face of FACES) {
            const neighbor = world.getBlock(wx + face.n[0], wy + face.n[1], wz + face.n[2]);
            if (
              registry.get(neighbor).occludes ||
              (neighbor === id && !def.occludes) ||
              (def.fluid && registry.get(neighbor).fluid === def.fluid)
            )
              continue;
            const axes = [0, 1, 2].filter((a) => face.n[a] === 0);
            const shades = face.v.map((v) => {
              if (def.fluid || id === BLOCK.GLASS) return face.shade;
              const base = [wx + face.n[0], wy + face.n[1], wz + face.n[2]];
              const a = [...base],
                c = [...base],
                corner = [...base];
              a[axes[0]] += v[axes[0]] === 0 ? -1 : 1;
              c[axes[1]] += v[axes[1]] === 0 ? -1 : 1;
              corner[axes[0]] = a[axes[0]];
              corner[axes[1]] = c[axes[1]];
              const s1 = occupied(a),
                s2 = occupied(c),
                s3 = occupied(corner);
              return face.shade * (1 - (s1 && s2 ? 3 : s1 + s2 + s3) * 0.105);
            });
            pushQuad(
              b,
              face.v,
              face.n,
              x,
              y,
              z,
              def.textures[face.texture],
              shades,
              def.fluid === 'water' &&
                registry.get(world.getBlock(wx, wy + 1, wz)).fluid !== 'water',
            );
            faces++;
          }
        }
  // Adjacent faces repeatedly request the same corner/air light. A tiny section-local cache
  // avoids string-map/light-engine lookups per duplicate vertex, without changing the samples.
  const sampledLight = new Uint16Array(18 * 18 * 18);
  const sample = (x: number, y: number, z: number) => {
    const ix = x - ox + 1,
      iy = y - oy + 1,
      iz = z - oz + 1;
    if (ix < 0 || iy < 0 || iz < 0 || ix >= 18 || iy >= 18 || iz >= 18)
      return (light.skyLight(x, y, z) << 4) | light.blockLight(x, y, z);
    const index = ix + iz * 18 + iy * 324;
    if (!sampledLight[index])
      sampledLight[index] = ((light.skyLight(x, y, z) << 4) | light.blockLight(x, y, z)) + 1;
    return sampledLight[index] - 1;
  };
  const solidCache = new Uint8Array(18 * 18 * 18);
  const solid = (x: number, y: number, z: number) => {
    const ix = x - ox + 1,
      iy = y - oy + 1,
      iz = z - oz + 1;
    if (ix < 0 || iy < 0 || iz < 0 || ix >= 18 || iy >= 18 || iz >= 18)
      return registry.get(world.getBlock(x, y, z)).occludes;
    const index = ix + iz * 18 + iy * 324;
    if (!solidCache[index])
      solidCache[index] = registry.get(world.getBlock(x, y, z)).occludes ? 2 : 1;
    return solidCache[index] === 2;
  };
  const layers: SectionMesh['layers'] = {};
  for (const layer of ['opaque', 'cutout', 'transparent'] as const) {
    const b = builders[layer];
    if (b.indices.length) {
      // Light is a separate vertex attribute: daytime can change without rebuilding terrain.
      const lights = new Float32Array((b.positions.length / 3) * 2);
      for (let i = 0; i < b.positions.length / 3; i++) {
        const x = Math.floor(ox + b.positions[i * 3] + b.normals[i * 3] * 0.01),
          y = Math.floor(oy + b.positions[i * 3 + 1] + b.normals[i * 3 + 1] * 0.01),
          z = Math.floor(oz + b.positions[i * 3 + 2] + b.normals[i * 3 + 2] * 0.01);
        const nx = b.normals[i * 3],
          ny = b.normals[i * 3 + 1],
          nz = b.normals[i * 3 + 2];
        const axis = Math.abs(nx) > 0.9 ? 0 : Math.abs(ny) > 0.9 ? 1 : Math.abs(nz) > 0.9 ? 2 : -1;
        if (axis >= 0) {
          // Smooth lighting: bilinear blend of the voxels in front of the face around this vertex,
          // skipping solid ones. Shadows fade over a block instead of snapping at voxel edges.
          const p = [
            ox + b.positions[i * 3],
            oy + b.positions[i * 3 + 1],
            oz + b.positions[i * 3 + 2],
          ];
          const front = [x, y, z];
          const t1 = axis === 0 ? 1 : 0,
            t2 = axis === 2 ? 1 : 2;
          const f1 = p[t1] - 0.5,
            f2 = p[t2] - 0.5;
          const l1 = Math.floor(f1),
            l2 = Math.floor(f2),
            w1 = f1 - l1,
            w2 = f2 - l2;
          let skySum = 0,
            blockSum = 0,
            weight = 0;
          for (let j = 0; j < 4; j++) {
            const d1 = j & 1,
              d2 = j >> 1;
            const w = (d1 ? w1 : 1 - w1) * (d2 ? w2 : 1 - w2);
            if (w < 1e-4) continue;
            front[t1] = l1 + d1;
            front[t2] = l2 + d2;
            if (solid(front[0], front[1], front[2])) continue;
            const v = sample(front[0], front[1], front[2]);
            skySum += (v >> 4) * w;
            blockSum += (v & 15) * w;
            weight += w;
          }
          if (weight > 0.05) {
            lights[i * 2] = skySum / weight / 15;
            lights[i * 2 + 1] = Math.pow(blockSum / weight / 15, 1.35);
            continue;
          }
        }
        const frontLight = sample(x, y, z);
        let sky = frontLight >> 4,
          block = frontLight & 15;
        // Sample the adjacent air voxel as well as the vertex; an opaque corner is not black.
        const ax = Math.floor(ox + b.positions[i * 3] - b.normals[i * 3] * 0.01),
          ay = Math.floor(oy + b.positions[i * 3 + 1] - b.normals[i * 3 + 1] * 0.01),
          az = Math.floor(oz + b.positions[i * 3 + 2] - b.normals[i * 3 + 2] * 0.01);
        const backLight = sample(ax, ay, az);
        sky = Math.max(sky, backLight >> 4);
        block = Math.max(block, backLight & 15);
        lights[i * 2] = sky / 15;
        lights[i * 2 + 1] = BLOCK_BRIGHTNESS[block];
      }
      layers[layer] = {
        lights,
        visuals: new Uint8Array(b.visuals),
        positions: new Float32Array(b.positions),
        normals: new Float32Array(b.normals),
        uvs: new Float32Array(b.uvs),
        colors: new Float32Array(b.colors),
        indices:
          b.positions.length / 3 <= 65535 ? new Uint16Array(b.indices) : new Uint32Array(b.indices),
      };
    }
  }
  return {
    key: sectionKey(cx, sy, cz),
    cx,
    sy,
    cz,
    revision: world.revision,
    layers,
    faces,
    emitters,
  };
}
export function meshTransfers(mesh: SectionMesh): ArrayBuffer[] {
  return Object.values(mesh.layers).flatMap(
    (layer) =>
      [
        layer.positions.buffer,
        layer.normals.buffer,
        layer.uvs.buffer,
        layer.colors.buffer,
        layer.lights.buffer,
        layer.visuals.buffer,
        layer.indices.buffer,
      ] as ArrayBuffer[],
  );
}
