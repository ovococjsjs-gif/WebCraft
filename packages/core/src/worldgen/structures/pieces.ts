/**
 * The piece framework of the v5 structures, after the reference's structure components.
 *
 * A structure is planned once, as a list of pieces with bounding boxes, from nothing but the seed
 * and the density terrain (see `DensityTerrain.groundHeight`). Every chunk then builds only the
 * part of each piece that falls inside it. A piece draws in its own local frame: `lx` runs along
 * its front, `lz` from the front (0) to the back, `ly` up from the floor. The facing turns that
 * frame, and oriented blocks (stairs, doors) turn with it. A piece's random numbers come from its
 * own box, so its look never depends on which chunk is built first.
 */
import { BLOCK, BLOCK_X, doorState, registry, stairsState } from '../../../../content/src/blocks';
import { FACINGS, rotateFacing, type Facing } from '../../../../content/src/shapes';
import { Rng } from '../rng';

export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly z0: number;
  readonly x1: number;
  readonly y1: number;
  readonly z1: number;
}
export function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box {
  return {
    x0: Math.min(x0, x1),
    y0: Math.min(y0, y1),
    z0: Math.min(z0, z1),
    x1: Math.max(x0, x1),
    y1: Math.max(y0, y1),
    z1: Math.max(z0, z1),
  };
}
export const intersects = (a: Box, b: Box) =>
  a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0 && a.z0 <= b.z1 && a.z1 >= b.z0;
export const intersects2 = (a: Box, b: Box, margin = 0) =>
  a.x0 - margin <= b.x1 && a.x1 + margin >= b.x0 && a.z0 - margin <= b.z1 && a.z1 + margin >= b.z0;
export const shifted = (b: Box, dx: number, dy: number, dz: number): Box =>
  box(b.x0 + dx, b.y0 + dy, b.z0 + dz, b.x1 + dx, b.y1 + dy, b.z1 + dz);
export function union(boxes: readonly Box[]): Box {
  return boxes.reduce((a, b) =>
    box(
      Math.min(a.x0, b.x0),
      Math.min(a.y0, b.y0),
      Math.min(a.z0, b.z0),
      Math.max(a.x1, b.x1),
      Math.max(a.y1, b.y1),
      Math.max(a.z1, b.z1),
    ),
  );
}
/**
 * The box of a piece `w` wide, `h` tall and `d` deep whose front-left corner (local 0,0,0) is at
 * `x`, `y`, `z`, facing `facing`, so that pieces can be attached to an exit point directly.
 */
export function orientedBox(
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  facing: Facing,
): Box {
  // Local (0, 0) is the front-left corner; `lx` grows along the front, `lz` towards the back.
  switch (facing) {
    case 'north':
      return box(x, y, z, x + w - 1, y + h - 1, z + d - 1);
    case 'south':
      return box(x - w + 1, y, z - d + 1, x, y + h - 1, z);
    case 'west':
      return box(x, y, z - w + 1, x + d - 1, y + h - 1, z);
    case 'east':
      return box(x - d + 1, y, z, x, y + h - 1, z + w - 1);
  }
}

/** Chest contents are chosen by kind and position when the chunk is loaded, never stored. */
export type LootKind =
  | 'dungeon'
  | 'mineshaft'
  | 'village_smith'
  | 'village_house'
  | 'desert_temple'
  | 'jungle_temple'
  | 'igloo'
  | 'witch_hut'
  | 'stronghold_corridor'
  | 'stronghold_crossing'
  | 'stronghold_library';

/** The chunk being built. Coordinates are world coordinates; writes outside it are dropped. */
export interface Canvas {
  readonly cx: number;
  readonly cz: number;
  get(x: number, y: number, z: number): number;
  set(x: number, y: number, z: number, state: number): void;
  chest(x: number, y: number, z: number, loot: LootKind): void;
  spawner(x: number, y: number, z: number, mob: string): void;
  /** Highest block of the chunk's terrain (not plants, leaves or logs) in a column, or -1. */
  surface(x: number, z: number): number;
  contains(x: number, z: number): boolean;
}

const SOFT_ABOVE = new Set<number>([
  BLOCK.AIR,
  BLOCK.TALL_GRASS,
  BLOCK.FLOWER,
  BLOCK.DAISY,
  BLOCK_X.POPPY,
  BLOCK_X.FERN,
  BLOCK_X.DEAD_BUSH,
  BLOCK_X.SNOW_LAYER,
]);
/** Air, water and plants: what a foundation replaces on its way down. */
export function isOpen(state: number): boolean {
  if (SOFT_ABOVE.has(state)) return true;
  const def = registry.get(state);
  return !def.solid || def.fluid !== undefined || def.liquid === true;
}

export abstract class Piece {
  constructor(
    public box: Box,
    public readonly facing: Facing = 'north',
  ) {}
  /** Width along the front and depth from front to back, in the piece's own frame. */
  get width(): number {
    return this.facing === 'north' || this.facing === 'south'
      ? this.box.x1 - this.box.x0 + 1
      : this.box.z1 - this.box.z0 + 1;
  }
  get depth(): number {
    return this.facing === 'north' || this.facing === 'south'
      ? this.box.z1 - this.box.z0 + 1
      : this.box.x1 - this.box.x0 + 1;
  }
  get height(): number {
    return this.box.y1 - this.box.y0 + 1;
  }
  abstract build(c: Canvas, r: Rng): void;
  /** Builds the part of the piece inside the canvas with the piece's own random stream. */
  draw(c: Canvas, seed: number, salt: number): void {
    const x0 = c.cx * 16,
      z0 = c.cz * 16;
    if (this.box.x1 < x0 || this.box.x0 > x0 + 15 || this.box.z1 < z0 || this.box.z0 > z0 + 15)
      return;
    this.build(c, Rng.of(seed, salt, this.box.x0, this.box.y0, this.box.z0));
  }
  moveY(dy: number): void {
    this.box = shifted(this.box, 0, dy, 0);
  }

