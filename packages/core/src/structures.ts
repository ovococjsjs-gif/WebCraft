/**
 * Overworld structures: dungeons, abandoned mineshafts, villages and desert pyramids.
 *
 * Every structure is planned on a grid of its own, and the plan is a pure function of the cell
 * coordinates and the seed. A column therefore only has to ask which plans can reach it and paint
 * its own share: the same house is built by all the columns it covers, each one independently,
 * which is what keeps a structure identical no matter which column is generated first.
 */
import { BLOCK } from '../../content/src/blocks';
import { hash2, hash3 } from './random';
import { END_FRAME_COUNT, END_FRAME_RING } from './portals';
import { profileAt, SEA_LEVEL, type BiomePreset } from './overworld';

export type StructureKind = 'dungeon' | 'mineshaft' | 'village' | 'pyramid' | 'stronghold';

export interface DungeonPlan {
  readonly kind: 'dungeon';
  readonly x: number;
  readonly z: number;
  readonly y: number;
  /** Chest corner of the room, so the contents differ between dungeons. */
  readonly loot: number;
}
export interface MineshaftPlan {
  readonly kind: 'mineshaft';
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly length: number;
  readonly axis: 0 | 1;
  /** Two side corridors leave the main one at these distances. */
  readonly branches: readonly number[];
}
export interface House {
  readonly dx: number;
  readonly dz: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
}
export interface VillagePlan {
  readonly kind: 'village';
  readonly x: number;
  readonly z: number;
  /** Desert villages are built of sandstone, the others of planks and cobblestone. */
  readonly sandstone: boolean;
  readonly houses: readonly House[];
}
export interface PyramidPlan {
  readonly kind: 'pyramid';
  readonly x: number;
  readonly z: number;
}
export interface StrongholdPlan {
  readonly kind: 'stronghold';
  readonly x: number;
  readonly z: number;
  readonly y: number;
  /** Which of the twelve frames already carry an eye when the world is generated. */
  readonly eyes: readonly number[];
}
export type StructurePlan =
  DungeonPlan | MineshaftPlan | VillagePlan | PyramidPlan | StrongholdPlan;

/** Cell size per kind; a cell holds at most one structure of that kind. */
const CELL: Record<StructureKind, number> = {
  dungeon: 16,
  mineshaft: 96,
  village: 64,
  pyramid: 80,
  stronghold: 512,
};
/** Chance that a cell holds its structure. */
const CELL_CHANCE: Record<StructureKind, number> = {
  dungeon: 0.14,
  mineshaft: 0.3,
  village: 0.4,
  pyramid: 0.34,
  // One stronghold every few hundred blocks: rare, but a player can always find one.
  stronghold: 0.75,
};
/** Biomes a village may stand in, and the ones a pyramid needs. */
const VILLAGE_BIOMES = new Set(['plains', 'forest', 'taiga', 'snow', 'savanna', 'swamp']);

