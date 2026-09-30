import { describe, expect, it } from 'vitest';
import { WorldSession } from '../../packages/core/src/session';
import { BLOCK, registry } from '../../packages/content/src/blocks';
import {
  END_FRAME_RING,
  buildEndPlatform,
  buildNetherPortal,
  endPortalComplete,
  findPortalNear,
  fitEye,
  lightPortalNear,
  openEndPortal,
  readPortalFrame,
} from '../../packages/core/src/portals';
import { structuresNear } from '../../packages/core/src/structures';
import { seedHash } from '../../packages/core/src/random';
import { endPillarTops } from '../../packages/core/src/end';
import { generateNetherColumn } from '../../packages/core/src/nether';
import { generateEndColumn } from '../../packages/core/src/end';
import { scalePosition } from '../../packages/core/src/dimensions';

const SURFACE = 8;

function flatSession(seed = 'e15-unit') {
  const session = new WorldSession(seed, 'flat');
  session.simulation.naturalSpawns = false;
  session.ensureAround('overworld', 40, 40, 3);
  return session;
}

describe('nether portals', () => {
  it('lights a frame of obsidian and finds it again', () => {
    const session = flatSession();
    const world = session.world;
    const frame = buildNetherPortal(world, 40, SURFACE + 1, 40, 0);
    expect(readPortalFrame(world, frame.x, frame.y + 1, frame.z)).toMatchObject({
      x: frame.x,
      y: frame.y,
      width: 2,
      height: 3,
    });
    // Every block of the opening is a portal, and the frame around it is obsidian.
    expect(world.getBlock(frame.x, frame.y, frame.z)).toBe(BLOCK.NETHER_PORTAL);
    expect(world.getBlock(frame.x, frame.y - 1, frame.z)).toBe(BLOCK.OBSIDIAN);
    expect(findPortalNear(world, frame.x, frame.y, frame.z, 8)).toEqual({
      x: frame.x,
      y: frame.y,
      z: frame.z,
    });
  });

  it('lights a hand-built frame from the block the flint touched', () => {
    const session = flatSession();
    const world = session.world;
    // An opening two wide and three high, with obsidian on every side of it.
    for (let oy = -1; oy <= 3; oy++)
      for (let ox = -1; ox <= 2; ox++) {
        const opening = ox >= 0 && ox <= 1 && oy >= 0 && oy <= 2;
        world.setBlock(50 + ox, SURFACE + oy, 50, opening ? BLOCK.AIR : BLOCK.OBSIDIAN);
      }
    // Flint and steel is used on the bottom obsidian: the opening sits above the touched block.
    expect(lightPortalNear(world, 50, SURFACE, 50)).toBeDefined();
    let lit = 0;
    for (let oy = 0; oy < 3; oy++)
      for (let ox = -1; ox <= 2; ox++)
        if (world.getBlock(50 + ox, SURFACE + oy, 50) === BLOCK.NETHER_PORTAL) lit++;
    expect(lit).toBe(6);
  });

  it('carries the player to the Nether and back to the same portal', () => {
    const session = flatSession();
    const frame = buildNetherPortal(session.world, 40, SURFACE + 1, 40, 0);
    session.simulation.player.position = { x: frame.x + 0.5, y: frame.y, z: frame.z + 0.5 };
    for (let tick = 0; tick < 82; tick++) session.simulation.step();
    expect(session.simulation.pendingTravel).toBe('nether');
    const trip = session.travel()!;
    expect(trip.to).toBe('nether');
    expect(session.dimension).toBe('nether');
    // One block in the Nether is eight in the Overworld.
    const scaled = scalePosition('overworld', 'nether', { x: 40, y: 0, z: 40 });
    expect(Math.abs(trip.position.x - scaled.x)).toBeLessThanOrEqual(2);
    expect(registry.get(session.world.getBlock(40, SURFACE, 40)).key).not.toBe('lab:grass');
    const back = session.travelTo('overworld');
    expect(back.to).toBe('overworld');
    expect(back.built).toBe(false);
    expect(
      Math.hypot(back.position.x - (frame.x + 0.5), back.position.z - (frame.z + 0.5)),
    ).toBeLessThan(16);
  });

  it('keeps every dimension its own creatures, chests and blocks', () => {
    const session = flatSession();
    const marker = { x: 42, y: 12, z: 42 };
    session.world.setBlock(marker.x, marker.y, marker.z, BLOCK.GOLD_BLOCK);
    session.simulation.mobs.spawn('lab:cow', { x: 42.5, y: 10, z: 42.5 });
    expect(session.simulation.mobs.list).toHaveLength(1);
    session.travelTo('nether');
    expect(session.simulation.mobs.list).toHaveLength(0);
    expect(session.world.getBlock(marker.x, marker.y, marker.z)).not.toBe(BLOCK.GOLD_BLOCK);
    session.travelTo('overworld');
    expect(session.simulation.mobs.list).toHaveLength(1);
    expect(session.world.getBlock(marker.x, marker.y, marker.z)).toBe(BLOCK.GOLD_BLOCK);
  });
});

