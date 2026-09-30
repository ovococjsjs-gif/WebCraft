import { test, expect, type Page } from '@playwright/test';
import { BLOCK } from '../../packages/content/src/blocks';

/**
 * E07 interface tests. Every mutation goes through the real panel markup and the Worker,
 * so a lost or duplicated item would show up in the snapshot straight away.
 */
type Point = { x: number; y: number; z: number };

async function boot(page: Page, url = '/?preset=flat&radius=2&spawns=off') {
  await page.goto(url);
  await page.waitForFunction(() => window.__VOXEL_LAB__?.getInfo().ready, undefined, {
    timeout: 90000,
  });
  await expect(page.locator('#fatal')).toBeHidden();
}
async function play(page: Page) {
  await page.click('#play');
  await page.waitForFunction(() => window.__VOXEL_LAB__?.getInfo().view === 'game');
}
async function aim(page: Page, yaw: number, pitch: number) {
  await page.evaluate(([y, p]) => window.__VOXEL_LAB__!.setLook(y!, p!), [yaw, pitch] as const);
  await page.waitForFunction(
    ([y, p]) =>
      Math.abs(window.__VOXEL_LAB__!.getState()!.look.yaw - y!) < 0.01 &&
      Math.abs(window.__VOXEL_LAB__!.getState()!.look.pitch - p!) < 0.01,
    [yaw, pitch] as const,
  );
}
async function countOf(page: Page, item: string) {
  return page.evaluate(
    (key) =>
      window
        .__VOXEL_LAB__!.getState()!
        .inventory.reduce((sum, slot) => sum + (slot && slot[0] === key ? slot[1] : 0), 0),
    item,
  );
}
async function grant(page: Page, item: string, count = 1) {
  const before = await countOf(page, item);
  await page.evaluate(([key, amount]) => window.__VOXEL_LAB__!.grant(key!, amount!), [
    item,
    count,
  ] as const);
  await page.waitForFunction(
    ([key, total]) =>
      window
        .__VOXEL_LAB__!.getState()!
        .inventory.reduce((sum, slot) => sum + (slot && slot[0] === key ? slot[1] : 0), 0) >=
      total!,
    [item, before + count] as const,
  );
}
/** Every item the player owns, wherever it currently lives. */
async function owned(page: Page) {
  return page.evaluate(() => {
    const state = window.__VOXEL_LAB__!.getState()!;
    const carried = state.inventory.reduce((sum, slot) => sum + (slot ? slot[1] : 0), 0);
    const containers = state.containers.reduce(
      (sum, entry) => sum + entry.slots.reduce((inner, slot) => inner + (slot ? slot[1] : 0), 0),
      0,
    );
    const grid = state.container?.grid.reduce((sum, slot) => sum + (slot ? slot[1] : 0), 0) ?? 0;
    const ground = state.itemEntities.reduce((sum, entity) => sum + entity[1], 0);
    return carried + (state.cursor ? state.cursor[1] : 0) + containers + grid + ground;
  });
}
async function openInventory(page: Page) {
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__VOXEL_LAB__?.getInfo().panel !== null);
}
async function closePanel(page: Page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__VOXEL_LAB__?.getInfo().panel === null);
}
// A chest view and a furnace panel both name their block cells "container", and the hidden block
// keeps its markup, so the locator only ever means the cell the player can actually see.
const slotLocator = (page: Page, id: string | null, index: number) =>
  page.locator(
    `#panel-overlay [data-slot-id="${id ?? 'player'}"][data-slot-index="${index}"]:visible`,
  );
/**
 * A real mouse click on a panel slot. The panel arms its drag layer on mousedown, so the pointer
 * has to arrive over the slot first: without the hover step Playwright would press a button while
 * the pointer is still somewhere else, and the panel would read it as a drag.
 */
