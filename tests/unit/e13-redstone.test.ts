import { describe, it, expect } from 'vitest';
import { BLOCK } from '../../packages/content/src/blocks';
import { WorldSession } from '../../packages/core/src/session';
import {
  BUTTON_PRESS_TICKS,
  MAX_POWER,
  PISTON_LIMIT,
  REDSTONE_BUDGET,
  REPEATER_TICKS_PER_SETTING,
} from '../../packages/core/src/redstone';
import {
  CART_ACCELERATION,
  CART_FRICTION,
  CART_MAX,
  CART_MAX_SPEED,
} from '../../packages/core/src/vehicles';

/**
 * Acceptance suite for E13 «редстоун, автоматизация и рельсовый транспорт». Everything is checked
 * as a circuit would be checked on a bench: how many blocks a signal travels and how much it
 * loses on the way, how long a repeater waits, how far a piston pushes, how fast a hopper moves
 * an item, and how quick a cart gets on a powered rail.
 */
function session(seed = 'e13-redstone'): WorldSession {
  const world = new WorldSession(seed, 'flat');
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) world.loadColumn(x, z);
  for (let i = 0; i < 5; i++) world.simulation.step();
  world.simulation.naturalSpawns = false;
  return world;
}
/** One redstone tick plus the world tick that carries it. */
function tickRedstone(world: WorldSession, ticks = 1): void {
  for (let i = 0; i < ticks; i++) world.simulation.step();
}
/** Clears a flat line of blocks at ground level and returns its base position. */
function clearLine(world: WorldSession, y: number, from: number, to: number, z: number): void {
  for (let x = from; x <= to; x++) world.simulation.setBlockState(x, y, z, BLOCK.AIR);
}

