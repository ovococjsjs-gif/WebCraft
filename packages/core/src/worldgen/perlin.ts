/**
 * Improved Perlin noise and the octave sums the v5 terrain is built from. The octave convention
 * follows the reference generator: the first octave has the given frequency and unit amplitude,
 * every further octave halves the frequency and doubles the amplitude. A sixteen-octave sum is
 * therefore dominated by its broad, slow octaves, with the fine ones adding grain on top.
 */
import { Rng } from './rng';

const GRAD3: readonly (readonly [number, number, number])[] = [
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [-1, 0, 1],
  [1, 0, -1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, -1, 1],
  [0, 1, -1],
  [0, -1, -1],
  [1, 1, 0],
  [0, -1, 1],
  [-1, 1, 0],
  [0, -1, -1],
];
const GX = Float64Array.from(GRAD3, (g) => g[0]);
const GY = Float64Array.from(GRAD3, (g) => g[1]);
const GZ = Float64Array.from(GRAD3, (g) => g[2]);
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

export class ImprovedNoise {
  private readonly perm = new Uint8Array(512);
  readonly ox: number;
  readonly oy: number;
  readonly oz: number;
  constructor(rng: Rng) {
    this.ox = rng.nextDouble() * 256;
    this.oy = rng.nextDouble() * 256;
    this.oz = rng.nextDouble() * 256;
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 0; i < 256; i++) {
      const j = rng.nextInt(256 - i) + i;
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  /** Noise in about [-1, 1]. */
  sample(x: number, y: number, z: number): number {
    x += this.ox;
    y += this.oy;
    z += this.oz;
    const fx = Math.floor(x),
      fy = Math.floor(y),
      fz = Math.floor(z);
    const X = fx & 255,
      Y = fy & 255,
      Z = fz & 255;
    x -= fx;
    y -= fy;
    z -= fz;
    const u = fade(x),
      v = fade(y),
      w = fade(z);
    const p = this.perm;
    const A = p[X] + Y,
      AA = p[A] + Z,
      AB = p[A + 1] + Z,
      B = p[X + 1] + Y,
      BA = p[B] + Z,
      BB = p[B + 1] + Z;
    const x1 = x - 1,
      y1 = y - 1,
      z1 = z - 1;
    let h = p[AA] & 15;
    const c000 = GX[h] * x + GY[h] * y + GZ[h] * z;
    h = p[BA] & 15;
    const c100 = GX[h] * x1 + GY[h] * y + GZ[h] * z;
    h = p[AB] & 15;
    const c010 = GX[h] * x + GY[h] * y1 + GZ[h] * z;
    h = p[BB] & 15;
    const c110 = GX[h] * x1 + GY[h] * y1 + GZ[h] * z;
    h = p[AA + 1] & 15;
    const c001 = GX[h] * x + GY[h] * y + GZ[h] * z1;
    h = p[BA + 1] & 15;
    const c101 = GX[h] * x1 + GY[h] * y + GZ[h] * z1;
    h = p[AB + 1] & 15;
    const c011 = GX[h] * x + GY[h] * y1 + GZ[h] * z1;
    h = p[BB + 1] & 15;
    const c111 = GX[h] * x1 + GY[h] * y1 + GZ[h] * z1;
    const l1 = c000 + u * (c100 - c000),
      l2 = c010 + u * (c110 - c010),
      l3 = c001 + u * (c101 - c001),
      l4 = c011 + u * (c111 - c011);
    const m1 = l1 + v * (l2 - l1),
      m2 = l3 + v * (l4 - l3);
    return m1 + w * (m2 - m1);
  }
}

/** Keeps huge coordinates precise, the way the reference wraps its long coordinates. */
const WRAP = 16777216;
const wrap = (v: number) => v - Math.floor(v / WRAP) * WRAP;

export class Octaves {
  private readonly layers: ImprovedNoise[] = [];
  constructor(
    rng: Rng,
    readonly count: number,
  ) {
    for (let i = 0; i < count; i++) this.layers.push(new ImprovedNoise(rng));
  }
  /** Octave sum at a point; `sx`, `sy`, `sz` are the frequencies of the first octave. */
  sample(x: number, y: number, z: number, sx: number, sy: number, sz: number): number {
    let total = 0,
      f = 1;
    for (const layer of this.layers) {
      total += layer.sample(wrap(x * sx * f), wrap(y * sy * f), wrap(z * sz * f)) / f;
      f /= 2;
    }
    return total;
  }
  /** The same sum on a plane, for heights and surface noise. */
  sample2(x: number, z: number, sx: number, sz: number): number {
    let total = 0,
      f = 1;
    for (const layer of this.layers) {
      total += layer.sample(wrap(x * sx * f), 0, wrap(z * sz * f)) / f;
      f /= 2;
    }
    return total;
  }
}

/**
 * Conventional fractal noise for layout fields (continents, climate, rivers): octaves get finer
 * and quieter, and the result is normalised to about [-1, 1].
 */
export class Fbm {
  private readonly layers: ImprovedNoise[] = [];
  private readonly norm: number;
  constructor(
    rng: Rng,
    readonly count: number,
    readonly persistence = 0.5,
  ) {
    let norm = 0,
      amp = 1;
    for (let i = 0; i < count; i++) {
      this.layers.push(new ImprovedNoise(rng));
      norm += amp;
      amp *= persistence;
    }
    this.norm = norm;
  }
  sample(x: number, z: number): number {
    let total = 0,
      amp = 1,
      f = 1;
    for (const layer of this.layers) {
      total += layer.sample(x * f, 0.5 + f * 0.37, z * f) * amp;
      amp *= this.persistence;
      f *= 2;
    }
    return total / this.norm;
  }
}
