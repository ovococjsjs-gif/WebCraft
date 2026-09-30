/**
 * The Nether: a cave system carved out of netherrack between two bedrock layers, with a lava
 * ocean in its floor, glowstone on its ceiling, quartz veins in its rock, soul sand along the
 * shores and fortresses of nether brick. Like the Overworld generator, every column is a pure
 * function of its coordinates and the seed.
 */
import { BLOCK } from '../../content/src/blocks';
import { ChunkColumn } from './world';
import { hash2, hash3, seedHash } from './random';
import { noise3 } from './overworld';

export const NETHER_FLOOR = 1;
export const NETHER_CEILING = 127;
/** Below this height the floor of the Nether is a sea of lava. */
export const NETHER_LAVA_SEA = 31;
/** Rock starts a little above the lava and stops a little under the ceiling. */
/** Chance per region that a fortress cell holds a bridge. */
const FORTRESS_CELL = 128;
export interface NetherColumn {
  readonly column: ChunkColumn;
  /** True when the column is part of a fortress: the caller may light its blaze spawners. */
  readonly fortress: boolean;
}
/**
 * Where the Nether is solid. The floor and the ceiling are closed, the layer under the lava sea
 * is rock with lava pockets, and everything between is a cavern: the noise decides where the
 * pillars and islands of netherrack stand, so the space stays connected and walkable.
 */
const NETHER_CEILING_ROCK = 118;
function rockAt(x: number, y: number, z: number, seed: number): boolean {
  if (y <= NETHER_FLOOR || y >= NETHER_CEILING_ROCK) return true;
  const body = noise3(x / 48, y / 30, z / 48, seed + 1701);
  const detail = noise3(x / 17 + 21.5, y / 12 - 7.5, z / 17 + 3.5, seed + 1907);
  // Below the lava line the same field is pushed towards rock only where it is strongest, so the
  // lava ocean keeps islands and pillars instead of being a flat sheet.
  const bias = y <= NETHER_LAVA_SEA ? 0.34 : 0;
  const density = body * 0.75 + detail * 0.25 + bias;
  // Right above the lava the rock thins out, so the sea is visible from the caverns.
  return density > (y > NETHER_LAVA_SEA + 10 ? 0.2 : 0.32);
}
/** Glowstone hangs from the ceiling in clusters. */
function glowstoneAt(x: number, y: number, z: number, seed: number): boolean {
  if (y < 70 || y >= NETHER_CEILING) return false;
  const cluster = noise3(x / 11, y / 7, z / 11, seed + 2311);
  return cluster > 0.24;
}
export function generateNetherColumn(
  cx: number,
  cz: number,
  seedText: string,
  generatorVersion = 4,
): NetherColumn {
  const column = new ChunkColumn(cx, cz);
  column.status = 'generating';
  const seed = seedHash(seedText),
    ox = cx * 16,
    oz = cz * 16;
  const fortress = inFortress(ox + 8, oz + 8, seed);
  for (let x = 0; x < 16; x++)
    for (let z = 0; z < 16; z++) {
      const wx = ox + x,
        wz = oz + z;
      for (let y = NETHER_FLOOR; y <= NETHER_CEILING; y++) {
        let state: number = BLOCK.AIR;
        if (y <= NETHER_FLOOR || y >= NETHER_CEILING) state = BLOCK.BEDROCK;
        else if (y >= NETHER_CEILING - 4 && hash3(wx, y, wz, seed + 59) < 0.34)
          state = BLOCK.BEDROCK;
        else if (rockAt(wx, y, wz, seed)) state = BLOCK.NETHERRACK;
        else if (y <= NETHER_LAVA_SEA) state = BLOCK.LAVA;
        column.set(x, y, z, state);
      }
    }
  // Quartz runs in small veins through the rock, soul sand lies in patches on the floor.
  for (let x = 0; x < 16; x++)
    for (let z = 0; z < 16; z++) {
      const wx = ox + x,
        wz = oz + z;
      const vein = hash3(Math.floor(wx / 4), 1, Math.floor(wz / 4), seed + 3001);
      const quartz = vein < 0.1;
      const soul = hash2(Math.floor(wx / 6), Math.floor(wz / 6), seed + 3041) < 0.3;
      for (let y = NETHER_FLOOR + 1; y < NETHER_CEILING; y++) {
        if (column.get(x, y, z) !== BLOCK.NETHERRACK) continue;
        const above = column.get(x, y + 1, z);
        // Glowstone hangs from the rock where the space below it is open.
        if (y >= 76 && column.get(x, y - 1, z) === BLOCK.AIR && glowstoneAt(wx, y, wz, seed)) {
          column.set(x, y, z, BLOCK.GLOWSTONE);
          continue;
        }
        if (quartz && hash3(wx, y, wz, seed + 3109) < 0.28)
          column.set(x, y, z, BLOCK.NETHER_QUARTZ_ORE);
        else if (soul && above === BLOCK.AIR && y <= NETHER_LAVA_SEA + 8 && y > NETHER_LAVA_SEA - 2)
          column.set(x, y, z, BLOCK.SOUL_SAND);
        else if (above === BLOCK.AIR && y < NETHER_LAVA_SEA + 12 && y > NETHER_LAVA_SEA + 8)
          column.set(x, y, z, BLOCK.MAGMA);
      }
    }
  if (fortress) buildFortress(column, cx, cz, seed, generatorVersion);
  column.status = 'ready';
  return { column, fortress };
}
/** Fortress cells: one cell in `FORTRESS_CELL` holds a bridge. */
export function inFortress(x: number, z: number, seed: number): boolean {
  const gx = Math.floor(x / FORTRESS_CELL),
    gz = Math.floor(z / FORTRESS_CELL);
  return hash2(gx, gz, seed + 4127) < 0.34;
}
/**
 * A fortress bridge: a walkway of nether brick with a parapet of nether brick fence, standing on
 * pillars that reach down into the lava. Two bridges cross in every cell, so the fortress is a
 * grid instead of a single corridor.
 */
