import { test, expect, type Page } from '@playwright/test';
import { BLOCK } from '../../packages/content/src/blocks';
import { ANVIL_MAX_COST, BREW_TICKS } from '../../packages/core/src/stations';
import { MAX_POWER } from '../../packages/core/src/redstone';

/**
 * E12/E13 interface tests: the three work stations and a redstone circuit, driven through the real
 * panel markup and the real Worker. Every number is the reference one, so an interface that draws
 * the right picture while the world does something else fails here.
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
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()!.player.onGround);
}
async function grant(page: Page, item: string, count = 1) {
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
    [item, count] as const,
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
/** Index of the first player slot that holds `item`, or -1. */
const slotOf = (page: Page, item: string) =>
  page.evaluate(
    (key) => window.__VOXEL_LAB__!.getState()!.inventory.findIndex((slot) => slot?.[0] === key),
    item,
  );
/**
 * Puts blocks into the world through the Worker's write path, in the air layer the player stands
 * in and straight next to the spawn point, so every station is inside the reach.
 */
async function build(page: Page, blocks: { x: number; y: number; z: number; state: number }[]) {
  for (const block of blocks) {
    await page.evaluate(([x, y, z, state]) => window.__VOXEL_LAB__!.block(x!, y!, z!, state!), [
      block.x,
      block.y,
      block.z,
      block.state,
    ] as const);
  }
  await page.waitForTimeout(250);
}
async function openAt(page: Page, kind: string, position: Point) {
  await page.evaluate(
    ([k, point]) =>
      window.__VOXEL_LAB__!.openContainer(
        k as 'enchanting',
        (point as Point).x,
        (point as Point).y,
        (point as Point).z,
      ),
    [kind, position] as const,
  );
  await page.waitForFunction((k) => window.__VOXEL_LAB__!.getInfo().panel === k, kind);
}
const panel = (page: Page) => page.evaluate(() => window.__VOXEL_LAB__!.getState()!.container);
/**
 * A real mouse click on one station cell. The station renderer keeps the data attributes of the
 * shared slot markup and gives the cell its own id, so a cell is addressed by that id.
 */
async function clickCell(page: Page, cellId: string) {
  const cell = page.locator(`#panel-overlay #${cellId}:visible`);
  await cell.hover();
  await cell.click();
  await page.waitForTimeout(200);
}
async function clickPlayerSlot(page: Page, index: number) {
  const cell = page.locator(
    `#panel-overlay [data-slot-id="player"][data-slot-index="${index}"]:visible`,
  );
  await cell.hover();
  await cell.click();
  await page.waitForTimeout(200);
}
/** Picks an item up from the inventory with a real click and drops it into a station cell. */
async function moveItemInto(page: Page, item: string, cellId: string) {
  const index = await slotOf(page, item);
  expect(index).toBeGreaterThanOrEqual(0);
  await clickPlayerSlot(page, index);
  await page.waitForFunction((key) => window.__VOXEL_LAB__!.getState()!.cursor?.[0] === key, item);
  await clickCell(page, cellId);
}
/**
 * A free cell beside the player at the spawn point, so a station can be dropped next to it.
 * The player stands on 4.5 / 9.0 / 8.5, and the flat world is solid at y=8.
 */
const beside = (dx: number, dz: number): Point => ({ x: 4 + dx, y: 9, z: 8 + dz });

