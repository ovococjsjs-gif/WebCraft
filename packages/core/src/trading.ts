/**
 * Villager trades, after the 1.12 offers of each career. The reference unlocks them in tiers and
 * rolls some counts; here every villager shows its whole list with fixed counts, each offer
 * serves a few times and then rests until the villager restocks, as the reference does.
 */
export const VILLAGER_PROFESSIONS = ['farmer', 'librarian', 'priest', 'smith', 'butcher'] as const;
export type Profession = (typeof VILLAGER_PROFESSIONS)[number];
export const PROFESSION_NAMES: Record<Profession, string> = {
  farmer: 'Фермер',
  librarian: 'Библиотекарь',
  priest: 'Священник',
  smith: 'Кузнец',
  butcher: 'Мясник',
};
export interface Trade {
  /** One or two stacks the player pays. */
  readonly give: readonly (readonly [string, number])[];
  readonly get: readonly [string, number];
}
/** Uses of one offer before it is out of stock. */
export const TRADE_MAX_USES = 8;
/** Ticks between two restocks of a villager (a used-up offer gets its uses back). */
export const TRADE_RESTOCK_TICKS = 2400;

const E = 'lab:emerald';
const t = (give: readonly (readonly [string, number])[], get: readonly [string, number]): Trade =>
  Object.freeze({ give: Object.freeze(give), get: Object.freeze(get) });
export const TRADES: Readonly<Record<Profession, readonly Trade[]>> = Object.freeze({
  farmer: [
    t([['lab:wheat', 20]], [E, 1]),
    t([['lab:potato', 15]], [E, 1]),
    t([['lab:carrot', 15]], [E, 1]),
    t([['lab:pumpkin', 8]], [E, 1]),
    t([['lab:melon', 4]], [E, 1]),
    t([[E, 1]], ['lab:bread', 4]),
    t([[E, 1]], ['lab:pumpkin_pie', 3]),
    t([[E, 1]], ['lab:apple', 6]),
    t([[E, 1]], ['lab:cookie', 8]),
    t([[E, 1]], ['lab:cake', 1]),
    t([['lab:string', 15]], [E, 1]),
    t(
      [
        ['lab:fish', 6],
        [E, 1],
      ],
      ['lab:cooked_fish', 6],
    ),
  ],
  librarian: [
    t([['lab:paper', 24]], [E, 1]),
    t([['lab:book', 8]], [E, 1]),
    t([[E, 3]], ['lab:bookshelf', 1]),
    t([[E, 1]], ['lab:glass', 4]),
    t([[E, 5]], ['lab:compass', 1]),
    t([[E, 5]], ['lab:clock', 1]),
    t(
      [
        [E, 1],
        ['lab:book', 1],
      ],
      ['lab:lapis', 4],
    ),
  ],
  priest: [
    t([['lab:rotten_flesh', 36]], [E, 1]),
    t([['lab:gold_ingot', 8]], [E, 1]),
    t([[E, 1]], ['lab:redstone', 2]),
    t([[E, 1]], ['lab:lapis', 2]),
    t([[E, 4]], ['lab:ender_pearl', 1]),
    t([[E, 3]], ['lab:glowstone', 1]),
    t([[E, 1]], ['lab:glass_bottle', 3]),
  ],
  smith: [
    t([['lab:coal', 16]], [E, 1]),
    t([['lab:iron_ingot', 7]], [E, 1]),
    t([['lab:diamond', 3]], [E, 1]),
    t([[E, 4]], ['lab:iron_helmet', 1]),
    t([[E, 10]], ['lab:iron_chestplate', 1]),
    t([[E, 7]], ['lab:iron_axe', 1]),
    t([[E, 9]], ['lab:iron_sword', 1]),
    t([[E, 8]], ['lab:iron_pickaxe', 1]),
    t([[E, 5]], ['lab:chainmail_helmet', 1]),
    t([[E, 11]], ['lab:chainmail_chestplate', 1]),
    t([[E, 9]], ['lab:chainmail_leggings', 1]),
    t([[E, 5]], ['lab:chainmail_boots', 1]),
    t([[E, 16]], ['lab:diamond_sword', 1]),
  ],
  butcher: [
    t([['lab:porkchop', 14]], [E, 1]),
    t([['lab:chicken', 14]], [E, 1]),
    t([['lab:beef', 12]], [E, 1]),
    t([['lab:leather', 9]], [E, 1]),
    t([[E, 1]], ['lab:cooked_porkchop', 6]),
    t([[E, 1]], ['lab:cooked_chicken', 8]),
    t([[E, 3]], ['lab:leather_chestplate', 1]),
    t([[E, 2]], ['lab:leather_leggings', 1]),
  ],
});
export function professionOf(variant: number): Profession {
  return VILLAGER_PROFESSIONS[variant] ?? 'farmer';
}
export function tradesFor(variant: number): readonly Trade[] {
  return TRADES[professionOf(variant)];
}