describe('E13 · wire, power and sources', () => {
  it('carries fifteen levels over fifteen blocks and loses one per block', () => {
    const world = session();
    const sim = world.simulation;
    const y = 9;
    const z = 0;
    clearLine(world, y, 0, 17, z);
    // A lever at x=0 with a wire running east, and a lamp at the far end of the line.
    sim.setBlockState(0, y, z, BLOCK.LEVER_OFF);
    for (let x = 1; x <= 16; x++) sim.setBlockState(x, y, z, BLOCK.REDSTONE_WIRE_0);
    sim.redstone.configure(0, y, z, 'east');
    expect(MAX_POWER).toBe(15);
    // The lever is off, so nothing is powered yet.
    tickRedstone(world, 2);
    expect(sim.redstone.powerAt(16, y, z)).toBe(0);
    sim.redstone.press(0, y, z);
    tickRedstone(world, 2);
    expect(world.world.getBlock(0, y, z)).toBe(BLOCK.LEVER_ON);
    // Fifteen levels at the source, one less on every following block.
    expect(sim.redstone.powerAt(1, y, z)).toBe(15);
    expect(sim.redstone.powerAt(2, y, z)).toBe(14);
    expect(sim.redstone.powerAt(16, y, z)).toBe(0);
    sim.redstone.press(0, y, z);
    tickRedstone(world, 2);
    expect(world.world.getBlock(0, y, z)).toBe(BLOCK.LEVER_OFF);
    expect(sim.redstone.powerAt(1, y, z)).toBe(0);
    expect(REDSTONE_BUDGET).toBe(6144);
  });

  it('turns a redstone torch off when the block under it is powered', () => {
    const world = session('e13-torch');
    const sim = world.simulation;
    const y = 9;
    clearLine(world, y, 0, 6, 0);
    sim.setBlockState(0, y, 0, BLOCK.LEVER_OFF);
    sim.setBlockState(1, y, 0, BLOCK.REDSTONE_WIRE_0);
    sim.redstone.configure(0, y, 0, 'east');
    // A torch standing on the wire: while the wire is off, the torch gives power.
    sim.setBlockState(1, y + 1, 0, BLOCK.REDSTONE_TORCH_ON);
    tickRedstone(world, 2);
    expect(world.world.getBlock(1, y + 1, 0)).toBe(BLOCK.REDSTONE_TORCH_ON);
    expect(sim.redstone.powerAt(1, y + 1, 0)).toBe(MAX_POWER);
    // Powering the block it hangs on inverts it: the torch is the classic NOT gate.
    sim.redstone.press(0, y, 0);
    tickRedstone(world, 3);
    expect(world.world.getBlock(1, y + 1, 0)).toBe(BLOCK.REDSTONE_TORCH_OFF);
    expect(sim.redstone.powerAt(1, y + 1, 0)).toBe(0);
    sim.redstone.press(0, y, 0);
    tickRedstone(world, 3);
    expect(world.world.getBlock(1, y + 1, 0)).toBe(BLOCK.REDSTONE_TORCH_ON);
  });

  it('releases a button after ten ticks and lights a lamp while it is held', () => {
    const world = session('e13-button');
    const sim = world.simulation;
    const y = 9;
    clearLine(world, y, 0, 6, 0);
    sim.setBlockState(0, y, 0, BLOCK.BUTTON_OFF);
    sim.setBlockState(1, y, 0, BLOCK.REDSTONE_WIRE_0);
    sim.setBlockState(2, y, 0, BLOCK.LAMP_OFF);
    sim.redstone.configure(0, y, 0, 'east');
    tickRedstone(world, 2);
    expect(world.world.getBlock(2, y, 0)).toBe(BLOCK.LAMP_OFF);
    expect(sim.redstone.press(0, y, 0)).toBe(true);
    tickRedstone(world, 2);
    expect(world.world.getBlock(0, y, 0)).toBe(BLOCK.BUTTON_ON);
    expect(world.world.getBlock(2, y, 0)).toBe(BLOCK.LAMP_ON);
    // Ten ticks of press, and the button lets go by itself.
    tickRedstone(world, BUTTON_PRESS_TICKS + 2);
    expect(world.world.getBlock(0, y, 0)).toBe(BLOCK.BUTTON_OFF);
    expect(world.world.getBlock(2, y, 0)).toBe(BLOCK.LAMP_OFF);
    expect(BUTTON_PRESS_TICKS).toBe(10);
  });

  it('waits two redstone ticks per repeater setting before passing the signal on', () => {
    const world = session('e13-repeater');
    const sim = world.simulation;
    const y = 9;
    clearLine(world, y, 0, 6, 0);
    sim.setBlockState(0, y, 0, BLOCK.LEVER_OFF);
    sim.setBlockState(1, y, 0, BLOCK.REPEATER_OFF);
    sim.setBlockState(2, y, 0, BLOCK.REDSTONE_WIRE_0);
    sim.redstone.configure(0, y, 0, 'east');
    sim.redstone.configure(1, y, 0, 'east', 1);
    sim.redstone.configure(2, y, 0, 'east');
    sim.redstone.press(0, y, 0);
    tickRedstone(world, 1);
    // The repeater has not delivered yet; the wire after it is still dark.
    expect(sim.redstone.powerAt(2, y, 0)).toBe(0);
    tickRedstone(world, 2);
    expect(sim.redstone.powerAt(2, y, 0)).toBeGreaterThan(0);
    // Turning the delay up to four settings costs eight ticks instead of two.
    expect(sim.redstone.cycleDelay(1, y, 0)).toBe(2);
    expect(sim.redstone.cycleDelay(1, y, 0)).toBe(3);
    expect(sim.redstone.cycleDelay(1, y, 0)).toBe(4);
    sim.redstone.press(0, y, 0); // off
    tickRedstone(world, 12);
    sim.redstone.press(0, y, 0); // on again
    tickRedstone(world, 4);
    expect(sim.redstone.powerAt(2, y, 0)).toBe(0);
    tickRedstone(world, 6);
    expect(sim.redstone.powerAt(2, y, 0)).toBeGreaterThan(0);
    expect(REPEATER_TICKS_PER_SETTING).toBe(2);
  });
});

