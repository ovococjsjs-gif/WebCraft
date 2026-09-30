import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { payload } from '../helpers/worlds';
import {
  sealWorld,
  verifyWorld,
  parseWorldFile,
  canonicalJSON,
  payloadChecksum,
  validatePayload,
  MAX_FILE_BYTES,
  SAVE_VERSION,
  exportFilename,
} from '../../packages/storage/src/format';

/** A version 1 file: nine block slots in the client and no item state at all. */
function legacyFile() {
  const modern = payload();
  const core = {
    generator: modern.core.generator,
    dimension: 'overworld' as const,
    tick: modern.core.tick,
    spawn: modern.core.spawn,
    player: modern.core.player,
    look: modern.core.look,
    selectedBlock: 'lab:oak_planks',
    editCount: modern.core.editCount,
    overrides: modern.core.overrides,
    scheduler: { sequence: 0, events: [] },
  };
  const client = {
    hotbar: [
      'lab:oak_planks',
      'lab:oak_log',
      'lab:cobblestone',
      'lab:dirt',
      'lab:stone',
      'lab:crafting_table',
      'lab:furnace',
      'lab:chest',
      'lab:glass',
    ],
    slot: 0,
    settings: { radius: 2, fov: 72, sensitivity: 1 },
  };
  return {
    format: 'voxel-lab/world' as const,
    version: 1,
    checksum: {
      algorithm: 'SHA-256' as const,
      value: payloadChecksum({
        name: modern.name,
        createdAt: modern.createdAt,
        savedAt: modern.savedAt,
        core,
        client,
      }),
    },
    payload: {
      name: modern.name,
      createdAt: modern.createdAt,
      savedAt: modern.savedAt,
      core,
      client,
    },
  };
}
describe('versioned world file', () => {
  it('roundtrips all currently implemented state with a stable checksum', () => {
    const source = payload();
    const sealed = sealWorld(source);
    expect(parseWorldFile(JSON.stringify(sealed)).payload).toEqual(source);
    expect(sealed.checksum.value).toBe(
      createHash('sha256')
        .update(canonicalJSON(validatePayload(source)))
        .digest('hex'),
    );
  });
  it('keeps baby, coloured and sheared creatures (the optional seventh field)', () => {
    const source = payload();
    source.core.mobs = [
      ['lab:sheep', 1.5, 9, 2.5, 8, 0.4, { g: -23000, v: 5, s: 1, c: 120 }],
      ['lab:cow', 3.5, 9, 2.5, 10, 0],
    ];
    const loaded = parseWorldFile(JSON.stringify(sealWorld(source))).payload;
    expect(loaded.core.mobs).toEqual(source.core.mobs);
    const broken = payload();
    broken.core.mobs = [['lab:sheep', 1.5, 9, 2.5, 8, 0.4, { v: 'red' } as never]];
    expect(() => validatePayload(broken)).toThrow();
  });
  it('does not depend on whitespace or property order', () => {
    const file = sealWorld(payload());
    const reordered = {
      ...file,
      payload: Object.fromEntries(Object.entries(file.payload).reverse()),
    };
    expect(verifyWorld(reordered).checksum).toEqual(file.checksum);
    expect(parseWorldFile(JSON.stringify(file, null, 2)).payload.name).toBe('Test world');
  });
  it('detects a modified saved block or player', () => {
    const file = sealWorld(payload());
    file.payload.core.overrides[0][3] = 'lab:stone';
    expect(() => verifyWorld(file)).toThrow('Контрольная сумма');
  });
  it('isolates sealed data from later game mutation', () => {
    const source = payload();
    const sealed = sealWorld(source);
    source.core.player.position.x = 100;
    source.core.overrides[0][0] = 10;
    expect(verifyWorld(sealed).payload.core.player.position.x).not.toBe(100);
  });
  it.each([0, SAVE_VERSION + 1, 999])(
    'rejects unsupported file version %i without conversion',
    (version) => {
      const f = sealWorld(payload());
      expect(() => verifyWorld({ ...f, version })).toThrow('Версия сохранения');
    },
  );
  it('upgrades a version 1 file to the item format without touching the original', () => {
    const legacy = legacyFile();
    const upgraded = verifyWorld(legacy);
    expect(upgraded.migrated).toBe(true);
    expect(upgraded.version).toBe(SAVE_VERSION);
    expect(upgraded.payload.core.inventory.slots).toHaveLength(41);
    expect(upgraded.payload.core.inventory.slots[0]).toEqual(['lab:oak_planks', 64, 0]);
    expect(upgraded.payload.client.settings.fov).toBe(72);
    expect('selected' in upgraded.payload.core).toBe(false);
    expect((legacy.payload as { core: { inventory?: unknown } }).core.inventory).toBeUndefined();
    // A version 1 world keeps its nine block slots as 64-placeable stacks.
    expect(upgraded.payload.core.inventory.selected).toBe(0);
    // Survival state did not exist then, so the file arrives with a fresh, full player.
    expect(upgraded.payload.core.survival.health).toBe(20);
    expect(upgraded.payload.core.survival.food).toBe(20);
    expect(upgraded.payload.core.mobs).toEqual([]);
    expect(upgraded.payload.core.arrows).toEqual([]);
    expect(upgraded.payload.core.orbs).toEqual([]);
    expect(upgraded.payload.core.time).toBe(0);
    // The world systems and stations did not exist either, so they arrive empty.
    expect(upgraded.payload.core.blocks.fluids).toEqual([]);
    expect(upgraded.payload.core.blocks.redstone).toEqual([]);
    expect(upgraded.payload.core.enchantments).toEqual([]);
    expect(upgraded.payload.core.brewing).toEqual([]);
    expect(upgraded.payload.core.carts).toEqual([]);
  });
  it('upgrades a version 2 file and keeps its checksum meaningful', () => {
    const modern = payload();
    const core: Record<string, unknown> = { ...modern.core };
    // A version 2 core has neither the survival block, the day clock nor the world systems.
    for (const key of [
      'time',
      'survival',
      'mobs',
      'arrows',
      'orbs',
      'blocks',
      'enchantments',
      'brewing',
      'carts',
      // The other dimensions and the bosses arrived with version 5.
      'dimensions',
      'bosses',
      'gameMode',
      'journey',
    ])
      delete core[key];
    const file = {
      format: 'voxel-lab/world' as const,
      version: 2,
      checksum: {
        algorithm: 'SHA-256' as const,
        value: payloadChecksum({
          name: modern.name,
          createdAt: modern.createdAt,
          savedAt: modern.savedAt,
          core: core as never,
          client: modern.client,
        }),
      },
      payload: {
        name: modern.name,
        createdAt: modern.createdAt,
        savedAt: modern.savedAt,
        core,
        client: modern.client,
      },
    };
    const upgraded = verifyWorld(file);
    expect(upgraded.migrated).toBe(true);
    expect(upgraded.version).toBe(SAVE_VERSION);
    expect(upgraded.payload.core.time).toBe(0);
    expect(upgraded.payload.core.survival.health).toBe(20);
    expect(upgraded.payload.core.survival.difficulty).toBe('normal');
    expect(upgraded.payload.core.containers).toHaveLength(modern.core.containers.length);
    expect(upgraded.payload.core.blocks.fire).toEqual([]);
    // A tampered version 2 file is still rejected: the checksum covers the old shape.
    const tampered = {
      ...file,
      payload: { ...file.payload, core: { ...core, tick: 999 } },
    };
    expect(() => verifyWorld(tampered)).toThrow('Контрольная сумма');
  });
  it('upgrades a version 3 file to version 4 with empty world systems', () => {
    const modern = payload();
    const core: Record<string, unknown> = { ...modern.core };
    // A version 3 core has survival state but no fluids, fire, redstone or stations.
    for (const key of [
      'blocks',
      'enchantments',
      'brewing',
      'carts',
      'dimensions',
      'bosses',
      'gameMode',
      'journey',
    ])
      delete core[key];
    const file = {
      format: 'voxel-lab/world' as const,
      version: 3,
      checksum: {
        algorithm: 'SHA-256' as const,
        value: payloadChecksum({
          name: modern.name,
          createdAt: modern.createdAt,
          savedAt: modern.savedAt,
          core: core as never,
          client: modern.client,
        }),
      },
      payload: {
        name: modern.name,
        createdAt: modern.createdAt,
        savedAt: modern.savedAt,
        core,
        client: modern.client,
      },
    };
    const upgraded = verifyWorld(file);
    expect(upgraded.migrated).toBe(true);
    expect(upgraded.version).toBe(SAVE_VERSION);
    expect(upgraded.payload.core.survival.health).toBe(modern.core.survival.health);
    expect(upgraded.payload.core.blocks).toEqual({
      fluids: [],
      fire: [],
      fuses: [],
      falling: [],
      redstone: [],
    });
    expect(upgraded.payload.core.carts).toEqual([]);
    // A tampered version 3 file is rejected against the checksum of its own shape.
    const tampered = { ...file, payload: { ...file.payload, core: { ...core, time: 123 } } };
    expect(() => verifyWorld(tampered)).toThrow('Контрольная сумма');
  });
  it('accepts an envelope without the migration flag as a current file', () => {
    const file = sealWorld(payload());
    const { migrated, ...rest } = file;
    void migrated;
    expect(parseWorldFile(JSON.stringify(rest)).payload).toEqual(file.payload);
  });
  it('rejects a diagnostic report rather than pretending it is a world', () =>
    expect(() => parseWorldFile('{"app":"voxel-web-lab","state":{}}')).toThrow());
  it('rejects truncated or invalid JSON', () =>
    expect(() => parseWorldFile('{"format":')).toThrow('JSON'));
  it('rejects files exceeding the byte budget', () =>
    expect(() => parseWorldFile(' '.repeat(MAX_FILE_BYTES + 1))).toThrow('16 МБ'));
  it('rejects an unknown generator instead of silently using the current generator', () => {
    const p = payload();
    (p.core.generator as { version: number }).version = 999;
    expect(() => sealWorld(p)).toThrow('генератор');
  });
  it('rejects unknown blocks rather than replacing them with air', () => {
    const p = payload();
    p.core.overrides[0][3] = 'minecraft:unknown';
    expect(() => sealWorld(p)).toThrow('не поддерживается');
  });
  it.each([
    [0, -1, 0],
    [0, 256, 0],
    [30000000, 1, 0],
    [NaN, 1, 0],
    [0.5, 1, 0],
  ])('rejects unsafe edit coordinates %s', (x, y, z) => {
    const p = payload();
    p.core.overrides = [[x, y, z, 'lab:stone']];
    expect(() => sealWorld(p)).toThrow('координаты');
  });
  it('rejects duplicate overrides', () => {
    const p = payload();
    p.core.overrides.push([...p.core.overrides[0]]);
    expect(() => sealWorld(p)).toThrow('повторная');
  });
  it.each([Infinity, NaN, -Infinity])('rejects nonfinite player positions %s', (x) => {
    const p = payload();
    p.core.player.position.x = x;
    expect(() => sealWorld(p)).toThrow();
  });
  it('rejects an inventory with the wrong slot count or an unknown item', () => {
    const wrongSize = payload();
    wrongSize.core.inventory.slots = wrongSize.core.inventory.slots.slice(0, 30);
    expect(() => sealWorld(wrongSize)).toThrow('41 слот');
    const unknown = payload();
    unknown.core.inventory.slots[0] = ['minecraft:stone', 1, 0];
    expect(() => sealWorld(unknown)).toThrow('не поддерживается');
  });
  it('rejects containers with impossible contents or a missing furnace state', () => {
    const chest = payload();
    chest.core.containers = [
      { key: '1,2,3', kind: 'chest', slots: new Array(27).fill(null) },
      { key: '4,2,3', kind: 'furnace', slots: [[], [], []] as never },
    ];
    expect(() => sealWorld(chest)).toThrow();
    const badSize = payload();
    badSize.core.containers = [{ key: '1,2,3', kind: 'furnace', slots: new Array(27).fill(null) }];
    expect(() => sealWorld(badSize)).toThrow('3 слот');
    const duplicate = payload();
    duplicate.core.containers = [
      { key: '1,2,3', kind: 'chest', slots: new Array(27).fill(null) },
      { key: '1,2,3', kind: 'chest', slots: new Array(27).fill(null) },
    ];
    expect(() => sealWorld(duplicate)).toThrow('повторный контейнер');
  });
  it('keeps a furnace burn, cook and experience state through a roundtrip', () => {
    const p = payload();
    p.core.containers = [
      {
        key: '3,8,4',
        kind: 'furnace',
        slots: [
          ['lab:iron_ore', 4, 0],
          ['lab:coal', 2, 0],
          ['lab:iron_ingot', 1, 0],
        ],
        furnace: { burn: 1200, burnTotal: 1600, cook: 75, xp: 0.7 },
      },
    ];
    const sealed = sealWorld(p);
    expect(parseWorldFile(JSON.stringify(sealed)).payload.core.containers).toEqual(
      p.core.containers,
    );
  });
  it('rejects a dropped item with an impossible damage value', () => {
    const p = payload();
    p.core.items = [['lab:iron_pickaxe', 1, 999, 1, 2, 3, 0]];
    expect(() => sealWorld(p)).toThrow('износ');
  });
  it('rejects missing state fields and unrecognized fields', () => {
    const p = payload();
    expect(() => sealWorld({ ...p, unknown: 123 } as never)).toThrow('поля');
    expect(() => validatePayload({ name: 'partial' })).toThrow();
  });
  it('rejects malformed and repeated scheduled events', () => {
    const p = payload();
    p.core.scheduler.events.push({ ...p.core.scheduler.events[0] });
    expect(() => sealWorld(p)).toThrow('повторное событие');
  });
  it('rejects dangerous event keys and nested objects', () => {
    const p = payload();
    p.core.scheduler.events[0].data = JSON.parse('{"__proto__":{"polluted":true}}');
    expect(() => sealWorld(p)).toThrow('поле события');
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
  it('allows literal HTML-looking names as data, not markup', () => {
    const p = payload('<img src=x onerror=alert(1)>');
    expect(verifyWorld(sealWorld(p)).payload.name).toBe(p.name);
  });
  it('rejects blank names and control characters', () => {
    expect(() => sealWorld(payload('   '))).toThrow();
    expect(() => sealWorld(payload('bad\u0000name'))).toThrow();
  });
  it('sanitizes exported filenames', () =>
    expect(exportFilename('a/b:c?d')).toBe('a_b_c_d.webcraft.json'));
  it('binds generator seed, time, selection and pending events into the checksum', () => {
    const p = payload(),
      hash = payloadChecksum(p);
    p.core.generator.seed = 'other';
    expect(payloadChecksum(p)).not.toBe(hash);
  });
});
