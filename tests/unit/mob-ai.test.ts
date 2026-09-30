import { describe, expect, it } from 'vitest';
import { BLOCK } from '../../packages/content/src/blocks';
import { WorldSession } from '../../packages/core/src/session';
import { knockbackVector } from '../../packages/core/src/combat';
import { MOB_PANIC_TICKS, MobStore, type MobTickContext } from '../../packages/core/src/mobs';
import type { VoxelWorld } from '../../packages/core/src/world';

/**
 * 0.10 creature behaviour: animals stroll and pause, face where they walk, keep away from
 * ledges, lava and water, bolt when hit, follow their food, and swim out of a pond.
 * A MobStore is driven directly so natural spawning and the player never interfere.
 */
const GROUND = 9; // feet height on the flat preset (grass top at y = 8)
function flatWorld(seed = 'mob-ai'): VoxelWorld {
  const s = new WorldSession(seed, 'flat');
  for (let x = -2; x <= 3; x++) for (let z = -2; z <= 3; z++) s.loadColumn(x, z);
  return s.world;
}
function rng(seed = 7) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function context(world: VoxelWorld, extra: Partial<MobTickContext> = {}): MobTickContext {
  return {
    world,
    playerPosition: { x: -200, y: GROUND, z: -200 },
    playerAlive: true,
    damageScale: 1,
    hurtPlayer: () => {},
    random: rng(),
    ...extra,
  };
}
function fill(
  world: VoxelWorld,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  id: number,
) {
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) world.setBlock(x, y, z, id);
}

