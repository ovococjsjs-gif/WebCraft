import { registry, BLOCK } from '../../content/src/blocks';
import {
  chunkCoord,
  localCoord,
  columnKey,
  sectionIndex,
  sectionKey,
  validBlockPosition,
  SECTION_VOLUME,
} from './coordinates';
import { TickScheduler } from './clock';
import type { DimensionId } from './dimensions';
export interface SectionSnapshot {
  palette: number[];
  indices: Uint16Array;
  revision: number;
}
/** Palette-indexed storage. Bit packing is intentionally deferred. */
export class Section {
  readonly indices = new Uint16Array(SECTION_VOLUME);
  readonly palette: number[] = [BLOCK.AIR];
  private readonly reverse = new Map<number, number>([[BLOCK.AIR, 0]]);
  revision = 0;
  nonAir = 0;
  get(index: number): number {
    return this.palette[this.indices[index]];
  }
  set(index: number, state: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= SECTION_VOLUME)
      throw new RangeError('Invalid section index');
    if (!registry.has(state)) throw new Error(`Unknown state ${state}`);
    const previous = this.get(index);
    if (previous === state) return false;
    let paletteIndex = this.reverse.get(state);
    if (paletteIndex === undefined) {
      paletteIndex = this.palette.length;
      this.palette.push(state);
      this.reverse.set(state, paletteIndex);
    }
    this.indices[index] = paletteIndex;
    this.nonAir += (state !== BLOCK.AIR ? 1 : 0) - (previous !== BLOCK.AIR ? 1 : 0);
    this.revision++;
    return true;
  }
  snapshot(): SectionSnapshot {
    return { palette: [...this.palette], indices: this.indices.slice(), revision: this.revision };
  }
  static restore(s: SectionSnapshot): Section {
    if (
      s.indices.length !== SECTION_VOLUME ||
      s.palette.length < 1 ||
      s.palette.length > SECTION_VOLUME + 1 ||
      s.palette[0] !== BLOCK.AIR ||
      new Set(s.palette).size !== s.palette.length ||
      s.palette.some((v) => !registry.has(v))
    )
      throw new Error('Invalid section snapshot');
    const result = new Section();
    result.palette.splice(0, result.palette.length, ...s.palette);
    result.reverse.clear();
    s.palette.forEach((v, i) => result.reverse.set(v, i));
    for (let i = 0; i < SECTION_VOLUME; i++) {
      const p = s.indices[i];
      if (p >= s.palette.length) throw new Error('Invalid palette index');
      result.indices[i] = p;
      if (s.palette[p] !== BLOCK.AIR) result.nonAir++;
    }
    result.revision = s.revision;
    return result;
  }
}
export type ColumnStatus = 'allocated' | 'generating' | 'ready';
export const PLANT_TICK_PERIOD = 128;
function plantBucket(index: number): number {
  return Math.imul(index ^ (index >>> 7), 31) & (PLANT_TICK_PERIOD - 1);
}
export class ChunkColumn {
  revision = 0;
  lightRevision = 0;
  readonly emitters = new Set<number>();
  readonly chests = new Set<number>();
  readonly plantBuckets = new Map<number, Set<number>>();
  readonly sections = new Map<number, Section>();
  status: ColumnStatus = 'allocated';
  /** Biome of every column (x + z * 16) from the v5 generator; regenerated, never saved. */
  biomes?: Uint8Array;
  /** v5: the loot table of each generated chest and the creature of each spawner, by index. */
  chestLoot?: ReadonlyMap<number, string>;
  spawners?: ReadonlyMap<number, string>;
  constructor(
    readonly cx: number,
    readonly cz: number,
  ) {}
  get(x: number, y: number, z: number): number {
    return this.sections.get(chunkCoord(y))?.get(sectionIndex(x, localCoord(y), z)) ?? BLOCK.AIR;
  }
  set(x: number, y: number, z: number, state: number): boolean {
    const sy = chunkCoord(y);
    let section = this.sections.get(sy);
    if (!section) {
      if (state === BLOCK.AIR) return false;
      section = new Section();
      this.sections.set(sy, section);
    }
    const localIndex = sectionIndex(x, localCoord(y), z),
      before = registry.get(section.get(localIndex));
    if (!section.set(localIndex, state)) return false;
    this.revision++;
    const index = (y << 8) | (z << 4) | x,
      def = registry.get(state);
    if (
      before.occludes !== def.occludes ||
      before.fluid !== def.fluid ||
      before.light !== def.light
    )
      this.lightRevision++;
    if (def.light) this.emitters.add(index);
    else this.emitters.delete(index);
    if (state === BLOCK.CHEST) this.chests.add(index);
    else this.chests.delete(index);
    const bucket = plantBucket(index);
    let plants = this.plantBuckets.get(bucket);
    if (
      (def.cropStage !== undefined && (def.cropStage < 7 || def.stem !== undefined)) ||
      def.sapling !== undefined ||
      (
        [
          BLOCK.FARMLAND,
          BLOCK.FARMLAND_WET,
          BLOCK.OAK_SAPLING,
          BLOCK.CACTUS,
          BLOCK.SUGAR_CANE,
        ] as readonly number[]
      ).includes(state)
    ) {
      if (!plants) {
        plants = new Set<number>();
        this.plantBuckets.set(bucket, plants);
      }
      plants.add(index);
    } else if (plants) {
      plants.delete(index);
      if (!plants.size) this.plantBuckets.delete(bucket);
    }
    return true;
  }
}
export interface BlockMutation {
  x: number;
  y: number;
  z: number;
  before: number;
  state: number;
}

