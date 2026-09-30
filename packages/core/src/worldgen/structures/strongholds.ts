/**
 * Strongholds after the reference: a labyrinth of stone-brick corridors, turns, stairs, crossing
 * rooms, libraries and chest corridors grown from a spiral staircase, always with exactly one
 * portal room. They lie in rings around the origin, three in the first, so an eye of ender always
 * has somewhere to fly, and the whole labyrinth is lowered until it is under the ground.
 */
import { BLOCK, BLOCK_X } from '../../../../content/src/blocks';
import {
  FACING_VECTOR,
  oppositeFacing,
  rotateFacing,
  type Facing,
} from '../../../../content/src/shapes';
import { Rng, hashUnit } from '../rng';
import { box, intersects, orientedBox, Piece, weighted, type Box, type Canvas } from './pieces';
import type { PlanContext } from './context';

interface Exit {
  x: number;
  y: number;
  z: number;
  dir: Facing;
}
type Kind =
  'corridor' | 'chest_corridor' | 'left' | 'right' | 'stairs' | 'crossing' | 'library' | 'portal';

function bricks(r: Rng): number {
  const roll = r.nextFloat();
  return roll < 0.2
    ? BLOCK_X.CRACKED_STONE_BRICKS
    : roll < 0.5
      ? BLOCK_X.MOSSY_STONE_BRICKS
      : BLOCK.STONE_BRICKS;
}

abstract class HoldPiece extends Piece {
  abstract exits(r: Rng): Exit[];
  protected exit(lx: number, ly: number, lz: number, local: Facing): Exit {
    const p = this.at(lx, ly, lz);
    const dir = this.turn(local);
    const [dx, dz] = FACING_VECTOR[dir];
    return { x: p.x + dx, y: p.y, z: p.z + dz, dir };
  }
  /** A brick shell with a hollow inside, the base of every piece. */
  protected hall(c: Canvas, r: Rng): void {
    this.shell(
      c,
      0,
      0,
      0,
      this.width - 1,
      this.height - 1,
      this.depth - 1,
      () => bricks(r),
      BLOCK.AIR,
    );
  }
  /** A three-by-three doorway in a local face, sometimes with a wooden door in it. */
  protected doorway(c: Canvas, r: Rng, lx: number, ly: number, lz: number, alongX: boolean): void {
    for (let dy = 0; dy < 3; dy++)
      for (let d = -1; d <= 1; d++)
        this.put(c, alongX ? lx + d : lx, ly + dy, alongX ? lz : lz + d, BLOCK.AIR);
    if (alongX && r.nextInt(3) === 0) {
      this.put(c, lx - 1, ly, lz, bricks(r));
      this.put(c, lx + 1, ly, lz, bricks(r));
      this.put(c, lx - 1, ly + 1, lz, bricks(r));
      this.put(c, lx + 1, ly + 1, lz, bricks(r));
      this.fill(c, lx - 1, ly + 2, lz, lx + 1, ly + 2, lz, BLOCK.STONE_BRICKS);
      this.door(c, lx, ly, lz, BLOCK_X.OAK_DOOR);
    }
  }
}

export class SpiralStairs extends HoldPiece {
  build(c: Canvas, r: Rng): void {
    this.hall(c, r);
    // Steps winding down around a central pillar, one quarter turn every two blocks.
    const ring = [
      [1, 1],
      [2, 1],
      [3, 1],
      [3, 2],
      [3, 3],
      [2, 3],
      [1, 3],
      [1, 2],
    ];
    for (let ly = 1; ly < 10; ly++) {
      this.put(c, 2, ly, 2, BLOCK.STONE_BRICKS);
      const [lx, lz] = ring[(10 - ly) % 8];
      this.put(c, lx, ly, lz, BLOCK_X.STONE_BRICK_SLAB);
    }
    this.doorway(c, r, 2, 1, 4, true);
    this.put(c, 1, 1, 1, BLOCK.TORCH);
  }
  exits(): Exit[] {
    return [this.exit(2, 1, 4, 'south')];
  }
}

