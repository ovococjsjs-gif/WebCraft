/** Items are a separate registry from blocks; both use original `lab:` keys. */
import {
  BLOCKS,
  BLOCK_H,
  FIRST_ROUND_H_BLOCK,
  FIRST_ROUND_I_BLOCK,
  registry as blocks,
} from './blocks';
import { DYE_COLORS, SPRITE_H } from './sprites-h';
import { EXTRA_DYES, I_SPRITE_COUNT, SPRITE_I } from './sprites-i';
export type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'sword' | 'hoe';
export interface ToolStats {
  readonly kind: ToolKind;
  readonly tier: 1 | 2 | 3 | 4;
  readonly speed: number;
  readonly durability: number;
}
export type ArmorSlot = 'head' | 'chest' | 'legs' | 'feet';
export interface ArmorStats {
  readonly slot: ArmorSlot;
  /** Armour points, the reference value that feeds the damage formula. */
  readonly points: number;
  readonly durability: number;
  /** Armour toughness; every piece in this build is iron, so it stays zero for now. */
  readonly toughness: number;
}
export interface FoodStats {
  readonly nutrition: number;
  readonly saturation: number;
  /** Status effect applied when the food is finished. */
  readonly effect?: {
    readonly id: string;
    readonly duration: number;
    readonly amplifier: number;
    /** Chance in percent that the effect is applied at all. */
    readonly chance: number;
  };
}
/** Melee numbers, kept apart from mining so a tool can be good at one and poor at the other. */
export interface AttackStats {
  readonly damage: number;
  /** Attacks per second; the charge bar refills over 1/speed seconds. */
  readonly speed: number;
}
export type UseKind =
  | 'bow'
  | 'shield'
  | 'bucket'
  | 'ignite'
  | 'drink'
  /** Fits an eye of ender into a portal frame. */
  | 'eye'
  /** Uses a crystal on the exit portal to call the dragon back. */
  | 'crystal'
  /** Thrown from the hand: an egg. */
  | 'throw'
  /** An empty glass bottle: filled at water. */
  | 'bottle'
  /** A fishing rod: cast into water, wait for a bite, reel in. */
  | 'fish'
  /** Compass and clock: tell the way home or the time of day. */
  | 'inspect';
