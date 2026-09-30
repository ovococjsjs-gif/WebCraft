import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { environmentAt, sunDirectionAt } from '../../packages/renderer/src/environment';
import {
  METEOR_LIFE,
  METEOR_PERIOD,
  MOON_ATLAS,
  MOON_PHASES,
  MOON_SIZE,
  buildStarField,
  glowPixels,
  meteorAt,
  moonAtlasPixels,
  moonCell,
  moonLit,
  moonPhaseAt,
} from '../../packages/renderer/src/sky';

const DAY = 24000;

describe('sun path', () => {
  it('rises in the east (+x), crosses the zenith at noon and sets in the west (−x)', () => {
    const at = (time: number) => sunDirectionAt(environmentAt(time).angle);
    const sunrise = at(0),
      noon = at(6000),
      sunset = at(12000),
      midnight = at(18000);
    expect(sunrise.x).toBeGreaterThan(0.95);
    expect(Math.abs(sunrise.y)).toBeLessThan(1e-6);
    expect(noon.y).toBeGreaterThan(0.98);
    expect(sunset.x).toBeLessThan(-0.95);
    expect(midnight.y).toBeLessThan(-0.98);
  });
  it('is always a unit vector and moves east to west through the morning', () => {
    let last = Infinity;
    for (let t = 0; t <= 12000; t += 500) {
      const v = sunDirectionAt(environmentAt(t).angle);
      expect(v.length()).toBeCloseTo(1, 6);
      expect(v.x).toBeLessThanOrEqual(last + 1e-9);
      last = v.x;
    }
  });
  it('writes into the vector it is given', () => {
    const out = new THREE.Vector3();
    expect(sunDirectionAt(0, out)).toBe(out);
  });
});

describe('moon phases', () => {
  it('advance one per day and repeat every eight', () => {
    expect(moonPhaseAt(0)).toBe(0);
    expect(moonPhaseAt(DAY - 1)).toBe(0);
    expect(moonPhaseAt(DAY)).toBe(1);
    expect(moonPhaseAt(4 * DAY + 5)).toBe(4);
    expect(moonPhaseAt(8 * DAY)).toBe(0);
    expect(moonPhaseAt(-50)).toBe(0);
    expect(moonPhaseAt(Number.NaN)).toBeGreaterThanOrEqual(0);
  });
  it('map to cells of the 4×2 atlas without two sharing one', () => {
    const seen = new Set<string>();
    for (let p = 0; p < MOON_PHASES; p++) {
      const { col, row } = moonCell(p);
      expect(col).toBeLessThan(MOON_ATLAS.cols);
      expect(row).toBeLessThan(MOON_ATLAS.rows);
      seen.add(`${col},${row}`);
    }
    expect(seen.size).toBe(MOON_PHASES);
    expect(moonCell(9)).toEqual(moonCell(1));
    expect(moonCell(-1)).toEqual(moonCell(7));
  });
  it('light up from full to nothing and back', () => {
    expect(moonLit(0)).toBeCloseTo(1, 9);
    expect(moonLit(4)).toBeCloseTo(0, 9);
    expect(moonLit(2)).toBeCloseTo(0.5, 9);
    expect(moonLit(6)).toBeCloseTo(0.5, 9);
    expect(moonLit(1)).toBeCloseTo(moonLit(7), 9);
  });
  describe('atlas pixels', () => {
    const pixels = moonAtlasPixels();
    const litPixels = (phase: number, side: 'left' | 'right' | 'all') => {
      const { col, row } = moonCell(phase);
      let n = 0;
      for (let y = 0; y < MOON_SIZE; y++)
        for (let x = 0; x < MOON_SIZE; x++) {
          if (side === 'left' && x >= MOON_SIZE / 2) continue;
          if (side === 'right' && x < MOON_SIZE / 2) continue;
          const at = ((row * MOON_SIZE + y) * MOON_ATLAS.width + col * MOON_SIZE + x) * 4;
          if (pixels[at + 3] === 255) n++;
        }
      return n;
    };
    it('has the size of the atlas', () => {
      expect(pixels.length).toBe(MOON_ATLAS.width * MOON_ATLAS.height * 4);
    });
    it('shows a round full moon, nothing lit at the new moon', () => {
      const full = litPixels(0, 'all');
      expect(full).toBeGreaterThan(130);
      expect(full).toBeLessThan(MOON_SIZE * MOON_SIZE);
      expect(litPixels(4, 'all')).toBe(0);
    });
    it('lights the right side while waxing and the left while waning', () => {
      expect(litPixels(6, 'right')).toBeGreaterThan(litPixels(6, 'left') * 4);
      expect(litPixels(2, 'left')).toBeGreaterThan(litPixels(2, 'right') * 4);
      expect(litPixels(5, 'right')).toBeGreaterThan(litPixels(5, 'left'));
      expect(litPixels(3, 'left')).toBeGreaterThan(litPixels(3, 'right'));
    });
    it('grows from the new moon to the full moon', () => {
      const counts = [4, 5, 6, 7, 0].map((p) => litPixels(p, 'all'));
      for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]);
    });
    it('keeps the corners of every cell clear', () => {
      for (let p = 0; p < MOON_PHASES; p++) {
        const { col, row } = moonCell(p);
        const at = (row * MOON_SIZE * MOON_ATLAS.width + col * MOON_SIZE) * 4;
        expect(pixels[at + 3]).toBe(0);
      }
    });
  });
});

