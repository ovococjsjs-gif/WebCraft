import { BLOCK, blockBoxes, registry } from '../../content/src/blocks';
import type { Box } from '../../content/src/shapes';
import type { Vec3 } from './coordinates';
import type { VoxelWorld } from './world';
export interface BlockHit {
  x: number;
  y: number;
  z: number;
  normal: Vec3;
  distance: number;
  state: number;
  /** Where the ray met the block; placement reads the upper or lower half from it. */
  point?: Vec3;
}
export function raycast(
  world: VoxelWorld,
  origin: Vec3,
  direction: Vec3,
  maxDistance = 6,
  /**
   * Fluids never stop the ray, as in the reference: the crosshair passes through water and
   * lava to the block behind. An empty bucket asks for 'sources' and stops at still fluid.
   */
  fluids: 'none' | 'sources' = 'none',
): BlockHit | null {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (
    !Number.isFinite(length) ||
    length < 1e-10 ||
    !Number.isFinite(maxDistance) ||
    maxDistance < 0
  )
    return null;
  const d = { x: direction.x / length, y: direction.y / length, z: direction.z / length };
  let x = Math.floor(origin.x),
    y = Math.floor(origin.y),
    z = Math.floor(origin.z);
  const sx = Math.sign(d.x),
    sy = Math.sign(d.y),
    sz = Math.sign(d.z);
  const dx = d.x === 0 ? Infinity : Math.abs(1 / d.x),
    dy = d.y === 0 ? Infinity : Math.abs(1 / d.y),
    dz = d.z === 0 ? Infinity : Math.abs(1 / d.z);
  let tx = d.x === 0 ? Infinity : ((sx > 0 ? x + 1 : x) - origin.x) / d.x;
  let ty = d.y === 0 ? Infinity : ((sy > 0 ? y + 1 : y) - origin.y) / d.y;
  let tz = d.z === 0 ? Infinity : ((sz > 0 ? z + 1 : z) - origin.z) / d.z;
  let distance = 0,
    normal: Vec3 = { x: 0, y: 0, z: 0 };
  while (distance <= maxDistance) {
    const state = world.getBlock(x, y, z);
    const fluid = state !== BLOCK.AIR && registry.has(state) && registry.get(state).fluid;
    const skip = fluid && !(fluids === 'sources' && registry.get(state).fluidSource);
    if (state !== BLOCK.AIR && !skip && registry.has(state)) {
      const at = (t: number): Vec3 => ({
        x: origin.x + d.x * t,
        y: origin.y + d.y * t,
        z: origin.z + d.z * t,
      });
      if (!registry.get(state).model)
        return { x, y, z, state, normal, distance, point: at(distance) };
      // Partial blocks are hit on their boxes: the ray passes over a slab or through a doorway.
      const boxes = blockBoxes(
        state,
        (bx, by, bz) => world.getBlock(bx, by, bz),
        x,
        y,
        z,
        'render',
      );
      const hit = rayBoxes(origin, d, x, y, z, boxes);
      if (hit && hit.distance <= maxDistance)
        return {
          x,
          y,
          z,
          state,
          normal: hit.normal,
          distance: hit.distance,
          point: at(hit.distance),
        };
    }
    if (tx <= ty && tx <= tz) {
      x += sx;
      distance = tx;
      tx += dx;
      normal = { x: -sx, y: 0, z: 0 };
    } else if (ty <= tz) {
      y += sy;
      distance = ty;
      ty += dy;
      normal = { x: 0, y: -sy, z: 0 };
    } else {
      z += sz;
      distance = tz;
      tz += dz;
      normal = { x: 0, y: 0, z: -sz };
    }
  }
  return null;
}
export function lookDirection(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}
/** Nearest entry of a ray into a set of cell-local boxes (slab method). */
function rayBoxes(
  origin: Vec3,
  d: Vec3,
  cx: number,
  cy: number,
  cz: number,
  boxes: readonly Box[],
): { distance: number; normal: Vec3 } | null {
  let best: { distance: number; normal: Vec3 } | null = null;
  const o = [origin.x - cx, origin.y - cy, origin.z - cz],
    dir = [d.x, d.y, d.z];
  for (const box of boxes) {
    let near = -Infinity,
      far = Infinity,
      axis = -1;
    let inside = true;
    for (let a = 0; a < 3; a++) {
      const lo = box[a],
        hi = box[a + 3];
      if (Math.abs(dir[a]) < 1e-12) {
        if (o[a] < lo || o[a] > hi) inside = false;
        continue;
      }
      let t0 = (lo - o[a]) / dir[a],
        t1 = (hi - o[a]) / dir[a];
      if (t0 > t1) [t0, t1] = [t1, t0];
      if (t0 > near) {
        near = t0;
        axis = a;
      }
      far = Math.min(far, t1);
    }
    if (!inside || near > far || far < 0) continue;
    const distance = Math.max(0, near);
    if (best && best.distance <= distance) continue;
    const normal = { x: 0, y: 0, z: 0 };
    if (axis >= 0) normal[(['x', 'y', 'z'] as const)[axis]] = -Math.sign(dir[axis]);
    best = { distance, normal };
  }
  return best;
}
