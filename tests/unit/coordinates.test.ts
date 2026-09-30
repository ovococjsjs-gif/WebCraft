import { describe, it, expect } from 'vitest';
import {
  chunkCoord,
  localCoord,
  sectionIndex,
  decodeIndex,
  validBlockPosition,
} from '../../packages/core/src/coordinates';
describe('integer voxel coordinates', () => {
  it.each([
    [-33, -3, 15],
    [-32, -2, 0],
    [-17, -2, 15],
    [-16, -1, 0],
    [-15, -1, 1],
    [-1, -1, 15],
    [0, 0, 0],
    [1, 0, 1],
    [15, 0, 15],
    [16, 1, 0],
    [17, 1, 1],
    [31, 1, 15],
    [32, 2, 0],
  ])('splits %i into chunk %i and local %i', (v, c, l) => {
    expect(chunkCoord(v)).toBe(c);
    expect(localCoord(v)).toBe(l);
    expect(c * 16 + l).toBe(v);
  });
  it('roundtrips all 4096 section indices', () => {
    const seen = new Set<number>();
    for (let x = 0; x < 16; x++)
      for (let y = 0; y < 16; y++)
        for (let z = 0; z < 16; z++) {
          const i = sectionIndex(x, y, z);
          expect(decodeIndex(i)).toEqual({ x, y, z });
          seen.add(i);
        }
    expect(seen.size).toBe(4096);
  });
  it.each([
    [0, -1, 0],
    [0, 256, 0],
    [30_000_000, 1, 0],
    [-30_000_000, 1, 0],
    [1.5, 1, 0],
    [NaN, 1, 0],
    [0, Infinity, 0],
  ])('rejects invalid coordinate (%s,%s,%s)', (x, y, z) =>
    expect(validBlockPosition(x, y, z)).toBe(false),
  );
  it('accepts the top layer and inner world boundary', () => {
    expect(validBlockPosition(-29_999_999, 255, 29_999_999)).toBe(true);
    expect(validBlockPosition(0, 0, 0)).toBe(true);
  });
});
