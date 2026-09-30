import { pixelNoise } from './pixel-art';

/**
 * Pure helpers of the night sky: where the stars are, what the moon looks like on a given day
 * and when a shooting star crosses. Nothing here touches WebGL, so all of it is unit-tested.
 */

/** Ticks in a day; the same number the world clock uses. */
const DAY = 24000;

export const MOON_PHASES = 8;
/** Pixels across one moon picture. */
export const MOON_SIZE = 16;
/** The atlas holds the eight phases in four columns and two rows. */
export const MOON_ATLAS = { cols: 4, rows: 2, width: 64, height: 32 } as const;

/**
 * Phase of the moon on a world day, as in the reference: 0 full, 1 waning gibbous, 2 last
 * quarter, 3 waning crescent, 4 new, 5 waxing crescent, 6 first quarter, 7 waxing gibbous.
 */
export function moonPhaseAt(tick: number): number {
  if (!Number.isFinite(tick)) return 0;
  const day = Math.floor(Math.max(0, tick) / DAY);
  return day % MOON_PHASES;
}

/** How much of the moon's face is lit in a phase: 1 for the full moon, 0 for the new moon. */
export function moonLit(phase: number): number {
  return (1 + Math.cos((phase * Math.PI) / 4)) / 2;
}

/** Column and row of a phase inside the atlas. */
export function moonCell(phase: number): { col: number; row: number } {
  const p = ((Math.floor(phase) % MOON_PHASES) + MOON_PHASES) % MOON_PHASES;
  return { col: p % MOON_ATLAS.cols, row: Math.floor(p / MOON_ATLAS.cols) };
}

/**
 * RGBA pixels of the moon atlas. Each cell is a round moon lit from the side the phase says:
 * the lit part is pale stone with craters, the dark part is a faint bluish ghost of the disc.
 * Row 0 of the data is the bottom of the picture (the way a DataTexture stores it).
 */
export function moonAtlasPixels(): Uint8ClampedArray {
  const { width, height } = MOON_ATLAS;
  const data = new Uint8ClampedArray(width * height * 4);
  const r = MOON_SIZE / 2;
  for (let phase = 0; phase < MOON_PHASES; phase++) {
    const { col, row } = moonCell(phase);
    const theta = (phase * Math.PI) / 4;
    const sin = Math.sin(theta),
      cos = Math.cos(theta);
    for (let y = 0; y < MOON_SIZE; y++)
      for (let x = 0; x < MOON_SIZE; x++) {
        const u = (x + 0.5 - r) / r,
          v = (y + 0.5 - r) / r,
          d2 = u * u + v * v;
        const at = ((row * MOON_SIZE + y) * width + col * MOON_SIZE + x) * 4;
        if (d2 > 1) continue;
        const z = Math.sqrt(1 - d2);
        // The lit side faces the sun: right for a waxing moon, left for a waning one.
        const lit = -u * sin + z * cos > 0.04;
        if (!lit) {
          data.set([58, 72, 104, 34], at);
          continue;
        }
        const crater =
          (x > 3 && x < 7 && y > 3 && y < 7) ||
          (x > 9 && x < 13 && y > 8 && y < 12) ||
          (x === 8 && y === 8);
        const n = crater ? 176 : pixelNoise(x, y, 77) > 0.74 ? 214 : 234;
        // The edge of the disc is a touch darker, which rounds it.
        const shade = 1 - 0.14 * d2;
        data.set(
          [n * shade, Math.min(255, (n + 8) * shade), Math.min(255, (n + 15) * shade), 255],
          at,
        );
      }
  }
  return data;
}

/**
 * A soft round glow: white, opaque in the middle and fading smoothly to nothing at the edge,
 * `size` pixels across. Used for the halos of the sun and the moon.
 */
export function glowPixels(size = 64): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  const r = size / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r;
      const a = d >= 1 ? 0 : Math.pow(1 - d, 2.2);
      data.set([255, 255, 255, Math.round(a * 255)], (y * size + x) * 4);
    }
  return data;
}

export interface StarField {
  count: number;
  /** x y z on a sphere, upper hemisphere only. */
  positions: Float32Array;
  /** r g b, brightness already folded in. */
  colors: Float32Array;
  /** 0‥1 per star, offsets its twinkle. */
  phases: Float32Array;
  /** Point size in CSS pixels. */
  sizes: Float32Array;
}

/** Tilt of the Milky Way's great circle against the horizon, radians. */
const BAND_TILT = 0.9;

/**
 * The stars: most are scattered over the dome, about a third crowd along a tilted band (the
 * Milky Way), a few are big and bright, a few are warm or blue. The same sky every time.
 */
