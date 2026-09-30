import {
  armorSlotIndex,
  itemDurability,
  itemRegistry,
  type ItemDefinition,
} from '../../content/src/items';
import { copyEnchantments, sameEnchantments, type Enchantments } from './item-metadata';
export interface ItemStack {
  /** `lab:*` item key. */
  readonly item: string;
  readonly count: number;
  /** Remaining damage for tools: 0 is pristine, durability - 1 is nearly broken. */
  readonly damage?: number;
  readonly enchantments?: Enchantments;
}
export type Slot = ItemStack | null;
export function definition(stack: ItemStack): ItemDefinition {
  const def = itemRegistry.find(stack.item);
  if (!def) throw new Error(`Unknown item ${stack.item}`);
  return def;
}
export function maxStack(stack: ItemStack): number {
  return definition(stack).maxStack;
}
export function stack(item: string, count = 1, damage = 0, enchantments?: Enchantments): ItemStack {
  const def = itemRegistry.find(item);
  if (!def) throw new Error(`Unknown item ${item}`);
  if (!Number.isInteger(count) || count < 1 || count > def.maxStack)
    throw new RangeError(`Bad count ${count} for ${item}`);
  const durability = itemDurability(def);
  if (!Number.isInteger(damage) || damage < 0 || damage >= Math.max(1, durability))
    throw new RangeError(`Bad damage ${damage} for ${item}`);
  const meta = copyEnchantments(enchantments);
  return Object.freeze({
    item,
    count,
    ...(durability ? { damage } : {}),
    ...(meta ? { enchantments: meta } : {}),
  });
}
export function sameKind(a: Slot, b: Slot): boolean {
  return (
    !!a &&
    !!b &&
    a.item === b.item &&
    (a.damage ?? 0) === (b.damage ?? 0) &&
    sameEnchantments(a.enchantments, b.enchantments)
  );
}
export function stacksEqual(a: Slot, b: Slot): boolean {
  return !a || !b ? a === b : sameKind(a, b) && a.count === b.count;
}
export function cloneStack<T extends Slot>(slot: T): T {
  return (
    slot
      ? {
          ...slot,
          ...(slot.enchantments ? { enchantments: copyEnchantments(slot.enchantments) } : {}),
        }
      : null
  ) as T;
}
export function cloneSlots(slots: readonly Slot[]): Slot[] {
  return slots.map(cloneStack);
}
/** The optional fourth field is instance metadata, introduced by save version 6. */
export type SlotData = [string, number, number, Enchantments?] | null;
export function encodeSlots(slots: readonly Slot[]): SlotData[] {
  return slots.map((slot): SlotData =>
    slot
      ? slot.enchantments
        ? [slot.item, slot.count, slot.damage ?? 0, copyEnchantments(slot.enchantments)]
        : [slot.item, slot.count, slot.damage ?? 0]
      : null,
  );
}
export function decodeSlots(data: readonly SlotData[]): Slot[] {
  return data.map((entry) => (entry ? stack(entry[0], entry[1], entry[2], entry[3]) : null));
}
export interface SlotRegion {
  readonly name: string;
  readonly from: number;
  readonly to: number;
}
export interface Container {
  readonly size: number;
  get(index: number): Slot;
  set(index: number, slot: Slot): void;
  readonly regions: readonly SlotRegion[];
}
export class ItemContainer implements Container {
  readonly slots: Slot[];
  constructor(
    readonly size: number,
    readonly regions: readonly SlotRegion[],
    slots: readonly Slot[] = [],
  ) {
    if (slots.length && slots.length !== size) throw new Error('Slot count mismatch');
    // Overlapping or out-of-range regions silently ate items during development, so the
    // container refuses to exist at all instead of misrouting a transfer later.
    const names = new Set<string>();
    let previousTo = 0;
    for (const region of [...regions].sort((a, b) => a.from - b.from)) {
      if (region.from < 0 || region.to > size || region.from >= region.to)
        throw new RangeError(`Region ${region.name} is outside 0..${size}`);
      if (region.from < previousTo)
        throw new RangeError(`Region ${region.name} overlaps another region`);
      if (names.has(region.name)) throw new RangeError(`Duplicate region ${region.name}`);
      names.add(region.name);
      previousTo = region.to;
    }
    this.slots = slots.length ? cloneSlots(slots) : new Array<Slot>(size).fill(null);
  }
  get(index: number): Slot {
    return this.slots[index] ?? null;
  }
  set(index: number, slot: Slot): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.size)
      throw new RangeError(`Slot ${index} outside 0..${this.size - 1}`);
    if (slot && slot.count > maxStack(slot))
      throw new RangeError(`Stack of ${slot.count} exceeds the limit for ${slot.item}`);
    this.slots[index] = slot
      ? stack(slot.item, slot.count, slot.damage ?? 0, slot.enchantments)
      : null;
  }
  snapshot(): Slot[] {
    return cloneSlots(this.slots);
  }
}
export const PLAYER_MAIN = { name: 'main', from: 9, to: 36 } as const;
export const PLAYER_HOTBAR = { name: 'hotbar', from: 0, to: 9 } as const;
export const PLAYER_ARMOR = { name: 'armor', from: 36, to: 40 } as const;
export const PLAYER_OFFHAND = { name: 'offhand', from: 40, to: 41 } as const;
export const PLAYER_MAIN_SLOTS = 36;
export const PLAYER_SLOTS = 41;
/**
 * 41 player slots: 0-8 hotbar, 9-35 main storage, 36-39 armour, 40 off hand.
 * Armour absorbs damage, wears independently and preserves instance metadata in saves.
 */