export class HoldCorridor extends HoldPiece {
  constructor(
    b: Box,
    f: Facing,
    readonly withChest: boolean,
    readonly west: boolean,
    readonly east: boolean,
  ) {
    super(b, f);
  }
  build(c: Canvas, r: Rng): void {
    this.hall(c, r);
    this.doorway(c, r, 2, 1, 0, true);
    this.doorway(c, r, 2, 1, this.depth - 1, true);
    if (this.west) this.doorway(c, r, 0, 1, 3, false);
    if (this.east) this.doorway(c, r, 4, 1, 3, false);
    if (this.withChest) {
      this.put(c, 3, 1, 5, BLOCK_X.STONE_BRICK_SLAB);
      this.chest(c, 3, 2, 5, 'stronghold_corridor');
      this.put(c, 1, 1, 2, BLOCK.TORCH);
    } else if (r.nextInt(3) === 0)
      this.put(c, r.nextBoolean() ? 1 : 3, 1, 1 + r.nextInt(5), BLOCK.TORCH);
    for (let i = 0; i < 3; i++)
      if (r.nextInt(4) === 0)
        this.put(c, r.nextBoolean() ? 1 : 3, 3, 1 + r.nextInt(5), BLOCK_X.COBWEB);
  }
  exits(): Exit[] {
    const out = [this.exit(2, 1, this.depth - 1, 'south')];
    if (this.west) out.push(this.exit(0, 1, 3, 'west'));
    if (this.east) out.push(this.exit(4, 1, 3, 'east'));
    return out;
  }
}

export class Turn extends HoldPiece {
  constructor(
    b: Box,
    f: Facing,
    readonly right: boolean,
  ) {
    super(b, f);
  }
  build(c: Canvas, r: Rng): void {
    this.hall(c, r);
    this.doorway(c, r, 2, 1, 0, true);
    this.doorway(c, r, this.right ? 4 : 0, 1, 2, false);
  }
  exits(): Exit[] {
    return [this.right ? this.exit(4, 1, 2, 'east') : this.exit(0, 1, 2, 'west')];
  }
}

export class HoldStairs extends HoldPiece {
  build(c: Canvas, r: Rng): void {
    this.fill(c, 0, 0, 0, 4, 10, 7, () => bricks(r), r);
    // Entrance floor at 6, then one step down per block to floor 1 at the far end.
    for (let lz = 0; lz < 8; lz++) {
      const floor = lz === 0 ? 6 : Math.max(1, 7 - lz);
      this.fill(c, 1, floor, lz, 3, floor + 2, lz, BLOCK.AIR);
      if (lz > 0 && lz < 7)
        this.fill(
          c,
          1,
          floor - 1,
          lz,
          3,
          floor - 1,
          lz,
          this.stairs(BLOCK_X.STONE_BRICK_STAIRS, 'south'),
        );
    }
    this.fill(c, 1, 1, 7, 3, 3, 7, BLOCK.AIR);
  }
  exits(): Exit[] {
    return [this.exit(2, 1, 7, 'south')];
  }
}

