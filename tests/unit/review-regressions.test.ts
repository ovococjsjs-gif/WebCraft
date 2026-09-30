import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { populateStructureLoot } from '../../packages/core/src/structure-loot';
import { Simulation } from '../../packages/core/src/simulation';
import { WorldSession } from '../../packages/core/src/session';
import { VoxelWorld, ChunkColumn, daylight, solarElevation } from '../../packages/core/src/world';
import { BLOCK, registry } from '../../packages/content/src/blocks';
import { ITEMS, itemDurability } from '../../packages/content/src/items';
import { stack, addStack, sameKind, type Slot } from '../../packages/core/src/inventory';
import { LightEngine } from '../../packages/core/src/lighting';
import { PlantSystem } from '../../packages/core/src/farming';
import { JavaRandom, seedHash, hash2 } from '../../packages/core/src/random';
import { generateColumn } from '../../packages/core/src/terrain';
import { generateEndColumn } from '../../packages/core/src/end';
import { structuresNear } from '../../packages/core/src/structures';
import { END_FRAME_RING } from '../../packages/core/src/portals';
import { safeStanding } from '../../packages/core/src/safe-spawn';
import { MobStore } from '../../packages/core/src/mobs';
import { recipeById, planFor } from '../../packages/core/src/crafting';
import { anvilResult } from '../../packages/core/src/stations';
import { meshSection } from '../../packages/renderer/src/mesher';
import { EntityModels } from '../../packages/renderer/src/entity-models';
import {
  parseWorldFile,
  sealWorld,
  payloadChecksum,
  defaultClient,
  SAVE_VERSION,
} from '../../packages/storage/src/format';
import { WorldRepository } from '../../packages/storage/src/repository';
import { MemoryWorldBackend } from '../../packages/storage/src/backend';
import { SaveCoordinator, type SaveBridge } from '../../apps/browser/src/saves';

const flat = (seed = 'review-v08') => {
  const session = new WorldSession(seed, 'flat');
  session.ensureAround('overworld', 4, 8, 0);
  session.simulation.player.position = { x: 4.5, y: 9.01, z: 8.5 };
  return session;
};
const payload = (session: WorldSession) => ({
  name: 'Regression',
  createdAt: 1,
  savedAt: 2,
  core: session.checkpoint(),
  client: defaultClient(2),
});
const roundTrip = (session: WorldSession) =>
  parseWorldFile(JSON.stringify(sealWorld(payload(session)))).payload.core;
const amounts = (slots: readonly Slot[]) =>
  slots.reduce<Record<string, number>>((out, slot) => {
    if (slot) {
      const key = JSON.stringify([slot.item, slot.damage ?? 0, slot.enchantments ?? {}]);
      out[key] = (out[key] ?? 0) + slot.count;
    }
    return out;
  }, {});

