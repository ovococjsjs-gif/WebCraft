/**
 * Shared collision against the voxel world. Full cubes collide as unit boxes; slabs, stairs,
 * fences, panes, doors and snow layers collide with the boxes of their model. The player, item
 * drops and creatures all use this module, so a fence stops all of them the same way.
 */
import { blockBoxes, registry } from '../../content/src/blocks';
import { MAX_COLLISION_HEIGHT, type Box } from '../../content/src/shapes';
import type { VoxelWorld } from './world';

export interface Aabb {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}
const EPS = 1e-7;
const FULL: readonly Box[] = [[0, 0, 0, 1, 1, 1]];
const NONE: readonly Box[] = [];
/** Collision boxes of one cell, in cell-local coordinates. Unloaded columns are solid walls. */
export function cellBoxes(world: VoxelWorld, x: number, y: number, z: number): readonly Box[] {
  if (y < 0) return NONE;
  if (!world.isLoaded(x, z)) return FULL;
  const state = world.getBlock(x, y, z);
  const def = registry.get(state);
  if (!def.model) return def.solid ? FULL : NONE;
  return blockBoxes(state, (bx, by, bz) => world.getBlock(bx, by, bz), x, y, z, 'collision');
}
/** Visits every cell whose boxes could reach into the region, including tall fences below. */
function forCells(box: Aabb, visit: (x: number, y: number, z: number) => boolean | void): void {
  const reach = Math.ceil(MAX_COLLISION_HEIGHT - 1);
  for (let x = Math.floor(box.minX + EPS); x <= Math.floor(box.maxX - EPS); x++)
    for (let y = Math.floor(box.minY + EPS) - reach; y <= Math.floor(box.maxY - EPS); y++)
      for (let z = Math.floor(box.minZ + EPS); z <= Math.floor(box.maxZ - EPS); z++)
        if (visit(x, y, z) === true) return;
}
/** Whether an axis-aligned box intersects any collision box of the world. */
export function boxHitsWorld(world: VoxelWorld, box: Aabb): boolean {
  let hit = false;
  forCells(box, (x, y, z) => {
    for (const b of cellBoxes(world, x, y, z))
      if (
        box.maxX > x + b[0] + EPS &&
        box.minX < x + b[3] - EPS &&
        box.maxY > y + b[1] + EPS &&
        box.minY < y + b[4] - EPS &&
        box.maxZ > z + b[2] + EPS &&
        box.minZ < z + b[5] - EPS
      ) {
        hit = true;
        return true;
      }
    return false;
  });
  return hit;
}
/** A body standing on `position` with the given width and height, as a box. */
export function bodyBox(
  position: { x: number; y: number; z: number },
  width: number,
  height: number,
): Aabb {
  const half = width / 2;
  return {
    minX: position.x - half,
    minY: position.y,
    minZ: position.z - half,
    maxX: position.x + half,
    maxY: position.y + height,
    maxZ: position.z + half,
  };
}
const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;
/**
 * How far a box can travel along one axis before touching the world, never more than `amount`.
 * This is the sweep of the reference: other axes must already be resolved.
 */
export function sweepAxis(
  world: VoxelWorld,
  box: Aabb,
  axis: 'x' | 'y' | 'z',
  amount: number,
): number {
  if (Math.abs(amount) < EPS) return 0;
  const query: Aabb = { ...box };
  const a = AXIS_INDEX[axis];
  const minKey = (['minX', 'minY', 'minZ'] as const)[a],
    maxKey = (['maxX', 'maxY', 'maxZ'] as const)[a];
  if (amount < 0) query[minKey] += amount;
  else query[maxKey] += amount;
  let allowed = amount;
  forCells(query, (x, y, z) => {
    const origin = [x, y, z];
    for (const b of cellBoxes(world, x, y, z)) {
      let overlap = true;
      for (let other = 0; other < 3; other++) {
        if (other === a) continue;
        const lo = origin[other] + b[other],
          hi = origin[other] + b[other + 3];
        const bMin = box[(['minX', 'minY', 'minZ'] as const)[other]],
          bMax = box[(['maxX', 'maxY', 'maxZ'] as const)[other]];
        if (bMax <= lo + EPS || bMin >= hi - EPS) {
          overlap = false;
          break;
        }
      }
      if (!overlap) continue;
      const lo = origin[a] + b[a],
        hi = origin[a] + b[a + 3];
      if (amount > 0 && box[maxKey] <= lo + EPS) allowed = Math.min(allowed, lo - box[maxKey]);
      if (amount < 0 && box[minKey] >= hi - EPS) allowed = Math.max(allowed, hi - box[minKey]);
    }
  });
  return allowed;
}
/** Whether a point is inside a collision box: item drops use points instead of bodies. */
export function pointInWorld(world: VoxelWorld, x: number, y: number, z: number): boolean {
  const cx = Math.floor(x),
    cy = Math.floor(y),
    cz = Math.floor(z);
  for (let dy = 0; dy <= Math.ceil(MAX_COLLISION_HEIGHT - 1); dy++)
    for (const b of cellBoxes(world, cx, cy - dy, cz)) {
      const lx = x - cx,
        ly = y - (cy - dy),
        lz = z - cz;
      if (lx >= b[0] && lx < b[3] && ly >= b[1] && ly < b[4] && lz >= b[2] && lz < b[5])
        return true;
    }
  return false;
}
