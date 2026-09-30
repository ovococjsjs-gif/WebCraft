import { registry } from '../../content/src/blocks';
import type { VoxelWorld } from './world';
import type { Vec3 } from './coordinates';

/** Storage limits are not colliders. A spawn needs actual support and two clear body cells. */
export function safeStanding(world: VoxelWorld, at: Vec3): boolean {
  const x = Math.floor(at.x),
    y = Math.floor(at.y),
    z = Math.floor(at.z);
  if (y < 1 || y > 253 || !world.isLoaded(x, z)) return false;
  const floor = registry.get(world.getBlock(x, y - 1, z));
  if (!floor.solid || floor.fluid || floor.key.includes('cactus') || floor.key.includes('magma'))
    return false;
  for (let yy = y; yy <= Math.floor(at.y + 1.79); yy++) {
    const def = registry.get(world.getBlock(x, yy, z));
    if (def.solid || def.fluid || def.key.includes('fire')) return false;
  }
  return true;
}
export function findSafeSpawn(world: VoxelWorld, preferred: Vec3): Vec3 | undefined {
  if (safeStanding(world, preferred)) return { ...preferred };
  const bx = Math.floor(preferred.x),
    bz = Math.floor(preferred.z);
  for (let radius = 0; radius <= 4; radius++)
    for (let dx = -radius; dx <= radius; dx++)
      for (let dz = -radius; dz <= radius; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        for (let dy = 0; dy <= 5; dy++)
          for (const direction of dy ? [1, -1] : [1]) {
            const point = {
              x: bx + dx + 0.5,
              y: Math.floor(preferred.y) + dy * direction + 0.01,
              z: bz + dz + 0.5,
            };
            if (safeStanding(world, point)) return point;
          }
      }
  for (let y = 252; y >= 1; y--) {
    const point = { x: bx + 0.5, y: y + 0.01, z: bz + 0.5 };
    if (safeStanding(world, point)) return point;
  }
  return undefined;
}