describe('R01/R05/R16 · instance identity through every transfer', () => {
  it.each(
    ITEMS.filter((item) => itemDurability(item) > 0).map(
      (item) => [item.key, itemDurability(item)] as const,
    ),
  )('%s survives damage, cursor, save, drop, pickup and death', (key, durability) => {
    const session = flat(),
      sim = session.simulation;
    const original = stack(key, 1, Math.min(7, durability - 1), { unbreaking: 2 });
    sim.inventory.set(0, original);
    const restored = new WorldSession(session.seed, session.preset, roundTrip(session));
    expect(restored.simulation.inventory.get(0)).toEqual(original);
    sim.slotClick(null, 0, 0);
    sim.returnCursor();
    expect(sim.inventory.get(0)).toEqual(original);
    expect(sim.dropSelected(false).ok).toBe(true);
    expect(sim.inventory.get(0)).toBeNull();
    sim.entities.list[0].pickupDelay = 0;
    sim.step();
    expect(sim.inventory.get(0)).toEqual(original);
    expect(sim.die()).toBe(1);
    const n = sim.entities.size;
    expect(sim.die()).toBe(0);
    expect(sim.entities.size).toBe(n);
    for (let i = 0; i < 25; i++) sim.step();
    expect(sim.inventory.get(0)).toBeNull();
    const dead = roundTrip(session);
    expect(dead.items[0]?.[2]).toBe(original.damage);
    expect(dead.items[0]?.[7]).toEqual(original.enchantments);
  });
  it('captures a completely full inventory and overflowing grid without losing or mutating items', () => {
    const session = flat(),
      sim = session.simulation;
    for (let i = 0; i < 36; i++) sim.inventory.set(i, stack('lab:cobblestone', 64));
    sim.inventory.set(40, stack('lab:oak_log', 64));
    sim.openCrafting();
    for (let i = 0; i < 4; i++)
      sim.grid.set(i, stack('lab:iron_pickaxe', 1, 150 + i, { efficiency: 2 }));
    sim.cursor = stack('lab:bow', 1, 50, { power: 2 });
    const before = amounts([...sim.inventory.slots, ...sim.grid.slots, sim.cursor]);
    const core = roundTrip(session),
      restored = new WorldSession(session.seed, session.preset, core);
    const ground = restored.simulation.entities.list.map((e) =>
      stack(e.item, e.count, e.damage, e.enchantments),
    );
    expect(
      amounts([...restored.simulation.inventory.slots, restored.simulation.cursor, ...ground]),
    ).toEqual(before);
    expect(sim.grid.slots.filter(Boolean)).toHaveLength(4);
    expect(roundTrip(session).items).toEqual(core.items);
  });
  it('does not merge plain and enchanted stacks or enchant a future item', () => {
    const session = flat(),
      sim = session.simulation;
    const enchanted = stack('lab:iron_pickaxe', 1, 200, { efficiency: 3 });
    sim.inventory.set(0, enchanted);
    addStack(sim.inventory, stack('lab:iron_pickaxe'));
    expect(sameKind(sim.inventory.get(0), sim.inventory.get(1))).toBe(false);
    expect(
      sim.enchantments.miningScale(
        ITEMS.find((i) => i.key === 'lab:iron_pickaxe'),
        sim.inventory.get(0),
      ),
    ).toBeGreaterThan(1);
    expect(
      sim.enchantments.miningScale(
        ITEMS.find((i) => i.key === 'lab:iron_pickaxe'),
        sim.inventory.get(1),
      ),
    ).toBe(1);
    expect(roundTrip(session).inventory.slots[0]?.[3]).toEqual({ efficiency: 3 });
  });
  it('moves instance metadata through a hopper without stacking two tools', () => {
    const session = flat(),
      sim = session.simulation;
    sim.setBlockState(4, 10, 8, BLOCK.HOPPER);
    sim.setBlockState(4, 9, 8, BLOCK.CHEST);
    const from = sim.containers.ensure('hopper', 4, 10, 8),
      to = sim.containers.ensure('chest', 4, 9, 8);
    const tool = stack('lab:iron_pickaxe', 1, 200, { unbreaking: 3 });
    from.slots.set(0, tool);
    to.slots.set(0, stack('lab:iron_pickaxe'));
    for (let tick = 0; tick < 8; tick++) sim.step();
    expect(to.slots.get(0)).toEqual(stack('lab:iron_pickaxe'));
    expect(to.slots.get(1)).toEqual(tool);
    expect(from.slots.get(0)).toBeNull();
  });
  it('repairs only the anvil result and preserves its enchantment', () => {
    const session = flat(),
      sim = session.simulation;
    sim.setBlockState(5, 9, 8, BLOCK.ANVIL);
    sim.openContainer('anvil', 5, 9, 8);
    sim.inventory.set(0, stack('lab:iron_pickaxe'));
    const worn = stack('lab:iron_pickaxe', 1, 180, { efficiency: 2 });
    sim.grid.set(0, worn);
    sim.grid.set(1, stack('lab:iron_ingot'));
    sim.survival.addXp(200);
    const expected = anvilResult(worn, stack('lab:iron_ingot'))!.stack;
    expect(sim.anvilTake().ok).toBe(true);
    expect(sim.inventory.get(0)).toEqual(stack('lab:iron_pickaxe'));
    expect(sim.inventory.get(1)).toEqual(expected);
    expect(
      anvilResult(worn, stack('lab:iron_pickaxe', 1, 80, { unbreaking: 2 }))?.stack?.enchantments,
    ).toEqual({ efficiency: 2, unbreaking: 2 });
  });
  it('returns an open grid and cursor before transferring dimension ownership', () => {
    const session = flat(),
      sim = session.simulation;
    sim.openCrafting();
    sim.grid.set(0, stack('lab:bow', 1, 45, { power: 2 }));
    sim.cursor = stack('lab:iron_helmet', 1, 3);
    session.travelTo('end');
    sim.openCrafting();
    expect(sim.inventory.slots.find((s) => s?.item === 'lab:bow')).toEqual(
      stack('lab:bow', 1, 45, { power: 2 }),
    );
    expect(sim.inventory.slots.find((s) => s?.item === 'lab:iron_helmet')?.damage).toBe(3);
    expect(sim.grid.slots.filter(Boolean)).toHaveLength(0);
  });
});

