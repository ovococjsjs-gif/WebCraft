import { describe, it, expect } from 'vitest';
import { generateColumn, surfaceHeight } from '../../packages/core/src/terrain';
import { VoxelWorld, ChunkColumn } from '../../packages/core/src/world';
import { meshSection, meshTransfers } from '../../packages/renderer/src/mesher';
import { BLOCK } from '../../packages/content/src/blocks';
import { seedHash } from '../../packages/core/src/random';
function emptyWorld() {
  const w = new VoxelWorld('mesh');
  for (let x = -1; x <= 1; x++)
    for (let z = -1; z <= 1; z++) {
      const c = new ChunkColumn(x, z);
      c.status = 'ready';
      w.addColumn(c);
    }
  return w;
}
describe('original deterministic terrain fixture', () => {
  it('produces identical columns from identical seed and coordinates', () => {
    const a = generateColumn(-1, 0, '642018', 'valley'),
      b = generateColumn(-1, 0, '642018', 'valley');
    for (const [sy, s] of a.sections) {
      expect(b.sections.get(sy)?.indices).toEqual(s.indices);
      expect(b.sections.get(sy)?.palette).toEqual(s.palette);
    }
  });
  it('is independent of neighbouring column generation order', () => {
    const a = new VoxelWorld('same'),
      b = new VoxelWorld('same');
    for (const x of [-1, 0, 1]) a.addColumn(generateColumn(x, 0, 'same', 'valley'));
    for (const x of [1, 0, -1]) b.addColumn(generateColumn(x, 0, 'same', 'valley'));
    for (let x = -2; x <= 17; x++)
      for (let y = 0; y < 48; y++) expect(a.getBlock(x, y, 7)).toBe(b.getBlock(x, y, 7));
  });
  it('changes terrain for a different seed away from the fixed river channel', () => {
    const a = generateColumn(3, -2, 'one', 'valley'),
      b = generateColumn(3, -2, 'two', 'valley');
    expect(a.sections.get(1)?.indices).not.toEqual(b.sections.get(1)?.indices);
  });
  it('generates the known flat test platform and protected base', () => {
    const c = generateColumn(-1, -1, 'test', 'flat');
    expect(c.get(0, 0, 0)).toBe(BLOCK.BEDROCK);
    expect(c.get(15, 8, 15)).toBe(BLOCK.GRASS);
    expect(c.get(15, 9, 15)).toBe(BLOCK.AIR);
    expect(surfaceHeight(-700, 25, seedHash('s'), 'flat')).toBe(8);
  });
});
describe('visible-face geometry', () => {
  it('emits no geometry for an empty section', () => {
    expect(meshSection(emptyWorld(), 0, 0, 0).faces).toBe(0);
  });
  it('emits 6 faces for one isolated cube', () => {
    const w = emptyWorld();
    w.setBlock(1, 1, 1, BLOCK.STONE);
    const m = meshSection(w, 0, 0, 0);
    expect(m.faces).toBe(6);
    expect(m.layers.opaque?.indices.length).toBe(36);
  });
  it('culls internal faces between adjacent cubes', () => {
    const w = emptyWorld();
    w.setBlock(1, 1, 1, BLOCK.STONE);
    w.setBlock(2, 1, 1, BLOCK.STONE);
    expect(meshSection(w, 0, 0, 0).faces).toBe(10);
  });
  it('culls a face across a column boundary', () => {
    const w = emptyWorld();
    w.setBlock(15, 1, 1, BLOCK.STONE);
    w.setBlock(16, 1, 1, BLOCK.STONE);
    expect(meshSection(w, 0, 0, 0).faces).toBe(5);
    expect(meshSection(w, 1, 0, 0).faces).toBe(5);
  });
  it('splits render layers and preserves glass visibility against opaque blocks', () => {
    const w = emptyWorld();
    w.setBlock(1, 1, 1, BLOCK.STONE);
    w.setBlock(3, 1, 1, BLOCK.GLASS);
    w.setBlock(5, 1, 1, BLOCK.LEAVES);
    const m = meshSection(w, 0, 0, 0);
    expect(Object.keys(m.layers).sort()).toEqual(['cutout', 'opaque', 'transparent']);
  });
  it('emits two crossed quads for plants', () => {
    const w = emptyWorld();
    w.setBlock(1, 1, 1, BLOCK.FLOWER);
    const m = meshSection(w, 0, 0, 0);
    expect(m.faces).toBe(2);
    expect(m.layers.cutout?.indices.length).toBe(12);
  });
  it('provides finite attributes, in-range UVs and transferable buffers', () => {
    const w = emptyWorld();
    w.setBlock(1, 1, 1, BLOCK.LOG);
    const m = meshSection(w, 0, 0, 0);
    const layer = m.layers.opaque!;
    expect([...layer.uvs].every((v) => v >= 0 && v <= 1)).toBe(true);
    expect([...layer.positions, ...layer.colors].every(Number.isFinite)).toBe(true);
    expect(meshTransfers(m)).toHaveLength(7);
    expect(
      [...layer.lights].every((value) => Number.isFinite(value) && value >= 0 && value <= 1),
    ).toBe(true);
  });
  it('culls internal water faces', () => {
    const w = emptyWorld();
    w.setBlock(1, 1, 1, BLOCK.WATER);
    w.setBlock(2, 1, 1, BLOCK.WATER);
    expect(meshSection(w, 0, 0, 0).faces).toBe(10);
  });
});