describe('the End portal', () => {
  it('opens when the twelfth eye is fitted', () => {
    const session = flatSession();
    const world = session.world;
    const centre = { x: 46, y: 20, z: 46 };
    session.ensureAround('overworld', centre.x, centre.z, 1);
    for (const [dx, dz] of END_FRAME_RING)
      world.setBlock(centre.x + dx, centre.y, centre.z + dz, BLOCK.END_PORTAL_FRAME);
    let fitted = 0;
    for (const [dx, dz] of END_FRAME_RING) {
      const last = fitted === END_FRAME_RING.length - 1;
      expect(fitEye(world, centre.x + dx, centre.y, centre.z + dz)).toBe(true);
      fitted++;
      if (last) expect(endPortalComplete(world, centre.x, centre.y, centre.z)).toBe(true);
      else expect(endPortalComplete(world, centre.x, centre.y, centre.z)).toBe(false);
    }
    expect(openEndPortal(world, centre.x, centre.y, centre.z)).toBe(9);
    expect(world.getBlock(centre.x, centre.y, centre.z)).toBe(BLOCK.END_PORTAL);
  });

  it('takes an eye of ender from the hand through the item use path', () => {
    const session = flatSession();
    const simulation = session.simulation;
    const world = session.world;
    const centre = { x: 46, y: 24, z: 46 };
    for (const [dx, dz] of END_FRAME_RING) {
      world.setBlock(centre.x + dx, centre.y, centre.z + dz, BLOCK.END_PORTAL_FRAME);
      for (let oy = 1; oy <= 3; oy++)
        world.setBlock(centre.x + dx, centre.y + oy, centre.z + dz, BLOCK.AIR);
    }
    simulation.grant('lab:eye_of_ender', 12);
    const slots = (simulation.inventory as unknown as { slots: ({ item?: string } | null)[] })
      .slots;
    simulation.inventory.selected = slots.findIndex((slot) => slot?.item === 'lab:eye_of_ender');
    let opened = 0;
    let placed = 0;
    for (const [dx, dz] of END_FRAME_RING) {
      simulation.player.position = {
        x: centre.x + dx + 0.5,
        y: centre.y + 2,
        z: centre.z + dz + 0.5,
      };
      simulation.input.yaw = 0;
      simulation.input.pitch = -1.5;
      const result = simulation.use();
      if (!result.ok) continue;
      placed++;
      if (result.message?.includes('открыт')) opened++;
    }
    expect(placed).toBe(12);
    expect(opened).toBe(1);
    expect(world.getBlock(centre.x, centre.y, centre.z)).toBe(BLOCK.END_PORTAL);
  });

  it('arrives on a platform and starts the dragon fight', () => {
    const session = flatSession();
    const trip = session.travelTo('end');
    expect(trip.to).toBe('end');
    expect(session.dimension).toBe('end');
    expect(session.simulation.bosses.dragon?.health).toBe(200);
    expect(session.simulation.bosses.crystals).toHaveLength(10);
    // The platform the traveller stands on is obsidian, and the island below is end stone.
    const under = session.world.getBlock(
      Math.floor(trip.position.x),
      Math.floor(trip.position.y) - 1,
      Math.floor(trip.position.z),
    );
    expect(under).toBe(BLOCK.OBSIDIAN);
    const pillars = endPillarTops();
    expect(pillars).toHaveLength(10);
    for (const pillar of pillars)
      expect(session.world.getBlock(pillar.x, pillar.y - 1, pillar.z)).toBe(BLOCK.OBSIDIAN);
  });
});

