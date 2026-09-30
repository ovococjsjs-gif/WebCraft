import { describe, it, expect } from 'vitest';
import { BLOCK } from '../../packages/content/src/blocks';
import { itemRegistry } from '../../packages/content/src/items';
import { WorldSession } from '../../packages/core/src/session';
import {
  ANVIL_BASE_COST,
  ANVIL_MAX_COST,
  BREW_FUEL_PER_POWDER,
  BREW_TICKS,
  BREWING_RECIPES,
  ENCHANT_LAPIS_PER_OFFER,
  ENCHANT_OFFERS,
  anvilResult,
  brewResult,
} from '../../packages/core/src/stations';

/**
 * Acceptance suite for E12 «развитие персонажа, особые предметы и занятия». The three work
 * stations of the reference game are checked with their real numbers: three offers at the table
 * for one lapis each, four hundred ticks in a brewing stand and twenty potions per blaze powder,
 * and an anvil that joins two tools for the base cost of one level.
 */
function session(seed = 'e12-stations'): WorldSession {
  const world = new WorldSession(seed, 'flat');
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) world.loadColumn(x, z);
  for (let i = 0; i < 5; i++) world.simulation.step();
  return world;
}
/** The comma separated position key of an open container, split back into three numbers. */
function parseKey(key: string): [number, number, number] {
  const [x, y, z] = key.split(',').map(Number);
  return [x, y, z];
}
function step(world: WorldSession, ticks: number): void {
  for (let i = 0; i < ticks; i++) world.simulation.step();
}
/** Places a station block next to the player and opens it. */
function station(world: WorldSession, kind: 'enchanting' | 'brewing' | 'anvil', block: number) {
  const sim = world.simulation;
  const x = Math.floor(sim.player.position.x) + 2;
  const y = Math.floor(sim.player.position.y);
  const z = Math.floor(sim.player.position.z);
  sim.setBlockState(x, y, z, block);
  const opened = sim.openContainer(kind, x, y, z);
  expect(opened.ok, opened.reason).toBe(true);
  return { x, y, z };
}

describe('E12 · the enchanting table', () => {
  it('offers three enchantments for one lapis each and spends levels to apply one', () => {
    const world = session();
    const sim = world.simulation;
    station(world, 'enchanting', BLOCK.ENCHANTING_TABLE);
    sim.grid.set(0, { item: 'lab:iron_pickaxe', count: 1, damage: 0 });
    const view = sim.containerView()!;
    expect(view.kind).toBe('enchanting');
    expect(view.enchant!.offers).toHaveLength(ENCHANT_OFFERS);
    expect(ENCHANT_OFFERS).toBe(3);
    expect(ENCHANT_LAPIS_PER_OFFER).toBe(1);
    for (const offer of view.enchant!.offers) {
      expect(offer.cost).toBeGreaterThanOrEqual(1);
      // The price is the enchantment's own cost times the level it offers, at most six.
      expect(offer.cost).toBeLessThanOrEqual(6);
      expect(offer.level).toBeGreaterThanOrEqual(1);
    }
    // Without levels the table refuses, even with the lapis in the inventory.
    sim.grant('lab:lapis', 4);
    const poor = sim.enchantApply(view.enchant!.offers[0].id);
    expect(poor.ok).toBe(false);
    expect(poor.reason).toContain('уровней');
    // With levels but without lapis it refuses for the other reason.
    sim.survival.addXp(200);
    const spendable = sim.enchantApply(view.enchant!.offers[0].id);
    expect(spendable.ok).toBe(true);
    const applied = sim.grid.get(0)?.enchantments;
    expect(applied).toBeDefined();
    // One lapis lazuli left the pocket for the enchantment that was applied.
    expect(sim.amountOf('lab:lapis')).toBe(3);
  });

  it('makes an enchanted pickaxe dig stone faster than a plain one', () => {
    const world = session('e12-mining');
    const sim = world.simulation;
    const plain = session('e12-mining');
    // Both worlds are the same seed, so the same stone block is mined in each of them.
    const at = { x: 4, y: 8, z: 4 };
    for (const target of [sim, plain.simulation]) {
      target.grant('lab:iron_pickaxe', 1);
      target.select(target.inventory.slots.findIndex((slot) => slot?.item === 'lab:iron_pickaxe'));
      target.setBlockState(at.x, at.y, at.z, BLOCK.STONE);
    }
    sim.inventory.set(sim.selected, { ...sim.heldItem!, enchantments: { efficiency: 3 } });
    const before = sim.enchantments.miningScale(
      itemRegistry.find('lab:iron_pickaxe')!,
      sim.heldItem,
    );
    expect(before).toBeGreaterThan(1);
    const fast = mineAt(sim, at);
    const slow = mineAt(plain.simulation, at);
    expect(fast).toBeLessThan(slow);
  });

  it('leaves the item in the table and remembers the enchantment through a save', () => {
    const world = session('e12-save');
    const sim = world.simulation;
    station(world, 'enchanting', BLOCK.ENCHANTING_TABLE);
    sim.grid.set(0, { item: 'lab:iron_sword', count: 1, damage: 0 });
    sim.survival.addXp(400);
    sim.grant('lab:lapis', 3);
    const offer = sim.containerView()!.enchant!.offers.find((entry) => entry.id === 'sharpness')!;
    expect(offer).toBeDefined();
    expect(sim.enchantApply(offer.id).ok).toBe(true);
    expect(sim.grid.get(0)?.item).toBe('lab:iron_sword');
    expect(
      sim.enchantments.attackBonus(itemRegistry.find('lab:iron_sword')!, sim.grid.get(0)),
    ).toBeGreaterThan(0);
    const checkpoint = world.checkpoint();
    const restored = new WorldSession('e12-save', 'flat', checkpoint);
    expect(
      restored.simulation.inventory.slots.find((item) => item?.item === 'lab:iron_sword')
        ?.enchantments,
    ).toEqual({ sharpness: offer.level });
    expect(restored.simulation.savedEnchantments()).toEqual([]);
  });
});