/** A drinkable potion: the effect it applies and how long it lasts. */
export interface PotionStats {
  readonly effect: string;
  readonly duration: number;
  readonly amplifier: number;
  /** Instant potions heal or hurt at once instead of leaving a lasting effect. */
  readonly instant?: boolean;
}
/** Minecart size, so vehicles can be described without a whole new registry. */
export type CartKind = 'ride' | 'chest';
export interface ItemDefinition {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  readonly maxStack: number;
  /** Block placed by this item, when it is a block item. */
  readonly block?: number;
  /** Index in the item sprite atlas, for items that are not blocks. */
  readonly sprite?: number;
  readonly tool?: ToolStats;
  readonly armor?: ArmorStats;
  readonly food?: FoodStats;
  readonly attack?: AttackStats;
  /** Held right-click behaviour beyond eating and placing. */
  readonly use?: UseKind;
  /** Ticks of furnace fuel provided by one item. */
  readonly fuelTicks?: number;
  /** Wearing item without a tool kind: a shield or a bow. */
  readonly durability?: number;
  /** A bucket: what it picks up or pours out. */
  readonly bucket?: 'empty' | 'water' | 'lava';
  /** A potion the player can drink. */
  readonly potion?: PotionStats;
  /** A minecart the player can place on a rail and ride. */
  readonly cart?: CartKind;
  /** Enchantment carried by the item, applied to the numbers instead of to a name. */
  readonly enchant?: { readonly id: string; readonly level: number };
  /** Seeds and roots: the crop this item plants on farmland. */
  readonly plants?: number;
  /** What stays in the hand after the item is eaten: the bowl of a stew. */
  readonly leaves?: string;
}
/** Which armour slot an item belongs to, or -1 for anything that is not wearable. */
export function armorSlotIndex(item: ItemDefinition | undefined): number {
  const slot = item?.armor?.slot;
  return slot ? ARMOR_SLOT_ORDER.indexOf(slot) : -1;
}
/** Total durability of an item, whichever field carries it. */
export function itemDurability(item: ItemDefinition | undefined): number {
  if (!item) return 0;
  return item.tool?.durability ?? item.armor?.durability ?? item.durability ?? 0;
}
export const TOOL_MATERIALS = {
  wood: { tier: 1, speed: 2, durability: 59, prefix: 'Деревян', color: '#9c7a4a' },
  stone: { tier: 2, speed: 4, durability: 131, prefix: 'Каменн', color: '#8d9490' },
  iron: { tier: 3, speed: 6, durability: 250, prefix: 'Железн', color: '#cfd6d8' },
  diamond: { tier: 4, speed: 8, durability: 1561, prefix: 'Алмазн', color: '#5fe0d5' },
} as const;
export type ToolMaterial = keyof typeof TOOL_MATERIALS;
const SPRITE = {
  stick: 0,
  coal: 1,
  charcoal: 2,
  ironIngot: 3,
  woodPickaxe: 4,
  stonePickaxe: 5,
  ironPickaxe: 6,
  woodAxe: 7,
  stoneAxe: 8,
  ironAxe: 9,
  woodShovel: 10,
  stoneShovel: 11,
  ironShovel: 12,
  woodSword: 13,
  stoneSword: 14,
  ironSword: 15,
  apple: 16,
  rottenFlesh: 17,
  ironHelmet: 18,
  ironChestplate: 19,
  ironLeggings: 20,
  ironBoots: 21,
  shield: 22,
  bow: 23,
  arrow: 24,
  seeds: 25,
  wheat: 26,
  bread: 27,
  flint: 28,
  flintAndSteel: 29,
  redstone: 30,
  bucket: 31,
  waterBucket: 32,
  lavaBucket: 33,
  book: 34,
  paper: 35,
  leather: 36,
  potionWater: 37,
  potionHealing: 38,
  potionRegeneration: 39,
  potionFireResistance: 40,
  potionSwiftness: 41,
  potionStrength: 42,
  potionPoison: 43,
  goldenApple: 44,
  minecart: 45,
  chestMinecart: 46,
  fortune_pickaxe: 47,
  lapis: 48,
  woodHoe: 49,
  stoneHoe: 50,
  ironHoe: 51,
  bone: 52,
  boneMeal: 53,
  beef: 54,
  porkchop: 55,
  chickenMeat: 56,
  mutton: 57,
  feather: 58,
  wool: 59,
  carrot: 60,
  potionAwkward: 61,
  enderPearl: 62,
  eyeOfEnder: 63,
  quartz: 64,
  netherStar: 65,
  elytra: 66,
  skull: 67,
  crystal: 68,
  string: 69,
  egg: 70,
  shears: 71,
  milkBucket: 72,
  cookedBeef: 73,
  cookedPorkchop: 74,
  cookedChicken: 75,
  cookedMutton: 76,
  diamondPickaxe: 77,
  diamondAxe: 78,
  diamondShovel: 79,
  diamondSword: 80,
  diamondHoe: 81,
  diamondHelmet: 82,
  diamondChestplate: 83,
  diamondLeggings: 84,
  diamondBoots: 85,
  glassBottle: 86,
  slimeball: 87,
  magmaCream: 88,
  ghastTear: 89,
  spiderEye: 90,
} as const;
export const SPRITE_COUNT = I_SPRITE_COUNT;
/** The bare-handed numbers every attack starts from. */
export const FIST: AttackStats = { damage: 1, speed: 4 };
/** 1.12 armour points and durability for the iron set. */
export const IRON_ARMOR: Readonly<Record<ArmorSlot, ArmorStats>> = {
  head: { slot: 'head', points: 2, durability: 165, toughness: 0 },
  chest: { slot: 'chest', points: 6, durability: 240, toughness: 0 },
  legs: { slot: 'legs', points: 5, durability: 225, toughness: 0 },
  feet: { slot: 'feet', points: 2, durability: 195, toughness: 0 },
};
/** 1.12 diamond set: more points, toughness 2 and far more durability. */
export const DIAMOND_ARMOR: Readonly<Record<ArmorSlot, ArmorStats>> = {
  head: { slot: 'head', points: 3, durability: 363, toughness: 2 },
  chest: { slot: 'chest', points: 8, durability: 528, toughness: 2 },
  legs: { slot: 'legs', points: 6, durability: 495, toughness: 2 },
  feet: { slot: 'feet', points: 3, durability: 429, toughness: 2 },
};
/** Which player slot an armour piece belongs to: 36 head, 37 chest, 38 legs, 39 feet. */
export const ARMOR_SLOT_ORDER: readonly ArmorSlot[] = ['head', 'chest', 'legs', 'feet'];
/** Tool nouns with their grammatical gender, so the material adjective agrees: «каменная кирка», «каменный топор». */
const TOOL_NAMES: Record<ToolKind, [string, string, 'f' | 'm']> = {
  pickaxe: ['кирка', 'кирки', 'f'],
  axe: ['топор', 'топора', 'm'],
  shovel: ['лопата', 'лопаты', 'f'],
  sword: ['меч', 'меча', 'm'],
  hoe: ['мотыга', 'мотыги', 'f'],
};
function toolName(material: ToolMaterial, kind: ToolKind): string {
  const [noun, , gender] = TOOL_NAMES[kind];
  return `${TOOL_MATERIALS[material].prefix}${gender === 'f' ? 'ая' : 'ый'} ${noun}`;
}
const definitions: ItemDefinition[] = [];
let next = 0;
/**
 * Registers a block item. `blockKey` is only needed for blocks that have two states: the item
 * is called after the concept, while the world stores the off state.
 */
const blockItem = (key: string, fuelTicks?: number, blockKey = key): void => {
  const def = blocks.find(blockKey);
  if (!def) throw new Error(`Block item without a block: ${blockKey}`);
  definitions.push({
    id: next++,
    key,
    name: def.name,
    maxStack: 64,
    block: def.id,
    ...((fuelTicks ?? def.fuelTicks) ? { fuelTicks: fuelTicks ?? def.fuelTicks } : {}),
  });
};
const blockItemAliases: [string, string][] = [
  ['lab:redstone_torch', 'lab:redstone_torch_on'],
  ['lab:lever', 'lab:lever_off'],
  ['lab:button', 'lab:button_off'],
  ['lab:plate', 'lab:plate_off'],
  ['lab:repeater', 'lab:repeater_off'],
  ['lab:comparator', 'lab:comparator_off'],
  ['lab:lamp', 'lab:lamp_off'],
  ['lab:powered_rail', 'lab:powered_rail_off'],
  ['lab:detector_rail', 'lab:detector_rail_off'],
];
for (const [itemKey, blockKey] of blockItemAliases) blockItem(itemKey, undefined, blockKey);

