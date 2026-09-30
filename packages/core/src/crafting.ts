import { itemRegistry } from '../../content/src/items';
import type { Container, Slot } from './inventory';
/** Bumped whenever a recipe changes, so a save file can be rejected or migrated explicitly. */
export const RECIPE_VERSION = 6;
export interface RecipeRemainder {
  /** Item that replaces one ingredient when the recipe consumes it (empty buckets and similar). */
  readonly swap: Readonly<Record<string, string>>;
}
export interface ShapedRecipe {
  readonly kind: 'shaped';
  readonly id: string;
  readonly name: string;
  readonly rows: readonly string[];
  readonly key: Readonly<Record<string, string>>;
  readonly result: readonly [string, number];
  readonly needs: 2 | 3;
  readonly remainder?: RecipeRemainder;
}
export interface ShapelessRecipe {
  readonly kind: 'shapeless';
  readonly id: string;
  readonly name: string;
  readonly ingredients: readonly string[];
  readonly result: readonly [string, number];
  readonly needs: 2 | 3;
  readonly remainder?: RecipeRemainder;
}
export type Recipe = ShapedRecipe | ShapelessRecipe;
export interface SmeltingRecipe {
  readonly id: string;
  readonly name: string;
  readonly input: string;
  readonly result: readonly [string, number];
  readonly ticks: number;
  /** Experience granted for one smelted item; the survival stage spends it. */
  readonly xp: number;
  readonly remainder?: RecipeRemainder;
}
const shaped = (
  id: string,
  name: string,
  needs: 2 | 3,
  rows: readonly string[],
  key: Record<string, string>,
  result: [string, number],
): ShapedRecipe =>
  Object.freeze({ kind: 'shaped', id, name, needs, rows, key: Object.freeze(key), result });
const shapeless = (
  id: string,
  name: string,
  needs: 2 | 3,
  ingredients: readonly string[],
  result: [string, number],
): ShapelessRecipe => Object.freeze({ kind: 'shapeless', id, name, needs, ingredients, result });
/**
 * Ingredient tags: a key starting with `#` stands for a family of items, so sticks, tables,
 * chests and wooden tools take planks of any tree, as in the reference game.
 */
const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'] as const;
export const INGREDIENT_TAGS: Readonly<Record<string, { name: string; items: readonly string[] }>> =
  {
    '#planks': { name: 'Доски', items: WOODS.map((wood) => `lab:${wood}_planks`) },
    '#logs': { name: 'Брёвна', items: WOODS.map((wood) => `lab:${wood}_log`) },
  };
export function ingredientMatches(ingredient: string, item: string): boolean {
  if (ingredient === item) return true;
  return INGREDIENT_TAGS[ingredient]?.items.includes(item) ?? false;
}
/** A readable name for an ingredient or a tag. */
export function ingredientName(ingredient: string): string {
  return INGREDIENT_TAGS[ingredient]?.name ?? itemRegistry.find(ingredient)?.name ?? ingredient;
}
/** The item that shows a tag in the recipe book: the first member. */
export function ingredientIcon(ingredient: string): string {
  return INGREDIENT_TAGS[ingredient]?.items[0] ?? ingredient;
}
const PLANKS = '#planks';
const DYE_NAMES: Record<string, string> = {
  red: 'Красный краситель',
  yellow: 'Жёлтый краситель',
  green: 'Зелёный краситель',
  orange: 'Оранжевый краситель',
  pink: 'Розовый краситель',
  lime: 'Лаймовый краситель',
  light_blue: 'Голубой краситель',
  magenta: 'Пурпурный краситель',
  purple: 'Фиолетовый краситель',
  cyan: 'Бирюзовый краситель',
  light_gray: 'Светло-серый краситель',
};
const WOOL_NAMES: readonly [string, string][] = [
  ['white', 'Белая'],
  ['orange', 'Оранжевая'],
  ['magenta', 'Пурпурная'],
  ['light_blue', 'Голубая'],
  ['yellow', 'Жёлтая'],
  ['lime', 'Лаймовая'],
  ['pink', 'Розовая'],
  ['gray', 'Серая'],
  ['light_gray', 'Светло-серая'],
  ['cyan', 'Бирюзовая'],
  ['purple', 'Фиолетовая'],
  ['blue', 'Синяя'],
  ['brown', 'Коричневая'],
  ['green', 'Зелёная'],
  ['red', 'Красная'],
  ['black', 'Чёрная'],
];
const TOOL_MATERIALS: Record<string, string> = {
  wood: PLANKS,
  stone: 'lab:cobblestone',
  iron: 'lab:iron_ingot',
  diamond: 'lab:diamond',
};
const TOOL_LABELS: Record<string, string> = {
  wood: 'Деревянн',
  stone: 'Каменн',
  iron: 'Железн',
  diamond: 'Алмазн',
};
const toolRecipes = (): Recipe[] => {
  const recipes: Recipe[] = [];
  for (const [material, key] of Object.entries(TOOL_MATERIALS)) {
    const label = TOOL_LABELS[material];
    recipes.push(
      shaped(
        `pickaxe_${material}`,
        `${label}ая кирка`,
        3,
        ['MMM', ' S ', ' S '],
        { M: key, S: 'lab:stick' },
        [`lab:${material}_pickaxe`, 1],
      ),
      shaped(
        `axe_${material}`,
        `${label}ый топор`,
        3,
        ['MM ', 'MS ', ' S '],
        { M: key, S: 'lab:stick' },
        [`lab:${material}_axe`, 1],
      ),
      shaped(
        `shovel_${material}`,
        `${label}ая лопата`,
        3,
        ['M', 'S', 'S'],
        { M: key, S: 'lab:stick' },
        [`lab:${material}_shovel`, 1],
      ),
      shaped(
        `hoe_${material}`,
        `${label}ая мотыга`,
        3,
        ['MM', ' S', ' S'],
        { M: key, S: 'lab:stick' },
        [`lab:${material}_hoe`, 1],
      ),
      shaped(
        `sword_${material}`,
        `${label}ый меч`,
        3,
        ['M', 'M', 'S'],
        { M: key, S: 'lab:stick' },
        [`lab:${material}_sword`, 1],
      ),
    );
  }
  return recipes;
};
export const RECIPES: readonly Recipe[] = Object.freeze([
  ...plankRecipes(),
  shaped('stick', 'Палки', 2, ['P', 'P'], { P: PLANKS }, ['lab:stick', 4]),
  shaped('crafting_table', 'Верстак', 2, ['PP', 'PP'], { P: PLANKS }, ['lab:crafting_table', 1]),
  shaped('furnace', 'Печь', 3, ['CCC', 'C C', 'CCC'], { C: 'lab:cobblestone' }, ['lab:furnace', 1]),
  shaped('chest', 'Сундук', 3, ['PPP', 'P P', 'PPP'], { P: PLANKS }, ['lab:chest', 1]),
  ...toolRecipes(),
  ...armorRecipes(),
  ...utilityRecipes(),
  ...buildingRecipes(),
  ...roundHRecipes(),
]);

