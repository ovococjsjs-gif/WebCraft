/**
 * Fishing as in 1.12: a cast throws the bobber, it floats up to the surface of the water, and
 * after 5–30 seconds (sooner in the rain) a fish bites: the bobber dips with a splash for one or
 * two seconds, and pulling the line in then brings the catch. Pulling at any other time brings
 * nothing. The catch is a fish most of the time, junk now and then, rarely a treasure.
 *
 * The bobber lives only in the running game: like the reference, a saved world has no bobbers.
 */
import type { Vec3 } from './coordinates';

export interface Bobber {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Floating in water: bites only come then. */
  inWater: boolean;
  /** Caught in a block (pulling it loose wears the rod more). */
  stuck: boolean;
  /** The block the hook is caught in. */
  hold?: readonly [number, number, number];
  /** Ticks until the next bite (counted only in water). */
  wait: number;
  /** Ticks left of the current bite (the moment to pull). */
  bite: number;
  age: number;
}

/** The bobber snaps back beyond this many blocks from the player. */
export const FISHING_REACH = 32;
/** 1.12: 100–600 ticks until a bite; a fish holds for 20–40 ticks. */
export const BITE_WAIT_MIN = 100;
export const BITE_WAIT_SPAN = 500;
export const BITE_HOLD_MIN = 20;
export const BITE_HOLD_SPAN = 20;

export function castBobber(eye: Vec3, dir: Vec3, random: () => number): Bobber {
  const speed = 0.95;
  return {
    x: eye.x + dir.x * 0.4,
    y: eye.y + dir.y * 0.4 - 0.1,
    z: eye.z + dir.z * 0.4,
    vx: dir.x * speed,
    vy: dir.y * speed + 0.18,
    vz: dir.z * speed,
    inWater: false,
    stuck: false,
    wait: nextWait(random),
    bite: 0,
    age: 0,
  };
}
export function nextWait(random: () => number): number {
  return BITE_WAIT_MIN + Math.floor(random() * BITE_WAIT_SPAN);
}

type Loot = readonly [item: string, weight: number, min?: number, max?: number];
/** 1.12 weights: fish 85 %, junk 10 %, treasure 5 % (items this build does not have left out). */
const FISH: readonly Loot[] = [
  ['lab:fish', 60],
  ['lab:salmon', 25],
];
const JUNK: readonly Loot[] = [
  ['lab:leather_boots', 10],
  ['lab:leather', 10],
  ['lab:bone', 10],
  ['lab:potion_water', 10],
  ['lab:string', 5],
  ['lab:bowl', 10],
  ['lab:stick', 5],
  ['lab:rotten_flesh', 10],
  ['lab:lily_pad', 17],
  ['lab:glass_bottle', 3],
];
const TREASURE: readonly Loot[] = [
  ['lab:bow', 1],
  ['lab:fishing_rod', 1],
  ['lab:book', 1],
  ['lab:emerald', 1],
];
export const FISHING_LOOT = { FISH, JUNK, TREASURE } as const;

function pick(table: readonly Loot[], random: () => number): { item: string; count: number } {
  const total = table.reduce((n, [, w]) => n + w, 0);
  let roll = random() * total;
  for (const [item, weight, min = 1, max = min] of table) {
    roll -= weight;
    if (roll < 0) return { item, count: min + Math.floor(random() * (max - min + 1)) };
  }
  const [item] = table[table.length - 1];
  return { item, count: 1 };
}
/** What comes out of the water; `luck` (Luck of the Sea levels) shifts junk to treasure. */
export function fishingCatch(
  random: () => number,
  luck = 0,
): { item: string; count: number; kind: 'fish' | 'junk' | 'treasure' } {
  const roll = random() * 100;
  const junk = Math.max(0, 10 - luck * 2.5),
    treasure = 5 + luck;
  if (roll < treasure) return { ...pick(TREASURE, random), kind: 'treasure' };
  if (roll < treasure + junk) return { ...pick(JUNK, random), kind: 'junk' };
  return { ...pick(FISH, random), kind: 'fish' };
}
