import { test, expect, type Page } from '@playwright/test';
import { runCoreFixture } from '../../packages/core/src/fixture';
import { BLOCK } from '../../packages/content/src/blocks';

/** A press and release in the same task, as a real short click arrives. */
async function rightClick(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const world = document.querySelector('#world')!;
    for (const type of ['mousedown', 'mouseup'])
      world.dispatchEvent(new MouseEvent(type, { button: 2, bubbles: true, cancelable: true }));
  });
}
async function boot(page: Page, url = '/?preset=flat&radius=2&spawns=off') {
  await page.goto(url);
  await page.waitForFunction(() => window.__VOXEL_LAB__?.getInfo().ready, undefined, {
    timeout: 60000,
  });
  await expect(page.locator('#fatal')).toBeHidden();
}
async function play(page: Page) {
  await page.click('#play');
  await page.waitForFunction(() => window.__VOXEL_LAB__?.getInfo().view === 'game');
}
async function aimDown(page: Page) {
  await page.evaluate(() => window.__VOXEL_LAB__!.setLook(0, -1.1));
  await page.waitForFunction(
    () =>
      window.__VOXEL_LAB__?.getState()?.target?.normal.y === 1 &&
      Math.abs((window.__VOXEL_LAB__?.getState()?.look.pitch ?? 0) + 1.1) < 0.001,
  );
}
/** Puts a stack of `item` into the active slot through the real palette interface. */
async function hold(page: Page, item: string) {
  await page.keyboard.press('KeyP');
  await expect(page.locator('#palette-overlay')).toBeVisible();
  await page.click(`[data-item="${item}"]`);
  await page.waitForFunction(
    (key) =>
      window.__VOXEL_LAB__?.getInfo().view === 'game' &&
      (window.__VOXEL_LAB__!.getState()!.inventory[
        window.__VOXEL_LAB__!.getState()!.selected
      ]?.[0] ?? '') === key,
    item,
  );
}

test('loads a real world without runtime errors and runs the identical Node/Worker fixture', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page);
  await expect(page.locator('h1')).toContainText('одного блока');
  await expect(page.locator('#play')).toBeEnabled();
  const info = await page.evaluate(() => window.__VOXEL_LAB__!.getInfo());
  expect(info.faces).toBeGreaterThan(100);
  expect(info.meshes).toBeGreaterThan(1);
  const actual = await page.evaluate(() => window.__VOXEL_LAB__!.fixture());
  expect(actual).toEqual(runCoreFixture());
  expect(errors).toEqual([]);
});

test('moves, jumps, selects a hotbar slot, flies and actually pauses the simulation', async ({
  page,
}) => {
  await boot(page);
  await play(page);
  await page.waitForFunction(() => window.__VOXEL_LAB__?.getState()?.player.onGround);
  const start = await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.player.position);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(
    (z) => window.__VOXEL_LAB__!.getState()!.player.position.z < z - 1,
    start.z,
  );
  await page.keyboard.up('KeyW');
  await page.keyboard.down('Space');
  await page.waitForFunction(
    (y) => window.__VOXEL_LAB__!.getState()!.player.position.y > y + 0.35,
    start.y,
  );
  await page.keyboard.up('Space');
  await page.keyboard.press('Digit3');
  await page.waitForFunction(() => window.__VOXEL_LAB__?.getState()?.selected === 2);
  await page.keyboard.press('KeyG');
  await page.waitForFunction(() => window.__VOXEL_LAB__?.getState()?.player.flying);
  await expect(page.locator('#flight-badge')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-overlay')).toBeVisible();
  await page.waitForFunction(() => window.__VOXEL_LAB__?.getInfo().tps === 0);
  const tick = await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.tick);
  // Intentional wall-time observation: verifies that a paused simulation stays still.
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.tick)).toBe(tick);
  await page.keyboard.press('F3');
  await page.click('#step-tick');
  await page.waitForFunction((t) => window.__VOXEL_LAB__!.getState()!.tick === t + 1, tick);
});

