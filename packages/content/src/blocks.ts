/** Original prototype registry. Runtime IDs are NOT legacy Minecraft IDs. */
import {
  collisionBoxes,
  renderBoxes,
  type BlockModel,
  type Box,
  type Facing,
  type Neighbours,
} from './shapes';
import { TILE, WOOL_COLORS } from './tiles';
export type RenderLayer = 'opaque' | 'cutout' | 'transparent';
export type ToolType = 'pickaxe' | 'axe' | 'shovel' | 'sword' | 'hoe';
/** Minimum tool tier able to harvest: 1 wood, 2 stone, 3 iron. */
export type ToolTier = 1 | 2 | 3 | 4;
export interface BlockDrop {
  readonly item: string;
  readonly count?: number;
  /** Independent rolls, in percent. */
  readonly chance?: number;
  /** `true`: only when cut with shears; `false`: only when broken any other way. */
  readonly shears?: boolean;
  /** When this roll succeeds it takes the place of that item: gravel gives flint instead. */
  readonly replaces?: string;
}
export interface BlockDefinition {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  readonly solid: boolean;
  readonly occludes: boolean;
  readonly layer: RenderLayer;
  readonly textures: readonly [number, number, number]; // top, side, bottom
  /** Mesh shape: a full cube, two crossed quads, or a thin plate on the floor. */
  readonly shape?: 'cross' | 'flat' | 'torch';
  readonly protected?: boolean;
  readonly placeable?: boolean;
  /** Seconds a bare hand needs in the reference behaviour; -1 is unbreakable. */
  readonly hardness: number;
  readonly tool?: ToolType;
  /** Harvest tier required to get drops at all. Absent means any tool works. */
  readonly tier?: ToolTier;
  readonly drops?: readonly BlockDrop[];
  /** Opens an interface when used. */
  readonly opens?:
    | 'crafting'
    | 'chest'
    | 'furnace'
    | 'bed'
    | 'enchanting'
    | 'brewing'
    | 'anvil'
    | 'dispenser'
    | 'dropper'
    | 'hopper';
  /** Damage per contact tick, for blocks such as lava. */
  readonly contactDamage?: number;
  /** Causes drowning while the head is inside it. */
  readonly liquid?: boolean;
  /** Experience orbs rolled when the block is broken: [min, max] as in the reference. */
  readonly xp?: readonly [number, number];
  /** Replacement block while a furnace burns. */
  readonly litVariant?: number;
  /** The other state of a two-state block: a lever, a lamp, a wire at full power. */
  readonly unlitVariant?: number;
  /** Fluid carried by this block: the level is 0 for a source and grows downstream. */
  readonly fluid?: 'water' | 'lava';
  readonly fluidLevel?: number;
  readonly fluidSource?: boolean;
  /** Falls when the block below disappears: sand, gravel and the like. */
  readonly falling?: boolean;
  /** Percent chance per fire tick that a flame catches on this block. */
  readonly flammable?: number;
  /** Ticks a block burns once it has caught fire. */
  readonly burnTicks?: number;
  /** Block light emitted, 0-15. */
  readonly light?: number;
  /** Role in the redstone network, read by `redstone.ts` instead of the numeric id. */
  readonly redstone?: RedstoneRole;
  /** Crops: the stage this block represents and the following stage. */
  readonly cropStage?: number;
  readonly cropNext?: number;
  readonly fuelTicks?: number;
  /** Geometry that is not a full cube. The same boxes drive drawing, collision and picking. */
  readonly model?: BlockModel;
  /**
   * The state an item places and a pick selects, for blocks with several oriented states: all
   * eight stairs of one material answer to the same item.
   */
  readonly base?: number;
  /** Connecting family of fences and panes: they join each other and full solid blocks. */
  readonly connects?: 'fence' | 'pane' | 'wall';
  /** Ground that grass, flowers and saplings accept, and that animals spawn on. */
  readonly soil?: boolean;
  /** How the item turns into a state when placed. */
  readonly placement?: 'stairs' | 'slab' | 'door' | 'axis' | 'ladder' | 'trapdoor' | 'gate';
  /** A sapling: the kind of tree it grows into. */
  readonly sapling?: WoodKind;
  /** A melon or pumpkin stem: once ripe it sets its fruit on a free neighbour. */
  readonly stem?: 'melon' | 'pumpkin';
  /** The other state of a block a hand opens and closes: trapdoors and fence gates. */
  readonly toggle?: number;
  /** Ladders: a body inside climbs instead of falling. */
  readonly climbable?: boolean;
  /** A cake: the state after one more slice is eaten, or 0 when this was the last slice. */
  readonly bite?: number;
  /** A slab placed on the same slab becomes this full block. */
  readonly doubleSlab?: number;
  /** The biome colour a face takes: grass and foliage change with the climate. */
  readonly tint?: 'grass' | 'foliage';
  /** Replaced by a placed block instead of blocking it: snow layers, grass, flowers. */
  readonly replaceable?: boolean;
}
export type WoodKind = 'oak' | 'spruce' | 'birch' | 'jungle' | 'acacia' | 'dark_oak';
export type RedstoneRole =
  | 'wire'
  | 'torch'
  | 'lever'
  | 'button'
  | 'plate'
  | 'repeater'
  | 'comparator'
  | 'lamp'
  | 'piston'
  | 'sticky_piston'
  | 'piston_head'
  | 'dispenser'
  | 'dropper'
  | 'tnt';
export const BLOCK = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  LOG: 5,
  LEAVES: 6,
  PLANKS: 7,
  COBBLE: 8,
  GLASS: 9,
  WATER: 10,
  BEDROCK: 11,
  FLOWER: 12,
  DAISY: 13,
  TALL_GRASS: 14,
  BIRCH: 15,
  COAL_ORE: 16,
  IRON_ORE: 17,
  CRAFTING_TABLE: 18,
  FURNACE: 19,
  FURNACE_LIT: 20,
  SMOOTH_STONE: 21,
  CHEST: 22,
  LAVA: 23,
  BED: 24,
  WATER_FLOW_1: 25,
  GRAVEL: 35,
  OBSIDIAN: 36,
  FIRE: 37,
  TNT: 38,
  TORCH: 39,
  FARMLAND: 40,
  FARMLAND_WET: 41,
  WHEAT_0: 42,
  WHEAT_1: 43,
  WHEAT_2: 44,
  WHEAT_3: 45,
  WHEAT_4: 46,
  WHEAT_5: 47,
  WHEAT_6: 48,
  WHEAT_7: 49,
  OAK_SAPLING: 50,
  SUGAR_CANE: 51,
  CACTUS: 52,
  PUMPKIN: 53,
  MELON: 54,
  ENCHANTING_TABLE: 55,
  BOOKSHELF: 56,
  BREWING_STAND: 57,
  ANVIL: 58,
  REDSTONE_ORE: 59,
  REDSTONE_WIRE_0: 60,
  REDSTONE_WIRE_15: 75,
  REDSTONE_TORCH_ON: 76,
  REDSTONE_TORCH_OFF: 77,
  LEVER_OFF: 78,
  LEVER_ON: 79,
  BUTTON_OFF: 80,
  BUTTON_ON: 81,
  PLATE_OFF: 82,
  PLATE_ON: 83,
  REPEATER_OFF: 84,
  REPEATER_ON: 85,
  COMPARATOR_OFF: 86,
  COMPARATOR_ON: 87,
  LAMP_OFF: 88,
  LAMP_ON: 89,
  PISTON: 90,
  PISTON_EXTENDED: 91,
  PISTON_HEAD: 92,
  STICKY_PISTON: 93,
  STICKY_PISTON_EXTENDED: 94,
  DISPENSER: 95,
  DROPPER: 96,
  HOPPER: 97,
  RAIL: 98,
  POWERED_RAIL_OFF: 99,
  POWERED_RAIL_ON: 100,
  DETECTOR_RAIL_OFF: 101,
  DETECTOR_RAIL_ON: 102,
  SANDSTONE: 107,
  SNOW: 108,
  ICE: 109,
  DIAMOND_ORE: 110,
  STONE_BRICKS: 111,
  MOSSY_COBBLESTONE: 112,
  SPAWNER: 113,
  NETHER_PORTAL: 114,
  END_PORTAL_FRAME: 115,
  END_PORTAL_FRAME_EYE: 116,
  END_PORTAL: 117,
  END_STONE: 118,
  GLOWSTONE: 119,
  NETHER_QUARTZ_ORE: 120,
  SOUL_SAND: 121,
  NETHER_BRICK: 122,
  DRAGON_EGG: 123,
  END_STONE_BRICKS: 124,
  PURPUR: 125,
  NETHERRACK: 126,
  MAGMA: 127,
  WITHER_SKELETON_SKULL: 128,
  GOLD_ORE: 103,
  IRON_BLOCK: 104,
  GOLD_BLOCK: 105,
  LAPIS_ORE: 106,
} as const;
const block = (
  id: number,
  key: string,
  name: string,
  tex: readonly [number, number, number],
  hardness: number,
  overrides: Partial<BlockDefinition> = {},
): BlockDefinition =>
  Object.freeze({
    id,
    key: `lab:${key}`,
    name,
    solid: true,
    occludes: true,
    layer: 'opaque',
    textures: tex,
    placeable: true,
    hardness,
    ...overrides,
  });
