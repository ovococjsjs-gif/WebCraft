import { mergeEnchantments, type EnchantmentId } from './item-metadata';
/**
 * Character progression: the enchanting table, the brewing stand and the anvil.
 *
 * Gameplay enchantments belong to item instances. The legacy map remains only as a codec
 * compatibility helper and never upgrades new items of the same catalogue kind.
 */
import { itemRegistry, type ItemDefinition } from '../../content/src/items';
import type { Container, Slot, SlotRegion } from './inventory';

export type EnchantTarget =
  'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword' | 'bow' | 'boots' | 'armor' | 'any';

export interface EnchantmentDefinition {
  readonly id: string;
  readonly name: string;
  readonly maxLevel: number;
  readonly targets: readonly EnchantTarget[];
  /** Levels of experience the offer costs, multiplied by the level of the enchantment. */
  readonly cost: number;
  /** Ticks the table works before the enchantment lands. */
  readonly duration: number;
}

export const ENCHANTMENTS: readonly EnchantmentDefinition[] = Object.freeze([
  {
    id: 'efficiency',
    name: 'Эффективность',
    maxLevel: 3,
    targets: ['pickaxe', 'axe', 'shovel', 'hoe'],
    cost: 1,
    duration: 60,
  },
  {
    id: 'sharpness',
    name: 'Острота',
    maxLevel: 3,
    targets: ['sword', 'axe'],
    cost: 1,
    duration: 60,
  },
  {
    id: 'fortune',
    name: 'Удача',
    maxLevel: 2,
    targets: ['pickaxe', 'shovel', 'axe'],
    cost: 2,
    duration: 90,
  },
  { id: 'unbreaking', name: 'Прочность', maxLevel: 3, targets: ['any'], cost: 1, duration: 60 },
  { id: 'protection', name: 'Защита', maxLevel: 3, targets: ['armor'], cost: 1, duration: 60 },
  { id: 'power', name: 'Сила', maxLevel: 3, targets: ['bow'], cost: 2, duration: 90 },
  {
    id: 'feather_falling',
    name: 'Невесомость',
    maxLevel: 3,
    targets: ['boots'],
    cost: 2,
    duration: 90,
  },
]);
/** One lapis lazuli per offered enchantment, exactly as many as the table slots show. */
export const ENCHANT_LAPIS_PER_OFFER = 1;
export const ENCHANT_OFFERS = 3;

export interface EnchantOffer {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly cost: number;
}

export interface SavedEnchantment {
  readonly item: string;
  readonly id: string;
  readonly level: number;
}

export class EnchantmentTable {
  private readonly entries = new Map<string, { id: string; level: number }>();

  static targetOf(item: ItemDefinition | undefined): EnchantTarget {
    if (!item) return 'any';
    if (item.tool) return item.tool.kind;
    if (item.armor) return item.armor.slot === 'feet' ? 'boots' : 'armor';
    if (item.use === 'bow') return 'bow';
    return 'any';
  }

  /** The three offers a table shows for an item, drawn deterministically from the seed. */
  offers(item: ItemDefinition | undefined, random: () => number): EnchantOffer[] {
    const target = EnchantmentTable.targetOf(item);
    const pool = ENCHANTMENTS.filter(
      (entry) =>
        entry.targets.includes('any') ||
        entry.targets.includes(target) ||
        (target === 'boots' && entry.targets.includes('armor')),
    );
    // Three distinct offers, drawn in a random order: a repeated draw never eats a slot.
    const remaining = [...pool];
    const offers: EnchantOffer[] = [];
    while (offers.length < ENCHANT_OFFERS && remaining.length) {
      const index = Math.min(remaining.length - 1, Math.floor(random() * remaining.length));
      const entry = remaining.splice(index, 1)[0];
      const level = 1 + Math.floor(random() * entry.maxLevel);
      offers.push({
        id: entry.id,
        name: entry.name,
        level,
        cost: entry.cost * level,
      });
    }
    return offers;
  }

  get(itemKey: string): { id: string; level: number } | undefined {
    return this.entries.get(itemKey);
  }

