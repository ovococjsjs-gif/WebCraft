import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseWorldFile, payloadChecksum } from '../../packages/storage/src/format';

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
async function lookDown(page: Page) {
  await page.evaluate(() => window.__VOXEL_LAB__!.setLook(0, -1.1));
  await page.waitForFunction(
    () =>
      window.__VOXEL_LAB__?.getState()?.target?.normal.y === 1 &&
      Math.abs((window.__VOXEL_LAB__?.getState()?.look.pitch ?? 0) + 1.1) < 0.001,
  );
}
/**
 * Puts a stack of `item` into the active slot. Deliberately not the palette menu: leaving the
 * game view triggers a background save, and these tests count save revisions.
 */
async function hold(page: Page, item: string) {
  await page.evaluate(([key, count]) => window.__VOXEL_LAB__!.grant(key!, count!), [
    item,
    64,
  ] as const);
  await page.waitForFunction(
    (key) =>
      (window.__VOXEL_LAB__!.getState()!.inventory[
        window.__VOXEL_LAB__!.getState()!.selected
      ]?.[0] ?? '') === key,
    item,
  );
}
/** Returns the block coordinate that the next right click will occupy. */
/** Returns false quickly when that direction has no free top face, instead of blocking. */
async function aim(page: Page, yaw: number) {
  await page.evaluate((value) => window.__VOXEL_LAB__!.setLook(value, -1.1), yaw);
  // Both angles must be awaited: the previous pitch can already produce a top face.
  await page.waitForFunction(
    (value) => {
      const state = window.__VOXEL_LAB__?.getState();
      return (
        state?.target?.normal.y === 1 &&
        Math.abs(state.look.yaw - value) < 0.001 &&
        Math.abs(state.look.pitch + 1.1) < 0.001
      );
    },
    yaw,
    { timeout: 4000 },
  );
}
/** The prototype refuses to place a solid block inside the player, so aim until a spot is free. */
async function placeBlock(page: Page): Promise<{ x: number; y: number; z: number }> {
  const edits = await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.edits);
  for (const yaw of [0, 1, -1, 2, 3]) {
    try {
      await aim(page, yaw);
    } catch {
      continue; // Nothing placeable in that direction from here.
    }
    const position = await page.evaluate(() => {
      const hit = window.__VOXEL_LAB__!.getState()!.target!;
      return { x: hit.x + hit.normal.x, y: hit.y + hit.normal.y, z: hit.z + hit.normal.z };
    });
    // Headless Chromium's CDP absolute mouse driver injects synthetic pointer-lock
    // re-centering deltas. Dispatch the button events without that fake motion;
    // real dragging and clicking is covered by the unlocked fallback test.
    // One quick right click: holding the button now repeats the action every 200 ms, and a busy
    // headless page can take a second between two separate dispatches.
    await rightClick(page);
    try {
      await page.waitForFunction((n) => window.__VOXEL_LAB__!.getState()!.edits === n, edits + 1, {
        timeout: 2000,
      });
      return position;
    } catch {
      // Rejected because that spot intersects the player: try another direction.
    }
  }
  throw new Error('No direction produced a legal block placement.');
}
/** Playwright's clock is not under our control, so idle is detected by observation. */
async function waitUntilStill(page: Page) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const before = await page.evaluate(() =>
      JSON.stringify(window.__VOXEL_LAB__!.getState()!.player.position),
    );
    await page.waitForTimeout(250);
    const after = await page.evaluate(() =>
      JSON.stringify(window.__VOXEL_LAB__!.getState()!.player.position),
    );
    if (before === after) return;
  }
  throw new Error('The player never came to rest.');
}
/** While pointer lock is active Chromium routes clicks to the locked canvas, as it should. */
async function openMenu(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-overlay')).toBeVisible();
}
async function save(page: Page) {
  // A debounced autosave may have committed the last change already; one more item change makes
  // sure a manual Ctrl+S always has something to write, so waiting for a new revision is safe.
  if (!(await status(page)).dirty)
    await page.evaluate(() => window.__VOXEL_LAB__!.grant('lab:stick', 1));
  const before = await page.evaluate(() => window.__VOXEL_LAB__!.getInfo().save.savedAt);
  await page.keyboard.press('Control+KeyS');
  await page.waitForFunction(
    (previous) => {
      const save = window.__VOXEL_LAB__!.getInfo().save;
      return !save.busy && save.phase === 'saved' && (save.savedAt ?? 0) > (previous ?? 0);
    },
    before,
    { timeout: 45000 },
  );
}
const status = (page: Page) => page.evaluate(() => window.__VOXEL_LAB__!.getInfo().save);
const activeID = (page: Page) =>
  page.evaluate(() => window.__VOXEL_LAB__!.getInfo().save.active?.id ?? '');
