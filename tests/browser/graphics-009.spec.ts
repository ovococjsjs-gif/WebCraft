import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { APP_VERSION } from '../../packages/content/src/version';
import { BLOCK } from '../../packages/content/src/blocks';

test.use({ viewport: { width: 960, height: 640 } });
async function boot(page: Page) {
  await page.goto('/?preset=flat&radius=2&spawns=off');
  await page.waitForFunction(() => window.__VOXEL_LAB__?.getInfo().ready, null, {
    timeout: 120000,
  });
}
/**
 * The pause menu with its tabs. The title screen has no pause button, so enter the world first
 * and pause the way a player does: with the pointer captured, Escape.
 */
async function openPause(page: Page) {
  if (await page.evaluate(() => document.body.classList.contains('on-title'))) {
    await page.click('#play');
    await expect(page.locator('#hud')).toBeVisible();
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await expect(page.locator('#pause-overlay')).toBeVisible();
  } else await page.click('#pause-button');
}
async function waitTicks(page: Page, n: number) {
  const t = await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.tick);
  await page.waitForFunction((t) => window.__VOXEL_LAB__!.getState()!.tick >= t, t + n);
}
async function selectItem(page: Page, item: string) {
  await page.waitForFunction(
    (item) => window.__VOXEL_LAB__!.getState()!.inventory.some((s) => s?.[0] === item),
    item,
  );
  await page.evaluate((item) => {
    const api = window.__VOXEL_LAB__!;
    api.hotbar(api.getState()!.inventory.findIndex((s) => s?.[0] === item));
  }, item);
  await page.waitForFunction((item) => {
    const s = window.__VOXEL_LAB__!.getState()!;
    return s.inventory[s.selected]?.[0] === item;
  }, item);
}

test('G02: day/night, moon/stars and every presentation clock really freeze in pause', async ({
  page,
}) => {
  await boot(page);
  for (const time of [6000, 12000, 18000, 0]) {
    await page.evaluate((t) => window.__VOXEL_LAB__!.time(t), time);
    await page.waitForFunction(
      (t) =>
        window.__VOXEL_LAB__!.getState()!.time === t &&
        Math.abs(window.__VOXEL_LAB__!.getInfo().environment.time - t) < 1,
      time,
    );
    const e = await page.evaluate(() => window.__VOXEL_LAB__!.getInfo().environment);
    if (time === 6000) {
      expect(e.sunVisible).toBe(true);
      expect(e.moonVisible).toBe(false);
      expect(e.daylight).toBeCloseTo(0.9);
    }
    if (time === 18000) {
      expect(e.sunVisible).toBe(false);
      expect(e.moonVisible).toBe(true);
      expect(e.starsOpacity).toBeGreaterThan(0.8);
    }
    expect(e.cloudDrawCalls).toBe(1);
  }
  await page.click('#play');
  await page.evaluate(() => window.__VOXEL_LAB__!.mob('lab:cow', 4));
  await waitTicks(page, 20);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getInfo().tps === 0);
  await page.waitForTimeout(250);
  const before = await page.evaluate(() => ({
    state: window.__VOXEL_LAB__!.getState(),
    animation: window.__VOXEL_LAB__!.getInfo().animation,
    environment: window.__VOXEL_LAB__!.getInfo().environment,
    renderFrame: window.__VOXEL_LAB__!.getInfo().gpu.renderFrame,
  }));
  await page.waitForTimeout(1400);
  const after = await page.evaluate(() => ({
    state: window.__VOXEL_LAB__!.getState(),
    animation: window.__VOXEL_LAB__!.getInfo().animation,
    environment: window.__VOXEL_LAB__!.getInfo().environment,
    renderFrame: window.__VOXEL_LAB__!.getInfo().gpu.renderFrame,
  }));
  expect(after.state!.tick).toBe(before.state!.tick);
  expect(after.state!.time).toBe(before.state!.time);
  expect(after.animation.phase).toBe(before.animation.phase);
  expect(after.animation.mobs).toEqual(before.animation.mobs);
  expect(after.environment.time).toBe(before.environment.time);
  expect(after.renderFrame - before.renderFrame).toBeLessThanOrEqual(4);
});

test('G07: remapped inventory is reflected in hints, works after reload, and Escape resumes', async ({
  page,
}) => {
  await boot(page);
  await openPause(page);
  await page.click('[data-tab=controls]');
  await page.click('[data-bind=inventory]');
  await page.keyboard.press('KeyI');
  await expect(page.locator('[data-bind=inventory]')).toHaveText('I');
  await page.keyboard.press('Escape');
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('[data-control=inventory]').first()).toHaveText('I');
  await page.keyboard.press('KeyE');
  await expect(page.locator('#panel-overlay')).toBeHidden();
  await page.keyboard.press('KeyI');
  await expect(page.locator('#panel-overlay')).toBeVisible();
  await page.keyboard.press('KeyI');
  await expect(page.locator('#panel-overlay')).toBeHidden();
  await page.reload();
  await page.waitForFunction(() => window.__VOXEL_LAB__?.getInfo().ready);
  await page.click('#play');
  await page.keyboard.press('KeyI');
  await expect(page.locator('#panel-overlay')).toBeVisible();
});

