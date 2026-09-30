import * as THREE from 'three';
import { mobDefinition } from '../../core/src/mobs';
import { SkinAtlas, SkinFace, rgb, shade, type Rgb, type SkinPainter } from './mob-skins';
import {
  BUILTIN_SKINS,
  PLAYER_PARTS,
  partSize,
  type PlayerPart,
  type PlayerSkin,
} from './player-skins';

/** Materials an armour piece can be made of; the name is the item key's prefix. */
export const ARMOR_MATERIALS = ['leather', 'chain', 'iron', 'gold', 'diamond'] as const;
export type ArmorMaterial = (typeof ARMOR_MATERIALS)[number];
/** base, shadow, deep, highlight */
const ARMOR_PALETTE: Record<ArmorMaterial, readonly [string, string, string, string]> = {
  leather: ['#9c6440', '#7c4a2c', '#553220', '#bd8558'],
  chain: ['#8f9398', '#6c7075', '#46494d', '#c3c7cc'],
  iron: ['#d6d6d6', '#a9a9a9', '#6f6f6f', '#f6f6f6'],
  gold: ['#f2d24b', '#c9a22e', '#8a6a14', '#fff3a6'],
  diamond: ['#5fe0d5', '#36b3a8', '#1f7a72', '#d2fffa'],
};
/** Player skins by rig variant: the three characters, then the uploaded skin (classic, slim). */
export const PLAYER_VARIANTS = BUILTIN_SKINS.length + 2;
export function playerSkinKey(variant: number) {
  return variant < BUILTIN_SKINS.length
    ? BUILTIN_SKINS[variant].id
    : variant === BUILTIN_SKINS.length
      ? 'custom'
      : 'custom-slim';
}
export function playerVariantSlim(variant: number) {
  return variant < BUILTIN_SKINS.length
    ? BUILTIN_SKINS[variant].slim
    : variant === BUILTIN_SKINS.length + 1;
}

/**
 * Creature rigs with Minecraft 1.12 proportions, built in skin pixels (1 px = 1/16 block).
 * Joint names are the animation contract of `EntityModels.animate`:
 * `head`, `skull` (the enderman's upper head), `leg-*`, `arm-*`, `spider-*`, `bird-*`, `rod-*`.
 * Meshes flagged `userData.wool` hide on a shorn sheep and `userData.shorn` ones show instead.
 * Creatures face −z.
 */
type V3 = readonly [number, number, number];
type Palette = readonly (readonly [Rgb, number])[];

const BLACK = rgb('#151515');
const WHITE = rgb('#f2f2f2');
/** Wool shades per `WOOL_COLORS` index: base, shadow, light, deep. */
const WOOL: readonly (readonly [string, string, string, string])[] = [
  ['#ebe8e2', '#dedad2', '#f7f5f0', '#cdc8bf'],
  ['#25232a', '#1c1b20', '#34313a', '#131216'],
  ['#4d5156', '#43464b', '#5d6167', '#36393d'],
  ['#a3a19d', '#96948f', '#b5b3ae', '#85837f'],
  ['#6f4c2f', '#634329', '#80593a', '#533722'],
  ['#e9a3b8', '#de94ab', '#f4bccd', '#cf839b'],
];

