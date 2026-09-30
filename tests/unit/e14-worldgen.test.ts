import { GENERATOR_VERSION } from '../../packages/core/src/persistence';
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PRESET,
  PRESET_LABELS,
  WORLD_PRESETS,
  biomeSpawnPoint,
  generateColumn,
  isScenicPreset,
  isWorldPreset,
} from '../../packages/core/src/terrain';
import { BIOMES, biomeById, selectBiome } from '../../packages/core/src/biomes';
import {
  LAVA_LEVEL,
  ORE_RULES,
  SEA_LEVEL,
  isBiomePreset,
  profileAt,
  veinsNear,
} from '../../packages/core/src/overworld';
import { structuresNear, structureColumn, NOTHING } from '../../packages/core/src/structures';
import { WorldSession } from '../../packages/core/src/session';
import { seedHash } from '../../packages/core/src/random';
import { BLOCK } from '../../packages/content/src/blocks';
import { sealWorld, verifyWorld } from '../../packages/storage/src/format';
import { payload } from '../helpers/worlds';

const SEED = 'biome-fixture-01';
const BIOME = 'overworld' as const;

describe('the list of world types', () => {
  it('keeps every preset addressable and names each of them', () => {
    expect(WORLD_PRESETS).toEqual(['overworld', 'large-biomes', 'amplified', 'valley', 'flat']);
    for (const preset of WORLD_PRESETS) expect(PRESET_LABELS[preset].length).toBeGreaterThan(3);
    expect(isBiomePreset(DEFAULT_PRESET)).toBe(true);
    expect(isWorldPreset('overworld')).toBe(true);
    expect(isWorldPreset('flat')).toBe(true);
    expect(isWorldPreset('nether')).toBe(false);
    expect(isWorldPreset(undefined)).toBe(false);
    expect(isScenicPreset('valley')).toBe(true);
    expect(isScenicPreset('amplified')).toBe(false);
  });
});

describe('the biome table', () => {
  it('answers the climate of any point with one of its biomes', () => {
    const seen = new Set<string>();
    for (let t = -1; t <= 1; t += 0.1)
      for (let h = -1; h <= 1; h += 0.1)
        for (const height of [20, 28, 31, 45, 95]) {
          const id = selectBiome({ temperature: t, humidity: h }, height, SEA_LEVEL, false);
          expect(biomeById(id).id).toBe(id);
          seen.add(id);
        }
    // Every biome of the table comes out of some climate, except the river, which is drawn by
    // the course of the water and not by temperature or humidity.
    expect([...seen].sort()).toEqual(
      BIOMES.map((b) => b.id)
        .filter((id) => id !== 'river')
        .sort(),
    );
  });
  it('lets the hard rules win over the climate', () => {
    const mild = { temperature: 0, humidity: 0 };
    expect(selectBiome(mild, 60, SEA_LEVEL, true)).toBe('river');
    expect(selectBiome(mild, SEA_LEVEL - 6, SEA_LEVEL, false)).toBe('ocean');
    expect(selectBiome(mild, SEA_LEVEL, SEA_LEVEL, false)).toBe('beach');
    expect(selectBiome(mild, 95, SEA_LEVEL, false)).toBe('mountains');
  });
});

