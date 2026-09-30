import { describe, it, expect } from 'vitest';
import { BLOCK, registry } from '../../packages/content/src/blocks';
import { WorldSession } from '../../packages/core/src/session';
import { knockbackVector } from '../../packages/core/src/combat';
import {
  MAX_MOBS,
  MOB_ATTACK_COOLDOWN,
  MOB_CHASE_RANGE,
  MOB_FUSE_TICKS,
  MOB_IDLE_DRAG,
  MOB_LOVE_TICKS,
  MOB_SHOOT_COOLDOWN,
  MOB_SHOOT_MIN_RANGE,
  MOB_SHOOT_PREFERRED,
  MOB_SHOOT_RANGE,
  mobDefinition,
} from '../../packages/core/src/mobs';

/**
 * Acceptance suite for E11 «существа, мобы и поведение». Every check is a number taken from the
 * reference: hit points and damage, the length of a creeper fuse, the range a skeleton keeps, the
 * light level a monster needs to appear, and the drops of an animal that was killed.
 */
function session(seed = 'e11-mobs'): WorldSession {
  const world = new WorldSession(seed, 'flat');
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) world.loadColumn(x, z);
  for (let i = 0; i < 5; i++) world.simulation.step();
  return world;
}
function step(world: WorldSession, ticks: number): void {
  for (let i = 0; i < ticks; i++) world.simulation.step();
}
/**
 * Records every hit that reaches the player and the tick it landed on. The health bar alone is a
 * poor witness, because natural regeneration moves it in the other direction.
 */
function watchDamage(world: WorldSession): { amount: number; tick: number }[] {
  const sim = world.simulation;
  const hits: { amount: number; tick: number }[] = [];
  const original = sim.damagePlayer.bind(sim);
  (sim as unknown as { damagePlayer: typeof sim.damagePlayer }).damagePlayer = (
    amount: number,
    type: Parameters<typeof sim.damagePlayer>[1],
    from?: Parameters<typeof sim.damagePlayer>[2],
  ) => {
    const dealt = original(amount, type, from) ?? 0;
    if (dealt > 0) hits.push({ amount: dealt, tick: world.world.tick });
    return dealt;
  };
  return hits;
}
/** Places a creature in front of the player and returns it. */
function place(world: WorldSession, kind: string, dx: number, dy = 0, dz = 0) {
  const sim = world.simulation;
  const at = sim.player.position;
  return sim.mobs.spawn(kind, { x: at.x + dx, y: at.y + dy, z: at.z + dz });
}

describe('E11 · the creature catalogue', () => {
  it('describes every reference creature with its hit points and damage', () => {
    const expected: [string, number, number][] = [
      ['lab:zombie', 20, 3],
      ['lab:skeleton', 20, 3],
      ['lab:creeper', 20, 0],
      ['lab:spider', 16, 2],
      ['lab:cow', 10, 0],
      ['lab:sheep', 8, 0],
      ['lab:pig', 10, 0],
      ['lab:chicken', 4, 0],
    ];
    for (const [kind, health, damage] of expected) {
      const definition = mobDefinition(kind);
      expect(definition, kind).toBeDefined();
      expect(definition!.health, kind).toBe(health);
      expect(definition!.damage, kind).toBe(damage);
    }
    // A skeleton is a ranged attacker with an eye height, a creeper carries a blast radius.
    expect(mobDefinition('lab:skeleton')!.ranged).toBe(true);
    expect(mobDefinition('lab:skeleton')!.eyeHeight).toBeCloseTo(1.6, 5);
    expect(mobDefinition('lab:creeper')!.blast).toBe(3);
    // Hostile creatures need the dark, and only the undead burn in the sun.
    expect(mobDefinition('lab:zombie')!.spawnLightMax).toBe(7);
    expect(mobDefinition('lab:zombie')!.burnsInDaylight).toBe(true);
    expect(mobDefinition('lab:cow')!.burnsInDaylight).toBeUndefined();
    expect(MAX_MOBS).toBe(256);
  });
});

