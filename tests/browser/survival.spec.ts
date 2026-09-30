import { test, expect, type Page } from '@playwright/test';

/**
 * E08 browser acceptance «выживание, бой, опыт и смерть»: the survival bars, a real death and
 * respawn cycle, a meal eaten by holding the button, combat against test creatures with numbers
 * taken from the reference game, and a saved world that brings health, hunger, the clock and the
 * creatures back.
 */
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
async function selectItem(page: Page, item: string) {
  await page.evaluate((key) => {
    const slot = window
      .__VOXEL_LAB__!.getState()!
      .inventory.findIndex((entry) => entry?.[0] === key);
    window.__VOXEL_LAB__!.hotbar(slot);
  }, item);
  await page.waitForFunction(
    (key) =>
      window.__VOXEL_LAB__!.getState()!.inventory[
        window.__VOXEL_LAB__!.getState()!.selected
      ]?.[0] === key,
    item,
  );
}
/** Selects an item and points the camera at the middle of a loaded test creature. */
async function aimAtMob(page: Page, item: string, index = 0) {
  await selectItem(page, item);
  await page.evaluate((i) => {
    const state = window.__VOXEL_LAB__!.getState()!;
    const mob = state.mobs[i!];
    const dx = mob.x - state.player.position.x;
    const dz = mob.z - state.player.position.z;
    const dy = mob.y + 0.9 - (state.player.position.y + 1.62);
    window.__VOXEL_LAB__!.setLook(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
  }, index);
  await page.waitForTimeout(80);
}
const mobHealth = (page: Page, index = 0) =>
  page.evaluate((i) => window.__VOXEL_LAB__!.getState()!.mobs[i!]?.health ?? 0, index);
const messages = (page: Page) =>
  page.evaluate(() => window.__VOXEL_LAB__!.getState()!.messages.join(' | '));
/** One full-charge swing of the held weapon. */
async function swing(page: Page) {
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()!.attack.ready);
  await page.evaluate(() => window.__VOXEL_LAB__!.hit());
}
/**
 * A landed hit knocks the creature back about half a block, exactly like the reference, so a
 * player who never moves loses their target out of the three block reach. This walks one step
 * forward, re-aims and swings, which is what a person does with a sword in hand.
 */
async function stepInAndSwing(page: Page, item = 'lab:iron_sword') {
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(260);
  await page.keyboard.up('KeyW');
  await aimAtMob(page, item);
  await swing(page);
  await page.waitForTimeout(140);
}
/** Swings until the first creature is gone; a bounded loop so a miss reports instead of hanging. */
async function killFirstMob(page: Page, attempts = 12) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if ((await mobHealth(page)) <= 0) return;
    await stepInAndSwing(page);
  }
  expect(await mobHealth(page)).toBe(0);
}
async function saveAndWait(page: Page) {
  const before = await page.evaluate(() => window.__VOXEL_LAB__!.getInfo().save.savedAt);
  await page.keyboard.press('Control+KeyS');
  await page.waitForFunction(
    (previous) => {
      const save = window.__VOXEL_LAB__!.getInfo().save;
      return (
        save.durable &&
        !save.busy &&
        save.phase === 'saved' &&
        (save.savedAt ?? 0) > (previous ?? 0)
      );
    },
    before,
    { timeout: 30000 },
  );
}

