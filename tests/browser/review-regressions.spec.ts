import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { APP_VERSION } from '../../packages/content/src/version';

async function boot(page: Page, radius = 2) {
  await page.goto(`/?preset=flat&radius=${radius}&spawns=off`);
  await page.waitForFunction(() => window.__VOXEL_LAB__?.getInfo().ready, null, {
    timeout: 120000,
  });
}
async function waitDimension(page: Page, dimension: 'overworld' | 'nether' | 'end') {
  await page.waitForFunction(
    (d) => {
      const api = window.__VOXEL_LAB__,
        info = api?.getInfo();
      return info?.ready && info.meshes > 0 && info.faces > 0 && api?.getState()?.dimension === d;
    },
    dimension,
    { timeout: 180000 },
  );
}

test('R02: real Ctrl+S retains health and difficulty across a reload', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    window.__VOXEL_LAB__!.damage(7);
    window.__VOXEL_LAB__!.difficulty('hard');
  });
  await page.waitForFunction(
    () =>
      window.__VOXEL_LAB__!.getState()?.survival.health === 13 &&
      window.__VOXEL_LAB__!.getState()?.survival.difficulty === 'hard',
  );
  const revision = await page.evaluate(() => window.__VOXEL_LAB__!.getInfo().save.active!.revision);
  await page.keyboard.press('Control+KeyS');
  await page.waitForFunction((revision) => {
    const s = window.__VOXEL_LAB__!.getInfo().save;
    return !s.busy && !s.dirty && s.active!.revision > revision;
  }, revision);
  await page.reload();
  await page.waitForFunction(() => window.__VOXEL_LAB__?.getInfo().ready);
  expect(await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.survival)).toMatchObject({
    health: 13,
    difficulty: 'hard',
  });
});

test('R01/R05: worn equipped armour saves through the browser and reloads intact', async ({
  page,
}) => {
  await boot(page);
  await page.click('#play');
  await page.evaluate(() => window.__VOXEL_LAB__!.grant('lab:iron_helmet', 1));
  await page.waitForFunction(
    () => window.__VOXEL_LAB__!.getState()?.inventory[0]?.[0] === 'lab:iron_helmet',
  );
  await page.keyboard.press('KeyE');
  await expect(page.locator('#panel-overlay')).toBeVisible();
  await page.locator('#player-hotbar [data-slot-index="0"]').click({ modifiers: ['Shift'] });
  await page.waitForFunction(
    () => window.__VOXEL_LAB__!.getState()?.inventory[36]?.[0] === 'lab:iron_helmet',
  );
  await page.evaluate(() => window.__VOXEL_LAB__!.damage(7));
  await page.waitForFunction(() => (window.__VOXEL_LAB__!.getState()?.inventory[36]?.[2] ?? 0) > 0);
  const before = await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.inventory[36]);
  await page.evaluate(() => window.__VOXEL_LAB__!.save());
  await page.reload();
  await page.waitForFunction(() => window.__VOXEL_LAB__?.getInfo().ready);
  expect(await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.inventory[36])).toEqual(
    before,
  );
  await expect(page.locator('#fatal')).toBeHidden();
});

test('R11/R17: real W → E → release W stops movement; E and F both toggle the panel', async ({
  page,
}) => {
  await boot(page);
  await page.click('#play');
  await page.keyboard.press('KeyG');
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()?.player.flying);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(250);
  await page.keyboard.press('KeyE');
  await page.keyboard.up('KeyW');
  await expect(page.locator('#panel-overlay')).toBeVisible();
  const start = await page.evaluate(() => {
    const s = window.__VOXEL_LAB__!.getState()!;
    return { position: s.player.position, tick: s.tick };
  });
  await page.waitForFunction(
    (tick) => window.__VOXEL_LAB__!.getState()!.tick >= tick + 20,
    start.tick,
  );
  const end = await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.player.position);
  expect(Math.hypot(end.x - start.position.x, end.z - start.position.z)).toBeLessThan(0.05);
  await page.keyboard.press('KeyE');
  await expect(page.locator('#panel-overlay')).toBeHidden();
  await page.keyboard.press('KeyF');
  await expect(page.locator('#panel-overlay')).toBeVisible();
  await page.keyboard.press('KeyF');
  await expect(page.locator('#panel-overlay')).toBeHidden();
});

