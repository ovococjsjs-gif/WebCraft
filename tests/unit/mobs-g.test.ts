import { describe, expect, it } from 'vitest';
import { BLOCK } from '../../packages/content/src/blocks';
import { WorldSession } from '../../packages/core/src/session';
import {
  GHAST_FIRE,
  GHAST_WARN,
  mobDefinition,
  MobStore,
  type MobEventType,
  type MobTickContext,
} from '../../packages/core/src/mobs';
import { ArrowStore } from '../../packages/core/src/projectiles';
import type { VoxelWorld } from '../../packages/core/src/world';
import type { Vec3 } from '../../packages/core/src/coordinates';

/** Round G: slimes and magma cubes (hops, splitting) and the ghast (sight, fireballs, return). */
const GROUND = 9;
function flatWorld(seed = 'mobs-g'): VoxelWorld {
  const s = new WorldSession(seed, 'flat');
  for (let x = -3; x <= 4; x++) for (let z = -3; z <= 4; z++) s.loadColumn(x, z);
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
    playerPosition: { x: 20, y: GROUND, z: 50 },
    playerAlive: true,
    damageScale: 1,
    hurtPlayer: () => {},
    random: rng(),
    ...extra,
  };
}

describe('round G · slimes and magma cubes', () => {
  it('come in three sizes with health = size² and the 1.12 drops', () => {
    for (const [kind, size] of [
      ['lab:slime', 4],
      ['lab:slime_medium', 2],
      ['lab:slime_small', 1],
      ['lab:magma_cube', 4],
      ['lab:magma_cube_small', 1],
    ] as const) {
      const d = mobDefinition(kind)!;
      expect(d.health).toBe(size * size);
      expect(d.width).toBeCloseTo(0.51 * size);
      expect(d.hops).toBe(true);
    }
    expect(mobDefinition('lab:slime_small')!.damage).toBe(0);
    expect(mobDefinition('lab:slime_small')!.drops[0].item).toBe('lab:slimeball');
    expect(mobDefinition('lab:slime')!.drops).toEqual([]);
    expect(mobDefinition('lab:magma_cube')!.fireImmune).toBe(true);
    expect(mobDefinition('lab:magma_cube')!.drops[0].item).toBe('lab:magma_cream');
  });
  it('split into two to four of the next size when killed', () => {
    const store = new MobStore();
    const big = store.spawn('lab:slime', { x: 20, y: GROUND, z: 20 });
    const death = store.hurt(big, 100, undefined, rng(3));
    expect(death).not.toBeNull();
    const medium = store.list.filter((m) => m.kind === 'lab:slime_medium');
    expect(medium.length).toBeGreaterThanOrEqual(2);
    expect(medium.length).toBeLessThanOrEqual(4);
    const counts = new Set<number>();
    for (let seed = 1; seed < 40; seed++) {
      const s = new MobStore();
      s.hurt(
        s.spawn('lab:magma_cube_medium', { x: 0, y: GROUND, z: 0 }),
        100,
        undefined,
        rng(seed),
      );
      expect(s.list.every((m) => m.kind === 'lab:magma_cube_small')).toBe(true);
      counts.add(s.list.length);
    }
    expect([...counts].sort()).toEqual([2, 3, 4]);
    // The smallest ones do not split any further.
    const small = new MobStore();
    small.hurt(small.spawn('lab:slime_small', { x: 0, y: GROUND, z: 0 }), 5, undefined, rng());
    expect(small.size).toBe(0);
  });
  it('move only by hopping towards the player, and a big one hurts on contact', () => {
    const world = flatWorld();
    const store = new MobStore();
    const slime = store.spawn('lab:slime', { x: 20, y: GROUND, z: 20 });
    const events: MobEventType[] = [];
    let hurt = 0;
    const player: Vec3 = { x: 20, y: GROUND, z: 30 };
    const ctx = context(world, {
      playerPosition: player,
      hurtPlayer: (amount) => (hurt += amount),
      event: (type) => events.push(type),
    });
    let airborne = 0;
    let groundMoves = 0;
    for (let t = 0; t < 400 && slime.position.z < 28.5; t++) {
      const before = { ...slime.position };
      store.tick(ctx);
      if (!slime.onGround) airborne++;
      else if (Math.abs(slime.position.z - before.z) > 0.2) groundMoves++;
    }
    expect(slime.position.z).toBeGreaterThan(27);
    expect(events).toContain('hop');
    expect(airborne).toBeGreaterThan(10);
    // Along the ground it never glides: every step of the way is a leap.
    expect(groundMoves).toBeLessThan(3);
    for (let t = 0; t < 200 && hurt === 0; t++) store.tick(ctx);
    expect(hurt).toBeGreaterThanOrEqual(4);
  });
  it('a small slime never hurts', () => {
    const world = flatWorld();
    const store = new MobStore();
    store.spawn('lab:slime_small', { x: 20, y: GROUND, z: 20 });
    let hurt = 0;
    const ctx = context(world, {
      playerPosition: { x: 20.3, y: GROUND, z: 20.3 },
      hurtPlayer: (amount) => (hurt += amount),
    });
    for (let t = 0; t < 200; t++) store.tick(ctx);
    expect(hurt).toBe(0);
  });
});

