/**
 * Item sprites (16×16). Each sprite is a silhouette split into parts — drawn as an ASCII map or,
 * for tools, computed along the handle diagonal — and every part is shaded the same way: light
 * top-left edges, dark bottom-right edges, then a dark outline around the whole shape. That one
 * rule gives every item sprite a consistent, readable look. Original art; deterministic.
 */
import { pixelNoise } from './pixel-art';
import { roundHSprites } from './item-art-h';

/** outline, dark, mid, light, highlight */
type Ramp = readonly [number, number, number, number, number];
type Spec = Record<string, Ramp | number>;
interface Options {
  /** Parts whose interior gets a little tone noise (ores, food, dust). */
  speckle?: string;
  /** Parts drawn without an outline (strings, glints). */
  bare?: string;
  seed?: number;
}

const WOOD: Ramp = [0x281c0e, 0x4f3a1e, 0x6b4f2c, 0x8a6a3d, 0xa5814c];
const MATERIAL: Record<'wood' | 'stone' | 'iron' | 'fortune' | 'diamond' | 'gold', Ramp> = {
  gold: [0x4a3006, 0xb88a14, 0xf2c83a, 0xfde67a, 0xfffbd0],
  wood: [0x2e2010, 0x6b4a22, 0x8f6a34, 0xb08a4a, 0xc9a466],
  stone: [0x262626, 0x575757, 0x767676, 0x979797, 0xb4b4b4],
  iron: [0x323232, 0x8e8e8e, 0xc2c2c2, 0xe2e2e2, 0xffffff],
  fortune: [0x2a1a40, 0x7a62b8, 0xa890e8, 0xd4c4ff, 0xffffff],
  diamond: [0x0c3a36, 0x1f9a8e, 0x3fd8c9, 0x8cf4e8, 0xe4fffb],
};
const DIAMOND = MATERIAL.diamond;
const IRON = MATERIAL.iron;
const GOLD: Ramp = [0x4a3006, 0xb88a14, 0xf2c83a, 0xfde67a, 0xfffbd0];

function darken(c: number, f: number): number {
  return (
    (Math.round(((c >> 16) & 255) * f) << 16) |
    (Math.round(((c >> 8) & 255) * f) << 8) |
    Math.round((c & 255) * f)
  );
}

/** Renders a part map: auto shading per part and an outline around everything. */
function sprite(rows: readonly string[], spec: Spec, options: Options = {}): Uint8ClampedArray {
  const seed = options.seed ?? 1;
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x > 15 || y > 15 ? '.' : (rows[y]?.[x] ?? '.');
  const filled = (ch: string) => ch !== '.' && ch !== ' ';
  const out = new Uint8ClampedArray(16 * 16 * 4);
  const put = (x: number, y: number, c: number) =>
    out.set([(c >> 16) & 255, (c >> 8) & 255, c & 255, 255], (y * 16 + x) * 4);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const ch = at(x, y);
      if (!filled(ch)) continue;
      const s = spec[ch];
      if (s === undefined) throw new Error(`item-art: no colour for '${ch}'`);
      if (typeof s === 'number') {
        put(x, y, s);
        continue;
      }
      const same = (dx: number, dy: number) => at(x + dx, y + dy) === ch;
      const lightEdge = !same(-1, 0) || !same(0, -1),
        darkEdge = !same(1, 0) || !same(0, 1);
      let tone = 2;
      if (lightEdge && !darkEdge) tone = 3;
      else if (darkEdge && !lightEdge) tone = 1;
      else if (!lightEdge && !darkEdge) {
        // One pixel inside the lit edge catches the highlight.
        if (!same(-1, -1) || (!same(-2, 0) && !same(0, -2))) tone = 4;
        if (options.speckle?.includes(ch)) {
          const n = pixelNoise(x, y, seed);
          if (n > 0.82) tone = 3;
          else if (n < 0.16) tone = 1;
        }
      }
      put(x, y, s[tone]);
    }
  // Outline: empty pixels touching the shape take the darkest shade of the part they touch.
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (filled(at(x, y))) continue;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const ch = at(x + dx, y + dy);
        if (!filled(ch) || options.bare?.includes(ch)) continue;
        const s = spec[ch];
        put(x, y, typeof s === 'number' ? darken(s, 0.4) : s[0]);
        break;
      }
    }
  return out;
}