export class PlayerInventory extends ItemContainer {
  selected = 0;
  constructor(slots: readonly Slot[] = []) {
    super(PLAYER_SLOTS, [PLAYER_HOTBAR, PLAYER_MAIN, PLAYER_ARMOR, PLAYER_OFFHAND], slots);
  }
  /** Inventory part of the save/tooling split. */
  get hotbar(): Slot[] {
    return this.slots.slice(0, 9);
  }
  get main(): Slot[] {
    return this.slots.slice(9, 36);
  }
  get armor(): Slot[] {
    return this.slots.slice(36, 40);
  }
  get offhand(): Slot[] {
    return this.slots.slice(40);
  }
  selectedSlot(): Slot {
    return this.get(this.selected);
  }
  select(index: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index > 8) return false;
    this.selected = index;
    return true;
  }
}
function tryMerge(target: Slot, incoming: ItemStack): { slot: Slot; remaining: number } {
  if (!target || !sameKind(target, incoming)) return { slot: target, remaining: incoming.count };
  const room = maxStack(target) - target.count;
  if (room <= 0) return { slot: target, remaining: incoming.count };
  const moved = Math.min(room, incoming.count);
  return { slot: { ...target, count: target.count + moved }, remaining: incoming.count - moved };
}
/**
 * Adds items, filling partial stacks first. Returns whatever did not fit, so callers can
 * leave it on the ground instead of deleting it.
 */
export function addStack(
  container: Container,
  incoming: ItemStack,
  from = 0,
  to = container.size,
  accept: (index: number) => boolean = () => true,
): ItemStack | null {
  let remaining = incoming.count;
  for (let i = from; i < to && remaining > 0; i++) {
    if (!accept(i)) continue;
    const target = container.get(i);
    if (!target || !sameKind(target, incoming)) continue;
    const room = maxStack(target) - target.count;
    if (room <= 0) continue;
    const moved = Math.min(room, remaining);
    container.set(i, { ...target, count: target.count + moved });
    remaining -= moved;
  }
  for (let i = from; i < to && remaining > 0; i++) {
    if (container.get(i)) continue;
    if (!accept(i)) continue;
    const limit = maxStack(incoming);
    const moved = Math.min(limit, remaining);
    container.set(i, { ...incoming, count: moved });
    remaining -= moved;
  }
  return remaining > 0 ? { ...incoming, count: remaining } : null;
}
/**
 * Adds any amount of one item, splitting it into legal stacks. This is the entry point for
 * pickups, drops and tooling, so callers cannot smuggle an oversized stack past the limits.
 */
export function addItems(
  container: Container,
  item: string,
  count: number,
  from = 0,
  to = container.size,
): number {
  if (!Number.isInteger(count) || count < 0) throw new RangeError(`Bad item count ${count}`);
  const limit = itemRegistry.find(item)?.maxStack;
  if (!limit) throw new Error(`Unknown item ${item}`);
  let left = count;
  while (left > 0) {
    const slice = Math.min(left, limit);
    const leftover = addStack(container, stack(item, slice), from, to);
    if (!leftover) {
      left -= slice;
      continue;
    }
    if (leftover.count === slice) return left; // No room at all: stop instead of spinning.
    left -= slice - leftover.count;
  }
  return 0;
}
/**
 * Whether a slot may hold an item: armour cells only take the piece that belongs to them,
 * every other cell is free. This is the reference `Slot.isItemValid` rule.
 */
