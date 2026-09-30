import {
  copyEnchantments,
  ENCHANTMENT_LEVELS,
  type EnchantmentId,
} from '../../core/src/item-metadata';
import { isGameMode, JOURNEY_GOALS, type JourneyGoal } from '../../core/src/gameplay';
/* eslint-disable no-control-regex -- Deliberately reject control characters in save metadata and filenames. */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { registry } from '../../content/src/blocks';
import { itemRegistry, itemDurability } from '../../content/src/items';
import { definition, stack, type SlotData, type Slot } from '../../core/src/inventory';
import { validBlockPosition, WORLD_LIMIT, type Vec3 } from '../../core/src/coordinates';
import { isScenicPreset, isWorldPreset } from '../../core/src/terrain';
import {
  DIFFICULTIES,
  MAX_AIR,
  MAX_FOOD,
  MAX_HEALTH,
  type SavedSurvival,
} from '../../core/src/survival';
import { EFFECT_IDS } from '../../core/src/effects';
import { mobDefinition, type SavedMob, type SavedMobExtra } from '../../core/src/mobs';
import { isDimensionId, type DimensionId } from '../../core/src/dimensions';
import type { SavedBossState, SavedBoss, SavedCrystal } from '../../core/src/bosses';
import type { DimensionState } from '../../core/src/simulation';
import type { ProjectileKind, SavedArrow, SavedOrb } from '../../core/src/projectiles';
import {
  SCENIC_GENERATOR_VERSION,
  GENERATOR_ID,
  GENERATOR_VERSION,
  type CoreCheckpoint,
  type SavedContainer,
  type SavedOverride,
} from '../../core/src/persistence';
import type { SavedItemEntity } from '../../core/src/entities';
import { SaveError } from './errors';

export const WORLD_FORMAT = 'voxel-lab/world';
/**
 * Which generator a file may name. Saves of the scenic fixtures were written by generator 1 and
 * regenerate byte for byte the same world, so they keep loading; the biome worlds only exist
 * from generator 2 on, and a biome world claiming version 1 would be regenerated differently.
 */
function generatorVersionOk(version: unknown, preset: unknown): boolean {
  return (
    typeof version === 'number' &&
    Number.isInteger(version) &&
    version >= SCENIC_GENERATOR_VERSION &&
    version <= GENERATOR_VERSION &&
    (version >= 2 || isScenicPreset(String(preset)))
  );
}
/**
 * 1: blocks only. 2: adds inventory, cursor, block containers and dropped items.
 * 3: adds survival state, creatures, arrows, experience orbs and the time of day.
 * 4: adds the world systems — fluid cells, burning fire, TNT fuses, falling blocks, the
 *    redstone network — plus enchantments, brewing stands and minecarts.
 */
export const SAVE_VERSION = 6;
export const LEGACY_VERSION = 1;
export const PREVIOUS_VERSION = 3;
export const VERSION_2 = 2;
/** Every version this build can still read; each one has its own upgrade path. */
export const READABLE_VERSIONS = [1, 2, 3, 4, 5, SAVE_VERSION];
export const MAX_MOBS = 256;
export const MAX_ARROWS = 1024;
export const MAX_ORBS = 1024;
export const MAX_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_OVERRIDES = 150_000;
export const MAX_EVENTS = 10_000;
export const MAX_CONTAINERS = 4096;
export const MAX_ITEM_ENTITIES = 4096;
export const MAX_FLUID_CELLS = 8192;
export const MAX_FIRE_CELLS = 4096;
export const MAX_FALLING_BLOCKS = 2048;
export const MAX_REDSTONE_PARTS = 16384;
export const MAX_ENCHANTMENTS = 512;
export const MAX_BREWING_STANDS = 256;
export const MAX_CARTS = 256;
export const PLAYER_SLOTS = 41;
export interface ClientCheckpoint {
  settings: { radius: number; fov: number; sensitivity: number };
}
export interface LegacyClientCheckpoint {
  hotbar: string[];
  slot: number;
  settings: { radius: number; fov: number; sensitivity: number };
}
export interface LegacyCoreCheckpoint {
  generator: CoreCheckpoint['generator'];
  dimension: 'overworld';
  tick: number;
  spawn: Vec3;
  player: CoreCheckpoint['player'];
  look: { yaw: number; pitch: number };
  selectedBlock: string;
  editCount: number;
  overrides: SavedOverride[];
  scheduler: CoreCheckpoint['scheduler'];
}
export interface LegacyPayload {
  name: string;
  createdAt: number;
  savedAt: number;
  core: LegacyCoreCheckpoint;
  client: LegacyClientCheckpoint;
}
export interface WorldPayload {
  name: string;
  createdAt: number;
  savedAt: number;
  core: CoreCheckpoint;
  client: ClientCheckpoint;
}
export interface WorldEnvelope {
  format: typeof WORLD_FORMAT;
  version: typeof SAVE_VERSION;
  /** True when the file was written by an older build and upgraded while opening. */
  migrated: boolean;
  checksum: { algorithm: 'SHA-256'; value: string };
  payload: WorldPayload;
}
const textEncoder = new TextEncoder();
const bad = (message: string): never => {
  throw new SaveError('CORRUPT', `Некорректный файл мира: ${message}`);
};
function object(value: unknown, fields: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad(label);
  const obj = value as Record<string, unknown>;
  if (
    Object.keys(obj).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(obj, key)) ||
    Object.keys(obj).some((key) => !fields.includes(key))
  )
    return bad(`${label}: неизвестные или отсутствующие поля`);
  return obj;
}
function number(value: unknown, min: number, max: number, label: string, integer = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isSafeInteger(value))
  )
    return bad(label);
  return value;
}
function string(value: unknown, max: number, label: string, allowEmpty = false): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!allowEmpty && !value.trim()) ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    return bad(label);
  return value;
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') return bad(label);
  return value;
}
function vector(value: unknown, velocity = false): Vec3 {
  const v = object(value, ['x', 'y', 'z'], 'вектор');
  const limit = velocity ? 1000 : WORLD_LIMIT - 1;
  return {
    x: number(v.x, -limit, limit, 'x'),
    y: number(v.y, velocity ? -1000 : -1_000_000, velocity ? 1000 : 1_000_000, 'y'),
    z: number(v.z, -limit, limit, 'z'),
  };
}
function blockKey(value: unknown, placeable = false): string {
  const key = string(value, 128, 'ID блока');
  const def = registry.find(key);
  if (!def)
    throw new SaveError(
      'UNSUPPORTED',
      `Блок «${key}» не поддерживается этой сборкой. Файл не изменён.`,
    );
  if (placeable && !def.placeable) return bad('неразрешённый блок в палитре');
  return key;
}
function itemKey(value: unknown, label = 'ID предмета'): string {
  const key = string(value, 128, label);
  if (!itemRegistry.find(key))
    throw new SaveError(
      'UNSUPPORTED',
      `Предмет «${key}» не поддерживается этой сборкой. Файл не изменён.`,
    );
  return key;
}
function slot(value: unknown, label = 'слот'): SlotData {
  if (value === null) return null;
  if (!Array.isArray(value) || ![3, 4].includes(value.length))
    return bad(`${label}: ожидается [предмет, количество, износ]`);
  const key = itemKey(value[0], label);
  const def = definition({ item: key, count: 1 });
  return [
    key,
    number(value[1], 1, def.maxStack, `${label}: количество`, true),
    number(value[2], 0, Math.max(0, itemDurability(def) - 1), `${label}: износ`, true),
    ...(value.length === 4 ? [metadata(value[3])] : []),
  ] as SlotData;
}
function metadata(value: unknown) {
  try {
    return copyEnchantments(value);
  } catch {
    return bad('зачарования предмета');
  }
}
function slotArray(value: unknown, size: number, label: string): SlotData[] {
  if (!Array.isArray(value) || value.length !== size)
    return bad(`${label}: ожидается ${size} слотов`);
  return value.map((entry, index) => slot(entry, `${label} #${index + 1}`));
}
function blockPosition(
  x: unknown,
  y: unknown,
  z: unknown,
  label: string,
): [number, number, number] {
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof z !== 'number' ||
    !validBlockPosition(x, y, z)
  )
    return bad(label);
  return [x, y, z];
}

