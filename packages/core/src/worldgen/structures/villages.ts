/**
 * Villages in four styles: oak on the plains, sandstone in the desert, acacia on the savanna and
 * spruce in the taiga. A well stands in the middle; roads run out from it and branch at their
 * ends, and houses, farms, a church, a library, a smithy and lamp posts line them. Every building
 * is checked against everything placed before it, so nothing overlaps, and it is only put where
 * the ground is dry and fairly level. Floors follow the density terrain, roads follow the chunk.
 */
import { BLOCK, BLOCK_X } from '../../../../content/src/blocks';
import { FACING_VECTOR, rotateFacing, type Facing } from '../../../../content/src/shapes';
import { Rng } from '../rng';
import { SEA_LEVEL } from '../terrain-v5';
import {
  box,
  intersects2,
  isOpen,
  orientedBox,
  Piece,
  weighted,
  type Box,
  type Canvas,
} from './pieces';
import type { PlanContext } from './context';
import type { Profession } from '../../trading';

export type VillageStyle = 'plains' | 'desert' | 'savanna' | 'taiga';
export interface Palette {
  readonly style: VillageStyle;
  readonly log: number;
  readonly planks: number;
  readonly cobble: number;
  readonly floor: number;
  readonly stairs: number;
  readonly stoneStairs: number;
  readonly fence: number;
  readonly door: number;
  readonly slab: number;
  readonly path: number;
  readonly flatRoofs: boolean;
}
export const PALETTES: Record<VillageStyle, Palette> = {
  plains: {
    style: 'plains',
    log: BLOCK.LOG,
    planks: BLOCK.PLANKS,
    cobble: BLOCK.COBBLE,
    floor: BLOCK.COBBLE,
    stairs: BLOCK_X.OAK_STAIRS,
    stoneStairs: BLOCK_X.COBBLESTONE_STAIRS,
    fence: BLOCK_X.OAK_FENCE,
    door: BLOCK_X.OAK_DOOR,
    slab: BLOCK_X.OAK_SLAB,
    path: BLOCK.GRAVEL,
    flatRoofs: false,
  },
  desert: {
    style: 'desert',
    log: BLOCK_X.SMOOTH_SANDSTONE,
    planks: BLOCK.SANDSTONE,
    cobble: BLOCK.SANDSTONE,
    floor: BLOCK_X.SMOOTH_SANDSTONE,
    stairs: BLOCK_X.SANDSTONE_STAIRS,
    stoneStairs: BLOCK_X.SANDSTONE_STAIRS,
    fence: BLOCK_X.OAK_FENCE,
    door: BLOCK_X.OAK_DOOR,
    slab: BLOCK_X.SANDSTONE_SLAB,
    path: BLOCK.SANDSTONE,
    flatRoofs: true,
  },
  savanna: {
    style: 'savanna',
    log: BLOCK_X.ACACIA_LOG,
    planks: BLOCK_X.ACACIA_PLANKS,
    cobble: BLOCK.COBBLE,
    floor: BLOCK_X.ACACIA_PLANKS,
    stairs: BLOCK_X.ACACIA_STAIRS,
    stoneStairs: BLOCK_X.COBBLESTONE_STAIRS,
    fence: BLOCK_X.ACACIA_FENCE,
    door: BLOCK_X.ACACIA_DOOR,
    slab: BLOCK_X.OAK_SLAB,
    path: BLOCK.GRAVEL,
    flatRoofs: false,
  },
  taiga: {
    style: 'taiga',
    log: BLOCK_X.SPRUCE_LOG,
    planks: BLOCK_X.SPRUCE_PLANKS,
    cobble: BLOCK.COBBLE,
    floor: BLOCK.COBBLE,
    stairs: BLOCK_X.SPRUCE_STAIRS,
    stoneStairs: BLOCK_X.COBBLESTONE_STAIRS,
    fence: BLOCK_X.SPRUCE_FENCE,
    door: BLOCK_X.SPRUCE_DOOR,
    slab: BLOCK_X.SPRUCE_SLAB,
    path: BLOCK.GRAVEL,
    flatRoofs: false,
  },
};
const VILLAGE_BIOMES: Record<string, VillageStyle> = {
  plains: 'plains',
  sunflower_plains: 'plains',
  desert: 'desert',
  savanna: 'savanna',
  taiga: 'taiga',
  cold_taiga: 'taiga',
};
export function villageStyle(biomeKey: string): VillageStyle | undefined {
  return VILLAGE_BIOMES[biomeKey];
}

