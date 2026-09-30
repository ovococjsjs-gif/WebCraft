import { describe, it, expect } from 'vitest';
import {
  Survival,
  MAX_HEALTH,
  MAX_FOOD,
  MAX_AIR,
  difficultyDamageScale,
  levelFromXp,
  reduceByArmor,
  xpForLevel,
  xpProgress,
  xpToNextLevel,
} from '../../packages/core/src/survival';
import { EffectStore } from '../../packages/core/src/effects';
import { ARMOR_SLOT_ORDER, IRON_ARMOR } from '../../packages/content/src/items';

const spawn = { x: 0, y: 8, z: 0 };
function fresh() {
  return new Survival(spawn);
}
function context(overrides: Partial<Parameters<Survival['tick']>[0]> = {}) {
  return {
    position: spawn,
    onGround: true,
    flying: false,
    inWater: false,
    headInWater: false,
    inLava: false,
    suffocating: false,
    difficulty: 'normal' as const,
    effects: new EffectStore(),
    ...overrides,
  };
}

describe('survival numbers', () => {
  it('follows the reference experience curve', () => {
    expect(xpToNextLevel(0)).toBe(7);
    expect(xpToNextLevel(16)).toBe(39);
    expect(xpToNextLevel(17)).toBe(47);
    expect(xpToNextLevel(31)).toBe(117);
    expect(xpToNextLevel(32)).toBe(130);
    expect(xpForLevel(2)).toBe(16);
    expect(levelFromXp(0)).toBe(0);
    expect(levelFromXp(7)).toBe(1);
    expect(levelFromXp(15)).toBe(1);
    expect(levelFromXp(16)).toBe(2);
    const progress = xpProgress(20);
    expect(progress.level).toBe(2);
    expect(progress.into).toBe(4);
    expect(progress.needed).toBe(11);
  });
  it('reduces damage by armour points with the reference formula', () => {
    // 10 armour points against 8 damage: the effective value is 10 - 8/2 = 6 points.
    expect(reduceByArmor(8, 10)).toBeCloseTo(8 * (1 - 6 / 25), 6);
    expect(reduceByArmor(20, 20)).toBeCloseTo(20 * (1 - 10 / 25), 6);
    expect(reduceByArmor(1, 0)).toBe(1);
    // Iron armour is 15 points in total, as in the reference set.
    const iron = ARMOR_SLOT_ORDER.reduce((sum, slot) => sum + IRON_ARMOR[slot].points, 0);
    expect(iron).toBe(15);
  });
  it('scales hostile damage by difficulty and removes it on Peaceful', () => {
    expect(difficultyDamageScale('peaceful')).toBe(0);
    expect(difficultyDamageScale('easy')).toBe(0.5);
    expect(difficultyDamageScale('normal')).toBe(1);
    expect(difficultyDamageScale('hard')).toBe(1.5);
  });
});

