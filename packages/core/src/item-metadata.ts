/** Instance-owned metadata. Never index an equipment upgrade by the item catalogue key. */
export const ENCHANTMENT_LEVELS = {
  efficiency: 3,
  sharpness: 3,
  fortune: 2,
  unbreaking: 3,
  protection: 3,
  power: 3,
  feather_falling: 3,
} as const;
export type EnchantmentId = keyof typeof ENCHANTMENT_LEVELS;
export type Enchantments = Partial<Record<EnchantmentId, number>>;
export function copyEnchantments(value: unknown): Enchantments | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RangeError('Invalid item enchantments');
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length > Object.keys(ENCHANTMENT_LEVELS).length)
    throw new RangeError('Too many item enchantments');
  const result: Enchantments = {};
  for (const [key, level] of entries) {
    if (
      !Object.hasOwn(ENCHANTMENT_LEVELS, key) ||
      typeof level !== 'number' ||
      !Number.isInteger(level) ||
      level < 1 ||
      level > ENCHANTMENT_LEVELS[key as EnchantmentId]
    )
      throw new RangeError(`Invalid enchantment ${key}`);
    result[key as EnchantmentId] = level;
  }
  return entries.length ? Object.freeze(result) : undefined;
}
export function sameEnchantments(a?: Enchantments, b?: Enchantments): boolean {
  return Object.keys(ENCHANTMENT_LEVELS).every(
    (key) => (a?.[key as EnchantmentId] ?? 0) === (b?.[key as EnchantmentId] ?? 0),
  );
}
export function mergeEnchantments(a?: Enchantments, b?: Enchantments): Enchantments | undefined {
  const result: Enchantments = { ...a };
  for (const [key, value] of Object.entries(b ?? {})) {
    const id = key as EnchantmentId;
    result[id] = Math.max(result[id] ?? 0, value);
  }
  return copyEnchantments(result);
}
