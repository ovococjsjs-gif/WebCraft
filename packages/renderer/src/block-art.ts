/**
 * Hand-made 16×16 painters for the 0.10 block set. Every tile is drawn from a small palette and
 * a readable motif (bark streaks, growth rings, boards, bricks, leaf clusters), in the same
 * spirit as `pixel-art.ts`: original art, no external assets, stable for a given tile name.
 */
import { extraTileName, type ExtraTileName, type HTileName } from '../../content/src/tiles';
import { H_PAINTERS } from './block-art-h';
import { pixelNoise } from './pixel-art';

type RGB = readonly [number, number, number];
export type Palette = readonly number[];
const rgb = (n: number): RGB => [(n >> 16) & 255, (n >> 8) & 255, n & 255];

export class Tile {
  readonly data = new Uint8ClampedArray(16 * 16 * 4);
  set(x: number, y: number, color: number, alpha = 255): void {
    if (x < 0 || y < 0 || x > 15 || y > 15) return;
    const [r, g, b] = rgb(color);
    this.data.set([r, g, b, alpha], (y * 16 + x) * 4);
  }
  alpha(x: number, y: number): number {
    return this.data[(y * 16 + x) * 4 + 3];
  }
  fill(fn: (x: number, y: number) => number | null, alpha = 255): this {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const c = fn(x, y);
        if (c !== null) this.set(x, y, c, alpha);
      }
    return this;
  }
}
const n2 = (x: number, y: number, seed: number) => pixelNoise(x, y, seed);
/** Clustered four-tone noise: the base of soils, sands and stones. */
export function grain(p: Palette, seed: number, cx = 3, cy = 2): (x: number, y: number) => number {
  return (x, y) => {
    const coarse = n2(Math.floor(x / cx), Math.floor(y / cy), seed),
      fine = n2(x, y, seed + 7);
    if (fine > 0.93) return p[3];
    return coarse > 0.7 ? p[2] : coarse < 0.27 ? p[1] : p[0];
  };
}
/** Stone with scattered crystals: granite, diorite, andesite. */
function speckled(p: Palette, seed: number, density: number): Tile {
  return new Tile().fill((x, y) => {
    const fine = n2(x, y, seed),
      blob = n2(Math.floor(x / 2), Math.floor(y / 2), seed + 3);
    if (fine > 1 - density) return p[3];
    if (blob > 0.74) return p[2];
    if (blob < 0.22) return p[1];
    return p[0];
  });
}
export function bark(p: Palette, seed: number): Tile {
  return new Tile().fill((x, y) => {
    const column = n2(x, 0, seed),
      run = n2(x, Math.floor((y + Math.floor(column * 9)) / 4), seed + 5);
    if (column > 0.78 && run > 0.3) return p[1];
    if (run > 0.82) return p[3];
    if (column < 0.2) return p[2];
    return p[0];
  });
}
/** Log ends: bark rim around growth rings. */
export function rings(barkP: Palette, woodP: Palette, seed: number): Tile {
  return new Tile().fill((x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return barkP[n2(x, y, seed) > 0.5 ? 0 : 1];
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) + (n2(x, y, seed) - 0.5) * 0.6;
    const ring = Math.floor(d) % 3;
    if (d < 1.5) return woodP[3];
    return ring === 0 ? woodP[1] : ring === 1 ? woodP[0] : woodP[2];
  });
}
/** Four boards with seams and a staggered butt joint on each. */
export function planks(p: Palette, seed: number): Tile {
  return new Tile().fill((x, y) => {
    const row = Math.floor(y / 4);
    if (y % 4 === 3) return p[3];
    const joint = (row % 2 ? 11 : 4) + Math.floor(n2(row, 0, seed) * 3);
    if (x === joint) return p[3];
    const grainLine = n2(x, row, seed + 1) > 0.8 && y % 4 === 1;
    if (grainLine) return p[2];
    return n2(Math.floor(x / 4), y, seed + 2) > 0.66 ? p[1] : p[0];
  });
}
export function leaves(p: Palette, seed: number, holes = 0.1): Tile {
  const t = new Tile();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const cluster = n2(Math.floor((x + Math.floor(y / 4)) / 3), Math.floor(y / 3), seed),
        fine = n2(x, y, seed + 11);
      if (fine < holes) continue;
      t.set(x, y, cluster < 0.25 ? p[1] : cluster > 0.72 ? p[2] : fine > 0.9 ? p[3] : p[0]);
    }
  return t;
}
/** Needles: short diagonal strokes, darker and denser than broad leaves. */
function needles(p: Palette, seed: number): Tile {
  const t = new Tile().fill((x, y) => (n2(x, y, seed) < 0.08 ? null : p[1]));
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(n2(i, 1, seed) * 16),
      y = Math.floor(n2(i, 2, seed) * 16),
      c = p[i % 3 === 0 ? 2 : i % 3 === 1 ? 0 : 3];
    t.set(x, y, c);
    t.set(x + 1, y + 1, c);
    t.set(x - 1, y + 1, p[0]);
  }
  return t;
}
export function bricks(p: Palette, mortar: number, seed: number): Tile {
  return new Tile().fill((x, y) => {
    const row = Math.floor(y / 4);
    if (y % 4 === 3) return mortar;
    if ((x + (row % 2) * 4) % 8 === 7) return mortar;
    const tone = n2(Math.floor((x + (row % 2) * 4) / 8), row, seed);
    const fine = n2(x, y, seed + 3);
    if (y % 4 === 0 && fine > 0.4) return p[2];
    return fine > 0.9 ? p[3] : tone > 0.6 ? p[1] : p[0];
  });
}
function edge(
  top: Tile,
  cover: (x: number, y: number) => number,
  depth: (x: number) => number,
): Tile {
  for (let x = 0; x < 16; x++) for (let y = 0; y < depth(x); y++) top.set(x, y, cover(x, y));
  return top;
}
export const DIRT: Palette = [0x946d47, 0x806043, 0xa47b50, 0x6d543e];
const dirt = (seed = 2) => new Tile().fill(grain(DIRT, seed * 149));