  /* ---------------------------------------------------------------- the local frame */
  wx(lx: number, lz: number): number {
    const b = this.box;
    switch (this.facing) {
      case 'north':
        return b.x0 + lx;
      case 'south':
        return b.x1 - lx;
      case 'west':
        return b.x0 + lz;
      case 'east':
        return b.x1 - lz;
    }
  }
  wz(lx: number, lz: number): number {
    const b = this.box;
    switch (this.facing) {
      case 'north':
        return b.z0 + lz;
      case 'south':
        return b.z1 - lz;
      case 'west':
        return b.z1 - lx;
      case 'east':
        return b.z0 + lx;
    }
  }
  wy(ly: number): number {
    return this.box.y0 + ly;
  }
  /** A local direction (north = towards the front) in world terms. */
  turn(local: Facing): Facing {
    return rotateFacing(local, FACINGS.indexOf(this.facing));
  }
  /** World position of a local point, for exits and child pieces. */
  at(lx: number, ly: number, lz: number): { x: number; y: number; z: number } {
    return { x: this.wx(lx, lz), y: this.wy(ly), z: this.wz(lx, lz) };
  }

  /* ---------------------------------------------------------------- drawing */
  put(c: Canvas, lx: number, ly: number, lz: number, state: number): void {
    c.set(this.wx(lx, lz), this.wy(ly), this.wz(lx, lz), state);
  }
  get(c: Canvas, lx: number, ly: number, lz: number): number {
    return c.get(this.wx(lx, lz), this.wy(ly), this.wz(lx, lz));
  }
  fill(
    c: Canvas,
    lx0: number,
    ly0: number,
    lz0: number,
    lx1: number,
    ly1: number,
    lz1: number,
    state: number | ((r: number) => number),
    r?: Rng,
  ): void {
    for (let ly = ly0; ly <= ly1; ly++)
      for (let lz = lz0; lz <= lz1; lz++)
        for (let lx = lx0; lx <= lx1; lx++)
          this.put(c, lx, ly, lz, typeof state === 'number' ? state : state(r ? r.nextFloat() : 0));
  }
  /** Walls of a box: the outer shell in `wall`, the inside in `inside` (unless undefined). */
  shell(
    c: Canvas,
    lx0: number,
    ly0: number,
    lz0: number,
    lx1: number,
    ly1: number,
    lz1: number,
    wall: number | ((r: number) => number),
    inside: number | undefined,
    r?: Rng,
  ): void {
    for (let ly = ly0; ly <= ly1; ly++)
      for (let lz = lz0; lz <= lz1; lz++)
        for (let lx = lx0; lx <= lx1; lx++) {
          const edge =
            ly === ly0 || ly === ly1 || lz === lz0 || lz === lz1 || lx === lx0 || lx === lx1;
          if (edge)
            this.put(c, lx, ly, lz, typeof wall === 'number' ? wall : wall(r ? r.nextFloat() : 0));
          else if (inside !== undefined) this.put(c, lx, ly, lz, inside);
        }
  }
  stairs(base: number, local: Facing, half: 'bottom' | 'top' = 'bottom'): number {
    return stairsState(base, this.turn(local), half);
  }
  door(c: Canvas, lx: number, ly: number, lz: number, base: number, local: Facing = 'north'): void {
    this.put(c, lx, ly, lz, doorState(base, this.turn(local), false, false));
    this.put(c, lx, ly + 1, lz, doorState(base, this.turn(local), false, true));
  }
  chest(c: Canvas, lx: number, ly: number, lz: number, loot: LootKind): void {
    c.chest(this.wx(lx, lz), this.wy(ly), this.wz(lx, lz), loot);
  }
  /** Fills downwards from below a local point with `state` until solid ground, like a plinth. */
  foundation(c: Canvas, lx: number, ly: number, lz: number, state: number, limit = 24): void {
    const x = this.wx(lx, lz),
      z = this.wz(lx, lz);
    if (!c.contains(x, z)) return;
    for (let y = this.wy(ly) - 1, n = 0; y > 0 && n < limit; y--, n++) {
      if (!isOpen(c.get(x, y, z))) break;
      c.set(x, y, z, state);
    }
  }
  /** Clears terrain and plants above a local point up to the open sky, so hills are cut back. */
  clearAbove(c: Canvas, lx: number, ly: number, lz: number, limit = 32): void {
    const x = this.wx(lx, lz),
      z = this.wz(lx, lz);
    if (!c.contains(x, z)) return;
    for (let y = this.wy(ly), n = 0; y < 255 && n < limit; y++, n++) {
      const s = c.get(x, y, z);
      if (s === BLOCK.AIR && n > 2) break;
      c.set(x, y, z, BLOCK.AIR);
    }
  }
}

/** A weighted pick with per-kind limits, the way piece types are drawn. */
export function weighted<T extends string>(
  r: Rng,
  entries: readonly (readonly [T, number])[],
  allowed: (kind: T) => boolean,
): T | undefined {
  const open = entries.filter(([k]) => allowed(k));
  const total = open.reduce((a, [, w]) => a + w, 0);
  if (total <= 0) return undefined;
  let roll = r.nextFloat() * total;
  for (const [k, w] of open) {
    roll -= w;
    if (roll < 0) return k;
  }
  return open[open.length - 1][0];
}