/** Every log gives four planks of its own tree. */
function plankRecipes(): Recipe[] {
  const names: Record<(typeof WOODS)[number], string> = {
    oak: 'Дубовые доски',
    spruce: 'Еловые доски',
    birch: 'Берёзовые доски',
    jungle: 'Доски тропического дерева',
    acacia: 'Доски акации',
    dark_oak: 'Доски тёмного дуба',
  };
  return WOODS.map((wood) =>
    shapeless(`planks_${wood}`, names[wood], 2, [`lab:${wood}_log`], [`lab:${wood}_planks`, 4]),
  );
}

/**
 * Building blocks and furniture found while playing: the bed, doors, fences, stairs, slabs,
 * bricks and panes. Shapes and yields are the reference ones.
 */
function buildingRecipes(): Recipe[] {
  const S = 'lab:stick';
  const recipes: Recipe[] = [
    shaped('bed', 'Кровать', 3, ['WWW', 'PPP'], { W: 'lab:wool', P: PLANKS }, ['lab:bed', 1]),
    shaped('stone_bricks', 'Каменный кирпич', 2, ['SS', 'SS'], { S: 'lab:stone' }, [
      'lab:stone_bricks',
      4,
    ]),
    shaped('sandstone', 'Песчаник', 2, ['SS', 'SS'], { S: 'lab:sand' }, ['lab:sandstone', 1]),
    shaped('smooth_sandstone', 'Гладкий песчаник', 2, ['SS', 'SS'], { S: 'lab:sandstone' }, [
      'lab:smooth_sandstone',
      4,
    ]),
    shaped('chiseled_sandstone', 'Резной песчаник', 2, ['S', 'S'], { S: 'lab:sandstone_slab' }, [
      'lab:chiseled_sandstone',
      1,
    ]),
    shaped('glass_pane', 'Стеклянная панель', 3, ['GGG', 'GGG'], { G: 'lab:glass' }, [
      'lab:glass_pane',
      16,
    ]),
    shaped('hay_block', 'Сноп сена', 3, ['WWW', 'WWW', 'WWW'], { W: 'lab:wheat' }, [
      'lab:hay_block',
      1,
    ]),
    shapeless('wheat_from_hay', 'Пшеница', 2, ['lab:hay_block'], ['lab:wheat', 9]),
    shaped('snow', 'Снежный блок', 2, ['SS', 'SS'], { S: 'lab:snowball' }, ['lab:snow', 1]),
    shapeless('iron_from_block', 'Железные слитки', 2, ['lab:iron_block'], ['lab:iron_ingot', 9]),
    shapeless('gold_from_block', 'Золотые слитки', 2, ['lab:gold_block'], ['lab:gold_ingot', 9]),
  ];
  const doors: [string, string, string][] = [
    ['oak', 'Дубовая дверь', 'lab:oak_planks'],
    ['spruce', 'Еловая дверь', 'lab:spruce_planks'],
    ['acacia', 'Дверь из акации', 'lab:acacia_planks'],
  ];
  for (const [wood, name, planks] of doors)
    recipes.push(
      shaped(`${wood}_door`, name, 3, ['PP', 'PP', 'PP'], { P: planks }, [`lab:${wood}_door`, 3]),
    );
  const fences: [string, string, string][] = [
    ['oak', 'Дубовый забор', 'lab:oak_planks'],
    ['spruce', 'Еловый забор', 'lab:spruce_planks'],
    ['acacia', 'Забор из акации', 'lab:acacia_planks'],
    ['dark_oak', 'Забор из тёмного дуба', 'lab:dark_oak_planks'],
  ];
  for (const [wood, name, planks] of fences)
    recipes.push(
      shaped(`${wood}_fence`, name, 3, ['PSP', 'PSP'], { P: planks, S }, [`lab:${wood}_fence`, 3]),
    );
  const stairs: [string, string, string][] = [
    ['oak_stairs', 'Дубовые ступени', 'lab:oak_planks'],
    ['spruce_stairs', 'Еловые ступени', 'lab:spruce_planks'],
    ['acacia_stairs', 'Ступени из акации', 'lab:acacia_planks'],
    ['cobblestone_stairs', 'Булыжные ступени', 'lab:cobblestone'],
    ['sandstone_stairs', 'Ступени из песчаника', 'lab:sandstone'],
    ['stone_brick_stairs', 'Ступени из каменного кирпича', 'lab:stone_bricks'],
  ];
  for (const [key, name, material] of stairs)
    recipes.push(shaped(key, name, 3, ['M  ', 'MM ', 'MMM'], { M: material }, [`lab:${key}`, 4]));
  const slabs: [string, string, string][] = [
    ['stone_slab', 'Каменная плита', 'lab:stone'],
    ['oak_slab', 'Дубовая плита', 'lab:oak_planks'],
    ['spruce_slab', 'Еловая плита', 'lab:spruce_planks'],
    ['cobblestone_slab', 'Булыжная плита', 'lab:cobblestone'],
    ['sandstone_slab', 'Плита из песчаника', 'lab:sandstone'],
    ['stone_brick_slab', 'Плита из каменного кирпича', 'lab:stone_bricks'],
  ];
  for (const [key, name, material] of slabs)
    recipes.push(shaped(key, name, 3, ['MMM'], { M: material }, [`lab:${key}`, 6]));
  return recipes;
}