describe('one column of a biome world', () => {
  const column = (cx: number, cz: number, seed = SEED) => generateColumn(cx, cz, seed, BIOME);

  it('is the same column whatever the generation order was', () => {
    const first = column(-1, 2);
    for (const [, section] of first.sections) expect(section.indices.length).toBeGreaterThan(0);
    const again = column(-1, 2);
    for (const [sy, section] of first.sections)
      expect(again.sections.get(sy)?.indices).toEqual(section.indices);
    // Neighbours generated before it change nothing: the column is a pure function of itself.
    column(0, 2);
    column(-2, 2);
    const after = column(-1, 2);
    for (const [sy, section] of first.sections)
      expect(after.sections.get(sy)?.indices).toEqual(section.indices);
    const other = column(-1, 2, 'another-seed');
    expect(other.sections.get(1)?.indices).not.toEqual(first.sections.get(1)?.indices);
  });

  it('builds a floor, hides ore in its depth band and never floods above the sea', () => {
    const seed = seedHash(SEED);
    let water = 0,
      checked = 0;
    for (const [cx, cz] of [
      [-1, 0],
      [0, 0],
      [2, -1],
      [3, 3],
    ] as const) {
      const c = column(cx, cz);
      for (let x = 0; x < 16; x++)
        for (let z = 0; z < 16; z++) {
          expect(c.get(x, 0, z)).toBe(BLOCK.BEDROCK);
          const height = profileAt(cx * 16 + x, cz * 16 + z, seed, BIOME).height;
          // The surface block stands at the profile height and stays solid whatever the caves do.
          for (let y = Math.max(1, LAVA_LEVEL + 1); y < height; y++) {
            const state = c.get(x, y, z);
            expect(state).not.toBe(BLOCK.GRASS);
            expect(state).not.toBe(BLOCK.SANDSTONE);
          }
          expect(c.get(x, height, z)).not.toBe(BLOCK.AIR);
          for (let y = height + 1; y <= SEA_LEVEL; y++) if (c.get(x, y, z) === BLOCK.WATER) water++;
          for (let y = SEA_LEVEL + 1; y <= SEA_LEVEL + 3; y++)
            expect(c.get(x, y, z)).not.toBe(BLOCK.WATER);
          checked++;
        }
    }
    expect(checked).toBe(4 * 256);
    expect(water).toBeGreaterThan(0);
  });

  it('keeps every vein inside its own band and under the surface', () => {
    const seed = seedHash(SEED);
    const bands = new Map(ORE_RULES.map((rule) => [rule.block, rule]));
    let veins = 0,
      blocks = 0;
    for (const [cx, cz] of [
      [1, 1],
      [-2, 3],
    ] as const) {
      const c = column(cx, cz);
      for (const vein of veinsNear(cx * 16, 1, cz * 16, cx * 16 + 15, 200, cz * 16 + 15, seed)) {
        const rule = bands.get(vein.block)!;
        expect(vein.y).toBeGreaterThanOrEqual(rule.minY);
        expect(vein.y).toBeLessThanOrEqual(rule.maxY);
        veins++;
      }
      for (let x = 0; x < 16; x++)
        for (let z = 0; z < 16; z++)
          for (let y = 1; y < 200; y++) {
            const state = c.get(x, y, z);
            const rule = bands.get(state);
            if (!rule) continue;
            blocks++;
            expect(y).toBeGreaterThanOrEqual(rule.minY - rule.radius);
            expect(y).toBeLessThanOrEqual(rule.maxY + rule.radius);
            expect(y).toBeLessThan(profileAt(cx * 16 + x, cz * 16 + z, seed, BIOME).height);
          }
    }
    expect(veins).toBeGreaterThan(10);
    expect(blocks).toBeGreaterThan(200);
  });
});