for (const key of [
  'lab:grass',
  'lab:dirt',
  'lab:stone',
  'lab:sand',
  'lab:oak_log',
  'lab:oak_leaves',
  'lab:oak_planks',
  'lab:cobblestone',
  'lab:glass',
  'lab:dandelion',
  'lab:daisy',
  'lab:tall_grass',
  'lab:birch_log',
  'lab:coal_ore',
  'lab:iron_ore',
  'lab:crafting_table',
  'lab:furnace',
  'lab:smooth_stone',
  'lab:chest',
  'lab:bed',
  'lab:lava',
  /* E09 physical blocks, E10 farming, E12 stations and E13 mechanisms. */
  'lab:gravel',
  'lab:obsidian',
  'lab:torch',
  'lab:tnt',
  'lab:farmland',
  'lab:oak_sapling',
  'lab:sugar_cane',
  'lab:cactus',
  'lab:pumpkin',
  'lab:melon',
  'lab:enchanting_table',
  'lab:bookshelf',
  'lab:brewing_stand',
  'lab:anvil',
  'lab:redstone_ore',
  'lab:piston',
  'lab:sticky_piston',
  'lab:dispenser',
  'lab:dropper',
  'lab:hopper',
  'lab:rail',
  'lab:gold_ore',
  'lab:iron_block',
  'lab:gold_block',
  'lab:lapis_ore',
  /* E14: the biome generator places these, so they have to be real items too. */
  'lab:sandstone',
  'lab:snow',
  'lab:ice',
  'lab:diamond_ore',
  /* E14: the structure materials. */
  'lab:stone_bricks',
  'lab:mossy_cobblestone',
  'lab:spawner',
  /* E15: the blocks of the Nether and the End, and the portal frames. */
  'lab:nether_portal',
  'lab:end_portal_frame',
  'lab:end_portal',
  'lab:end_stone',
  'lab:glowstone',
  'lab:nether_quartz_ore',
  'lab:soul_sand',
  'lab:nether_brick',
  'lab:dragon_egg',
  'lab:end_stone_bricks',
  'lab:purpur',
  'lab:netherrack',
  'lab:magma',
  // The skull of a wither skeleton is an item that places the block of the same name.
  'lab:wither_skeleton_skull',
])
  blockItem(key);
const material = (key: string, name: string, sprite: number, fuelTicks?: number): void => {
  definitions.push({
    id: next++,
    key,
    name,
    maxStack: 64,
    sprite,
    ...(fuelTicks ? { fuelTicks } : {}),
  });
};
material('lab:stick', 'Палка', SPRITE.stick, 100);
material('lab:coal', 'Уголь', SPRITE.coal, 1600);
material('lab:charcoal', 'Древесный уголь', SPRITE.charcoal, 1600);
material('lab:iron_ingot', 'Железный слиток', SPRITE.ironIngot);
definitions.push({
  id: next++,
  key: 'lab:apple',
  name: 'Яблоко',
  maxStack: 64,
  sprite: SPRITE.apple,
  food: { nutrition: 4, saturation: 2.4 },
});
definitions.push({
  id: next++,
  key: 'lab:rotten_flesh',
  name: 'Гнилая плоть',
  maxStack: 64,
  sprite: SPRITE.rottenFlesh,
  food: {
    nutrition: 4,
    saturation: 0.8,
    // The reference gives hunger for 30 seconds in 80% of the cases.
    effect: { id: 'hunger', duration: 600, amplifier: 0, chance: 80 },
  },
});
for (const slot of ARMOR_SLOT_ORDER) {
  const stats = IRON_ARMOR[slot];
  const label: Record<ArmorSlot, string> = {
    head: 'Железный шлем',
    chest: 'Железный нагрудник',
    legs: 'Железные поножи',
    feet: 'Железные ботинки',
  };
  const sprite: Record<ArmorSlot, number> = {
    head: SPRITE.ironHelmet,
    chest: SPRITE.ironChestplate,
    legs: SPRITE.ironLeggings,
    feet: SPRITE.ironBoots,
  };
  definitions.push({
    id: next++,
    key: `lab:iron_${slot === 'legs' ? 'leggings' : slot === 'chest' ? 'chestplate' : slot === 'head' ? 'helmet' : 'boots'}`,
    name: label[slot],
    maxStack: 1,
    sprite: sprite[slot],
    armor: stats,
  });
}
definitions.push({
  id: next++,
  key: 'lab:shield',
  name: 'Щит',
  maxStack: 1,
  sprite: SPRITE.shield,
  use: 'shield',
  durability: 336,
});
definitions.push({
  id: next++,
  key: 'lab:bow',
  name: 'Лук',
  maxStack: 1,
  sprite: SPRITE.bow,
  use: 'bow',
  attack: { damage: 1, speed: 1 },
  durability: 384,
});
material('lab:arrow', 'Стрела', SPRITE.arrow);
material('lab:seeds', 'Семена пшеницы', SPRITE.seeds);
material('lab:wheat', 'Пшеница', SPRITE.wheat);
material('lab:flint', 'Кремень', SPRITE.flint);
material('lab:redstone', 'Редстоуновая пыль', SPRITE.redstone);
material('lab:paper', 'Бумага', SPRITE.paper);
material('lab:leather', 'Кожа', SPRITE.leather);
material('lab:lapis', 'Лазурит', SPRITE.lapis);
// The gem of the diamond ore.
material('lab:diamond', 'Алмаз', SPRITE_H.diamond);
material('lab:snowball', 'Снежок', SPRITE_H.snowball);
material('lab:gold_ingot', 'Золотой слиток', SPRITE_H.goldIngot);
material('lab:sugar', 'Сахар', SPRITE_H.sugar);
material('lab:gunpowder', 'Порох', SPRITE_H.gunpowder);
material('lab:string', 'Нить', SPRITE.string);
material('lab:blaze_rod', 'Огненный стержень', SPRITE_H.blazeRod);
material('lab:blaze_powder', 'Огненный порошок', SPRITE_H.blazePowder);
material('lab:ghast_tear', 'Слеза гаста', SPRITE.ghastTear);
material('lab:magma_cream', 'Магмовый крем', SPRITE.magmaCream);
material('lab:spider_eye', 'Паучий глаз', SPRITE.spiderEye);
material('lab:slimeball', 'Слизь', SPRITE.slimeball);
material('lab:nether_wart', 'Адский нарост', SPRITE_H.netherWart);
material('lab:bone', 'Кость', SPRITE.bone);
material('lab:bone_meal', 'Костная мука', SPRITE.boneMeal);
material('lab:feather', 'Перо', SPRITE.feather);
// Round H: wool is a block again, the white one of sixteen; the item keeps its id and key.
definitions.push({
  id: next++,
  key: 'lab:wool',
  name: 'Белая шерсть',
  maxStack: 64,
  block: BLOCK_H.WOOL[0],
});
// A carrot is eaten raw, as in the reference; it keeps its place so later ids stay put.
definitions.push({
  id: next++,
  key: 'lab:carrot',
  name: 'Морковь',
  maxStack: 64,
  sprite: SPRITE.carrot,
  food: { nutrition: 3, saturation: 3.6 },
  plants: BLOCK_H.CARROTS,
});
/* E15: the parts the two bosses and the two portals are made of. */
material('lab:nether_quartz', 'Кварц Нижнего мира', SPRITE.quartz);
material('lab:ender_pearl', 'Жемчуг Края', SPRITE.enderPearl);
material('lab:nether_star', 'Звезда Нижнего мира', SPRITE.netherStar);
material('lab:end_crystal', 'Кристалл Края', SPRITE.crystal);
material('lab:elytra', 'Элитры', SPRITE.elytra);
for (const food of [
  { key: 'lab:beef', name: 'Говядина', sprite: SPRITE.beef, nutrition: 3, saturation: 1.8 },
  { key: 'lab:porkchop', name: 'Свинина', sprite: SPRITE.porkchop, nutrition: 3, saturation: 1.8 },
  { key: 'lab:chicken', name: 'Курица', sprite: SPRITE.chickenMeat, nutrition: 2, saturation: 1.2 },
  { key: 'lab:mutton', name: 'Баранина', sprite: SPRITE.mutton, nutrition: 2, saturation: 1.2 },
])
  definitions.push({
    id: next++,
    key: food.key,
    name: food.name,
    maxStack: 64,
    sprite: food.sprite,
    food: { nutrition: food.nutrition, saturation: food.saturation },
  });