test('the survival HUD draws health, hunger, armour and experience from real numbers', async ({
  page,
}) => {
  await boot(page);
  await play(page);
  await expect(page.locator('#survival-hud')).toBeVisible();
  await expect(page.locator('#health-bar i.heart')).toHaveCount(10);
  await expect(page.locator('#food-bar i.food')).toHaveCount(10);
  await expect(page.locator('#xp-level')).toHaveText('0');
  // Ten drawn cells for twenty health points, so seven health is three and a half cells.
  await page.evaluate(() => window.__VOXEL_LAB__!.vitals({ health: 7, food: 5 }));
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()!.survival.health === 7);
  await expect(page.locator('#health-bar i.heart.half')).toHaveCount(1);
  await expect(page.locator('#health-bar i.heart.empty')).toHaveCount(6);
  // Five hunger points are two and a half drumsticks.
  await expect(page.locator('#food-bar i.food.empty')).toHaveCount(7);
  await expect(page.locator('#food-bar i.food.half')).toHaveCount(1);
  await expect(page.locator('#xp-level')).toHaveText('0');
  // Five points is half of the seven a first level costs.
  await page.evaluate(() => window.__VOXEL_LAB__!.vitals({ xp: 5 }));
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()!.survival.xp === 5);
  expect(await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.survival.xpInto)).toBe(5);
  // Armour is worn through the real interface: pick the piece up, click the chest slot.
  await grant(page, 'lab:iron_chestplate', 1);
  const slot = await page.evaluate(() =>
    window
      .__VOXEL_LAB__!.getState()!
      .inventory.findIndex((entry) => entry?.[0] === 'lab:iron_chestplate'),
  );
  await page.evaluate(() => window.__VOXEL_LAB__!.openCrafting());
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getInfo().panel === 'crafting');
  await page
    .locator(`#panel-overlay [data-slot-id="player"][data-slot-index="${slot}"]:visible`)
    .click();
  await page.locator('#player-armor [data-slot-index="37"]:visible').click();
  await page.waitForFunction(
    () => window.__VOXEL_LAB__!.getState()!.inventory[37]?.[0] === 'lab:iron_chestplate',
  );
  await page.evaluate(() => window.__VOXEL_LAB__!.closeContainer());
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getInfo().panel === null);
  // Six armour points are drawn as three of the ten cells.
  await expect(page.locator('#armor-bar')).toBeVisible();
  await expect(page.locator('#armor-bar i.armor:not(.empty)')).toHaveCount(3);
  // Ten points of fall damage against six armour points: the reference keeps 9.52 of them,
  // because the effective points are max(6/5, 6 - 10/2) = 1.2 and the reduction is 1.2/25.
  await page.evaluate(() => window.__VOXEL_LAB__!.vitals({ health: 20 }));
  await page.evaluate(() => window.__VOXEL_LAB__!.damage(10, 'fall'));
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()!.survival.health < 20);
  const armored = await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.survival.health);
  expect(armored).toBeCloseTo(10.48, 1);
  // The chestplate wears down instead of the player: floor(10 / 4), at least one point.
  expect(await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.inventory[37]?.[2])).toBe(2);
});

test('a fatal fall raises the death screen and respawn brings the player back', async ({
  page,
}) => {
  await boot(page);
  await play(page);
  await grant(page, 'lab:iron_ingot', 4);
  const dropped = await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.itemEntities.length);
  await page.evaluate(() => window.__VOXEL_LAB__!.damage(24, 'fall'));
  await expect(page.locator('#death-overlay')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#death-title')).toHaveText('Ты погиб!');
  await expect(page.locator('#death-cause')).toContainText('Падение');
  const dead = await page.evaluate(() => {
    const state = window.__VOXEL_LAB__!.getState()!;
    return {
      dead: state.survival.dead,
      cause: state.survival.damageType,
      health: state.survival.health,
      carried: state.inventory.filter(Boolean).length,
      ground: state.itemEntities.length,
    };
  });
  expect(dead.dead).toBe(true);
  expect(dead.cause).toBe('fall');
  expect(dead.health).toBe(0);
  expect(dead.carried).toBe(0);
  expect(dead.ground).toBeGreaterThan(dropped);
  await page.locator('#respawn-button').click();
  await page.waitForFunction(() => !window.__VOXEL_LAB__!.getState()!.survival.dead);
  await expect(page.locator('#death-overlay')).toBeHidden();
  const revived = await page.evaluate(() => {
    const state = window.__VOXEL_LAB__!.getState()!;
    return {
      health: state.survival.health,
      food: state.survival.food,
      type: state.survival.damageType,
    };
  });
  expect(revived.health).toBe(20);
  expect(revived.food).toBe(20);
  expect(revived.type).toBe(null);
});