test('the brewing stand fills, brews and hands the potion over', async ({ page }) => {
  test.slow(); // One potion run is twenty seconds of wall clock, exactly like the reference.
  await boot(page);
  await play(page);
  const stand = beside(2, 0);
  await build(page, [{ ...stand, state: BLOCK.BREWING_STAND }]);
  await grant(page, 'lab:potion_water', 3);
  await grant(page, 'lab:nether_wart', 1);
  await grant(page, 'lab:blaze_powder', 1);
  await openAt(page, 'brewing', stand);
  await expect(page.locator('#panel-eyebrow')).toHaveText('РАБОЧЕЕ МЕСТО');
  await expect(page.locator('#panel-title')).toHaveText('Варочная стойка');
  await expect(page.locator('#brew-status')).toHaveText('Нет порошка');
  // The interface loads the bottles and the powder through the Worker, not by itself.
  await page.click('#brew-load');
  await page.waitForFunction(
    () =>
      window.__VOXEL_LAB__!.getState()!.container?.brewing?.bottles.filter(Boolean).length === 3,
  );
  expect(await countOf(page, 'lab:potion_water')).toBe(0);
  expect(await countOf(page, 'lab:blaze_powder')).toBe(0);
  // The wart goes into the ingredient cell through real clicks on the panel.
  await moveItemInto(page, 'lab:nether_wart', 'brew-ingredient');
  await page.waitForFunction(
    () =>
      window.__VOXEL_LAB__!.getState()!.container?.brewing?.ingredient?.[0] === 'lab:nether_wart',
  );
  await expect(page.locator('#brew-status')).toContainText('Топливо');
  // A brewing run is 400 ticks of simulation, and the bar reports the real ratio on the way.
  expect(BREW_TICKS).toBe(400);
  const progress = await page.evaluate(
    () => window.__VOXEL_LAB__!.getState()!.container!.brewing!.progress,
  );
  expect(progress).toBeLessThan(BREW_TICKS);
  await page.waitForFunction(
    () =>
      window
        .__VOXEL_LAB__!.getState()!
        .container!.brewing!.bottles.some((bottle) => bottle?.[0] === 'lab:potion_awkward'),
    undefined,
    { timeout: 45000 },
  );
  // The awkward potion is the reference result of wart in water, and the bottles hold it in place.
  expect(
    (await panel(page))!.brewing!.bottles.filter((bottle) => bottle?.[0] === 'lab:potion_awkward')
      .length,
  ).toBe(3);
  await page.click('#brew-take');
  await page.waitForFunction(() =>
    window.__VOXEL_LAB__!.getState()!.container!.brewing!.bottles.every((b) => b === null),
  );
  expect(await countOf(page, 'lab:potion_awkward')).toBe(3);
});

test('the enchanting table reads the levels, spends them and enchants the item in its slot', async ({
  page,
}) => {
  await boot(page);
  await play(page);
  const table = beside(2, 0);
  await build(page, [{ ...table, state: BLOCK.ENCHANTING_TABLE }]);
  await grant(page, 'lab:iron_sword', 1);
  await grant(page, 'lab:lapis', 3);
  await page.evaluate(() => window.__VOXEL_LAB__!.vitals({ xp: 200 }));
  await openAt(page, 'enchanting', table);
  await expect(page.locator('#panel-title')).toHaveText('Стол зачарований');
  // The table shows the levels the player really has, and no offers without an item.
  await page.waitForFunction(
    () => (window.__VOXEL_LAB__!.getState()!.container?.enchant?.levels ?? 0) > 5,
  );
  await expect(page.locator('#enchant-offers')).toContainText('Положи предмет в слот');
  const levels = (await panel(page))!.enchant!.levels;
  expect(await page.locator('#enchant-levels').textContent()).toBe(`${levels} уровней`);
  await moveItemInto(page, 'lab:iron_sword', 'enchant-slot');
  await page.waitForFunction(
    () => (window.__VOXEL_LAB__!.getState()!.container?.enchant?.offers.length ?? 0) > 0,
  );
  const offers = (await panel(page))!.enchant!.offers;
  // A sword can take Sharpness and Unbreaking: three offers at most, each with a real price.
  expect(offers.length).toBeGreaterThan(0);
  expect(offers.length).toBeLessThanOrEqual(3);
  for (const candidate of offers) {
    expect(candidate.level).toBeGreaterThanOrEqual(1);
    expect(candidate.cost).toBeGreaterThanOrEqual(candidate.level);
  }
  const offer = [...offers].sort((a, b) => a.cost - b.cost)[0]!;
  await page.click(`[data-offer="${offer.id}"]`);
  // The toast names the enchantment that was applied, and a lapis is gone from the player.
  await expect(page.locator('#toast')).toContainText(`${offer.name} ${offer.level}`);
  expect((await panel(page))!.enchant!.lapis).toBe(2);
  expect((await panel(page))!.enchant!.levels).toBe(levels - offer.cost);
  // The enchanted sword is still in the table's slot until the player lifts it out, and a plain
  // click takes it onto the cursor first, exactly like a real interface.
  await expect(page.locator('#enchant-slot img')).toHaveCount(1);
  await clickCell(page, 'enchant-slot');
  await page.waitForFunction(
    () => window.__VOXEL_LAB__!.getState()!.cursor?.[0] === 'lab:iron_sword',
  );
  await clickPlayerSlot(page, 0);
  await page.waitForFunction(() =>
    window.__VOXEL_LAB__!.getState()!.inventory.some((slot) => slot?.[0] === 'lab:iron_sword'),
  );
  expect(await countOf(page, 'lab:iron_sword')).toBe(1);
  expect(await countOf(page, 'lab:lapis')).toBe(2);
});

