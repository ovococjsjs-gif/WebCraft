/**
 * Melee and ranged combat maths: attack charge, criticals, sweeping, knockback, armour
 * points and shield blocking. The numbers come from the reference behaviour and are kept in
 * one place so the conformance stage can compare them without touching the simulation.
 */
import type { Vec3 } from './coordinates';
import {
  itemRegistry,
  itemDurability,
  IRON_ARMOR,
  ARMOR_SLOT_ORDER,
  type ItemDefinition,
} from '../../content/src/items';
import { definition, type Slot } from './inventory';
import { PLAYER_ARMOR } from './inventory';
import { reduceByArmor, attackStatsOf } from './survival';
/** Reference melee reach; the block reach is longer and lives in the simulation. */
export const ENTITY_REACH = 3.0;
export const CRITICAL_MULTIPLIER = 1.5;
export const SWEEP_RANGE = 1.0;
export const SWEEP_EXTRA_DAMAGE = 1;
/**
 * Knockback impulses. The reference states them per tick — 0.4 for a melee hit, plus 0.5 while
 * sprinting, with the upward part capped at 0.4 — while this engine carries a velocity in blocks
 * per second and moves by `velocity * 0.05` each tick. The impulses below are written in those
 * units, so a plain hit travels about half a block and a sprinting hit about one, exactly like
 * the reference, and a hit lifts a creature one block into the air.
 */
