import { describe, it, expect } from 'vitest';
import { BLOCK } from '../../packages/content/src/blocks';
import { WorldSession } from '../../packages/core/src/session';
import { totalItems, stack, type Container } from '../../packages/core/src/inventory';

/**
 * Acceptance suite for E07 «предметы». It walks the same route the task description
 * asks for (tree -> planks -> workbench -> wooden/stone pickaxe -> coal and iron ->
 * iron ingot) and checks after every single interface click that nothing is lost or
 * duplicated.
 */
function session(seed = 'e07-route'): WorldSession {
  const world = new WorldSession(seed, 'flat');
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) world.loadColumn(x, z);
  return world;
}
function total(s: WorldSession): number {
  const containers: Container[] = [
    s.simulation.inventory,
    ...s.simulation.containers.entries().map(([, block]) => block.slots),
  ];
  return totalItems(containers, s.simulation.cursor);
}
/** Every item the player owns: carried, in the interface, in a container or on the ground. */
function everything(s: WorldSession): number {
  const sim = s.simulation;
  const entities = sim.entities.list.reduce((sum, entity) => sum + entity.count, 0);
  const grid = sim.grid.slots.reduce((sum, slot) => sum + (slot?.count ?? 0), 0);
  return total(s) + entities + grid;
}
function restCursor(s: WorldSession) {
  const sim = s.simulation;
  if (!sim.cursor) return;
  const empty = sim.inventory.slots.findIndex((slot) => !slot);
  expect(empty).toBeGreaterThanOrEqual(0);
  sim.slotClick(null, empty, 0);
  expect(sim.cursor).toBeNull();
}
/** Takes a stack of `item` from the inventory, unless the cursor already carries it. */
function take(s: WorldSession, item: string) {
  const sim = s.simulation;
  if (sim.cursor?.item === item) return;
  restCursor(s);
  const index = sim.inventory.slots.findIndex((slot) => slot?.item === item);
  expect(index).toBeGreaterThanOrEqual(0);
  sim.slotClick(null, index, 0);
  expect(sim.cursor?.item).toBe(item);
}
/** Places exactly one item from the cursor into a slot (right click, button 2). */
function one(s: WorldSession, where: 'container' | 'grid', index: number) {
  const sim = s.simulation;
  expect(sim.open, 'интерфейс должен быть открыт').not.toBeNull();
  sim.slotClick(where === 'container' ? sim.open!.key : 'grid', index, 2);
}
/** Mines a block through the authoritative core call the worker uses when a break completes. */
function mine(s: WorldSession, x: number, y: number, z: number, expected: number) {
  expect(s.world.getBlock(x, y, z)).toBe(expected);
  expect(s.simulation.breakBlock(x, y, z)).toBe(true);
}
/**
 * Walks the player over every drop on the ground and picks it up through the real
 * pickup path (`withinPickupRange` + the inventory sink).
 */
function sweep(s: WorldSession, limit = 200) {
  const sim = s.simulation;
  for (let guard = 0; guard < limit && sim.entities.size > 0; guard++) {
    const entity = sim.entities.list[0];
    sim.player.position.x = entity.position.x;
    sim.player.position.z = entity.position.z;
    sim.step();
  }
  expect(sim.entities.size, 'на земле не должно оставаться предметов').toBe(0);
}
/** Steps the world until the drops have been collected. */
function collect(s: WorldSession, item: string, count: number, limit = 400) {
  for (let i = 0; i < limit && s.simulation.amountOf(item) < count; i++) s.simulation.step();
  expect(s.simulation.amountOf(item), `собрано ${item}`).toBeGreaterThanOrEqual(count);
}
function mineMany(s: WorldSession, blocks: [number, number, number, number][]) {
  for (const [x, y, z, state] of blocks) mine(s, x, y, z, state);
  for (let i = 0; i < 40; i++) s.simulation.step();
  sweep(s);
}
function hold(s: WorldSession, item: string) {
  const sim = s.simulation;
  const slot = sim.inventory.slots.findIndex((entry, index) => index < 9 && entry?.item === item);
  expect(slot, `${item} должен лежать в хотбаре`).toBeGreaterThanOrEqual(0);
  sim.select(slot);
  expect(sim.heldItem?.item).toBe(item);
}
/** Opens the crafting table that has already been placed in the world. */
function openTable(s: WorldSession, x: number, y: number, z: number) {
  s.simulation.openContainer('crafting_table', x, y, z);
}

