import { describe, it, expect } from 'vitest';
import { BLOCK } from '../../packages/content/src/blocks';
import { WorldSession } from '../../packages/core/src/session';
import { MOB_ATTACK_COOLDOWN, MOB_CHASE_RANGE, mobDefinition } from '../../packages/core/src/mobs';
import { ORB_DESPAWN_TICKS } from '../../packages/core/src/projectiles';
import { ARROW_LIFETIME } from '../../packages/core/src/combat';

function session(seed = 'e08-mobs'): WorldSession {
  const world = new WorldSession(seed, 'flat');
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) world.loadColumn(x, z);
  return world;
}

describe('test creatures', () => {
  it('keeps a training dummy standing and a walker chasing', () => {
    const world = session();
    const sim = world.simulation;
    for (let i = 0; i < 5; i++) sim.step();
    const base = { ...sim.player.position };
    sim.mobs.spawn('lab:dummy', { x: base.x + 2, y: base.y, z: base.z });
    sim.mobs.spawn('lab:walker', { x: base.x + 8, y: base.y, z: base.z });
    const walker = sim.mobs.list[1];
    const before = Math.abs(walker.position.x - sim.player.position.x);
    expect(before).toBeLessThanOrEqual(MOB_CHASE_RANGE + 1);
    for (let i = 0; i < 60; i++) sim.step();
    const dummy = sim.mobs.byId(1)!;
    expect(dummy.position.x).toBeCloseTo(base.x + 2, 1);
    const after = Math.abs(walker.position.x - sim.player.position.x);
    expect(after).toBeLessThan(before);
  });
  it('attacks the player on a cooldown and stops on Peaceful', () => {
    const world = session();
    const sim = world.simulation;
    for (let i = 0; i < 5; i++) sim.step();
    const at = { ...sim.player.position };
    sim.mobs.spawn('lab:walker', { x: at.x + 1, y: at.y, z: at.z });
    for (let i = 0; i < 40; i++) sim.step();
    const damaged = sim.survival.health;
    expect(damaged).toBeLessThan(20);
    expect(MOB_ATTACK_COOLDOWN).toBe(20);
    sim.setDifficulty('peaceful');
    sim.survival.health = 20;
    for (let i = 0; i < 60; i++) sim.step();
    expect(sim.survival.health).toBe(20);
  });
  it('falls, lands and never sinks through the floor', () => {
    const world = session();
    const sim = world.simulation;
    const base = { ...sim.player.position };
    const walker = sim.mobs.spawn('lab:walker', { x: base.x + 3, y: base.y + 12, z: base.z });
    for (let i = 0; i < 60; i++) sim.step();
    expect(walker.position.y).toBeGreaterThan(base.y - 2);
    expect(walker.position.y).toBeLessThan(base.y + 13);
    expect(walker.onGround).toBe(true);
  });
  it('drops its loot and its experience when it dies', () => {
    const world = session();
    const sim = world.simulation;
    const definition = mobDefinition('lab:walker')!;
    const walker = sim.mobs.spawn('lab:walker', { x: 10.5, y: 8, z: 0.5 });
    const death = sim.mobs.hurt(walker, definition.health + 1)!;
    expect(death).not.toBeNull();
    expect(sim.mobs.size).toBe(0);
    expect(death.xp).toBe(definition.xp);
    expect(death.drops.every((drop) => drop.count >= 1)).toBe(true);
  });
  it('reports hostile creatures near a spot, for the sleeping rule', () => {
    const world = session();
    const sim = world.simulation;
    const at = { x: 0.5, y: 8, z: 0.5 };
    sim.mobs.spawn('lab:dummy', { x: 1.5, y: 8, z: 0.5 });
    expect(sim.mobs.hostileNear(at, 8)).toBe(false);
    sim.mobs.spawn('lab:walker', { x: 3.5, y: 8, z: 0.5 });
    expect(sim.mobs.hostileNear(at, 8)).toBe(true);
    expect(sim.mobs.hostileNear(at, 1)).toBe(false);
  });
  it('round-trips creatures through a checkpoint', () => {
    const world = session('e08-mob-save');
    const sim = world.simulation;
    sim.mobs.spawn('lab:walker', { x: 4.5, y: 9, z: 1.5 });
    const saved = world.checkpoint();
    const restored = new WorldSession('e08-mob-save', 'flat', saved);
    expect(restored.simulation.mobs.size).toBe(1);
    const mob = restored.simulation.mobs.list[0];
    expect(mob.kind).toBe('lab:walker');
    expect(mob.position.x).toBeCloseTo(4.5, 6);
    expect(mob.health).toBe(20);
  });
});

