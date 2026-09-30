import {
  terrainPixels,
  animatedPixels,
  pixelCanvas,
  ANIMATED_TILE_BASE,
  ANIMATED_FRAMES,
} from './pixel-art';
import * as THREE from 'three';
import { registry } from '../../content/src/blocks';
import { itemRegistry, SPRITE_COUNT } from '../../content/src/items';
import {
  ATLAS_COLS,
  ATLAS_ROWS,
  TILE_STRIDE,
  TILE_SIZE,
  ITEM_TILE_BASE,
  isSpriteTile,
  spriteTile,
} from './mesher';
import { CLASSIC_TILES, classicTilePixels } from './tile-art';
import { itemSpritePixels } from './item-art';
import { extraTilePixels } from './block-art';
import { renderBoxes, type Box } from '../../content/src/shapes';
import { EXTRA_TILE_BASE } from '../../content/src/tiles';
const SPRITE_TILES = SPRITE_COUNT;
function pixelRandom(x: number, y: number, s: number) {
  let h = Math.imul(x + 137, 374761393) ^ Math.imul(y + 43, 668265263) ^ s;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const bases = [
  [108, 150, 72],
  [134, 101, 67],
  [133, 101, 70],
  [133, 139, 134],
  [219, 207, 157],
  [119, 89, 55],
  [173, 140, 88],
  [78, 121, 57],
  [184, 144, 88],
  [122, 133, 127],
  [174, 213, 219],
  [57, 128, 151],
  [66, 72, 70],
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
  [215, 216, 200],
  [128, 128, 126],
  [130, 132, 130],
  [162, 122, 74],
  [168, 128, 78],
  [134, 108, 72],
  [112, 108, 104],
  [96, 92, 88],
  [122, 122, 120],
  [186, 143, 91],
  [164, 124, 78],
  [214, 106, 36],
  [138, 46, 42],
  [186, 62, 56],
];

/**
 * Tiles above the hand-drawn set are generated: every block texture that arrived with the
 * fluid, farming, redstone and mechanism stages is drawn here from a small style table keyed
 * by the block that uses it. Keeping it table-driven means a new block gets a readable texture
 * without a new painting routine, and no tile can ever fall back to a magenta placeholder.
 */
interface TileStyle {
  readonly base: readonly [number, number, number];
  readonly pattern: string;
  readonly accent?: readonly [number, number, number];
}
const STYLE_BY_KEY: readonly { match: RegExp; style: TileStyle }[] = [
  {
    match: /water_flow/,
    style: { base: [57, 128, 151], pattern: 'liquid', accent: [188, 216, 226] },
  },
  { match: /lava_flow/, style: { base: [214, 106, 36], pattern: 'lava', accent: [255, 210, 90] } },
  { match: /gravel/, style: { base: [134, 130, 126], pattern: 'rubble', accent: [96, 92, 88] } },
  { match: /obsidian/, style: { base: [38, 30, 52], pattern: 'glassy', accent: [96, 76, 140] } },
  { match: /fire/, style: { base: [226, 122, 36], pattern: 'fire', accent: [255, 226, 120] } },
  { match: /tnt/, style: { base: [200, 60, 52], pattern: 'tnt', accent: [238, 238, 230] } },
  {
    match: /redstone_torch/,
    style: { base: [120, 42, 40], pattern: 'torch', accent: [228, 60, 50] },
  },
  { match: /torch/, style: { base: [162, 124, 72], pattern: 'torch', accent: [255, 214, 120] } },
  { match: /farmland/, style: { base: [122, 84, 52], pattern: 'furrow', accent: [92, 60, 36] } },
  {
    match: /wheat_[0-7]/,
    style: { base: [120, 150, 60], pattern: 'crop', accent: [224, 196, 90] },
  },
  { match: /oak_sapling/, style: { base: [96, 140, 62], pattern: 'crop', accent: [70, 110, 48] } },
  {
    match: /sugar_cane/,
    style: { base: [150, 180, 90], pattern: 'cane', accent: [196, 216, 130] },
  },
  { match: /cactus/, style: { base: [70, 120, 60], pattern: 'cactus', accent: [214, 226, 190] } },
  { match: /pumpkin/, style: { base: [214, 138, 44], pattern: 'furrow', accent: [150, 88, 24] } },
  { match: /melon/, style: { base: [110, 156, 62], pattern: 'rubble', accent: [60, 104, 44] } },
  {
    match: /enchanting_table/,
    style: { base: [58, 44, 92], pattern: 'glassy', accent: [140, 108, 220] },
  },
  {
    match: /brewing_stand/,
    style: { base: [122, 122, 128], pattern: 'metal', accent: [176, 184, 190] },
  },
  { match: /anvil/, style: { base: [70, 70, 74], pattern: 'metal', accent: [140, 140, 146] } },
  {
    match: /redstone_ore/,
    style: { base: [122, 126, 122], pattern: 'ore', accent: [206, 44, 40] },
  },
  { match: /redstone_wire/, style: { base: [96, 30, 26], pattern: 'wire', accent: [216, 48, 40] } },
  { match: /lamp_on/, style: { base: [214, 176, 92], pattern: 'metal', accent: [255, 236, 160] } },
  { match: /lamp_off/, style: { base: [128, 92, 62], pattern: 'metal', accent: [156, 118, 78] } },
  {
    match: /repeater|comparator/,
    style: { base: [160, 156, 148], pattern: 'circuit', accent: [210, 208, 200] },
  },
  { match: /_on$/, style: { base: [150, 132, 96], pattern: 'metal', accent: [222, 200, 140] } },
  { match: /piston/, style: { base: [172, 156, 132], pattern: 'planks', accent: [120, 108, 92] } },
  {
    match: /dispenser|dropper|hopper/,
    style: { base: [122, 120, 118], pattern: 'metal', accent: [86, 84, 82] },
  },
  { match: /rail/, style: { base: [148, 130, 96], pattern: 'rail', accent: [196, 180, 140] } },
  { match: /lapis_ore/, style: { base: [122, 126, 122], pattern: 'ore', accent: [56, 78, 190] } },
  { match: /gold_ore/, style: { base: [122, 126, 122], pattern: 'ore', accent: [228, 190, 76] } },
  {
    match: /iron_block/,
    style: { base: [196, 196, 196], pattern: 'metal', accent: [232, 232, 232] },
  },
  {
    match: /gold_block/,
    style: { base: [228, 190, 76], pattern: 'metal', accent: [255, 232, 150] },
  },
  {
    match: /lever|button|plate/,
    style: { base: [140, 140, 136], pattern: 'circuit', accent: [186, 186, 180] },
  },
  {
    match: /diamond_ore/,
    style: { base: [122, 126, 122], pattern: 'ore', accent: [110, 222, 226] },
  },
  {
    match: /sandstone/,
    style: { base: [218, 204, 156], pattern: 'planks', accent: [196, 180, 132] },
  },
  { match: /snow/, style: { base: [238, 242, 248], pattern: 'noise', accent: [214, 222, 234] } },
  { match: /ice/, style: { base: [152, 196, 230], pattern: 'glassy', accent: [216, 238, 252] } },
  {
    match: /stone_bricks/,
    style: { base: [128, 128, 128], pattern: 'planks', accent: [104, 104, 104] },
  },
  {
    match: /mossy_cobblestone/,
    style: { base: [104, 106, 104], pattern: 'rubble', accent: [72, 98, 62] },
  },
  {
    match: /spawner/,
    style: { base: [38, 40, 44], pattern: 'glassy', accent: [124, 126, 136] },
  },
  {
    match: /nether_portal/,
    style: { base: [98, 32, 140], pattern: 'glassy', accent: [186, 96, 232] },
  },
  {
    match: /end_portal/,
    style: { base: [16, 14, 34], pattern: 'glassy', accent: [216, 220, 255] },
  },
  {
    match: /end_portal_frame/,
    style: { base: [70, 96, 78], pattern: 'planks', accent: [150, 214, 186] },
  },
  {
    match: /end_stone/,
    style: { base: [219, 222, 158], pattern: 'rubble', accent: [198, 202, 140] },
  },
  { match: /glowstone/, style: { base: [222, 196, 118], pattern: 'ore', accent: [255, 240, 170] } },
  { match: /quartz_ore/, style: { base: [122, 60, 56], pattern: 'ore', accent: [236, 232, 224] } },
  { match: /soul_sand/, style: { base: [86, 68, 58], pattern: 'rubble', accent: [62, 48, 42] } },
  { match: /nether_brick/, style: { base: [58, 32, 36], pattern: 'planks', accent: [38, 20, 24] } },
  { match: /dragon_egg/, style: { base: [26, 20, 34], pattern: 'glassy', accent: [122, 84, 168] } },
  { match: /purpur/, style: { base: [168, 124, 170], pattern: 'planks', accent: [140, 100, 144] } },
  { match: /netherrack/, style: { base: [110, 48, 48], pattern: 'rubble', accent: [84, 34, 34] } },
  { match: /magma/, style: { base: [88, 44, 30], pattern: 'lava', accent: [226, 118, 42] } },
  {
    match: /wither_skeleton_skull/,
    style: { base: [46, 44, 42], pattern: 'rubble', accent: [16, 14, 14] },
  },
];
/**
 * Tiles that need their own look although their block already has one: the top of a sandstone
 * block is smoother than its side.
 */
const TILE_STYLE_BY_INDEX: readonly { tile: number; style: TileStyle }[] = [
  {
    tile: 124,
    style: { base: [226, 214, 168], pattern: 'planks', accent: [208, 194, 146] },
  },
  // The top of a portal frame is smooth end stone; the eye sits in a ring of green stone.
  { tile: 132, style: { base: [86, 112, 92], pattern: 'circuit', accent: [232, 240, 236] } },
  { tile: 133, style: { base: [76, 102, 84], pattern: 'planks', accent: [146, 206, 178] } },
];
/** Colour of a tile that no style claims: a stable grey, never the magenta placeholder. */
function fallbackStyle(tile: number): TileStyle {
  const shade = 96 + Math.floor(pixelRandom(tile, tile * 3, 17) * 90);
  return { base: [shade, shade, shade], pattern: 'noise' };
}
function styleFor(tile: number): TileStyle {
  for (const entry of TILE_STYLE_BY_INDEX) if (entry.tile === tile) return entry.style;
  for (const def of registry.list())
    for (const index of def.textures)
      if (index === tile)
        for (const entry of STYLE_BY_KEY) if (entry.match.test(def.key)) return entry.style;
  return fallbackStyle(tile);
}
/** Every block texture index used by the registry, so the atlas can cover all of them. */
export function blockTextureTiles(): number[] {
  const set = new Set<number>();
  for (const def of registry.list()) for (const index of def.textures) set.add(index);
  return [...set].sort((a, b) => a - b);
}
function generatedTileCanvas(tile: number): HTMLCanvasElement {
  const style = styleFor(tile);
  const c = document.createElement('canvas');
  c.width = c.height = TILE_SIZE;
  const ctx = c.getContext('2d')!;
  const px = (x: number, y: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  };
  const rgb = (v: readonly [number, number, number], delta = 0) =>
    `rgb(${Math.max(0, Math.min(255, Math.round(v[0] + delta)))},${Math.max(0, Math.min(255, Math.round(v[1] + delta)))},${Math.max(0, Math.min(255, Math.round(v[2] + delta)))})`;
  const accent = style.accent ?? style.base;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const noise = (pixelRandom(x, y, tile * 977) - 0.5) * 22;
      let color = rgb(style.base, noise);
      switch (style.pattern) {
        case 'liquid':
          if ((x + y) % 7 < 2) color = rgb(style.base, 14 + noise);
          if (pixelRandom(x, y, tile + 5) > 0.94) color = rgb(accent);
          break;
        case 'lava':
          if (pixelRandom(Math.floor(x / 3), Math.floor(y / 3), tile + 11) > 0.62)
            color = rgb(accent, noise);
          else if ((x * y) % 11 < 3) color = rgb(style.base, -30);
          break;
        case 'rubble':
          if (pixelRandom(Math.floor(x / 2), Math.floor(y / 2), tile + 3) > 0.68)
            color = rgb(accent, noise);
          break;
        case 'glassy':
          if ((x + y) % 9 === 0) color = rgb(accent, noise * 1.6);
          if (pixelRandom(x, y, tile + 19) > 0.9) color = rgb(accent, 26);
          break;
        case 'fire': {
          const flame = Math.abs(((x * 3 + y * 5) % 16) - 8);
          color = flame < 3 ? rgb(accent, noise) : rgb(style.base, noise - flame * 3);
          break;
        }
        case 'tnt':
          if (y > 4 && y < 11) color = rgb(accent, noise * 0.4);
          if ((y === 4 || y === 11) && x % 4 < 2) color = rgb(style.base, -40);
          break;
        case 'torch':
          if (y < 6) color = rgb(accent, noise);
          else if (x < 6 || x > 9) color = rgb(style.base, -34);
          break;
        case 'furrow':
          if (y % 5 === 0) color = rgb(accent, noise);
          else color = rgb(style.base, noise + ((x + y) % 3) * 3);
          break;
        case 'crop': {
          const stalk = x % 4 === 1;
          const grain = y % 6 === 2 && x % 4 < 3;
          if (grain) color = rgb(accent, noise);
          else if (stalk) color = rgb(style.base, 22);
          break;
        }
        case 'cane':
          if (x % 3 === 2) color = rgb(style.base, -28);
          if ((y + Math.floor(x / 3)) % 7 === 0) color = rgb(accent, noise);
          break;
        case 'cactus':
          if (x < 2 || x > 13 || y < 2 || y > 13) color = rgb(style.base, -26);
          if (x % 5 === 2 && y % 5 === 3) color = rgb(accent);
          break;
        case 'metal':
          if (y % 6 === 0 || x % 6 === 0) color = rgb(accent, noise);
          break;
        case 'ore':
          if (pixelRandom(Math.floor(x / 2), Math.floor(y / 2), tile + 41) > 0.66)
            color = rgb(accent, noise);
          break;
        case 'wire': {
          const near = Math.abs(x - 7.5) < 1.4 || Math.abs(y - 7.5) < 1.4;
          color = near ? rgb(accent, noise) : rgb(style.base, noise - 10);
          break;
        }
        case 'circuit':
          if (y === 7 || x === 7) color = rgb(accent, noise);
          if ((x % 5 === 2 && y % 5 === 4) || (x % 7 === 3 && y % 7 === 5))
            color = rgb(accent, -46);
          break;
        case 'planks':
          if (y % 5 === 0) color = rgb(accent, noise);
          break;
        case 'rail':
          if (x === 3 || x === 12) color = rgb(accent, noise);
          if (y % 5 === 2) color = rgb(accent, -30);
          break;
        default:
          break;
      }
      px(x, y, color);
    }
  return c;
}