/* --------------------------------------------------------------- wood palettes */
export const WOOD = {
  spruce: {
    bark: [0x3d2b1a, 0x2c1f12, 0x4a3522, 0x5a432c],
    wood: [0x6e5232, 0x5a4228, 0x7d5f3c, 0x4b3721],
    planks: [0x735535, 0x68492c, 0x7f5f3c, 0x4a341e],
  },
  birch: {
    bark: [0xe0dcd0, 0x2a2a26, 0xc8c4b6, 0x8b8a80],
    wood: [0xd4c38a, 0xbfae76, 0xe2d39d, 0xa89565],
    planks: [0xc8b77a, 0xbaa86c, 0xd6c68c, 0x9a8a58],
  },
  jungle: {
    bark: [0x584419, 0x463512, 0x6a5220, 0x7a6128],
    wood: [0xa27550, 0x8f6443, 0xb3875c, 0x7a5336],
    planks: [0xa0734f, 0x946843, 0xae8058, 0x6f4c30],
  },
  acacia: {
    bark: [0x6a645c, 0x57524a, 0x7b756c, 0x4a4540],
    wood: [0xb05e33, 0x9a4f29, 0xc26d3c, 0x86421f],
    planks: [0xab5c33, 0x9f532c, 0xba683a, 0x7c3d1d],
  },
  dark_oak: {
    bark: [0x3b2d18, 0x2d2211, 0x48381f, 0x21190c],
    wood: [0x4b3721, 0x3d2c19, 0x5a4228, 0x2f2213],
    planks: [0x45301a, 0x3c2915, 0x523a20, 0x291c0e],
  },
  oak: {
    bark: [0x7e623f, 0x5e4b34, 0x96754a, 0xaf8956],
    wood: [0xb49360, 0x9a784b, 0xc6a671, 0x806341],
    planks: [0xbc945c, 0xcaa66b, 0xa67d4c, 0x795b3c],
  },
} as const;