export class MobRigs {
  private s = 1 / 16;
  constructor(
    readonly atlas: SkinAtlas,
    private readonly geometry: THREE.BufferGeometry,
    private readonly material: THREE.Material,
  ) {}
  private cube(
    parent: THREE.Object3D,
    key: string,
    size: V3,
    center: V3,
    paint: SkinPainter,
    inflate = 0,
  ) {
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.userData.skinPart = this.atlas.part(key, size, paint);
    mesh.scale.set(
      (size[0] + inflate * 2) * this.s,
      (size[1] + inflate * 2) * this.s,
      (size[2] + inflate * 2) * this.s,
    );
    mesh.position.set(center[0] * this.s, center[1] * this.s, center[2] * this.s);
    mesh.userData.restPosition = mesh.position.clone();
    parent.add(mesh);
    return mesh;
  }
  private joint(parent: THREE.Object3D, name: string, pivot: V3) {
    const j = new THREE.Group();
    j.name = name;
    j.position.set(pivot[0] * this.s, pivot[1] * this.s, pivot[2] * this.s);
    parent.add(j);
    return j;
  }
  build(kind: string, variant = 0): THREE.Group {
    const g = new THREE.Group();
    g.userData.kind = kind;
    g.userData.variant = variant;
    this.s = 1 / 16;
    switch (kind) {
      case 'lab:cow':
        this.cow(g, kind);
        break;
      case 'lab:pig':
        this.pig(g, kind);
        break;
      case 'lab:sheep':
        this.sheep(g, kind, Math.max(0, Math.min(WOOL.length - 1, variant)));
        break;
      case 'lab:chicken':
        this.chicken(g, kind);
        break;
      case 'lab:creeper':
        this.creeper(g, kind);
        break;
      case 'lab:spider':
        this.spider(g, kind);
        break;
      case 'lab:blaze':
        this.blaze(g, kind);
        break;
      case 'lab:skeleton':
        this.skeleton(g, kind, false);
        break;
      case 'lab:wither_skeleton':
        this.s = 1.2 / 16;
        this.skeleton(g, kind, true);
        break;
      case 'lab:enderman':
        this.enderman(g, kind);
        break;
      case 'lab:dummy':
        this.dummy(g, kind);
        break;
      case 'lab:slime':
      case 'lab:slime_medium':
      case 'lab:slime_small':
        this.s = (mobDefinition(kind)!.width / 0.51) * (1 / 16) * 1.02;
        this.slime(g);
        break;
      case 'lab:magma_cube':
      case 'lab:magma_cube_medium':
      case 'lab:magma_cube_small':
        this.s = (mobDefinition(kind)!.width / 0.51) * (1 / 16) * 1.02;
        this.magmaCube(g);
        break;
      case 'lab:ghast':
        this.s = 4 / 16;
        this.ghast(g);
        break;
      case 'lab:player':
        this.player(g, Math.max(0, Math.min(PLAYER_VARIANTS - 1, variant)));
        break;
      case 'lab:villager':
        this.villager(g, kind, variant);
        break;
      default:
        this.clothed(g, kind);
    }
    return g;
  }
  /**
   * A 1.12 villager: a long head with the big nose and the one brow, a robe to the shins, the
   * arms folded in front, and the robe's colour telling the career (see core trading.ts):
   * farmer brown, librarian white, priest purple, smith black apron, butcher white apron.
   */
  private villager(g: THREE.Group, kind: string, variant: number) {
    const careers = [
      { robe: '#6e4a2c', trim: '#8a6038', apron: null, hat: '#c9a45a' },
      { robe: '#e9e4d8', trim: '#cfc8b8', apron: null, hat: null },
      { robe: '#7b3b91', trim: '#a35bbb', apron: null, hat: null },
      { robe: '#6e4a2c', trim: '#8a6038', apron: '#27272b', hat: null },
      { robe: '#6e4a2c', trim: '#8a6038', apron: '#ecebe6', hat: null },
    ] as const;
    const c = careers[Math.max(0, Math.min(careers.length - 1, variant))];
    const id = `${kind}/${variant}`;
    const skin = rgb('#b98a68'),
      robe = rgb(c.robe),
      trim = rgb(c.trim),
      brow = rgb('#3e2a1e');
    const cloth = (f: SkinFace) => {
      f.fill(robe, 0.08);
      // Folds of the robe: darker vertical stripes.
      for (let x = 1; x < f.w; x += 3) f.tone(x, 0, 1, f.h, 0.88);
      if (f.name === 'bottom') f.tone(0, 0, f.w, f.h, 0.7);
    };
    for (const sign of [-1, 1]) {
      const j = this.joint(g, `leg-${sign}-0`, [sign * 2, 12, 0]);
      j.userData.phase = sign > 0 ? 0 : Math.PI;
      this.cube(j, `${id}/leg`, [4, 12, 4], [0, -6, 0], (f) => {
        f.fill(shade(robe, 0.8), 0.06);
        if (f.name === 'bottom') f.fill(rgb('#3b2a1e'), 0.05);
        else if (f.name !== 'top') f.rect(0, 10, f.w, 2, rgb('#3b2a1e'));
      });
    }
    // The body, and the robe hanging over it down to the shins.
    this.cube(g, `${id}/body`, [8, 12, 6], [0, 18, 0], (f) => {
      cloth(f);
      if (f.name === 'top') f.fill(trim, 0.06);
    });
    this.cube(
      g,
      `${id}/robe`,
      [8, 18, 6],
      [0, 15, 0],
      (f) => {
        cloth(f);
        if (f.name === 'top') return f.rect(0, 0, f.w, f.h, null);
        if (f.name !== 'bottom') f.rect(0, f.h - 1, f.w, 1, trim);
        if (c.apron && f.name === 'front') {
          f.rect(1, 2, f.w - 2, f.h - 4, rgb(c.apron));
          f.tone(1, 2, f.w - 2, 1, 0.85);
        }
      },
      0.5,
    );
    // Folded arms: a bar across with the two forearms, tilted forward like the reference.
    const arms = this.joint(g, 'folded', [0, 21, -3]);
    arms.rotation.x = -0.75;
    const sleeve = (f: SkinFace) => {
      f.fill(robe, 0.07);
      f.tone(0, 0, f.w, 1, 1.1);
    };
    this.cube(arms, `${id}/arm`, [4, 8, 4], [-6, -2, 1], sleeve);
    this.cube(arms, `${id}/arm`, [4, 8, 4], [6, -2, 1], sleeve);
    this.cube(arms, `${id}/hands`, [8, 4, 4], [0, -4, 1], (f) => {
      f.fill(skin, 0.07);
      if (f.name === 'front') for (let x = 1; x < f.w; x += 2) f.px(x, 1, shade(skin, 0.85));
    });
    const head = this.joint(g, 'head', [0, 24, 0]);
    this.cube(head, `${id}/head`, [8, 10, 8], [0, 5, 0], (f) => {
      f.fill(skin, 0.06);
      if (f.name === 'top') {
        if (c.hat) f.fill(rgb(c.hat), 0.1);
        return;
      }
      if (f.name === 'bottom') return f.tone(0, 0, f.w, f.h, 0.8);
      if (c.hat) {
        f.rect(0, 0, f.w, 2, rgb(c.hat));
        f.tone(0, 1, f.w, 1, 0.85);
      }
      if (f.name !== 'front') return;
      // The single brow, green eyes with white, the mouth under the nose.
      f.rect(1, 3, 6, 1, brow);
      f.rect(1, 4, 2, 1, WHITE);
      f.rect(5, 4, 2, 1, WHITE);
      f.px(2, 4, rgb('#2f8a3a'));
      f.px(5, 4, rgb('#2f8a3a'));
      f.rect(2, 8, 4, 1, shade(skin, 0.7));
    });
    this.cube(head, `${id}/nose`, [2, 4, 2], [0, 2, -5], (f) => {
      f.fill(shade(skin, 0.95), 0.05);
      if (f.name === 'bottom') f.tone(0, 0, f.w, f.h, 0.8);
    });
  }

  // -------------------------------------------------------------------- the player
  /** Repaints the uploaded-skin variants; returns false if the rigs were never built. */
  wearCustom(skin: PlayerSkin) {
    let ok = true;
    const key = skin.slim ? 'custom-slim' : 'custom';
    for (const part of PLAYER_PARTS)
      ok = this.atlas.repaint(`lab:player/${key}/${part}`, skin.paint[part]) && ok;
    return ok;
  }
  /**
   * The reference's player model (1.8+ layout): a base body and an outer layer half a pixel to a
   * pixel larger, the head and arms pivoting at the neck and shoulders, legs at the hips. The body
   * has its own joint at the neck so sneaking can lean it. Every armour piece of every material is
   * built in and hidden; `userData.armor` = { slot, material } tells the avatar which to show.
   * `hand-1` / `hand--1` mark where items are held.
   */
  private player(g: THREE.Group, variant: number) {
    const key = playerSkinKey(variant),
      slim = playerVariantSlim(variant);
    // The uploaded variants start as the traveller (classic) or the ranger (slim).
    const skin = BUILTIN_SKINS[variant] ?? BUILTIN_SKINS[slim ? 2 : 0];
    const part = (parent: THREE.Object3D, name: PlayerPart, center: V3, inflate = 0) =>
      this.cube(
        parent,
        `lab:player/${key}/${name}`,
        partSize(name, slim),
        center,
        skin.paint[name],
        inflate,
      );
    const armor = (
      parent: THREE.Object3D,
      slot: number,
      piece: 'helmet' | 'chest' | 'arm' | 'belt' | 'legs' | 'boots',
      size: V3,
      center: V3,
      inflate: number,
    ) => {
      for (const material of ARMOR_MATERIALS) {
        const m = this.cube(
          parent,
          `armor/${material}/${piece}/${size[0]}`,
          size,
          center,
          armorPainter(material, piece),
          inflate,
        );
        m.visible = false;
        m.userData.armor = { slot, material };
      }
    };
    const body = this.joint(g, 'body', [0, 24, 0]);
    part(body, 'body', [0, -6, 0]);
    part(body, 'jacket', [0, -6, 0], 0.25);
    armor(body, 1, 'chest', [8, 12, 4], [0, -6, 0], 1);
    armor(body, 2, 'belt', [8, 12, 4], [0, -6, 0], 0.5);
    const head = this.joint(g, 'head', [0, 24, 0]);
    part(head, 'head', [0, 4, 0]);
    part(head, 'hat', [0, 4, 0], 0.5);
    armor(head, 0, 'helmet', [8, 8, 8], [0, 4, 0], 1);
    const aw = slim ? 3 : 4;
    for (const sign of [1, -1]) {
      const right = sign > 0;
      const arm = this.joint(g, `arm-${sign}`, [sign * 5, slim ? 21.5 : 22, 0]);
      arm.userData.phase = right ? Math.PI : 0;
      const cx = sign * (aw / 2 - 1);
      part(arm, right ? 'armR' : 'armL', [cx, -4, 0]);
      part(arm, right ? 'sleeveR' : 'sleeveL', [cx, -4, 0], 0.25);
      armor(arm, 1, 'arm', [aw, 12, 4], [cx, -4, 0], 1);
      const hand = this.joint(arm, `hand-${sign}`, [cx, -9, -1]);
      hand.userData.hand = true;
      const leg = this.joint(g, `leg-${sign}-0`, [sign * 1.9, 12, 0]);
      leg.userData.phase = right ? 0 : Math.PI;
      part(leg, right ? 'legR' : 'legL', [0, -6, 0]);
      part(leg, right ? 'pantsR' : 'pantsL', [0, -6, 0], 0.25);
      armor(leg, 2, 'legs', [4, 12, 4], [0, -6, 0], 0.5);
      armor(leg, 3, 'boots', [4, 12, 4], [0, -6, 0], 1);
    }
  }

