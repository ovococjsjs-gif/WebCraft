/**
 * The scattered features: a desert pyramid with its trapped treasure room, a jungle temple, a
 * witch's hut on stilts and an igloo. Each belongs to its own biomes and is planned from the
 * density terrain like a village building, so a temple always stands in the biome it is made for.
 */
import { BLOCK, BLOCK_X } from '../../../../content/src/blocks';
import type { Facing } from '../../../../content/src/shapes';
import { Rng } from '../rng';
import { SEA_LEVEL } from '../terrain-v5';
import { box, Piece, type Canvas } from './pieces';
import type { PlanContext } from './context';

export type TempleKind = 'desert_pyramid' | 'jungle_temple' | 'witch_hut' | 'igloo';
export function templeKind(biomeKey: string): TempleKind | undefined {
  if (biomeKey === 'desert' || biomeKey === 'desert_hills') return 'desert_pyramid';
  if (biomeKey === 'jungle' || biomeKey === 'jungle_hills') return 'jungle_temple';
  if (biomeKey === 'swamp') return 'witch_hut';
  if (biomeKey === 'ice_plains' || biomeKey === 'cold_taiga') return 'igloo';
  return undefined;
}

/* ------------------------------------------------------------------ desert pyramid */
export class DesertPyramid extends Piece {
  static readonly size = [21, 15, 21] as const;
  build(c: Canvas): void {
    const S = BLOCK.SANDSTONE,
      CUT = BLOCK_X.SMOOTH_SANDSTONE,
      CH = BLOCK_X.CHISELED_SANDSTONE,
      OR = BLOCK_X.TERRACOTTA_ORANGE;
    for (let lz = 0; lz < 21; lz++)
      for (let lx = 0; lx < 21; lx++) {
        this.foundation(c, lx, -3, lz, S);
        for (let ly = -3; ly <= 0; ly++) this.put(c, lx, ly, lz, S);
        this.clearAbove(c, lx, 1, lz, 20);
      }
    // The stepped body: each level a ring one block in from the one below, hollow inside.
    for (let i = 1; i <= 9; i++)
      for (let lz = i; lz <= 20 - i; lz++)
        for (let lx = i; lx <= 20 - i; lx++) {
          const edge = lx === i || lx === 20 - i || lz === i || lz === 20 - i;
          this.put(c, lx, i, lz, edge ? S : BLOCK.AIR);
        }
    this.fill(c, 10, 10, 10, 10, 10, 10, S);
    // Hall: open from the floor to the steps above it.
    this.fill(c, 5, 1, 5, 15, 4, 15, BLOCK.AIR);
    for (let lz = 5; lz <= 15; lz++)
      for (let lx = 5; lx <= 15; lx++)
        if (lx === 5 || lx === 15 || lz === 5 || lz === 15) this.put(c, lx, 1, lz, CUT);
    // The front towers, striped with orange like the reference.
    for (const tx of [0, 16]) {
      for (let ly = 1; ly <= 9; ly++)
        for (let lz = 0; lz <= 4; lz++)
          for (let lx = tx; lx <= tx + 4; lx++) {
            const edge = lx === tx || lx === tx + 4 || lz === 0 || lz === 4;
            const stripe = ly === 6 || ly === 8;
            this.put(c, lx, ly, lz, edge ? (stripe ? OR : S) : BLOCK.AIR);
          }
      for (let lz = 0; lz <= 4; lz++)
        for (let lx = tx; lx <= tx + 4; lx++) this.put(c, lx, 10, lz, CUT);
      this.put(c, tx + 2, 11, 2, CH);
      this.put(c, tx + 2, 7, 0, CH);
      this.put(c, tx + 2, 1, 4, BLOCK.AIR);
      this.put(c, tx + 2, 2, 4, BLOCK.AIR);
    }
    // Entrance: a doorway through the front steps into the hall.
    this.fill(c, 8, 1, 0, 12, 5, 4, S);
    this.fill(c, 9, 1, 0, 11, 3, 5, BLOCK.AIR);
    this.put(c, 10, 4, 0, CH);
    this.put(c, 8, 5, 0, BLOCK_X.SANDSTONE_STAIRS);
    this.put(c, 12, 5, 0, BLOCK_X.SANDSTONE_STAIRS);
    this.put(c, 9, 4, 0, OR);
    this.put(c, 11, 4, 0, OR);
    // The floor star over the hidden room.
    for (let lz = 8; lz <= 12; lz++)
      for (let lx = 8; lx <= 12; lx++) {
        const d = Math.max(Math.abs(lx - 10), Math.abs(lz - 10));
        const diag = Math.abs(lx - 10) === Math.abs(lz - 10);
        this.put(c, lx, 0, lz, d === 0 ? BLOCK_X.TERRACOTTA : diag || d === 2 ? OR : CUT);
      }
    // Below: a shaft, and a room with a chest in each wall over nine blocks of TNT.
    this.fill(c, 10, -10, 10, 10, -1, 10, BLOCK.AIR);
    this.shell(c, 7, -14, 7, 13, -9, 13, S, BLOCK.AIR);
    this.fill(c, 9, -13, 9, 11, -13, 11, BLOCK.TNT);
    this.fill(c, 8, -12, 8, 12, -12, 12, S);
    this.fill(c, 9, -12, 9, 11, -12, 11, S);
    this.put(c, 10, -11, 10, BLOCK.PLATE_OFF);
    for (const [lx, lz] of [
      [10, 8],
      [10, 12],
      [8, 10],
      [12, 10],
    ])
      this.chest(c, lx, -11, lz, 'desert_temple');
    for (const [lx, lz] of [
      [8, 8],
      [12, 8],
      [8, 12],
      [12, 12],
    ]) {
      this.put(c, lx, -11, lz, CH);
      this.put(c, lx, -10, lz, OR);
    }
  }
}

