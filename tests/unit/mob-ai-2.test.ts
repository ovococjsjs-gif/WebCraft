import { describe, expect, it } from 'vitest';
import { BLOCK } from '../../packages/content/src/blocks';
import { WorldSession } from '../../packages/core/src/session';
import {
  MOB_BREED_COOLDOWN,
  MOB_GROW_TICKS,
  MobStore,
  type MobEventType,
  type MobTickContext,
} from '../../packages/core/src/mobs';
import { findPath, fits, lineOfSight } from '../../packages/core/src/mob-nav';
import type { VoxelWorld } from '../../packages/core/src/world';
import type { Vec3 } from '../../packages/core/src/coordinates';

/**
 * Mob pass 2: creatures that see, remember and find their way; grow up, take fall damage and
 * push each other aside; and the specials of each kind (enderman, spider, blaze, sheep,
 * chicken). A MobStore is driven directly; the last block goes through the whole simulation.
 */
const GROUND = 9; // feet height on the flat preset (grass top at y = 8)
function flatWorld(seed = 'mob-ai-2'): VoxelWorld {
  const s = new WorldSession(seed, 'flat');
  for (let x = -2; x <= 3; x++) for (let z = -2; z <= 3; z++) s.loadColumn(x, z);
  return s.world;
}
function rng(seed = 11) {
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
    playerPosition: { x: 20, y: GROUND, z: 50 },
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
const flat = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);

describe('mob pass 2 · navigation', () => {
  it('finds a way round a wall and never through it', () => {
    const world = flatWorld();
    fill(world, 30, 30, 9, 11, 10, 30, BLOCK.STONE);
    const path = findPath(
      world,
      { x: 25, y: GROUND, z: 20 },
      { x: 35, y: GROUND, z: 20 },
      { height: 2, maxDrop: 3, swim: false, maxNodes: 2000 },
    );
    expect(path).not.toBeNull();
    const last = path![path!.length - 1];
    expect(Math.hypot(last.x - 35, last.z - 20)).toBeLessThanOrEqual(1);
    for (const point of path!) {
      expect(point.x === 30 && point.z >= 10 && point.z <= 30).toBe(false);
      expect(fits(world, point.x, point.y, point.z, 2)).toBe(true);
    }
    // Going round the end of the wall is far longer than the ten blocks straight across.
    expect(path!.length).toBeGreaterThan(14);
  });
  it('sees across open ground but not through stone', () => {
    const world = flatWorld();
    const a = { x: 20.5, y: 10.6, z: 20.5 },
      b = { x: 28.5, y: 10.6, z: 20.5 };
    expect(lineOfSight(world, a, b)).toBe(true);
    fill(world, 24, 24, 9, 11, 18, 22, BLOCK.STONE);
    expect(lineOfSight(world, a, b)).toBe(false);
  });
  it('walks a zombie round a deep trench to reach the player', () => {
    const world = flatWorld();
    // A six deep trench between them, open at the far end.
    fill(world, 29, 30, 2, 8, 6, 28, BLOCK.AIR);
    const mobs = new MobStore(),
      zombie = mobs.spawn('lab:zombie', { x: 24.5, y: GROUND, z: 18.5 }),
      player = { x: 35.5, y: GROUND, z: 18.5 },
      ctx = context(world, { playerPosition: player });
    let best = Infinity;
    for (let t = 0; t < 400; t++) {
      mobs.tick(ctx);
      best = Math.min(best, flat(zombie.position, player));
      if (best < 2.5) break;
    }
    expect(best).toBeLessThan(2.5);
    expect(zombie.position.y).toBeGreaterThan(8.5);
  });
  it('does not notice a player hidden behind a wall', () => {
    const world = flatWorld();
    fill(world, 30, 30, 9, 13, 0, 40, BLOCK.STONE);
    const mobs = new MobStore(),
      zombie = mobs.spawn('lab:zombie', { x: 25.5, y: GROUND, z: 20.5 }),
      ctx = context(world, { playerPosition: { x: 34.5, y: GROUND, z: 20.5 } });
    for (let t = 0; t < 100; t++) mobs.tick(ctx);
    expect(zombie.aggressive).toBe(false);
    expect(zombie.memory).toBe(0);
  });
  it('keeps a crowd of cows from standing inside each other', () => {
    const world = flatWorld(),
      mobs = new MobStore();
    for (let i = 0; i < 6; i++) mobs.spawn('lab:cow', { x: 20.5, y: GROUND, z: 20.5 });
    const ctx = context(world);
    for (let t = 0; t < 80; t++) mobs.tick(ctx);
    let closest = Infinity;
    for (const a of mobs.list)
      for (const b of mobs.list)
        if (a !== b) closest = Math.min(closest, flat(a.position, b.position));
    expect(closest).toBeGreaterThan(0.45);
  });
});

