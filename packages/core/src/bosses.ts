/**
 * The bosses: the ender dragon that circles the fountain of the End, the end crystals that heal
 * it, and the wither a player builds out of soul sand and three skulls.
 *
 * Both bosses are kinematic: their position follows a plan (a circle, a dive, a perch, a flight
 * towards the player) instead of an integrator, which keeps a fight readable and a save small.
 * Everything they do to the world goes back through the context the simulation hands them, so
 * an explosion, a block or a hit is journalled exactly like the player's own actions.
 */
import { BLOCK, registry } from '../../content/src/blocks';
import type { Vec3 } from './coordinates';
import type { VoxelWorld } from './world';
import { END_FOUNTAIN } from './end';

export type BossKind = 'ender_dragon' | 'wither';
/** A dragon circles, dives at the player and rests on the fountain between dives. */
export type DragonPhase = 'circling' | 'charging' | 'perched';

export const DRAGON_HEALTH = 200;
export const WITHER_HEALTH = 300;
export const DRAGON_CIRCLE_RADIUS = 34;
export const DRAGON_CIRCLE_SPEED = 0.022;
export const DRAGON_DIVE_SPEED = 0.85;
export const DRAGON_PERCH_TICKS = 140;
export const DRAGON_CONTACT_DAMAGE = 6;
export const DRAGON_CONTACT_RANGE = 4.5;
export const WITHER_CONTACT_DAMAGE = 5;
export const WITHER_CONTACT_RANGE = 2.4;
export const WITHER_SPEED = 0.28;
export const WITHER_SKULL_COOLDOWN = 40;
export const WITHER_SKULL_SPEED = 0.55;
export const WITHER_SKULL_DAMAGE = 8;
export const WITHER_SKULL_EXPLOSION = 2;
export const SKULL_LIFE_TICKS = 120;
export const CRYSTAL_HEALTH = 1;
export const CRYSTAL_RANGE = 40;
export const CRYSTAL_HEAL_TICKS = 10;
export const CRYSTAL_EXPLOSION = 3;
/** Blocks a crystal may stand on: the altar of the End and the fountain itself. */
const CRYSTAL_BASE: ReadonlySet<number> = new Set<number>([BLOCK.OBSIDIAN, BLOCK.BEDROCK]);

export interface BossEntity {
  id: number;
  kind: BossKind;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  health: number;
  maxHealth: number;
  phase: DragonPhase;
  phaseTicks: number;
  /** Angle on the circle the dragon is flying, in radians. */
  angle: number;
  /** Where the dragon and the wither return to when the fight restarts. */
  home: Vec3;
  hurtTime: number;
  attackCooldown: number;
  /** Ticks before the boss may touch the player again. */
  touchCooldown: number;
}
export interface EndCrystalEntity {
  id: number;
  position: Vec3;
}
export interface WitherSkull {
  id: number;
  position: Vec3;
  velocity: Vec3;
  life: number;
}
export interface BossDeath {
  kind: BossKind;
  position: Vec3;
}
export interface BossTickContext {
  readonly world: VoxelWorld;
  readonly playerPosition: Vec3;
  readonly playerDead: boolean;
  readonly hurtPlayer: (amount: number, type: 'mob' | 'magic', from: Vec3) => void;
  /** Explosion in the world: blocks, drops and the push everything near gets. */
  readonly explode: (x: number, y: number, z: number, radius: number) => void;
  readonly random: () => number;
}
export interface SavedBoss {
  kind: BossKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  phase: DragonPhase;
  angle: number;
  homeX: number;
  homeY: number;
  homeZ: number;
}
export interface SavedCrystal {
  x: number;
  y: number;
  z: number;
}
export interface SavedBossState {
  dragonDefeated?: boolean;
  dragonEncountered?: boolean;
  bosses: SavedBoss[];
  crystals: SavedCrystal[];
}

export class BossStore {
  private nextId = 1;
  dragonDefeated = false;
  dragonEncountered = false;
  readonly list: BossEntity[] = [];
  readonly crystals: EndCrystalEntity[] = [];
  readonly skulls: WitherSkull[] = [];
  /** Ticks since the crystals last healed the dragon, so healing is not once per crystal. */
  private healTicks = 0;