/* ====================================================================== pieces */
abstract class VillagePiece extends Piece {
  constructor(
    b: Box,
    facing: Facing,
    readonly p: Palette,
  ) {
    super(b, facing);
  }
  /** Floor slab on a foundation, with the space above cleared: the usual start of a building. */
  protected site(c: Canvas, floor: number, clearTo = this.height - 1): void {
    for (let lz = 0; lz < this.depth; lz++)
      for (let lx = 0; lx < this.width; lx++) {
        this.foundation(c, lx, 0, lz, this.p.cobble);
        this.put(c, lx, 0, lz, floor);
        this.clearAbove(c, lx, 1, lz, clearTo + 4);
      }
  }
  /** Four walls with logs at the corners, from `ly0` to `ly1`. */
  protected walls(
    c: Canvas,
    ly0: number,
    ly1: number,
    wall = this.p.planks,
    lx1 = this.width - 1,
    lz1 = this.depth - 1,
    lx0 = 0,
    lz0 = 0,
  ): void {
    for (let ly = ly0; ly <= ly1; ly++)
      for (let lz = lz0; lz <= lz1; lz++)
        for (let lx = lx0; lx <= lx1; lx++) {
          const edgeX = lx === lx0 || lx === lx1,
            edgeZ = lz === lz0 || lz === lz1;
          if (!edgeX && !edgeZ) continue;
          this.put(c, lx, ly, lz, edgeX && edgeZ ? this.p.log : wall);
        }
  }
  /** A pitched roof over `lx0..lx1`, sloping to the left and right, ridge along the depth. */
  protected roofSides(
    c: Canvas,
    lx0: number,
    lx1: number,
    ly: number,
    lz0: number,
    lz1: number,
  ): void {
    if (this.p.flatRoofs) return this.roofFlat(c, lx0, lx1, ly, lz0, lz1);
    for (let i = 0; lx0 + i <= lx1 - i; i++) {
      const y = ly + i;
      for (let lz = lz0; lz <= lz1; lz++) {
        const end = lz === lz0 || lz === lz1;
        if (lx0 + i === lx1 - i) this.put(c, lx0 + i, y, lz, this.p.slab);
        else {
          this.put(c, lx0 + i, y, lz, this.stairs(this.p.stairs, 'east'));
          this.put(c, lx1 - i, y, lz, this.stairs(this.p.stairs, 'west'));
        }
        for (let lx = lx0 + i + 1; lx <= lx1 - i - 1; lx++)
          this.put(c, lx, y, lz, end ? this.p.planks : BLOCK.AIR);
      }
    }
  }
  /** A pitched roof sloping to the front and back, ridge along the width. */
  protected roofFrontBack(
    c: Canvas,
    lx0: number,
    lx1: number,
    ly: number,
    lz0: number,
    lz1: number,
  ): void {
    if (this.p.flatRoofs) return this.roofFlat(c, lx0, lx1, ly, lz0, lz1);
    for (let i = 0; lz0 + i <= lz1 - i; i++) {
      const y = ly + i;
      for (let lx = lx0; lx <= lx1; lx++) {
        const end = lx === lx0 || lx === lx1;
        if (lz0 + i === lz1 - i) this.put(c, lx, y, lz0 + i, this.p.slab);
        else {
          this.put(c, lx, y, lz0 + i, this.stairs(this.p.stairs, 'south'));
          this.put(c, lx, y, lz1 - i, this.stairs(this.p.stairs, 'north'));
        }
        for (let lz = lz0 + i + 1; lz <= lz1 - i - 1; lz++)
          this.put(c, lx, y, lz, end ? this.p.planks : BLOCK.AIR);
      }
    }
  }
  protected roofFlat(
    c: Canvas,
    lx0: number,
    lx1: number,
    ly: number,
    lz0: number,
    lz1: number,
  ): void {
    for (let lz = lz0; lz <= lz1; lz++)
      for (let lx = lx0; lx <= lx1; lx++) {
        const edge = lx === lx0 || lx === lx1 || lz === lz0 || lz === lz1;
        this.put(c, lx, ly, lz, edge ? this.p.log : this.p.planks);
        if (this.p.style === 'desert' && edge && (lx + lz) % 2 === 0)
          this.put(c, lx, ly + 1, lz, this.p.slab);
      }
  }
  protected window(c: Canvas, lx: number, ly: number, lz: number): void {
    this.put(c, lx, ly, lz, BLOCK_X.GLASS_PANE);
  }
  protected table(c: Canvas, lx: number, ly: number, lz: number): void {
    this.put(c, lx, ly, lz, this.p.fence);
    this.put(c, lx, ly + 1, lz, BLOCK.PLATE_OFF);
  }
}

