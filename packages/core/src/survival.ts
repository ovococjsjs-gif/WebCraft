/**
 * Player survival: health, food, air, experience and the environment damage pipeline.
 * Every number here is a provisional constant recorded from the reference behaviour; the
 * conformance stage (E00) still has to compare them against a live 1.12.2 client.
 */
import type { Vec3 } from './coordinates';
import { EffectStore, type SavedEffect } from './effects';
import { itemRegistry, FIST, type ItemDefinition } from '../../content/src/items';
export type Difficulty = 'peaceful' | 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['peaceful', 'easy', 'normal', 'hard'];
export const DIFFICULTY_NAMES: Record<Difficulty, string> = {
  peaceful: 'Мирная',
  easy: 'Легко',
  normal: 'Обычно',
  hard: 'Сложно',
};
export const MAX_HEALTH = 20;
export const MAX_ABSORPTION = 20;
export const MAX_FOOD = 20;
export const MAX_AIR = 300;
/** Ten ticks of immunity after a hit, so one contact cannot drain a whole health bar. */
export const HURT_RESISTANT_TICKS = 10;
/** Exhaustion needed before one point of saturation or food is spent. */
export const EXHAUSTION_PER_POINT = 4;
export const VOID_DAMAGE_Y = -20;
export type DamageType =
  | 'generic'
  | 'player'
  | 'mob'
  | 'arrow'
  | 'fall'
  | 'in_wall'
  | 'drown'
  | 'starve'
  | 'on_fire'
  | 'lava'
  | 'out_of_world'
  | 'magic'
  | 'poison'
  | 'wither'
  | 'thorns'
  | 'explosion'
  | 'fire';