function tileCanvas(tile: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = TILE_SIZE;
  const ctx = c.getContext('2d')!,
    image = ctx.createImageData(TILE_SIZE, TILE_SIZE);
  const base = bases[tile] ?? [160, 90, 160];
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      let [r, g, b] = base;
      let a = 255;
      const n = (pixelRandom(x, y, tile * 933) - 0.5) * 24;
      r += n;
      g += n;
      b += n;
      if (tile === 0) {
        const cluster = pixelRandom(Math.floor(x / 3), Math.floor(y / 3), 781) > 0.65 ? 9 : -3;
        r += cluster;
        g += cluster;
        b += cluster * 0.4;
      }
      if (tile === 1 && y < 3 + Math.floor(pixelRandom(x, 2, 42) * 3)) {
        r = 92 + n;
        g = 134 + n;
        b = 61 + n * 0.5;
      }
      if (tile === 3) {
        if (pixelRandom(Math.floor(x / 3), Math.floor(y / 2), 22) < 0.23) {
          r -= 14;
          g -= 14;
          b -= 12;
        }
      }
      if (tile === 4) {
        r -= n * 0.55;
        g -= n * 0.55;
        b -= n * 0.55;
      }
      if (tile === 5) {
        const stripe = x % 5 === 0 ? -24 : x % 5 === 1 ? 13 : 0;
        r += stripe;
        g += stripe;
        b += stripe;
        if (y % 8 === 0 && x % 4 < 2) {
          r -= 16;
          g -= 16;
          b -= 12;
        }
      }
      if (tile === 6) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        if (Math.floor(d) % 3 === 0) {
          r -= 31;
          g -= 31;
          b -= 25;
        } else {
          r += 8;
          g += 8;
        }
      }
      if (tile === 7) {
        const cl = pixelRandom(Math.floor(x / 2), Math.floor(y / 2), 33);
        r += cl * 17;
        g += cl * 24;
        b += cl * 8;
        if (pixelRandom(x, y, 571) < 0.11) a = 0;
      }
      if (tile === 8) {
        if (y % 4 === 0) {
          r -= 40;
          g -= 33;
          b -= 25;
        }
        if ((x + (Math.floor(y / 4) % 2) * 8) % 16 === 0) {
          r -= 25;
          g -= 21;
          b -= 16;
        }
        if (y % 4 === 1) {
          r += 11;
          g += 10;
          b += 7;
        }
      }
      if (tile === 9) {
        const yy = y % 5,
          xx = (x + Math.floor(y / 5) * 3) % 7;
        if (yy === 0 || xx === 0) {
          r -= 34;
          g -= 34;
          b -= 29;
        } else if (yy === 1) {
          r += 16;
          g += 16;
          b += 16;
        }
      }
      if (tile === 10) {
        a = 30;
        if (x === 0 || y === 0 || x === 15 || y === 15) {
          r = 177;
          g = 214;
          b = 216;
          a = 210;
        }
        if ((x - y === 4 || x - y === 5) && x > 5 && y > 2) {
          r = 233;
          g = 247;
          b = 240;
          a = 155;
        }
      }
      if (tile === 11) {
        a = 185;
        if ((x + y * 2) % 13 < 2) {
          r += 18;
          g += 23;
          b += 21;
        }
        r -= n * 0.7;
        g -= n * 0.7;
        b -= n * 0.7;
      }
      if (tile === 12) {
        const n2 = pixelRandom(x, y, 1);
        r = 40 + n2 * 53;
        g = 45 + n2 * 52;
        b = 43 + n2 * 48;
      }
      if (tile === 27) {
        // Lava: bright molten base with slow dark crusts, still, since fluids are later.
        const crust = pixelRandom(Math.floor(x / 4), Math.floor(y / 4), 5531);
        const heat = pixelRandom(x, y, 991) * 30;
        r += heat;
        g += heat * 0.45;
        b -= 12;
        if (crust > 0.72) {
          r -= 46;
          g -= 26;
          b -= 10;
        }
      }
      if (tile === 28 || tile === 29) {
        // Bed cloth: a woven texture so the single block still reads as fabric.
        const weave = (x + y) % 4 === 0 ? 12 : (x - y + 16) % 6 === 0 ? -10 : 0;
        r += weave;
        g += weave;
        b += weave;
        if (tile === 29) {
          r += 14;
          g += 10;
          b += 8;
        }
      }
      if (tile >= 13 && tile <= 15) a = 0;
      if (tile === 16) {
        if ((y % 5 === 0 && x % 7 < 4) || (y % 7 === 3 && x % 8 < 2)) {
          r = 58;
          g = 63;
          b = 59;
        }
      }
      // Coal and iron ore: stone with embedded mineral blobs.
      if (tile === 17 || tile === 18) {
        const stone = pixelRandom(x, y, 91);
        r = 122 + stone * 26;
        g = 126 + stone * 24;
        b = 122 + stone * 22;
        const blob = pixelRandom(Math.floor(x / 2), Math.floor(y / 2), 4471);
        if (blob > 0.62) {
          const shade = pixelRandom(x, y, 733);
          if (tile === 17) {
            r = 34 + shade * 30;
            g = 34 + shade * 30;
            b = 36 + shade * 30;
          } else {
            r = 198 + shade * 46;
            g = 128 + shade * 40;
            b = 94 + shade * 34;
          }
        }
      }
      if (tile === 19) {
        // Crafting table side: planks with a dark toolboard stripe.
        if (y < 3 || y === 9) {
          r -= 34;
          g -= 30;
          b -= 22;
        }
        if (x % 8 === 3 && y > 3 && y < 9) {
          r -= 26;
          g -= 24;
          b -= 18;
        }
      }
      if (tile === 20) {
        // Crafting table top: 3x3 grid.
        if (x % 5 === 2 || y % 5 === 2 || x === 0 || y === 0) {
          r -= 42;
          g -= 38;
          b -= 30;
        }
      }
      if (tile === 21) {
        if (x < 2 || x > 13) {
          r -= 30;
          g -= 28;
          b -= 24;
        }
        if (y % 7 === 4) r += 12;
      }
      if (tile === 22) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        if (d > 5.5) {
          r -= 26;
          g -= 24;
          b -= 20;
        } else if (d < 3) {
          r -= 52;
          g -= 50;
          b -= 48;
        }
      }
      if (tile === 23) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        if (d > 5.5) {
          r -= 24;
          g -= 22;
          b -= 18;
        } else if (d < 4) {
          const glow = 1 - d / 4;
          r = 210 + glow * 45;
          g = 120 + glow * 90;
          b = 40 + glow * 40;
        }
      }
      if (tile === 24) {
        r = 158 + pixelRandom(x, y, 61) * 14;
        g = 158 + pixelRandom(x, y, 62) * 14;
        b = 154 + pixelRandom(x, y, 63) * 12;
        if (y % 8 === 0) {
          r -= 10;
          g -= 10;
          b -= 8;
        }
      }
      // Chest sides and lid.
      if (tile === 25 || tile === 26) {
        if (y < 4 || y > 12) {
          r -= 34;
          g -= 28;
          b -= 20;
        }
        if (y === 4 || y === 12) {
          r += 18;
          g += 14;
          b += 10;
        }
        if (tile === 25 && x > 6 && x < 9 && y > 6 && y < 10) {
          r = 226;
          g = 196;
          b = 104;
        }
      }
      const i = (y * 16 + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = a;
    }
  ctx.putImageData(image, 0, 0);
  if (tile === 13 || tile === 14) {
    ctx.fillStyle = '#447d40';
    ctx.fillRect(7, 5, 2, 11);
    ctx.fillRect(5, 11, 3, 2);
    ctx.fillRect(9, 8, 3, 2);
    ctx.fillStyle = tile === 13 ? '#e6b948' : '#f0eee0';
    ctx.fillRect(4, 3, 8, 4);
    ctx.fillRect(6, 1, 4, 8);
    ctx.fillStyle = tile === 13 ? '#ffdc69' : '#e5bc4d';
    ctx.fillRect(6, 3, 4, 3);
  }
  if (tile === 15) {
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? '#789b52' : '#5d8644';
      const x = 2 + i * 2;
      ctx.fillRect(x, 7 + (i % 4), 1, 9 - (i % 4));
      ctx.fillRect(x - 1, 4 + (i % 4), 1, 5);
      ctx.fillRect(x - 2, 2 + (i % 4), 1, 4);
    }
  }
  return c;
}
export function createAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * TILE_STRIDE;
  canvas.height = ATLAS_ROWS * TILE_STRIDE;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const tiles: HTMLCanvasElement[] = [];
  for (let i = 0; i < bases.length; i++) {
    const pixels = terrainPixels(i);
    tiles.push(pixels ? pixelCanvas(pixels) : tileCanvas(i));
  }
  // Every further block texture is generated from the style table, so nothing falls back.
  for (const tile of blockTextureTiles()) {
    if (tile >= EXTRA_TILE_BASE) {
      const pixels = extraTilePixels(tile);
      if (pixels) tiles[tile] = pixelCanvas(pixels);
      continue;
    }
    if (tile < bases.length || tile >= ITEM_TILE_BASE) continue;
    tiles[tile] = generatedTileCanvas(tile);
  }
  // The hand-drawn classic set replaces the older base and generated art where it has a painter.
  for (const tile of CLASSIC_TILES) {
    const pixels = classicTilePixels(tile);
    if (pixels) tiles[tile] = pixelCanvas(pixels);
  }
  // Animated terrain gets an ordinary first-frame icon as well as its GPU filmstrip.
  for (const def of registry.list()) {
    const kind =
      def.fluid === 'water'
        ? 1
        : def.fluid === 'lava'
          ? 2
          : def.key === 'lab:fire'
            ? 3
            : def.key === 'lab:end_portal'
              ? 6
              : def.key === 'lab:nether_portal'
                ? 4
                : 0;
    if (kind) for (const tile of def.textures) tiles[tile] = pixelCanvas(animatedPixels(kind, 0));
  }
  for (let i = 0; i < SPRITE_TILES; i++) {
    const pixels = itemSpritePixels(i);
    if (!pixels) throw new Error(`No sprite art for item sprite ${i}`);
    tiles[spriteTile(i)] = pixelCanvas(pixels);
  }
  for (const kind of [1, 2, 3, 4, 6])
    for (let frame = 0; frame < ANIMATED_FRAMES; frame++)
      tiles[ANIMATED_TILE_BASE + (kind - 1) * ANIMATED_FRAMES + frame] = pixelCanvas(
        animatedPixels(kind, frame),
      );
  for (let i = 0; i < tiles.length; i++) {
    if (!tiles[i]) continue;
    const tile = tiles[i],
      x = (i % ATLAS_COLS) * TILE_STRIDE,
      y = Math.floor(i / ATLAS_COLS) * TILE_STRIDE;
    ctx.drawImage(tile, x + 1, y + 1);
    ctx.drawImage(tile, 0, 0, 16, 1, x + 1, y, 16, 1);
    ctx.drawImage(tile, 0, 15, 16, 1, x + 1, y + 17, 16, 1);
    ctx.drawImage(tile, 0, 0, 1, 16, x, y + 1, 1, 16);
    ctx.drawImage(tile, 15, 0, 1, 16, x + 17, y + 1, 1, 16);
    // Sprites bleed transparently, so keep only the pixel itself for those tiles.
    if (isSpriteTile(i)) {
      ctx.clearRect(x, y, TILE_STRIDE, 1);
      ctx.clearRect(x, y + 17, TILE_STRIDE, 1);
      ctx.clearRect(x, y + 1, 1, 16);
      ctx.clearRect(x + 17, y + 1, 1, 16);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return { canvas, texture, mipTexture: mipAtlas(tiles) };
}

/**
 * The terrain atlas again, without gutters (16 px cells in a power-of-two sheet) and with every
 * mip level down to 1×1. A 2×2 box never straddles two 16-aligned cells before level 5, so levels
 * 1–4 are pure per-tile averages, exactly as in the reference; the terrain shader never asks for
 * more than level 4. Far terrain then shows the calm average of a tile instead of a sparkle of
 * single pixels picked at random by nearest sampling.
 */
export const MIP_ATLAS_WIDTH = ATLAS_COLS * 16;
export const MIP_ATLAS_HEIGHT = ATLAS_ROWS * 16;
function mipAtlas(tiles: readonly (HTMLCanvasElement | undefined)[]): THREE.DataTexture {
  const canvas = document.createElement('canvas');
  canvas.width = MIP_ATLAS_WIDTH;
  canvas.height = MIP_ATLAS_HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  tiles.forEach((tile, i) => {
    if (tile) ctx.drawImage(tile, (i % ATLAS_COLS) * 16, Math.floor(i / ATLAS_COLS) * 16);
  });
  const base = new Uint8Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
  const levels = mipChain(base, canvas.width, canvas.height);
  const texture = new THREE.DataTexture(base, canvas.width, canvas.height, THREE.RGBAFormat);
  texture.mipmaps = levels;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}
/** Every level to 1×1. Colour is averaged by coverage, so cut-out edges do not darken. */
export function mipChain(base: Uint8Array, width: number, height: number) {
  const levels = [{ data: base, width, height }];
  let src = base,
    w = width,
    h = height;
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1),
      nh = Math.max(1, h >> 1),
      out = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++)
      for (let x = 0; x < nw; x++) {
        let r = 0,
          g = 0,
          b = 0,
          a = 0,
          n = 0;
        for (let dy = 0; dy < (h > 1 ? 2 : 1); dy++)
          for (let dx = 0; dx < (w > 1 ? 2 : 1); dx++) {
            const i = (((y * (h > 1 ? 2 : 1) + dy) * w + x * (w > 1 ? 2 : 1) + dx) * 4) | 0;
            const alpha = src[i + 3];
            r += src[i] * alpha;
            g += src[i + 1] * alpha;
            b += src[i + 2] * alpha;
            a += alpha;
            n++;
          }
        const o = (y * nw + x) * 4;
        if (a > 0) {
          out[o] = Math.round(r / a);
          out[o + 1] = Math.round(g / a);
          out[o + 2] = Math.round(b / a);
        }
        out[o + 3] = Math.round(a / n);
      }
    levels.push({ data: out, width: nw, height: nh });
    src = out;
    w = nw;
    h = nh;
  }
  return levels;
}
/** Atlas tile that should represent an item in icons, the held view and world drops. */
export function itemTile(itemKey: string): number {
  const item = itemRegistry.find(itemKey);
  if (!item) return ITEM_TILE_BASE;
  if (item.sprite !== undefined) return spriteTile(item.sprite);
  const def = registry.get(item.block ?? 0);
  return def.shape === 'cross' ? def.textures[0] : def.textures[1];
}
const icons = new Map<number, string>();
/** A model drawn for the icon: fences show a straight run, stairs their profile. */
function iconBoxes(state: number): readonly Box[] {
  const def = registry.get(state);
  if (!def.model) return [[0, 0, 0, 1, 1, 1]];
  if (def.model.kind === 'fence' || def.model.kind === 'wall')
    return renderBoxes(def.model, { north: true, south: true, east: false, west: false });
  return renderBoxes(def.model);
}
/**
 * Inventory icon of a block. Cubes and partial models are drawn in the same isometric view,
 * box by box with the matching part of each texture; plants, doors and panes are flat sprites.
 */