definitions.push({
  id: next++,
  key: 'lab:potion_awkward',
  name: 'Тусклое зелье',
  maxStack: 1,
  sprite: SPRITE.potionAwkward,
  use: 'drink',
});
definitions.push({
  id: next++,
  key: 'lab:bread',
  name: 'Хлеб',
  maxStack: 64,
  sprite: SPRITE.bread,
  food: { nutrition: 5, saturation: 6 },
});
definitions.push({
  id: next++,
  key: 'lab:golden_apple',
  name: 'Золотое яблоко',
  maxStack: 64,
  sprite: SPRITE.goldenApple,
  food: {
    nutrition: 4,
    saturation: 9.6,
    effect: { id: 'regeneration', duration: 100, amplifier: 1, chance: 100 },
  },
});
definitions.push({
  id: next++,
  key: 'lab:eye_of_ender',
  name: 'Око Края',
  maxStack: 64,
  sprite: SPRITE.eyeOfEnder,
  // Used on a portal frame to fit the eye, and thrown to find the stronghold.
  use: 'eye',
});
definitions.push({
  id: next++,
  key: 'lab:book',
  name: 'Книга',
  maxStack: 64,
  sprite: SPRITE.book,
});
definitions.push({
  id: next++,
  key: 'lab:flint_and_steel',
  name: 'Огниво',
  maxStack: 1,
  sprite: SPRITE.flintAndSteel,
  use: 'ignite',
  durability: 64,
});
for (const kind of [
  { key: 'lab:bucket', name: 'Ведро', sprite: SPRITE.bucket, bucket: 'empty' as const },
  {
    key: 'lab:water_bucket',
    name: 'Ведро воды',
    sprite: SPRITE.waterBucket,
    bucket: 'water' as const,
  },
  {
    key: 'lab:lava_bucket',
    name: 'Ведро лавы',
    sprite: SPRITE.lavaBucket,
    bucket: 'lava' as const,
  },
])
  definitions.push({
    id: next++,
    key: kind.key,
    name: kind.name,
    maxStack: 1,
    sprite: kind.sprite,
    use: 'bucket',
    bucket: kind.bucket,
  });