const row = (page: Page, id: string) => page.locator(`.world-row[data-world="${id}"]`);

test('saves to IndexedDB with Ctrl+S and restores the block after a full page reload', async ({
  page,
}) => {
  await boot(page);
  await play(page);
  await lookDown(page);
  await hold(page, 'lab:stone');
  const placed = await placeBlock(page);
  // A debounced autosave may have committed the placement already; one more item change makes
  // sure the manual Ctrl+S writes a fresh revision either way.
  // The autosave can win the race against this check, so keep changing something until an
  // unsaved change is actually observed.
  await expect
    .poll(
      async () => {
        if ((await status(page)).dirty) return true;
        await page.evaluate(() => window.__VOXEL_LAB__!.grant('lab:stick', 1));
        return false;
      },
      { timeout: 20000, intervals: [300, 600, 1000] },
    )
    .toBe(true);
  expect(await status(page)).toMatchObject({ durable: true });
  await save(page);
  const saved = await status(page);
  expect(saved).toMatchObject({ phase: 'saved', durable: true, dirty: false, error: '' });
  expect(saved.active?.changedBlocks).toBe(1);
  expect(saved.active?.revision).toBeGreaterThanOrEqual(2);
  const id = saved.active!.id;

  await page.reload();
  await page.waitForFunction(() => window.__VOXEL_LAB__?.getInfo().ready, undefined, {
    timeout: 60000,
  });
  expect(await activeID(page)).toBe(id);
  expect((await status(page)).active?.changedBlocks).toBe(1);
  expect(page.url()).toContain(`world=${id}`);
  // Re-entering the original link (a plain relic, or a shared link) must not spawn a copy.
  await page.goto('/?preset=flat&radius=2&spawns=off');
  await page.waitForFunction(() => window.__VOXEL_LAB__?.getInfo().ready, undefined, {
    timeout: 60000,
  });
  expect(await activeID(page)).toBe(id);
  expect((await status(page)).active?.changedBlocks).toBe(1);
  // The world list still holds exactly one world for this configuration.
  await page.click('#open-worlds');
  await expect(page.locator('.world-row')).toHaveCount(1);
  await page.click('#close-worlds');

  // The restored look, player and level geometry all point at the same saved block.
  const restored = await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.target);
  expect(restored).toMatchObject({ state: 3, x: placed.x, y: placed.y, z: placed.z });
  // Reloading is not enough by itself: the exact saved state must come back.
  const checkpoint = await page.evaluate(() => window.__VOXEL_LAB__!.capture());
  expect(checkpoint.overrides).toEqual([[placed.x, placed.y, placed.z, 'lab:stone']]);
  expect(checkpoint.generator.preset).toBe('flat');
});

