import { describe, it, expect } from 'vitest';
import {
  ItemContainer,
  PlayerInventory,
  addItems,
  addStack,
  clickSlot,
  cloneStack,
  countItem,
  decodeSlots,
  encodeSlots,
  maxStack,
  removeItem,
  sameKind,
  stack,
  stacksEqual,
  totalItems,
  PLAYER_HOTBAR,
  PLAYER_MAIN,
  type Container,
  type Slot,
} from '../../packages/core/src/inventory';
import { itemRegistry } from '../../packages/content/src/items';

const bags = (size = 41) => new PlayerInventory(new Array<Slot>(size).fill(null));
describe('item stacks', () => {
  it('rejects unknown items, empty counts and oversized stacks', () => {
    expect(() => stack('lab:unknown')).toThrow();
    expect(() => stack('lab:coal', 0)).toThrow();
    expect(() => stack('lab:coal', 65)).toThrow();
    expect(() => stack('lab:iron_pickaxe', 2)).toThrow();
  });
  it('gives tools a single slot and a damage range', () => {
    expect(maxStack(stack('lab:iron_pickaxe'))).toBe(1);
    expect(stack('lab:iron_pickaxe', 1, 249).damage).toBe(249);
    expect(() => stack('lab:iron_pickaxe', 1, 250)).toThrow();
  });
  it('treats differently damaged tools as different stacks', () => {
    expect(sameKind(stack('lab:stone_axe', 1, 0), stack('lab:stone_axe', 1, 0))).toBe(true);
    expect(sameKind(stack('lab:stone_axe', 1, 0), stack('lab:stone_axe', 1, 3))).toBe(false);
    expect(sameKind(stack('lab:stone_axe', 1, 3), stack('lab:wood_axe'))).toBe(false);
  });
  it('stacks a tool with itself only when it is free of damage', () => {
    const container = new ItemContainer(1, [{ name: 'main', from: 0, to: 1 }]);
    container.set(0, stack('lab:iron_pickaxe'));
    expect(addStack(container, stack('lab:iron_pickaxe'))).toEqual({
      item: 'lab:iron_pickaxe',
      count: 1,
      damage: 0,
    });
    // A damaged tool cannot share the slot, so it comes back as a leftover stack.
    expect(addStack(container, stack('lab:iron_pickaxe', 1, 5))).toEqual({
      item: 'lab:iron_pickaxe',
      count: 1,
      damage: 5,
    });
  });
  it('roundtrips through the save representation', () => {
    const slots: Slot[] = [stack('lab:coal', 12), null, stack('lab:iron_axe', 1, 7)];
    expect(decodeSlots(encodeSlots(slots))).toEqual(slots);
  });
  it('refuses to place an oversized stack directly into a slot', () => {
    const container = new ItemContainer(1, [{ name: 'main', from: 0, to: 1 }]);
    expect(() => container.set(0, { item: 'lab:coal', count: 99 })).toThrow();
    expect(() => container.get(4)).not.toThrow();
  });
});
describe('adding and removing items', () => {
  it('fills partial stacks before using empty slots', () => {
    const bag = bags();
    bag.set(0, stack('lab:coal', 60));
    expect(addStack(bag, stack('lab:coal', 10))).toBeNull();
    expect(bag.get(0)!.count).toBe(64);
    expect(bag.get(1)!.count).toBe(6);
  });
  it('returns the leftover instead of deleting items when full', () => {
    const bag = bags();
    for (let i = 0; i < 41; i++) bag.set(i, stack('lab:cobblestone', 64));
    expect(addStack(bag, stack('lab:coal', 5))).toEqual({ item: 'lab:coal', count: 5 });
    expect(totalItems([bag])).toBe(41 * 64);
  });
  it('never merges different items or damaged tools into one slot', () => {
    const bag = bags();
    bag.set(0, stack('lab:coal', 5));
    addStack(bag, stack('lab:charcoal', 5));
    expect(bag.get(0)!.item).toBe('lab:coal');
    expect(bag.get(1)!.item).toBe('lab:charcoal');
  });
  it('respects a sub-range so chests and player slots stay separate', () => {
    const container = new ItemContainer(8, [{ name: 'main', from: 0, to: 8 }]);
    expect(addItems(container, 'lab:coal', 70, 3, 5)).toBe(0);
    expect(container.get(2)).toBeNull();
    expect(container.get(3)!.count).toBe(64);
    expect(container.get(4)!.count).toBe(6);
    expect(container.get(5)).toBeNull();
    container.set(3, stack('lab:coal', 64));
    container.set(4, stack('lab:coal', 64));
    expect(addItems(container, 'lab:coal', 5, 3, 5)).toBe(5);
    expect(addItems(container, 'lab:coal', 70, 0, 8)).toBe(0);
  });
  it('removes from the end of the inventory and reports the real amount', () => {
    const bag = bags();
    bag.set(0, stack('lab:coal', 3));
    bag.set(1, stack('lab:coal', 4));
    expect(removeItem(bag, 'lab:coal', 5)).toBe(5);
    expect(countItem(bag, 'lab:coal')).toBe(2);
    expect(removeItem(bag, 'lab:coal', 9)).toBe(2);
    expect(removeItem(bag, 'lab:coal', 1)).toBe(0);
  });
});
describe('slot clicks', () => {
  const fill = (entries: Record<number, Slot>) => {
    const bag = bags();
    for (const [index, slot] of Object.entries(entries)) bag.set(Number(index), cloneStack(slot));
    return bag;
  };
  it('picks up, places and swaps whole stacks', () => {
    const bag = fill({ 0: stack('lab:coal', 5) });
    const picked = clickSlot(bag, 0, null);
    expect(picked.cursor).toEqual(stack('lab:coal', 5));
    expect(bag.get(0)).toBeNull();
    const placed = clickSlot(bag, 3, picked.cursor);
    expect(placed.cursor).toBeNull();
    expect(bag.get(3)).toEqual(stack('lab:coal', 5));
    const swap = clickSlot(bag, 3, stack('lab:stick', 2));
    expect(swap.cursor).toEqual(stack('lab:coal', 5));
    expect(bag.get(3)).toEqual(stack('lab:stick', 2));
  });
  it('merges up to the stack limit and keeps the remainder on the cursor', () => {
    const bag = fill({ 0: stack('lab:coal', 60) });
    const result = clickSlot(bag, 0, stack('lab:coal', 10));
    expect(bag.get(0)!.count).toBe(64);
    expect(result.cursor).toEqual(stack('lab:coal', 6));
  });
  it('splits on right click and places single items', () => {
    const bag = fill({ 0: stack('lab:cobblestone', 7) });
    const half = clickSlot(bag, 0, null, { right: true });
    expect(half.cursor).toEqual(stack('lab:cobblestone', 4));
    expect(bag.get(0)!.count).toBe(3);
    const one = clickSlot(bag, 5, half.cursor, { right: true });
    expect(bag.get(5)).toEqual(stack('lab:cobblestone', 1));
    expect(one.cursor!.count).toBe(3);
    const placeAll = clickSlot(bag, 5, one.cursor);
    expect(bag.get(5)).toEqual(stack('lab:cobblestone', 4));
    expect(placeAll.cursor).toBeNull();
  });
  it('does not mix items on right click', () => {
    const bag = fill({ 0: stack('lab:coal', 4) });
    const result = clickSlot(bag, 0, stack('lab:stick', 4), { right: true });
    expect(result.cursor).toEqual(stack('lab:stick', 4));
    expect(bag.get(0)).toEqual(stack('lab:coal', 4));
  });
  it('quick-moves whole stacks between hotbar and main storage, filling partials first', () => {
    const bag = fill({ 0: stack('lab:oak_log', 30) });
    bag.set(12, stack('lab:oak_log', 60));
    clickSlot(bag, 0, null, { shift: true, quickOrder: ['main', 'hotbar'] });
    expect(bag.get(0)).toBeNull();
    expect(bag.get(12)!.count).toBe(64);
    expect(bag.get(9)!.count).toBe(26);
  });
  it('quick-moves back to the hotbar when the main storage is the source', () => {
    const bag = fill({ 20: stack('lab:cobblestone', 10) });
    clickSlot(bag, 20, null, { shift: true, quickOrder: ['main', 'hotbar'] });
    expect(bag.get(20)).toBeNull();
    expect(bag.get(0)).toEqual(stack('lab:cobblestone', 10));
  });
  it('leaves items in place when the destination is completely full', () => {
    const bag = bags();
    for (let i = 9; i < 36; i++) bag.set(i, stack('lab:coal'));
    bag.set(0, stack('lab:stick', 1));
    clickSlot(bag, 0, null, { shift: true, quickOrder: ['main', 'hotbar'] });
    expect(bag.get(0)).toEqual(stack('lab:stick', 1));
  });
});
describe('integrity under random operation sequences', () => {
  it('never duplicates or loses items across thousands of random slot operations', () => {
    const items = ['lab:coal', 'lab:cobblestone', 'lab:stick', 'lab:oak_log', 'lab:iron_ingot'];
    const tools = ['lab:stone_pickaxe', 'lab:iron_axe', 'lab:wood_shovel'];
    let state = 987654321;
    const random = () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    const bag = new PlayerInventory(new Array<Slot>(41).fill(null));
    let cursor: Slot = null;
    let expected = 0;
    const total = () => totalItems([bag], cursor);
    const insert = (item: string, count: number) => {
      expected += count - addItems(bag, item, count);
    };
    for (const item of items) insert(item, 64 * 2 + 5);
    for (const item of tools) insert(item, 1);
    for (let step = 0; step < 6000; step++) {
      const action = random();
      const index = Math.floor(random() * bag.size);
      if (action < 0.1) {
        // Drop whatever the cursor holds: the only operation allowed to remove items.
        if (cursor) {
          expected -= cursor.count;
          cursor = null;
        }
      } else if (action < 0.2) {
        insert(items[Math.floor(random() * items.length)], 1 + Math.floor(random() * 9));
      } else {
        const outcome = clickSlot(bag, index, cursor, {
          right: random() < 0.35,
          shift: random() < 0.25,
          quickOrder: ['main', 'hotbar'],
        });
        cursor = outcome.cursor;
      }
      expect(total()).toBe(expected);
      if (cursor) {
        expect(cursor.count).toBeGreaterThan(0);
        expect(cursor.count).toBeLessThanOrEqual(maxStack(cursor));
      }
      for (let slotIndex = 0; slotIndex < bag.size; slotIndex++) {
        const slot = bag.get(slotIndex);
        if (!slot) continue;
        expect(slot.count).toBeGreaterThan(0);
        expect(slot.count).toBeLessThanOrEqual(maxStack(slot));
        if (itemRegistry.find(slot.item)!.tool) expect(slot.count).toBe(1);
      }
    }
    expect(expected).toBeGreaterThan(0);
  });
  it('keeps every item while a chest and the inventory are mixed', () => {
    let state = 24680;
    const random = () => {
      state = (state * 48271) % 2147483647;
      return state / 2147483647;
    };
    const chest = new ItemContainer(27, [{ name: 'container', from: 0, to: 27 }]);
    const bag = new PlayerInventory(new Array<Slot>(41).fill(null));
    // A real container view: the chest sits first, then the player slots at their offset.
    const combined = new ItemContainer(68, [
      { name: 'container', from: 0, to: 27 },
      { name: 'hotbar', from: 27, to: 36 },
      { name: 'main', from: 36, to: 68 },
    ]);
    const sync = () => {
      // The combined view mirrors both real containers, so results are written back.
      for (let i = 0; i < 27; i++) combined.set(i, chest.get(i));
      for (let i = 0; i < 41; i++) combined.set(27 + i, bag.get(i));
    };
    const commit = () => {
      for (let i = 0; i < 27; i++) chest.set(i, combined.get(i));
      for (let i = 0; i < 41; i++) bag.set(i, combined.get(27 + i));
    };
    const total = () => totalItems([chest, bag]);
    let expected = 0;
    sync();
    // Seed the chest and the inventory with known amounts through the same API the game uses.
    for (const [container, amount] of [
      [chest, 200],
      [bag, 150],
    ] as const) {
      expected += amount - addItems(container, 'lab:iron_ingot', amount);
      sync();
      commit();
    }
    sync();
    let cursor: Slot = null;
    let dropped = 0;
    for (let step = 0; step < 3000; step++) {
      sync();
      if (random() < 0.12) {
        if (cursor) {
          dropped += cursor.count;
          cursor = null;
        }
      } else {
        const index = Math.floor(random() * combined.size);
        cursor = clickSlot(combined, index, cursor, {
          right: random() < 0.3,
          shift: random() < 0.4,
          quickOrder: ['container', 'main', 'hotbar'],
        }).cursor;
      }
      commit();
      expect(total() + (cursor?.count ?? 0) + dropped).toBe(expected);
    }
    expect(expected).toBeGreaterThan(0);
    expect(dropped).toBeGreaterThan(0);
  });
});
describe('quick move helper', () => {
  it('uses region names instead of hardcoded indices', () => {
    const container = new ItemContainer(68, [
      { name: 'container', from: 0, to: 27 },
      { name: 'hotbar', from: 27, to: 36 },
      { name: 'main', from: 36, to: 68 },
    ]);
    container.set(40, stack('lab:coal', 5));
    clickSlot(container, 40, null, { shift: true, quickOrder: ['container', 'main'] });
    expect(container.get(40)).toBeNull();
    expect(container.get(0)).toEqual(stack('lab:coal', 5));
    container.set(0, stack('lab:coal', 64));
    container.set(41, stack('lab:coal', 3));
    clickSlot(container, 41, null, { shift: true, quickOrder: ['container', 'main'] });
    expect(container.get(41)).toBeNull();
    expect(container.get(0)!.count).toBe(64);
    expect(container.get(1)!.count).toBe(3);
  });
  it('exports the shared empty-container shape used by chests', () => {
    const chest: Container = new ItemContainer(27, [{ name: 'container', from: 0, to: 27 }]);
    expect(countItem(chest, 'lab:coal')).toBe(0);
    expect(stacksEqual(null, null)).toBe(true);
  });
  it('refuses containers whose regions overlap or leave the slot range', () => {
    expect(
      () =>
        new ItemContainer(41, [PLAYER_HOTBAR, PLAYER_MAIN, { name: 'extra', from: 30, to: 40 }]),
    ).toThrow();
    expect(
      () =>
        new ItemContainer(9, [
          { name: 'a', from: 0, to: 5 },
          { name: 'b', from: 3, to: 9 },
        ]),
    ).toThrow('overlaps');
    expect(() => new ItemContainer(4, [{ name: 'a', from: 0, to: 9 }])).toThrow();
    expect(() => new ItemContainer(4, [])).not.toThrow();
  });
  it('only lets the matching piece into each armour cell, and wears it on a right click', () => {
    const player = new PlayerInventory();
    const chestplate = stack('lab:iron_chestplate');
    // A pickaxe has no business in an armour cell; the matching piece does.
    expect(clickSlot(player, 37, stack('lab:iron_pickaxe')).cursor?.item).toBe('lab:iron_pickaxe');
    expect(player.get(37)).toBeNull();
    const placed = clickSlot(player, 37, chestplate);
    expect(placed.cursor).toBeNull();
    expect(player.get(37)?.item).toBe('lab:iron_chestplate');
    // The right cell for the right piece: a helmet is refused by the chest cell.
    const swapped = clickSlot(player, 37, stack('lab:iron_helmet'));
    expect(swapped.cursor?.item).toBe('lab:iron_helmet');
    expect(player.get(37)?.item).toBe('lab:iron_chestplate');
    // Right click with an empty hand wears the piece straight away, as the reference does.
    player.set(10, stack('lab:iron_boots'));
    const worn = clickSlot(player, 10, null, { right: true });
    expect(player.get(39)?.item).toBe('lab:iron_boots');
    expect(player.get(10)).toBeNull();
    expect(worn.changed).toEqual([10, 39]);
  });
  it('shift-clicks armour into its cell instead of the storage region', () => {
    const player = new PlayerInventory();
    player.set(12, stack('lab:iron_leggings'));
    clickSlot(player, 12, null, { shift: true, quickOrder: ['main', 'hotbar', 'armor'] });
    expect(player.get(12)).toBeNull();
    expect(player.get(38)?.item).toBe('lab:iron_leggings');
  });
});