for (const radius of [2, 4, 5])
  test(`R04/R06/R07/R15: all dimension meshes and safe respawn at radius ${radius}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(240000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await boot(page, radius);
    const measurements: unknown[] = [];
    for (const dimension of ['nether', 'end', 'overworld'] as const) {
      const started = Date.now();
      await page.evaluate((d) => window.__VOXEL_LAB__!.travel(d), dimension);
      await waitDimension(page, dimension);
      const info = await page.evaluate(() => window.__VOXEL_LAB__!.getInfo());
      measurements.push({ dimension, elapsedMs: Date.now() - started, ...info });
      if (dimension !== 'overworld') {
        await expect
          .poll(() => page.evaluate(() => window.__VOXEL_LAB__!.getInfo().environment.sunVisible))
          .toBe(false);
        expect(info.environment.cloudsVisible).toBe(false);
      }
      if (dimension === 'end') {
        const state = await page.evaluate(() => window.__VOXEL_LAB__!.getState()!);
        expect(state.crystals).toHaveLength(10);
        expect(state.bosses).toHaveLength(1);
        expect(info.gpu.entityObjects).toBeGreaterThanOrEqual(11);
        await page.click('#play');
        await expect(page.locator('#boss-bar')).toBeVisible();
        await expect(page.locator('#boss-name')).toContainText('Дракон');
        await page.keyboard.press('Escape');
      }
    }
    await page.evaluate(() => window.__VOXEL_LAB__!.travel('nether'));
    await waitDimension(page, 'nether');
    await page.evaluate(() => window.__VOXEL_LAB__!.die());
    await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()?.survival.dead);
    await page.locator('#respawn-button').click();
    await waitDimension(page, 'overworld');
    expect(await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.survival.health)).toBe(20);
    await page.evaluate(() => window.__VOXEL_LAB__!.save());
    await expect(page.locator('#fatal')).toBeHidden();
    expect(errors).toEqual([]);
    await testInfo.attach('dimension-work-and-gpu.json', {
      body: JSON.stringify(measurements, null, 2),
      contentType: 'application/json',
    });
  });

test('R12: WebGL allocations plateau across 20 waves of projectiles and creatures', async ({
  page,
}, testInfo) => {
  await boot(page);
  const moduleURL =
    '/@fs' + fileURLToPath(new URL('../../packages/renderer/src/scene.ts', import.meta.url));
  const samples = await page.evaluate(async (url) => {
    const { VoxelRenderer } = await import(/* @vite-ignore */ url);
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;top:0;right:0;width:200px;height:160px';
    document.body.append(canvas);
    const renderer = new VoxelRenderer(canvas),
      stats = [];
    try {
      for (let cycle = 0; cycle < 20; cycle++) {
        renderer.syncArrows(
          Array.from({ length: 24 }, (_, id) => ({
            id,
            x: (id % 4) * 0.15,
            y: 0,
            z: -4 - id * 0.02,
            yaw: 0,
            pitch: 0,
          })),
        );
        renderer.syncMobs(
          Array.from({ length: 6 }, (_, id) => ({
            id,
            kind: 'lab:zombie',
            x: id * 0.12,
            y: -1,
            z: -4,
            yaw: 0,
            health: 20,
            hurt: false,
          })),
        );
        renderer.render(0.016, cycle);
        renderer.syncArrows([]);
        renderer.syncMobs([]);
        renderer.render(0.016, cycle + 0.5);
        stats.push(renderer.resourceStats);
      }
      return stats;
    } finally {
      renderer.dispose();
      canvas.remove();
    }
  }, moduleURL);
  const geometry = samples.map((s) => s.geometries);
  expect(Math.max(...geometry) - Math.min(...geometry)).toBeLessThanOrEqual(1);
  expect(samples.every((s) => s.entityObjects === 0)).toBe(true);
  await testInfo.attach('gpu-plateau.json', {
    body: JSON.stringify(samples, null, 2),
    contentType: 'application/json',
  });
});

test('R19: audio unlocks only after a gesture; volume and accessibility settings persist', async ({
  page,
}) => {
  await boot(page);
  expect((await page.evaluate(() => window.__VOXEL_LAB__!.getInfo().audio)).unlocked).toBe(false);
  await page.click('#open-settings');
  await page.click('[data-tab="settings"]');
  await page.locator('#volume').fill('0');
  await page.locator('#reduce-motion').check();
  await page.locator('#show-journey').uncheck();
  await expect
    .poll(() => page.evaluate(() => window.__VOXEL_LAB__!.getInfo().audio.volume))
    .toBe(0);
  await page.reload();
  await page.waitForFunction(() => window.__VOXEL_LAB__?.getInfo().ready);
  expect((await page.evaluate(() => window.__VOXEL_LAB__!.getInfo().audio)).volume).toBe(0);
  await page.click('#open-settings');
  await page.click('[data-tab="settings"]');
  await expect(page.locator('#reduce-motion')).toBeChecked();
  await expect(page.locator('#show-journey')).not.toBeChecked();
});

test('R10/R19: production survival disables palette/flight and shows the first achievable goal', async ({
  page,
}) => {
  const url = pathToFileURL(resolve(`releases/webcraft-${APP_VERSION}.html`));
  url.search = '?preset=flat&mode=survival&radius=2&spawns=off';
  await page.goto(url.toString());
  await expect(page.locator('#play')).toBeEnabled({ timeout: 60000 });
  await page.click('#play');
  await expect(page.locator('#journey-title')).toContainText('дерева');
  await page.keyboard.press('KeyP');
  await expect(page.locator('#palette-overlay')).toBeHidden();
  await expect(page.locator('#panel-overlay')).toBeVisible();
  await page.keyboard.press('KeyE');
  await expect(page.locator('#panel-overlay')).toBeHidden();
  await page.keyboard.press('KeyG');
  await expect(page.locator('#flight-badge')).toBeHidden();
  await expect(page.locator('#toast')).toContainText('творчестве');
  expect(await page.evaluate(() => window.__VOXEL_LAB__)).toBeUndefined();
});