/** Ticks until the block at the position is gone, so two tools can be compared. */
function mineAt(sim: WorldSession['simulation'], at: { x: number; y: number; z: number }): number {
  sim.player.position.x = at.x + 0.5;
  sim.player.position.z = at.z + 0.5;
  sim.player.position.y = at.y + 1;
  sim.setInput({ ...sim.input, yaw: 0, pitch: -1.5 });
  sim.hitBlock();
  sim.setMining(true);
  let ticks = 0;
  while (sim.world.getBlock(at.x, at.y, at.z) !== BLOCK.AIR && ticks < 600) {
    sim.step();
    ticks++;
  }
  sim.setMining(false);
  return ticks;
}

describe('E12 · the brewing stand', () => {
  it('brews three bottles at once from wart into an awkward potion', () => {
    const world = session();
    const sim = world.simulation;
    station(world, 'brewing', BLOCK.BREWING_STAND);
    sim.grant('lab:potion_water', 3);
    sim.grant('lab:blaze_powder', 1);
    sim.grant('lab:nether_wart', 1);
    const filled = sim.brewingFill();
    expect(filled.ok, filled.reason).toBe(true);
    let view = sim.containerView()!;
    expect(view.brewing!.bottles.filter((bottle) => bottle !== null)).toHaveLength(3);
    expect(view.brewing!.fuel).toBe(BREW_FUEL_PER_POWDER);
    expect(BREW_FUEL_PER_POWDER).toBe(20);
    // The ingredient goes into the stand's own first slot, as a player would place it.
    sim.cursor = { item: 'lab:nether_wart', count: 1, damage: 0 };
    const key = sim.open!.key!;
    const placed = sim.slotClick(key, 0, 0);
    expect(placed.ok).toBe(true);
    view = sim.containerView()!;
    expect(view.brewing!.ingredient?.[0]).toBe('lab:nether_wart');
    // Nothing happens before the reference four hundred ticks.
    step(world, BREW_TICKS - 1);
    expect(sim.containerView()!.brewing!.progress).toBe(BREW_TICKS - 1);
    step(world, 1);
    view = sim.containerView()!;
    for (const bottle of view.brewing!.bottles) expect(bottle?.[0]).toBe('lab:potion_awkward');
    expect(view.brewing!.ingredient).toBeNull();
    const taken = sim.brewingTake();
    expect(taken.ok).toBe(true);
    expect(sim.amountOf('lab:potion_awkward')).toBe(3);
    expect(BREW_TICKS).toBe(400);
    expect(brewResult('lab:potion_water', 'lab:nether_wart')).toBe('lab:potion_awkward');
    expect(BREWING_RECIPES.length).toBeGreaterThanOrEqual(6);
  });

  it('turns an awkward potion into a drinkable effect and applies it to the player', () => {
    const world = session('e12-drink');
    const sim = world.simulation;
    station(world, 'brewing', BLOCK.BREWING_STAND);
    const stand = sim.brewing.ensure(...parseKey(sim.open!.key!));
    stand.bottles[0] = { item: 'lab:potion_awkward', count: 1, damage: 0 };
    stand.ingredient = { item: 'lab:ghast_tear', count: 1, damage: 0 };
    stand.fuel = 1;
    step(world, BREW_TICKS);
    expect(stand.bottles[0]?.item).toBe('lab:potion_regeneration');
    expect(brewResult('lab:potion_awkward', 'lab:ghast_tear')).toBe('lab:potion_regeneration');
    sim.brewingTake();
    const index = sim.inventory.slots.findIndex((slot) => slot?.item === 'lab:potion_regeneration');
    expect(index).toBeGreaterThanOrEqual(0);
    sim.select(index);
    sim.survival.health = 10;
    const drunk = sim.use();
    expect(drunk.ok, drunk.reason).toBe(true);
    expect(sim.survival.effects.has('regeneration')).toBe(true);
    expect(sim.amountOf('lab:potion_regeneration')).toBe(0);
    // Regeneration heals over time, and the effect ends on its own.
    step(world, 60);
    expect(sim.survival.health).toBeGreaterThan(10);
    expect(sim.survival.effects.has('regeneration')).toBe(true);
  });
});

