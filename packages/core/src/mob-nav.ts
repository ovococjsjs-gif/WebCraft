/**
 * Creature navigation: a small A* over the voxel grid in the spirit of the reference walk-node
 * processor, plus line of sight. Creatures stand on cells; a cell is open when nothing blocks its
 * centre (open doors, trapdoors, carpets and snow layers do not), and a fence below reaches up
 * into it. Moves go to the eight neighbours, one block up (a jump) or down a bounded drop.
 */
import { BLOCK, registry } from '../../content/src/blocks';
import { cellBoxes } from './collision';
import type { Vec3 } from './coordinates';
import type { VoxelWorld } from './world';

export interface NavPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
export interface NavOptions {
  /** Cells of body height, `ceil(height)`. */
  readonly height: number;
  /** Deepest drop the creature accepts on the way (3 for most, more when it is chasing). */
  readonly maxDrop: number;
  /** Water cells may be crossed (swimmers, hunters); animals on land avoid them. */
  readonly swim: boolean;
  /** Expansion budget; the best partial path is returned when it runs out. */
  readonly maxNodes?: number;
  /** Stop once within this horizontal distance of the goal. */
  readonly reach?: number;
}
const DANGER = new Set<number>([BLOCK.LAVA, BLOCK.FIRE, BLOCK.CACTUS, BLOCK.MAGMA]);

/** Whether the centre column of a cell is obstructed for a walking body. */
export function blocksBody(world: VoxelWorld, x: number, y: number, z: number): boolean {
  if (y < 0) return false;
  if (!world.isLoaded(x, z)) return true;
  for (const b of cellBoxes(world, x, y, z))
    if (b[4] > 0.2 && b[0] < 0.7 && b[3] > 0.3 && b[2] < 0.7 && b[5] > 0.3) return true;
  // Fences and walls are one and a half blocks tall: they reach into the cell above.
  for (const b of cellBoxes(world, x, y - 1, z))
    if (b[4] > 1 && b[0] < 0.7 && b[3] > 0.3 && b[2] < 0.7 && b[5] > 0.3) return true;
  return false;
}
function blockDef(world: VoxelWorld, x: number, y: number, z: number) {
  if (y < 0 || !world.isLoaded(x, z)) return undefined;
  return registry.get(world.getBlock(x, y, z));
}
function isWater(world: VoxelWorld, x: number, y: number, z: number) {
  return blockDef(world, x, y, z)?.fluid === 'water';
}
function dangerous(world: VoxelWorld, x: number, y: number, z: number) {
  if (y < 0 || !world.isLoaded(x, z)) return true;
  const id = world.getBlock(x, y, z);
  return DANGER.has(id) || registry.get(id).fluid === 'lava';
}
/** A body of `height` cells fits with its feet in (x, y, z), and nothing there hurts. */
export function fits(world: VoxelWorld, x: number, y: number, z: number, height: number): boolean {
  for (let dy = 0; dy < height; dy++) {
    if (blocksBody(world, x, y + dy, z)) return false;
    if (dangerous(world, x, y + dy, z)) return false;
  }
  return true;
}
/** Feet may rest here: the body fits and there is a floor, or water to swim in. */
export function standable(
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
  o: Pick<NavOptions, 'height' | 'swim'>,
): boolean {
  if (!fits(world, x, y, z, o.height)) return false;
  if (isWater(world, x, y, z) || isWater(world, x, y - 1, z)) return o.swim;
  if (!blocksBody(world, x, y - 1, z)) return false;
  return !dangerous(world, x, y - 1, z);
}
/** The standable height closest to `y` in a column, searching `span` cells up and down. */
export function groundNear(
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
  o: Pick<NavOptions, 'height' | 'swim'>,
  span = 4,
): number | null {
  for (let d = 0; d <= span; d++) {
    if (standable(world, x, y - d, z, o)) return y - d;
    if (d && standable(world, x, y + d, z, o)) return y + d;
  }
  return null;
}

interface Node {
  x: number;
  y: number;
  z: number;
  g: number;
  f: number;
  parent: Node | null;
  key: number;
  closed: boolean;
  heap: number;
}
const key = (x: number, y: number, z: number) =>
  ((x & 0x3ff) << 20) | ((z & 0x3ff) << 10) | (y & 0x3ff);
class Heap {
  items: Node[] = [];
  push(n: Node) {
    n.heap = this.items.length;
    this.items.push(n);
    this.up(n.heap);
  }
  pop(): Node | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (last && this.items.length) {
      this.items[0] = last;
      last.heap = 0;
      this.down(0);
    }
    return top;
  }
  update(n: Node) {
    this.up(n.heap);
  }
  get size() {
    return this.items.length;
  }
  private up(i: number) {
    const a = this.items;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      a[p].heap = p;
      a[i].heap = i;
      i = p;
    }
  }
  private down(i: number) {
    const a = this.items;
    for (;;) {
      const l = i * 2 + 1,
        r = l + 1;
      let m = i;
      if (l < a.length && a[l].f < a[m].f) m = l;
      if (r < a.length && a[r].f < a[m].f) m = r;
      if (m === i) break;
      [a[m], a[i]] = [a[i], a[m]];
      a[m].heap = m;
      a[i].heap = i;
      i = m;
    }
  }
}
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/**
 * Cells from `start` towards `goal`, excluding the start. When the goal cannot be reached within
 * the budget the path ends at the explored cell closest to it, which is what makes a hunter
 * press against the far side of a river instead of freezing. Returns null when there is no
 * progress to make at all.
 */
