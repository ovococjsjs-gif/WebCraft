/**
 * Seeded randomness of the v5 generator. A small, fast 32-bit generator (sfc32) with the call
 * surface the reference generator code is written against: `nextInt(n)`, `nextFloat()`,
 * `nextDouble()`, `nextBoolean()` and `nextSeed()` in place of `nextLong()` for child streams.
 * Streams are derived by hashing, never by sharing state, so every chunk and every feature can
 * be generated alone and in any order.
 */
export function mix32(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
/** Hash of any number of 32-bit integers; stable, order-sensitive and well mixed. */
export function hashInts(...values: number[]): number {
  let h = 0x9e3779b9;
  for (const v of values) h = mix32((h ^ mix32(v | 0)) + 0x632be5ab);
  return h;
}
/** Uniform [0, 1) hash of integer coordinates. */
export function hashUnit(seed: number, ...values: number[]): number {
  return hashInts(seed, ...values) / 4294967296;
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  constructor(seed: number) {
    this.a = mix32(seed ^ 0xa3c59ac3);
    this.b = mix32(seed + 0x6a09e667);
    this.c = mix32(seed ^ 0xbb67ae85);
    this.d = 1;
    for (let i = 0; i < 12; i++) this.next();
  }
  /** Stream for a world, a salt and optional integer coordinates. */
  static of(seed: number, salt: number, ...coords: number[]): Rng {
    return new Rng(hashInts(seed, salt, ...coords));
  }
  next(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }
  /** Integer in [0, bound). A bound of 0 or less answers 0, instead of throwing like Java. */
  nextInt(bound: number): number {
    if (bound <= 1) return 0;
    return Math.floor((this.next() / 4294967296) * bound);
  }
  nextFloat(): number {
    return this.next() / 4294967296;
  }
  nextDouble(): number {
    return (this.next() * 2097152 + (this.next() >>> 11)) / 9007199254740992;
  }
  nextBoolean(): boolean {
    return (this.next() & 1) === 1;
  }
  /** A seed for a child stream, the counterpart of `new Random(random.nextLong())`. */
  nextSeed(): number {
    return this.next();
  }
}