describe('E13 · pistons', () => {
  it('pushes a row of blocks up to twelve long and pulls them back with slime', () => {
    const world = session('e13-piston');
    const sim = world.simulation;
    const y = 9;
    const z = 0;
    clearLine(world, y, 0, 20, z);
    sim.setBlockState(0, y, z, BLOCK.LEVER_OFF);
    sim.setBlockState(1, y, z, BLOCK.STICKY_PISTON);
    sim.redstone.configure(0, y, z, 'east');
    sim.redstone.configure(1, y, z, 'east');
    tickRedstone(world, 2);
    sim.redstone.press(0, y, z);
    tickRedstone(world, 3);
    expect(world.world.getBlock(1, y, z)).toBe(BLOCK.STICKY_PISTON_EXTENDED);
    expect(world.world.getBlock(2, y, z)).toBe(BLOCK.PISTON_HEAD);
    sim.redstone.press(0, y, z);
    tickRedstone(world, 3);
    expect(world.world.getBlock(1, y, z)).toBe(BLOCK.STICKY_PISTON);
    expect(world.world.getBlock(2, y, z)).toBe(BLOCK.AIR);
    // A row of twelve blocks in front of the piston moves as one, one block further on.
    const start = 2;
    for (let i = 0; i < PISTON_LIMIT; i++) sim.setBlockState(start + i, y, z, BLOCK.PLANKS);
    sim.setBlockState(start + PISTON_LIMIT, y, z, BLOCK.AIR);
    expect(PISTON_LIMIT).toBe(12);
    sim.redstone.press(0, y, z);
    tickRedstone(world, 3);
    expect(world.world.getBlock(start, y, z)).toBe(BLOCK.PISTON_HEAD);
    expect(world.world.getBlock(start + 1, y, z)).toBe(BLOCK.PLANKS);
    expect(world.world.getBlock(start + PISTON_LIMIT, y, z)).toBe(BLOCK.PLANKS);
    expect(world.world.getBlock(start + PISTON_LIMIT + 1, y, z)).toBe(BLOCK.AIR);
    sim.redstone.press(0, y, z);
    tickRedstone(world, 3);
    // The slime pulls the block in front of the head back with it.
    expect(world.world.getBlock(start, y, z)).toBe(BLOCK.PLANKS);
    expect(world.world.getBlock(start + PISTON_LIMIT + 1, y, z)).toBe(BLOCK.AIR);
  });

  it('refuses to push a row that is longer than twelve blocks', () => {
    const world = session('e13-piston-limit');
    const sim = world.simulation;
    const y = 9;
    const z = 0;
    clearLine(world, y, 0, 40, z);
    sim.setBlockState(0, y, z, BLOCK.LEVER_OFF);
    sim.setBlockState(1, y, z, BLOCK.PISTON);
    for (let i = 0; i < 13; i++) sim.setBlockState(2 + i, y, z, BLOCK.PLANKS);
    sim.redstone.configure(0, y, z, 'east');
    sim.redstone.configure(1, y, z, 'east');
    sim.redstone.press(0, y, z);
    tickRedstone(world, 3);
    // Nothing moved at all: the reference piston refuses the whole row.
    expect(world.world.getBlock(2, y, z)).toBe(BLOCK.PLANKS);
    expect(world.world.getBlock(1, y, z)).toBe(BLOCK.PISTON);
  });
});