const BASE_BLOCKS: readonly BlockDefinition[] = [
  block(0, 'air', 'Воздух', [0, 0, 0], 0, {
    solid: false,
    occludes: false,
    placeable: false,
  }),
  block(1, 'grass', 'Дёрн', [0, 1, 2], 0.6, {
    tool: 'shovel',
    drops: [{ item: 'lab:dirt' }],
    soil: true,
  }),
  block(2, 'dirt', 'Земля', [2, 2, 2], 0.5, { tool: 'shovel', soil: true }),
  block(3, 'stone', 'Камень', [3, 3, 3], 1.5, {
    tool: 'pickaxe',
    tier: 1,
    drops: [{ item: 'lab:cobblestone' }],
  }),
  block(4, 'sand', 'Песок', [4, 4, 4], 0.5, {
    tool: 'shovel',
    // Sand and gravel fall when nothing holds them up.
    falling: true,
  }),
  block(5, 'oak_log', 'Дубовое бревно', [6, 5, 6], 2, {
    tool: 'axe',
    fuelTicks: 300,
    flammable: 5,
    burnTicks: 300,
  }),
  block(6, 'oak_leaves', 'Дубовая листва', [7, 7, 7], 0.2, {
    occludes: false,
    layer: 'cutout',
    // Leaves follow the reference: only shears keep the block, otherwise a sapling now and
    // then and one apple in two hundred.
    drops: [
      { item: 'lab:oak_leaves', shears: true },
      { item: 'lab:oak_sapling', chance: 5, shears: false },
      { item: 'lab:apple', chance: 0.5, shears: false },
      { item: 'lab:stick', chance: 2, shears: false },
    ],
    flammable: 60,
    burnTicks: 60,
  }),
  block(7, 'oak_planks', 'Дубовые доски', [8, 8, 8], 2, {
    tool: 'axe',
    fuelTicks: 300,
    flammable: 20,
    burnTicks: 300,
  }),
  block(8, 'cobblestone', 'Булыжник', [9, 9, 9], 2, { tool: 'pickaxe', tier: 1 }),
  block(9, 'glass', 'Стекло', [10, 10, 10], 0.3, {
    occludes: false,
    layer: 'transparent',
  }),
  block(10, 'water', 'Вода', [11, 11, 11], -1, {
    solid: false,
    occludes: false,
    layer: 'transparent',
    liquid: true,
    placeable: false,
    fluid: 'water',
    fluidSource: true,
  }),
  block(11, 'bedrock', 'Основание', [12, 12, 12], -1, { protected: true, placeable: false }),
  block(12, 'dandelion', 'Одуванчик', [13, 13, 13], 0, {
    solid: false,
    occludes: false,
    layer: 'cutout',
    shape: 'cross',
  }),
  block(13, 'daisy', 'Ромашка', [14, 14, 14], 0, {
    solid: false,
    occludes: false,
    layer: 'cutout',
    shape: 'cross',
  }),
  block(14, 'tall_grass', 'Трава', [15, 15, 15], 0, {
    solid: false,
    occludes: false,
    layer: 'cutout',
    shape: 'cross',
    replaceable: true,
    // The only early source of wheat seeds, as in the reference: one clump in eight.
    drops: [
      { item: 'lab:tall_grass', shears: true },
      { item: 'lab:seeds', chance: 12.5, shears: false },
    ],
  }),
  block(15, 'birch_log', 'Берёзовое бревно', [6, 16, 6], 2, {
    tool: 'axe',
    fuelTicks: 300,
    flammable: 5,
    burnTicks: 300,
  }),
  block(16, 'coal_ore', 'Угольная руда', [17, 17, 17], 3, {
    tool: 'pickaxe',
    tier: 1,
    drops: [{ item: 'lab:coal' }],
    // Coal ore is the one ore in this build that pays experience, exactly like the reference.
    xp: [0, 2],
  }),
  block(17, 'iron_ore', 'Железная руда', [18, 18, 18], 3, { tool: 'pickaxe', tier: 2 }),
  block(18, 'crafting_table', 'Верстак', [20, 19, 8], 2.5, {
    tool: 'axe',
    opens: 'crafting',
    fuelTicks: 300,
  }),
  block(19, 'furnace', 'Печь', [22, 21, 21], 3.5, {
    tool: 'pickaxe',
    tier: 1,
    opens: 'furnace',
    litVariant: 20,
  }),
  block(20, 'furnace_lit', 'Печь (горит)', [22, 23, 21], 3.5, {
    tool: 'pickaxe',
    tier: 1,
    opens: 'furnace',
    placeable: false,
    drops: [{ item: 'lab:furnace' }],
  }),
  block(21, 'smooth_stone', 'Гладкий камень', [24, 24, 24], 1.5, {
    tool: 'pickaxe',
    tier: 1,
  }),
  block(22, 'chest', 'Сундук', [26, 25, 25], 2.5, { tool: 'axe', opens: 'chest', fuelTicks: 300 }),
  // Still water instead of flowing lava: fluids are a later stage, the hazard is not.
  block(23, 'lava', 'Лава', [27, 27, 27], -1, {
    solid: false,
    occludes: false,
    layer: 'transparent',
    liquid: true,
    contactDamage: 4,
    fluid: 'lava',
    fluidSource: true,
  }),
  // One block, not the reference 1x2 bed: block properties arrive with a later stage.
  block(24, 'bed', 'Кровать', [29, 28, 28], 0.2, { tool: 'axe', opens: 'bed' }),

  /* ---------------------------------------------------------------- E09: fluiden und Physik */
  ...[1, 2, 3, 4, 5, 6, 7].map((level, index) =>
    block(24 + level, `water_flow_${level}`, 'Вода', [30 + index, 30 + index, 30 + index], -1, {
      solid: false,
      occludes: false,
      layer: 'transparent',
      liquid: true,
      placeable: false,
      fluid: 'water',
      fluidLevel: level,
    }),
  ),
  ...[1, 2, 3].map((level, index) =>
    block(31 + level, `lava_flow_${level}`, 'Лава', [37 + index, 37 + index, 37 + index], -1, {
      solid: false,
      occludes: false,
      layer: 'transparent',
      liquid: true,
      placeable: false,
      contactDamage: 4,
      fluid: 'lava',
      fluidLevel: level,
    }),
  ),
  block(35, 'gravel', 'Гравий', [40, 40, 40], 0.6, {
    tool: 'shovel',
    falling: true,
    // As in 1.12: one time in ten the gravel gives a flint instead of itself.
    drops: [{ item: 'lab:gravel' }, { item: 'lab:flint', chance: 10, replaces: 'lab:gravel' }],
  }),
  block(36, 'obsidian', 'Обсидиан', [41, 41, 41], 25, { tool: 'pickaxe', tier: 4 }),
  block(37, 'fire', 'Огонь', [42, 42, 42], 0, {
    solid: false,
    occludes: false,
    layer: 'cutout',
    shape: 'cross',
    light: 15,
    placeable: false,
    // Fire is a state of the world, not an item: breaking it leaves nothing behind.
    drops: [],
  }),
  block(38, 'tnt', 'Динамит', [44, 43, 45], 0, {
    redstone: 'tnt',
    flammable: 100,
    burnTicks: 0,
  }),
  block(39, 'torch', 'Факел', [46, 46, 46], 0, {
    solid: false,
    occludes: false,
    layer: 'cutout',
    shape: 'torch',
    light: 14,
  }),
  /* --------------------------------------------------------------------- E10: farming */
  block(40, 'farmland', 'Вспаханная земля', [47, 2, 2], 0.6, {
    tool: 'shovel',
    drops: [{ item: 'lab:dirt' }],
  }),
  block(41, 'farmland_wet', 'Вспаханная земля', [48, 2, 2], 0.6, {
    tool: 'shovel',
    placeable: false,
    drops: [{ item: 'lab:dirt' }],
  }),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((stage) =>
    block(42 + stage, `wheat_${stage}`, 'Пшеница', [49 + stage, 49 + stage, 49 + stage], 0, {
      solid: false,
      occludes: false,
      layer: 'cutout',
      shape: 'cross',
      placeable: stage === 0,
      cropStage: stage,
      cropNext: stage < 7 ? 43 + stage : undefined,
      drops:
        stage === 7
          ? [{ item: 'lab:wheat' }, { item: 'lab:seeds', count: 3 }]
          : [{ item: 'lab:seeds' }],
    }),
  ),
  block(50, 'oak_sapling', 'Саженец дуба', [57, 57, 57], 0, {
    sapling: 'oak',
    solid: false,
    occludes: false,
    layer: 'cutout',
    shape: 'cross',
    flammable: 60,
    drops: [{ item: 'lab:oak_sapling' }],
  }),
  block(51, 'sugar_cane', 'Сахарный тростник', [58, 58, 58], 0, {
    solid: false,
    occludes: false,
    layer: 'cutout',
    shape: 'cross',
  }),
  block(52, 'cactus', 'Кактус', [59, 60, 59], 0.4, { tool: 'axe' }),
  block(53, 'pumpkin', 'Тыква', [62, 61, 62], 1, { tool: 'axe' }),
  block(54, 'melon', 'Арбуз', [64, 63, 64], 1, {
    tool: 'axe',
    // Three to seven slices.
    drops: [
      { item: 'lab:melon_slice', count: 3 },
      ...[80, 60, 40, 20].map((chance) => ({ item: 'lab:melon_slice', chance })),
    ],
  }),
  /* --------------------------------------------------------- E12: Verzaubern und Brauen */
  block(55, 'enchanting_table', 'Стол зачарований', [66, 65, 41], 5, {
    tool: 'pickaxe',
    tier: 1,
    opens: 'enchanting',
    light: 7,
  }),
  block(56, 'bookshelf', 'Книжная полка', [8, 67, 8], 1.5, {
    tool: 'axe',
    flammable: 30,
    burnTicks: 300,
  }),
  block(57, 'brewing_stand', 'Варочная стойка', [68, 68, 68], 0.5, {
    opens: 'brewing',
    tool: 'pickaxe',
  }),
  block(58, 'anvil', 'Наковальня', [70, 69, 70], 5, { tool: 'pickaxe', tier: 1, opens: 'anvil' }),
  /* ------------------------------------------------------------------ E13: redstone */
  block(59, 'redstone_ore', 'Редстоуновая руда', [71, 71, 71], 3, {
    tool: 'pickaxe',
    tier: 2,
    light: 9,
    drops: [{ item: 'lab:redstone', count: 4 }],
    xp: [1, 5],
  }),
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((power) =>
    block(
      60 + power,
      `redstone_wire_${power}`,
      'Редстоуновая пыль',
      [72 + power, 72 + power, 72 + power],
      0,
      {
        solid: false,
        occludes: false,
        layer: 'cutout',
        shape: 'flat',
        redstone: 'wire',
        drops: [{ item: 'lab:redstone' }],
      },
    ),
  ),
  block(76, 'redstone_torch_on', 'Редстоуновый факел', [88, 88, 88], 0, {
    solid: false,
    occludes: false,
    layer: 'cutout',
    shape: 'torch',
    light: 7,
    redstone: 'torch',
    unlitVariant: 77,
    drops: [{ item: 'lab:redstone_torch' }],
  }),
  block(77, 'redstone_torch_off', 'Редстоуновый факел', [89, 89, 89], 0, {
    solid: false,
    occludes: false,
    layer: 'cutout',
    shape: 'torch',
    placeable: false,
    redstone: 'torch',
    litVariant: 76,
    drops: [{ item: 'lab:redstone_torch' }],
  }),
  block(78, 'lever_off', 'Рычаг', [90, 90, 90], 0.5, {
    solid: false,
    occludes: false,
    layer: 'cutout',
    shape: 'flat',
    redstone: 'lever',
    litVariant: 79,
  }),
  block(79, 'lever_on', 'Рычаг', [91, 91, 91], 0.5, {
    solid: false,
    occludes: false,
    layer: 'cutout',
    shape: 'flat',
    placeable: false,
    redstone: 'lever',
    unlitVariant: 78,
    drops: [{ item: 'lab:lever' }],
  }),
  block(80, 'button_off', 'Кнопка', [92, 92, 92], 0.5, {
    solid: false,
    occludes: false,
    layer: 'cutout',
    shape: 'flat',
    redstone: 'button',
    litVariant: 81,
  }),
  block(81, 'button_on', 'Кнопка', [93, 93, 93], 0.5, {
    solid: false,
    occludes: false,
    layer: 'cutout',
    shape: 'flat',
    placeable: false,
    redstone: 'button',
    unlitVariant: 80,
    drops: [{ item: 'lab:button' }],
  }),
  block(82, 'plate_off', 'Нажимная плита', [94, 94, 94], 0.5, {
    solid: false,
    occludes: false,
    layer: 'cutout',
    shape: 'flat',
    redstone: 'plate',
    litVariant: 83,
  }),
  block(83, 'plate_on', 'Нажимная плита', [95, 95, 95], 0.5, {
    solid: false,
    occludes: false,
    layer: 'cutout',
    shape: 'flat',
    placeable: false,
    redstone: 'plate',
    unlitVariant: 82,
    drops: [{ item: 'lab:plate' }],
  }),
  block(84, 'repeater_off', 'Повторитель', [96, 96, 96], 0, {
    solid: false,
    occludes: false,
    layer: 'cutout',
    shape: 'flat',
    redstone: 'repeater',
    litVariant: 85,
  }),
  block(85, 'repeater_on', 'Повторитель', [97, 97, 97], 0, {
    solid: false,
    occludes: false,
    layer: 'cutout',
    shape: 'flat',
    placeable: false,
    redstone: 'repeater',
    unlitVariant: 84,
    drops: [{ item: 'lab:repeater' }],
  }),
  block(86, 'comparator_off', 'Компаратор', [98, 98, 98], 0, {
    solid: false,
    occludes: false,
    layer: 'cutout',
    shape: 'flat',
    redstone: 'comparator',
    litVariant: 87,
  }),
  block(87, 'comparator_on', 'Компаратор', [99, 99, 99], 0, {
    solid: false,
    occludes: false,
    layer: 'cutout',
    shape: 'flat',
    placeable: false,
    redstone: 'comparator',
    unlitVariant: 86,
    drops: [{ item: 'lab:comparator' }],
  }),
  block(88, 'lamp_off', 'Редстоуновая лампа', [100, 100, 100], 0.3, {
    redstone: 'lamp',
    litVariant: 89,
  }),
  block(89, 'lamp_on', 'Редстоуновая лампа', [101, 101, 101], 0.3, {
    redstone: 'lamp',
    light: 15,
    unlitVariant: 88,
    drops: [{ item: 'lab:lamp' }],
  }),
  block(90, 'piston', 'Поршень', [103, 102, 104], 1.5, { tool: 'pickaxe', redstone: 'piston' }),
  block(91, 'piston_extended', 'Поршень', [103, 102, 104], 1.5, {
    tool: 'pickaxe',
    placeable: false,
    redstone: 'piston',
    drops: [{ item: 'lab:piston' }],
  }),
  block(92, 'piston_head', 'Головка поршня', [105, 105, 105], 1.5, {
    tool: 'pickaxe',
    placeable: false,
    drops: [],
  }),
  block(93, 'sticky_piston', 'Липкий поршень', [106, 102, 104], 1.5, {
    tool: 'pickaxe',
    redstone: 'sticky_piston',
  }),
  block(94, 'sticky_piston_extended', 'Липкий поршень', [106, 102, 104], 1.5, {
    tool: 'pickaxe',
    placeable: false,
    redstone: 'sticky_piston',
    drops: [{ item: 'lab:sticky_piston' }],
  }),
  block(95, 'dispenser', 'Раздатчик', [108, 107, 108], 3.5, {
    tool: 'pickaxe',
    redstone: 'dispenser',
    opens: 'dispenser',
  }),
  block(96, 'dropper', 'Выбрасыватель', [110, 109, 110], 3.5, {
    tool: 'pickaxe',
    redstone: 'dropper',
    opens: 'dropper',
  }),
  block(97, 'hopper', 'Воронка', [112, 111, 113], 3, { tool: 'pickaxe', opens: 'hopper' }),
  block(98, 'rail', 'Рельсы', [114, 114, 114], 0.7, {
    tool: 'pickaxe',
    solid: false,
    occludes: false,
    layer: 'cutout',
    shape: 'flat',
  }),
  block(99, 'powered_rail_off', 'Энергорельсы', [115, 115, 115], 0.7, {
    tool: 'pickaxe',
    solid: false,
    occludes: false,
    layer: 'cutout',
    shape: 'flat',
    litVariant: 100,
  }),
  block(100, 'powered_rail_on', 'Энергорельсы', [116, 116, 116], 0.7, {
    tool: 'pickaxe',
    solid: false,
    occludes: false,
    layer: 'cutout',
    shape: 'flat',
    placeable: false,
    unlitVariant: 99,
    drops: [{ item: 'lab:powered_rail' }],
  }),
  block(101, 'detector_rail_off', 'Рельсы-датчик', [117, 117, 117], 0.7, {
    tool: 'pickaxe',
    solid: false,
    occludes: false,
    layer: 'cutout',
    shape: 'flat',
    litVariant: 102,
  }),
  block(103, 'gold_ore', 'Золотая руда', [119, 119, 119], 3, {
    tool: 'pickaxe',
    tier: 3,
  }),
  block(104, 'iron_block', 'Железный блок', [120, 120, 120], 5, { tool: 'pickaxe', tier: 2 }),
  block(105, 'gold_block', 'Золотой блок', [121, 121, 121], 3, { tool: 'pickaxe', tier: 3 }),
  block(106, 'lapis_ore', 'Лазуритовая руда', [122, 122, 122], 3, {
    tool: 'pickaxe',
    tier: 2,
    drops: [{ item: 'lab:lapis', count: 6 }],
    xp: [2, 5],
  }),
  block(102, 'detector_rail_on', 'Рельсы-датчик', [118, 118, 118], 0.7, {
    tool: 'pickaxe',
    solid: false,
    occludes: false,
    layer: 'cutout',
    shape: 'flat',
    placeable: false,
    unlitVariant: 101,
    drops: [{ item: 'lab:detector_rail' }],
  }),
  /* ------------------------------------------- E14: blocks the biome generator places */
  block(107, 'sandstone', 'Песчаник', [123, 123, 124], 0.8, { tool: 'pickaxe', tier: 1 }),
  block(108, 'snow', 'Снег', [125, 125, 125], 0.2, {
    tool: 'shovel',
    // Snow is only ever placed as a thin cover in the reference; here it is a full block.
    drops: [{ item: 'lab:snowball' }],
  }),
  block(109, 'ice', 'Лёд', [126, 126, 126], 0.5, {
    tool: 'pickaxe',
    occludes: false,
    layer: 'transparent',
  }),
  block(110, 'diamond_ore', 'Алмазная руда', [127, 127, 127], 3, {
    tool: 'pickaxe',
    tier: 3,
    drops: [{ item: 'lab:diamond' }],
    xp: [3, 7],
  }),
  /* ------------------------------------------- E14: blocks the structures are built from */
  block(111, 'stone_bricks', 'Каменный кирпич', [128, 128, 128], 1.5, {
    tool: 'pickaxe',
    tier: 1,
  }),
  block(112, 'mossy_cobblestone', 'Мшистый булыжник', [129, 129, 129], 2, {
    tool: 'pickaxe',
    tier: 1,
  }),
  block(113, 'spawner', 'Спавнер', [130, 130, 130], 5, {
    tool: 'pickaxe',
    drops: [],
    layer: 'cutout',
  }),
  /* ------------------------------------------- E15: portals, the Nether and the End */
  block(114, 'nether_portal', 'Адский портал', [131, 131, 131], -1, {
    solid: false,
    occludes: false,
    layer: 'transparent',
    light: 11,
    drops: [],
  }),
  block(115, 'end_portal_frame', 'Рама портала Края', [133, 133, 133], -1, {
    unlitVariant: 116,
    // The frame only ever holds an eye: it is unbreakable and never drops itself.
    drops: [],
  }),
  block(116, 'end_portal_frame_eye', 'Рама портала Края с оком', [132, 133, 133], -1, {
    light: 3,
    unlitVariant: 115,
    drops: [],
  }),
  block(117, 'end_portal', 'Портал Края', [134, 134, 134], -1, {
    solid: false,
    occludes: false,
    layer: 'transparent',
    light: 15,
    drops: [],
  }),
  block(118, 'end_stone', 'Камень Края', [135, 135, 135], 3, { tool: 'pickaxe', tier: 1 }),
  block(119, 'glowstone', 'Светокамень', [136, 136, 136], 0.3, {
    light: 15,
    // Two to four dust, as in the reference.
    drops: [
      { item: 'lab:glowstone_dust', count: 2 },
      { item: 'lab:glowstone_dust', chance: 50 },
      { item: 'lab:glowstone_dust', chance: 50 },
    ],
  }),
  block(120, 'nether_quartz_ore', 'Кварцевая руда', [137, 137, 137], 3, {
    tool: 'pickaxe',
    tier: 1,
    drops: [{ item: 'lab:nether_quartz' }],
    xp: [2, 5],
  }),
  block(121, 'soul_sand', 'Песок душ', [138, 138, 138], 0.5, { tool: 'shovel' }),
  block(122, 'nether_brick', 'Адский кирпич', [139, 139, 139], 2, { tool: 'pickaxe', tier: 1 }),
  block(123, 'dragon_egg', 'Яйцо дракона', [140, 140, 140], 3, { tool: 'pickaxe', tier: 1 }),
  block(124, 'end_stone_bricks', 'Кирпичи Края', [141, 141, 141], 3, {
    tool: 'pickaxe',
    tier: 1,
  }),
  block(125, 'purpur', 'Пурпур', [142, 142, 142], 1.5, { tool: 'pickaxe', tier: 1 }),
  block(126, 'netherrack', 'Адский камень', [143, 143, 143], 0.4, {
    tool: 'pickaxe',
    tier: 1,
    drops: [{ item: 'lab:netherrack' }],
  }),
  block(127, 'magma', 'Магма', [144, 144, 144], 0.5, {
    tool: 'pickaxe',
    tier: 1,
    light: 3,
    contactDamage: 1,
  }),
  // The three skulls of the wither ritual: placed on soul sand, they wake the wither.
  block(128, 'wither_skeleton_skull', 'Череп скелета-иссушителя', [145, 145, 145], 1, {
    tool: 'pickaxe',
    tier: 1,
  }),
];