export class CrossingRoom extends HoldPiece {
  build(c: Canvas, r: Rng): void {
    this.hall(c, r);
    this.doorway(c, r, 5, 1, 0, true);
    this.doorway(c, r, 5, 1, 10, true);
    this.doorway(c, r, 0, 1, 5, false);
    this.doorway(c, r, 10, 1, 5, false);
    const style = r.nextInt(3);
    if (style === 0) {
      for (let ly = 1; ly <= 5; ly++) this.put(c, 5, ly, 5, BLOCK.STONE_BRICKS);
      for (const [lx, lz] of [
        [4, 5],
        [6, 5],
        [5, 4],
        [5, 6],
      ])
        this.put(c, lx, 3, lz, BLOCK_X.STONE_BRICK_SLAB);
      this.put(c, 5, 6, 5, BLOCK.STONE_BRICKS);
      this.put(c, 4, 1, 4, BLOCK.TORCH);
      this.put(c, 6, 1, 6, BLOCK.TORCH);
    } else if (style === 1) {
      // A fountain.
      this.shell(c, 3, 1, 3, 7, 1, 7, BLOCK_X.STONE_BRICK_SLAB, undefined);
      this.fill(c, 4, 0, 4, 6, 0, 6, BLOCK.WATER);
      this.fill(c, 4, 1, 4, 6, 1, 6, BLOCK.AIR);
      for (let ly = 1; ly <= 4; ly++) this.put(c, 5, ly, 5, BLOCK.STONE_BRICKS);
      this.put(c, 5, 5, 5, BLOCK.GLOWSTONE);
    } else {
      // A storeroom gallery with a chest.
      this.fill(c, 1, 3, 1, 9, 3, 2, BLOCK.PLANKS);
      this.fill(c, 1, 3, 8, 9, 3, 9, BLOCK.PLANKS);
      this.chest(c, 2, 4, 1, 'stronghold_crossing');
      this.put(c, 8, 4, 9, BLOCK.TORCH);
      this.put(c, 2, 1, 2, BLOCK.TORCH);
      this.put(c, 8, 1, 8, BLOCK.TORCH);
    }
  }
  exits(): Exit[] {
    return [this.exit(5, 1, 10, 'south'), this.exit(0, 1, 5, 'west'), this.exit(10, 1, 5, 'east')];
  }
}

export class Library extends HoldPiece {
  build(c: Canvas, r: Rng): void {
    const h = this.height;
    this.hall(c, r);
    this.doorway(c, r, 7, 1, 0, true);
    for (let ly = 1; ly < h - 1; ly++)
      for (let lz = 1; lz <= 13; lz++)
        for (let lx = 1; lx <= 12; lx++) {
          const wall = lx === 1 || lx === 12 || lz === 13;
          const shelf = (lx - 1) % 4 === 2 && lz >= 3 && lz <= 10;
          if (ly === 5 && h > 7) continue;
          if (wall || (shelf && ly <= 3)) this.put(c, lx, ly, lz, BLOCK.BOOKSHELF);
          else if (r.nextFloat() < 0.07) this.put(c, lx, ly, lz, BLOCK_X.COBWEB);
        }
    this.fill(c, 6, 1, 1, 8, 3, 1, BLOCK.AIR);
    if (h > 7) {
      // A gallery with a railing round the upper floor.
      for (let lz = 1; lz <= 13; lz++)
        for (let lx = 1; lx <= 12; lx++) {
          const ring = lx <= 3 || lx >= 10 || lz <= 2 || lz >= 11;
          if (ring) this.put(c, lx, 5, lz, BLOCK.PLANKS);
          if (
            ring &&
            (lx === 4 || lx === 9 || lz === 3 || lz === 10) &&
            !(lx > 4 && lx < 9 && lz > 3 && lz < 10)
          )
            this.put(c, lx, 6, lz, BLOCK_X.OAK_FENCE);
        }
      for (let ly = 1; ly <= 5; ly++) this.put(c, 10, ly, 12, BLOCK.PLANKS);
      for (let i = 0; i < 4; i++)
        this.put(c, 11, 1 + i, 9 + i, this.stairs(BLOCK_X.OAK_STAIRS, 'south'));
      this.chest(c, 3, 6, 12, 'stronghold_library');
      this.put(c, 6, 9, 7, BLOCK.GLOWSTONE);
    }
    this.chest(c, 10, 1, 3, 'stronghold_library');
    this.put(c, 2, 1, 2, BLOCK.TORCH);
    this.put(c, 11, 1, 11, BLOCK.TORCH);
  }
  exits(): Exit[] {
    return [];
  }
}

