export const TICK_MS = 50;
/** Browser-hosted prototype policy: cap catch-up and report dropped wall time. */
export class FixedStepClock {
  private accumulator = 0;
  droppedMs = 0;
  reset(): void {
    this.accumulator = 0;
  }
  advance(elapsedMs: number, step: () => void): number {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 0;
    const accepted = Math.min(elapsedMs, 250);
    this.droppedMs += elapsedMs - accepted;
    this.accumulator += accepted;
    let count = 0;
    while (this.accumulator + 1e-9 >= TICK_MS) {
      this.accumulator = Math.max(0, this.accumulator - TICK_MS);
      step();
      count++;
    }
    return count;
  }
  get alpha(): number {
    return this.accumulator / TICK_MS;
  }
}
export interface ScheduledEvent {
  at: number;
  priority: number;
  sequence: number;
  kind: string;
  data: Readonly<Record<string, number | string>>;
}
export class TickScheduler {
  private events: ScheduledEvent[] = [];
  private sequence = 0;
  schedule(at: number, kind: string, data: ScheduledEvent['data'] = {}, priority = 0): number {
    if (!Number.isSafeInteger(at) || at < 0) throw new RangeError('Invalid event tick');
    const sequence = this.sequence++;
    this.events.push({ at, kind, data: { ...data }, priority, sequence });
    this.events.sort((a, b) => a.at - b.at || a.priority - b.priority || a.sequence - b.sequence);
    return sequence;
  }
  due(tick: number): ScheduledEvent[] {
    const result: ScheduledEvent[] = [];
    while (this.events[0] && this.events[0].at <= tick) result.push(this.events.shift()!);
    return result;
  }
  snapshot(): { sequence: number; events: ScheduledEvent[] } {
    return {
      sequence: this.sequence,
      events: this.events.map((e) => ({ ...e, data: { ...e.data } })),
    };
  }
  restore(s: ReturnType<TickScheduler['snapshot']>): void {
    this.sequence = s.sequence;
    this.events = s.events.map((e) => ({ ...e, data: { ...e.data } }));
    this.events.sort((a, b) => a.at - b.at || a.priority - b.priority || a.sequence - b.sequence);
  }
  get size(): number {
    return this.events.length;
  }
}
