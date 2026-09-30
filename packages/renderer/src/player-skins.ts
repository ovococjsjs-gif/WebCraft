import { rgb, shade, type Rgb, type SkinFace, type SkinPainter } from './mob-skins';

/**
 * The player's skins. Three original WebCraft characters are painted procedurally, and any
 * standard 64×64 (or legacy 64×32) Minecraft-layout PNG can be worn instead: `skinFromImage`
 * reads it box by box into the same painters. Parts follow the reference's two layers: a base
 * body and a slightly larger outer layer (hat, jacket, sleeves, trouser legs) with holes.
 */
export type PlayerPart =
  | 'head'
  | 'hat'
  | 'body'
  | 'jacket'
  | 'armR'
  | 'armL'
  | 'sleeveR'
  | 'sleeveL'
  | 'legR'
  | 'legL'
  | 'pantsR'
  | 'pantsL';
export const PLAYER_PARTS: readonly PlayerPart[] = [
  'head',
  'hat',
  'body',
  'jacket',
  'armR',
  'armL',
  'sleeveR',
  'sleeveL',
  'legR',
  'legL',
  'pantsR',
  'pantsL',
];
export interface PlayerSkin {
  readonly id: string;
  readonly name: string;
  /** Three-pixel arms, like the reference's slim model. */
  readonly slim: boolean;
  /** Skin tone and sleeve colour for the first-person arm. */
  readonly arm: { readonly skin: string; readonly sleeve: string; readonly cuff: string };
  readonly paint: Readonly<Record<PlayerPart, SkinPainter>>;
}
/** Box sizes in skin pixels (w, h, d), per part and arm width. */
export function partSize(part: PlayerPart, slim: boolean): [number, number, number] {
  if (part === 'head' || part === 'hat') return [8, 8, 8];
  if (part === 'body' || part === 'jacket') return [8, 12, 4];
  if (part.startsWith('arm') || part.startsWith('sleeve')) return [slim ? 3 : 4, 12, 4];
  return [4, 12, 4];
}

const hex = (c: Rgb) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const clear: SkinPainter = (f) => f.rect(0, 0, f.w, f.h, null);
/** The limb's outer side: +x for the right limbs, −x for the left ones. */
const outer = (f: SkinFace, right: boolean) => f.name === (right ? 'px' : 'nx');
const vertical = (f: SkinFace) => f.name !== 'top' && f.name !== 'bottom';

interface Look {
  skin: Rgb;
  hair: Rgb;
  eye: Rgb;
  brow: Rgb;
  mouth: Rgb;
}
/** The face every built-in character shares: two-pixel eyes with a white, brows, nose shade. */
function face(f: SkinFace, look: Look, fringe: (f: SkinFace) => void) {
  f.fill(look.skin, 0.035);
  if (f.name === 'top') return f.fill(look.hair, 0.1);
  if (f.name === 'bottom') return f.tone(0, 0, f.w, f.h, 0.82);
  fringe(f);
  if (f.name !== 'front') return;
  f.rect(1, 3, 2, 1, look.brow);
  f.rect(5, 3, 2, 1, look.brow);
  f.px(1, 4, rgb('#f4f1ea'));
  f.px(2, 4, look.eye);
  f.px(5, 4, look.eye);
  f.px(6, 4, rgb('#f4f1ea'));
  f.rect(3, 5, 2, 1, shade(look.skin, 0.86));
  f.rect(3, 6, 2, 1, look.mouth);
  f.px(0, 5, shade(look.skin, 0.95));
  f.px(7, 5, shade(look.skin, 0.95));
}
function hairRows(f: SkinFace, hair: Rgb, rows: readonly number[]) {
  // rows[i]: how far the hair comes down column i (front view left to right).
  for (let x = 0; x < f.w; x++)
    for (let y = 0; y < (rows[x] ?? rows[rows.length - 1]); y++)
      f.px(x, y, shade(hair, 0.9 + f.random() * 0.2));
}
/** A sleeve that ends `length` pixels down the arm with a darker cuff row. */
function sleeveArm(f: SkinFace, skin: Rgb, cloth: Rgb, length: number, cuff: Rgb) {
  f.fill(skin, 0.035);
  if (f.name === 'top') return f.fill(cloth, 0.06);
  if (f.name === 'bottom') return f.tone(0, 0, f.w, f.h, 0.85);
  f.rect(0, 0, f.w, length, cloth);
  for (let y = 0; y < length; y++)
    for (let x = 0; x < f.w; x++) f.px(x, y, shade(cloth, 0.94 + f.random() * 0.1));
  f.rect(0, length - 1, f.w, 1, cuff);
  f.rect(0, f.h - 1, f.w, 1, shade(skin, 0.88));
}