function dungeonPlan(cx: number, cz: number, seed: number): DungeonPlan | undefined {
  if (hash2(cx, cz, seed + 6101) >= CELL_CHANCE.dungeon) return undefined;
  const x = cx * CELL.dungeon + 3 + Math.floor(hash2(cx, cz, seed + 6103) * 10);
  const z = cz * CELL.dungeon + 3 + Math.floor(hash2(cx, cz, seed + 6107) * 10);
  const y = 12 + Math.floor(hash2(cx, cz, seed + 6113) * 26);
  return { kind: 'dungeon', x, z, y, loot: Math.floor(hash2(cx, cz, seed + 6119) * 4) };
}
function mineshaftPlan(cx: number, cz: number, seed: number): MineshaftPlan | undefined {
  if (hash2(cx, cz, seed + 6203) >= CELL_CHANCE.mineshaft) return undefined;
  const cell = CELL.mineshaft;
  const x = cx * cell + 8 + Math.floor(hash2(cx, cz, seed + 6209) * (cell - 16));
  const z = cz * cell + 8 + Math.floor(hash2(cx, cz, seed + 6211) * (cell - 16));
  const length = 48 + Math.floor(hash2(cx, cz, seed + 6217) * 48);
  const axis: 0 | 1 = hash2(cx, cz, seed + 6221) < 0.5 ? 0 : 1;
  const y = 14 + Math.floor(hash2(cx, cz, seed + 6227) * 10);
  const branches = [Math.floor(length * 0.28), Math.floor(length * 0.62)] as readonly number[];
  return { kind: 'mineshaft', x, z, y, length, axis, branches };
}
function villagePlan(
  cx: number,
  cz: number,
  seed: number,
  preset: BiomePreset,
): VillagePlan | undefined {
  if (hash2(cx, cz, seed + 6301) >= CELL_CHANCE.village) return undefined;
  const cell = CELL.village;
  const x = cx * cell + 8 + Math.floor(hash2(cx, cz, seed + 6303) * (cell - 16));
  const z = cz * cell + 8 + Math.floor(hash2(cx, cz, seed + 6307) * (cell - 16));
  const profile = profileAt(x, z, seed, preset);
  if (profile.river || profile.height <= SEA_LEVEL + 2 || profile.height >= 80) return undefined;
  if (!VILLAGE_BIOMES.has(profile.biome)) return undefined;
  const sandstone = profile.biome === 'snow' || profile.biome === 'savanna';
  const houses: House[] = [];
  const count = 3 + Math.floor(hash2(cx, cz, seed + 6311) * 4);
  for (let i = 0; i < count; i++) {
    const angle = hash2(cx * 31 + i, cz * 17 + i * 7, seed + 6317) * Math.PI * 2;
    const radius = 6 + hash2(cx + i * 3, cz - i * 5, seed + 6323) * 10;
    houses.push({
      dx: Math.round(Math.cos(angle) * radius),
      dz: Math.round(Math.sin(angle) * radius),
      width: 5 + (i % 2) * 2,
      depth: 5 + ((i + 1) % 2) * 2,
      height: 3 + (i % 3 === 0 ? 1 : 0),
    });
  }
  return { kind: 'village', x, z, sandstone, houses };
}
function pyramidPlan(cx: number, cz: number, seed: number): PyramidPlan | undefined {
  if (hash2(cx, cz, seed + 6401) >= CELL_CHANCE.pyramid) return undefined;
  const cell = CELL.pyramid;
  const x = cx * cell + 12 + Math.floor(hash2(cx, cz, seed + 6403) * (cell - 24));
  const z = cz * cell + 12 + Math.floor(hash2(cx, cz, seed + 6407) * (cell - 24));
  return { kind: 'pyramid', x, z };
}
/** How far a structure of each kind reaches out of its own cell. */
const KIND_REACH: Record<StructureKind, number> = {
  dungeon: 4,
  mineshaft: 20,
  village: 26,
  pyramid: 11,
  stronghold: 6,
};
const KINDS: readonly StructureKind[] = [
  'dungeon',
  'mineshaft',
  'village',
  'pyramid',
  'stronghold',
];
/**
 * A stronghold: one room of stone brick deep underground with the ring of twelve end portal
 * frames in its middle, two to four of them already fitted with an eye.
 */
function strongholdPlan(cx: number, cz: number, seed: number): StrongholdPlan | undefined {
  if (hash2(cx, cz, seed + 6601) >= CELL_CHANCE.stronghold) return undefined;
  const cell = CELL.stronghold;
  const x = cx * cell + 40 + Math.floor(hash2(cx, cz, seed + 6607) * (cell - 80));
  const z = cz * cell + 40 + Math.floor(hash2(cx, cz, seed + 6619) * (cell - 80));
  const y = 26 + Math.floor(hash2(cx, cz, seed + 6637) * 10);
  const eyes: number[] = [];
  // Two to four frames arrive with an eye already in place, so the portal room is a reward.
  const count = 2 + Math.floor(hash2(cx, cz, seed + 6653) * 3);
  for (let i = 0; eyes.length < count && i < 24; i++) {
    const index = Math.floor(hash2(cx + i * 13, cz - i * 7, seed + 6661) * END_FRAME_COUNT);
    if (!eyes.includes(index)) eyes.push(index);
  }
  return { kind: 'stronghold', x, z, y, eyes };
}
/**
 * Every structure whose body can reach the column box. The village and the pyramid need the
 * surface height, which comes from the same profile the terrain uses, so they always stand on
 * the ground the generator actually built.
 */
export function structuresNear(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  seed: number,
  preset: BiomePreset,
): StructurePlan[] {
  const found: StructurePlan[] = [];
  for (const kind of KINDS) {
    const cell = CELL[kind],
      reach = KIND_REACH[kind];
    for (let gx = Math.floor((x0 - reach) / cell); gx <= Math.floor((x1 + reach) / cell); gx++)
      for (let gz = Math.floor((z0 - reach) / cell); gz <= Math.floor((z1 + reach) / cell); gz++) {
        const plan =
          kind === 'dungeon'
            ? dungeonPlan(gx, gz, seed)
            : kind === 'mineshaft'
              ? mineshaftPlan(gx, gz, seed)
              : kind === 'village'
                ? villagePlan(gx, gz, seed, preset)
                : kind === 'stronghold'
                  ? strongholdPlan(gx, gz, seed)
                  : pyramidPlan(gx, gz, seed);
        if (plan) found.push(plan);
      }
  }
  return found;
}
/** The block a plan puts at one position, or -1 when it writes nothing there. */
export type BlockAt = (y: number) => number;
export const NOTHING = -1;