  /** Legacy migration helper only. Gameplay writes onto the selected stack, never this map. */
  apply(itemKey: string, offer: EnchantOffer): boolean {
    const definition = ENCHANTMENTS.find((entry) => entry.id === offer.id);
    if (!definition) return false;
    const known = this.entries.get(itemKey);
    if (known && known.id === offer.id && known.level >= offer.level) return false;
    this.entries.set(itemKey, { id: offer.id, level: Math.min(offer.level, definition.maxLevel) });
    return true;
  }

  /** Enchantment an item carries: the table's knowledge, or the one baked into the item. */
  of(item: ItemDefinition | undefined): { id: string; level: number } | undefined {
    if (!item) return undefined;
    return this.entries.get(item.key) ?? item.enchant ?? undefined;
  }

  private level(id: EnchantmentId, item: ItemDefinition | undefined, instance?: Slot): number {
    if (!item) return 0;
    const inherent = item.enchant?.id === id ? item.enchant.level : 0;
    if (instance !== undefined) return Math.max(instance?.enchantments?.[id] ?? 0, inherent);
    const legacy = this.entries.get(item.key);
    return Math.max(legacy?.id === id ? legacy.level : 0, inherent);
  }
  miningScale(item: ItemDefinition | undefined, instance?: Slot): number {
    return 1 + 0.1 * this.level('efficiency', item, instance);
  }
  fortuneLevel(item: ItemDefinition | undefined, instance?: Slot): number {
    return this.level('fortune', item, instance);
  }
  attackBonus(item: ItemDefinition | undefined, instance?: Slot): number {
    const level = this.level('sharpness', item, instance);
    return level ? 0.5 * level + 0.5 : 0;
  }
  unbreakingChance(item: ItemDefinition | undefined, instance?: Slot): number {
    const level = this.level('unbreaking', item, instance);
    return (100 * level) / (level + 1);
  }
  armorBonus(item: ItemDefinition | undefined, instance?: Slot): number {
    return this.level('protection', item, instance);
  }
  protectedFromFall(item: ItemDefinition | undefined, instance?: Slot): boolean {
    return this.level('feather_falling', item, instance) > 0;
  }
  snapshot(): SavedEnchantment[] {
    return [...this.entries.entries()]
      .map(([item, entry]) => ({ item, id: entry.id, level: entry.level }))
      .sort((a, b) => a.item.localeCompare(b.item));
  }
  restore(data: readonly SavedEnchantment[]): number {
    this.entries.clear();
    let skipped = 0;
    for (const entry of data) {
      if (!itemRegistry.find(entry.item) || !ENCHANTMENTS.some((def) => def.id === entry.id)) {
        skipped++;
        continue;
      }
      this.entries.set(entry.item, { id: entry.id, level: entry.level });
    }
    return skipped;
  }
  clear(): void {
    this.entries.clear();
  }
}

/* ------------------------------------------------------------------ brewing */

export const BREW_TICKS = 400;
/** Blaze powder is the only fuel a stand accepts, as in the reference. */
export const BLAZE_POWDER_ITEM = 'lab:blaze_powder';
/** One blaze powder boils twenty potions, as in the reference. */
export const BREW_FUEL_PER_POWDER = 20;
export const BREWING_BOTTLES = 3;

export interface BrewingRecipe {
  readonly base: string;
  readonly ingredient: string;
  readonly result: string;
}
/** Two steps, exactly like the reference: water plus wart gives an awkward potion. */
export const BREWING_RECIPES: readonly BrewingRecipe[] = Object.freeze([
  { base: 'lab:potion_water', ingredient: 'lab:nether_wart', result: 'lab:potion_awkward' },
  { base: 'lab:potion_awkward', ingredient: 'lab:ghast_tear', result: 'lab:potion_regeneration' },
  { base: 'lab:potion_awkward', ingredient: 'lab:blaze_powder', result: 'lab:potion_strength' },
  { base: 'lab:potion_awkward', ingredient: 'lab:sugar', result: 'lab:potion_swiftness' },
  {
    base: 'lab:potion_awkward',
    ingredient: 'lab:magma_cream',
    result: 'lab:potion_fire_resistance',
  },
  { base: 'lab:potion_awkward', ingredient: 'lab:spider_eye', result: 'lab:potion_poison' },
  { base: 'lab:potion_awkward', ingredient: 'lab:melon', result: 'lab:potion_healing' },
]);