async function clickSlot(
  page: Page,
  id: string | null,
  index: number,
  button: 'left' | 'right' = 'left',
) {
  await slotLocator(page, id, index).hover();
  await slotLocator(page, id, index).click({ button });
  await page.waitForTimeout(150);
}
async function shiftClickSlot(page: Page, id: string | null, index: number) {
  await slotLocator(page, id, index).hover();
  await slotLocator(page, id, index).click({ modifiers: ['Shift'] });
  await page.waitForTimeout(200);
}
const cursor = (page: Page) => page.evaluate(() => window.__VOXEL_LAB__!.getState()!.cursor);
const panel = (page: Page) => page.evaluate(() => window.__VOXEL_LAB__!.getState()!.container);
/** Where the crosshair must point to build into a cell: points on its floor block's top face. */
function aimPoints(cell: Point, player: { x: number; y: number; z: number }): Point[] {
  const towardsX = Math.sign(player.x - (cell.x + 0.5)) * 0.28;
  const towardsZ = Math.sign(player.z - (cell.z + 0.5)) * 0.28;
  const points: Point[] = [];
  for (const fx of [towardsX, -towardsX, 0])
    for (const fz of [towardsZ, -towardsZ, 0])
      points.push({ x: cell.x + 0.5 + fx, y: cell.y, z: cell.z + 0.5 + fz });
  return points;
}
/** Points the crosshair at a world position, using the player's live eye height. */
async function aimAt(page: Page, point: Point) {
  const position = await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.player.position);
  const dx = point.x - position.x;
  const dy = point.y - (position.y + 1.62);
  const dz = point.z - position.z;
  await aim(page, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
}
/** Places the held block and reports whether the world really changed. */
async function tryPlace(page: Page, cell: Point, expected: number) {
  const before = await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.edits);
  await page.evaluate(() => window.__VOXEL_LAB__!.use());
  try {
    await page.waitForFunction((edits) => window.__VOXEL_LAB__!.getState()!.edits > edits, before, {
      timeout: 3000,
    });
  } catch {
    return false;
  }
  const hit = await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.target!);
  expect({ x: hit.x, y: hit.y, z: hit.z }).toEqual(cell);
  expect(hit.state).toBe(expected);
  return true;
}
async function walk(page: Page, code: string, ms: number) {
  await page.keyboard.down(code);
  await page.waitForTimeout(ms);
  await page.keyboard.up(code);
  await page.waitForTimeout(150);
}
/** False while the player's own box stands in that cell, because a block cannot be built there. */
async function cellFreeForPlayer(page: Page, cell: Point) {
  return page.evaluate((target) => {
    const position = window.__VOXEL_LAB__!.getState()!.player.position;
    const half = 0.3;
    return !(
      target.x < position.x + half &&
      target.x + 1 > position.x - half &&
      target.z < position.z + half &&
      target.z + 1 > position.z - half &&
      target.y < position.y + 1.8 &&
      target.y + 1 > position.y
    );
  }, cell);
}
/**
 * Builds a block into a free cell next to the player, or next to `anchor` so two chests really
 * end up as one double chest. The aim is computed from the live eye position and checked against
 * the real crosshair target before anything is placed: in this headless renderer a single key
 * press already carries the player a whole block, so aiming cannot rely on walking precision.
 */
async function placeNear(page: Page, anchor: Point | null, block: number): Promise<Point> {
  for (let attempt = 0; attempt < 14; attempt++) {
    const position = await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.player.position);
    const origin = anchor ?? {
      x: Math.floor(position.x),
      y: Math.floor(position.y),
      z: Math.floor(position.z),
    };
    const cells: Point[] = [
      { x: origin.x + 1, y: origin.y, z: origin.z },
      { x: origin.x - 1, y: origin.y, z: origin.z },
      { x: origin.x, y: origin.y, z: origin.z + 1 },
      { x: origin.x, y: origin.y, z: origin.z - 1 },
    ];
    for (const cell of cells) {
      if (!(await cellFreeForPlayer(page, cell))) continue;
      for (const point of aimPoints(cell, position)) {
        await aimAt(page, point);
        const hit = await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.target);
        if (!hit || hit.normal.y !== 1) continue;
        if (hit.x !== cell.x || hit.y !== cell.y - 1 || hit.z !== cell.z) continue;
        if (await tryPlace(page, cell, block)) return cell;
        break; // The crosshair found the cell but the game refused it: the cell is not free.
      }
    }
    await walk(page, attempt % 2 === 0 ? 'KeyS' : 'KeyW', 60);
  }
  throw new Error('Не нашлось места, куда поставить блок');
}
/**
 * Ctrl+S, then waits until nothing is left uncommitted. The debounced autosave often commits the
 * last edit by itself, and a world with nothing to write does not burn a revision, so waiting for
 * a *newer* timestamp would wait for ever: the durable, clean state is what the reload needs.
 */
