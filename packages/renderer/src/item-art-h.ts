/**
 * Round H item sprites: the missing 1.12 items and own art for the few that used to borrow a
 * neighbour's picture. Drawn with the same part-map painter as `item-art.ts` (light top-left
 * edges, dark bottom-right edges, dark outline), which hands its kit over so both files share
 * one look. Original art; deterministic.
 */
import { DYE_COLORS, SPRITE_H } from '../../content/src/sprites-h';

type Ramp = readonly [number, number, number, number, number];
type Spec = Record<string, Ramp | number>;
interface Options {
  speckle?: string;
  bare?: string;
  seed?: number;
}
type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'sword' | 'hoe';
export interface ArtKit {
  sprite(rows: readonly string[], spec: Spec, options?: Options): Uint8ClampedArray;
  along(fn: (u: number, v: number) => string | null): string[];
  tool(kind: ToolKind, material: 'gold'): Uint8ClampedArray;
  darken(c: number, f: number): number;
  handle(u: number, v: number, top?: number): boolean;
  readonly WOOD: Ramp;
  readonly IRON: Ramp;
  readonly GOLD: Ramp;
  readonly HELMET: readonly string[];
  readonly CHESTPLATE: readonly string[];
  readonly LEGGINGS: readonly string[];
  readonly BOOTS: readonly string[];
  readonly LUMP: readonly string[];
  readonly PILE: readonly string[];
  readonly ORB: readonly string[];
}

const ramp = (c: number, darken: ArtKit['darken']): Ramp => [
  darken(c, 0.3),
  darken(c, 0.72),
  c,
  Math.min(0xffffff, lighten(c, 1.2)),
  lighten(c, 1.45),
];
function lighten(c: number, f: number): number {
  const ch = (v: number) => Math.min(255, Math.round(v * f + (f - 1) * 40));
  return (ch((c >> 16) & 255) << 16) | (ch((c >> 8) & 255) << 8) | ch(c & 255);
}

