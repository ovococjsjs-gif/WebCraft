/**
 * Golden fingerprints of every frozen generator version. A save only stores the player's edits;
 * the landscape under them is regenerated from the seed, so a single changed block in an old
 * generator silently moves every existing world. These hashes pin versions 1–4 byte for byte.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { registry } from '../../packages/content/src/blocks';
import { generateColumn, spawnPoint, type WorldPreset } from '../../packages/core/src/terrain';
import { generateNetherColumn } from '../../packages/core/src/nether';
import { generateEndColumn } from '../../packages/core/src/end';
import type { ChunkColumn } from '../../packages/core/src/world';

export const GOLDEN_SEEDS = ['642018', 'golden-a', '-17'] as const;
export const GOLDEN_COLUMNS: readonly (readonly [number, number])[] = [
  [0, 0],
  [-1, -1],
  [3, -2],
  [-5, 4],
  [12, 7],
  [-20, -31],
];
function columnHash(column: ChunkColumn): string {
  const keys = new Map<number, number>();
  const bytes = new Uint8Array(16 * 16 * 256 * 2);
  let i = 0;
  for (let y = 0; y < 256; y++)
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const id = column.get(x, y, z);
        // Hash the stable key, not the runtime number: renumbering is allowed, reshaping is not.
        let code = keys.get(id);
        if (code === undefined) {
          code = hashKey(registry.get(id).key);
          keys.set(id, code);
        }
        bytes[i++] = code & 255;
        bytes[i++] = code >> 8;
      }
  return bytesToHex(sha256(bytes)).slice(0, 24);
}
function hashKey(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 33) ^ key.charCodeAt(i)) & 0xffff;
  return h;
}
export interface GoldenEntry {
  readonly id: string;
  readonly hash: string;
}
export function goldenCases(): { id: string; make: () => string }[] {
  const cases: { id: string; make: () => string }[] = [];
  const biome: WorldPreset[] = ['overworld', 'large-biomes', 'amplified'];
  for (const seed of GOLDEN_SEEDS) {
    for (const version of [2, 3, 4])
      for (const preset of biome)
        for (const [cx, cz] of GOLDEN_COLUMNS)
          cases.push({
            id: `ow/v${version}/${preset}/${seed}/${cx},${cz}`,
            make: () => columnHash(generateColumn(cx, cz, seed, preset, version)),
          });
    for (const preset of ['valley', 'flat'] as const)
      for (const [cx, cz] of GOLDEN_COLUMNS.slice(0, 3))
        cases.push({
          id: `ow/v1/${preset}/${seed}/${cx},${cz}`,
          make: () => columnHash(generateColumn(cx, cz, seed, preset, 1)),
        });
    for (const version of [3, 4]) {
      for (const [cx, cz] of GOLDEN_COLUMNS)
        cases.push({
          id: `nether/v${version}/${seed}/${cx},${cz}`,
          make: () => columnHash(generateNetherColumn(cx, cz, seed, version).column),
        });
      for (const [cx, cz] of [...GOLDEN_COLUMNS, [6, 0] as const, [0, -7] as const])
        cases.push({
          id: `end/v${version}/${seed}/${cx},${cz}`,
          make: () => columnHash(generateEndColumn(cx, cz, seed, version)),
        });
    }
    for (const preset of [...biome, 'valley', 'flat'] as WorldPreset[])
      cases.push({
        id: `spawn/${preset}/${seed}`,
        make: () => JSON.stringify(spawnPoint(seed, preset)),
      });
  }
  return cases;
}