for (const potion of [
  {
    key: 'lab:potion_water',
    name: 'Бутылка воды',
    sprite: SPRITE.potionWater,
    stats: undefined,
  },
  {
    key: 'lab:potion_healing',
    name: 'Зелье исцеления',
    sprite: SPRITE.potionHealing,
    stats: { effect: 'instant_health', duration: 1, amplifier: 0, instant: true },
  },
  {
    key: 'lab:potion_regeneration',
    name: 'Зелье регенерации',
    sprite: SPRITE.potionRegeneration,
    stats: { effect: 'regeneration', duration: 900, amplifier: 0 },
  },
  {
    key: 'lab:potion_fire_resistance',
    name: 'Зелье огнестойкости',
    sprite: SPRITE.potionFireResistance,
    stats: { effect: 'fire_resistance', duration: 3600, amplifier: 0 },
  },
  {
    key: 'lab:potion_swiftness',
    name: 'Зелье скорости',
    sprite: SPRITE.potionSwiftness,
    stats: { effect: 'speed', duration: 3600, amplifier: 0 },
  },
  {
    key: 'lab:potion_strength',
    name: 'Зелье силы',
    sprite: SPRITE.potionStrength,
    stats: { effect: 'strength', duration: 3600, amplifier: 0 },
  },
  {
    key: 'lab:potion_poison',
    name: 'Зелье отравления',
    sprite: SPRITE.potionPoison,
    stats: { effect: 'poison', duration: 900, amplifier: 0 },
  },
] as const)
  definitions.push({
    id: next++,
    key: potion.key,
    name: potion.name,
    maxStack: 1,
    sprite: potion.sprite,
    use: 'drink',
    ...(potion.stats ? { potion: potion.stats } : {}),
  });
for (const cart of [
  { key: 'lab:minecart', name: 'Вагонетка', sprite: SPRITE.minecart, cart: 'ride' as const },
  {
    key: 'lab:chest_minecart',
    name: 'Вагонетка с сундуком',
    sprite: SPRITE.chestMinecart,
    cart: 'chest' as const,
  },
])
  definitions.push({
    id: next++,
    key: cart.key,
    name: cart.name,
    maxStack: 1,
    sprite: cart.sprite,
    cart: cart.cart,
  });
for (const materialKey of ['wood', 'stone', 'iron'] as const) {
  const stats = TOOL_MATERIALS[materialKey];
  // 1.12 melee damage and attack speed per material and tool kind.
  const melee: Record<ToolKind, Record<ToolMaterial, AttackStats>> = {
    sword: {
      wood: { damage: 4, speed: 1.6 },
      stone: { damage: 5, speed: 1.6 },
      iron: { damage: 6, speed: 1.6 },
      diamond: { damage: 7, speed: 1.6 },
    },
    axe: {
      wood: { damage: 7, speed: 1 },
      stone: { damage: 9, speed: 0.9 },
      iron: { damage: 9, speed: 0.9 },
      diamond: { damage: 9, speed: 1 },
    },
    pickaxe: {
      wood: { damage: 2, speed: 1.2 },
      stone: { damage: 3, speed: 1.2 },
      iron: { damage: 4, speed: 1.2 },
      diamond: { damage: 5, speed: 1.2 },
    },
    hoe: {
      wood: { damage: 1, speed: 1 },
      stone: { damage: 1, speed: 1 },
      iron: { damage: 1, speed: 1 },
      diamond: { damage: 1, speed: 1 },
    },
    shovel: {
      wood: { damage: 2.5, speed: 1 },
      stone: { damage: 3.5, speed: 1 },
      iron: { damage: 4.5, speed: 1 },
      diamond: { damage: 5.5, speed: 1 },
    },
  };
  const tools: [ToolKind, number][] = [
    [
      'pickaxe',
      SPRITE.woodPickaxe + (materialKey === 'wood' ? 0 : materialKey === 'stone' ? 1 : 2),
    ],
    ['axe', SPRITE.woodAxe + (materialKey === 'wood' ? 0 : materialKey === 'stone' ? 1 : 2)],
    ['shovel', SPRITE.woodShovel + (materialKey === 'wood' ? 0 : materialKey === 'stone' ? 1 : 2)],
    ['sword', SPRITE.woodSword + (materialKey === 'wood' ? 0 : materialKey === 'stone' ? 1 : 2)],
    ['hoe', SPRITE.woodHoe + (materialKey === 'wood' ? 0 : materialKey === 'stone' ? 1 : 2)],
  ];
  for (const [kind, sprite] of tools)
    definitions.push({
      id: next++,
      key: `lab:${materialKey}_${kind}`,
      name: toolName(materialKey, kind),
      maxStack: 1,
      sprite,
      tool: {
        kind,
        tier: stats.tier,
        speed: kind === 'sword' ? 1.5 : stats.speed,
        durability: stats.durability,
      },
      attack: melee[kind][materialKey],
      ...(materialKey === 'wood' && kind === 'pickaxe' ? { fuelTicks: 200 } : {}),
    });
}
/** The enchanted pickaxe carries a real enchantment instead of a longer name. */
definitions.push({
  id: next++,
  key: 'lab:fortune_pickaxe',
  name: 'Кирка удачи I',
  maxStack: 1,
  sprite: SPRITE.fortune_pickaxe,
  tool: { kind: 'pickaxe', tier: 3, speed: 6, durability: 250 },
  attack: { damage: 4, speed: 1.2 },
  enchant: { id: 'fortune', level: 1 },
});
/* 0.10: every placeable block of the new set is an item, appended so older ids stay put. */
for (const def of BLOCKS)
  if (
    def.id > 128 &&
    def.id < FIRST_ROUND_H_BLOCK &&
    def.placeable !== false &&
    !definitions.some((item) => item.key === def.key)
  )
    blockItem(def.key);
