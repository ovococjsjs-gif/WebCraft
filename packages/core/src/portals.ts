/**
 * The two portals.
 *
 * A Nether portal is built by the player: a frame of obsidian with an opening inside, lit with
 * flint and steel. Standing in the portal block for four seconds carries the player to the other
 * dimension, where the same portal is either found or built. An End portal is found, not built:
 * twelve frames in a stronghold, each one fitted with an eye of ender, and the middle turns into
 * the portal once the last eye is in place.
 */
import { BLOCK, registry } from '../../content/src/blocks';
import type { VoxelWorld } from './world';
import { PORTAL_SEARCH_RADIUS, type DimensionId } from './dimensions';
import { netherFloorAt } from './nether';
import { END_FOUNTAIN } from './end';

/** Opening of a Nether portal: two to four blocks wide, three to five high. */
export const PORTAL_MIN_WIDTH = 2;
export const PORTAL_MAX_WIDTH = 4;
export const PORTAL_MIN_HEIGHT = 3;
export const PORTAL_MAX_HEIGHT = 5;
export interface PortalFrame {
  /** Bottom left corner of the opening, in world coordinates. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  /** The frame runs along x (axis 0) or along z (axis 1). */
  readonly axis: 0 | 1;
}
function isObsidian(world: VoxelWorld, x: number, y: number, z: number): boolean {
  return world.getBlock(x, y, z) === BLOCK.OBSIDIAN;
}
function isPortal(world: VoxelWorld, x: number, y: number, z: number): boolean {
  return world.getBlock(x, y, z) === BLOCK.NETHER_PORTAL;
}
function isOpen(world: VoxelWorld, x: number, y: number, z: number): boolean {
  const state = world.getBlock(x, y, z);
  return state === BLOCK.AIR || state === BLOCK.NETHER_PORTAL;
}
/**
 * Tries to read a portal frame whose opening contains the given block. The four corners of the
 * frame do not have to be obsidian, exactly as in the reference: a frame missing its corners
 * still lights.
 */
export function readPortalFrame(
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
): PortalFrame | undefined {
  for (const axis of [0, 1] as const) {
    const dx = axis === 0 ? 0 : 1,
      dz = axis === 0 ? 1 : 0;
    for (let width = PORTAL_MIN_WIDTH; width <= PORTAL_MAX_WIDTH; width++)
      for (let height = PORTAL_MIN_HEIGHT; height <= PORTAL_MAX_HEIGHT; height++)
        for (let ox = 0; ox < width; ox++)
          for (let oy = 0; oy < height; oy++) {
            const bx = x - dx * ox,
              by = y - oy,
              bz = z - dz * ox;
            const frame: PortalFrame = { x: bx, y: by, z: bz, width, height, axis };
            if (frameIsValid(world, frame)) return frame;
          }
  }
  return undefined;
}
function frameIsValid(world: VoxelWorld, frame: PortalFrame): boolean {
  const { x, y, z, width, height, axis } = frame;
  const dx = axis === 0 ? 0 : 1,
    dz = axis === 0 ? 1 : 0;
  for (let ox = 0; ox < width; ox++)
    for (let oy = 0; oy < height; oy++)
      if (!isOpen(world, x + dx * ox, y + oy, z + dz * ox)) return false;
  // Below and above every column of the opening, and beside every row: obsidian.
  for (let ox = 0; ox < width; ox++) {
    if (!isObsidian(world, x + dx * ox, y - 1, z + dz * ox)) return false;
    if (!isObsidian(world, x + dx * ox, y + height, z + dz * ox)) return false;
  }
  for (let oy = 0; oy < height; oy++) {
    if (!isObsidian(world, x - dx, y + oy, z - dz)) return false;
    if (!isObsidian(world, x + dx * width, y + oy, z + dz * width)) return false;
  }
  return true;
}
/**
 * Offsets around the block a player touched, tried in turn: flint and steel is used on the bottom
 * obsidian as often as on the frame beside it, and the opening may start either way.
 */