/* ------------------------------------------------------------------ jungle temple */
export class JungleTemple extends Piece {
  static readonly size = [12, 12, 15] as const;
  build(c: Canvas, r: Rng): void {
    const mossy = () => (r.nextFloat() < 0.4 ? BLOCK.MOSSY_COBBLESTONE : BLOCK.COBBLE);
    for (let lz = 0; lz < 15; lz++)
      for (let lx = 0; lx < 12; lx++) {
        this.foundation(c, lx, -4, lz, BLOCK.COBBLE);
        this.clearAbove(c, lx, 1, lz, 16);
      }
    // Basement, ground floor, upper floor and a crown, each stepped in.
    this.shell(c, 0, -4, 0, 11, 0, 14, mossy, BLOCK.AIR);
    this.shell(c, 0, 0, 0, 11, 4, 14, mossy, BLOCK.AIR);
    this.shell(c, 1, 4, 1, 10, 8, 13, mossy, BLOCK.AIR);
    this.shell(c, 3, 8, 3, 8, 11, 11, mossy, BLOCK.AIR);
    for (let lz = 4; lz <= 10; lz++)
      for (let lx = 4; lx <= 7; lx++) this.put(c, lx, 11, lz, mossy());
    // Entrance with steps, windows on every side.
    this.fill(c, 5, 1, 0, 6, 3, 0, BLOCK.AIR);
    for (const lz of [4, 10]) {
      this.put(c, 0, 2, lz, BLOCK.AIR);
      this.put(c, 11, 2, lz, BLOCK.AIR);
      this.put(c, 1, 6, lz, BLOCK.AIR);
      this.put(c, 10, 6, lz, BLOCK.AIR);
    }
    this.fill(c, 4, 6, 1, 7, 7, 1, BLOCK.AIR);
    for (const lx of [2, 9])
      for (let ly = 1; ly <= 3; ly++) this.put(c, lx, ly, 2, BLOCK_X.MOSSY_STONE_BRICKS);
    // A staircase up to the second floor and one down to the basement.
    for (let i = 0; i < 4; i++)
      this.put(c, 9, 1 + i, 6 + i, this.stairs(BLOCK_X.COBBLESTONE_STAIRS, 'south'));
    this.fill(c, 9, 4, 6, 9, 4, 10, BLOCK.AIR);
    for (let i = 0; i < 4; i++) {
      this.put(c, 2, -i, 7 + i, this.stairs(BLOCK_X.COBBLESTONE_STAIRS, 'north'));
      this.put(c, 2, -i + 1, 7 + i, BLOCK.AIR);
      this.put(c, 2, -i + 2, 7 + i, BLOCK.AIR);
    }
    this.fill(c, 1, -3, 1, 10, -1, 13, BLOCK.AIR);
    this.put(c, 5, -3, 13, BLOCK.TORCH);
    this.chest(c, 9, -3, 12, 'jungle_temple');
    this.chest(c, 5, 5, 12, 'jungle_temple');
    this.put(c, 6, 5, 12, BLOCK.TORCH);
    // Vines of leaves hanging over the walls: the jungle has taken it back.
    for (let i = 0; i < 20; i++) {
      const lx = r.nextInt(12),
        lz = r.nextInt(15),
        ly = 5 + r.nextInt(4);
      if (this.get(c, lx, ly, lz) === BLOCK.AIR && (lx === 0 || lx === 11 || lz === 0 || lz === 14))
        this.put(c, lx, ly, lz, BLOCK_X.JUNGLE_LEAVES);
    }
  }
}

