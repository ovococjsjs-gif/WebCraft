/**
 * Decoration of the v5 generator, after the 1.12 biome decorator: ores, lakes, sand and clay
 * discs, the trees of each biome, flowers, grass, cacti, cane, mushrooms, lily pads, boulders
 * and ice spikes.
 *
 * A source chunk decorates the 16×16 square offset by eight blocks, so features straddle chunk
 * borders as in the reference. To keep generation independent of loading order, every decision
 * (is there room for this tree? is this ground soil?) reads only the undecorated base terrain,
 * which is the same for every chunk that asks. Writes are clipped to the chunk being built.
 */
import { BLOCK, BLOCK_H, BLOCK_X, registry } from '../../../content/src/blocks';
import { Rng } from './rng';
import { biomeV5, type BiomeV5, type TreeKind } from './biomes-v5';
import { SEA_LEVEL } from './terrain-v5';

export interface WorldView {
  /** Undecorated terrain at any position (caves and surface included). */
  base(x: number, y: number, z: number): number;
  /** First air above the highest block of the base terrain. */
  height(x: number, z: number): number;
  biome(x: number, z: number): number;
  /** Ground a structure has claimed: no trees or plants grow there. */
  reserved?(x: number, z: number): boolean;
}
export interface Sink {
  /** The chunk being built: writes elsewhere are dropped. */
  current(x: number, y: number, z: number): number | undefined;
  put(x: number, y: number, z: number, state: number): void;
  /** Inclusive horizontal bounds of the writable area, for skipping far-away work early. */
  readonly bounds?: { minX: number; minZ: number; maxX: number; maxZ: number };
  /** Records what a generated chest holds and what a spawner calls up. */
  chest?(x: number, y: number, z: number, loot: 'dungeon'): void;
  spawner?(x: number, y: number, z: number, mob: string): void;
}

const SOFT = new Set<number>([
  BLOCK.AIR,
  BLOCK.TALL_GRASS,
  BLOCK_X.FERN,
  BLOCK_X.SNOW_LAYER,
  BLOCK.FLOWER,
  BLOCK.DAISY,
  BLOCK_X.POPPY,
  BLOCK_X.DEAD_BUSH,
]);
const LEAVES = new Set<number>([
  BLOCK.LEAVES,
  BLOCK_X.BIRCH_LEAVES,
  BLOCK_X.SPRUCE_LEAVES,
  BLOCK_X.JUNGLE_LEAVES,
  BLOCK_X.ACACIA_LEAVES,
  BLOCK_X.DARK_OAK_LEAVES,
]);
const TREE_SOIL = new Set<number>([
  BLOCK.GRASS,
  BLOCK.DIRT,
  BLOCK_X.PODZOL,
  BLOCK_X.COARSE_DIRT,
  BLOCK_X.GRASS_SNOWY,
]);
const DEAD_BUSH_GROUND = new Set<number>([
  BLOCK.SAND,
  BLOCK_X.RED_SAND,
  BLOCK_X.TERRACOTTA,
  BLOCK_X.TERRACOTTA_ORANGE,
  BLOCK_X.TERRACOTTA_YELLOW,
  BLOCK_X.TERRACOTTA_WHITE,
  BLOCK_X.TERRACOTTA_LIGHT_GRAY,
  BLOCK_X.TERRACOTTA_BROWN,
  BLOCK_X.TERRACOTTA_RED,
  BLOCK.DIRT,
  BLOCK_X.COARSE_DIRT,
]);

