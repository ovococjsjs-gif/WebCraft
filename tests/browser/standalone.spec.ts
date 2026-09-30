import { APP_VERSION } from '../../packages/content/src/version';
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** A press and release in the same task, as a real short click arrives. */
async function rightClick(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const world = document.querySelector('#world')!;
    for (const type of ['mousedown', 'mouseup'])
      world.dispatchEvent(new MouseEvent(type, { button: 2, bubbles: true, cancelable: true }));
  });
}

test('the downloaded file keeps a saved world across a reload', async ({ page }) => {
  test.setTimeout(120_000); // Loading the file, a reload and a pointer-lock click take a while.
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  const url = pathToFileURL(resolve(`releases/webcraft-${APP_VERSION}.html`));
  url.search = '?preset=flat&radius=2';
  await page.goto(url.toString());
  await expect(page.locator('#play')).toBeEnabled({ timeout: 45000 });
  await expect(page.locator('#fatal')).toBeHidden();
  // A brand-new world is not reported as unsaved just because the player settled.
  await expect(page.locator('#save-quick')).toHaveAttribute('data-mode', 'saved');
  await page.click('#play');
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#target-pill')).toBeVisible();
  // Without the dev-only test hooks, the block comes from the real palette and the edit from the
  // real canvas events. The palette hands out a stone, which lands on the ground ahead.
  await page.keyboard.press('KeyP');
  await expect(page.locator('#palette-overlay')).toBeVisible();
  await page.click('[data-item="lab:stone"]');
  await expect(page.locator('#selected-name')).toHaveText('Камень');
  // One quick right click: holding the button now repeats the action every 200 ms, and a busy
  // headless page can take a second between two separate dispatches.
  await rightClick(page);
  await expect(page.locator('#toast')).toContainText('установлен');
  // The debounced autosave may already have committed; only the durable effect matters.
  await expect(page.locator('#save-quick')).not.toHaveAttribute('data-mode', 'error');
  await page.keyboard.press('Control+KeyS');
  await expect(page.locator('#save-quick')).toHaveAttribute('data-mode', 'saved', {
    timeout: 45000,
  });
  await page.reload();
  await expect(page.locator('#play')).toBeEnabled({ timeout: 45000 });
  await expect(page.locator('#save-quick')).toHaveAttribute('data-durable', 'true');
  await expect(page.locator('#world-title')).toHaveText('Плоская лаборатория');
  // The stored snapshot still reports the edited block, so the world really came back.
  await page.click('#open-worlds');
  await expect(page.locator('.world-row')).toHaveCount(1);
  await expect(page.locator('.world-row')).toContainText('1 блоков изменено');
  // Continue through the library row itself: the home screen is not visible right now.
  await page.locator('.world-open').click();
  await expect(page.locator('#hud')).toBeVisible();
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});

test('production HTML boots in an opaque allow-scripts iframe with no network', async ({
  page,
}) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  const html = readFileSync(`releases/webcraft-${APP_VERSION}.html`, 'utf8');
  await page.setContent(
    '<iframe id="preview" sandbox="allow-scripts" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>',
  );
  await page.evaluate((source) => {
    (document.querySelector('#preview') as HTMLIFrameElement).srcdoc = source;
  }, html);
  const frame = page.frameLocator('#preview');
  await expect(frame.locator('#play')).toBeEnabled({ timeout: 45000 });
  await expect(frame.locator('#fatal')).toBeHidden();
  // An opaque origin cannot persist: the app says so instead of pretending to save.
  await expect(frame.locator('#save-quick')).toHaveAttribute('data-durable', 'false');
  await expect(frame.locator('#save-quick')).toHaveAttribute('data-mode', 'temporary');
  await expect(frame.locator('#save-status-label')).toHaveText('Временный мир');
  await expect(frame.locator('.prototype-note')).toContainText('экспортируй мир');
  await frame.locator('#play').click();
  await expect(frame.locator('#hud')).toBeVisible();
  await expect(frame.locator('#fallback-hint')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(frame.locator('#pause-overlay')).toBeVisible();
  await frame.locator('[data-tab="saves"]').click();
  await expect(frame.locator('#storage-banner')).toBeVisible();
  await expect(frame.locator('#storage-heading')).toHaveText('Временный режим');
  await expect(frame.locator('#storage-message')).toContainText('IndexedDB');
  await expect(frame.locator('#save-now')).toBeEnabled(); // In-memory snapshots still work.
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});