export class Well extends VillagePiece {
  build(c: Canvas): void {
    const p = this.p;
    for (let lz = 0; lz < 6; lz++)
      for (let lx = 0; lx < 6; lx++) {
        this.foundation(c, lx, 0, lz, p.cobble);
        this.put(c, lx, 0, lz, lx === 0 || lz === 0 || lx === 5 || lz === 5 ? p.path : p.cobble);
        this.clearAbove(c, lx, 1, lz, 8);
      }
    // A shaft of water four deep in a stone lining, a rim, four posts and a roof.
    for (let ly = -4; ly <= 0; ly++)
      for (let lz = 1; lz <= 4; lz++)
        for (let lx = 1; lx <= 4; lx++) {
          const inner = lx >= 2 && lx <= 3 && lz >= 2 && lz <= 3;
          this.put(c, lx, ly, lz, inner && ly > -4 ? BLOCK.WATER : p.cobble);
        }
    for (let lz = 1; lz <= 4; lz++)
      for (let lx = 1; lx <= 4; lx++) {
        const inner = lx >= 2 && lx <= 3 && lz >= 2 && lz <= 3;
        if (!inner) this.put(c, lx, 1, lz, p.cobble);
        this.put(
          c,
          lx,
          4,
          lz,
          p.slab === BLOCK_X.SANDSTONE_SLAB ? p.slab : BLOCK_X.COBBLESTONE_SLAB,
        );
      }
    for (const [lx, lz] of [
      [1, 1],
      [4, 1],
      [1, 4],
      [4, 4],
    ])
      for (let ly = 2; ly <= 3; ly++) this.put(c, lx, ly, lz, p.fence);
  }
}

/** A straight road three wide; it is drawn on whatever the chunk's surface is at each column. */
export class Road extends VillagePiece {
  build(c: Canvas): void {
    const b = this.box;
    for (let x = b.x0; x <= b.x1; x++)
      for (let z = b.z0; z <= b.z1; z++) {
        if (!c.contains(x, z)) continue;
        const top = c.surface(x, z);
        if (top < 1) continue;
        const above = c.get(x, top + 1, z);
        if (above === BLOCK.WATER || top < SEA_LEVEL - 1) {
          // A plank bridge over a pond or a river bank.
          c.set(x, SEA_LEVEL - 1, z, this.p.style === 'desert' ? BLOCK.SANDSTONE : BLOCK.PLANKS);
          for (let y = SEA_LEVEL; y < SEA_LEVEL + 3; y++)
            if (isOpen(c.get(x, y, z))) c.set(x, y, z, BLOCK.AIR);
          continue;
        }
        c.set(x, top, z, this.p.path);
        if (this.p.path === BLOCK.GRAVEL && isOpen(c.get(x, top - 1, z)))
          c.set(x, top - 1, z, BLOCK.COBBLE);
        for (let y = top + 1; y < top + 4; y++) {
          const s = c.get(x, y, z);
          if (s !== BLOCK.AIR && isOpen(s)) c.set(x, y, z, BLOCK.AIR);
        }
      }
  }
}

export class Lamp extends VillagePiece {
  build(c: Canvas): void {
    this.foundation(c, 0, 0, 0, this.p.cobble);
    this.put(c, 0, 0, 0, this.p.cobble);
    for (let ly = 1; ly <= 3; ly++) this.put(c, 0, ly, 0, this.p.fence);
    this.put(c, 0, 4, 0, BLOCK.TORCH);
  }
}

