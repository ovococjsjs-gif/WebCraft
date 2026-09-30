/**
 * Fluids: water and lava, their levels, spreading rules and the interaction between them.
 *
 * The storage stays the world itself: a source is stored as the source block (water/lava), a
 * flow as one of the `*_flow_N` blocks. A cell that needs a decision is put into `active` and
 * the system re-evaluates it on later ticks, which is how the reference game keeps the cost of
 * a waterfall bounded instead of scanning the whole world every tick.
 */
import { BLOCK, registry, type BlockDefinition } from '../../content/src/blocks';
import type { VoxelWorld } from './world';

export type FluidKind = 'water' | 'lava';
/** Flowing levels: water spreads seven blocks, lava only three before it stops. */
export const WATER_MAX_LEVEL = 7;
export const LAVA_MAX_LEVEL = 3;
/** Ticks between two fluid ticks; lava is far slower than water, as in the reference. */
export const WATER_DELAY = 5;
export const LAVA_DELAY = 30;
/** Cells re-evaluated in a single tick, so one broken dam cannot freeze the whole simulation. */
export const FLUID_BUDGET = 4096;
/** How far a cell searches downwards for a drop before spreading sideways. */
export const FLUID_SLOPE_DISTANCE = 4;
/** Pending cells kept in a save; the rest wake again when their neighbours change. */
export const SAVED_FLUID_LIMIT = 8192;

export interface SavedFluid {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const DIRS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function fluidKindOf(state: number): FluidKind | null {
  return registry.get(state).fluid ?? null;
}

export function fluidLevelOf(state: number): number {
  const def = registry.get(state);
  if (!def.fluid) return -1;
  return def.fluidSource ? 0 : (def.fluidLevel ?? 0);
}

export function isFluidSource(state: number): boolean {
  return registry.get(state).fluidSource === true;
}

/** The flowing block that carries `level`, or the source block for level zero. */
export function fluidStateFor(kind: FluidKind, level: number): number {
  if (level <= 0) return kind === 'water' ? BLOCK.WATER : BLOCK.LAVA;
  const capped = Math.min(level, kind === 'water' ? WATER_MAX_LEVEL : LAVA_MAX_LEVEL);
  return (kind === 'water' ? BLOCK.WATER_FLOW_1 : 32) + capped - 1;
}

/** A fluid can move into air and into a flow of the same kind, but never into a solid block. */
function canFlowInto(world: VoxelWorld, x: number, y: number, z: number, kind: FluidKind): boolean {
  const state = world.getBlock(x, y, z);
  if (state === BLOCK.AIR) return true;
  const def = registry.get(state);
  if (!def.fluid) return false;
  if (def.fluid !== kind) return false;
  return !isFluidSource(state);
}

function isSolidAt(world: VoxelWorld, x: number, y: number, z: number): boolean {
  const def = registry.get(world.getBlock(x, y, z));
  return def.solid;
}

/** Water and lava meeting: lava cools into obsidian at its source and into cobble when flowing. */
export function cooledLavaState(source: boolean): number {
  return source ? BLOCK.OBSIDIAN : BLOCK.COBBLE;
}

export class FluidSystem {
  /** Called after every write, so the host can journal it and wake its neighbours. */
  onWrite?: (x: number, y: number, z: number, before: number, state: number) => void;
  readonly active = new Set<string>();
  /** Number of cells re-evaluated on the last tick, for the diagnostics report. */
  lastProcessed = 0;
  private tickIndex = 0;

  constructor(private readonly world: VoxelWorld) {}

  /** Writes through the world and reports the change, in one place. */
  private write(x: number, y: number, z: number, state: number): boolean {
    const before = this.world.getBlock(x, y, z);
    // Rewriting the same state would wake the neighbours for nothing and keep a waterfall
    // re-scheduling itself forever.
    if (before === state) return false;
    if (!this.world.setBlock(x, y, z, state)) return false;
    this.onWrite?.(x, y, z, before, state);
    return true;
  }

  private static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }
  private static parse(key: string): [number, number, number] {
    const [x, y, z] = key.split(',').map(Number);
    return [x, y, z];
  }

  /** Schedules a cell and its neighbours; called for every block change and every fluid tick. */
  mark(x: number, y: number, z: number): void {
    if (!this.world.isLoaded(x, z)) return;
    this.active.add(FluidSystem.key(x, y, z));
    this.active.add(FluidSystem.key(x, y + 1, z));
    for (const [dx, dz] of DIRS) {
      this.active.add(FluidSystem.key(x + dx, y, z + dz));
      this.active.add(FluidSystem.key(x + dx, y - 1, z + dz));
    }
  }