/* Mob pass 2: what the farm animals give. Appended last so every older id stays put. */
definitions.push(
  { id: next++, key: 'lab:egg', name: 'Яйцо', maxStack: 16, sprite: SPRITE.egg, use: 'throw' },
  {
    id: next++,
    key: 'lab:shears',
    name: 'Ножницы',
    maxStack: 1,
    sprite: SPRITE.shears,
    durability: 238,
  },
  {
    id: next++,
    key: 'lab:milk_bucket',
    name: 'Ведро молока',
    maxStack: 1,
    sprite: SPRITE.milkBucket,
    use: 'drink',
  },
);
/* Playthrough pass: cooked meat from the furnace, appended so every older id stays put. */
for (const food of [
  {
    key: 'lab:cooked_beef',
    name: 'Стейк',
    sprite: SPRITE.cookedBeef,
    nutrition: 8,
    saturation: 12.8,
  },
  {
    key: 'lab:cooked_porkchop',
    name: 'Жареная свинина',
    sprite: SPRITE.cookedPorkchop,
    nutrition: 8,
    saturation: 12.8,
  },
  {
    key: 'lab:cooked_chicken',
    name: 'Жареная курица',
    sprite: SPRITE.cookedChicken,
    nutrition: 6,
    saturation: 7.2,
  },
  {
    key: 'lab:cooked_mutton',
    name: 'Жареная баранина',
    sprite: SPRITE.cookedMutton,
    nutrition: 6,
    saturation: 9.6,
  },
])
  definitions.push({
    id: next++,
    key: food.key,
    name: food.name,
    maxStack: 64,
    sprite: food.sprite,
    food: { nutrition: food.nutrition, saturation: food.saturation },
  });
/* 0.10: the diamond tier, appended so older ids stay put. Diamonds finally have a use. */
{
  const stats = TOOL_MATERIALS.diamond;
  const melee: Record<ToolKind, AttackStats> = {
    pickaxe: { damage: 5, speed: 1.2 },
    axe: { damage: 9, speed: 1 },
    shovel: { damage: 5.5, speed: 1 },
    sword: { damage: 7, speed: 1.6 },
    hoe: { damage: 1, speed: 4 },
  };
  const sprites: Record<ToolKind, number> = {
    pickaxe: SPRITE.diamondPickaxe,
    axe: SPRITE.diamondAxe,
    shovel: SPRITE.diamondShovel,
    sword: SPRITE.diamondSword,
    hoe: SPRITE.diamondHoe,
  };
  for (const kind of ['pickaxe', 'axe', 'shovel', 'sword', 'hoe'] as const)
    definitions.push({
      id: next++,
      key: `lab:diamond_${kind}`,
      name: toolName('diamond', kind),
      maxStack: 1,
      sprite: sprites[kind],
      tool: {
        kind,
        tier: stats.tier,
        speed: kind === 'sword' ? 1.5 : stats.speed,
        durability: stats.durability,
      },
      attack: melee[kind],
    });
  const pieces: [ArmorSlot, string, string, number][] = [
    ['head', 'helmet', 'Алмазный шлем', SPRITE.diamondHelmet],
    ['chest', 'chestplate', 'Алмазный нагрудник', SPRITE.diamondChestplate],
    ['legs', 'leggings', 'Алмазные поножи', SPRITE.diamondLeggings],
    ['feet', 'boots', 'Алмазные ботинки', SPRITE.diamondBoots],
  ];
  for (const [slot, noun, name, sprite] of pieces)
    definitions.push({
      id: next++,
      key: `lab:diamond_${noun}`,
      name,
      maxStack: 1,
      sprite,
      armor: DIAMOND_ARMOR[slot],
    });
}
/* 0.10: the glass bottle, the way into brewing: filled at water, handed back after a potion. */
definitions.push({
  id: next++,
  key: 'lab:glass_bottle',
  name: 'Стеклянная бутылка',
  maxStack: 64,
  sprite: SPRITE.glassBottle,
  use: 'bottle',
});

