import { describe, it, expect } from 'vitest';
import { BLOCK, registry } from '../../packages/content/src/blocks';
import {
  breakTicks,
  breakSeconds,
  canHarvestBlock,
  damageTool,
  durabilityLeft,
  instantBreak,
  rollDrops,
  toolDamagePerBlock,
} from '../../packages/core/src/mining';
import { itemRegistry } from '../../packages/content/src/items';
import { stack } from '../../packages/core/src/inventory';

const hand = null;
const woodPick = stack('lab:wood_pickaxe');
const stonePick = stack('lab:stone_pickaxe');
const ironPick = stack('lab:iron_pickaxe');
const woodAxe = stack('lab:wood_axe');
const shovel = stack('lab:iron_shovel');

describe('mining times, harvest rules and drops', () => {
  it('keeps the reference shape of the break-time formula', () => {
    // Bare hand on stone: 1 * 1.5 / 100 -> 150 ticks, i.e. 7.5 seconds.
    expect(breakTicks(BLOCK.STONE, hand)).toBe(150);
    expect(breakSeconds(BLOCK.STONE, hand)).toBeCloseTo(7.5);
    // Wooden pickaxe on stone: speed 2, harvestable -> 1 * 1.5 / (2 * 30) = 22.5 ticks.
    expect(breakTicks(BLOCK.STONE, woodPick)).toBe(23);
    expect(breakTicks(BLOCK.STONE, ironPick)).toBe(8);
    // Iron pickaxe on dirt: the tool kind does not match, so dirt stays a hand job.
    expect(breakTicks(BLOCK.DIRT, ironPick)).toBe(breakTicks(BLOCK.DIRT, hand));
    expect(breakTicks(BLOCK.DIRT, shovel)).toBeLessThan(breakTicks(BLOCK.DIRT, hand));
  });
  it('breaks soft plants in one hit and refuses the foundation', () => {
    expect(instantBreak(BLOCK.TALL_GRASS, hand)).toBe(true);
  });
  it('never harvests a tiered block without the right tool', () => {
    expect(canHarvestBlock(registry.get(BLOCK.STONE), hand)).toBe(false);
    expect(canHarvestBlock(registry.get(BLOCK.STONE), woodPick)).toBe(true);
    expect(canHarvestBlock(registry.get(BLOCK.STONE), woodAxe)).toBe(false);
    // Iron ore needs tier 2, so a wooden pickaxe yields nothing while a stone one works.
    expect(canHarvestBlock(registry.get(BLOCK.IRON_ORE), woodPick)).toBe(false);
    expect(canHarvestBlock(registry.get(BLOCK.IRON_ORE), stonePick)).toBe(true);
    expect(canHarvestBlock(registry.get(BLOCK.IRON_ORE), ironPick)).toBe(true);
    expect(canHarvestBlock(registry.get(BLOCK.DIRT), hand)).toBe(true);
  });
  it('offers no drops when the block cannot be harvested', () => {
    const random = () => 0.5;
    expect(rollDrops(BLOCK.STONE, hand, random)).toEqual([]);
    expect(rollDrops(BLOCK.STONE, woodPick, random)).toEqual([
      { item: 'lab:cobblestone', count: 1 },
    ]);
    expect(rollDrops(BLOCK.COAL_ORE, woodPick, random)).toEqual([{ item: 'lab:coal', count: 1 }]);
    expect(rollDrops(BLOCK.IRON_ORE, woodPick, random)).toEqual([]);
    expect(rollDrops(BLOCK.IRON_ORE, stonePick, random)).toEqual([
      { item: 'lab:iron_ore', count: 1 },
    ]);
    expect(rollDrops(BLOCK.AIR, ironPick, random)).toEqual([]);
    expect(rollDrops(BLOCK.GRASS, hand, random)).toEqual([{ item: 'lab:dirt', count: 1 }]);
    expect(rollDrops(BLOCK.LOG, hand, random)).toEqual([{ item: 'lab:oak_log', count: 1 }]);
    expect(rollDrops(BLOCK.FURNACE_LIT, woodPick, random)).toEqual([
      { item: 'lab:furnace', count: 1 },
    ]);
    expect(rollDrops(BLOCK.BEDROCK, ironPick, random)).toEqual([]);
  });
  it('lets a lucky roll add extra produce', () => {
    expect(rollDrops(BLOCK.LEAVES, hand, () => 0.01).length).toBeGreaterThanOrEqual(1);
  });
  it('wears tools down and reports the exact durability', () => {
    expect(toolDamagePerBlock(woodPick)).toBe(1);
    expect(toolDamagePerBlock(hand)).toBe(0);
    expect(durabilityLeft(woodPick)).toBe(59);
    let tool = stack('lab:wood_pickaxe');
    for (let i = 0; i < 58; i++) {
      const result = damageTool(tool);
      expect(result.broke).toBe(false);
      tool = result.stack!;
    }
    expect(durabilityLeft(tool)).toBe(1);
    const last = damageTool(tool);
    expect(last.broke).toBe(true);
    expect(last.stack).toBeNull();
    expect(durabilityLeft(stack('lab:coal'))).toBeNull();
  });
  it('guarantees that every default drop is a real item', () => {
    const missing: string[] = [];
    for (let id = 1; id < registry.size; id++) {
      const def = registry.get(id);
      if (def.protected || def.hardness < 0) continue;
      const drops = def.drops ?? [{ item: itemRegistry.ofBlock(id)?.key ?? def.key }];
      for (const rule of drops)
        if (!itemRegistry.find(rule.item)) missing.push(`${def.key} -> ${rule.item}`);
    }
    expect(missing).toEqual([]);
  });
  it('covers every block in the registry with a finite or protected time', () => {
    for (let id = 0; id < registry.size; id++) {
      const def = registry.get(id);
      const time = breakTicks(id, ironPick);
      if (def.hardness < 0) expect(time).toBe(Infinity);
      else expect(time).toBeGreaterThanOrEqual(1);
    }
  });
});