/* ============================================================================================
 * 0.10 block set: the materials of the 1.12-style generator and of its structures.
 * IDs are assigned in this order and never reused; saves store keys, not these numbers.
 * ========================================================================================== */
const EXTRA_BLOCKS: BlockDefinition[] = [];
let nextExtraId = 129;
function add(
  key: string,
  name: string,
  tex: readonly [number, number, number] | number,
  hardness: number,
  overrides: Partial<BlockDefinition> = {},
): number {
  const id = nextExtraId++;
  const textures: readonly [number, number, number] =
    typeof tex === 'number' ? [tex, tex, tex] : tex;
  EXTRA_BLOCKS.push(block(id, key, name, textures, hardness, overrides));
  return id;
}
const plant = (tile: number, extra: Partial<BlockDefinition> = {}): Partial<BlockDefinition> => ({
  solid: false,
  occludes: false,
  layer: 'cutout',
  shape: 'cross',
  replaceable: false,
  hardness: 0,
  ...extra,
  textures: [tile, tile, tile],
});
const wood = { tool: 'axe' as const, fuelTicks: 300, flammable: 5, burnTicks: 300 };
const planks = { tool: 'axe' as const, fuelTicks: 300, flammable: 20, burnTicks: 300 };
const leaves = (key: string): Partial<BlockDefinition> => ({
  occludes: false,
  layer: 'cutout',
  // Only shears keep the block; the other trees have no sapling of their own yet, and dark
  // oak shares the oak apple.
  drops: [
    { item: `lab:${key}`, shears: true },
    // Round H: every tree drops its own sapling now (jungle half as often), and a stick now and then.
    {
      item: `lab:${key.replace('_leaves', '_sapling')}`,
      chance: key === 'jungle_leaves' ? 2.5 : 5,
      shears: false as const,
    },
    { item: 'lab:stick', chance: 2, shears: false as const },
    ...(key === 'dark_oak_leaves'
      ? [{ item: 'lab:apple', chance: 0.5, shears: false as const }]
      : []),
  ],
  flammable: 60,
  burnTicks: 60,
  tint: 'foliage',
});
const rock = { tool: 'pickaxe' as const, tier: 1 as const };
type Half = 'bottom' | 'top';
const STAIR_ORDER: readonly ['north' | 'east' | 'south' | 'west', Half][] = [
  ['north', 'bottom'],
  ['east', 'bottom'],
  ['south', 'bottom'],
  ['west', 'bottom'],
  ['north', 'top'],
  ['east', 'top'],
  ['south', 'top'],
  ['west', 'top'],
];
/** Eight states per stair material: four facings, bottom and upside down. */
function stairs(
  key: string,
  name: string,
  tex: readonly [number, number, number],
  hardness: number,
  extra: Partial<BlockDefinition>,
): number {
  const first = nextExtraId;
  for (const [index, [facing, half]] of STAIR_ORDER.entries())
    add(index === 0 ? key : `${key}_${facing}_${half}`, name, tex, hardness, {
      ...extra,
      occludes: false,
      model: { kind: 'stairs', facing, half },
      placement: 'stairs',
      base: first,
      placeable: index === 0,
      drops: [{ item: `lab:${key}` }],
    });
  return first;
}
function slab(
  key: string,
  name: string,
  tex: readonly [number, number, number],
  hardness: number,
  doubleKey: string,
  extra: Partial<BlockDefinition>,
): number {
  const first = nextExtraId;
  const double = [...BASE_BLOCKS, ...EXTRA_BLOCKS].find(
    (def) => def.key === `lab:${doubleKey}`,
  )?.id;
  if (double === undefined) throw new Error(`Slab ${key} without its full block ${doubleKey}`);
  add(key, name, tex, hardness, {
    ...extra,
    occludes: false,
    model: { kind: 'slab', half: 'bottom' },
    placement: 'slab',
    base: first,
    doubleSlab: double,
  });
  add(`${key}_top`, name, tex, hardness, {
    ...extra,
    occludes: false,
    model: { kind: 'slab', half: 'top' },
    placement: 'slab',
    base: first,
    doubleSlab: double,
    placeable: false,
    drops: [{ item: `lab:${key}` }],
  });
  return first;
}
function fence(key: string, name: string, tex: number): number {
  return add(key, name, tex, 2, {
    ...planks,
    occludes: false,
    model: { kind: 'fence' },
    connects: 'fence',
  });
}
/** Sixteen states per door: facing, open or closed, lower or upper half. */
function door(key: string, name: string, lower: number, upper: number): number {
  const first = nextExtraId;
  for (const upperHalf of [false, true])
    for (const open of [false, true])
      for (const facing of ['north', 'east', 'south', 'west'] as const) {
        const canonical = !upperHalf && !open && facing === 'north';
        add(
          canonical
            ? key
            : `${key}_${facing}_${open ? 'open' : 'closed'}_${upperHalf ? 'upper' : 'lower'}`,
          name,
          upperHalf ? upper : lower,
          3,
          {
            tool: 'axe',
            occludes: false,
            layer: 'cutout',
            model: { kind: 'door', facing, open, upper: upperHalf },
            placement: 'door',
            base: first,
            placeable: canonical,
            // Only the lower half drops the door; breaking either half removes both.
            drops: upperHalf ? [] : [{ item: `lab:${key}` }],
            flammable: 5,
          },
        );
      }
  return first;
}