export class SmallHouse extends VillagePiece {
  static readonly size = [5, 8, 5] as const;
  build(c: Canvas, r: Rng): void {
    const p = this.p;
    this.site(c, p.floor);
    this.fill(c, 1, 1, 1, 3, 3, 3, BLOCK.AIR);
    this.walls(c, 1, 3);
    this.door(c, 2, 1, 0, p.door);
    this.window(c, 0, 2, 2);
    this.window(c, 4, 2, 2);
    this.window(c, 2, 2, 4);
    if (r.nextBoolean()) this.roofSides(c, 0, 4, 4, 0, 4);
    else {
      this.roofFlat(c, 0, 4, 4, 0, 4);
      if (!p.flatRoofs)
        for (let lx = 0; lx <= 4; lx++)
          for (let lz = 0; lz <= 4; lz++)
            if (lx === 0 || lz === 0 || lx === 4 || lz === 4) this.put(c, lx, 5, lz, p.fence);
    }
    this.put(c, 1, 1, 3, BLOCK.CRAFTING_TABLE);
    this.put(c, 3, 1, 3, r.nextBoolean() ? BLOCK.BED : BLOCK.FURNACE);
    this.put(c, 1, 1, 1, BLOCK.TORCH);
    if (r.nextInt(4) === 0) this.chest(c, 3, 1, 1, 'village_house');
  }
}

export class Hut extends VillagePiece {
  static readonly size = [4, 6, 5] as const;
  build(c: Canvas, r: Rng): void {
    const p = this.p;
    this.site(c, r.nextBoolean() ? BLOCK.DIRT : p.floor);
    this.fill(c, 1, 1, 1, 2, 3, 3, BLOCK.AIR);
    this.walls(c, 1, 3);
    this.door(c, 1, 1, 0, p.door);
    this.window(c, 0, 2, 2);
    this.window(c, 3, 2, 2);
    this.roofFlat(c, 0, 3, 4, 0, 4);
    for (let lz = 0; lz <= 4; lz++) for (let lx = 0; lx <= 3; lx++) this.put(c, lx, 4, lz, p.log);
    this.table(c, 2, 1, 3);
    this.put(c, 1, 1, 3, BLOCK.TORCH);
  }
}

export class BigHouse extends VillagePiece {
  static readonly size = [7, 10, 9] as const;
  build(c: Canvas, r: Rng): void {
    const p = this.p;
    this.site(c, p.floor);
    this.fill(c, 1, 1, 1, 5, 4, 7, BLOCK.AIR);
    this.walls(c, 1, 4);
    for (let ly = 1; ly <= 4; ly++) {
      this.put(c, 0, ly, 4, p.log);
      this.put(c, 6, ly, 4, p.log);
    }
    this.door(c, 3, 1, 0, p.door);
    for (const lz of [2, 6]) {
      this.window(c, 0, 2, lz);
      this.window(c, 6, 2, lz);
      this.window(c, 0, 3, lz);
      this.window(c, 6, 3, lz);
    }
    this.window(c, 1, 2, 0);
    this.window(c, 5, 2, 0);
    this.window(c, 3, 2, 8);
    this.window(c, 3, 3, 8);
    // An upper floor of planks over the back half, reached by a flight of stairs.
    this.fill(c, 1, 4, 5, 5, 4, 7, p.planks);
    for (let i = 0; i < 3; i++) this.put(c, 5, 1 + i, 2 + i, this.stairs(p.stairs, 'north'));
    this.put(c, 5, 4, 4, BLOCK.AIR);
    this.roofSides(c, 0, 6, 5, 0, 8);
    this.put(c, 1, 1, 7, BLOCK.BED);
    this.put(c, 2, 1, 7, BLOCK.BED);
    this.put(c, 1, 1, 5, BLOCK.CRAFTING_TABLE);
    this.put(c, 1, 1, 1, BLOCK.FURNACE);
    this.put(c, 3, 1, 7, BLOCK.BOOKSHELF);
    this.put(c, 1, 5, 6, BLOCK.TORCH);
    this.put(c, 2, 1, 2, BLOCK.TORCH);
    if (r.nextInt(3) === 0) this.chest(c, 4, 5, 7, 'village_house');
  }
}

export class Library extends VillagePiece {
  static readonly size = [9, 9, 7] as const;
  build(c: Canvas, r: Rng): void {
    const p = this.p;
    this.site(c, p.floor);
    this.fill(c, 1, 1, 1, 7, 4, 5, BLOCK.AIR);
    this.walls(c, 1, 1, p.cobble);
    this.walls(c, 2, 4);
    this.door(c, 4, 1, 0, p.door);
    for (const lx of [1, 2, 6, 7]) {
      this.window(c, lx, 2, 0);
      this.window(c, lx, 3, 0);
    }
    for (const lz of [2, 3, 4]) {
      this.window(c, 0, 2, lz);
      this.window(c, 8, 2, lz);
    }
    for (let lx = 1; lx <= 7; lx++) {
      this.put(c, lx, 1, 5, BLOCK.BOOKSHELF);
      this.put(c, lx, 2, 5, BLOCK.BOOKSHELF);
    }
    this.put(c, 1, 1, 1, BLOCK.CRAFTING_TABLE);
    this.table(c, 7, 1, 1);
    this.put(c, 3, 1, 2, this.stairs(p.stairs, 'east'));
    this.put(c, 5, 1, 2, this.stairs(p.stairs, 'west'));
    this.table(c, 4, 1, 2);
    this.put(c, 1, 1, 4, BLOCK.TORCH);
    this.put(c, 7, 1, 4, BLOCK.TORCH);
    if (r.nextInt(5) === 0) this.put(c, 4, 1, 4, BLOCK.ENCHANTING_TABLE);
    this.roofFrontBack(c, 0, 8, 5, 0, 6);
  }
}