test('exports a portable world file, imports it as a new world, and rejects foreign files', async ({
  page,
}) => {
  await boot(page);
  await play(page);
  await lookDown(page);
  await hold(page, 'lab:grass');
  const placed = await placeBlock(page);
  await save(page);
  const id = await activeID(page);
  expect((await status(page)).active?.changedBlocks).toBe(1);

  await openMenu(page);
  await page.click('[data-tab="saves"]');
  const download = page.waitForEvent('download');
  await page.click('#export-active');
  const file = readFileSync((await (await download).path())!, 'utf8');
  const parsed = parseWorldFile(file);
  expect(parsed.payload.core.overrides).toHaveLength(1);
  expect(parsed.payload.core.overrides[0].slice(0, 3)).toEqual([placed.x, placed.y, placed.z]);
  expect(parsed.payload.core.generator.preset).toBe('flat');
  expect(parsed.payload.core.generator.seed).toBe('642018');
  expect(parsed.checksum.value).toHaveLength(64);

  // The import handler is asynchronous, so poll for its effect instead of assuming it finished.
  await page.click('#open-worlds-menu');
  await expect(page.locator('.world-row')).toHaveCount(1);
  await page.setInputFiles('#world-file-input', {
    name: 'imported.voxel.json',
    mimeType: 'application/json',
    buffer: Buffer.from(file),
  });
  await page.waitForFunction(
    (previous) => window.__VOXEL_LAB__!.getInfo().save.active?.id !== previous,
    id,
    { timeout: 45000 },
  );
  const importedID = await activeID(page);
  expect(importedID).not.toBe(id); // A new record, never an overwrite of the open world.
  expect((await status(page)).active?.changedBlocks).toBe(1);
  expect((await status(page)).active?.name).toBe(parsed.payload.name);
  await page.click('#open-worlds');
  await expect(page.locator('.world-row')).toHaveCount(2);
  await expect(row(page, id)).toContainText(parsed.payload.name);
  await expect(row(page, importedID)).toContainText(parsed.payload.name);

  /** Rejected documents must leave every stored record and the open world untouched. */
  const rejected = async (name: string, buffer: Buffer, message: string) => {
    const before = await status(page);
    await page.setInputFiles('#world-file-input', { name, mimeType: 'application/json', buffer });
    await page.waitForFunction(
      (previous) => {
        const warning = document.querySelector('#library-warning');
        return (
          !!warning &&
          !warning.hasAttribute('hidden') &&
          (warning.textContent ?? '').trim().length > 0 &&
          window.__VOXEL_LAB__!.getInfo().save.active?.id === previous
        );
      },
      importedID,
      { timeout: 45000 },
    );
    await expect(page.locator('#library-warning')).toContainText(message);
    await expect(page.locator('.world-row')).toHaveCount(2);
    expect(await activeID(page)).toBe(importedID);
    expect((await status(page)).active?.revision).toBe(before.active?.revision);
  };
  await rejected(
    'foreign.json',
    Buffer.from(
      '{"format":"minecraft/level","version":1,"checksum":{"algorithm":"SHA-256","value":"' +
        '0'.repeat(64) +
        '"},"payload":{}}',
    ),
    'не файл мира WebCraft',
  );
  await rejected(
    'report.json',
    Buffer.from('{"app":"voxel-web-lab","version":"0.2.0","state":{"tick":10},"messages":[]}'),
    'Некорректный файл мира',
  );
  // A file that names something this build does not know: the world must stay untouched. The
  // replacement has to stay foreign to the registry, so it is a key that no stage will ever add.
  const altered = JSON.parse(file.replace('"lab:grass"', '"lab:not_a_real_item"'));
  await rejected('tampered.voxel.json', Buffer.from(JSON.stringify(altered)), 'Контрольная сумма');
  // A correctly signed but unsupported block reaches the schema check AFTER authentication.
  altered.checksum.value = payloadChecksum(altered.payload);
  await rejected(
    'unknown-block.voxel.json',
    Buffer.from(JSON.stringify(altered)),
    'не поддерживается',
  );
  await expect(page.locator('#fatal')).toBeHidden();
});