/** A room of cobblestone with air inside, a chest in a corner and its walls partly mossy. */
function dungeonAt(plan: DungeonPlan, x: number, z: number, seed: number): BlockAt | undefined {
  const dx = x - plan.x,
    dz = z - plan.z;
  if (Math.abs(dx) > 3 || Math.abs(dz) > 3) return undefined;
  const edge = Math.abs(dx) === 3 || Math.abs(dz) === 3;
  const moss = hash3(x, 0, z, seed + 6501) < 0.4;
  const chest = dx === -2 && dz === -2;
  return (y: number) => {
    if (y < plan.y || y > plan.y + 3) return NOTHING;
    if (y === plan.y + 3)
      return edge ? (moss ? BLOCK.MOSSY_COBBLESTONE : BLOCK.COBBLE) : BLOCK.COBBLE;
    if (!edge) {
      if (y === plan.y) {
        // The chest takes its corner, the spawner the other three.
        if (chest) return BLOCK.CHEST;
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) return BLOCK.SPAWNER;
      }
      return BLOCK.AIR;
    }
    if (y === plan.y - 1) return BLOCK.COBBLE;
    return moss ? BLOCK.MOSSY_COBBLESTONE : BLOCK.COBBLE;
  };
}
/** The main corridor of a mineshaft with its beams, rails, floor and two side branches. */
function mineshaftAt(plan: MineshaftPlan, x: number, z: number): BlockAt | undefined {
  const along = plan.axis === 0 ? x - plan.x : z - plan.z;
  const across = plan.axis === 0 ? z - plan.z : x - plan.x;
  const inMain = along >= -2 && along <= plan.length && Math.abs(across) <= 1;
  let branch = -1;
  if (!inMain)
    for (const [index, at] of plan.branches.entries()) {
      if (plan.axis === 0) {
        if (x - plan.x === at && z - plan.z >= -18 && z - plan.z <= -2) branch = index;
        if (x - plan.x === at && z - plan.z >= 2 && z - plan.z <= 18) branch = index;
      } else {
        if (z - plan.z === at && x - plan.x >= -18 && x - plan.x <= -2) branch = index;
        if (z - plan.z === at && x - plan.x >= 2 && x - plan.x <= 18) branch = index;
      }
    }
  if (!inMain && branch < 0) return undefined;
  const beam = inMain && (along % 6 === 0 || along % 6 === 1);
  return (y: number) => {
    if (y < plan.y || y > plan.y + 2) return NOTHING;
    if (y === plan.y) return beam && Math.abs(across) <= 1 ? BLOCK.PLANKS : BLOCK.RAIL;
    if (y === plan.y + 2) return BLOCK.PLANKS;
    // The sides are propped up with logs, the middle of the corridor stays open.
    return across === 0 ? BLOCK.AIR : BLOCK.LOG;
  };
}
/** One house: a floor, walls with a doorway and a flat roof, filled in down to the ground. */
function houseAt(
  plan: VillagePlan,
  house: House,
  x: number,
  z: number,
  height: number,
): BlockAt | undefined {
  const dx = x - (plan.x + house.dx),
    dz = z - (plan.z + house.dz);
  const hw = (house.width - 1) / 2,
    hd = (house.depth - 1) / 2;
  if (Math.abs(dx) > hw || Math.abs(dz) > hd) return undefined;
  const wall = plan.sandstone ? BLOCK.SANDSTONE : BLOCK.PLANKS;
  const floor = plan.sandstone ? BLOCK.SANDSTONE : BLOCK.COBBLE;
  const edge = Math.abs(dx) === hw || Math.abs(dz) === hd;
  const door = dx === 0 && dz === -hd;
  const top = height + house.height;
  return (y: number) => {
    if (y > top) return NOTHING;
    if (y < height) return y >= height - 3 ? floor : NOTHING;
    if (y === height) return floor;
    if (y === top) return edge ? wall : floor;
    if (edge) return door && y < height + 2 ? BLOCK.AIR : wall;
    return y === height + house.height - 1 && Math.abs(dx) === 1 && Math.abs(dz) === 1
      ? BLOCK.GLASS
      : BLOCK.AIR;
  };
}
/** A stepped sandstone pyramid with a burial chamber and two chests inside. */
function pyramidAt(plan: PyramidPlan, x: number, z: number, height: number): BlockAt | undefined {
  const dx = Math.abs(x - plan.x),
    dz = Math.abs(z - plan.z);
  if (dx > 10 || dz > 10) return undefined;
  const level = height + (10 - Math.max(dx, dz));
  const chamber = dx <= 2 && dz <= 2;
  const chest = dx === 2 && dz === 2;
  return (y: number) => {
    if (y > level) return NOTHING;
    if (chamber && y >= height + 1 && y <= height + 3)
      return chest && y === height + 1 ? BLOCK.CHEST : BLOCK.AIR;
    if (y < height - 4) return NOTHING;
    return BLOCK.SANDSTONE;
  };
}
/**
 * What one plan writes in one column. The caller hands over the surface height so the structures,
 * not the generator, decide how they meet the ground.
 */
