/**
 * The End: a central island of end stone with the fountain and the obsidian pillars the crystals
 * stand on, and a scatter of outer islands far away, where the end cities wait. As everywhere
 * else, a column knows nothing about its neighbours: the island shape is a function of the
 * coordinates alone.
 */
import { BLOCK } from '../../content/src/blocks';
import { ChunkColumn } from './world';
import { hash2, seedHash } from './random';
import { noise } from './overworld';

/** Radius of the island the dragon circles, and how far the outer islands start. */
export const END_MAIN_RADIUS = 62;
export const END_OUTER_START = 620;
export const END_OUTER_END = 3000;
/** The pillars stand on this circle. */
export const END_PILLAR_RADIUS = 43;
export const END_PILLAR_COUNT = 10;
/** Height of the flat surface of the main island before noise is added. */
export const END_SURFACE = 62;
/** Where the exit portal and the dragon egg sit. */
export const END_FOUNTAIN = { x: 0, y: 64, z: 0 } as const;
export function generateEndColumn(
  cx: number,
  cz: number,
  seedText: string,
  generatorVersion = 4,
): ChunkColumn {
  const column = new ChunkColumn(cx, cz);
  column.status = 'generating';
  const seed = seedHash(seedText),
    ox = cx * 16,
    oz = cz * 16;
  for (let x = 0; x < 16; x++)
    for (let z = 0; z < 16; z++) {
      const wx = ox + x,
        wz = oz + z;
      const distance = Math.hypot(wx, wz);
      const height = islandHeight(wx, wz, distance, seed);
      if (height < 0) continue;
      const thickness = 3 + Math.floor(hash2(wx, wz, seed + 5101) * 5);
      for (let y = Math.max(0, height - thickness); y <= height; y++)
        column.set(x, y, z, BLOCK.END_STONE);
      // Chorus-like growth on the lower shelves of the outer islands is left to the decoration
      // pass; the surface itself is bare end stone.
    }
  buildPillars(column, cx, cz);
  buildFountain(column, cx, cz);
  buildOuterStructures(column, cx, cz, seed, generatorVersion);
  column.status = 'ready';
  return column;
}
/** Surface height of the island at a point, or -1 where there is no island at all. */
export function islandHeight(x: number, z: number, distance: number, seed: number): number {
  if (distance <= END_MAIN_RADIUS) {
    const edge = Math.min(1, (END_MAIN_RADIUS - distance) / 18);
    const lumps = noise(x / 26 + 3.5, z / 26 - 8.5, seed + 5001);
    return Math.round(END_SURFACE + lumps * 5 * edge - (1 - edge) * 6);
  }
  if (distance < END_OUTER_START) return -1;
  const fade =
    Math.min(1, (distance - END_OUTER_START) / 320) * Math.min(1, (END_OUTER_END - distance) / 900);
  if (fade <= 0.05) return -1;
  const shape = noise(x / 90 + 17.5, z / 90 + 4.5, seed + 5209);
  if (shape < 0.12) return -1;
  const lumps = noise(x / 34 - 6.5, z / 34 + 9.5, seed + 5303);
  return Math.round(48 + shape * 26 * fade + lumps * 7);
}
/**
 * The ten pillars a crystal stands on: the ring the island generator builds, with the height of
 * each one, so the boss stage can put a crystal on every top.
 */