test('an exported file opens the same world in a clean browser profile', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await boot(page);
  await play(page);
  await hold(page, 'lab:grass');
  const placed = await placeBlock(page);
  await save(page);
  await openMenu(page);
  await page.click('[data-tab="saves"]');
  const download = page.waitForEvent('download');
  await page.click('#export-active');
  const file = readFileSync((await (await download).path())!, 'utf8');

  // A separate context has its own empty storage: the equivalent of a fresh browser profile.
  const clean = await browser.newContext({
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1024, height: 768 },
  });
  try {
    const fresh = await clean.newPage();
    await fresh.goto('/?preset=flat&radius=2&spawns=off');
    await fresh.waitForFunction(() => window.__VOXEL_LAB__?.getInfo().ready, undefined, {
      timeout: 60000,
    });
    expect(
      await fresh.evaluate(() => window.__VOXEL_LAB__!.getInfo().save.active?.changedBlocks),
    ).toBe(0);
    await fresh.click('#play');
    await fresh.waitForFunction(() => window.__VOXEL_LAB__!.getInfo().view === 'game');
    await fresh.keyboard.press('Escape');
    await expect(fresh.locator('#pause-overlay')).toBeVisible();
    await fresh.setInputFiles('#world-file-input', {
      name: 'ported.voxel.json',
      mimeType: 'application/json',
      buffer: Buffer.from(file),
    });
    await fresh.waitForFunction(
      () => window.__VOXEL_LAB__!.getInfo().save.active?.changedBlocks === 1,
      undefined,
      { timeout: 45000 },
    );
    const restored = await fresh.evaluate(() => window.__VOXEL_LAB__!.getState()!.target);
    expect(restored).toMatchObject({ state: 1, x: placed.x, y: placed.y, z: placed.z });
    expect(await fresh.evaluate(() => window.__VOXEL_LAB__!.getInfo().save.active?.seed)).toBe(
      '642018',
    );
  } finally {
    await clean.close();
  }
});

test('a failed write keeps the last good revision, reports it, and can be retried', async ({
  page,
}) => {
  test.slow(); // Two placements, a rejected write, a retry and a reboot.
  await boot(page);
  await play(page);
  await lookDown(page);
  await hold(page, 'lab:grass');
  const first = await placeBlock(page);
  await save(page);
  const id = await activeID(page);
  // A background autosave may have committed the same block a moment earlier, so the revision
  // number itself is not fixed: what matters is that a revision now holds the edit.
  const firstCommit = await status(page);
  expect(firstCommit.active?.changedBlocks).toBeGreaterThanOrEqual(1);

  const second = await placeBlock(page);
  expect(second).not.toEqual(first);
  // Let the debounced autosave carry both blocks into the committed revision, so the rejected
  // write below starts from a known, clean baseline.
  await expect
    .poll(async () => (await status(page)).active?.changedBlocks ?? 0, { timeout: 30000 })
    .toBe(2);
  // A fresh block makes the world dirty again, and placing it changes the camera as well, so the
  // manual write below always has something to commit.
  const third = await placeBlock(page);
  expect(third).not.toEqual(first);
  expect(third).not.toEqual(second);
  // The fault and the write happen in one page task, and the pointer is read in that same task:
  // whatever the debounced autosave committed first becomes the baseline of the comparison.
  const committed = await page.evaluate(() => {
    const active = window.__VOXEL_LAB__!.getInfo().save.active;
    const pointer = { revision: active?.revision ?? 0, changedBlocks: active?.changedBlocks ?? 0 };
    window.__VOXEL_LAB__!.failNextSave('quota');
    void window.__VOXEL_LAB__!.save().catch(() => {}); // The rejection is asserted through the UI state.
    return pointer;
  });
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getInfo().save.phase === 'error');
  const failed = await status(page);
  expect(failed.error).toContain('недостаточно места');
  expect(failed.error).toContain('не изменена');
  // The committed revision was not replaced: the pointer is exactly where it was.
  expect(failed.active?.revision).toBe(committed.revision);
  expect(failed.active?.changedBlocks).toBe(committed.changedBlocks);
  await openMenu(page);
  await page.click('[data-tab="saves"]');
  await expect(page.locator('#storage-banner')).toContainText('Сохранение не подтверждено');
  await expect(page.locator('#storage-banner')).toContainText('не изменена');

  const failedAgain = await status(page);
  expect(failedAgain.dirty).toBe(true);
  // A transient failure must not poison the session: the button retries the same snapshot.
  await page.click('#save-now');
  await page.waitForFunction(
    (previous) => {
      const save = window.__VOXEL_LAB__!.getInfo().save;
      return !save.busy && save.phase === 'saved' && (save.savedAt ?? 0) > (previous ?? 0);
    },
    failedAgain.savedAt,
    { timeout: 45000 },
  );
  const after = await status(page);
  expect(after).toMatchObject({ phase: 'saved', error: '' });
  expect(after.active?.revision).toBe(committed.revision + 1);
  expect(after.active?.changedBlocks).toBe(3);

  await page.reload();
  await page.waitForFunction(() => window.__VOXEL_LAB__?.getInfo().ready, undefined, {
    timeout: 60000,
  });
  expect(await activeID(page)).toBe(id);
  expect((await status(page)).active?.changedBlocks).toBe(3);
  const target = await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.target);
  const checkpoint = await page.evaluate(() => window.__VOXEL_LAB__!.capture());
  // Every block survived the failed write plus the retry...
  expect(checkpoint.overrides.map((entry) => entry.slice(0, 3))).toEqual(
    expect.arrayContaining([
      [first.x, first.y, first.z],
      [second.x, second.y, second.z],
      [third.x, third.y, third.z],
    ]),
  );
  // ...and the restored crosshair still points at one of them, not at empty air.
  expect(target?.state).toBe(1);
  expect([first, second, third]).toContainEqual({ x: target!.x, y: target!.y, z: target!.z });
});