test('the anvil merges two swords into one and charges its reference price in levels', async ({
  page,
}) => {
  await boot(page);
  await play(page);
  const anvil = beside(2, 0);
  await build(page, [{ ...anvil, state: BLOCK.ANVIL }]);
  await grant(page, 'lab:iron_sword', 2);
  await page.evaluate(() => window.__VOXEL_LAB__!.vitals({ xp: 200 }));
  await openAt(page, 'anvil', anvil);
  await expect(page.locator('#panel-title')).toHaveText('Наковальня');
  await expect(page.locator('#anvil-status')).toHaveText('Эти предметы не сочетаются');
  await expect(page.locator('#anvil-take')).toBeDisabled();
  await moveItemInto(page, 'lab:iron_sword', 'anvil-first');
  await moveItemInto(page, 'lab:iron_sword', 'anvil-second');
  await page.waitForFunction(
    () => (window.__VOXEL_LAB__!.getState()!.container?.anvil?.result?.length ?? 0) > 0,
  );
  await expect(page.locator('#anvil-status')).toHaveText('Предметы объединены');
  const view = (await panel(page))!.anvil!;
  // The player's own level bar decides the price, exactly as it does at the table.
  const levels = await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.survival.level);
  // Two whole swords give one whole sword, and the price is the reference one, never free.
  expect(view.result![0]).toBe('lab:iron_sword');
  expect(view.result![2] ?? 0).toBe(0);
  expect(view.cost).toBeGreaterThanOrEqual(1);
  expect(view.cost).toBeLessThanOrEqual(ANVIL_MAX_COST);
  await expect(page.locator('#anvil-take')).toBeEnabled();
  await page.click('#anvil-take');
  await expect(page.locator('#toast')).toContainText(`уровней: ${view.cost}`);
  expect(await countOf(page, 'lab:iron_sword')).toBe(1);
  const after = await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.survival.level);
  expect(after).toBe(levels - view.cost);
  expect((await panel(page))!.anvil!.result).toBeNull();
});

test('a lever, a wire and a lamp light up in the world that is really rendered', async ({
  page,
}) => {
  await boot(page);
  await play(page);
  // A line of five wires between the lever and the lamp: the signal is still strong out there.
  const y = 9;
  const z = 8;
  await build(page, [
    { x: 6, y, z, state: BLOCK.LEVER_OFF },
    ...Array.from({ length: 5 }, (_, index) => ({
      x: 7 + index,
      y,
      z,
      state: BLOCK.REDSTONE_WIRE_0,
    })),
    { x: 12, y, z, state: BLOCK.LAMP_OFF },
  ]);
  expect(MAX_POWER).toBe(15);
  /** Reads a block and its signal through the Worker and returns the reported line. */
  const probe = async (x: number) => {
    await page.evaluate(([px, py, pz]) => window.__VOXEL_LAB__!.probe(px!, py!, pz!), [
      x,
      y,
      z,
    ] as const);
    await expect(page.locator('#toast')).toContainText(`Проба ${x},${y},${z}`);
    return page.locator('#toast').textContent();
  };
  // The lever is off, so the lamp is dark and nothing arrives five blocks away.
  const idle = await probe(12);
  expect(idle).toContain(`блок ${BLOCK.LAMP_OFF}`);
  expect(idle).toContain('сигнал 0');
  await page.evaluate(([px, py, pz]) => window.__VOXEL_LAB__!.press(px!, py!, pz!), [
    6,
    y,
    z,
  ] as const);
  // The lever itself flips in the world: the node reports the block it really became.
  await expect(page.locator('#toast')).toContainText(`Рычаг 6,${y},${z}: ${BLOCK.LEVER_ON}`);
  // The solver feeds the whole line: fifteen levels at the lever, still eleven at the far wire.
  const near = await probe(7);
  expect(near).toContain('сигнал 15');
  const far = await probe(11);
  expect(far).toContain('сигнал 11');
  const lit = await probe(12);
  expect(lit).toContain(`блок ${BLOCK.LAMP_ON}`);
  // Switched off again, the line goes dark: no stale power is left in the world.
  await page.evaluate(([px, py, pz]) => window.__VOXEL_LAB__!.press(px!, py!, pz!), [
    6,
    y,
    z,
  ] as const);
  await expect(page.locator('#toast')).toContainText(`Рычаг 6,${y},${z}: ${BLOCK.LEVER_OFF}`);
  const dark = await probe(12);
  expect(dark).toContain(`блок ${BLOCK.LAMP_OFF}`);
  expect(dark).toContain('сигнал 0');
});