test('places and breaks real blocks, and chooses a palette material', async ({ page }) => {
  await boot(page);
  await play(page);
  await hold(page, 'lab:stone');
  await aimDown(page);
  // Headless Chromium's CDP absolute mouse driver emits synthetic re-centering
  // movements under pointer lock. Dispatch button events without that fake motion.
  // Real mouse dragging/clicking is separately covered in the unlocked fallback test.
  // One quick right click: holding the button now repeats the action every 200 ms, and a busy
  // headless page can take a second between two separate dispatches.
  await rightClick(page);
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()!.edits === 1);
  // The block constant has to travel into the page: the predicate runs in the browser.
  await page.waitForFunction(
    (state) => window.__VOXEL_LAB__!.getState()!.target?.state === state,
    BLOCK.STONE,
  );
  // Mining continues only while the button is held, and bare hands need 150 ticks for stone.
  // The button is released inside the page the moment the stone goes: a slow headless round trip
  // would otherwise keep it held long enough to dig the dirt below into the selected slot too.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const world = document.querySelector('#world')!;
        world.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
        const timer = setInterval(() => {
          if (window.__VOXEL_LAB__!.getState()!.edits !== 2) return;
          world.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
          clearInterval(timer);
          resolve();
        }, 5);
      }),
  );
  // The palette hands out any item, and the held item decides what the crosshair shows.
  await hold(page, 'lab:glass');
  await expect(page.locator('#selected-name')).toHaveText('Стекло');
});

test('has functioning settings, reset confirmation, new seed and diagnostic export', async ({
  page,
}) => {
  await boot(page);
  await page.click('#open-settings');
  await expect(page.locator('#menu-heading')).toHaveText('Настройки.');
  await expect(page.locator('[data-tab="game"]')).toBeHidden();
  await page.selectOption('#distance', '3');
  await page.locator('#fov').fill('85');
  await expect(page.locator('#fov-label')).toHaveText('85°');
  await page.click('#close-menu');
  await expect(page.locator('#home')).toBeVisible();
  await page.click('#world-settings');
  await expect(page.locator('#create-overlay')).toBeVisible();
  await page.fill('#seed-input', 'foundation-02');
  await page.keyboard.press('Escape');
  await expect(page.locator('#create-overlay')).toBeHidden();
  expect(await page.evaluate(() => window.__VOXEL_LAB__!.getInfo().session)).toBe(1);
  await page.click('#world-settings');
  await page.click('#regenerate');
  await page.waitForFunction(
    () => window.__VOXEL_LAB__?.getInfo().ready && window.__VOXEL_LAB__?.getInfo().session === 2,
  );
  await expect(page.locator('#seed-label')).toHaveText('foundation-02');
  await page.click('#about');
  await expect(page.locator('#about-overlay')).toBeVisible();
  await page.click('#about-debug');
  const download = page.waitForEvent('download');
  await page.click('#download-report');
  expect((await download).suggestedFilename()).toMatch(/^webcraft-report-.*\.json$/);
});

test('still plays when pointer lock is forbidden by an embedding browser', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLElement.prototype, 'requestPointerLock', {
      value: () => Promise.reject(new DOMException('Blocked by iframe', 'SecurityError')),
      configurable: true,
    });
  });
  await boot(page);
  await play(page);
  await expect(page.locator('#fallback-hint')).toBeVisible();
  await expect(page.locator('#pause-overlay')).toBeHidden();
  await hold(page, 'lab:stone');
  await page.mouse.move(512, 384);
  await page.evaluate(() => window.__VOXEL_LAB__!.setLook(0, -1.1));
  await page.waitForFunction(() => !!window.__VOXEL_LAB__!.getState()!.target);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()!.edits === 1);
  const before = await page.evaluate(() =>
    JSON.stringify(window.__VOXEL_LAB__!.getState()!.target),
  );
  await page.mouse.move(512, 384);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(662, 424, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await page.waitForFunction(
    (old) => JSON.stringify(window.__VOXEL_LAB__!.getState()!.target) !== old,
    before,
  );
  expect(await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.edits)).toBe(1);
});

test('responsive menu fits a narrow viewport without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await expect(page.locator('#play')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.click('#open-settings');
  await expect(page.locator('#pause-overlay')).toBeVisible();
  const bounds = await page.locator('#pause-overlay .modal').boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(390);
});