test('a corrupt latest snapshot opens the previous verified copy and rebases on save', async ({
  page,
}) => {
  await boot(page);
  await play(page);
  await lookDown(page);
  await hold(page, 'lab:grass');
  await placeBlock(page);
  // Let the debounced autosave commit the placement on its own: a Ctrl+S racing it would write a
  // second revision on a slow machine, and the backup must be the world *before* the block.
  await page.waitForFunction(
    () => {
      const save = window.__VOXEL_LAB__!.getInfo().save;
      return (
        !save.busy && !save.dirty && save.phase === 'saved' && (save.active?.revision ?? 0) >= 2
      );
    },
    undefined,
    { timeout: 30000 },
  );
  const id = await activeID(page);
  expect((await status(page)).active?.revision).toBe(2);

  await page.evaluate(async (worldId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('voxel-lab-worlds');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['records'], 'readwrite');
      const store = tx.objectStore('records');
      const get = store.get(worldId);
      get.onsuccess = () => {
        const record = get.result as { value: { current: { payload: { name: string } } } };
        record.value.current.payload.name = 'tampered';
        store.put(record);
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }, id);

  await page.reload();
  await page.waitForFunction(() => window.__VOXEL_LAB__?.getInfo().ready, undefined, {
    timeout: 60000,
  });
  const recovered = await status(page);
  expect(recovered.recovered).toBe(true);
  expect(recovered.active?.revision).toBe(2); // The stored record itself is untouched.
  expect(recovered.active?.changedBlocks).toBe(0); // The backup before the tampered write.
  await expect(page.locator('#recovery-notice')).toBeVisible();
  await expect(page.locator('#recovery-notice')).toContainText('резервная копия');

  await save(page);
  const repaired = await status(page);
  expect(repaired).toMatchObject({ recovered: false, phase: 'saved', error: '' });
  expect(repaired.active?.revision).toBe(3);
  await expect(page.locator('#recovery-notice')).toBeHidden();
  await page.reload();
  await page.waitForFunction(() => window.__VOXEL_LAB__?.getInfo().ready, undefined, {
    timeout: 60000,
  });
  expect((await status(page)).recovered).toBe(false);
  expect((await status(page)).active?.revision).toBe(3);
  // The damaged copy was discarded: the repaired snapshot is what the next save backs up.
  await expect(page.locator('#fatal')).toBeHidden();
});