  /** Re-schedules every fluid cell near a position: used after a chunk is loaded. */
  scan(x0: number, y0: number, z0: number, radius = 2): void {
    for (let x = x0 - radius; x <= x0 + radius; x++)
      for (let z = z0 - radius; z <= z0 + radius; z++)
        for (let y = Math.max(0, y0 - radius); y <= Math.min(255, y0 + radius); y++)
          if (registry.get(this.world.getBlock(x, y, z)).fluid) this.mark(x, y, z);
  }

  get size(): number {
    return this.active.size;
  }

  /**
   * One fluid step. Water and lava move on different schedules, so a cell waits for its own
   * delay before it is evaluated again; a fresh block change always evaluates immediately.
   */
  tick(): number {
    this.tickIndex++;
    if (this.active.size === 0) {
      this.lastProcessed = 0;
      return 0;
    }
    const keys = [...this.active].sort();
    const retry: string[] = [];
    let processed = 0;
    for (const key of keys) {
      this.active.delete(key);
      if (processed >= FLUID_BUDGET) {
        retry.push(key);
        continue;
      }
      const [x, y, z] = FluidSystem.parse(key);
      if (!this.world.isLoaded(x, z)) continue;
      const state = this.world.getBlock(x, y, z);
      const def = registry.get(state);
      if (!def.fluid) continue;
      const delay = def.fluid === 'water' ? WATER_DELAY : LAVA_DELAY;
      // A deterministic pseudo delay in [0, delay) keeps a plane of water from ticking in
      // lockstep while staying reproducible for the same world and tick.
      const phase = Math.abs(Math.imul(x * 31 + y * 17 + z * 7, 2654435761)) % delay;
      if (phase !== this.tickIndex % delay) {
        retry.push(key);
        continue;
      }
      processed++;
      this.stepCell(x, y, z, def);
    }
    for (const key of retry) this.active.add(key);
    this.lastProcessed = processed;
    return processed;
  }