/* ------------------------------------------------------------------ tools */
/** Builds a part map from handle coordinates: u runs up the handle, v across it. */
function along(fn: (u: number, v: number) => string | null): string[] {
  const rows: string[] = [];
  for (let y = 0; y < 16; y++) {
    let row = '';
    for (let x = 0; x < 16; x++) {
      const px = x + 0.5 - 1,
        py = y + 0.5 - 15,
        u = (px - py) / Math.SQRT2,
        v = (px + py) / Math.SQRT2;
      row += fn(u, v) ?? '.';
    }
    rows.push(row);
  }
  return rows;
}
function grid(fn: (x: number, y: number) => string | null): string[] {
  return Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 16 }, (_, x) => fn(x, y) ?? '.').join(''),
  );
}
const handle = (u: number, v: number, top = 14) => u > 0.6 && u < top && Math.abs(v) < 1.0;
type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'sword' | 'hoe';
function tool(kind: ToolKind, material: keyof typeof MATERIAL): Uint8ClampedArray {
  const m = MATERIAL[material];
  let rows: string[];
  switch (kind) {
    case 'pickaxe':
      rows = along((u, v) => {
        const c = 15.6 - 0.07 * v * v;
        if (Math.abs(v) < 7.3 && Math.abs(u - c) < 1.6 - Math.abs(v) * 0.09) return 'm';
        return handle(u, v) ? 'h' : null;
      });
      break;
    case 'axe':
      rows = along((u, v) => {
        if (v > -5.7 && v < 0.9 && u > 12.2 + 0.3 * v && u < 16.4 - 0.1 * v)
          return v < -4.7 ? 'e' : 'm';
        if (v >= 0.9 && v < 2.2 && u > 13.4 && u < 15.6) return 'm';
        return handle(u, v, 15.5) ? 'h' : null;
      });
      break;
    case 'shovel':
      rows = along((u, v) => {
        if (((u - 15.3) / 3) ** 2 + (v / 2.15) ** 2 < 1) return 'm';
        return handle(u, v, 13) ? 'h' : null;
      });
      break;
    case 'hoe':
      rows = along((u, v) => {
        if (v > -4.8 && v < 1.0 && u > 14.4 && u < 16.4) return 'm';
        if (v > -4.8 && v < -3.3 && u > 12.9 && u <= 14.4) return 'm';
        return handle(u, v, 15.5) ? 'h' : null;
      });
      break;
    case 'sword':
      rows = along((u, v) => {
        const a = Math.abs(v);
        if (u > 6.3 && u < 19.6 && a < Math.min(1.5, (19.9 - u) * 0.62))
          return a < 0.45 ? 'e' : 'm';
        if (u > 4.9 && u <= 6.3 && a < 3.3) return 'g';
        if (u > 1.8 && u <= 4.9 && a < 0.75) return 'h';
        if (u > 0.5 && u <= 1.8 && a < 1.1) return 'g';
        return null;
      });
      return sprite(rows, { m, e: m[4], g: [m[0], m[1], m[1], m[2], m[3]], h: WOOD });
  }
  return sprite(rows, { m, e: m[4], h: WOOD });
}

/* ------------------------------------------------------------------ shared shapes */
const BUCKET = [
  '................',
  '................',
  '................',
  '...bbbbbbbbbb...',
  '..baaaaaaaaaab..',
  '..baaaaaaaaaab..',
  '..bbaaaaaaaabb..',
  '..bbbbbbbbbbbb..',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '....bbbbbbbb....',
  '....bbbbbbbb....',
  '.....bbbbbb.....',
  '................',
  '................',
  '................',
];
const bucket = (inside: Ramp | number) => sprite(BUCKET, { b: IRON, a: inside });
const POTION = [
  '................',
  '......cccc......',
  '......gggg......',
  '.......gg.......',
  '.......gg.......',
  '.....gggggg.....',
  '....gaaaaaag....',
  '...gaaaaaaaag...',
  '...gaaaaaaaag...',
  '...gaaaaaaaag...',
  '...gaaaaaaaag...',
  '....gaaaaaag....',
  '.....gggggg.....',
  '................',
  '................',
  '................',
];
const GLASS: Ramp = [0x3a4a5a, 0x9ab4c8, 0xc4d8e8, 0xe4f0f8, 0xffffff];
const CORK: Ramp = [0x2a1c10, 0x6a4a2a, 0x8a6438, 0xa8804a, 0xc49a60];
const potion = (liquid: number) =>
  sprite(POTION, {
    g: GLASS,
    c: CORK,
    a: [darken(liquid, 0.3), darken(liquid, 0.75), liquid, liquid, 0xffffff],
  });
