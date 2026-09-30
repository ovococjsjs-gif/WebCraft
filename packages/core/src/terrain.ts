import { generateColumnV5, spawnPointV5 } from './worldgen/generator-v5';
import { BLOCK } from '../../content/src/blocks';
import { ChunkColumn } from './world';
import { hash2, hash3, seedHash } from './random';
import { NOTHING, structureColumn, structuresNear } from './structures';
import { biomeById, type BiomeId } from './biomes';
import {
  BIOME_PRESETS,
  isBiomePreset,
  inVein,
  isCave,
  profileAt,
  treeRootsNear,
  veinsNear,
  LAVA_LEVEL,
  SEA_LEVEL,
  type BiomePreset,
} from './overworld';
/** The two hand-built scenic fixtures the first stages shipped, kept for the regression suites. */
export const SCENIC_PRESETS = ['valley', 'flat'] as const;
export function isScenicPreset(preset: string): preset is 'valley' | 'flat' {
  return (SCENIC_PRESETS as readonly string[]).includes(preset);
}
export type WorldPreset = BiomePreset | (typeof SCENIC_PRESETS)[number];
/** Every world type the game can generate, biome worlds first: they are the real game. */
export const WORLD_PRESETS: readonly WorldPreset[] = Object.freeze([
  ...BIOME_PRESETS,
  ...SCENIC_PRESETS,
]);
export function isWorldPreset(value: unknown): value is WorldPreset {
  return typeof value === 'string' && (WORLD_PRESETS as readonly string[]).includes(value);
}
/** Names for the world list and the new-world menu; the game's own words, not the codes. */
export const PRESET_LABELS: Record<WorldPreset, string> = Object.freeze({
  overworld: 'Обычный мир',
  'large-biomes': 'Крупные биомы',
  amplified: 'Усиленный рельеф',
  valley: 'Долина истоков',
  flat: 'Плоская лаборатория',
});
export const DEFAULT_PRESET: WorldPreset = 'overworld';
export const WATER_LEVEL = 19;
/** The biome worlds fill this column height in a column; kept in one place for the tests. */
export const COLUMN_HEIGHT = 256;
/** The band structures write in: below the deepest floor and above the tallest pyramid. */
const STRUCTURE_MIN_Y = 4;
const STRUCTURE_MAX_Y = 132;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
function noise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x),
    iz = Math.floor(z),
    fx = smooth(x - ix),
    fz = smooth(z - iz);
  return (
    lerp(
      lerp(hash2(ix, iz, seed), hash2(ix + 1, iz, seed), fx),
      lerp(hash2(ix, iz + 1, seed), hash2(ix + 1, iz + 1, seed), fx),
      fz,
    ) *
      2 -
    1
  );
}
export function riverCenter(z: number): number {
  return Math.sin(z * 0.035) * 12 + Math.cos(z * 0.013) * 14 - 10;
}
/** Original scenic fixture, not Minecraft's generator. Stable across generation order. */
export function surfaceHeight(x: number, z: number, seed: number, preset: WorldPreset): number {
  if (preset === 'flat') return 8;
  const distance = Math.abs(x - riverCenter(z));
  let base =
    27 +
    noise(x / 55, z / 55, seed) * 10 +
    noise(x / 21, z / 21, seed + 7) * 4 +
    noise(x / 8, z / 8, seed + 29) * 1.3;
  if (distance < 6) base = 13 + distance * 0.42;
  else if (distance < 11) base = 16 + (distance - 6) * 1.05;
  else if (distance < 20) base = lerp(21.25, base, smooth((distance - 11) / 9));
  return Math.max(5, Math.floor(base));
}
export function generateColumn(
  cx: number,
  cz: number,
  seedText: string,
  preset: WorldPreset,
  generatorVersion = 4,
): ChunkColumn {
  if (isBiomePreset(preset))
    return generatorVersion >= 5
      ? generateColumnV5(cx, cz, seedText, preset)
      : generateBiomeColumn(cx, cz, seedText, preset, generatorVersion);
  const column = new ChunkColumn(cx, cz);
  column.status = 'generating';
  const seed = seedHash(seedText),
    ox = cx * 16,
    oz = cz * 16;
  const put = (x: number, y: number, z: number, id: number) => {
    if (x >= ox && x < ox + 16 && z >= oz && z < oz + 16 && y >= 0 && y < 256)
      column.set(x - ox, y, z - oz, id);
  };
  for (let x = 0; x < 16; x++)
    for (let z = 0; z < 16; z++) {
      const wx = ox + x,
        wz = oz + z,
        h = surfaceHeight(wx, wz, seed, preset);
      for (let y = 0; y <= h; y++) {
        let state: number =
          y === 0 ? BLOCK.BEDROCK : y < h - 3 ? BLOCK.STONE : y < h ? BLOCK.DIRT : BLOCK.GRASS;
        if (preset === 'valley' && h <= WATER_LEVEL + 1 && y >= h - 3) state = BLOCK.SAND;
        column.set(x, y, z, state);
      }
      if (preset === 'valley') {
        for (let y = h + 1; y <= WATER_LEVEL; y++) column.set(x, y, z, BLOCK.WATER);
        if (h > WATER_LEVEL + 2 && !(Math.abs(wx - 29) < 3 && Math.abs(wz - 11) < 3)) {
          const r = hash2(wx, wz, seed + 557);
          if (r < 0.014) column.set(x, h + 1, z, BLOCK.FLOWER);
          else if (r < 0.025) column.set(x, h + 1, z, BLOCK.DAISY);
          else if (r < 0.115) column.set(x, h + 1, z, BLOCK.TALL_GRASS);
        }
      }
    }
  if (preset === 'valley') {
    // Evaluate roots beyond the column boundary, so leaf placement is order-independent.
    for (let gx = Math.floor((ox - 4) / 7); gx <= Math.floor((ox + 19) / 7); gx++)
      for (let gz = Math.floor((oz - 4) / 7); gz <= Math.floor((oz + 19) / 7); gz++) {
        if (hash2(gx, gz, seed + 137) > 0.59) continue;
        const x = gx * 7 + 1 + Math.floor(hash2(gx, gz, seed + 331) * 5),
          z = gz * 7 + 1 + Math.floor(hash2(gx, gz, seed + 729) * 5);
        if (Math.abs(x - 29) < 7 && Math.abs(z - 11) < 7) continue;
        const h = surfaceHeight(x, z, seed, preset);
        if (h <= WATER_LEVEL + 2 || Math.abs(x - riverCenter(z)) < 15) continue;
        const birch = hash2(gx, gz, seed + 669) < 0.2;
        const height = birch ? 6 : 4 + Math.floor(hash2(gx, gz, seed + 83) * 2);
        for (let dy = height - 2; dy <= height + 1; dy++) {
          const radius = dy === height + 1 ? 1 : 2;
          for (let dx = -radius; dx <= radius; dx++)
            for (let dz = -radius; dz <= radius; dz++) {
              if (
                Math.abs(dx) === radius &&
                Math.abs(dz) === radius &&
                (dy === height + 1 || hash2(x + dx, z + dz, seed + dy) > 0.55)
              )
                continue;
              put(x + dx, h + dy, z + dz, BLOCK.LEAVES);
            }
        }
        for (let dy = 1; dy <= height; dy++) put(x, h + dy, z, birch ? BLOCK.BIRCH : BLOCK.LOG);
      }
    // A small, static test bridge. It is a fixture, not a generated vanilla structure.
    const center = Math.round(riverCenter(9)),
      left = center - 13,
      right = center + 13;
    for (let x = left; x <= right; x++)
      for (let z = 8; z <= 10; z++) {
        put(x, 22, z, BLOCK.PLANKS);
        for (let y = 23; y <= 25; y++) put(x, y, z, BLOCK.AIR);
      }
    for (let x = left; x <= right; x += 6)
      for (const z of [7, 11]) for (let y = 16; y <= 23; y++) put(x, y, z, BLOCK.LOG);
  }
  column.status = 'ready';
  return column;
}
export function spawnPoint(
  seedText: string,
  preset: WorldPreset,
  generatorVersion = 4,
): { x: number; y: number; z: number } {
  if (isBiomePreset(preset))
    return generatorVersion >= 5
      ? spawnPointV5(seedText, preset)
      : biomeSpawnPoint(seedText, preset);
  const x = preset === 'flat' ? 4.5 : 29.5,
    z = preset === 'flat' ? 8.5 : 11.5;
  return {
    x,
    y: surfaceHeight(Math.floor(x), Math.floor(z), seedHash(seedText), preset) + 1.01,
    z,
  };
}
/**
 * The player starts on dry land: the closest column to the origin that stands above the water
 * line, in a land biome and not in a river bed. Flat ground is preferred over a mountain slope,
 * and a world that is ocean all the way out still starts on the highest ground it can find.
 */