describe('R02 · all saved domains and capture-time acknowledgement', () => {
  it.each([
    'health',
    'difficulty',
    'food',
    'time',
    'blocks',
    'boss',
    'cart',
    'brewing',
    'journey',
    'items',
    'enchantments',
  ])('%s changes the Worker persistence stamp', (name) => {
    const session = flat(),
      sim = session.simulation,
      before = session.persistenceStamp();
    switch (name) {
      case 'health':
        sim.survival.health = 13;
        break;
      case 'difficulty':
        sim.setDifficulty('hard');
        break;
      case 'food':
        sim.survival.food = 11;
        break;
      case 'time':
        sim.setTime(1);
        break;
      case 'blocks':
        session.world.setBlock(5, 9, 8, BLOCK.STONE);
        break;
      case 'boss':
        sim.bosses.spawnBoss('wither', { x: 9, y: 10, z: 9 });
        break;
      case 'cart':
        sim.carts.spawn('ride', { x: 4.5, y: 9.125, z: 8.5 });
        break;
      case 'brewing':
        sim.brewing.ensure(4, 9, 8).ingredient = stack('lab:nether_wart');
        break;
      case 'journey':
        sim.journey.add('wood');
        break;
      case 'items':
        sim.entities.spawnStack(stack('lab:bow', 1, 10), sim.player.position);
        break;
      case 'enchantments':
        sim.inventory.set(0, stack('lab:iron_pickaxe', 1, 2, { fortune: 2 }));
        break;
    }
    expect(session.persistenceStamp()).not.toBe(before);
    expect(() => roundTrip(session)).not.toThrow();
  });
  const coordinator = async () => {
    const session = flat();
    let captures = 0;
    const bridge: SaveBridge = {
      ready: () => true,
      current: () => ({
        ...session.simulation.snapshot(),
        persistenceStamp: session.persistenceStamp(),
      }),
      client: () => defaultClient(2),
      capture: async () => {
        captures++;
        return { core: session.checkpoint(), stamp: session.persistenceStamp() };
      },
      pause: () => {},
      load: () => {},
      changed: () => {},
      notify: () => {},
    };
    const saves = new SaveCoordinator(bridge);
    saves.repository = new WorldRepository(new MemoryWorldBackend());
    saves.active = await saves.repository.create(payload(session));
    await saves.save();
    return { session, saves, captures: () => captures };
  };
  it('manual save always captures; clean autosave does not rotate a backup', async () => {
    const { saves, captures, session } = await coordinator();
    const rev = saves.active!.meta.revision;
    await saves.save(false);
    expect(saves.active!.meta.revision).toBe(rev);
    await saves.save();
    expect(captures()).toBe(2);
    expect(saves.active!.meta.revision).toBe(rev + 1);
    session.simulation.survival.health = 13;
    session.simulation.setDifficulty('hard');
    expect(saves.dirty).toBe(true);
    await saves.save();
    const saved = await saves.repository.load(saves.active!.meta.id);
    expect(saved.file.payload.core.survival).toMatchObject({ health: 13, difficulty: 'hard' });
  });
  it('a mutation after capture remains dirty even if the database commit finishes later', async () => {
    const { saves, session } = await coordinator();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const commit = saves.repository.commit.bind(saves.repository);
    const spy = vi.spyOn(saves.repository, 'commit').mockImplementation(async (...args) => {
      await gate;
      return commit(...args);
    });
    const pending = saves.save();
    await Promise.resolve();
    await Promise.resolve();
    expect(spy).toHaveBeenCalled();
    session.simulation.survival.health = 9;
    release();
    await pending;
    expect(saves.dirty).toBe(true);
    spy.mockRestore();
    await saves.save();
    expect(saves.dirty).toBe(false);
  });
  it('saves a fractional moving minecart and non-empty brewing stand', () => {
    const session = flat(),
      sim = session.simulation;
    const cart = sim.carts.spawn('ride', { x: 4.2, y: 9.125, z: 8.5 });
    cart.velocity.x = 0.17;
    const brewing = sim.brewing.ensure(4, 9, 8);
    brewing.ingredient = stack('lab:nether_wart');
    brewing.bottles[0] = stack('lab:potion_water');
    const core = roundTrip(session);
    expect(core.carts[0]).toMatchObject({ x: 4.2, y: 9.125, vx: 0.17 });
    expect(core.brewing[0].state.bottles[0]?.item).toBe('lab:potion_water');
  });
});