export class Church extends VillagePiece {
  static readonly size = [5, 14, 9] as const;
  build(c: Canvas): void {
    const p = this.p;
    const stone = p.style === 'desert' ? BLOCK.SANDSTONE : BLOCK.COBBLE;
    this.site(c, stone);
    this.fill(c, 1, 1, 1, 3, 11, 7, BLOCK.AIR);
    this.walls(c, 1, 5, stone);
    this.walls(c, 6, 11, stone, 4, 8, 0, 5);
    for (let lz = 0; lz <= 4; lz++) for (let lx = 0; lx <= 4; lx++) this.put(c, lx, 6, lz, stone);
    for (let lz = 5; lz <= 8; lz++) for (let lx = 0; lx <= 4; lx++) this.put(c, lx, 12, lz, stone);
    for (const [lx, lz, f] of [
      [0, 5, 'west'],
      [4, 5, 'east'],
      [0, 8, 'west'],
      [4, 8, 'east'],
    ] as const)
      this.put(c, lx, 13, lz, this.stairs(p.stoneStairs, f));
    this.put(c, 2, 5, 5, stone);
    this.put(c, 2, 9, 5, stone);
    this.fill(c, 1, 9, 6, 3, 9, 7, stone);
    this.door(c, 2, 1, 0, p.door);
    for (const lz of [2, 3]) {
      this.window(c, 0, 3, lz);
      this.window(c, 4, 3, lz);
      this.window(c, 0, 4, lz);
      this.window(c, 4, 4, lz);
    }
    for (const ly of [10, 11]) {
      this.window(c, 0, ly, 7);
      this.window(c, 4, ly, 7);
      this.window(c, 2, ly, 8);
    }
    this.window(c, 2, 3, 8);
    this.window(c, 2, 4, 8);
    // Altar at the back with a light on either side.
    this.put(c, 2, 1, 7, this.stairs(p.stoneStairs, 'south'));
    this.put(c, 1, 1, 7, BLOCK.TORCH);
    this.put(c, 3, 1, 7, BLOCK.TORCH);
    this.put(c, 1, 10, 6, BLOCK.TORCH);
  }
}

export class Smithy extends VillagePiece {
  static readonly size = [10, 6, 7] as const;
  build(c: Canvas, r: Rng): void {
    const p = this.p;
    this.site(c, p.cobble);
    this.fill(c, 0, 1, 0, 9, 4, 6, BLOCK.AIR);
    // The open forge under a slab roof on four posts.
    for (const [lx, lz] of [
      [0, 0],
      [5, 0],
      [0, 6],
    ])
      for (let ly = 1; ly <= 3; ly++) this.put(c, lx, ly, lz, p.log);
    for (let lx = 1; lx <= 5; lx++) this.put(c, lx, 1, 6, p.cobble);
    for (let lz = 1; lz <= 5; lz++) this.put(c, 0, 1, lz, p.cobble);
    for (let lz = 0; lz <= 6; lz++) for (let lx = 0; lx <= 5; lx++) this.put(c, lx, 4, lz, p.slab);
    for (let lx = 1; lx <= 3; lx++)
      for (let lz = 4; lz <= 5; lz++) this.put(c, lx, 1, lz, p.cobble);
    this.put(c, 2, 1, 5, BLOCK.LAVA);
    this.put(c, 2, 0, 5, p.cobble);
    this.put(c, 4, 1, 5, BLOCK.FURNACE);
    this.put(c, 4, 2, 5, BLOCK.FURNACE);
    this.put(c, 3, 1, 2, BLOCK.ANVIL);
    this.chest(c, 1, 1, 1, 'village_smith');
    // The smith's room.
    this.walls(c, 1, 3, p.planks, 9, 6, 6, 0);
    this.roofFlat(c, 6, 9, 4, 0, 6);
    this.door(c, 7, 1, 0, p.door);
    this.window(c, 9, 2, 3);
    this.window(c, 7, 2, 6);
    this.put(c, 8, 1, 5, BLOCK.BED);
    this.put(c, 8, 1, 1, BLOCK.TORCH);
    if (r.nextBoolean()) this.put(c, 7, 1, 5, BLOCK.CRAFTING_TABLE);
  }
}