describe('E11 · hostile behaviour', () => {
  it('chases the player, hits on a twenty tick cooldown and stops at the reach', () => {
    const world = session();
    const sim = world.simulation;
    sim.survival.difficulty = 'normal';
    const hits = watchDamage(world);
    const zombie = place(world, 'lab:zombie', 8);
    const before = Math.abs(zombie.position.x - sim.player.position.x);
    expect(before).toBeLessThanOrEqual(MOB_CHASE_RANGE);
    // A zombie walks as fast as a player and is on top of them within three seconds.
    step(world, 60);
    const after = Math.abs(zombie.position.x - sim.player.position.x);
    expect(after).toBeLessThan(before);
    expect(after).toBeLessThan(2.5);
    step(world, 120);
    // Melee only lands inside the arm's reach, and it hits for three points a swing.
    expect(zombie.position.x - sim.player.position.x).toBeLessThanOrEqual(2.5);
    expect(sim.survival.health).toBeLessThan(20);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    for (const hit of hits) expect(hit.amount).toBe(3);
    // Twenty ticks between two swings is the reference cooldown.
    for (let i = 1; i < hits.length; i++)
      expect(hits[i].tick - hits[i - 1].tick).toBeGreaterThanOrEqual(20);
    expect(MOB_ATTACK_COOLDOWN).toBe(20);
    expect(MOB_CHASE_RANGE).toBe(16);
  });

  it('keeps its distance as a skeleton and answers with arrows', () => {
    const world = session();
    const sim = world.simulation;
    const hits = watchDamage(world);
    const skeleton = place(world, 'lab:skeleton', 9);
    const start = sim.survival.health;
    step(world, 180);
    // The archer never closes in: it holds its firing band instead of touching the player.
    const distance = Math.abs(skeleton.position.x - sim.player.position.x);
    expect(distance).toBeGreaterThan(MOB_SHOOT_MIN_RANGE);
    expect(distance).toBeLessThanOrEqual(MOB_SHOOT_RANGE);
    // Its arrows land: the player loses hit points at three damage per arrow.
    expect(sim.survival.health).toBeLessThan(start);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    for (const hit of hits) expect(hit.amount).toBe(3);
    // Forty ticks between two arrows, exactly the reference cooldown.
    for (let i = 1; i < hits.length; i++)
      expect(hits[i].tick - hits[i - 1].tick).toBeGreaterThanOrEqual(40);
    expect(MOB_SHOOT_COOLDOWN).toBe(40);
    expect(MOB_SHOOT_PREFERRED).toBe(7);
    expect(mobDefinition('lab:skeleton')!.ranged).toBe(true);
  });

  it('holds fire when the player is standing right next to a skeleton', () => {
    const world = session();
    const sim = world.simulation;
    place(world, 'lab:skeleton', 2);
    const start = sim.survival.health;
    step(world, 40);
    expect(sim.arrows.list).toHaveLength(0);
    expect(sim.survival.health).toBe(start);
    // Closer than the minimum range the bow is useless, that is the reference distance.
    expect(MOB_SHOOT_MIN_RANGE).toBe(2.5);
  });

  it('primes a thirty tick fuse, blows a hole in the wall and backs off when the player runs', () => {
    const world = session();
    const sim = world.simulation;
    const y = 9;
    const wall = Math.floor(sim.player.position.x) - 2;
    const z = Math.floor(sim.player.position.z);
    // A stone wall two blocks in front of the player, so the blast has something to break.
    for (let dy = 0; dy < 3; dy++) sim.setBlockState(wall, y + dy, z, BLOCK.STONE);
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = 0; dy < 3; dy++) sim.setBlockState(wall, y + dy, z + dz, BLOCK.STONE);
    // The creeper stands between the player and the wall, inside its two block arm reach.
    const creeper = sim.mobs.spawn('lab:creeper', { x: wall + 1.2, y, z: z + 0.5 });
    step(world, 3);
    expect(creeper.fuse).toBeGreaterThan(0);
    expect(creeper.fuse).toBeLessThanOrEqual(MOB_FUSE_TICKS);
    expect(MOB_FUSE_TICKS).toBe(30);
    // Nine more ticks are not enough for a blast.
    step(world, 6);
    expect(sim.mobs.list).toContain(creeper);
    expect(world.world.getBlock(wall, y, z)).toBe(BLOCK.STONE);
    step(world, 30);
    expect(sim.mobs.list).not.toContain(creeper);
    expect(world.world.getBlock(wall, y, z)).toBe(BLOCK.AIR);
    // Running away defuses the fuse before it finishes.
    const runner = session('e11-run');
    const other = runner.simulation.mobs.spawn('lab:creeper', {
      x: runner.simulation.player.position.x + 1.4,
      y: runner.simulation.player.position.y,
      z: runner.simulation.player.position.z,
    });
    step(runner, 3);
    expect(other.fuse).toBeGreaterThan(0);
    runner.simulation.player.position.x += 20;
    step(runner, 2);
    expect(other.fuse).toBe(0);
    expect(runner.simulation.mobs.list).toContain(other);
  });

  it('burns an undead creature in the morning sun but leaves a sheep alone', () => {
    const world = session();
    const sim = world.simulation;
    // Noon: the sky is bright and no roof is in the way.
    sim.world.time = 6000;
    const zombie = place(world, 'lab:zombie', 4);
    const sheep = place(world, 'lab:sheep', 6);
    const start = zombie.health;
    step(world, 60);
    expect(zombie.health).toBeLessThan(start);
    expect(sim.mobs.burning).toBeGreaterThan(0);
    expect(sheep.health).toBe(mobDefinition('lab:sheep')!.health);
  });

  it('summons monsters in the dark of the night and animals on lit grass by day', () => {
    const night = session('e11-night');
    night.simulation.naturalSpawns = true;
    night.simulation.world.time = 18_000;
    expect(night.simulation.isNight).toBe(true);
    for (let i = 0; i < 800 && !night.simulation.mobs.list.length; i++) night.simulation.step();
    const monsters = night.simulation.mobs.list.filter(
      (mob) => mobDefinition(mob.kind)!.hostile === true,
    );
    expect(monsters.length).toBeGreaterThan(0);
    const day = session('e11-day');
    day.simulation.naturalSpawns = true;
    day.simulation.world.time = 6000;
    expect(day.simulation.isNight).toBe(false);
    for (let i = 0; i < 800 && !day.simulation.mobs.list.length; i++) day.simulation.step();
    const animals = day.simulation.mobs.list.filter(
      (mob) => mobDefinition(mob.kind)!.hostile === false,
    );
    expect(animals.length).toBeGreaterThan(0);
    // A roof over the pen keeps a monster from appearing in the middle of the day.
    const cellar = session('e11-cellar');
    cellar.simulation.naturalSpawns = true;
    cellar.simulation.world.time = 6000;
    for (let x = -4; x <= 4; x++)
      for (let z = -4; z <= 4; z++) cellar.simulation.setBlockState(x, 12, z, BLOCK.STONE);
    for (let i = 0; i < 600; i++) cellar.simulation.step();
    const spawn = cellar.simulation.mobs.list;
    expect(spawn.length).toBeGreaterThan(0);
    for (const mob of spawn)
      expect(mobDefinition(mob.kind)!.hostile, `${mob.kind} at noon in a roofed pen`).toBe(false);
  });
});