  private stepCell(x: number, y: number, z: number, def: BlockDefinition): void {
    const kind = def.fluid!;
    if (kind === 'lava') {
      // Lava that touches water hardens before it spreads any further.
      for (const [dx, dy, dz] of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ] as const) {
        const neighbour = registry.get(this.world.getBlock(x + dx, y + dy, z + dz));
        if (neighbour.fluid === 'water') {
          if (this.write(x, y, z, cooledLavaState(def.fluidSource === true))) this.mark(x, y, z);
          return;
        }
      }
    }
    const source = def.fluidSource === true;
    if (source) {
      // A source only pushes water out. It is woken again by any change around it (writes mark
      // their neighbours), so a still lake falls asleep instead of re-scheduling itself forever.
      this.flowFrom(x, y, z, kind, 0);
      return;
    }
    // Two neighbouring sources with solid ground below turn the flow into a source.
    if (kind === 'water' && this.creationAllowed(kind, x, y, z)) {
      // Through write(), so the new source is journaled and survives a reload.
      if (this.write(x, y, z, BLOCK.WATER)) this.mark(x, y, z);
      return;
    }
    const level = fluidLevelOf(this.world.getBlock(x, y, z));
    if (level <= 0 || level > (kind === 'water' ? WATER_MAX_LEVEL : LAVA_MAX_LEVEL)) {
      if (this.write(x, y, z, BLOCK.AIR)) this.mark(x, y, z);
      return;
    }
    const feeding = this.feedingLevel(kind, x, y, z, level);
    if (feeding === null) {
      // Nothing feeds this flow any more, so it drains.
      if (this.write(x, y, z, BLOCK.AIR)) this.mark(x, y, z);
      return;
    }
    if (feeding !== level) {
      if (this.write(x, y, z, fluidStateFor(kind, feeding))) this.mark(x, y, z);
    }
    this.flowFrom(x, y, z, kind, feeding);
  }

  /**
   * Sources only form through the two-source rule, never out of thin air: a flowing cell with
   * two neighbouring water sources and a solid floor becomes a source itself.
   */
  private creationAllowed(kind: FluidKind, x: number, y: number, z: number): boolean {
    if (kind !== 'water') return false;
    if (!isSolidAt(this.world, x, y - 1, z)) return false;
    let sources = 0;
    for (const [dx, dz] of DIRS) {
      const def = registry.get(this.world.getBlock(x + dx, y, z + dz));
      if (def.fluid === 'water' && def.fluidSource) sources++;
    }
    return sources >= 2;
  }

  private tryCreateSource(kind: FluidKind, x: number, y: number, z: number): void {
    const state = this.world.getBlock(x, y, z);
    if (isFluidSource(state)) return;
    if (registry.get(state).solid) return;
    if (this.write(x, y, z, kind === 'water' ? BLOCK.WATER : BLOCK.LAVA)) this.mark(x, y, z);
  }

  /**
   * Level this flow cell should carry, or `null` when nothing feeds it any more.
   *
   * The rule is the gradient from a source: a cell is fed when a source is next to it or when
   * a neighbour carries a *smaller* level, so levels can fall but never rise. That is what makes
   * a broken dam drain from the far end towards the hole instead of re-numbering itself.
   */
  private feedingLevel(
    kind: FluidKind,
    x: number,
    y: number,
    z: number,
    own: number,
  ): number | null {
    const max = kind === 'water' ? WATER_MAX_LEVEL : LAVA_MAX_LEVEL;
    // Anything directly above keeps the cell flowing at level one.
    if (registry.get(this.world.getBlock(x, y + 1, z)).fluid === kind) return 1;
    let best: number | null = null;
    for (const [dx, dz] of DIRS) {
      const def = registry.get(this.world.getBlock(x + dx, y, z + dz));
      if (def.fluid !== kind) continue;
      const level = def.fluidSource ? 0 : (def.fluidLevel ?? 0);
      if (!def.fluidSource && level >= own) continue;
      const candidate = Math.min(level + 1, max);
      if (best === null || candidate < best) best = candidate;
    }
    return best;
  }

  /** Pushes fluid out of a cell: down first, then sideways with a slope search. */
  private flowFrom(x: number, y: number, z: number, kind: FluidKind, level: number): void {
    const max = kind === 'water' ? WATER_MAX_LEVEL : LAVA_MAX_LEVEL;
    if (y > 0 && canFlowInto(this.world, x, y - 1, z, kind)) {
      if (this.write(x, y - 1, z, fluidStateFor(kind, Math.min(1, max)))) this.mark(x, y - 1, z);
      // A free drop takes everything: the water falls instead of running along the top.
      return;
    }
    const next = level + 1;
    if (next > max) return;
    for (const [dx, dz] of DIRS) {
      const tx = x + dx,
        tz = z + dz;
      if (!this.world.isLoaded(tx, tz)) continue;
      if (!canFlowInto(this.world, tx, y, tz, kind)) {
        // A solid neighbour may still pass water on when the floor below it is open.
        if (!this.findDrop(kind, tx, y, tz)) continue;
        if (this.write(tx, y - 1, tz, fluidStateFor(kind, 1))) this.mark(tx, y - 1, tz);
        continue;
      }
      const drop = this.findDrop(kind, tx, y, tz);
      if (drop) {
        if (this.write(tx, y, tz, fluidStateFor(kind, 1))) this.mark(tx, y, tz);
        continue;
      }
      const existing = fluidLevelOf(this.world.getBlock(tx, y, tz));
      if (existing >= 0 && existing <= next) continue;
      if (this.write(tx, y, tz, fluidStateFor(kind, next))) this.mark(tx, y, tz);
    }
  }

  /** True when the column at (x,z) has an opening below the current level within reach. */
  private findDrop(kind: FluidKind, x: number, y: number, z: number): boolean {
    for (let depth = 1; depth <= FLUID_SLOPE_DISTANCE; depth++) {
      const below = y - depth;
      if (below < 0) return false;
      const state = this.world.getBlock(x, below, z);
      const def = registry.get(state);
      if (def.solid) return false;
      if (def.fluid === kind) return false;
      if (def.fluid && def.fluid !== kind) return false;
      if (!canFlowInto(this.world, x, below - 1, z, kind)) return true;
    }
    return false;
  }

  snapshot(): SavedFluid[] {
    return [...this.active]
      .map((key) => FluidSystem.parse(key))
      .map(([x, y, z]) => ({ x, y, z }))
      .sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z)
      .slice(0, SAVED_FLUID_LIMIT);
  }

  restore(cells: readonly SavedFluid[]): void {
    this.active.clear();
    for (const cell of cells) this.active.add(FluidSystem.key(cell.x, cell.y, cell.z));
  }

  clear(): void {
    this.active.clear();
  }
}
