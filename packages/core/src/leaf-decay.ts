/**
 * Leaf decay, as in the reference game: once a tree loses its trunk, the crown that no longer
 * reaches a log falls apart over the next half a minute and drops its saplings and apples.
 *
 * The system is driven by events instead of random ticks: removing a log checks the leaves
 * around it, and each unsupported leaf gets its own delay. The decision is taken again when the
 * delay runs out, so a log put back in time saves the crown. Leaves placed far from any trunk
 * are never looked at, which keeps a player's hedge where it is.
 */
import { registry } from '../../content/src/blocks';
import type { VoxelWorld } from './world';

/** Leaves further than this from a removed log are not looked at. */
export const LEAF_DECAY_SCAN = 6;
/** A leaf stays while a log can be reached through at most this many leaves. */
export const LEAF_SUPPORT_RANGE = 6;
/** Delay range of one leaf, in ticks: the crown thins out over 2–25 seconds. */
export const LEAF_DECAY_MIN = 40;
export const LEAF_DECAY_SPREAD = 460;
/** Upper bound of pending leaves, so a burning forest cannot grow the queue without end. */
const MAX_PENDING = 4096;

const leafCache = new Map<number, boolean>();
const logCache = new Map<number, boolean>();
export function isLeaves(state: number): boolean {
  let value = leafCache.get(state);
  if (value === undefined) {
    value = state !== 0 && registry.get(state).key.endsWith('_leaves');
    leafCache.set(state, value);
  }
  return value;
}
export function isLog(state: number): boolean {
  let value = logCache.get(state);
  if (value === undefined) {
    value = state !== 0 && /_(log|wood)$/.test(registry.get(state).key);
    logCache.set(state, value);
  }
  return value;
}

interface Pending {
  x: number;
  y: number;
  z: number;
  at: number;
}

const NEIGHBOURS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;

export class LeafDecay {
  private pending: Pending[] = [];
  private readonly queued = new Set<string>();
  constructor(
    private readonly world: VoxelWorld,
    private readonly random: () => number,
  ) {}

  get backlog(): number {
    return this.pending.length;
  }

  /** Call after a block left the world; only a trunk leaving matters. */
  blockRemoved(x: number, y: number, z: number, state: number, tick: number): void {
    if (!isLog(state)) return;
    // Walk the crown that touches the removed log, and schedule every leaf that lost its trunk.
    const seen = new Set<string>();
    const stack: [number, number, number][] = [];
    for (const [dx, dy, dz] of NEIGHBOURS) stack.push([x + dx, y + dy, z + dz]);
    while (stack.length) {
      const [px, py, pz] = stack.pop()!;
      const key = `${px},${py},${pz}`;
      if (seen.has(key)) continue;
      if (Math.max(Math.abs(px - x), Math.abs(py - y), Math.abs(pz - z)) > LEAF_DECAY_SCAN)
        continue;
      seen.add(key);
      if (!isLeaves(this.world.getBlock(px, py, pz))) continue;
      if (!this.supported(px, py, pz)) this.schedule(px, py, pz, tick);
      for (const [dx, dy, dz] of NEIGHBOURS) stack.push([px + dx, py + dy, pz + dz]);
    }
  }

  /**
   * Leaves whose delay ran out and that are still without a trunk. The caller removes them and
   * rolls their drops, so the same rules as breaking by hand apply.
   */
  due(tick: number): { x: number; y: number; z: number; state: number }[] {
    if (!this.pending.length) return [];
    const out: { x: number; y: number; z: number; state: number }[] = [];
    const keep: Pending[] = [];
    for (const entry of this.pending) {
      if (entry.at > tick) {
        keep.push(entry);
        continue;
      }
      this.queued.delete(`${entry.x},${entry.y},${entry.z}`);
      if (!this.world.isLoaded(entry.x, entry.z)) continue;
      const state = this.world.getBlock(entry.x, entry.y, entry.z);
      if (!isLeaves(state) || this.supported(entry.x, entry.y, entry.z)) continue;
      out.push({ x: entry.x, y: entry.y, z: entry.z, state });
    }
    this.pending = keep;
    return out;
  }

  /** True when a log is reachable through connected leaves within the support range. */
  supported(x: number, y: number, z: number): boolean {
    const seen = new Set<string>([`${x},${y},${z}`]);
    let frontier: [number, number, number][] = [[x, y, z]];
    for (let step = 0; step < LEAF_SUPPORT_RANGE && frontier.length; step++) {
      const next: [number, number, number][] = [];
      for (const [px, py, pz] of frontier)
        for (const [dx, dy, dz] of NEIGHBOURS) {
          const nx = px + dx,
            ny = py + dy,
            nz = pz + dz;
          const key = `${nx},${ny},${nz}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const state = this.world.getBlock(nx, ny, nz);
          if (isLog(state)) return true;
          if (isLeaves(state)) next.push([nx, ny, nz]);
        }
      frontier = next;
    }
    return false;
  }

  private schedule(x: number, y: number, z: number, tick: number): void {
    const key = `${x},${y},${z}`;
    if (this.queued.has(key) || this.pending.length >= MAX_PENDING) return;
    this.queued.add(key);
    this.pending.push({
      x,
      y,
      z,
      at: tick + LEAF_DECAY_MIN + Math.floor(this.random() * LEAF_DECAY_SPREAD),
    });
  }
}