function buildFortress(
  column: ChunkColumn,
  cx: number,
  cz: number,
  seed: number,
  generatorVersion: number,
): void {
  const ox = cx * 16,
    oz = cz * 16;
  for (let x = 0; x < 16; x++)
    for (let z = 0; z < 16; z++) {
      const wx = ox + x,
        wz = oz + z;
      const gx = Math.floor(wx / FORTRESS_CELL),
        gz = Math.floor(wz / FORTRESS_CELL);
      // Every cell has a bridge along x at one z and along z at one x; the two meet in a junction.
      const bridgeZ = gz * FORTRESS_CELL + 30 + Math.floor(hash2(gx, gz, seed + 4159) * 60);
      const bridgeX = gx * FORTRESS_CELL + 30 + Math.floor(hash2(gx, gz, seed + 4211) * 60);
      const onX = Math.abs(wz - bridgeZ) <= 2;
      const onZ = Math.abs(wx - bridgeX) <= 2;
      if (!onX && !onZ) continue;
      const base = 44 + Math.floor(hash2(gx, gz, seed + 4231) * 8);
      const deck = base;
      for (let y = 0; y < deck; y++)
        if (column.get(x, y, z) === BLOCK.AIR) column.set(x, y, z, BLOCK.NETHER_BRICK);
      for (let y = deck; y <= deck + (generatorVersion >= 4 ? 3 : 1); y++)
        column.set(x, y, z, BLOCK.AIR);
      const edge = (onX && Math.abs(wz - bridgeZ) === 2) || (onZ && Math.abs(wx - bridgeX) === 2);
      column.set(x, deck, z, edge ? BLOCK.NETHER_BRICK : BLOCK.NETHER_BRICK);
      if (edge) column.set(x, deck + 1, z, BLOCK.NETHER_BRICK);
    }
}
/** Floor height of the Nether at a column, used to place arrivals without falling into lava. */
export function netherFloorAt(x: number, z: number, seedText: string): number {
  const seed = seedHash(seedText);
  for (let y = NETHER_LAVA_SEA + 2; y < NETHER_CEILING; y++) {
    if (rockAt(x, y, z, seed) && !rockAt(x, y + 1, z, seed) && !rockAt(x, y + 2, z, seed)) return y;
  }
  return NETHER_LAVA_SEA + 6;
}