export class PortalRoom extends HoldPiece {
  build(c: Canvas, r: Rng): void {
    this.hall(c, r);
    this.doorway(c, r, 5, 1, 0, true);
    // Lava under the stairs on either side and a staircase up to the frame platform.
    this.fill(c, 1, 1, 8, 3, 1, 14, BLOCK.LAVA);
    this.fill(c, 7, 1, 8, 9, 1, 14, BLOCK.LAVA);
    this.fill(c, 1, 1, 1, 9, 1, 7, BLOCK.AIR);
    for (let i = 0; i < 3; i++)
      this.fill(
        c,
        4,
        1 + i,
        4 + i,
        6,
        1 + i,
        4 + i,
        this.stairs(BLOCK_X.STONE_BRICK_STAIRS, 'south'),
      );
    this.fill(c, 3, 1, 7, 7, 3, 13, BLOCK.STONE_BRICKS);
    this.fill(c, 4, 4, 7, 6, 4, 7, BLOCK.AIR);
    // Twelve frames round a three-by-three hole; each has one chance in ten of an eye.
    let eyes = 0;
    const frames: [number, number][] = [];
    for (let i = 4; i <= 6; i++) frames.push([i, 8], [i, 12], [3, i + 5], [7, i + 5]);
    for (const [lx, lz] of frames) {
      const eye = r.nextFloat() < 0.1;
      if (eye) eyes++;
      this.put(c, lx, 4, lz, eye ? BLOCK.END_PORTAL_FRAME_EYE : BLOCK.END_PORTAL_FRAME);
    }
    this.fill(c, 4, 3, 9, 6, 3, 11, eyes === 12 ? BLOCK.END_PORTAL : BLOCK.AIR);
    this.fill(c, 4, 1, 9, 6, 2, 11, BLOCK.LAVA);
    for (const [lx, lz] of [
      [1, 1],
      [9, 1],
    ])
      this.put(c, lx, 1, lz, BLOCK.TORCH);
    const p = this.at(5, 4, 5);
    c.spawner(p.x, p.y, p.z, 'lab:zombie');
    this.put(c, 5, 4, 4, BLOCK_X.STONE_BRICK_SLAB);
    this.put(c, 5, 3, 5, BLOCK.STONE_BRICKS);
  }
  exits(): Exit[] {
    return [];
  }
}

const SIZE: Record<Kind, readonly [number, number, number]> = {
  corridor: [5, 5, 7],
  chest_corridor: [5, 5, 7],
  left: [5, 5, 5],
  right: [5, 5, 5],
  stairs: [5, 11, 8],
  crossing: [11, 7, 11],
  library: [14, 11, 15],
  portal: [11, 8, 16],
};
const WEIGHTS: readonly (readonly [Kind, number])[] = [
  ['corridor', 40],
  ['chest_corridor', 5],
  ['left', 20],
  ['right', 20],
  ['stairs', 5],
  ['crossing', 10],
  ['library', 5],
  ['portal', 20],
];
const LIMIT: Record<Kind, number> = {
  corridor: 99,
  chest_corridor: 4,
  left: 99,
  right: 99,
  stairs: 6,
  crossing: 6,
  library: 2,
  portal: 1,
};
/** Where the entrance floor of a piece sits above its box bottom. */
const ENTRY_Y: Partial<Record<Kind, number>> = { stairs: 6 };

export interface Stronghold {
  readonly x: number;
  readonly z: number;
  readonly pieces: readonly Piece[];
}