// ------------------------------------------------------------------------- the traveller
function traveller(): PlayerSkin {
  const look: Look = {
    skin: rgb('#d8a57a'),
    hair: rgb('#5a3a22'),
    eye: rgb('#3d5f8a'),
    brow: rgb('#3f2817'),
    mouth: rgb('#a4674b'),
  };
  const tunic = rgb('#2f8f8a'),
    trim = rgb('#226c68'),
    belt = rgb('#6b4a2b'),
    strap = rgb('#7a5634'),
    buckle = rgb('#d8b04a'),
    trousers = rgb('#5b4a3a'),
    boot = rgb('#3b2a1e'),
    scarf = rgb('#b8452f');
  const leg =
    (right: boolean): SkinPainter =>
    (f) => {
      f.fill(trousers, 0.06);
      if (f.name === 'bottom') return f.fill(shade(boot, 0.8), 0.04);
      if (f.name === 'top') return;
      f.rect(0, 8, f.w, 4, boot);
      for (let x = 0; x < f.w; x++) f.px(x, 8, shade(boot, 1.25));
      if (f.name === 'front') f.px(right ? 1 : 2, 5, shade(trousers, 0.8));
      if (outer(f, right)) f.tone(0, 0, f.w, 8, 0.93);
    };
  return {
    id: 'traveller',
    name: 'Путник',
    slim: false,
    arm: { skin: hex(look.skin), sleeve: hex(tunic), cuff: hex(trim) },
    paint: {
      head: (f) =>
        face(f, look, (g) => {
          if (g.name === 'front') hairRows(g, look.hair, [3, 2, 2, 1, 2, 2, 2, 3]);
          else if (g.name === 'back') hairRows(g, look.hair, [6, 7, 7, 7, 7, 7, 7, 6]);
          else
            hairRows(
              g,
              look.hair,
              g.name === 'px' ? [6, 4, 3, 3, 3, 3, 3, 2] : [2, 3, 3, 3, 3, 3, 4, 6],
            );
        }),
      hat: (f) => {
        clear(f);
        // Loose strands over the ears and the crown give the hair volume.
        if (f.name === 'top')
          for (let i = 0; i < 14; i++)
            f.px(f.random() * 8, f.random() * 8, shade(look.hair, 0.95 + f.random() * 0.2));
        if (f.name === 'back') hairRows(f, look.hair, [2, 1, 1, 1, 1, 1, 1, 2]);
        if (f.name === 'front') {
          f.px(0, 0, look.hair);
          f.px(1, 0, shade(look.hair, 1.1));
          f.px(7, 0, look.hair);
        }
      },
      body: (f) => {
        f.fill(tunic, 0.06);
        if (f.name === 'bottom') return f.fill(trousers, 0.05);
        if (f.name === 'top') return;
        f.rect(0, 11, f.w, 1, trim);
        f.rect(0, 8, f.w, 1, belt);
        if (f.name === 'front') {
          // V-neck, strap across the chest, buckle.
          f.px(3, 0, look.skin);
          f.px(4, 0, look.skin);
          f.px(3, 1, shade(look.skin, 0.9));
          f.px(4, 1, shade(tunic, 0.8));
          for (let i = 0; i < 8; i++) f.px(i, 7 - i, strap);
          f.rect(3, 8, 2, 1, buckle);
          f.rect(0, 9, f.w, 2, shade(tunic, 0.92));
        }
        if (f.name === 'back') for (let i = 0; i < 8; i++) f.px(7 - i, 7 - i, strap);
        if (f.side) f.px(1, 8, shade(belt, 1.2));
      },
      jacket: (f) => {
        clear(f);
        // A red scarf round the neck, its tail hanging down the back.
        if (f.name === 'top') f.rect(0, 0, f.w, f.h, scarf);
        if (!vertical(f)) return;
        f.rect(0, 0, f.w, 2, scarf);
        for (let x = 0; x < f.w; x++) f.px(x, 1, shade(scarf, 0.82));
        if (f.name === 'back') {
          f.rect(5, 2, 2, 3, shade(scarf, 0.9));
          f.px(5, 5, shade(scarf, 0.75));
        }
      },
      armR: (f) => sleeveArm(f, look.skin, tunic, 5, trim),
      armL: (f) => sleeveArm(f, look.skin, tunic, 5, trim),
      sleeveR: clear,
      sleeveL: (f) => {
        clear(f);
        // A leather bracer on the left wrist.
        if (vertical(f)) f.rect(0, 8, f.w, 2, strap);
      },
      legR: leg(true),
      legL: leg(false),
      pantsR: clear,
      pantsL: clear,
    },
  };
}