/** Reference day length and the window in which a bed may be used. */
export const DAY_TICKS = 24_000;
export const SLEEP_START = 12_542;
export const SLEEP_END = 23_459;
export function dayTime(time: number): number {
  return ((Math.floor(time) % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
}
export function isNight(time: number): boolean {
  const t = dayTime(time);
  return t >= SLEEP_START && t < SLEEP_END;
}
/** 0 at dawn, 0.5 at dusk; handy for sky colour and light. */
export function dayProgress(time: number): number {
  return dayTime(time) / DAY_TICKS;
}
/** Shared by core and renderer: dawn 0, noon 6000, dusk 12000, midnight 18000. */
export function solarElevation(time: number): number {
  return Math.sin(dayProgress(time) * Math.PI * 2);
}
export function daylight(time: number): number {
  return Math.max(0, Math.min(1, (solarElevation(time) + 0.18) / 1.18));
}
export class VoxelWorld {
  onBlockChange?: (change: BlockMutation) => void;
  readonly columns = new Map<string, ChunkColumn>();
  readonly scheduler = new TickScheduler();
  readonly dirtySections = new Set<string>();
  revision = 0;
  tick = 0;
  /** Time of day in ticks, 0..23999; noon is 6000 and midnight 18000. */
  time = 0;
  constructor(
    readonly seed: string,
    readonly dimensionID: DimensionId = 'overworld',
  ) {}
  column(cx: number, cz: number): ChunkColumn | undefined {
    return this.columns.get(columnKey(cx, cz));
  }
  isLoaded(x: number, z: number): boolean {
    return this.column(chunkCoord(x), chunkCoord(z))?.status === 'ready';
  }
  addColumn(column: ChunkColumn): void {
    this.columns.set(columnKey(column.cx, column.cz), column);
    this.revision++;
    this.markColumn(column.cx, column.cz);
  }
  removeColumn(cx: number, cz: number): void {
    this.columns.delete(columnKey(cx, cz));
    for (const key of this.dirtySections) {
      const [x, , z] = key.split(',').map(Number);
      if (x === cx && z === cz) this.dirtySections.delete(key);
    }
    this.revision++;
  }
  getBlock(x: number, y: number, z: number): number {
    if (!validBlockPosition(x, y, z)) return BLOCK.AIR;
    return (
      this.column(chunkCoord(x), chunkCoord(z))?.get(localCoord(x), y, localCoord(z)) ?? BLOCK.AIR
    );
  }
  setBlock(x: number, y: number, z: number, state: number): boolean {
    if (!validBlockPosition(x, y, z) || !registry.has(state)) return false;
    const column = this.column(chunkCoord(x), chunkCoord(z));
    if (!column || column.status !== 'ready') return false;
    const before = column.get(localCoord(x), y, localCoord(z));
    if (!column.set(localCoord(x), y, localCoord(z), state)) return false;
    this.onBlockChange?.({ x, y, z, before, state });
    const oldDef = registry.get(before),
      newDef = registry.get(state);
    if (
      oldDef.occludes !== newDef.occludes ||
      oldDef.light !== newDef.light ||
      oldDef.fluid !== newDef.fluid
    )
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) this.markColumn(column.cx + dx, column.cz + dz);
    this.revision++;
    const cx = chunkCoord(x),
      cz = chunkCoord(z),
      sy = chunkCoord(y);
    this.dirtySections.add(sectionKey(cx, sy, cz));
    // AO also depends on diagonal neighbours; invalidate all touched columns on edges.
    const dx = localCoord(x) === 0 ? -1 : localCoord(x) === 15 ? 1 : 0;
    const dz = localCoord(z) === 0 ? -1 : localCoord(z) === 15 ? 1 : 0;
    for (const ox of dx ? [0, dx] : [0])
      for (const oz of dz ? [0, dz] : [0]) {
        this.dirtySections.add(sectionKey(cx + ox, sy, cz + oz));
        if (localCoord(y) === 0 && sy > 0)
          this.dirtySections.add(sectionKey(cx + ox, sy - 1, cz + oz));
        if (localCoord(y) === 15 && sy < 15)
          this.dirtySections.add(sectionKey(cx + ox, sy + 1, cz + oz));
      }
    return true;
  }
  markColumn(cx: number, cz: number): void {
    const column = this.column(cx, cz);
    if (!column) return;
    for (const sy of column.sections.keys()) this.dirtySections.add(sectionKey(cx, sy, cz));
  }
  get sectionCount(): number {
    let n = 0;
    for (const c of this.columns.values()) n += c.sections.size;
    return n;
  }
  get storageBytes(): number {
    let n = 0;
    for (const c of this.columns.values())
      for (const s of c.sections.values()) n += s.indices.byteLength + s.palette.length * 2;
    return n;
  }
}