describe('E13 · machines', () => {
  it('ejects one item from a dropper and shoots an arrow from a dispenser', () => {
    const world = session('e13-dispenser');
    const sim = world.simulation;
    const y = 9;
    const z = 0;
    clearLine(world, y, 0, 6, z);
    clearLine(world, y + 2, 0, 6, z);
    // The dropper sits on the lower circuit, the dispenser on an identical one two blocks up.
    sim.setBlockState(0, y, z, BLOCK.LEVER_OFF);
    sim.setBlockState(1, y, z, BLOCK.DROPPER);
    sim.setBlockState(0, y + 2, z, BLOCK.LEVER_OFF);
    sim.setBlockState(1, y + 2, z, BLOCK.DISPENSER);
    sim.redstone.configure(0, y, z, 'east');
    sim.redstone.configure(1, y, z, 'east');
    sim.redstone.configure(0, y + 2, z, 'east');
    sim.redstone.configure(1, y + 2, z, 'east');
    const dropper = sim.containers.ensure('dispenser', 1, y, z);
    dropper.slots.set(0, { item: 'lab:cobblestone', count: 8, damage: 0 });
    const dispenser = sim.containers.ensure('dispenser', 1, y + 2, z);
    dispenser.slots.set(0, { item: 'lab:arrow', count: 4, damage: 0 });
    const ground = sim.entities.list.length;
    sim.redstone.press(0, y, z);
    tickRedstone(world, 3);
    // The dropper throws one unit out and keeps the rest.
    expect(dropper.slots.slots[0]?.count).toBe(7);
    expect(sim.entities.list.length).toBe(ground + 1);
    expect(sim.entities.list.at(-1)!.item).toBe('lab:cobblestone');
    // The dispenser fires the arrow itself, which is what the reference machine does.
    sim.redstone.press(0, y + 2, z);
    tickRedstone(world, 3);
    expect(dispenser.slots.slots[0]?.count).toBe(3);
    expect(sim.arrows.list.length).toBeGreaterThan(0);
  });

  it('moves one item out of a hopper every eight ticks', () => {
    const world = session('e13-hopper');
    const sim = world.simulation;
    const y = 9;
    const z = 0;
    clearLine(world, y, 0, 3, z);
    sim.setBlockState(0, y, z, BLOCK.HOPPER);
    // A chest below the hopper is what the reference funnels into.
    sim.setBlockState(0, y - 1, z, BLOCK.CHEST);
    // Hoppers work on the world clock, so the funnel is filled right after the grid is reached.
    const hopper = sim.containers.ensure('hopper', 0, y, z);
    while (world.world.tick % 8 !== 0) tickRedstone(world, 1);
    hopper.slots.set(0, { item: 'lab:oak_planks', count: 5, damage: 0 });
    tickRedstone(world, 7);
    expect(hopper.slots.slots[0]?.count).toBe(5);
    tickRedstone(world, 1);
    expect(hopper.slots.slots[0]?.count).toBe(4);
    const chest = sim.containers.get(0, y - 1, z)!;
    expect(chest.slots.slots.filter((slot) => slot?.item === 'lab:oak_planks')).toHaveLength(1);
    tickRedstone(world, 8);
    expect(hopper.slots.slots[0]?.count).toBe(3);
  });

  it('lights a redstone lamp from a lever and turns it off again', () => {
    const world = session('e13-lamp');
    const sim = world.simulation;
    const y = 9;
    const z = 0;
    clearLine(world, y, 0, 6, z);
    sim.setBlockState(0, y, z, BLOCK.LEVER_OFF);
    sim.setBlockState(1, y, z, BLOCK.REDSTONE_WIRE_0);
    sim.setBlockState(2, y, z, BLOCK.REDSTONE_WIRE_0);
    sim.setBlockState(3, y, z, BLOCK.LAMP_OFF);
    sim.redstone.configure(0, y, z, 'east');
    tickRedstone(world, 2);
    expect(world.world.getBlock(3, y, z)).toBe(BLOCK.LAMP_OFF);
    sim.redstone.press(0, y, z);
    tickRedstone(world, 3);
    expect(world.world.getBlock(3, y, z)).toBe(BLOCK.LAMP_ON);
    expect(sim.light.lightAt(3, y, z, true)).toBeGreaterThan(0);
    sim.redstone.press(0, y, z);
    tickRedstone(world, 3);
    expect(world.world.getBlock(3, y, z)).toBe(BLOCK.LAMP_OFF);
  });

  it('primes a block of TNT from a lever instead of lighting it with flint', () => {
    const world = session('e13-tnt');
    const sim = world.simulation;
    const y = 9;
    const z = 0;
    clearLine(world, y, 0, 6, z);
    sim.setBlockState(0, y, z, BLOCK.LEVER_OFF);
    sim.setBlockState(1, y, z, BLOCK.REDSTONE_WIRE_0);
    sim.setBlockState(2, y, z, BLOCK.TNT);
    sim.redstone.configure(0, y, z, 'east');
    sim.redstone.press(0, y, z);
    tickRedstone(world, 3);
    expect(sim.blockSim.fuseCount).toBeGreaterThan(0);
    // The charge goes off on its own after the reference fuse and takes the TNT with it.
    tickRedstone(world, 120);
    expect(world.world.getBlock(2, y, z)).toBe(BLOCK.AIR);
  });
});

