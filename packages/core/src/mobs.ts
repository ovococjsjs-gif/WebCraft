/**
 * Creatures: the catalogue, and their behaviour. Hunters see (line of sight), remember and
 * path-find to their target; animals stroll to random reachable spots, graze, follow food and
 * their parents, panic when hit and keep away from ledges, lava and water; everything floats,
 * burns, takes fall damage and pushes its neighbours aside.
 */
import { BLOCK, registry } from '../../content/src/blocks';
import { blocksBody, findPath, fits, groundNear, lineOfSight, type NavPoint } from './mob-nav';
import { KNOCKBACK_VERTICAL } from './combat';
import type { Vec3 } from './coordinates';
import type { VoxelWorld } from './world';
import { bodyBox, boxHitsWorld } from './collision';
import { TRADE_RESTOCK_TICKS } from './trading';
export interface MobDrop {
  readonly item: string;
  readonly min: number;
  readonly max: number;
  readonly chance?: number;
}
export interface MobDefinition {
  readonly kind: string;
  readonly name: string;
  /** Height of the eyes over the feet, used when a creature aims a bow. */
  readonly eyeHeight?: number;
  /** Ranged attackers draw a bow instead of walking into the player. */
  readonly ranged?: boolean;
  /** Blast radius of a creature that explodes instead of hitting, in blocks. */
  readonly blast?: number;
  /** Item that makes a passive creature follow the player and breed. */
  readonly breedItem?: string;
  /** Sunlight hurts this creature, so it seeks shade or burns. */
  readonly burnsInDaylight?: boolean;
  /** Highest light level a hostile creature accepts when it spawns. */
  readonly spawnLightMax?: number;
  readonly health: number;
  /** Box used for collisions and for the renderer. */
  readonly width: number;
  readonly height: number;
  readonly damage: number;
  readonly speed: number;
  readonly hostile: boolean;
  readonly xp: number;
  readonly drops: readonly MobDrop[];
  readonly color: string;
  readonly headColor: string;
  /** Fire and lava do not hurt it (blaze, wither skeleton). */
  readonly fireImmune?: boolean;
  /** Floats in the air instead of walking (blaze). */
  readonly flies?: boolean;
  /** Moves only by hopping, a jump every second or two (slimes, magma cubes). */
  readonly hops?: boolean;
  /** On death it bursts into two to four of these (the next smaller slime). */
  readonly splitsInto?: string;
}
/** Slimes and magma cubes in their three sizes (1.12: size 4, 2, 1; health = size²). */
function cubeSizes(
  base: 'lab:slime' | 'lab:magma_cube',
  names: readonly [string, string, string],
  palette: { color: string; headColor: string },
): MobDefinition[] {
  const magma = base === 'lab:magma_cube';
  return (
    [
      [4, '', `${base}_medium`],
      [2, '_medium', `${base}_small`],
      [1, '_small', undefined],
    ] as const
  ).map(([size, suffix, splitsInto], i) =>
    Object.freeze({
      kind: `${base}${suffix}`,
      name: names[i],
      health: size * size,
      width: 0.51 * size,
      height: 0.51 * size,
      // A small slime only nudges; magma cubes burn harder (size + 2 at hard, softened here).
      damage: magma ? size + 2 : size === 1 ? 0 : size,
      speed: 2 + size * 0.45,
      hostile: true,
      xp: size,
      drops: magma
        ? size > 1
          ? [{ item: 'lab:magma_cream', min: 0, max: 1, chance: 0.25 }]
          : []
        : size === 1
          ? [{ item: 'lab:slimeball', min: 0, max: 2 }]
          : [],
      ...palette,
      spawnLightMax: magma ? 15 : 7,
      fireImmune: magma || undefined,
      hops: true,
      splitsInto,
      eyeHeight: 0.51 * size * 0.625,
    }),
  );
}
export const MOBS: readonly MobDefinition[] = Object.freeze([
  {
    kind: 'lab:enderman',
    name: 'Странник Края',
    health: 40,
    width: 0.65,
    height: 2.9,
    damage: 5,
    speed: 4,
    hostile: true,
    xp: 5,
    drops: [{ item: 'lab:ender_pearl', min: 0, max: 1 }],
    color: '#272536',
    headColor: '#383044',
    spawnLightMax: 7,
  },
  {
    kind: 'lab:blaze',
    name: 'Ифрит',
    health: 20,
    width: 0.7,
    height: 1.8,
    damage: 5,
    speed: 2.8,
    hostile: true,
    xp: 10,
    drops: [
      { item: 'lab:blaze_rod', min: 1, max: 2 },
      { item: 'lab:nether_wart', min: 0, max: 1 },
    ],
    color: '#bb6c27',
    headColor: '#f3bf50',
    spawnLightMax: 15,
    fireImmune: true,
    flies: true,
    eyeHeight: 1.5,
  },
  {
    kind: 'lab:wither_skeleton',
    name: 'Скелет-иссушитель',
    health: 20,
    width: 0.7,
    height: 2.4,
    damage: 5,
    speed: 3.5,
    hostile: true,
    xp: 5,
    drops: [
      { item: 'lab:bone', min: 1, max: 2 },
      { item: 'lab:wither_skeleton_skull', min: 1, max: 1, chance: 0.25 },
    ],
    color: '#333840',
    headColor: '#515863',
    spawnLightMax: 15,
    fireImmune: true,
  },
  Object.freeze({
    kind: 'lab:dummy',
    name: 'Тренировочный манекен',
    health: 20,
    width: 0.6,
    height: 1.8,
    damage: 0,
    speed: 0,
    hostile: false,
    xp: 0,
    drops: [],
    color: '#b08c5a',
    headColor: '#d8bb8b',
  }),
  Object.freeze({
    kind: 'lab:walker',
    name: 'Ходок',
    health: 20,
    width: 0.6,
    height: 1.9,
    damage: 3,
    speed: 2.4,
    hostile: true,
    xp: 5,
    drops: [{ item: 'lab:rotten_flesh', min: 0, max: 2 }],
    color: '#4f6b52',
    headColor: '#6f8f70',
  }),
  Object.freeze({
    kind: 'lab:zombie',
    name: 'Зомби',
    health: 20,
    width: 0.6,
    height: 1.95,
    damage: 3,
    speed: 4.2,
    hostile: true,
    xp: 5,
    drops: [{ item: 'lab:rotten_flesh', min: 0, max: 2 }],
    color: '#3d6b4a',
    headColor: '#5d8f63',
    burnsInDaylight: true,
    spawnLightMax: 7,
  }),
  Object.freeze({
    kind: 'lab:skeleton',
    name: 'Скелет',
    health: 20,
    width: 0.6,
    height: 1.95,
    damage: 3,
    speed: 3.6,
    hostile: true,
    xp: 5,
    drops: [
      { item: 'lab:bone', min: 0, max: 2 },
      { item: 'lab:arrow', min: 0, max: 2 },
    ],
    color: '#c9c9c9',
    headColor: '#e2e2e2',
    ranged: true,
    eyeHeight: 1.6,
    spawnLightMax: 7,
  }),
  Object.freeze({
    kind: 'lab:creeper',
    name: 'Крипер',
    health: 20,
    width: 0.6,
    height: 1.7,
    damage: 0,
    speed: 4,
    hostile: true,
    xp: 5,
    drops: [{ item: 'lab:gunpowder', min: 0, max: 2 }],
    color: '#54a04a',
    headColor: '#79c46c',
    blast: 3,
    spawnLightMax: 7,
  }),
  Object.freeze({
    kind: 'lab:spider',
    name: 'Паук',
    health: 16,
    width: 1.4,
    height: 0.9,
    damage: 2,
    speed: 5,
    hostile: true,
    xp: 5,
    drops: [
      { item: 'lab:spider_eye', min: 0, max: 2 },
      { item: 'lab:string', min: 1, max: 2 },
    ],
    color: '#3b2b27',
    headColor: '#5d4238',
    spawnLightMax: 7,
  }),
  Object.freeze({
    kind: 'lab:cow',
    name: 'Корова',
    health: 10,
    width: 0.9,
    height: 1.4,
    damage: 0,
    speed: 1.2,
    hostile: false,
    xp: 1,
    drops: [
      { item: 'lab:beef', min: 1, max: 3 },
      { item: 'lab:leather', min: 0, max: 2 },
    ],
    color: '#4a3a2a',
    headColor: '#efe6dc',
    breedItem: 'lab:wheat',
  }),
  Object.freeze({
    kind: 'lab:sheep',
    name: 'Овца',
    health: 8,
    width: 0.9,
    height: 1.3,
    damage: 0,
    speed: 1.2,
    hostile: false,
    xp: 1,
    drops: [
      { item: 'lab:mutton', min: 1, max: 2 },
      { item: 'lab:wool', min: 1, max: 1 },
    ],
    color: '#e8e4dc',
    headColor: '#f4f1ea',
    breedItem: 'lab:wheat',
  }),
  Object.freeze({
    kind: 'lab:pig',
    name: 'Свинья',
    health: 10,
    width: 0.9,
    height: 0.9,
    damage: 0,
    speed: 1.2,
    hostile: false,
    xp: 1,
    drops: [{ item: 'lab:porkchop', min: 1, max: 3 }],
    color: '#e0a0a8',
    headColor: '#f0bcc2',
    breedItem: 'lab:carrot',
  }),
  Object.freeze({
    // Villagers live in villages and trade emeralds; the variant is the career (see trading.ts).
    kind: 'lab:villager',
    name: 'Житель',
    health: 20,
    width: 0.6,
    height: 1.95,
    damage: 0,
    speed: 1.1,
    hostile: false,
    xp: 0,
    drops: [],
    color: '#6b4a2b',
    headColor: '#b88a6a',
    eyeHeight: 1.62,
  }),
  Object.freeze({
    kind: 'lab:chicken',
    name: 'Курица',
    health: 4,
    width: 0.4,
    height: 0.7,
    damage: 0,
    speed: 1.1,
    hostile: false,
    xp: 1,
    drops: [
      { item: 'lab:chicken', min: 1, max: 1 },
      { item: 'lab:feather', min: 0, max: 2 },
    ],
    color: '#f4f4f4',
    headColor: '#e04b3a',
    breedItem: 'lab:seeds',
  }),
  ...cubeSizes('lab:slime', ['Слизень', 'Слизень (средний)', 'Слизень (малый)'], {
    color: '#72c05f',
    headColor: '#9ad88a',
  }),
  ...cubeSizes(
    'lab:magma_cube',
    ['Магмовый куб', 'Магмовый куб (средний)', 'Магмовый куб (малый)'],
    { color: '#4a1f14', headColor: '#f07a1c' },
  ),
  Object.freeze({
    kind: 'lab:ghast',
    name: 'Гаст',
    health: 10,
    width: 4,
    height: 4,
    damage: 0,
    speed: 1.6,
    hostile: true,
    xp: 5,
    drops: [
      { item: 'lab:ghast_tear', min: 0, max: 1 },
      { item: 'lab:gunpowder', min: 0, max: 2 },
    ],
    color: '#f0f0f0',
    headColor: '#d8d8d8',
    spawnLightMax: 15,
    fireImmune: true,
    flies: true,
    eyeHeight: 2.6,
  }),
]);
export function mobDefinition(kind: string): MobDefinition | undefined {
  return MOBS.find((mob) => mob.kind === kind);
}
export const MOB_GRAVITY = 32;
export const MOB_JUMP_VELOCITY = 8.4;
/** Slabs and stairs are walked up; a full block needs a jump. */
export const MOB_STEP_HEIGHT = 0.6;
export const MOB_ATTACK_RANGE = 1.6;
export const MOB_ATTACK_COOLDOWN = 20;
export const MOB_HURT_TICKS = 10;
export const MOB_CHASE_RANGE = 16;
export const MAX_MOBS = 256;
/** The creeper hisses for a second and a half before the blast. */
export const MOB_FUSE_TICKS = 30;
/** A skeleton shoots when the player is further away than this. */
export const MOB_SHOOT_MIN_RANGE = 2.5;
export const MOB_SHOOT_RANGE = 14;
export const MOB_SHOOT_COOLDOWN = 40;
/** Distance a shooter tries to keep from the player: close enough to hit, far enough to aim. */
export const MOB_SHOOT_PREFERRED = 7;
/** A creature fed its breeding item waits this long for a partner. */
export const MOB_LOVE_TICKS = 600;
/** Passive creatures wander instead of chasing. */
export const MOB_WANDER_CHANCE = 4;
/**
 * Reference ground friction for a creature that is not steering itself this tick. Knockback
 * pushes a standing mob about half a block and then lets it settle instead of sliding for ever.
 */