/* ============================================================================ round H
 * The missing 1.12 items, appended so every older id stays put. */
{
  const food = (
    key: string,
    name: string,
    sprite: number,
    nutrition: number,
    saturation: number,
    extra: Partial<ItemDefinition> = {},
  ) =>
    definitions.push({
      id: next++,
      key,
      name,
      maxStack: 64,
      sprite,
      food: { nutrition, saturation },
      ...extra,
    });
  material('lab:emerald', 'Изумруд', SPRITE_H.emerald);
  material('lab:clay_ball', 'Комок глины', SPRITE_H.clayBall);
  material('lab:brick', 'Кирпич', SPRITE_H.brick);
  material('lab:netherbrick', 'Адский кирпич (предмет)', SPRITE_H.netherbrick);
  material('lab:glowstone_dust', 'Светящаяся пыль', SPRITE_H.glowstoneDust);
  material('lab:gold_nugget', 'Золотой самородок', SPRITE_H.goldNugget);
  material('lab:iron_nugget', 'Железный самородок', SPRITE_H.ironNugget);
  material('lab:bowl', 'Миска', SPRITE_H.bowl);
  food('lab:mushroom_stew', 'Грибной суп', SPRITE_H.mushroomStew, 6, 7.2, {
    maxStack: 1,
    leaves: 'lab:bowl',
  });
  food('lab:beetroot_soup', 'Свекольный суп', SPRITE_H.beetrootSoup, 6, 7.2, {
    maxStack: 1,
    leaves: 'lab:bowl',
  });
  food('lab:potato', 'Картофель', SPRITE_H.potato, 1, 0.6, { plants: BLOCK_H.POTATOES });
  food('lab:baked_potato', 'Печёный картофель', SPRITE_H.bakedPotato, 5, 6);
  definitions.push({
    id: next++,
    key: 'lab:poisonous_potato',
    name: 'Ядовитый картофель',
    maxStack: 64,
    sprite: SPRITE_H.poisonousPotato,
    food: {
      nutrition: 2,
      saturation: 1.2,
      effect: { id: 'poison', duration: 100, amplifier: 0, chance: 60 },
    },
  });
  food('lab:beetroot', 'Свёкла', SPRITE_H.beetroot, 1, 1.2);
  definitions.push({
    id: next++,
    key: 'lab:beetroot_seeds',
    name: 'Семена свёклы',
    maxStack: 64,
    sprite: SPRITE_H.beetrootSeeds,
    plants: BLOCK_H.BEETROOTS,
  });
  food('lab:melon_slice', 'Долька арбуза', SPRITE_H.melonSlice, 2, 1.2);
  definitions.push(
    {
      id: next++,
      key: 'lab:melon_seeds',
      name: 'Семена арбуза',
      maxStack: 64,
      sprite: SPRITE_H.melonSeeds,
      plants: BLOCK_H.MELON_STEM,
    },
    {
      id: next++,
      key: 'lab:pumpkin_seeds',
      name: 'Семена тыквы',
      maxStack: 64,
      sprite: SPRITE_H.pumpkinSeeds,
      plants: BLOCK_H.PUMPKIN_STEM,
    },
  );
  food('lab:pumpkin_pie', 'Тыквенный пирог', SPRITE_H.pumpkinPie, 8, 4.8);
  food('lab:cookie', 'Печенье', SPRITE_H.cookie, 2, 0.4);
  food('lab:golden_carrot', 'Золотая морковь', SPRITE_H.goldenCarrot, 6, 14.4);
  material('lab:speckled_melon', 'Сверкающий ломтик арбуза', SPRITE_H.speckledMelon);
  material('lab:fermented_spider_eye', 'Приготовленный паучий глаз', SPRITE_H.fermentedEye);
  food('lab:fish', 'Сырая треска', SPRITE_H.fish, 2, 0.4);
  food('lab:cooked_fish', 'Жареная треска', SPRITE_H.cookedFish, 5, 6);
  food('lab:salmon', 'Сырой лосось', SPRITE_H.salmon, 2, 0.4);
  food('lab:cooked_salmon', 'Жареный лосось', SPRITE_H.cookedSalmon, 6, 9.6);
  definitions.push(
    {
      id: next++,
      key: 'lab:fishing_rod',
      name: 'Удочка',
      maxStack: 1,
      sprite: SPRITE_H.fishingRod,
      use: 'fish',
      durability: 64,
      fuelTicks: 300,
    },
    {
      id: next++,
      key: 'lab:compass',
      name: 'Компас',
      maxStack: 64,
      sprite: SPRITE_H.compass,
      use: 'inspect',
    },
    {
      id: next++,
      key: 'lab:clock',
      name: 'Часы',
      maxStack: 64,
      sprite: SPRITE_H.clock,
      use: 'inspect',
    },
    // The cake is a block item drawn with its own sprite, one to a stack as in the reference.
    {
      id: next++,
      key: 'lab:cake',
      name: 'Торт',
      maxStack: 1,
      sprite: SPRITE_H.cake,
      block: BLOCK_H.CAKE,
    },
  );
  // Gold: fast and fragile, harvesting like wood.
  const goldMelee: Record<ToolKind, AttackStats> = {
    pickaxe: { damage: 2, speed: 1.2 },
    axe: { damage: 7, speed: 1 },
    shovel: { damage: 2.5, speed: 1 },
    sword: { damage: 4, speed: 1.6 },
    hoe: { damage: 1, speed: 1 },
  };
  const goldSprites: Record<ToolKind, number> = {
    pickaxe: SPRITE_H.goldPickaxe,
    axe: SPRITE_H.goldAxe,
    shovel: SPRITE_H.goldShovel,
    sword: SPRITE_H.goldSword,
    hoe: SPRITE_H.goldHoe,
  };
  for (const kind of ['pickaxe', 'axe', 'shovel', 'sword', 'hoe'] as const) {
    const [noun, , gender] = TOOL_NAMES[kind];
    definitions.push({
      id: next++,
      key: `lab:golden_${kind}`,
      name: `Золот${gender === 'f' ? 'ая' : 'ой'} ${noun}`,
      maxStack: 1,
      sprite: goldSprites[kind],
      tool: { kind, tier: 1, speed: kind === 'sword' ? 1.5 : 12, durability: 32 },
      attack: goldMelee[kind],
    });
  }
  // 1.12 armour points and durability of the gold, leather and chainmail sets.
  const sets: [string, [string, string, string, string], number, [number, number][]][] = [
    [
      'golden',
      ['Золотой шлем', 'Золотой нагрудник', 'Золотые поножи', 'Золотые ботинки'],
      SPRITE_H.goldHelmet,
      [
        [2, 77],
        [5, 112],
        [3, 105],
        [1, 91],
      ],
    ],
    [
      'leather',
      ['Кожаная шапка', 'Кожаная куртка', 'Кожаные штаны', 'Кожаные ботинки'],
      SPRITE_H.leatherHelmet,
      [
        [1, 55],
        [3, 80],
        [2, 75],
        [1, 65],
      ],
    ],
    [
      'chainmail',
      ['Кольчужный шлем', 'Кольчужная рубаха', 'Кольчужные поножи', 'Кольчужные ботинки'],
      SPRITE_H.chainHelmet,
      [
        [2, 165],
        [5, 240],
        [4, 225],
        [1, 195],
      ],
    ],
  ];
  const nouns = ['helmet', 'chestplate', 'leggings', 'boots'];
  for (const [material, names, firstSprite, stats] of sets)
    ARMOR_SLOT_ORDER.forEach((slot, i) =>
      definitions.push({
        id: next++,
        key: `lab:${material}_${nouns[i]}`,
        name: names[i],
        maxStack: 1,
        sprite: firstSprite + i,
        armor: { slot, points: stats[i][0], durability: stats[i][1], toughness: 0 },
      }),
    );
  DYE_COLORS.forEach(([color, name], i) => material(`lab:${color}_dye`, name, SPRITE_H.dye + i));
}
/* Round H blocks become items after the round H items, in registration order. */
for (const def of BLOCKS)
  if (
    def.id >= FIRST_ROUND_H_BLOCK &&
    def.id < FIRST_ROUND_I_BLOCK &&
    def.placeable !== false &&
    !definitions.some((item) => item.key === def.key)
  )
    blockItem(def.key);