test('holding the button eats the meal and the effect shows up on the HUD', async ({ page }) => {
  await boot(page);
  await play(page);
  await grant(page, 'lab:rotten_flesh', 6);
  await selectItem(page, 'lab:rotten_flesh');
  await page.evaluate(() => window.__VOXEL_LAB__!.vitals({ food: 6, saturation: 0, health: 12 }));
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()!.survival.food === 6);
  // A tap is not a meal: releasing early cancels the held action and keeps the food.
  // The tap runs inside the page, so a slow headless round trip cannot stretch it into a meal.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const lab = window.__VOXEL_LAB__!;
        lab.hold(true);
        const timer = setInterval(() => {
          if (!lab.getState()!.use.eating) return;
          clearInterval(timer);
          setTimeout(() => {
            lab.hold(false);
            resolve();
          }, 200);
        }, 5);
      }),
  );
  await page.waitForFunction(() => !window.__VOXEL_LAB__!.getState()!.use.eating);
  expect(await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.survival.food)).toBe(6);
  // A full 32-tick hold finishes the meal: four points of hunger from one piece of flesh.
  await page.evaluate(() => window.__VOXEL_LAB__!.hold(true));
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()!.survival.food >= 10, null, {
    timeout: 8000,
  });
  await page.evaluate(() => window.__VOXEL_LAB__!.hold(false));
  const eaten = await page.evaluate(() => {
    const state = window.__VOXEL_LAB__!.getState()!;
    return {
      food: state.survival.food,
      flesh: state.inventory.reduce(
        (sum, slot) => (slot?.[0] === 'lab:rotten_flesh' ? sum + slot[1] : sum),
        0,
      ),
      effects: state.survival.effects.map((effect) => effect.id),
      message: state.messages.join(' | '),
    };
  });
  expect(eaten.food).toBe(10);
  expect(eaten.flesh).toBe(5);
  expect(eaten.message).toContain('Съедено');
  // Rotten flesh gives hunger in eight cases out of ten, exactly like the reference, so the
  // meal is repeated until the roll lands instead of betting the test on one throw.
  let eatenMeals = 1;
  while (eatenMeals < 6) {
    if (await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.survival.effects.length)) break;
    eatenMeals++;
    await page.evaluate(() => window.__VOXEL_LAB__!.vitals({ food: 6, saturation: 0 }));
    await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()!.survival.food === 6);
    await page.evaluate(() => window.__VOXEL_LAB__!.hold(true));
    await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()!.survival.food >= 10, null, {
      timeout: 8000,
    });
    await page.evaluate(() => window.__VOXEL_LAB__!.hold(false));
  }
  expect(eatenMeals).toBeLessThan(6);
  const effects = await page.evaluate(() =>
    window.__VOXEL_LAB__!.getState()!.survival.effects.map((effect) => effect.id),
  );
  expect(effects).toContain('hunger');
  await expect(page.locator('#effect-line .effect-chip')).toContainText('Голод');
});

test('the world spawns its own creatures, and the suite can pin that off', async ({ page }) => {
  test.setTimeout(120_000);
  // The pinned world proves the switch: after a full spawn interval nothing may appear.
  await boot(page);
  await play(page);
  expect(await page.evaluate(() => window.__VOXEL_LAB__!.getInfo().naturalSpawning)).toBe(false);
  await page.waitForTimeout(13000);
  expect(await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.mobs.length)).toBe(0);
  // The normal world is alive: the spawner works on its own, without the debug hooks.
  await boot(page, '/?preset=flat&radius=2');
  await play(page);
  expect(await page.evaluate(() => window.__VOXEL_LAB__!.getInfo().naturalSpawning)).toBe(true);
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()!.mobs.length > 0, undefined, {
    timeout: 45000,
  });
  const spawned = await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.mobs[0]);
  expect(spawned!.health).toBeGreaterThan(0);
  expect(spawned!.kind.startsWith('lab:')).toBe(true);
});

test('a sword, a bow and a hostile creature fight with real damage numbers', async ({ page }) => {
  await boot(page);
  await play(page);
  await grant(page, 'lab:iron_sword', 1);
  await page.evaluate(() => window.__VOXEL_LAB__!.mob('lab:dummy', 2.2));
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()!.mobs.length === 1);
  await aimAtMob(page, 'lab:iron_sword');
  expect(await mobHealth(page)).toBe(20);
  // A full-charge iron sword hit is exactly six points of damage in the reference.
  await swing(page);
  await expect.poll(() => mobHealth(page), { timeout: 3000 }).toBe(14);
  // From a standstill the next swing already reaches short: the dummy is pushed off the blade.
  await swing(page);
  await page.waitForTimeout(140);
  expect(await mobHealth(page)).toBeLessThanOrEqual(14);
  await killFirstMob(page);
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()!.mobs.length === 0);
  expect(await messages(page)).toContain('побеждён');
  // A hostile creature chases, hits and pays five experience points when it dies.
  await page.evaluate(() => window.__VOXEL_LAB__!.mob('lab:walker', 6));
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()!.mobs.length === 1);
  // The hit is proven by the simulation's own damage log: regeneration heals it away in a
  // second, so a single reading of the health bar would be a race.
  await page.waitForFunction(
    () =>
      window.__VOXEL_LAB__!.getState()!.messages.some((line) => line.includes('Получено урона')),
    null,
    { timeout: 15000 },
  );
  expect(await messages(page)).toContain('Получено урона: 3');
  await killFirstMob(page);
  // Five experience points: the orbs fly into the player as soon as the creature dies.
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()!.survival.xp === 5, null, {
    timeout: 8000,
  });
  // A fully drawn bow: one whole second of holding, then a six-damage arrow.
  await grant(page, 'lab:bow', 1);
  await grant(page, 'lab:arrow', 4);
  await page.evaluate(() => window.__VOXEL_LAB__!.mob('lab:dummy', 2.5));
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()!.mobs.length === 1);
  await aimAtMob(page, 'lab:bow');
  await page.evaluate(() => window.__VOXEL_LAB__!.hold(true));
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()!.use.bowCharge >= 20, null, {
    timeout: 5000,
  });
  await page.evaluate(() => window.__VOXEL_LAB__!.hold(false));
  await expect.poll(() => mobHealth(page), { timeout: 5000 }).toBe(14);
  expect(await countOf(page, 'lab:arrow')).toBe(3);
});