describe('E11 · animals, breeding and drops', () => {
  it('rolls the drops and the experience of every animal that can be killed', () => {
    const world = session();
    const sim = world.simulation;
    const cow = place(world, 'lab:cow', 3);
    const sheep = place(world, 'lab:sheep', 4);
    const pig = place(world, 'lab:pig', 5);
    const chicken = place(world, 'lab:chicken', 6);
    const beef = sim.mobs.hurt(cow, 100)!;
    expect(
      beef.drops.every((drop) => drop.item === 'lab:beef' || drop.item === 'lab:leather'),
    ).toBe(true);
    for (const drop of beef.drops) {
      if (drop.item === 'lab:beef') expect(drop.count).toBeGreaterThanOrEqual(1);
      if (drop.item === 'lab:beef') expect(drop.count).toBeLessThanOrEqual(3);
      if (drop.item === 'lab:leather') expect(drop.count).toBeLessThanOrEqual(2);
    }
    expect(beef.xp).toBe(1);
    const mutton = sim.mobs.hurt(sheep, 100)!;
    expect(mutton.drops.some((drop) => drop.item === 'lab:wool')).toBe(true);
    const pork = sim.mobs.hurt(pig, 100)!;
    expect(pork.drops.some((drop) => drop.item === 'lab:porkchop')).toBe(true);
    const bird = sim.mobs.hurt(chicken, 100)!;
    expect(bird.drops.some((drop) => drop.item === 'lab:chicken')).toBe(true);
    expect(mobDefinition('lab:chicken')!.health).toBe(4);
    expect(mobDefinition('lab:cow')!.health).toBe(10);
  });

  it('breeds two well fed animals into a calf and refuses the wrong food', () => {
    const world = session();
    const sim = world.simulation;
    const first = place(world, 'lab:cow', 3);
    const second = place(world, 'lab:cow', 4);
    expect(sim.mobs.feed(first, 'lab:carrot')).toBe('refused');
    expect(sim.mobs.feed(first, 'lab:wheat')).toBe('fed');
    expect(first.loveTicks).toBe(MOB_LOVE_TICKS);
    expect(MOB_LOVE_TICKS).toBe(600);
    const third = place(world, 'lab:sheep', 5);
    expect(sim.mobs.feed(third, 'lab:wheat')).toBe('fed');
    // The partner has to be in love too, so a lone fed cow is not enough.
    expect(sim.mobs.list).toHaveLength(3);
    expect(sim.mobs.feed(second, 'lab:wheat')).toBe('bred');
    const calf = sim.mobs.list.find((mob) => mob.baby)!;
    expect(calf).toBeDefined();
    expect(calf.kind).toBe('lab:cow');
    expect(calf.health).toBe(mobDefinition('lab:cow')!.health);
    // A fed pig answers to a carrot instead of wheat.
    const pig = place(world, 'lab:pig', 7);
    expect(sim.mobs.feed(pig, 'lab:wheat')).toBe('refused');
    expect(sim.mobs.feed(pig, 'lab:carrot')).toBe('fed');
  });

  it('lets a knocked back creature settle instead of sliding away for ever', () => {
    const world = session();
    const sim = world.simulation;
    // A training dummy has no locomotion of its own, so only the hit and the friction move it.
    const dummy = place(world, 'lab:dummy', 2);
    const start = { x: dummy.position.x, z: dummy.position.z };
    sim.mobs.hurt(dummy, 1, knockbackVector({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, false));
    step(world, 1);
    expect(dummy.velocity.x).toBeGreaterThan(0);
    step(world, 20);
    const travelled = Math.abs(dummy.position.x - start.x);
    // The reference push is about half a block: 0.4 of speed against the ground friction.
    expect(travelled).toBeGreaterThan(0.3);
    expect(travelled).toBeLessThan(0.8);
    expect(Math.abs(dummy.velocity.x)).toBeLessThan(0.01);
    // Standing still for a while is enough: the creature stops where it landed.
    const rest = dummy.position.x;
    step(world, 40);
    expect(Math.abs(dummy.position.x - rest)).toBeLessThan(0.01);
    expect(MOB_IDLE_DRAG).toBe(0.6);
  });

  it('keeps creatures standing on the ground and steps over a single block', () => {
    const world = session();
    const sim = world.simulation;
    const cow = place(world, 'lab:cow', 3, 4);
    const landing = cow.position.y;
    step(world, 60);
    expect(cow.position.y).toBeLessThan(landing);
    expect(cow.onGround).toBe(true);
    // A stone step in the way of a chasing zombie is climbed, not blocked.
    const wall = Math.floor(sim.player.position.x) - 2;
    const z = Math.floor(sim.player.position.z);
    sim.setBlockState(wall, 8, z, BLOCK.STONE);
    const zombie = sim.mobs.spawn('lab:zombie', {
      x: wall - 2.5,
      y: 9,
      z: z + 0.5,
    });
    step(world, 80);
    expect(zombie.position.y).toBeGreaterThanOrEqual(9);
    expect(Math.abs(zombie.position.x - sim.player.position.x)).toBeLessThan(2);
    // Creatures that fall out of the world are removed instead of piling up.
    const void1 = place(world, 'lab:pig', 3, -40);
    step(world, 5);
    expect(sim.mobs.list).not.toContain(void1);
    expect(registry.get(BLOCK.STONE).solid).toBe(true);
  });
});