/* ------------------------------------------------------------------ witch hut */
export class WitchHut extends Piece {
  static readonly size = [7, 8, 9] as const;
  build(c: Canvas): void {
    const P = BLOCK_X.SPRUCE_PLANKS,
      L = BLOCK.LOG;
    for (const [lx, lz] of [
      [1, 2],
      [5, 2],
      [1, 7],
      [5, 7],
    ]) {
      this.foundation(c, lx, 0, lz, L, 16);
      this.put(c, lx, 0, lz, L);
    }
    this.fill(c, 1, 1, 1, 5, 1, 7, P);
    this.fill(c, 1, 2, 2, 5, 4, 7, BLOCK.AIR);
    for (let ly = 2; ly <= 4; ly++)
      for (let lz = 2; lz <= 7; lz++)
        for (let lx = 1; lx <= 5; lx++) {
          const cornerX = lx === 1 || lx === 5,
            cornerZ = lz === 2 || lz === 7;
          if (cornerX && cornerZ) this.put(c, lx, ly, lz, L);
          else if (cornerX || cornerZ) this.put(c, lx, ly, lz, P);
        }
    this.put(c, 3, 2, 2, BLOCK.AIR);
    this.put(c, 3, 3, 2, BLOCK.AIR);
    this.put(c, 1, 3, 4, BLOCK_X.SPRUCE_FENCE);
    this.put(c, 5, 3, 4, BLOCK_X.SPRUCE_FENCE);
    this.put(c, 3, 3, 7, BLOCK_X.SPRUCE_FENCE);
    this.put(c, 1, 2, 1, BLOCK_X.SPRUCE_FENCE);
    this.put(c, 5, 2, 1, BLOCK_X.SPRUCE_FENCE);
    for (let lz = 1; lz <= 8; lz++) {
      this.put(c, 0, 5, lz, this.stairs(BLOCK_X.SPRUCE_STAIRS, 'east'));
      this.put(c, 6, 5, lz, this.stairs(BLOCK_X.SPRUCE_STAIRS, 'west'));
      for (let lx = 1; lx <= 5; lx++) this.put(c, lx, 5, lz, P);
    }
    for (let lx = 0; lx <= 6; lx++) {
      this.put(c, lx, 5, 0, this.stairs(BLOCK_X.SPRUCE_STAIRS, 'south'));
      this.put(c, lx, 5, 8, this.stairs(BLOCK_X.SPRUCE_STAIRS, 'north'));
    }
    this.put(c, 4, 2, 6, BLOCK.CRAFTING_TABLE);
    this.put(c, 2, 2, 6, BLOCK.BREWING_STAND);
    this.put(c, 2, 2, 3, BLOCK_X.RED_MUSHROOM);
    this.chest(c, 4, 2, 3, 'witch_hut');
  }
}