async function saveAndWait(page: Page) {
  await page.keyboard.press('Control+KeyS');
  await page.waitForFunction(
    () => {
      const save = window.__VOXEL_LAB__!.getInfo().save;
      return save.durable && !save.busy && save.phase === 'saved' && !save.dirty;
    },
    undefined,
    { timeout: 45000 },
  );
}
async function openAt(page: Page, kind: 'chest' | 'furnace', position: Point) {
  await page.evaluate(
    ([k, p]) =>
      window.__VOXEL_LAB__!.openContainer(
        k as 'chest' | 'furnace',
        (p as Point).x,
        (p as Point).y,
        (p as Point).z,
      ),
    [kind, position] as const,
  );
  await page.waitForFunction((k) => window.__VOXEL_LAB__!.getInfo().panel === k, kind);
}

test('the panel shows the player slots, the crafting grid and a searchable recipe book', async ({
  page,
}) => {
  await boot(page);
  await play(page);
  await openInventory(page);
  await expect(page.locator('#panel-overlay')).toBeVisible();
  await expect(page.locator('#panel-title')).toHaveText('Инвентарь и крафт');
  await expect(page.locator('#player-main [data-slot-id="player"]')).toHaveCount(27);
  await expect(page.locator('#player-hotbar [data-slot-id="player"]')).toHaveCount(9);
  await expect(page.locator('#player-armor [data-slot-id="player"]')).toHaveCount(5);
  await expect(page.locator('#craft-grid [data-slot-id="grid"]')).toHaveCount(4);
  await expect(page.locator('#craft-size')).toHaveText('2×2');
  const entries = await page.locator('#recipe-list .recipe-entry').count();
  expect(entries).toBeGreaterThan(10);
  await expect(page.locator('#recipe-count')).toContainText(`/ ${entries}`);
  await page.fill('#recipe-search', 'Кирка');
  await page.waitForFunction(
    () => document.querySelectorAll('#recipe-list .recipe-entry').length > 0,
  );
  // Wood, stone, iron, gold and diamond.
  expect(await page.locator('#recipe-list .recipe-entry').count()).toBe(5);
  await page.fill('#recipe-search', '');
  await expect(page.locator('#cursor-item')).toBeHidden();
  await closePanel(page);
  await expect(page.locator('#panel-overlay')).toBeHidden();
  await expect(page.locator('#pause-overlay')).toBeHidden();
});

