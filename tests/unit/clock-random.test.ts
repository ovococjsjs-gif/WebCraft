import { describe, it, expect } from 'vitest';
import { FixedStepClock, TickScheduler } from '../../packages/core/src/clock';
import { JavaRandom, hash2, seedHash } from '../../packages/core/src/random';
describe('fixed-step clock', () => {
  it.each([24, 30, 60, 120, 144])('keeps 200 ticks across ten seconds at %i FPS', (fps) => {
    const clock = new FixedStepClock();
    let ticks = 0;
    for (let frame = 0; frame < fps * 10; frame++) clock.advance(1000 / fps, () => ticks++);
    expect(ticks).toBe(200);
    expect(clock.alpha).toBeCloseTo(0, 7);
  });

  it.each([10, 20, 25, 50, 100])('runs 20 ticks for one second of %i ms frames', (dt) => {
    const c = new FixedStepClock();
    let ticks = 0;
    for (let n = 0; n < 1000 / dt; n++) c.advance(dt, () => ticks++);
    expect(ticks).toBe(20);
  });
  it('keeps fractional frame time', () => {
    const c = new FixedStepClock();
    let n = 0;
    c.advance(23, () => n++);
    c.advance(27, () => n++);
    expect(n).toBe(1);
    expect(c.alpha).toBeCloseTo(0);
  });
  it('caps catch-up and explicitly reports dropped wall time', () => {
    const c = new FixedStepClock();
    let n = 0;
    c.advance(1200, () => n++);
    expect(n).toBe(5);
    expect(c.droppedMs).toBe(950);
  });
  it('rejects invalid elapsed time and resets accumulated fractions', () => {
    const c = new FixedStepClock();
    let n = 0;
    c.advance(-1, () => n++);
    c.advance(NaN, () => n++);
    c.advance(49, () => n++);
    c.reset();
    c.advance(1, () => n++);
    expect(n).toBe(0);
  });
});
describe('ordered scheduled events', () => {
  it('dispatches by tick, priority and stable insertion order', () => {
    const s = new TickScheduler();
    s.schedule(5, 'later');
    s.schedule(3, 'normal-a');
    s.schedule(3, 'priority', {}, -1);
    s.schedule(3, 'normal-b');
    expect(s.due(2)).toEqual([]);
    expect(s.due(3).map((e) => e.kind)).toEqual(['priority', 'normal-a', 'normal-b']);
    expect(s.due(5).map((e) => e.kind)).toEqual(['later']);
  });
  it('preserves order and sequence across serialization', () => {
    const a = new TickScheduler();
    a.schedule(10, 'one');
    a.schedule(10, 'two');
    const b = new TickScheduler();
    b.restore(a.snapshot());
    b.schedule(10, 'three');
    expect(b.due(10).map((e) => e.kind)).toEqual(['one', 'two', 'three']);
    expect(a.size).toBe(2);
  });
  it('rejects negative and fractional ticks', () => {
    const s = new TickScheduler();
    expect(() => s.schedule(-1, 'x')).toThrow();
    expect(() => s.schedule(0.2, 'x')).toThrow();
  });
});
describe('Java 48-bit random algorithm', () => {
  it('matches standard seed-zero integer vectors', () => {
    const r = new JavaRandom(0);
    expect([r.nextInt(), r.nextInt(), r.nextInt()]).toEqual([-1155484576, -723955400, 1033096058]);
  });
  it('matches bounded integer vectors', () => {
    const r = new JavaRandom(0);
    expect(Array.from({ length: 10 }, () => r.nextInt(10))).toEqual([0, 8, 9, 7, 5, 3, 1, 1, 9, 4]);
  });
  it('matches a double vector', () =>
    expect(new JavaRandom(0).nextDouble()).toBe(0.730967787376657));
  it('restores exact internal random state', () => {
    const a = new JavaRandom(1234567890123456789n);
    a.nextInt();
    const state = a.snapshot(),
      b = new JavaRandom(9);
    b.restore(state);
    expect(Array.from({ length: 30 }, () => a.nextInt())).toEqual(
      Array.from({ length: 30 }, () => b.nextInt()),
    );
  });
  it('validates bounds and states', () => {
    const r = new JavaRandom(3);
    expect(() => r.nextInt(0)).toThrow();
    expect(() => r.nextInt(2 ** 31)).toThrow();
    expect(() => r.next(33)).toThrow();
    expect(() => r.restore('bad-state')).toThrow();
  });
  it('deterministically hashes text and spatial cells', () => {
    expect(seedHash('same')).toBe(seedHash('same'));
    expect(seedHash('same')).not.toBe(seedHash('different'));
    expect(hash2(-16, 19, 5)).toBe(hash2(-16, 19, 5));
    expect(hash2(-16, 19, 5)).toBeGreaterThanOrEqual(0);
    expect(hash2(-16, 19, 5)).toBeLessThan(1);
  });
});