describe('R03 · real historical save codecs and immutable old generators', () => {
  const files = readdirSync('fixtures/saves').filter((f) => f.endsWith('.voxel.json'));
  it.each(files)('opens the genuine UI export %s and seals a valid current envelope', (file) => {
    const raw = JSON.parse(readFileSync(`fixtures/saves/${file}`, 'utf8'));
    const migrated = parseWorldFile(JSON.stringify(raw));
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.migrated).toBe(true);
    expect(migrated.payload.core.generator.version).toBe(raw.payload.core.generator.version);
    expect(migrated.payload.core.generator.seed).toBe(raw.payload.core.generator.seed);
    expect(() => parseWorldFile(JSON.stringify(migrated))).not.toThrow();
    const core = migrated.payload.core;
    const session = new WorldSession(core.generator.seed, core.generator.preset, core);
    session.loadColumn(0, 0);
    expect(session.checkpoint().generator.version).toBe(core.generator.version);
    raw.payload.core.tick++;
    expect(() => parseWorldFile(JSON.stringify(raw))).toThrow('Контрольная сумма');
  });
  it('authenticates the v3/generator1 shape before adding defaults (no v3 HTML was bundled)', () => {
    const raw = JSON.parse(readFileSync('fixtures/saves/release-0.4.0-flat.voxel.json', 'utf8'));
    raw.version = 3;
    for (const key of ['blocks', 'enchantments', 'brewing', 'carts']) delete raw.payload.core[key];
    raw.checksum.value = payloadChecksum(raw.payload);
    expect(parseWorldFile(JSON.stringify(raw)).payload.core.generator.version).toBe(1);
  });
  it('migrates global legacy upgrades onto only existing inventory, chest and ground items', () => {
    const session = flat(),
      core = session.checkpoint();
    core.inventory.slots[0] = ['lab:iron_pickaxe', 1, 100];
    core.items = [['lab:iron_pickaxe', 1, 120, 5, 9, 8, 0]];
    core.containers = [
      {
        key: '4,9,8',
        kind: 'chest',
        slots: [['lab:iron_pickaxe', 1, 140], ...new Array(26).fill(null)],
      },
    ];
    core.enchantments = [{ item: 'lab:iron_pickaxe', id: 'efficiency', level: 3 }];
    delete core.gameMode;
    delete core.journey;
    const data = { ...payload(session), core };
    const file = {
      format: 'voxel-lab/world',
      version: 5,
      payload: data,
      checksum: { algorithm: 'SHA-256', value: payloadChecksum(data) },
    };
    const saved = parseWorldFile(JSON.stringify(file)).payload.core;
    expect(saved.inventory.slots[0]?.[3]).toEqual({ efficiency: 3 });
    expect(saved.containers[0].slots[0]?.[3]).toEqual({ efficiency: 3 });
    expect(saved.items[0][7]).toEqual({ efficiency: 3 });
    expect(saved.enchantments).toEqual([]);
  });
  it('generator2 does not silently acquire the strongholds added by generator3', () => {
    const seed = 'legacy-layout',
      plan = structuresNear(-1024, -1024, 1024, 1024, seedHash(seed), 'overworld').find(
        (p) => p.kind === 'stronghold',
      )!;
    expect(plan).toBeDefined();
    const [dx, dz] = END_FRAME_RING[0],
      x = plan.x + dx,
      z = plan.z + dz;
    const old = generateColumn(Math.floor(x / 16), Math.floor(z / 16), seed, 'overworld', 2),
      current = generateColumn(Math.floor(x / 16), Math.floor(z / 16), seed, 'overworld', 3);
    expect([BLOCK.END_PORTAL_FRAME, BLOCK.END_PORTAL_FRAME_EYE]).not.toContain(
      old.get(x & 15, plan.y, z & 15),
    );
    expect([BLOCK.END_PORTAL_FRAME, BLOCK.END_PORTAL_FRAME_EYE]).toContain(
      current.get(x & 15, plan.y, z & 15),
    );
  });
  it('generator4 fixes outer-city cells without altering the frozen End generator3', () => {
    const seed = 'cities-v4',
      hash = seedHash(seed);
    let found = false;
    for (let gx = 3; gx < 9 && !found; gx++)
      for (let gz = -3; gz < 4 && !found; gz++) {
        if (hash2(gx, gz, hash + 6113) >= 0.55) continue;
        const x = gx * 256 + 80 + Math.floor(hash2(gx, gz, hash + 6121) * 96),
          z = gz * 256 + 80 + Math.floor(hash2(gx, gz, hash + 6131) * 96);
        const modern = generateEndColumn(Math.floor(x / 16), Math.floor(z / 16), seed, 4);
        if (!modern.chests.size) continue;
        expect(generateEndColumn(Math.floor(x / 16), Math.floor(z / 16), seed, 3).chests.size).toBe(
          0,
        );
        found = true;
      }
    expect(found).toBe(true);
  });
});

