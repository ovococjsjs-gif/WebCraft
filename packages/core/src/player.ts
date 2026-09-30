import { registry } from '../../content/src/blocks';
import type { Vec3 } from './coordinates';
import type { VoxelWorld } from './world';
import { bodyBox, boxHitsWorld, sweepAxis, type Aabb } from './collision';
export const PLAYER_HALF = 0.3,
  PLAYER_HEIGHT = 1.8,
  EYE_HEIGHT = 1.62;
export interface PlayerInput {
  forward: number;
  strafe: number;
  jump: boolean;
  crouch: boolean;
  sprint: boolean;
  yaw: number;
  pitch: number;
}
export const EMPTY_INPUT: PlayerInput = {
  forward: 0,
  strafe: 0,
  jump: false,
  crouch: false,
  sprint: false,
  yaw: 0,
  pitch: 0,
};
export interface PlayerState {
  position: Vec3;
  velocity: Vec3;
  onGround: boolean;
  flying: boolean;
  inWater: boolean;
}
/** What the status effects do to a body this tick; all optional, all zero by default. */
export interface BodyMods {
  /** Jump boost level: every level adds about a block to the height of a jump. */
  jumpBoost?: number;
  /** Levitation level: the body rises a block a second per level, gravity forgotten. */
  levitation?: number;
  /** Slow falling: the fall never gets faster than a gentle drift. */
  slowFalling?: boolean;
  /**
   * Output: set by `tickPlayer` for the tick a body was thrown back up by slime. It lives here and
   * not on the player, because the player's fields are exactly what a save file stores.
   */
  bounced?: boolean;
}
/** Speed of the drift down under slow falling, in blocks per second. */
export const SLOW_FALL_SPEED = 1.6;
/** Fraction of the landing speed a body keeps when it bounces off slime. */
export const SLIME_BOUNCE = 0.8;
export function createPlayer(position: Vec3): PlayerState {
  return {
    position: { ...position },
    velocity: { x: 0, y: 0, z: 0 },
    onGround: false,
    flying: false,
    inWater: false,
  };
}
export function sanitizeInput(input: PlayerInput): PlayerInput {
  const finite = (v: number) => (Number.isFinite(v) ? v : 0);
  return {
    forward: Math.max(-1, Math.min(1, finite(input.forward))),
    strafe: Math.max(-1, Math.min(1, finite(input.strafe))),
    yaw: finite(input.yaw),
    pitch: Math.max(-1.55, Math.min(1.55, finite(input.pitch))),
    jump: !!input.jump,
    crouch: !!input.crouch,
    sprint: !!input.sprint,
  };
}
const EPS = 1e-7;
export function playerOverlapsBlock(player: PlayerState, x: number, y: number, z: number): boolean {
  const p = player.position;
  return (
    p.x + PLAYER_HALF > x + EPS &&
    p.x - PLAYER_HALF < x + 1 - EPS &&
    p.z + PLAYER_HALF > z + EPS &&
    p.z - PLAYER_HALF < z + 1 - EPS &&
    p.y + PLAYER_HEIGHT > y + EPS &&
    p.y < y + 1 - EPS
  );
}
function playerBox(p: Vec3): Aabb {
  return bodyBox(p, PLAYER_HALF * 2, PLAYER_HEIGHT);
}
function moveAxis(world: VoxelWorld, p: Vec3, axis: 'x' | 'y' | 'z', amount: number): number {
  const allowed = sweepAxis(world, playerBox(p), axis, amount);
  p[axis] += allowed;
  return allowed;
}
function supported(world: VoxelWorld, p: Vec3, dx: number, dz: number): boolean {
  return boxHitsWorld(world, {
    minX: p.x + dx - 0.28,
    minY: p.y - 0.08,
    minZ: p.z + dz - 0.28,
    maxX: p.x + dx + 0.28,
    maxY: p.y - 0.01,
    maxZ: p.z + dz + 0.28,
  });
}
/** Height a walking player climbs without jumping: slabs, stairs, snow and path edges. */
export const PLAYER_STEP_HEIGHT = 0.6;
/** Forward kick of a sprint jump, blocks per second (the reference's 0.2 per tick, eased). */
export const SPRINT_JUMP_BOOST = 3;
/**
 * Prototype controller; vanilla friction/edge cases are not yet certified.
 * Returns whether a wall stopped the horizontal move (it ends a sprint).
 */