test('health, hunger, the clock and the creatures survive a save and a reload', async ({
  page,
}) => {
  await boot(page);
  await play(page);
  await page.evaluate(() =>
    window.__VOXEL_LAB__!.vitals({ health: 13, food: 9, saturation: 2, xp: 40 }),
  );
  await page.evaluate(() => window.__VOXEL_LAB__!.time(16_000));
  await page.evaluate(() => window.__VOXEL_LAB__!.mob('lab:dummy', 6));
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()!.mobs.length === 1);
  const before = await page.evaluate(() => {
    const state = window.__VOXEL_LAB__!.getState()!;
    return {
      health: state.survival.health,
      food: state.survival.food,
      level: state.survival.level,
      xp: state.survival.xp,
      mobs: state.mobs.length,
      night: state.night,
      time: state.time,
    };
  });
  expect(before.night).toBe(true);
  await saveAndWait(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await boot(page);
  await play(page);
  const after = await page.evaluate(() => {
    const state = window.__VOXEL_LAB__!.getState()!;
    return {
      health: state.survival.health,
      food: state.survival.food,
      level: state.survival.level,
      xp: state.survival.xp,
      mobs: state.mobs.length,
      night: state.night,
      time: state.time,
      kind: state.mobs[0]?.kind ?? '',
    };
  });
  expect(after.health).toBe(13);
  expect(after.food).toBe(9);
  expect(after.level).toBe(before.level);
  expect(after.xp).toBeCloseTo(before.xp, 3);
  expect(after.mobs).toBe(1);
  expect(after.kind).toBe('lab:dummy');
  expect(after.night).toBe(true);
  expect(after.time).toBeGreaterThanOrEqual(before.time);
  // The bar is drawn from the restored value, not from a fresh player.
  await expect(page.locator('#health-bar i.heart.empty')).toHaveCount(3);
  // And the restored creature is really simulated again: a hostile one walks towards the player.
  await page.evaluate(() => window.__VOXEL_LAB__!.despawnMobs());
  await page.evaluate(() => window.__VOXEL_LAB__!.mob('lab:walker', 12));
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()!.mobs.length === 1);
  const distance = () =>
    page.evaluate(() => {
      const state = window.__VOXEL_LAB__!.getState()!;
      const mob = state.mobs[0];
      return Math.hypot(mob.x - state.player.position.x, mob.z - state.player.position.z);
    });
  const near = await distance();
  await page.waitForFunction(
    (start) => {
      const state = window.__VOXEL_LAB__!.getState()!;
      const mob = state.mobs[0];
      return (
        Math.hypot(mob.x - state.player.position.x, mob.z - state.player.position.z) < start - 2
      );
    },
    near,
    { timeout: 8000 },
  );
});

