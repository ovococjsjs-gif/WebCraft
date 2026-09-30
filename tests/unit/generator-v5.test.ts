import { describe, expect, it } from 'vitest';
import { BLOCK, registry } from '../../packages/content/src/blocks';
import { GeneratorV5, spawnPointV5 } from '../../packages/core/src/worldgen/generator-v5';
import { BIOMES_V5, biomeV5 } from '../../packages/core/src/worldgen/biomes-v5';
import { idx, SEA_LEVEL } from '../../packages/core/src/worldgen/terrain-v5';
import { generateColumn, spawnPoint } from '../../packages/core/src/terrain';
import { WorldSession } from '../../packages/core/src/session';
import { GENERATOR_VERSION } from '../../packages/core/src/persistence';

const same = (a: Uint16Array, b: Uint16Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

describe('generator v5', () => {
  it('is the generator of new worlds', () => {
    expect(GENERATOR_VERSION).toBe(5);
    expect(new WorldSession('v5-new', 'overworld').checkpoint().generator.version).toBe(5);
  });
  it('gives the same chunk whatever was generated before it', () => {
    const lone = new GeneratorV5('order', 'overworld').chunk(3, -2).blocks;
    const busy = new GeneratorV5('order', 'overworld');
    for (const [x, z] of [
      [4, -2],
      [2, -3],
      [-5, 7],
      [3, -1],
      [2, -2],
    ])
      busy.chunk(x, z);
    expect(same(busy.chunk(3, -2).blocks, lone)).toBe(true);
    expect(same(new GeneratorV5('order', 'overworld').chunk(3, -2).blocks, lone)).toBe(true);
  });
  it('depends on the seed and the preset', () => {
    const a = new GeneratorV5('one', 'overworld').chunk(0, 0).blocks;
    expect(same(new GeneratorV5('two', 'overworld').chunk(0, 0).blocks, a)).toBe(false);
    expect(same(new GeneratorV5('one', 'amplified').chunk(0, 0).blocks, a)).toBe(false);
  });
  it('fills a column with registered blocks, solid ground at the bottom and a sea below 63', () => {
    const g = new GeneratorV5('content', 'overworld');
    let water = 0;
    for (let cx = -12; cx <= 12; cx += 3) {
      const { blocks, biomes } = g.chunk(cx, 0);
      for (const s of new Set(blocks)) expect(() => registry.get(s)).not.toThrow();
      for (const b of biomes) expect(BIOMES_V5[b]).toBeDefined();
      for (let i = 0; i < 256; i++) {
        expect(blocks[idx(i & 15, 0, i >> 4)]).not.toBe(BLOCK.AIR);
        if (blocks[idx(i & 15, SEA_LEVEL - 1, i >> 4)] === BLOCK.WATER) water++;
      }
    }
    expect(water).toBeGreaterThan(0);
  });
  it('is reached through generateColumn at version 5 and records biomes', () => {
    const column = generateColumn(0, 0, 'dispatch', 'overworld', 5);
    expect(column.biomes).toHaveLength(256);
    expect(column.status).toBe('ready');
    const legacy = generateColumn(0, 0, 'dispatch', 'overworld', 4);
    expect(legacy.biomes).toBeUndefined();
  });
  it('spawns the player on open ground, never inside blocks or at sea', () => {
    for (const seed of [
      'alpha',
      'beta',
      'spawn-3',
      'Ω',
      '12345',
      'island',
      'forest',
      'jungle',
      'taiga',
      'playtest',
      'ui1',
      'roofed',
    ]) {
      const p = spawnPointV5(seed, 'overworld');
      const g = new GeneratorV5(seed, 'overworld');
      const x = Math.floor(p.x),
        z = Math.floor(p.z),
        y = Math.floor(p.y);
      const { blocks } = g.chunk(x >> 4, z >> 4);
      const at = (yy: number) => blocks[idx(x & 15, yy, z & 15)];
      expect(registry.get(at(y - 1)).solid).toBe(true);
      // Never on a treetop: the ground under the feet is not wood or leaves.
      expect(registry.get(at(y - 1)).key).not.toMatch(/_log$|^lab:log$|leaves/);
      expect(registry.get(at(y)).solid).toBe(false);
      expect(registry.get(at(y + 1)).solid).toBe(false);
      expect(registry.get(at(y)).fluid).toBeFalsy();
      expect(y).toBeGreaterThan(SEA_LEVEL);
      expect(spawnPoint(seed, 'overworld', 5)).toEqual(p);
    }
  });
  it('has large-biome and amplified variants', () => {
    const tall = (preset: 'overworld' | 'amplified') => {
      const g = new GeneratorV5('tall', preset);
      let top = 0;
      for (let cx = 0; cx < 4; cx++)
        for (let cz = 0; cz < 4; cz++) {
          const { blocks } = g.chunk(cx * 3, cz * 3);
          for (let i = 0; i < 256; i++) {
            let y = 255;
            while (y > 0 && blocks[idx(i & 15, y, i >> 4)] === BLOCK.AIR) y--;
            top = Math.max(top, y);
          }
        }
      return top;
    };
    expect(tall('amplified')).toBeGreaterThan(tall('overworld'));
    expect(new GeneratorV5('big', 'large-biomes').layout).not.toBe(
      new GeneratorV5('big', 'overworld').layout,
    );
  });
  it('lays out a varied world: oceans, rivers, beaches and many land biomes', () => {
    const layout = new GeneratorV5('variety', 'overworld').layout;
    const kinds = new Map<string, number>();
    const keys = new Set<string>();
    for (let x = -3000; x <= 3000; x += 40)
      for (let z = -3000; z <= 3000; z += 40) {
        const b = biomeV5(layout.biomeAt(x, z));
        kinds.set(b.kind, (kinds.get(b.kind) ?? 0) + 1);
        keys.add(b.key);
      }
    const total = [...kinds.values()].reduce((a, b) => a + b, 0);
    expect((kinds.get('ocean') ?? 0) / total).toBeGreaterThan(0.2);
    expect((kinds.get('land') ?? 0) / total).toBeGreaterThan(0.35);
    expect(kinds.get('river')).toBeGreaterThan(0);
    expect(kinds.get('beach')).toBeGreaterThan(0);
    expect(keys.size).toBeGreaterThan(20);
  });
  it('generates a chunk in reasonable time', () => {
    const g = new GeneratorV5('speed', 'overworld');
    g.chunk(0, 0);
    const t = performance.now();
    for (let i = 1; i <= 8; i++) g.chunk(i, 0);
    expect((performance.now() - t) / 8).toBeLessThan(150);
  });
});