describe('R06–R09 · dimensional lifecycle and ordinary combat', () => {
  it.each(['nether', 'end'] as const)(
    'respawns safely at the Overworld bed/spawn after death in %s',
    (dimension) => {
      const session = flat();
      session.simulation.survival.setSpawn({ x: 7.5, y: 9.01, z: 8.5 });
      session.travelTo(dimension);
      session.simulation.die();
      session.respawn();
      expect(session.dimension).toBe('overworld');
      expect(session.simulation.survival.dead).toBe(false);
      expect(safeStanding(session.world, session.simulation.player.position)).toBe(true);
      expect(session.simulation.player.position.x).toBe(7.5);
      expect(() => roundTrip(session)).not.toThrow();
    },
  );
  it('falls through a loaded, empty End column, dies and remains saveable', () => {
    const session = flat(),
      end = session.worldFor('end'),
      column = new ChunkColumn(50, 50);
    column.status = 'ready';
    end.addColumn(column);
    session.simulation.changeDimension(end, { x: 800.5, y: 10, z: 800.5 });
    for (let tick = 0; tick < 400; tick++) session.simulation.step();
    expect(session.simulation.player.position.y).toBeLessThan(0);
    expect(session.simulation.survival.dead).toBe(true);
    expect(() => roundTrip(session)).not.toThrow();
  });
  it('does not resurrect the dragon or duplicate crystals after travel, save and reload', () => {
    const session = flat();
    session.travelTo('end');
    const sim = session.simulation;
    expect(sim.bosses.crystals).toHaveLength(10);
    sim.hurtBoss(sim.bosses.dragon!, 1000);
    const n = sim.bosses.crystals.length;
    session.travelTo('overworld');
    const core = roundTrip(session),
      restored = new WorldSession(session.seed, session.preset, core);
    restored.travelTo('end');
    expect(restored.simulation.bosses.dragon).toBeUndefined();
    expect(restored.simulation.bosses.dragonDefeated).toBe(true);
    expect(restored.simulation.bosses.crystals).toHaveLength(n);
    for (const [x, z] of [
      [-3, 0],
      [3, 0],
      [0, -3],
      [0, 3],
    ])
      restored.simulation.bosses.addCrystal({ x: x + 0.5, y: 68, z: z + 0.5 });
    expect(restored.simulation.checkDragonRitual()).toBe(true);
    expect(restored.simulation.bosses.dragon?.health).toBe(200);
    expect(restored.simulation.bosses.crystals).toHaveLength(10);
    expect(restored.simulation.checkDragonRitual()).toBe(false);
  });
  it.each(['melee', 'arrow'])('destroys a crystal using ordinary %s targeting', (method) => {
    const session = flat(),
      sim = session.simulation;
    sim.setInput({ ...sim.input, yaw: 0, pitch: 0 });
    sim.player.position = { x: 4.5, y: 9, z: 8.5 };
    session.world.setBlock(4, 8, 6, BLOCK.OBSIDIAN);
    sim.bosses.addCrystal({ x: 4.5, y: 9, z: 6.5 });
    if (method === 'melee') expect(sim.attack().ok).toBe(true);
    else {
      sim.arrows.spawn({ x: 4.5, y: 10.2, z: 8.5 }, { x: 0, y: 0, z: -30 }, 4);
      for (let i = 0; i < 5; i++) sim.step();
    }
    expect(sim.bosses.crystals).toHaveLength(0);
  });
  it('reports renderable bosses, crystals, skulls and carts outside diagnostics', () => {
    const session = flat(),
      sim = session.simulation;
    sim.bosses.spawnBoss('wither', { x: 4, y: 10, z: 4 });
    sim.bosses.addCrystal({ x: 5, y: 10, z: 5 });
    sim.carts.spawn('ride', { x: 4, y: 9, z: 4 });
    const state = sim.snapshot();
    expect(state.bosses[0]).toMatchObject({ kind: 'wither', x: 4, y: 10, z: 4 });
    expect(state.crystals).toHaveLength(1);
    expect(state.carts).toHaveLength(1);
  });
});