/** A ladder in the cell of the feet or of the body's middle. */
export function onLadder(world: VoxelWorld, p: { x: number; y: number; z: number }): boolean {
  const x = Math.floor(p.x),
    z = Math.floor(p.z);
  for (const dy of [0.05, 0.9]) {
    const state = world.getBlock(x, Math.floor(p.y + dy), z);
    if (state && registry.get(state).climbable) return true;
  }
  return false;
}
export function tickPlayer(
  world: VoxelWorld,
  player: PlayerState,
  input: PlayerInput,
  speedScale = 1,
  mods: BodyMods = {},
): boolean {
  const p = player.position,
    v = player.velocity,
    dt = 0.05;
  mods.bounced = false;
  player.inWater =
    registry.get(world.getBlock(Math.floor(p.x), Math.floor(p.y + 0.5), Math.floor(p.z))).fluid ===
    'water';
  const speed =
    (player.flying
      ? input.sprint
        ? 13
        : 8
      : player.inWater
        ? 2.4
        : input.crouch
          ? 1.4
          : input.sprint
            ? 5.65
            : 4.3) * Math.max(0, speedScale);
  const len = Math.max(1, Math.hypot(input.forward, input.strafe));
  const tx =
    ((-Math.sin(input.yaw) * input.forward + Math.cos(input.yaw) * input.strafe) / len) * speed;
  const tz =
    ((-Math.cos(input.yaw) * input.forward - Math.sin(input.yaw) * input.strafe) / len) * speed;
  const acceleration = player.flying ? 0.65 : player.onGround ? 0.7 : 0.22;
  const airborne = !player.flying && !player.onGround && !player.inWater;
  const current = Math.hypot(v.x, v.z),
    wanted = Math.hypot(tx, tz);
  if (airborne && wanted > 0 && current > wanted && v.x * tx + v.z * tz > 0) {
    // Momentum carries a sprint jump: in the air a faster-than-walking body only slowly sheds
    // the extra speed while steering, instead of being clamped back to the walking target.
    const keep = 0.97 * (1 - acceleration * 0.35);
    v.x = v.x * keep + tx * (1 - keep);
    v.z = v.z * keep + tz * (1 - keep);
  } else {
    v.x += (tx - v.x) * acceleration;
    v.z += (tz - v.z) * acceleration;
  }
  // Exponential drag otherwise leaves subnormal velocities long after position has stopped.
  // Those invisible values must not keep an idle world's persistence stamp changing forever.
  if (Math.abs(v.x) < 1e-7) v.x = 0;
  if (Math.abs(v.z) < 1e-7) v.z = 0;
  if (player.flying) {
    v.y = (Number(input.jump) - Number(input.crouch)) * speed;
  } else if (player.inWater) {
    v.y = Math.max(-2, v.y - 4 * dt);
    if (input.jump) v.y = 3.6;
  } else {
    if (input.jump && player.onGround) {
      v.y = 9 + 1.9 * (mods.jumpBoost ?? 0);
      if (input.sprint && input.forward > 0) {
        v.x -= Math.sin(input.yaw) * SPRINT_JUMP_BOOST;
        v.z -= Math.cos(input.yaw) * SPRINT_JUMP_BOOST;
      }
    }
    if (mods.levitation) v.y += (mods.levitation - v.y) * 0.2;
    else v.y = Math.max(-55, v.y - 32 * dt);
    if (mods.slowFalling && !mods.levitation) v.y = Math.max(v.y, -SLOW_FALL_SPEED);
  }
  let dx = v.x * dt,
    dz = v.z * dt;
  if (input.crouch && player.onGround && !player.flying) {
    for (let i = 0; i < 8 && !supported(world, p, dx, 0); i++) dx *= 0.5;
    if (!supported(world, p, dx, 0)) dx = 0;
    for (let i = 0; i < 8 && !supported(world, p, dx, dz); i++) dz *= 0.5;
    if (!supported(world, p, dx, dz)) dz = 0;
  }
  const start = { x: p.x, y: p.y, z: p.z };
  let actualX = moveAxis(world, p, 'x', dx);
  let actualZ = moveAxis(world, p, 'z', dz);
  const blocked = Math.abs(actualX - dx) > EPS || Math.abs(actualZ - dz) > EPS;
  if (blocked && player.onGround && !player.flying && v.y <= 0) {
    // Try the same move from half a block higher, then settle down again: stairs and slabs are
    // walked up, a full block still needs a jump.
    const alt = { ...start };
    const up = moveAxis(world, alt, 'y', PLAYER_STEP_HEIGHT);
    const altX = moveAxis(world, alt, 'x', dx);
    const altZ = moveAxis(world, alt, 'z', dz);
    moveAxis(world, alt, 'y', -up);
    if (altX * altX + altZ * altZ > actualX * actualX + actualZ * actualZ + EPS) {
      p.x = alt.x;
      p.y = alt.y;
      p.z = alt.z;
      actualX = altX;
      actualZ = altZ;
    }
  }
  const wet =
    player.inWater ||
    registry.get(world.getBlock(Math.floor(p.x), Math.floor(p.y + 0.05), Math.floor(p.z))).fluid ===
      'water';
  if (
    blocked &&
    wet &&
    !player.flying &&
    (input.forward !== 0 || input.strafe !== 0) &&
    (input.jump || !player.onGround)
  ) {
    // Swimming into a bank: find the smallest lift from which the move succeeds (a shore up to
    // one block above the surface, never a two-block wall) and kick up just enough to land on it,
    // instead of bobbing against the edge forever.
    for (let lift = 0.25; lift <= 1.35 + EPS; lift += 0.1) {
      const alt = { ...start };
      const up = moveAxis(world, alt, 'y', lift);
      if (up < lift - EPS) break;
      const altX = moveAxis(world, alt, 'x', dx);
      const altZ = moveAxis(world, alt, 'z', dz);
      if (altX * altX + altZ * altZ > actualX * actualX + actualZ * actualZ + EPS) {
        v.y = Math.max(v.y, Math.sqrt(2 * 32 * (lift + 0.12)));
        break;
      }
    }
  }
  const walled = Math.abs(actualX - dx) > EPS || Math.abs(actualZ - dz) > EPS;
  if (!player.flying && onLadder(world, p)) {
    // Ladders, as in the reference: walking into the wall or jumping climbs, a sneak holds on,
    // otherwise the body slides down slowly and never gathers a dangerous fall.
    if (walled || input.jump) v.y = 2.35;
    else if (input.crouch) v.y = Math.max(0, v.y);
    else v.y = Math.max(-3, v.y);
  }
  if (Math.abs(actualX - dx) > EPS) v.x = 0;
  if (Math.abs(actualZ - dz) > EPS) v.z = 0;
  const dy = v.y * dt,
    impact = v.y,
    actualY = moveAxis(world, p, 'y', dy);
  player.onGround = dy < 0 && Math.abs(actualY - dy) > EPS;
  // Descending onto the ground ends flight, as landing does in the reference creative mode.
  if (player.flying && player.onGround) player.flying = false;
  if (Math.abs(actualY - dy) > EPS) v.y = 0;
  // Slime throws a falling body back up (crouching kills the bounce, as in the reference).
  if (player.onGround && impact < -4 && !input.crouch && !player.flying && onSlime(world, p)) {
    v.y = Math.min(16, -impact * SLIME_BOUNCE);
    player.onGround = false;
    mods.bounced = true;
  }
  return walled;
}
/** True when the block right under the feet is slime. */
function onSlime(world: VoxelWorld, p: Vec3): boolean {
  return !!registry.get(world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.05), Math.floor(p.z)))
    .bouncy;
}