export class Farm extends VillagePiece {
  build(c: Canvas, r: Rng): void {
    const w = this.width,
      d = this.depth;
    for (let lz = 0; lz < d; lz++)
      for (let lx = 0; lx < w; lx++) {
        this.foundation(c, lx, 0, lz, BLOCK.DIRT);
        this.clearAbove(c, lx, 1, lz, 8);
        const border = lx === 0 || lz === 0 || lx === w - 1 || lz === d - 1 || lx === 6;
        const water = lx % 6 === 3;
        if (border)
          this.put(c, lx, 0, lz, this.p.style === 'desert' ? BLOCK.SANDSTONE : this.p.log);
        else if (water) this.put(c, lx, 0, lz, BLOCK.WATER);
        else {
          this.put(c, lx, 0, lz, BLOCK.FARMLAND_WET);
          this.put(c, lx, 1, lz, BLOCK.WHEAT_0 + 2 + r.nextInt(6));
        }
        this.put(c, lx, -1, lz, BLOCK.DIRT);
      }
  }
}

export class Pen extends VillagePiece {
  static readonly size = [7, 3, 7] as const;
  build(c: Canvas, r: Rng): void {
    for (let lz = 0; lz < 7; lz++)
      for (let lx = 0; lx < 7; lx++) {
        this.foundation(c, lx, 0, lz, BLOCK.DIRT);
        this.put(c, lx, 0, lz, BLOCK.GRASS);
        this.clearAbove(c, lx, 1, lz, 8);
        const edge = lx === 0 || lz === 0 || lx === 6 || lz === 6;
        if (edge && !(lz === 0 && lx === 3)) this.put(c, lx, 1, lz, this.p.fence);
      }
    this.put(c, 1, 1, 5, BLOCK_X.HAY);
    this.put(c, 2, 1, 5, BLOCK_X.HAY);
    if (r.nextBoolean()) this.put(c, 1, 2, 5, BLOCK_X.HAY);
    this.put(c, 5, 0, 5, BLOCK.WATER);
  }
}

/* ====================================================================== planning */
type Kind = 'small' | 'hut' | 'big' | 'library' | 'church' | 'smithy' | 'farm' | 'big_farm' | 'pen';
const KINDS: readonly (readonly [Kind, number])[] = [
  ['small', 5],
  ['hut', 4],
  ['big', 2],
  ['library', 2],
  ['church', 2],
  ['smithy', 2],
  ['farm', 3],
  ['big_farm', 3],
  ['pen', 1],
];
const LIMIT: Record<Kind, number> = {
  small: 8,
  hut: 6,
  big: 2,
  library: 1,
  church: 1,
  smithy: 1,
  farm: 3,
  big_farm: 2,
  pen: 1,
};
const SIZE: Record<Kind, readonly [number, number, number]> = {
  small: SmallHouse.size,
  hut: Hut.size,
  big: BigHouse.size,
  library: Library.size,
  church: Church.size,
  smithy: Smithy.size,
  farm: [7, 2, 9],
  big_farm: [13, 2, 9],
  pen: Pen.size,
};
function makePiece(kind: Kind, b: Box, f: Facing, p: Palette): VillagePiece {
  switch (kind) {
    case 'small':
      return new SmallHouse(b, f, p);
    case 'hut':
      return new Hut(b, f, p);
    case 'big':
      return new BigHouse(b, f, p);
    case 'library':
      return new Library(b, f, p);
    case 'church':
      return new Church(b, f, p);
    case 'smithy':
      return new Smithy(b, f, p);
    case 'farm':
    case 'big_farm':
      return new Farm(b, f, p);
    case 'pen':
      return new Pen(b, f, p);
  }
}

export interface Village {
  readonly x: number;
  readonly z: number;
  readonly style: VillageStyle;
  readonly pieces: readonly Piece[];
  readonly bounds: Box;
}

