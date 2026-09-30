import { describe, expect, it } from 'vitest';
import { registry } from '../../packages/content/src/blocks';
import { SPRITE_COUNT } from '../../packages/content/src/items';
import { CLASSIC_TILES, classicTilePixels } from '../../packages/renderer/src/tile-art';
import { itemSpritePixels } from '../../packages/renderer/src/item-art';

const alpha = (px: Uint8ClampedArray, x: number, y: number) => px[(y * 16 + x) * 4 + 3];
const opaqueCount = (px: Uint8ClampedArray) => {
  let n = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] > 128) n++;
  return n;
};

describe('classic block tiles (0.10 texture pass)', () => {
  it('are 16×16, deterministic and cover the tiles the review flagged', () => {
    for (const tile of CLASSIC_TILES) {
      const a = classicTilePixels(tile)!;
      expect(a.length, `tile ${tile}`).toBe(1024);
      expect([...a], `tile ${tile}`).toEqual([...classicTilePixels(tile)!]);
    }
    for (const flagged of [3, 9, 46, 49, 56, 57, 58, 72, 87, 90, 101, 114, 118])
      expect(CLASSIC_TILES).toContain(flagged);
  });
  it('keep opaque cubes fully opaque and give cutout sprites real transparency', () => {
    for (const def of registry.list()) {
      const faces = def.textures.filter((t) => CLASSIC_TILES.includes(t));
      for (const tile of faces) {
        const px = classicTilePixels(tile)!;
        if (def.layer === 'opaque' && !def.shape && !def.model)
          expect(opaqueCount(px), `${def.key} tile ${tile}`).toBe(256);
        if (
          def.shape === 'cross' ||
          def.shape === 'torch' ||
          def.key.includes('rail') ||
          def.key.includes('wire')
        )
          expect(opaqueCount(px), `${def.key} tile ${tile}`).toBeLessThan(200);
      }
    }
  });
  it('draws stone and cobblestone as different materials', () => {
    const stone = classicTilePixels(3)!,
      cobble = classicTilePixels(9)!;
    let diff = 0;
    for (let i = 0; i < 1024; i += 4) if (stone[i] !== cobble[i]) diff++;
    expect(diff).toBeGreaterThan(150);
  });
  it('grows wheat stage by stage', () => {
    const covered = [49, 50, 51, 52, 53, 54, 55, 56].map((t) => opaqueCount(classicTilePixels(t)!));
    expect(new Set(covered).size).toBe(8);
    expect(covered[7]).toBeGreaterThan(covered[0] * 2);
  });
  it('paints torches as the two-pixel column the mesher maps (cols 7–8, rows 6–15)', () => {
    for (const tile of [46, 88, 89]) {
      const px = classicTilePixels(tile)!;
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          const inside = (x === 7 || x === 8) && y >= 6;
          expect(alpha(px, x, y) > 0, `tile ${tile} @${x},${y}`).toBe(inside);
        }
    }
  });
  it('brightens redstone wire with power', () => {
    const red = (t: number) => {
      const px = classicTilePixels(t)!;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i + 3]) sum += px[i];
      return sum;
    };
    expect(red(87)).toBeGreaterThan(red(72) * 2);
  });
});

describe('item sprites (0.10 texture pass)', () => {
  it('draws every sprite: deterministic, outlined shapes with a transparent margin', () => {
    for (let i = 0; i < SPRITE_COUNT; i++) {
      const px = itemSpritePixels(i);
      expect(px, `sprite ${i}`).not.toBeNull();
      expect([...px!]).toEqual([...itemSpritePixels(i)!]);
      const n = opaqueCount(px!);
      expect(n, `sprite ${i}`).toBeGreaterThan(12);
      expect(n, `sprite ${i}`).toBeLessThan(230);
    }
  });
  it('gives each tool material its own look', () => {
    const [wood, stone, iron] = [4, 5, 6].map((s) => [...itemSpritePixels(s)!].join());
    expect(new Set([wood, stone, iron]).size).toBe(3);
  });
});