describe('the stronghold', () => {
  it('hides a portal room with eyes already in some frames', () => {
    const seed = seedHash('e15-stronghold');
    let found: { x: number; z: number; y: number } | undefined;
    for (let cx = -40; cx <= 40 && !found; cx += 4)
      for (let cz = -40; cz <= 40 && !found; cz += 4)
        for (const plan of structuresNear(
          cx * 16,
          cz * 16,
          cx * 16 + 15,
          cz * 16 + 15,
          seed,
          'overworld',
        ))
          if (plan.kind === 'stronghold') {
            found = { x: plan.x, z: plan.z, y: plan.y };
            break;
          }
    expect(found).toBeDefined();
    // Legacy strongholds belong to generator v3-v4; a v5 world gets its own in the structure pass.
    const fresh = new WorldSession('e15-stronghold', 'overworld').checkpoint();
    const session = new WorldSession('e15-stronghold', 'overworld', {
      ...fresh,
      generator: { ...fresh.generator, version: 4 },
    });
    session.ensureAround('overworld', found!.x, found!.z, 2);
    const world = session.world;
    let frames = 0,
      eyes = 0,
      portal = 0;
    for (const [dx, dz] of END_FRAME_RING) {
      const state = world.getBlock(found!.x + dx, found!.y, found!.z + dz);
      if (state === BLOCK.END_PORTAL_FRAME) frames++;
      if (state === BLOCK.END_PORTAL_FRAME_EYE) eyes++;
    }
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        if (world.getBlock(found!.x + dx, found!.y, found!.z + dz) === BLOCK.END_PORTAL) portal++;
    expect(frames + eyes).toBe(12);
    expect(eyes).toBeGreaterThanOrEqual(2);
    expect(eyes).toBeLessThanOrEqual(4);
    expect(portal).toBe(0);
    // The hall around the ring is hollow and lit, with the altar chest in a corner.
    expect(world.getBlock(found!.x + 2, found!.y + 1, found!.z + 2)).toBe(BLOCK.AIR);
    expect(world.getBlock(found!.x + 4, found!.y + 1, found!.z)).toBe(BLOCK.STONE_BRICKS);
    expect(world.getBlock(found!.x + 3, found!.y, found!.z + 3)).toBe(BLOCK.CHEST);
    expect(world.getBlock(found!.x + 3, found!.y + 3, found!.z + 3)).toBe(BLOCK.TORCH);
  });
});