test('library creates, renames, duplicates and deletes worlds without losing others', async ({
  page,
}) => {
  await boot(page);
  const firstID = await activeID(page);
  await page.click('#open-worlds');
  await expect(page.locator('.world-row')).toHaveCount(1);

  await page.click('#new-world');
  await page.fill('#new-world-name', 'Второй мир');
  await page.fill('#seed-input', 'save-b');
  await page.selectOption('#preset', 'valley');
  await page.click('#regenerate');
  await page.waitForFunction(
    (previous) =>
      window.__VOXEL_LAB__?.getInfo().ready &&
      window.__VOXEL_LAB__!.getInfo().save.active?.id !== previous,
    firstID,
    { timeout: 30000 },
  );
  const secondID = await activeID(page);
  expect(secondID).not.toBe(firstID);
  expect((await status(page)).active?.name).toBe('Второй мир');
  expect((await status(page)).active?.preset).toBe('valley');

  await page.click('#open-worlds');
  await expect(page.locator('.world-row')).toHaveCount(2);
  await expect(row(page, firstID)).toContainText('Плоская лаборатория');

  await row(page, secondID).locator('[data-world-action="rename"]').click();
  await page.fill('#world-action-name', 'Переименованный мир');
  await page.click('#world-action-confirm');
  await expect(row(page, secondID)).toContainText('Переименованный мир');

  await row(page, secondID).locator('[data-world-action="copy"]').click();
  await page.waitForFunction(
    (previous) => window.__VOXEL_LAB__!.getInfo().save.active?.id !== previous,
    secondID,
    { timeout: 30000 },
  );
  const copyID = await activeID(page);
  expect((await status(page)).active?.name).toContain('копия');
  await page.click('#open-worlds');
  await expect(page.locator('.world-row')).toHaveCount(3);

  await row(page, copyID).locator('[data-world-action="delete"]').click();
  await expect(page.locator('#world-action-overlay')).toBeVisible();
  await page.click('#world-action-confirm');
  await page.waitForFunction(
    (removed) => window.__VOXEL_LAB__!.getInfo().save.active?.id !== removed,
    copyID,
    { timeout: 30000 },
  );
  await expect(page.locator('.world-row')).toHaveCount(2);
  await expect(row(page, firstID)).toContainText('Плоская лаборатория');
  await expect(row(page, secondID)).toContainText('Переименованный мир');
  await expect(page.locator('#fatal')).toBeHidden();
});

test('an idle world skips autosaves, but an explicit save still captures fresh state', async ({
  page,
}) => {
  await boot(page);
  await play(page);
  await page.waitForFunction(() => window.__VOXEL_LAB__?.getState()?.player.onGround);
  const revision = (await status(page)).active?.revision;
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyW');
  await waitUntilStill(page);
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getInfo().save.dirty);
  // Ticks advance continuously; only real state changes may be persisted.
  await page.evaluate(() => window.__VOXEL_LAB__!.save());
  const moved = await status(page);
  expect(moved.active?.revision).toBe((revision ?? 0) + 1);
  expect(moved.dirty).toBe(false);
  // A complete autosave period does not rotate an unchanged snapshot.
  await page.waitForTimeout(15500);
  expect((await status(page)).active?.revision).toBe(moved.active?.revision);
  expect(await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.tick)).toBeGreaterThan(0);
  // Manual save captures the exact tick/time even when the meaningful-state stamp is clean.
  await page.evaluate(() => window.__VOXEL_LAB__!.save());
  expect((await status(page)).active?.revision).toBe((moved.active?.revision ?? 0) + 1);
});