describe('round G · the ghast', () => {
  it('floats, warns, and fires at a player it can see', () => {
    const world = flatWorld('ghast');
    const store = new MobStore();
    const ghast = store.spawn('lab:ghast', { x: 20, y: GROUND + 12, z: 20 });
    const events: MobEventType[] = [];
    const shots: { from: Vec3; to: Vec3 }[] = [];
    const ctx = context(world, {
      playerPosition: { x: 20, y: GROUND, z: 50 },
      event: (type) => events.push(type),
      shootGhastFireball: (from, to) => shots.push({ from, to }),
    });
    for (let t = 0; t < GHAST_FIRE + 10; t++) store.tick(ctx);
    expect(events).toContain('ghast_warn');
    expect(events.indexOf('ghast_warn')).toBeLessThan(events.indexOf('ghast_shoot'));
    expect(shots.length).toBe(1);
    // The fireball leaves in front of its face, towards the player.
    expect(shots[0].from.z).toBeGreaterThan(ghast.position.z);
    expect(GHAST_WARN).toBeLessThan(GHAST_FIRE);
    // It does not fall to the ground.
    for (let t = 0; t < 200; t++) store.tick(ctx);
    expect(ghast.position.y).toBeGreaterThan(GROUND + 2);
  });
  it('holds fire when a wall hides the player', () => {
    const world = flatWorld('ghast-wall');
    for (let x = 0; x <= 40; x++)
      for (let y = GROUND; y <= GROUND + 30; y++) world.setBlock(x, y, 36, BLOCK.STONE);
    const store = new MobStore();
    store.spawn('lab:ghast', { x: 20, y: GROUND + 12, z: 20 });
    let shots = 0;
    const ctx = context(world, {
      playerPosition: { x: 20, y: GROUND, z: 50 },
      shootGhastFireball: () => shots++,
    });
    for (let t = 0; t < 120; t++) store.tick(ctx);
    expect(shots).toBe(0);
  });
  it('a blow sends its fireball back as the player’s', () => {
    const arrows = new ArrowStore();
    const ball = arrows.spawn(
      { x: 0, y: 10, z: -3 },
      { x: 0, y: 0, z: 0.75 },
      6,
      'mob',
      false,
      'ghast_fireball',
    );
    // Looking away: nothing is struck.
    expect(arrows.deflect({ x: 0, y: 10, z: 0 }, { x: 0, y: 0, z: 1 })).toBeNull();
    const hit = arrows.deflect({ x: 0, y: 10, z: 0 }, { x: 0, y: 0, z: -1 });
    expect(hit).toBe(ball);
    expect(ball.owner).toBe('player');
    expect(ball.velocity.z).toBeLessThan(0);
    // A second blow does nothing: it is already the player's.
    expect(arrows.deflect({ x: 0, y: 10, z: 0 }, { x: 0, y: 0, z: -1 })).toBeNull();
  });
});

describe('round G · saves', () => {
  it('keep fireballs, eggs and ghast fireballs in flight (they used to break the file)', async () => {
    const { payload } = await import('../helpers/worlds');
    const { validatePayload } = await import('../../packages/storage/src/format');
    const world = payload('projectiles');
    const flying = [
      [1, 20, 1, 0, 0, 0.5, 5, 'mob', 3, 0, 0, 'fireball'],
      [2, 20, 1, 0, 0.1, 0.5, 0, 'player', 3, 0, 0, 'egg'],
      [3, 20, 1, 0, 0, 0.75, 6, 'mob', 3, 0, 0, 'ghast_fireball'],
      [4, 20, 1, 0, 0, 1, 2, 'player', 3, 0, 1],
    ];
    const core = { ...world.core, arrows: flying } as unknown as typeof world.core;
    const checked = validatePayload({ ...world, core });
    expect(checked.core.arrows.map((a) => a[11])).toEqual([
      'fireball',
      'egg',
      'ghast_fireball',
      undefined,
    ]);
    const bad = [[1, 20, 1, 0, 0, 0.5, 5, 'mob', 3, 0, 0, 'rocket']];
    expect(() =>
      validatePayload({
        ...world,
        core: { ...world.core, arrows: bad } as unknown as typeof world.core,
      }),
    ).toThrow();
  });
});