// ---------------------------------------------------------------------------- the miner
function miner(): PlayerSkin {
  const look: Look = {
    skin: rgb('#b07a55'),
    hair: rgb('#2f2219'),
    eye: rgb('#2c1c12'),
    brow: rgb('#2a1c12'),
    mouth: rgb('#5a3522'),
  };
  const beard = rgb('#3a2a1c'),
    plaidA = rgb('#a83a32'),
    plaidB = rgb('#6e231f'),
    denim = rgb('#3f5f8a'),
    seam = rgb('#e0b53a'),
    boot = rgb('#5b3a22'),
    helmet = rgb('#e0b53a'),
    lamp = rgb('#fff3b0');
  const plaid = (f: SkinFace, x0 = 0) => {
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++) {
        const a = (x + x0) % 4 < 2,
          b = y % 4 < 2;
        const c = a && b ? plaidB : a || b ? plaidA : shade(plaidA, 1.15);
        f.px(x, y, shade(c, 0.95 + f.random() * 0.1));
      }
  };
  const leg =
    (right: boolean): SkinPainter =>
    (f) => {
      f.fill(denim, 0.07);
      if (f.name === 'bottom') return f.fill(shade(boot, 0.8), 0.04);
      if (f.name === 'top') return;
      f.rect(0, 9, f.w, 3, boot);
      for (let x = 0; x < f.w; x++) f.px(x, 9, shade(boot, 1.3));
      if (outer(f, right)) for (let y = 0; y < 9; y++) f.px(1, y, shade(denim, 1.15));
      if (f.name === 'front') f.rect(0, 3, f.w, 1, shade(denim, 0.85));
    };
  return {
    id: 'miner',
    name: 'Рудокоп',
    slim: false,
    arm: { skin: hex(look.skin), sleeve: hex(plaidA), cuff: hex(plaidB) },
    paint: {
      head: (f) =>
        face(f, look, (g) => {
          if (g.name === 'back') hairRows(g, look.hair, [5, 5, 5, 5, 5, 5, 5, 5]);
          else if (g.side) hairRows(g, look.hair, g.name === 'px' ? [4, 3, 2, 2] : [2, 2, 3, 4]);
          if (g.name === 'front') {
            // Full beard with the mouth showing through.
            for (let x = 0; x < 8; x++)
              for (let y = 5; y < 8; y++)
                if (!(y === 5 && x > 1 && x < 6)) g.px(x, y, shade(beard, 0.9 + g.random() * 0.2));
            g.rect(3, 6, 2, 1, look.mouth);
          }
          if (g.side)
            for (let y = 4; y < 8; y++)
              g.px(g.name === 'px' ? 0 : 7, y, shade(beard, 0.9 + g.random() * 0.2));
          if (g.side) for (let x = 0; x < 3; x++) g.px(g.name === 'px' ? x : 7 - x, 7, beard);
        }),
      hat: (f) => {
        clear(f);
        // A hard hat with a brim and a glowing lamp.
        if (f.name === 'top') {
          f.fill(helmet, 0.06);
          f.rect(3, 0, 2, 8, shade(helmet, 1.12));
          return;
        }
        if (!vertical(f)) return;
        for (let y = 0; y < 3; y++)
          for (let x = 0; x < f.w; x++) f.px(x, y, shade(helmet, 0.92 + f.random() * 0.12));
        f.rect(0, 2, f.w, 1, shade(helmet, 0.72));
        if (f.name === 'front') {
          f.rect(3, 0, 2, 2, lamp, 1);
          f.px(2, 1, rgb('#8c8c8c'));
          f.px(5, 1, rgb('#8c8c8c'));
        }
      },
      body: (f) => {
        plaid(f);
        if (f.name === 'bottom') return f.fill(denim, 0.05);
        if (f.name === 'top') return;
        // Overalls: bib on the chest, straps over the shoulders.
        if (f.name === 'front') {
          f.rect(1, 4, 6, 8, denim);
          for (let y = 4; y < 12; y++)
            for (let x = 1; x < 7; x++) f.px(x, y, shade(denim, 0.93 + f.random() * 0.12));
          f.rect(1, 0, 1, 4, denim);
          f.rect(6, 0, 1, 4, denim);
          f.px(1, 4, seam);
          f.px(6, 4, seam);
          f.rect(3, 6, 2, 2, shade(denim, 0.8));
        } else if (f.name === 'back') {
          f.rect(0, 7, 8, 5, denim);
          for (let i = 0; i < 7; i++) {
            f.px(1 + i * 0.85, i, denim);
            f.px(6 - i * 0.85, i, denim);
          }
        } else f.rect(0, 7, f.w, 5, denim);
      },
      jacket: clear,
      armR: (f) => {
        sleeveArm(f, look.skin, plaidA, 6, plaidB);
        if (vertical(f)) for (let y = 0; y < 5; y++) f.px(1, y, plaidB);
        if (vertical(f))
          for (let y = 7; y < 11; y++)
            if (f.random() < 0.3) f.px(f.random() * f.w, y, shade(look.skin, 0.8));
      },
      armL: (f) => {
        sleeveArm(f, look.skin, plaidA, 6, plaidB);
        if (vertical(f)) for (let y = 0; y < 5; y++) f.px(2, y, plaidB);
      },
      sleeveR: clear,
      sleeveL: clear,
      legR: leg(true),
      legL: leg(false),
      pantsR: clear,
      pantsL: clear,
    },
  };
}

