import { registry, type BlockDefinition } from '../../content/src/blocks';
import { definition as itemDefinition, type ItemStack } from './inventory';
import { itemDurability, itemRegistry } from '../../content/src/items';
/** Ticks the held stack needs for one block, following the reference progress formula. */
export function breakTicks(state: number, held: ItemStack | null, speedScale = 1): number {
  const def = registry.get(state);
  if (def.hardness < 0) return Infinity;
  if (def.hardness === 0) return 1;
  const tool = held ? itemDefinition(held).tool : undefined;
  const canHarvest = canHarvestBlock(def, held);
  const base = tool && def.tool && tool.kind === def.tool ? tool.speed : 1;
  const speed = base * Math.max(0, speedScale);
  const perTick = speed / def.hardness / (canHarvest ? 30 : 100);
  if (perTick >= 1) return 1;
  return Math.ceil(1 / perTick);
}
export function breakSeconds(state: number, held: ItemStack | null): number {
  const ticks = breakTicks(state, held);
  return Number.isFinite(ticks) ? ticks / 20 : Infinity;
}
/**
 * A block with no tier requirement can be harvested by hand. Tiers exist only for
 * stone-like blocks, so hand-breaking stone yields nothing, as in the reference game.
 */
export function canHarvestBlock(def: BlockDefinition, held: ItemStack | null): boolean {
  if (def.tier === undefined) return true;
  const tool = held ? itemDefinition(held).tool : undefined;
  if (!tool || !def.tool) return false;
  return tool.kind === def.tool && tool.tier >= def.tier;
}
/** True when the reference game would give an instant break on the first hit. */
export function instantBreak(state: number, held: ItemStack | null, speedScale = 1): boolean {
  return breakTicks(state, held, speedScale) <= 1;
}
export interface DroppedStack {
  readonly item: string;
  readonly count: number;
}
/** Rolls block drops. `random` returns 0..1 and is injectable for deterministic tests. */
export function rollDrops(
  state: number,
  held: ItemStack | null,
  random: () => number = Math.random,
): DroppedStack[] {
  const def = registry.get(state);
  // Air has no item and protected or unbreakable blocks never drop anything.
  if (state === 0 || def.protected || def.hardness < 0) return [];
  if (!canHarvestBlock(def, held)) return [];
  // A block with two states (a lamp, a lever, a rail) drops the item that stands for it.
  const rules = def.drops ?? [{ item: itemRegistry.ofBlock(state)?.key ?? def.key }];
  const result: DroppedStack[] = [];
  const shears = held ? itemDefinition(held).key === 'lab:shears' : false;
  for (const rule of rules) {
    if (rule.shears !== undefined && rule.shears !== shears) continue;
    const chance = rule.chance ?? 100;
    if (chance < 100 && random() * 100 >= chance) continue;
    result.push({ item: rule.item, count: rule.count ?? 1 });
  }
  for (const rule of rules)
    if (rule.replaces && result.some((entry) => entry.item === rule.item))
      return result.filter((entry) => entry.item !== rule.replaces);
  return result;
}
export function toolDamagePerBlock(held: ItemStack | null): number {
  return held && itemDefinition(held).tool ? 1 : 0;
}
export function damageTool(held: ItemStack): { stack: ItemStack | null; broke: boolean } {
  const def = itemDefinition(held);
  if (!itemDurability(def)) return { stack: held, broke: false };
  const next = (held.damage ?? 0) + 1;
  if (next >= itemDurability(def)) return { stack: null, broke: true };
  return { stack: { ...held, damage: next }, broke: false };
}
export function durabilityLeft(held: ItemStack): number | null {
  const def = itemDefinition(held);
  const durability = itemDurability(def);
  return durability ? durability - (held.damage ?? 0) : null;
}
