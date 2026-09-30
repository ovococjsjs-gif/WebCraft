/**
 * Round I block tiles (0.13): concrete and its powder, stained glass, the ten new terracottas,
 * sixteen glazed patterns, polished stones, red sandstone, prismarine, a sponge, slime, bone and
 * nether wart blocks, and the doors and trapdoors of the woods that had none. Same conventions
 * as `block-art.ts`: original art, deterministic per tile name, nothing is loaded from disk.
 */
import { NEW_TERRACOTTA, WOOL_COLORS, type ITileName } from '../../content/src/tiles';
import { pixelNoise } from './pixel-art';
import { Tile, bricks, doorArt, grain, planks, WOOD } from './block-art';

const n2 = (x: number, y: number, seed: number) => pixelNoise(x, y, seed);
const channel = (c: number, shift: number) => (c >> shift) & 255;
export function shade(c: number, f: number): number {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return (ch(channel(c, 16)) << 16) | (ch(channel(c, 8)) << 8) | ch(channel(c, 0));
}
/** Linear blend of two colours; `t` 0 gives `a`, 1 gives `b`. */
export function mix(a: number, b: number, t: number): number {
  const m = (shift: number) => Math.round(channel(a, shift) * (1 - t) + channel(b, shift) * t);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}
const luminance = (c: number) =>
  (0.299 * channel(c, 16) + 0.587 * channel(c, 8) + 0.114 * channel(c, 0)) / 255;

/** Concrete: a flat, dense colour with only the faintest variation. */
function concrete(color: number, seed: number): Tile {
  return new Tile().fill((x, y) => {
    const f = n2(x, y, seed);
    return shade(color, f > 0.94 ? 1.045 : f < 0.06 ? 0.955 : 1);
  });
}
/** Concrete powder: soft grains, a little lighter than the block it becomes. */
function powder(color: number, seed: number): Tile {
  const soft = mix(color, 0xffffff, 0.08);
  return new Tile().fill((x, y) => {
    const clump = n2(Math.floor(x / 2), Math.floor(y / 2), seed);
    const fine = n2(x, y, seed + 5);
    return shade(soft, 1 + (clump - 0.5) * 0.17 + (fine - 0.5) * 0.11);
  });
}
/** Stained glass: a tinted pane with a darker rim and a little diagonal glint. */
function stainedGlass(color: number, seed: number): Tile {
  const t = new Tile();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      if (edge) t.set(x, y, shade(color, 0.72), 238);
      else t.set(x, y, n2(x, y, seed) > 0.88 ? mix(color, 0xffffff, 0.18) : color, 156);
    }
  const glint = mix(color, 0xffffff, 0.62);
  for (const [gx, gy] of [
    [3, 3],
    [4, 4],
    [5, 5],
    [3, 7],
    [4, 8],
    [10, 11],
    [11, 12],
  ])
    t.set(gx, gy, glint, 214);
  return t;
}
/** Terracotta in one of the ten new colours, grained like the mesa ones. */
function clay(color: number, seed: number): Tile {
  return new Tile().fill(
    grain([color, shade(color, 0.94), shade(color, 1.07), shade(color, 0.87)], seed, 4, 3),
  );
}
const TERRACOTTA_HEX: Record<(typeof NEW_TERRACOTTA)[number], number> = {
  magenta: 0x95586c,
  light_blue: 0x716c89,
  lime: 0x677535,
  pink: 0xa14e4e,
  gray: 0x392a23,
  cyan: 0x575b5b,
  purple: 0x764656,
  blue: 0x4a3b5b,
  green: 0x4c532a,
  black: 0x251610,
};

/* ------------------------------------------------------------ glazed terracotta */
type Symbol4 = 0 | 1 | 2 | 3; // base, light, dark, trim
interface Motif {
  /** Pinwheel layout: each quadrant is the previous one turned a quarter. Default: mirrored. */
  readonly rotate?: boolean;
  /**
   * (a, b) run 0..7 from the centre of the tile to its edge, in the mirrored layout; in the
   * rotated layout they are the coordinates inside the top-left quadrant, centre at (7, 7).
   */
  readonly at: (a: number, b: number) => Symbol4;
}
const ringTable = (table: readonly Symbol4[], index: number): Symbol4 =>
  table[Math.min(index, table.length - 1)];