/** Converts the stored triple back into a runtime slot, or null for an empty one. */
function decodeSlot(data: SlotData): Slot {
  if (!data) return null;
  return stack(data[0], data[1], data[2], data[3]);
}
/** Fluid, fire, falling and redstone state of a version 4 world. */
function validateWorldSystems(value: unknown): CoreCheckpoint['blocks'] {
  const d = object(value, ['fluids', 'fire', 'fuses', 'falling', 'redstone'], 'состояние блоков');
  const cell = (entry: unknown, label: string): { x: number; y: number; z: number } => {
    const c = object(entry, ['x', 'y', 'z'], label);
    const [x, y, z] = blockPosition(c.x, c.y, c.z, label);
    return { x, y, z };
  };
  if (!Array.isArray(d.fluids) || d.fluids.length > MAX_FLUID_CELLS) return bad('клетки жидкости');
  if (!Array.isArray(d.fire) || d.fire.length > MAX_FIRE_CELLS) return bad('очаги огня');
  if (!Array.isArray(d.fuses) || d.fuses.length > MAX_FALLING_BLOCKS) return bad('фитили');
  if (!Array.isArray(d.falling) || d.falling.length > MAX_FALLING_BLOCKS)
    return bad('падающие блоки');
  if (!Array.isArray(d.redstone) || d.redstone.length > MAX_REDSTONE_PARTS)
    return bad('элементы редстоуна');
  const timed = (
    entry: unknown,
    label: string,
  ): { x: number; y: number; z: number; delay: number } => {
    const e = object(entry, ['x', 'y', 'z', 'delay'], label);
    const [x, y, z] = blockPosition(e.x, e.y, e.z, label);
    return { x, y, z, delay: number(e.delay, 0, 100_000, label, true) };
  };
  return {
    fluids: d.fluids.map((entry) => cell(entry, 'клетка жидкости')),
    fire: d.fire.map((entry) => {
      const f = object(entry, ['x', 'y', 'z', 'age'], 'очаг огня');
      const [x, y, z] = blockPosition(f.x, f.y, f.z, 'очаг огня');
      return { x, y, z, age: number(f.age, 0, 100_000, 'возраст огня', true) };
    }),
    fuses: d.fuses.map((entry) => timed(entry, 'фитиль')),
    falling: d.falling.map((entry) => timed(entry, 'падающий блок')),
    redstone: d.redstone.map((entry) => {
      const r = object(
        entry,
        ['x', 'y', 'z', 'power', 'facing', 'delay', 'mode', 'timer'],
        'элемент редстоуна',
      );
      const [x, y, z] = blockPosition(r.x, r.y, r.z, 'элемент редстоуна');
      return {
        x,
        y,
        z,
        power: number(r.power, 0, 15, 'сила сигнала', true),
        facing: facing(r.facing),
        delay: number(r.delay, 1, 4, 'задержка', true),
        mode: r.mode === 'subtract' ? ('subtract' as const) : ('compare' as const),
        timer: number(r.timer, 0, 100_000, 'таймер', true),
      };
    }),
  };
}
function facing(value: unknown): 'north' | 'south' | 'east' | 'west' {
  if (value === 'north' || value === 'south' || value === 'east' || value === 'west') return value;
  return bad('направление');
}
function validateEnchantments(value: unknown): CoreCheckpoint['enchantments'] {
  if (!Array.isArray(value) || value.length > MAX_ENCHANTMENTS) return bad('зачарования');
  return value.map((raw) => {
    const e = object(raw, ['item', 'id', 'level'], 'зачарование');
    return {
      item: itemKey(e.item, 'предмет зачарования'),
      id: string(e.id, 32, 'зачарование'),
      level: number(e.level, 1, 10, 'уровень зачарования', true),
    };
  });
}
function runtimeSlot(value: unknown, label: string): Slot {
  if (value === null || Array.isArray(value)) return decodeSlot(slot(value, label));
  const fields = [
    'item',
    'count',
    ...['damage', 'enchantments'].filter(
      (key) => !!value && typeof value === 'object' && Object.hasOwn(value, key),
    ),
  ];
  const entry = object(value, fields, label);
  return decodeSlot(
    slot(
      [
        entry.item,
        entry.count,
        entry.damage ?? 0,
        ...(entry.enchantments ? [entry.enchantments] : []),
      ],
      label,
    ),
  );
}
function validateBrewing(value: unknown): CoreCheckpoint['brewing'] {
  if (!Array.isArray(value) || value.length > MAX_BREWING_STANDS) return bad('варочные стойки');
  return value.map((raw) => {
    const entry = object(raw, ['key', 'state'], 'варочная стойка');
    const key = string(entry.key, 32, 'ключ стойки');
    if (!/^-?\d+,-?\d+,-?\d+$/.test(key)) return bad('ключ стойки');
    const [x, y, z] = key.split(',').map(Number);
    blockPosition(x, y, z, 'координаты стойки');
    const st = object(
      entry.state,
      ['ingredient', 'bottles', 'powder', 'fuel', 'progress'],
      'содержимое стойки',
    );
    if (!Array.isArray(st.bottles) || st.bottles.length !== 3) return bad('бутылочки стойки');
    return {
      key,
      state: {
        ingredient: runtimeSlot(st.ingredient, 'ингредиент'),
        bottles: st.bottles.map((entry2, index) => runtimeSlot(entry2, `бутылочка #${index + 1}`)),
        powder: runtimeSlot(st.powder, 'порошок'),
        fuel: number(st.fuel, 0, 10_000, 'заряды варки', true),
        progress: number(st.progress, 0, 10_000, 'прогресс варки', true),
      },
    };
  });
}
function validateCarts(value: unknown): CoreCheckpoint['carts'] {
  if (!Array.isArray(value) || value.length > MAX_CARTS) return bad('вагонетки');
  return value.map((raw) => {
    const c = object(raw, ['kind', 'x', 'y', 'z', 'vx', 'vz'], 'вагонетка');
    if (c.kind !== 'ride' && c.kind !== 'chest') return bad('тип вагонетки');
    const { x, y, z } = vector({ x: c.x, y: c.y, z: c.z });
    return {
      kind: c.kind,
      x,
      y,
      z,
      vx: number(c.vx, -100, 100, 'скорость вагонетки'),
      vz: number(c.vz, -100, 100, 'скорость вагонетки'),
    };
  });
}

