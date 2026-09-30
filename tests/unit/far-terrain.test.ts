import { describe, expect, it } from 'vitest';
import { BLOCK, registry } from '../../packages/content/src/blocks';
import { GeneratorV5 } from '../../packages/core/src/worldgen/generator-v5';
import { farPatchV5 } from '../../packages/core/src/worldgen/far-v5';
import { idx, SEA_LEVEL } from '../../packages/core/src/worldgen/terrain-v5';
import { buildFarMesh, LEAF_FLAG, NO_TILE } from '../../packages/renderer/src/far-mesher';

/** The y above the highest block of terrain in a column (trees, plants and water ignored). */
function groundTop(blocks: Uint16Array, x: number, z: number): number {
  for (let y = 255; y > 0; y--) {
    const id = blocks[idx(x, y, z)];
    if (!id || id === BLOCK.WATER) continue;
    const def = registry.get(id);
    if (!def.solid || /leaves|log|mushroom_block|cactus|snow_layer/.test(def.key)) continue;
    return y + 1;
  }
  return 0;
}

describe('far terrain (round G)', () => {
  it('samples the same patch for the same request', () => {
    const a = farPatchV5('far-a', 'overworld', 256, -512, 4, 16);
    const b = farPatchV5('far-a', 'overworld', 256, -512, 4, 16);
    expect(a.side).toBe(18);
    expect([...a.heights]).toEqual([...b.heights]);
    expect([...a.tops]).toEqual([...b.tops]);
    expect([...a.canopy]).toEqual([...b.canopy]);
    const other = farPatchV5('far-b', 'overworld', 256, -512, 4, 16);
    expect([...other.heights]).not.toEqual([...a.heights]);
  });
  it('follows the ground of the generated chunks closely', () => {
    const g = new GeneratorV5('far-ground', 'overworld');
    let near = 0,
      total = 0;
    for (const [cx, cz] of [
      [0, 0],
      [7, -3],
      [-12, 9],
      [20, 20],
    ]) {
      const blocks = g.chunk(cx, cz).blocks;
      const patch = farPatchV5('far-ground', 'overworld', cx * 16, cz * 16, 4, 4);
      for (let j = 0; j < 4; j++)
        for (let i = 0; i < 4; i++) {
          const k = i + 1 + (j + 1) * patch.side;
          const real = Math.max(groundTop(blocks, i * 4, j * 4), patch.depth[k] ? SEA_LEVEL : 0);
          total++;
          if (Math.abs(real - patch.heights[k]) <= 2) near++;
        }
    }
    expect(near / total).toBeGreaterThan(0.8);
  });
  it('builds a valid mesh whose faces point out of the terrain', () => {
    const stride = 4,
      cells = 32;
    const patch = farPatchV5('far-mesh', 'overworld', -128, 64, stride, cells);
    const mesh = buildFarMesh(patch, stride, cells);
    const vertices = mesh.positions.length / 3;
    expect(vertices).toBeGreaterThan(0);
    expect(mesh.colors.length).toBe(vertices * 4);
    expect(mesh.indices.length % 6).toBe(0);
    expect(Math.max(...mesh.indices)).toBeLessThan(vertices);
    expect(mesh.minY).toBeLessThanOrEqual(mesh.maxY);
    // Every triangle faces away from the cell it belongs to: tops up, walls towards the lower side.
    const p = mesh.positions;
    let up = 0,
      down = 0;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [a, b, c] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]].map(
        (v) => v * 3,
      );
      const ux = p[b] - p[a],
        uy = p[b + 1] - p[a + 1],
        uz = p[b + 2] - p[a + 2],
        vx = p[c] - p[a],
        vy = p[c + 1] - p[a + 1],
        vz = p[c + 2] - p[a + 2];
      const ny = uz * vx - ux * vz;
      void uy;
      void vy;
      if (ny > 0) up++;
      else if (ny < 0) down++;
    }
    // Only the undersides of crowns face down.
    expect(up).toBeGreaterThan(down * 2);
    // Kinds: 255 land, 128 canopy, 0 water.
    const kinds = new Set<number>();
    for (let i = 3; i < mesh.colors.length; i += 4) kinds.add(mesh.colors[i]);
    for (const kind of kinds) expect([0, 128, 255]).toContain(kind);
  });
  it('shows walls towards a lower neighbour facing that neighbour', () => {
    // A synthetic patch: one raised cell in the middle of flat land.
    const side = 5,
      count = side * side;
    const patch = farPatchV5('far-wall', 'overworld', 0, 0, 4, 3);
    const flat = {
      ...patch,
      side,
      heights: new Int16Array(count).fill(70),
      depth: new Uint8Array(count),
      tops: new Uint16Array(count).fill(BLOCK.GRASS),
      canopy: new Uint8Array(count),
      leaves: new Uint8Array(count),
      biomes: new Uint8Array(count).fill(patch.biomes[0]),
    };
    flat.heights[2 + 2 * side] = 72;
    const mesh = buildFarMesh(flat, 4, 3);
    const p = mesh.positions;
    const normals: string[] = [];
    for (let t = 0; t < mesh.indices.length; t += 6) {
      const [a, b, c] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]].map(
        (v) => v * 3,
      );
      const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]],
        v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const low = Math.min(p[a + 1], p[b + 1], p[c + 1]);
      if (n[1] === 0 && low >= 70) {
        // A wall of the raised cell: its normal points away from the cell centre (6, 6).
        const mid = [(p[a] + p[c]) / 2 - 6, (p[a + 2] + p[c + 2]) / 2 - 6];
        normals.push(String(Math.sign(n[0] * mid[0] + n[2] * mid[1])));
      }
    }
    // Two blocks high on every side: the grass edge over a block of dirt, all facing outward.
    expect(normals).toEqual(Array(8).fill('1'));
  });
});

describe('far terrain (round H)', () => {
  it('gives every vertex the atlas tile of its face', () => {
    const patch = farPatchV5('far-tiles', 'overworld', 1024, 1024, 2, 32);
    const mesh = buildFarMesh(patch, 2, 32);
    expect(mesh.tiles.length).toBe(mesh.positions.length / 3);
    const used = new Set(mesh.tiles);
    // Water has no texture; every other tile is a real atlas cell (leaves carry a flag bit).
    for (const tile of used) if (tile !== NO_TILE) expect(tile & ~LEAF_FLAG).toBeLessThan(512);
    // The tops of the land carry the texture of the block that tops each column.
    const tops = new Set<number>();
    for (let j = 0; j < 32; j++)
      for (let i = 0; i < 32; i++) {
        const k = i + 1 + (j + 1) * patch.side;
        if (!patch.depth[k]) tops.add(registry.get(patch.tops[k]).textures[0]);
      }
    for (const tile of tops) expect(used.has(tile)).toBe(true);
  });
  it('stands trunks under the crowns only at single-block detail', () => {
    let fine = 0,
      coarse = 0;
    for (const [x, z] of [
      [0, 0],
      [2048, -1024],
      [-3000, 512],
    ]) {
      fine += farPatchV5('far-trunks', 'overworld', x, z, 1, 32).trunk.reduce((a, b) => a + b, 0);
      coarse += farPatchV5('far-trunks', 'overworld', x, z, 2, 32).trunk.reduce((a, b) => a + b, 0);
    }
    expect(fine).toBeGreaterThan(0);
    expect(coarse).toBe(0);
  });
});
