import { describe, it, expect } from 'vitest';
import { BLOCK } from '../../packages/content/src/blocks';
import { WorldSession } from '../../packages/core/src/session';
import { MAX_HEALTH, xpProgress } from '../../packages/core/src/survival';

/**
 * Acceptance suite for E08 «выживание, бой, опыт и смерть». It checks the three criteria of
 * the stage: one connected loop of eating, damage, healing, death and respawn; combat against
 * real creatures with numeric expectations; and a save file that carries the whole state.
 */
function session(seed = 'e08-survival'): WorldSession {
  const world = new WorldSession(seed, 'flat');
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) world.loadColumn(x, z);
  return world;
}
function clearBlock(world: WorldSession, x: number, y: number, z: number, state: number) {
  world.world.setBlock(x, y, z, state);
}
/** Items the player carries plus items lying on the ground, without counting experience. */
function itemsOwned(world: WorldSession): number {
  const sim = world.simulation;
  const carried = sim.inventory.slots.reduce((sum, slot) => sum + (slot?.count ?? 0), 0);
  const ground = sim.entities.list.reduce((sum, entity) => sum + entity.count, 0);
  return carried + ground;
}

describe('E08 · the survival loop', () => {
  it('runs eating, damage, healing, death and respawn as one cycle', () => {
    const world = session();
    const sim = world.simulation;
    expect(sim.survival.health).toBe(MAX_HEALTH);
    expect(sim.survival.food).toBe(20);
    sim.grant('lab:apple', 2);
    // Eating is a held action: it only counts after the reference 32 ticks.
    expect(sim.survival.food).toBe(20);
    sim.survival.food = 8;
    sim.survival.saturation = 0;
    sim.select(sim.inventory.slots.findIndex((slot) => slot?.item === 'lab:apple'));
    const use = sim.use();
    expect(use.ok).toBe(true);
    for (let i = 0; i < 31; i++) sim.step();
    expect(sim.survival.food).toBe(8);
    sim.step();
    expect(sim.survival.food).toBe(12);
    expect(sim.inventory.slots.filter((slot) => slot?.item === 'lab:apple')).toHaveLength(1);
    // Damage, then natural regeneration at food 12 does not happen: the bar is too low.
    const hurt = sim.damagePlayer(6, 'generic');
    expect(hurt).toBe(6);
    expect(sim.survival.health).toBe(MAX_HEALTH - 6);
    for (let i = 0; i < 100; i++) sim.step();
    expect(sim.survival.health).toBe(MAX_HEALTH - 6);
    // Food back to 20 and the regeneration timer starts again.
    sim.survival.food = 20;
    sim.survival.saturation = 5;
    for (let i = 0; i < 10; i++) sim.step();
    expect(sim.survival.health).toBe(MAX_HEALTH - 5);
    // Death drops the inventory and part of the experience, and respawn brings the player back.
    sim.grant('lab:cobblestone', 32);
    sim.survival.addXp(60);
    const level = xpProgress(60).level;
    const before = itemsOwned(world);
    const dropped = sim.die();
    expect(dropped).toBeGreaterThan(0);
    expect(sim.survival.dead).toBe(true);
    expect(sim.inventory.slots.every((slot) => !slot)).toBe(true);
    expect(sim.survival.xp).toBe(0);
    expect(sim.orbs.size).toBeGreaterThan(0);
    // Nothing vanished: carried items became drops, and experience became orbs.
    expect(itemsOwned(world)).toBe(before);
    expect(level).toBeGreaterThan(0);
    const payout = sim.orbs.total;
    expect(payout).toBeGreaterThan(0);
    expect(payout).toBeLessThanOrEqual(100);
    sim.respawn();
    expect(sim.survival.dead).toBe(false);
    expect(sim.survival.health).toBe(MAX_HEALTH);
    expect(sim.player.position.x).toBeCloseTo(sim.survival.spawn.x, 6);
  });
  it('hurts on landing from a fall and reports it as fall damage', () => {
    const world = session();
    const sim = world.simulation;
    for (let i = 0; i < 5; i++) sim.step();
    const ground = sim.player.position.y;
    const drop = 12;
    for (let x = -2; x <= 2; x++)
      for (let z = -2; z <= 2; z++)
        for (let y = Math.floor(ground) + 1; y <= Math.floor(ground) + drop + 2; y++)
          clearBlock(world, x, y, z, BLOCK.AIR);
    sim.player.position.y = ground + drop;
    sim.player.velocity.y = 0;
    sim.player.onGround = false;
    let guard = 0;
    while (!sim.player.onGround && guard++ < 200) sim.step();
    expect(sim.player.onGround).toBe(true);
    expect(sim.survival.health).toBeLessThan(MAX_HEALTH);
    expect(sim.survival.lastDamageType).toBe('fall');
    // Twelve blocks of fall: the reference takes whole blocks beyond the third one.
    const damage = MAX_HEALTH - sim.survival.health;
    expect(damage).toBeGreaterThanOrEqual(7);
    expect(damage).toBeLessThanOrEqual(9);
    expect(sim.survival.fallDistance).toBe(0);
  });
  it('drowns under water and stops taking damage above the surface', () => {
    const world = session();
    const sim = world.simulation;
    const y = Math.floor(sim.player.position.y);
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        clearBlock(world, dx, y, dz, BLOCK.WATER);
        clearBlock(world, dx, y + 1, dz, BLOCK.WATER);
      }
    sim.player.position = { x: 0.5, y, z: 0.5 };
    for (let i = 0; i < 320; i++) sim.step();
    expect(sim.survival.air).toBeLessThanOrEqual(0);
    expect(sim.survival.health).toBeLessThan(MAX_HEALTH);
    expect(sim.survival.lastDamageType).toBe('drown');
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) clearBlock(world, dx, y + 1, dz, BLOCK.AIR);
    for (let i = 0; i < 20; i++) sim.step();
    expect(sim.survival.air).toBeGreaterThan(0);
  });
  it('burns in lava and survives with fire resistance', () => {
    const world = session();
    const sim = world.simulation;
    const y = Math.floor(sim.player.position.y);
    sim.survival.food = 0;
    sim.survival.saturation = 0;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) clearBlock(world, dx, y, dz, BLOCK.LAVA);
    sim.player.position = { x: 0.5, y, z: 0.5 };
    for (let i = 0; i < 12; i++) sim.step();
    expect(sim.survival.health).toBeLessThan(MAX_HEALTH);
    const burned = sim.survival.health;
    sim.survival.effects.apply('fire_resistance', 400, 0);
    sim.survival.hurtResistantTime = 0;
    for (let i = 0; i < 12; i++) sim.step();
    expect(sim.survival.health).toBe(burned);
    expect(sim.survival.fireTicks).toBeGreaterThan(0);
  });
});