// --------------------------------------------------------------------------- the ranger
function ranger(): PlayerSkin {
  const look: Look = {
    skin: rgb('#e8bf9a'),
    hair: rgb('#8a3b22'),
    eye: rgb('#3f7a3a'),
    brow: rgb('#6a2c18'),
    mouth: rgb('#c0776a'),
  };
  const cloak = rgb('#3f5a2e'),
    lining = rgb('#2e4322'),
    leather = rgb('#7a5634'),
    tan = rgb('#9a8058'),
    boot = rgb('#4a3222'),
    clasp = rgb('#c9c2a8');
  const leg =
    (right: boolean): SkinPainter =>
    (f) => {
      f.fill(tan, 0.06);
      if (f.name === 'bottom') return f.fill(shade(boot, 0.8), 0.04);
      if (f.name === 'top') return;
      f.rect(0, 6, f.w, 6, boot);
      for (let y = 6; y < 12; y++)
        for (let x = 0; x < f.w; x++) f.px(x, y, shade(boot, 0.94 + f.random() * 0.1));
      for (let x = 0; x < f.w; x++) f.px(x, 6, shade(boot, 1.3));
      if (outer(f, right)) f.px(1, 8, clasp);
    };
  return {
    id: 'ranger',
    name: 'Следопыт',
    slim: true,
    arm: { skin: hex(look.skin), sleeve: hex(cloak), cuff: hex(leather) },
    paint: {
      head: (f) =>
        face(f, look, (g) => {
          if (g.name === 'front') {
            hairRows(g, look.hair, [3, 2, 1, 1, 1, 2, 3, 3]);
            g.px(1, 5, shade(look.skin, 0.84));
            g.px(6, 5, shade(look.skin, 0.84));
            g.px(2, 6, shade(look.skin, 0.88));
          } else if (g.name === 'back') hairRows(g, look.hair, [8, 8, 8, 8, 8, 8, 8, 8]);
          else
            hairRows(
              g,
              look.hair,
              g.name === 'px' ? [8, 7, 5, 4, 3, 3, 3, 3] : [3, 3, 3, 3, 4, 5, 7, 8],
            );
        }),
      hat: (f) => {
        clear(f);
        // Hair falls past the shoulders at the back; a braid on the right.
        if (f.name === 'back') hairRows(f, look.hair, [4, 6, 7, 8, 8, 7, 6, 4]);
        if (f.name === 'px') {
          for (let y = 3; y < 8; y++) f.px(0, y, shade(look.hair, y % 2 ? 0.85 : 1.05));
          f.px(1, 7, leather);
        }
        if (f.name === 'top')
          for (let i = 0; i < 10; i++) f.px(f.random() * 8, f.random() * 8, shade(look.hair, 1.1));
      },
      body: (f) => {
        f.fill(cloak, 0.06);
        if (f.name === 'bottom') return f.fill(tan, 0.05);
        if (f.name === 'top') return;
        f.rect(0, 9, f.w, 1, leather);
        if (f.name === 'front') {
          f.rect(2, 0, 4, 1, shade(look.skin, 0.95));
          f.rect(3, 1, 2, 1, lining);
          for (let i = 0; i < 9; i++) f.px(6 - i * 0.62, i, leather);
          f.px(3, 9, clasp);
          f.rect(0, 10, f.w, 2, tan);
        }
        if (f.name === 'back') {
          // A quiver across the back.
          for (let y = 0; y < 9; y++) {
            f.px(1 + y * 0.6, y, leather);
            f.px(2 + y * 0.6, y, shade(leather, 0.8));
          }
          f.px(1, 0, rgb('#e8e2d0'));
          f.px(2, 0, rgb('#b8452f'));
        }
      },
      jacket: (f) => {
        clear(f);
        // The hood lies on the shoulders; the cloak hangs down the back.
        if (f.name === 'top') f.rect(0, 0, f.w, f.h, lining);
        if (f.name === 'back')
          for (let y = 0; y < 12; y++)
            for (let x = 0; x < 8; x++)
              if (y < 2 || x > 0 || y < 10)
                f.px(x, y, shade(y < 2 ? lining : cloak, 0.92 + f.random() * 0.14));
        if (f.side) f.rect(0, 0, f.w, 2, lining);
        if (f.name === 'front') {
          f.rect(0, 0, 2, 2, lining);
          f.rect(6, 0, 2, 2, lining);
          f.px(1, 1, clasp);
        }
      },
      armR: (f) => sleeveArm(f, look.skin, cloak, 8, leather),
      armL: (f) => sleeveArm(f, look.skin, cloak, 8, leather),
      sleeveR: clear,
      sleeveL: (f) => {
        clear(f);
        if (vertical(f)) f.rect(0, 8, f.w, 3, leather);
        if (f.name === 'front') f.px(1, 9, clasp);
      },
      legR: leg(true),
      legL: leg(false),
      pantsR: clear,
      pantsL: clear,
    },
  };
}