describe('the bosses', () => {
  it('wakes the wither from a T of soul sand and three skulls', () => {
    const session = flatSession();
    const simulation = session.simulation;
    const world = session.world;
    const cx = 40,
      cz = 40;
    simulation.setBlockState(cx - 1, SURFACE + 1, cz, BLOCK.SOUL_SAND);
    simulation.setBlockState(cx, SURFACE, cz, BLOCK.SOUL_SAND);
    simulation.setBlockState(cx + 1, SURFACE + 1, cz, BLOCK.SOUL_SAND);
    simulation.setBlockState(cx, SURFACE + 1, cz, BLOCK.SOUL_SAND);
    expect(simulation.bosses.wither).toBeUndefined();
    simulation.setBlockState(cx - 1, SURFACE + 2, cz, BLOCK.WITHER_SKELETON_SKULL);
    simulation.setBlockState(cx, SURFACE + 2, cz, BLOCK.WITHER_SKELETON_SKULL);
    expect(simulation.bosses.wither).toBeUndefined();
    simulation.setBlockState(cx + 1, SURFACE + 2, cz, BLOCK.WITHER_SKELETON_SKULL);
    expect(simulation.bosses.wither?.health).toBe(300);
    expect(world.getBlock(cx + 1, SURFACE + 2, cz)).toBe(BLOCK.AIR);
  });

  it('heals the dragon from its crystals and leaves the egg and the exit portal', () => {
    const session = flatSession();
    const simulation = session.simulation;
    session.travelTo('end');
    session.ensureAround('end', 0, 0, 6);
    const dragon = simulation.bosses.dragon!;
    const crystals = simulation.bosses.crystals.length;
    simulation.bosses.hurt(dragon, 60);
    const wounded = dragon.health;
    for (let tick = 0; tick < 40; tick++) simulation.step();
    expect(dragon.health).toBeGreaterThan(wounded);
    expect(simulation.bosses.crystals).toHaveLength(crystals);
    const death = simulation.hurtBoss(dragon, 999)!;
    expect(death.kind).toBe('ender_dragon');
    expect(simulation.bosses.dragon).toBeUndefined();
    expect(session.world.getBlock(0, 65, 0)).toBe(BLOCK.DRAGON_EGG);
    expect(session.world.getBlock(0, 64, 0)).toBe(BLOCK.END_PORTAL);
    expect(simulation.orbs.list.length).toBeGreaterThan(0);
  });

  it('carries the traveller home through the exit portal', () => {
    const session = flatSession();
    session.travelTo('end');
    session.ensureAround('end', 0, 0, 6);
    session.simulation.setBlockState(0, 64, 0, BLOCK.END_PORTAL);
    session.simulation.player.position = { x: 0.5, y: 64, z: 0.5 };
    session.simulation.step();
    expect(session.simulation.pendingTravel).toBe('overworld');
    const back = session.travel()!;
    expect(back.to).toBe('overworld');
    expect(session.dimension).toBe('overworld');
  });
});

describe('the generators and the save file', () => {
  it('gives the Nether and the End their own blocks', () => {
    const nether = generateNetherColumn(0, 0, 'e15-unit');
    let netherrack = 0,
      lava = 0;
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 16; x++)
        for (let z = 0; z < 16; z++) {
          const state = nether.column.get(x, y, z);
          if (state === BLOCK.NETHERRACK) netherrack++;
          if (state === BLOCK.LAVA) lava++;
        }
    expect(netherrack).toBeGreaterThan(5_000);
    expect(lava).toBeGreaterThan(0);
    const end = generateEndColumn(0, 0, 'e15-unit');
    let endStone = 0;
    for (let y = 50; y < 80; y++)
      for (let x = 0; x < 16; x++)
        for (let z = 0; z < 16; z++) if (end.get(x, y, z) === BLOCK.END_STONE) endStone++;
    expect(endStone).toBeGreaterThan(1_000);
    expect(buildEndPlatform).toBeTypeOf('function');
  });

  it('saves both dimensions, their edits and the fight in the End', () => {
    const session = flatSession('e15-save');
    session.travelTo('nether');
    session.world.setBlock(0, 40, 0, BLOCK.GLOWSTONE);
    session.simulation.bosses.spawnBoss('wither', { x: 0.5, y: 40, z: 0.5 });
    const checkpoint = session.checkpoint();
    expect(checkpoint.dimension).toBe('nether');
    expect(checkpoint.overrides.some((entry) => entry[4] === 'nether')).toBe(true);
    const restored = new WorldSession('e15-save', 'flat', checkpoint);
    expect(restored.dimension).toBe('nether');
    restored.ensureAround('nether', 0, 0, 1);
    expect(restored.world.getBlock(0, 40, 0)).toBe(BLOCK.GLOWSTONE);
    expect(restored.simulation.bosses.wither?.health).toBe(300);
  });
});
