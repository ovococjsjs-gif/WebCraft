/**
 * Status effects. The registry holds the effects this build actually implements; the full
 * reference list belongs to the potion stage, and `EFFECT_IDS` is the only place that decides
 * what a save file may contain.
 */
export interface EffectDefinition {
  readonly id: string;
  readonly name: string;
  readonly beneficial: boolean;
  /** Applied and removed at once instead of running for a duration. */
  readonly instant: boolean;
  readonly color: string;
}
export const EFFECTS: readonly EffectDefinition[] = Object.freeze([
  { id: 'speed', name: 'Скорость', beneficial: true, instant: false, color: '#7cafc8' },
  { id: 'slowness', name: 'Замедление', beneficial: false, instant: false, color: '#5a6a86' },
  { id: 'haste', name: 'Спешка', beneficial: true, instant: false, color: '#d4b25a' },
  { id: 'mining_fatigue', name: 'Усталость', beneficial: false, instant: false, color: '#4a4f3a' },
  { id: 'strength', name: 'Сила', beneficial: true, instant: false, color: '#9c3f3a' },
  { id: 'regeneration', name: 'Регенерация', beneficial: true, instant: false, color: '#cd5cab' },
  { id: 'poison', name: 'Отравление', beneficial: false, instant: false, color: '#87a363' },
  { id: 'resistance', name: 'Сопротивление', beneficial: true, instant: false, color: '#8b8b93' },
  {
    id: 'fire_resistance',
    name: 'Огнестойкость',
    beneficial: true,
    instant: false,
    color: '#d97a35',
  },
  {
    id: 'water_breathing',
    name: 'Подводное дыхание',
    beneficial: true,
    instant: false,
    color: '#3c6fb0',
  },
  { id: 'hunger', name: 'Голод', beneficial: false, instant: false, color: '#5a6b3a' },
  /** Given by the wither skeleton's blow: like poison, but it can kill. */
  { id: 'wither', name: 'Иссушение', beneficial: false, instant: false, color: '#352a27' },
  {
    id: 'instant_health',
    name: 'Мгновенное лечение',
    beneficial: true,
    instant: true,
    color: '#e8576f',
  },
  {
    id: 'instant_damage',
    name: 'Мгновенный урон',
    beneficial: false,
    instant: true,
    color: '#4a2323',
  },
]);
export const EFFECT_IDS: readonly string[] = EFFECTS.map((effect) => effect.id);
export function effectDefinition(id: string): EffectDefinition | undefined {
  return EFFECTS.find((effect) => effect.id === id);
}
/** Effect in ticks, exactly as the reference game measures it (20 ticks = 1 second). */
export const EFFECT_TICKS_PER_SECOND = 20;
export function seconds(ticks: number): number {
  return ticks / EFFECT_TICKS_PER_SECOND;
}
export interface ActiveEffect {
  readonly id: string;
  /** Remaining ticks; 0 means "expired" and the store drops the entry. */
  duration: number;
  /** Level minus one, as in the reference game. */
  amplifier: number;
}
export interface EffectChange {
  readonly type: 'applied' | 'expired' | 'removed';
  readonly id: string;
  readonly amplifier: number;
  readonly duration: number;
}
export interface SavedEffect {
  id: string;
  duration: number;
  amplifier: number;
}
export const MAX_AMPLIFIER = 9;
export class EffectStore {
  private readonly active = new Map<string, ActiveEffect>();
  apply(id: string, duration: number, amplifier = 0): EffectChange | null {
    const definition = effectDefinition(id);
    if (!definition) throw new Error(`Unknown effect ${id}`);
    if (!Number.isInteger(duration) || duration < 0)
      throw new RangeError(`Bad duration ${duration}`);
    if (!Number.isInteger(amplifier) || amplifier < 0 || amplifier > MAX_AMPLIFIER)
      throw new RangeError(`Bad amplifier ${amplifier}`);
    const current = this.active.get(id);
    // A weaker or equal effect never shortens the one already running.
    if (current && (current.amplifier > amplifier || current.duration > duration)) {
      if (current.amplifier === amplifier && current.duration < duration)
        current.duration = duration;
      return null;
    }
    this.active.set(id, { id, duration, amplifier });
    return { type: 'applied', id, amplifier, duration };
  }
  /** Level as players count it: amplifier 0 is level 1, absent is 0. */
  level(id: string): number {
    const current = this.active.get(id);
    return current ? current.amplifier + 1 : 0;
  }
  has(id: string): boolean {
    return this.active.has(id);
  }
  duration(id: string): number {
    return this.active.get(id)?.duration ?? 0;
  }
  remove(id: string): EffectChange | null {
    const current = this.active.get(id);
    if (!current) return null;
    this.active.delete(id);
    return { type: 'removed', id, amplifier: current.amplifier, duration: current.duration };
  }
  clear(): EffectChange[] {
    const removed: EffectChange[] = [];
    for (const effect of [...this.active.values()])
      removed.push({
        type: 'removed',
        id: effect.id,
        amplifier: effect.amplifier,
        duration: effect.duration,
      });
    this.active.clear();
    return removed;
  }
  tick(): EffectChange[] {
    const expired: EffectChange[] = [];
    for (const effect of [...this.active.values()]) {
      effect.duration--;
      if (effect.duration > 0) continue;
      this.active.delete(effect.id);
      expired.push({
        type: 'expired',
        id: effect.id,
        amplifier: effect.amplifier,
        duration: 0,
      });
    }
    return expired;
  }
  get list(): ActiveEffect[] {
    return [...this.active.values()].map((effect) => ({ ...effect }));
  }
  get size(): number {
    return this.active.size;
  }
  snapshot(): SavedEffect[] {
    return this.list.sort((a, b) => a.id.localeCompare(b.id));
  }
  restore(data: readonly SavedEffect[]): void {
    this.active.clear();
    for (const entry of data) {
      if (!effectDefinition(entry.id)) throw new Error(`Unknown saved effect ${entry.id}`);
      if (entry.duration <= 0) continue;
      if (entry.amplifier < 0 || entry.amplifier > MAX_AMPLIFIER)
        throw new RangeError(`Bad saved amplifier ${entry.amplifier}`);
      this.active.set(entry.id, {
        id: entry.id,
        duration: Math.floor(entry.duration),
        amplifier: entry.amplifier,
      });
    }
  }
}
