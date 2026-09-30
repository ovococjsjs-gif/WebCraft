/**
 * Abandoned mineshafts after the reference: a dirt-floored room with corridors branching out of
 * it, three wide and three high with a timber frame every five blocks, crossings, stairs going
 * down, rails, cobwebs, the odd chest and now and then a cobweb-choked corridor with a spider
 * spawner. The whole network stays well below the ground, so it never breaks the surface.
 */
import { BLOCK, BLOCK_X } from '../../../../content/src/blocks';
import {
  FACING_VECTOR,
  oppositeFacing,
  rotateFacing,
  type Facing,
} from '../../../../content/src/shapes';
import { Rng } from '../rng';
import { box, intersects, isOpen, orientedBox, Piece, type Box, type Canvas } from './pieces';
import type { PlanContext } from './context';

const PLANKS = BLOCK.PLANKS;
const FENCE = BLOCK_X.OAK_FENCE;

/** Where a piece continues: a point just outside it and the direction to go. */
interface Exit {
  x: number;
  y: number;
  z: number;
  dir: Facing;
}

abstract class MinePiece extends Piece {
  abstract exits(r: Rng): Exit[];
  /** Planks under every open floor cell, so corridors bridge caves and ravines. */
  protected floorBridge(
    c: Canvas,
    lx0: number,
    lx1: number,
    lz0: number,
    lz1: number,
    ly = 0,
  ): void {
    for (let lz = lz0; lz <= lz1; lz++)
      for (let lx = lx0; lx <= lx1; lx++)
        if (isOpen(this.get(c, lx, ly - 1, lz))) this.put(c, lx, ly - 1, lz, PLANKS);
  }
  /** An exit leaving through the local face `side` at local `lx`/`lz`, floor `ly`. */
  protected exit(lx: number, ly: number, lz: number, local: Facing): Exit {
    const p = this.at(lx, ly, lz);
    const dir = this.turn(local);
    const [dx, dz] = FACING_VECTOR[dir];
    return { x: p.x + dx, y: p.y, z: p.z + dz, dir };
  }
}

export class MineRoom extends MinePiece {
  build(c: Canvas): void {
    const w = this.width,
      d = this.depth,
      h = this.height;
    for (let lz = 0; lz < d; lz++)
      for (let lx = 0; lx < w; lx++) {
        this.put(c, lx, 0, lz, BLOCK.DIRT);
        for (let ly = 1; ly < h; ly++) this.put(c, lx, ly, lz, BLOCK.AIR);
      }
  }
  exits(r: Rng): Exit[] {
    const out: Exit[] = [];
    const w = this.width,
      d = this.depth;
    for (let lx = 1; lx < w - 3; lx += 4 + r.nextInt(4)) {
      out.push(this.exit(lx + 1, 1, 0, 'north'));
      if (r.nextBoolean()) out.push(this.exit(lx + 1, 1, d - 1, 'south'));
    }
    for (let lz = 1; lz < d - 3; lz += 4 + r.nextInt(4)) {
      if (r.nextBoolean()) out.push(this.exit(0, 1, lz + 1, 'west'));
      out.push(this.exit(w - 1, 1, lz + 1, 'east'));
    }
    return out;
  }
}

export class Corridor extends MinePiece {
  constructor(
    b: Box,
    facing: Facing,
    readonly rails: boolean,
    readonly spiders: boolean,
  ) {
    super(b, facing);
  }
  build(c: Canvas, r: Rng): void {
    const len = this.depth;
    this.floorBridge(c, 0, 2, 0, len - 1);
    this.fill(c, 0, 0, 0, 2, 2, len - 1, BLOCK.AIR);
    for (let lz = 0; lz < len; lz++) {
      if (lz % 5 === 2) {
        // The frame: two posts and a beam.
        this.put(c, 0, 0, lz, FENCE);
        this.put(c, 0, 1, lz, FENCE);
        this.put(c, 2, 0, lz, FENCE);
        this.put(c, 2, 1, lz, FENCE);
        this.fill(c, 0, 2, lz, 2, 2, lz, PLANKS);
        // A notch over the beam, unless it would open into a corridor running just above.
        if (r.nextInt(4) === 0 && !isOpen(this.get(c, 1, 4, lz))) this.put(c, 1, 3, lz, BLOCK.AIR);
        if (r.nextInt(5) === 0) this.put(c, r.nextBoolean() ? 0 : 2, 0, lz + 1, BLOCK.TORCH);
      }
      for (const lx of [0, 2])
        for (const ly of [1, 2]) {
          const chance = this.spiders ? 0.6 : ly === 2 ? 0.07 : 0.02;
          if (lz % 5 !== 2 && r.nextFloat() < chance) this.put(c, lx, ly, lz, BLOCK_X.COBWEB);
        }
      if (this.spiders && r.nextFloat() < 0.3) this.put(c, 1, 2, lz, BLOCK_X.COBWEB);
      if (this.rails && r.nextFloat() < 0.75 && lz % 5 !== 2) this.put(c, 1, 0, lz, BLOCK.RAIL);
    }
    if (r.nextInt(4) === 0) {
      const lz = 1 + r.nextInt(len - 2);
      if (lz % 5 !== 2) this.chest(c, r.nextBoolean() ? 0 : 2, 0, lz, 'mineshaft');
    }
    if (this.spiders) {
      const lz = Math.floor(len / 2) + (Math.floor(len / 2) % 5 === 2 ? 1 : 0);
      const p = this.at(1, 0, lz);
      c.spawner(p.x, p.y, p.z, 'lab:spider');
    }
  }
  exits(r: Rng): Exit[] {
    const len = this.depth;
    const out: Exit[] = [this.exit(1, 0, len - 1, 'south')];
    // Side openings between frames now and then.
    for (let lz = 4; lz < len - 1; lz += 5) {
      if (r.nextInt(4) === 0) out.push(this.exit(0, 0, lz, 'west'));
      if (r.nextInt(4) === 0) out.push(this.exit(2, 0, lz, 'east'));
    }
    return out;
  }
}