class Decorator {
  constructor(
    readonly view: WorldView,
    readonly sink: Sink,
  ) {}
  base(x: number, y: number, z: number): number {
    return y < 0 || y > 255 ? BLOCK.AIR : this.view.base(x, y, z);
  }
  /** Places a block only over air, plants and leaves: trees never eat terrain or each other's logs. */
  soft(x: number, y: number, z: number, state: number): void {
    const now = this.sink.current(x, y, z);
    if (now === undefined) return;
    if (SOFT.has(now) || (LEAVES.has(now) && !LEAVES.has(state))) this.sink.put(x, y, z, state);
  }
  leaf(x: number, y: number, z: number, state: number): void {
    const now = this.sink.current(x, y, z);
    if (now === undefined) return;
    if (SOFT.has(now)) this.sink.put(x, y, z, state);
  }
  log(x: number, y: number, z: number, state: number): void {
    const now = this.sink.current(x, y, z);
    if (now === undefined) return;
    if (SOFT.has(now) || LEAVES.has(now) || now === BLOCK.WATER) this.sink.put(x, y, z, state);
  }
  /** Replace a block only if it is currently `from` (ores in stone, sand over dirt). */
  swap(x: number, y: number, z: number, from: ReadonlySet<number> | number, state: number): void {
    const now = this.sink.current(x, y, z);
    if (now === undefined) return;
    if (typeof from === 'number' ? now === from : from.has(now)) this.sink.put(x, y, z, state);
  }
  force(x: number, y: number, z: number, state: number): void {
    if (this.sink.current(x, y, z) !== undefined) this.sink.put(x, y, z, state);
  }
  /** Space check on the base terrain: every cell of the column range is air or a plant. */
  clear(x: number, y0: number, y1: number, z: number, radius: number): boolean {
    for (let y = y0; y <= y1; y++) {
      if (y < 1 || y > 254) return false;
      const r = y <= y0 ? 0 : radius;
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) if (!SOFT.has(this.base(x + dx, y, z + dz))) return false;
    }
    return true;
  }

  /* ------------------------------------------------------------------ minerals */
  /** The reference's ore vein: a stretched chain of spheres along a random line. */
  vein(
    r: Rng,
    x: number,
    y: number,
    z: number,
    size: number,
    state: number,
    host = STONE_HOST,
  ): void {
    const angle = r.nextFloat() * Math.PI;
    const x0 = x + 8 + (Math.sin(angle) * size) / 8,
      x1 = x + 8 - (Math.sin(angle) * size) / 8,
      z0 = z + 8 + (Math.cos(angle) * size) / 8,
      z1 = z + 8 - (Math.cos(angle) * size) / 8,
      y0 = y + r.nextInt(3) - 2,
      y1 = y + r.nextInt(3) - 2;
    const b = this.sink.bounds;
    const reach = size / 16 + 2;
    if (
      b &&
      (Math.max(x0, x1) + reach < b.minX ||
        Math.min(x0, x1) - reach > b.maxX + 1 ||
        Math.max(z0, z1) + reach < b.minZ ||
        Math.min(z0, z1) - reach > b.maxZ + 1)
    ) {
      // Out of reach of the target: draw the same numbers so the stream stays aligned.
      for (let i = 0; i < size; i++) r.nextDouble();
      return;
    }
    for (let i = 0; i < size; i++) {
      const t = i / size;
      const cx = x0 + (x1 - x0) * t,
        cy = y0 + (y1 - y0) * t,
        cz = z0 + (z1 - z0) * t;
      const spread = (r.nextDouble() * size) / 16;
      const w = (Math.sin(Math.PI * t) + 1) * spread + 1,
        h = (Math.sin(Math.PI * t) + 1) * spread + 1;
      for (let bx = Math.floor(cx - w / 2); bx <= Math.floor(cx + w / 2); bx++) {
        const dx = (bx + 0.5 - cx) / (w / 2);
        if (dx * dx >= 1) continue;
        for (let by = Math.floor(cy - h / 2); by <= Math.floor(cy + h / 2); by++) {
          const dy = (by + 0.5 - cy) / (h / 2);
          if (dx * dx + dy * dy >= 1 || by < 1 || by > 255) continue;
          for (let bz = Math.floor(cz - w / 2); bz <= Math.floor(cz + w / 2); bz++) {
            const dz = (bz + 0.5 - cz) / (w / 2);
            if (dx * dx + dy * dy + dz * dz < 1) this.swap(bx, by, bz, host, state);
          }
        }
      }
    }
  }
  ores(r: Rng, ox: number, oz: number): void {
    const spread = (count: number, size: number, state: number, min: number, max: number) => {
      for (let i = 0; i < count; i++)
        this.vein(
          r,
          ox + r.nextInt(16),
          r.nextInt(max - min) + min,
          oz + r.nextInt(16),
          size,
          state,
        );
    };
    spread(10, 33, BLOCK.DIRT, 0, 256);
    spread(8, 33, BLOCK.GRAVEL, 0, 256);
    spread(10, 33, BLOCK_X.GRANITE, 0, 80);
    spread(10, 33, BLOCK_X.DIORITE, 0, 80);
    spread(10, 33, BLOCK_X.ANDESITE, 0, 80);
    spread(20, 17, BLOCK.COAL_ORE, 0, 128);
    spread(20, 9, BLOCK.IRON_ORE, 0, 64);
    spread(2, 9, BLOCK.GOLD_ORE, 0, 32);
    spread(8, 8, BLOCK.REDSTONE_ORE, 0, 16);
    spread(1, 8, BLOCK.DIAMOND_ORE, 0, 16);
    // Lapis clusters around y 16 with a triangular spread.
    this.vein(
      r,
      ox + r.nextInt(16),
      r.nextInt(16) + r.nextInt(16),
      oz + r.nextInt(16),
      7,
      BLOCK.LAPIS_ORE,
    );
  }
  /** Sand, clay and gravel discs on the floor of shallow water. */
  disc(
    r: Rng,
    x: number,
    z: number,
    radiusMax: number,
    state: number,
    hosts: ReadonlySet<number>,
  ): void {
    const y = this.view.height(x, z) - 1;
    if (this.base(x, y + 1, z) !== BLOCK.WATER && this.base(x, y, z) !== BLOCK.WATER) return;
    let top = y;
    while (top > 0 && this.base(x, top, z) === BLOCK.WATER) top--;
    const radius = r.nextInt(radiusMax - 2) + 2;
    const depth = state === BLOCK_X.CLAY ? 1 : 2;
    for (let dx = -radius; dx <= radius; dx++)
      for (let dz = -radius; dz <= radius; dz++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        for (let dy = top - depth; dy <= top + depth; dy++)
          this.swap(x + dx, dy, z + dz, hosts, state);
      }
  }

  /* ------------------------------------------------------------------ lakes */
  /**
   * A dungeon after the reference: a cobblestone room with a mossy floor, a spawner in the
   * middle and up to two chests against its walls, only where it is buried in rock but opens
   * onto a cave through one to five gaps in its walls.
   */
  dungeon(r: Rng, x: number, y: number, z: number): void {
    const rx = r.nextInt(2) + 2,
      rz = r.nextInt(2) + 2;
    if (y < 4 || y > 200) return;
    let openings = 0;
    for (let dx = -rx - 1; dx <= rx + 1; dx++)
      for (let dz = -rz - 1; dz <= rz + 1; dz++)
        for (let dy = -1; dy <= 4; dy++) {
          const s = this.base(x + dx, y + dy, z + dz);
          const solid = registry.get(s).solid;
          if ((dy === -1 || dy === 4) && !solid) return;
          const wall = Math.abs(dx) === rx + 1 || Math.abs(dz) === rz + 1;
          if (wall && dy === 0 && s === BLOCK.AIR && this.base(x + dx, y + 1, z + dz) === BLOCK.AIR)
            openings++;
        }
    if (openings < 1 || openings > 5) return;
    for (let dx = -rx - 1; dx <= rx + 1; dx++)
      for (let dz = -rz - 1; dz <= rz + 1; dz++)
        for (let dy = 3; dy >= -1; dy--) {
          const wall = Math.abs(dx) === rx + 1 || Math.abs(dz) === rz + 1;
          const px = x + dx,
            py = y + dy,
            pz = z + dz;
          if (dy >= 0 && !wall) this.force(px, py, pz, BLOCK.AIR);
          else if (dy === -1) {
            if (registry.get(this.base(px, py - 1, pz)).solid || !wall)
              this.force(px, py, pz, r.nextInt(4) === 0 ? BLOCK.COBBLE : BLOCK.MOSSY_COBBLESTONE);
          } else if (registry.get(this.base(px, py, pz)).solid)
            this.force(px, py, pz, BLOCK.COBBLE);
        }
    // Two tries at a chest, each against exactly one wall.
    for (let i = 0; i < 2; i++)
      for (let tries = 0; tries < 3; tries++) {
        const cx = x + r.nextInt(rx * 2 + 1) - rx,
          cz = z + r.nextInt(rz * 2 + 1) - rz;
        let walls = 0;
        for (const [dx, dz] of DIRS) {
          const nx = cx + dx,
            nz = cz + dz;
          if (Math.abs(nx - x) === rx + 1 || Math.abs(nz - z) === rz + 1) walls++;
        }
        if (walls !== 1 || (cx === x && cz === z)) continue;
        this.force(cx, y, cz, BLOCK.CHEST);
        if (this.sink.current(cx, y, cz) !== undefined) this.sink.chest?.(cx, y, cz, 'dungeon');
        break;
      }
    const roll = r.nextInt(4);
    const mob = roll < 2 ? 'lab:zombie' : roll === 2 ? 'lab:skeleton' : 'lab:spider';
    this.force(x, y, z, BLOCK.SPAWNER);
    if (this.sink.current(x, y, z) !== undefined) this.sink.spawner?.(x, y, z, mob);
  }
  lake(r: Rng, x: number, y: number, z: number, liquid: number): void {
    x -= 8;
    z -= 8;
    while (y > 5 && this.base(x + 8, y, z + 8) === BLOCK.AIR) y--;
    if (y <= 4) return;
    y -= 4;
    const mask = new Uint8Array(2048);
    const at = (i: number, j: number, k: number) => (i * 16 + k) * 8 + j;
    const blobs = r.nextInt(4) + 4;
    for (let n = 0; n < blobs; n++) {
      const sx = r.nextDouble() * 6 + 3,
        sy = r.nextDouble() * 4 + 2,
        sz = r.nextDouble() * 6 + 3;
      const cx = r.nextDouble() * (16 - sx - 2) + 1 + sx / 2,
        cy = r.nextDouble() * (8 - sy - 4) + 2 + sy / 2,
        cz = r.nextDouble() * (16 - sz - 2) + 1 + sz / 2;
      for (let i = 1; i < 15; i++)
        for (let k = 1; k < 15; k++)
          for (let j = 1; j < 7; j++) {
            const dx = (i - cx) / (sx / 2),
              dy = (j - cy) / (sy / 2),
              dz = (k - cz) / (sz / 2);
            if (dx * dx + dy * dy + dz * dz < 1) mask[at(i, j, k)] = 1;
          }
    }
    const border = (i: number, j: number, k: number) =>
      !mask[at(i, j, k)] &&
      ((i < 15 && mask[at(i + 1, j, k)]) ||
        (i > 0 && mask[at(i - 1, j, k)]) ||
        (k < 15 && mask[at(i, j, k + 1)]) ||
        (k > 0 && mask[at(i, j, k - 1)]) ||
        (j < 7 && mask[at(i, j + 1, k)]) ||
        (j > 0 && mask[at(i, j - 1, k)]));
    for (let i = 0; i < 16; i++)
      for (let k = 0; k < 16; k++)
        for (let j = 0; j < 8; j++) {
          if (!border(i, j, k)) continue;
          const state = this.base(x + i, y + j, z + k);
          const def = registry.get(state);
          if (j >= 4 && def.fluid) return;
          if (j < 4 && !def.solid && state !== liquid) return;
        }
    for (let i = 0; i < 16; i++)
      for (let k = 0; k < 16; k++)
        for (let j = 0; j < 8; j++)
          if (mask[at(i, j, k)]) this.force(x + i, y + j, z + k, j >= 4 ? BLOCK.AIR : liquid);
    for (let i = 0; i < 16; i++)
      for (let k = 0; k < 16; k++)
        for (let j = 4; j < 8; j++)
          if (mask[at(i, j, k)] && this.base(x + i, y + j - 1, z + k) === BLOCK.DIRT) {
            const biome = biomeV5(this.view.biome(x + i, z + k));
            if (biome.top === BLOCK.GRASS)
              this.swap(x + i, y + j - 1, z + k, BLOCK.DIRT, BLOCK.GRASS);
          }
    if (liquid === BLOCK.LAVA)
      for (let i = 0; i < 16; i++)
        for (let k = 0; k < 16; k++)
          for (let j = 0; j < 8; j++)
            if (
              border(i, j, k) &&
              (j < 4 || r.nextInt(2) !== 0) &&
              registry.get(this.base(x + i, y + j, z + k)).solid
            )
              this.force(x + i, y + j, z + k, BLOCK.STONE);
  }

  /* ------------------------------------------------------------------ trees */
  private ground(x: number, y: number, z: number): boolean {
    return TREE_SOIL.has(this.base(x, y - 1, z));
  }
  private blob(
    x: number,
    y: number,
    z: number,
    radius: number,
    state: number,
    r: Rng,
    trim = true,
  ): void {
    for (let dx = -radius; dx <= radius; dx++)
      for (let dz = -radius; dz <= radius; dz++) {
        if (trim && Math.abs(dx) === radius && Math.abs(dz) === radius && r.nextInt(2) === 0)
          continue;
        this.leaf(x + dx, y, z + dz, state);
      }
  }
  /** Oak, birch, jungle sapling and swamp oak: a trunk under a four-layer crown. */
  simpleTree(
    r: Rng,
    x: number,
    y: number,
    z: number,
    height: number,
    log: number,
    leaves: number,
  ): boolean {
    if (!this.ground(x, y, z) || !this.clear(x, y, y + height + 1, z, 0)) return false;
    if (!this.clear(x, y + height - 3, y + height + 1, z, 1)) return false;
    for (let ly = y + height - 3; ly <= y + height; ly++) {
      const rel = ly - (y + height);
      const radius = 1 - Math.trunc(rel / 2);
      for (let dx = -radius; dx <= radius; dx++)
        for (let dz = -radius; dz <= radius; dz++) {
          if (
            Math.abs(dx) === radius &&
            Math.abs(dz) === radius &&
            (r.nextInt(2) === 0 || rel === 0)
          )
            continue;
          this.leaf(x + dx, ly, z + dz, leaves);
        }
    }
    for (let i = 0; i < height; i++) this.log(x, y + i, z, log);
    this.swap(x, y - 1, z, TREE_SOIL, BLOCK.DIRT);
    return true;
  }
  spruce(r: Rng, x: number, y: number, z: number): boolean {
    const height = r.nextInt(4) + 6;
    const bare = 1 + r.nextInt(2);
    const maxRadius = 2 + r.nextInt(2);
    if (!this.ground(x, y, z) || !this.clear(x, y, y + height + 1, z, 0)) return false;
    let radius = r.nextInt(2),
      limit = 1,
      reset = 0;
    for (let i = 0; i <= height - bare; i++) {
      const ly = y + height - i;
      for (let dx = -radius; dx <= radius; dx++)
        for (let dz = -radius; dz <= radius; dz++)
          if (!(Math.abs(dx) === radius && Math.abs(dz) === radius && radius > 0))
            this.leaf(x + dx, ly, z + dz, BLOCK_X.SPRUCE_LEAVES);
      if (radius >= limit) {
        radius = reset;
        reset = 1;
        limit = Math.min(limit + 1, maxRadius);
      } else radius++;
    }
    const trunk = height - r.nextInt(3);
    for (let i = 0; i < trunk; i++) this.log(x, y + i, z, BLOCK_X.SPRUCE_LOG);
    this.swap(x, y - 1, z, TREE_SOIL, BLOCK.DIRT);
    return true;
  }
  pine(r: Rng, x: number, y: number, z: number): boolean {
    const height = r.nextInt(5) + 7;
    const crownStart = height - r.nextInt(2) - 3;
    const maxRadius = 1 + r.nextInt(height - crownStart + 1);
    if (!this.ground(x, y, z) || !this.clear(x, y, y + height + 1, z, 0)) return false;
    let radius = 0;
    for (let ly = y + height; ly >= y + crownStart; ly--) {
      for (let dx = -radius; dx <= radius; dx++)
        for (let dz = -radius; dz <= radius; dz++)
          if (!(Math.abs(dx) === radius && Math.abs(dz) === radius && radius > 0))
            this.leaf(x + dx, ly, z + dz, BLOCK_X.SPRUCE_LEAVES);
      if (radius >= 1 && ly === y + crownStart + 1) radius--;
      else if (radius < maxRadius) radius++;
    }
    for (let i = 0; i < height - 1; i++) this.log(x, y + i, z, BLOCK_X.SPRUCE_LOG);
    this.swap(x, y - 1, z, TREE_SOIL, BLOCK.DIRT);
    return true;
  }
  /** Two-by-two conifers of the mega taiga, with podzol spread around the roots. */
  megaConifer(r: Rng, x: number, y: number, z: number, spruce: boolean): boolean {
    const height = r.nextInt(15) + 13;
    for (const [dx, dz] of TWO_BY_TWO) if (!this.ground(x + dx, y, z + dz)) return false;
    for (const [dx, dz] of TWO_BY_TWO)
      if (!this.clear(x + dx, y, y + height, z + dz, 0)) return false;
    const crown = spruce ? r.nextInt(5) + Math.floor(height * 0.6) : r.nextInt(5) + 3;
    const top = y + height;
    let previous = 0;
    for (let ly = top - crown; ly <= top; ly++) {
      const fromTop = top - ly;
      let radius = Math.floor((fromTop / crown) * (spruce ? 3.5 : 2.5));
      if (spruce && fromTop > 1 && radius === previous && (fromTop & 1) === 0) radius++;
      previous = radius;
      for (let dx = -radius; dx <= radius + 1; dx++)
        for (let dz = -radius; dz <= radius + 1; dz++) {
          const ex = dx <= 0 ? -dx : dx - 1,
            ez = dz <= 0 ? -dz : dz - 1;
          if (ex * ex + ez * ez > radius * radius) continue;
          this.leaf(x + dx, ly, z + dz, BLOCK_X.SPRUCE_LEAVES);
        }
    }
    for (let i = 0; i < height; i++)
      for (const [dx, dz] of TWO_BY_TWO) this.log(x + dx, y + i, z + dz, BLOCK_X.SPRUCE_LOG);
    for (let dx = -2; dx <= 3; dx++)
      for (let dz = -2; dz <= 3; dz++) {
        if ((Math.abs(dx - 0.5) > 2 && Math.abs(dz - 0.5) > 2) || r.nextInt(3) === 0) continue;
        const gy = this.view.height(x + dx, z + dz) - 1;
        if (Math.abs(gy - (y - 1)) <= 2) this.swap(x + dx, gy, z + dz, TREE_SOIL, BLOCK_X.PODZOL);
      }
    return true;
  }
  /** Big oak: limbs from a tall trunk to clusters of leaves, like the reference's large oak. */
  fancyOak(r: Rng, x: number, y: number, z: number): boolean {
    const limit = 5 + r.nextInt(12);
    const trunk = Math.floor(limit * 0.618);
    if (!this.ground(x, y, z) || !this.clear(x, y, y + limit, z, 0)) return false;
    const perLayer = Math.max(1, Math.floor(1.382 + Math.pow((1 * limit) / 13, 2)));
    const nodes: [number, number, number, number][] = [];
    const topY = y + limit - 4;
    for (let ly = topY; ly >= y + Math.floor(limit * 0.3); ly--) {
      const rel = ly - y;
      const size = layerSize(limit, rel);
      if (size < 0) continue;
      for (let n = 0; n < perLayer; n++) {
        const dist = size * (r.nextFloat() + 0.328);
        const angle = r.nextFloat() * 2 * Math.PI;
        const nx = Math.floor(dist * Math.sin(angle) + x + 0.5),
          nz = Math.floor(dist * Math.cos(angle) + z + 0.5);
        const base = Math.min(y + trunk, Math.floor(ly - Math.hypot(nx - x, nz - z) * 0.381));
        nodes.push([nx, ly, nz, base]);
      }
    }
    if (!nodes.length) nodes.push([x, y + trunk, z, y + trunk]);
    for (const [nx, ny, nz] of nodes)
      for (let dy = 0; dy < 4; dy++) {
        const radius = dy === 0 || dy === 3 ? 2 : 3;
        for (let dx = -radius; dx <= radius; dx++)
          for (let dz = -radius; dz <= radius; dz++)
            if (Math.hypot(Math.abs(dx) + 0.5, Math.abs(dz) + 0.5) <= radius + 0.5)
              this.leaf(nx + dx, ny + dy, nz + dz, BLOCK.LEAVES);
      }
    for (let i = 0; i < trunk; i++) this.log(x, y + i, z, BLOCK.LOG);
    for (const [nx, ny, nz, base] of nodes) {
      if (base - y < limit * 0.2) continue;
      const steps = Math.max(Math.abs(nx - x), Math.abs(ny - base), Math.abs(nz - z));
      for (let s = 0; s <= steps; s++) {
        const t = steps ? s / steps : 0;
        this.log(
          Math.floor(x + (nx - x) * t + 0.5),
          Math.floor(base + (ny - base) * t + 0.5),
          Math.floor(z + (nz - z) * t + 0.5),
          BLOCK.LOG,
        );
      }
    }
    this.swap(x, y - 1, z, TREE_SOIL, BLOCK.DIRT);
    return true;
  }
  acacia(r: Rng, x: number, y: number, z: number): boolean {
    const height = r.nextInt(3) + r.nextInt(3) + 5;
    if (!this.ground(x, y, z) || !this.clear(x, y, y + height + 1, z, 0)) return false;
    const dir = r.nextInt(4);
    const [ddx, ddz] = DIRS[dir];
    const bendAt = height - r.nextInt(4) - 1;
    let bend = 3 - r.nextInt(3);
    let tx = x,
      tz = z,
      topY = y;
    for (let i = 0; i < height; i++) {
      if (i >= bendAt && bend > 0) {
        tx += ddx;
        tz += ddz;
        bend--;
      }
      this.log(tx, y + i, tz, BLOCK_X.ACACIA_LOG);
      topY = y + i;
    }
    const canopy = (cx: number, cy: number, cz: number) => {
      for (let dx = -3; dx <= 3; dx++)
        for (let dz = -3; dz <= 3; dz++)
          if (Math.abs(dx) !== 3 || Math.abs(dz) !== 3)
            this.leaf(cx + dx, cy, cz + dz, BLOCK_X.ACACIA_LEAVES);
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) this.leaf(cx + dx, cy + 1, cz + dz, BLOCK_X.ACACIA_LEAVES);
      for (const [ax, az] of DIRS)
        this.leaf(cx + ax * 2, cy + 1, cz + az * 2, BLOCK_X.ACACIA_LEAVES);
    };
    canopy(tx, topY + 1, tz);
    // A second, lower branch leaning the other way.
    const other = r.nextInt(4);
    if (other !== dir) {
      const [ox, oz] = DIRS[other];
      let bx = x,
        bz = z,
        by = y + bendAt - 1 - r.nextInt(2);
      const len = 1 + r.nextInt(3);
      for (let i = 0; i < len; i++) {
        bx += ox;
        bz += oz;
        by++;
        this.log(bx, by, bz, BLOCK_X.ACACIA_LOG);
      }
      if (len > 0) {
        for (let dx = -2; dx <= 2; dx++)
          for (let dz = -2; dz <= 2; dz++)
            if (Math.abs(dx) !== 2 || Math.abs(dz) !== 2)
              this.leaf(bx + dx, by + 1, bz + dz, BLOCK_X.ACACIA_LEAVES);
        for (let dx = -1; dx <= 1; dx++)
          for (let dz = -1; dz <= 1; dz++)
            this.leaf(bx + dx, by + 2, bz + dz, BLOCK_X.ACACIA_LEAVES);
      }
    }
    this.swap(x, y - 1, z, TREE_SOIL, BLOCK.DIRT);
    return true;
  }
  darkOak(r: Rng, x: number, y: number, z: number): boolean {
    const height = r.nextInt(3) + r.nextInt(2) + 6;
    for (const [dx, dz] of TWO_BY_TWO) if (!this.ground(x + dx, y, z + dz)) return false;
    for (const [dx, dz] of TWO_BY_TWO)
      if (!this.clear(x + dx, y, y + height + 1, z + dz, 0)) return false;
    const [ddx, ddz] = DIRS[r.nextInt(4)];
    const bendAt = height - r.nextInt(4);
    let bend = 2 - r.nextInt(3);
    let tx = x,
      tz = z;
    const top = y + height - 1;
    for (let i = 0; i < height; i++) {
      if (i >= bendAt && bend > 0) {
        tx += ddx;
        tz += ddz;
        bend--;
      }
      for (const [dx, dz] of TWO_BY_TWO) this.log(tx + dx, y + i, tz + dz, BLOCK_X.DARK_OAK_LOG);
    }
    for (let dx = -2; dx <= 3; dx++)
      for (let dz = -2; dz <= 3; dz++) {
        const edge = (dx === -2 || dx === 3) && (dz === -2 || dz === 3);
        if (!edge) this.leaf(tx + dx, top, tz + dz, BLOCK_X.DARK_OAK_LEAVES);
        if (Math.abs(dx - 0.5) < 2.5 && Math.abs(dz - 0.5) < 2.5)
          this.leaf(tx + dx, top + 1, tz + dz, BLOCK_X.DARK_OAK_LEAVES);
        if (!edge && (dx === -2 || dx === 3 || dz === -2 || dz === 3) && r.nextInt(3) > 0)
          this.leaf(tx + dx, top - 1, tz + dz, BLOCK_X.DARK_OAK_LEAVES);
      }
    for (let dx = -3; dx <= 4; dx++)
      for (let dz = -3; dz <= 4; dz++)
        if (
          (dx === -3 || dx === 4 || dz === -3 || dz === 4) &&
          !((dx === -3 || dx === 4) && (dz === -3 || dz === 4)) &&
          r.nextInt(3) === 0
        )
          this.leaf(tx + dx, top, tz + dz, BLOCK_X.DARK_OAK_LEAVES);
    for (let dx = -1; dx <= 2; dx++)
      for (let dz = -1; dz <= 2; dz++)
        this.leaf(tx + dx, top + 2, tz + dz, BLOCK_X.DARK_OAK_LEAVES);
    return true;
  }
  megaJungle(r: Rng, x: number, y: number, z: number): boolean {
    const height = r.nextInt(3) + r.nextInt(20) + 10;
    for (const [dx, dz] of TWO_BY_TWO) if (!this.ground(x + dx, y, z + dz)) return false;
    for (const [dx, dz] of TWO_BY_TWO)
      if (!this.clear(x + dx, y, y + height, z + dz, 0)) return false;
    const top = y + height;
    const crown = (cx: number, cy: number, cz: number, radius: number) => {
      for (let dy = -2; dy <= 0; dy++) {
        const rr = radius - dy - 1 > radius ? radius : radius + dy + 1;
        for (let dx = -rr; dx <= rr + 1; dx++)
          for (let dz = -rr; dz <= rr + 1; dz++) {
            const ex = dx <= 0 ? -dx : dx - 1,
              ez = dz <= 0 ? -dz : dz - 1;
            if (ex * ex + ez * ez <= rr * rr)
              this.leaf(cx + dx, cy + dy, cz + dz, BLOCK_X.JUNGLE_LEAVES);
          }
      }
    };
    crown(x, top, z, 2);
    for (let by = top - 2 - r.nextInt(4); by > y + height / 2; by -= 2 + r.nextInt(4)) {
      const angle = r.nextFloat() * Math.PI * 2;
      let bx = x,
        bz = z;
      for (let i = 0; i < 5; i++) {
        bx = x + Math.floor(1.5 + Math.cos(angle) * i);
        bz = z + Math.floor(1.5 + Math.sin(angle) * i);
        this.log(bx, by - 3 + Math.floor(i / 2), bz, BLOCK_X.JUNGLE_LOG);
      }
      const crownY = by + 1 + r.nextInt(2);
      for (let dy = -1; dy <= 0; dy++)
        for (let dx = -2; dx <= 2; dx++)
          for (let dz = -2; dz <= 2; dz++)
            if (dx * dx + dz * dz <= (dy === 0 ? 2 : 5))
              this.leaf(bx + dx, crownY + dy, bz + dz, BLOCK_X.JUNGLE_LEAVES);
    }
    for (let i = 0; i < height; i++)
      for (const [dx, dz] of TWO_BY_TWO) this.log(x + dx, y + i, z + dz, BLOCK_X.JUNGLE_LOG);
    return true;
  }
  jungleBush(r: Rng, x: number, y: number, z: number): boolean {
    if (!this.ground(x, y, z) || !SOFT.has(this.base(x, y, z))) return false;
    this.log(x, y, z, BLOCK_X.JUNGLE_LOG);
    for (let dy = 0; dy <= 2; dy++) {
      const radius = 2 - dy;
      for (let dx = -radius; dx <= radius; dx++)
        for (let dz = -radius; dz <= radius; dz++)
          if (Math.abs(dx) !== radius || Math.abs(dz) !== radius || r.nextInt(2) === 0)
            this.leaf(x + dx, y + dy, z + dz, BLOCK_X.JUNGLE_LEAVES);
    }
    return true;
  }
  swampOak(r: Rng, x: number, y: number, z: number): boolean {
    // A swamp oak may stand in one block of water, rooted in the ground below.
    let root = y;
    if (this.base(x, root, z) === BLOCK.WATER) root++;
    if (this.base(x, root - 1, z) === BLOCK.WATER) root--;
    const height = r.nextInt(4) + 5;
    const groundY = this.base(x, root - 1, z) === BLOCK.WATER ? root - 1 : root;
    if (!TREE_SOIL.has(this.base(x, groundY - 1, z))) return false;
    for (let ly = groundY + height - 3; ly <= groundY + height; ly++) {
      const rel = ly - (groundY + height);
      const radius = 2 - Math.trunc(rel / 2);
      for (let dx = -radius; dx <= radius; dx++)
        for (let dz = -radius; dz <= radius; dz++) {
          if (
            Math.abs(dx) === radius &&
            Math.abs(dz) === radius &&
            (r.nextInt(2) === 0 || rel === 0)
          )
            continue;
          this.leaf(x + dx, ly, z + dz, BLOCK.LEAVES);
        }
    }
    for (let i = 0; i < height; i++) this.log(x, groundY + i, z, BLOCK.LOG);
    return true;
  }
  hugeMushroom(r: Rng, x: number, y: number, z: number, red: boolean): boolean {
    const below = this.base(x, y - 1, z);
    if (
      below !== BLOCK_X.MYCELIUM &&
      below !== BLOCK.GRASS &&
      below !== BLOCK.DIRT &&
      below !== BLOCK_X.PODZOL
    )
      return false;
    const height = r.nextInt(3) + 4 + (r.nextInt(12) === 0 ? 3 : 0);
    if (!this.clear(x, y, y + height + 1, z, 0)) return false;
    const cap = red ? BLOCK_X.RED_MUSHROOM_BLOCK : BLOCK_X.BROWN_MUSHROOM_BLOCK;
    const top = y + height;
    if (red) {
      for (let ly = top - 3; ly <= top; ly++) {
        const radius = ly < top ? 2 : 1;
        for (let dx = -radius; dx <= radius; dx++)
          for (let dz = -radius; dz <= radius; dz++) {
            const edge = Math.abs(dx) === radius || Math.abs(dz) === radius;
            if (ly < top && !edge) continue;
            if (ly < top && Math.abs(dx) === radius && Math.abs(dz) === radius) continue;
            this.leaf(x + dx, ly, z + dz, cap);
          }
      }
    } else {
      for (let dx = -3; dx <= 3; dx++)
        for (let dz = -3; dz <= 3; dz++)
          if (Math.abs(dx) !== 3 || Math.abs(dz) !== 3) this.leaf(x + dx, top, z + dz, cap);
    }
    for (let i = 0; i < height; i++) this.log(x, y + i, z, BLOCK_X.MUSHROOM_STEM);
    return true;
  }
  /** True when a structure claimed the ground within `reach` of a point. */
  blocked(x: number, z: number, reach: number): boolean {
    const reserved = this.view.reserved;
    if (!reserved) return false;
    return (
      reserved(x, z) ||
      reserved(x - reach, z - reach) ||
      reserved(x + reach, z - reach) ||
      reserved(x - reach, z + reach) ||
      reserved(x + reach, z + reach)
    );
  }
  tree(kind: TreeKind, r: Rng, x: number, z: number): boolean {
    if (this.blocked(x, z, 3)) return false;
    const y = this.view.height(x, z);
    switch (kind) {
      case 'oak':
        return this.simpleTree(r, x, y, z, r.nextInt(3) + 4, BLOCK.LOG, BLOCK.LEAVES);
      case 'fancy_oak':
        return this.fancyOak(r, x, y, z);
      case 'birch':
        return this.simpleTree(r, x, y, z, r.nextInt(3) + 5, BLOCK.BIRCH, BLOCK_X.BIRCH_LEAVES);
      case 'tall_birch':
        return this.simpleTree(
          r,
          x,
          y,
          z,
          r.nextInt(3) + 5 + r.nextInt(7),
          BLOCK.BIRCH,
          BLOCK_X.BIRCH_LEAVES,
        );
      case 'spruce':
        return this.spruce(r, x, y, z);
      case 'pine':
        return this.pine(r, x, y, z);
      case 'mega_spruce':
        return this.megaConifer(r, x, y, z, true);
      case 'mega_pine':
        return this.megaConifer(r, x, y, z, false);
      case 'jungle':
        return this.simpleTree(
          r,
          x,
          y,
          z,
          r.nextInt(7) + 4,
          BLOCK_X.JUNGLE_LOG,
          BLOCK_X.JUNGLE_LEAVES,
        );
      case 'mega_jungle':
        return this.megaJungle(r, x, y, z);
      case 'jungle_bush':
        return this.jungleBush(r, x, y, z);
      case 'acacia':
        return this.acacia(r, x, y, z);
      case 'dark_oak':
        return this.darkOak(r, x, y, z);
      case 'swamp_oak':
        return this.swampOak(r, x, y, z);
      case 'huge_brown_mushroom':
        return this.hugeMushroom(r, x, y, z, false);
      case 'huge_red_mushroom':
        return this.hugeMushroom(r, x, y, z, true);
    }
  }

  /* ------------------------------------------------------------------ plants */
  plantAt(x: number, y: number, z: number, state: number, ground: (s: number) => boolean): void {
    if (y < 1 || y > 254) return;
    if (this.base(x, y, z) !== BLOCK.AIR) return;
    if (!ground(this.base(x, y - 1, z))) return;
    this.soft(x, y, z, state);
  }
  /** A cluster of tries around a point, the way the reference scatters grass and flowers. */
  scatter(
    r: Rng,
    x: number,
    z: number,
    tries: number,
    reach: number,
    place: (x: number, y: number, z: number) => void,
  ): void {
    const y = this.view.height(x, z);
    for (let i = 0; i < tries; i++) {
      const px = x + r.nextInt(reach) - r.nextInt(reach),
        pz = z + r.nextInt(reach) - r.nextInt(reach);
      const py = this.view.height(px, pz);
      if (Math.abs(py - y) > 4 || this.view.reserved?.(px, pz)) continue;
      place(px, py, pz);
    }
  }
  nearWater(x: number, y: number, z: number): boolean {
    for (const [dx, dz] of DIRS) if (this.base(x + dx, y, z + dz) === BLOCK.WATER) return true;
    return false;
  }
  reeds(r: Rng, x: number, z: number): void {
    this.scatter(r, x, z, 20, 4, (px, py, pz) => {
      const g = this.base(px, py - 1, pz);
      if (
        g !== BLOCK.GRASS &&
        g !== BLOCK.DIRT &&
        g !== BLOCK.SAND &&
        g !== BLOCK_X.RED_SAND &&
        g !== BLOCK_X.PODZOL
      )
        return;
      if (!this.nearWater(px, py - 1, pz) || this.base(px, py, pz) !== BLOCK.AIR) return;
      const h = 2 + r.nextInt(r.nextInt(3) + 1);
      for (let i = 0; i < h; i++)
        if (this.base(px, py + i, pz) === BLOCK.AIR) this.soft(px, py + i, pz, BLOCK.SUGAR_CANE);
    });
  }
  cactus(r: Rng, x: number, z: number): void {
    this.scatter(r, x, z, 10, 8, (px, py, pz) => {
      // The reference starts each patch at a random height, so most of its tries miss the
      // ground: a desert chunk ends up with a handful of cacti, not a thicket.
      if (r.nextInt(8) !== 0) return;
      if (
        this.base(px, py - 1, pz) !== BLOCK.SAND &&
        this.base(px, py - 1, pz) !== BLOCK_X.RED_SAND
      )
        return;
      const h = 1 + r.nextInt(r.nextInt(3) + 1);
      for (let i = 0; i < h; i++) {
        for (const [dx, dz] of DIRS) if (this.base(px + dx, py + i, pz + dz) !== BLOCK.AIR) return;
        this.soft(px, py + i, pz, BLOCK.CACTUS);
      }
    });
  }
  lilyPads(r: Rng, x: number, z: number): void {
    this.scatter(r, x, z, 10, 8, (px, py, pz) => {
      if (this.base(px, py - 1, pz) === BLOCK.WATER && this.base(px, py, pz) === BLOCK.AIR)
        this.soft(px, py, pz, BLOCK_X.LILY_PAD);
    });
  }
  pumpkins(r: Rng, x: number, z: number, state: number): void {
    this.scatter(r, x, z, state === BLOCK.MELON ? 64 : 24, 8, (px, py, pz) => {
      if (
        this.base(px, py - 1, pz) === BLOCK.GRASS &&
        this.base(px, py, pz) === BLOCK.AIR &&
        r.nextInt(3) === 0
      )
        this.soft(px, py, pz, state);
    });
  }
  mushroomsUnder(r: Rng, x: number, z: number, state: number): void {
    // Small mushrooms grow in shade: under trees, and in caves on any stone floor.
    const underground = r.nextInt(2) === 0;
    const top = this.view.height(x, z);
    const y = underground ? 12 + r.nextInt(Math.max(1, top - 16)) : top;
    for (let i = 0; i < 16; i++) {
      const px = x + r.nextInt(8) - r.nextInt(8),
        pz = z + r.nextInt(8) - r.nextInt(8),
        py = y + r.nextInt(4) - r.nextInt(4);
      if (this.base(px, py, pz) !== BLOCK.AIR) continue;
      const g = this.base(px, py - 1, pz);
      if (!registry.get(g).occludes || g === BLOCK.SAND || g === BLOCK.GRAVEL) continue;
      if (!underground && g !== BLOCK_X.PODZOL && g !== BLOCK_X.MYCELIUM && r.nextInt(3) !== 0)
        continue;
      if (underground && py > this.view.height(px, pz) - 6) continue;
      this.soft(px, py, pz, state);
    }
  }
  boulder(r: Rng, x: number, z: number): void {
    let y = this.view.height(x, z);
    const g = this.base(x, y - 1, z);
    if (
      g !== BLOCK.GRASS &&
      g !== BLOCK.DIRT &&
      g !== BLOCK_X.PODZOL &&
      g !== BLOCK_X.COARSE_DIRT &&
      g !== BLOCK.STONE
    )
      return;
    y -= 1;
    for (let n = 0; n < 3; n++) {
      const a = r.nextInt(2),
        b = r.nextInt(2),
        c = r.nextInt(2);
      const f = (a + b + c) * 0.333 + 0.5;
      for (let dx = -a; dx <= a; dx++)
        for (let dy = -b; dy <= b; dy++)
          for (let dz = -c; dz <= c; dz++)
            if (dx * dx + dy * dy + dz * dz <= f * f)
              this.force(x + dx, y + dy, z + dz, BLOCK.MOSSY_COBBLESTONE);
      x += r.nextInt(3) - 1;
      z += r.nextInt(3) - 1;
      y -= r.nextInt(2);
    }
  }
  iceSpike(r: Rng, x: number, z: number): void {
    const y = this.view.height(x, z);
    if (this.base(x, y - 1, z) !== BLOCK.SNOW) return;
    const top = r.nextInt(4) + 7 + (r.nextInt(60) === 0 ? 10 + r.nextInt(30) : 0);
    const width = Math.floor(top / 4) + r.nextInt(2);
    for (let dy = 0; dy < top; dy++) {
      const f = (1 - dy / top) * width;
      const radius = Math.ceil(f);
      for (let dx = -radius; dx <= radius; dx++)
        for (let dz = -radius; dz <= radius; dz++) {
          const ex = Math.abs(dx) - 0.25,
            ez = Math.abs(dz) - 0.25;
          if ((dx === 0 && dz === 0) || ex * ex + ez * ez <= f * f) {
            if ((Math.abs(dx) === radius || Math.abs(dz) === radius) && r.nextFloat() > 0.75)
              continue;
            this.soft(x + dx, y + dy, z + dz, BLOCK_X.PACKED_ICE);
            if (dy !== 0 && radius > 1) this.soft(x + dx, y - dy + 1, z + dz, BLOCK_X.PACKED_ICE);
          }
        }
    }
  }
}
const STONE_HOST = new Set<number>([BLOCK.STONE]);
const DISC_SAND_HOSTS = new Set<number>([BLOCK.DIRT, BLOCK.GRASS]);
const DISC_CLAY_HOSTS = new Set<number>([BLOCK.DIRT, BLOCK_X.CLAY, BLOCK.SAND, BLOCK.GRAVEL]);
const TWO_BY_TWO: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];
const DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
function layerSize(limit: number, y: number): number {
  if (y < limit * 0.3) return -1;
  const half = limit / 2;
  const dist = half - y;
  let size = Math.sqrt(half * half - dist * dist);
  if (dist === 0) size = half;
  else if (Math.abs(dist) >= half) return 0;
  return size * 0.5;
}
function pickTree(biome: BiomeV5, r: Rng): TreeKind {
  const total = biome.treeKinds.reduce((sum, [, w]) => sum + w, 0);
  let t = r.nextFloat() * total;
  for (const [kind, w] of biome.treeKinds) if ((t -= w) < 0) return kind;
  return biome.treeKinds[0][0];
}