function validateContainers(value: unknown): SavedContainer[] {
  if (!Array.isArray(value) || value.length > MAX_CONTAINERS)
    throw new SaveError('LIMIT', `Поддерживается до ${MAX_CONTAINERS} контейнеров в одном мире.`);
  const seen = new Set<string>();
  return value.map((raw) => {
    const c =
      raw && typeof raw === 'object' && !Array.isArray(raw) && 'furnace' in raw
        ? object(raw, ['key', 'kind', 'slots', 'furnace'], 'контейнер')
        : object(raw, ['key', 'kind', 'slots'], 'контейнер');
    const key = string(c.key, 32, 'ключ контейнера');
    if (!/^-?\d+,-?\d+,-?\d+$/.test(key)) return bad('ключ контейнера');
    const [x, y, z] = key.split(',').map(Number);
    blockPosition(x, y, z, 'координаты контейнера');
    if (seen.has(key)) return bad('повторный контейнер');
    seen.add(key);
    if (c.kind !== 'chest' && c.kind !== 'furnace' && c.kind !== 'hopper' && c.kind !== 'dispenser')
      return bad('тип контейнера');
    const kind = c.kind;
    if (kind === 'furnace' && c.furnace !== undefined) {
      const fields = ['burn', 'burnTotal', 'cook', 'xp'];
      const f =
        c.furnace && typeof c.furnace === 'object' && 'perItem' in c.furnace
          ? object(c.furnace, [...fields, 'perItem'], 'состояние печи')
          : object(c.furnace, fields, 'состояние печи');
      return {
        key,
        kind: 'furnace' as const,
        slots: slotArray(c.slots, 3, 'содержимое печи'),
        furnace: {
          burn: number(f.burn, 0, 100_000, 'остаток топлива', true),
          burnTotal: number(f.burnTotal, 0, 100_000, 'полное время горения', true),
          cook: number(f.cook, 0, 100_000, 'прогресс плавки', true),
          xp: number(f.xp, 0, 1_000_000, 'опыт печи'),
          perItem:
            f.perItem === undefined ? undefined : number(f.perItem, 0, 100, 'опыт за изделие'),
        },
      };
    }
    if (c.furnace !== undefined) return bad('состояние печи у сундука');
    const capacity = kind === 'chest' ? 27 : kind === 'hopper' ? 5 : kind === 'dispenser' ? 9 : 3;
    return { key, kind, slots: slotArray(c.slots, capacity, 'содержимое контейнера') };
  });
}
function validateItems(value: unknown): SavedItemEntity[] {
  if (!Array.isArray(value) || value.length > MAX_ITEM_ENTITIES)
    throw new SaveError('LIMIT', `Поддерживается до ${MAX_ITEM_ENTITIES} предметов на земле.`);
  return value.map((raw) => {
    if (!Array.isArray(raw) || ![7, 8].includes(raw.length)) return bad('предмет в мире');
    const [item, count, damage, x, y, z, age] = raw;
    const key = itemKey(item, 'ID предмета в мире');
    const def = definition({ item: key, count: 1 });
    return [
      key,
      number(count, 1, def.maxStack, 'количество предмета', true),
      number(damage, 0, Math.max(0, itemDurability(def) - 1), 'износ предмета', true),
      number(x, -WORLD_LIMIT, WORLD_LIMIT, 'координата x предмета'),
      number(y, -1_000_000, 1_000_000, 'координата y предмета'),
      number(z, -WORLD_LIMIT, WORLD_LIMIT, 'координата z предмета'),
      number(age, 0, 1_000_000, 'возраст предмета', true),
      ...(raw.length === 8 ? [metadata(raw[7])] : []),
    ] as SavedItemEntity;
  });
}
function validateEffects(value: unknown): SavedSurvival['effects'] {
  if (!Array.isArray(value) || value.length > EFFECT_IDS.length * 2)
    throw new SaveError('LIMIT', 'Слишком много эффектов в сохранении.');
  const seen = new Set<string>();
  return value.map((raw) => {
    const e = object(raw, ['id', 'duration', 'amplifier'], 'эффект');
    const id = string(e.id, 32, 'ID эффекта');
    if (!EFFECT_IDS.includes(id)) return bad('неизвестный эффект');
    if (seen.has(id)) return bad('повторный эффект');
    seen.add(id);
    return {
      id,
      duration: number(e.duration, 1, 1_000_000, 'длительность эффекта', true),
      amplifier: number(e.amplifier, 0, 9, 'уровень эффекта', true),
    };
  });
}
export function validateSurvival(value: unknown): SavedSurvival {
  const d = object(
    value,
    [
      'health',
      'absorption',
      'food',
      'saturation',
      'exhaustion',
      'air',
      'xp',
      'level',
      'spawn',
      'difficulty',
      'dead',
      'effects',
    ],
    'состояние выживания',
  );
  const spawn = vector(d.spawn);
  if (!DIFFICULTIES.includes(d.difficulty as (typeof DIFFICULTIES)[number]))
    return bad('сложность');
  return {
    health: number(d.health, 0, MAX_HEALTH, 'здоровье'),
    absorption: number(d.absorption, 0, MAX_HEALTH, 'поглощение'),
    food: number(d.food, 0, MAX_FOOD, 'голод'),
    saturation: number(d.saturation, 0, MAX_FOOD, 'насыщение'),
    exhaustion: number(d.exhaustion, 0, 4, 'истощение'),
    air: number(d.air, -20, MAX_AIR, 'запас воздуха', true),
    xp: number(d.xp, 0, 1_000_000_000, 'опыт'),
    level: number(d.level, 0, 100_000, 'уровень', true),
    spawn: { x: spawn.x, y: spawn.y, z: spawn.z },
    difficulty: d.difficulty as SavedSurvival['difficulty'],
    dead: boolean(d.dead, 'признак смерти'),
    effects: validateEffects(d.effects),
  };
}
function validateMobs(value: unknown): SavedMob[] {
  if (!Array.isArray(value) || value.length > MAX_MOBS)
    throw new SaveError('LIMIT', `Поддерживается до ${MAX_MOBS} существ в одном мире.`);
  return value.map((raw) => {
    // Six fields, plus an optional seventh with growth, wool colour, shearing and breeding.
    if (!Array.isArray(raw) || (raw.length !== 6 && raw.length !== 7)) return bad('существо');
    const [kind, x, y, z, health, yaw, extraRaw] = raw as unknown[];
    const key = string(kind, 32, 'вид существа');
    const definition = mobDefinition(key);
    if (!definition)
      throw new SaveError('UNSUPPORTED', `Существо «${key}» не поддерживается этой сборкой.`);
    return [
      key,
      number(x, -WORLD_LIMIT, WORLD_LIMIT, 'координата x существа'),
      number(y, -1_000_000, 1_000_000, 'координата y существа'),
      number(z, -WORLD_LIMIT, WORLD_LIMIT, 'координата z существа'),
      number(health, 0, definition.health, 'здоровье существа'),
      number(yaw, -10_000, 10_000, 'поворот существа'),
      ...(raw.length === 7 ? [validateMobExtra(extraRaw)] : []),
    ] as SavedMob;
  });
}
function validateMobExtra(value: unknown): SavedMobExtra {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad('данные существа');
  const d = value as Record<string, unknown>;
  for (const key of Object.keys(d))
    if (!['g', 'v', 's', 'c', 'h', 'u'].includes(key)) return bad('данные существа');
  const extra: SavedMobExtra = {};
  if (d.g !== undefined) extra.g = number(d.g, -1_000_000, 1_000_000, 'возраст существа');
  if (d.v !== undefined) extra.v = number(d.v, 0, 255, 'окраска существа', true);
  if (d.s !== undefined) {
    if (d.s !== 1) return bad('стрижка существа');
    extra.s = 1;
  }
  if (d.c !== undefined) extra.c = number(d.c, 0, 1_000_000, 'перерыв существа');
  // A villager: the village it belongs to and how often each offer was used since a restock.
  if (d.h !== undefined) {
    if (!Array.isArray(d.h) || d.h.length !== 3) return bad('дом жителя');
    extra.h = [
      number(d.h[0], -WORLD_LIMIT, WORLD_LIMIT, 'дом жителя'),
      number(d.h[1], -1_000_000, 1_000_000, 'дом жителя'),
      number(d.h[2], -WORLD_LIMIT, WORLD_LIMIT, 'дом жителя'),
    ];
  }
  if (d.u !== undefined) {
    if (!Array.isArray(d.u) || d.u.length > 32) return bad('сделки жителя');
    extra.u = d.u.map((n) => number(n, 0, 1_000, 'сделки жителя', true));
  }
  return extra;
}
function validateArrows(value: unknown): SavedArrow[] {
  if (!Array.isArray(value) || value.length > MAX_ARROWS)
    throw new SaveError('LIMIT', `Поддерживается до ${MAX_ARROWS} стрел в одном мире.`);
  return value.map((raw) => {
    // Eleven fields, plus the kind of projectile (fireball, egg, ghast fireball) when it is not
    // an arrow.
    if (!Array.isArray(raw) || (raw.length !== 11 && raw.length !== 12)) return bad('стрела');
    const [x, y, z, vx, vy, vz, damage, owner, age, stuck, critical, kind] = raw;
    if (owner !== 'player' && owner !== 'mob') return bad('владелец стрелы');
    if (raw.length === 12 && !PROJECTILE_KINDS.includes(kind)) return bad('вид снаряда');
    return [
      number(x, -WORLD_LIMIT, WORLD_LIMIT, 'координата x стрелы'),
      number(y, -1_000_000, 1_000_000, 'координата y стрелы'),
      number(z, -WORLD_LIMIT, WORLD_LIMIT, 'координата z стрелы'),
      number(vx, -1000, 1000, 'скорость стрелы'),
      number(vy, -1000, 1000, 'скорость стрелы'),
      number(vz, -1000, 1000, 'скорость стрелы'),
      number(damage, 0, 1000, 'урон стрелы'),
      owner,
      number(age, 0, 100_000, 'возраст стрелы', true),
      stuck ? 1 : 0,
      critical ? 1 : 0,
      ...(raw.length === 12 ? [kind as ProjectileKind] : []),
    ] as SavedArrow;
  });
}
const PROJECTILE_KINDS: readonly unknown[] = ['arrow', 'fireball', 'egg', 'ghast_fireball'];
function validateOrbs(value: unknown): SavedOrb[] {
  if (!Array.isArray(value) || value.length > MAX_ORBS)
    throw new SaveError('LIMIT', `Поддерживается до ${MAX_ORBS} сфер опыта в одном мире.`);
  return value.map((raw) => {
    if (!Array.isArray(raw) || raw.length !== 5) return bad('сфера опыта');
    const [points, x, y, z, age] = raw;
    return [
      number(points, 1, 10_000, 'значение сферы', true),
      number(x, -WORLD_LIMIT, WORLD_LIMIT, 'координата x сферы'),
      number(y, -1_000_000, 1_000_000, 'координата y сферы'),
      number(z, -WORLD_LIMIT, WORLD_LIMIT, 'координата z сферы'),
      number(age, 0, 100_000, 'возраст сферы', true),
    ];
  });
}
/** Files written before version 3 carry no survival state; defaults fill the gap. */
function upgradeCoreToV3(core: CoreCheckpoint, time = 0): CoreCheckpoint {
  return upgradeCoreToV4({
    ...core,
    time,
    survival: {
      ...defaultSurvivalCheckpoint(core.spawn),
    },
    mobs: [],
    arrows: [],
    orbs: [],
  });
}
/** A version 3 world knows nothing about fluids, fire or redstone: every list starts empty. */
function upgradeCoreToV4(core: CoreCheckpoint): CoreCheckpoint {
  return upgradeCoreToV5({
    ...core,
    blocks: { fluids: [], fire: [], fuses: [], falling: [], redstone: [] },
    enchantments: [],
    brewing: [],
    carts: [],
  });
}
/**
 * A version 4 world lives in the Overworld alone: no other dimension waits with its own state
 * and no boss is awake, so the lists start empty and the dimension is the Overworld.
 */