/* --------------------------------------------------------------- plants */
export function plant(draw: (t: Tile) => void): Tile {
  const t = new Tile();
  draw(t);
  return t;
}
export function stem(t: Tile, x: number, from: number, to: number, color: number): void {
  for (let y = from; y <= to; y++) t.set(x, y, color);
}
function flower(petals: Palette, centre: number, shape: 'cup' | 'star' | 'ball' | 'tulip'): Tile {
  return plant((t) => {
    stem(t, 7, 7, 15, 0x3f7a2a);
    t.set(6, 12, 0x4f8f33);
    t.set(5, 11, 0x4f8f33);
    t.set(8, 10, 0x4f8f33);
    t.set(9, 9, 0x4f8f33);
    const cx = 7,
      cy = 5;
    if (shape === 'ball') {
      for (let y = -3; y <= 3; y++)
        for (let x = -3; x <= 3; x++)
          if (x * x + y * y <= 9) t.set(cx + x, cy + y, petals[(x + y + 9) % 3]);
    } else if (shape === 'tulip') {
      for (let y = 2; y <= 7; y++)
        for (let x = 5; x <= 9; x++)
          if (!(y === 2 && (x === 6 || x === 8))) t.set(x, y, petals[(x + y) % 2]);
      t.set(7, 6, petals[2]);
    } else if (shape === 'star') {
      for (const [dx, dy] of [
        [0, -2],
        [0, 2],
        [-2, 0],
        [2, 0],
        [-1, -1],
        [1, 1],
        [-1, 1],
        [1, -1],
        [0, -3],
        [3, 0],
        [-3, 0],
        [0, 3],
      ] as const)
        t.set(cx + dx, cy + dy, petals[Math.abs(dx + dy) % 2]);
      t.set(cx, cy, centre);
    } else {
      for (let y = -2; y <= 1; y++)
        for (let x = -2; x <= 2; x++)
          if (Math.abs(x) + Math.max(0, y) < 3) t.set(cx + x, cy + y, petals[(x + 3) % 2]);
      t.set(cx, cy, centre);
      t.set(cx, cy - 1, petals[2]);
    }
    if (shape === 'ball' || shape === 'tulip') return;
    t.set(cx, cy, centre);
  });
}
function mushroom(cap: Palette, spots: boolean): Tile {
  return plant((t) => {
    for (let y = 9; y <= 14; y++) {
      t.set(7, y, 0xe8dcc8);
      t.set(8, y, 0xd4c6ae);
    }
    for (let y = 0; y < 4; y++)
      for (let x = -4 + (y === 0 ? 1 : 0); x <= 3 - (y === 0 ? 1 : 0); x++)
        t.set(8 + x, 6 + y, y === 3 ? cap[2] : cap[(x + y + 8) % 2]);
    if (spots)
      for (const [x, y] of [
        [6, 7],
        [9, 6],
        [10, 8],
        [5, 8],
      ] as const)
        t.set(x, y, 0xf0ece0);
  });
}