/* ============================================================================ round I (0.13)
 * The missing dyes, the squid's ink and what a rabbit gives; then the round I blocks as items.
 * Appended last, so every older id stays put. */
{
  const dyeSprites = [SPRITE_I.grayDye, SPRITE_I.blackDye, SPRITE_I.brownDye];
  EXTRA_DYES.forEach(([color, name], i) => material(`lab:${color}_dye`, name, dyeSprites[i]));
  material('lab:ink_sac', 'Чернильный мешок', SPRITE_I.inkSac);
  const meat = (key: string, name: string, sprite: number, nutrition: number, saturation: number) =>
    definitions.push({
      id: next++,
      key,
      name,
      maxStack: 64,
      sprite,
      food: { nutrition, saturation },
    });
  meat('lab:raw_rabbit', 'Крольчатина', SPRITE_I.rawRabbit, 3, 1.8);
  meat('lab:cooked_rabbit', 'Жареная крольчатина', SPRITE_I.cookedRabbit, 5, 6);
  definitions.push({
    id: next++,
    key: 'lab:rabbit_stew',
    name: 'Рагу из кролика',
    maxStack: 1,
    sprite: SPRITE_I.rabbitStew,
    food: { nutrition: 10, saturation: 12 },
    leaves: 'lab:bowl',
  });
  material('lab:rabbit_hide', 'Кроличья шкурка', SPRITE_I.rabbitHide);
  material('lab:rabbit_foot', 'Кроличья лапка', SPRITE_I.rabbitFoot);
}
for (const def of BLOCKS)
  if (
    def.id >= FIRST_ROUND_I_BLOCK &&
    def.placeable !== false &&
    !definitions.some((item) => item.key === def.key)
  )
    blockItem(def.key);
export const ITEMS: readonly ItemDefinition[] = Object.freeze(
  definitions.map((def) => Object.freeze(def)),
);
export class ItemRegistry {
  private readonly byID = new Map<number, ItemDefinition>();
  private readonly byKey = new Map<string, ItemDefinition>();
  private readonly byBlock = new Map<number, ItemDefinition>();
  constructor(defs: readonly ItemDefinition[]) {
    for (const def of defs) {
      if (
        !Number.isInteger(def.id) ||
        def.id < 0 ||
        this.byID.has(def.id) ||
        this.byKey.has(def.key)
      )
        throw new Error(`Invalid/duplicate item definition: ${def.key}`);
      if (
        !Number.isInteger(def.maxStack) ||
        def.maxStack < 1 ||
        def.maxStack > 64 ||
        (def.maxStack > 1 && def.tool)
      )
        throw new Error(`Invalid stack size for ${def.key}`);
      this.byID.set(def.id, def);
      this.byKey.set(def.key, def);
      if (def.block !== undefined) {
        if (this.byBlock.has(def.block)) throw new Error(`Duplicate block item for ${def.key}`);
        this.byBlock.set(def.block, def);
      }
    }
  }
  get(id: number): ItemDefinition {
    const def = this.byID.get(id);
    if (!def) throw new Error(`Unknown item ID ${id}`);
    return def;
  }
  has(id: number): boolean {
    return this.byID.has(id);
  }
  find(key: string): ItemDefinition | undefined {
    return this.byKey.get(key);
  }
  ofBlock(block: number): ItemDefinition | undefined {
    const direct = this.byBlock.get(block);
    if (direct) return direct;
    // Oriented states (stairs, slabs, doors) answer to the item of their canonical state.
    const base = blocks.has(block) ? blocks.get(block).base : undefined;
    return base === undefined ? undefined : this.byBlock.get(base);
  }
  byKind(kind: ToolKind): ItemDefinition[] {
    return ITEMS.filter((item) => item.tool?.kind === kind);
  }
  get size(): number {
    return this.byID.size;
  }
}
export const itemRegistry = new ItemRegistry(ITEMS);
/** Drop rules live in the block registry, so a block may drop something other than itself. */
export function blockDrops(
  state: number,
): { item: ItemDefinition; count: number; chance: number }[] {
  const def = blocks.get(state);
  const rules = def.drops ?? [{ item: def.key }];
  return rules.map((rule) => {
    const item = itemRegistry.find(rule.item);
    if (!item) throw new Error(`Unknown drop item ${rule.item} for ${def.key}`);
    return { item, count: rule.count ?? 1, chance: rule.chance ?? 100 };
  });
}
/** Every item that can be produced, used by the recipe book and by creative tooling. */
export function itemKeyOfBlock(state: number): string | undefined {
  return blocks.get(state).key;
}
export { BLOCKS };