/**
 * E09-E13 utility recipes: light, fire, buckets, mechanisms, redstone parts, brewing gear.
 * Every shape is the familiar one from the reference game.
 */
function utilityRecipes(): Recipe[] {
  const C = 'lab:coal';
  const I = 'lab:iron_ingot';
  const S = 'lab:stick';
  const P = PLANKS;
  const R = 'lab:redstone';
  const B = 'lab:cobblestone';
  const paper = 'lab:paper';
  return [
    shaped('torch', 'Факелы', 2, ['C', 'S'], { C, S }, ['lab:torch', 4]),
    shaped('flint_and_steel', 'Огниво', 2, ['I ', ' F'], { I, F: 'lab:flint' }, [
      'lab:flint_and_steel',
      1,
    ]),
    shaped('bucket', 'Ведро', 3, ['I I', ' I '], { I }, ['lab:bucket', 1]),
    shaped('shears', 'Ножницы', 2, [' I', 'I '], { I }, ['lab:shears', 1]),
    shaped('tnt', 'Динамит', 3, ['GSG', 'SGS', 'GSG'], { G: 'lab:sand', S: 'lab:redstone' }, [
      'lab:tnt',
      1,
    ]),
    shaped('rail', 'Рельсы', 3, ['I I', 'ISI', 'I I'], { I, S }, ['lab:rail', 16]),
    shaped('powered_rail', 'Энергорельсы', 3, ['I I', 'ISI', 'IRI'], { I, S, R }, [
      'lab:powered_rail',
      6,
    ]),
    shaped('detector_rail', 'Рельсы-датчик', 3, ['I I', 'IPI', 'IRI'], { I, P: 'lab:plate', R }, [
      'lab:detector_rail',
      6,
    ]),
    shaped('minecart', 'Вагонетка', 3, ['I I', 'III'], { I }, ['lab:minecart', 1]),
    shaped(
      'chest_minecart',
      'Вагонетка с сундуком',
      3,
      ['A', 'C'],
      { A: 'lab:minecart', C: 'lab:chest' },
      ['lab:chest_minecart', 1],
    ),
    shaped('hopper', 'Воронка', 3, ['I I', 'ICI', ' I '], { I, C: 'lab:chest' }, ['lab:hopper', 1]),
    shaped('piston', 'Поршень', 3, ['PPP', 'CIC', 'CIC'], { P, C: B, I }, ['lab:piston', 1]),
    shaped(
      'sticky_piston',
      'Липкий поршень',
      3,
      ['S', 'P'],
      { S: 'lab:slimeball', P: 'lab:piston' },
      ['lab:sticky_piston', 1],
    ),
    shaped('dispenser', 'Раздатчик', 3, ['BBB', 'BSB', 'BRB'], { B, S: 'lab:bow', R }, [
      'lab:dispenser',
      1,
    ]),
    shaped('dropper', 'Выбрасыватель', 3, ['BBB', 'B B', 'BRB'], { B, R }, ['lab:dropper', 1]),
    shaped('lever', 'Рычаг', 2, ['S', 'B'], { S, B }, ['lab:lever', 1]),
    shaped('button', 'Кнопка', 2, ['B'], { B: 'lab:stone' }, ['lab:button', 1]),
    shaped('plate', 'Нажимная плита', 2, ['BB'], { B: 'lab:stone' }, ['lab:plate', 1]),
    shaped('redstone_torch', 'Редстоуновый факел', 2, ['R', 'S'], { R, S }, [
      'lab:redstone_torch',
      1,
    ]),
    shaped(
      'repeater',
      'Повторитель',
      3,
      ['TRT', 'BBB'],
      { T: 'lab:redstone_torch', R, B: 'lab:stone' },
      ['lab:repeater', 1],
    ),
    shaped(
      'comparator',
      'Компаратор',
      3,
      [' T ', 'TQT', 'BBB'],
      {
        T: 'lab:redstone_torch',
        Q: 'lab:iron_ingot',
        B: 'lab:stone',
      },
      ['lab:comparator', 1],
    ),
    shaped('lamp', 'Редстоуновая лампа', 3, [' R ', 'RGR', ' R '], { R, G: 'lab:glowstone' }, [
      'lab:lamp',
      1,
    ]),
    shaped('bookshelf', 'Книжная полка', 3, ['PPP', 'BBB', 'PPP'], { P, B: 'lab:book' }, [
      'lab:bookshelf',
      1,
    ]),
    shaped('paper', 'Бумага', 3, ['SSS'], { S: 'lab:sugar_cane' }, ['lab:paper', 3]),
    shaped('book', 'Книга', 2, ['PP', 'L '], { P: paper, L: 'lab:leather' }, ['lab:book', 1]),
    shaped('bread', 'Хлеб', 3, ['WWW'], { W: 'lab:wheat' }, ['lab:bread', 1]),
    shaped('glass_bottle', 'Стеклянная бутылка', 3, ['G G', ' G '], { G: 'lab:glass' }, [
      'lab:glass_bottle',
      3,
    ]),
    shaped(
      'enchanting_table',
      'Стол зачарований',
      3,
      [' B ', 'DOD', 'OOO'],
      {
        B: 'lab:book',
        D: 'lab:diamond',
        O: 'lab:obsidian',
      },
      ['lab:enchanting_table', 1],
    ),
    shaped(
      'brewing_stand',
      'Варочная стойка',
      3,
      [' B ', 'III'],
      {
        B: 'lab:blaze_rod',
        I: 'lab:cobblestone',
      },
      ['lab:brewing_stand', 1],
    ),
    shaped('anvil', 'Наковальня', 3, ['III', ' I ', 'III'], { I: 'lab:iron_block' }, [
      'lab:anvil',
      1,
    ]),
    shaped(
      'golden_apple',
      'Золотое яблоко',
      3,
      ['GGG', 'GAG', 'GGG'],
      {
        G: 'lab:gold_ingot',
        A: 'lab:apple',
      },
      ['lab:golden_apple', 1],
    ),
    shaped('sugar', 'Сахар', 2, ['S'], { S: 'lab:sugar_cane' }, ['lab:sugar', 1]),
    shapeless('bone_meal', 'Костная мука', 2, ['lab:bone'], ['lab:bone_meal', 3]),
    shapeless('blaze_powder', 'Огненный порошок', 2, ['lab:blaze_rod'], ['lab:blaze_powder', 2]),
    shapeless(
      'magma_cream',
      'Магмовый крем',
      2,
      ['lab:slimeball', 'lab:blaze_powder'],
      ['lab:magma_cream', 1],
    ),
    shaped(
      'end_crystal',
      'Кристалл Края',
      3,
      ['GGG', 'GEG', 'GPG'],
      { G: 'lab:glass', E: 'lab:eye_of_ender', P: 'lab:ender_pearl' },
      ['lab:end_crystal', 1],
    ),
    shapeless(
      'eye_of_ender',
      'Око Края',
      2,
      ['lab:ender_pearl', 'lab:blaze_powder'],
      ['lab:eye_of_ender', 1],
    ),
    shaped('bow', 'Лук', 3, [' ST', 'S T', ' ST'], { S: 'lab:stick', T: 'lab:string' }, [
      'lab:bow',
      1,
    ]),
    shaped(
      'arrows',
      'Стрелы',
      3,
      ['F', 'S', 'P'],
      { F: 'lab:flint', S: 'lab:stick', P: 'lab:feather' },
      ['lab:arrow', 4],
    ),
    shaped('gold_block', 'Золотой блок', 3, ['GGG', 'GGG', 'GGG'], { G: 'lab:gold_ingot' }, [
      'lab:gold_block',
      1,
    ]),
    shaped('iron_block', 'Железный блок', 3, ['III', 'III', 'III'], { I }, ['lab:iron_block', 1]),
  ];
}

