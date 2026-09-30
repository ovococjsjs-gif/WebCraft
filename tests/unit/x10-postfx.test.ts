import { describe, expect, it } from 'vitest';
import { PostFX, postParams, type PostInput } from '../../packages/renderer/src/postfx';
import { DEFAULT_QUALITY, sanitizeQuality } from '../../packages/renderer/src/quality';

const day: PostInput = {
  daylight: 1,
  twilight: 0,
  dimension: 'overworld',
  medium: 'air',
  rain: 0,
  thunder: 0,
  hurt: 0,
  flash: 0,
  reducedMotion: false,
};
const at = (patch: Partial<PostInput>) => postParams({ ...day, ...patch });

describe('the look of the frame', () => {
  it('is gentle by day: a little glow, a light vignette, nothing wobbles', () => {
    const p = at({});
    expect(p.bloom).toBeGreaterThan(0.15);
    expect(p.bloom).toBeLessThan(0.45);
    expect(p.vignette).toBeLessThan(0.3);
    expect(p.saturation).toBeGreaterThan(1);
    expect(p.underwater).toBe(0);
    expect(p.heat).toBe(0);
    expect(p.damage).toBe(0);
    expect(p.mediumAmount).toBe(0);
  });
  it('glows more and darkens the corners more at night', () => {
    const n = at({ daylight: 0 });
    expect(n.bloom).toBeGreaterThan(day.daylight * 0 + at({}).bloom);
    expect(n.vignette).toBeGreaterThan(at({}).vignette);
    expect(n.bloomThreshold).toBeLessThan(at({}).bloomThreshold);
    expect(n.shadowTint[2]).toBeGreaterThan(n.shadowTint[0]);
  });
  it('warms the highlights at dawn and dusk', () => {
    const d = at({ daylight: 0.4, twilight: 1 });
    expect(d.highlightTint[0]).toBeGreaterThan(d.highlightTint[2] + 0.12);
    expect(d.bloom).toBeGreaterThan(at({}).bloom);
  });
  it('turns the picture blue-green and wobbly under water', () => {
    const w = at({ medium: 'water' });
    expect(w.underwater).toBe(1);
    expect(w.mediumAmount).toBeGreaterThan(0.5);
    expect(w.mediumTint[2]).toBeGreaterThan(w.mediumTint[0]);
    expect(w.vignette).toBeGreaterThan(at({}).vignette);
  });
  it('turns it red and hot in lava', () => {
    const l = at({ medium: 'lava' });
    expect(l.heat).toBe(1);
    expect(l.mediumTint[0]).toBeGreaterThan(l.mediumTint[2] * 2);
  });
  it('gives the Nether a red glow with heat shimmer and the End a violet one', () => {
    const nether = at({ dimension: 'nether' });
    expect(nether.heat).toBe(1);
    expect(nether.shadowTint[0]).toBeGreaterThan(nether.shadowTint[2]);
    const end = at({ dimension: 'end' });
    expect(end.shadowTint[2]).toBeGreaterThan(end.shadowTint[1]);
    // The day/night cycle belongs to the Overworld only.
    expect(at({ dimension: 'nether', daylight: 0 }).vignette).toBe(nether.vignette);
  });
  it('drains the colour in rain and brightens in a lightning flash', () => {
    expect(at({ rain: 1 }).saturation).toBeLessThan(at({}).saturation - 0.2);
    expect(at({ flash: 1 }).exposure).toBeGreaterThan(1.2);
  });
  it('flashes red when hurt, clamped to 0‥1', () => {
    expect(at({ hurt: 0.5 }).damage).toBe(0.5);
    expect(at({ hurt: 7 }).damage).toBe(1);
    expect(at({ hurt: -1 }).damage).toBe(0);
    expect(at({ hurt: 1 }).aberration).toBeGreaterThan(at({}).aberration);
  });
  it('drops every moving effect for reduced motion but keeps the still ones', () => {
    const r = at({ medium: 'water', hurt: 1, reducedMotion: true });
    expect(r.underwater).toBe(0);
    expect(r.heat).toBe(0);
    expect(r.aberration).toBe(0);
    expect(r.mediumAmount).toBeGreaterThan(0.5);
    expect(r.vignette).toBeGreaterThan(0.3);
    expect(at({ dimension: 'nether', reducedMotion: true }).heat).toBe(0);
  });
  it('never hands the GPU a NaN or an infinity', () => {
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      const p = at({
        daylight: bad,
        twilight: bad,
        rain: bad,
        thunder: bad,
        hurt: bad,
        flash: bad,
      });
      for (const value of Object.values(p).flat()) expect(Number.isFinite(value)).toBe(true);
    }
  });
  it('keeps every number inside a sane range over a whole day', () => {
    for (let d = 0; d <= 1; d += 0.05)
      for (const medium of ['air', 'water', 'lava'])
        for (const dimension of ['overworld', 'nether', 'end']) {
          const p = at({ daylight: d, twilight: 1 - d, medium, dimension, rain: d, hurt: d });
          expect(p.vignette).toBeGreaterThanOrEqual(0);
          expect(p.vignette).toBeLessThanOrEqual(1);
          expect(p.saturation).toBeGreaterThan(0.5);
          expect(p.saturation).toBeLessThan(1.5);
          expect(p.contrast).toBeGreaterThan(0.9);
          expect(p.contrast).toBeLessThan(1.3);
          expect(p.bloom).toBeGreaterThan(0);
          expect(p.bloom).toBeLessThan(1);
          for (const c of [...p.shadowTint, ...p.highlightTint]) {
            expect(c).toBeGreaterThan(0.8);
            expect(c).toBeLessThan(1.25);
          }
        }
  });
});

describe('the option', () => {
  it('is on by default and survives a round trip through the settings', () => {
    expect(DEFAULT_QUALITY.post).toBe(true);
    expect(sanitizeQuality({}).post).toBe(true);
    expect(sanitizeQuality({ post: false }).post).toBe(false);
    expect(sanitizeQuality(sanitizeQuality({ post: false })).post).toBe(false);
  });
  it('is on for old saved settings that never heard of it', () => {
    const { post: _omitted, ...old } = DEFAULT_QUALITY;
    void _omitted;
    expect(sanitizeQuality(old).post).toBe(true);
  });
  it('is a real pipeline class that can be switched off', () => {
    expect(typeof PostFX).toBe('function');
    expect(PostFX.prototype.render).toBeTypeOf('function');
    expect(PostFX.prototype.dispose).toBeTypeOf('function');
  });
});
