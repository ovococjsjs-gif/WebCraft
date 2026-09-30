import { describe, it, expect } from 'vitest';
import {
  ARROW_MAX_DAMAGE,
  ENTITY_REACH,
  armorOf,
  arrowDamage,
  attackCharge,
  chargeMultiplier,
  cooldownTicks,
  isCritical,
  knockbackVector,
  reduceByArmorPoints,
  shieldBlocks,
  sweepTargets,
} from '../../packages/core/src/combat';
import { itemRegistry } from '../../packages/content/src/items';
import { stack, type Slot } from '../../packages/core/src/inventory';
import { PLAYER_ARMOR } from '../../packages/core/src/inventory';

const sword = itemRegistry.find('lab:iron_sword')!;
const fist = undefined;
function armorSlots(...items: (string | null)[]): Slot[] {
  const slots: Slot[] = new Array(41).fill(null);
  const order = ['lab:iron_helmet', 'lab:iron_chestplate', 'lab:iron_leggings', 'lab:iron_boots'];
  items.forEach((item) => {
    if (!item) return;
    const slot = PLAYER_ARMOR.from + order.indexOf(item);
    slots[slot] = stack(item, 1);
  });
  return slots;
}

describe('melee numbers', () => {
  it('uses reference attack speeds for the cooldown', () => {
    expect(cooldownTicks(4)).toBe(5);
    expect(cooldownTicks(1.6)).toBe(12);
    expect(cooldownTicks(1)).toBe(20);
    expect(itemRegistry.find('lab:iron_sword')!.attack).toEqual({ damage: 6, speed: 1.6 });
    expect(itemRegistry.find('lab:wood_axe')!.attack).toEqual({ damage: 7, speed: 1 });
    expect(itemRegistry.find('lab:stone_axe')!.attack).toEqual({ damage: 9, speed: 0.9 });
    expect(itemRegistry.find('lab:iron_pickaxe')!.attack).toEqual({ damage: 4, speed: 1.2 });
    expect(itemRegistry.find('lab:wood_shovel')!.attack).toEqual({ damage: 2.5, speed: 1 });
  });
  it('charges attacks between a fifth and the full damage', () => {
    expect(chargeMultiplier(0)).toBe(0.2);
    expect(chargeMultiplier(0.5)).toBeCloseTo(0.4, 6);
    expect(chargeMultiplier(1)).toBe(1);
    expect(attackCharge(0, sword).ready).toBe(false);
    expect(attackCharge(6, sword).charge).toBeCloseTo(0.5, 6);
    expect(attackCharge(12, sword).ready).toBe(true);
    expect(attackCharge(999, sword).charge).toBe(1);
    expect(attackCharge(5, fist).charge).toBe(1);
  });
  it('counts a critical hit only while falling and clear of water', () => {
    const falling = {
      onGround: false,
      fallDistance: 2,
      inWater: false,
      inLava: false,
      sprinting: false,
      hasBlindness: false,
    };
    expect(isCritical(falling)).toBe(true);
    expect(isCritical({ ...falling, onGround: true })).toBe(false);
    expect(isCritical({ ...falling, fallDistance: 0 })).toBe(false);
    expect(isCritical({ ...falling, inWater: true })).toBe(false);
    expect(isCritical({ ...falling, hasBlindness: true })).toBe(false);
  });
  it('pushes the target away and harder when sprinting', () => {
    // The reference impulse is 0.4 blocks per tick horizontally and 0.4 upward; the engine
    // carries a velocity per second, so the same push is eight blocks per second.
    const walk = knockbackVector({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, false);
    expect(walk.x).toBeCloseTo(8, 6);
    expect(walk.y).toBeCloseTo(8, 6);
    const sprint = knockbackVector({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 2 }, true);
    // A sprinting hit adds the reference 0.5 per tick on top of the plain push.
    expect(sprint.z).toBeCloseTo(18, 6);
    expect(Math.abs(sprint.z)).toBeGreaterThan(Math.abs(walk.x));
  });
  it('sums armour points and reduces damage through them', () => {
    const none = armorOf(new Array<Slot>(41).fill(null));
    expect(none.points).toBe(0);
    const full = armorOf(
      armorSlots('lab:iron_helmet', 'lab:iron_chestplate', 'lab:iron_leggings', 'lab:iron_boots'),
    );
    expect(full.points).toBe(15);
    expect(full.pieces).toEqual([36, 37, 38, 39]);
    // 6 damage against 15 points: the effective value is 15 - 6/2 = 12 points.
    const reduced = reduceByArmorPoints(6, full);
    expect(reduced).toBeCloseTo(6 * (1 - 12 / 25), 6);
    // A shield in an armour slot never counts as armour points.
    const shield = armorOf(armorSlots('lab:shield'));
    expect(shield.points).toBe(0);
  });
});

describe('shields, sweeping and arrows', () => {
  it('blocks only what comes from the front', () => {
    const player = { x: 0, y: 0, z: 0 };
    const inFront = { x: 0, y: 0, z: -3 };
    const behind = { x: 0, y: 0, z: 3 };
    expect(shieldBlocks(true, inFront, player, 0)).toBe(true);
    expect(shieldBlocks(true, behind, player, 0)).toBe(false);
    expect(shieldBlocks(false, inFront, player, 0)).toBe(false);
    // No direction at all: the shield still covers the player.
    expect(shieldBlocks(true, null, player, 0)).toBe(true);
  });
  it('sweeps everything close to the main target except the target itself', () => {
    const target = { id: 1, position: { x: 0, y: 0, z: 0 } };
    const hits = sweepTargets(
      1,
      target.position,
      [
        target,
        { id: 2, position: { x: 0.8, y: 0, z: 0 } },
        { id: 3, position: { x: 4, y: 0, z: 0 } },
      ],
      6,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe(2);
    expect(hits[0].damage).toBeCloseTo(1 + 6 * 0.2, 6);
  });
  it('scales arrow damage with the draw', () => {
    expect(arrowDamage(0)).toBe(1);
    expect(arrowDamage(1)).toBe(ARROW_MAX_DAMAGE);
    expect(arrowDamage(0.5)).toBeCloseTo(3.5, 6);
    expect(ENTITY_REACH).toBe(3);
  });
});