export const BUILTIN_SKINS: readonly PlayerSkin[] = [traveller(), miner(), ranger()];

// ------------------------------------------------------------------ Minecraft-layout PNGs
export interface SkinImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray | Uint8Array;
}
/** Texture origin (u, v) of each box in the standard 64×64 layout. */
const LAYOUT: Record<PlayerPart, readonly [number, number]> = {
  head: [0, 0],
  hat: [32, 0],
  body: [16, 16],
  jacket: [16, 32],
  armR: [40, 16],
  sleeveR: [40, 32],
  armL: [32, 48],
  sleeveL: [48, 48],
  legR: [0, 16],
  pantsR: [0, 32],
  legL: [16, 48],
  pantsL: [0, 48],
};
const OVERLAYS = new Set<PlayerPart>(['hat', 'jacket', 'sleeveR', 'sleeveL', 'pantsR', 'pantsL']);
/** The reference's own heuristic: a slim skin leaves column 54 of the right arm empty. */
export function detectSlim(img: SkinImage): boolean {
  if (img.height < 64) return false;
  return img.data[(20 * img.width + 54) * 4 + 3] === 0;
}
export function validSkinImage(img: SkinImage): boolean {
  return img.width === 64 && (img.height === 64 || img.height === 32);
}
/**
 * Reads a standard skin into painters. Base-layer pixels are opaque (a hole shows as black, as
 * in the reference); outer-layer pixels below half alpha are holes. A 64×32 legacy skin has no
 * outer layer except the hat and mirrors its right limbs onto the left.
 */
