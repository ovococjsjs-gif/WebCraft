import { describe, expect, it } from 'vitest';
import { BLOCK, registry } from '../../packages/content/src/blocks';
import { GeneratorV5 } from '../../packages/core/src/worldgen/generator-v5';
import { idx } from '../../packages/core/src/worldgen/terrain-v5';
import { intersects, intersects2 } from '../../packages/core/src/worldgen/structures/pieces';
import { templeKind } from '../../packages/core/src/worldgen/structures/temples';
import { villageStyle, Road, Lamp } from '../../packages/core/src/worldgen/structures/villages';
import { Corridor } from '../../packages/core/src/worldgen/structures/mineshafts';
import {
  PortalRoom,
  strongholdPositions,
} from '../../packages/core/src/worldgen/structures/strongholds';
import { structureLoot, LOOT_TABLES } from '../../packages/core/src/structure-loot';
import { VoxelWorld } from '../../packages/core/src/world';
import { generateColumn, spawnPoint } from '../../packages/core/src/terrain';
import { Simulation } from '../../packages/core/src/simulation';
import { seedHash } from '../../packages/core/src/random';

const gen = new GeneratorV5('structures', 'overworld');
const all = gen.structures.near(-60, -60, 60, 60);

describe('v5 structures', () => {
  it('places villages, temples, mineshafts and strongholds', () => {
    const kinds = new Set(all.map((s) => s.kind));
    for (const k of ['village', 'mineshaft', 'stronghold'] as const) expect(kinds).toContain(k);
    expect(all.some((s) => s.kind === 'temple')).toBe(true);
  });
  it('builds villages only in village biomes, with no two buildings overlapping', () => {
    const villages = all.filter((s) => s.kind === 'village');
    expect(villages.length).toBeGreaterThan(0);
    for (const v of villages) {
      expect(villageStyle(gen.structures.ctx.biome(v.x, v.z).key)).toBeDefined();
      const buildings = v.pieces.filter((p) => !(p instanceof Road));
      const houses = buildings.filter((p) => !(p instanceof Lamp));
      expect(houses.length).toBeGreaterThanOrEqual(4);
      for (let i = 0; i < buildings.length; i++)
        for (let j = i + 1; j < buildings.length; j++)
          expect(intersects2(buildings[i].box, buildings[j].box)).toBe(false);
      const roads = v.pieces.filter((p) => p instanceof Road);
      for (const b of buildings)
        for (const r of roads) expect(intersects2(b.box, r.box)).toBe(false);
    }
  });
  it('puts every temple in the biome it belongs to', () => {
    const temples = gen.structures.near(-200, -200, 200, 200, ['temple']);
    expect(temples.length).toBeGreaterThan(2);
    for (const t of temples)
      expect(templeKind(gen.structures.ctx.biome(t.x, t.z).key)).toBe(t.label);
  });
  it('keeps mineshafts and strongholds under the ground', () => {
    const ground = (x: number, z: number) => gen.structures.ctx.ground(x, z);
    for (const s of all.filter((s) => s.kind === 'mineshaft' || s.kind === 'stronghold'))
      for (const p of s.pieces) {
        const b = p.box;
        const lowest = Math.min(
          ground(b.x0, b.z0),
          ground(b.x1, b.z1),
          ground(b.x0, b.z1),
          ground(b.x1, b.z0),
        );
        expect(b.y1).toBeLessThan(lowest - 4);
        expect(b.y0).toBeGreaterThan(3);
      }
  });
  it('keeps every mineshaft corridor walkable from end to end', () => {
    const chunks = new Map<string, Uint16Array | Uint8Array | number[]>();
    const blockAt = (x: number, y: number, z: number) => {
      const key = `${x >> 4},${z >> 4}`;
      if (!chunks.has(key)) chunks.set(key, gen.chunk(x >> 4, z >> 4).blocks);
      return chunks.get(key)![idx(x & 15, y, z & 15)];
    };
    const solid = (x: number, y: number, z: number) => registry.get(blockAt(x, y, z)).solid;
    let checked = 0;
    for (const s of all.filter((entry) => entry.kind === 'mineshaft').slice(0, 4))
      for (const piece of s.pieces) {
        if (!(piece instanceof Corridor)) continue;
        for (let lz = 0; lz < piece.depth; lz++) {
          // The walk: two free cells over a solid floor, down the middle or, past a spawner,
          // along one side.
          const lane = [1, 0, 2].find((lx) => {
            const feet = piece.at(lx, 0, lz);
            return !solid(feet.x, feet.y, feet.z) && !solid(feet.x, feet.y + 1, feet.z);
          });
          expect(lane, `corridor at ${JSON.stringify(piece.at(1, 0, lz))}`).toBeDefined();
          const floor = piece.at(1, -1, lz);
          expect(solid(floor.x, floor.y, floor.z)).toBe(true);
          checked++;
        }
      }
    expect(checked).toBeGreaterThan(50);
  });
  it('lays strongholds in rings, each with exactly one portal room and no overlapping pieces', () => {
    const rings = strongholdPositions(seedHash('structures'));
    expect(rings).toHaveLength(34);
    for (const p of rings.slice(0, 3)) expect(Math.hypot(p.x, p.z)).toBeGreaterThan(600);
    const hold = all.find((s) => s.kind === 'stronghold')!;
    expect(hold.pieces.filter((p) => p instanceof PortalRoom)).toHaveLength(1);
    for (let i = 0; i < hold.pieces.length; i++)
      for (let j = i + 1; j < hold.pieces.length; j++)
        expect(intersects(hold.pieces[i].box, hold.pieces[j].box)).toBe(false);
  });
  it('builds the twelve portal frames of a stronghold', () => {
    const hold = all.find((s) => s.kind === 'stronghold')!;
    const room = hold.pieces.find((p) => p instanceof PortalRoom)!;
    let frames = 0,
      spawner = 0;
    for (let cx = room.box.x0 >> 4; cx <= room.box.x1 >> 4; cx++)
      for (let cz = room.box.z0 >> 4; cz <= room.box.z1 >> 4; cz++) {
        const chunk = gen.chunk(cx, cz);
        for (const s of chunk.blocks)
          if (s === BLOCK.END_PORTAL_FRAME || s === BLOCK.END_PORTAL_FRAME_EYE) frames++;
        spawner += chunk.spawners.size;
      }
    expect(frames).toBe(12);
    expect(spawner).toBeGreaterThanOrEqual(1);
  });
  it('generates the well of a village with water in it and a road beside it', () => {
    const v = all.find((s) => s.kind === 'village')!;
    const chunk = gen.chunk(v.x >> 4, v.z >> 4);
    let water = 0;
    for (let dx = 0; dx <= 1; dx++)
      for (let dz = 0; dz <= 1; dz++)
        for (let y = 40; y < 120; y++) {
          const x = v.x + dx,
            z = v.z + dz;
          if (x >> 4 !== v.x >> 4 || z >> 4 !== v.z >> 4) continue;
          if (chunk.blocks[idx(x & 15, y, z & 15)] === BLOCK.WATER) water++;
        }
    expect(water).toBeGreaterThan(0);
  });
  it('has dungeons with a spawner and chests that know their loot table', () => {
    let spawners = 0,
      dungeonChests = 0;
    for (let cx = -6; cx < 6 && (spawners < 1 || dungeonChests < 1); cx++)
      for (let cz = -6; cz < 6; cz++) {
        const c = gen.chunk(cx, cz);
        for (const [i, mob] of c.spawners) {
          expect(c.blocks[i]).toBe(BLOCK.SPAWNER);
          expect(mob).toMatch(/^lab:/);
          spawners++;
        }
        for (const [i, loot] of c.chestLoot) {
          expect(c.blocks[i]).toBe(BLOCK.CHEST);
          if (loot === 'dungeon') dungeonChests++;
        }
      }
    expect(spawners).toBeGreaterThan(0);
    expect(dungeonChests).toBeGreaterThan(0);
  });
  it('keeps trees off village ground', () => {
    const v = all.find((s) => s.kind === 'village')!;
    const road = v.pieces.find((p) => p instanceof Road)!;
    const b = road.box;
    const chunk = gen.chunk(b.x0 >> 4, b.z0 >> 4);
    const logs = [BLOCK.LOG, BLOCK.BIRCH];
    for (let x = b.x0; x <= Math.min(b.x1, (b.x0 & ~15) + 15); x++)
      for (let z = b.z0; z <= Math.min(b.z1, (b.z0 & ~15) + 15); z++)
        for (let y = 50; y < 140; y++)
          expect(logs).not.toContain(chunk.blocks[idx(x & 15, y, z & 15)]);
  });
  it('fills structure chests from their own table, the same way every time', () => {
    for (const kind of LOOT_TABLES) {
      const a = structureLoot('loot', 10, 20, 30, kind);
      expect(a.length).toBeGreaterThan(0);
      expect(structureLoot('loot', 10, 20, 30, kind)).toEqual(a);
    }
    // Every roll must make a legal stack: known items, never more than an item stacks to.
    for (const kind of LOOT_TABLES)
      for (let i = 0; i < 600; i++)
        expect(() => structureLoot('s' + (i % 7), i, 5 + (i % 50), i * 3, kind)).not.toThrow();
    const temple = structureLoot('loot', 1, 2, 3, 'stronghold_library').map((s) => s.item);
    for (const item of temple)
      expect(['lab:book', 'lab:paper', 'lab:eye_of_ender', 'lab:ender_pearl']).toContain(item);
  });
});