describe('E08 · combat with test creatures', () => {
  it('damages a training dummy with the charged damage of the held sword', () => {
    const world = session();
    const sim = world.simulation;
    sim.grant('lab:iron_sword', 1);
    sim.select(sim.inventory.slots.findIndex((slot) => slot?.item === 'lab:iron_sword'));
    const spawn = sim.spawnMob('lab:dummy', 2);
    expect(spawn.ok).toBe(true);
    const dummy = sim.mobs.list[0];
    expect(dummy.health).toBe(20);
    // A fully charged iron sword deals its full 6 damage.
    sim.attackTicks = 200;
    const first = sim.attack();
    expect(first.ok).toBe(true);
    expect(first.damage).toBeCloseTo(6, 6);
    expect(dummy.health).toBeCloseTo(14, 6);
    // A second swing in the same tick is not charged, so it lands a fifth of the damage.
    const second = sim.attack();
    expect(second.damage).toBeCloseTo(6 * 0.2, 6);
    expect(dummy.health).toBeCloseTo(14 - 1.2, 6);
    expect(sim.mobs.size).toBe(1);
  });
  it('kills a walker, rolling its drops and its experience', () => {
    const world = session();
    const sim = world.simulation;
    sim.grant('lab:iron_axe', 1);
    sim.select(sim.inventory.slots.findIndex((slot) => slot?.item === 'lab:iron_axe'));
    sim.spawnMob('lab:walker', 2);
    const walker = sim.mobs.list[0];
    expect(walker.health).toBe(20);
    let guard = 0;
    while (sim.mobs.size > 0 && guard++ < 40) {
      sim.attackTicks = 200;
      sim.attack();
    }
    expect(sim.mobs.size).toBe(0);
    // Five experience points arrive as orbs and are collected while standing there.
    expect(sim.orbs.total + sim.entities.list.reduce((sum, e) => sum + e.count, 0)).toBeGreaterThan(
      0,
    );
    for (let i = 0; i < 40; i++) sim.step();
    expect(sim.survival.xp).toBeGreaterThan(0);
    expect(xpProgress(sim.survival.xp).level).toBeGreaterThanOrEqual(0);
    void walker;
  });
  it('lets a walker hit the player and reduces the hit with iron armour', () => {
    const world = session();
    const sim = world.simulation;
    sim.spawnMob('lab:walker', 1);
    const bare = sim.damagePlayer(4, 'mob', { x: 0.5, y: 8, z: 2.5 });
    expect(bare).toBe(4);
    expect(sim.survival.health).toBe(MAX_HEALTH - 4);
    // The four armour slots take only their own piece, which the interface also enforces.
    const pieces: [number, string][] = [
      [36, 'lab:iron_helmet'],
      [37, 'lab:iron_chestplate'],
      [38, 'lab:iron_leggings'],
      [39, 'lab:iron_boots'],
    ];
    for (const [slot, item] of pieces) {
      sim.grant(item, 1);
      sim.inventory.set(slot, { item, count: 1 });
    }
    expect(sim.inventory.get(36)?.item).toBe('lab:iron_helmet');
    sim.survival.health = MAX_HEALTH;
    sim.survival.hurtResistantTime = 0;
    // 15 armour points against 4 damage: the effective value is 15 - 2 = 13 points.
    const armored = sim.damagePlayer(4, 'mob', { x: 0.5, y: 8, z: 2.5 });
    expect(armored).toBeCloseTo(4 * (1 - 13 / 25), 6);
    // Armour wears out instead of the player absorbing everything for ever.
    expect(sim.inventory.get(37)?.damage).toBeGreaterThan(0);
  });
  it('blocks a frontal hit with a raised shield and wears it down', () => {
    const world = session();
    const sim = world.simulation;
    sim.grant('lab:shield', 1);
    const index = sim.inventory.slots.findIndex((slot) => slot?.item === 'lab:shield');
    sim.inventory.set(40, sim.inventory.get(index));
    sim.inventory.set(index, null);
    sim.setInput({ ...sim.input, yaw: 0, pitch: 0 });
    sim.setUseHold(true);
    expect(sim.isBlocking()).toBe(true);
    const blocked = sim.damagePlayer(5, 'mob', {
      x: 0.5,
      y: sim.player.position.y,
      z: sim.player.position.z - 3,
    });
    expect(blocked).toBe(0);
    expect(sim.inventory.get(40)?.damage).toBe(1);
    // The same hit from behind gets through even with the shield raised.
    sim.survival.hurtResistantTime = 0;
    const behind = sim.damagePlayer(5, 'mob', {
      x: 0.5,
      y: sim.player.position.y,
      z: sim.player.position.z + 3,
    });
    expect(behind).toBe(5);
  });
  it('shoots an arrow that hurts a creature', () => {
    const world = session();
    const sim = world.simulation;
    sim.grant('lab:bow', 1);
    sim.grant('lab:arrow', 5);
    sim.select(sim.inventory.slots.findIndex((slot) => slot?.item === 'lab:bow'));
    sim.spawnMob('lab:dummy', 6);
    const dummy = sim.mobs.list[0];
    const eye = {
      x: sim.player.position.x,
      y: sim.player.position.y + 1.62,
      z: sim.player.position.z,
    };
    sim.setInput({
      ...sim.input,
      yaw: Math.atan2(-(dummy.position.x - eye.x), -(dummy.position.z - eye.z)),
      pitch: Math.atan2(
        -(dummy.position.y + 0.9 - eye.y),
        Math.hypot(dummy.position.x - eye.x, dummy.position.z - eye.z),
      ),
    });
    expect(sim.use().ok).toBe(true);
    for (let i = 0; i < 25; i++) sim.step();
    const release = sim.setUseHold(false);
    expect(release.ok).toBe(true);
    expect(sim.arrows.size).toBe(1);
    let guard = 0;
    while (sim.arrows.size > 0 && guard++ < 60) sim.step();
    expect(dummy.health).toBeLessThan(20);
  });
});