export function endPillarTops(): { x: number; y: number; z: number }[] {
  const result: { x: number; y: number; z: number }[] = [];
  for (let index = 0; index < END_PILLAR_COUNT; index++) {
    const angle = (index / END_PILLAR_COUNT) * Math.PI * 2;
    result.push({
      x: Math.round(Math.cos(angle) * END_PILLAR_RADIUS),
      y: 76 + (index % 4) * 3 + 1,
      z: Math.round(Math.sin(angle) * END_PILLAR_RADIUS),
    });
  }
  return result;
}
/** Ten obsidian pillars in a ring, each carrying an end crystal on top. */
function buildPillars(column: ChunkColumn, cx: number, cz: number): void {
  for (let index = 0; index < END_PILLAR_COUNT; index++) {
    const angle = (index / END_PILLAR_COUNT) * Math.PI * 2;
    const px = Math.round(Math.cos(angle) * END_PILLAR_RADIUS),
      pz = Math.round(Math.sin(angle) * END_PILLAR_RADIUS);
    const dx = px - (cx * 16 + 8),
      dz = pz - (cz * 16 + 8);
    if (Math.abs(dx) > 10 || Math.abs(dz) > 10) continue;
    const top = 76 + (index % 4) * 3;
    for (let y = Math.max(0, END_SURFACE - 6); y <= top; y++)
      for (let x = 0; x < 16; x++)
        for (let z = 0; z < 16; z++) {
          const wx = cx * 16 + x,
            wz = cz * 16 + z;
          if (Math.abs(wx - px) > 2 || Math.abs(wz - pz) > 2) continue;
          column.set(x, y, z, BLOCK.OBSIDIAN);
        }
  }
}
/** The bedrock fountain in the middle: the dragon egg rests on it until the dragon is beaten. */
function buildFountain(column: ChunkColumn, cx: number, cz: number): void {
  const dx = END_FOUNTAIN.x - (cx * 16 + 8),
    dz = END_FOUNTAIN.z - (cz * 16 + 8);
  if (Math.abs(dx) > 12 || Math.abs(dz) > 12) return;
  for (let x = 0; x < 16; x++)
    for (let z = 0; z < 16; z++) {
      const wx = cx * 16 + x,
        wz = cz * 16 + z;
      const d = Math.max(Math.abs(wx), Math.abs(wz));
      if (d > 3) continue;
      for (let y = 58; y <= END_FOUNTAIN.y + 5; y++)
        column.set(x, y, z, y <= END_FOUNTAIN.y ? BLOCK.END_STONE : BLOCK.AIR);
      if (d === 3)
        for (let y = END_FOUNTAIN.y + 1; y <= END_FOUNTAIN.y + 3; y++)
          column.set(x, y, z, BLOCK.BEDROCK);
      if (d <= 2) column.set(x, END_FOUNTAIN.y + 1, z, BLOCK.BEDROCK);
      if (d <= 1) column.set(x, END_FOUNTAIN.y + 2, z, BLOCK.BEDROCK);
      if (Math.abs(wx) <= 1 && Math.abs(wz) <= 1) {
        column.set(x, END_FOUNTAIN.y + 3, z, BLOCK.BEDROCK);
        if (d === 0) column.set(x, END_FOUNTAIN.y + 4, z, BLOCK.BEDROCK);
      }
    }
}
/** Towers on the outer islands: end stone brick with a purpur roof and a chest inside. */
function buildOuterStructures(
  column: ChunkColumn,
  cx: number,
  cz: number,
  seed: number,
  generatorVersion: number,
): void {
  const cell = 256;
  // v1–v3 retain their exact old geometry. v4 fixes chunk-vs-structure-cell coordinates.
  const minX = generatorVersion >= 4 ? Math.floor((cx * 16 - 180) / cell) : cx - 1;
  const maxX = generatorVersion >= 4 ? Math.floor((cx * 16 + 19 - 80) / cell) : cx + 1;
  const minZ = generatorVersion >= 4 ? Math.floor((cz * 16 - 180) / cell) : cz - 1;
  const maxZ = generatorVersion >= 4 ? Math.floor((cz * 16 + 19 - 80) / cell) : cz + 1;
  for (let gx = minX; gx <= maxX; gx++)
    for (let gz = minZ; gz <= maxZ; gz++) {
      if (hash2(gx, gz, seed + 6113) >= 0.55) continue;
      const towerX = gx * cell + 80 + Math.floor(hash2(gx, gz, seed + 6121) * 96);
      const towerZ = gz * cell + 80 + Math.floor(hash2(gx, gz, seed + 6131) * 96);
      if (Math.hypot(towerX, towerZ) < END_OUTER_START) continue;
      const dx = towerX - (cx * 16 + 8),
        dz = towerZ - (cz * 16 + 8);
      if (Math.abs(dx) > 12 || Math.abs(dz) > 12) continue;
      const base = islandHeight(towerX, towerZ, Math.hypot(towerX, towerZ), seed);
      if (base < 0) continue;
      const height = 12 + Math.floor(hash2(gx, gz, seed + 6143) * 8);
      for (let x = 0; x < 16; x++)
        for (let z = 0; z < 16; z++) {
          const wx = cx * 16 + x,
            wz = cz * 16 + z;
          const tx = wx - towerX,
            tz = wz - towerZ;
          if (Math.abs(tx) > 4 || Math.abs(tz) > 4) continue;
          const wall = Math.abs(tx) === 4 || Math.abs(tz) === 4;
          for (let y = base; y <= base + height; y++) {
            if (y === base) column.set(x, y, z, BLOCK.END_STONE_BRICKS);
            else if (y === base + height) column.set(x, y, z, BLOCK.PURPUR);
            else if (wall && Math.abs(tx) <= 4 && Math.abs(tz) <= 4)
              column.set(x, y, z, y === base + 3 && tx === 0 ? BLOCK.AIR : BLOCK.END_STONE_BRICKS);
            else column.set(x, y, z, BLOCK.AIR);
          }
          // A chest with the wings waits on the top floor: the loot stage fills it.
          if (tx === 0 && tz === 0) column.set(x, base + 1, z, BLOCK.CHEST);
        }
    }
}
/** Where the arrival platform for the End portal goes, and where the dragon waits. */
export function endSpawnPoint(): { x: number; y: number; z: number } {
  return { x: 0.5, y: END_SURFACE + 1.01, z: 0.5 };
}