describe('E07 acceptance: tree to iron ingot', () => {
  it('walks the whole progression with real mining, crafting and smelting', () => {
    const s = session();
    const sim = s.simulation;
    const px = Math.floor(sim.player.position.x),
      pz = Math.floor(sim.player.position.z),
      level = Math.floor(sim.player.position.y),
      tableY = level - 1;
    expect(total(s)).toBe(0);

    // --- 1. punch three tree blocks -------------------------------------------------
    const logs: [number, number, number, number][] = [
      [px, level, pz, BLOCK.LOG],
      [px + 1, level, pz + 1, BLOCK.LOG],
      [px + 1, level + 1, pz + 1, BLOCK.LOG],
    ];
    for (const [x, y, z, state] of logs) s.world.setBlock(x, y, z, state);
    mineMany(s, logs);
    collect(s, 'lab:oak_log', 3);
    expect(total(s)).toBe(3);

    // --- 2. planks, twelve of them, in the 2x2 grid of the inventory ----------------
    sim.openCrafting();
    expect(sim.grid.size).toBe(4);
    for (let batch = 0; batch < 3; batch++) {
      take(s, 'lab:oak_log');
      one(s, 'grid', 0);
      restCursor(s);
      expect(sim.grid.get(0)).toEqual(stack('lab:oak_log', 1));
      sim.slotClick('result', 0, 0);
      // One log becomes four planks: the only step that legitimately changes the total.
      expect(everything(s)).toBe(4 + batch * 4 + (3 - batch - 1));
      restCursor(s);
    }
    expect(sim.amountOf('lab:oak_planks')).toBe(12);
    expect(sim.grid.slots.every((slot) => !slot)).toBe(true);

    // --- 3. crafting table ----------------------------------------------------------
    take(s, 'lab:oak_planks');
    for (const index of [0, 1, 2, 3]) one(s, 'grid', index);
    restCursor(s);
    sim.slotClick('result', 0, 0);
    restCursor(s);
    expect(sim.amountOf('lab:crafting_table')).toBe(1);
    expect(sim.amountOf('lab:oak_planks')).toBe(8);
    sim.closeContainer();
    expect(sim.cursor).toBeNull();
    sim.openContainer('furnace', px, level, pz);
    expect(sim.open).toBeNull();

    // --- 4. sticks and a wooden pickaxe on the 3x3 grid -----------------------------
    s.world.setBlock(px + 1, tableY, pz, BLOCK.CRAFTING_TABLE);
    openTable(s, px + 1, tableY, pz);
    expect(sim.grid.size).toBe(9);
    expect(sim.autoFill('stick').ok).toBe(true);
    sim.slotClick('result', 0, 0, { shift: true });
    expect(sim.amountOf('lab:stick')).toBe(4);
    expect(sim.grid.slots.every((slot) => !slot)).toBe(true);
    expect(sim.amountOf('lab:oak_planks')).toBe(6);
    expect(sim.autoFill('pickaxe_wood').ok).toBe(true);
    sim.slotClick('result', 0, 0, { shift: true });
    expect(sim.amountOf('lab:wood_pickaxe')).toBe(1);
    expect(sim.amountOf('lab:oak_planks')).toBe(3);
    restCursor(s);

    // --- 5. cobblestone, twelve blocks ---------------------------------------------
    hold(s, 'lab:wood_pickaxe');
    const stoneSpots: [number, number, number, number][] = [
      [px - 1, level, pz, BLOCK.STONE],
      [px + 1, level, pz, BLOCK.STONE],
      [px, level, pz - 1, BLOCK.STONE],
      [px, level, pz + 1, BLOCK.STONE],
      [px - 1, level, pz - 1, BLOCK.STONE],
      [px - 1, level, pz + 1, BLOCK.STONE],
      [px + 1, level, pz - 1, BLOCK.STONE],
      [px + 1, level, pz + 1, BLOCK.STONE],
      [px - 1, tableY, pz - 1, BLOCK.STONE],
      [px - 1, tableY, pz + 1, BLOCK.STONE],
      [px + 1, tableY, pz - 1, BLOCK.STONE],
      [px + 1, tableY, pz + 1, BLOCK.STONE],
    ];
    for (const [x, y, z, state] of stoneSpots) s.world.setBlock(x, y, z, state);
    mineMany(s, stoneSpots);
    collect(s, 'lab:cobblestone', 12);
    const usedPick = sim.inventory.slots.find((slot) => slot?.item === 'lab:wood_pickaxe');
    expect(usedPick?.damage).toBe(12);
    expect(usedPick?.count).toBe(1);
    expect(total(s)).toBe(3 + 4 + 12);

    // --- 6. stone pickaxe -----------------------------------------------------------
    // The pickaxe is three wide: cobblestone on top, two sticks down the middle.
    take(s, 'lab:cobblestone');
    for (const index of [0, 1, 2]) one(s, 'grid', index);
    take(s, 'lab:stick');
    for (const index of [4, 7]) one(s, 'grid', index);
    expect(sim.grid.get(4)).toEqual(stack('lab:stick', 1));
    restCursor(s);
    sim.slotClick('result', 0, 0);
    restCursor(s);
    expect(sim.amountOf('lab:stone_pickaxe')).toBe(1);
    expect(sim.amountOf('lab:cobblestone')).toBe(9);
    expect(sim.amountOf('lab:stick')).toBe(0);
    hold(s, 'lab:stone_pickaxe');

    // --- 7. coal and iron ore -------------------------------------------------------
    const ores: [number, number, number, number][] = [
      [px - 1, level, pz, BLOCK.COAL_ORE],
      [px + 1, level, pz, BLOCK.COAL_ORE],
      [px, level, pz - 1, BLOCK.COAL_ORE],
      [px, level, pz + 1, BLOCK.COAL_ORE],
      [px - 1, level, pz - 1, BLOCK.IRON_ORE],
      [px - 1, level, pz + 1, BLOCK.IRON_ORE],
      [px + 1, level, pz - 1, BLOCK.IRON_ORE],
      [px + 1, level, pz + 1, BLOCK.IRON_ORE],
    ];
    for (const [x, y, z, state] of ores) s.world.setBlock(x, y, z, state);
    mineMany(s, ores);
    collect(s, 'lab:coal', 4);
    collect(s, 'lab:iron_ore', 4);
    // A wooden pickaxe cannot harvest iron ore at all, so the stone one was required.
    expect(sim.amountOf('lab:iron_ore')).toBe(4);

    // --- 8. furnace and the first iron ingot ---------------------------------------
    // A furnace is a full ring of cobblestone in the 3x3 grid.
    take(s, 'lab:cobblestone');
    for (const index of [0, 1, 2, 3, 5, 6, 7, 8]) one(s, 'grid', index);
    restCursor(s);
    sim.slotClick('result', 0, 0);
    restCursor(s);
    expect(sim.amountOf('lab:furnace')).toBe(1);
    expect(sim.amountOf('lab:cobblestone')).toBe(1);
    sim.closeContainer();

    const furnaceY = level - 2;
    s.world.setBlock(px - 1, furnaceY, pz, BLOCK.FURNACE);
    sim.openContainer('furnace', px - 1, furnaceY, pz);
    expect(sim.open?.title).toBe('Печь');
    take(s, 'lab:iron_ore');
    for (let i = 0; i < 4 && sim.cursor; i++) one(s, 'container', 0);
    restCursor(s);
    take(s, 'lab:coal');
    one(s, 'container', 1);
    restCursor(s);
    expect(sim.containerView()!.container[0]).toEqual(['lab:iron_ore', 4, 0]);
    expect(sim.containerView()!.container[1]).toEqual(['lab:coal', 1, 0]);
    // The fuel ignites on the next world tick, not when the slot is filled.
    sim.step();
    expect(sim.containerView()!.furnace).toMatchObject({
      burn: 1599,
      burnTotal: 1600,
      cook: 1,
      lit: true,
    });

    // Everything stays put while the furnace burns: no clicks, no losses.
    const held = everything(s);
    for (let i = 0; i < 200; i++) {
      sim.step();
      expect(everything(s)).toBe(held);
    }
    expect(sim.containerView()!.container[2]).toEqual(['lab:iron_ingot', 1, 0]);
    expect(sim.containerView()!.container[0]).toEqual(['lab:iron_ore', 3, 0]);
    expect(total(s)).toBe(held);

    // --- 9. the ingot goes from the furnace output into the inventory ---------------
    sim.slotClick(sim.open!.key, 2, 0);
    expect(sim.cursor).toEqual(stack('lab:iron_ingot', 1));
    restCursor(s);
    expect(sim.amountOf('lab:iron_ingot')).toBe(1);
    sim.closeContainer();
    expect(sim.cursor).toBeNull();
    expect(sim.open).toBeNull();

    // The player still owns every single item they ever picked up.
    if (process.env.TRACE)
      console.log(
        'STEP9b',
        JSON.stringify(sim.inventoryData().filter(Boolean)),
        'amountOf',
        sim.amountOf('lab:oak_planks'),
      );
    sweep(s);
    expect(sim.amountOf('lab:oak_planks')).toBe(3);
    expect(sim.amountOf('lab:cobblestone')).toBe(1);
    expect(sim.amountOf('lab:coal')).toBe(3);
    // Three ore are still waiting inside the furnace, one became the ingot.
    expect(sim.amountOf('lab:iron_ore')).toBe(0);
    expect(sim.containerData()[0].slots[0]).toEqual(['lab:iron_ore', 3, 0]);
    expect(sim.amountOf('lab:iron_ingot')).toBe(1);
    expect(sim.amountOf('lab:stick')).toBe(0);
    expect(sim.amountOf('lab:crafting_table')).toBe(1);
    expect(sim.amountOf('lab:furnace')).toBe(1);
    expect(sim.amountOf('lab:wood_pickaxe')).toBe(1);
    expect(sim.amountOf('lab:stone_pickaxe')).toBe(1);
    expect(total(s)).toBe(everything(s));
    expect(total(s)).toBe(3 + 1 + 3 + 3 + 1 + 1 + 1 + 1 + 1);
    expect(sim.heldItem?.item).toBe('lab:stone_pickaxe');
  });

  it('never loses or duplicates an item across 600 random interface clicks', () => {
    const s = session('e07-mix');
    const sim = s.simulation;
    const px = Math.floor(sim.player.position.x),
      pz = Math.floor(sim.player.position.z),
      level = Math.floor(sim.player.position.y);
    s.world.setBlock(px - 1, level, pz, BLOCK.CHEST);
    s.world.setBlock(px - 2, level, pz, BLOCK.CHEST); // double chest
    s.world.setBlock(px + 1, level, pz, BLOCK.FURNACE);
    s.world.setBlock(px + 1, level - 1, pz, BLOCK.CRAFTING_TABLE);
    sim.grant('lab:iron_ingot', 64);
    sim.grant('lab:coal', 40);
    sim.grant('lab:iron_ore', 20);
    sim.grant('lab:oak_log', 12);
    sim.grant('lab:stick', 5);
    const expected = total(s);
    expect(expected).toBe(141);
    let state = 97531;
    const random = () => {
      state = (state * 48271) % 2147483647;
      return state / 2147483647;
    };
    for (let i = 0; i < 600; i++) {
      const roll = random();
      if (roll < 0.25) sim.openContainer('chest', px - 1, level, pz);
      else if (roll < 0.45) sim.openContainer('furnace', px + 1, level, pz);
      else if (roll < 0.65) sim.openContainer('crafting_table', px + 1, level - 1, pz);
      else if (roll < 0.75) sim.openCrafting();
      const view = sim.containerView();
      const hasGrid = !!view && view.kind !== 'chest' && view.kind !== 'furnace';
      const size =
        view?.kind === 'chest' ? view.container.length : hasGrid ? view!.gridSize ** 2 : 3;
      const where = (['container', 'grid', null] as const)[Math.floor(random() * 3)]!;
      if (!view) continue;
      if (where === 'grid' && !hasGrid) continue;
      const index = Math.floor(random() * size);
      const mode = random() < 0.3 ? 2 : 0;
      sim.slotClick(where === 'container' ? view.key : where, index, mode, {
        shift: random() < 0.35,
        double: random() < 0.08,
      });
      if (random() < 0.06) sim.closeContainer();
      if (random() < 0.04) sim.dropSelected(random() < 0.5);
      if (random() < 0.1) sim.step();
      expect(everything(s), `клик ${i}: ${where ?? 'инвентарь'}[${index}] режим ${mode}`).toBe(
        expected,
      );
    }
    sim.closeContainer();
    // Items dropped on the ground are still owned, so the player can pick them all back up.
    sweep(s);
    expect(total(s)).toBe(expected);
  });

  it('saves the crafting grid without disturbing the open interface', () => {
    const s = session('e07-grid');
    const sim = s.simulation;
    sim.grant('lab:oak_log', 5);
    sim.openCrafting();
    take(s, 'lab:oak_log');
    for (const index of [0, 1, 2]) one(s, 'grid', index);
    restCursor(s);
    expect(everything(s)).toBe(5);
    const liveGrid = sim.grid.slots.map((slot) => (slot ? slot.item : null));
    const checkpoint = s.checkpoint();
    // A background save must leave the panel exactly as the player left it.
    expect(sim.grid.slots.map((slot) => (slot ? slot.item : null))).toEqual(liveGrid);
    expect(sim.grid.slots.filter(Boolean)).toHaveLength(3);
    // The saved copy carries those three logs, so a reload finds every item.
    const saved = checkpoint.inventory.slots.reduce((sum, slot) => sum + (slot ? slot[1] : 0), 0);
    expect(saved).toBe(5);
    const restored = new WorldSession('e07-grid', 'flat', checkpoint);
    expect(restored.simulation.amountOf('lab:oak_log')).toBe(5);
    expect(restored.simulation.grid.slots.every((slot) => !slot)).toBe(true);
  });
  it('restores the furnace, the double chest and the inventory from a checkpoint', () => {
    const s = session('e07-save');
    const sim = s.simulation;
    const px = Math.floor(sim.player.position.x),
      pz = Math.floor(sim.player.position.z),
      level = Math.floor(sim.player.position.y);
    s.world.setBlock(px - 1, level, pz, BLOCK.CHEST);
    s.world.setBlock(px - 2, level, pz, BLOCK.CHEST);
    s.world.setBlock(px + 1, level, pz, BLOCK.FURNACE);
    sim.openContainer('chest', px - 1, level, pz);
    expect(sim.open?.title).toBe('Большой сундук');
    sim.open!.view!.set(0, stack('lab:coal', 12));
    sim.open!.view!.set(31, stack('lab:iron_ingot', 5));
    sim.closeContainer();
    sim.grant('lab:iron_ore', 4);
    sim.grant('lab:coal', 2);
    sim.openContainer('furnace', px + 1, level, pz);
    take(s, 'lab:iron_ore');
    for (let i = 0; i < 4 && sim.cursor; i++) one(s, 'container', 0);
    restCursor(s);
    take(s, 'lab:coal');
    one(s, 'container', 1);
    restCursor(s);
    expect(sim.containerView()!.container[0]).toEqual(['lab:iron_ore', 4, 0]);
    for (let i = 0; i < 250; i++) sim.step();
    const before = sim.containerData().find((entry) => entry.kind === 'furnace')!;
    expect(before.furnace!.burn).toBeGreaterThan(0);
    expect(before.furnace!.cook).toBeGreaterThan(0);
    expect(before.slots[2]).toEqual(['lab:iron_ingot', 1, 0]);
    sim.grant('lab:stick', 7);
    // A drop far away from the player, so restoring it cannot be confused with a pickup.
    sim.entities.spawn('lab:iron_ingot', 3, { x: px - 4.5, y: level + 1, z: pz - 4.5 });
    const checkpoint = s.checkpoint();
    const restored = new WorldSession('e07-save', 'flat', checkpoint);
    restored.loadColumn(0, 0);
    const after = restored.simulation;
    expect(after.containerData()).toEqual(sim.containerData());
    expect(after.inventoryData()).toEqual(sim.inventoryData());
    expect(after.entities.snapshot()).toEqual(sim.entities.snapshot());
    expect(after.amountOf('lab:stick')).toBe(7);
    expect(after.amountOf('lab:coal')).toBe(sim.amountOf('lab:coal'));
    // The restored furnace keeps burning from the saved counters, one tick at a time.
    restored.simulation.step();
    const furnaceAfter = restored.simulation
      .containerData()
      .find((entry) => entry.kind === 'furnace')!;
    expect(furnaceAfter.furnace!.burn).toBe(before.furnace!.burn - 1);
    expect(furnaceAfter.furnace!.cook).toBe(before.furnace!.cook + 1);
    // A reload must not duplicate anything either: same inventory, same chest and furnace.
    const reloaded = new WorldSession('e07-save', 'flat', restored.checkpoint());
    reloaded.loadColumn(0, 0);
    expect(reloaded.simulation.containerData()).toEqual(restored.simulation.containerData());
    expect(reloaded.simulation.inventoryData()).toEqual(restored.simulation.inventoryData());
    expect(reloaded.simulation.entities.snapshot()).toEqual(
      restored.simulation.entities.snapshot(),
    );
    expect(totalItems([reloaded.simulation.inventory])).toBe(
      totalItems([restored.simulation.inventory]),
    );
    expect(totalItems([reloaded.simulation.inventory])).toBe(totalItems([sim.inventory]));
  });
});