  get dragon(): BossEntity | undefined {
    return this.list.find((boss) => boss.kind === 'ender_dragon');
  }
  get wither(): BossEntity | undefined {
    return this.list.find((boss) => boss.kind === 'wither');
  }
  byId(id: number): BossEntity | undefined {
    return this.list.find((boss) => boss.id === id);
  }
  /** The boss the interface puts a health bar for: the one nearest the player. */
  nearest(position: Vec3, range = 96): BossEntity | undefined {
    let best: BossEntity | undefined,
      bestDistance = range;
    for (const boss of this.list) {
      const distance = Math.hypot(
        boss.position.x - position.x,
        boss.position.y - position.y,
        boss.position.z - position.z,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = boss;
      }
    }
    return best;
  }
  spawnBoss(kind: BossKind, position: Vec3, home: Vec3 = endFountainHome()): BossEntity {
    const boss: BossEntity = {
      id: this.nextId++,
      kind,
      position: { ...position },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: 0,
      health: kind === 'ender_dragon' ? DRAGON_HEALTH : WITHER_HEALTH,
      maxHealth: kind === 'ender_dragon' ? DRAGON_HEALTH : WITHER_HEALTH,
      phase: 'circling',
      phaseTicks: 0,
      angle: 0,
      home: { ...home },
      hurtTime: 0,
      attackCooldown: 0,
      touchCooldown: 0,
    };
    if (kind === 'ender_dragon') {
      this.dragonEncountered = true;
      this.dragonDefeated = false;
    }
    this.list.push(boss);
    return boss;
  }
  /** Puts the end crystals on the pillars: without them the dragon never heals. */
  addCrystal(position: Vec3): EndCrystalEntity {
    const existing = this.crystalAt(position.x, position.y, position.z);
    if (existing) return existing;
    const crystal: EndCrystalEntity = { id: this.nextId++, position: { ...position } };
    this.crystals.push(crystal);
    return crystal;
  }
  crystalAt(x: number, y: number, z: number): EndCrystalEntity | undefined {
    return this.crystals.find(
      (crystal) =>
        Math.floor(crystal.position.x) === Math.floor(x) &&
        Math.floor(crystal.position.y) === Math.floor(y) &&
        Math.floor(crystal.position.z) === Math.floor(z),
    );
  }
  /** A crystal may only stand on obsidian or bedrock, as in the reference. */
  crystalPlaceAllowed(world: VoxelWorld, x: number, y: number, z: number): boolean {
    return (
      CRYSTAL_BASE.has(world.getBlock(x, y - 1, z)) &&
      world.getBlock(x, y, z) === BLOCK.AIR &&
      !this.crystalAt(x, y, z)
    );
  }
  /**
   * Damage to a boss. The dragon ignores a hit while it is perched on the fountain only in the
   * sense that it is hard to reach there; every hit the player lands counts.
   */
  hurt(boss: BossEntity, amount: number): BossDeath | null {
    if (!this.list.includes(boss) || amount <= 0) return null;
    boss.health -= amount;
    boss.hurtTime = 10;
    if (boss.health > 0) return null;
    if (boss.kind === 'ender_dragon') this.dragonDefeated = true;
    this.list.splice(this.list.indexOf(boss), 1);
    return { kind: boss.kind, position: { ...boss.position } };
  }
  /** A crystal takes one hit; breaking it explodes and may hurt the dragon through the blast. */
  hurtCrystal(crystal: EndCrystalEntity, context: BossTickContext): void {
    const index = this.crystals.indexOf(crystal);
    if (index < 0) return;
    this.crystals.splice(index, 1);
    context.explode(
      Math.floor(crystal.position.x),
      Math.floor(crystal.position.y),
      Math.floor(crystal.position.z),
      CRYSTAL_EXPLOSION,
    );
  }
  /** The wither's skulls damage the player and burst on the first block they meet. */
  private tickSkulls(context: BossTickContext): void {
    const player = context.playerPosition;
    for (let index = this.skulls.length - 1; index >= 0; index--) {
      const skull = this.skulls[index];
      skull.position = {
        x: skull.position.x + skull.velocity.x,
        y: skull.position.y + skull.velocity.y,
        z: skull.position.z + skull.velocity.z,
      };
      skull.life--;
      const dx = skull.position.x - player.x,
        dy = skull.position.y - (player.y + 1),
        dz = skull.position.z - player.z;
      if (Math.hypot(dx, dy, dz) <= 1.2) {
        if (!context.playerDead) context.hurtPlayer(WITHER_SKULL_DAMAGE, 'magic', skull.position);
        context.explode(
          Math.floor(skull.position.x),
          Math.floor(skull.position.y),
          Math.floor(skull.position.z),
          WITHER_SKULL_EXPLOSION,
        );
        this.skulls.splice(index, 1);
        continue;
      }
      const block = context.world.getBlock(
        Math.floor(skull.position.x),
        Math.floor(skull.position.y),
        Math.floor(skull.position.z),
      );
      if (registry.get(block).solid || skull.life <= 0) {
        context.explode(
          Math.floor(skull.position.x),
          Math.floor(skull.position.y),
          Math.floor(skull.position.z),
          skull.life <= 0 ? 0 : WITHER_SKULL_EXPLOSION,
        );
        this.skulls.splice(index, 1);
      }
    }
  }
  private tickDragon(boss: BossEntity, context: BossTickContext): void {
    const player = context.playerPosition;
    const home = boss.home;
    if (boss.phase === 'perched') {
      boss.phaseTicks++;
      boss.position = { x: home.x + 0.5, y: home.y + 4, z: home.z + 0.5 };
      boss.velocity = { x: 0, y: 0, z: 0 };
      boss.attackCooldown = Math.max(0, boss.attackCooldown - 1);
      const distance = Math.hypot(player.x - boss.position.x, player.z - boss.position.z);
      if (
        boss.attackCooldown === 0 &&
        distance <= DRAGON_CONTACT_RANGE + 2 &&
        !context.playerDead
      ) {
        context.hurtPlayer(DRAGON_CONTACT_DAMAGE, 'mob', boss.position);
        boss.attackCooldown = 30;
      }
      if (boss.phaseTicks >= DRAGON_PERCH_TICKS) {
        boss.phase = 'circling';
        boss.phaseTicks = 0;
      }
      return;
    }
    if (boss.phase === 'charging') {
      const target = { x: player.x, y: player.y + 1, z: player.z };
      const dx = target.x - boss.position.x,
        dy = target.y - boss.position.y,
        dz = target.z - boss.position.z;
      const distance = Math.hypot(dx, dy, dz) || 1;
      boss.velocity = {
        x: (dx / distance) * DRAGON_DIVE_SPEED,
        y: (dy / distance) * DRAGON_DIVE_SPEED,
        z: (dz / distance) * DRAGON_DIVE_SPEED,
      };
      boss.position = {
        x: boss.position.x + boss.velocity.x,
        y: boss.position.y + boss.velocity.y,
        z: boss.position.z + boss.velocity.z,
      };
      boss.yaw = Math.atan2(-boss.velocity.x, -boss.velocity.z);
      boss.phaseTicks++;
      const touching =
        Math.hypot(player.x - boss.position.x, player.z - boss.position.z) <= 2.5 &&
        Math.abs(player.y - boss.position.y) <= 2.5;
      if (touching && !context.playerDead) {
        context.hurtPlayer(DRAGON_CONTACT_DAMAGE, 'mob', boss.position);
        boss.phase = 'circling';
        boss.phaseTicks = 0;
        return;
      }
      // A dive ends when it reaches the player's height or gets tired of chasing.
      if (distance <= 1.2 || boss.phaseTicks > 120) {
        boss.phase = 'perched';
        boss.phaseTicks = 0;
        boss.attackCooldown = 20;
      }
      return;
    }
    // Circling: a slow arc around the fountain, high above the island.
    boss.angle += DRAGON_CIRCLE_SPEED;
    boss.phaseTicks++;
    const previous = { ...boss.position };
    const altitude = home.y + 22 + Math.sin(boss.angle * 3) * 5;
    boss.position = {
      x: home.x + Math.cos(boss.angle) * DRAGON_CIRCLE_RADIUS,
      y: altitude,
      z: home.z + Math.sin(boss.angle) * DRAGON_CIRCLE_RADIUS,
    };
    boss.velocity = {
      x: boss.position.x - previous.x,
      y: boss.position.y - previous.y,
      z: boss.position.z - previous.z,
    };
    boss.yaw = Math.atan2(-boss.velocity.x, -boss.velocity.z);
    const toPlayer = Math.hypot(player.x - boss.position.x, player.z - boss.position.z);
    if (boss.phaseTicks > 90 && toPlayer < 40) {
      boss.phase = 'charging';
      boss.phaseTicks = 0;
    }
  }
  private tickWither(boss: BossEntity, context: BossTickContext): void {
    const player = context.playerPosition;
    const dx = player.x - boss.position.x,
      dz = player.z - boss.position.z;
    const flat = Math.hypot(dx, dz) || 1;
    const target = {
      x: player.x,
      y: player.y + 2 + Math.sin(boss.phaseTicks / 24) * 1.5,
      z: player.z,
    };
    const dy = target.y - boss.position.y;
    const dive = Math.hypot(dx, dy, dz) || 1;
    const step = flat > 2.5 ? WITHER_SPEED : WITHER_SPEED * 0.2;
    boss.position = {
      x: boss.position.x + (dx / dive) * step,
      y: boss.position.y + (dy / Math.max(1, Math.abs(dy))) * step * 0.6,
      z: boss.position.z + (dz / dive) * step,
    };
    boss.yaw = Math.atan2(-dx, -dz);
    boss.phaseTicks++;
    boss.attackCooldown = Math.max(0, boss.attackCooldown - 1);
    if (boss.attackCooldown === 0 && !context.playerDead) {
      const distance = Math.hypot(dx, dy, dz) || 1;
      this.skulls.push({
        id: this.nextId++,
        position: { x: boss.position.x, y: boss.position.y - 1, z: boss.position.z },
        velocity: {
          x: (dx / distance) * WITHER_SKULL_SPEED,
          y: (dy / distance) * WITHER_SKULL_SPEED,
          z: (dz / distance) * WITHER_SKULL_SPEED,
        },
        life: SKULL_LIFE_TICKS,
      });
      boss.attackCooldown = WITHER_SKULL_COOLDOWN;
    }
    // Contact damage has its own cooldown, as the wither cannot hit every tick.
    if (
      flat <= WITHER_CONTACT_RANGE &&
      Math.abs(player.y - boss.position.y) <= 2 &&
      boss.touchCooldown === 0 &&
      !context.playerDead
    ) {
      context.hurtPlayer(WITHER_CONTACT_DAMAGE, 'mob', boss.position);
      boss.touchCooldown = 20;
    }
    boss.touchCooldown = Math.max(0, boss.touchCooldown - 1);
  }
  /**
   * Every tick of every fight. Crystals mend the dragon; a broken crystal hurts it a little, as
   * the reference does: a crystal that goes up takes a bite out of the dragon.
   */
  tick(context: BossTickContext): void {
    this.tickSkulls(context);
    for (const boss of this.list) {
      if (boss.hurtTime > 0) boss.hurtTime--;
      if (boss.kind === 'ender_dragon') this.tickDragon(boss, context);
      else this.tickWither(boss, context);
    }
    const dragon = this.dragon;
    if (!dragon || this.crystals.length === 0) {
      this.healTicks = 0;
      return;
    }
    this.healTicks++;
    if (this.healTicks < CRYSTAL_HEAL_TICKS) return;
    this.healTicks = 0;
    const near = this.crystals.some(
      (crystal) =>
        Math.hypot(
          crystal.position.x - dragon.position.x,
          crystal.position.y - dragon.position.y,
          crystal.position.z - dragon.position.z,
        ) <= CRYSTAL_RANGE,
    );
    if (near) dragon.health = Math.min(dragon.maxHealth, dragon.health + CRYSTAL_HEALTH);
  }
  snapshot(): SavedBossState {
    return {
      dragonDefeated: this.dragonDefeated,
      dragonEncountered: this.dragonEncountered,
      bosses: this.list.map((boss) => ({
        kind: boss.kind,
        x: boss.position.x,
        y: boss.position.y,
        z: boss.position.z,
        yaw: boss.yaw,
        health: boss.health,
        phase: boss.phase,
        angle: boss.angle,
        homeX: boss.home.x,
        homeY: boss.home.y,
        homeZ: boss.home.z,
      })),
      crystals: this.crystals.map((crystal) => ({
        x: crystal.position.x,
        y: crystal.position.y,
        z: crystal.position.z,
      })),
    };
  }
  restore(data: SavedBossState | undefined): void {
    this.list.length = 0;
    this.crystals.length = 0;
    this.skulls.length = 0;
    this.healTicks = 0;
    this.dragonDefeated = data?.dragonDefeated ?? false;
    this.dragonEncountered = data?.dragonEncountered ?? false;
    if (!data) return;
    for (const saved of data.bosses) {
      const boss = this.spawnBoss(
        saved.kind,
        { x: saved.x, y: saved.y, z: saved.z },
        { x: saved.homeX, y: saved.homeY, z: saved.homeZ },
      );
      boss.health = saved.health;
      boss.phase = saved.phase;
      boss.angle = saved.angle;
      boss.yaw = saved.yaw;
    }
    this.dragonDefeated = data.dragonDefeated ?? false;
    this.dragonEncountered ||= data.crystals.length > 0;
    for (const crystal of data.crystals)
      this.crystals.push({
        id: this.nextId++,
        position: { x: crystal.x, y: crystal.y, z: crystal.z },
      });
  }
  get count(): number {
    return this.list.length;
  }
}
/** The fountain of the End is where the dragon lives and where it rests. */
export function endFountainHome(): Vec3 {
  return { x: END_FOUNTAIN.x + 0.5, y: END_FOUNTAIN.y, z: END_FOUNTAIN.z + 0.5 };
}
/** Where the dragon egg lands when the dragon dies. */
export function dragonEggSpot(): Vec3 {
  return { x: END_FOUNTAIN.x, y: END_FOUNTAIN.y + 1, z: END_FOUNTAIN.z };
}