/* ------------------------------------------------------------------ igloo */
export class Igloo extends Piece {
  static readonly size = [7, 5, 9] as const;
  build(c: Canvas, r: Rng): void {
    const SNOW = BLOCK.SNOW;
    const cx = 3,
      cz = 5;
    for (let lz = 0; lz < 9; lz++)
      for (let lx = 0; lx < 7; lx++) {
        this.foundation(c, lx, 0, lz, SNOW, 8);
        this.clearAbove(c, lx, 1, lz, 8);
      }
    for (let ly = 0; ly <= 4; ly++) {
      const radius = [3.6, 3.4, 3.1, 2.4, 1.4][ly];
      for (let lz = 1; lz < 9; lz++)
        for (let lx = 0; lx < 7; lx++) {
          const d = Math.hypot(lx - cx, lz - cz);
          if (d > radius) continue;
          const shell = ly === 0 || ly === 4 || d > radius - 1.05;
          this.put(c, lx, ly, lz, shell ? SNOW : BLOCK.AIR);
        }
    }
    // Entrance tunnel.
    for (let lz = 0; lz <= 2; lz++)
      for (let ly = 0; ly <= 3; ly++)
        for (let lx = 2; lx <= 4; lx++) {
          const inner = lx === 3 && ly >= 1 && ly <= 2;
          this.put(c, lx, ly, lz, inner ? BLOCK.AIR : ly === 3 && lx !== 3 ? BLOCK.AIR : SNOW);
        }
    this.put(c, 3, 1, 3, BLOCK.AIR);
    this.put(c, 3, 2, 3, BLOCK.AIR);
    for (let lz = 3; lz <= 7; lz++)
      for (let lx = 1; lx <= 5; lx++)
        if (this.get(c, lx, 1, lz) === BLOCK.AIR) this.put(c, lx, 0, lz, BLOCK_X.PACKED_ICE);
    this.put(c, 1, 1, 6, BLOCK.BED);
    this.put(c, 5, 1, 5, BLOCK.FURNACE);
    this.put(c, 5, 1, 6, BLOCK.CRAFTING_TABLE);
    this.put(c, 2, 1, 7, BLOCK.TORCH);
    if (r.nextBoolean()) this.chest(c, 4, 1, 7, 'igloo');
  }
}

/* ------------------------------------------------------------------ planning */
export interface Temple {
  readonly kind: TempleKind;
  readonly pieces: readonly Piece[];
}
const FACINGS: readonly Facing[] = ['north', 'east', 'south', 'west'];
export function planTemple(ctx: PlanContext, x: number, z: number, r: Rng): Temple | undefined {
  const kind = templeKind(ctx.biome(x, z).key);
  if (!kind) return undefined;
  const [w, h, d] =
    kind === 'desert_pyramid'
      ? DesertPyramid.size
      : kind === 'jungle_temple'
        ? JungleTemple.size
        : kind === 'witch_hut'
          ? WitchHut.size
          : Igloo.size;
  const facing = FACINGS[r.nextInt(4)];
  const ns = facing === 'north' || facing === 'south';
  const sx = ns ? w : d,
    sz = ns ? d : w;
  const x0 = x - (sx >> 1),
    z0 = z - (sz >> 1);
  const corners = [
    [x0, z0],
    [x0 + sx - 1, z0],
    [x0, z0 + sz - 1],
    [x0 + sx - 1, z0 + sz - 1],
    [x, z],
  ];
  const hs = corners.map(([px, pz]) => ctx.ground(px, pz));
  if (corners.some(([px, pz]) => templeKind(ctx.biome(px, pz).key) !== kind)) return undefined;
  let floor: number;
  if (kind === 'witch_hut') floor = Math.max(SEA_LEVEL, Math.max(...hs)) + 1;
  else {
    if (Math.min(...hs) <= SEA_LEVEL) return undefined;
    floor =
      kind === 'desert_pyramid'
        ? Math.min(...hs) - 1
        : Math.round(hs.reduce((a, b) => a + b) / hs.length) - 1;
  }
  const b = box(x0, floor, z0, x0 + sx - 1, floor + h - 1, z0 + sz - 1);
  const piece =
    kind === 'desert_pyramid'
      ? new DesertPyramid(b, facing)
      : kind === 'jungle_temple'
        ? new JungleTemple(b, facing)
        : kind === 'witch_hut'
          ? new WitchHut(b, facing)
          : new Igloo(b, facing);
  return { kind, pieces: [piece] };
}