export function slotAccepts(container: Container, index: number, slot: Slot): boolean {
  if (!slot) return true;
  const def = itemRegistry.find(slot.item);
  if (!def) return false;
  const region = container.regions.find((entry) => index >= entry.from && index < entry.to);
  if (!region) return true;
  if (region.name !== 'armor') return true;
  const wanted = armorSlotIndex(def);
  return wanted >= 0 && PLAYER_ARMOR.from + wanted === index;
}
export function countItem(container: Container, item: string): number {
  let total = 0;
  for (let i = 0; i < container.size; i++) {
    const slot = container.get(i);
    if (slot && slot.item === item) total += slot.count;
  }
  return total;
}
export function findItem(container: Container, item: string): number[] {
  const found: number[] = [];
  for (let i = 0; i < container.size; i++) if (container.get(i)?.item === item) found.push(i);
  return found;
}
/** Removes up to `count` items; returns how many were actually removed. */
export function removeItem(container: Container, item: string, count: number): number {
  let left = count;
  for (let i = container.size - 1; i >= 0 && left > 0; i--) {
    const slot = container.get(i);
    if (!slot || slot.item !== item) continue;
    const taken = Math.min(left, slot.count);
    container.set(i, slot.count === taken ? null : { ...slot, count: slot.count - taken });
    left -= taken;
  }
  return count - left;
}
/** Total item count, used by integrity tests to prove nothing is duplicated or lost. */
export function totalItems(containers: readonly Container[], cursor: Slot = null): number {
  let total = cursor ? cursor.count : 0;
  for (const container of containers)
    for (let i = 0; i < container.size; i++) total += container.get(i)?.count ?? 0;
  return total;
}
export interface ClickOptions {
  /** Right button splits or places one item. */
  readonly right?: boolean;
  /** Shift-click moves the stack to the other region instead of holding it. */
  readonly shift?: boolean;
  /** Where quick-moved items should go, in order. Ignored for the result slot. */
  readonly quickOrder?: readonly string[];
}
export interface ClickOutcome {
  readonly cursor: Slot;
  /** Slot indices that changed, so the caller can mark them dirty. */
  readonly changed: number[];
  readonly crafted?: number;
}
function regionFor(container: Container, index: number): string | undefined {
  return container.regions.find((region) => index >= region.from && index < region.to)?.name;
}
function quickMove(container: Container, index: number, order: readonly string[]): number[] {
  const stack = container.get(index);
  const changed: number[] = [];
  if (!stack) return changed;
  const source = regionFor(container, index);
  for (const name of order) {
    if (name === source) continue;
    const region = container.regions.find((entry) => entry.name === name);
    if (!region) continue;
    const leftover = addStack(container, stack, region.from, region.to, (i) =>
      slotAccepts(container, i, stack),
    );
    if (!leftover) {
      container.set(index, null);
      changed.push(index);
      return changed;
    }
    if (leftover.count !== stack.count) {
      container.set(index, leftover);
      changed.push(index);
    }
  }
  return changed;
}
/**
 * The single place that mutates slots. Everything the interface does goes through here,
 * which is why "no duplication, no loss" can be tested with random operation sequences.
 */
export function clickSlot(
  container: Container,
  index: number,
  cursor: Slot,
  options: ClickOptions = {},
): ClickOutcome {
  const slot = container.get(index);
  const changed: number[] = [];
  if (options.shift) {
    // The reference game ignores shift-clicking while the cursor carries a stack.
    if (cursor) return { cursor, changed: [] };
    // A wearable piece goes to its armour cell first; everything else follows the given order.
    const order = options.quickOrder ?? ['main', 'hotbar'];
    const wearable = slot ? armorSlotIndex(itemRegistry.find(slot.item)) >= 0 : false;
    changed.push(...quickMove(container, index, wearable ? ['armor', ...order] : order));
    return { cursor, changed };
  }
  if (options.right) {
    if (!cursor) {
      if (!slot) return { cursor, changed: [] };
      // Right-clicking a piece of armour with an empty hand wears it, as the reference does.
      const armorIndex = armorSlotIndex(itemRegistry.find(slot.item));
      if (armorIndex >= 0 && container.regions.some((entry) => entry.name === 'armor')) {
        const target = PLAYER_ARMOR.from + armorIndex;
        if (target < container.size && !container.get(target)) {
          container.set(target, slot);
          container.set(index, null);
          return { cursor, changed: [index, target] };
        }
      }
      const take = Math.ceil(slot.count / 2);
      container.set(index, slot.count === take ? null : { ...slot, count: slot.count - take });
      changed.push(index);
      return { cursor: { ...slot, count: take }, changed };
    }
    if (!slot) {
      if (!slotAccepts(container, index, cursor)) return { cursor, changed: [] };
      container.set(index, { ...cursor, count: 1 });
      changed.push(index);
      return {
        cursor: cursor.count === 1 ? null : { ...cursor, count: cursor.count - 1 },
        changed,
      };
    }
    if (!sameKind(slot, cursor)) return { cursor, changed: [] };
    if (slot.count >= maxStack(slot)) return { cursor, changed: [] };
    container.set(index, { ...slot, count: slot.count + 1 });
    changed.push(index);
    return { cursor: cursor.count === 1 ? null : { ...cursor, count: cursor.count - 1 }, changed };
  }
  if (!cursor) {
    if (!slot) return { cursor, changed: [] };
    container.set(index, null);
    changed.push(index);
    return { cursor: slot, changed };
  }
  if (!slot) {
    if (!slotAccepts(container, index, cursor)) return { cursor, changed: [] };
    container.set(index, cursor);
    changed.push(index);
    return { cursor: null, changed };
  }
  const merged = tryMerge(slot, cursor);
  if (merged.remaining !== cursor.count) {
    container.set(index, merged.slot);
    changed.push(index);
    return {
      cursor: merged.remaining > 0 ? { ...cursor, count: merged.remaining } : null,
      changed,
    };
  }
  // Different items, or the stack is full: swap, exactly like the reference behaviour.
  if (!slotAccepts(container, index, cursor)) return { cursor, changed: [] };
  container.set(index, cursor);
  changed.push(index);
  return { cursor: slot, changed };
}
/**
 * Double-click: gather every stack of the same kind onto the cursor. Slots are emptied in
 * order and the cursor only grows, so the number of items never changes.
 */
