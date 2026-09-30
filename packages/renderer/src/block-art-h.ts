/**
 * Round H block tiles: mineral blocks, bricks and quartz, the sixteen wools, iron bars, the
 * jack o'lantern, five saplings, the new crops and stems, the cake, the ladder and the trapdoor.
 * Same painter conventions as `block-art.ts`; original art, deterministic per tile name.
 */
import type { HTileName } from '../../content/src/tiles';
import { WOOL_COLORS } from '../../content/src/tiles';
import { pixelNoise } from './pixel-art';
import { Tile, bricks, grain, planks, plant, stem, WOOD, type Palette } from './block-art';

const n2 = (x: number, y: number, seed: number) => pixelNoise(x, y, seed);
function shade(c: number, f: number): number {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return (ch((c >> 16) & 255) << 16) | (ch((c >> 8) & 255) << 8) | ch(c & 255);
}
const STONE: Palette = [0x7f7f7f, 0x737373, 0x8a8a8a, 0x686868];

/** Ore: stone with a few clustered gems, each lit on its top-left pixel. */
function ore(gem: Palette, seed: number): Tile {
  const t = new Tile().fill(grain(STONE, seed));
  const spots: [number, number][] = [
    [3, 3],
    [10, 2],
    [6, 8],
    [12, 10],
    [3, 12],
  ];
  for (const [sx, sy] of spots)
    for (const [dx, dy, tone] of [
      [0, 0, 2],
      [1, 0, 0],
      [0, 1, 0],
      [1, 1, 1],
      [2, 1, 1],
      [1, 2, 1],
    ] as const)
      if (n2(sx + dx, sy + dy, seed) > 0.18) t.set(sx + dx, sy + dy, gem[tone]);
  return t;
}
/** A block of a precious material: bevelled rim and a pressed pattern inside. */
function mineral(p: Palette, pattern: 'facets' | 'grid' | 'speckle', seed: number): Tile {
  return new Tile().fill((x, y) => {
    if (x === 0 || y === 0) return p[2];
    if (x === 15 || y === 15) return p[3];
    if (pattern === 'grid' && (x % 5 === 0 || y % 5 === 0)) return p[3];
    if (pattern === 'facets') {
      const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
      if (Math.abs(d - 7) < 0.6) return p[2];
      if (Math.abs(d - 3.5) < 0.6) return p[3];
    }
    const f = n2(x, y, seed);
    if (pattern === 'speckle' && f > 0.82) return p[2];
    return f < 0.2 ? p[1] : p[0];
  });
}
/** Wool: soft woven rows with a little fuzz. */
function wool(color: number, seed: number): Tile {
  return new Tile().fill((x, y) => {
    const weave = (x + (y % 2 ? 2 : 0)) % 4 < 2 ? 1.04 : 0.96;
    const fuzz = n2(x, y, seed);
    const f = weave * (fuzz > 0.85 ? 1.08 : fuzz < 0.15 ? 0.9 : 1);
    return shade(color, f);
  });
}
function sapling(trunk: number, leaf: Palette, tall: boolean): Tile {
  return plant((t) => {
    stem(t, 7, tall ? 7 : 9, 15, trunk);
    stem(t, 8, 12, 15, shade(trunk, 0.8));
    const top = tall ? 1 : 3;
    for (let y = top; y < (tall ? 11 : 11); y++) {
      const half = tall ? Math.floor((y - top) / 2) + 1 : 4 - Math.abs(y - 7) / 1.5;
      for (let x = Math.round(7.5 - half); x <= Math.round(7.5 + half); x++)
        if (n2(x, y, trunk & 255) > 0.22) t.set(x, y, leaf[(x + y) % 3]);
    }
  });
}
/** Crop stage: `stage` 0..3; the ripe stage shows the root or bulb at the foot of the leaves. */
function crop(stage: number, leaf: Palette, root: number | null): Tile {
  return plant((t) => {
    const h = [3, 6, 9, 11][stage];
    for (const x0 of [2, 6, 10, 13]) {
      for (let i = 0; i < h; i++) {
        const x = x0 + (i > h / 2 ? (x0 < 8 ? -1 : 1) : 0);
        t.set(x, 15 - i, leaf[i % 3]);
        if (i > 1 && i % 3 === 0) t.set(x + (x0 < 8 ? 1 : -1), 15 - i, leaf[(i + 1) % 3]);
      }
      if (root !== null && stage === 3) {
        t.set(x0, 15, root);
        t.set(x0 + 1, 15, shade(root, 0.8));
        t.set(x0, 14, shade(root, 1.1));
      }
    }
  });
}
function stemArt(stage: number): Tile {
  const c = stage === 3 ? [0x8a7a2a, 0x9e8a34, 0x6e6020] : [0x4f8f33, 0x3f7a2a, 0x5fa040];
  return plant((t) => {
    const h = [4, 7, 10, 13][stage];
    for (let i = 0; i < h; i++) {
      const x = 7 + (i % 5 === 4 ? 1 : 0);
      t.set(x, 15 - i, c[i % 3]);
      if (i % 3 === 2) t.set(x + (i % 2 ? 1 : -1), 14 - i, c[(i + 1) % 3]);
    }
  });
}