export const BLOCK_X = {
  SNOW_LAYER: add('snow_layer', 'Снежный покров', TILE.snow, 0.1, {
    solid: false,
    occludes: false,
    model: { kind: 'layer', height: 0.125 },
    tool: 'shovel',
    drops: [{ item: 'lab:snowball' }],
    replaceable: true,
  }),
  GRASS_SNOWY: add('grass_snowy', 'Заснеженный дёрн', [TILE.snow, TILE.grass_snowy_side, 2], 0.6, {
    tool: 'shovel',
    drops: [{ item: 'lab:dirt' }],
    soil: true,
  }),
  PODZOL: add('podzol', 'Подзол', [TILE.podzol_top, TILE.podzol_side, 2], 0.5, {
    tool: 'shovel',
    drops: [{ item: 'lab:dirt' }],
    soil: true,
  }),
  COARSE_DIRT: add('coarse_dirt', 'Каменистая земля', TILE.coarse_dirt, 0.5, {
    tool: 'shovel',
    soil: true,
  }),
  RED_SAND: add('red_sand', 'Красный песок', TILE.red_sand, 0.5, { tool: 'shovel', falling: true }),
  CLAY: add('clay', 'Глина', TILE.clay, 0.6, {
    tool: 'shovel',
    drops: [{ item: 'lab:clay_ball', count: 4 }],
  }),
  TERRACOTTA: add('terracotta', 'Терракота', TILE.terracotta, 1.25, rock),
  TERRACOTTA_ORANGE: add(
    'terracotta_orange',
    'Оранжевая терракота',
    TILE.terracotta_orange,
    1.25,
    rock,
  ),
  TERRACOTTA_YELLOW: add(
    'terracotta_yellow',
    'Жёлтая терракота',
    TILE.terracotta_yellow,
    1.25,
    rock,
  ),
  TERRACOTTA_WHITE: add('terracotta_white', 'Белая терракота', TILE.terracotta_white, 1.25, rock),
  TERRACOTTA_LIGHT_GRAY: add(
    'terracotta_light_gray',
    'Светло-серая терракота',
    TILE.terracotta_light_gray,
    1.25,
    rock,
  ),
  TERRACOTTA_BROWN: add(
    'terracotta_brown',
    'Коричневая терракота',
    TILE.terracotta_brown,
    1.25,
    rock,
  ),
  TERRACOTTA_RED: add('terracotta_red', 'Красная терракота', TILE.terracotta_red, 1.25, rock),
  GRANITE: add('granite', 'Гранит', TILE.granite, 1.5, rock),
  DIORITE: add('diorite', 'Диорит', TILE.diorite, 1.5, rock),
  ANDESITE: add('andesite', 'Андезит', TILE.andesite, 1.5, rock),
  SPRUCE_LOG: add(
    'spruce_log',
    'Еловое бревно',
    [TILE.spruce_log_top, TILE.spruce_log, TILE.spruce_log_top],
    2,
    wood,
  ),
  SPRUCE_PLANKS: add('spruce_planks', 'Еловые доски', TILE.spruce_planks, 2, planks),
  SPRUCE_LEAVES: add(
    'spruce_leaves',
    'Еловая хвоя',
    TILE.spruce_leaves,
    0.2,
    leaves('spruce_leaves'),
  ),
  BIRCH_PLANKS: add('birch_planks', 'Берёзовые доски', TILE.birch_planks, 2, planks),
  BIRCH_LEAVES: add(
    'birch_leaves',
    'Берёзовая листва',
    TILE.birch_leaves,
    0.2,
    leaves('birch_leaves'),
  ),
  JUNGLE_LOG: add(
    'jungle_log',
    'Бревно тропического дерева',
    [TILE.jungle_log_top, TILE.jungle_log, TILE.jungle_log_top],
    2,
    wood,
  ),
  JUNGLE_PLANKS: add('jungle_planks', 'Доски тропического дерева', TILE.jungle_planks, 2, planks),
  JUNGLE_LEAVES: add(
    'jungle_leaves',
    'Тропическая листва',
    TILE.jungle_leaves,
    0.2,
    leaves('jungle_leaves'),
  ),
  ACACIA_LOG: add(
    'acacia_log',
    'Акациевое бревно',
    [TILE.acacia_log_top, TILE.acacia_log, TILE.acacia_log_top],
    2,
    wood,
  ),
  ACACIA_PLANKS: add('acacia_planks', 'Акациевые доски', TILE.acacia_planks, 2, planks),
  ACACIA_LEAVES: add(
    'acacia_leaves',
    'Листва акации',
    TILE.acacia_leaves,
    0.2,
    leaves('acacia_leaves'),
  ),
  DARK_OAK_LOG: add(
    'dark_oak_log',
    'Бревно тёмного дуба',
    [TILE.dark_oak_log_top, TILE.dark_oak_log, TILE.dark_oak_log_top],
    2,
    wood,
  ),
  DARK_OAK_PLANKS: add('dark_oak_planks', 'Доски тёмного дуба', TILE.dark_oak_planks, 2, planks),
  DARK_OAK_LEAVES: add(
    'dark_oak_leaves',
    'Листва тёмного дуба',
    TILE.dark_oak_leaves,
    0.2,
    leaves('dark_oak_leaves'),
  ),
  FERN: add(
    'fern',
    'Папоротник',
    TILE.fern,
    0,
    plant(TILE.fern, {
      replaceable: true,
      tint: 'grass',
      drops: [
        { item: 'lab:fern', shears: true },
        { item: 'lab:seeds', chance: 12.5, shears: false },
      ],
    }),
  ),
  DEAD_BUSH: add(
    'dead_bush',
    'Сухой куст',
    TILE.dead_bush,
    0,
    plant(TILE.dead_bush, { replaceable: true, drops: [{ item: 'lab:stick', chance: 50 }] }),
  ),
  POPPY: add('poppy', 'Мак', TILE.poppy, 0, plant(TILE.poppy)),
  BLUE_ORCHID: add('blue_orchid', 'Синяя орхидея', TILE.blue_orchid, 0, plant(TILE.blue_orchid)),
  ALLIUM: add('allium', 'Лук-победитель', TILE.allium, 0, plant(TILE.allium)),
  RED_TULIP: add('red_tulip', 'Красный тюльпан', TILE.red_tulip, 0, plant(TILE.red_tulip)),
  BROWN_MUSHROOM: add(
    'brown_mushroom',
    'Коричневый гриб',
    TILE.brown_mushroom,
    0,
    plant(TILE.brown_mushroom, { light: 1 }),
  ),
  RED_MUSHROOM: add('red_mushroom', 'Красный гриб', TILE.red_mushroom, 0, plant(TILE.red_mushroom)),
  LILY_PAD: add('lily_pad', 'Кувшинка', TILE.lily_pad, 0, {
    solid: false,
    occludes: false,
    layer: 'cutout',
    shape: 'flat',
    tint: 'foliage',
  }),
  COBWEB: add(
    'cobweb',
    'Паутина',
    TILE.cobweb,
    4,
    plant(TILE.cobweb, { hardness: 4, tool: 'sword', drops: [{ item: 'lab:string' }] }),
  ),
  PACKED_ICE: add('packed_ice', 'Плотный лёд', TILE.packed_ice, 0.5, {
    tool: 'pickaxe',
    drops: [],
  }),
  MOSSY_STONE_BRICKS: add(
    'mossy_stone_bricks',
    'Замшелый каменный кирпич',
    TILE.mossy_stone_bricks,
    1.5,
    rock,
  ),
  CRACKED_STONE_BRICKS: add(
    'cracked_stone_bricks',
    'Потрескавшийся каменный кирпич',
    TILE.cracked_stone_bricks,
    1.5,
    rock,
  ),
  CHISELED_SANDSTONE: add(
    'chiseled_sandstone',
    'Резной песчаник',
    [TILE.sandstone_top, TILE.chiseled_sandstone, TILE.sandstone_bottom],
    0.8,
    rock,
  ),
  SMOOTH_SANDSTONE: add(
    'smooth_sandstone',
    'Гладкий песчаник',
    [TILE.sandstone_top, TILE.sandstone_top, TILE.sandstone_top],
    0.8,
    rock,
  ),
  HAY: add('hay_block', 'Сноп сена', [TILE.hay_top, TILE.hay_side, TILE.hay_top], 0.5, {
    flammable: 60,
    burnTicks: 60,
  }),
  MYCELIUM: add('mycelium', 'Мицелий', [TILE.mycelium_top, TILE.mycelium_side, 2], 0.6, {
    tool: 'shovel',
    drops: [{ item: 'lab:dirt' }],
    soil: true,
  }),
  GLASS_PANE: add('glass_pane', 'Стеклянная панель', 10, 0.3, {
    occludes: false,
    layer: 'transparent',
    model: { kind: 'pane' },
    connects: 'pane',
  }),
  OAK_FENCE: fence('oak_fence', 'Дубовый забор', 8),
  SPRUCE_FENCE: fence('spruce_fence', 'Еловый забор', TILE.spruce_planks),
  ACACIA_FENCE: fence('acacia_fence', 'Акациевый забор', TILE.acacia_planks),
  DARK_OAK_FENCE: fence('dark_oak_fence', 'Забор из тёмного дуба', TILE.dark_oak_planks),
  OAK_STAIRS: stairs('oak_stairs', 'Дубовые ступени', [8, 8, 8], 2, planks),
  SPRUCE_STAIRS: stairs(
    'spruce_stairs',
    'Еловые ступени',
    [TILE.spruce_planks, TILE.spruce_planks, TILE.spruce_planks],
    2,
    planks,
  ),
  ACACIA_STAIRS: stairs(
    'acacia_stairs',
    'Акациевые ступени',
    [TILE.acacia_planks, TILE.acacia_planks, TILE.acacia_planks],
    2,
    planks,
  ),
  COBBLESTONE_STAIRS: stairs('cobblestone_stairs', 'Булыжные ступени', [9, 9, 9], 2, rock),
  SANDSTONE_STAIRS: stairs(
    'sandstone_stairs',
    'Ступени из песчаника',
    [TILE.sandstone_top, TILE.sandstone_side, TILE.sandstone_bottom],
    0.8,
    rock,
  ),
  STONE_BRICK_STAIRS: stairs(
    'stone_brick_stairs',
    'Ступени из каменного кирпича',
    [TILE.stone_bricks, TILE.stone_bricks, TILE.stone_bricks],
    1.5,
    rock,
  ),
  STONE_SLAB: slab(
    'stone_slab',
    'Каменная плита',
    [TILE.stone_slab_top, TILE.stone_slab_side, TILE.stone_slab_top],
    2,
    'smooth_stone',
    rock,
  ),
  OAK_SLAB: slab('oak_slab', 'Дубовая плита', [8, 8, 8], 2, 'oak_planks', planks),
  SPRUCE_SLAB: slab(
    'spruce_slab',
    'Еловая плита',
    [TILE.spruce_planks, TILE.spruce_planks, TILE.spruce_planks],
    2,
    'spruce_planks',
    planks,
  ),
  COBBLESTONE_SLAB: slab('cobblestone_slab', 'Булыжная плита', [9, 9, 9], 2, 'cobblestone', rock),
  SANDSTONE_SLAB: slab(
    'sandstone_slab',
    'Плита из песчаника',
    [TILE.sandstone_top, TILE.sandstone_side, TILE.sandstone_bottom],
    2,
    'sandstone',
    rock,
  ),
  STONE_BRICK_SLAB: slab(
    'stone_brick_slab',
    'Плита из каменного кирпича',
    [TILE.stone_bricks, TILE.stone_bricks, TILE.stone_bricks],
    2,
    'stone_bricks',
    rock,
  ),
  MUSHROOM_STEM: add(
    'mushroom_stem',
    'Ножка гриба',
    [TILE.mushroom_pores, TILE.mushroom_stem, TILE.mushroom_pores],
    0.2,
    {
      tool: 'axe',
      drops: [],
    },
  ),
  BROWN_MUSHROOM_BLOCK: add(
    'brown_mushroom_block',
    'Шляпка коричневого гриба',
    [TILE.brown_mushroom_cap, TILE.brown_mushroom_cap, TILE.mushroom_pores],
    0.2,
    {
      tool: 'axe',
      drops: [{ item: 'lab:brown_mushroom', chance: 20 }],
    },
  ),
  RED_MUSHROOM_BLOCK: add(
    'red_mushroom_block',
    'Шляпка красного гриба',
    [TILE.red_mushroom_cap, TILE.red_mushroom_cap, TILE.mushroom_pores],
    0.2,
    {
      tool: 'axe',
      drops: [{ item: 'lab:red_mushroom', chance: 20 }],
    },
  ),
  OAK_DOOR: door('oak_door', 'Дубовая дверь', TILE.oak_door_lower, TILE.oak_door_upper),
  SPRUCE_DOOR: door('spruce_door', 'Еловая дверь', TILE.spruce_door_lower, TILE.spruce_door_upper),
  ACACIA_DOOR: door(
    'acacia_door',
    'Акациевая дверь',
    TILE.acacia_door_lower,
    TILE.acacia_door_upper,
  ),
} as const;