/** Sixteen patterns; the colour decides which one a block gets. */
export const GLAZE_MOTIFS: readonly Motif[] = [
  // 0: nested diamonds
  { at: (a, b) => ([3, 1, 0, 2] as const)[(a + b) % 4] },
  // 1: nested squares
  { at: (a, b) => ringTable([3, 0, 1, 1, 0, 2, 2, 3], Math.max(a, b)) },
  // 2: target rings
  {
    at: (a, b) =>
      ringTable([3, 3, 0, 1, 1, 0, 2, 2, 0, 3, 3], Math.round(Math.hypot(a + 0.5, b + 0.5))),
  },
  // 3: checker with a bright heart
  {
    at: (a, b) => {
      if (a < 2 && b < 2) return 3;
      if (a === 7 || b === 7) return 2;
      return ((a >> 1) + (b >> 1)) % 2 ? 1 : 0;
    },
  },
  // 4: a cross on a dark ground
  {
    at: (a, b) => {
      if (a < 2 && b < 2) return 3;
      if (a < 2 || b < 2) return 1;
      return a > 4 && b > 4 ? 2 : 0;
    },
  },
  // 5: plaid
  {
    at: (a, b) => {
      if (a % 4 === 3 || b % 4 === 3) return 3;
      return a % 4 < 2 === b % 4 < 2 ? 1 : 0;
    },
  },
  // 6: zigzag rows
  {
    at: (a, b) => {
      if (b % 4 === 3) return 2;
      const zig = b % 4 < 2 ? b % 2 : 1 - (b % 2);
      return (a + zig) % 4 < 2 ? 1 : 0;
    },
  },
  // 7: studs on a grid
  {
    at: (a, b) => {
      if (a % 4 === 3 || b % 4 === 3) return 2;
      return (a % 4 === 1 || a % 4 === 2) && (b % 4 === 1 || b % 4 === 2) ? 3 : 0;
    },
  },
  // 8: pinwheel of four triangles
  {
    rotate: true,
    at: (a, b) => (a === 0 || b === 0 ? 2 : a === b ? 3 : a > b ? 1 : 0),
  },
  // 9: square spiral
  {
    rotate: true,
    at: (a, b) => {
      const ring = Math.min(a, b);
      if (ring % 2 === 0) return a >= b ? 1 : 3;
      return a >= b ? 0 : 2;
    },
  },
  // 10: rays of the sun
  {
    at: (a, b) => {
      const r = Math.hypot(a + 0.5, b + 0.5);
      if (r < 2.2) return 3;
      if (r < 3.3) return 2;
      const sector = Math.floor(Math.atan2(b + 0.5, a + 0.5) / (Math.PI / 8));
      return sector % 2 === 0 ? 1 : 0;
    },
  },
  // 11: waves
  {
    at: (a, b) => {
      const w = b + Math.round(1.7 * Math.sin(a * 0.85)) + 8;
      if (w % 4 === 2) return 2;
      return w % 4 < 2 ? 1 : 0;
    },
  },
  // 12: a four-pointed star
  {
    at: (a, b) => {
      if (a + b <= 1) return 3;
      const arm = Math.min(a, b) < 1.5 && Math.max(a, b) <= 6;
      if (arm) return 1;
      return a + b === 5 || a + b === 6 ? 2 : 0;
    },
  },
  // 13: bricks
  {
    at: (a, b) => {
      const shift = (b >> 1) % 2 ? 2 : 0;
      if (b % 2 === 1 && b !== 7) return 2;
      if ((a + shift) % 4 === 3) return 2;
      return (a + shift) % 8 < 4 ? 1 : 0;
    },
  },
  // 14: frame around a disc
  {
    at: (a, b) => {
      const m = Math.max(a, b);
      if (m === 7) return 3;
      if (Math.hypot(a + 0.5, b + 0.5) < 3) return 2;
      return m >= 4 && m <= 5 ? 1 : 0;
    },
  },
  // 15: four petals
  {
    rotate: true,
    at: (a, b) => {
      const x = 7 - a,
        y = 7 - b; // distance from the tile centre, 0..7
      if (x < 1.5 && y < 1.5) return 3;
      const petal = Math.hypot(x - 3.2, y - 3.2) < 3.3;
      if (petal) return Math.hypot(x - 3.2, y - 3.2) < 1.6 ? 3 : 1;
      return x + y > 9 ? 2 : 0;
    },
  },
];
function glazed(color: number, index: number): Tile {
  const motif = GLAZE_MOTIFS[index % GLAZE_MOTIFS.length];
  const base = shade(color, 0.96);
  const light = mix(color, 0xffffff, 0.42);
  const dark = shade(color, 0.56);
  const trim = luminance(color) > 0.6 ? shade(color, 0.42) : mix(color, 0xfff6e8, 0.86);
  const palette = [base, light, dark, trim] as const;
  return new Tile().fill((x, y) => {
    let a: number, b: number;
    if (motif.rotate) {
      // Turn the pattern of the top-left quadrant into the quadrant the pixel is in.
      const right = x >= 8,
        low = y >= 8;
      const lx = right ? x - 8 : x,
        ly = low ? y - 8 : y;
      if (!right && !low) [a, b] = [lx, ly];
      else if (right && !low) [a, b] = [7 - ly, lx];
      else if (right && low) [a, b] = [7 - lx, 7 - ly];
      else [a, b] = [ly, 7 - lx];
    } else {
      a = 7 - Math.min(x, 15 - x);
      b = 7 - Math.min(y, 15 - y);
    }
    const tone = palette[motif.at(a, b)];
    // A whisper of noise keeps the glaze from looking printed.
    return shade(tone, 0.985 + n2(x, y, 700 + index) * 0.03);
  });
}