export class Crossing extends MinePiece {
  constructor(
    b: Box,
    facing: Facing,
    readonly tall: boolean,
  ) {
    super(b, facing);
  }
  build(c: Canvas): void {
    const h = this.height;
    this.floorBridge(c, 0, 4, 0, 4);
    this.fill(c, 0, 0, 0, 4, h - 1, 4, BLOCK.AIR);
    for (const [lx, lz] of [
      [1, 1],
      [3, 1],
      [1, 3],
      [3, 3],
    ])
      for (let ly = 0; ly < h; ly++) this.put(c, lx, ly, lz, PLANKS);
    if (this.tall) {
      this.fill(c, 0, 3, 0, 4, 3, 4, PLANKS);
      this.fill(c, 1, 3, 1, 3, 3, 3, BLOCK.AIR);
    }
  }
  exits(): Exit[] {
    const out = [
      this.exit(2, 0, 4, 'south'),
      this.exit(0, 0, 2, 'west'),
      this.exit(4, 0, 2, 'east'),
    ];
    if (this.tall)
      out.push(this.exit(2, 4, 4, 'south'), this.exit(0, 4, 2, 'west'), this.exit(4, 4, 2, 'east'));
    return out;
  }
}

export class MineStairs extends MinePiece {
  build(c: Canvas): void {
    // Two flat cells at the top, five steps down, two flat cells at the bottom.
    for (let lz = 0; lz < 9; lz++) {
      const floor = lz < 2 ? 5 : lz > 6 ? 0 : 5 - (lz - 1);
      this.floorBridge(c, 0, 2, lz, lz, floor);
      this.fill(c, 0, floor, lz, 2, floor + 2, lz, BLOCK.AIR);
    }
  }
  exits(): Exit[] {
    return [this.exit(1, 0, 8, 'south')];
  }
}

export interface Mineshaft {
  readonly pieces: readonly Piece[];
}

const REACH = 80;
export function planMineshaft(
  ctx: PlanContext,
  x: number,
  z: number,
  r: Rng,
): Mineshaft | undefined {
  const surface = (px: number, pz: number) => ctx.ground(px, pz);
  const y = 12 + r.nextInt(28);
  const w = 7 + r.nextInt(8),
    d = 7 + r.nextInt(8),
    h = 4 + r.nextInt(3);
  const room = new MineRoom(box(x, y, z, x + w - 1, y + h - 1, z + d - 1), 'north');
  if (surface(x, z) - 8 < room.box.y1) return undefined;
  const pieces: MinePiece[] = [room];
  const queue: { exit: Exit; depth: number }[] = room.exits(r).map((exit) => ({ exit, depth: 1 }));
  const fits = (b: Box) =>
    b.y0 > 4 &&
    Math.abs(b.x0 - x) < REACH &&
    Math.abs(b.x1 - x) < REACH &&
    Math.abs(b.z0 - z) < REACH &&
    Math.abs(b.z1 - z) < REACH &&
    !pieces.some((p) => intersects(p.box, b)) &&
    [
      [b.x0, b.z0],
      [b.x1, b.z1],
      [b.x0, b.z1],
      [b.x1, b.z0],
    ].every(([px, pz]) => surface(px, pz) - 6 > b.y1);
  while (queue.length && pieces.length < 50) {
    const { exit, depth } = queue.shift()!;
    if (depth > 8) continue;
    const facing = oppositeFacing(exit.dir);
    // Local (0, 0) is the front-left corner; for a piece entered from `exit`, centre it there.
    const left = rotateFacing(facing, 1);
    const [lx, lz] = FACING_VECTOR[left];
    const roll = r.nextInt(100);
    let piece: MinePiece | undefined;
    if (roll < 70) {
      const len = 5 * (2 + r.nextInt(3));
      const b = orientedBox(exit.x - lx, exit.y, exit.z - lz, 3, 3, len, facing);
      if (fits(b)) piece = new Corridor(b, facing, r.nextInt(3) === 0, r.nextInt(23) === 0);
    } else if (roll < 85) {
      const tall = r.nextInt(4) === 0;
      const b = orientedBox(exit.x - lx * 2, exit.y, exit.z - lz * 2, 5, tall ? 7 : 3, 5, facing);
      if (fits(b)) piece = new Crossing(b, facing, tall);
    } else {
      const b = orientedBox(exit.x - lx, exit.y - 5, exit.z - lz, 3, 8, 9, facing);
      if (fits(b)) piece = new MineStairs(b, facing);
    }
    if (!piece) continue;
    pieces.push(piece);
    for (const next of piece.exits(r)) queue.push({ exit: next, depth: depth + 1 });
  }
  if (pieces.length < 4) return undefined;
  return { pieces };
}