/* ============================================================================ round H
 * The missing 1.12 blocks, appended so every older id stays put. */
export const FIRST_ROUND_H_BLOCK = nextExtraId;
const T16 = 1 / 16;
const FACING_LIST = ['north', 'east', 'south', 'west'] as const;
/** A box against one side of the cell, `depth` blocks thick. */
function againstSide(side: (typeof FACING_LIST)[number], depth: number, y0 = 0, y1 = 1): Box {
  switch (side) {
    case 'north':
      return [0, y0, 0, 1, y1, depth];
    case 'south':
      return [0, y0, 1 - depth, 1, y1, 1];
    case 'east':
      return [1 - depth, y0, 0, 1, y1, 1];
    case 'west':
      return [0, y0, 0, depth, y1, 1];
  }
}
/** Sixteen trapdoor states: hinge side, open or shut, lower or upper half of the cell. */
function trapdoor(key: string, name: string, tex: number, extra: Partial<BlockDefinition>): number {
  const first = nextExtraId;
  for (const top of [false, true])
    for (const open of [false, true])
      for (const facing of FACING_LIST) {
        const index = (top ? 8 : 0) + (open ? 4 : 0) + FACING_LIST.indexOf(facing);
        const box: Box = open
          ? againstSide(facing, 3 * T16)
          : top
            ? [0, 1 - 3 * T16, 0, 1, 1, 1]
            : [0, 0, 0, 1, 3 * T16, 1];
        add(
          index === 0
            ? key
            : `${key}_${facing}_${open ? 'open' : 'shut'}_${top ? 'top' : 'bottom'}`,
          name,
          tex,
          3,
          {
            ...extra,
            occludes: false,
            layer: 'cutout',
            model: { kind: 'boxes', boxes: [box] },
            placement: 'trapdoor',
            base: first,
            placeable: index === 0,
            toggle: first + (index ^ 4),
            drops: [{ item: `lab:${key}` }],
          },
        );
      }
  return first;
}
/** Eight fence gate states: the way the player faced, open or shut. */
function gate(key: string, name: string, tex: number): number {
  const first = nextExtraId;
  for (const open of [false, true])
    for (const facing of FACING_LIST) {
      const index = (open ? 4 : 0) + FACING_LIST.indexOf(facing);
      const alongX = facing === 'north' || facing === 'south';
      // Boxes are built for a gate across x, then swapped for a gate across z.
      const swap = (b: Box): Box => (alongX ? b : [b[2], b[1], b[0], b[5], b[4], b[3]]);
      const posts: Box[] = [
        [0, 5 * T16, 7 * T16, 2 * T16, 1, 9 * T16],
        [14 * T16, 5 * T16, 7 * T16, 1, 1, 9 * T16],
      ];
      const toward = facing === 'south' || facing === 'east' ? 1 : -1;
      const leaves: Box[] = open
        ? [0, 14 * T16].flatMap((x0) => {
            const z0 = toward > 0 ? 9 * T16 : 1 * T16,
              z1 = toward > 0 ? 15 * T16 : 7 * T16;
            return [
              [x0, 6 * T16, z0, x0 + 2 * T16, 9 * T16, z1],
              [x0, 12 * T16, z0, x0 + 2 * T16, 15 * T16, z1],
            ] as Box[];
          })
        : [
            [2 * T16, 6 * T16, 7 * T16, 14 * T16, 9 * T16, 9 * T16],
            [2 * T16, 12 * T16, 7 * T16, 14 * T16, 15 * T16, 9 * T16],
            [6 * T16, 9 * T16, 7 * T16, 8 * T16, 12 * T16, 9 * T16],
            [8 * T16, 9 * T16, 7 * T16, 10 * T16, 12 * T16, 9 * T16],
          ];
      add(index === 0 ? key : `${key}_${facing}_${open ? 'open' : 'shut'}`, name, tex, 2, {
        ...planks,
        occludes: false,
        model: {
          kind: 'boxes',
          boxes: [...posts, ...leaves].map(swap),
          collision: open ? [] : [swap([0, 0, 6 * T16, 1, 1.5, 10 * T16])],
        },
        placement: 'gate',
        base: first,
        placeable: index === 0,
        toggle: first + (index ^ 4),
        drops: [{ item: `lab:${key}` }],
      });
    }
  return first;
}
/** Eight growth stages drawn with four tiles, like the reference crops. */
function cropChain(
  key: string,
  name: string,
  tiles: readonly [number, number, number, number],
  ripe: readonly BlockDrop[],
  young: readonly BlockDrop[],
  extra: Partial<BlockDefinition> = {},
): number {
  const first = nextExtraId;
  for (let stage = 0; stage < 8; stage++) {
    const tile = tiles[[0, 0, 1, 1, 2, 2, 2, 3][stage]];
    add(`${key}_${stage}`, name, tile, 0, {
      ...plant(tile),
      placeable: false,
      cropStage: stage,
      cropNext: stage < 7 ? first + stage + 1 : undefined,
      drops: stage === 7 ? ripe : young,
      ...extra,
    });
  }
  return first;
}
const wall = (key: string, name: string, tex: number) =>
  add(key, name, tex, 2, { ...rock, occludes: false, model: { kind: 'wall' }, connects: 'wall' });
