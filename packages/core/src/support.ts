/**
 * What a block needs to stay where it is, as in the reference: flowers and grass stand on soil,
 * sugar cane on soil by the water or on more cane, a cactus on sand with nothing solid beside
 * it, crops on farmland, rails, wire and torches on something solid. When a neighbour changes,
 * a block that lost its support pops off and drops as an item, so breaking the lowest cane
 * brings the whole stalk down.
 */
import { BLOCK, BLOCK_X, registry } from '../../content/src/blocks';

export type SupportRule =
  | 'soil'
  | 'desert'
  | 'cane'
  | 'cactus'
  | 'crop'
  | 'mushroom'
  | 'lily'
  | 'floor'
  | 'attached'
  /** Ladders: the wall behind them. */
  | 'wall'
  | 'door_upper';

type GetBlock = (x: number, y: number, z: number) => number;

let rules: (SupportRule | null)[] | null = null;
function ruleTable(): (SupportRule | null)[] {
  if (rules) return rules;
  rules = [];
  for (const def of registry.list()) {
    const key = def.key.replace(/^lab:/, '');
    let rule: SupportRule | null = null;
    if (def.cropStage !== undefined || /_crop_\d+$|_stem_\d+$/.test(key)) rule = 'crop';
    else if (key === 'sugar_cane') rule = 'cane';
    else if (key === 'cactus') rule = 'cactus';
    else if (key === 'dead_bush') rule = 'desert';
    else if (key === 'brown_mushroom' || key === 'red_mushroom') rule = 'mushroom';
    else if (key === 'lily_pad') rule = 'lily';
    else if (
      /^(dandelion|daisy|poppy|blue_orchid|allium|red_tulip|orange_tulip|white_tulip|pink_tulip|oxeye_daisy|azure_bluet|tall_grass|fern|double_\w+|\w+_sapling)$/.test(
        key,
      )
    )
      rule = 'soil';
    else if (
      /^(torch|redstone_torch_(on|off)|lever_(on|off)|button_(on|off)|wall_sign_\w+)$/.test(key)
    )
      rule = 'attached';
    else if (
      /^(redstone_wire_\d+|repeater_(on|off)|comparator_(on|off)|rail|powered_rail_(on|off)|detector_rail_(on|off)|plate_(on|off)|snow_layer|\w+_carpet|carpet|sign_\w+|flower_pot|cake\w*)$/.test(
        key,
      )
    )
      rule = 'floor';
    else if (def.climbable) rule = 'wall';
    else if (def.model?.kind === 'door') rule = def.model.upper ? 'door_upper' : 'floor';
    rules[def.id] = rule;
  }
  return rules;
}

export function supportRule(state: number): SupportRule | null {
  return ruleTable()[state] ?? null;
}

const SOIL = new Set<number>([
  BLOCK.GRASS,
  BLOCK.DIRT,
  BLOCK.FARMLAND,
  BLOCK.FARMLAND_WET,
  BLOCK_X.PODZOL,
  BLOCK_X.COARSE_DIRT,
  BLOCK_X.GRASS_SNOWY,
]);
const CANE_GROUND = new Set<number>([
  BLOCK.GRASS,
  BLOCK.DIRT,
  BLOCK.SAND,
  BLOCK_X.RED_SAND,
  BLOCK_X.PODZOL,
  BLOCK_X.COARSE_DIRT,
  BLOCK_X.GRASS_SNOWY,
]);
const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const solid = (state: number) => registry.get(state).solid === true;
const isWater = (state: number) => registry.get(state).fluid === 'water' || state === BLOCK.ICE;
function isDesertGround(state: number): boolean {
  if (state === BLOCK.SAND || state === BLOCK_X.RED_SAND || state === BLOCK.DIRT) return true;
  if (state === BLOCK_X.PODZOL || state === BLOCK_X.COARSE_DIRT) return true;
  return registry.get(state).key.includes('terracotta');
}

/** True when the block `state` at (x, y, z) has what it needs to stay. */
export function isSupported(
  get: GetBlock,
  x: number,
  y: number,
  z: number,
  state: number,
): boolean {
  const rule = supportRule(state);
  if (!rule) return true;
  const below = get(x, y - 1, z);
  switch (rule) {
    case 'soil':
      return SOIL.has(below);
    case 'desert':
      return isDesertGround(below);
    case 'crop':
      return below === BLOCK.FARMLAND || below === BLOCK.FARMLAND_WET;
    case 'mushroom':
      return solid(below);
    case 'lily':
      return below === BLOCK.WATER || below === BLOCK.ICE;
    case 'floor':
      return solid(below);
    case 'door_upper':
      return registry.get(below).model?.kind === 'door';
    case 'attached':
      // Floor or wall: anything solid under it or beside it holds it.
      if (solid(below)) return true;
      for (const [dx, dz] of SIDES) if (solid(get(x + dx, y, z + dz))) return true;
      return false;
    case 'wall': {
      // The key names the side of the wall: `ladder` is north, `ladder_east` and so on.
      const side = /_(east|south|west)$/.exec(registry.get(state).key)?.[1] ?? 'north';
      const [dx, dz] =
        side === 'east' ? [1, 0] : side === 'west' ? [-1, 0] : side === 'south' ? [0, 1] : [0, -1];
      return solid(get(x + dx, y, z + dz));
    }
    case 'cane':
      if (below === BLOCK.SUGAR_CANE) return true;
      if (!CANE_GROUND.has(below)) return false;
      // Water beside the ground or beside the cane itself, as the growth rule counts it.
      for (const [dx, dz] of SIDES)
        if (isWater(get(x + dx, y - 1, z + dz)) || isWater(get(x + dx, y, z + dz))) return true;
      return false;
    case 'cactus':
      if (below !== BLOCK.CACTUS && below !== BLOCK.SAND && below !== BLOCK_X.RED_SAND)
        return false;
      for (const [dx, dz] of SIDES) if (solid(get(x + dx, y, z + dz))) return false;
      return true;
  }
}

/** Why a block cannot be placed here, for the message under the crosshair. */
export function supportReason(state: number): string {
  switch (supportRule(state)) {
    case 'soil':
      return 'Сажают на дёрн или землю';
    case 'desert':
      return 'Растёт на песке или терракоте';
    case 'cane':
      return 'Тростник растёт у воды: на дёрне, земле или песке';
    case 'cactus':
      return 'Кактус растёт на песке, и рядом не должно быть блоков';
    case 'crop':
      return 'Сажают на вспаханную грядку';
    case 'lily':
      return 'Кувшинку кладут на воду';
    case 'wall':
      return 'Лестницу вешают на стену';
    default:
      return 'Нужна опора';
  }
}

/** Cells whose support may depend on (x, y, z): above it and its four sides. */
export const DEPENDENTS = [
  [0, 1, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;