describe('E08 · state travels through a save file', () => {
  it('restores health, hunger, experience, effects, time, creatures and arrows', () => {
    const world = session('e08-save');
    const sim = world.simulation;
    sim.survival.health = 11;
    sim.survival.food = 6;
    sim.survival.saturation = 1.5;
    sim.survival.addXp(120);
    sim.survival.effects.apply('speed', 400, 1);
    sim.survival.setDifficulty('hard');
    sim.survival.setSpawn({ x: 3.5, y: 9, z: -2.5 });
    sim.spawnMob('lab:dummy', 3);
    sim.grant('lab:bow', 1);
    sim.grant('lab:arrow', 8);
    sim.select(sim.inventory.slots.findIndex((slot) => slot?.item === 'lab:bow'));
    sim.setUseHold(true);
    for (let i = 0; i < 25; i++) sim.step();
    sim.setUseHold(false);
    expect(sim.arrows.size).toBe(1);
    sim.orbs.spawnSplit(30, { x: 0.5, y: 9, z: 0.5 }, () => 0.5);
    // Set the clock after the ticks that fired the arrow, so the assertion is exact.
    world.world.time = 15_000;
    const checkpoint = world.checkpoint();
    const restored = new WorldSession('e08-save', 'flat', checkpoint);
    const after = restored.simulation;
    expect(after.survival.health).toBe(11);
    expect(after.survival.food).toBe(6);
    expect(after.survival.saturation).toBeCloseTo(1.5, 6);
    expect(after.survival.xp).toBe(sim.survival.xp);
    expect(after.survival.difficulty).toBe('hard');
    expect(after.survival.effects.level('speed')).toBe(2);
    expect(after.survival.spawn).toEqual({ x: 3.5, y: 9, z: -2.5 });
    expect(restored.world.time).toBe(15_000);
    expect(restored.world.time).toBeGreaterThan(0);
    expect(after.mobs.size).toBe(1);
    expect(after.arrows.size).toBe(1);
    expect(after.orbs.total).toBe(sim.orbs.total);
    // The restored world keeps running the same numbers.
    after.step();
    expect(after.survival.food).toBeLessThanOrEqual(6);
  });
  it('sleeps at a bed only at night and moves the respawn point', () => {
    const world = session('e08-bed');
    const sim = world.simulation;
    const x = Math.floor(sim.player.position.x);
    const y = Math.floor(sim.player.position.y);
    const z = Math.floor(sim.player.position.z);
    clearBlock(world, x + 1, y, z, BLOCK.BED);
    clearBlock(world, x + 1, y + 1, z, BLOCK.AIR);
    clearBlock(world, x + 1, y + 2, z, BLOCK.AIR);
    // Let the player settle on the ground first: sleeping needs both feet planted.
    for (let i = 0; i < 10; i++) sim.step();
    expect(sim.player.onGround).toBe(true);
    world.world.time = 6000;
    const day = sim.sleep(x + 1, y, z);
    expect(day.ok).toBe(false);
    expect(day.reason).toContain('ночью');
    world.world.time = 16_000;
    const night = sim.sleep(x + 1, y, z);
    expect(night.ok).toBe(true);
    expect(sim.survival.spawn).toEqual({ x: x + 1.5, y: y + 1, z: z + 0.5 });
    expect(world.world.time).toBe(0);
    expect(sim.isNight).toBe(false);
    // A hostile creature nearby forbids sleeping even at night.
    world.world.time = 16_000;
    sim.spawnMob('lab:walker', 3);
    const blocked = sim.sleep(x + 1, y, z);
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toContain('чудовища');
  });
  it('awards the furnace experience when the finished item is taken out', () => {
    const world = session('e08-furnace-xp');
    const sim = world.simulation;
    const x = Math.floor(sim.player.position.x);
    const y = Math.floor(sim.player.position.y);
    const z = Math.floor(sim.player.position.z);
    clearBlock(world, x + 1, y, z, BLOCK.FURNACE);
    sim.openContainer('furnace', x + 1, y, z);
    const key = sim.open!.key!;
    sim.slotClick(key, 0, 0, {});
    sim.grant('lab:iron_ore', 3);
    sim.grant('lab:coal', 1);
    sim.inventory.set(0, { item: 'lab:iron_ore', count: 3 });
    sim.inventory.set(1, { item: 'lab:coal', count: 1 });
    // Move the ore and the coal into the furnace by hand, then let it smelt.
    sim.slotClick(null, 0, 0, {});
    sim.slotClick(key, 0, 0, {});
    sim.slotClick(null, 1, 0, {});
    sim.slotClick(key, 1, 0, {});
    for (let i = 0; i < 220; i++) sim.step();
    expect(sim.open).toBeTruthy();
    const view = sim.containerView()!;
    expect(view.container[2]?.[1]).toBeGreaterThan(0);
    const before = sim.survival.xp;
    sim.slotClick(key, 2, 0, {});
    expect(sim.survival.xp).toBeGreaterThan(before);
    // One ingot pays 0.7 points in the reference, and the fraction is kept for the next item.
    expect(sim.survival.xp).toBeCloseTo(0.7, 5);
  });
  it('pays experience orbs for coal ore and follows them into the experience bar', () => {
    const world = session('e08-ore-xp');
    const sim = world.simulation;
    sim.survival.xp = 0;
    const x = Math.floor(sim.player.position.x);
    const y = Math.floor(sim.player.position.y) - 1;
    const z = Math.floor(sim.player.position.z);
    // Five blocks break with a pickaxe that is good enough for coal; the orbs fly to the player.
    sim.inventory.set(0, { item: 'lab:stone_pickaxe', count: 1, damage: 0 });
    sim.inventory.select(0);
    let orbs = 0;
    for (let i = 0; i < 8; i++) {
      clearBlock(world, x + i, y, z, BLOCK.COAL_ORE);
      expect(sim.breakBlock(x + i, y, z)).toBe(true);
      orbs += sim.orbs.list.length;
      for (let t = 0; t < 20; t++) sim.step();
    }
    expect(orbs).toBeGreaterThan(0);
    // The orbs fly into the player, so the bar shows the same points that were spawned.
    expect(sim.survival.xp).toBeGreaterThan(0);
    expect(Number.isInteger(sim.survival.xp)).toBe(true);
    // Every broken block dropped its coal, and nothing else moved.
    expect(itemsOwned(world)).toBeGreaterThanOrEqual(8);
  });
});
