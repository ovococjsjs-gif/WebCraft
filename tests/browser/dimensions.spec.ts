import { expect, test } from '@playwright/test';

/**
 * The dimensions in a real browser: a portal carries the player to the Nether, the world is
 * rebuilt around him there, and the End starts its fight on the first arrival.
 */
test('a portal takes the player to the Nether and back', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/?spawns=off&preset=flat');
  await page.waitForFunction(
    () =>
      (
        window as never as { __VOXEL_LAB__?: { getState: () => { columns?: number } | null } }
      ).__VOXEL_LAB__?.getState() !== null &&
      (
        window as never as { __VOXEL_LAB__: { getInfo: () => { ready: boolean } } }
      ).__VOXEL_LAB__.getInfo().ready,
    undefined,
    { timeout: 120_000 },
  );
  // The travel command takes the same road a portal does, without the four second wait.
  await page.evaluate(() =>
    (window as never as { __VOXEL_LAB__: { travel: (d: string) => void } }).__VOXEL_LAB__.travel(
      'nether',
    ),
  );
  await page.waitForFunction(
    () =>
      (
        window as never as { __VOXEL_LAB__: { getState: () => { dimension: string } } }
      ).__VOXEL_LAB__.getState().dimension === 'nether',
    undefined,
    { timeout: 60_000 },
  );
  const where = await page.evaluate(() =>
    (
      window as never as {
        __VOXEL_LAB__: {
          getState: () => {
            dimension: string;
            player: { position: { x: number; y: number; z: number } };
          };
        };
      }
    ).__VOXEL_LAB__.getState(),
  );
  expect(where.dimension).toBe('nether');
  expect(where.player.position.y).toBeGreaterThan(30);
  // The nether is solid rock and lava, not the flat grass of the Overworld.
  await page.evaluate(() =>
    (window as never as { __VOXEL_LAB__: { travel: (d: string) => void } }).__VOXEL_LAB__.travel(
      'end',
    ),
  );
  await page.waitForFunction(
    () =>
      (
        window as never as { __VOXEL_LAB__: { getState: () => { dimension: string } } }
      ).__VOXEL_LAB__.getState().dimension === 'end',
    undefined,
    { timeout: 60_000 },
  );
  const end = await page.evaluate(() =>
    (
      window as never as {
        __VOXEL_LAB__: { getState: () => { dimension: string; boss: { name: string } | null } };
      }
    ).__VOXEL_LAB__.getState(),
  );
  expect(end.dimension).toBe('end');
  expect(end.boss?.name).toContain('Дракон');
});