describe('0.10 · creature behaviour', () => {
  it('strolls, pauses and always faces the way it walks', () => {
    const world = flatWorld(),
      mobs = new MobStore(),
      cow = mobs.spawn('lab:cow', { x: 20.5, y: GROUND, z: 20.5 }),
      ctx = context(world);
    let still = 0,
      moving = 0,
      misaligned = 0;
    for (let t = 0; t < 2400; t++) {
      mobs.tick(ctx);
      const v = Math.hypot(cow.velocity.x, cow.velocity.z);
      if (v < 0.05) still++;
      else {
        moving++;
        if (v > 0.5) {
          const fx = -Math.sin(cow.yaw),
            fz = -Math.cos(cow.yaw);
          if ((fx * cow.velocity.x + fz * cow.velocity.z) / v < 0.8) misaligned++;
        }
      }
    }
    expect(moving).toBeGreaterThan(200);
    expect(still).toBeGreaterThan(400);
    expect(misaligned / moving).toBeLessThan(0.12);
  });
  it('never walks off a deep ledge while strolling', () => {
    const world = flatWorld('ledge'),
      mobs = new MobStore();
    // A 5×5 plateau surrounded by a six block deep trench.
    fill(world, 12, 28, 2, 8, 12, 28, BLOCK.AIR);
    fill(world, 18, 22, 2, 8, 18, 22, BLOCK.DIRT);
    const kinds = ['lab:cow', 'lab:pig', 'lab:sheep', 'lab:chicken', 'lab:zombie'];
    const list = kinds.map((k, i) =>
      mobs.spawn(k, { x: 19.5 + (i % 3), y: GROUND, z: 19.5 + Math.floor(i / 3) }),
    );
    const ctx = context(world, { playerIgnored: true });
    for (let t = 0; t < 3000; t++) mobs.tick(ctx);
    for (const m of list) expect(m.position.y, m.kind).toBeGreaterThanOrEqual(GROUND - 0.01);
  });
  it('refuses to step into lava or a pond from dry land', () => {
    const world = flatWorld('hazard'),
      mobs = new MobStore();
    fill(world, 10, 30, 8, 8, 10, 30, BLOCK.LAVA);
    fill(world, 18, 22, 8, 8, 18, 22, BLOCK.GRASS);
    fill(world, 30, 40, 8, 8, 10, 30, BLOCK.WATER);
    const pig = mobs.spawn('lab:pig', { x: 20.5, y: GROUND, z: 20.5 });
    for (let t = 0, ctx = context(world); t < 3000; t++) mobs.tick(ctx);
    expect(mobs.list).toContain(pig);
    expect(pig.position.x).toBeGreaterThan(17.7);
    expect(pig.position.x).toBeLessThan(23.3);
    expect(pig.position.z).toBeGreaterThan(17.7);
    expect(pig.position.z).toBeLessThan(23.3);
  });
  it('bolts away from the blow, faster than it strolls', () => {
    const world = flatWorld('panic'),
      mobs = new MobStore(),
      sheep = mobs.spawn('lab:sheep', { x: 20.5, y: GROUND, z: 20.5 }),
      from = { x: 18.5, y: GROUND, z: 20.5 };
    const ctx = context(world);
    for (let t = 0; t < 5; t++) mobs.tick(ctx);
    mobs.hurt(sheep, 1, knockbackVector(from, sheep.position, false));
    expect(sheep.panic).toBe(MOB_PANIC_TICKS);
    const start = { ...sheep.position };
    let peak = 0;
    for (let t = 0; t < 40; t++) {
      mobs.tick(ctx);
      peak = Math.max(peak, Math.hypot(sheep.velocity.x, sheep.velocity.z));
    }
    expect(sheep.position.x - start.x).toBeGreaterThan(2);
    expect(peak).toBeGreaterThan(2);
    // Monsters do not panic.
    const zombie = mobs.spawn('lab:zombie', { x: 25.5, y: GROUND, z: 25.5 });
    mobs.hurt(zombie, 1, knockbackVector(from, zombie.position, false));
    expect(zombie.panic).toBe(0);
  });
  it('follows the player holding its food and only that food', () => {
    const world = flatWorld('tempt'),
      mobs = new MobStore(),
      player = { x: 10.5, y: GROUND, z: 20.5 };
    const cow = mobs.spawn('lab:cow', { x: 18.5, y: GROUND, z: 20.5 });
    for (
      let t = 0, ctx = context(world, { playerPosition: player, holdingItem: 'lab:carrot' });
      t < 200;
      t++
    )
      mobs.tick(ctx);
    const ignored = Math.hypot(cow.position.x - player.x, cow.position.z - player.z);
    cow.position.x = 18.5;
    cow.position.z = 20.5;
    cow.stroll = 0;
    const ctx = context(world, { playerPosition: player, holdingItem: 'lab:wheat' });
    for (let t = 0; t < 200; t++) mobs.tick(ctx);
    const d = Math.hypot(cow.position.x - player.x, cow.position.z - player.z);
    expect(d).toBeLessThan(3);
    expect(d).toBeGreaterThan(1.2);
    expect(ignored).toBeGreaterThan(3);
    // It looks at the player it follows.
    const fx = -Math.sin(cow.yaw),
      fz = -Math.cos(cow.yaw);
    expect(fx * (player.x - cow.position.x) + fz * (player.z - cow.position.z)).toBeGreaterThan(0);
  });
  it('floats in a pond and climbs out onto the shore', () => {
    const world = flatWorld('pond'),
      mobs = new MobStore();
    fill(world, 16, 24, 5, 8, 16, 24, BLOCK.WATER);
    const cow = mobs.spawn('lab:cow', { x: 20.5, y: 5, z: 20.5 });
    const ctx = context(world);
    let surfaced = false;
    for (let t = 0; t < 60; t++) {
      mobs.tick(ctx);
      if (cow.position.y > 7.6) surfaced = true;
    }
    expect(surfaced).toBe(true);
    let out = false;
    for (let t = 0; t < 2400 && !out; t++) {
      mobs.tick(ctx);
      out = cow.onGround && !cow.inWater && cow.position.y >= GROUND - 0.01;
    }
    expect(out).toBe(true);
  });
});