export const MOB_IDLE_DRAG = 0.6;
export const MOB_GROW_TICKS = 24000;
export const MOB_BREED_COOLDOWN = 6000;
/** Ticks a hunter keeps after the target leaves its sight. */
export const MOB_MEMORY_TICKS = 100;
export const MOB_DESPAWN_FAR = 128;
export const MOB_DESPAWN_NEAR = 32;
export const MOB_EGG_TICKS = [6000, 12000] as const;
export const SHEEP_EAT_TICKS = 40;
/** Natural sheep colours of the reference and their weights (per mille). */
export const WOOL_COLORS = ['white', 'black', 'gray', 'light_gray', 'brown', 'pink'] as const;
const WOOL_WEIGHTS = [818, 50, 50, 50, 30, 2];
/** How far from its village a villager strolls before it heads back. */
const VILLAGER_ROAM = 28;
/** The wool block a sheep of this colour gives: the white one keeps the old key. */
export function woolItem(variant: number): string {
  const color = WOOL_COLORS[variant] ?? 'white';
  return color === 'white' ? 'lab:wool' : `lab:${color}_wool`;
}
/** Neutral creatures get angry for this long after being hurt or stared at. */
export const MOB_ANGER_TICKS = 600;
export const MOB_STROLL_TIMEOUT = 200;
export const MOB_PANIC_TICKS = 90;
/** A creature will not walk off a ledge deeper than this unless it is chasing or fleeing. */
export const MOB_SAFE_DROP = 3;
export const BLAZE_BURST = 3;
/** A ghast sees 64 blocks; it warns at 10 ticks of aiming and fires at 20, then rests 40. */
export const GHAST_SIGHT = 64;
export const GHAST_WARN = 10;
export const GHAST_FIRE = 20;
export const GHAST_REST = 40;
export const BLAZE_COOLDOWN = 100;

export interface MobEntity {
  id: number;
  kind: string;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  health: number;
  age: number;
  hurtTime: number;
  attackCooldown: number;
  onGround: boolean;
  /** Creeper countdown; zero means nothing is about to explode. */
  fuse: number;
  /** Breeding interest left, in ticks. */
  loveTicks: number;
  /** Children keep their parents' shape but not their size. */
  baby: boolean;
  /** Direction of the last flight or stroll, in the x/z plane. */
  wanderYaw: number;
  /** Ticks left before an unfinished stroll is given up; zero means standing about. */
  stroll: number;
  /** Ticks left of running away after being hit (passive creatures only). */
  panic: number;
  /** The body is in water this tick: it swims up and may climb out onto the shore. */
  inWater: boolean;
  /** Negative while a child: ticks until it grows up. */
  growth: number;
  breedCooldown: number;
  /** Ticks of burning left: sunlight, fire or lava. */
  fireTicks: number;
  fallDistance: number;
  /** Wool colour index for sheep (see WOOL_COLORS), a villager's career (see trading.ts). */
  variant: number;
  /** A villager's village: it strolls back when it wanders too far from it. */
  home: Vec3 | null;
  /** Times each of a villager's offers was used since the last restock. */
  tradeUses: number[];
  sheared: boolean;
  /** Sheep grazing animation, counting down. */
  eating: number;
  eggTimer: number;
  /** Anger at the player after a hit or a stare (neutral creatures need it to attack). */
  provoked: number;
  /** Ticks the target is still remembered after leaving the line of sight. */
  memory: number;
  /** Hunting this tick: drives aiming poses and the angry face. */
  aggressive: boolean;
  climbing: boolean;
  /** Blaze volley: shots left, and warm-up ticks before the first. */
  burst: number;
  charge: number;
  teleportCooldown: number;
  wantsTeleport: boolean;
  collided: boolean;
  path: NavPoint[] | null;
  pathIndex: number;
  pathGoal: Vec3 | null;
  repath: number;
  stuck: number;
  lastSpot: Vec3;
  followId: number;
}
export interface SavedMobExtra {
  /** Growth (negative while a child). */
  g?: number;
  /** Wool colour or career. */
  v?: number;
  /** A villager's home point. */
  h?: [number, number, number];
  /** A villager's offer uses. */
  u?: number[];
  /** Sheared. */
  s?: 1;
  /** Breeding cooldown. */
  c?: number;
}
export type SavedMob = [
  kind: string,
  x: number,
  y: number,
  z: number,
  health: number,
  yaw: number,
  extra?: SavedMobExtra,
];
export type MobEventType =
  | 'teleport'
  | 'graze'
  | 'egg'
  | 'leap'
  | 'scream'
  | 'fireball'
  | 'charge'
  | 'grow'
  | 'hop'
  | 'squish'
  | 'ghast_warn'
  | 'ghast_shoot';