export function biomeSpawnPoint(
  seedText: string,
  preset: BiomePreset,
): { x: number; y: number; z: number } {
  const seed = seedHash(seedText);
  const stand = (x: number, z: number, height: number) => ({
    x: x + 0.5,
    y: height + 1.01,
    z: z + 0.5,
  });
  const land = (x: number, z: number) => {
    const profile = profileAt(x, z, seed, preset);
    if (profile.river || profile.height <= SEA_LEVEL + 1 || profile.height >= 88) return undefined;
    const biome = biomeById(profile.biome);
    return biome.id === 'ocean' || biome.id === 'beach' ? undefined : profile;
  };
  for (let radius = 0; radius <= 96; radius++) {
    let best: { x: number; z: number; height: number; score: number } | undefined;
    for (let dx = -radius; dx <= radius; dx++)
      for (let dz = -radius; dz <= radius; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const x = 8 + dx,
          z = 8 + dz;
        const profile = land(x, z);
        if (!profile) continue;
        const score = Math.abs(profile.height - (SEA_LEVEL + 6));
        if (!best || score < best.score) best = { x, z, height: profile.height, score };
      }
    if (best) return stand(best.x, best.z, best.height);
  }
  // Ocean for a hundred blocks and more: take the highest ground anywhere within reach.
  const pick = { x: 8, z: 8, height: profileAt(8, 8, seed, preset).height };
  const consider = (x: number, z: number) => {
    const height = profileAt(x, z, seed, preset).height;
    if (height > pick.height || (height > SEA_LEVEL + 1 && pick.height <= SEA_LEVEL + 1)) {
      pick.x = x;
      pick.z = z;
      pick.height = height;
    }
  };
  for (let radius = 8; radius <= 512; radius += 8) {
    for (let step = -radius; step <= radius; step += 8) {
      consider(8 + step, 8 - radius);
      consider(8 + step, 8 + radius);
      if (step > -radius && step < radius) {
        consider(8 - radius, 8 + step);
        consider(8 + radius, 8 + step);
      }
    }
    if (pick.height > SEA_LEVEL + 1 && radius >= 128) break;
  }
  return stand(pick.x, pick.z, pick.height);
}
/**
 * One column of a biome world. The order of the passes matters and is the same for every column:
 * rock and soil first, then the caves that cut through them, then the water that can now reach
 * an open cave mouth, then the ore veins, and finally the plants that need a surface to stand on.
 */