const woolAdj = (female: string) =>
  female === 'Голубая' ? 'Голубой' : female === 'Синяя' ? 'Синий' : female.replace(/ая$/, 'ый');
const WOOL_TILES = WOOL_COLORS.map(([color]) => TILE[`wool_${color}`]);
const ore = (key: string, name: string, tile: number, item: string, xp: [number, number]) =>
  add(key, name, tile, 3, { tool: 'pickaxe', tier: 3, drops: [{ item }], xp });
const storage = (
  key: string,
  name: string,
  tile: number,
  tier: 1 | 2 | 3,
  extra: Partial<BlockDefinition> = {},
) => add(key, name, tile, 5, { tool: 'pickaxe', tier, ...extra });

export const BLOCK_H = {
  EMERALD_ORE: ore('emerald_ore', 'Изумрудная руда', TILE.emerald_ore, 'lab:emerald', [3, 7]),
  EMERALD_BLOCK: storage('emerald_block', 'Изумрудный блок', TILE.emerald_block, 3),
  DIAMOND_BLOCK: storage('diamond_block', 'Алмазный блок', TILE.diamond_block, 3),
  COAL_BLOCK: storage('coal_block', 'Угольный блок', TILE.coal_block, 1, { fuelTicks: 16000 }),
  REDSTONE_BLOCK: storage('redstone_block', 'Блок редстоуна', TILE.redstone_block, 1),
  LAPIS_BLOCK: storage('lapis_block', 'Лазуритовый блок', TILE.lapis_block, 2, { hardness: 3 }),
  BRICKS: add('bricks', 'Кирпичи', TILE.bricks, 2, rock),
  BRICK_STAIRS: stairs(
    'brick_stairs',
    'Кирпичные ступени',
    [TILE.bricks, TILE.bricks, TILE.bricks],
    2,
    rock,
  ),
  BRICK_SLAB: slab(
    'brick_slab',
    'Кирпичная плита',
    [TILE.bricks, TILE.bricks, TILE.bricks],
    2,
    'bricks',
    rock,
  ),
  NETHER_BRICK_FENCE: add('nether_brick_fence', 'Забор из адского кирпича', 139, 2, {
    ...rock,
    occludes: false,
    model: { kind: 'fence' },
    connects: 'fence',
  }),
  NETHER_BRICK_STAIRS: stairs(
    'nether_brick_stairs',
    'Ступени из адского кирпича',
    [139, 139, 139],
    2,
    rock,
  ),
  QUARTZ_BLOCK: add(
    'quartz_block',
    'Кварцевый блок',
    [TILE.quartz_top, TILE.quartz_side, TILE.quartz_top],
    0.8,
    rock,
  ),
  QUARTZ_PILLAR: add(
    'quartz_pillar',
    'Кварцевая колонна',
    [TILE.quartz_pillar_top, TILE.quartz_pillar_side, TILE.quartz_pillar_top],
    0.8,
    rock,
  ),
  QUARTZ_STAIRS: stairs(
    'quartz_stairs',
    'Кварцевые ступени',
    [TILE.quartz_top, TILE.quartz_side, TILE.quartz_top],
    0.8,
    rock,
  ),
  QUARTZ_SLAB: slab(
    'quartz_slab',
    'Кварцевая плита',
    [TILE.quartz_top, TILE.quartz_side, TILE.quartz_top],
    0.8,
    'quartz_block',
    rock,
  ),
  /** Sixteen wools; the white one keeps the old key so the wool item becomes a block. */
  WOOL: WOOL_COLORS.map(([color, female], i) =>
    add(color === 'white' ? 'wool' : `${color}_wool`, `${female} шерсть`, WOOL_TILES[i], 0.8, {
      tool: 'sword',
      flammable: 30,
      burnTicks: 60,
    }),
  ),
  CARPET: WOOL_COLORS.map(([color, female], i) =>
    add(`${color}_carpet`, `${woolAdj(female)} ковёр`, WOOL_TILES[i], 0.1, {
      solid: false,
      occludes: false,
      model: { kind: 'layer', height: T16 },
      flammable: 60,
      burnTicks: 20,
    }),
  ),
  BIRCH_FENCE: fence('birch_fence', 'Берёзовый забор', TILE.birch_planks),
  JUNGLE_FENCE: fence('jungle_fence', 'Забор из тропического дерева', TILE.jungle_planks),
  BIRCH_STAIRS: stairs(
    'birch_stairs',
    'Берёзовые ступени',
    [TILE.birch_planks, TILE.birch_planks, TILE.birch_planks],
    2,
    planks,
  ),
  JUNGLE_STAIRS: stairs(
    'jungle_stairs',
    'Ступени из тропического дерева',
    [TILE.jungle_planks, TILE.jungle_planks, TILE.jungle_planks],
    2,
    planks,
  ),
  DARK_OAK_STAIRS: stairs(
    'dark_oak_stairs',
    'Ступени из тёмного дуба',
    [TILE.dark_oak_planks, TILE.dark_oak_planks, TILE.dark_oak_planks],
    2,
    planks,
  ),
  BIRCH_SLAB: slab(
    'birch_slab',
    'Берёзовая плита',
    [TILE.birch_planks, TILE.birch_planks, TILE.birch_planks],
    2,
    'birch_planks',
    planks,
  ),
  JUNGLE_SLAB: slab(
    'jungle_slab',
    'Плита из тропического дерева',
    [TILE.jungle_planks, TILE.jungle_planks, TILE.jungle_planks],
    2,
    'jungle_planks',
    planks,
  ),
  ACACIA_SLAB: slab(
    'acacia_slab',
    'Акациевая плита',
    [TILE.acacia_planks, TILE.acacia_planks, TILE.acacia_planks],
    2,
    'acacia_planks',
    planks,
  ),
  DARK_OAK_SLAB: slab(
    'dark_oak_slab',
    'Плита из тёмного дуба',
    [TILE.dark_oak_planks, TILE.dark_oak_planks, TILE.dark_oak_planks],
    2,
    'dark_oak_planks',
    planks,
  ),
  IRON_BARS: add(
    'iron_bars',
    'Железная решётка',
    [TILE.iron_bars, TILE.iron_bars, TILE.iron_bars],
    5,
    {
      tool: 'pickaxe',
      tier: 1,
      occludes: false,
      layer: 'cutout',
      model: { kind: 'pane' },
      connects: 'pane',
    },
  ),
  JACK_O_LANTERN: add('jack_o_lantern', 'Светильник Джека', [62, TILE.jack_o_lantern, 62], 1, {
    tool: 'axe',
    light: 15,
  }),
  SPRUCE_SAPLING: add(
    'spruce_sapling',
    'Саженец ели',
    TILE.spruce_sapling,
    0,
    plant(TILE.spruce_sapling, { sapling: 'spruce', flammable: 60 }),
  ),
  BIRCH_SAPLING: add(
    'birch_sapling',
    'Саженец берёзы',
    TILE.birch_sapling,
    0,
    plant(TILE.birch_sapling, { sapling: 'birch', flammable: 60 }),
  ),
  JUNGLE_SAPLING: add(
    'jungle_sapling',
    'Саженец тропического дерева',
    TILE.jungle_sapling,
    0,
    plant(TILE.jungle_sapling, { sapling: 'jungle', flammable: 60 }),
  ),
  ACACIA_SAPLING: add(
    'acacia_sapling',
    'Саженец акации',
    TILE.acacia_sapling,
    0,
    plant(TILE.acacia_sapling, { sapling: 'acacia', flammable: 60 }),
  ),
  DARK_OAK_SAPLING: add(
    'dark_oak_sapling',
    'Саженец тёмного дуба',
    TILE.dark_oak_sapling,
    0,
    plant(TILE.dark_oak_sapling, { sapling: 'dark_oak', flammable: 60 }),
  ),
  CARROTS: cropChain(
    'carrots',
    'Морковь',
    [TILE.carrots_0, TILE.carrots_1, TILE.carrots_2, TILE.carrots_3],
    [
      { item: 'lab:carrot' },
      { item: 'lab:carrot', chance: 60 },
      { item: 'lab:carrot', chance: 60 },
      { item: 'lab:carrot', chance: 40 },
    ],
    [{ item: 'lab:carrot' }],
  ),
  POTATOES: cropChain(
    'potatoes',
    'Картофель',
    [TILE.potatoes_0, TILE.potatoes_1, TILE.potatoes_2, TILE.potatoes_3],
    [
      { item: 'lab:potato' },
      { item: 'lab:potato', chance: 60 },
      { item: 'lab:potato', chance: 60 },
      { item: 'lab:potato', chance: 40 },
      { item: 'lab:poisonous_potato', chance: 2 },
    ],
    [{ item: 'lab:potato' }],
  ),
  BEETROOTS: cropChain(
    'beetroots',
    'Свёкла',
    [TILE.beetroots_0, TILE.beetroots_1, TILE.beetroots_2, TILE.beetroots_3],
    [
      { item: 'lab:beetroot' },
      { item: 'lab:beetroot_seeds' },
      { item: 'lab:beetroot_seeds', chance: 57 },
    ],
    [{ item: 'lab:beetroot_seeds' }],
  ),
  MELON_STEM: cropChain(
    'melon_stem',
    'Росток арбуза',
    [TILE.stem_0, TILE.stem_1, TILE.stem_2, TILE.stem_3],
    [{ item: 'lab:melon_seeds', chance: 60 }],
    [{ item: 'lab:melon_seeds', chance: 30 }],
    { stem: 'melon' },
  ),
  PUMPKIN_STEM: cropChain(
    'pumpkin_stem',
    'Росток тыквы',
    [TILE.stem_0, TILE.stem_1, TILE.stem_2, TILE.stem_3],
    [{ item: 'lab:pumpkin_seeds', chance: 60 }],
    [{ item: 'lab:pumpkin_seeds', chance: 30 }],
    { stem: 'pumpkin' },
  ),
  /** Seven cake states, from whole to one slice left. */
  CAKE: (() => {
    const first = nextExtraId;
    for (let bites = 0; bites < 7; bites++)
      add(
        bites === 0 ? 'cake' : `cake_${bites}`,
        'Торт',
        [TILE.cake_top, TILE.cake_side, TILE.cake_bottom],
        0.5,
        {
          occludes: false,
          layer: 'cutout',
          model: {
            kind: 'boxes',
            boxes: [[T16 + bites * 2 * T16, 0, T16, 15 * T16, 0.5, 15 * T16]],
          },
          base: first,
          placeable: bites === 0,
          bite: bites < 6 ? first + bites + 1 : 0,
          drops: [],
        },
      );
    return first;
  })(),
  LADDER: (() => {
    const first = nextExtraId;
    for (const facing of FACING_LIST)
      add(facing === 'north' ? 'ladder' : `ladder_${facing}`, 'Лестница', TILE.ladder, 0.4, {
        tool: 'axe',
        solid: false,
        occludes: false,
        layer: 'cutout',
        model: { kind: 'boxes', boxes: [againstSide(facing, 2 * T16)] },
        placement: 'ladder',
        base: first,
        placeable: facing === 'north',
        climbable: true,
        drops: [{ item: 'lab:ladder' }],
        flammable: 5,
      });
    return first;
  })(),
  OAK_TRAPDOOR: trapdoor('oak_trapdoor', 'Дубовый люк', TILE.oak_trapdoor, { ...planks }),
  OAK_FENCE_GATE: gate('oak_fence_gate', 'Дубовая калитка', 8),
  SPRUCE_FENCE_GATE: gate('spruce_fence_gate', 'Еловая калитка', TILE.spruce_planks),
  BIRCH_FENCE_GATE: gate('birch_fence_gate', 'Берёзовая калитка', TILE.birch_planks),
  COBBLESTONE_WALL: wall('cobblestone_wall', 'Булыжная стена', 9),
  MOSSY_COBBLESTONE_WALL: wall('mossy_cobblestone_wall', 'Мшистая булыжная стена', 129),
} as const;