/** Iron armour and the shield: the reference shapes, five to eight ingots per piece. */
function armorRecipes(): Recipe[] {
  return [
    shaped('helmet_iron', 'Железный шлем', 3, ['III', 'I I'], { I: 'lab:iron_ingot' }, [
      'lab:iron_helmet',
      1,
    ]),
    shaped(
      'chestplate_iron',
      'Железный нагрудник',
      3,
      ['I I', 'III', 'III'],
      { I: 'lab:iron_ingot' },
      ['lab:iron_chestplate', 1],
    ),
    shaped('leggings_iron', 'Железные поножи', 3, ['III', 'I I', 'I I'], { I: 'lab:iron_ingot' }, [
      'lab:iron_leggings',
      1,
    ]),
    shaped('boots_iron', 'Железные ботинки', 3, ['I I', 'I I'], { I: 'lab:iron_ingot' }, [
      'lab:iron_boots',
      1,
    ]),
    shaped('helmet_diamond', 'Алмазный шлем', 3, ['DDD', 'D D'], { D: 'lab:diamond' }, [
      'lab:diamond_helmet',
      1,
    ]),
    shaped(
      'chestplate_diamond',
      'Алмазный нагрудник',
      3,
      ['D D', 'DDD', 'DDD'],
      { D: 'lab:diamond' },
      ['lab:diamond_chestplate', 1],
    ),
    shaped('leggings_diamond', 'Алмазные поножи', 3, ['DDD', 'D D', 'D D'], { D: 'lab:diamond' }, [
      'lab:diamond_leggings',
      1,
    ]),
    shaped('boots_diamond', 'Алмазные ботинки', 3, ['D D', 'D D'], { D: 'lab:diamond' }, [
      'lab:diamond_boots',
      1,
    ]),
    shaped('shield', 'Щит', 3, ['PIP', 'PPP', ' P '], { P: PLANKS, I: 'lab:iron_ingot' }, [
      'lab:shield',
      1,
    ]),
  ];
}
/**
 * Round H: gold tools and armour, leather armour, storage blocks, bricks, quartz, wool and dyes,
 * carpets, the other woods' fences, stairs and slabs, ladders, trapdoors, gates, walls, foods,
 * the fishing rod, the compass, the clock and the cake. Shapes and yields are the reference ones.
 */