test('G07: toggle controls and keyboard-accessible slots cancel cleanly when an interface opens', async ({
  page,
}) => {
  await boot(page);
  await openPause(page);
  await page.click('[data-tab=controls]');
  await page.check('#toggle-sprint');
  await page.check('#toggle-crouch');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlLeft');
  await page.keyboard.press('ShiftLeft');
  expect(await page.evaluate(() => window.__VOXEL_LAB__!.getInfo().input)).toMatchObject({
    sprint: true,
    crouch: true,
  });
  await page.evaluate(() => window.__VOXEL_LAB__!.grant('lab:iron_ingot', 3));
  await page.waitForFunction(() =>
    window.__VOXEL_LAB__!.getState()!.inventory.some((s) => s?.[0] === 'lab:iron_ingot'),
  );
  await page.keyboard.press('KeyE');
  await expect(page.locator('#panel-overlay')).toBeVisible();
  expect(await page.evaluate(() => window.__VOXEL_LAB__!.getInfo().input)).toMatchObject({
    forward: 0,
    sprint: false,
    crouch: false,
  });
  const index = await page.evaluate(() =>
    window.__VOXEL_LAB__!.getState()!.inventory.findIndex((s) => s?.[0] === 'lab:iron_ingot'),
  );
  const slot = page.locator(
    `#panel-overlay [data-slot-id=player][data-slot-index="${index}"]:visible`,
  );
  await slot.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => window.__VOXEL_LAB__!.getState()!.cursor?.[0] === 'lab:iron_ingot',
  );
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !window.__VOXEL_LAB__!.getState()!.cursor);
  await page.keyboard.press('Tab');
  expect(await slot.evaluate((el) => el !== document.activeElement)).toBe(true);
});