describe('mob pass 2 · life', () => {
  it('lets hostiles far from the player vanish but keeps the animals', () => {
    const world = flatWorld(),
      mobs = new MobStore();
    mobs.spawn('lab:zombie', { x: 20.5, y: GROUND, z: 20.5 });
    const cow = mobs.spawn('lab:cow', { x: 22.5, y: GROUND, z: 20.5 });
    mobs.tick(context(world, { playerPosition: { x: 300, y: GROUND, z: 300 } }));
    expect(mobs.list.map((m) => m.kind)).toEqual(['lab:cow']);
    expect(mobs.byId(cow.id)).toBe(cow);
  });
  it('grows a calf up and refuses to breed again straight away', () => {
    const world = flatWorld(),
      mobs = new MobStore(),
      ctx = context(world);
    const a = mobs.spawn('lab:cow', { x: 20.5, y: GROUND, z: 20.5 }),
      b = mobs.spawn('lab:cow', { x: 21.5, y: GROUND, z: 20.5 });
    expect(mobs.feed(a, 'lab:wheat')).toBe('fed');
    expect(['fed', 'bred']).toContain(mobs.feed(b, 'lab:wheat'));
    let calf = undefined as ReturnType<MobStore['spawn']> | undefined;
    for (let t = 0; t < 200 && !calf; t++) {
      mobs.tick(ctx);
      calf = mobs.list.find((m) => m.baby);
    }
    expect(calf).toBeDefined();
    expect(calf!.growth).toBeLessThan(0);
    expect(a.breedCooldown).toBeGreaterThan(MOB_BREED_COOLDOWN - 300);
    expect(mobs.feed(a, 'lab:wheat')).toBe('refused');
    calf!.growth = -3;
    for (let t = 0; t < 4; t++) mobs.tick(ctx);
    expect(calf!.baby).toBe(false);
    expect(MOB_GROW_TICKS).toBe(24000);
  });
  it('takes fall damage beyond three blocks', () => {
    const world = flatWorld(),
      mobs = new MobStore(),
      cow = mobs.spawn('lab:cow', { x: 20.5, y: GROUND + 10, z: 20.5 }),
      ctx = context(world);
    for (let t = 0; t < 60; t++) mobs.tick(ctx);
    expect(cow.onGround).toBe(true);
    expect(cow.health).toBeLessThanOrEqual(10 - 6);
    expect(cow.health).toBeGreaterThan(0);
    const low = mobs.spawn('lab:cow', { x: 24.5, y: GROUND + 2, z: 20.5 });
    for (let t = 0; t < 30; t++) mobs.tick(ctx);
    expect(low.health).toBe(10);
  });
  it('burns in lava unless it is a blaze', () => {
    const world = flatWorld();
    world.setBlock(20, 8, 20, BLOCK.LAVA);
    world.setBlock(26, 8, 20, BLOCK.LAVA);
    fill(world, 19, 27, 9, 11, 19, 19, BLOCK.STONE);
    fill(world, 19, 27, 9, 11, 21, 21, BLOCK.STONE);
    const mobs = new MobStore(),
      pig = mobs.spawn('lab:pig', { x: 20.5, y: 8.2, z: 20.5 }),
      blaze = mobs.spawn('lab:blaze', { x: 26.5, y: 8.2, z: 20.5 }),
      ctx = context(world);
    for (let t = 0; t < 40; t++) mobs.tick(ctx);
    expect(pig.health).toBeLessThan(10);
    expect(blaze.health).toBe(20);
  });
});