function roundHRecipes(): Recipe[] {
  const S = 'lab:stick';
  const G = 'lab:gold_ingot';
  const nugget = 'lab:gold_nugget';
  const recipes: Recipe[] = [];
  const tools: [string, string, readonly string[]][] = [
    ['pickaxe', 'Золотая кирка', ['MMM', ' S ', ' S ']],
    ['axe', 'Золотой топор', ['MM ', 'MS ', ' S ']],
    ['shovel', 'Золотая лопата', ['M', 'S', 'S']],
    ['sword', 'Золотой меч', ['M', 'M', 'S']],
    ['hoe', 'Золотая мотыга', ['MM', ' S', ' S']],
  ];
  for (const [tool, name, rows] of tools)
    recipes.push(shaped(`${tool}_gold`, name, 3, rows, { M: G, S }, [`lab:golden_${tool}`, 1]));
  const armour: [string, readonly string[], 2 | 3][] = [
    ['helmet', ['MMM', 'M M'], 3],
    ['chestplate', ['M M', 'MMM', 'MMM'], 3],
    ['leggings', ['MMM', 'M M', 'M M'], 3],
    ['boots', ['M M', 'M M'], 3],
  ];
  const armourNames: Record<string, [string, string]> = {
    helmet: ['Золотой шлем', 'Кожаная шапка'],
    chestplate: ['Золотой нагрудник', 'Кожаная куртка'],
    leggings: ['Золотые поножи', 'Кожаные штаны'],
    boots: ['Золотые ботинки', 'Кожаные ботинки'],
  };
  for (const [piece, rows, needs] of armour) {
    const [gold, leather] = armourNames[piece];
    recipes.push(
      shaped(`${piece}_gold`, gold, needs, rows, { M: G }, [`lab:golden_${piece}`, 1]),
      shaped(`${piece}_leather`, leather, needs, rows, { M: 'lab:leather' }, [
        `lab:leather_${piece}`,
        1,
      ]),
    );
  }
  // Nine of a material pack into its block and the block breaks back into nine.
  const storage: [string, string, string, string][] = [
    ['emerald_block', 'Изумрудный блок', 'lab:emerald', 'Изумруды'],
    ['diamond_block', 'Алмазный блок', 'lab:diamond', 'Алмазы'],
    ['coal_block', 'Угольный блок', 'lab:coal', 'Уголь'],
    ['redstone_block', 'Блок редстоуна', 'lab:redstone', 'Редстоун'],
    ['lapis_block', 'Лазуритовый блок', 'lab:lapis', 'Лазурит'],
  ];
  for (const [block, name, material, materialName] of storage)
    recipes.push(
      shaped(block, name, 3, ['MMM', 'MMM', 'MMM'], { M: material }, [`lab:${block}`, 1]),
      shapeless(`${block}_back`, materialName, 2, [`lab:${block}`], [material, 9]),
    );
  recipes.push(
    shaped('gold_from_nuggets', 'Золотой слиток', 3, ['NNN', 'NNN', 'NNN'], { N: nugget }, [G, 1]),
    shapeless('gold_nuggets', 'Золотые самородки', 2, [G], [nugget, 9]),
    shaped(
      'iron_from_nuggets',
      'Железный слиток',
      3,
      ['NNN', 'NNN', 'NNN'],
      { N: 'lab:iron_nugget' },
      ['lab:iron_ingot', 1],
    ),
    shapeless('iron_nuggets', 'Железные самородки', 2, ['lab:iron_ingot'], ['lab:iron_nugget', 9]),
    shaped('clay_block', 'Глина', 2, ['CC', 'CC'], { C: 'lab:clay_ball' }, ['lab:clay', 1]),
    shaped('bricks', 'Кирпичи', 2, ['BB', 'BB'], { B: 'lab:brick' }, ['lab:bricks', 1]),
    shaped('nether_brick_block', 'Адский кирпич', 2, ['BB', 'BB'], { B: 'lab:netherbrick' }, [
      'lab:nether_brick',
      1,
    ]),
    shaped(
      'nether_brick_fence',
      'Забор из адского кирпича',
      3,
      ['BBB', 'BBB'],
      { B: 'lab:nether_brick' },
      ['lab:nether_brick_fence', 6],
    ),
    shaped('quartz_block', 'Кварцевый блок', 2, ['QQ', 'QQ'], { Q: 'lab:nether_quartz' }, [
      'lab:quartz_block',
      1,
    ]),
    shaped('quartz_pillar', 'Кварцевая колонна', 2, ['Q', 'Q'], { Q: 'lab:quartz_block' }, [
      'lab:quartz_pillar',
      2,
    ]),
    shaped('glowstone_block', 'Светокамень', 2, ['DD', 'DD'], { D: 'lab:glowstone_dust' }, [
      'lab:glowstone',
      1,
    ]),
    shaped('wool_from_string', 'Белая шерсть', 2, ['SS', 'SS'], { S: 'lab:string' }, [
      'lab:wool',
      1,
    ]),
    shaped('iron_bars', 'Железная решётка', 3, ['III', 'III'], { I: 'lab:iron_ingot' }, [
      'lab:iron_bars',
      16,
    ]),
    shaped(
      'jack_o_lantern',
      'Светильник Джека',
      2,
      ['P', 'T'],
      {
        P: 'lab:pumpkin',
        T: 'lab:torch',
      },
      ['lab:jack_o_lantern', 1],
    ),
    shaped('ladder', 'Лестница', 3, ['S S', 'SSS', 'S S'], { S }, ['lab:ladder', 3]),
    shaped('oak_trapdoor', 'Дубовый люк', 3, ['PPP', 'PPP'], { P: PLANKS }, [
      'lab:oak_trapdoor',
      2,
    ]),
    shaped('cobblestone_wall', 'Булыжная стена', 3, ['CCC', 'CCC'], { C: 'lab:cobblestone' }, [
      'lab:cobblestone_wall',
      6,
    ]),
    shaped(
      'mossy_cobblestone_wall',
      'Мшистая булыжная стена',
      3,
      ['CCC', 'CCC'],
      { C: 'lab:mossy_cobblestone' },
      ['lab:mossy_cobblestone_wall', 6],
    ),
    shaped('bowl', 'Миски', 3, ['P P', ' P '], { P: PLANKS }, ['lab:bowl', 4]),
    shapeless(
      'mushroom_stew',
      'Грибной суп',
      2,
      ['lab:bowl', 'lab:brown_mushroom', 'lab:red_mushroom'],
      ['lab:mushroom_stew', 1],
    ),
    shaped(
      'beetroot_soup',
      'Свекольный суп',
      3,
      ['BBB', 'BBB', ' W '],
      {
        B: 'lab:beetroot',
        W: 'lab:bowl',
      },
      ['lab:beetroot_soup', 1],
    ),
    shapeless(
      'pumpkin_pie',
      'Тыквенный пирог',
      3,
      ['lab:pumpkin', 'lab:sugar', 'lab:egg'],
      ['lab:pumpkin_pie', 1],
    ),
    shaped(
      'golden_carrot',
      'Золотая морковь',
      3,
      ['NNN', 'NCN', 'NNN'],
      {
        N: nugget,
        C: 'lab:carrot',
      },
      ['lab:golden_carrot', 1],
    ),
    shaped(
      'speckled_melon',
      'Сверкающий ломтик арбуза',
      3,
      ['NNN', 'NMN', 'NNN'],
      {
        N: nugget,
        M: 'lab:melon_slice',
      },
      ['lab:speckled_melon', 1],
    ),
    shapeless(
      'fermented_spider_eye',
      'Приготовленный паучий глаз',
      3,
      ['lab:spider_eye', 'lab:brown_mushroom', 'lab:sugar'],
      ['lab:fermented_spider_eye', 1],
    ),
    shaped('melon_block', 'Арбуз', 3, ['MMM', 'MMM', 'MMM'], { M: 'lab:melon_slice' }, [
      'lab:melon',
      1,
    ]),
    shapeless('melon_seeds', 'Семена арбуза', 2, ['lab:melon_slice'], ['lab:melon_seeds', 1]),
    shapeless('pumpkin_seeds', 'Семена тыквы', 2, ['lab:pumpkin'], ['lab:pumpkin_seeds', 4]),
    shaped('fishing_rod', 'Удочка', 3, ['  S', ' SW', 'S W'], { S, W: 'lab:string' }, [
      'lab:fishing_rod',
      1,
    ]),
    shaped(
      'compass',
      'Компас',
      3,
      [' I ', 'IRI', ' I '],
      {
        I: 'lab:iron_ingot',
        R: 'lab:redstone',
      },
      ['lab:compass', 1],
    ),
    shaped('clock', 'Часы', 3, [' G ', 'GRG', ' G '], { G, R: 'lab:redstone' }, ['lab:clock', 1]),
    Object.freeze({
      ...shaped(
        'cake',
        'Торт',
        3,
        ['MMM', 'SES', 'WWW'],
        {
          M: 'lab:milk_bucket',
          S: 'lab:sugar',
          E: 'lab:egg',
          W: 'lab:wheat',
        },
        ['lab:cake', 1],
      ),
      remainder: { swap: { 'lab:milk_bucket': 'lab:bucket' } },
    }),
  );
  // The other woods: fences, gates, stairs and slabs of their own planks.
  const woodNames: Record<string, [string, string, string, string]> = {
    birch: ['Берёзовый забор', 'Берёзовая калитка', 'Берёзовые ступени', 'Берёзовая плита'],
    jungle: [
      'Забор из тропического дерева',
      '',
      'Ступени из тропического дерева',
      'Плита из тропического дерева',
    ],
    dark_oak: ['', '', 'Ступени из тёмного дуба', 'Плита из тёмного дуба'],
    acacia: ['', '', '', 'Плита из акации'],
    oak: ['', 'Дубовая калитка', '', ''],
    spruce: ['', 'Еловая калитка', '', ''],
  };
  for (const [wood, [fence, gate, stairs, slab]] of Object.entries(woodNames)) {
    const P = `lab:${wood}_planks`;
    if (fence)
      recipes.push(
        shaped(`${wood}_fence`, fence, 3, ['PSP', 'PSP'], { P, S }, [`lab:${wood}_fence`, 3]),
      );
    if (gate)
      recipes.push(
        shaped(`${wood}_fence_gate`, gate, 3, ['SPS', 'SPS'], { P, S }, [
          `lab:${wood}_fence_gate`,
          1,
        ]),
      );
    if (stairs)
      recipes.push(
        shaped(`${wood}_stairs`, stairs, 3, ['M  ', 'MM ', 'MMM'], { M: P }, [
          `lab:${wood}_stairs`,
          4,
        ]),
      );
    if (slab)
      recipes.push(shaped(`${wood}_slab`, slab, 3, ['MMM'], { M: P }, [`lab:${wood}_slab`, 6]));
  }
  const stoneSets: [string, string, string, string][] = [
    ['brick', 'lab:bricks', 'Кирпичные ступени', 'Кирпичная плита'],
    ['nether_brick', 'lab:nether_brick', 'Ступени из адского кирпича', ''],
    ['quartz', 'lab:quartz_block', 'Кварцевые ступени', 'Кварцевая плита'],
  ];
  for (const [set, M, stairs, slab] of stoneSets) {
    recipes.push(
      shaped(`${set}_stairs`, stairs, 3, ['M  ', 'MM ', 'MMM'], { M }, [`lab:${set}_stairs`, 4]),
    );
    if (slab) recipes.push(shaped(`${set}_slab`, slab, 3, ['MMM'], { M }, [`lab:${set}_slab`, 6]));
  }
  // Dyes from flowers and from each other, as in the reference.
  const dye = (color: string) => `lab:${color}_dye`;
  const flowers: [string, string, string, number][] = [
    ['red_from_poppy', 'lab:poppy', 'red', 1],
    ['red_from_tulip', 'lab:red_tulip', 'red', 1],
    ['red_from_beetroot', 'lab:beetroot', 'red', 1],
    ['yellow_from_dandelion', 'lab:dandelion', 'yellow', 1],
    ['light_blue_from_orchid', 'lab:blue_orchid', 'light_blue', 1],
    ['magenta_from_allium', 'lab:allium', 'magenta', 1],
    ['light_gray_from_daisy', 'lab:daisy', 'light_gray', 1],
  ];
  for (const [id, flower, color, count] of flowers)
    recipes.push(shapeless(`dye_${id}`, DYE_NAMES[color], 2, [flower], [dye(color), count]));
  const white = 'lab:bone_meal',
    blue = 'lab:lapis';
  const mixes: [string, readonly string[]][] = [
    ['orange', [dye('red'), dye('yellow')]],
    ['pink', [dye('red'), white]],
    ['lime', [dye('green'), white]],
    ['light_blue', [blue, white]],
    ['purple', [dye('red'), blue]],
    ['cyan', [blue, dye('green')]],
    ['magenta', [dye('purple'), dye('pink')]],
  ];
  for (const [color, ingredients] of mixes)
    recipes.push(shapeless(`dye_${color}_mix`, DYE_NAMES[color], 2, ingredients, [dye(color), 2]));
  // White wool takes any dye; every wool gives carpets.
  const woolDyes: Record<string, string> = {
    blue,
    ...Object.fromEntries(Object.keys(DYE_NAMES).map((color) => [color, dye(color)])),
  };
  for (const [color, name] of WOOL_NAMES) {
    const wool = color === 'white' ? 'lab:wool' : `lab:${color}_wool`;
    if (woolDyes[color])
      recipes.push(
        shapeless(`wool_${color}`, `${name} шерсть`, 2, [woolDyes[color], 'lab:wool'], [wool, 1]),
      );
    recipes.push(
      shaped(`carpet_${color}`, `${name} ковёр`, 2, ['WW'], { W: wool }, [
        `lab:${color}_carpet`,
        3,
      ]),
    );
  }
  return recipes;
}
export const SMELTING: readonly SmeltingRecipe[] = Object.freeze([
  {
    id: 'iron_ingot',
    name: 'Железный слиток',
    input: 'lab:iron_ore',
    result: ['lab:iron_ingot', 1],
    ticks: 200,
    xp: 0.7,
  },
  { id: 'glass', name: 'Стекло', input: 'lab:sand', result: ['lab:glass', 1], ticks: 200, xp: 0.1 },
  {
    id: 'gold_ingot',
    name: 'Золотой слиток',
    input: 'lab:gold_ore',
    result: ['lab:gold_ingot', 1],
    ticks: 200,
    xp: 1,
  },
  // Cobblestone bakes back into stone, and stone into its smooth form: stone is what
  // buttons, pressure plates, repeaters and stone bricks are made of.
  {
    id: 'stone',
    name: 'Камень',
    input: 'lab:cobblestone',
    result: ['lab:stone', 1],
    ticks: 200,
    xp: 0.1,
  },
  {
    id: 'smooth_stone',
    name: 'Гладкий камень',
    input: 'lab:stone',
    result: ['lab:smooth_stone', 1],
    ticks: 200,
    xp: 0.1,
  },
  ...WOODS.map((wood): SmeltingRecipe => ({
    id: `charcoal_${wood}`,
    name: 'Древесный уголь',
    input: `lab:${wood}_log`,
    result: ['lab:charcoal', 1],
    ticks: 200,
    xp: 0.15,
  })),
  ...(
    [
      ['beef', 'Стейк', 'lab:cooked_beef'],
      ['porkchop', 'Жареная свинина', 'lab:cooked_porkchop'],
      ['chicken', 'Жареная курица', 'lab:cooked_chicken'],
      ['mutton', 'Жареная баранина', 'lab:cooked_mutton'],
    ] as const
  ).map(([raw, name, cooked]): SmeltingRecipe => ({
    id: `cooked_${raw}`,
    name,
    input: `lab:${raw}`,
    result: [cooked, 1],
    ticks: 200,
    xp: 0.35,
  })),
  ...(
    [
      ['baked_potato', 'Печёный картофель', 'lab:potato', 'lab:baked_potato', 0.35],
      ['cooked_fish', 'Жареная рыба', 'lab:fish', 'lab:cooked_fish', 0.35],
      ['cooked_salmon', 'Жареный лосось', 'lab:salmon', 'lab:cooked_salmon', 0.35],
      ['brick', 'Кирпич', 'lab:clay_ball', 'lab:brick', 0.3],
      ['netherbrick', 'Адский кирпич', 'lab:netherrack', 'lab:netherbrick', 0.1],
      ['green_dye', 'Зелёный краситель', 'lab:cactus', 'lab:green_dye', 1],
      ['terracotta', 'Терракота', 'lab:clay', 'lab:terracotta', 0.35],
      ['emerald', 'Изумруд', 'lab:emerald_ore', 'lab:emerald', 1],
      ['diamond', 'Алмаз', 'lab:diamond_ore', 'lab:diamond', 1],
      [
        'cracked_stone_bricks',
        'Потрескавшийся каменный кирпич',
        'lab:stone_bricks',
        'lab:cracked_stone_bricks',
        0.1,
      ],
    ] as const
  ).map(([id, name, input, result, xp]): SmeltingRecipe => ({
    id,
    name,
    input,
    result: [result, 1],
    ticks: 200,
    xp,
  })),
]);
export function smeltingFor(input: Slot): SmeltingRecipe | undefined {
  if (!input) return undefined;
  return SMELTING.find((recipe) => recipe.input === input.item);
}
export function fuelTicks(item: string): number {
  return itemRegistry.find(item)?.fuelTicks ?? 0;
}
export interface GridView {
  readonly size: 2 | 3;
  get(index: number): Slot;
}
/**
 * Trims empty rows and columns so a recipe can be placed anywhere inside the grid.
 * The pattern itself is trimmed the same way, which is why `['MM ', 'MS ', ' S ']`
 * matches the same shape as `['MM', 'MS', ' S']`.
 */