export interface MobTickContext {
  readonly world: VoxelWorld;
  readonly playerPosition: Vec3;
  readonly playerAlive: boolean;
  /** Hostile creatures ignore a creative player; animals still follow food. */
  readonly playerIgnored?: boolean;
  /** Eye position and look direction of the player, for the enderman's stare. */
  readonly playerEye?: Vec3;
  readonly playerLook?: Vec3;
  /** Difficulty scaling applied to hostile damage. */
  readonly damageScale: number;
  /** Called when a hostile creature lands a hit. */
  readonly hurtPlayer: (amount: number, from: Vec3, kind?: string) => void;
  readonly random: () => number;
  /** Item the player is holding, used by animals that follow their food. */
  readonly holdingItem?: string;
  /** A skeleton releases an arrow at the player. */
  readonly shootArrow?: (from: Vec3, to: Vec3) => void;
  /** A blaze throws a small fireball. */
  readonly shootFireball?: (from: Vec3, to: Vec3) => void;
  /** A ghast spits a big one that explodes. */
  readonly shootGhastFireball?: (from: Vec3, to: Vec3) => void;
  /** A creeper's fuse ran out. */
  readonly explode?: (position: Vec3, radius: number) => void;
  /** Sunlight hurts this creature right now. */
  readonly burnsAt?: (position: Vec3, kind: string) => boolean;
  /** Combined light level of a cell (spiders are calm in bright light). */
  readonly lightAt?: (x: number, y: number, z: number) => number;
  /** Rain falls on this cell: it wets endermen and puts out burning creatures. */
  readonly rainAt?: (x: number, y: number, z: number) => boolean;
  readonly dropItem?: (item: string, count: number, position: Vec3) => void;
  readonly setBlock?: (x: number, y: number, z: number, state: number) => void;
  /** Presentation cues: sounds and particles. */
  readonly event?: (type: MobEventType, entity: MobEntity, position: Vec3) => void;
}
export interface MobDeath {
  readonly entity: MobEntity;
  readonly xp: number;
  readonly drops: readonly { item: string; count: number }[];
}
function blockAt(world: VoxelWorld, x: number, y: number, z: number) {
  if (y < 0 || !world.isLoaded(Math.floor(x), Math.floor(z))) return undefined;
  return registry.get(world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
}
/** Turns `from` towards `to` by at most `step` radians, the short way round. */
function turnTowards(from: number, to: number, step: number) {
  let d = to - from;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return from + Math.max(-step, Math.min(step, d));
}
/** Yaw that faces along the x/z direction (dx, dz). */
function faceYaw(dx: number, dz: number) {
  return Math.atan2(-dx, -dz);
}
function boxHits(world: VoxelWorld, position: Vec3, width: number, height: number): boolean {
  return boxHitsWorld(world, bodyBox(position, width, height));
}
function idHash(id: number, salt: number) {
  let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) ^ salt;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function woolFor(roll: number) {
  let r = roll * 1000;
  for (let i = 0; i < WOOL_WEIGHTS.length; i++) {
    r -= WOOL_WEIGHTS[i];
    if (r < 0) return i;
  }
  return 0;
}
/** What a creature wants to do this tick; `drive` turns it into motion. */
interface Plan {
  /** Walk to this point, by path when the way is not straight. */
  goal?: Vec3;
  /** Or just walk along this x/z heading (atan2(dz, dx)). */
  heading?: number;
  speed: number;
  /** Stop within this horizontal distance of the goal. */
  reach?: number;
  /** Face this yaw instead of the walking direction. */
  face?: number;
  /** Deepest fall the creature accepts on the way. */
  maxDrop?: number;
  /** Responsiveness of the steering, 0..1 per tick. */
  accel?: number;
  /** Target height for a flying creature. */
  hover?: number;
}
export class MobStore {
  private nextId = 1;
  /** Ticks spent burning, exposed for the tests. */
  burning = 0;
  /** Path searches left this tick: navigation is spread over ticks, never a spike. */
  private pathBudget = 0;
  readonly list: MobEntity[] = [];
  spawn(kind: string, position: Vec3, health?: number): MobEntity {
    const definition = mobDefinition(kind);
    if (!definition) throw new Error(`Unknown creature ${kind}`);
    if (this.list.length >= MAX_MOBS) throw new RangeError('Too many creatures');
    const id = this.nextId++;
    const entity: MobEntity = {
      id,
      kind,
      position: { ...position },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: 0,
      health: health ?? definition.health,
      age: 0,
      hurtTime: 0,
      attackCooldown: 0,
      onGround: false,
      fuse: 0,
      loveTicks: 0,
      baby: false,
      wanderYaw: 0,
      stroll: 0,
      panic: 0,
      inWater: false,
      growth: 0,
      breedCooldown: 0,
      fireTicks: 0,
      fallDistance: 0,
      // Deterministic per creature, so spawning never draws from the world's random stream.
      variant:
        kind === 'lab:sheep'
          ? woolFor(idHash(id, Math.floor(position.x * 7 + position.z * 13)))
          : 0,
      home: null,
      tradeUses: [],
      sheared: false,
      eating: 0,
      eggTimer:
        MOB_EGG_TICKS[0] + Math.floor(idHash(id, 77) * (MOB_EGG_TICKS[1] - MOB_EGG_TICKS[0])),
      provoked: 0,
      memory: 0,
      aggressive: false,
      climbing: false,
      burst: 0,
      charge: 0,
      teleportCooldown: 0,
      wantsTeleport: false,
      collided: false,
      path: null,
      pathIndex: 0,
      pathGoal: null,
      repath: 0,
      stuck: 0,
      lastSpot: { ...position },
      followId: 0,
    };
    this.list.push(entity);
    return entity;
  }
  byId(id: number): MobEntity | undefined {
    return this.list.find((entity) => entity.id === id);
  }
  clear(): void {
    this.list.length = 0;
  }
  get size(): number {
    return this.list.length;
  }
  damageOf(entity: MobEntity): number {
    return mobDefinition(entity.kind)?.damage ?? 0;
  }
  center(entity: MobEntity): Vec3 {
    const definition = mobDefinition(entity.kind)!;
    return {
      x: entity.position.x,
      y: entity.position.y + definition.height / 2,
      z: entity.position.z,
    };
  }
  private remove(entity: MobEntity) {
    const index = this.list.indexOf(entity);
    if (index >= 0) this.list.splice(index, 1);
  }
  /** Returns the rolled drops when the creature dies. */
  hurt(
    entity: MobEntity,
    amount: number,
    knockback?: Vec3,
    random: () => number = Math.random,
  ): MobDeath | null {
    if (entity.health <= 0) return null;
    const definition = mobDefinition(entity.kind);
    entity.health -= Math.max(0, amount);
    entity.hurtTime = MOB_HURT_TICKS;
    if (knockback) {
      // Reference rule: the motion an entity already carries is halved and the impulse is added
      // on top, with the upward part never exceeding the 0.4 per tick cap.
      entity.velocity.x = entity.velocity.x / 2 + knockback.x;
      entity.velocity.z = entity.velocity.z / 2 + knockback.z;
      entity.velocity.y = Math.min(KNOCKBACK_VERTICAL, entity.velocity.y / 2 + knockback.y);
    }
    if (entity.health > 0) {
      if (definition?.hostile) {
        // Anything that hits a monster makes it angry, the neutral ones included.
        if (knockback) {
          entity.provoked = MOB_ANGER_TICKS;
          entity.memory = MOB_MEMORY_TICKS;
        }
        if (entity.kind === 'lab:enderman') entity.wantsTeleport = true;
      } else if ((definition?.speed ?? 0) > 0) {
        // A hurt animal bolts away from the blow, the way the reference panic goal does.
        entity.panic = MOB_PANIC_TICKS;
        entity.loveTicks = 0;
        entity.path = null;
        entity.eating = 0;
        if (knockback && (knockback.x || knockback.z))
          entity.wanderYaw = Math.atan2(knockback.z, knockback.x);
      }
      return null;
    }
    entity.health = 0;
    this.remove(entity);
    // A slime bursts into two to four smaller ones, spread around where it stood.
    if (definition?.splitsInto) {
      const count = 2 + Math.floor(random() * 3),
        child = mobDefinition(definition.splitsInto)!;
      for (let i = 0; i < count && this.list.length < MAX_MOBS; i++) {
        const spread = definition.width / 4;
        const young = this.spawn(child.kind, {
          x: entity.position.x + ((i % 2) - 0.5) * spread,
          y: entity.position.y + 0.5,
          z: entity.position.z + (Math.floor(i / 2) - 0.5) * spread,
        });
        young.yaw = random() * Math.PI * 2;
        young.provoked = entity.provoked;
        young.memory = entity.memory;
      }
    }
    const drops: { item: string; count: number }[] = [];
    for (const drop of definition?.drops ?? []) {
      if (drop.chance !== undefined && random() >= drop.chance) continue;
      // A shorn sheep has no wool left to drop.
      if (entity.sheared && drop.item === 'lab:wool') continue;
      const count = drop.min + Math.floor(random() * (drop.max - drop.min + 1));
      const item = drop.item === 'lab:wool' ? woolItem(entity.variant) : drop.item;
      if (count > 0) drops.push({ item, count });
    }
    // Children drop nothing and give no experience, as in the reference.
    if (entity.baby) return { entity, xp: 0, drops: [] };
    return { entity, xp: definition?.xp ?? 0, drops };
  }

  // ------------------------------------------------------------------ the tick
  tick(context: MobTickContext): MobDeath[] {
    const deaths: MobDeath[] = [];
    this.pathBudget = 8;
    this.separate();
    for (const entity of [...this.list]) {
      if (!this.list.includes(entity)) continue;
      const definition = mobDefinition(entity.kind);
      if (!definition) continue;
      if (!context.world.isLoaded(Math.floor(entity.position.x), Math.floor(entity.position.z)))
        continue;
      const death = this.think(context, entity, definition);
      if (death) deaths.push(death);
    }
    return deaths;
  }
  private think(
    context: MobTickContext,
    entity: MobEntity,
    definition: MobDefinition,
  ): MobDeath | null {
    entity.age++;
    if (entity.hurtTime > 0) entity.hurtTime--;
    if (entity.attackCooldown > 0) entity.attackCooldown--;
    if (entity.provoked > 0) entity.provoked--;
    if (entity.breedCooldown > 0) entity.breedCooldown--;
    if (entity.teleportCooldown > 0) entity.teleportCooldown--;
    if (entity.repath > 0) entity.repath--;
    const p = entity.position,
      dx = context.playerPosition.x - p.x,
      dz = context.playerPosition.z - p.z,
      dy = context.playerPosition.y - p.y,
      distance = Math.hypot(dx, dz);
    // Monsters far from every player disappear, the near ones only now and then.
    if (definition.hostile) {
      const far = Math.hypot(dx, dy, dz);
      if (far > MOB_DESPAWN_FAR || (far > MOB_DESPAWN_NEAR && context.random() < 1 / 800)) {
        this.remove(entity);
        return null;
      }
    }
    // Villagers restock their offers now and then.
    if (entity.tradeUses.length && entity.age % TRADE_RESTOCK_TICKS === 0) entity.tradeUses = [];
    // Children grow up.
    if (entity.baby && entity.growth === 0) entity.growth = -MOB_GROW_TICKS;
    if (entity.growth < 0 && ++entity.growth === 0) {
      entity.baby = false;
      context.event?.('grow', entity, p);
    }
    // Fire: lava and flames set it alight, water and rain put it out, the sun burns the undead.
    const hurtBy = (amount: number) => this.hurt(entity, amount, undefined, context.random);
    const feet = blockAt(context.world, p.x, p.y + 0.1, p.z),
      body = blockAt(context.world, p.x, p.y + Math.min(1, definition.height * 0.6), p.z);
    const lava = feet?.fluid === 'lava' || body?.fluid === 'lava',
      flame = feet?.key === registry.get(BLOCK.FIRE).key,
      rained = !!context.rainAt?.(
        Math.floor(p.x),
        Math.floor(p.y + definition.height),
        Math.floor(p.z),
      ),
      wet = entity.inWater || rained;
    const sunburn = !!context.burnsAt?.(p, entity.kind);
    if (!definition.fireImmune) {
      if (lava) {
        entity.fireTicks = Math.max(entity.fireTicks, 300);
        if (entity.age % 10 === 0) {
          const d = hurtBy(4);
          if (d) return d;
        }
      }
      if (flame) entity.fireTicks = Math.max(entity.fireTicks, 160);
      if (sunburn) entity.fireTicks = Math.max(entity.fireTicks, 160);
    }
    if (wet && !lava) entity.fireTicks = 0;
    if (entity.fireTicks > 0) {
      entity.fireTicks--;
      this.burning++;
      if (!definition.fireImmune && entity.age % 20 === 0) {
        const d = hurtBy(1);
        if (d) return d;
      }
    }
    // Water hurts an enderman, and it blinks away from it.
    if (entity.kind === 'lab:enderman' && wet) {
      entity.wantsTeleport = true;
      if (entity.age % 10 === 0) {
        const d = hurtBy(1);
        if (d) return d;
      }
    }
    if (entity.wantsTeleport && entity.teleportCooldown === 0) {
      entity.wantsTeleport = false;
      this.teleport(context, entity, definition, p, 16);
    }

    // ---------------------------------------------------------------- choose a plan
    if (entity.kind === 'lab:ghast') return this.ghast(context, entity, definition);
    const chasing = this.hunt(context, entity, definition, dx, dy, dz, distance);
    entity.aggressive = chasing;
    if (definition.hops) {
      this.hop(context, entity, definition, chasing, dx, dz);
      const fell = this.integrate(context, entity, definition, { speed: 0 });
      // Slimes are bouncy: no fall damage, only a squish on landing.
      void fell;
      if (entity.onGround && entity.velocity.y === 0 && entity.stroll > 0) {
        entity.stroll = 0;
        context.event?.('squish', entity, p);
      }
      if (!this.list.includes(entity)) return null;
      this.meleeTouch(context, entity, definition, chasing);
      return null;
    }
    let plan: Plan = { speed: 0 };
    if (definition.blast !== undefined) {
      // A creeper closes in, lights its fuse at arm's length and backs off if the player runs.
      const arm = MOB_ATTACK_RANGE + 0.4;
      if (chasing && distance <= arm && Math.abs(dy) < 3) {
        if (entity.fuse === 0) entity.fuse = MOB_FUSE_TICKS;
      } else if (entity.fuse > 0 && (distance > arm + 3 || !chasing)) entity.fuse = 0;
      if (entity.fuse > 0) {
        entity.fuse--;
        entity.velocity.x *= 0.5;
        entity.velocity.z *= 0.5;
        entity.yaw = turnTowards(entity.yaw, faceYaw(dx, dz), 0.5);
        if (entity.fuse === 0) {
          context.explode?.({ x: p.x, y: p.y + definition.height / 2, z: p.z }, definition.blast);
          this.remove(entity);
          return null;
        }
        this.integrate(context, entity, definition, { speed: 0 });
        return null;
      }
    }
    if (chasing && (definition.ranged || entity.kind === 'lab:blaze'))
      plan = this.rangedPlan(context, entity, definition, dx, dy, dz, distance);
    else if (chasing && definition.speed > 0) {
      plan = {
        goal: context.playerPosition,
        speed: definition.speed * (entity.baby ? 1.5 : 1),
        reach: 0.8,
        face: distance < 3 ? faceYaw(dx, dz) : undefined,
        maxDrop: 4,
        accel: 0.4,
      };
      if (definition.flies) plan.hover = context.playerPosition.y + 0.5;
      // A spider pounces from a few blocks away.
      if (
        entity.kind === 'lab:spider' &&
        entity.onGround &&
        distance > 2 &&
        distance < 4 &&
        context.random() < 0.1
      ) {
        entity.velocity.x += (dx / distance) * 4;
        entity.velocity.z += (dz / distance) * 4;
        entity.velocity.y = 7;
        context.event?.('leap', entity, p);
      }
      // A far enderman that cannot see its target blinks closer.
      if (
        entity.kind === 'lab:enderman' &&
        entity.teleportCooldown === 0 &&
        (distance > 12 || entity.stuck > 30) &&
        context.random() < 0.05
      )
        this.teleport(context, entity, definition, context.playerPosition, 6);
    } else if (definition.speed <= 0) plan = { speed: 0 };
    else plan = this.idlePlan(context, entity, definition, dx, dz, distance, sunburn && !chasing);
    if (definition.flies && plan.hover === undefined && chasing)
      plan.hover = context.playerPosition.y + 1.5;
    this.drive(context, entity, definition, plan);
    const fell = this.integrate(context, entity, definition, plan);
    if (fell > 0) {
      const d = hurtBy(fell);
      if (d) return d;
    }
    if (!this.list.includes(entity)) return null;

    // ---------------------------------------------------------------- after moving
    this.meleeTouch(context, entity, definition, chasing);
    // Hens lay an egg every five to ten minutes.
    if (entity.kind === 'lab:chicken' && !entity.baby && --entity.eggTimer <= 0) {
      entity.eggTimer =
        MOB_EGG_TICKS[0] + Math.floor(context.random() * (MOB_EGG_TICKS[1] - MOB_EGG_TICKS[0]));
      context.dropItem?.('lab:egg', 1, { ...p });
      context.event?.('egg', entity, p);
    }
    return null;
  }

  /** A hunter within arm's reach of the player lands a blow when its cooldown allows. */
  private meleeTouch(
    context: MobTickContext,
    entity: MobEntity,
    definition: MobDefinition,
    chasing: boolean,
  ) {
    const p = entity.position;
    if (
      definition.hostile &&
      // A shooter never swings: standing inside its bow range is safe from melee.
      (!definition.ranged || entity.kind === 'lab:blaze') &&
      chasing &&
      entity.attackCooldown === 0 &&
      Math.hypot(context.playerPosition.x - p.x, context.playerPosition.z - p.z) <=
        (definition.hops
          ? definition.width / 2 + 0.7
          : MOB_ATTACK_RANGE + (definition.width > 1 ? 0.4 : 0)) &&
      context.playerPosition.y - p.y <= Math.max(2, definition.height) &&
      p.y - context.playerPosition.y <= 2
    ) {
      entity.attackCooldown = definition.hops ? 10 : MOB_ATTACK_COOLDOWN;
      const damage = definition.damage * context.damageScale;
      if (damage > 0) context.hurtPlayer(damage, this.center(entity), entity.kind);
    }
  }
  /**
   * Slimes and magma cubes move in hops: on the ground they wait (10–30 ticks, a third of that
   * while hunting), then leap towards the player or a wandering heading and keep the momentum in
   * the air. `charge` counts down the wait and `stroll` marks a hop in flight.
   */
  private hop(
    context: MobTickContext,
    entity: MobEntity,
    definition: MobDefinition,
    chasing: boolean,
    dx: number,
    dz: number,
  ) {
    if (!entity.onGround && !entity.inWater) return;
    entity.velocity.x *= 0.3;
    entity.velocity.z *= 0.3;
    if (chasing) entity.yaw = turnTowards(entity.yaw, faceYaw(dx, dz), 0.5);
    if (entity.charge > 0) {
      entity.charge--;
      return;
    }
    const wait = Math.floor(context.random() * 20) + 10;
    entity.charge = chasing ? Math.floor(wait / 3) : wait;
    let heading: number;
    if (chasing) heading = Math.atan2(dz, dx);
    else {
      if (context.random() < 0.3) entity.wanderYaw = context.random() * Math.PI * 2;
      heading = entity.wanderYaw;
      // Now and then an idle slime just bounces on the spot.
      if (context.random() < 0.25) {
        entity.velocity.y = MOB_JUMP_VELOCITY * 0.7;
        entity.stroll = 1;
        return;
      }
    }
    // Magma cubes leap higher, big ones a little higher still.
    const lift = definition.fireImmune ? 1.25 + definition.width * 0.08 : 1;
    entity.velocity.x = Math.cos(heading) * definition.speed;
    entity.velocity.z = Math.sin(heading) * definition.speed;
    entity.velocity.y = MOB_JUMP_VELOCITY * lift;
    entity.yaw = turnTowards(entity.yaw, faceYaw(Math.cos(heading), Math.sin(heading)), 1);
    entity.stroll = 1;
    entity.onGround = false;
    context.event?.('hop', entity, entity.position);
  }
  /**
   * A ghast drifts to random points of open air up to 16 blocks away. When it sees the player
   * within 64 blocks it turns to face them, cries out at 10 ticks of aiming and spits a
   * fireball at 20, then rests. `charge` is the aiming count (negative while resting).
   */
  private ghast(context: MobTickContext, entity: MobEntity, definition: MobDefinition) {
    const p = entity.position;
    const eye = this.eye(entity, definition);
    const target = {
      x: context.playerPosition.x,
      y: context.playerEye?.y ?? context.playerPosition.y + 1.62,
      z: context.playerPosition.z,
    };
    const tx = target.x - eye.x,
      ty = target.y - eye.y,
      tz = target.z - eye.z,
      range = Math.hypot(tx, ty, tz);
    if (context.playerAlive && !context.playerIgnored && range <= GHAST_SIGHT) {
      if ((entity.age + entity.id) % 5 === 0)
        entity.memory = lineOfSight(context.world, eye, target) ? MOB_MEMORY_TICKS : 0;
    } else entity.memory = 0;
    const sees = entity.memory > 0;
    if (sees) {
      entity.yaw = turnTowards(entity.yaw, faceYaw(tx, tz), 0.2);
      entity.charge++;
      if (entity.charge === GHAST_WARN) context.event?.('ghast_warn', entity, eye);
      if (entity.charge >= GHAST_FIRE) {
        const forward = { x: tx / range, y: ty / range, z: tz / range };
        const from = {
          x: eye.x + forward.x * 2.2,
          y: eye.y - 0.4 + forward.y * 2.2,
          z: eye.z + forward.z * 2.2,
        };
        context.shootGhastFireball?.(from, target);
        context.event?.('ghast_shoot', entity, from);
        entity.charge = -GHAST_REST;
      }
    } else if (entity.charge > 0) entity.charge--;
    else if (entity.charge < 0) entity.charge++;
    entity.aggressive = entity.charge > GHAST_WARN;
    // Wandering: a fresh goal when the old one is reached, blocked, or after a while.
    const goal = entity.pathGoal;
    const far = goal ? Math.hypot(goal.x - p.x, goal.y - p.y, goal.z - p.z) : 0;
    if (!goal || far < 1.5 || far > 60 || entity.collided || entity.stroll-- <= 0) {
      entity.stroll = 100 + Math.floor(context.random() * 100);
      const next = {
        x: p.x + (context.random() * 2 - 1) * 16,
        y: p.y + (context.random() * 2 - 1) * 16,
        z: p.z + (context.random() * 2 - 1) * 16,
      };
      // Only a goal whose way is open: a few samples along the line must leave room.
      let open = true;
      for (let k = 1; k <= 4 && open; k++) {
        const at = {
          x: p.x + ((next.x - p.x) * k) / 4,
          y: p.y + ((next.y - p.y) * k) / 4,
          z: p.z + ((next.z - p.z) * k) / 4,
        };
        open = !boxHits(context.world, at, definition.width, definition.height);
      }
      entity.pathGoal = open ? next : { ...p };
    }
    const g = entity.pathGoal!;
    const gx = g.x - p.x,
      gz = g.z - p.z,
      gd = Math.hypot(gx, gz);
    const speed = gd > 0.5 ? definition.speed : 0;
    entity.velocity.x += ((gd ? (gx / gd) * speed : 0) - entity.velocity.x) * 0.05;
    entity.velocity.z += ((gd ? (gz / gd) * speed : 0) - entity.velocity.z) * 0.05;
    if (!sees && gd > 0.5) entity.yaw = turnTowards(entity.yaw, faceYaw(gx, gz), 0.1);
    this.integrate(context, entity, definition, { speed, hover: g.y });
    return null;
  }

  // ------------------------------------------------------------------ senses
  private eye(entity: MobEntity, definition: MobDefinition): Vec3 {
    return {
      x: entity.position.x,
      y:
        entity.position.y +
        (definition.eyeHeight ?? definition.height * 0.85) * (entity.baby ? 0.55 : 1),
      z: entity.position.z,
    };
  }
  /** Target acquisition: sight, memory, and the moods of the neutral creatures. */
  private hunt(
    context: MobTickContext,
    entity: MobEntity,
    definition: MobDefinition,
    dx: number,
    dy: number,
    dz: number,
    distance: number,
  ): boolean {
    if (
      !definition.hostile ||
      definition.speed <= 0 ||
      !context.playerAlive ||
      context.playerIgnored
    ) {
      entity.memory = 0;
      return false;
    }
    if (distance > MOB_CHASE_RANGE * 1.5 || Math.abs(dy) > 10) {
      entity.memory = 0;
      return false;
    }
    const eyeTo = {
      x: context.playerPosition.x,
      y: context.playerEye?.y ?? context.playerPosition.y + 1.62,
      z: context.playerPosition.z,
    };
    const inRange = distance <= MOB_CHASE_RANGE && Math.abs(dy) < 6;
    const check = entity.memory === 0 || (entity.age + entity.id) % 4 === 0;
    let sees = false;
    if (inRange && check) sees = lineOfSight(context.world, this.eye(entity, definition), eyeTo);
    // The enderman only turns on a player who looks it in the eyes.
    if (entity.kind === 'lab:enderman' && entity.provoked === 0) {
      if (sees && context.playerLook && context.playerEye) {
        const head = this.eye(entity, definition),
          vx = head.x - context.playerEye.x,
          vy = head.y - context.playerEye.y,
          vz = head.z - context.playerEye.z,
          len = Math.hypot(vx, vy, vz),
          dot =
            (vx * context.playerLook.x + vy * context.playerLook.y + vz * context.playerLook.z) /
            len;
        if (dot > 1 - 0.025 / len) {
          entity.provoked = MOB_ANGER_TICKS;
          context.event?.('scream', entity, head);
        }
      }
      if (entity.provoked === 0) {
        entity.memory = 0;
        return false;
      }
    }
    // A spider is calm in bright light unless something hurt it.
    if (entity.kind === 'lab:spider' && entity.provoked === 0) {
      const light =
        context.lightAt?.(
          Math.floor(entity.position.x),
          Math.floor(entity.position.y + 0.5),
          Math.floor(entity.position.z),
        ) ?? 0;
      if (light > 11) {
        if (entity.memory === 0) sees = false;
        else if (context.random() < 0.01) entity.memory = 0;
      }
    }
    if (sees) entity.memory = MOB_MEMORY_TICKS;
    else if (entity.memory > 0 && check) entity.memory = Math.max(0, entity.memory - 4);
    void dz;
    return entity.memory > 0;
  }

  // ------------------------------------------------------------------ plans
  private rangedPlan(
    context: MobTickContext,
    entity: MobEntity,
    definition: MobDefinition,
    dx: number,
    dy: number,
    dz: number,
    distance: number,
  ): Plan {
    const p = entity.position;
    const sees = entity.memory === MOB_MEMORY_TICKS;
    const face = faceYaw(dx, dz);
    if (entity.kind === 'lab:blaze') {
      // A blaze hovers a little above its target, circles, and throws volleys of three.
      if (entity.burst > 0) {
        if (entity.charge > 0) {
          if (--entity.charge === 0) context.event?.('charge', entity, p);
        } else if (entity.age % 6 === 0) {
          entity.burst--;
          const from = { x: p.x, y: p.y + definition.height * 0.75, z: p.z };
          const spread = Math.sqrt(distance) * 0.25;
          context.shootFireball?.(from, {
            x: context.playerPosition.x + (context.random() - 0.5) * spread,
            y: context.playerPosition.y + 1,
            z: context.playerPosition.z + (context.random() - 0.5) * spread,
          });
          context.event?.('fireball', entity, from);
        }
      } else if (sees && entity.attackCooldown === 0 && distance > 2.5 && distance < 24) {
        entity.burst = BLAZE_BURST;
        entity.charge = 30;
        entity.attackCooldown = BLAZE_COOLDOWN;
      }
      const around = entity.age * 0.02 + entity.id;
      const radial = distance > 9 ? 1 : distance < 4 ? -1 : 0;
      return {
        heading:
          Math.atan2(dz, dx) +
          (radial === 0 ? Math.PI / 2 : radial < 0 ? Math.PI : 0) +
          Math.sin(around) * 0.4,
        speed: definition.speed * (radial === 0 ? 0.35 : 0.8),
        face,
        hover: context.playerPosition.y + 1.5 + Math.sin(entity.age * 0.05) * 0.6,
        accel: 0.12,
      };
    }
    // A shooter holds its firing band: it backs off when the player closes in and steps
    // forward again when the player runs, so it never loses the target out of range.
    if (!sees)
      return { goal: context.playerPosition, speed: definition.speed, reach: 4, accel: 0.3 };
    if (distance <= MOB_SHOOT_MIN_RANGE) return { speed: 0, face, accel: 0.3 };
    const preferred = MOB_SHOOT_PREFERRED;
    const radial = distance < preferred ? -1 : distance > MOB_SHOOT_RANGE - 2 ? 1 : 0;
    const strafe = Math.sin(entity.age * 0.05) * 0.35;
    const wx = (dx / distance) * radial - (dz / distance) * strafe,
      wz = (dz / distance) * radial + (dx / distance) * strafe;
    const len = Math.hypot(wx, wz);
    if (distance <= MOB_SHOOT_RANGE && entity.attackCooldown === 0 && dy > -2 && dy < 4) {
      entity.attackCooldown = MOB_SHOOT_COOLDOWN;
      context.shootArrow?.(
        { x: p.x, y: p.y + (definition.eyeHeight ?? 1.6), z: p.z },
        {
          x: context.playerPosition.x,
          y: context.playerPosition.y + 1.4,
          z: context.playerPosition.z,
        },
      );
    }
    // Backing off never walks over a ledge.
    const heading = Math.atan2(wz, wx);
    const safe = len > 0.05 && !this.unsafeAhead(context.world, entity, definition, heading);
    return {
      heading,
      speed: safe ? definition.speed * 0.9 * Math.min(1, len) : 0,
      face,
      accel: 0.2,
    };
  }
  /**
   * Everything a creature does when it is not hunting: panic after a hit, shade from the sun,
   * love, food, following a parent, grazing, and the stroll-and-pause of the reference wander
   * goal, which walks to a random reachable spot rather than in a straight line.
   */
  private idlePlan(
    context: MobTickContext,
    entity: MobEntity,
    definition: MobDefinition,
    dx: number,
    dz: number,
    distance: number,
    shade: boolean,
  ): Plan {
    const world = context.world,
      p = entity.position;
    if (entity.eating > 0) {
      if (--entity.eating === 4) this.graze(context, entity);
      return { speed: 0 };
    }
    if (entity.panic > 0) {
      entity.panic--;
      const goal = entity.pathGoal;
      if (!goal || Math.hypot(goal.x - p.x, goal.z - p.z) < 1.2 || entity.stuck >= 40) {
        const goal = this.randomSpot(context, entity, definition, 7, 3, entity.wanderYaw);
        if (goal) this.setGoal(entity, goal);
        entity.wanderYaw += (context.random() - 0.5) * 1.2;
      }
      return entity.pathGoal
        ? {
            goal: entity.pathGoal,
            speed: definition.speed * 2.2,
            maxDrop: MOB_SAFE_DROP,
            accel: 0.4,
          }
        : { heading: entity.wanderYaw, speed: definition.speed * 2.2, accel: 0.4 };
    }
    if (entity.panic === 0 && entity.stroll === 0 && !shade)
      entity.pathGoal = entity.pathGoal ?? null;
    if (shade) {
      // Undead in the sun look for a roof or a tree.
      if (!entity.pathGoal || context.burnsAt?.(entity.pathGoal, entity.kind)) {
        for (let i = 0; i < 10; i++) {
          const spot = this.randomSpot(context, entity, definition, 10, 3);
          if (spot && !context.burnsAt?.(spot, entity.kind)) {
            this.setGoal(entity, spot);
            break;
          }
        }
      }
      if (entity.pathGoal) return { goal: entity.pathGoal, speed: definition.speed, reach: 0.4 };
    }
    const hostile = definition.hostile;
    const tempting =
      !hostile &&
      context.playerAlive &&
      definition.breedItem !== undefined &&
      context.holdingItem === definition.breedItem &&
      distance <= 10;
    if (!hostile && entity.loveTicks > 0) {
      entity.loveTicks--;
      const partner = this.findPartner(entity, definition);
      if (partner)
        return {
          goal: partner.position,
          speed: definition.speed,
          reach: 1.2,
          face: faceYaw(partner.position.x - p.x, partner.position.z - p.z),
        };
    }
    if (tempting) {
      // Animals walk after the player who holds their food and stop at arm's length.
      entity.stroll = 0;
      return {
        goal: context.playerPosition,
        speed: definition.speed * 1.1,
        reach: 2,
        face: faceYaw(dx, dz),
        maxDrop: MOB_SAFE_DROP,
      };
    }
    if (entity.baby && !hostile) {
      // Young animals stay close to a grown-up of their kind.
      if (entity.followId === 0 || entity.age % 40 === 0)
        entity.followId = this.parentOf(entity)?.id ?? 0;
      const parent = entity.followId ? this.byId(entity.followId) : undefined;
      if (parent) {
        const d = Math.hypot(parent.position.x - p.x, parent.position.z - p.z);
        if (d > 3 && d < 16)
          return { goal: parent.position, speed: definition.speed * 1.1, reach: 2 };
      }
    }
    // A sheep now and then lowers its head and eats the grass it stands on.
    if (
      entity.kind === 'lab:sheep' &&
      entity.onGround &&
      entity.stroll === 0 &&
      context.random() < (entity.baby ? 1 / 50 : 1 / 1000)
    ) {
      const below = world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.5), Math.floor(p.z)),
        at = world.getBlock(Math.floor(p.x), Math.floor(p.y + 0.1), Math.floor(p.z));
      if (below === BLOCK.GRASS || at === BLOCK.TALL_GRASS) {
        entity.eating = SHEEP_EAT_TICKS;
        return { speed: 0 };
      }
    }
    if (entity.stroll > 0) {
      entity.stroll--;
      if (!entity.pathGoal || (entity.path && entity.pathIndex >= entity.path.length))
        entity.stroll = 0;
      else
        return {
          goal: entity.pathGoal,
          speed: definition.speed * (hostile ? 0.45 : 0.8),
          reach: 0.6,
          maxDrop: MOB_SAFE_DROP,
        };
    }
    entity.pathGoal = null;
    entity.path = null;
    if (entity.home) {
      // A villager that strayed from its village walks back to the well.
      const away = Math.hypot(entity.home.x - p.x, entity.home.z - p.z);
      if (away > VILLAGER_ROAM && context.random() < 1 / 20) {
        this.setGoal(entity, { ...entity.home });
        entity.stroll = MOB_STROLL_TIMEOUT;
      }
      // And stops to look at a player who comes close.
      if (distance < 4 && Math.abs(context.playerPosition.y - p.y) < 2 && entity.stroll === 0)
        return { speed: 0, face: faceYaw(dx, dz) };
    }
    if (context.random() < 1 / 100) {
      const goal = this.randomSpot(context, entity, definition, 10, 3);
      if (goal) {
        this.setGoal(entity, goal);
        entity.stroll = MOB_STROLL_TIMEOUT;
      }
    }
    // Swimming creatures keep paddling towards the shore instead of floating in place.
    if (entity.inWater) {
      const goal = this.randomSpot(context, entity, definition, 10, 3);
      if (goal) {
        this.setGoal(entity, goal);
        entity.stroll = MOB_STROLL_TIMEOUT;
      }
    }
    return { speed: 0 };
  }
  private setGoal(entity: MobEntity, goal: Vec3) {
    entity.pathGoal = goal;
    entity.path = null;
    entity.pathIndex = 0;
    entity.repath = 0;
    entity.stuck = 0;
  }
  /**
   * A random reachable-looking standing spot, like the reference random position generator:
   * dry land for animals, within `range` blocks, optionally biased along a heading.
   */
  private randomSpot(
    context: MobTickContext,
    entity: MobEntity,
    definition: MobDefinition,
    range: number,
    vertical: number,
    bias?: number,
  ): Vec3 | null {
    const o = {
      height: Math.max(1, Math.ceil(definition.height * (entity.baby ? 0.55 : 1))),
      swim: false,
    };
    const p = entity.position;
    let best: Vec3 | null = null,
      bestScore = -Infinity;
    for (let i = 0; i < 10; i++) {
      let ox = Math.round((context.random() * 2 - 1) * range),
        oz = Math.round((context.random() * 2 - 1) * range);
      if (bias !== undefined) {
        const r = range * (0.6 + context.random() * 0.4),
          a = bias + (context.random() - 0.5) * 1.2;
        ox = Math.round(Math.cos(a) * r);
        oz = Math.round(Math.sin(a) * r);
      }
      const x = Math.floor(p.x) + ox,
        z = Math.floor(p.z) + oz,
        y0 = Math.floor(p.y + 0.01) + Math.round((context.random() * 2 - 1) * vertical);
      if (!context.world.isLoaded(x, z)) continue;
      const y = groundNear(context.world, x, y0, z, o, vertical + 1);
      if (y === null) continue;
      // Grass and daylight are preferred, as the reference weights them for animals.
      const ground = context.world.getBlock(x, y - 1, z);
      const score =
        (ground === BLOCK.GRASS ? 2 : 0) +
        (definition.hostile ? 0 : 0.5) -
        Math.abs(y - p.y) * 0.3 +
        context.random();
      if (score > bestScore) {
        best = { x: x + 0.5, y, z: z + 0.5 };
        bestScore = score;
      }
    }
    return best;
  }
  private parentOf(entity: MobEntity): MobEntity | undefined {
    let best: MobEntity | undefined,
      bestD = 16;
    for (const other of this.list) {
      if (other === entity || other.kind !== entity.kind || other.baby) continue;
      const d = Math.hypot(
        other.position.x - entity.position.x,
        other.position.z - entity.position.z,
      );
      if (d < bestD) {
        best = other;
        bestD = d;
      }
    }
    return best;
  }
  private graze(context: MobTickContext, entity: MobEntity) {
    const p = entity.position,
      x = Math.floor(p.x),
      z = Math.floor(p.z),
      y = Math.floor(p.y + 0.1);
    if (context.world.getBlock(x, y, z) === BLOCK.TALL_GRASS)
      context.setBlock?.(x, y, z, BLOCK.AIR);
    else if (context.world.getBlock(x, y - 1, z) === BLOCK.GRASS)
      context.setBlock?.(x, y - 1, z, BLOCK.DIRT);
    else return;
    entity.sheared = false;
    if (entity.growth < 0) entity.growth = Math.min(0, entity.growth + 1200);
    context.event?.('graze', entity, { ...p });
  }
  /** An enderman blinks to a random dry spot near `around`. */
  private teleport(
    context: MobTickContext,
    entity: MobEntity,
    definition: MobDefinition,
    around: Vec3,
    range: number,
  ): boolean {
    const o = { height: Math.ceil(definition.height), swim: false };
    for (let i = 0; i < 16; i++) {
      const x = Math.floor(around.x + (context.random() * 2 - 1) * range),
        z = Math.floor(around.z + (context.random() * 2 - 1) * range),
        y0 = Math.floor(around.y + (context.random() * 2 - 1) * 4);
      if (!context.world.isLoaded(x, z)) continue;
      const y = groundNear(context.world, x, y0, z, o, 8);
      if (y === null) continue;
      if (blockAt(context.world, x, y, z)?.fluid || blockAt(context.world, x, y - 1, z)?.fluid)
        continue;
      if (Math.hypot(x + 0.5 - around.x, z + 0.5 - around.z) < 2) continue;
      context.event?.('teleport', entity, { ...entity.position });
      entity.position.x = x + 0.5;
      entity.position.y = y;
      entity.position.z = z + 0.5;
      entity.velocity.x = entity.velocity.y = entity.velocity.z = 0;
      entity.path = null;
      entity.teleportCooldown = 40;
      entity.fallDistance = 0;
      context.event?.('teleport', entity, { ...entity.position });
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ motion
  /** Would a creature walking along `heading` from here step into danger within a block? */
  private unsafeAhead(
    world: VoxelWorld,
    entity: MobEntity,
    definition: MobDefinition,
    heading: number,
  ) {
    const reach = definition.width / 2 + 0.45;
    const x = Math.floor(entity.position.x + Math.cos(heading) * reach),
      z = Math.floor(entity.position.z + Math.sin(heading) * reach),
      feet = Math.floor(entity.position.y + 0.01);
    if (!world.isLoaded(x, z)) return true;
    const height = Math.max(1, Math.ceil(definition.height));
    if (!fits(world, x, feet, z, height)) return !fits(world, x, feet + 1, z, height);
    for (let d = 1; d <= MOB_SAFE_DROP + 1; d++) {
      const below = blockAt(world, x, feet - d, z);
      if (!below) return true;
      if (below.fluid === 'lava') return true;
      if (below.fluid === 'water') return !entity.inWater && !mobDefinition(entity.kind)?.hostile;
      if (blocksBody(world, x, feet - d, z)) return false;
    }
    return true;
  }
  /** The straight line to `goal` can be walked without jumps, gaps or hazards. */
  private straight(world: VoxelWorld, entity: MobEntity, definition: MobDefinition, goal: Vec3) {
    const p = entity.position;
    if (Math.abs(goal.y - p.y) > 1.1) return false;
    const dx = goal.x - p.x,
      dz = goal.z - p.z,
      length = Math.hypot(dx, dz);
    if (length < 1.5) return true;
    const height = Math.max(1, Math.ceil(definition.height * (entity.baby ? 0.55 : 1)));
    const feet = Math.floor(p.y + 0.01);
    for (let t = 0.5; t < length; t += 0.5) {
      const x = Math.floor(p.x + (dx / length) * t),
        z = Math.floor(p.z + (dz / length) * t);
      if (!fits(world, x, feet, z, height)) return false;
      if (!blocksBody(world, x, feet - 1, z) && !entity.inWater) return false;
    }
    return true;
  }
  /** Turns a plan into steering: straight when it can, by path when it must. */
  private drive(context: MobTickContext, entity: MobEntity, definition: MobDefinition, plan: Plan) {
    const p = entity.position;
    let heading = plan.heading,
      speed = plan.speed,
      jump = false;
    if (plan.goal && speed > 0) {
      const gx = plan.goal.x - p.x,
        gz = plan.goal.z - p.z,
        gd = Math.hypot(gx, gz);
      if (gd <= (plan.reach ?? 0.5) && Math.abs(plan.goal.y - p.y) < 1.5) {
        speed = 0;
        entity.path = null;
        if (entity.stroll > 0 && plan.goal === entity.pathGoal) entity.stroll = 0;
      } else if (definition.flies || this.straight(context.world, entity, definition, plan.goal)) {
        entity.path = null;
        heading = Math.atan2(gz, gx);
      } else {
        const moved =
          !entity.pathGoal ||
          Math.hypot(entity.pathGoal.x - plan.goal.x, entity.pathGoal.z - plan.goal.z) > 1.5;
        const done = !entity.path || entity.pathIndex >= entity.path.length;
        if (
          (done || (moved && entity.repath === 0)) &&
          this.pathBudget > 0 &&
          entity.repath === 0
        ) {
          this.pathBudget--;
          entity.repath = 10 + (entity.id % 10);
          const height = Math.max(1, Math.ceil(definition.height * (entity.baby ? 0.55 : 1)));
          entity.path = findPath(
            context.world,
            { x: Math.floor(p.x), y: Math.floor(p.y + 0.01), z: Math.floor(p.z) },
            {
              x: Math.floor(plan.goal.x),
              y: Math.floor(plan.goal.y + 0.01),
              z: Math.floor(plan.goal.z),
            },
            {
              height,
              maxDrop: plan.maxDrop ?? MOB_SAFE_DROP,
              swim: definition.hostile || entity.inWater,
              reach: Math.max(0.5, (plan.reach ?? 0.5) - 0.5),
            },
          );
          entity.pathIndex = 0;
          if (plan.goal !== entity.pathGoal) entity.pathGoal = { ...plan.goal };
          if (!entity.path && entity.stroll > 0) entity.stroll = 0;
        }
        const path = entity.path;
        if (path && entity.pathIndex < path.length) {
          let wp = path[entity.pathIndex];
          const reachWp = speed > 2 ? 0.5 : 0.35;
          while (
            entity.pathIndex < path.length &&
            Math.hypot(wp.x + 0.5 - p.x, wp.z + 0.5 - p.z) < reachWp &&
            wp.y <= p.y + 0.6
          ) {
            entity.pathIndex++;
            wp = path[Math.min(entity.pathIndex, path.length - 1)];
          }
          if (entity.pathIndex < path.length) {
            const wx = wp.x + 0.5 - p.x,
              wz = wp.z + 0.5 - p.z;
            heading = Math.atan2(wz, wx);
            if (wp.y > Math.floor(p.y + 0.01) && Math.hypot(wx, wz) < 1.3) jump = true;
          } else speed = 0;
        } else if (!path) {
          // No path yet (or none at all): press on directly so a hunter is never frozen.
          heading = Math.atan2(gz, gx);
          if (entity.stroll > 0 && entity.repath > 0 && !definition.hostile) speed = 0;
        } else speed = 0;
      }
    }
    if (heading === undefined) speed = 0;
    // Hazard guard for anything walking without a path (flights, straight lines).
    if (
      speed > 0 &&
      heading !== undefined &&
      !entity.path &&
      !definition.flies &&
      plan.goal !== context.playerPosition &&
      this.unsafeAhead(context.world, entity, definition, heading)
    ) {
      speed = 0;
      entity.stroll = 0;
      if (entity.panic > 0) entity.wanderYaw += Math.PI * (0.5 + context.random());
    }
    const accel = plan.accel ?? 0.35;
    const wantX = heading === undefined ? 0 : Math.cos(heading) * speed,
      wantZ = heading === undefined ? 0 : Math.sin(heading) * speed;
    if (speed > 0) {
      entity.velocity.x += (wantX - entity.velocity.x) * accel;
      entity.velocity.z += (wantZ - entity.velocity.z) * accel;
    } else if (definition.speed <= 0 || definition.hostile) {
      entity.velocity.x *= MOB_IDLE_DRAG;
      entity.velocity.z *= MOB_IDLE_DRAG;
    } else {
      entity.velocity.x *= 0.5;
      entity.velocity.z *= 0.5;
    }
    if (speed === 0 && Math.hypot(entity.velocity.x, entity.velocity.z) < 0.02) {
      entity.velocity.x = 0;
      entity.velocity.z = 0;
    }
    const target =
      plan.face ??
      (speed > 0 && heading !== undefined ? faceYaw(Math.cos(heading), Math.sin(heading)) : null);
    if (target !== null)
      entity.yaw = turnTowards(entity.yaw, target, definition.hostile ? 0.45 : 0.3);
    // Jump up a block on the path, or when walking into a wall that a jump can clear.
    if (speed > 0 && entity.onGround && (jump || entity.collided))
      entity.velocity.y = MOB_JUMP_VELOCITY;
    if (speed > 0 && entity.inWater && entity.collided)
      entity.velocity.y = Math.max(entity.velocity.y, 6);
    // Stuck detection: a creature that makes no headway gives up the path and tries again.
    if (entity.age % 20 === 0) {
      const moved = Math.hypot(p.x - entity.lastSpot.x, p.z - entity.lastSpot.z);
      if (speed > 0 && moved < 0.3) {
        entity.stuck += 20;
        entity.path = null;
        entity.repath = 0;
        if (entity.stuck >= 60 && entity.stroll > 0) {
          entity.stroll = 0;
          entity.pathGoal = null;
        }
      } else entity.stuck = 0;
      entity.lastSpot = { ...p };
    }
  }
  /** Creatures push each other apart instead of standing inside one another. */
  private separate() {
    if (this.list.length < 2) return;
    const cells = new Map<number, MobEntity[]>();
    const cellKey = (x: number, z: number) => ((x & 0xffff) << 16) | (z & 0xffff);
    for (const m of this.list) {
      const k = cellKey(Math.floor(m.position.x), Math.floor(m.position.z));
      const bucket = cells.get(k);
      if (bucket) bucket.push(m);
      else cells.set(k, [m]);
    }
    for (const a of this.list) {
      const da = mobDefinition(a.kind)!;
      const ax = Math.floor(a.position.x),
        az = Math.floor(a.position.z);
      for (let ox = -1; ox <= 1; ox++)
        for (let oz = -1; oz <= 1; oz++)
          for (const b of cells.get(cellKey(ax + ox, az + oz)) ?? []) {
            if (b.id <= a.id) continue;
            const db = mobDefinition(b.kind)!;
            const sa = a.baby ? 0.55 : 1,
              sb = b.baby ? 0.55 : 1;
            const dx = b.position.x - a.position.x,
              dz = b.position.z - a.position.z,
              min = (da.width * sa + db.width * sb) / 2;
            if (Math.abs(dx) >= min || Math.abs(dz) >= min) continue;
            if (Math.abs(b.position.y - a.position.y) > Math.min(da.height * sa, db.height * sb))
              continue;
            let d = Math.hypot(dx, dz);
            let nx = dx,
              nz = dz;
            if (d < 1e-4) {
              nx = Math.cos(a.id * 2.4);
              nz = Math.sin(a.id * 2.4);
              d = 0;
            } else {
              nx /= d;
              nz /= d;
            }
            // A creature that never walks (the training dummy) is a post: the other one takes
            // the whole push and goes round it.
            const fixedA = da.speed === 0,
              fixedB = db.speed === 0;
            if (fixedA && fixedB) continue;
            const push = Math.min(0.5, min - Math.min(d, min)) * 3;
            const shareA = fixedA ? 0 : fixedB ? 2 : 1,
              shareB = fixedB ? 0 : fixedA ? 2 : 1;
            a.velocity.x -= nx * push * shareA;
            a.velocity.z -= nz * push * shareA;
            b.velocity.x += nx * push * shareB;
            b.velocity.z += nz * push * shareB;
          }
    }
  }

  /** A second creature already in love, close enough to make a child. */
  private findPartner(entity: MobEntity, definition: MobDefinition): MobEntity | undefined {
    void definition;
    return this.list.find(
      (other) =>
        other !== entity &&
        other.kind === entity.kind &&
        other.loveTicks > 0 &&
        Math.hypot(other.position.x - entity.position.x, other.position.z - entity.position.z) <= 8,
    );
  }

  /**
   * Feeding a passive creature its breeding item: the first animal waits, the second one turns
   * the pair into a child. A child grows up faster when fed. Returns what happened so the
   * caller can spend the item.
   */
  feed(entity: MobEntity, item: string): 'fed' | 'bred' | 'refused' {
    const definition = mobDefinition(entity.kind);
    if (!definition?.breedItem || definition.breedItem !== item) return 'refused';
    if (entity.baby) {
      if (entity.growth === 0) entity.growth = -MOB_GROW_TICKS;
      entity.growth = Math.min(0, entity.growth + Math.ceil(-entity.growth * 0.1));
      return 'fed';
    }
    if (entity.breedCooldown > 0 || entity.loveTicks > 0) return 'refused';
    const partner = this.list.find(
      (other) =>
        other !== entity &&
        other.kind === entity.kind &&
        other.loveTicks > 0 &&
        !other.baby &&
        Math.hypot(other.position.x - entity.position.x, other.position.z - entity.position.z) <= 8,
    );
    if (partner) {
      partner.loveTicks = 0;
      partner.breedCooldown = MOB_BREED_COOLDOWN;
      entity.breedCooldown = MOB_BREED_COOLDOWN;
      const child = this.spawn(entity.kind, { ...partner.position });
      child.baby = true;
      child.growth = -MOB_GROW_TICKS;
      child.loveTicks = 0;
      child.yaw = partner.yaw;
      if (entity.kind === 'lab:sheep') child.variant = (child.id & 1 ? entity : partner).variant;
      return 'bred';
    }
    entity.loveTicks = MOB_LOVE_TICKS;
    return 'fed';
  }
  /** Shears a grown sheep; returns the wool it gives (1–3) or 0 when there is nothing to cut. */
  shear(entity: MobEntity, random: () => number = Math.random): number {
    if (entity.kind !== 'lab:sheep' || entity.sheared || entity.baby) return 0;
    entity.sheared = true;
    return 1 + Math.floor(random() * 3);
  }
  /** A grown cow can be milked into a bucket. */
  milkable(entity: MobEntity): boolean {
    return entity.kind === 'lab:cow' && !entity.baby;
  }

  /** Hostile creatures only appear in the dark, exactly as the spawn rule of the reference. */
  canSpawnHostile(lightLevel: number): boolean {
    return lightLevel <= 7;
  }

  /** Spawns the first creature of `kind` that fits, for the world generator and for tests. */
  spawnNear(kind: string, position: Vec3, lightLevel: number): MobEntity | null {
    const definition = mobDefinition(kind);
    if (!definition) return null;
    if (
      definition.hostile &&
      definition.spawnLightMax !== undefined &&
      lightLevel > definition.spawnLightMax
    )
      return null;
    if (this.list.length >= MAX_MOBS) return null;
    return this.spawn(kind, position);
  }

  /**
   * Gravity, buoyancy, climbing and collision for one creature. Returns the fall damage of a
   * landing, which the caller applies.
   */
  private integrate(
    context: MobTickContext,
    entity: MobEntity,
    definition: MobDefinition,
    plan: Plan,
  ): number {
    const world = context.world;
    const height = definition.height * (entity.baby ? 0.55 : 1);
    if (entity.onGround) entity.velocity.y = Math.max(0, entity.velocity.y);
    if (definition.flies) {
      // A blaze floats: it rises and sinks towards the height it wants, or drifts down slowly.
      if (plan.hover !== undefined) {
        const want = Math.max(-2, Math.min(2, (plan.hover - entity.position.y) * 1.5));
        entity.velocity.y += (want - entity.velocity.y) * 0.25;
      } else entity.velocity.y = Math.max(entity.velocity.y - 0.3, -1.2);
    } else {
      entity.velocity.y -= MOB_GRAVITY * 0.05;
      entity.velocity.y = Math.max(-55, entity.velocity.y);
    }
    // Creatures float: water at chest height pushes them up so they bob at the surface; with
    // only the feet wet they are still swimming and can kick themselves up onto a bank.
    const chest = blockAt(
      world,
      entity.position.x,
      entity.position.y + Math.min(0.7, height * 0.55),
      entity.position.z,
    );
    const paddling =
      blockAt(world, entity.position.x, entity.position.y + 0.1, entity.position.z)?.fluid ===
      'water';
    entity.inWater = chest?.fluid === 'water' || paddling;
    if (chest?.fluid === 'water') {
      entity.velocity.y = Math.min(entity.velocity.y + MOB_GRAVITY * 0.05 + 1.1, 2.4);
      entity.velocity.x *= 0.8;
      entity.velocity.z *= 0.8;
    } else if (paddling) entity.velocity.y = Math.max(entity.velocity.y, -1);
    // Chickens flap their wings and flutter down instead of falling.
    if (entity.kind === 'lab:chicken') entity.velocity.y = Math.max(entity.velocity.y, -3);
    // A spider walks up walls.
    if (entity.climbing) entity.velocity.y = Math.max(entity.velocity.y, 2.4);
    const dt = 0.05;
    entity.collided = false;
    this.move(world, entity, definition, 'x', entity.velocity.x * dt);
    this.move(world, entity, definition, 'z', entity.velocity.z * dt);
    entity.climbing = entity.kind === 'lab:spider' && entity.collided && (plan.speed ?? 0) > 0;
    // The intended step is measured before the move, because a blocked move clears the speed.
    const intended = entity.velocity.y * dt;
    const beforeY = entity.position.y;
    this.move(world, entity, definition, 'y', intended);
    const travelled = entity.position.y - beforeY;
    const wasGround = entity.onGround;
    entity.onGround = intended < 0 && travelled > intended + 1e-9;
    if (entity.onGround) entity.velocity.y = 0;
    let damage = 0;
    if (entity.inWater || entity.climbing || definition.flies || entity.kind === 'lab:chicken')
      entity.fallDistance = 0;
    else if (travelled < 0) entity.fallDistance -= travelled;
    if (entity.onGround) {
      if (!wasGround && entity.fallDistance > 3) damage = Math.ceil(entity.fallDistance - 3);
      entity.fallDistance = 0;
    }
    if (entity.position.y < -16) this.remove(entity);
    return damage;
  }

  private move(
    world: VoxelWorld,
    entity: MobEntity,
    definition: MobDefinition,
    axis: 'x' | 'y' | 'z',
    amount: number,
  ): void {
    if (amount === 0) return;
    const width = definition.width * (entity.baby ? 0.55 : 1),
      height = definition.height * (entity.baby ? 0.55 : 1);
    const next = { ...entity.position };
    next[axis] += amount;
    // Stepping up: slabs, stairs and paths are walked over; a full block needs a jump.
    if (
      axis !== 'y' &&
      boxHits(world, next, width, height) &&
      entity.onGround &&
      !boxHits(world, { ...next, y: next.y + MOB_STEP_HEIGHT }, width, height)
    ) {
      entity.position.y += MOB_STEP_HEIGHT;
      entity.velocity.y = 0;
    }
    if (boxHits(world, next, width, height)) {
      if (axis === 'y') {
        entity.velocity.y = 0;
        return;
      }
      entity.velocity[axis] = 0;
      entity.collided = true;
      return;
    }
    entity.position[axis] = next[axis];
  }
  snapshot(): SavedMob[] {
    return this.list.map((entity) => {
      const extra: SavedMobExtra = {};
      if (entity.baby) extra.g = entity.growth || -MOB_GROW_TICKS;
      if (entity.variant) extra.v = entity.variant;
      if (entity.sheared) extra.s = 1;
      if (entity.breedCooldown) extra.c = entity.breedCooldown;
      if (entity.home)
        extra.h = [
          Math.round(entity.home.x * 10) / 10,
          Math.round(entity.home.y * 10) / 10,
          Math.round(entity.home.z * 10) / 10,
        ];
      if (entity.tradeUses.some((uses) => uses > 0)) extra.u = [...entity.tradeUses];
      const saved: SavedMob = [
        entity.kind,
        entity.position.x,
        entity.position.y,
        entity.position.z,
        entity.health,
        entity.yaw,
      ];
      if (Object.keys(extra).length) saved.push(extra);
      return saved;
    });
  }
  restore(data: readonly SavedMob[]): number {
    this.clear();
    let skipped = 0;
    for (const entry of data) {
      const [kind, x, y, z, health, yaw, extra] = entry;
      if (!mobDefinition(kind)) {
        skipped++;
        continue;
      }
      const entity = this.spawn(kind, { x, y, z }, health);
      entity.yaw = yaw;
      if (extra && typeof extra === 'object') {
        if (typeof extra.g === 'number' && extra.g < 0) {
          entity.baby = true;
          entity.growth = Math.max(-MOB_GROW_TICKS, Math.round(extra.g));
        }
        if (typeof extra.v === 'number' && extra.v >= 0 && extra.v < 16)
          entity.variant = Math.floor(extra.v);
        if (
          Array.isArray(extra.h) &&
          extra.h.length === 3 &&
          extra.h.every((n) => typeof n === 'number' && Number.isFinite(n))
        )
          entity.home = { x: extra.h[0], y: extra.h[1], z: extra.h[2] };
        if (Array.isArray(extra.u))
          entity.tradeUses = extra.u
            .slice(0, 32)
            .map((n) => (typeof n === 'number' && n > 0 ? Math.min(99, Math.floor(n)) : 0));
        if (extra.s) entity.sheared = true;
        if (typeof extra.c === 'number' && extra.c > 0)
          entity.breedCooldown = Math.min(MOB_BREED_COOLDOWN, extra.c);
      }
    }
    return skipped;
  }
  renderPositions(): { id: number; kind: string; x: number; y: number; z: number; yaw: number }[] {
    return this.list.map((entity) => {
      const definition = mobDefinition(entity.kind)!;
      return {
        id: entity.id,
        kind: entity.kind,
        x: entity.position.x,
        y: entity.position.y + definition.height / 2,
        z: entity.position.z,
        yaw: entity.yaw,
      };
    });
  }
  /** Distance from the player to the nearest creature, for the "can I sleep" rule. */
  hostileNear(position: Vec3, radius: number): boolean {
    return this.list.some((entity) => {
      const definition = mobDefinition(entity.kind);
      if (!definition?.hostile) return false;
      const dx = entity.position.x - position.x;
      const dy = entity.position.y - position.y;
      const dz = entity.position.z - position.z;
      return Math.hypot(dx, dy, dz) <= radius;
    });
  }
  info(id: number): { kind: string; name: string; health: number; max: number } | undefined {
    const entity = this.byId(id);
    if (!entity) return undefined;
    const definition = mobDefinition(entity.kind);
    return definition
      ? { kind: entity.kind, name: definition.name, health: entity.health, max: definition.health }
      : undefined;
  }
}
export function mobColors(kind: string): { body: string; head: string } {
  const definition = mobDefinition(kind);
  return { body: definition?.color ?? '#888', head: definition?.headColor ?? '#aaa' };
}