  // ---------------------------------------------------------------- quadrupeds
  private quadLegs(
    g: THREE.Group,
    kind: string,
    size: V3,
    xs: number,
    zs: readonly [number, number],
    paint: SkinPainter,
  ) {
    for (const sign of [-1, 1])
      for (const z of zs) {
        const j = this.joint(g, `leg-${sign}-${z}`, [sign * xs, size[1], z]);
        j.userData.phase = (sign > 0 ? 0 : Math.PI) + (z > 0 ? Math.PI : 0);
        this.cube(j, `${kind}/leg`, size, [0, -size[1] / 2, 0], paint);
      }
  }
  private cow(g: THREE.Group, kind: string) {
    const brown = rgb('#4f3b2b'),
      white = rgb('#e7e2d8'),
      muzzle = rgb('#b8a28e'),
      hoof = rgb('#35291f');
    const spotted = (f: SkinFace, spots: number) => {
      f.fill(brown, 0.08);
      for (let i = 0; i < spots; i++)
        f.blob(
          f.random() * f.w,
          f.random() * f.h,
          1.6 + f.random() * Math.min(f.w, f.h) * 0.22,
          white,
        );
      f.tone(0, 0, f.w, f.h, 1);
    };
    this.cube(g, `${kind}/body`, [12, 10, 18], [0, 17, 1], (f) => {
      spotted(f, f.name === 'top' ? 3 : f.side ? 3 : 1);
      if (f.name === 'bottom') f.tone(0, 0, f.w, f.h, 0.8);
    });
    this.cube(g, `${kind}/udder`, [4, 1, 5], [0, 11.5, 6], (f) => {
      f.fill(rgb('#e5a1a4'), 0.05);
      if (f.name === 'bottom')
        for (const [x, y] of [
          [0, 1],
          [3, 1],
          [0, 3],
          [3, 3],
        ])
          f.px(x, y, rgb('#c77b82'));
    });
    this.quadLegs(g, kind, [4, 12, 4], 4, [-6, 7], (f) => {
      f.fill(brown, 0.08);
      if (f.name !== 'top' && f.name !== 'bottom') {
        f.rect(0, 7, f.w, 3, null);
        for (let y = 7; y < 10; y++)
          for (let x = 0; x < f.w; x++) f.px(x, y, shade(white, 0.92 + f.random() * 0.1));
        f.rect(0, 10, f.w, 2, hoof);
      }
      if (f.name === 'bottom') f.fill(hoof, 0.05);
    });
    const head = this.joint(g, 'head', [0, 20, -8]);
    this.cube(head, `${kind}/head`, [8, 8, 6], [0, 0, -3], (f) => {
      f.fill(brown, 0.08);
      if (f.name === 'front') {
        for (let y = 0; y < 6; y++) {
          const half = y < 2 ? 1 : 2;
          for (let x = 4 - half; x < 4 + half; x++)
            f.px(x, y, shade(white, 0.95 + f.random() * 0.08));
        }
        f.px(1, 3, BLACK);
        f.px(6, 3, BLACK);
        f.px(1, 2, shade(brown, 0.7));
        f.px(6, 2, shade(brown, 0.7));
        f.rect(1, 5, 6, 3, null);
        for (let y = 5; y < 8; y++)
          for (let x = 1; x < 7; x++) f.px(x, y, shade(muzzle, 0.95 + f.random() * 0.1));
        f.px(2, 6, rgb('#4a382b'));
        f.px(5, 6, rgb('#4a382b'));
        f.rect(2, 7, 4, 1, shade(muzzle, 0.78));
      }
      if (f.side) f.blob(1, 5, 1.4, white);
    });
    for (const sign of [-1, 1])
      this.cube(head, `${kind}/horn`, [1, 3, 1], [sign * 4.5, 4.5, -3.5], (f) => {
        f.fill(rgb('#d9cfb8'), 0.05);
        f.px(0, 0, rgb('#8f8570'));
      });
  }
  private pig(g: THREE.Group, kind: string) {
    const pink = rgb('#eea3a3'),
      dark = rgb('#d88b8e');
    this.cube(g, `${kind}/body`, [10, 8, 16], [0, 10, 1], (f) => {
      f.fill(pink, 0.05);
      if (f.name === 'top') f.tone(0, 0, f.w, f.h, 1.04);
      if (f.name === 'bottom') f.fill(dark, 0.05);
      if (f.side) f.tone(0, 6, f.w, 2, 0.92);
      for (let i = 0; i < 6; i++) f.px(f.random() * f.w, f.random() * f.h, shade(pink, 0.9));
    });
    this.quadLegs(g, kind, [4, 6, 4], 3, [-5, 7], (f) => {
      f.fill(pink, 0.05);
      if (f.name !== 'top' && f.name !== 'bottom') f.rect(0, 5, f.w, 1, rgb('#c07079'));
      if (f.name === 'bottom') f.fill(rgb('#b8666f'), 0.04);
    });
    const head = this.joint(g, 'head', [0, 12, -6]);
    this.cube(head, `${kind}/head`, [8, 8, 8], [0, 0, -4], (f) => {
      f.fill(pink, 0.05);
      if (f.name === 'front') {
        f.px(1, 3, WHITE);
        f.px(2, 3, BLACK);
        f.px(5, 3, BLACK);
        f.px(6, 3, WHITE);
        f.rect(1, 2, 2, 1, shade(pink, 0.9));
        f.rect(5, 2, 2, 1, shade(pink, 0.9));
        f.rect(3, 7, 2, 1, shade(pink, 0.85));
      }
      if (f.name === 'bottom') f.fill(dark, 0.05);
    });
    this.cube(head, `${kind}/snout`, [4, 3, 1], [0, -1.5, -8.5], (f) => {
      f.fill(rgb('#e98b92'), 0.04);
      if (f.name === 'front') {
        f.rect(0, 0, 4, 1, rgb('#f3a0a6'));
        f.px(1, 1, rgb('#8f4750'));
        f.px(2, 1, rgb('#8f4750'));
      }
    });
  }
  private wool(f: SkinFace, variant = 0) {
    const [base, shadow, light, deep] = WOOL[variant].map(rgb);
    f.mottle([
      [base, 5],
      [shadow, 3],
      [light, 2],
      [deep, 1],
    ]);
    // Curls: small lighter crescents over darker gaps.
    for (let i = 0; i < (f.w * f.h) / 6; i++) {
      const x = Math.floor(f.random() * f.w),
        y = Math.floor(f.random() * f.h);
      f.px(x, y, shade(light, 1.04));
      f.px(x + 1, y + 1, shade(deep, 0.97));
    }
  }
  private sheep(g: THREE.Group, kind: string, variant: number) {
    const skin = rgb('#d4bb9f'),
      hide = rgb('#e4d6c4'),
      w = `@${variant}`;
    const wool: THREE.Object3D[] = [],
      shorn: THREE.Object3D[] = [];
    wool.push(
      this.cube(g, `${kind}/body${w}`, [10, 9, 17], [0, 16.5, 1], (f) => this.wool(f, variant)),
    );
    // Under the fleece: a slim pale body, shown once the sheep has been shorn.
    const bare = this.cube(g, `${kind}/shorn`, [8, 7, 15], [0, 15.5, 1], (f) => {
      f.fill(hide, 0.05);
      for (let i = 0; i < (f.w * f.h) / 5; i++)
        f.px(f.random() * f.w, f.random() * f.h, shade(hide, 0.9 + f.random() * 0.06));
      if (f.name === 'bottom') f.tone(0, 0, f.w, f.h, 0.85);
    });
    bare.visible = false;
    shorn.push(bare);
    this.quadLegs(g, kind, [4, 12, 4], 3, [-5, 7], (f) => {
      f.fill(skin, 0.05);
      if (f.name === 'bottom') return f.fill(rgb('#5f4f40'), 0.05);
      if (f.name !== 'top') f.rect(0, 11, f.w, 1, rgb('#5f4f40'));
    });
    // Woolly leggings over the upper legs, part of the fleece.
    for (const leg of g.children.filter((c) => c.name.startsWith('leg-')))
      wool.push(
        this.cube(leg, `${kind}/legwool${w}`, [5, 5, 5], [0, -2.5, 0], (f) => {
          this.wool(f, variant);
          if (f.name === 'bottom') f.tone(0, 0, f.w, f.h, 0.8);
        }),
      );
    const head = this.joint(g, 'head', [0, 18, -8]);
    this.cube(head, `${kind}/head`, [6, 6, 8], [0, 1, -2], (f) => {
      f.fill(skin, 0.05);
      if (f.name === 'front') {
        f.px(0, 2, WHITE);
        f.px(1, 2, BLACK);
        f.px(4, 2, BLACK);
        f.px(5, 2, WHITE);
        f.rect(2, 4, 2, 1, rgb('#a8807a'));
        f.rect(2, 5, 2, 1, shade(skin, 0.8));
      }
    });
    wool.push(
      this.cube(head, `${kind}/cap${w}`, [7, 3, 7], [0, 3.5, -1], (f) => {
        this.wool(f, variant);
        if (f.name === 'front') f.tone(0, 2, f.w, 1, 0.94);
      }),
    );
    for (const m of wool) m.userData.wool = true;
    for (const m of shorn) m.userData.shorn = true;
    g.userData.woolParts = wool;
    g.userData.shornParts = shorn;
  }
  private chicken(g: THREE.Group, kind: string) {
    const feather = rgb('#f5f3ee'),
      orange = rgb('#eba63d');
    this.cube(g, `${kind}/body`, [6, 6, 8], [0, 8, 0], (f) => {
      f.fill(feather, 0.04);
      if (f.name === 'back') {
        f.tone(1, 0, 4, 3, 0.9);
        f.px(2, 1, rgb('#d9d5cc'));
      }
      if (f.name === 'bottom') f.tone(0, 0, f.w, f.h, 0.88);
    });
    for (const sign of [-1, 1]) {
      const wing = this.joint(g, sign < 0 ? 'bird-left' : 'bird-right', [sign * 3, 11, 0]);
      this.cube(wing, `${kind}/wing`, [1, 4, 6], [sign * 0.5, -2, 0], (f) => {
        f.fill(feather, 0.04);
        if (f.side) for (let x = 0; x < f.w; x += 2) f.px(x, 3, rgb('#d8d4cb'));
      });
      const leg = this.joint(g, `leg-${sign}-0`, [sign * 1.5, 5, 1]);
      leg.userData.phase = sign > 0 ? 0 : Math.PI;
      this.cube(leg, `${kind}/leg`, [1, 5, 1], [0, -2.5, 0], (f) => f.fill(orange, 0.05));
      this.cube(leg, `${kind}/foot`, [3, 1, 3], [0, -4.5, -1], (f) => {
        f.fill(orange, 0.06);
        if (f.name === 'top') f.px(1, 2, shade(orange, 0.8));
      });
    }
    const head = this.joint(g, 'head', [0, 9, -4]);
    this.cube(head, `${kind}/head`, [4, 6, 3], [0, 3, -0.5], (f) => {
      f.fill(feather, 0.04);
      if (f.name === 'front') {
        f.px(0, 1, BLACK);
        f.px(3, 1, BLACK);
      }
      if (f.side) f.px(1, 1, BLACK);
    });
    this.cube(head, `${kind}/beak`, [4, 2, 2], [0, 3, -3], (f) => {
      f.fill(orange, 0.05);
      if (f.name === 'front' || f.side) f.rect(0, 1, f.w, 1, shade(orange, 0.85));
    });
    this.cube(head, `${kind}/wattle`, [2, 2, 2], [0, 1, -3], (f) => f.fill(rgb('#d3301f'), 0.08));
  }