const INGOT = [
  '................',
  '................',
  '................',
  '................',
  '..........ll....',
  '........llllll..',
  '......lllllllaa.',
  '....llllllllaaa.',
  '..llllllllaaaa..',
  '.aaallllaaaaa...',
  '.aaaaaaaaaaa....',
  '..aaaaaaaaa.....',
  '...aaaaaa.......',
  '....aaa.........',
  '................',
  '................',
];
const DIAMOND_ROWS = [
  '................',
  '................',
  '................',
  '....aabbbbcc....',
  '...aaabbbbccc...',
  '..aaaabbbbcccc..',
  '.ddddddddddddd..',
  '..ddddddddddd...',
  '...ddddddddd....',
  '....ddddddd.....',
  '.....ddddd......',
  '......ddd.......',
  '.......d........',
  '................',
  '................',
  '................',
];
const EMERALD_ROWS = [
  '................',
  '................',
  '.......aa.......',
  '......aaaa......',
  '.....aabbaa.....',
  '....aabbbbaa....',
  '....abbbbbba....',
  '....abbbbbba....',
  '....abbbbbba....',
  '....abbbbbba....',
  '....aabbbbaa....',
  '.....aabbaa.....',
  '......aaaa......',
  '.......aa.......',
  '................',
  '................',
];
const BRICK_ROWS = [
  '................',
  '................',
  '................',
  '................',
  '.......tttttt...',
  '.....tttttttt...',
  '...ttttttttts...',
  '..tttttttttss...',
  '..aaaaaaaasss...',
  '..aaaaaaaass....',
  '..aaaaaaaas.....',
  '..aaaaaaaa......',
  '................',
  '................',
  '................',
  '................',
];
const NUGGET = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '......aa........',
  '.....aaaa.aa....',
  '....aaaaaaaaa...',
  '....aaaaaaaaa...',
  '...aaaaaaaaa....',
  '...aaaaaaaaaa...',
  '....aaaaaaaa....',
  '................',
  '................',
  '................',
  '................',
];
const BOWL = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '...ssssssssss...',
  '..ssssssssssss..',
  '.bbbbbbbbbbbbbb.',
  '.bbbbbbbbbbbbbb.',
  '..bbbbbbbbbbbb..',
  '...bbbbbbbbbb...',
  '....bbbbbbbb....',
  '.....bbbbbb.....',
  '................',
  '................',
  '................',
];
const POTATO = [
  '................',
  '................',
  '................',
  '.......aaaa.....',
  '.....aaaaaaaa...',
  '....aaaaaaaaaa..',
  '...aaaaaaaaaaa..',
  '...aaaaaaaaaaa..',
  '..aaaaaaaaaaaa..',
  '..aaaaaaaaaaa...',
  '..aaaaaaaaaaa...',
  '...aaaaaaaaa....',
  '....aaaaaaa.....',
  '......aaa.......',
  '................',
  '................',
];
const BEETROOT = [
  '................',
  '.......g..g.....',
  '......gg.gg.....',
  '......gggg......',
  '.......gg.......',
  '.....aaaaaa.....',
  '....aaaaaaaa....',
  '...aaaaaaaaaa...',
  '...aaaaaaaaaa...',
  '...aaaaaaaaaa...',
  '....aaaaaaaa....',
  '.....aaaaaa.....',
  '......aaaa......',
  '.......aa.......',
  '........a.......',
  '................',
];
const SEEDS = [
  '................',
  '................',
  '................',
  '................',
  '.........aa.....',
  '....aa...aaa....',
  '....aaa...a.....',
  '.....a..........',
  '..........aa....',
  '...aa....aaa....',
  '...aaa....a.....',
  '....a...........',
  '.......aa.......',
  '.......aaa......',
  '........a.......',
  '................',
];
const SLICE = [
  '................',
  '................',
  '................',
  '..rrrrrrrrrrrr..',
  '..rffffffffffr..',
  '...rffsfffsfr...',
  '...rffffffffr...',
  '....rffsfffr....',
  '....rfffffsr....',
  '.....rffffr.....',
  '.....rfsffr.....',
  '......rffr......',
  '......rffr......',
  '.......rr.......',
  '................',
  '................',
];
const PIE = [
  '................',
  '................',
  '................',
  '................',
  '.....cccccc.....',
  '...ccffffffcc...',
  '..cffffffffffc..',
  '..cffffffffffc..',
  '.cffffffffffffc.',
  '.cccccccccccccc.',
  '.bbbbbbbbbbbbbb.',
  '..bbbbbbbbbbbb..',
  '................',
  '................',
  '................',
  '................',
];
const COOKIE = [
  '................',
  '................',
  '................',
  '.....aaaaaa.....',
  '....aaaaaaaa....',
  '...aapaaaaaaa...',
  '...aaaaaapaaa...',
  '...aaaaaaaaaa...',
  '...aaapaaaaaa...',
  '...aaaaaaapaa...',
  '...apaaaaaaaa...',
  '....aaaapaaa....',
  '.....aaaaaa.....',
  '................',
  '................',
  '................',
];
const FISH = [
  '................',
  '................',
  '................',
  '................',
  '..............tt',
  '....aaaaaa...tt.',
  '...aaaaaaaaaatt.',
  '..aeaaaaaaaaat..',
  '..aaaaaaaaaaatt.',
  '...bbbbbbbbbbtt.',
  '....bbbbbb...tt.',
  '..............tt',
  '................',
  '................',
  '................',
  '................',
];
const CASE = [
  '................',
  '................',
  '................',
  '.....cccccc.....',
  '....cffffffc....',
  '...cffffffffc...',
  '...cffffffffc...',
  '...cffffffffc...',
  '...cffffffffc...',
  '...cffffffffc...',
  '...cffffffffc...',
  '....cffffffc....',
  '.....cccccc.....',
  '................',
  '................',
  '................',
];
const CAKE = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '.....wwwwww.....',
  '...wwrwwwwrww...',
  '..wwwwwwrwwwww..',
  '..sswwwwwwwwss..',
  '..sssssssssss...',
  '..bbbbbbbbbbbb..',
  '..bbbbbbbbbbbb..',
  '..bbbbbbbbbbbb..',
  '................',
  '................',
  '................',
];
const DYE = [
  '................',
  '................',
  '................',
  '................',
  '........a.......',
  '.......aaa......',
  '......aaaaa.....',
  '.....aaaaaaa....',
  '....aaaaaaaaa...',
  '....aaaaaaaaa...',
  '....aaaaaaaaa...',
  '.....aaaaaaa....',
  '......aaaaa.....',
  '................',
  '................',
  '................',
];
const WART = [
  '................',
  '................',
  '................',
  '....aa....aa....',
  '...aaaa..aaaa...',
  '...aaaa..aaaa...',
  '....aa.aa.aa....',
  '......aaaa......',
  '.....aaaaaa.....',
  '....aa.ss.aa....',
  '.......ss.......',
  '.......ss.......',
  '......ssss......',
  '................',
  '................',
  '................',
];

