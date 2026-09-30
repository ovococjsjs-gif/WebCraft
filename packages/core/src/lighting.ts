import { registry } from '../../content/src/blocks';
import type { ChunkColumn, VoxelWorld } from './world';
export const MAX_LIGHT = 15;
export const LIGHT_RANGE = 15;
const SIZE = 16 * 16 * 256;
const neighbours = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;
interface ColumnLight {
  sky: Uint8Array;
  block: Uint8Array;
  dependencies: (ChunkColumn | number | undefined)[];
  checkedRevision: number;
}
/** Cross-column block-light flood fill, cached by the nine LOCAL column revisions.
 * Only the resulting 16×256×16 column is retained; the 48-wide flood workspace is temporary.
 * Opaque blocks STOP propagation. A global edit does not invalidate a distant light cache.
 */
export class LightEngine {
  private readonly columns = new Map<string, ColumnLight>();
  private readonly empty = new Uint8Array(SIZE);
  builds = 0;
  constructor(private readonly world: VoxelWorld) {}
  get cachedColumns() {
    return this.columns.size;
  }
  noteEmitter(_x: number, _y: number, _z: number): void {
    /* indexed by ChunkColumn.set */
  }
  invalidate(x: number, z: number): void {
    const cx = Math.floor(x / 16),
      cz = Math.floor(z / 16);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) this.columns.delete(`${cx + dx},${cz + dz}`);
  }
  private dependencies(cx: number, cz: number) {
    const result: (ChunkColumn | number | undefined)[] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const c = this.world.column(cx + dx, cz + dz);
        result.push(c, c?.lightRevision);
      }
    return result;
  }
  isPrepared(cx: number, cz: number): boolean {
    if (!this.world.column(cx, cz)) return true;
    const cached = this.columns.get(`${cx},${cz}`);
    if (!cached) return false;
    if (cached.checkedRevision === this.world.revision) return true;
    const same = this.dependencies(cx, cz).every((entry, i) => entry === cached.dependencies[i]);
    if (same) cached.checkedRevision = this.world.revision;
    return same;
  }
  prepare(cx: number, cz: number): void {
    this.column(cx, cz);
  }
  private column(cx: number, cz: number): ColumnLight {
    const key = `${cx},${cz}`,
      column = this.world.column(cx, cz);
    if (!column)
      return {
        sky: this.empty,
        block: this.empty,
        dependencies: [],
        checkedRevision: this.world.revision,
      };
    const cached = this.columns.get(key);
    if (cached?.checkedRevision === this.world.revision) return cached;
    const deps = this.dependencies(cx, cz);
    if (cached && deps.every((entry, i) => entry === cached.dependencies[i])) {
      cached.checkedRevision = this.world.revision;
      return cached;
    }
    // Eviction never leaves detached arrays behind, even while continuously travelling.
    for (const k of this.columns.keys()) if (!this.world.columns.has(k)) this.columns.delete(k);
    const entry = this.build(cx, cz, deps);
    this.columns.set(key, entry);
    return entry;
  }
  private build(cx: number, cz: number, dependencies: ColumnLight['dependencies']): ColumnLight {
    this.builds++;
    const sky = new Uint8Array(SIZE),
      block = new Uint8Array(SIZE),
      column = this.world.column(cx, cz)!;
    if (this.world.dimensionID === 'overworld') {
      for (let z = 0; z < 16; z++)
        for (let x = 0; x < 16; x++) {
          let level = 15;
          for (let y = 255; y >= 0; y--) {
            const def = registry.get(column.get(x, y, z));
            if (def.occludes) level = 0;
            else if (def.fluid && level > 0) level = Math.max(0, level - 2);
            sky[(y << 8) | (z << 4) | x] = level;
          }
        }
    }
    const sources: { x: number; y: number; z: number; light: number }[] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const c = this.world.column(cx + dx, cz + dz);
        if (!c) continue;
        for (const index of c.emitters) {
          const x = index & 15,
            z = (index >> 4) & 15,
            y = index >> 8;
          sources.push({
            x: x + (dx + 1) * 16,
            y,
            z: z + (dz + 1) * 16,
            light: registry.get(c.get(x, y, z)).light ?? 0,
          });
        }
      }
    if (sources.length) {
      const width = 48,
        plane = width * width;
      let low = 255,
        high = 0;
      for (const source of sources) {
        low = Math.min(low, source.y - 15);
        high = Math.max(high, source.y + 15);
      }
      low = Math.max(0, low);
      high = Math.min(255, high);
      const values = new Uint8Array(plane * (high - low + 1));
      const queue: number[] = [];
      const index = (x: number, y: number, z: number) => (y - low) * plane + z * width + x;
      for (const source of sources) {
        const i = index(source.x, source.y, source.z);
        values[i] = source.light;
        queue.push(i);
      }
      for (let head = 0; head < queue.length; head++) {
        const i = queue[head],
          level = values[i];
        if (level <= 1) continue;
        const x = i % width,
          z = Math.floor(i / width) % width,
          y = Math.floor(i / plane) + low;
        for (const [dx, dy, dz] of neighbours) {
          const nx = x + dx,
            ny = y + dy,
            nz = z + dz;
          if (nx < 0 || nx >= width || nz < 0 || nz >= width || ny < low || ny > high) continue;
          const j = index(nx, ny, nz);
          if (values[j] >= level - 1) continue;
          const neighbor = this.world.column(
            cx + Math.floor(nx / 16) - 1,
            cz + Math.floor(nz / 16) - 1,
          );
          if (!neighbor) continue;
          const def = registry.get(neighbor.get(nx & 15, ny, nz & 15));
          if (def.occludes) continue;
          const next = level - (def.fluid ? 2 : 1);
          if (next <= values[j]) continue;
          values[j] = next;
          queue.push(j);
        }
      }
      for (let y = low; y <= high; y++)
        for (let z = 0; z < 16; z++)
          for (let x = 0; x < 16; x++)
            block[(y << 8) | (z << 4) | x] = values[index(x + 16, y, z + 16)];
    }
    return { sky, block, dependencies, checkedRevision: this.world.revision };
  }
  blockLight(x: number, y: number, z: number): number {
    if (y < 0 || y > 255) return 0;
    return this.column(Math.floor(x / 16), Math.floor(z / 16)).block[
      (Math.floor(y) << 8) | ((z & 15) << 4) | (x & 15)
    ];
  }
  skyLight(x: number, y: number, z: number): number {
    if (this.world.dimensionID !== 'overworld' || y < 0) return 0;
    if (y > 255) return 15;
    if (!this.world.isLoaded(x, z)) return 15;
    return this.column(Math.floor(x / 16), Math.floor(z / 16)).sky[
      (Math.floor(y) << 8) | ((z & 15) << 4) | (x & 15)
    ];
  }
  lightAt(x: number, y: number, z: number, isNight: boolean): number {
    return Math.max(
      this.blockLight(x, y, z),
      Math.max(0, this.skyLight(x, y, z) - (isNight ? 11 : 0)),
    );
  }
  clear(): void {
    this.columns.clear();
  }
}