export function gatherSame(container: Container, index: number, cursor: Slot): ClickOutcome {
  const source = container.get(index);
  const template = cursor ?? source;
  if (!template) return { cursor, changed: [] };
  const changed: number[] = [];
  let total = cursor ? cursor.count : 0;
  const limit = maxStack(template);
  const order = [
    index,
    ...Array.from({ length: container.size }, (_, i) => i).filter((i) => i !== index),
  ];
  for (const i of order) {
    if (total >= limit) break;
    const slot = container.get(i);
    if (!slot || !sameKind(slot, template)) continue;
    const moved = Math.min(limit - total, slot.count);
    total += moved;
    container.set(i, slot.count === moved ? null : { ...slot, count: slot.count - moved });
    changed.push(i);
  }
  if (!changed.length) return { cursor, changed: [] };
  return { cursor: { ...template, count: total }, changed };
}
/**
 * Number keys: swap the hovered slot with a player hotbar slot. The reference game refuses
 * this while an item is held by the cursor, because the cursor has nowhere to go.
 */
export function hotbarSwap(
  container: Container,
  index: number,
  player: PlayerInventory,
  hotbarIndex: number,
  cursor: Slot,
): ClickOutcome {
  if (cursor) return { cursor, changed: [] };
  if (!Number.isInteger(hotbarIndex) || hotbarIndex < 0 || hotbarIndex > 8)
    return { cursor, changed: [] };
  if (container === player && index === hotbarIndex) return { cursor, changed: [] };
  const from = container.get(index);
  const to = player.get(hotbarIndex);
  container.set(index, to);
  player.set(hotbarIndex, from);
  return { cursor, changed: [index, hotbarIndex] };
}
/** One item per slot while dragging with the left button held. */
export function dragPlace(container: Container, index: number, cursor: Slot): ClickOutcome {
  const slot = container.get(index);
  if (!cursor) return { cursor, changed: [] };
  if (slot && !sameKind(slot, cursor)) return { cursor, changed: [] };
  if (slot && slot.count >= maxStack(slot)) return { cursor, changed: [] };
  container.set(index, slot ? { ...slot, count: slot.count + 1 } : { ...cursor, count: 1 });
  return {
    cursor: cursor.count === 1 ? null : { ...cursor, count: cursor.count - 1 },
    changed: [index],
  };
}
/** Even share per remaining slot while dragging with the right button held. */
export function dragShare(
  container: Container,
  index: number,
  cursor: Slot,
  slotsLeft: number,
): ClickOutcome {
  if (!cursor) return { cursor, changed: [] };
  const slot = container.get(index);
  if (slot && !sameKind(slot, cursor)) return { cursor, changed: [] };
  const room = slot ? maxStack(slot) - slot.count : maxStack(cursor);
  const share = Math.max(1, Math.floor(cursor.count / Math.max(1, slotsLeft)));
  const moved = Math.min(room, share, cursor.count);
  if (moved <= 0) return { cursor, changed: [] };
  container.set(index, slot ? { ...slot, count: slot.count + moved } : { ...cursor, count: moved });
  return {
    cursor: cursor.count === moved ? null : { ...cursor, count: cursor.count - moved },
    changed: [index],
  };
}
/** Two regions side by side, used by chests and other block containers. */
export const CONTAINER_REGION = { name: 'container', from: 0, to: 0 } as const;