describe('hunger, regeneration and damage', () => {
  it('spends saturation before food and needs four exhaustion per point', () => {
    const survival = fresh();
    survival.exhaustion = 0;
    survival.addExhaustion(3.9);
    expect(survival.saturation).toBe(5);
    expect(survival.food).toBe(MAX_FOOD);
    survival.addExhaustion(0.2);
    expect(survival.saturation).toBe(4);
    expect(survival.food).toBe(MAX_FOOD);
    survival.saturation = 0;
    survival.addExhaustion(4);
    expect(survival.food).toBe(MAX_FOOD - 1);
  });
  it('heals slowly at food 18 and quickly with full food and saturation', () => {
    const survival = fresh();
    survival.health = 10;
    survival.food = 18;
    survival.saturation = 0;
    for (let i = 0; i < 79; i++) survival.tick(context());
    expect(survival.health).toBe(10);
    survival.tick(context());
    expect(survival.health).toBe(11);
    survival.health = 10;
    survival.food = MAX_FOOD;
    survival.saturation = 5;
    for (let i = 0; i < 10; i++) survival.tick(context());
    expect(survival.health).toBe(11);
  });
  it('starves after eighty empty ticks and stops at five hearts on Easy', () => {
    const survival = fresh();
    survival.food = 0;
    survival.saturation = 0;
    for (let i = 0; i < 80; i++) survival.tick(context());
    expect(survival.health).toBe(MAX_HEALTH - 1);
    const easy = fresh();
    easy.setDifficulty('easy');
    easy.food = 0;
    easy.saturation = 0;
    easy.health = 10;
    for (let i = 0; i < 200; i++) easy.tick(context({ difficulty: 'easy' }));
    expect(easy.health).toBe(10);
    const peaceful = fresh();
    peaceful.setDifficulty('peaceful');
    peaceful.food = 0;
    peaceful.saturation = 0;
    peaceful.health = 12;
    for (let i = 0; i < 200; i++) peaceful.tick(context({ difficulty: 'peaceful' }));
    expect(peaceful.health).toBe(MAX_HEALTH);
  });
  it('turns fall distance into damage only beyond three blocks', () => {
    const survival = fresh();
    expect(survival.landingDamage(3)).toBe(0);
    expect(survival.landingDamage(3.9)).toBe(0);
    expect(survival.landingDamage(4)).toBe(1);
    expect(survival.landingDamage(12.4)).toBe(9);
  });
  it('drowns after the air runs out and recovers it above water', () => {
    const survival = fresh();
    for (let i = 0; i < MAX_AIR; i++) survival.tick(context({ headInWater: true }));
    expect(survival.health).toBe(MAX_HEALTH);
    expect(survival.air).toBeLessThanOrEqual(0);
    for (let i = 0; i < 20; i++) survival.tick(context({ headInWater: true }));
    expect(survival.health).toBe(MAX_HEALTH - 2);
    for (let i = 0; i < 10; i++) survival.tick(context({ headInWater: false }));
    expect(survival.air).toBeGreaterThan(0);
  });
  it('hurts in lava, inside a block and below the world', () => {
    const lava = fresh();
    for (let i = 0; i < 10; i++) lava.tick(context({ inLava: true }));
    expect(lava.health).toBeLessThan(MAX_HEALTH);
    expect(lava.fireTicks).toBeGreaterThan(0);
    const wall = fresh();
    for (let i = 0; i < 10; i++) wall.tick(context({ suffocating: true }));
    expect(wall.health).toBe(MAX_HEALTH - 1);
    const void_ = fresh();
    for (let i = 0; i < 10; i++) void_.tick(context({ position: { x: 0, y: -21, z: 0 } }));
    expect(void_.health).toBe(MAX_HEALTH - 4);
    expect(void_.lastDamageType).toBe('out_of_world');
  });
  it('gives ten ticks of immunity between hits', () => {
    const survival = fresh();
    const first = survival.hurt(4, 'mob');
    expect(first.applied).toBe(4);
    const second = survival.hurt(4, 'mob');
    expect(second.applied).toBe(0);
    for (let i = 0; i < 10; i++) survival.tick(context());
    expect(survival.hurt(4, 'mob').applied).toBe(4);
  });
  it('spends absorption before health and lets resistance cut damage', () => {
    const survival = fresh();
    survival.addAbsorption(3);
    const result = survival.hurt(5, 'mob');
    expect(result.absorbed).toBe(3);
    expect(result.applied).toBe(2);
    expect(survival.health).toBe(MAX_HEALTH - 2);
    survival.addAbsorption(0);
    survival.effects.apply('resistance', 200, 1);
    survival.hurtResistantTime = 0;
    // Resistance II removes 40% of the incoming damage.
    expect(survival.hurt(10, 'mob').applied).toBeCloseTo(6, 6);
  });
  it('never lets poison kill the player', () => {
    const survival = fresh();
    survival.health = 2;
    // Food at 17 keeps natural regeneration out of the way, so only poison is measured.
    survival.food = 17;
    survival.saturation = 0;
    survival.effects.apply('poison', 200, 0);
    for (let i = 0; i < 200; i++) survival.tick(context());
    expect(survival.health).toBe(1);
    expect(survival.dead).toBe(false);
  });
  it('dies, keeps the spawn point and returns with a full bar', () => {
    const survival = fresh();
    survival.hurt(MAX_HEALTH, 'fall');
    expect(survival.dead).toBe(true);
    expect(survival.health).toBe(0);
    survival.die();
    expect(survival.dead).toBe(true);
    survival.respawn();
    expect(survival.health).toBe(MAX_HEALTH);
    expect(survival.food).toBe(MAX_FOOD);
    expect(survival.dead).toBe(false);
    expect(survival.spawn).toEqual(spawn);
  });
  it('drops at most a hundred experience points on death', () => {
    const survival = fresh();
    survival.addXp(xpForLevel(30) + 5);
    expect(survival.progress.level).toBe(30);
    expect(survival.xpToDrop()).toBe(100);
    survival.xp = 40;
    expect(survival.xpToDrop()).toBe(Math.min(survival.progress.level * 7, 100));
  });
  it('round-trips through a saved shape', () => {
    const survival = fresh();
    survival.health = 13;
    survival.food = 7;
    survival.saturation = 2.5;
    survival.addXp(30);
    survival.effects.apply('speed', 400, 1);
    survival.setSpawn({ x: 4, y: 9, z: -2 });
    survival.setDifficulty('hard');
    const saved = survival.snapshot();
    const restored = fresh();
    restored.restore(saved);
    expect(restored.health).toBe(13);
    expect(restored.food).toBe(7);
    expect(restored.progress.level).toBe(survival.progress.level);
    expect(restored.effects.level('speed')).toBe(2);
    expect(restored.difficulty).toBe('hard');
    expect(restored.spawn).toEqual({ x: 4, y: 9, z: -2 });
  });
});