/* ------------------------------------------------------------ stones and minerals */
function polished(palette: readonly number[], seed: number): Tile {
  return new Tile().fill((x, y) => {
    const f = n2(x, y, seed);
    const tone = f > 0.92 ? palette[2] : f < 0.1 ? palette[1] : palette[0];
    if (x === 0 || y === 0) return mix(tone, 0xffffff, 0.12);
    if (x === 15 || y === 15) return shade(tone, 0.86);
    return tone;
  });
}
const RED_SANDSTONE = [0xb5602b, 0xa95a27, 0xc06a32, 0x9d5222];
function redSandstoneTop(): Tile {
  return new Tile().fill(grain(RED_SANDSTONE, 820, 4, 4));
}
function redSandstoneSide(): Tile {
  return new Tile().fill((x, y) => {
    if (y < 3) return n2(x, y, 821) > 0.5 ? 0xc06a32 : 0xb5602b;
    if (y === 3 || y === 11) return 0x8c4a20;
    if (y > 11) return n2(x, y, 822) > 0.6 ? 0xa45522 : 0xae5c28;
    return n2(x, Math.floor(y / 2), 823) > 0.75 ? 0xa95a27 : 0xb5602b;
  });
}
function redSandstoneBottom(): Tile {
  return new Tile().fill((x, y) => {
    const crack = (x + y * 3) % 11 === 0 && n2(x, y, 824) > 0.4;
    return crack ? 0x8c4a20 : grain([0xad5a26, 0xa4531f, 0xb5622c, 0x9a4c1b], 825)(x, y);
  });
}
function chiseledRedSandstone(): Tile {
  return new Tile().fill((x, y) => {
    if (y < 2 || y > 13) return y % 2 ? 0x9d5222 : 0xb5602b;
    const dx = Math.abs(x - 7.5),
      dy = Math.abs(y - 7.5);
    const sun =
      Math.round(Math.hypot(dx, dy)) === 3 || (dx < 0.6 && dy < 5) || (dy < 0.6 && dx < 5);
    return sun ? 0x8c4a20 : n2(x, y, 826) > 0.85 ? 0xa95a27 : 0xb96430;
  });
}
function prismarine(seed: number): Tile {
  return new Tile().fill((x, y) => {
    const patch = n2(Math.floor(x / 3), Math.floor(y / 3), seed);
    const fine = n2(x, y, seed + 9);
    if (fine > 0.9) return 0x8fd6c2;
    return patch > 0.66 ? 0x7cc3ae : patch < 0.3 ? 0x4f8a7c : 0x63a394;
  });
}
function darkPrismarine(): Tile {
  return new Tile().fill((x, y) => {
    const patch = n2(Math.floor(x / 3), Math.floor(y / 2), 841);
    const fine = n2(x, y, 842);
    if (fine > 0.92) return 0x4c8a73;
    return patch > 0.7 ? 0x3c6e5c : patch < 0.25 ? 0x284a3e : 0x335c4d;
  });
}
function seaLantern(): Tile {
  return new Tile().fill((x, y) => {
    const lx = x % 8,
      ly = y % 8;
    if (lx === 0 || ly === 0) return 0x86b6a6;
    if (lx === 7 || ly === 7) return 0xa9d1c2;
    const d = Math.max(Math.abs(lx - 3.5), Math.abs(ly - 3.5));
    const core = d < 1.6 ? 0xf2fffa : d < 2.6 ? 0xd5f2e7 : 0xb9e0d2;
    return n2(x, y, 850) > 0.9 ? mix(core, 0xffffff, 0.4) : core;
  });
}
function sponge(wet: boolean): Tile {
  const base = wet
    ? [0xa39a3c, 0x968d33, 0xb0a744, 0x7d7528]
    : [0xcdc24e, 0xc0b542, 0xd9cf62, 0x8f8a2f];
  const holes = wet ? 0x5f6a3a : 0x8f8a2f;
  return new Tile().fill((x, y) => {
    const hole = n2(Math.floor(x / 2), Math.floor(y / 2), wet ? 861 : 860) > 0.74;
    if (hole && n2(x, y, 862) > 0.25) return holes;
    return grain(base, wet ? 863 : 864, 2, 2)(x, y);
  });
}
function slimeBlock(): Tile {
  const t = new Tile();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const core = x >= 3 && x <= 12 && y >= 3 && y <= 12;
      if (core) {
        const f = n2(x, y, 870);
        t.set(x, y, f > 0.85 ? 0x79cf55 : f < 0.15 ? 0x4ea537 : 0x63b846, 235);
      } else {
        const rim = x === 0 || y === 0 || x === 15 || y === 15;
        t.set(x, y, rim ? 0x8fe06a : 0x7fd65b, rim ? 215 : 170);
      }
    }
  for (const [x, y] of [
    [4, 4],
    [5, 4],
    [4, 5],
  ])
    t.set(x, y, 0xc5f5a8, 245);
  return t;
}
function boneTop(): Tile {
  return new Tile().fill((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d > 6.5) return 0xd3cdb2;
    if (Math.abs(d - 4.5) < 0.6) return 0xc9c3a6;
    return n2(x, y, 880) > 0.85 ? 0xf3efdb : 0xe6e1c8;
  });
}
function boneSide(): Tile {
  return new Tile().fill((x, y) => {
    if (x === 0 || x === 15) return 0xd3cdb2;
    if (x === 5 || x === 10) return 0xc9c3a6;
    if (y % 5 === 4 && x % 5 !== 0) return 0xd8d2b8;
    return n2(x, y, 881) > 0.85 ? 0xf3efdb : 0xe6e1c8;
  });
}
function witheredWart(): Tile {
  return new Tile().fill((x, y) => {
    const knob = n2(Math.floor(x / 2), Math.floor(y / 2), 890);
    const fine = n2(x, y, 891);
    if (knob > 0.8) return fine > 0.5 ? 0xa1322a : 0x8c2820;
    if (knob < 0.2) return 0x5c0f0f;
    return fine > 0.85 ? 0x8a2a22 : 0x741a18;
  });
}
/** Trapdoor: the planks of the wood, with a window of slats cut out of the middle. */
function trapdoorArt(palette: readonly number[], seed: number): Tile {
  const base = planks(palette, seed);
  return new Tile().fill((x, y) => {
    if (x > 2 && x < 13 && (y === 3 || y === 4 || y === 11 || y === 12) && x !== 7 && x !== 8)
      return null;
    const i = (y * 16 + x) * 4;
    return (base.data[i] << 16) | (base.data[i + 1] << 8) | base.data[i + 2];
  });
}

