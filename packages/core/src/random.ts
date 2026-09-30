/** java.util.Random's 48-bit linear congruential algorithm; not a world generator. */
export class JavaRandom {
  private state: bigint;
  static readonly MULTIPLIER = 0x5deece66dn;
  static readonly MASK = (1n << 48n) - 1n;
  constructor(seed: bigint | number) {
    this.state = (BigInt(seed) ^ JavaRandom.MULTIPLIER) & JavaRandom.MASK;
  }
  next(bits: number): number {
    if (!Number.isInteger(bits) || bits < 1 || bits > 32)
      throw new RangeError('bits must be 1..32');
    this.state = (this.state * JavaRandom.MULTIPLIER + 11n) & JavaRandom.MASK;
    return Number(this.state >> BigInt(48 - bits));
  }
  nextInt(bound?: number): number {
    if (bound === undefined) return this.next(32) | 0;
    if (!Number.isInteger(bound) || bound <= 0 || bound > 0x7fffffff)
      throw new RangeError('Invalid bound');
    if ((bound & -bound) === bound) return Math.floor((bound * this.next(31)) / 0x80000000);
    let bits: number, val: number;
    do {
      bits = this.next(31);
      val = bits % bound;
    } while (bits - val + bound - 1 >= 0x80000000);
    return val;
  }
  nextDouble(): number {
    return (this.next(26) * 134217728 + this.next(27)) / 9007199254740992;
  }
  snapshot(): string {
    return this.state.toString(16);
  }
  restore(state: string): void {
    if (!/^[0-9a-f]{1,12}$/i.test(state)) throw new Error('Invalid RNG state');
    this.state = BigInt(`0x${state}`) & JavaRandom.MASK;
  }
}
export function seedHash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return h >>> 0;
}
/** Same mixing as `hash2`, for the three-dimensional generators: caves, veins and regions. */
export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
export function hash2(x: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