const RADIUS = 88;
/** Plans a village around a point, or nothing when the place does not suit one. */
export function planVillage(ctx: PlanContext, x: number, z: number, r: Rng): Village | undefined {
  const style = villageStyle(ctx.biome(x, z).key);
  if (!style) return undefined;
  const p = PALETTES[style];
  const pieces: Piece[] = [];
  const buildings: Box[] = [];
  const roads: Box[] = [];
  const counts = new Map<Kind, number>();
  const ground = (gx: number, gz: number) => ctx.ground(gx, gz);
  const land = (gx: number, gz: number) => ctx.biome(gx, gz).kind === 'land';
  const centre = ground(x, z);
  if (centre <= SEA_LEVEL) return undefined;

  const wellBox = box(x - 2, centre - 1, z - 2, x + 3, centre + 4, z + 3);
  pieces.push(new Well(wellBox, 'north', p));
  buildings.push(wellBox);

  /** Floor height for a footprint, or undefined when it is wet, steep or already taken. */
  const site = (b: Box, flat: number): number | undefined => {
    if (
      Math.max(Math.abs(b.x0 - x), Math.abs(b.x1 - x), Math.abs(b.z0 - z), Math.abs(b.z1 - z)) >
      RADIUS
    )
      return undefined;
    if (buildings.some((o) => intersects2(o, b, 1)) || roads.some((o) => intersects2(o, b)))
      return undefined;
    const pts = [
      [b.x0, b.z0],
      [b.x1, b.z0],
      [b.x0, b.z1],
      [b.x1, b.z1],
      [(b.x0 + b.x1) >> 1, (b.z0 + b.z1) >> 1],
    ];
    const hs = pts.map(([px, pz]) => ground(px, pz));
    if (hs.some((h) => h <= SEA_LEVEL) || pts.some(([px, pz]) => !land(px, pz))) return undefined;
    if (Math.max(...hs) - Math.min(...hs) > flat) return undefined;
    return Math.round(hs.reduce((a, h) => a + h, 0) / hs.length) - 1;
  };

  interface Seed {
    x: number;
    z: number;
    dir: Facing;
    depth: number;
  }
  const queue: Seed[] = [
    { x, z: z - 3, dir: 'north', depth: 0 },
    { x, z: z + 4, dir: 'south', depth: 0 },
    { x: x - 3, z, dir: 'west', depth: 0 },
    { x: x + 4, z, dir: 'east', depth: 0 },
  ];
  let roadCount = 0;
  while (queue.length && roadCount < 14) {
    const seed = queue.shift()!;
    const [dx, dz] = FACING_VECTOR[seed.dir];
    const [sx, sz] = FACING_VECTOR[rotateFacing(seed.dir, 1)];
    // Walk the road out until it meets water, another road, a building or the edge.
    const want = 12 + r.nextInt(18);
    let length = 0;
    for (let t = 0; t < want; t++) {
      const cx = seed.x + dx * t,
        cz = seed.z + dz * t;
      const cell = box(
        cx - Math.abs(sx),
        0,
        cz - Math.abs(sz),
        cx + Math.abs(sx),
        0,
        cz + Math.abs(sz),
      );
      if (Math.max(Math.abs(cx - x), Math.abs(cz - z)) > RADIUS - 8) break;
      if (buildings.some((o) => intersects2(o, cell)) || roads.some((o) => intersects2(o, cell)))
        break;
      if (ground(cx, cz) <= SEA_LEVEL - 2 || !land(cx, cz)) break;
      length = t + 1;
    }
    if (length < 5) continue;
    const ex = seed.x + dx * (length - 1),
      ez = seed.z + dz * (length - 1);
    const roadBox = box(
      Math.min(seed.x, ex) - Math.abs(sx),
      0,
      Math.min(seed.z, ez) - Math.abs(sz),
      Math.max(seed.x, ex) + Math.abs(sx),
      255,
      Math.max(seed.z, ez) + Math.abs(sz),
    );
    roads.push(roadBox);
    pieces.push(new Road(roadBox, seed.dir, p));
    roadCount++;
    // Buildings along both sides, facing the road.
    for (const side of [1, -1] as const) {
      const facing = rotateFacing(seed.dir, side === 1 ? 3 : 1);
      const [fx, fz] = FACING_VECTOR[rotateFacing(facing, 1)];
      let t = 1;
      while (t < length - 1) {
        const kind = weighted(r, KINDS, (k) => (counts.get(k) ?? 0) < LIMIT[k]);
        if (!kind) break;
        const [w, h, d] = SIZE[kind];
        const mid = t + (w >> 1);
        if (mid >= length) break;
        // The cell just outside the road edge in front of the building's middle.
        const px = seed.x + dx * mid + sx * 2 * side,
          pz = seed.z + dz * mid + sz * 2 * side;
        const ox = px - fx * (w >> 1),
          oz = pz - fz * (w >> 1);
        const b0 = orientedBox(ox, 0, oz, w, h, d, facing);
        const floor = site(b0, kind === 'farm' || kind === 'big_farm' ? 3 : 5);
        if (floor === undefined) {
          // A lamp post fits where a house does not.
          const lb = box(px, 0, pz, px, 0, pz);
          const lf = r.nextInt(3) === 0 ? site(lb, 2) : undefined;
          if (lf !== undefined) {
            const lamp = box(px, lf, pz, px, lf + 4, pz);
            buildings.push(lamp);
            pieces.push(new Lamp(lamp, facing, p));
          }
          t += 2;
          continue;
        }
        const b = box(b0.x0, floor, b0.z0, b0.x1, floor + h - 1, b0.z1);
        buildings.push(b);
        pieces.push(makePiece(kind, b, facing, p));
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
        t += w + 1 + r.nextInt(2);
      }
    }
    // Branches at the far end: on, left and right, fewer the further out.
    if (seed.depth < 3) {
      const nx = ex + dx,
        nz = ez + dz;
      if (r.nextFloat() < 0.7)
        queue.push({ x: nx + dx, z: nz + dz, dir: seed.dir, depth: seed.depth + 1 });
      for (const side of [1, 3]) {
        if (r.nextFloat() > 0.55 - seed.depth * 0.1) continue;
        const dir = rotateFacing(seed.dir, side);
        const [bx, bz] = FACING_VECTOR[dir];
        queue.push({ x: ex + bx * 2, z: ez + bz * 2, dir, depth: seed.depth + 1 });
      }
    }
  }
  const houses = [...counts.values()].reduce((a, n) => a + n, 0);
  if (houses < 3) return undefined;
  const all = [...buildings, ...roads];
  const bounds = box(
    Math.min(...all.map((b) => b.x0)),
    0,
    Math.min(...all.map((b) => b.z0)),
    Math.max(...all.map((b) => b.x1)),
    255,
    Math.max(...all.map((b) => b.z1)),
  );
  return { x, z, style, pieces, bounds };
}