describe('the structures of the biome world', () => {
  const seed = seedHash(SEED);
  const plans = structuresNear(-96, -96, 96, 96, seed, BIOME);

  it('plans several kinds of structure and paints them into the column', () => {
    const kinds = new Set(plans.map((plan) => plan.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(3);
    const dungeon = plans.find((plan) => plan.kind === 'dungeon');
    const village = plans.find((plan) => plan.kind === 'village');
    expect(dungeon ?? village).toBeTruthy();
    for (const plan of plans) {
      const cx = plan.x >> 4,
        cz = plan.z >> 4;
      const column = generateColumn(cx, cz, SEED, BIOME);
      // Whatever the plan writes above the bedrock is really in the generated world.
      const at = structureColumn(plan, plan.x, plan.z, seed, BIOME);
      if (!at) continue;
      const lx = ((plan.x % 16) + 16) % 16,
        lz = ((plan.z % 16) + 16) % 16;
      let painted = 0;
      for (let y = 4; y <= 132; y++) {
        const state = at(y);
        if (state === NOTHING) continue;
        painted++;
        expect(column.get(lx, y, lz)).toBe(state);
      }
      expect(painted).toBeGreaterThan(0);
    }
  });

  it('builds a dungeon that is hollow, walled and lit by nothing', () => {
    const dungeon = plans.find((plan) => plan.kind === 'dungeon')!;
    expect(dungeon.y).toBeGreaterThanOrEqual(12);
    expect(dungeon.y).toBeLessThanOrEqual(38);
    const at = structureColumn(dungeon, dungeon.x, dungeon.z, seed, BIOME)!;
    // The middle of the room is air under a solid ceiling, with the lid on top of it.
    expect(at(dungeon.y)).toBe(BLOCK.AIR);
    expect(at(dungeon.y + 1)).toBe(BLOCK.AIR);
    expect(at(dungeon.y + 3)).toBe(BLOCK.COBBLE);
    // A corner holds the chest, the other three hold a spawner.
    const chest = structureColumn(dungeon, dungeon.x - 2, dungeon.z - 2, seed, BIOME)!;
    expect(chest(dungeon.y)).toBe(BLOCK.CHEST);
    for (const [dx, dz] of [
      [2, 2],
      [2, -2],
      [-2, 2],
    ] as const)
      expect(
        structureColumn(dungeon, dungeon.x + dx, dungeon.z + dz, seed, BIOME)!(dungeon.y),
      ).toBe(BLOCK.SPAWNER);
    const wall = structureColumn(dungeon, dungeon.x + 3, dungeon.z, seed, BIOME)!;
    expect([BLOCK.COBBLE, BLOCK.MOSSY_COBBLESTONE]).toContain(wall(dungeon.y + 1));
    expect(wall(dungeon.y + 3)).not.toBe(BLOCK.AIR);
    expect(wall(dungeon.y + 4)).toBe(NOTHING);
    // A dungeon is underground: the column above it keeps its own surface.
    const column = generateColumn(dungeon.x >> 4, dungeon.z >> 4, SEED, BIOME);
    const lx = ((dungeon.x % 16) + 16) % 16,
      lz = ((dungeon.z % 16) + 16) % 16;
    const height = profileAt(dungeon.x, dungeon.z, seed, BIOME).height;
    expect(height).toBeGreaterThan(dungeon.y + 4);
    expect(column.get(lx, height, lz)).not.toBe(BLOCK.AIR);
  });

  it('stands a village on the ground with doorways and a floor', () => {
    const village = plans.find((plan) => plan.kind === 'village')!;
    const house = village.houses[0];
    const hx = village.x + house.dx,
      hz = village.z + house.dz;
    const height = profileAt(hx, hz, seed, BIOME).height;
    const at = structureColumn(village, hx, hz, seed, BIOME)!;
    expect(at(height)).toBe(village.sandstone ? BLOCK.SANDSTONE : BLOCK.COBBLE);
    expect(at(height + 1)).toBe(BLOCK.AIR);
    expect(at(height + house.height)).not.toBe(BLOCK.AIR);
    const column = generateColumn(hx >> 4, hz >> 4, SEED, BIOME);
    expect(column.get(((hx % 16) + 16) % 16, height, ((hz % 16) + 16) % 16)).toBe(at(height));
  });
});

describe('a new biome world', () => {
  it('starts the player on dry land that stands above the sea', () => {
    const seed = seedHash(SEED);
    for (const preset of ['overworld', 'large-biomes', 'amplified'] as const) {
      const spawn = biomeSpawnPoint(SEED, preset);
      const x = Math.floor(spawn.x),
        z = Math.floor(spawn.z);
      const profile = profileAt(x, z, seed, preset);
      expect(profile.height).toBeGreaterThan(SEA_LEVEL + 1);
      expect(profile.height).toBeLessThan(88);
      expect(['ocean', 'beach']).not.toContain(profile.biome);
      expect(spawn.y).toBeCloseTo(profile.height + 1.01, 5);
      // The ground under the player is real: solid at their feet, open above their head.
      const column = generateColumn(x >> 4, z >> 4, SEED, preset);
      const lx = ((x % 16) + 16) % 16,
        lz = ((z % 16) + 16) % 16;
      const under = column.get(lx, profile.height, lz);
      expect([BLOCK.WATER, BLOCK.ICE, BLOCK.AIR, BLOCK.LAVA]).not.toContain(under);
      expect([
        BLOCK.AIR,
        BLOCK.FLOWER,
        BLOCK.DAISY,
        BLOCK.TALL_GRASS,
        BLOCK.SNOW,
        BLOCK.CACTUS,
        BLOCK.PUMPKIN,
        BLOCK.SUGAR_CANE,
        BLOCK.LOG,
        BLOCK.BIRCH,
      ]).toContain(column.get(lx, profile.height + 1, lz));
    }
  });
  it('saves and reloads with its own preset and generator version', () => {
    const session = new WorldSession(SEED, BIOME);
    session.loadColumn(0, 0);
    session.loadColumn(1, 0);
    session.world.setBlock(2, 40, 2, BLOCK.GLASS);
    const file = sealWorld({ ...payload(), core: session.checkpoint() });
    const reopened = verifyWorld(file);
    expect(reopened.payload.core.generator.preset).toBe('overworld');
    expect(reopened.payload.core.generator.version).toBe(GENERATOR_VERSION);
    const restored = new WorldSession(
      reopened.payload.core.generator.seed,
      reopened.payload.core.generator.preset,
      reopened.payload.core,
    );
    restored.loadColumn(0, 0);
    expect(restored.world.getBlock(2, 40, 2)).toBe(BLOCK.GLASS);
    // Everything that was not edited regenerates exactly as before.
    for (let y = 30; y < 90; y++)
      expect(restored.world.getBlock(3, y, 2)).toBe(session.world.getBlock(3, y, 2));
  });
  it('still accepts an old scenic save but not a biome world claiming to be one', () => {
    const rewrite = (preset: 'valley' | 'overworld') => {
      const file = payload();
      const generator = file.core.generator as { version: number; preset: string };
      generator.version = 1;
      generator.preset = preset;
      return sealWorld(file);
    };
    expect(verifyWorld(rewrite('valley')).payload.core.generator.preset).toBe('valley');
    expect(() => verifyWorld(rewrite('overworld'))).toThrow('генератор');
  });
});