  // ---------------------------------------------------------------- monsters
  private creeper(g: THREE.Group, kind: string) {
    const palette: Palette = [
      [rgb('#56a449'), 5],
      [rgb('#4a9140'), 3],
      [rgb('#6cc05e'), 2.2],
      [rgb('#3d7f35'), 1.5],
      [rgb('#88cf7b'), 0.7],
      [rgb('#2f6629'), 0.6],
      [rgb('#c7d6c1'), 0.2],
    ];
    this.cube(g, `${kind}/body`, [8, 12, 4], [0, 12, 0], (f) => f.mottle(palette));
    for (const sign of [-1, 1])
      for (const z of [-4, 4]) {
        const j = this.joint(g, `leg-${sign}-${z}`, [sign * 2, 6, z]);
        j.userData.phase = (sign > 0 ? 0 : Math.PI) + (z > 0 ? Math.PI : 0);
        this.cube(j, `${kind}/leg`, [4, 6, 4], [0, -3, 0], (f) => {
          f.mottle(palette);
          if (f.name === 'bottom') f.tone(0, 0, f.w, f.h, 0.6);
        });
      }
    const head = this.joint(g, 'head', [0, 18, 0]);
    this.cube(head, `${kind}/head`, [8, 8, 8], [0, 4, 0], (f) => {
      f.mottle(palette);
      if (f.name !== 'front') return;
      const eye = rgb('#0b0b0b'),
        mouth = rgb('#1d1f1c');
      f.rect(1, 2, 2, 2, eye);
      f.rect(5, 2, 2, 2, eye);
      f.rect(3, 4, 2, 1, mouth);
      f.rect(2, 5, 4, 2, mouth);
      f.px(2, 7, mouth);
      f.px(5, 7, mouth);
      f.px(3, 5, rgb('#2a2f28'));
    });
  }
  private spider(g: THREE.Group, kind: string) {
    const palette: Palette = [
      [rgb('#34281f'), 5],
      [rgb('#2a2019'), 3],
      [rgb('#42352a'), 2],
      [rgb('#1d1612'), 1],
      [rgb('#57483a'), 0.5],
    ];
    const head = this.joint(g, 'head', [0, 9, -6]);
    this.cube(head, `${kind}/head`, [8, 8, 8], [0, 0, -4], (f) => {
      f.mottle(palette);
      if (f.name !== 'front') return;
      const red = rgb('#d8231b'),
        hot = rgb('#ff6a52');
      f.rect(1, 3, 2, 2, red, 1);
      f.rect(5, 3, 2, 2, red, 1);
      f.px(1, 3, hot, 1);
      f.px(5, 3, hot, 1);
      for (const [x, y] of [
        [0, 1],
        [7, 1],
        [3, 2],
        [4, 2],
        [2, 1],
        [5, 1],
      ])
        f.px(x, y, red, 0.9);
      f.px(2, 7, rgb('#5a4839'));
      f.px(5, 7, rgb('#5a4839'));
    });
    this.cube(g, `${kind}/neck`, [6, 6, 6], [0, 9, -2], (f) => f.mottle(palette));
    this.cube(g, `${kind}/body`, [10, 8, 12], [0, 10, 7], (f) => {
      f.mottle(palette);
      if (f.name === 'top') {
        const mark = rgb('#5b4632');
        for (let y = 1; y < f.h - 1; y += 3) {
          const half = 1 + Math.floor(y / 3);
          f.px(4 - half, y, mark);
          f.px(5 + half, y, mark);
        }
        f.rect(4, 1, 2, f.h - 3, shade(mark, 0.8));
      }
    });
    const tilt = [0.62, 0.5, 0.5, 0.62],
      sweep = [Math.PI / 4, Math.PI / 8, -Math.PI / 8, -Math.PI / 4],
      zs = [-5, -4, -3, -2];
    for (let i = 0; i < 4; i++)
      for (const sign of [-1, 1]) {
        const j = this.joint(g, `spider-${i}-${sign}`, [sign * 4, 9, zs[i]]);
        j.rotation.set(0, sign * sweep[i], -sign * tilt[i], 'YZX');
        j.userData.side = sign;
        j.userData.phase = i * Math.PI * 0.55 + (sign > 0 ? Math.PI : 0);
        this.cube(j, `${kind}/leg`, [16, 2, 2], [sign * 8, 0, 0], (f) => {
          f.mottle(palette);
          if (f.name === 'top' || f.name === 'front' || f.name === 'back') {
            f.rect(7, 0, 2, f.h, rgb('#4d3e31'));
            f.rect(0, 0, 2, f.h, rgb('#1a1410'));
            f.rect(f.w - 2, 0, 2, f.h, rgb('#1a1410'));
          }
        });
      }
  }
  private blaze(g: THREE.Group, kind: string) {
    const head = this.joint(g, 'head', [0, 21, 0]);
    this.cube(head, `${kind}/head`, [8, 8, 8], [0, 4, 0], (f) => {
      f.mottle([
        [rgb('#f3bf45'), 5],
        [rgb('#e5a02e'), 3],
        [rgb('#fbe07c'), 1.5],
        [rgb('#c67a22'), 1],
      ]);
      for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) f.px(x, y, f.get(x, y), 0.35);
      if (f.name !== 'front') return;
      const brow = rgb('#9a4f14'),
        eye = rgb('#2b1604');
      f.rect(1, 2, 2, 1, brow, 0.2);
      f.rect(5, 2, 2, 1, brow, 0.2);
      f.rect(1, 3, 2, 1, eye);
      f.rect(5, 3, 2, 1, eye);
      f.rect(2, 6, 4, 1, brow, 0.2);
    });
    const rings = [
      { y: 17, r: 9, speed: 1 },
      { y: 11, r: 7, speed: -0.75 },
      { y: 5, r: 5, speed: 1.3 },
    ];
    let i = 0;
    for (const [ring, spec] of rings.entries())
      for (let k = 0; k < 4; k++, i++) {
        const rod = this.cube(g, `${kind}/rod`, [2, 8, 2], [0, spec.y, 0], (f) => {
          f.fill(rgb('#f2c84e'), 0.06);
          for (let y = 1; y < f.h; y += 3) f.rect(0, y, f.w, 1, rgb('#c27a1c'));
          for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) f.px(x, y, f.get(x, y), 0.6);
        });
        rod.name = `rod-${i}`;
        rod.userData.rod = {
          angle: (k * Math.PI) / 2 + ring * 0.6,
          radius: spec.r * this.s,
          y: spec.y * this.s,
          speed: spec.speed,
        };
      }
  }

  // ---------------------------------------------------------------- cubes and the ghast
  /**
   * A slime: a jelly cube (8 px, scaled by size) around a darker core with two eyes and a mouth.
   * The jelly is drawn opaque but pale, with the core showing through the front, which reads
   * the same at a glance and keeps the crowd in the one instanced draw.
   */
  private slime(g: THREE.Group) {
    const jelly: Palette = [
      [rgb('#7ccd67'), 5],
      [rgb('#6fbf5b'), 3],
      [rgb('#8fdb7a'), 2],
      [rgb('#63b050'), 1],
    ];
    const body = this.joint(g, 'cube', [0, 0, 0]);
    this.cube(body, 'lab:slime/jelly', [8, 8, 8], [0, 4, 0], (f) => {
      f.mottle(jelly);
      // A lighter rim, like light caught in the edge of the jelly.
      f.tone(0, 0, f.w, 1, 1.12);
      f.tone(0, 0, 1, f.h, 1.08);
      f.tone(0, f.h - 1, f.w, 1, 0.88);
      // The core seen through the jelly.
      f.tone(1, 1, 6, 6, 0.84);
      if (f.name !== 'front') return;
      const eye = rgb('#1f4a1a'),
        mouth = rgb('#2c5b25');
      f.rect(1, 2, 2, 2, eye);
      f.rect(5, 2, 2, 2, eye);
      f.px(1, 2, rgb('#dff5d8'));
      f.px(5, 2, rgb('#dff5d8'));
      f.px(4, 5, mouth);
    });
  }
  /**
   * A magma cube: eight slabs of dark crust with glowing cracks. In the air the slabs pull apart
   * (the `layer-*` joints), showing the fire inside — the reference animation.
   */
  private magmaCube(g: THREE.Group) {
    const crust: Palette = [
      [rgb('#3a1a12'), 5],
      [rgb('#4e2216'), 3],
      [rgb('#2a120c'), 2],
      [rgb('#6b2c16'), 1],
    ];
    const ember = rgb('#ff9a1f'),
      hot = rgb('#ffd24a');
    for (let i = 0; i < 8; i++) {
      const layer = this.joint(g, `layer-${i}`, [0, i + 0.5, 0]);
      layer.userData.layer = i;
      // How far a slab lifts per step when the cube leaps: most of a pixel of this size.
      layer.userData.step = this.s * 0.7;
      this.cube(layer, `lab:magma_cube/layer-${i}`, [8, 1, 8], [0, 0, 0], (f) => {
        f.mottle(crust);
        // Sparse glowing cracks; the molten core only shows on the inner faces between slabs.
        const outer = (f.name === 'top' && i === 7) || (f.name === 'bottom' && i === 0);
        if (f.name === 'top' || f.name === 'bottom') {
          if (outer) {
            f.px(Math.floor(f.random() * f.w), Math.floor(f.random() * f.h), ember, 0.6);
          } else {
            f.rect(2, 2, 4, 4, ember, 0.8);
            f.rect(3, 3, 2, 2, hot, 1);
          }
        } else if (i % 2 === 1 && f.random() < 0.7)
          f.px(Math.floor(f.random() * f.w), 0, shade(ember, 0.85), 0.5);
        if (f.name !== 'front') return;
        // The eyes sit on the fifth and fourth slabs from the bottom.
        if (i === 5 || i === 4) {
          f.rect(1, 0, 2, 1, i === 5 ? hot : ember, 1);
          f.rect(5, 0, 2, 1, i === 5 ? hot : ember, 1);
          if (i === 4) {
            f.px(2, 0, rgb('#c2261a'), 0.7);
            f.px(5, 0, rgb('#c2261a'), 0.7);
          }
        }
      });
    }
  }
  /**
   * The ghast: a 16-pixel cube scaled to four blocks, nine tentacles swaying underneath, a sleepy
   * face, and an angry one (eyes open, mouth wide, red tears) shown while it takes aim.
   */
  private ghast(g: THREE.Group) {
    const skin: Palette = [
      [rgb('#f2f2f2'), 6],
      [rgb('#e6e6e6'), 3],
      [rgb('#fafafa'), 2],
      [rgb('#d6d6d6'), 1],
    ];
    const face = (angry: boolean) => (f: SkinFace) => {
      f.mottle(skin);
      if (f.name !== 'front') return;
      const dark = rgb('#4a4a4a'),
        tear = rgb('#b8b8b8');
      if (!angry) {
        // Closed eyes and a small, sad mouth.
        f.rect(3, 6, 3, 1, dark);
        f.rect(10, 6, 3, 1, dark);
        f.rect(4, 7, 1, 2, tear);
        f.rect(11, 7, 1, 2, tear);
        f.rect(6, 11, 4, 2, dark);
      } else {
        const red = rgb('#c5161b');
        f.rect(3, 5, 3, 3, dark);
        f.rect(10, 5, 3, 3, dark);
        f.rect(4, 8, 1, 3, red, 0.5);
        f.rect(11, 8, 1, 3, red, 0.5);
        f.rect(5, 10, 6, 4, rgb('#1d1d1d'));
        f.rect(6, 11, 4, 2, red, 0.4);
      }
    };
    this.cube(g, 'lab:ghast/body', [16, 16, 16], [0, 8, 0], face(false));
    const angry = this.cube(g, 'lab:ghast/angry', [16, 16, 0.2], [0, 8, -8.12], (f) => {
      if (f.name === 'front') face(true)(f);
      else f.fill(rgb('#f0f0f0'), 0.02);
    });
    angry.name = 'ghast-angry';
    angry.visible = false;
    const lengths = [9, 12, 10, 13, 8, 11, 12, 9, 10];
    for (let i = 0; i < 9; i++) {
      const x = ((i % 3) - 1) * 5,
        z = (Math.floor(i / 3) - 1) * 5;
      const j = this.joint(g, `tentacle-${i}`, [x, 0.5, z]);
      j.userData.phase = i * 1.7;
      const length = lengths[i];
      this.cube(j, `lab:ghast/tentacle-${length}`, [2, length, 2], [0, -length / 2, 0], (f) => {
        f.mottle(skin);
        if (f.name === 'bottom') f.tone(0, 0, f.w, f.h, 0.85);
      });
    }
  }

  // ---------------------------------------------------------------- humanoids
  private humanoid(
    g: THREE.Group,
    kind: string,
    o: {
      legLength?: number;
      limb?: number;
      /** null leaves the head joint empty for a custom head. */
      head: SkinPainter | null;
      body: SkinPainter;
      arm: SkinPainter;
      leg?: SkinPainter;
    },
  ) {
    const L = o.legLength ?? 12,
      w = o.limb ?? 4;
    this.cube(g, `${kind}/body`, [8, 12, 4], [0, L + 6, 0], o.body);
    if (o.leg)
      for (const sign of [-1, 1]) {
        const j = this.joint(g, `leg-${sign}-0`, [sign * 2, L, 0]);
        j.userData.phase = sign > 0 ? 0 : Math.PI;
        this.cube(j, `${kind}/leg`, [w, L, w], [0, -L / 2, 0], o.leg);
      }
    const arms: THREE.Group[] = [];
    for (const sign of [-1, 1]) {
      const j = this.joint(g, `arm-${sign}`, [sign * (4 + w / 2), L + 10, 0]);
      j.userData.phase = sign > 0 ? Math.PI : 0;
      this.cube(j, `${kind}/arm`, [w, L, w], [0, 2 - L / 2, 0], o.arm);
      arms.push(j);
    }
    const head = this.joint(g, 'head', [0, L + 12, 0]);
    if (o.head) this.cube(head, `${kind}/head`, [8, 8, 8], [0, 4, 0], o.head);
    return { arms, head };
  }
  /** Zombie-like creatures in clothes: zombies, the desert walker, unknown kinds. */
  private clothed(g: THREE.Group, kind: string) {
    const def = mobDefinition(kind);
    const look =
      kind === 'lab:zombie'
        ? {
            skin: rgb('#5f9148'),
            hair: rgb('#3f6b31'),
            shirt: rgb('#2f8c93'),
            pants: rgb('#3b3f91'),
            shoes: rgb('#4f4f55'),
            eye: rgb('#161616'),
          }
        : kind === 'lab:walker'
          ? {
              skin: rgb('#a8956b'),
              hair: rgb('#6b5a3d'),
              shirt: rgb('#6f5a3c'),
              pants: rgb('#4c4031'),
              shoes: rgb('#3a3128'),
              eye: rgb('#2a1a0e'),
            }
          : {
              skin: rgb(def?.headColor ?? '#c9a27e'),
              hair: shade(rgb(def?.headColor ?? '#c9a27e'), 0.6),
              shirt: rgb(def?.color ?? '#5b6b7b'),
              pants: shade(rgb(def?.color ?? '#5b6b7b'), 0.7),
              shoes: rgb('#3a3a3a'),
              eye: BLACK,
            };
    const grime = (f: SkinFace, c: Rgb, n: number) => {
      for (let i = 0; i < n; i++) f.px(f.random() * f.w, f.random() * f.h, shade(c, 0.8));
    };
    this.humanoid(g, kind, {
      head: (f) => {
        f.fill(look.skin, 0.07);
        if (f.name === 'top') return f.fill(look.hair, 0.08);
        const rows = f.name === 'front' ? 1 : f.name === 'back' ? 4 : 2;
        for (let y = 0; y < rows; y++)
          for (let x = 0; x < f.w; x++)
            if (y < rows - 1 || f.random() < 0.7)
              f.px(x, y, shade(look.hair, 0.92 + f.random() * 0.14));
        if (f.name === 'bottom') f.tone(0, 0, f.w, f.h, 0.8);
        if (f.name !== 'front') return;
        f.rect(1, 3, 2, 1, shade(look.skin, 0.82));
        f.rect(5, 3, 2, 1, shade(look.skin, 0.82));
        f.rect(1, 4, 2, 1, look.eye);
        f.rect(5, 4, 2, 1, look.eye);
        f.rect(3, 5, 2, 1, shade(look.skin, 0.72));
        f.rect(2, 6, 4, 1, shade(look.skin, 0.55));
        grime(f, look.skin, 3);
      },
      body: (f) => {
        f.fill(look.shirt, 0.07);
        if (f.name === 'front') {
          f.px(3, 0, look.skin);
          f.px(4, 0, look.skin);
          f.px(3, 1, shade(look.skin, 0.9));
        }
        if (f.name !== 'top' && f.name !== 'bottom') {
          f.rect(0, f.h - 1, f.w, 1, look.pants);
          for (let x = 0; x < f.w; x++) if (f.random() < 0.35) f.px(x, f.h - 2, look.skin);
        }
        if (f.name === 'bottom') f.fill(look.pants, 0.06);
        grime(f, look.shirt, 4);
      },
      arm: (f) => {
        f.fill(look.skin, 0.07);
        if (f.name === 'top') return f.fill(look.shirt, 0.06);
        if (f.name === 'bottom') return f.tone(0, 0, f.w, f.h, 0.85);
        for (let y = 0; y < 4; y++)
          for (let x = 0; x < f.w; x++)
            if (y < 3 || f.random() < 0.5) f.px(x, y, shade(look.shirt, 0.93 + f.random() * 0.12));
        grime(f, look.skin, 2);
      },
      leg: (f) => {
        f.fill(look.pants, 0.07);
        if (f.name === 'bottom') return f.fill(look.shoes, 0.06);
        if (f.name === 'top') return;
        f.rect(0, 10, f.w, 2, look.shoes);
        f.tone(0, 9, f.w, 1, 0.85);
        if (f.name === 'px' || f.name === 'nx') f.tone(0, 0, f.w, 10, 0.94);
      },
    });
  }
  private skeleton(g: THREE.Group, kind: string, wither: boolean) {
    const bone = wither ? rgb('#353535') : rgb('#c9c9c9'),
      hollow = wither ? rgb('#0d0d0d') : rgb('#2d2d2d'),
      noise = wither ? 0.12 : 0.06;
    const boneFill = (f: SkinFace) => f.fill(bone, noise);
    const { arms } = this.humanoid(g, kind, {
      limb: 2,
      head: (f) => {
        boneFill(f);
        if (f.name === 'bottom') f.tone(0, 0, f.w, f.h, 0.75);
        if (f.name !== 'front') return;
        f.rect(1, 3, 2, 2, hollow);
        f.rect(5, 3, 2, 2, hollow);
        f.px(2, 4, shade(hollow, 1.4));
        f.px(5, 4, shade(hollow, 1.4));
        f.rect(3, 5, 2, 1, shade(hollow, 1.2));
        for (let x = 1; x < 7; x++) f.px(x, 6, x % 2 ? shade(bone, 0.55) : shade(bone, 1.05));
        f.rect(1, 7, 6, 1, shade(bone, 0.85));
      },
      body: (f) => {
        if (f.name === 'top' || f.name === 'bottom') return boneFill(f);
        f.rect(0, 0, f.w, f.h, null);
        const rows = [0, 2, 4, 6, 10, 11];
        for (const y of rows)
          for (let x = 0; x < f.w; x++)
            f.px(x, y, shade(bone, (y % 4 ? 0.9 : 1) + (f.random() - 0.5) * noise));
        if (f.name === 'front' || f.name === 'back')
          for (let y = 0; y < f.h; y++)
            for (const x of [3, 4]) f.px(x, y, shade(bone, 0.95 + (f.random() - 0.5) * noise));
      },
      arm: (f) => {
        boneFill(f);
        if (!f.side && f.name !== 'front' && f.name !== 'back') return;
        f.tone(0, 5, f.w, 1, 0.8);
      },
      leg: (f) => {
        boneFill(f);
        if (f.name === 'top' || f.name === 'bottom') return;
        f.tone(0, 6, f.w, 1, 0.8);
      },
    });
    const hand = arms[1];
    if (wither) {
      // Tilted 45° in the fist: down-forward when the arm hangs, forward-up when it is raised.
      const stone = rgb('#8d9490');
      const fist = new THREE.Group();
      fist.position.set(0, -10 * this.s, 0);
      fist.rotation.x = -Math.PI / 4;
      hand.add(fist);
      this.cube(fist, `${kind}/blade`, [1, 2, 9], [0, 0, -6], (f) => {
        f.fill(stone, 0.1);
        if (f.side) f.rect(0, 0, f.w, 1, shade(stone, 1.2));
        if (f.name === 'front') f.fill(shade(stone, 1.15), 0.05);
      });
      this.cube(fist, `${kind}/guard`, [1, 4, 1], [0, 0, -1], (f) => f.fill(rgb('#5b4a33'), 0.08));
      this.cube(fist, `${kind}/grip`, [1, 1, 3], [0, 0, 1], (f) => f.fill(rgb('#6e4a28'), 0.08));
      return;
    }
    // The bow sits across the right hand so it stands upright when the arm aims forward.
    this.cube(hand, `${kind}/bow`, [1, 1, 12], [0, -9, 0], (f) => {
      f.fill(wither ? rgb('#3f3a36') : rgb('#6e4a28'), 0.08);
      if (f.name === 'top' || f.side) {
        f.rect(0, 5, f.w, 2, rgb('#a0723e'));
        if (f.w > 2) f.rect(5, 0, 2, f.h, rgb('#a0723e'));
      }
    });
  }
  private enderman(g: THREE.Group, kind: string) {
    const palette: Palette = [
      [rgb('#141414'), 6],
      [rgb('#1b1b1d'), 3],
      [rgb('#0e0e0e'), 2],
      [rgb('#1e1826'), 1],
    ];
    const { head } = this.humanoid(g, kind, {
      legLength: 28,
      limb: 2,
      head: null,
      body: (f) => f.mottle(palette),
      arm: (f) => f.mottle(palette),
      leg: (f) => f.mottle(palette),
    });
    // The head is two pieces: an angry enderman lifts the skull off its jaw and gapes.
    const skull = this.joint(head, 'skull', [0, 2, 0]);
    this.cube(skull, `${kind}/skull`, [8, 6, 8], [0, 3, 0], (f) => {
      f.mottle(palette);
      if (f.name !== 'front') return;
      const eye = rgb('#e27bfb'),
        rim = rgb('#b64bd6');
      f.px(0, 4, rim, 0.9);
      f.rect(1, 4, 2, 1, eye, 1);
      f.rect(5, 4, 2, 1, eye, 1);
      f.px(7, 4, rim, 0.9);
    });
    this.cube(head, `${kind}/jaw`, [8, 2, 8], [0, 1, 0], (f) => {
      f.mottle(palette);
      if (f.name === 'top') f.fill(rgb('#07060a'), 0.04);
    });
    this.cube(head, `${kind}/mouth`, [7, 6, 7], [0, 4.5, 0], (f) => {
      f.fill(rgb('#050407'), 0.04);
      if (f.name === 'front') f.rect(1, 2, 5, 1, rgb('#3a1f47'), 0.3);
    });
  }
  private dummy(g: THREE.Group, kind: string) {
    const burlap = rgb('#bca47b'),
      stitch = rgb('#4a3524'),
      wood = rgb('#8a6641');
    const sack = (f: SkinFace) => {
      f.fill(burlap, 0.06);
      for (let y = 0; y < f.h; y++)
        for (let x = 0; x < f.w; x++) if ((x + y) % 2 === 0) f.px(x, y, shade(f.get(x, y), 0.94));
    };
    this.cube(g, `${kind}/post`, [2, 13, 2], [0, 6.5, 0], (f) => {
      f.fill(wood, 0.08);
      for (let y = 0; y < f.h; y += 3) f.px(f.random() * f.w, y, shade(wood, 0.75));
    });
    this.cube(g, `${kind}/base`, [8, 1, 8], [0, 0.5, 0], (f) => {
      f.fill(shade(wood, 0.85), 0.08);
      if (f.name === 'top')
        for (let x = 0; x < f.w; x += 3) f.rect(x, 0, 1, f.h, shade(wood, 0.72));
    });
    const { arms } = this.humanoid(g, kind, {
      head: (f) => {
        sack(f);
        if (f.name === 'top') f.rect(3, 3, 2, 2, stitch);
        if (f.name !== 'front') return;
        for (const ox of [1, 5]) {
          f.px(ox - 1, 2, stitch);
          f.px(ox + 1, 2, stitch);
          f.px(ox, 3, stitch);
          f.px(ox - 1, 4, stitch);
          f.px(ox + 1, 4, stitch);
        }
        for (let x = 2; x < 6; x += 2) f.px(x, 6, stitch);
        f.rect(2, 6, 4, 1, stitch);
        f.px(3, 6, burlap);
      },
      body: (f) => {
        sack(f);
        if (f.name !== 'front') return;
        const red = rgb('#b3322a');
        for (let y = 0; y < f.h; y++)
          for (let x = 0; x < f.w; x++) {
            const d = Math.hypot(x + 0.5 - 4, y + 0.5 - 5.5);
            if (d < 3.6) f.px(x, y, d < 1.3 ? red : d < 2.4 ? rgb('#efe8d8') : red);
          }
        f.rect(0, 11, 8, 1, stitch);
      },
      arm: (f) => {
        sack(f);
        if (f.name === 'bottom') f.fill(stitch, 0.1);
      },
    });
    for (const [i, j] of arms.entries()) j.rotation.z = (i === 0 ? -1 : 1) * (Math.PI / 2);
  }
}

