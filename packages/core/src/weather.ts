import { hashInts, hashUnit } from './worldgen/rng';

/**
 * Weather of the overworld, as in the reference: long clear spells, rain spells of a few
 * minutes, and now and then a thunderstorm. It is a pure function of the seed and the world
 * tick, so saves need no new field and every client of one world sees the same sky.
 */
export interface WeatherLevel {
  /** 0..1, eased in and out over five seconds at the ends of a spell. */
  readonly rain: number;
  /** 0..1, only ever above zero while it rains. */
  readonly thunder: number;
}

export type Precipitation = 'rain' | 'snow' | 'none';

export interface WeatherSnapshot extends WeatherLevel {
  /** What falls where the player stands. */
  readonly kind: Precipitation;
  /** Highest rain-stopping block + 1 over a (2R+1)² grid around (ox, oz), row-major by z. */
  readonly tops?: readonly number[];
  readonly ox: number;
  readonly oz: number;
  /** The latest lightning strike close enough to see, if one struck in the last two seconds. */
  readonly lightning?: { readonly tick: number; readonly x: number; readonly z: number };
}

export const WEATHER_GRID_RADIUS = 10;
const CLEAR_TICKS: [number, number] = [9000, 60000];
const RAIN_TICKS: [number, number] = [6000, 16000];
const EASE_TICKS = 100;
const SALT = 0x5ea7;

interface Spell {
  start: number;
  end: number;
  rain: boolean;
  thunder: boolean;
}

/** Walks the spells of one world; the last one is cached, since ticks move forward. */
export class WeatherSchedule {
  private readonly seed: number;
  private spell: Spell;
  private index = 0;
  constructor(seed: number) {
    this.seed = seed;
    this.spell = this.make(0, 0);
  }
  private make(index: number, start: number): Spell {
    const rain = index % 2 === 1;
    const [lo, hi] = rain ? RAIN_TICKS : CLEAR_TICKS;
    const length = lo + Math.floor(hashUnit(hashInts(this.seed, SALT, index)) * (hi - lo));
    const thunder = rain && hashUnit(hashInts(this.seed, SALT + 1, index)) < 0.3;
    return { start, end: start + length, rain, thunder };
  }
  private find(tick: number): Spell {
    if (tick < this.spell.start) {
      this.index = 0;
      this.spell = this.make(0, 0);
    }
    while (tick >= this.spell.end) {
      this.index++;
      this.spell = this.make(this.index, this.spell.end);
    }
    return this.spell;
  }
  at(tick: number): WeatherLevel {
    const t = Math.max(0, tick);
    const s = this.find(t);
    if (!s.rain) return { rain: 0, thunder: 0 };
    const ease = Math.min(1, (t - s.start) / EASE_TICKS, (s.end - t) / EASE_TICKS);
    const rain = Math.max(0, ease);
    return { rain, thunder: s.thunder ? rain : 0 };
  }
  /** Ticks until the weather next changes, for the lab tools. */
  changesIn(tick: number): number {
    return this.find(Math.max(0, tick)).end - tick;
  }
  /**
   * A strike in a storm about every eight seconds, at a spot within 64 blocks of (x, z)
   * picked from the tick alone, so it is the same for everyone.
   */
  lightning(
    tick: number,
    x: number,
    z: number,
    thunder = (t: number) => this.at(t).thunder,
  ): { tick: number; x: number; z: number } | undefined {
    for (let t = tick; t > tick - 40 && t >= 0; t--) {
      if (thunder(t) < 0.5) continue;
      const h = hashInts(this.seed, SALT + 2, t);
      if (hashUnit(h) >= 1 / 160) continue;
      const angle = hashUnit(hashInts(h, 1)) * Math.PI * 2,
        distance = 12 + hashUnit(hashInts(h, 2)) * 52;
      return {
        tick: t,
        x: Math.floor(x + Math.cos(angle) * distance),
        z: Math.floor(z + Math.sin(angle) * distance),
      };
    }
    return undefined;
  }
}

/** The reference's rule: no rain where it never rains, snow where it is cold enough. */
export function precipitationFor(temperature: number, rainfall: number, y: number): Precipitation {
  if (rainfall <= 0) return 'none';
  // Air cools with height above the sea, so high mountains get snow where valleys get rain.
  const cooled = temperature - Math.max(0, y - 64) * 0.00166667;
  return cooled < 0.15 ? 'snow' : 'rain';
}