test('clicks move items through the grid and the cursor without losing one', async ({ page }) => {
  test.slow(); // Walking, smelting and a reload are worth more than the default budget.
  await boot(page);
  await play(page);
  await grant(page, 'lab:oak_log', 12);
  await grant(page, 'lab:coal', 5);
  const before = await owned(page);
  expect(before).toBe(17);
  await openInventory(page);
  // One log per grid cell, the remaining nine logs stay on the cursor.
  await clickSlot(page, null, 0);
  await expect(page.locator('#cursor-item')).toBeVisible();
  for (const index of [0, 1, 2]) await clickSlot(page, 'grid', index, 'right');
  expect(await cursor(page)).toEqual(['lab:oak_log', 9, 0]);
  expect(await owned(page)).toBe(before);
  // Returning the cursor to an empty slot keeps every log.
  await clickSlot(page, null, 20);
  expect(await cursor(page)).toBeNull();
  expect(await countOf(page, 'lab:oak_log')).toBe(9);
  // A left click on an empty slot with an empty cursor does nothing at all.
  await clickSlot(page, null, 21);
  expect(await cursor(page)).toBeNull();
  // Shift-clicking a grid cell sends that log straight back to the inventory.
  await shiftClickSlot(page, 'grid', 0);
  await expect.poll(() => countOf(page, 'lab:oak_log')).toBe(10);
  expect(await cursor(page)).toBeNull();
  await shiftClickSlot(page, 'grid', 1);
  await expect.poll(() => countOf(page, 'lab:oak_log')).toBe(11);
  expect(await owned(page)).toBe(before);
  // The single log left in the grid becomes four planks: the count grows by exactly three.
  await expect(page.locator('#craft-result')).not.toHaveClass(/empty/);
  await clickSlot(page, 'result', 0);
  expect(await cursor(page)).toEqual(['lab:oak_planks', 4, 0]);
  await clickSlot(page, null, 21);
  await expect.poll(() => countOf(page, 'lab:oak_planks')).toBe(4);
  expect(await countOf(page, 'lab:oak_log')).toBe(11);
  expect(await owned(page)).toBe(before + 3);
  await closePanel(page);
  expect(await owned(page)).toBe(before + 3);
  expect(await countOf(page, 'lab:oak_planks')).toBe(4);
});