export function brewResult(
  base: string | undefined,
  ingredient: string | undefined,
): string | null {
  if (!base || !ingredient) return null;
  return (
    BREWING_RECIPES.find((recipe) => recipe.base === base && recipe.ingredient === ingredient)
      ?.result ?? null
  );
}

export interface BrewingState {
  /** Slot 0: the ingredient every bottle is brewed with. */
  ingredient: Slot | null;
  /** Slots 1-3: the bottles. */
  bottles: (Slot | null)[];
  /** Slot 4: blaze powder, consumed one item per twenty brews. */
  powder: Slot | null;
  /** Brews left from the powder already spent. */
  fuel: number;
  progress: number;
}

/**
 * The brewing stand seen as a five-slot container, so the ordinary slot rules (left click,
 * right click, shift click, dragging) work on it without a second code path.
 */
export class BrewingContainer implements Container {
  readonly size = 5;
  readonly regions: readonly SlotRegion[] = [{ name: 'container', from: 0, to: 5 }];
  constructor(private readonly state: BrewingState) {}
  get(index: number): Slot {
    if (index === 0) return this.state.ingredient;
    if (index >= 1 && index <= 3) return this.state.bottles[index - 1];
    if (index === 4) return this.state.powder;
    return null;
  }
  set(index: number, slot: Slot): void {
    if (index === 0) this.state.ingredient = slot;
    else if (index >= 1 && index <= 3) this.state.bottles[index - 1] = slot;
    else if (index === 4) this.state.powder = slot;
    // A fresh powder item tops the stand up with its full twenty brews.
    if (this.state.powder && this.state.fuel <= 0) {
      this.state.fuel = BREW_FUEL_PER_POWDER;
      this.state.powder = null;
    }
  }
}

export class BrewingStore {
  private readonly stands = new Map<string, BrewingState>();

  static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }
  get(x: number, y: number, z: number): BrewingState | undefined {
    return this.stands.get(BrewingStore.key(x, y, z));
  }
  ensure(x: number, y: number, z: number): BrewingState {
    const key = BrewingStore.key(x, y, z);
    let state = this.stands.get(key);
    if (!state) {
      state = { ingredient: null, bottles: [null, null, null], powder: null, fuel: 0, progress: 0 };
      this.stands.set(key, state);
    }
    return state;
  }
  remove(x: number, y: number, z: number): BrewingState | undefined {
    const key = BrewingStore.key(x, y, z);
    const state = this.stands.get(key);
    this.stands.delete(key);
    return state;
  }
  /** One tick for every stand: fuel, then the bottle run. Returns how many potions finished. */
  tick(): number {
    let finished = 0;
    for (const state of this.stands.values()) {
      // `brewResult` is read as (base in the bottle, ingredient on top), never the other way.
      const ready = state.bottles.some(
        (bottle) => bottle !== null && brewResult(bottle.item, state.ingredient?.item) !== null,
      );
      if (!ready || !state.ingredient) {
        state.progress = 0;
        continue;
      }
      if (state.fuel <= 0) continue;
      state.progress++;
      if (state.progress < BREW_TICKS) continue;
      state.progress = 0;
      state.fuel--;
      for (const [index, bottle] of state.bottles.entries()) {
        if (!bottle) continue;
        const brewed = brewResult(bottle.item, state.ingredient.item);
        if (!brewed) continue;
        state.bottles[index] = { item: brewed, count: 1, damage: 0 };
        finished++;
      }
      state.ingredient =
        state.ingredient.count > 1
          ? { ...state.ingredient, count: state.ingredient.count - 1 }
          : null;
    }
    return finished;
  }
  snapshot(): { key: string; state: BrewingState }[] {
    return [...this.stands.entries()].map(([key, state]) => ({
      key,
      state: {
        ...state,
        ingredient: state.ingredient ? { ...state.ingredient } : null,
        bottles: state.bottles.map((bottle) => (bottle ? { ...bottle } : null)),
        powder: state.powder ? { ...state.powder } : null,
      },
    }));
  }
  restore(data: readonly { key: string; state: BrewingState }[]): void {
    this.stands.clear();
    for (const entry of data)
      this.stands.set(entry.key, {
        ingredient: entry.state.ingredient ? { ...entry.state.ingredient } : null,
        bottles: (entry.state.bottles ?? [null, null, null]).map((bottle) =>
          bottle ? { ...bottle } : null,
        ),
        powder: entry.state.powder ? { ...entry.state.powder } : null,
        fuel: entry.state.fuel ?? 0,
        progress: entry.state.progress ?? 0,
      });
  }
  clear(): void {
    this.stands.clear();
  }
}