export const WOOL_TILE_NAMES = WOOL_COLORS.map(([key]) => `wool_${key}` as const);

export const H_PAINTERS: Record<HTileName, () => Tile> = {
  emerald_ore: () => ore([0x3ce07a, 0x17a04a, 0x0a6a2e], 501),
  emerald_block: () => mineral([0x2ac867, 0x1ea356, 0x6ef0a0, 0x137a3e], 'facets', 502),
  diamond_block: () => mineral([0x5de4d6, 0x44c8bc, 0xa8fff4, 0x2a9a90], 'facets', 503),
  coal_block: () => mineral([0x1e1e1e, 0x141414, 0x3a3a3a, 0x0a0a0a], 'speckle', 504),
  redstone_block: () => mineral([0xb01810, 0x8e120c, 0xe03a2a, 0x6a0c08], 'grid', 505),
  lapis_block: () => mineral([0x2a4ea8, 0x1e3e8e, 0x5a80d8, 0x152c6a], 'speckle', 506),
  bricks: () => bricks([0x985042, 0x8a4538, 0xa85c4c, 0x7a3a30], 0xb0a494, 507),
  quartz_top: () =>
    new Tile().fill((x, y) =>
      n2(x, y, 508) > 0.85 ? 0xf2eee6 : n2(x, y, 509) < 0.15 ? 0xdcd6cc : 0xe8e3da,
    ),
  quartz_side: () =>
    new Tile().fill((x, y) =>
      y === 0 || y === 15 ? 0xd6d0c4 : n2(x, y, 510) > 0.86 ? 0xf2eee6 : 0xe6e1d8,
    ),
  quartz_pillar_side: () =>
    new Tile().fill((x) =>
      x === 0 || x === 15 || x === 5 || x === 10 ? 0xd2ccc0 : x % 5 === 1 ? 0xf2eee6 : 0xe6e1d8,
    ),
  quartz_pillar_top: () =>
    new Tile().fill((x, y) => {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      return d > 6.5 ? 0xd2ccc0 : Math.abs(d - 3.5) < 0.6 ? 0xd8d2c6 : 0xe8e3da;
    }),
  ...(Object.fromEntries(
    WOOL_COLORS.map(([key, , color], i) => [`wool_${key}`, () => wool(color, 520 + i)]),
  ) as Record<(typeof WOOL_TILE_NAMES)[number], () => Tile>),
  iron_bars: () =>
    new Tile().fill((x, y) => {
      if (x % 4 === 1) return y % 8 === 0 ? 0x5a5a5a : 0x9a9a9a;
      if (x % 4 === 2) return 0x6e6e6e;
      if (y === 0 || y === 15) return 0x7a7a7a;
      return null;
    }),
  jack_o_lantern: () =>
    new Tile().fill((x, y) => {
      const eye = (y === 5 || y === 6) && (x === 4 || x === 5 || x === 10 || x === 11);
      const nose = y === 8 && (x === 7 || x === 8);
      const mouth =
        (y === 10 && x >= 3 && x <= 12 && x !== 6 && x !== 9) || (y === 11 && x >= 4 && x <= 11);
      if (eye || nose || mouth) return y === 11 || x === 3 ? 0xf8c030 : 0xffe060;
      const rib = x % 4 === 0 ? 0.86 : 1;
      return shade(n2(x, y, 530) > 0.8 ? 0xe0801a : 0xd0701a, rib);
    }),
  spruce_sapling: () => sapling(0x4a3522, [0x3b5a38, 0x2e4a2e, 0x4a6b45], true),
  birch_sapling: () => sapling(0xd8d4c8, [0x6b9a45, 0x5a863a, 0x7cab52], false),
  jungle_sapling: () => sapling(0x584419, [0x3f9a2a, 0x2f8420, 0x52ad36], false),
  acacia_sapling: () => sapling(0x6a645c, [0x6f8a2f, 0x5e7627, 0x809c38], false),
  dark_oak_sapling: () => sapling(0x3b2d18, [0x3c6b25, 0x2f5a1d, 0x4a7c2d], false),
  carrots_0: () => crop(0, [0x3f8f2a, 0x4fa033, 0x2f7a22], null),
  carrots_1: () => crop(1, [0x3f8f2a, 0x4fa033, 0x2f7a22], null),
  carrots_2: () => crop(2, [0x3f8f2a, 0x4fa033, 0x2f7a22], null),
  carrots_3: () => crop(3, [0x3f8f2a, 0x4fa033, 0x2f7a22], 0xf08a22),
  potatoes_0: () => crop(0, [0x4f9a3a, 0x5fae46, 0x3a822c], null),
  potatoes_1: () => crop(1, [0x4f9a3a, 0x5fae46, 0x3a822c], null),
  potatoes_2: () => crop(2, [0x4f9a3a, 0x5fae46, 0x3a822c], null),
  potatoes_3: () => crop(3, [0x4f9a3a, 0x5fae46, 0x3a822c], 0xc8a460),
  beetroots_0: () => crop(0, [0x4a8a2a, 0x8a2a2a, 0x3a7a22], null),
  beetroots_1: () => crop(1, [0x4a8a2a, 0x8a2a2a, 0x3a7a22], null),
  beetroots_2: () => crop(2, [0x4a8a2a, 0x8a2a2a, 0x3a7a22], null),
  beetroots_3: () => crop(3, [0x4a8a2a, 0x8a2a2a, 0x3a7a22], 0xa81e34),
  stem_0: () => stemArt(0),
  stem_1: () => stemArt(1),
  stem_2: () => stemArt(2),
  stem_3: () => stemArt(3),
  cake_top: () =>
    new Tile().fill((x, y) => {
      if (x > 1 && x < 14 && y > 1 && y < 14 && x % 3 === 1 && y % 3 === 1 && n2(x, y, 544) > 0.55)
        return 0xc81e1e;
      return n2(x, y, 540) > 0.85 ? 0xffffff : 0xf2f0ee;
    }),
  cake_side: () =>
    new Tile().fill((x, y) => {
      if (y < 8) return null;
      if (y < 10) return (x + (y === 9 ? 1 : 0)) % 3 === 0 && y === 9 ? 0xe0dcd8 : 0xf2f0ee;
      if (y === 12) return 0xc81e1e;
      return n2(x, y, 541) > 0.8 ? 0xb07a44 : 0x9a663a;
    }),
  cake_inner: () =>
    new Tile().fill((x, y) => {
      if (y < 8) return null;
      if (y < 10) return 0xf2f0ee;
      if (y === 12) return 0xc81e1e;
      return n2(x, y, 542) > 0.7 ? 0xe0c080 : 0xd0aa66;
    }),
  cake_bottom: () => new Tile().fill((x, y) => (n2(x, y, 543) > 0.8 ? 0x8a5a2e : 0x7a4e28)),
  ladder: () =>
    new Tile().fill((x, y) => {
      if (x === 2 || x === 13) return WOOD.oak.planks[2];
      if (x === 3 || x === 12) return WOOD.oak.planks[0];
      if (x > 3 && x < 12 && y % 4 === 1) return WOOD.oak.planks[1];
      if (x > 3 && x < 12 && y % 4 === 2) return WOOD.oak.planks[3];
      return null;
    }),
  oak_trapdoor: () => {
    const base = planks(WOOD.oak.planks, 550);
    return new Tile().fill((x, y) => {
      if (x > 2 && x < 13 && (y === 3 || y === 4 || y === 11 || y === 12) && x !== 7 && x !== 8)
        return null;
      const i = (y * 16 + x) * 4;
      return (base.data[i] << 16) | (base.data[i + 1] << 8) | base.data[i + 2];
    });
  },
};