export function skinFromImage(
  img: SkinImage,
  slim = detectSlim(img),
  name = 'Свой скин',
): PlayerSkin {
  const legacy = img.height === 32;
  const at = (x: number, y: number): [number, number, number, number] => {
    const o = (y * img.width + x) * 4;
    return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]];
  };
  const painter = (part: PlayerPart): SkinPainter => {
    let source = part,
      mirror = false;
    if (legacy && (part === 'armL' || part === 'legL')) {
      source = part === 'armL' ? 'armR' : 'legR';
      mirror = true;
    }
    const overlay = OVERLAYS.has(part);
    if (legacy && overlay && part !== 'hat') return clear;
    const [w, , d] = partSize(part, slim);
    const [u, v] = LAYOUT[source];
    return (f) => {
      let name = f.name;
      if (mirror && (name === 'px' || name === 'nx')) name = name === 'px' ? 'nx' : 'px';
      // Face origins in the texture, reference order: right, front, left, back; top, bottom.
      const origin: Record<string, readonly [number, number]> = {
        px: [u, v + d],
        front: [u + d, v + d],
        nx: [u + d + w, v + d],
        back: [u + 2 * d + w, v + d],
        top: [u + d, v],
        bottom: [u + d + w, v],
      };
      const [ox, oy] = origin[name];
      for (let y = 0; y < f.h; y++)
        for (let x = 0; x < f.w; x++) {
          // Top and bottom are stored turned half round relative to our face pictures.
          let sx = f.name === 'top' || f.name === 'bottom' ? f.w - 1 - x : x;
          const sy = f.name === 'top' || f.name === 'bottom' ? f.h - 1 - y : y;
          if (mirror) sx = f.w - 1 - sx;
          const [r, g, b, a] = at(ox + sx, oy + sy);
          if (overlay) f.px(x, y, a < 128 ? null : [r, g, b]);
          else f.px(x, y, a === 0 && r + g + b === 0 ? [0, 0, 0] : [r, g, b]);
        }
    };
  };
  const paint = {} as Record<PlayerPart, SkinPainter>;
  for (const part of PLAYER_PARTS) paint[part] = painter(part);
  // First-person arm colours: sampled from the right arm's front face.
  const [aw] = partSize('armR', slim);
  const sample = (y: number) => {
    const [r, g, b] = at(44 + Math.floor(aw / 2), 20 + y);
    return hex([r, g, b]);
  };
  const low = at(44 + Math.floor(aw / 2), 30);
  return {
    id: 'custom',
    name,
    slim,
    arm: {
      skin: hex([low[0], low[1], low[2]]),
      sleeve: sample(1),
      cuff: hex(shade(rgb(sample(3)), 0.85)),
    },
    paint,
  };
}