const liquid = (c: number): Ramp => [darken(c, 0.3), darken(c, 0.72), c, darken(c, 1.15), 0xffffff];
const APPLE = [
  '................',
  '........s.......',
  '.......s.ll.....',
  '.......sll......',
  '...aaa.s.aaa....',
  '..aaaaaaaaaaa...',
  '.aaaaaaaaaaaaa..',
  '.aaaaaaaaaaaaa..',
  '.aaaaaaaaaaaaa..',
  '.aaaaaaaaaaaaa..',
  '.aaaaaaaaaaaaa..',
  '..aaaaaaaaaaa...',
  '...aaaaaaaaa....',
  '....aaa.aaa.....',
  '................',
  '................',
];
const LUMP = [
  '................',
  '................',
  '................',
  '.....aaaa.......',
  '....aaaaaaa.....',
  '...aaaaaaaaaa...',
  '...aaaaaaaaaaa..',
  '..aaaaaaaaaaaa..',
  '..aaaaaaaaaaaa..',
  '...aaaaaaaaaaa..',
  '...aaaaaaaaaa...',
  '....aaaaaaaa....',
  '......aaaa......',
  '................',
  '................',
  '................',
];
const PILE = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '.......a........',
  '......aaa..a....',
  '....aaaaaa......',
  '...aaaaaaaaa....',
  '..aaaaaaaaaaa...',
  '..aaaaaaaaaaaa..',
  '...aaaaaaaaaa...',
  '....a..aaaa.....',
  '................',
  '................',
  '................',
];
const GEM = [
  '................',
  '................',
  '................',
  '......aaaa......',
  '....aaaaaaaa....',
  '...aaaaaaaaaa...',
  '..aaaaaaaaaaaa..',
  '..aaaaaaaaaaaa..',
  '...aaaaaaaaaa...',
  '....aaaaaaaa....',
  '.....aaaaaa.....',
  '......aaaa......',
  '.......aa.......',
  '................',
  '................',
  '................',
];
const MEAT = [
  '................',
  '................',
  '................',
  '......aaaaa.....',
  '....aaaaaaaaa...',
  '...aaaaaaaaaaa..',
  '..aaaaaaaaaaaa..',
  '..aaaaaaaaaaaa..',
  '..aaaaaaaaaaa...',
  '..faaaaaaaaaa...',
  '...faaaaaaaa....',
  '....ffaaaaa.....',
  '......fff.......',
  '................',
  '................',
  '................',
];
const ORB = [
  '................',
  '................',
  '................',
  '.....aaaaaa.....',
  '....aaaaaaaa....',
  '...aaaaaaaaaa...',
  '...aaaaaaaaaa...',
  '...aaaaaaaaaa...',
  '...aaaaaaaaaa...',
  '...aaaaaaaaaa...',
  '...aaaaaaaaaa...',
  '....aaaaaaaa....',
  '.....aaaaaa.....',
  '................',
  '................',
  '................',
];
const CART = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '.bbbbbbbbbbbbbb.',
  '.baaaaaaaaaaaab.',
  '.bbbbbbbbbbbbbb.',
  '..bbbbbbbbbbbb..',
  '..bbbbbbbbbbbb..',
  '...bbbbbbbbbb...',
  '...ww......ww...',
  '...ww......ww...',
  '................',
  '................',
  '................',
];