export function generateBiomeColumn(
  cx: number,
  cz: number,
  seedText: string,
  preset: BiomePreset,
  generatorVersion = 4,
): ChunkColumn {
  const column = new ChunkColumn(cx, cz);
  column.status = 'generating';
  const seed = seedHash(seedText),
    ox = cx * 16,
    oz = cz * 16;
  const local = (x: number, y: number, z: number, state: number) => {
    if (x >= ox && x < ox + 16 && z >= oz && z < oz + 16 && y >= 0 && y < COLUMN_HEIGHT)
      column.set(x - ox, y, z - oz, state);
  };
  const heights: number[] = new Array(256).fill(0);
  const biomes: string[] = new Array(256).fill('plains');
  /* ---------------------------------------------------------------- rock and soil */
  for (let x = 0; x < 16; x++)
    for (let z = 0; z < 16; z++) {
      const wx = ox + x,
        wz = oz + z;
      const profile = profileAt(wx, wz, seed, preset);
      const biome = biomeById(profile.biome);
      heights[z * 16 + x] = profile.height;
      biomes[z * 16 + x] = biome.id;
      for (let y = 0; y <= profile.height; y++) {
        let state: number;
        if (y === 0) state = BLOCK.BEDROCK;
        else if (y <= 3 && hash3(wx, y, wz, seed + 59) < (4 - y) * 0.3) state = BLOCK.BEDROCK;
        else if (y === profile.height) state = biome.surface;
        else if (y > profile.height - 4) state = biome.filler;
        else state = BLOCK.STONE;
        local(wx, profile.height === 0 ? y : y, wz, state);
      }
    }
  /* -------------------------------------------------------------------- caves */
  for (let x = 0; x < 16; x++)
    for (let z = 0; z < 16; z++) {
      const wx = ox + x,
        wz = oz + z,
        top = heights[z * 16 + x];
      for (let y = 1; y < top; y++) {
        if (column.get(x, y, z) === BLOCK.BEDROCK) continue;
        if (!isCave(wx, y, wz, seed)) continue;
        column.set(x, y, z, y <= LAVA_LEVEL ? BLOCK.LAVA : BLOCK.AIR);
      }
    }
  /* ------------------------------------------------------------------- water */
  for (let x = 0; x < 16; x++)
    for (let z = 0; z < 16; z++) {
      const height = heights[z * 16 + x];
      if (height >= SEA_LEVEL) continue;
      const cold = biomeById(biomes[z * 16 + x] as BiomeId).cold;
      for (let y = height + 1; y <= SEA_LEVEL; y++) {
        if (column.get(x, y, z) === BLOCK.AIR)
          column.set(x, y, z, y === SEA_LEVEL && cold ? BLOCK.ICE : BLOCK.WATER);
      }
    }
  /* -------------------------------------------------------------------- veins */
  // Only the veins whose body can reach this column are asked, and each one is walked over its
  // own bounding box instead of the whole column: the difference is most of the generator's cost.
  let relief = 0;
  for (let i = 0; i < heights.length; i++) relief = Math.max(relief, heights[i]);
  for (const vein of veinsNear(ox, 1, oz, ox + 15, relief, oz + 15, seed)) {
    const x0 = Math.max(ox, Math.floor(vein.x - vein.radius)),
      x1 = Math.min(ox + 15, Math.ceil(vein.x + vein.radius)),
      z0 = Math.max(oz, Math.floor(vein.z - vein.radius)),
      z1 = Math.min(oz + 15, Math.ceil(vein.z + vein.radius)),
      y0 = Math.max(1, Math.floor(vein.y - vein.radius)),
      y1 = Math.ceil(vein.y + vein.radius);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        for (let z = z0; z <= z1; z++) {
          if (y >= heights[(z - oz) * 16 + (x - ox)]) continue;
          if (column.get(x - ox, y, z - oz) !== BLOCK.STONE) continue;
          if (!inVein(vein, x, y, z)) continue;
          local(x, y, z, vein.block);
        }
  }
  /* ------------------------------------------------------------- structures */
  for (const plan of structuresNear(ox, oz, ox + 15, oz + 15, seed, preset).filter(
    (plan) => generatorVersion >= 3 || plan.kind !== 'stronghold',
  ))
    for (let x = ox; x < ox + 16; x++)
      for (let z = oz; z < oz + 16; z++) {
        const at = structureColumn(plan, x, z, seed, preset);
        if (!at) continue;
        for (let y = STRUCTURE_MIN_Y; y <= STRUCTURE_MAX_Y; y++) {
          const state = at(y);
          if (state !== NOTHING) local(x, y, z, state);
        }
      }
  /* -------------------------------------------------------------- vegetation */
  for (let x = 0; x < 16; x++)
    for (let z = 0; z < 16; z++) {
      const wx = ox + x,
        wz = oz + z,
        height = heights[z * 16 + x],
        biome = biomeById(biomes[z * 16 + x] as BiomeId);
      if (height < SEA_LEVEL || column.get(x, height, z) !== biome.surface) continue;
      const above = height + 1;
      const roll = hash2(wx, wz, seed + 557);
      if (biome.cold) column.set(x, above, z, BLOCK.SNOW);
      else if (roll < biome.flowerChance) column.set(x, above, z, BLOCK.FLOWER);
      else if (roll < biome.flowerChance * 2) column.set(x, above, z, BLOCK.DAISY);
      else if (roll < biome.flowerChance * 2 + biome.grassChance)
        column.set(x, above, z, BLOCK.TALL_GRASS);
      else if (roll < biome.flowerChance * 2 + biome.grassChance + biome.cactusChance) {
        const tall = 2 + Math.floor(hash2(wx, wz, seed + 991) * 2);
        for (let dy = 0; dy < tall; dy++) column.set(x, above + dy, z, BLOCK.CACTUS);
      } else if (
        roll <
        biome.flowerChance * 2 + biome.grassChance + biome.cactusChance + biome.pumpkinChance
      )
        column.set(x, above, z, BLOCK.PUMPKIN);
      // Cane grows right at the water line, and only where water really is next to the column.
      if (
        height <= SEA_LEVEL + 1 &&
        hash2(wx, wz, seed + 1201) < 0.3 &&
        waterNearby(wx, wz, seed, preset)
      ) {
        const tall = 1 + Math.floor(hash2(wx, wz, seed + 1301) * 3);
        for (let dy = 0; dy < tall; dy++) column.set(x, height + 1 + dy, z, BLOCK.SUGAR_CANE);
      }
    }
  for (const plan of treeRootsNear(ox, oz, ox + 15, oz + 15, seed, preset)) {
    const height = profileAt(plan.x, plan.z, seed, preset).height;
    if (height < SEA_LEVEL + 1) continue;
    // A tree never takes root on a roof, a floor or a wall of a structure: the surface block at
    // the root has to be the one the biome itself lays down.
    const root = column.get(plan.x - ox, height, plan.z - oz);
    if (root !== biomeById(profileAt(plan.x, plan.z, seed, preset).biome).surface) continue;
    const trunk = plan.birch ? BLOCK.BIRCH : BLOCK.LOG;
    // Canopy: two wide layers that reach down past the trunk top, then two narrow ones above it.
    // A tall tree simply carries the same canopy higher; only the trunk grows.
    for (let dy = plan.trunkHeight - 2; dy <= plan.trunkHeight + 2; dy++) {
      const radius = dy >= plan.trunkHeight + 1 ? 1 : 2;
      for (let dx = -radius; dx <= radius; dx++)
        for (let dz = -radius; dz <= radius; dz++) {
          if (dx === 0 && dz === 0 && dy <= plan.trunkHeight) continue;
          const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
          if (corner && (dy > plan.trunkHeight || hash2(plan.x + dx, plan.z + dz, seed + dy) > 0.4))
            continue;
          local(plan.x + dx, height + dy, plan.z + dz, BLOCK.LEAVES);
        }
    }
    for (let dy = 1; dy <= plan.trunkHeight; dy++) local(plan.x, height + dy, plan.z, trunk);
  }
  column.status = 'ready';
  return column;
}
/** True when one of the four neighbours of a column lies below the water line. */
function waterNearby(x: number, z: number, seed: number, preset: BiomePreset): boolean {
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const)
    if (profileAt(x + dx, z + dz, seed, preset).height < SEA_LEVEL) return true;
  return false;
}