test('a bed sleeps only at night and moves the respawn point', async ({ page }) => {
  await boot(page);
  await play(page);
  // Let the player settle: a moving eye position would make every aim below a guess.
  await page.waitForTimeout(1000);
  const edits = await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.edits);
  await grant(page, 'lab:bed', 1);
  await selectItem(page, 'lab:bed');
  // Place the bed on the ground in front of the player through the normal use action. The cell
  // is read together with the click, so the aim below talks about the block that was really made.
  await page.evaluate(() => window.__VOXEL_LAB__!.setLook(0, -0.6));
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()!.target?.normal.y === 1);
  await page.evaluate(() => window.__VOXEL_LAB__!.use());
  // A placement is exactly one world edit and the bed item has left the hand.
  await page.waitForFunction(
    (before) => window.__VOXEL_LAB__!.getState()!.edits === before + 1,
    edits,
  );
  expect(await countOf(page, 'lab:bed')).toBe(0);
  // The cell comes from the save journal, so it is the block that was really created rather
  // than the block that was aimed at one snapshot earlier.
  const bedCell = await page.evaluate(async () => {
    const checkpoint = await window.__VOXEL_LAB__!.capture();
    const placed = checkpoint.overrides.find((entry) => entry[3] === 'lab:bed')!;
    return { x: placed[0], y: placed[1], z: placed[2] };
  });
  // Look at the bed itself: the shallowest pitch that puts the placed bed under the crosshair.
  const aimAtBed = async () => {
    for (const pitch of [-0.3, -0.45, -0.6, -0.75, -0.9]) {
      await page.evaluate((value) => window.__VOXEL_LAB__!.setLook(0, value), pitch);
      try {
        await page.waitForFunction(
          () => window.__VOXEL_LAB__!.getState()!.target?.state === 24,
          null,
          { timeout: 1500 },
        );
        return;
      } catch {
        continue;
      }
    }
    throw new Error('Не удалось навестись на кровать');
  };
  // Daytime: the bed refuses to be used and says why.
  await page.evaluate(() => window.__VOXEL_LAB__!.time(6000));
  // The clock keeps ticking, so the set time is only a starting point.
  await page.waitForFunction(() => {
    const time = window.__VOXEL_LAB__!.getState()!.time;
    return time >= 6000 && time < 6300;
  });
  await aimAtBed();
  await page.evaluate(() => window.__VOXEL_LAB__!.use());
  // The refusal is reported to the player as a notice, not as a change of world state.
  await expect(page.locator('#toast')).toContainText('ночью', { timeout: 5000 });
  // Night: sleeping skips to dawn and the respawn point follows the bed.
  await page.evaluate(() => window.__VOXEL_LAB__!.time(16_000));
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()!.night);
  await aimAtBed();
  const spawn = await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.survival.spawn);
  await page.evaluate(() => window.__VOXEL_LAB__!.use());
  await page.waitForFunction(() => !window.__VOXEL_LAB__!.getState()!.night, null, {
    timeout: 5000,
  });
  const slept = await page.evaluate(() => {
    const state = window.__VOXEL_LAB__!.getState()!;
    return { time: state.time, spawn: state.survival.spawn };
  });
  // Waking up at dawn of the next day: the clock is at 24000 and rolls over to zero right after.
  const toDawn = Math.min(Math.abs(slept.time - 24_000), slept.time);
  expect(toDawn).toBeLessThan(1500);
  await expect(page.locator('#toast')).toContainText('Сон');
  // The respawn point moved to the bed: the middle of the block, one step above it.
  expect(slept.spawn).toEqual({ x: bedCell.x + 0.5, y: bedCell.y + 1, z: bedCell.z + 0.5 });
  expect(slept.spawn).not.toEqual(spawn);
});

test('the difficulty chosen in the menu decides how hard the creatures hit', async ({ page }) => {
  await boot(page);
  await play(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-overlay')).toBeVisible();
  await page.click('[data-tab="settings"]');
  await page.selectOption('#difficulty', 'peaceful');
  await page.waitForFunction(
    () => window.__VOXEL_LAB__!.getState()!.survival.difficulty === 'peaceful',
  );
  // The menu pauses the simulation, so the world has to be running again before the test.
  await page.click('#close-menu');
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getInfo().view === 'game');
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getInfo().tps > 0);
  await page.evaluate(() => window.__VOXEL_LAB__!.mob('lab:walker', 4));
  await page.waitForFunction(() => window.__VOXEL_LAB__!.getState()!.mobs.length === 1);
  // Four seconds of being hit on the peaceful setting leave the player untouched.
  await page.waitForTimeout(4000);
  expect(await page.evaluate(() => window.__VOXEL_LAB__!.getState()!.survival.health)).toBe(20);
  // On the peaceful setting the same creature lands its hits but deals no damage at all, so the
  // simulation never logs a hit against the player.
  expect(await messages(page)).not.toContain('Получено урона');
  // The hard setting multiplies the creature damage by 1.5: three points become 4.5, and the
  // simulation's own damage log is the witness.
  await page.evaluate(() => window.__VOXEL_LAB__!.difficulty('hard'));
  await page.waitForFunction(
    () => window.__VOXEL_LAB__!.getState()!.survival.difficulty === 'hard',
  );
  await page.waitForFunction(
    () =>
      window.__VOXEL_LAB__!.getState()!.messages.some((line) => line.includes('Получено урона')),
    null,
    { timeout: 20000 },
  );
  expect(await messages(page)).toContain('Получено урона: 4.5');
});