function upgradeCoreToV5(core: CoreCheckpoint): CoreCheckpoint {
  return {
    ...core,
    dimension: 'overworld',
    dimensions: [],
    bosses: { bosses: [], crystals: [] },
  } as CoreCheckpoint;
}
function defaultSurvivalCheckpoint(spawn: Vec3): SavedSurvival {
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
/** The creatures, chests and systems of one dimension, waiting while the player is elsewhere. */
function validateDimensionState(value: unknown): DimensionState {
  const d = object(
    value,
    ['mobs', 'arrows', 'orbs', 'items', 'containers', 'blocks', 'brewing', 'carts', 'bosses'],
    'состояние измерения',
  );
  const list = (entry: unknown, name: string): unknown[] => {
    if (entry === undefined) return [];
    if (!Array.isArray(entry)) return bad(name);
    return entry;
  };
  return {
    mobs: validateMobs(list(d.mobs, 'существа измерения')),
    arrows: validateArrows(list(d.arrows, 'стрелы измерения')),
    orbs: validateOrbs(list(d.orbs, 'сферы измерения')),
    items: validateItems(list(d.items, 'предметы измерения')),
    containers: validateContainers(list(d.containers, 'контейнеры измерения')),
    blocks: d.blocks === undefined ? {} : validateWorldSystems(d.blocks),
    brewing: validateBrewing(list(d.brewing, 'варильни измерения')),
    carts: validateCarts(list(d.carts, 'вагонетки измерения')),
    bosses: validateBosses(d.bosses),
  };
}
/** A list of entries with a cap; a missing list is empty, a wrong shape is an error. */
function entryList(value: unknown, max: number, label: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) return bad(label);
  return value;
}
function validateBosses(value: unknown): SavedBossState {
  if (value === undefined) return { bosses: [], crystals: [] };
  const extra = ['dragonDefeated', 'dragonEncountered'].filter((k) =>
    Object.hasOwn(value as object, k),
  );
  const d = object(value, ['bosses', 'crystals', ...extra], 'боссы');
  const bosses = entryList(d.bosses, 16, 'боссы').map((entry): SavedBoss => {
    const b = object(
      entry,
      ['kind', 'x', 'y', 'z', 'yaw', 'health', 'phase', 'angle', 'homeX', 'homeY', 'homeZ'],
      'босс',
    );
    if (b.kind !== 'ender_dragon' && b.kind !== 'wither') return bad('вид босса');
    if (b.phase !== 'circling' && b.phase !== 'charging' && b.phase !== 'perched')
      return bad('фаза босса');
    return {
      kind: b.kind,
      x: number(b.x, -WORLD_LIMIT, WORLD_LIMIT, 'координата x босса'),
      y: number(b.y, -1_000_000, 1_000_000, 'координата y босса'),
      z: number(b.z, -WORLD_LIMIT, WORLD_LIMIT, 'координата z босса'),
      yaw: number(b.yaw, -1e12, 1e12, 'поворот босса'),
      health: number(b.health, 0, 10_000, 'здоровье босса'),
      phase: b.phase,
      angle: number(b.angle, -1e6, 1e6, 'положение на орбите'),
      homeX: number(b.homeX, -WORLD_LIMIT, WORLD_LIMIT, 'дом босса x'),
      homeY: number(b.homeY, -1_000_000, 1_000_000, 'дом босса y'),
      homeZ: number(b.homeZ, -WORLD_LIMIT, WORLD_LIMIT, 'дом босса z'),
    };
  });
  const crystals = entryList(d.crystals, 256, 'кристаллы').map((entry): SavedCrystal => {
    const c = object(entry, ['x', 'y', 'z'], 'кристалл');
    return {
      x: number(c.x, -WORLD_LIMIT, WORLD_LIMIT, 'координата x кристалла'),
      y: number(c.y, -1_000_000, 1_000_000, 'координата y кристалла'),
      z: number(c.z, -WORLD_LIMIT, WORLD_LIMIT, 'координата z кристалла'),
    };
  });
  return {
    bosses,
    crystals,
    ...(d.dragonDefeated !== undefined
      ? { dragonDefeated: boolean(d.dragonDefeated, 'победа над драконом') }
      : {}),
    ...(d.dragonEncountered !== undefined
      ? { dragonEncountered: boolean(d.dragonEncountered, 'встреча с драконом') }
      : {}),
  };
}
export function validateCore(value: unknown, version: number = SAVE_VERSION): CoreCheckpoint {
  const v3 = version >= 3;
  const v4 = version >= 4;
  const v5 = version >= 5;
  const v6fields =
    version >= 6 && value && typeof value === 'object'
      ? ['gameMode', 'journey'].filter((k) => Object.hasOwn(value, k))
      : [];
  const d = object(
    value,
    [
      'generator',
      'dimension',
      'tick',
      ...(v3 ? ['time'] : []),
      'spawn',
      'player',
      'look',
      'inventory',
      'cursor',
      'containers',
      'items',
      ...(v3 ? ['survival', 'mobs', 'arrows', 'orbs'] : []),
      ...(v4 ? ['blocks', 'enchantments', 'brewing', 'carts'] : []),
      ...(v5 ? ['dimensions', 'bosses'] : []),
      ...v6fields,
      'editCount',
      'overrides',
      'scheduler',
    ],
    'состояние ядра',
  );
  const g = object(d.generator, ['id', 'version', 'seed', 'preset'], 'генератор');
  if (g.id !== GENERATOR_ID || !isWorldPreset(g.preset))
    throw new SaveError(
      'UNSUPPORTED',
      'Неподдерживаемый генератор или его версия. Мир не будет пересоздан другим алгоритмом.',
    );
  if (!generatorVersionOk(g.version, g.preset))
    throw new SaveError(
      'UNSUPPORTED',
      'Неподдерживаемый генератор или его версия. Мир не будет пересоздан другим алгоритмом.',
    );
  if (v5 ? !isDimensionId(d.dimension) : d.dimension !== 'overworld')
    throw new SaveError('UNSUPPORTED', 'Это измерение пока не поддерживается.');
  const p = object(d.player, ['position', 'velocity', 'onGround', 'flying', 'inWater'], 'игрок');
  const look = object(d.look, ['yaw', 'pitch'], 'обзор');
  const inventory = object(d.inventory, ['selected', 'slots'], 'инвентарь');
  if (!Array.isArray(d.overrides) || d.overrides.length > MAX_OVERRIDES)
    throw new SaveError(
      'LIMIT',
      `Поддерживается до ${MAX_OVERRIDES.toLocaleString('ru')} изменённых блоков в одном мире.`,
    );
  const seen = new Set<string>();
  const overrides: SavedOverride[] = d.overrides.map((entry) => {
    const expected = v5 ? [4, 5] : [4];
    if (!Array.isArray(entry) || !expected.includes(entry.length)) return bad('изменение блока');
    const [x, y, z, key] = entry;
    const dimension = entry.length === 5 ? entry[4] : 'overworld';
    if (!isDimensionId(dimension)) return bad('измерение изменённого блока');
    if (!validBlockPosition(x, y, z)) return bad('координаты изменённого блока');
    const id = `${dimension},${x},${y},${z}`;
    if (seen.has(id)) return bad('повторная координата блока');
    seen.add(id);
    // The Overworld is the default dimension: its entries keep the four-field shape, so a world
    // that never leaves home is byte for byte the file it was before the dimensions existed.
    return dimension === 'overworld'
      ? [x, y, z, blockKey(key)]
      : [x, y, z, blockKey(key), dimension as DimensionId];
  });
  const scheduler = object(d.scheduler, ['sequence', 'events'], 'планировщик');
  const sequence = number(scheduler.sequence, 0, Number.MAX_SAFE_INTEGER, 'счётчик событий', true);
  if (!Array.isArray(scheduler.events) || scheduler.events.length > MAX_EVENTS)
    throw new SaveError('LIMIT', 'Слишком много отложенных событий.');
  const sequences = new Set<number>();
  const events = scheduler.events.map((raw) => {
    const e = object(raw, ['at', 'priority', 'sequence', 'kind', 'data'], 'событие');
    const seq = number(e.sequence, 0, sequence - 1, 'номер события', true);
    if (sequences.has(seq)) return bad('повторное событие');
    sequences.add(seq);
    if (
      !e.data ||
      typeof e.data !== 'object' ||
      Array.isArray(e.data) ||
      Object.keys(e.data).length > 32
    )
      return bad('данные события');
    const data: Record<string, string | number> = {};
    for (const [key, val] of Object.entries(e.data)) {
      if (
        !/^[a-zA-Z0-9_:-]{1,64}$/.test(key) ||
        ['__proto__', 'constructor', 'prototype'].includes(key)
      )
        return bad('поле события');
      data[key] =
        typeof val === 'string'
          ? string(val, 256, 'значение события', true)
          : number(val, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'значение события');
    }
    return {
      at: number(e.at, 0, Number.MAX_SAFE_INTEGER, 'такт события', true),
      priority: number(e.priority, -1000, 1000, 'приоритет', true),
      sequence: seq,
      kind: string(e.kind, 64, 'тип события'),
      data,
    };
  });
  return {
    generator: {
      id: GENERATOR_ID,
      version: g.version as CoreCheckpoint['generator']['version'],
      seed: string(g.seed, 64, 'сид'),
      preset: g.preset,
    },
    dimension: (v5 ? d.dimension : 'overworld') as DimensionId,
    ...(version >= 6
      ? {
          gameMode:
            d.gameMode === undefined
              ? 'survival'
              : isGameMode(d.gameMode)
                ? d.gameMode
                : bad('режим игры'),
          journey: entryList(d.journey, JOURNEY_GOALS.length, 'первые шаги').map((goal) =>
            JOURNEY_GOALS.includes(goal as JourneyGoal)
              ? (goal as JourneyGoal)
              : bad('этап первых шагов'),
          ),
        }
      : {}),
    ...(v5
      ? {
          dimensions: entryList(d.dimensions, 8, 'измерения').map(
            (
              entry,
            ): {
              dimension: DimensionId;
              state: DimensionState;
            } => {
              const item = object(entry, ['dimension', 'state'], 'измерение');
              if (!isDimensionId(item.dimension)) return bad('имя измерения');
              return { dimension: item.dimension, state: validateDimensionState(item.state) };
            },
          ),
          bosses: validateBosses(d.bosses),
        }
      : {}),
    tick: number(d.tick, 0, Number.MAX_SAFE_INTEGER, 'такт мира', true),
    ...(v3 ? { time: number(d.time, 0, 23_999, 'время суток', true) } : {}),
    spawn: vector(d.spawn),
    player: {
      position: vector(p.position),
      velocity: vector(p.velocity, true),
      onGround: boolean(p.onGround, 'onGround'),
      flying: boolean(p.flying, 'flying'),
      inWater: boolean(p.inWater, 'inWater'),
    },
    look: {
      yaw: number(look.yaw, -1e12, 1e12, 'поворот'),
      pitch: number(look.pitch, -1.55, 1.55, 'наклон'),
    },
    inventory: {
      selected: number(inventory.selected, 0, 8, 'активный слот', true),
      slots: slotArray(inventory.slots, PLAYER_SLOTS, 'инвентарь'),
    },
    cursor: slot(d.cursor, 'предмет на курсоре'),
    containers: validateContainers(d.containers),
    items: validateItems(d.items),
    ...(v3
      ? {
          survival: validateSurvival(d.survival),
          mobs: validateMobs(d.mobs),
          arrows: validateArrows(d.arrows),
          orbs: validateOrbs(d.orbs),
        }
      : {}),
    ...(v4
      ? {
          blocks: validateWorldSystems(d.blocks),
          enchantments: validateEnchantments(d.enchantments),
          brewing: validateBrewing(d.brewing),
          carts: validateCarts(d.carts),
        }
      : {}),
    editCount: number(d.editCount, 0, Number.MAX_SAFE_INTEGER, 'число изменений', true),
    overrides,
    scheduler: { sequence, events },
  } as CoreCheckpoint;
}
export function validateClient(value: unknown): ClientCheckpoint {
  const c = object(value, ['settings'], 'клиент');
  const settings = object(c.settings, ['radius', 'fov', 'sensitivity'], 'настройки');
  return {
    settings: {
      radius: number(settings.radius, 2, 8, 'дальность', true),
      fov: number(settings.fov, 55, 100, 'FOV'),
      sensitivity: number(settings.sensitivity, 0.3, 2.5, 'чувствительность'),
    },
  };
}
export function validatePayload(value: unknown, version: number = SAVE_VERSION): WorldPayload {
  const p = object(value, ['name', 'createdAt', 'savedAt', 'core', 'client'], 'содержимое');
  return {
    name: string(p.name, 64, 'название'),
    createdAt: number(p.createdAt, 0, 8.64e15, 'дата создания', true),
    savedAt: number(p.savedAt, 0, 8.64e15, 'дата сохранения', true),
    core: validateCore(p.core, version),
    client: validateClient(p.client),
  };
}
export function validateLegacyCore(value: unknown): LegacyCoreCheckpoint {
  const d = object(
    value,
    [
      'generator',
      'dimension',
      'tick',
      'spawn',
      'player',
      'look',
      'selectedBlock',
      'editCount',
      'overrides',
      'scheduler',
    ],
    'состояние ядра (версия 1)',
  );
  const g = object(d.generator, ['id', 'version', 'seed', 'preset'], 'генератор');
  if (g.id !== GENERATOR_ID || !generatorVersionOk(g.version, g.preset))
    throw new SaveError('UNSUPPORTED', 'Неподдерживаемый генератор версии 1.');
  if (d.dimension !== 'overworld')
    throw new SaveError('UNSUPPORTED', 'Это измерение пока не поддерживается.');
  const p = object(d.player, ['position', 'velocity', 'onGround', 'flying', 'inWater'], 'игрок');
  const look = object(d.look, ['yaw', 'pitch'], 'обзор');
  if (!Array.isArray(d.overrides) || d.overrides.length > MAX_OVERRIDES)
    throw new SaveError('LIMIT', 'Слишком много изменённых блоков для версии 1.');
  const seen = new Set<string>();
  const overrides: SavedOverride[] = d.overrides.map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 4) return bad('изменение блока');
    const [x, y, z, key] = entry;
    if (!validBlockPosition(x, y, z)) return bad('координаты изменённого блока');
    const id = `${x},${y},${z}`;
    if (seen.has(id)) return bad('повторная координата блока');
    seen.add(id);
    return [x, y, z, blockKey(key)];
  });
  const scheduler = object(d.scheduler, ['sequence', 'events'], 'планировщик');
  return {
    generator: {
      id: GENERATOR_ID,
      version: g.version as CoreCheckpoint['generator']['version'],
      seed: string(g.seed, 64, 'сид'),
      preset: g.preset === 'valley' ? 'valley' : 'flat',
    },
    dimension: 'overworld',
    tick: number(d.tick, 0, Number.MAX_SAFE_INTEGER, 'такт мира', true),
    spawn: vector(d.spawn),
    player: {
      position: vector(p.position),
      velocity: vector(p.velocity, true),
      onGround: boolean(p.onGround, 'onGround'),
      flying: boolean(p.flying, 'flying'),
      inWater: boolean(p.inWater, 'inWater'),
    },
    look: {
      yaw: number(look.yaw, -1e12, 1e12, 'поворот'),
      pitch: number(look.pitch, -1.55, 1.55, 'наклон'),
    },
    selectedBlock: blockKey(d.selectedBlock, true),
    editCount: number(d.editCount, 0, Number.MAX_SAFE_INTEGER, 'число изменений', true),
    overrides,
    scheduler: {
      sequence: number(scheduler.sequence, 0, Number.MAX_SAFE_INTEGER, 'счётчик событий', true),
      events: [],
    },
  };
}
export function validateLegacyClient(value: unknown): LegacyClientCheckpoint {
  const c = object(value, ['hotbar', 'slot', 'settings'], 'клиент (версия 1)');
  if (!Array.isArray(c.hotbar) || c.hotbar.length !== 9) return bad('нужно 9 слотов');
  const settings = object(c.settings, ['radius', 'fov', 'sensitivity'], 'настройки');
  return {
    hotbar: c.hotbar.map((key) => blockKey(key, true)),
    slot: number(c.slot, 0, 8, 'активный слот', true),
    settings: {
      radius: number(settings.radius, 2, 8, 'дальность', true),
      fov: number(settings.fov, 55, 100, 'FOV'),
      sensitivity: number(settings.sensitivity, 0.3, 2.5, 'чувствительность'),
    },
  };
}
export function validateLegacyPayload(value: unknown): LegacyPayload {
  const p = object(value, ['name', 'createdAt', 'savedAt', 'core', 'client'], 'содержимое');
  const core = validateLegacyCore(p.core),
    client = validateLegacyClient(p.client);
  if (core.selectedBlock !== client.hotbar[client.slot])
    return bad('выбранный блок не совпадает с активным слотом');
  return {
    name: string(p.name, 64, 'название'),
    createdAt: number(p.createdAt, 0, 8.64e15, 'дата создания', true),
    savedAt: number(p.savedAt, 0, 8.64e15, 'дата сохранения', true),
    core,
    client,
  };
}
export const MIGRATION_STACK = 64;
/** Version 1 worlds had nine infinite block slots; version 2 hands out 64 of each. */
export function migrateLegacyPayload(legacy: LegacyPayload): WorldPayload {
  const slots: SlotData[] = new Array<SlotData>(PLAYER_SLOTS).fill(null);
  legacy.client.hotbar.forEach((key, index) => {
    const item = itemRegistry.ofBlock(registry.find(key)?.id ?? 0);
    if (item) slots[index] = [item.key, Math.min(item.maxStack, MIGRATION_STACK), 0];
  });
  return {
    name: legacy.name,
    createdAt: legacy.createdAt,
    savedAt: legacy.savedAt,
    core: upgradeCoreToV3({
      generator: legacy.core.generator,
      dimension: legacy.core.dimension,
      tick: legacy.core.tick,
      time: 0,
      spawn: legacy.core.spawn,
      player: legacy.core.player,
      look: legacy.core.look,
      inventory: { selected: legacy.client.slot, slots },
      cursor: null,
      containers: [],
      items: [],
      survival: defaultSurvivalCheckpoint(legacy.core.spawn),
      mobs: [],
      arrows: [],
      orbs: [],
      editCount: legacy.core.editCount,
      overrides: legacy.core.overrides,
      scheduler: legacy.core.scheduler,
    } as unknown as CoreCheckpoint),
    client: { settings: legacy.client.settings },
  };
}
/** Stable order makes whitespace and JSON property order irrelevant. Used only AFTER shape validation. */
export function canonicalJSON(value: unknown, depth = 0): string {
  if (depth > 64) return bad('слишком глубокая структура');
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value))
    return '[' + value.map((entry) => canonicalJSON(entry, depth + 1)).join(',') + ']';
  const record = value as Record<string, unknown>;
  return (
    '{' +
    Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJSON(record[key], depth + 1)}`)
      .join(',') +
    '}'
  );
}
export function payloadChecksum(payload: unknown): string {
  return bytesToHex(sha256(textEncoder.encode(canonicalJSON(payload))));
}
/** Upgrade definitions are copied onto EXISTING items; future crafted items stay unenchanted. */
function upgradeCoreToV6(core: CoreCheckpoint): CoreCheckpoint {
  const add = (entry: SlotData, upgrades = core.enchantments): SlotData => {
    if (!entry) return null;
    const old = upgrades.find((e) => e.item === entry[0]);
    if (!old || !Object.hasOwn(ENCHANTMENT_LEVELS, old.id)) return entry;
    const id = old.id as EnchantmentId;
    return [
      entry[0],
      entry[1],
      entry[2],
      copyEnchantments({ ...entry[3], [id]: Math.min(old.level, ENCHANTMENT_LEVELS[id]) }),
    ];
  };
  const migrate = (state: DimensionState) => {
    state.containers = state.containers.map((c) => ({
      ...c,
      slots: c.slots.map((slot) => add(slot)),
    }));
    state.items = state.items.map((item) => {
      const upgraded = add([item[0], item[1], item[2], item[7]]);
      return upgraded?.[3]
        ? ([
            item[0],
            item[1],
            item[2],
            item[3],
            item[4],
            item[5],
            item[6],
            upgraded[3],
          ] as SavedItemEntity)
        : item;
    });
  };
  core.inventory.slots = core.inventory.slots.map((entry) => add(entry));
  core.cursor = add(core.cursor);
  migrate(core);
  for (const entry of core.dimensions) migrate(entry.state);
  const endBosses =
    core.dimension === 'end'
      ? core.bosses
      : core.dimensions.find((d) => d.dimension === 'end')?.state.bosses;
  if (endBosses) {
    endBosses.dragonDefeated = core.overrides.some(
      (edit) => edit[4] === 'end' && (edit[3] === 'lab:dragon_egg' || edit[3] === 'lab:end_portal'),
    );
    endBosses.dragonEncountered =
      endBosses.dragonDefeated ||
      endBosses.bosses.some((b) => b.kind === 'ender_dragon') ||
      endBosses.crystals.length > 0;
  }
  return { ...core, gameMode: 'lab', journey: [], enchantments: [] };
}
export function sealWorld(raw: WorldPayload): WorldEnvelope {
  const payload = validatePayload(raw);
  const envelope: WorldEnvelope = {
    format: WORLD_FORMAT,
    version: SAVE_VERSION,
    migrated: false,
    checksum: { algorithm: 'SHA-256', value: payloadChecksum(payload) },
    payload,
  };
  if (textEncoder.encode(JSON.stringify(envelope)).length > MAX_FILE_BYTES)
    throw new SaveError('LIMIT', 'Файл мира превышает ограничение 16 МБ.');
  return envelope;
}
export function verifyWorld(value: unknown): WorldEnvelope {
  const e = object(
    value,
    [
      'format',
      'version',
      'checksum',
      'payload',
      ...(value && typeof value === 'object' && 'migrated' in value ? ['migrated'] : []),
    ],
    'заголовок',
  );
  if (e.format !== WORLD_FORMAT)
    throw new SaveError(
      'UNSUPPORTED',
      'Это не файл мира WebCraft. Диагностический отчёт и миры Minecraft не поддерживаются.',
    );
  const version = typeof e.version === 'number' ? e.version : -1;
  if (!READABLE_VERSIONS.includes(version))
    throw new SaveError(
      'UNSUPPORTED',
      `Версия сохранения ${String(e.version).slice(0, 16)} не поддерживается. Оригинал не изменён.`,
    );
  const checksum = object(e.checksum, ['algorithm', 'value'], 'контрольная сумма');
  if (
    checksum.algorithm !== 'SHA-256' ||
    typeof checksum.value !== 'string' ||
    !/^[a-f0-9]{64}$/.test(checksum.value)
  )
    return bad('контрольная сумма');
  // Never normalize a generator ID, optional field or item BEFORE authenticating its original payload.
  if (payloadChecksum(e.payload) !== checksum.value)
    throw new SaveError(
      'CORRUPT',
      'Контрольная сумма не совпадает. Сохранение повреждено или изменено.',
    );
  let payload =
    version === 1
      ? migrateLegacyPayload(validateLegacyPayload(e.payload))
      : validatePayload(e.payload, version);
  if (version === 2) payload = { ...payload, core: upgradeCoreToV3(payload.core) };
  if (version === 3) payload = { ...payload, core: upgradeCoreToV4(payload.core) };
  if (version === 4) payload = { ...payload, core: upgradeCoreToV5(payload.core) };
  if (version < 6) payload = { ...payload, core: upgradeCoreToV6(payload.core) };
  // A migrated envelope is itself a valid v6 envelope: its checksum must cover the upgraded data.
  const sealed = sealWorld(payload);
  return { ...sealed, migrated: version < SAVE_VERSION || e.migrated === true };
}
export function parseWorldFile(text: string): WorldEnvelope {
  if (textEncoder.encode(text).length > MAX_FILE_BYTES)
    throw new SaveError('LIMIT', 'Максимальный размер файла мира — 16 МБ.');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SaveError('CORRUPT', 'Файл не является корректным JSON-сохранением.');
  }
  return verifyWorld(data);
}
export function defaultClient(radius = 4): ClientCheckpoint {
  return { settings: { radius, fov: 72, sensitivity: 1 } };
}
export function envelopeBytes(e: WorldEnvelope): number {
  return textEncoder.encode(JSON.stringify(e)).length;
}
export function exportFilename(name: string): string {
  return `${name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 64) || 'webcraft-world'}.webcraft.json`;
}