/** Chainmail: the plate silhouette with every other inner pixel open. */
function chain(rows: readonly string[]): string[] {
  return rows.map((row, y) =>
    [...row]
      .map((ch, x) => {
        if (ch !== 'a') return ch;
        const inner = row[x - 1] === 'a' && row[x + 1] === 'a';
        return inner && (x + y) % 2 === 0 ? 'b' : 'a';
      })
      .join(''),
  );
}

export function roundHSprites(kit: ArtKit): Record<number, () => Uint8ClampedArray> {
  const { sprite, along, darken, WOOD, IRON, GOLD } = kit;
  const r = (c: number) => ramp(c, darken);
  const LEATHER: Ramp = [0x2a1608, 0x6a3e1c, 0x8e5a2c, 0xae7640, 0xc89458];
  const CHAIN: Ramp = [0x2a2a2a, 0x6a6a6a, 0x8e8e8e, 0xb0b0b0, 0xd0d0d0];
  const DIAMOND: Ramp = [0x0c3a36, 0x1f9a8e, 0x3fd8c9, 0x8cf4e8, 0xe4fffb];
  const EMERALD: Ramp = [0x06301a, 0x128a3e, 0x22c05a, 0x6ae890, 0xd4ffe2];
  const slice = (flesh: Ramp, seeds: number, extra: Spec = {}) =>
    sprite(
      SLICE,
      { r: [0x0e3a0a, 0x2a7a1a, 0x3a9a2a, 0x5aba3a, 0x8ada6a], f: flesh, s: seeds, ...extra },
      { bare: 's' },
    );
  const stick = (m: Ramp) =>
    sprite(
      along((u, v) => (kit.handle(u, v, 15.5) ? 'h' : null)),
      { h: m },
    );
  const out: Record<number, () => Uint8ClampedArray> = {
    [SPRITE_H.diamond]: () =>
      sprite(DIAMOND_ROWS, {
        a: DIAMOND,
        b: [DIAMOND[0], DIAMOND[2], DIAMOND[3], DIAMOND[4], 0xffffff],
        c: [DIAMOND[0], DIAMOND[1], DIAMOND[2], DIAMOND[2], DIAMOND[3]],
        d: [DIAMOND[0], DIAMOND[1], DIAMOND[2], DIAMOND[3], DIAMOND[4]],
      }),
    [SPRITE_H.goldIngot]: () =>
      sprite(INGOT, {
        l: [0x4a3006, 0xe0b22a, 0xf8d860, 0xfdeea0, 0xfffbd0],
        a: [0x4a3006, 0xa87c10, 0xd4a420, 0xe8c440, 0xf6de80],
      }),
    [SPRITE_H.sugar]: () =>
      sprite(
        kit.PILE,
        { a: [0x8a8a8a, 0xd8d8d8, 0xeeeeee, 0xf8f8f8, 0xffffff] },
        { speckle: 'a', seed: 93 },
      ),
    [SPRITE_H.gunpowder]: () =>
      sprite(
        kit.PILE,
        { a: [0x1a1a1a, 0x444444, 0x5e5e5e, 0x7a7a7a, 0x9a9a9a] },
        { speckle: 'a', seed: 94 },
      ),
    [SPRITE_H.snowball]: () =>
      sprite(
        kit.ORB,
        { a: [0x7a8a9a, 0xd6e2ea, 0xeef6fa, 0xfafdff, 0xffffff] },
        { speckle: 'a', seed: 95 },
      ),
    [SPRITE_H.blazeRod]: () => stick([0x5a3000, 0xd08a10, 0xf6c030, 0xffe070, 0xfff4c0]),
    [SPRITE_H.blazePowder]: () =>
      sprite(
        kit.PILE,
        { a: [0x6a2a00, 0xd06a10, 0xf09a20, 0xfcc850, 0xfff0a0] },
        { speckle: 'a', seed: 97 },
      ),
    [SPRITE_H.netherWart]: () =>
      sprite(WART, {
        a: [0x3a0808, 0x8a1a1a, 0xae2a26, 0xcc4a3a, 0xe8806a],
        s: [0x2a0606, 0x6a1414, 0x8a2020, 0xa03028, 0xb84a3a],
      }),
    [SPRITE_H.emerald]: () =>
      sprite(EMERALD_ROWS, {
        a: EMERALD,
        b: [EMERALD[0], EMERALD[2], EMERALD[3], EMERALD[4], 0xffffff],
      }),
    [SPRITE_H.clayBall]: () =>
      sprite(
        kit.LUMP,
        { a: [0x3a4048, 0x8a94a4, 0xa4aebe, 0xbcc6d4, 0xd8e0ea] },
        { speckle: 'a', seed: 100 },
      ),
    [SPRITE_H.brick]: () =>
      sprite(BRICK_ROWS, {
        a: [0x3a140a, 0x8a3a24, 0xa84a30, 0xbe5e40, 0xd47a5a],
        t: [0x3a140a, 0xb05a3e, 0xc8714f, 0xda8a68, 0xeaa888],
        s: [0x2a0e06, 0x6a2a18, 0x7e3420, 0x8e3e28, 0x9e4a32],
      }),
    [SPRITE_H.netherbrick]: () =>
      sprite(BRICK_ROWS, {
        a: [0x14060a, 0x3e1418, 0x4e1c22, 0x5e262c, 0x70323a],
        t: [0x14060a, 0x582228, 0x6a2c32, 0x7c3840, 0x8e4850],
        s: [0x0c0406, 0x2e0e12, 0x381418, 0x42181e, 0x4c1e24],
      }),
    [SPRITE_H.glowstoneDust]: () =>
      sprite(
        kit.PILE,
        { a: [0x6a4a10, 0xc89a30, 0xeac450, 0xfae080, 0xfff6c0] },
        { speckle: 'a', seed: 103 },
      ),
    [SPRITE_H.goldNugget]: () => sprite(NUGGET, { a: GOLD }, { speckle: 'a', seed: 104 }),
    [SPRITE_H.ironNugget]: () => sprite(NUGGET, { a: IRON }, { speckle: 'a', seed: 105 }),
    [SPRITE_H.bowl]: () =>
      sprite(
        BOWL.map((row) => row.replace(/s/g, 'b')),
        { b: WOOD },
      ),
    [SPRITE_H.mushroomStew]: () =>
      sprite(
        BOWL,
        { b: WOOD, s: [0x3a2a1a, 0xb89a78, 0xceb08c, 0xe0c4a2, 0xf0dcc0] },
        { speckle: 's', seed: 107 },
      ),
    [SPRITE_H.beetrootSoup]: () =>
      sprite(
        BOWL,
        { b: WOOD, s: [0x3a060e, 0x8a1426, 0xae2034, 0xc83a4a, 0xe06a74] },
        { speckle: 's', seed: 108 },
      ),
    [SPRITE_H.potato]: () =>
      sprite(
        POTATO,
        { a: [0x3a2a0a, 0xa8864a, 0xc8a460, 0xdcbe7c, 0xeed8a0] },
        { speckle: 'a', seed: 109 },
      ),
    [SPRITE_H.bakedPotato]: () =>
      sprite(
        POTATO,
        { a: [0x3a200a, 0xb07a2a, 0xd49a3c, 0xeab85a, 0xf8d888] },
        { speckle: 'a', seed: 110 },
      ),
    [SPRITE_H.poisonousPotato]: () =>
      sprite(
        POTATO,
        { a: [0x2a3a0a, 0x8a9a3a, 0xa8b44a, 0xc0c866, 0xd8dc90] },
        { speckle: 'a', seed: 111 },
      ),
    [SPRITE_H.beetroot]: () =>
      sprite(BEETROOT, {
        a: [0x3a0610, 0x8a1428, 0xa81e34, 0xc43a4c, 0xde6a78],
        g: [0x0e3a0a, 0x2a7a1a, 0x3a9a2a, 0x5aba3a, 0x8ada6a],
      }),
    [SPRITE_H.beetrootSeeds]: () =>
      sprite(SEEDS, { a: [0x3a2a14, 0x9a7a4a, 0xb8965e, 0xcaa874, 0xdcc090] }),
    [SPRITE_H.melonSlice]: () =>
      slice([0x5a0a0a, 0xc02a2a, 0xe04a3a, 0xf06a5a, 0xff9a8a], 0x1a1a1a),
    [SPRITE_H.melonSeeds]: () =>
      sprite(SEEDS, { a: [0x0a0a0a, 0x2a2622, 0x3e3830, 0x5a5248, 0x7a7266] }),
    [SPRITE_H.pumpkinSeeds]: () =>
      sprite(SEEDS, { a: [0x4a4a2a, 0xc8c8a0, 0xe0e0b8, 0xeeeed0, 0xfafae8] }),
    [SPRITE_H.pumpkinPie]: () =>
      sprite(PIE, {
        c: [0x3a200a, 0xb07a3a, 0xc8904a, 0xdca660, 0xeec080],
        f: [0x5a2a04, 0xc86a14, 0xe0862a, 0xf0a04a, 0xfcc07a],
        b: [0x3a200a, 0x8a5a2a, 0xa06c36, 0xb47e44, 0xc89456],
      }),
    [SPRITE_H.cookie]: () =>
      sprite(
        COOKIE,
        { a: [0x3a200a, 0xb0783a, 0xca9050, 0xdca866, 0xecc088], p: 0x3a1e0e },
        { bare: 'p' },
      ),
    [SPRITE_H.goldenCarrot]: () =>
      sprite(
        along((u, v) => {
          if (
            u > 13.2 &&
            u < 17.5 &&
            Math.abs(v) < 1.6 &&
            (Math.abs(v) < 0.5 || (u + v * 2) % 2 < 1.2)
          )
            return 'g';
          const w = Math.min(1.7, (u - 1) * 0.28);
          return u > 1 && u <= 13.2 && Math.abs(v) < w ? 'a' : null;
        }),
        { a: GOLD, g: [0x3a3006, 0x9a8a1a, 0xc8b43a, 0xe6d45a, 0xfaf08a] },
      ),
    [SPRITE_H.speckledMelon]: () =>
      slice([0x5a0a0a, 0xc02a2a, 0xe04a3a, 0xf06a5a, 0xff9a8a], 0xffe050, {
        r: [0x4a3006, 0xb88a14, 0xf2c83a, 0xfde67a, 0xfffbd0],
      }),
    [SPRITE_H.fermentedEye]: () =>
      sprite(
        [
          '................',
          '.......mm.......',
          '......mmmm......',
          '.....mmmmmm.....',
          '.....aaaaaa.....',
          '....aaaaaaaa....',
          '...aaappppaaa...',
          '...aapppwppaa...',
          '...aappppppaa...',
          '...aappppppaa...',
          '...aaappppaaa...',
          '....aaaaaaaa....',
          '.....aaaaaa.....',
          '................',
          '................',
          '................',
        ],
        {
          a: [0x3a1a14, 0x7a3a2a, 0x965040, 0xac6a56, 0xc88a78],
          m: [0x2a1a0e, 0x6a4a2a, 0x8a6438, 0xa47e4e, 0xbe9a6a],
          p: 0x2a0a10,
          w: 0xe8c8c0,
        },
        { speckle: 'a', seed: 121, bare: 'pw' },
      ),
    [SPRITE_H.fish]: () =>
      sprite(FISH, {
        a: [0x2a2a1a, 0x8a846a, 0xa8a080, 0xc0b898, 0xd8d0b0],
        b: [0x3a3a2a, 0xc8c4b0, 0xdcd8c4, 0xecead8, 0xfafaf0],
        t: [0x2a2a1a, 0x7a745a, 0x948c70, 0xaaa286, 0xc0b89c],
        e: 0x101010,
      }),
    [SPRITE_H.cookedFish]: () =>
      sprite(FISH, {
        a: [0x2a1a0a, 0x9a7a4a, 0xb8945e, 0xcaa874, 0xdcc090],
        b: [0x3a2a14, 0xc8ae86, 0xdac49e, 0xe8d6b4, 0xf6ead0],
        t: [0x2a1a0a, 0x8a6a3e, 0xa07c4a, 0xb48e5a, 0xc8a26e],
        e: 0x101010,
      }),
    [SPRITE_H.salmon]: () =>
      sprite(FISH, {
        a: [0x3a0e0a, 0xa83a2a, 0xc84e3a, 0xdc6a52, 0xee8e74],
        b: [0x3a2a14, 0xd8a078, 0xe8b890, 0xf2cca8, 0xfae0c8],
        t: [0x2a0a06, 0x8a2e20, 0xa43a2a, 0xba4a38, 0xce5e4a],
        e: 0x101010,
      }),
    [SPRITE_H.cookedSalmon]: () =>
      sprite(FISH, {
        a: [0x2a100a, 0x9a4a2a, 0xb8603a, 0xcc7a50, 0xde9a70],
        b: [0x3a2414, 0xd8a680, 0xe6bc98, 0xf0d0b2, 0xf8e4cc],
        t: [0x2a0e06, 0x844024, 0x9c4e30, 0xb05e3e, 0xc47050],
        e: 0x101010,
      }),
    [SPRITE_H.fishingRod]: () =>
      sprite(
        along((u, v) => {
          if (kit.handle(u, v, 15.5)) return 'h';
          // The line hangs from the tip down the right side, with the hook at its end.
          return null;
        }).map((row, y) =>
          [...row]
            .map((ch, x) => {
              if (ch !== '.') return ch;
              if (x === 14 && y >= 2 && y <= 11) return 's';
              if (y === 12 && x === 14) return 'k';
              if (y === 13 && (x === 13 || x === 14)) return 'k';
              return '.';
            })
            .join(''),
        ),
        { h: WOOD, s: 0xdcdcdc, k: 0x9a9a9a },
        { bare: 'sk' },
      ),
    [SPRITE_H.compass]: () =>
      sprite(
        CASE.map((row, y) =>
          [...row]
            .map((ch, x) => {
              if (ch !== 'f') return ch;
              if (x === 8 && y >= 5 && y <= 7) return 'n';
              if (x === 7 && y >= 5 && y <= 7) return 'n';
              if ((x === 7 || x === 8) && y >= 8 && y <= 10) return 's';
              return 'f';
            })
            .join(''),
        ),
        {
          c: [0x2a2a2a, 0x6a6a6a, 0x8a8a8a, 0xa8a8a8, 0xc8c8c8],
          f: [0x3a3a3a, 0x9a9a9a, 0xb4b4b4, 0xc8c8c8, 0xdcdcdc],
          n: 0xd02a2a,
          s: 0x5a5a5a,
        },
        { bare: 'ns' },
      ),
    [SPRITE_H.clock]: () =>
      sprite(
        CASE.map((row, y) =>
          [...row].map((ch) => (ch === 'f' ? (y < 8 ? 'd' : 'n') : ch)).join(''),
        ),
        {
          c: GOLD,
          d: [0x2a4a7a, 0x5a9ae0, 0x7ab8f0, 0xf6e060, 0xfff0a0],
          n: [0x0a0a2a, 0x1a1a4a, 0x2a2a5a, 0x3a3a6a, 0xd8d8f0],
        },
      ),
    [SPRITE_H.cake]: () =>
      sprite(
        CAKE,
        {
          w: [0x8a8a8a, 0xe0e0e0, 0xf4f4f4, 0xfafafa, 0xffffff],
          r: 0xc81e1e,
          s: [0x8a8a8a, 0xd8d8d8, 0xe8e8e8, 0xf2f2f2, 0xffffff],
          b: [0x2a1608, 0x8a5a2a, 0xa46e3a, 0xb8824a, 0xcc9860],
        },
        { bare: 'r' },
      ),
    [SPRITE_H.goldPickaxe]: () => kit.tool('pickaxe', 'gold'),
    [SPRITE_H.goldAxe]: () => kit.tool('axe', 'gold'),
    [SPRITE_H.goldShovel]: () => kit.tool('shovel', 'gold'),
    [SPRITE_H.goldSword]: () => kit.tool('sword', 'gold'),
    [SPRITE_H.goldHoe]: () => kit.tool('hoe', 'gold'),
    [SPRITE_H.goldHelmet]: () => sprite(kit.HELMET, { a: GOLD }),
    [SPRITE_H.goldChestplate]: () => sprite(kit.CHESTPLATE, { a: GOLD }),
    [SPRITE_H.goldLeggings]: () => sprite(kit.LEGGINGS, { a: GOLD }),
    [SPRITE_H.goldBoots]: () => sprite(kit.BOOTS, { a: GOLD }),
    [SPRITE_H.leatherHelmet]: () => sprite(kit.HELMET, { a: LEATHER }),
    [SPRITE_H.leatherChestplate]: () => sprite(kit.CHESTPLATE, { a: LEATHER }),
    [SPRITE_H.leatherLeggings]: () => sprite(kit.LEGGINGS, { a: LEATHER }),
    [SPRITE_H.leatherBoots]: () => sprite(kit.BOOTS, { a: LEATHER }),
    [SPRITE_H.chainHelmet]: () => sprite(chain(kit.HELMET), { a: CHAIN, b: 0x3a3a3a }),
    [SPRITE_H.chainChestplate]: () => sprite(chain(kit.CHESTPLATE), { a: CHAIN, b: 0x3a3a3a }),
    [SPRITE_H.chainLeggings]: () => sprite(chain(kit.LEGGINGS), { a: CHAIN, b: 0x3a3a3a }),
    [SPRITE_H.chainBoots]: () => sprite(chain(kit.BOOTS), { a: CHAIN, b: 0x3a3a3a }),
  };
  DYE_COLORS.forEach(([, , color], i) => {
    out[SPRITE_H.dye + i] = () => sprite(DYE, { a: r(color) }, { speckle: 'a', seed: 147 + i });
  });
  return out;
}