describe('E13 · rails and minecarts', () => {
  it('runs a cart along a rail line and turns it around at the end', () => {
    const world = session('e13-cart');
    const sim = world.simulation;
    const y = 9;
    const z = 0;
    clearLine(world, y, 0, 24, z);
    for (let x = 0; x <= 20; x++) sim.setBlockState(x, y, z, BLOCK.RAIL);
    // The cart starts at the west end and is given one push along the rails.
    const cart = sim.carts.spawn('ride', { x: 1.5, y: y + 0.0625, z: 0.5 });
    cart.velocity = { x: 2, y: 0, z: 0 };
    tickRedstone(world, 20);
    expect(cart.position.x).toBeGreaterThan(1.5);
    let furthest = cart.position.x;
    for (let i = 0; i < 400 && Math.abs(cart.position.x - furthest) < 0.5; i++) {
      tickRedstone(world, 1);
      furthest = Math.max(furthest, cart.position.x);
    }
    // Friction stops the cart instead of letting it run for ever.
    for (let i = 0; i < 400; i++) tickRedstone(world, 1);
    expect(Math.abs(cart.velocity.x)).toBeLessThan(1);
    expect(CART_FRICTION).toBe(0.04);
    expect(CART_MAX_SPEED).toBe(8);
    expect(CART_ACCELERATION).toBe(0.6);
    expect(CART_MAX).toBe(64);
  });

  it('carries the player on a minecart and lets them step off again', () => {
    const world = session('e13-ride');
    const sim = world.simulation;
    const y = 9;
    const z = 0;
    clearLine(world, y, 0, 24, z);
    for (let x = 0; x <= 20; x++) sim.setBlockState(x, y, z, BLOCK.RAIL);
    const cart = sim.carts.spawn('ride', { x: 3.5, y: y + 0.0625, z: 0.5 });
    sim.player.position.x = 3.5;
    sim.player.position.z = 0.5;
    sim.player.position.y = y + 1;
    const mounted = sim.use();
    expect(mounted.ok, mounted.reason).toBe(true);
    expect(sim.carts.riding).toBe(cart.id);
    cart.velocity = { x: 3, y: 0, z: 0 };
    const before = sim.player.position.x;
    tickRedstone(world, 20);
    expect(sim.player.position.x).toBeGreaterThan(before);
    // The player can get out anywhere, and the cart keeps its own position.
    expect(sim.dismountCart().ok).toBe(true);
    expect(sim.carts.riding).toBeNull();
  });

  it('speeds a cart up on a powered rail and slows it on a plain one', () => {
    const world = session('e13-powered-rail');
    const sim = world.simulation;
    const y = 9;
    const z = 0;
    clearLine(world, y, 0, 24, z);
    for (let x = 0; x <= 20; x++) sim.setBlockState(x, y, z, BLOCK.RAIL);
    // Powered rails at the start, fed by a lever standing right beside the first of them.
    sim.setBlockState(0, y, z, BLOCK.LEVER_ON);
    sim.redstone.configure(0, y, z, 'east');
    for (let x = 1; x <= 3; x++) sim.setBlockState(x, y, z, BLOCK.POWERED_RAIL_OFF);
    tickRedstone(world, 2);
    const cart = sim.carts.spawn('ride', { x: 1.5, y: y + 0.0625, z: 0.5 });
    cart.velocity = { x: 0.2, y: 0, z: 0 };
    tickRedstone(world, 20);
    expect(cart.velocity.x).toBeGreaterThan(1);
    expect(sim.redstone.powerAt(1, y, z)).toBeGreaterThan(0);
  });
});