function trim<T>(cells: readonly T[], width: number, isEmpty: (cell: T) => boolean) {
  const height = Math.ceil(cells.length / width);
  let top = 0,
    bottom = height - 1,
    left = 0,
    right = width - 1;
  const emptyRow = (row: number) => {
    for (let column = 0; column < width; column++)
      if (!isEmpty(cells[row * width + column])) return false;
    return true;
  };
  const emptyColumn = (column: number) => {
    for (let row = 0; row < height; row++) if (!isEmpty(cells[row * width + column])) return false;
    return true;
  };
  while (top <= bottom && emptyRow(top)) top++;
  while (bottom >= top && emptyRow(bottom)) bottom--;
  while (left <= right && emptyColumn(left)) left++;
  while (right >= left && emptyColumn(right)) right--;
  if (top > bottom || left > right) return { cells: [] as T[], height: 0, width: 0 };
  const trimmed: T[] = [];
  for (let row = top; row <= bottom; row++)
    for (let column = left; column <= right; column++) trimmed.push(cells[row * width + column]);
  return { cells: trimmed, height: bottom - top + 1, width: right - left + 1 };
}
function matchesShaped(recipe: ShapedRecipe, cells: readonly Slot[], size: number): boolean {
  const width = Math.max(...recipe.rows.map((row) => row.length));
  const symbols: (string | null)[] = [];
  for (const row of recipe.rows)
    for (let column = 0; column < width; column++) {
      const symbol = row[column] ?? ' ';
      symbols.push(symbol === ' ' ? null : (recipe.key[symbol] ?? '?'));
    }
  const pattern = trim(symbols, width, (cell) => cell === null);
  const grid = trim([...cells], size, (slot) => !slot);
  if (pattern.height !== grid.height || pattern.width !== grid.width) return false;
  for (let i = 0; i < pattern.cells.length; i++) {
    const slot = grid.cells[i];
    const item = pattern.cells[i];
    if (item === null) {
      if (slot) return false;
      continue;
    }
    // Any stack counts as one ingredient; crafting takes one item from every used slot.
    if (!slot || !ingredientMatches(item, slot.item) || slot.count < 1) return false;
  }
  return true;
}
function matchesShapeless(recipe: ShapelessRecipe, cells: Slot[]): boolean {
  const needed = [...recipe.ingredients];
  for (const slot of cells) {
    if (!slot) continue;
    const index = needed.findIndex((ingredient) => ingredientMatches(ingredient, slot.item));
    if (index < 0 || slot.count < 1) return false;
    needed.splice(index, 1);
  }
  return needed.length === 0;
}
/**
 * Finds the recipe for a crafting grid. The reference game does not mirror shaped
 * recipes, so neither do we: an axe must be built facing the same way.
 */