export const BLOCKS: readonly BlockDefinition[] = Object.freeze([...BASE_BLOCKS, ...EXTRA_BLOCKS]);
/** Kept for the tooling that still expects a flat list of placeable defaults. */
export const HOTBAR = [
  BLOCK.PLANKS,
  BLOCK.LOG,
  BLOCK.COBBLE,
  BLOCK.DIRT,
  BLOCK.STONE,
  BLOCK.CRAFTING_TABLE,
  BLOCK.FURNACE,
  BLOCK.CHEST,
  BLOCK.GLASS,
] as const;
const AIR: BlockDefinition = BLOCKS[0];
export class BlockRegistry {
  private readonly byID = new Map<number, BlockDefinition>();
  private readonly byKey = new Map<string, BlockDefinition>();
  private readonly defs: readonly BlockDefinition[];
  constructor(defs: readonly BlockDefinition[]) {
    this.defs = defs;
    for (const def of defs) {
      if (
        !Number.isInteger(def.id) ||
        def.id < 0 ||
        def.id > 65535 ||
        this.byID.has(def.id) ||
        this.byKey.has(def.key)
      )
        throw new Error(`Invalid/duplicate block definition: ${def.key}`);
      this.byID.set(def.id, def);
      this.byKey.set(def.key, def);
    }
    if (!this.byID.has(0) || this.byID.get(0)?.solid)
      throw new Error('Registry requires non-solid air at ID 0');
  }
  get(id: number): BlockDefinition {
    const def = this.byID.get(id);
    if (!def) throw new Error(`Unknown block ID ${id}`);
    return def;
  }
  has(id: number): boolean {
    return this.byID.has(id);
  }
  find(key: string): BlockDefinition | undefined {
    return this.byKey.get(key);
  }
  get size(): number {
    return this.byID.size;
  }
  /** Every definition, in registration order; used by the atlas and by the diagnostics. */
  list(): readonly BlockDefinition[] {
    return this.defs;
  }
  get air(): BlockDefinition {
    return AIR;
  }
}
export const registry = new BlockRegistry(BLOCKS);
export const BLOCKS_BY_ITEM = new Map<string, BlockDefinition>();
for (const def of BLOCKS) if (def.placeable) BLOCKS_BY_ITEM.set(def.key, def);