describe('mob pass 2 · specials', () => {
  it('angers an enderman that is stared at, and it screams', () => {
    const world = flatWorld(),
      mobs = new MobStore(),
      enderman = mobs.spawn('lab:enderman', { x: 20.5, y: GROUND, z: 30.5 }),
      events: MobEventType[] = [];
    const eye = { x: 20.5, y: GROUND + 1.62, z: 20.5 };
    const head = { x: 20.5, y: GROUND + 2.55, z: 30.5 };
    const len = Math.hypot(head.y - eye.y, head.z - eye.z);
    const look = { x: 0, y: (head.y - eye.y) / len, z: (head.z - eye.z) / len };
    const ctx = context(world, {
      playerPosition: { x: 20.5, y: GROUND, z: 20.5 },
      playerEye: eye,
      playerLook: look,
      event: (type) => events.push(type),
    });
    for (let t = 0; t < 10; t++) mobs.tick(ctx);
    expect(enderman.aggressive).toBe(true);
    expect(events).toContain('scream');
    // Looking away does not calm it: it remembers.
    const away = context(world, {
      playerPosition: { x: 20.5, y: GROUND, z: 20.5 },
      playerEye: eye,
      playerLook: { x: 1, y: 0, z: 0 },
    });
    for (let t = 0; t < 20; t++) mobs.tick(away);
    expect(enderman.aggressive).toBe(true);
  });
  it('leaves an enderman calm when nobody looks and teleports it out of the rain', () => {
    const world = flatWorld(),
      mobs = new MobStore(),
      enderman = mobs.spawn('lab:enderman', { x: 20.5, y: GROUND, z: 20.5 }),
      events: MobEventType[] = [];
    const start = { ...enderman.position };
    const ctx = context(world, {
      rainAt: () => true,
      event: (type) => events.push(type),
    });
    for (let t = 0; t < 60; t++) mobs.tick(ctx);
    expect(enderman.aggressive).toBe(false);
    expect(events).toContain('teleport');
    expect(flat(enderman.position, start)).toBeGreaterThan(1.5);
    expect(enderman.health).toBeLessThan(40);
  });
  it('keeps a spider calm in bright light and hunting in the dark', () => {
    const world = flatWorld();
    const player = { x: 26.5, y: GROUND, z: 20.5 };
    const bright = new MobStore(),
      calm = bright.spawn('lab:spider', { x: 20.5, y: GROUND, z: 20.5 });
    const day = context(world, { playerPosition: player, lightAt: () => 15 });
    for (let t = 0; t < 40; t++) bright.tick(day);
    expect(calm.aggressive).toBe(false);
    const dark = new MobStore(),
      hunter = dark.spawn('lab:spider', { x: 20.5, y: GROUND, z: 20.5 });
    const night = context(world, { playerPosition: player, lightAt: () => 0 });
    for (let t = 0; t < 40; t++) dark.tick(night);
    expect(hunter.aggressive).toBe(true);
    expect(flat(hunter.position, player)).toBeLessThan(4);
  });
  it('lets a spider climb a wall towards the player on top', () => {
    const world = flatWorld();
    fill(world, 24, 30, 9, 12, 14, 26, BLOCK.STONE);
    const mobs = new MobStore(),
      spider = mobs.spawn('lab:spider', { x: 22.4, y: GROUND, z: 20.5 }),
      ctx = context(world, {
        playerPosition: { x: 25.5, y: 13, z: 20.5 },
        lightAt: () => 0,
      });
    let top = 0,
      climbed = false;
    for (let t = 0; t < 200; t++) {
      mobs.tick(ctx);
      top = Math.max(top, spider.position.y);
      climbed ||= spider.climbing;
    }
    expect(climbed).toBe(true);
    expect(top).toBeGreaterThanOrEqual(12.9);
  });
  it('makes a blaze hover and throw its fireballs in bursts of three', () => {
    const world = flatWorld(),
      mobs = new MobStore(),
      blaze = mobs.spawn('lab:blaze', { x: 20.5, y: GROUND, z: 20.5 }),
      shots: number[] = [];
    let tick = 0;
    const ctx = context(world, {
      playerPosition: { x: 20.5, y: GROUND, z: 30.5 },
      shootFireball: () => shots.push(tick),
    });
    let high = 0;
    for (tick = 0; tick < 220; tick++) {
      mobs.tick(ctx);
      high = Math.max(high, blaze.position.y);
    }
    expect(shots.length).toBeGreaterThanOrEqual(3);
    // The first three come close together, the next burst only after the cooldown.
    expect(shots[2] - shots[0]).toBeLessThan(30);
    if (shots.length > 3) expect(shots[3] - shots[2]).toBeGreaterThan(40);
    expect(high).toBeGreaterThan(GROUND + 0.5);
  });
  it('lets a sheep graze its wool back after shearing', () => {
    const world = flatWorld(),
      mobs = new MobStore(),
      sheep = mobs.spawn('lab:sheep', { x: 20.5, y: GROUND, z: 20.5 }),
      ctx = context(world, {
        setBlock: (x, y, z, state) => world.setBlock(x, y, z, state),
      });
    expect(mobs.shear(sheep, rng())).toBeGreaterThanOrEqual(1);
    expect(sheep.sheared).toBe(true);
    expect(mobs.shear(sheep, rng())).toBe(0);
    for (let t = 0; t < 12000 && sheep.sheared; t++) mobs.tick(ctx);
    expect(sheep.sheared).toBe(false);
    const below = world.getBlock(
      Math.floor(sheep.position.x),
      Math.floor(sheep.position.y) - 1,
      Math.floor(sheep.position.z),
    );
    expect([BLOCK.DIRT, BLOCK.GRASS]).toContain(below);
  });
  it('lets a chicken lay an egg and keeps the look of a sheep in the save', () => {
    const world = flatWorld(),
      mobs = new MobStore(),
      hen = mobs.spawn('lab:chicken', { x: 20.5, y: GROUND, z: 20.5 }),
      drops: string[] = [];
    hen.eggTimer = 2;
    const ctx = context(world, { dropItem: (item) => drops.push(item) });
    for (let t = 0; t < 4; t++) mobs.tick(ctx);
    expect(drops).toEqual(['lab:egg']);
    const sheep = mobs.spawn('lab:sheep', { x: 24.5, y: GROUND, z: 20.5 });
    mobs.shear(sheep, rng());
    const calf = mobs.spawn('lab:cow', { x: 26.5, y: GROUND, z: 20.5 });
    calf.baby = true;
    calf.growth = -1234;
    const copy = new MobStore();
    expect(copy.restore(mobs.snapshot())).toBe(0);
    const s2 = copy.list.find((m) => m.kind === 'lab:sheep')!;
    const c2 = copy.list.find((m) => m.kind === 'lab:cow')!;
    expect(s2.sheared).toBe(true);
    expect(s2.variant).toBe(sheep.variant);
    expect(c2.baby).toBe(true);
    expect(c2.growth).toBe(-1234);
  });
});