/** Accepts a bare slot array or any container, so tests and the simulation share one path. */
function toCells(input: Container | readonly Slot[]): readonly Slot[] {
  if (Array.isArray(input)) return input;
  const container = input as Container;
  const cells: Slot[] = [];
  for (let i = 0; i < container.size; i++) cells.push(container.get(i));
  return cells;
}
export function findRecipe(input: Container | readonly Slot[], size: 2 | 3): Recipe | undefined {
  const cells = toCells(input);
  if (!cells.some(Boolean)) return undefined;
  for (const recipe of RECIPES) {
    if (recipe.needs > size) continue;
    if (
      recipe.kind === 'shaped'
        ? matchesShaped(recipe, [...cells], size)
        : matchesShapeless(recipe, [...cells])
    )
      return recipe;
  }
  return undefined;
}
export interface CraftResult {
  readonly recipe: Recipe;
  readonly item: string;
  readonly count: number;
}
export function gridResult(
  input: Container | readonly Slot[],
  size: 2 | 3,
): CraftResult | undefined {
  const recipe = findRecipe(input, size);
  if (!recipe) return undefined;
  return { recipe, item: recipe.result[0], count: recipe.result[1] };
}
/**
 * Consumes one set of ingredients from every non-empty grid slot. Ingredients with a
 * remainder (an empty bucket and similar) leave that item behind instead of vanishing.
 */