type ColouredTile = Extract<
  ITileName,
  `concrete_${string}` | `stained_glass_${string}` | `glazed_${string}` | `terracotta_${string}`
>;
const COLOURED = Object.fromEntries([
  ...WOOL_COLORS.map(([key, , color], i) => [`concrete_${key}`, () => concrete(color, 600 + i)]),
  ...WOOL_COLORS.map(([key, , color], i) => [
    `concrete_powder_${key}`,
    () => powder(color, 620 + i),
  ]),
  ...WOOL_COLORS.map(([key, , color], i) => [
    `stained_glass_${key}`,
    () => stainedGlass(color, 640 + i),
  ]),
  ...WOOL_COLORS.map(([key, , color], i) => [`glazed_${key}`, () => glazed(color, i)]),
  ...NEW_TERRACOTTA.map((key, i) => [
    `terracotta_${key}`,
    () => clay(TERRACOTTA_HEX[key], 660 + i),
  ]),
]) as Record<ColouredTile, () => Tile>;

export const I_PAINTERS: Record<ITileName, () => Tile> = {
  ...COLOURED,
  polished_granite: () => polished([0x9d6d58, 0x8e604c, 0xb07f68], 800),
  polished_diorite: () => polished([0xc2c2c2, 0xb0b0b2, 0xd6d6d4], 801),
  polished_andesite: () => polished([0x8b8b8c, 0x7c7c7d, 0x98989a], 802),
  red_sandstone_top: redSandstoneTop,
  red_sandstone_side: redSandstoneSide,
  red_sandstone_bottom: redSandstoneBottom,
  chiseled_red_sandstone: chiseledRedSandstone,
  prismarine: () => prismarine(840),
  prismarine_bricks: () => bricks([0x63ab9a, 0x58a08e, 0x72bba9, 0x4a8c7c], 0x3f7565, 843),
  dark_prismarine: darkPrismarine,
  sea_lantern: seaLantern,
  sponge: () => sponge(false),
  wet_sponge: () => sponge(true),
  slime_block: slimeBlock,
  bone_block_top: boneTop,
  bone_block_side: boneSide,
  nether_wart_block: witheredWart,
  red_nether_bricks: () => bricks([0x5a1818, 0x4e1414, 0x6a2020, 0x3f1010], 0x2e0c0c, 895),
  birch_door_lower: () => doorArt(WOOD.birch.planks, false),
  birch_door_upper: () => doorArt(WOOD.birch.planks, true),
  jungle_door_lower: () => doorArt(WOOD.jungle.planks, false),
  jungle_door_upper: () => doorArt(WOOD.jungle.planks, true),
  dark_oak_door_lower: () => doorArt(WOOD.dark_oak.planks, false),
  dark_oak_door_upper: () => doorArt(WOOD.dark_oak.planks, true),
  spruce_trapdoor: () => trapdoorArt(WOOD.spruce.planks, 900),
  birch_trapdoor: () => trapdoorArt(WOOD.birch.planks, 901),
  jungle_trapdoor: () => trapdoorArt(WOOD.jungle.planks, 902),
  acacia_trapdoor: () => trapdoorArt(WOOD.acacia.planks, 903),
  dark_oak_trapdoor: () => trapdoorArt(WOOD.dark_oak.planks, 904),
};