/* --------------------------------------------------------------- the table */
const PAINTERS: Record<Exclude<ExtraTileName, HTileName>, () => Tile> = {
  grass_snowy_side: () =>
    edge(
      dirt(),
      (x, y) => (y === 0 || n2(x, y, 51) > 0.3 ? 0xf2f7f7 : 0xd8e4e8),
      (x) => 3 + Math.floor(n2(Math.floor(x / 2), 0, 52) * 3),
    ),
  podzol_top: () =>
    new Tile().fill((x, y) => {
      const c = n2(Math.floor(x / 2), Math.floor(y / 2), 61),
        f = n2(x, y, 62);
      if (f > 0.9) return 0x4e6b25;
      return c > 0.7 ? 0x8a5a2a : c < 0.3 ? 0x5e3d1d : 0x74491f;
    }),
  podzol_side: () =>
    edge(
      dirt(),
      (x, y) => (n2(x, y, 63) > 0.5 ? 0x74491f : 0x5e3d1d),
      (x) => 2 + Math.floor(n2(x, 0, 64) * 3),
    ),
  coarse_dirt: () =>
    new Tile().fill((x, y) => {
      const f = n2(x, y, 71),
        c = n2(Math.floor(x / 2), Math.floor(y / 2), 72);
      if (c > 0.78) return f > 0.5 ? 0x7c7a74 : 0x68665f;
      return grain(DIRT, 73)(x, y);
    }),
  red_sand: () => new Tile().fill(grain([0xb9632c, 0xa85624, 0xc77237, 0xd8894a], 81)),
  clay: () =>
    new Tile().fill((x, y) => {
      const c = n2(Math.floor(x / 4), Math.floor(y / 2), 91);
      return c > 0.7 ? 0xa6acba : c < 0.25 ? 0x969cab : 0x9fa5b3;
    }),
  terracotta: () => new Tile().fill(grain([0x985e43, 0x8e573d, 0xa0664a, 0x86503a], 101, 4, 3)),
  terracotta_orange: () =>
    new Tile().fill(grain([0xa1542a, 0x974e27, 0xab5c30, 0x8e4822], 102, 4, 3)),
  terracotta_yellow: () =>
    new Tile().fill(grain([0xb9842a, 0xae7b25, 0xc28d31, 0xa37222], 103, 4, 3)),
  terracotta_white: () =>
    new Tile().fill(grain([0xd1b2a1, 0xc8a898, 0xd9bba9, 0xbd9f8f], 104, 4, 3)),
  terracotta_light_gray: () =>
    new Tile().fill(grain([0x876a61, 0x7e625a, 0x8f726a, 0x765c53], 105, 4, 3)),
  terracotta_brown: () =>
    new Tile().fill(grain([0x4d3324, 0x472f21, 0x553827, 0x3f291c], 106, 4, 3)),
  terracotta_red: () => new Tile().fill(grain([0x8f3d2e, 0x86382a, 0x974333, 0x7c3326], 107, 4, 3)),
  granite: () => speckled([0x9a6a55, 0x8a5c48, 0xab7b64, 0xc49a86], 111, 0.12),
  diorite: () => speckled([0xbcbcbc, 0xa8a8aa, 0xd2d2d0, 0x7e7e80], 112, 0.1),
  andesite: () => speckled([0x858586, 0x767677, 0x939394, 0x6a6a6b], 113, 0.08),
  spruce_log: () => bark(WOOD.spruce.bark, 121),
  spruce_log_top: () => rings(WOOD.spruce.bark, WOOD.spruce.wood, 122),
  spruce_planks: () => planks(WOOD.spruce.planks, 123),
  spruce_leaves: () => needles([0x3b5a38, 0x2e4a2e, 0x4a6b45, 0x24392a], 124),
  birch_log_top: () => rings(WOOD.birch.bark, WOOD.birch.wood, 131),
  birch_planks: () => planks(WOOD.birch.planks, 132),
  birch_leaves: () => leaves([0x6b9a45, 0x5a863a, 0x7cab52, 0x8fbd60], 133),
  jungle_log: () => bark(WOOD.jungle.bark, 141),
  jungle_log_top: () => rings(WOOD.jungle.bark, WOOD.jungle.wood, 142),
  jungle_planks: () => planks(WOOD.jungle.planks, 143),
  jungle_leaves: () => leaves([0x3f9a2a, 0x2f8420, 0x52ad36, 0x6cc446], 144, 0.06),
  acacia_log: () => bark(WOOD.acacia.bark, 151),
  acacia_log_top: () => rings(WOOD.acacia.bark, WOOD.acacia.wood, 152),
  acacia_planks: () => planks(WOOD.acacia.planks, 153),
  acacia_leaves: () => leaves([0x6f8a2f, 0x5e7627, 0x809c38, 0x94ad44], 154, 0.14),
  dark_oak_log: () => bark(WOOD.dark_oak.bark, 161),
  dark_oak_log_top: () => rings(WOOD.dark_oak.bark, WOOD.dark_oak.wood, 162),
  dark_oak_planks: () => planks(WOOD.dark_oak.planks, 163),
  dark_oak_leaves: () => leaves([0x3c6b25, 0x2f5a1d, 0x4a7c2d, 0x5a8c36], 164, 0.07),
  fern: () =>
    plant((t) => {
      for (const [x0, lean] of [
        [4, -1],
        [7, 0],
        [11, 1],
      ] as const)
        for (let i = 0; i < 12; i++) {
          const x = x0 + Math.round(lean * (i / 5)),
            y = 15 - i;
          t.set(x, y, 0x4f8a36);
          if (i > 2 && i % 2 === 0) {
            t.set(x - 1, y, 0x5f9c40);
            t.set(x + 1, y - 1, 0x3f7429);
          }
        }
    }),
  dead_bush: () =>
    plant((t) => {
      const c = [0x7a5a2c, 0x946f3a, 0x5e441f];
      for (let i = 0; i < 7; i++) t.set(7 + (i > 4 ? 1 : 0), 15 - i, c[0]);
      for (let i = 0; i < 5; i++) {
        t.set(7 - i, 10 - i, c[1]);
        t.set(8 + i, 9 - i, c[1]);
        t.set(5 - Math.floor(i / 2), 12 - i, c[2]);
        t.set(10 + Math.floor(i / 2), 12 - i, c[2]);
      }
      t.set(3, 5, c[0]);
      t.set(12, 4, c[0]);
    }),
  poppy: () => flower([0xd32a1e, 0xb01e16, 0xe8483a], 0x2a1a10, 'cup'),
  blue_orchid: () => flower([0x2ea8e0, 0x1f86c0, 0x6ccaf0], 0x9ad8f0, 'star'),
  allium: () => flower([0xb57ae0, 0x9a5cc8, 0xd2a2f0], 0xe8d0f8, 'ball'),
  red_tulip: () => flower([0xd8341e, 0xc02614, 0xf06040], 0, 'tulip'),
  brown_mushroom: () => mushroom([0x9a7456, 0x8a6648, 0x6e503a], false),
  red_mushroom: () => mushroom([0xd02a24, 0xb81f1b, 0x8e1814], true),
  lily_pad: () =>
    new Tile().fill((x, y) => {
      const dx = x - 7.5,
        dy = y - 7.5,
        d = dx * dx + dy * dy;
      if (d > 52) return null;
      if (dx > 0 && Math.abs(dy) < dx * 0.35) return null; // the notch
      const vein = Math.abs(dx) < 0.6 || Math.abs(dy) < 0.6 || Math.abs(dx - dy) < 0.6;
      return vein ? 0x2f6a1c : d > 40 ? 0x2c5f1a : n2(x, y, 171) > 0.7 ? 0x4e8f2e : 0x3f7d25;
    }),
  cobweb: () =>
    plant((t) => {
      const c = 0xeeeeee;
      for (let i = 0; i < 16; i++) {
        t.set(i, i, c, 200);
        t.set(15 - i, i, c, 200);
        t.set(7, i, c, 170);
        t.set(i, 8, c, 170);
      }
      for (const r of [3, 6])
        for (let a = 0; a < 32; a++) {
          const x = Math.round(7.5 + Math.cos((a / 32) * Math.PI * 2) * r),
            y = Math.round(7.5 + Math.sin((a / 32) * Math.PI * 2) * r);
          t.set(x, y, c, 150);
        }
    }),
  packed_ice: () =>
    new Tile().fill((x, y) => {
      const crack = Math.abs(((x * 3 + y * 2) % 13) - 6) === 0 && n2(x, y, 181) > 0.3;
      if (crack) return 0xeaf4ff;
      const c = n2(Math.floor(x / 3), Math.floor(y / 3), 182);
      return c > 0.66 ? 0x98b8e8 : c < 0.3 ? 0x7fa3dc : 0x8cade2;
    }),
  mossy_stone_bricks: () => {
    const t = bricks([0x7d7d7b, 0x737371, 0x8d8d8a, 0x686866], 0x565654, 191);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++)
        if (
          n2(Math.floor(x / 2), Math.floor(y / 2), 192) > 0.62 ||
          (y % 4 === 3 && n2(x, y, 193) > 0.4)
        )
          t.set(x, y, n2(x, y, 194) > 0.5 ? 0x5a7a3a : 0x4b6a30);
    return t;
  },
  cracked_stone_bricks: () => {
    const t = bricks([0x7d7d7b, 0x737371, 0x8d8d8a, 0x686866], 0x565654, 201);
    let x = 3,
      y = 0;
    while (y < 16) {
      t.set(x, y, 0x444442);
      y++;
      x += n2(x, y, 202) > 0.6 ? 1 : n2(x, y, 203) > 0.7 ? -1 : 0;
    }
    for (let i = 0; i < 6; i++) t.set(10 + i, 9 + Math.floor(i / 2), 0x4a4a48);
    return t;
  },
  chiseled_sandstone: () =>
    new Tile().fill((x, y) => {
      if (y < 2 || y > 13) return y % 2 ? 0xc9b681 : 0xd9c893;
      const dx = Math.abs(x - 7.5),
        dy = Math.abs(y - 7.5);
      const sun =
        Math.round(Math.sqrt(dx * dx + dy * dy)) === 3 ||
        (dx < 0.6 && dy < 5) ||
        (dy < 0.6 && dx < 5);
      return sun ? 0xa8935c : n2(x, y, 211) > 0.85 ? 0xcfbd88 : 0xdccb96;
    }),
  hay_side: () =>
    new Tile().fill((x, y) => {
      if (y === 3 || y === 12) return x % 2 ? 0x6e4a1c : 0x86602a;
      const straw = n2(x, Math.floor(y / 3), 221);
      return straw > 0.7 ? 0xd8b23a : straw < 0.25 ? 0xa8862a : 0xc49e30;
    }),
  hay_top: () =>
    new Tile().fill((x, y) => {
      const d = Math.hypot(x - 7.5, y - 7.5) + (n2(x, y, 231) - 0.5);
      return Math.floor(d) % 2 ? 0xb89428 : n2(x, y, 232) > 0.7 ? 0xd4b03a : 0xc6a232;
    }),
  oak_door_lower: () => doorArt(WOOD.oak.planks, false),
  oak_door_upper: () => doorArt(WOOD.oak.planks, true),
  spruce_door_lower: () => doorArt(WOOD.spruce.planks, false),
  spruce_door_upper: () => doorArt(WOOD.spruce.planks, true),
  acacia_door_lower: () => doorArt(WOOD.acacia.planks, false),
  acacia_door_upper: () => doorArt(WOOD.acacia.planks, true),
  mycelium_top: () =>
    new Tile().fill((x, y) => {
      const c = n2(Math.floor(x / 2), Math.floor(y / 2), 241),
        f = n2(x, y, 242);
      if (f > 0.92) return 0xb8a8b8;
      return c > 0.66 ? 0x7e6a82 : c < 0.3 ? 0x5f5064 : 0x6f5e74;
    }),
  mycelium_side: () =>
    edge(
      dirt(),
      (x, y) => (n2(x, y, 243) > 0.5 ? 0x6f5e74 : 0x5f5064),
      (x) => 2 + Math.floor(n2(x, 0, 244) * 3),
    ),
  stone_slab_side: () =>
    new Tile().fill((x, y) => {
      if (y === 0 || y === 15 || y === 7) return 0x8a8a88;
      if (y === 8) return 0x6e6e6c;
      return n2(x, y, 251) > 0.85 ? 0xa8a8a6 : 0x9e9e9c;
    }),
  stone_slab_top: () =>
    new Tile().fill((x, y) => {
      if (x === 0 || y === 0 || x === 15 || y === 15) return 0x8a8a88;
      return n2(x, y, 252) > 0.85 ? 0xb0b0ae : 0xa6a6a4;
    }),
  stone_bricks: () => bricks([0x7d7d7b, 0x737371, 0x8d8d8a, 0x686866], 0x585856, 261),
  snow: () =>
    new Tile().fill((x, y) => {
      const c = n2(Math.floor(x / 3), Math.floor(y / 2), 271);
      return c > 0.72 ? 0xffffff : c < 0.24 ? 0xe4eef2 : 0xf2f8fa;
    }),
  sandstone_side: () =>
    new Tile().fill((x, y) => {
      if (y < 3) return n2(x, y, 281) > 0.5 ? 0xe0cf9c : 0xd8c792;
      if (y === 3 || y === 11) return 0xb8a36c;
      if (y > 11) return n2(x, y, 282) > 0.6 ? 0xcab681 : 0xd2bf8a;
      return n2(x, Math.floor(y / 2), 283) > 0.75 ? 0xcfbd88 : 0xd9c893;
    }),
  sandstone_top: () => new Tile().fill(grain([0xdfcf9c, 0xd8c792, 0xe6d8a8, 0xcfbd88], 291, 4, 4)),
  sandstone_bottom: () =>
    new Tile().fill((x, y) => {
      const crack = (x + y * 3) % 11 === 0 && n2(x, y, 301) > 0.4;
      return crack ? 0xb8a36c : grain([0xd6c48e, 0xcdb983, 0xdfcf9c, 0xc2ad76], 302)(x, y);
    }),
  double_tall_grass: () =>
    plant((t) => {
      for (let blade = 0; blade < 7; blade++) {
        const x0 = 1 + blade * 2,
          h = 8 + Math.floor(n2(blade, 0, 311) * 8);
        for (let i = 0; i < h; i++)
          t.set(
            x0 + Math.round((n2(blade, 1, 312) - 0.5) * (i / 5)),
            15 - i,
            i > h - 3 ? 0x7fb055 : 0x5e9a3c,
          );
      }
    }),
  sunflower: () => flower([0xf2c81e, 0xe0b010, 0xf8dc50], 0x6a4a1a, 'ball'),
  snowy_leaves: () => {
    const t = leaves([0x4a6b45, 0x3b5a38, 0x5a7d52, 0x2e4a2e], 321);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) if (t.alpha(x, y) && n2(x, y, 322) > 0.72) t.set(x, y, 0xf2f8fa);
    return t;
  },
  ice: () =>
    new Tile().fill((x, y) => {
      if ((x + y) % 9 === 0 && x > 2 && x < 13) return 0xe8f4ff;
      return n2(Math.floor(x / 4), Math.floor(y / 4), 331) > 0.6 ? 0x9ec4f4 : 0x8cb6ee;
    }, 200),
  gravel: () =>
    new Tile().fill((x, y) => {
      const pebble = n2(Math.floor(x / 2), Math.floor((y + (x % 2)) / 2), 341);
      return pebble > 0.78
        ? 0xa39c98
        : pebble < 0.2
          ? 0x6a6362
          : pebble > 0.55
            ? 0x8b8482
            : 0x7c7574;
    }),
  mossy_cobblestone: () => {
    const t = new Tile().fill((x, y) => {
      const xx = (x + Math.floor(y / 5) * 3) % 7,
        yy = y % 5;
      return xx === 0 || yy === 0 ? 0x535f59 : yy === 1 ? 0x99a298 : xx === 6 ? 0x758078 : 0x88938b;
    });
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++)
        if (n2(Math.floor(x / 3), Math.floor(y / 2), 351) > 0.6)
          t.set(x, y, n2(x, y, 352) > 0.5 ? 0x5a7a3a : 0x4b6a30);
    return t;
  },
  mushroom_stem: () =>
    new Tile().fill((x, y) => {
      const f = n2(x, Math.floor(y / 3), 361);
      return f > 0.8 ? 0xcfc8b4 : f < 0.2 ? 0xe8e2d0 : 0xdcd6c2;
    }),
  mushroom_pores: () =>
    new Tile().fill((x, y) => (n2(x, y, 371) > 0.55 && (x + y) % 2 === 0 ? 0xb8ad94 : 0xd8ceb4)),
  brown_mushroom_cap: () =>
    new Tile().fill(grain([0x8e6a4c, 0x7c5c40, 0x9c7756, 0x6e5038], 381, 3, 3)),
  red_mushroom_cap: () =>
    new Tile().fill((x, y) => {
      const spot =
        n2(Math.floor(x / 3), Math.floor(y / 3), 391) > 0.8 && x % 3 !== 2 && y % 3 !== 2;
      return spot ? 0xf0ece0 : n2(x, y, 392) > 0.8 ? 0xb81f1b : 0xc92a24;
    }),
  vine: () =>
    plant((t) => {
      for (let i = 0; i < 5; i++) {
        let x = 1 + i * 3;
        for (let y = 0; y < 16; y++) {
          if (n2(i, y, 401) > 0.25) t.set(x, y, n2(x, y, 402) > 0.5 ? 0x3f7a2a : 0x4f8f33);
          if (n2(i, y, 403) > 0.8) x += n2(i, y, 404) > 0.5 ? 1 : -1;
        }
      }
    }),
};

function doorArt(p: Palette, upper: boolean): Tile {
  const frame = p[3];
  return new Tile().fill((x, y) => {
    if (x === 0 || x === 15 || (upper ? y === 0 : y === 15)) return frame;
    if (upper && x > 2 && x < 13 && y > 2 && y < 10 && x !== 7 && x !== 8 && y !== 6) return null;
    if (upper && (x === 7 || x === 8 || y === 6) && x > 1 && x < 14 && y > 1 && y < 11)
      return frame;
    if (!upper && y > 2 && y < 13 && x > 2 && x < 13) {
      if (x === 3 || x === 12 || y === 3 || y === 12) return p[2];
      return x % 3 === 0 ? p[1] : p[0];
    }
    if (!upper && x === 12 && y === 1) return 0x2a2a2a;
    return x % 4 === 0 ? p[1] : p[0];
  });
}

/** Pixels for a tile of the 0.10 band, or null when the tile is not one of them. */
export function extraTilePixels(tile: number): Uint8ClampedArray | null {
  const name = extraTileName(tile);
  if (!name) return null;
  const painter =
    (PAINTERS as Partial<Record<ExtraTileName, () => Tile>>)[name] ?? H_PAINTERS[name as HTileName];
  return painter().data;
}