describe('arrows and experience orbs', () => {
  it('sticks an arrow into a block and forgets it after a while', () => {
    const world = session();
    const sim = world.simulation;
    for (let i = 0; i < 5; i++) sim.step();
    const feet = Math.floor(sim.player.position.y);
    expect(world.world.setBlock(2, feet + 1, 0, BLOCK.STONE)).toBe(true);
    const arrow = sim.arrows.spawn({ x: 0.5, y: feet + 1.5, z: 0.5 }, { x: 0.5, y: 0, z: 0 }, 4);
    for (let i = 0; i < 20; i++) sim.step();
    expect(arrow.stuck).toBe(true);
    expect(arrow.velocity.x).toBe(0);
    arrow.age = ARROW_LIFETIME + 1;
    for (let i = 0; i < 2; i++) sim.step();
    expect(sim.arrows.size).toBe(0);
  });
  it('splits a payout into orbs and merges them back together', () => {
    const world = session();
    const sim = world.simulation;
    const spawned = sim.orbs.spawnSplit(30, { x: 0.5, y: 9, z: 0.5 }, () => 0.5);
    expect(spawned).toBe(30);
    expect(sim.orbs.total).toBe(30);
    expect(sim.orbs.size).toBeGreaterThan(1);
    for (let i = 0; i < 5; i++) sim.step();
    expect(sim.orbs.size).toBe(1);
    expect(sim.orbs.total).toBe(30);
  });
  it('collects orbs into levels and lets them expire', () => {
    const world = session();
    const sim = world.simulation;
    for (let i = 0; i < 5; i++) sim.step();
    const at = sim.player.position;
    sim.orbs.spawnSplit(20, { x: at.x, y: at.y, z: at.z }, () => 0.5);
    for (let i = 0; i < 60; i++) sim.step();
    expect(sim.survival.xp).toBe(20);
    expect(sim.survival.level).toBe(2);
    const far = sim.orbs.spawn(5, { x: at.x + 40, y: at.y, z: at.z });
    far.age = ORB_DESPAWN_TICKS;
    // Unloaded chunks freeze the orb, so load its column before the age check.
    world.loadColumn(Math.floor((at.x + 40) / 16), Math.floor(at.z / 16));
    sim.step();
    expect(sim.orbs.size).toBe(0);
  });
  it('enforces the armour slot rule in the interface', () => {
    const world = session();
    const sim = world.simulation;
    sim.grant('lab:iron_helmet', 1);
    const helmet = sim.inventory.slots.findIndex((slot) => slot?.item === 'lab:iron_helmet');
    sim.grant('lab:cobblestone', 1);
    const stone = sim.inventory.slots.findIndex((slot) => slot?.item === 'lab:cobblestone');
    // Picking the helmet up and clicking an armour slot works.
    sim.slotClick(null, helmet, 0);
    expect(sim.slotClick(null, 37, 0, {}).ok).toBe(false);
    expect(sim.cursor?.item).toBe('lab:iron_helmet');
    expect(sim.slotClick(null, 36, 0, {}).ok).toBe(true);
    expect(sim.inventory.get(36)?.item).toBe('lab:iron_helmet');
    // A stone cannot be dropped into an armour slot.
    sim.slotClick(null, stone, 0);
    expect(sim.cursor?.item).toBe('lab:cobblestone');
    expect(sim.slotClick(null, 37, 0, {}).ok).toBe(false);
    expect(sim.inventory.get(37)).toBeNull();
    // Shift-clicking the helmet equips it straight from the inventory.
    sim.slotClick(null, stone, 0);
    sim.slotClick(null, stone, 0);
    const placed = sim.inventory.get(stone);
    if (placed) sim.slotClick(null, stone, 0);
    sim.slotClick(null, 36, 0, {});
    sim.slotClick(null, 9, 0, {});
    sim.inventory.set(9, { item: 'lab:iron_boots', count: 1 });
    expect(sim.slotClick(null, 9, 0, { shift: true }).ok).toBe(true);
    expect(sim.inventory.get(39)?.item).toBe('lab:iron_boots');
  });
});