test('G06: graphics preferences persist and the long settings menu never hides its tabs', async ({
  page,
}) => {
  await boot(page);
  expect(await page.evaluate(() => window.__VOXEL_LAB__!.getInfo().graphics.preset)).toBe('laptop');
  await openPause(page);
  await page.click('[data-tab=settings]');
  await page.selectOption('#graphics-quality', 'economy');
  await page.selectOption('#fps-limit', '30');
  await page.uncheck('#adaptive');
  await page.uncheck('#particles');
  await page.uncheck('#clouds');
  await page.locator('#render-scale').evaluate((el) => {
    (el as HTMLInputElement).value = '80';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('[data-tab=controls]')).toBeInViewport();
  await page.click('[data-tab=controls]');
  await expect(page.locator('[data-bind=inventory]')).toBeInViewport();
  const expected = {
    preset: 'economy',
    adaptive: false,
    scale: 0.8,
    fpsLimit: 30,
    particles: false,
    clouds: false,
  };
  expect(await page.evaluate(() => window.__VOXEL_LAB__!.getInfo().graphics)).toMatchObject(
    expected,
  );
  await page.reload();
  await page.waitForFunction(() => window.__VOXEL_LAB__?.getInfo().ready);
  expect(await page.evaluate(() => window.__VOXEL_LAB__!.getInfo().graphics)).toMatchObject(
    expected,
  );
  expect(await page.locator('#world').getAttribute('width')).toBe('768');
  await page.setViewportSize({ width: 390, height: 740 });
  await openPause(page);
  await page.click('[data-tab=settings]');
  await expect(page.locator('[data-tab=controls]')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('G05: the visible bow actually draws; opening inventory cancels it without a phantom arrow', async ({
  page,
}) => {
  await boot(page);
  await page.click('#play');
  await page.evaluate(() => {
    window.__VOXEL_LAB__!.grant('lab:bow', 1);
    window.__VOXEL_LAB__!.grant('lab:arrow', 8);
  });
  await selectItem(page, 'lab:bow');
  await page.evaluate(() => window.__VOXEL_LAB__!.hold(true));
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getInfo().animation.held.bow > 0.6, null, {
    timeout: 15000,
  });
  expect(await page.evaluate(() => window.__VOXEL_LAB__!.getInfo().animation.held.item)).toBe(
    'lab:bow',
  );
  const arrows = await page.evaluate(
    () => window.__VOXEL_LAB__!.getState()!.inventory.find((s) => s?.[0] === 'lab:arrow')?.[1],
  );
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => !window.__VOXEL_LAB__!.getState()!.use.active);
  await waitTicks(page, 12);
  expect(
    await page.evaluate(
      () => window.__VOXEL_LAB__!.getState()!.inventory.find((s) => s?.[0] === 'lab:arrow')?.[1],
    ),
  ).toBe(arrows);
  expect(await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.arrows)).toHaveLength(0);
});

test('G03/G05: real WebGL batches a crowd, mixed drops and projectiles without shader errors', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await boot(page);
  const moduleURL =
    '/@fs' + fileURLToPath(new URL('../../packages/renderer/src/scene.ts', import.meta.url));
  const result = await page.evaluate(async (moduleURL) => {
    const { VoxelRenderer } = (await import(
      /* @vite-ignore */ moduleURL
    )) as typeof import('../../packages/renderer/src/scene');
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:200px;z-index:100';
    document.body.append(canvas);
    const renderer = new VoxelRenderer(canvas);
    try {
      renderer.look(0, 0);
      renderer.syncMobs(
        Array.from({ length: 24 }, (_, id) => ({
          id,
          kind: 'lab:zombie',
          x: ((id % 6) - 2.5) * 0.7,
          y: -1,
          z: -4 - Math.floor(id / 6),
          yaw: 0,
          health: 20,
          hurt: id === 0,
        })),
      );
      renderer.syncArrows(
        Array.from({ length: 24 }, (_, id) => ({
          id,
          x: ((id % 6) - 2.5) * 0.5,
          y: 0.3,
          z: -4 - Math.floor(id / 6),
          yaw: 0,
          pitch: 0,
        })),
      );
      renderer.syncItems(
        Array.from({ length: 45 }, (_, id) => ({
          id,
          item: ['lab:coal', 'lab:iron_sword', 'lab:bread'][id % 3],
          x: ((id % 9) - 4) * 0.45,
          y: -0.8,
          z: -3 - Math.floor(id / 9) * 0.4,
        })),
      );
      renderer.render(0.016);
      const active = renderer.resourceStats;
      renderer.syncMobs([]);
      renderer.syncArrows([]);
      renderer.syncItems([]);
      renderer.render(0.016);
      const empty = renderer.resourceStats;
      return { active, empty };
    } finally {
      renderer.dispose();
      canvas.remove();
    }
  }, moduleURL);
  expect(result.active.entityObjects).toBe(48);
  expect(result.active.entityParts).toBeGreaterThan(180);
  expect(result.active.entityDrawCalls).toBeLessThanOrEqual(6);
  expect(result.active.droppedItemDrawCalls).toBe(1);
  expect(result.empty.entityObjects).toBe(0);
  expect(result.empty.droppedItemDrawCalls).toBe(0);
  expect(errors).toEqual([]);
  await testInfo.attach('graphics-batches.json', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
});

test('G08: eye-level water switches fog and overlay; terrain remains ready after remeshing', async ({
  page,
}) => {
  await boot(page);
  const p = await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.player.position);
  const x = Math.floor(p.x),
    y = Math.floor(p.y + 1.62),
    z = Math.floor(p.z);
  await page.evaluate(({ x, y, z, block }) => window.__VOXEL_LAB__!.block(x, y, z, block), {
    x,
    y,
    z,
    block: BLOCK.WATER,
  });
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()?.cameraMedium === 'water');
  await expect(page.locator('body')).toHaveAttribute('data-medium', 'water');
  await page.evaluate(({ x, y, z }) => window.__VOXEL_LAB__!.block(x, y, z, 0), { x, y, z });
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()?.cameraMedium === 'air');
  await page.waitForFunction(
    () =>
      window.__VOXEL_LAB__!.getInfo().backlog === 0 && window.__VOXEL_LAB__!.getInfo().faces > 0,
  );
  await expect(page.locator('#fatal')).toBeHidden();
});

test('G06: diagnostic export contains this version, quality, frame percentiles and real features', async ({
  page,
}) => {
  await boot(page);
  await page.click('#play');
  await waitTicks(page, 30);
  await page.keyboard.press('F3');
  await expect(page.locator('#download-report')).toBeInViewport();
  const downloaded = page.waitForEvent('download');
  await page.click('#download-report');
  const download = await downloaded;
  const json = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(json.version).toBe(APP_VERSION);
  expect(json.performance.graphics.preset).toBe('laptop');
  expect(json.performance.frameTimes.samples).toBeGreaterThan(0);
  expect(json.performance.frameTimes.p95).toBeGreaterThan(0);
  expect(json.performance.gpu.terrainBytes).toBeGreaterThan(0);
  expect(json.performance.environment).toHaveProperty('moonVisible');
  expect(json.performance.measurement).toContain('not GPU timer queries');
});
