import { describe, it, expect } from 'vitest';
import {
  RECIPES,
  RECIPE_VERSION,
  SMELTING,
  canCraft,
  consumeGrid,
  findRecipe,
  fuelTicks,
  gridResult,
  planFor,
  recipeBook,
  recipeById,
  recipeList,
  smeltingFor,
} from '../../packages/core/src/crafting';
import {
  ItemContainer,
  PlayerInventory,
  stack,
  type Slot,
} from '../../packages/core/src/inventory';

const grid = (size: 2 | 3, items: Record<number, Slot> = {}) => {
  const container = new ItemContainer(size * size, [
    { name: 'container', from: 0, to: size * size },
  ]);
  for (const [index, slot] of Object.entries(items)) container.set(Number(index), slot);
  return container;
};
const planks = (count = 1) => stack('lab:oak_planks', count);
const stick = (count = 1) => stack('lab:stick', count);

describe('recipe registry', () => {
  it('is versioned and self-consistent', () => {
    expect(RECIPE_VERSION).toBe(6);
    expect(recipeList().length).toBe(RECIPES.length);
    const ids = new Set(RECIPES.map((recipe) => recipe.id));
    expect(ids.size).toBe(RECIPES.length);
    for (const recipe of RECIPES) {
      expect(recipe.needs === 2 || recipe.needs === 3).toBe(true);
      expect(recipeById(recipe.id)).toBe(recipe);
    }
    // Shapeless: six plank kinds, bone meal, blaze powder, magma cream, the eye of ender, and
    // unpacking hay, iron and gold blocks; round H adds 38 more (storage blocks, nuggets, seeds,
    // soups, dyes and dyed wool); round I adds 22 (three dye mixes, sixteen concrete powders,
    // the slime, bone and sponge recipes and the leather of rabbit hides).
    expect(RECIPES.filter((recipe) => recipe.kind === 'shapeless').length).toBe(73);
    expect(recipeById('magma_cream')?.result).toEqual(['lab:magma_cream', 1]);
    expect(recipeById('bone_meal')?.result).toEqual(['lab:bone_meal', 3]);
  });
  it('names every tool of every material', () => {
    for (const material of ['wood', 'stone', 'iron'])
      for (const kind of ['pickaxe', 'axe', 'shovel', 'sword'])
        expect(recipeById(`${kind}_${material}`)).toBeTruthy();
  });
  it('knows which fuel burns for how long', () => {
    expect(fuelTicks('lab:coal')).toBe(1600);
    expect(fuelTicks('lab:charcoal')).toBe(1600);
    expect(fuelTicks('lab:stick')).toBe(100);
    expect(fuelTicks('lab:oak_planks')).toBe(300);
    expect(fuelTicks('lab:iron_ingot')).toBe(0);
  });
});

describe('2x2 and 3x3 crafting grids', () => {
  it('turns one log into four planks anywhere in the grid', () => {
    for (const index of [0, 1, 2, 3]) {
      const result = gridResult(grid(2, { [index]: stack('lab:oak_log') }), 2);
      expect(result?.item).toBe('lab:oak_planks');
      expect(result?.count).toBe(4);
    }
    expect(gridResult(grid(2, { 0: stack('lab:birch_log') }), 2)?.item).toBe('lab:birch_planks');
  });
  it('builds sticks from two planks and a table from four', () => {
    expect(gridResult(grid(2, { 0: planks(), 2: planks() }), 2)?.item).toBe('lab:stick');
    expect(
      gridResult(grid(2, { 0: planks(), 1: planks(), 2: planks(), 3: planks() }), 2)?.item,
    ).toBe('lab:crafting_table');
  });
  it('ignores empty rows and columns but not the intended shape', () => {
    expect(gridResult(grid(3, { 4: planks(), 7: planks() }), 3)?.item).toBe('lab:stick');
    expect(gridResult(grid(3, { 4: planks(), 5: planks() }), 3)?.item).toBeUndefined();
  });
  it('does not mirror shaped recipes', () => {
    // Axe: planks on the left column, sticks at the bottom. The mirror image must not match.
    const axe = grid(3, { 0: planks(), 1: planks(), 3: planks(), 4: stick(), 7: stick() });
    expect(gridResult(axe, 3)?.item).toBe('lab:wood_axe');
    const mirrored = grid(3, { 1: planks(), 2: planks(), 4: planks(), 3: stick(), 6: stick() });
    expect(gridResult(mirrored, 3)).toBeUndefined();
  });
  it('refuses 3x3 recipes in a 2x2 grid and counts two identical stacks as one ingredient', () => {
    const tiny = grid(2, { 0: planks(2) });
    expect(gridResult(tiny.slots, 2)).toBeUndefined();
    const doubled = grid(3, { 0: planks(2), 1: planks(2) });
    expect(gridResult(doubled.slots, 3)).toBeUndefined();
  });
  it('never returns a result for an empty grid', () => {
    expect(findRecipe(new Array<Slot>(4).fill(null), 2)).toBeUndefined();
    expect(gridResult([null, null, null, null], 2)).toBeUndefined();
  });
  it('consumes one item from every used slot and leaves leftovers', () => {
    const container = grid(3, { 0: planks(3), 1: planks(3), 3: stick(2), 6: stick(2) });
    consumeGrid(container, 3);
    expect(container.get(0)!.count).toBe(2);
    expect(container.get(3)!.count).toBe(1);
    consumeGrid(container, 3);
    expect(container.get(0)!.count).toBe(1);
    expect(container.get(3)).toBeNull();
    expect(container.get(6)).toBeNull();
  });
  it('returns a remainder item instead of consuming the ingredient', () => {
    const withRemainder = {
      kind: 'shapeless' as const,
      id: 'test:remainder',
      name: 'Тест',
      needs: 2 as const,
      ingredients: ['lab:coal'] as const,
      result: ['lab:stick', 1] as const,
      remainder: { swap: { 'lab:coal': 'lab:charcoal' } },
    };
    const container = grid(2, { 0: stack('lab:coal') });
    consumeGrid(container, 2, withRemainder.remainder);
    expect(container.get(0)?.item).toBe('lab:charcoal');
  });
  it('plans the exact layout the recipe book fills', () => {
    const pickaxe = recipeById('pickaxe_wood')!;
    const plan = planFor(pickaxe, 3);
    expect(plan).toHaveLength(5);
    expect(plan.map((entry) => entry.slot).sort()).toEqual([0, 1, 2, 4, 7]);
    const sticks = recipeById('stick')!;
    expect(planFor(sticks, 2).map((entry) => entry.slot)).toEqual([0, 2]);
    const shapeless = planFor(recipeById('planks_oak')!, 2);
    expect(shapeless).toEqual([{ slot: 0, item: 'lab:oak_log' }]);
  });
});