/* -------------------------------------------------------------------- anvil */

/** Levels one anvil operation costs before any prior work is counted. */
export const ANVIL_BASE_COST = 1;
export const ANVIL_MAX_COST = 39;

export interface AnvilResult {
  readonly stack: Slot;
  readonly cost: number;
  readonly message: string;
}

function durabilityOf(slot: Slot | null): number {
  if (!slot) return 0;
  const item = itemRegistry.find(slot.item);
  return (
    (item?.tool?.durability ?? item?.armor?.durability ?? item?.durability ?? 0) -
    (slot.damage ?? 0)
  );
}
function maxDurabilityOf(slot: Slot | null): number {
  if (!slot) return 0;
  const item = itemRegistry.find(slot.item);
  return item?.tool?.durability ?? item?.armor?.durability ?? item?.durability ?? 0;
}

/**
 * The anvil combines two items of the same kind into one with the remaining durability of both,
 * or repairs a tool with its material repair item. Both are the reference rules, minus renaming.
 */
export function anvilResult(first: Slot | null, second: Slot | null): AnvilResult | null {
  if (!first) return null;
  const definition = itemRegistry.find(first.item);
  if (!definition) return null;
  if (!second) return null;
  const repairItem = REPAIR_ITEMS[first.item];
  if (repairItem && second.item === repairItem) {
    const max = maxDurabilityOf(first);
    if (max <= 0) return null;
    const current = durabilityOf(first);
    const repaired = Math.min(max, current + Math.floor(max * 0.25));
    if (repaired <= current) return null;
    return {
      stack: { ...first, count: 1, damage: max - repaired },
      cost: ANVIL_BASE_COST,
      message: 'Инструмент починен',
    };
  }
  if (second.item !== first.item) return null;
  const max = maxDurabilityOf(first);
  if (max <= 0) return null;
  const combined = Math.min(max, durabilityOf(first) + durabilityOf(second));
  const extra = Math.min(ANVIL_MAX_COST - ANVIL_BASE_COST, Math.floor(combined / 100));
  return {
    stack: {
      ...first,
      count: 1,
      damage: max - combined,
      enchantments: mergeEnchantments(first.enchantments, second.enchantments),
    },
    cost: ANVIL_BASE_COST + extra,
    message: 'Предметы объединены',
  };
}

/** Repair material for every tool and armour kind, in the reference shape of the mechanic. */
export const REPAIR_ITEMS: Record<string, string> = {
  'lab:wood_pickaxe': 'lab:oak_planks',
  'lab:stone_pickaxe': 'lab:cobblestone',
  'lab:iron_pickaxe': 'lab:iron_ingot',
  'lab:wood_axe': 'lab:oak_planks',
  'lab:stone_axe': 'lab:cobblestone',
  'lab:iron_axe': 'lab:iron_ingot',
  'lab:wood_shovel': 'lab:oak_planks',
  'lab:stone_shovel': 'lab:cobblestone',
  'lab:iron_shovel': 'lab:iron_ingot',
  'lab:wood_sword': 'lab:oak_planks',
  'lab:stone_sword': 'lab:cobblestone',
  'lab:iron_sword': 'lab:iron_ingot',
  'lab:iron_helmet': 'lab:iron_ingot',
  'lab:iron_chestplate': 'lab:iron_ingot',
  'lab:iron_leggings': 'lab:iron_ingot',
  'lab:iron_boots': 'lab:iron_ingot',
  'lab:bow': 'lab:stick',
  'lab:shield': 'lab:oak_planks',
};