describe('mob pass 2 · in the game', () => {
  function game(seed = 'mob-pass-2') {
    const world = new WorldSession(seed, 'flat');
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) world.loadColumn(x, z);
    const sim = world.simulation;
    for (let i = 0; i < 5; i++) sim.step();
    return sim;
  }
  function holding(sim: ReturnType<typeof game>, item: string, count = 1) {
    sim.inventory.set(sim.inventory.selected, { item, count, damage: 0 });
  }
  function faceMob(sim: ReturnType<typeof game>, kind: string) {
    const p = sim.player.position;
    sim.input.yaw = 0;
    sim.input.pitch = -0.35;
    return sim.mobs.spawn(kind, { x: p.x, y: p.y, z: p.z - 1.6 });
  }
  it('shears a sheep for wool and milks a cow into a bucket', () => {
    const sim = game();
    const sheep = faceMob(sim, 'lab:sheep');
    holding(sim, 'lab:shears');
    const sheared = sim.use();
    expect(sheared.ok).toBe(true);
    expect(sheep.sheared).toBe(true);
    expect(sim.inventory.get(sim.inventory.selected)?.damage).toBe(1);
    sim.mobs.clear();
    faceMob(sim, 'lab:cow');
    holding(sim, 'lab:bucket');
    expect(sim.use().ok).toBe(true);
    expect(sim.inventory.get(sim.inventory.selected)?.item).toBe('lab:milk_bucket');
  });
  it('washes effects away with milk, and drinks potions without a block in front', () => {
    const sim = game();
    sim.survival.effects.apply('poison', 200, 0);
    sim.input.pitch = 1.4; // looking at the sky
    holding(sim, 'lab:milk_bucket');
    expect(sim.use().ok).toBe(true);
    expect(sim.survival.effects.list.length).toBe(0);
    expect(sim.inventory.get(sim.inventory.selected)?.item).toBe('lab:bucket');
  });
  it('throws an egg that flies and breaks', () => {
    const sim = game();
    holding(sim, 'lab:egg', 4);
    sim.input.pitch = 0.2;
    expect(sim.use().ok).toBe(true);
    expect(sim.inventory.get(sim.inventory.selected)?.count).toBe(3);
    expect(sim.arrows.list.some((a) => a.kind === 'egg')).toBe(true);
    for (let i = 0; i < 80; i++) sim.step();
    expect(sim.arrows.list.some((a) => a.kind === 'egg')).toBe(false);
  });
  it('withers the player hit by a wither skeleton and sets them alight with a fireball', () => {
    const sim = game();
    const p = sim.player.position;
    sim.mobs.spawn('lab:wither_skeleton', { x: p.x + 1.2, y: p.y, z: p.z });
    let withered = false;
    for (let i = 0; i < 60 && !withered; i++) {
      sim.step();
      withered = sim.survival.effects.has('wither');
    }
    expect(withered).toBe(true);
    sim.mobs.clear();
    sim.arrows.spawn(
      { x: p.x + 3, y: p.y + 1, z: p.z },
      { x: -1, y: 0, z: 0 },
      5,
      'mob',
      false,
      'fireball',
    );
    for (let i = 0; i < 6; i++) sim.step();
    expect(sim.survival.fireTicks).toBeGreaterThan(0);
  });
});