describe('R10 · attainable resources, recipes and non-refilling loot', () => {
  it.each([
    ['lab:enderman', 'lab:ender_pearl'],
    ['lab:blaze', 'lab:blaze_rod'],
    ['lab:wither_skeleton', 'lab:wither_skeleton_skull'],
    ['lab:spider', 'lab:string'],
  ])('%s supplies %s', (kind, item) => {
    const mobs = new MobStore(),
      mob = mobs.spawn(kind, { x: 0, y: 9, z: 0 });
    let call = 0;
    const death = mobs.hurt(mob, 1000, undefined, () =>
      kind.includes('wither') ? (call++ === 0 ? 0.99 : 0) : 0.99,
    );
    expect(death?.drops.some((drop) => drop.item === item && drop.count > 0)).toBe(true);
  });
  it('crafts powder and an Eye through the real grid, with no palette or grant call', () => {
    const sim = flat().simulation;
    sim.openCrafting();
    sim.grid.set(0, stack('lab:blaze_rod'));
    expect(sim.slotClick('result', 0, 0).ok).toBe(true);
    expect(sim.cursor?.item).toBe('lab:blaze_powder');
    expect(sim.cursor?.count).toBe(2);
    sim.returnCursor();
    sim.grid.set(0, stack('lab:ender_pearl'));
    sim.grid.set(1, stack('lab:blaze_powder'));
    expect(sim.slotClick('result', 0, 0).ok).toBe(true);
    expect(sim.cursor?.item).toBe('lab:eye_of_ender');
    const lamp = recipeById('lamp')!;
    expect(planFor(lamp, 3).map((p) => p.item)).toContain('lab:glowstone');
    expect(planFor(lamp, 3).map((p) => p.item)).not.toContain(lamp.result[0]);
    expect(recipeById('bow')).toBeDefined();
    expect(recipeById('arrows')).toBeDefined();
    expect(recipeById('end_crystal')).toBeDefined();
  });
  it('fills a generated chest once, never refills an emptied chest or a player-placed chest', () => {
    const session = flat(),
      world = session.world,
      column = world.column(0, 0)!,
      store = session.simulation.containers;
    column.set(4, 9, 8, BLOCK.CHEST);
    expect(populateStructureLoot(world, column, store, () => false)).toBe(1);
    expect(store.get(4, 9, 8)!.slots.slots.filter(Boolean).length).toBeGreaterThan(2);
    store.get(4, 9, 8)!.slots.slots.fill(null);
    expect(populateStructureLoot(world, column, store, () => false)).toBe(0);
    const saved = roundTrip(session),
      restored = new WorldSession(session.seed, session.preset, saved);
    expect(restored.simulation.containers.get(4, 9, 8)!.slots.slots.every((s) => s === null)).toBe(
      true,
    );
    store.remove(4, 9, 8);
    expect(populateStructureLoot(world, column, store, () => true)).toBe(0);
  });
  it('naturally spawns fortress enemies on loaded nether-brick walkways', () => {
    const world = new VoxelWorld('natural-fortress', 'nether');
    for (let cx = -2; cx <= 2; cx++)
      for (let cz = -2; cz <= 2; cz++) {
        const c = new ChunkColumn(cx, cz);
        for (let x = 0; x < 16; x++)
          for (let z = 0; z < 16; z++) c.set(x, 64, z, BLOCK.NETHER_BRICK);
        c.status = 'ready';
        world.addColumn(c);
      }
    const sim = new Simulation(world, { x: 0.5, y: 65.01, z: 0.5 });
    sim.naturalSpawns = true;
    sim.step();
    expect(sim.mobs.list.length).toBeGreaterThan(0);
    // Fortresses also breed magma cubes, as in 1.12 (round G).
    expect(['lab:blaze', 'lab:wither_skeleton', 'lab:magma_cube_medium']).toContain(
      sim.mobs.list[0].kind,
    );
  });
  it('persists explicit survival and creative modes', () => {
    const session = new WorldSession('mode', 'overworld', undefined, 'survival');
    expect(roundTrip(session).gameMode).toBe('survival');
    session.simulation.gameMode = 'creative';
    expect(roundTrip(session).gameMode).toBe('creative');
  });
});