export const TICK_SECONDS = 0.05;
export const KNOCKBACK_BASE = 0.4 / TICK_SECONDS;
export const KNOCKBACK_SPRINT_BONUS = 0.5 / TICK_SECONDS;
export const KNOCKBACK_SPRINT = KNOCKBACK_BASE + KNOCKBACK_SPRINT_BONUS;
export const KNOCKBACK_VERTICAL = 0.4 / TICK_SECONDS;
/** Shield blocks the damage that arrives from the half-space the player is facing. */
export const SHIELD_ARC = Math.PI / 2;
/** Arrow damage per charge step; a full charge is one whole second of drawing. */
export const BOW_CHARGE_TICKS = 20;
export const BOW_MIN_CHARGE_TICKS = 3;
export const ARROW_MAX_DAMAGE = 6;
export const ARROW_SPEED = 3;
export const ARROW_GRAVITY = 0.05;
export const ARROW_DRAG = 0.99;
export const ARROW_LIFETIME = 1200;
export const BOW_DURABILITY_COST = 1;
export interface AttackCharge {
  readonly charge: number;
  readonly multiplier: number;
  readonly ready: boolean;
}
/** Ticks between two full-power hits for a weapon with the given attacks per second. */
export function cooldownTicks(speed = 4): number {
  const clamped = Math.max(0.1, speed);
  return (20 / clamped) | 0;
}
export function attackCharge(
  ticksSinceAttack: number,
  item: ItemDefinition | undefined,
): AttackCharge {
  const speed = attackStatsOf(item).speed;
  const needed = Math.max(1, cooldownTicks(speed));
  const charge = Math.max(0, Math.min(1, ticksSinceAttack / needed));
  return { charge, multiplier: chargeMultiplier(charge), ready: charge >= 1 };
}
export function chargeMultiplier(charge: number): number {
  return 0.2 + charge * charge * 0.8;
}
export interface CriticalContext {
  readonly onGround: boolean;
  readonly fallDistance: number;
  readonly inWater: boolean;
  readonly inLava: boolean;
  readonly sprinting: boolean;
  readonly hasBlindness: boolean;
}
/** Critical hits need a falling, grounded-free hit; sprinting trades the critical for a shove. */
export function isCritical(context: CriticalContext): boolean {
  return (
    context.fallDistance > 0 &&
    !context.onGround &&
    !context.inWater &&
    !context.inLava &&
    !context.hasBlindness
  );
}
export function knockbackVector(from: Vec3, to: Vec3, sprinting: boolean): Vec3 {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  const power = sprinting ? KNOCKBACK_SPRINT : KNOCKBACK_BASE;
  if (length < 1e-6) return { x: 0, y: KNOCKBACK_VERTICAL, z: 0 };
  return { x: (dx / length) * power, y: KNOCKBACK_VERTICAL, z: (dz / length) * power };
}
export interface ArmorState {
  readonly points: number;
  readonly toughness: number;
  /** Slot indices of the armour pieces that reduce damage, for durability loss. */
  readonly pieces: readonly number[];
}
export function armorOf(slots: readonly Slot[]): ArmorState {
  let points = 0;
  let toughness = 0;
  const pieces: number[] = [];
  for (let i = PLAYER_ARMOR.from; i < PLAYER_ARMOR.to; i++) {
    const slot = slots[i];
    const stats = slot ? definition(slot).armor : undefined;
    // A shield sits in the armour list but protects by blocking, not by points.
    if (!slot || !stats || stats.points <= 0) continue;
    points += stats.points;
    toughness += stats.toughness;
    pieces.push(i);
  }
  return { points, toughness, pieces };
}
export function reduceByArmorPoints(damage: number, armor: ArmorState): number {
  return reduceByArmor(damage, armor.points, armor.toughness);
}
/** Armour takes one point of wear per four points of incoming damage, always at least one. */
export function armorWearFor(damage: number): number {
  return Math.max(1, Math.floor(damage / 4));
}
export function isArmor(item: string): boolean {
  return !!itemRegistry.find(item)?.armor;
}
/** Which armour slot a piece belongs to, or -1 when the item is not wearable. */
export function armorSlotFor(item: string): number {
  const stats = itemRegistry.find(item)?.armor;
  if (!stats) return -1;
  const index = ARMOR_SLOT_ORDER.indexOf(stats.slot);
  return index < 0 ? -1 : PLAYER_ARMOR.from + index;
}
export function armorDurability(item: string): number {
  return itemRegistry.find(item)?.armor?.durability ?? 0;
}
export function shieldBlocks(
  blocking: boolean,
  attackFrom: Vec3 | null | undefined,
  playerPosition: Vec3,
  yaw: number,
): boolean {
  if (!blocking) return false;
  if (!attackFrom) return true; // Environmental damage has no direction and is not blocked.
  const dx = attackFrom.x - playerPosition.x;
  const dz = attackFrom.z - playerPosition.z;
  if (Math.hypot(dx, dz) < 1e-6) return true;
  // The player looks along (-sin yaw, -cos yaw); the shield covers the frontal arc.
  const facing = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  const length = Math.hypot(dx, dz);
  const dot = (dx / length) * facing.x + (dz / length) * facing.z;
  return Math.acos(Math.max(-1, Math.min(1, dot))) <= SHIELD_ARC;
}
export function arrowDamage(charge: number): number {
  const clamped = Math.max(0, Math.min(1, charge));
  return 1 + (ARROW_MAX_DAMAGE - 1) * clamped;
}
export function bowDurabilityAfterShot(current: number): { damage: number; broke: boolean } {
  const next = current + BOW_DURABILITY_COST;
  const durability = itemDurability(itemRegistry.find('lab:bow')) || 384;
  return { damage: next, broke: next >= durability };
}
export interface SweepHit {
  readonly id: number;
  readonly damage: number;
  readonly knockback: Vec3;
}
/** Sweeping blows hit everything close to the main target except the target itself. */
export function sweepTargets(
  targetId: number,
  targetPosition: Vec3,
  candidates: readonly { id: number; position: Vec3 }[],
  baseDamage: number,
): SweepHit[] {
  const hits: SweepHit[] = [];
  for (const candidate of candidates) {
    if (candidate.id === targetId) continue;
    const dx = candidate.position.x - targetPosition.x;
    const dz = candidate.position.z - targetPosition.z;
    if (Math.hypot(dx, dz) > SWEEP_RANGE) continue;
    hits.push({
      id: candidate.id,
      damage: SWEEP_EXTRA_DAMAGE + baseDamage * 0.2,
      knockback: { x: dx * KNOCKBACK_BASE, y: KNOCKBACK_VERTICAL * 0.5, z: dz * KNOCKBACK_BASE },
    });
  }
  return hits;
}
export { IRON_ARMOR };