test('a double chest and a furnace keep their contents across a save and reload', async ({
  page,
}) => {
  test.slow(); // Walking, smelting and a reload are worth more than the default budget.
  await boot(page);
  await play(page);
  await grant(page, 'lab:chest', 1);
  await page.evaluate(() => window.__VOXEL_LAB__!.hotbar(0));
  const first = await placeNear(page, null, BLOCK.CHEST);
  await grant(page, 'lab:chest', 1);
  await page.evaluate(() => window.__VOXEL_LAB__!.hotbar(0));
  const second = await placeNear(page, first, BLOCK.CHEST);
  expect(Math.abs(second.x - first.x) + Math.abs(second.z - first.z)).toBe(1);
  await grant(page, 'lab:coal', 12);
  await openAt(page, 'chest', second);
  expect((await panel(page))!.container.length).toBe(54);
  await expect(page.locator('#panel-title')).toHaveText('Большой сундук');
  await expect(page.locator('#panel-container [data-slot-id="container"]')).toHaveCount(54);
  // Coal in the far half, so a wrong half order would be visible.
  await clickSlot(page, null, 0);
  await clickSlot(page, 'container', 31);
  // Slot 31 is in the far half, so the coal really landed in the other chest of the pair.
  const shown = (await panel(page))!.container;
  expect(shown[31]).toEqual(['lab:coal', 12, 0]);
  expect(shown.slice(0, 27).every((slot) => !slot)).toBe(true);
  const halves = await page.evaluate(() =>
    window
      .__VOXEL_LAB__!.getState()!
      .containers.map((entry) => entry.slots.reduce((sum, slot) => sum + (slot ? slot[1] : 0), 0)),
  );
  expect(halves).toContain(12);
  expect(halves).toContain(0);
  await closePanel(page);
  // A furnace nearby: three iron ore in, one coal as fuel, then wait for the ingot.
  await grant(page, 'lab:furnace', 1);
  await page.evaluate(() => window.__VOXEL_LAB__!.hotbar(0));
  const furnaceCell = await placeNear(page, null, BLOCK.FURNACE);
  await grant(page, 'lab:iron_ore', 3);
  await grant(page, 'lab:coal', 2);
  await openAt(page, 'furnace', furnaceCell!);
  await expect(page.locator('#furnace-status')).toHaveText('Нет топлива');
  await clickSlot(page, null, 0);
  for (let i = 0; i < 3; i++) await clickSlot(page, 'container', 0, 'right');
  await clickSlot(page, null, 1);
  await clickSlot(page, 'container', 1, 'right');
  await clickSlot(page, null, 2);
  await page.waitForFunction(
    () => window.__VOXEL_LAB__!.getState()!.container?.furnace?.lit === true,
    undefined,
    { timeout: 45000 },
  );
  await expect(page.locator('#furnace-status')).toContainText('Горит');
  // One smelt is ten seconds of wall clock, exactly like the reference game.
  await page.waitForFunction(
    () => (window.__VOXEL_LAB__!.getState()!.container?.container[2]?.[1] ?? 0) > 0,
    undefined,
    { timeout: 60000 },
  );
  const smelted = await panel(page);
  expect(smelted!.container[2]?.[0]).toBe('lab:iron_ingot');
  expect(smelted!.container[0]?.[1]).toBe(2);
  expect(smelted!.furnace!.xp).toBeGreaterThan(0.6);
  await closePanel(page);
  const beforeSave = await owned(page);
  // Pausing freezes the furnace: a second ingot takes ten seconds of wall clock, and the save,
  // the reload and the reboot below all take time, so the snapshot has to be pinned first.
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-overlay')).toBeVisible();
  // Reloading is only safe once the write really committed: a reload during an in-flight save
  // would reopen the previous revision, which is how this test used to lose the freshly smelted
  // ingot now and then.
  await saveAndWait(page);
  await page.reload();
  await page.waitForFunction(() => window.__VOXEL_LAB__?.getInfo().ready, undefined, {
    timeout: 90000,
  });
  await play(page);
  await openAt(page, 'chest', second);
  const afterChest = await panel(page);
  expect(afterChest!.container.length).toBe(54);
  expect(afterChest!.container[31]).toEqual(['lab:coal', 12, 0]);
  await closePanel(page);
  await openAt(page, 'furnace', furnaceCell!);
  const afterFurnace = await panel(page);
  // Three iron ore went in and one was smelted, so the reload has to show three iron items in
  // total: a lost or duplicated stack would break this sum.
  const ingots = afterFurnace!.container[2]?.[1] ?? 0;
  const ore = afterFurnace!.container[0]?.[1] ?? 0;
  expect(afterFurnace!.container[2]?.[0]).toBe('lab:iron_ingot');
  expect(ingots + ore).toBe(3);
  expect(ingots).toBeGreaterThanOrEqual(1);
  expect(afterFurnace!.furnace!.xp).toBeGreaterThan(0.6);
  await closePanel(page);
  // The ingot is still inside the furnace, so the reload duplicated nothing.
  expect(await owned(page)).toBe(beforeSave);
});

test('death drops everything and the world keeps every stack on the ground', async ({ page }) => {
  await boot(page);
  await play(page);
  await grant(page, 'lab:iron_ingot', 7);
  await grant(page, 'lab:stick', 3);
  const before = await owned(page);
  expect(before).toBe(10);
  // Dying on the spawn point would let the respawned player reach the drops within the pickup
  // range, so walk until the death spot is more than three blocks away from the spawn point.
  const start = await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.player.position);
  for (let step = 0; step < 20; step++) {
    const now = await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.player.position);
    if (Math.abs(now.x - start.x) >= 3 || Math.abs(now.z - start.z) >= 3) break;
    await walk(page, 'KeyW', 60);
  }
  await page.evaluate(() => window.__VOXEL_LAB__!.die());
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()!.itemEntities.length > 0);
  // Longer than the pickup delay: anything the player could reach would be back in the inventory.
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => {
    const state = window.__VOXEL_LAB__!.getState()!;
    return { carried: state.inventory.filter(Boolean).length, ground: state.itemEntities.length };
  });
  expect(after.carried).toBe(0);
  expect(after.ground).toBeGreaterThan(0);
  expect(await owned(page)).toBe(before);
  await expect(page.locator('#toast')).toContainText('выпало', { timeout: 5000 });
});