export function blockIcon(state: number, atlas: HTMLCanvasElement): string {
  const cached = icons.get(state);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const def = registry.get(state);
  const source = (tile: number) => ({
    x: (tile % ATLAS_COLS) * TILE_STRIDE + 1,
    y: Math.floor(tile / ATLAS_COLS) * TILE_STRIDE + 1,
  });
  const flat =
    def.shape || def.climbable || def.model?.kind === 'pane' || def.model?.kind === 'door';
  if (flat) {
    if (def.model?.kind === 'door') {
      // The two halves stacked, the way a door stands.
      const base = def.base ?? state;
      const top = source(registry.get(base + 8).textures[1]),
        bottom = source(registry.get(base).textures[1]);
      ctx.drawImage(atlas, top.x, top.y, 16, 16, 18, 2, 28, 30);
      ctx.drawImage(atlas, bottom.x, bottom.y, 16, 16, 18, 32, 28, 30);
    } else {
      const s = source(def.textures[def.model?.kind === 'pane' ? 1 : 0]);
      ctx.drawImage(atlas, s.x, s.y, 16, 16, 4, 4, 56, 56);
    }
  } else {
    const face = (
      tile: number,
      matrix: readonly number[],
      crop: readonly [number, number, number, number],
      shade: number,
    ) => {
      const [u0, v0, u1, v1] = crop.map((value) => Math.round(value * 16));
      if (u1 <= u0 || v1 <= v0) return;
      const s = source(tile);
      ctx.save();
      ctx.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
      ctx.drawImage(atlas, s.x + u0, s.y + v0, u1 - u0, v1 - v0, u0, v0, u1 - u0, v1 - v0);
      if (shade) {
        ctx.fillStyle = `rgba(0,0,0,${shade})`;
        ctx.fillRect(u0, v0, u1 - u0, v1 - v0);
      }
      ctx.restore();
    };
    // Back to front: lower boxes first, then the ones nearer the viewer.
    const boxes = [...iconBoxes(state)].sort((a, b) => a[1] - b[1] || a[0] + a[2] - (b[0] + b[2]));
    for (const [x0, y0, z0, x1, y1, z1] of boxes) {
      // Front-left face (z = z1), front-right face (x = x1), then the top (y = y1).
      face(
        def.textures[1],
        [1.5, 0.75, 0, 1.5, 32 - 24 * z1, 6 + 12 * z1],
        [x0, 1 - y1, x1, 1 - y0],
        0.18,
      );
      face(
        def.textures[1],
        [1.5, -0.75, 0, 1.5, 8 + 24 * x1, 18 + 12 * x1],
        [1 - z1, 1 - y1, 1 - z0, 1 - y0],
        0.04,
      );
      face(def.textures[0], [1.5, 0.75, -1.5, 0.75, 32, 6 + (1 - y1) * 24], [x0, z0, x1, z1], 0);
    }
  }
  const url = c.toDataURL();
  icons.set(state, url);
  return url;
}

/** Style table for the generated tiles, exposed for the atlas tests. */
export function generatedTileCount(): number {
  return blockTextureTiles().filter((tile) => tile >= bases.length && tile < ITEM_TILE_BASE).length;
}
const itemIcons = new Map<string, string>();
/** Flat icon for inventory slots: the block icon for blocks, the sprite for everything else. */
export function itemIcon(itemKey: string, atlas: HTMLCanvasElement): string {
  const cached = itemIcons.get(itemKey);
  if (cached) return cached;
  const item = itemRegistry.find(itemKey);
  if (!item) return '';
  let url: string;
  if (item.block !== undefined) url = blockIcon(item.block, atlas);
  else {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const tile = spriteTile(item.sprite ?? 0);
    ctx.drawImage(
      atlas,
      (tile % ATLAS_COLS) * TILE_STRIDE + 1,
      Math.floor(tile / ATLAS_COLS) * TILE_STRIDE + 1,
      16,
      16,
      4,
      4,
      56,
      56,
    );
    url = c.toDataURL();
  }
  itemIcons.set(itemKey, url);
  return url;
}