export function consumeGrid(grid: Container, size: 2 | 3, remainder?: RecipeRemainder): void {
  const swap = remainder?.swap ?? {};
  for (let i = 0; i < size * size; i++) {
    const slot = grid.get(i);
    if (!slot) continue;
    if (slot.count > 1) {
      grid.set(i, { ...slot, count: slot.count - 1 });
      continue;
    }
    const left = swap[slot.item];
    grid.set(i, left ? { item: left, count: 1, ...(slot.damage ? { damage: 0 } : {}) } : null);
  }
}
/** Positions for the recipe book: which slot must receive which item. */
export function planFor(recipe: Recipe, size: 2 | 3): { slot: number; item: string }[] {
  if (recipe.kind === 'shapeless')
    return recipe.ingredients.map((item, index) => ({ slot: index, item }));
  const plan: { slot: number; item: string }[] = [];
  recipe.rows.forEach((row, y) =>
    [...row].forEach((symbol, x) => {
      if (symbol === ' ') return;
      plan.push({ slot: y * size + x, item: recipe.key[symbol] });
    }),
  );
  return plan;
}
/** True when the player inventory holds every ingredient at least once. */
export function canCraft(recipe: Recipe, inventory: Container): boolean {
  const needed = new Map<string, number>();
  if (recipe.kind === 'shapeless')
    for (const item of recipe.ingredients) needed.set(item, (needed.get(item) ?? 0) + 1);
  else
    for (const [symbol, item] of Object.entries(recipe.key))
      needed.set(item, (needed.get(item) ?? 0) + countSymbol(recipe.rows, symbol));
  for (const [item, amount] of needed) if (countIn(inventory, item) < amount) return false;
  return true;
}
function countSymbol(rows: readonly string[], symbol: string): number {
  let total = 0;
  for (const row of rows) for (const cell of row) if (cell === symbol) total++;
  return total;
}
function countIn(inventory: Container, item: string): number {
  let total = 0;
  for (let i = 0; i < inventory.size; i++) {
    const slot = inventory.get(i);
    if (slot && ingredientMatches(item, slot.item)) total += slot.count;
  }
  return total;
}
export interface RecipeEntry {
  readonly id: string;
  readonly name: string;
  readonly item: string;
  readonly count: number;
  readonly needs: 2 | 3;
  readonly craftable: boolean;
  readonly ingredients: readonly { item: string; count: number }[];
}
/** Recipe book contents: everything the player could build right now. */
export function recipeBook(inventory: Container): RecipeEntry[] {
  return RECIPES.map((recipe) => {
    const ingredients = new Map<string, number>();
    if (recipe.kind === 'shapeless')
      for (const item of recipe.ingredients)
        ingredients.set(item, (ingredients.get(item) ?? 0) + 1);
    else
      for (const [symbol, item] of Object.entries(recipe.key))
        ingredients.set(item, countSymbol(recipe.rows, symbol));
    return {
      id: recipe.id,
      name: recipe.name,
      item: recipe.result[0],
      count: recipe.result[1],
      needs: recipe.needs,
      craftable: canCraft(recipe, inventory),
      ingredients: [...ingredients].map(([item, count]) => ({ item, count })),
    };
  });
}
export function recipeById(id: string): Recipe | undefined {
  return RECIPES.find((recipe) => recipe.id === id);
}
/** Convenience for tooling and tests: the full recipe list with display names. */
export function recipeList(): { id: string; name: string; result: string; count: number }[] {
  return RECIPES.map((recipe) => ({
    id: recipe.id,
    name: recipe.name,
    result: recipe.result[0],
    count: recipe.result[1],
  }));
}
export const STARTER_RECIPE_COUNT = RECIPES.length;
export const DEFAULT_SMELT_TICKS = 200;