describe('R11/R13/R14/R15/R20 · input, lighting and bounded work', () => {
  it('neutralizes movement, mining and held use without firing a charged bow', () => {
    const sim = flat().simulation;
    sim.inventory.set(0, stack('lab:bow'));
    sim.inventory.set(1, stack('lab:arrow', 8));
    sim.setInput({ ...sim.input, forward: 1, jump: true, sprint: true });
    sim.setMining(true);
    sim.setUseHold(true);
    sim.bowCharge = 20;
    sim.cancelActions();
    expect(sim.input).toMatchObject({ forward: 0, strafe: 0, jump: false, sprint: false });
    expect(sim.mining).toBeNull();
    expect(sim.useHeld).toBe(false);
    expect(sim.bowCharge).toBe(0);
    expect(sim.arrows.size).toBe(0);
  });
  it('propagates torch light symmetrically across a chunk edge and invalidates only local caches', () => {
    const session = flat();
    session.loadColumn(1, 0);
    session.loadColumn(8, 0);
    const light = new LightEngine(session.world);
    session.world.setBlock(15, 12, 8, BLOCK.TORCH);
    expect(light.blockLight(15, 12, 8)).toBe(14);
    expect(light.blockLight(14, 12, 8)).toBe(13);
    expect(light.blockLight(16, 12, 8)).toBe(13);
    const builds = light.builds;
    session.world.setBlock(128, 10, 8, BLOCK.STONE);
    expect(light.blockLight(16, 12, 8)).toBe(13);
    expect(light.builds).toBe(builds);
    session.world.setBlock(15, 12, 8, BLOCK.AIR);
    expect(light.blockLight(16, 12, 8)).toBe(0);
    expect(light.cachedColumns).toBeLessThanOrEqual(session.world.columns.size);
  });
  it('stops block light at opaque walls and carries light into terrain attributes', () => {
    const session = flat();
    session.loadColumn(1, 0);
    const world = session.world,
      light = new LightEngine(world);
    world.setBlock(15, 12, 8, BLOCK.TORCH);
    for (let y = 0; y < 29; y++) for (let z = 0; z < 16; z++) world.setBlock(16, y, z, BLOCK.STONE);
    expect(light.blockLight(16, 12, 8)).toBe(0);
    expect(light.blockLight(17, 12, 8)).toBe(0);
    const geometry = meshSection(world, 0, 0, 0, light);
    expect(
      Object.values(geometry.layers).some((layer) =>
        layer.lights.some((value, index) => index % 2 === 1 && value > 0),
      ),
    ).toBe(true);
  });
  it('has identical plant opportunity and maturity times at radii 2, 4 and 5', () => {
    const mature: number[][] = [];
    for (const radius of [2, 4, 5]) {
      const world = new VoxelWorld('farm');
      for (let cx = -radius; cx <= radius; cx++)
        for (let cz = -radius; cz <= radius; cz++)
          world.addColumn(generateColumn(cx, cz, 'farm', 'flat'));
      const rng = new JavaRandom(871),
        plants = new PlantSystem({
          world,
          light: new LightEngine(world),
          isNight: () => false,
          random: () => rng.nextDouble(),
        });
      const crops = [4, 5, 6, 7, 8, 9];
      for (const x of crops) {
        world.setBlock(x, 8, 8, BLOCK.FARMLAND_WET);
        world.setBlock(x, 9, 8, BLOCK.WHEAT_0);
      }
      world.setBlock(6, 8, 9, BLOCK.WATER);
      const times = crops.map(() => 0);
      for (let tick = 0; tick < 15000; tick++) {
        plants.tickActive(tick, { x: 6, z: 8 });
        crops.forEach((x, i) => {
          if (!times[i] && registry.get(world.getBlock(x, 9, 8)).cropStage === 7) times[i] = tick;
        });
        if (times.every(Boolean)) break;
      }
      expect(times.every((tick) => tick > 0 && tick < 15000)).toBe(true);
      expect(plants.backlog).toBe(0);
      mature.push(times);
    }
    expect(mature[1]).toEqual(mature[0]);
    expect(mature[2]).toEqual(mature[0]);
  }, 15000);
  it('agrees about the sun: noon is brightest, midnight darkest', () => {
    expect(solarElevation(0)).toBeCloseTo(0);
    expect(solarElevation(6000)).toBeCloseTo(1);
    expect(solarElevation(18000)).toBeCloseTo(-1);
    expect(daylight(6000)).toBe(1);
    expect(daylight(18000)).toBe(0);
    expect(new LightEngine(new VoxelWorld('sky', 'nether')).skyLight(0, 260, 0)).toBe(0);
  });
  it('shares a single geometry across arbitrary entity spawn/despawn cycles', () => {
    const models = new EntityModels();
    const geometries = new Set<unknown>();
    for (let cycle = 0; cycle < 30; cycle++)
      for (const kind of ['lab:cow', 'lab:enderman', 'lab:blaze']) {
        const group = models.mob(kind);
        group.traverse((mesh) => {
          if ('geometry' in mesh) geometries.add(mesh.geometry);
        });
        group.clear();
      }
    expect(geometries.size).toBe(1);
    models.dispose();
  });
});