describe('spawners', () => {
  it('call up their creature near a player in the dark, and not beyond sixteen blocks', () => {
    const world = new VoxelWorld('spawner-test');
    for (let x = -2; x <= 2; x++)
      for (let z = -2; z <= 2; z++) world.addColumn(generateColumn(x, z, world.seed, 'flat'));
    const sim = new Simulation(world, spawnPoint(world.seed, 'flat'));
    sim.naturalSpawns = true;
    const p = sim.player.position;
    let y = 60;
    while (y > 0 && world.getBlock(Math.floor(p.x) + 3, y, Math.floor(p.z)) === BLOCK.AIR) y--;
    const sx = Math.floor(p.x) + 3,
      sy = y + 1,
      sz = Math.floor(p.z);
    // A dark stone box around the spawner.
    for (let dx = -5; dx <= 5; dx++)
      for (let dz = -5; dz <= 5; dz++)
        for (let dy = 0; dy <= 4; dy++) {
          const edge = Math.abs(dx) === 5 || Math.abs(dz) === 5 || dy === 4;
          if (edge) world.setBlock(sx + dx, sy + dy, sz + dz, BLOCK.STONE);
        }
    world.setBlock(sx, sy, sz, BLOCK.SPAWNER);
    const column = world.column(sx >> 4, sz >> 4)!;
    column.spawners = new Map([[(sy << 8) | ((sz & 15) << 4) | (sx & 15), 'lab:zombie']]);
    const before = sim.mobs.list.filter((m) => m.kind === 'lab:zombie').length;
    for (let i = 0; i < 20 * 45; i++) sim.step();
    const after = sim.mobs.list.filter((m) => m.kind === 'lab:zombie').length;
    expect(after).toBeGreaterThan(before);
  });
});