/* ------------------------------------------------------------------ the sprite table */
const HELMET_ROWS = [
  '................',
  '................',
  '................',
  '....aaaaaaaa....',
  '...aaaaaaaaaa...',
  '..aaaaaaaaaaaa..',
  '..aaaaaaaaaaaa..',
  '..aaa......aaa..',
  '..aaa......aaa..',
  '..aa........aa..',
  '................',
];
const CHESTPLATE_ROWS = [
  '................',
  '................',
  '..aaa......aaa..',
  '.aaaaa....aaaaa.',
  '.aaaaaaaaaaaaaa.',
  '.aaaaaaaaaaaaaa.',
  '.aaa.aaaaaa.aaa.',
  '.aa..aaaaaa..aa.',
  '.....aaaaaa.....',
  '.....aaaaaa.....',
  '.....aaaaaa.....',
  '.....aaaaaa.....',
  '.....aaaaaa.....',
  '................',
];
const LEGGINGS_ROWS = [
  '................',
  '................',
  '...aaaaaaaaaa...',
  '...aaaaaaaaaa...',
  '...aaaaaaaaaa...',
  '...aaaa..aaaa...',
  '...aaaa..aaaa...',
  '...aaaa..aaaa...',
  '...aaaa..aaaa...',
  '...aaaa..aaaa...',
  '...aaaa..aaaa...',
  '...aaaa..aaaa...',
  '...aaaa..aaaa...',
  '................',
];
const BOOTS_ROWS = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '...aaa....aaa...',
  '...aaa....aaa...',
  '...aaa....aaa...',
  '..aaaa...aaaa...',
  '.aaaaa..aaaaa...',
  '.aaaaa..aaaaa...',
  '................',
];
const SPRITES: Record<number, () => Uint8ClampedArray> = {
  0: () =>
    sprite(
      along((u, v) => (handle(u, v, 15.5) ? 'h' : null)),
      { h: WOOD },
    ),
  1: () =>
    sprite(
      LUMP,
      { a: [0x0a0a0a, 0x1a1a1a, 0x2a2a2a, 0x444444, 0x6a6a6a] },
      { speckle: 'a', seed: 1 },
    ),
  2: () =>
    sprite(
      LUMP,
      { a: [0x140e0a, 0x2a1f18, 0x3a2c22, 0x564638, 0x7a6a5e] },
      { speckle: 'a', seed: 2 },
    ),
  3: () =>
    sprite(
      [
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
      ],
      {
        l: [0x323232, 0xb8b8b8, 0xdedede, 0xf2f2f2, 0xffffff],
        a: [0x323232, 0x8a8a8a, 0xaaaaaa, 0xc4c4c4, 0xe0e0e0],
      },
    ),
  4: () => tool('pickaxe', 'wood'),
  5: () => tool('pickaxe', 'stone'),
  6: () => tool('pickaxe', 'iron'),
  7: () => tool('axe', 'wood'),
  8: () => tool('axe', 'stone'),
  9: () => tool('axe', 'iron'),
  10: () => tool('shovel', 'wood'),
  11: () => tool('shovel', 'stone'),
  12: () => tool('shovel', 'iron'),
  13: () => tool('sword', 'wood'),
  14: () => tool('sword', 'stone'),
  15: () => tool('sword', 'iron'),
  16: () =>
    sprite(APPLE, {
      a: [0x3a0606, 0x9a1414, 0xcc2020, 0xe84a3a, 0xffb0a0],
      s: 0x5a3a1a,
      l: 0x4a9a2a,
    }),
  17: () =>
    sprite(
      MEAT.map((r) => r.replace(/f/g, 'b')),
      { a: [0x2a1a0e, 0x6a4a2a, 0x8a6a3a, 0x9a8a4a, 0xb0a060], b: 0x7a2a1a },
      { speckle: 'a', seed: 17 },
    ),
  18: () => sprite(HELMET_ROWS, { a: IRON }),
  19: () => sprite(CHESTPLATE_ROWS, { a: IRON }),
  20: () => sprite(LEGGINGS_ROWS, { a: IRON }),
  21: () => sprite(BOOTS_ROWS, { a: IRON }),
  22: () =>
    sprite(
      [
        '................',
        '................',
        '..bbbbbbbbbbbb..',
        '..baaaaaaaaaab..',
        '..baaaaaaaaaab..',
        '..baaaaiaaaaab..',
        '..baaaiiiaaaab..',
        '..baaaaiaaaaab..',
        '..baaaaaaaaaab..',
        '..baaaaaaaaaab..',
        '...baaaaaaaab...',
        '....baaaaaab....',
        '.....baaaab.....',
        '......bbbb......',
        '................',
        '................',
      ],
      { a: MATERIAL.wood, b: IRON, i: 0x9a9a9a },
    ),
  23: () =>
    sprite(
      grid((x, y) => {
        // A limb arc around the grip corner, strung along the diagonal.
        const d = Math.hypot(x - 2, y - 13);
        if (x === y && x >= 3 && x <= 12) return 's';
        if (Math.abs(d - 11) < 0.75 && x >= 2 && y <= 13)
          return Math.abs(x - 15 + y) < 2.5 ? 'g' : 'w';
        return null;
      }),
      { w: WOOD, g: [0x1a120a, 0x3a2a18, 0x4a3822, 0x5a462c, 0x6a543a], s: 0xd8d8d0 },
      { bare: 's' },
    ),
  24: () =>
    sprite(
      along((u, v) => {
        const a = Math.abs(v);
        if (u > 13.5 && u < 17 && a < (17 - u) * 0.75) return 'f';
        if (u > 2.6 && u <= 13.5 && a < 0.5) return 'h';
        if (u > 0.6 && u < 4.6 && a < 1.7 && a > 0.5) return 'e';
        return null;
      }),
      { f: MATERIAL.stone, h: WOOD, e: 0xeeeeee },
    ),
  25: () => {
    const rows = Array.from({ length: 16 }, () => [...'................']);
    for (const [x, y] of [
      [3, 5],
      [8, 3],
      [11, 7],
      [5, 10],
      [10, 11],
      [7, 7],
    ]) {
      rows[y][x] = 'a';
      rows[y + 1][x] = 'a';
      rows[y + 1][x + 1] = 'b';
    }
    return sprite(
      rows.map((r) => r.join('')),
      { a: [0x1e3a0e, 0x5a8a2a, 0x7aaa3a, 0x9aca5a, 0xbadf7a], b: 0x3a6a1a },
    );
  },
  26: () =>
    sprite(
      [
        '................',
        '...e.e..e.......',
        '..eeeee.ee.e....',
        '...eeeeeeeee....',
        '....eeeeeeee....',
        '.....eseese.....',
        '......sssss.....',
        '.......sss......',
        '......bbbbb.....',
        '.......sss......',
        '......ss.ss.....',
        '.....ss...ss....',
        '....ss.....ss...',
        '...ss.......s...',
        '................',
        '................',
      ],
      {
        e: [0x5a4212, 0xb08c2c, 0xd4b04a, 0xe8cc6c, 0xfff0a8],
        s: [0x4a4012, 0x9a9434, 0xb8b04a, 0xd4cc6a, 0xece490],
        b: 0x6a4a2a,
      },
    ),
  27: () =>
    sprite(
      [
        '................',
        '................',
        '................',
        '................',
        '.....aaaaaa.....',
        '...aaaaaaaaaa...',
        '..aaacaaacaaaa..',
        '.aaaacaaacaaaaa.',
        '.aaaaaaaaaaaaaa.',
        '.bbbbbbbbbbbbbb.',
        '.bbbbbbbbbbbbbb.',
        '..bbbbbbbbbbbb..',
        '................',
      ],
      {
        a: [0x4a2a0a, 0x9a5a1a, 0xba7426, 0xd08e3a, 0xe8b060],
        b: [0x4a2a0a, 0x8a5a2a, 0xa87a3a, 0xc09450, 0xd8b070],
        c: 0xe8c890,
      },
    ),
  28: () =>
    sprite(
      [
        '................',
        '................',
        '................',
        '......aa........',
        '.....aaaa.......',
        '....aaaaaa......',
        '....aaaaaaa.....',
        '...aaaaaaaaa....',
        '...aaaaaaaaaa...',
        '..aaaaaaaaaaa...',
        '..aaaaaaaaaa....',
        '...aaaaaaaa.....',
        '....aaaaa.......',
        '................',
      ],
      { a: [0x121212, 0x2a2a2a, 0x3e3e3e, 0x5a5a5a, 0x808080] },
      { speckle: 'a', seed: 28 },
    ),
  29: () =>
    sprite(
      [
        '................',
        '................',
        '...bbbbb........',
        '..bb...bb.......',
        '..b.....b.......',
        '..b.....b.......',
        '..bb...bb.......',
        '...bb.bb........',
        '....bbb...aa....',
        '.........aaaa...',
        '........aaaaaa..',
        '........aaaaaa..',
        '.........aaaa...',
        '................',
      ],
      { b: IRON, a: [0x121212, 0x2a2a2a, 0x3e3e3e, 0x5a5a5a, 0x808080] },
    ),
  30: () =>
    sprite(
      PILE,
      { a: [0x3a0404, 0x8a0c08, 0xc41a12, 0xee3a2a, 0xff8a7a] },
      { speckle: 'a', seed: 30 },
    ),
  31: () => bucket(0x3a3a3a),
  32: () => bucket(liquid(0x3a6ad8)),
  33: () => bucket(liquid(0xf07a1a)),
  34: () =>
    sprite(
      [
        '................',
        '................',
        '...bbbbbbbbbb...',
        '..bbbbbbbbbbbp..',
        '..bbbbbbbbbbbp..',
        '..bbbgggggbbbp..',
        '..bbbbbbbbbbbp..',
        '..bbbbbbbbbbbp..',
        '..bbbbbbbbbbbp..',
        '..bbbbbbbbbbbp..',
        '..bbbbbbbbbbbp..',
        '..bbbbbbbbbbbp..',
        '...ppppppppppp..',
        '................',
      ],
      { b: [0x2a1408, 0x6a3a1a, 0x8a4e24, 0xa46232, 0xbc7a44], p: 0xeee6d0, g: 0xe8c24a },
    ),
  35: () =>
    sprite(
      [
        '................',
        '................',
        '....aaaaaaaa....',
        '...aaaaaaaaaa...',
        '...alllllllla...',
        '...aaaaaaaaaa...',
        '...alllllllla...',
        '...aaaaaaaaaa...',
        '...allllllaaa...',
        '...aaaaaaaaaa...',
        '...aaaaaaaaaa...',
        '....aaaaaaaa....',
        '................',
      ],
      { a: [0x6a6a60, 0xd8d4c4, 0xeae6d8, 0xf6f4ea, 0xffffff], l: 0xc4c0b0 },
    ),
  36: () =>
    sprite(
      [
        '................',
        '................',
        '...aa......aa...',
        '...aaaaaaaaaa...',
        '....aaaaaaaa....',
        '...aaaaaaaaaa...',
        '..aaaaaaaaaaaa..',
        '..aaaaaaaaaaaa..',
        '...aaaaaaaaaa...',
        '...aaaaaaaaaa...',
        '..aaaaaaaaaaaa..',
        '..aa..aaaa..aa..',
        '................',
      ],
      { a: [0x2a160a, 0x7a4424, 0x9a5a30, 0xb4723e, 0xc88a52] },
      { speckle: 'a', seed: 36 },
    ),
  37: () => potion(0x3a6ad8),
  38: () => potion(0xe03a4a),
  39: () => potion(0xd06ac8),
  40: () => potion(0xe89a3a),
  41: () => potion(0x7ab8e8),
  42: () => potion(0x8a2a2a),
  43: () => potion(0x4a8a2a),
  44: () => sprite(APPLE, { a: GOLD, s: 0x5a3a1a, l: 0x4a9a2a }),
  45: () => sprite(CART, { b: IRON, a: 0x2a2a2a, w: 0x3a3a3a }),
  46: () =>
    sprite(
      [
        '................',
        '....cccccccc....',
        '....clllllll....',
        '....cccclccc....',
        '....cccccccc....',
        ...CART.slice(5),
      ].slice(0, 16),
      {
        b: IRON,
        a: 0x2a2a2a,
        w: 0x3a3a3a,
        c: [0x2a1808, 0x7a5222, 0x9a6a2e, 0xb4823e, 0xc89a52],
        l: 0x5a3812,
      },
    ),
  47: () => tool('pickaxe', 'fortune'),
  48: () =>
    sprite(
      GEM,
      { a: [0x0a1a4a, 0x1a3a9a, 0x2a54c8, 0x4a7ae8, 0x9ac0ff] },
      { speckle: 'a', seed: 48 },
    ),
  49: () => tool('hoe', 'wood'),
  50: () => tool('hoe', 'stone'),
  51: () => tool('hoe', 'iron'),
  52: () =>
    sprite(
      along((u, v) => {
        const a = Math.abs(v);
        if (u > 3 && u < 17 && a < 0.8) return 'a';
        for (const cu of [2.4, 17.6])
          for (const cv of [-1, 1]) if (Math.hypot(u - cu, v - cv) < 1.35) return 'a';
        return null;
      }),
      { a: [0x5a5448, 0xc8c2b0, 0xe4dfcf, 0xf4f0e4, 0xffffff] },
    ),
  53: () =>
    sprite(
      PILE,
      { a: [0x6a6a66, 0xc4c4bc, 0xdcdcd4, 0xececec, 0xffffff] },
      { speckle: 'a', seed: 53 },
    ),
  54: () =>
    sprite(
      MEAT,
      { a: [0x3a0808, 0x9a2020, 0xc03030, 0xd85048, 0xf09088], f: 0xf0e0d0 },
      { speckle: 'a', seed: 54 },
    ),
  55: () =>
    sprite(
      MEAT,
      { a: [0x5a2020, 0xd06a6a, 0xe88a86, 0xf4a8a0, 0xffd0c8], f: 0xf8ece0 },
      { speckle: 'a', seed: 55 },
    ),
  56: () =>
    sprite(
      [
        '................',
        '................',
        '.....aaaaa......',
        '....aaaaaaa.....',
        '...aaaaaaaaa....',
        '...aaaaaaaaa....',
        '...aaaaaaaaa....',
        '....aaaaaaaa....',
        '.....aaaaaa.....',
        '.......aab......',
        '........bbb.....',
        '.........bbb....',
        '.........b.b....',
        '................',
      ],
      { a: [0x5a4038, 0xe0b0a0, 0xf0c8b8, 0xf8dcd0, 0xfff0e8], b: 0xeee6d8 },
    ),
  57: () =>
    sprite(
      MEAT,
      { a: [0x3a0a0a, 0xa02a2a, 0xc8403a, 0xe06a60, 0xf8a8a0], f: 0xfaf0e8 },
      { speckle: 'a', seed: 57 },
    ),
  58: () =>
    sprite(
      along((u, v) => {
        if (u > 1 && u < 17.5 && Math.abs(v) < 0.4) return 's';
        const w = Math.min(2.6, (u - 4) * 0.55, (18.2 - u) * 0.7);
        if (u > 4 && u < 18 && Math.abs(v) < w) return 'a';
        return null;
      }),
      { a: [0x7a7a72, 0xdcdcd4, 0xececea, 0xf8f8f6, 0xffffff], s: 0xa8a49a },
    ),
  59: () =>
    sprite(
      ORB,
      { a: [0x7a7a72, 0xdadad2, 0xeaeae4, 0xf6f6f2, 0xffffff] },
      { speckle: 'a', seed: 59 },
    ),
  60: () =>
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
        if (u > 1 && u <= 13.2 && Math.abs(v) < w) return 'a';
        return null;
      }),
      {
        a: [0x4a1e04, 0xd06a14, 0xf08a22, 0xf8a848, 0xffd090],
        g: [0x0e3a0a, 0x2a7a1a, 0x3a9a2a, 0x5aba3a, 0x8ada6a],
      },
    ),
  61: () => potion(0x5a78c8),
  62: () =>
    sprite(
      ORB,
      { a: [0x04201c, 0x0e4a42, 0x1a6a5e, 0x2a9484, 0x7adcc8] },
      { speckle: 'a', seed: 62 },
    ),
  63: () =>
    sprite(
      [
        ...ORB.slice(0, 6),
        '...aaggggggaa...',
        '...aaggkkggaa...',
        '...aaggkkggaa...',
        '...aaggggggaa...',
        ...ORB.slice(10),
      ],
      { a: [0x04201c, 0x0e4a42, 0x1a6a5e, 0x2a9484, 0x7adcc8], g: 0x5ad07a, k: 0x0a1a10 },
    ),
  64: () =>
    sprite(
      [
        '................',
        '................',
        '................',
        '........a.......',
        '.......aaa......',
        '......aaaa......',
        '.....aaaaaa.....',
        '....aaaaaaa.....',
        '...aaaaaaaa.....',
        '...aaaaaaa......',
        '....aaaaa.......',
        '.....aaa........',
        '................',
      ],
      { a: [0x6a625a, 0xd8d0c4, 0xece6dc, 0xf8f4ee, 0xffffff] },
    ),
  65: () =>
    sprite(
      [
        '................',
        '.......a........',
        '.......a........',
        '......aaa.......',
        '......aaa.......',
        '.....aaaaa......',
        '.aaaaaaaaaaaaa..',
        '...aaaaaaaaa....',
        '.....aaaaa......',
        '......aaa.......',
        '......aaa.......',
        '.......a........',
        '.......a........',
        '................',
      ],
      { a: [0x5a5a3a, 0xd8d8b0, 0xeeeed0, 0xfafae8, 0xffffff] },
    ),
  66: () =>
    sprite(
      [
        '................',
        '...aaaa..aaaa...',
        '..aaaaa..aaaaa..',
        '..aaaaa..aaaaa..',
        '..aaaaa..aaaaa..',
        '..aaaaa..aaaaa..',
        '..aaaa....aaaa..',
        '..aaaa....aaaa..',
        '..aaa......aaa..',
        '..aaa......aaa..',
        '..aa........aa..',
        '..aa........aa..',
        '..a..........a..',
        '................',
      ],
      { a: [0x2a2438, 0x6a6284, 0x8a82a4, 0xa8a0c0, 0xc8c0e0] },
    ),
  67: () =>
    sprite(
      [
        '................',
        '................',
        '...aaaaaaaaaa...',
        '..aaaaaaaaaaaa..',
        '..aaaaaaaaaaaa..',
        '..aakkaaaakkaa..',
        '..aakkaaaakkaa..',
        '..aaaaaaaaaaaa..',
        '..aaaaakkaaaaa..',
        '..aaaaaaaaaaaa..',
        '...akakakakaa...',
        '...aaaaaaaaaa...',
        '................',
      ],
      { a: [0x5a5a54, 0xc8c8c0, 0xdcdcd4, 0xecece6, 0xffffff], k: 0x1a1a1a },
    ),
  68: () =>
    sprite(
      [
        '................',
        '................',
        '...ffffffffff...',
        '...f........f...',
        '...f..pppp..f...',
        '...f.pppppp.f...',
        '...f.pppppp.f...',
        '...f.pppppp.f...',
        '...f.pppppp.f...',
        '...f..pppp..f...',
        '...f........f...',
        '...ffffffffff...',
        '................',
      ],
      {
        f: [0x2a2a3a, 0x5a5a6a, 0x7a7a8a, 0x9a9aaa, 0xc0c0d0],
        p: [0x4a1040, 0xc04aa8, 0xe070c8, 0xf4a0e0, 0xffe0f8],
      },
    ),
  69: () =>
    sprite(
      [
        '................',
        '................',
        '................',
        '....ss....ss....',
        '...s..s..s..s...',
        '...s...ss...s...',
        '....s..ss..s....',
        '.....ss..ss.....',
        '......s..s......',
        '.....s....s.....',
        '....s......s....',
        '...s........s...',
        '................',
      ],
      { s: 0xeeeeea },
      { bare: 's' },
    ),
  70: () =>
    sprite(
      [
        '................',
        '................',
        '................',
        '......aaaa......',
        '.....aaaaaa.....',
        '....aaaaaaaa....',
        '....aaaaaaaa....',
        '...aaaaaaaaaa...',
        '...aaaaaaaaaa...',
        '...aaaaaaaaaa...',
        '...aaaaaaaaaa...',
        '....aaaaaaaa....',
        '.....aaaaaa.....',
        '................',
      ],
      { a: [0x6a5a44, 0xd8c8a4, 0xe8dcbc, 0xf4ecd4, 0xfffaf0] },
      { speckle: 'a', seed: 70 },
    ),
  71: () =>
    sprite(
      [
        '................',
        '..........aa....',
        '.........aaa....',
        '........aaa.....',
        '.......aaa......',
        '..aa..aaa.......',
        '..aaaaaa........',
        '...aaaaa........',
        '....aahh........',
        '...hh..hhh......',
        '..hh...h..h.....',
        '..h...h...h.....',
        '..h..h...h......',
        '...hh....h......',
        '.........hh.....',
        '................',
      ],
      { a: IRON, h: [0x3a0808, 0x8a1a1a, 0xb02a2a, 0xc84a4a, 0xe07070] },
    ),
  72: () => bucket(liquid(0xf4f4f0)),
  // Cooked meat: the raw shapes, browned, with a lighter seared edge.
  73: () =>
    sprite(
      MEAT,
      { a: [0x2a1406, 0x6a3a14, 0x8c5220, 0xa86c34, 0xc89058], f: 0xe8d4b0 },
      { speckle: 'a', seed: 73 },
    ),
  74: () =>
    sprite(
      MEAT,
      { a: [0x3a1c0a, 0x8a5024, 0xa86a38, 0xc48a52, 0xdcaa74], f: 0xf0dcc0 },
      { speckle: 'a', seed: 74 },
    ),
  75: () =>
    sprite(
      [
        '................',
        '................',
        '.....aaaaa......',
        '....aaaaaaa.....',
        '...aaaaaaaaa....',
        '...aaaaaaaaa....',
        '...aaaaaaaaa....',
        '....aaaaaaaa....',
        '.....aaaaaa.....',
        '.......aab......',
        '........bbb.....',
        '.........bbb....',
        '.........b.b....',
        '................',
      ],
      { a: [0x3a200c, 0x9a6230, 0xb87c40, 0xd09a5c, 0xe8bc84], b: 0xeee6d8 },
      { speckle: 'a', seed: 75 },
    ),
  76: () =>
    sprite(
      MEAT,
      { a: [0x2e1608, 0x74401a, 0x94582a, 0xb0743e, 0xcc9660], f: 0xece0c8 },
      { speckle: 'a', seed: 76 },
    ),
  77: () => tool('pickaxe', 'diamond'),
  78: () => tool('axe', 'diamond'),
  79: () => tool('shovel', 'diamond'),
  80: () => tool('sword', 'diamond'),
  81: () => tool('hoe', 'diamond'),
  82: () => sprite(HELMET_ROWS, { a: DIAMOND }),
  83: () => sprite(CHESTPLATE_ROWS, { a: DIAMOND }),
  84: () => sprite(LEGGINGS_ROWS, { a: DIAMOND }),
  85: () => sprite(BOOTS_ROWS, { a: DIAMOND }),
  86: () =>
    sprite(
      POTION.map((row, y) =>
        y === 1 ? row.replace(/c/g, 'g') : row.replace(/a/g, y === 6 ? 'h' : '.'),
      ),
      { g: GLASS, h: 0xe4f0f8 },
    ),
  // Slimeball: a glossy green blob with a bright glint.
  87: () =>
    sprite(
      [
        '................',
        '................',
        '................',
        '................',
        '......aaaa......',
        '....aaaaaaaa....',
        '...aaawaaaaaa...',
        '...aawwaaaaaa...',
        '...aaaaaaaaaa...',
        '...aaaaaaaaaa...',
        '....aaaaaaaa....',
        '.....aaaaaa.....',
        '................',
        '................',
        '................',
        '................',
      ],
      { a: [0x2c6a22, 0x55a843, 0x72c85c, 0x8fdc78, 0xc2f0b0], w: 0xeafbe4 },
      { speckle: 'a', seed: 87 },
    ),
  // Magma cream: a dark blob with a glowing orange heart.
  88: () =>
    sprite(
      [
        '................',
        '................',
        '................',
        '................',
        '......aaaa......',
        '....aaaaaaaa....',
        '...aaaoooaaaa...',
        '...aaooyyoaaa...',
        '...aaoyyooaaa...',
        '...aaaoooaaaa...',
        '....aaaaaaaa....',
        '.....aaaaaa.....',
        '................',
        '................',
        '................',
        '................',
      ],
      { a: [0x1e0c06, 0x4a1e10, 0x6a2c16, 0x86401e, 0xa05a2a], o: 0xf07a1c, y: 0xffd24a },
      { speckle: 'a', seed: 88, bare: 'oy' },
    ),
  // Ghast tear: a pale teardrop, point up.
  89: () =>
    sprite(
      [
        '................',
        '................',
        '.......a........',
        '.......a........',
        '......aaa.......',
        '......aaa.......',
        '.....aaaaa......',
        '.....awaaa......',
        '....aawaaaa.....',
        '....aawaaaa.....',
        '....aaaaaaa.....',
        '....aaaaaaa.....',
        '.....aaaaa......',
        '......aaa.......',
        '................',
        '................',
      ],
      { a: [0x5a7a8a, 0xa8c8d4, 0xcfe6ee, 0xe8f6fa, 0xffffff], w: 0xffffff },
    ),
  // Spider eye: a red eyeball with its dark pupil and a glint.
  90: () =>
    sprite(
      [
        '................',
        '................',
        '................',
        '................',
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
      { a: [0x4a0c14, 0x9a1e2a, 0xc0303a, 0xd84a54, 0xf08088], p: 0x2a0a10, w: 0xf6d6d8 },
      { speckle: 'a', seed: 90, bare: 'pw' },
    ),
};

Object.assign(
  SPRITES,
  roundHSprites({
    sprite,
    along,
    tool,
    darken,
    handle,
    WOOD,
    IRON,
    GOLD,
    HELMET: HELMET_ROWS,
    CHESTPLATE: CHESTPLATE_ROWS,
    LEGGINGS: LEGGINGS_ROWS,
    BOOTS: BOOTS_ROWS,
    LUMP,
    PILE,
    ORB,
  }),
);

/** Pixels for an item sprite, or null to keep the older painter. */
export function itemSpritePixels(sprite: number): Uint8ClampedArray | null {
  return SPRITES[sprite]?.() ?? null;
}