/** Everything the source chunk (sx, sz) plants into the target, in the reference's order. */
export function decorate(view: WorldView, sink: Sink, seed: number, sx: number, sz: number): void {
  const d = new Decorator(view, sink);
  const ox = sx * 16,
    oz = sz * 16;
  const biome = biomeV5(view.biome(ox + 16, oz + 16));
  const r = Rng.of(seed, 0xdec0, sx, sz);
  // Lakes come before everything else, as in the reference population.
  if (
    biome.kind !== 'river' &&
    biome.key !== 'desert' &&
    biome.key !== 'desert_hills' &&
    r.nextInt(4) === 0
  )
    d.lake(r, ox + r.nextInt(16) + 8, r.nextInt(256), oz + r.nextInt(16) + 8, BLOCK.WATER);
  if (r.nextInt(8) === 0) {
    const y = r.nextInt(r.nextInt(248) + 8);
    if (y < SEA_LEVEL || r.nextInt(10) === 0)
      d.lake(r, ox + r.nextInt(16) + 8, y, oz + r.nextInt(16) + 8, BLOCK.LAVA);
  }
  const u = Rng.of(seed, 0xd0e, sx, sz);
  for (let i = 0; i < 8; i++)
    d.dungeon(u, ox + u.nextInt(16) + 8, u.nextInt(256), oz + u.nextInt(16) + 8);
  d.ores(Rng.of(seed, 0x0e5, sx, sz), ox, oz);
  if (biome.surface === 'extreme_hills') {
    // Emerald ore: a few single blocks deep under the mountains only, on a stream of its own so
    // everything else in the chunk stays where it was.
    const e = Rng.of(seed, 0xe3e, sx, sz);
    for (let i = 3 + e.nextInt(6); i > 0; i--)
      d.swap(
        ox + e.nextInt(16),
        4 + e.nextInt(28),
        oz + e.nextInt(16),
        BLOCK.STONE,
        BLOCK_H.EMERALD_ORE,
      );
  }
  const p = Rng.of(seed, 0xf1a, sx, sz);
  const spot = () => [ox + p.nextInt(16) + 8, oz + p.nextInt(16) + 8] as const;
  for (let i = 0; i < biome.sandPatches; i++) {
    const [x, z] = spot();
    d.disc(p, x, z, 7, BLOCK.SAND, DISC_SAND_HOSTS);
  }
  for (let i = 0; i < biome.clay; i++) {
    const [x, z] = spot();
    d.disc(p, x, z, 4, BLOCK_X.CLAY, DISC_CLAY_HOSTS);
  }
  for (let i = 0; i < biome.gravelPatches; i++) {
    const [x, z] = spot();
    d.disc(p, x, z, 6, BLOCK.GRAVEL, DISC_SAND_HOSTS);
  }
  if (biome.boulders) for (let i = p.nextInt(3); i > 0; i--) d.boulder(p, ...spot());
  if (biome.key === 'ice_spikes') {
    for (let i = 0; i < 3; i++) d.iceSpike(p, ...spot());
  }
  // Trees.
  const t = Rng.of(seed, 0x7ee, sx, sz);
  if (biome.key === 'roofed_forest') {
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        const x = ox + i * 4 + 1 + 8 + t.nextInt(3),
          z = oz + j * 4 + 1 + 8 + t.nextInt(3);
        if (t.nextInt(20) === 0)
          d.tree(t.nextBoolean() ? 'huge_red_mushroom' : 'huge_brown_mushroom', t, x, z);
        else if (t.nextInt(3) > 0) d.tree('dark_oak', t, x, z);
        else
          d.tree(t.nextInt(5) === 0 ? 'birch' : t.nextInt(10) === 0 ? 'fancy_oak' : 'oak', t, x, z);
      }
  } else {
    let count = biome.trees;
    if (t.nextFloat() < biome.extraTreeChance) count++;
    for (let i = 0; i < count; i++) {
      const x = ox + t.nextInt(16) + 8,
        z = oz + t.nextInt(16) + 8;
      // The biome at the trunk decides the species, so forests end at their border.
      const here = biomeV5(view.biome(x, z));
      if (here.treeKinds.length && (here.trees > 0 || here.extraTreeChance > 0))
        d.tree(pickTree(here, t), t, x, z);
    }
  }
  for (let i = 0; i < biome.bigMushrooms; i++) {
    const [x, z] = [ox + t.nextInt(16) + 8, oz + t.nextInt(16) + 8];
    d.tree(t.nextBoolean() ? 'huge_red_mushroom' : 'huge_brown_mushroom', t, x, z);
  }
  // Ground cover.
  const g = Rng.of(seed, 0x9a55, sx, sz);
  const soil = (s: number) => TREE_SOIL.has(s) && s !== BLOCK_X.COARSE_DIRT;
  for (let i = 0; i < biome.flowers; i++) {
    const [x, z] = [ox + g.nextInt(16) + 8, oz + g.nextInt(16) + 8];
    const here = biomeV5(view.biome(x, z));
    if (!here.flowerKinds.length || here.flowers <= 0) continue;
    const flower = here.flowerKinds[g.nextInt(here.flowerKinds.length)];
    d.scatter(g, x, z, 16, 8, (px, py, pz) =>
      d.plantAt(px, py, pz, flower, (s) => s === BLOCK.GRASS || s === BLOCK.DIRT),
    );
  }
  for (let i = 0; i < biome.grass + biome.ferns; i++) {
    const [x, z] = [ox + g.nextInt(16) + 8, oz + g.nextInt(16) + 8];
    const fernShare = biome.ferns / Math.max(1, biome.grass + biome.ferns);
    d.scatter(g, x, z, 32, 8, (px, py, pz) =>
      d.plantAt(px, py, pz, g.nextFloat() < fernShare ? BLOCK_X.FERN : BLOCK.TALL_GRASS, soil),
    );
  }
  for (let i = 0; i < biome.deadBushes; i++) {
    const [x, z] = [ox + g.nextInt(16) + 8, oz + g.nextInt(16) + 8];
    d.scatter(g, x, z, 4, 8, (px, py, pz) =>
      d.plantAt(px, py, pz, BLOCK_X.DEAD_BUSH, (s) => DEAD_BUSH_GROUND.has(s)),
    );
  }
  for (let i = 0; i < biome.lilyPads; i++)
    d.lilyPads(g, ox + g.nextInt(16) + 8, oz + g.nextInt(16) + 8);
  const m = Rng.of(seed, 0x3005, sx, sz);
  for (let i = 0; i < biome.mushrooms; i++) {
    if (m.nextInt(4) === 0)
      d.mushroomsUnder(m, ox + m.nextInt(16) + 8, oz + m.nextInt(16) + 8, BLOCK_X.BROWN_MUSHROOM);
    if (m.nextInt(8) === 0)
      d.mushroomsUnder(m, ox + m.nextInt(16) + 8, oz + m.nextInt(16) + 8, BLOCK_X.RED_MUSHROOM);
  }
  if (m.nextInt(4) === 0)
    d.mushroomsUnder(m, ox + m.nextInt(16) + 8, oz + m.nextInt(16) + 8, BLOCK_X.BROWN_MUSHROOM);
  if (m.nextInt(8) === 0)
    d.mushroomsUnder(m, ox + m.nextInt(16) + 8, oz + m.nextInt(16) + 8, BLOCK_X.RED_MUSHROOM);
  for (let i = 0; i < biome.reeds + 10; i++) {
    if (i >= biome.reeds && m.nextInt(10) !== 0) continue;
    d.reeds(m, ox + m.nextInt(16) + 8, oz + m.nextInt(16) + 8);
  }
  if (biome.pumpkins !== false && m.nextInt(32) === 0)
    d.pumpkins(m, ox + m.nextInt(16) + 8, oz + m.nextInt(16) + 8, BLOCK.PUMPKIN);
  if (biome.melons)
    for (let i = 0; i < 2; i++)
      d.pumpkins(m, ox + m.nextInt(16) + 8, oz + m.nextInt(16) + 8, BLOCK.MELON);
  for (let i = 0; i < biome.cacti; i++) d.cactus(m, ox + m.nextInt(16) + 8, oz + m.nextInt(16) + 8);
}
export { SOFT, LEAVES };