/**
 * Armour as the reference draws it: plates over the base body, open where the face, neck and
 * joints show. Chainmail is a see-through mesh of rings; every material gets rivets and a light
 * top edge so the pieces read at a distance.
 */
function armorPainter(
  material: ArmorMaterial,
  piece: 'helmet' | 'chest' | 'arm' | 'belt' | 'legs' | 'boots',
): SkinPainter {
  const [base, shadow, deep, light] = ARMOR_PALETTE[material].map(rgb);
  const chain = material === 'chain';
  return (f: SkinFace) => {
    f.rect(0, 0, f.w, f.h, null);
    const side = f.name === 'px' || f.name === 'nx';
    const vertical = f.name !== 'top' && f.name !== 'bottom';
    const plate = (x: number, y: number) => {
      if (chain && (x + y) % 2 === 1) return;
      const c = chain ? ((x + y) % 4 === 0 ? light : shadow) : shade(base, 0.94 + f.random() * 0.1);
      f.px(x, y, c);
    };
    const rows = (from: number, to: number) => {
      for (let y = from; y < to; y++) for (let x = 0; x < f.w; x++) plate(x, y);
      if (!chain && to > from) {
        for (let x = 0; x < f.w; x++) f.px(x, from, light);
        for (let x = 0; x < f.w; x++) f.px(x, to - 1, shade(shadow, 0.95));
      }
    };
    switch (piece) {
      case 'helmet':
        if (f.name === 'top') {
          for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) plate(x, y);
          if (!chain) f.rect(3, 0, 2, f.h, light);
          return;
        }
        if (f.name === 'bottom') return;
        rows(0, f.name === 'front' ? 3 : f.name === 'back' ? 7 : 5);
        if (f.name === 'front') {
          // A nose guard and cheek plates round the face opening.
          if (!chain) f.rect(3, 3, 2, 2, shadow);
          for (let y = 3; y < 5; y++) {
            plate(0, y);
            plate(7, y);
          }
          if (!chain) f.px(1, 1, deep);
          if (!chain) f.px(6, 1, deep);
        }
        if (side && !chain) f.px(f.name === 'px' ? 1 : 6, 3, deep);
        return;
      case 'chest':
        if (f.name === 'bottom') return;
        if (f.name === 'top') {
          for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) plate(x, y);
          if (!chain) f.rect(3, 1, 2, 2, null);
          return;
        }
        rows(0, 11);
        if (f.name === 'front') {
          f.rect(3, 0, 2, 1, null);
          if (!chain) {
            f.rect(3, 1, 2, 1, deep);
            for (let y = 3; y < 10; y += 3) {
              f.px(1, y, deep);
              f.px(6, y, deep);
            }
            f.rect(1, 6, 6, 1, shadow);
          }
        }
        return;
      case 'arm':
        if (f.name === 'bottom') return;
        if (f.name === 'top') {
          for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) plate(x, y);
          return;
        }
        rows(0, 5);
        if (vertical && !chain) f.px(Math.floor(f.w / 2), 2, deep);
        return;
      case 'belt':
        if (f.name === 'top') return;
        if (f.name === 'bottom') {
          for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) plate(x, y);
          return;
        }
        rows(8, 12);
        if (f.name === 'front' && !chain) f.rect(3, 9, 2, 2, deep);
        return;
      case 'legs':
        if (!vertical) return;
        rows(0, 9);
        if (f.name === 'front' && !chain) f.px(1, 4, deep);
        return;
      case 'boots':
        if (f.name === 'top') return;
        if (f.name === 'bottom') {
          for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) f.px(x, y, deep);
          return;
        }
        rows(8, 12);
        if (f.name === 'front' && !chain) f.rect(0, 11, f.w, 1, deep);
        return;
    }
  };
}