export function findPath(
  world: VoxelWorld,
  start: NavPoint,
  goal: NavPoint,
  o: NavOptions,
): NavPoint[] | null {
  const maxNodes = o.maxNodes ?? 600,
    reach = o.reach ?? 0.5;
  const nodes = new Map<number, Node>();
  const heap = new Heap();
  const h = (x: number, y: number, z: number) => {
    const dx = Math.abs(x - goal.x),
      dz = Math.abs(z - goal.z);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz) + Math.abs(y - goal.y) * 0.5;
  };
  const first: Node = {
    ...start,
    g: 0,
    f: h(start.x, start.y, start.z),
    parent: null,
    key: key(start.x, start.y, start.z),
    closed: false,
    heap: 0,
  };
  nodes.set(first.key, first);
  heap.push(first);
  let best = first,
    bestH = first.f,
    expanded = 0;
  const open = (from: Node, x: number, y: number, z: number, cost: number) => {
    const k = key(x, y, z);
    let n = nodes.get(k);
    const g = from.g + cost;
    if (n) {
      if (n.closed || g >= n.g) return;
      n.g = g;
      n.f = g + h(x, y, z);
      n.parent = from;
      heap.update(n);
      return;
    }
    n = { x, y, z, g, f: g + h(x, y, z), parent: from, key: k, closed: false, heap: 0 };
    nodes.set(k, n);
    heap.push(n);
  };
  while (heap.size && expanded < maxNodes) {
    const cur = heap.pop()!;
    if (cur.closed) continue;
    cur.closed = true;
    expanded++;
    const hh = h(cur.x, cur.y, cur.z);
    if (hh < bestH) {
      best = cur;
      bestH = hh;
    }
    if (Math.hypot(cur.x - goal.x, cur.z - goal.z) <= reach && Math.abs(cur.y - goal.y) <= 1) {
      best = cur;
      break;
    }
    for (const [dx, dz] of DIRS) {
      const nx = cur.x + dx,
        nz = cur.z + dz,
        diagonal = dx !== 0 && dz !== 0;
      // A diagonal step may not cut a corner.
      if (
        diagonal &&
        (!fits(world, cur.x + dx, cur.y, cur.z, o.height) ||
          !fits(world, cur.x, cur.y, cur.z + dz, o.height))
      )
        continue;
      const base = diagonal ? Math.SQRT2 : 1;
      const water = (y: number) => (isWater(world, nx, y, nz) ? 1.5 : 0);
      if (standable(world, nx, cur.y, nz, o)) {
        open(cur, nx, cur.y, nz, base + water(cur.y));
        continue;
      }
      // One block up: the target must be free and there must be head room to jump.
      if (
        !diagonal &&
        standable(world, nx, cur.y + 1, nz, o) &&
        fits(world, cur.x, cur.y + o.height, cur.z, 1)
      ) {
        open(cur, nx, cur.y + 1, nz, base + 0.8 + water(cur.y + 1));
        continue;
      }
      // Down a ledge, as far as the creature dares to fall.
      if (!fits(world, nx, cur.y, nz, o.height)) continue;
      for (let d = 1; d <= o.maxDrop + 1; d++) {
        const y = cur.y - d;
        if (y < 0) break;
        if (standable(world, nx, y, nz, o)) {
          if (d <= o.maxDrop) open(cur, nx, y, nz, base + d * 0.4 + water(y));
          break;
        }
        if (blocksBody(world, nx, y, nz) || dangerous(world, nx, y, nz)) break;
        if (isWater(world, nx, y, nz)) break;
      }
    }
  }
  if (best === first) return null;
  const path: NavPoint[] = [];
  for (let n: Node | null = best; n && n !== first; n = n.parent)
    path.push({ x: n.x, y: n.y, z: n.z });
  return path.reverse();
}

/** Clear sight between two points: no collision box of a full or model block in between. */
export function lineOfSight(world: VoxelWorld, from: Vec3, to: Vec3): boolean {
  const dx = to.x - from.x,
    dy = to.y - from.y,
    dz = to.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-6) return true;
  const steps = Math.ceil(length / 0.2);
  let lastX = NaN,
    lastY = NaN,
    lastZ = NaN;
  for (let i = 1; i < steps; i++) {
    const t = i / steps,
      px = from.x + dx * t,
      py = from.y + dy * t,
      pz = from.z + dz * t;
    const x = Math.floor(px),
      y = Math.floor(py),
      z = Math.floor(pz);
    if (x === lastX && y === lastY && z === lastZ) continue;
    lastX = x;
    lastY = y;
    lastZ = z;
    if (!world.isLoaded(x, z)) return false;
    const def = registry.get(world.getBlock(x, y, z));
    if (!def.solid && !def.model) continue;
    const fx = px - x,
      fy = py - y,
      fz = pz - z;
    for (const b of cellBoxes(world, x, y, z))
      if (fx >= b[0] && fx <= b[3] && fy >= b[1] && fy <= b[4] && fz >= b[2] && fz <= b[5])
        return false;
  }
  return true;
}