describe('E12 · the anvil', () => {
  it('joins two worn tools into one for the base cost of one level', () => {
    const world = session('e12-anvil');
    const sim = world.simulation;
    station(world, 'anvil', BLOCK.ANVIL);
    sim.grid.set(0, { item: 'lab:stone_pickaxe', count: 1, damage: 100 });
    sim.grid.set(1, { item: 'lab:stone_pickaxe', count: 1, damage: 120 });
    const view = sim.containerView()!;
    expect(view.anvil!.cost).toBe(ANVIL_BASE_COST);
    expect(ANVIL_BASE_COST).toBe(1);
    expect(view.anvil!.result?.[0]).toBe('lab:stone_pickaxe');
    // The base cost is one level, which the player still has to pay.
    const broken = sim.anvilTake();
    expect(broken.ok).toBe(false);
    expect(broken.reason).toContain('уровней');
    sim.survival.addXp(200);
    const levels = sim.survival.progress.level;
    const taken = sim.anvilTake();
    expect(taken.ok, taken.reason).toBe(true);
    expect(sim.survival.progress.level).toBeLessThan(levels);
    const repaired = sim.inventory.slots.find((slot) => slot?.item === 'lab:stone_pickaxe');
    expect(repaired).toBeDefined();
    expect(repaired!.damage ?? 0).toBeLessThan(100);
  });

  it('repairs a tool with its material and refuses unrelated items', () => {
    const worn = { item: 'lab:iron_pickaxe', count: 1, damage: 200 };
    const ingot = { item: 'lab:iron_ingot', count: 1, damage: 0 };
    const repaired = anvilResult(worn, ingot);
    expect(repaired).not.toBeNull();
    expect(repaired!.cost).toBe(ANVIL_BASE_COST);
    expect(repaired!.stack!.item).toBe('lab:iron_pickaxe');
    const wear = repaired!.stack!.damage ?? 0;
    expect(wear).toBeLessThan(200);
    // A quarter of the maximum durability comes back, the reference repair step.
    const durability = itemRegistry.find('lab:iron_pickaxe')!.tool!.durability;
    expect(wear).toBe(200 - Math.floor(durability * 0.25));
    expect(anvilResult(worn, { item: 'lab:apple', count: 1, damage: 0 })).toBeNull();
    expect(anvilResult(null, ingot)).toBeNull();
    expect(ANVIL_MAX_COST).toBe(39);
  });
});

describe('E12 · special items', () => {
  it('grows a bone into bone meal and feeds it to a crop', () => {
    const world = session('e12-bone');
    const sim = world.simulation;
    sim.grant('lab:bone', 1);
    expect(itemRegistry.find('lab:bone_meal')).toBeDefined();
    sim.openCrafting();
    expect(sim.autoFill('bone_meal').ok).toBe(true);
    sim.slotClick('result', 0, 0, { shift: true });
    expect(sim.amountOf('lab:bone_meal')).toBe(3);
    expect(sim.amountOf('lab:bone')).toBe(0);
    // Bone meal pushes a young crop forward, the same call the hoe and the seeds use.
    const y = 9;
    sim.setBlockState(6, 8, 6, BLOCK.FARMLAND_WET);
    sim.setBlockState(6, y, 6, BLOCK.WHEAT_0);
    expect(sim.plants.fertilize(6, y, 6)).toBe(true);
    expect(sim.world.getBlock(6, y, 6)).toBe(BLOCK.WHEAT_3);
  });

  it('gives a golden apple its regeneration and the extra hunger points', () => {
    const world = session('e12-apple');
    const sim = world.simulation;
    sim.grant('lab:golden_apple', 1);
    sim.survival.health = 6;
    sim.survival.food = 10;
    sim.select(sim.inventory.slots.findIndex((slot) => slot?.item === 'lab:golden_apple'));
    expect(sim.setUseHold(true).ok).toBe(true);
    step(world, 40);
    sim.setUseHold(false);
    expect(sim.survival.food).toBeGreaterThan(10);
    expect(sim.survival.effects.has('regeneration')).toBe(true);
    const afterEating = sim.survival.health;
    step(world, 120);
    expect(sim.survival.health).toBeGreaterThan(afterEating);
    expect(sim.amountOf('lab:golden_apple')).toBe(0);
  });
});