export function buildStarField(count: number, radius = 310): StarField {
  const positions = new Float32Array(count * 3),
    colors = new Float32Array(count * 3),
    phases = new Float32Array(count),
    sizes = new Float32Array(count);
  const tilt = { c: Math.cos(BAND_TILT), s: Math.sin(BAND_TILT) };
  for (let i = 0; i < count; i++) {
    const band = pixelNoise(i, 3, 21) < 0.34;
    let x: number, y: number, z: number;
    if (band) {
      // A point on the great circle, pushed a little off it (a triangular spread).
      // Only the half of the circle that rises above the horizon: nothing is mirrored up.
      const a = pixelNoise(i, 1, 47) * Math.PI,
        off = (pixelNoise(i, 2, 83) + pixelNoise(i, 4, 11) - 1) * 0.17;
      const ex = Math.cos(a),
        ey = Math.sin(a) * tilt.c,
        ez = Math.sin(a) * tilt.s;
      // The circle's normal is (0, −s, c); `off` moves the point along it.
      x = ex;
      y = ey + off * -tilt.s;
      z = ez + off * tilt.c;
      const len = Math.hypot(x, y, z);
      x /= len;
      y /= len;
      z /= len;
      // The ends of the band dip a little under the horizon: lift those few stars just above it.
      if (y < 0.06) y = 0.06 + Math.abs(y) * 0.9;
      const k = Math.hypot(x, z);
      const scale = Math.sqrt(Math.max(0, 1 - y * y)) / (k || 1);
      x *= scale;
      z *= scale;
    } else {
      const a = pixelNoise(i, 1, 47) * Math.PI * 2,
        h = 0.07 + pixelNoise(i, 2, 83) * 0.93,
        r = Math.sqrt(1 - h * h);
      x = Math.cos(a) * r;
      y = h;
      z = Math.sin(a) * r;
    }
    positions.set([x * radius, y * radius, z * radius], i * 3);
    const magnitude = pixelNoise(i, 5, 5),
      temperature = pixelNoise(i, 6, 9);
    const bright = !band && magnitude > 0.93;
    sizes[i] = bright ? 3.2 : band ? 1.5 : magnitude > 0.72 ? 2.3 : 1.7;
    const gain = band ? 0.55 : bright ? 1 : 0.62 + magnitude * 0.3;
    const rgb =
      temperature < 0.45
        ? [0.78, 0.87, 1.0]
        : temperature < 0.78
          ? [0.95, 0.96, 1.0]
          : [1.0, 0.86, 0.66];
    colors.set([rgb[0] * gain, rgb[1] * gain, rgb[2] * gain], i * 3);
    phases[i] = pixelNoise(i, 7, 13);
  }
  return { count, positions, colors, phases, sizes };
}

export interface Meteor {
  /** 0‥1 through its short life. */
  u: number;
  /** 0‥1 brightness envelope: swift rise, slow fade. */
  fade: number;
  /** Where on the dome the head is (unit vector). */
  head: readonly [number, number, number];
  /** Direction it travels (unit vector, tangent to the dome). */
  tangent: readonly [number, number, number];
}

/** Seconds between shooting stars and how long each one lives. */
export const METEOR_PERIOD = 41;
export const METEOR_LIFE = 1.2;

/**
 * The shooting star of the moment, or null: one every `METEOR_PERIOD` seconds of the
 * presentation clock, on a path that depends only on which one it is.
 */
export function meteorAt(seconds: number): Meteor | null {
  if (!(seconds >= 0)) return null;
  const n = Math.floor(seconds / METEOR_PERIOD),
    t = seconds - n * METEOR_PERIOD;
  if (t > METEOR_LIFE) return null;
  const u = t / METEOR_LIFE,
    k = n & 1023;
  const az = pixelNoise(k, 11, 61) * Math.PI * 2,
    el = 0.42 + pixelNoise(k, 12, 61) * 0.62,
    slant = (pixelNoise(k, 13, 61) - 0.5) * 1.3;
  // Start point on the dome.
  const sx = Math.cos(el) * Math.cos(az),
    sy = Math.sin(el),
    sz = Math.cos(el) * Math.sin(az);
  // Two tangents at that point: sideways (along the azimuth) and downwards.
  const ex = -Math.sin(az),
    ez = Math.cos(az);
  // "Down" projected onto the tangent plane at the start point.
  let dx = sy * sx,
    dy = -(1 - sy * sy),
    dz = sy * sz;
  const dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl;
  dy /= dl;
  dz /= dl;
  let tx = ex * Math.cos(slant) + dx * Math.sin(slant + 0.9),
    ty = dy * Math.sin(slant + 0.9),
    tz = ez * Math.cos(slant) + dz * Math.sin(slant + 0.9);
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl;
  ty /= tl;
  tz /= tl;
  // March along the path and pull the point back onto the sphere.
  const travel = u * 0.55;
  let hx = sx + tx * travel,
    hy = sy + ty * travel,
    hz = sz + tz * travel;
  const hl = Math.hypot(hx, hy, hz);
  hx /= hl;
  hy /= hl;
  hz /= hl;
  const fade = Math.min(1, u * 8) * Math.pow(1 - u, 1.4);
  return { u, fade, head: [hx, hy, hz], tangent: [tx, ty, tz] };
}