/**
 * Where a village's people live: every house and farm, with the career its building calls for
 * (the library's librarian, the church's priest, the smithy's smith, a farmer on a farm).
 * Houses leave the career open.
 */
export function villageHomes(pieces: readonly Piece[]): { box: Box; profession?: Profession }[] {
  const out: { box: Box; profession?: Profession }[] = [];
  for (const piece of pieces) {
    if (piece instanceof Library) out.push({ box: piece.box, profession: 'librarian' });
    else if (piece instanceof Church) out.push({ box: piece.box, profession: 'priest' });
    else if (piece instanceof Smithy) out.push({ box: piece.box, profession: 'smith' });
    else if (piece instanceof Farm) out.push({ box: piece.box, profession: 'farmer' });
    else if (piece instanceof SmallHouse || piece instanceof Hut || piece instanceof BigHouse)
      out.push({ box: piece.box });
  }
  return out;
}

/**
 * What a village looks like from far away: the roofs of its buildings (their top and the block
 * they are made of) and the paths of its roads. Farms show as tilled ground at ground height.
 */
export function villageFootprints(
  pieces: readonly Piece[],
): { box: Box; top: number; height?: number }[] {
  const out: { box: Box; top: number; height?: number }[] = [];
  for (const piece of pieces) {
    if (!(piece instanceof VillagePiece)) continue;
    if (piece instanceof Lamp) continue;
    if (piece instanceof Road) out.push({ box: piece.box, top: piece.p.path });
    else if (piece instanceof Farm) out.push({ box: piece.box, top: BLOCK.FARMLAND });
    else if (piece instanceof Pen) out.push({ box: piece.box, top: piece.p.fence });
    else
      out.push({
        box: piece.box,
        top:
          piece instanceof Well ? piece.p.cobble : piece.p.flatRoofs ? piece.p.log : piece.p.planks,
        height: piece.box.y1 + 1,
      });
  }
  return out;
}