function attempt(x: number, z: number, r: Rng, ctx: PlanContext): Stronghold | undefined {
  const start = new SpiralStairs(box(x - 2, 40, z - 2, x + 2, 50, z + 2), 'north');
  const pieces: HoldPiece[] = [start];
  const counts = new Map<Kind, number>();
  const queue: { exit: Exit; depth: number }[] = start.exits().map((exit) => ({ exit, depth: 1 }));
  while (queue.length && pieces.length < 60) {
    const { exit, depth } = queue.shift()!;
    if (depth > 30) continue;
    const kind = weighted(r, WEIGHTS, (k) => {
      if ((counts.get(k) ?? 0) >= LIMIT[k]) return false;
      if (k === 'portal') return depth >= 6;
      if (k === 'library') return depth >= 4;
      return true;
    });
    if (!kind) continue;
    const [w, h, d] = SIZE[kind];
    const facing = oppositeFacing(exit.dir);
    const [ex, ez] = FACING_VECTOR[rotateFacing(facing, 1)];
    // The doorway sits in the middle of the front face (lx = w / 2), entrance floor at 1.
    const mid = w >> 1;
    const lift = ENTRY_Y[kind] ?? 1;
    const bx = orientedBox(exit.x - ex * mid, exit.y - lift, exit.z - ez * mid, w, h, d, facing);
    if (
      Math.max(Math.abs(bx.x0 - x), Math.abs(bx.x1 - x), Math.abs(bx.z0 - z), Math.abs(bx.z1 - z)) >
      112
    )
      continue;
    if (bx.y0 < 6 || pieces.some((p) => intersects(p.box, bx))) continue;
    const piece: HoldPiece =
      kind === 'corridor' || kind === 'chest_corridor'
        ? new HoldCorridor(
            bx,
            facing,
            kind === 'chest_corridor',
            r.nextInt(3) === 0,
            r.nextInt(3) === 0,
          )
        : kind === 'left' || kind === 'right'
          ? new Turn(bx, facing, kind === 'right')
          : kind === 'stairs'
            ? new HoldStairs(bx, facing)
            : kind === 'crossing'
              ? new CrossingRoom(bx, facing)
              : kind === 'library'
                ? new Library(
                    r.nextBoolean() ? bx : box(bx.x0, bx.y0, bx.z0, bx.x1, bx.y0 + 6, bx.z1),
                    facing,
                  )
                : new PortalRoom(bx, facing);
    pieces.push(piece);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    const next = piece.exits(r);
    for (const e of next) queue.push({ exit: e, depth: depth + 1 });
  }
  if (!counts.get('portal')) return undefined;
  // Lower everything until the top of every piece is well below the ground over it.
  let dy = 0;
  for (const p of pieces) {
    const b = p.box;
    const g = Math.min(
      ctx.ground(b.x0, b.z0),
      ctx.ground(b.x1, b.z1),
      ctx.ground(b.x0, b.z1),
      ctx.ground(b.x1, b.z0),
    );
    dy = Math.min(dy, g - 8 - b.y1);
  }
  const lowest = Math.min(...pieces.map((p) => p.box.y0));
  dy = Math.max(dy, 6 - lowest);
  if (dy !== 0) for (const p of pieces) p.moveY(dy);
  return { x, z, pieces };
}

export function planStronghold(ctx: PlanContext, x: number, z: number, seed: number): Stronghold {
  for (let i = 0; i < 12; i++) {
    const s = attempt(x, z, Rng.of(seed, 0x57c0, x, z, i), ctx);
    if (s) return s;
  }
  // Very unlikely: a stronghold that never grew a portal room gets a lone one below its stairs.
  const room = new PortalRoom(box(x - 5, 20, z + 3, x + 5, 27, z + 18), 'north');
  const stairs = new SpiralStairs(box(x - 2, 20, z - 2, x + 2, 30, z + 2), 'north');
  return { x, z, pieces: [stairs, room] };
}

/** Centres of the strongholds of a world, ring by ring: 3, 6, 10 and 15 of them. */
export function strongholdPositions(seed: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const rings = [
    [3, 640, 1100],
    [6, 1800, 2300],
    [10, 3000, 3500],
    [15, 4300, 4800],
  ] as const;
  rings.forEach(([count, near, far], ring) => {
    const angle0 = hashUnit(seed, 0x57a0, ring) * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const angle =
        angle0 + (i / count) * Math.PI * 2 + (hashUnit(seed, 0x57a1, ring, i) - 0.5) * 0.5;
      const dist = near + hashUnit(seed, 0x57a2, ring, i) * (far - near);
      const x = Math.floor((Math.cos(angle) * dist) / 16) * 16 + 8,
        z = Math.floor((Math.sin(angle) * dist) / 16) * 16 + 8;
      out.push({ x, z });
    }
  });
  return out;
}