describe('mob pass 2 · sounds', () => {
  it('names a sound for shearing, milking, throwing and a breaking egg', () => {
    const world = new WorldSession('mob-sounds', 'flat');
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) world.loadColumn(x, z);
    const sim = world.simulation;
    for (let i = 0; i < 5; i++) sim.step();
    const heard = new Set<string>();
    const listen = () => {
      for (const e of sim.snapshot().visualEvents) if (e.kind === 'sound') heard.add(e.sound!);
    };
    const p = sim.player.position;
    sim.input.yaw = 0;
    sim.input.pitch = -0.35;
    const sheep = sim.mobs.spawn('lab:sheep', { x: p.x, y: p.y, z: p.z - 1.6 });
    sim.inventory.set(sim.inventory.selected, { item: 'lab:shears', count: 1, damage: 0 });
    sim.use();
    listen();
    sim.mobs.clear();
    void sheep;
    sim.mobs.spawn('lab:cow', { x: p.x, y: p.y, z: p.z - 1.6 });
    sim.inventory.set(sim.inventory.selected, { item: 'lab:bucket', count: 1, damage: 0 });
    sim.use();
    listen();
    sim.mobs.clear();
    sim.inventory.set(sim.inventory.selected, { item: 'lab:egg', count: 1, damage: 0 });
    sim.input.pitch = -0.6;
    sim.use();
    listen();
    for (let i = 0; i < 40; i++) {
      sim.step();
      listen();
    }
    for (const cue of ['shear', 'milk', 'throw', 'mob_egg']) expect(heard).toContain(cue);
  });
});