/**
 * Boxes of a block at a position, for drawing, collision or picking. Full cubes answer one unit
 * box; plants and other non-solid shapes answer nothing for collision. Fences and panes read
 * their four neighbours: they join their own family and full solid blocks (panes also glass).
 */
export function blockBoxes(
  state: number,
  getBlock: (x: number, y: number, z: number) => number,
  x: number,
  y: number,
  z: number,
  purpose: 'render' | 'collision',
): readonly Box[] {
  const def = registry.get(state);
  if (!def.model) return def.solid || purpose === 'render' ? UNIT_BOX : NO_BOXES;
  let near: Neighbours | undefined;
  if (def.connects) {
    const joins = (other: number) => {
      const o = registry.get(other);
      return (
        o.connects === def.connects ||
        (o.solid && o.occludes && !o.model) ||
        (def.connects === 'pane' && o.key === 'lab:glass') ||
        (def.connects !== 'pane' && o.key.endsWith('_fence_gate'))
      );
    };
    near = {
      north: joins(getBlock(x, y, z - 1)),
      south: joins(getBlock(x, y, z + 1)),
      west: joins(getBlock(x - 1, y, z)),
      east: joins(getBlock(x + 1, y, z)),
    };
  }
  return purpose === 'render' ? renderBoxes(def.model, near) : collisionBoxes(def.model, near);
}
const UNIT_BOX: readonly Box[] = Object.freeze([[0, 0, 0, 1, 1, 1] as Box]);
const NO_BOXES: readonly Box[] = Object.freeze([]);

/* ------------------------------------------------------------------ oriented states */
const FACING_ORDER = ['north', 'east', 'south', 'west'] as const;
/** The stair state of a material for a facing and a half. `base` is the canonical state. */
export function stairsState(base: number, facing: Facing, half: 'bottom' | 'top'): number {
  return base + (half === 'top' ? 4 : 0) + FACING_ORDER.indexOf(facing);
}
export function slabState(base: number, half: 'bottom' | 'top'): number {
  return base + (half === 'top' ? 1 : 0);
}
export function doorState(base: number, facing: Facing, open: boolean, upper: boolean): number {
  return base + (upper ? 8 : 0) + (open ? 4 : 0) + FACING_ORDER.indexOf(facing);
}
/** The same door with its leaf swung the other way; both halves toggle together. */
export function toggledDoor(state: number): number {
  const def = registry.get(state);
  if (def.model?.kind !== 'door' || def.base === undefined) return state;
  return doorState(def.base, def.model.facing, !def.model.open, def.model.upper);
}
/** Ground that takes saplings and on which animals spawn: grass, dirt, podzol and the like. */
export function isSoil(state: number): boolean {
  return registry.has(state) && registry.get(state).soil === true;
}