describe('glow', () => {
  it('is opaque in the middle and fades to nothing at the edge', () => {
    const size = 64,
      g = glowPixels(size);
    const alpha = (x: number, y: number) => g[(y * size + x) * 4 + 3];
    expect(alpha(31, 31)).toBeGreaterThan(240);
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(63, 63)).toBe(0);
    for (let x = 32; x < 62; x++) expect(alpha(x + 1, 32)).toBeLessThanOrEqual(alpha(x, 32));
  });
  it('is symmetric', () => {
    const size = 32,
      g = glowPixels(size);
    const alpha = (x: number, y: number) => g[(y * size + x) * 4 + 3];
    for (let i = 0; i < size; i++) expect(alpha(i, 5)).toBe(alpha(size - 1 - i, 5));
  });
});

describe('star field', () => {
  const field = buildStarField(900);
  it('is the same every time', () => {
    expect(buildStarField(900).positions).toEqual(field.positions);
    expect(buildStarField(300).positions).toEqual(field.positions.slice(0, 900));
  });
  it('keeps every star above the horizon on the dome', () => {
    for (let i = 0; i < field.count; i++) {
      const x = field.positions[i * 3],
        y = field.positions[i * 3 + 1],
        z = field.positions[i * 3 + 2];
      expect(y).toBeGreaterThan(0);
      expect(Math.hypot(x, y, z)).toBeGreaterThan(309.9);
      expect(Math.hypot(x, y, z)).toBeLessThan(310.1);
    }
  });
  it('gives each star a size, a colour and a twinkle phase in range', () => {
    for (let i = 0; i < field.count; i++) {
      expect(field.sizes[i]).toBeGreaterThanOrEqual(1.4);
      expect(field.sizes[i]).toBeLessThanOrEqual(3.3);
      expect(field.phases[i]).toBeGreaterThanOrEqual(0);
      expect(field.phases[i]).toBeLessThan(1);
      for (let c = 0; c < 3; c++) {
        const v = field.colors[i * 3 + c];
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
  it('has a few bright big stars and many small ones', () => {
    const big = [...field.sizes].filter((s) => s > 3).length;
    const small = [...field.sizes].filter((s) => s < 2).length;
    expect(big).toBeGreaterThan(5);
    expect(big).toBeLessThan(field.count * 0.12);
    expect(small).toBeGreaterThan(field.count * 0.4);
  });
  it('crowds about half of the stars along the Milky Way band', () => {
    // The band is the great circle with normal (0, −sin 0.9, cos 0.9).
    const n = [0, -Math.sin(0.9), Math.cos(0.9)];
    let near = 0;
    for (let i = 0; i < field.count; i++) {
      const d =
        (field.positions[i * 3] * n[0] +
          field.positions[i * 3 + 1] * n[1] +
          field.positions[i * 3 + 2] * n[2]) /
        310;
      if (Math.abs(d) < 0.2) near++;
    }
    expect(near / field.count).toBeGreaterThan(0.38);
  });
});

describe('shooting stars', () => {
  it('come once per period and live a little over a second', () => {
    expect(meteorAt(-1)).toBeNull();
    expect(meteorAt(Number.NaN)).toBeNull();
    expect(meteorAt(0)).not.toBeNull();
    expect(meteorAt(METEOR_LIFE - 0.01)).not.toBeNull();
    expect(meteorAt(METEOR_LIFE + 0.05)).toBeNull();
    expect(meteorAt(METEOR_PERIOD - 0.5)).toBeNull();
    expect(meteorAt(METEOR_PERIOD + 0.2)).not.toBeNull();
    let active = 0;
    for (let t = 0; t < METEOR_PERIOD * 10; t += 0.05) if (meteorAt(t)) active++;
    expect(active * 0.05).toBeCloseTo(METEOR_LIFE * 10, 0);
  });
  it('keeps to the dome: unit head, unit tangent, above the horizon', () => {
    for (let n = 0; n < 40; n++)
      for (const f of [0.05, 0.4, 0.95]) {
        const m = meteorAt(n * METEOR_PERIOD + f * METEOR_LIFE)!;
        expect(m).not.toBeNull();
        expect(Math.hypot(...m.head)).toBeCloseTo(1, 6);
        expect(Math.hypot(...m.tangent)).toBeCloseTo(1, 6);
        expect(m.head[1]).toBeGreaterThan(0.05);
      }
  });
  it('fades in fast, peaks, and is gone at the end', () => {
    const fades = [0, 0.05, 0.15, 0.5, 0.9, 0.999].map(
      (f) => meteorAt(f * METEOR_LIFE + 3 * METEOR_PERIOD)!.fade,
    );
    expect(fades[0]).toBe(0);
    expect(fades[2]).toBeGreaterThan(fades[1]);
    expect(fades[3]).toBeGreaterThan(0.2);
    expect(fades[5]).toBeLessThan(0.01);
    for (const f of fades) {
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });
  it('travels across the sky and always slants downwards', () => {
    for (let n = 0; n < 30; n++) {
      const a = meteorAt(n * METEOR_PERIOD)!,
        b = meteorAt(n * METEOR_PERIOD + METEOR_LIFE - 0.01)!;
      const travelled = Math.hypot(
        a.head[0] - b.head[0],
        a.head[1] - b.head[1],
        a.head[2] - b.head[2],
      );
      expect(travelled).toBeGreaterThan(0.3);
      expect(b.head[1]).toBeLessThan(a.head[1] + 1e-9);
    }
  });
  it('follows a different path each time, the same path every run', () => {
    const at = (n: number) => meteorAt(n * METEOR_PERIOD + 0.3)!.head.join(',');
    expect(at(2)).toBe(at(2));
    expect(new Set([1, 2, 3, 4, 5, 6].map(at)).size).toBe(6);
  });
});