const PORTAL_TOUCH_OFFSETS = [
  [0, 0, 0],
  [0, 1, 0],
  [0, 2, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [1, 1, 0],
  [-1, 1, 0],
  [0, 1, 1],
  [0, 1, -1],
] as const;
/** Lights the frame a player touched with flint and steel, if the blocks around it form one. */
export function lightPortalNear(
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
): PortalFrame | undefined {
  for (const [ox, oy, oz] of PORTAL_TOUCH_OFFSETS) {
    const frame = readPortalFrame(world, x + ox, y + oy, z + oz);
    if (!frame) continue;
    lightPortal(world, frame);
    return frame;
  }
  return undefined;
}
/** Lights the frame: every block of the opening becomes a portal. Returns how many were placed. */
export function lightPortal(world: VoxelWorld, frame: PortalFrame): number {
  const dx = frame.axis === 0 ? 0 : 1,
    dz = frame.axis === 0 ? 1 : 0;
  let placed = 0;
  for (let ox = 0; ox < frame.width; ox++)
    for (let oy = 0; oy < frame.height; oy++) {
      const bx = frame.x + dx * ox,
        by = frame.y + oy,
        bz = frame.z + dz * ox;
      if (!isOpen(world, bx, by, bz)) continue;
      if (world.setBlock(bx, by, bz, BLOCK.NETHER_PORTAL)) placed++;
    }
  return placed;
}
/** Builds a fresh lit portal at a spot, used when the destination has no partner portal yet. */
export function buildNetherPortal(
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
  axis: 0 | 1 = 0,
): PortalFrame {
  const dx = axis === 0 ? 0 : 1,
    dz = axis === 0 ? 1 : 0;
  const width = 2,
    height = 3;
  for (let ox = -1; ox <= width; ox++)
    for (let oy = -1; oy <= height; oy++) {
      const bx = x + dx * ox,
        by = y + oy,
        bz = z + dz * ox;
      const frame = ox === -1 || ox === width || oy === -1 || oy === height;
      // The corners stay open, as a hand-built portal usually has them.
      const corner = (ox === -1 || ox === width) && (oy === -1 || oy === height);
      world.setBlock(bx, by, bz, corner ? BLOCK.AIR : frame ? BLOCK.OBSIDIAN : BLOCK.AIR);
    }
  // A platform of netherrack, so the portal never hangs in the air.
  for (let ox = -2; ox <= width + 1; ox++)
    for (let oz = -2; oz <= 2; oz++) {
      const bx = x + dx * ox + dz * oz,
        bz = z + dz * ox + dx * oz;
      for (let oy = -1; oy >= -3; oy--) {
        const by = y + oy;
        if (registry.get(world.getBlock(bx, by, bz)).solid) break;
        world.setBlock(bx, by, bz, BLOCK.NETHERRACK);
      }
    }
  const frame: PortalFrame = { x, y, z, width, height, axis };
  lightPortal(world, frame);
  return frame;
}
/** A portal the caller already knows about, so a partner is never missed by the scan. */
export interface PortalPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
/** Asks the caller for the portals it has recorded near a point. */
export type PortalLookup = (x: number, z: number, radius: number) => readonly PortalPoint[];
/**
 * The partner portal nearest to a point. Portals the world already knows about (every portal
 * block is a block edit, so the session keeps a list) are checked first: the coarse scan below
 * only samples every fourth block and would miss a hand-built frame often enough to matter.
 */
export function findPortalNear(
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
  radius = PORTAL_SEARCH_RADIUS,
  known?: PortalLookup,
): PortalPoint | undefined {
  let best: { x: number; y: number; z: number; score: number } | undefined;
  if (known)
    for (const portal of known(x, z, radius)) {
      if (!isPortal(world, portal.x, portal.y, portal.z)) continue;
      const score = Math.hypot(portal.x - x, portal.z - z);
      if (!best || score < best.score) best = { ...portal, score };
    }
  if (best) return { x: best.x, y: best.y, z: best.z };
  const cx = Math.floor(x),
    cz = Math.floor(z);
  for (let ox = -radius; ox <= radius; ox += 4)
    for (let oz = -radius; oz <= radius; oz += 4) {
      const distance = Math.hypot(ox, oz);
      if (distance > radius) continue;
      if (!world.isLoaded(cx + ox, cz + oz)) continue;
      for (let scan = 0; scan < 8; scan++) {
        const by = Math.min(120, Math.max(3, Math.round(y) + scan * 12));
        if (isPortal(world, cx + ox, by, cz + oz))
          if (!best || distance < best.score)
            best = { x: cx + ox, y: by, z: cz + oz, score: distance };
      }
      // A coarser sweep finds portals that sit further from the arrival height.
      for (let by = 4; by < 120; by += 4)
        if (isPortal(world, cx + ox, by, cz + oz))
          if (!best || distance < best.score)
            best = { x: cx + ox, y: by, z: cz + oz, score: distance };
    }
  return best ? { x: best.x, y: best.y, z: best.z } : undefined;
}
export interface Arrival {
  readonly position: { x: number; y: number; z: number };
  /** True when the arrival portal had to be built. */
  readonly built: boolean;
}
/**
 * Where a traveller arrives in the Nether: at a partner portal if one is close enough, otherwise
 * on a portal built on the nether floor nearest to the preferred height.
 */
export function netherArrival(
  world: VoxelWorld,
  seedText: string,
  x: number,
  preferredY: number,
  z: number,
  known?: PortalLookup,
): Arrival {
  const existing = findPortalNear(world, x, preferredY, z, PORTAL_SEARCH_RADIUS, known);
  if (existing)
    return {
      position: { x: existing.x + 0.5, y: existing.y + 0.1, z: existing.z + 0.5 },
      built: false,
    };
  const clamp = Math.min(110, Math.max(34, Math.round(preferredY)));
  let floor = netherFloorAt(Math.round(x), Math.round(z), seedText);
  if (Math.abs(floor - clamp) > 24) floor = Math.min(110, Math.max(34, floor));
  buildNetherPortal(world, Math.round(x), floor + 1, Math.round(z), 0);
  return {
    position: { x: Math.round(x) + 0.5, y: floor + 1.1, z: Math.round(z) + 0.5 },
    built: true,
  };
}
/** The Overworld end of a Nether trip: an existing portal, or a new one on the surface. */
export function overworldArrival(
  world: VoxelWorld,
  x: number,
  z: number,
  surfaceHeight: number,
  known?: PortalLookup,
): Arrival {
  const existing = findPortalNear(world, x, surfaceHeight, z, PORTAL_SEARCH_RADIUS, known);
  if (existing)
    return {
      position: { x: existing.x + 0.5, y: existing.y + 0.1, z: existing.z + 0.5 },
      built: false,
    };
  const bx = Math.round(x),
    bz = Math.round(z);
  const y = Math.max(4, Math.min(200, Math.round(surfaceHeight) + 1));
  buildNetherPortal(world, bx, y, bz, 0);
  return { position: { x: bx + 0.5, y: y + 0.1, z: bz + 0.5 }, built: true };
}
/** True when the block is a portal of the given dimension. */
export function isPortalBlock(dimension: DimensionId, state: number): boolean {
  if (dimension === 'nether' || dimension === 'overworld') return state === BLOCK.NETHER_PORTAL;
  return state === BLOCK.END_PORTAL;
}
/* --------------------------------------------------------------- the End portal */
/**
 * The twelve frames of an End portal: the edge of a five-by-five square without its corners, so
 * the middle three-by-three is the portal itself.
 */
export const END_FRAME_RING = [
  [2, -2],
  [2, -1],
  [2, 0],
  [2, 1],
  [2, 2],
  [1, 2],
  [0, 2],
  [-1, 2],
  [-2, 2],
  [-2, 1],
  [-2, 0],
  [-2, -1],
] as const;
/** The corners never hold a frame, so a full ring is these twelve cells. */
export const END_FRAME_COUNT = 12;
/** Where the portal itself opens: the three-by-three square inside the ring. */
export const END_PORTAL_INNER = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [0, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;
export function isEndFrameState(state: number): boolean {
  return state === BLOCK.END_PORTAL_FRAME || state === BLOCK.END_PORTAL_FRAME_EYE;
}
/** Fits an eye into a frame. Returns false when the block is not an empty frame. */
export function fitEye(world: VoxelWorld, x: number, y: number, z: number): boolean {
  if (world.getBlock(x, y, z) !== BLOCK.END_PORTAL_FRAME) return false;
  return world.setBlock(x, y, z, BLOCK.END_PORTAL_FRAME_EYE);
}
/** True when every frame of the ring around the point already carries an eye. */
export function endPortalComplete(world: VoxelWorld, x: number, y: number, z: number): boolean {
  let frames = 0,
    eyes = 0;
  for (const [dx, dz] of END_FRAME_RING) {
    const state = world.getBlock(x + dx, y, z + dz);
    if (!isEndFrameState(state)) continue;
    frames++;
    if (state === BLOCK.END_PORTAL_FRAME_EYE) eyes++;
  }
  return frames >= END_FRAME_COUNT && eyes >= END_FRAME_COUNT;
}
/** Opens the portal inside a completed ring. Returns how many portal blocks appeared. */
export function openEndPortal(world: VoxelWorld, x: number, y: number, z: number): number {
  let placed = 0;
  for (const [dx, dz] of END_PORTAL_INNER)
    if (world.setBlock(x + dx, y, z + dz, BLOCK.END_PORTAL)) placed++;
  for (const [dx, dz] of END_PORTAL_INNER) {
    for (const dy of [1, 2, 3]) world.setBlock(x + dx, y + dy, z + dz, BLOCK.AIR);
  }
  return placed;
}
/**
 * The block the compiler uses to count portal blocks: exposed so tests can prove a portal was
 * built without reaching into the world twice.
 */
export function portalBlockCount(
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
  radius: number,
): number {
  let count = 0;
  for (let ox = -radius; ox <= radius; ox++)
    for (let oy = -radius; oy <= radius; oy++)
      for (let oz = -radius; oz <= radius; oz++)
        if (world.getBlock(x + ox, y + oy, z + oz) === BLOCK.NETHER_PORTAL) count++;
  return count;
}
/** How far the arrival platform stands from the middle of the End island. */
export const END_PLATFORM = { x: 12, z: 0, radius: 3 } as const;
/** Builds the small obsidian platform a traveller steps onto when arriving in the End. */
export function buildEndPlatform(world: VoxelWorld): { x: number; y: number; z: number } {
  let surface = 0;
  for (let y = 200; y > 0; y--)
    if (registry.get(world.getBlock(END_PLATFORM.x, y, END_PLATFORM.z)).solid) {
      surface = y;
      break;
    }
  const y = Math.max(surface + 1, 50);
  for (let ox = -END_PLATFORM.radius; ox <= END_PLATFORM.radius; ox++)
    for (let oz = -END_PLATFORM.radius; oz <= END_PLATFORM.radius; oz++) {
      world.setBlock(END_PLATFORM.x + ox, y, END_PLATFORM.z + oz, BLOCK.OBSIDIAN);
      for (let oy = 1; oy <= 3; oy++)
        world.setBlock(END_PLATFORM.x + ox, y + oy, END_PLATFORM.z + oz, BLOCK.AIR);
    }
  return { x: END_PLATFORM.x + 0.5, y: y + 1.1, z: END_PLATFORM.z + 0.5 };
}
/**
 * The exit portal of the End, built when the dragon dies: a ring of bedrock around the fountain
 * with the three-by-three portal inside. Stepping in carries the player home.
 */
export function buildExitPortal(world: VoxelWorld): { x: number; y: number; z: number } {
  const { x, y, z } = END_FOUNTAIN;
  for (let ox = -3; ox <= 3; ox++)
    for (let oz = -3; oz <= 3; oz++) {
      if (Math.max(Math.abs(ox), Math.abs(oz)) !== 3) continue;
      const corner = Math.abs(ox) === 3 && Math.abs(oz) === 3;
      world.setBlock(x + ox, y, z + oz, corner ? BLOCK.AIR : BLOCK.BEDROCK);
    }
  for (const [dx, dz] of END_PORTAL_INNER) {
    world.setBlock(x + dx, y, z + dz, BLOCK.END_PORTAL);
    for (const oy of [1, 2, 3]) world.setBlock(x + dx, y + oy, z + dz, BLOCK.AIR);
  }
  return { x: x + 0.5, y: y + 0.1, z: z + 0.5 };
}
/** Where the player stands after beating the dragon and stepping into the exit portal. */
export function exitPortalSpot(): { x: number; y: number; z: number } {
  return { x: 0.5, y: 66.1, z: 0.5 };
}