describe('0.8 release-gate follow-up regressions', () => {
  it('has an exactly stable persistence stamp after drag has come to rest', () => {
    const session = flat(),
      sim = session.simulation;
    sim.setInput({ ...sim.input, forward: 1 });
    for (let i = 0; i < 8; i++) sim.step();
    sim.setInput({ ...sim.input, forward: 0 });
    for (let i = 0; i < 70; i++) sim.step();
    expect(sim.player.velocity.x).toBe(0);
    expect(sim.player.velocity.z).toBe(0);
    const before = session.persistenceStamp();
    for (let i = 0; i < 400; i++) sim.step();
    expect(session.persistenceStamp()).toBe(before);
  });
  it('does not rewind the travelling clock when an inactive world is reused', () => {
    const session = flat();
    session.simulation.setTime(8000);
    session.world.tick = 100;
    session.travelTo('end');
    session.simulation.setTime(9400);
    session.world.tick = 600;
    session.travelTo('overworld');
    expect(session.world.time).toBe(9400);
    expect(session.world.tick).toBe(600);
    const core = roundTrip(session),
      restored = new WorldSession(session.seed, session.preset, core);
    restored.travelTo('end');
    expect(restored.world.time).toBe(9400);
    expect(restored.world.tick).toBe(600);
  });
  it('does not rebuild sky/block caches for a crop-only stage change', () => {
    const session = flat(),
      world = session.world,
      light = new LightEngine(world);
    world.setBlock(4, 9, 8, BLOCK.WHEAT_0);
    expect(light.skyLight(4, 9, 8)).toBe(15);
    const builds = light.builds;
    world.setBlock(4, 9, 8, BLOCK.WHEAT_1);
    expect(light.skyLight(4, 9, 8)).toBe(15);
    expect(light.builds).toBe(builds);
  });
});