describe('recipe book', () => {
  it('marks what the inventory can build right now', () => {
    const bag = new PlayerInventory();
    const empty = recipeBook(bag);
    expect(empty.every((entry) => !entry.craftable)).toBe(true);
    bag.set(0, stack('lab:oak_log', 4));
    const withLogs = recipeBook(bag);
    expect(withLogs.find((entry) => entry.id === 'planks_oak')?.craftable).toBe(true);
    expect(withLogs.find((entry) => entry.id === 'crafting_table')?.craftable).toBe(false);
    expect(withLogs.find((entry) => entry.id === 'stick')?.craftable).toBe(false);
  });
  it('requires the full ingredient count, not just a similar item', () => {
    const bag = new PlayerInventory();
    bag.set(0, planks(3));
    bag.set(1, stick());
    expect(canCraft(recipeById('pickaxe_wood')!, bag)).toBe(false);
    bag.set(2, stick());
    expect(canCraft(recipeById('pickaxe_wood')!, bag)).toBe(true);
  });
  it('lists ingredients with names and counts for the interface', () => {
    const entry = recipeBook(new PlayerInventory()).find((recipe) => recipe.id === 'furnace')!;
    expect(entry.ingredients).toEqual([{ item: 'lab:cobblestone', count: 8 }]);
    expect(entry.needs).toBe(3);
  });
});

describe('furnace recipes', () => {
  it('smelts ore, sand, cobblestone and logs over the reference duration', () => {
    for (const recipe of SMELTING) expect(recipe.ticks).toBe(200);
    expect(smeltingFor(stack('lab:iron_ore'))?.result).toEqual(['lab:iron_ingot', 1]);
    expect(smeltingFor(stack('lab:sand'))?.result).toEqual(['lab:glass', 1]);
    expect(smeltingFor(stack('lab:cobblestone'))?.result).toEqual(['lab:stone', 1]);
    expect(smeltingFor(stack('lab:stone'))?.result).toEqual(['lab:smooth_stone', 1]);
    expect(smeltingFor(stack('lab:oak_log'))?.result).toEqual(['lab:charcoal', 1]);
    expect(smeltingFor(stack('lab:birch_log'))?.result).toEqual(['lab:charcoal', 1]);
    expect(smeltingFor(null)).toBeUndefined();
    expect(smeltingFor(stack('lab:iron_ingot'))).toBeUndefined();
    expect(smeltingFor(stack('lab:iron_ore'))?.xp).toBeGreaterThan(0);
  });
  it('crafts the iron armour pieces and the shield from the reference shapes', () => {
    const find = (id: string) => RECIPES.find((recipe) => recipe.id === id)!;
    expect(find('helmet_iron').result).toEqual(['lab:iron_helmet', 1]);
    expect(find('chestplate_iron').result).toEqual(['lab:iron_chestplate', 1]);
    expect(find('leggings_iron').result).toEqual(['lab:iron_leggings', 1]);
    expect(find('boots_iron').result).toEqual(['lab:iron_boots', 1]);
    const shield = find('shield');
    expect(shield.result).toEqual(['lab:shield', 1]);
    // Six planks and one ingot, in the familiar shield shape.
    const grid = new ItemContainer(9, [{ name: 'grid', from: 0, to: 9 }]);
    const layout: [number, string][] = [
      [0, 'lab:oak_planks'],
      [1, 'lab:iron_ingot'],
      [2, 'lab:oak_planks'],
      [3, 'lab:oak_planks'],
      [4, 'lab:oak_planks'],
      [5, 'lab:oak_planks'],
      [7, 'lab:oak_planks'],
    ];
    for (const [index, item] of layout) grid.set(index, stack(item));
    const match = findRecipe(grid, 3);
    expect(match?.id).toBe('shield');
    // Five ingots make a helmet, eight a chestplate, as the reference asks for.
    const book = recipeBook(new PlayerInventory());
    expect(book.find((recipe) => recipe.id === 'helmet_iron')!.ingredients).toEqual([
      { item: 'lab:iron_ingot', count: 5 },
    ]);
    expect(book.find((recipe) => recipe.id === 'chestplate_iron')!.ingredients).toEqual([
      { item: 'lab:iron_ingot', count: 8 },
    ]);
  });
});
