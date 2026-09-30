import { describe, it, expect } from 'vitest';
import { Section, VoxelWorld, ChunkColumn } from '../../packages/core/src/world';
import { BLOCK, BLOCKS, BlockRegistry } from '../../packages/content/src/blocks';
function empty(world: VoxelWorld, cx = 0, cz = 0) {
  const c = new ChunkColumn(cx, cz);
  c.status = 'ready';
  world.addColumn(c);
  return c;
}
describe('palette sections', () => {
  it('allocates compact typed storage, not one object per block', () => {
    const s = new Section();
    expect(s.indices.byteLength).toBe(8192);
    expect(s.nonAir).toBe(0);
    expect(s.palette).toEqual([0]);
  });
  it('deduplicates palette entries and counts non-air transitions', () => {
    const s = new Section();
    s.set(0, BLOCK.STONE);
    s.set(1, BLOCK.STONE);
    expect(s.palette).toEqual([0, BLOCK.STONE]);
    expect(s.nonAir).toBe(2);
    const rev = s.revision;
    expect(s.set(1, BLOCK.STONE)).toBe(false);
    expect(s.revision).toBe(rev);
    s.set(0, BLOCK.AIR);
    expect(s.nonAir).toBe(1);
  });
  it('snapshot data is independent, and roundtrips all cells', () => {
    const s = new Section();
    for (let i = 0; i < 4096; i++) s.set(i, i % 9);
    const snap = s.snapshot(),
      restored = Section.restore(snap);
    expect(restored.indices).toEqual(s.indices);
    expect(restored.palette).toEqual(s.palette);
    expect(restored.nonAir).toBe(s.nonAir);
    snap.indices[5] = 0;
    expect(s.get(5)).toBe(5);
  });
  it('rejects unknown states, bad coordinates, and malformed snapshots', () => {
    const s = new Section();
    expect(() => s.set(4096, 1)).toThrow();
    expect(() => s.set(-1, 1)).toThrow();
    expect(() => s.set(1, 9999)).toThrow();
    expect(() =>
      Section.restore({ palette: [0], indices: new Uint16Array(2), revision: 0 }),
    ).toThrow();
    const bad = s.snapshot();
    bad.indices[1] = 12;
    expect(() => Section.restore(bad)).toThrow();
  });
});
describe('world mutation boundary', () => {
  it('writes into negative column coordinates', () => {
    const w = new VoxelWorld('test');
    empty(w, -1, -1);
    expect(w.setBlock(-1, 255, -16, BLOCK.GLASS)).toBe(true);
    expect(w.getBlock(-1, 255, -16)).toBe(BLOCK.GLASS);
    expect(w.column(-1, -1)?.get(15, 255, 0)).toBe(BLOCK.GLASS);
  });
  it('rejects writes into absent or generating columns', () => {
    const w = new VoxelWorld('test');
    expect(w.setBlock(0, 1, 0, 1)).toBe(false);
    const c = new ChunkColumn(0, 0);
    c.status = 'generating';
    w.addColumn(c);
    expect(w.setBlock(0, 1, 0, 1)).toBe(false);
  });
  it('invalidates both sides of section and diagonal column seams', () => {
    const w = new VoxelWorld('test');
    empty(w);
    w.dirtySections.clear();
    w.setBlock(15, 15, 15, BLOCK.LOG);
    expect([...w.dirtySections]).toEqual(
      expect.arrayContaining(['0,0,0', '1,0,0', '0,0,1', '1,0,1', '1,1,1']),
    );
  });
  it('does not allocate outside the target height', () => {
    const w = new VoxelWorld('test');
    empty(w);
    expect(w.setBlock(0, -1, 0, 1)).toBe(false);
    expect(w.setBlock(0, 256, 0, 1)).toBe(false);
    expect(w.sectionCount).toBe(0);
  });
  it('keeps independent dimensions separate', () => {
    const a = new VoxelWorld('s', 'overworld'),
      b = new VoxelWorld('s', 'nether');
    empty(a);
    empty(b);
    a.setBlock(0, 1, 0, BLOCK.LOG);
    expect(b.getBlock(0, 1, 0)).toBe(0);
    expect(a.dimensionID).not.toBe(b.dimensionID);
  });
  it('unloads columns without retaining their section buffers in the world map', () => {
    const w = new VoxelWorld('s');
    empty(w);
    w.setBlock(1, 1, 1, 1);
    expect(w.storageBytes).toBeGreaterThan(8192);
    w.removeColumn(0, 0);
    expect(w.storageBytes).toBe(0);
    expect(w.columns.size).toBe(0);
  });
  it('rejects duplicate block registry IDs and missing air', () => {
    expect(() => new BlockRegistry([BLOCKS[0], BLOCKS[0]])).toThrow();
    expect(() => new BlockRegistry([BLOCKS[1]])).toThrow();
    expect(() => new BlockRegistry(BLOCKS)).not.toThrow();
  });
});