export interface DamageOptions {
  /** Position the damage came from, used for knockback and shield facing. */
  readonly source?: Vec3 | null;
  /** Damage that armour and resistance do not reduce. */
  readonly bypassArmor?: boolean;
  /** Total armour points of the target, computed from its equipment. */
  readonly armor?: number;
  readonly toughness?: number;
  /** Damage may not push health below this value (poison leaves a survivor). */
  readonly healthFloor?: number;
  /** Ignores the post-hit immunity window, used by continuous hazards. */
  readonly ignoreResistance?: boolean;
}
export interface DamageResult {
  applied: number;
  absorbed: number;
  blocked: boolean;
  died: boolean;
  readonly type: DamageType;
}
export interface SurvivalTickContext {
  /** Standing inside a flame block. */
  readonly inFire?: boolean;
  readonly position: Vec3;
  readonly onGround: boolean;
  readonly flying: boolean;
  readonly inWater: boolean;
  readonly headInWater: boolean;
  readonly inLava: boolean;
  readonly suffocating: boolean;
  readonly difficulty: Difficulty;
  readonly effects: EffectStore;
}
export interface SurvivalTickEvents {
  healed: number;
  damage: DamageResult | null;
  effects: string[];
}
export interface SavedSurvival {
  health: number;
  absorption: number;
  food: number;
  saturation: number;
  exhaustion: number;
  air: number;
  xp: number;
  level: number;
  spawn: Vec3;
  difficulty: Difficulty;
  dead: boolean;
  effects: SavedEffect[];
}
export function defaultSurvival(spawn: Vec3): SavedSurvival {
  return {
    health: MAX_HEALTH,
    absorption: 0,
    food: MAX_FOOD,
    saturation: 5,
    exhaustion: 0,
    air: MAX_AIR,
    xp: 0,
    level: 0,
    spawn: { ...spawn },
    difficulty: 'normal',
    dead: false,
    effects: [],
  };
}
/** Experience needed to go from `level` to `level + 1` in the reference game. */
export function xpToNextLevel(level: number): number {
  if (level >= 32) return 9 * level - 158;
  if (level >= 17) return 5 * level - 38;
  return 2 * level + 7;
}
/** Total experience points that correspond to the start of `level`. */
export function xpForLevel(level: number): number {
  let total = 0;
  for (let i = 0; i < level; i++) total += xpToNextLevel(i);
  return total;
}
export function levelFromXp(points: number): number {
  let level = 0;
  let left = Math.max(0, Math.floor(points));
  while (left >= xpToNextLevel(level) && level < 21863) {
    left -= xpToNextLevel(level);
    level++;
  }
  return level;
}
export interface XpProgress {
  readonly level: number;
  readonly into: number;
  readonly needed: number;
  /** 0..1 for the bar above the hotbar. */
  readonly fraction: number;
}
export function xpProgress(points: number): XpProgress {
  const level = levelFromXp(points);
  const base = xpForLevel(level);
  const needed = xpToNextLevel(level);
  const into = Math.max(0, points - base);
  return { level, into, needed, fraction: Math.min(1, into / needed) };
}
/** Hostile damage is scaled by difficulty; Peaceful removes it entirely. */
export function difficultyDamageScale(difficulty: Difficulty): number {
  if (difficulty === 'peaceful') return 0;
  if (difficulty === 'easy') return 0.5;
  if (difficulty === 'hard') return 1.5;
  return 1;
}
export class Survival {
  health = MAX_HEALTH;
  absorption = 0;
  food = MAX_FOOD;
  saturation = 5;
  exhaustion = 0;
  air = MAX_AIR;
  xp = 0;
  level = 0;
  spawn: Vec3;
  difficulty: Difficulty = 'normal';
  dead = false;
  /** Ticks left of post-hit immunity. */
  hurtResistantTime = 0;
  /** Blocks fallen since leaving the ground, for fall damage. */
  fallDistance = 0;
  fireTicks = 0;
  readonly effects = new EffectStore();
  lastDamageType: DamageType | null = null;
  private regenTimer = 0;
  private starveTimer = 0;
  private lavaTimer = 0;
  private suffocateTimer = 0;
  private voidTimer = 0;
  private poisonTimer = 0;
  private witherTimer = 0;
  constructor(spawn: Vec3) {
    this.spawn = { ...spawn };
  }
  get maxHealth(): number {
    return MAX_HEALTH;
  }
  get healthFraction(): number {
    return this.health / MAX_HEALTH;
  }
  get progress(): XpProgress {
    return xpProgress(this.xp);
  }
  setDifficulty(difficulty: Difficulty): boolean {
    if (!DIFFICULTIES.includes(difficulty)) return false;
    this.difficulty = difficulty;
    return true;
  }
  addExhaustion(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.exhaustion += amount;
    while (this.exhaustion >= EXHAUSTION_PER_POINT) {
      this.exhaustion -= EXHAUSTION_PER_POINT;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.food = Math.max(0, this.food - 1);
    }
  }
  heal(amount: number): number {
    if (this.dead || amount <= 0) return 0;
    const before = this.health;
    this.health = Math.min(MAX_HEALTH, this.health + amount);
    return this.health - before;
  }
  /** Absorption shields soak damage before health, exactly like the reference hearts. */
  addAbsorption(amount: number): void {
    this.absorption = Math.min(MAX_ABSORPTION, Math.max(0, this.absorption + amount));
  }
  eat(item: ItemDefinition | undefined): boolean {
    if (this.dead || !item?.food) return false;
    // The reference refuses food at a full bar unless it grants an instant effect.
    if (this.food >= MAX_FOOD) return false;
    this.food = Math.min(MAX_FOOD, this.food + item.food.nutrition);
    this.saturation = Math.min(this.food, this.saturation + item.food.saturation);
    return true;
  }
  hurt(amount: number, type: DamageType, options: DamageOptions = {}): DamageResult {
    const result: DamageResult = {
      applied: 0,
      absorbed: 0,
      blocked: false,
      died: false,
      type,
    };
    if (this.dead || !Number.isFinite(amount) || amount <= 0) return result;
    const ignoresWindow = type === 'out_of_world' || options.ignoreResistance;
    if (this.hurtResistantTime > 0 && !ignoresWindow) return result;
    let damage = amount;
    if (!options.bypassArmor) {
      const armor = options.armor ?? 0;
      damage = reduceByArmor(damage, armor, options.toughness ?? 0);
      const resistance = this.effects.level('resistance');
      if (resistance > 0) damage *= Math.max(0, 1 - 0.2 * resistance);
    }
    if (type === 'on_fire' || type === 'lava') {
      if (this.effects.has('fire_resistance')) return result;
    }
    if (damage <= 0) return result;
    if (this.absorption > 0) {
      const soaked = Math.min(this.absorption, damage);
      this.absorption -= soaked;
      damage -= soaked;
      result.absorbed = soaked;
    }
    if (damage <= 0) return result;
    const floor = options.healthFloor ?? 0;
    const allowed = Math.max(0, this.health - floor);
    const applied = Math.min(damage, allowed);
    this.health -= applied;
    this.hurtResistantTime = HURT_RESISTANT_TICKS;
    this.lastDamageType = type;
    result.applied = applied;
    // Taking a hit is exhausting in the reference game as well.
    this.addExhaustion(0.1);
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      result.died = true;
    }
    return result;
  }
  /** Fall damage uses the reference formula: whole blocks beyond the third one. */
  landingDamage(fallDistance: number): number {
    return Math.max(0, Math.floor(fallDistance - 3));
  }
  die(): void {
    this.health = 0;
    this.dead = true;
    this.clearHazards();
  }
  respawn(at?: Vec3): void {
    this.lastDamageType = null;
    this.health = MAX_HEALTH;
    this.absorption = 0;
    this.food = MAX_FOOD;
    this.saturation = 5;
    this.exhaustion = 0;
    this.air = MAX_AIR;
    this.dead = false;
    this.hurtResistantTime = 0;
    this.clearHazards();
    this.effects.clear();
    if (at) this.spawn = { ...at };
  }
  setSpawn(at: Vec3): void {
    this.spawn = { ...at };
  }
  addXp(points: number): { levels: number; level: number } {
    if (!Number.isFinite(points) || points === 0) return { levels: 0, level: this.level };
    const before = this.progress.level;
    this.xp = Math.max(0, this.xp + points);
    const after = this.progress.level;
    this.level = after;
    return { levels: after - before, level: after };
  }
  /** Experience a death drops: the reference keeps at most a hundred points. */
  xpToDrop(): number {
    return Math.min(this.progress.level * 7, 100);
  }
  /** Spent by enchanting and repairs in a later stage; kept here so levels cannot go negative. */
  spendLevels(count: number): boolean {
    if (count <= 0 || this.progress.level < count) return false;
    this.xp = xpForLevel(this.progress.level - count);
    this.level = this.progress.level;
    return true;
  }
  private clearHazards(): void {
    this.fallDistance = 0;
    this.fireTicks = 0;
    this.regenTimer = 0;
    this.starveTimer = 0;
    this.lavaTimer = 0;
    this.suffocateTimer = 0;
    this.voidTimer = 0;
    this.poisonTimer = 0;
  }
  /** One tick of natural regeneration, food drain and environmental damage. */
  tick(context: SurvivalTickContext): SurvivalTickEvents {
    const events: SurvivalTickEvents = { healed: 0, damage: null, effects: [] };
    if (this.hurtResistantTime > 0) this.hurtResistantTime--;
    const expired = this.effects.tick();
    for (const change of expired) events.effects.push(change.id);
    if (this.dead) return events;
    if (this.fireTicks > 0) {
      this.fireTicks--;
      if (this.fireTicks % 20 === 0 && !context.effects.has('fire_resistance'))
        events.damage = this.hurt(1, 'on_fire', { bypassArmor: true, ignoreResistance: true });
    }
    if (context.inLava) {
      this.fireTicks = Math.max(this.fireTicks, 300);
      this.lavaTimer++;
      if (this.lavaTimer % 10 === 0)
        events.damage =
          this.hurt(4, 'lava', { bypassArmor: true, ignoreResistance: true }) ?? events.damage;
    } else this.lavaTimer = 0;
    if (context.inFire) this.fireTicks = Math.max(this.fireTicks, 120);
    if (context.headInWater && !context.effects.has('water_breathing')) {
      this.air--;
      if (this.air <= -20) {
        this.air = 0;
        events.damage = this.hurt(2, 'drown', { bypassArmor: true, ignoreResistance: true });
      }
    } else if (this.air < MAX_AIR) {
      this.air = Math.min(MAX_AIR, this.air + 4);
    }
    if (context.suffocating) {
      this.suffocateTimer++;
      if (this.suffocateTimer % 10 === 0)
        events.damage = this.hurt(1, 'in_wall', { bypassArmor: true, ignoreResistance: true });
    } else this.suffocateTimer = 0;
    if (context.position.y < VOID_DAMAGE_Y) {
      this.voidTimer++;
      if (this.voidTimer % 10 === 0)
        events.damage = this.hurt(4, 'out_of_world', { bypassArmor: true, ignoreResistance: true });
    }
    const poison = this.effects.level('poison');
    if (poison > 0) {
      this.poisonTimer++;
      // Poison cannot kill: the reference stops one half-heart short.
      if (this.poisonTimer % Math.max(1, 25 >> (poison - 1)) === 0)
        events.damage = this.hurt(1, 'poison', {
          bypassArmor: true,
          ignoreResistance: true,
          healthFloor: 1,
        });
    } else this.poisonTimer = 0;
    const wither = this.effects.level('wither');
    if (wither > 0) {
      this.witherTimer++;
      if (this.witherTimer % Math.max(1, 40 >> (wither - 1)) === 0)
        events.damage = this.hurt(1, 'wither', { bypassArmor: true, ignoreResistance: true });
    } else this.witherTimer = 0;
    const regeneration = this.effects.level('regeneration');
    if (regeneration > 0) {
      this.regenTimer++;
      if (this.regenTimer >= Math.max(1, Math.floor(50 / (regeneration + 1)))) {
        this.regenTimer = 0;
        events.healed += this.heal(1);
      }
    }
    if (this.dead) return events;
    if (context.difficulty === 'peaceful') {
      // Peaceful heals on its own timer, no matter how empty the hunger bar is.
      if (this.health < MAX_HEALTH) {
        this.regenTimer++;
        if (this.regenTimer >= 20) {
          this.regenTimer = 0;
          events.healed += this.heal(1);
        }
      }
      return events;
    }
    if (regeneration === 0 && this.health < MAX_HEALTH && this.food >= 18) {
      this.regenTimer++;
      const fast = this.food >= MAX_FOOD && this.saturation > 0;
      if (this.regenTimer >= (fast ? 10 : 80)) {
        this.regenTimer = 0;
        this.addExhaustion(6);
        events.healed += this.heal(1);
      }
    } else if (this.health >= MAX_HEALTH) this.regenTimer = 0;
    if (this.food <= 0 && this.effects.level('hunger') === 0) {
      // Easy difficulty stops at five hearts, Normal and Hard do not.
      const stops = context.difficulty === 'easy' && this.health <= 10;
      if (!stops) {
        this.starveTimer++;
        if (this.starveTimer >= 80) {
          this.starveTimer = 0;
          const amount = context.difficulty === 'hard' ? 2 : 1;
          events.damage = this.hurt(amount, 'starve', { bypassArmor: true });
        }
      }
    } else this.starveTimer = 0;
    return events;
  }
  snapshot(): SavedSurvival {
    return {
      health: this.health,
      absorption: this.absorption,
      food: this.food,
      saturation: this.saturation,
      exhaustion: this.exhaustion,
      air: this.air,
      xp: this.xp,
      level: this.progress.level,
      spawn: { ...this.spawn },
      difficulty: this.difficulty,
      dead: this.dead,
      effects: this.effects.snapshot(),
    };
  }
  restore(data: SavedSurvival): void {
    this.health = Math.max(0, Math.min(MAX_HEALTH, data.health));
    this.absorption = Math.max(0, Math.min(MAX_ABSORPTION, data.absorption));
    this.food = Math.max(0, Math.min(MAX_FOOD, data.food));
    this.saturation = Math.max(0, Math.min(MAX_FOOD, data.saturation));
    this.exhaustion = Math.max(0, Math.min(EXHAUSTION_PER_POINT, data.exhaustion));
    this.air = Math.max(-20, Math.min(MAX_AIR, data.air));
    this.xp = Math.max(0, data.xp);
    this.spawn = { ...data.spawn };
    this.setDifficulty(data.difficulty);
    this.dead = data.dead || this.health <= 0;
    this.hurtResistantTime = 0;
    this.level = this.progress.level;
    this.effects.restore(data.effects);
  }
}
/** Armour is a percentage reduction, not a flat subtraction; the formula is the 1.12 one. */
export function reduceByArmor(damage: number, armor: number, toughness = 0): number {
  const effective = Math.min(20, Math.max(armor / 5, armor - damage / (2 + toughness / 4)));
  return damage * (1 - effective / 25);
}
export function attackStatsOf(item: ItemDefinition | undefined): { damage: number; speed: number } {
  return item?.attack ?? FIST;
}
export function foodName(item: string): string {
  return itemRegistry.find(item)?.name ?? item;
}
export { itemRegistry };