/**
 * The portal room of a stronghold: a nine-by-nine hall of stone bricks with the ring of twelve
 * frames in its middle, a corridor leaving to the east and a torch in each corner. The room is
 * carved at the depth the plan chose, so a player who digs down finds it hollow and lit.
 */
function strongholdAt(plan: StrongholdPlan, x: number, z: number): BlockAt | undefined {
  const dx = x - plan.x,
    dz = z - plan.z;
  const room = Math.abs(dx) <= 4 && Math.abs(dz) <= 4;
  const corridor = dx >= 5 && dx <= 17 && Math.abs(dz) <= 1;
  const corridorWall = dx >= 5 && dx <= 17 && Math.abs(dz) === 2;
  if (!room && !corridor && !corridorWall) return undefined;
  const wall = room && (Math.abs(dx) === 4 || Math.abs(dz) === 4);
  const inner = room && Math.abs(dx) <= 1 && Math.abs(dz) <= 1;
  const ringIndex = END_FRAME_RING.findIndex(([rx, rz]) => rx === dx && rz === dz);
  const eye = ringIndex >= 0 && plan.eyes.includes(ringIndex);
  // The altar chest stands in a corner of the hall, the torches light the other three.
  const chest = room && dx === 3 && dz === 3;
  const torch = room && Math.abs(dx) === 3 && Math.abs(dz) === 3;
  return (y: number) => {
    if (y < plan.y || y > plan.y + 4) return NOTHING;
    if (y === plan.y) {
      if (ringIndex >= 0) return eye ? BLOCK.END_PORTAL_FRAME_EYE : BLOCK.END_PORTAL_FRAME;
      // The portal opens in this three-by-three square once the last eye is fitted.
      if (inner) return BLOCK.AIR;
      if (chest) return BLOCK.CHEST;
      return BLOCK.STONE_BRICKS;
    }
    if (y === plan.y + 4) return BLOCK.STONE_BRICKS;
    if (y === plan.y + 3 && torch) return BLOCK.TORCH;
    if (corridor) return BLOCK.AIR;
    if (corridorWall) return BLOCK.STONE_BRICKS;
    return wall ? BLOCK.STONE_BRICKS : BLOCK.AIR;
  };
}
export function structureColumn(
  plan: StructurePlan,
  x: number,
  z: number,
  seed: number,
  preset: BiomePreset,
): BlockAt | undefined {
  switch (plan.kind) {
    case 'dungeon':
      return dungeonAt(plan, x, z, seed);
    case 'mineshaft':
      return mineshaftAt(plan, x, z);
    case 'village': {
      for (const house of plan.houses) {
        const at = houseAt(
          plan,
          house,
          x,
          z,
          profileAt(plan.x + house.dx, plan.z + house.dz, seed, preset).height,
        );
        if (at) return at;
      }
      // A gravel path runs through the village, laid on the ground the terrain built.
      const dx = x - plan.x,
        dz = z - plan.z;
      if (dx * dx + dz * dz > 15 * 15) return undefined;
      if (hash2(Math.floor(x / 2), Math.floor(z / 2), seed + 6329) >= 0.25) return undefined;
      const ground = profileAt(x, z, seed, preset).height;
      if (ground <= SEA_LEVEL + 1) return undefined;
      return (y: number) => (y === ground ? BLOCK.GRAVEL : NOTHING);
    }
    case 'stronghold': {
      return strongholdAt(plan, x, z);
    }
    case 'pyramid': {
      const height = profileAt(plan.x, plan.z, seed, preset).height;
      return height <= SEA_LEVEL + 1 || height >= 80 ? undefined : pyramidAt(plan, x, z, height);
    }
  }
}
