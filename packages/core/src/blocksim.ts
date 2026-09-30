/**
 * Falling blocks, fire and explosions.
 *
 * Sand, gravel and the like turn into entities in the reference game; for a browser build with
 * one tick budget they move as a scheduled block change instead, which keeps the visual result
 * and stays testable. Fire spreads, burns out and consumes flammable neighbours. Explosions
 * remove blocks with a distance-based resistance rule and push entities away.
 */
import { BLOCK, registry } from '../../content/src/blocks';
import type { VoxelWorld } from './world';

export interface SavedFalling {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Ticks left before the block lands; the block is already in the world. */
  readonly delay: number;
}
export interface SavedFire {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly age: number;
}
/** Blocks removed by an explosion, kept so a save can rebuild the crater. */
export interface SavedCrater {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly state: number;
}

export const FALLING_START_DELAY = 2;
/** Fire burns out after this many ticks when nothing keeps it alive. */
export const FIRE_LIFETIME = 300;
/** Chance per tick, in percent, that fire spreads to a neighbouring flammable block. */
export const FIRE_SPREAD_CHANCE = 12;
/** Explosion radius in blocks for a single TNT charge. */
export const TNT_RADIUS = 4;
/** Ticks between the fuse being lit and the blast. */
export const TNT_FUSE = 80;
/** Most water cells a sponge drinks, and how many steps through water it reaches. */
const SPONGE_LIMIT = 65;
const SPONGE_REACH = 7;
const SIX_FACES = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;
/** Flames alive at once; above this the fire stops spreading instead of growing without end. */
export const MAX_FIRE_CELLS = 4096;

export interface ExplosionResult {
  readonly removed: { x: number; y: number; z: number; state: number }[];
  readonly drops: { item: string; count: number; x: number; y: number; z: number }[];
  /** Entities pushed by the blast: the simulation applies the velocity itself. */
  readonly pushed: { x: number; y: number; z: number; dx: number; dy: number; dz: number }[];
}

export class BlockSimulation {
  /** Called after every write, so the host can journal it and wake its neighbours. */
  onWrite?: (x: number, y: number, z: number, before: number, state: number) => void;
  /**
   * Called right after a blast, with everything the blast removed and dropped. The host turns
   * the removed blocks into experience and the drops into item entities.
   */
  onExplosion?: (
    result: ExplosionResult,
    center: { x: number; y: number; z: number },
    radius: number,
  ) => void;
  private readonly falling: {
    x: number;
    y: number;
    z: number;
    delay: number;
  }[] = [];
  private readonly fires = new Map<string, { x: number; y: number; z: number; age: number }>();
  private readonly fuses = new Map<string, { x: number; y: number; z: number; left: number }>();
  /** Blocks destroyed by a blast, remembered so a save can rebuild the crater. */
  readonly craters: SavedCrater[] = [];

  constructor(
    private readonly world: VoxelWorld,
    private readonly random: () => number,
  ) {}

  private write(x: number, y: number, z: number, state: number): boolean {
    const before = this.world.getBlock(x, y, z);
    if (!this.world.setBlock(x, y, z, state)) return false;
    this.onWrite?.(x, y, z, before, state);
    return true;
  }

  static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  /** Blocks that fall: they need a block below and a free space to fall into. */
  markFalling(x: number, y: number, z: number): void {
    const state = this.world.getBlock(x, y, z);
    if (!registry.get(state).falling) return;
    if (!this.supportedBelow(x, y, z)) this.queueFalling(x, y, z, FALLING_START_DELAY);
  }

  private queueFalling(x: number, y: number, z: number, delay: number): void {
    if (this.world.getBlock(x, y, z) === BLOCK.AIR) return;
    if (this.falling.some((entry) => entry.x === x && entry.y === y && entry.z === z)) return;
    this.falling.push({ x, y, z, delay });
  }

  private supportedBelow(x: number, y: number, z: number): boolean {
    if (y <= 0) return true;
    const below = registry.get(this.world.getBlock(x, y - 1, z));
    return below.solid || below.fluid !== undefined;
  }

  /**
   * Concrete powder sets into concrete as soon as water touches any of its six faces. Called for
   * the cell that changed and for each neighbour, so both a poured bucket and a placed block work.
   */
  private harden(x: number, y: number, z: number): void {
    const to = registry.get(this.world.getBlock(x, y, z)).hardensTo;
    if (to === undefined) return;
    for (const [dx, dy, dz] of SIX_FACES)
      if (registry.get(this.world.getBlock(x + dx, y + dy, z + dz)).fluid === 'water') {
        this.write(x, y, z, to);
        return;
      }
  }

  /**
   * A sponge drinks the water around it: every water cell reachable through water within six
   * steps, at most 65 of them, is removed, and a sponge that drank anything turns wet.
   */
  private absorb(x: number, y: number, z: number): void {
    const wet = registry.get(this.world.getBlock(x, y, z)).absorbs;
    if (wet === undefined) return;
    const seen = new Set<string>([BlockSimulation.key(x, y, z)]);
    const queue: [number, number, number, number][] = [[x, y, z, 0]];
    let drunk = 0;
    for (let head = 0; head < queue.length && drunk < SPONGE_LIMIT; head++) {
      const [cx, cy, cz, steps] = queue[head];
      for (const [dx, dy, dz] of SIX_FACES) {
        const nx = cx + dx,
          ny = cy + dy,
          nz = cz + dz,
          key = BlockSimulation.key(nx, ny, nz);
        if (seen.has(key)) continue;
        seen.add(key);
        if (registry.get(this.world.getBlock(nx, ny, nz)).fluid !== 'water') continue;
        this.write(nx, ny, nz, BLOCK.AIR);
        drunk++;
        if (steps + 1 < SPONGE_REACH) queue.push([nx, ny, nz, steps + 1]);
        if (drunk >= SPONGE_LIMIT) break;
      }
    }
    if (drunk > 0) this.write(x, y, z, wet);
  }

  /** Called after any block change: neighbours may start or stop falling. */
  onBlockChange(x: number, y: number, z: number): void {
    this.harden(x, y, z);
    this.absorb(x, y, z);
    for (const [dx, dy, dz] of SIX_FACES) this.harden(x + dx, y + dy, z + dz);
    for (const [dx, dy, dz] of [
      [0, 1, 0],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
    ] as const)
      this.markFalling(x + dx, y + dy, z + dz);
  }

  fireAt(x: number, y: number, z: number): void {
    const key = BlockSimulation.key(x, y, z);
    const existing = this.fires.get(key);
    if (existing) existing.age = 0;
    else this.fires.set(key, { x, y, z, age: 0 });
  }

  /** Ignites the block at the position when it is flammable, or places fire in air. */
  ignite(x: number, y: number, z: number): boolean {
    const state = this.world.getBlock(x, y, z);
    const def = registry.get(state);
    if (state === BLOCK.AIR) {
      if (!this.canBurnHere(x, y, z)) return false;
      this.write(x, y, z, BLOCK.FIRE);
      this.fireAt(x, y, z);
      return true;
    }
    return this.catchFire(x, y, z, def.flammable !== undefined);
  }

  /**
   * A flammable block catches fire: the flame appears in the air above it when there is room,
   * otherwise the block itself turns into the flame. Explosives are primed instead.
   */
  private catchFire(x: number, y: number, z: number, flammable: boolean): boolean {
    const state = this.world.getBlock(x, y, z);
    const def = registry.get(state);
    if (state === BLOCK.TNT) {
      this.prime(x, y, z);
      return true;
    }
    if (def.flammable === undefined && !flammable) return false;
    const above = this.world.getBlock(x, y + 1, z);
    if (above === BLOCK.AIR && this.canBurnHere(x, y + 1, z)) {
      this.write(x, y + 1, z, BLOCK.FIRE);
      this.fireAt(x, y + 1, z);
      return true;
    }
    this.write(x, y, z, BLOCK.FIRE);
    this.fireAt(x, y, z);
    return true;
  }

  /** Priming TNT through redstone or an explosion; the fuse runs for four seconds. */
  /** Called when a charge is lit, so the fuse can be heard. */
  onPrime?: (x: number, y: number, z: number) => void;
  prime(x: number, y: number, z: number, fuse = TNT_FUSE): void {
    const key = BlockSimulation.key(x, y, z);
    if (!this.fuses.has(key)) this.onPrime?.(x, y, z);
    this.fuses.set(key, { x, y, z, left: fuse });
  }

  fuseLeft(x: number, y: number, z: number): number | null {
    return this.fuses.get(BlockSimulation.key(x, y, z))?.left ?? null;
  }

  /** Removes a block: explosives that vanish take their fuse with them. */
  forget(x: number, y: number, z: number): void {
    const key = BlockSimulation.key(x, y, z);
    this.fuses.delete(key);
    this.fires.delete(key);
  }

  private canBurnHere(x: number, y: number, z: number): boolean {
    if (y <= 0) return false;
    const below = registry.get(this.world.getBlock(x, y - 1, z));
    return below.solid || (below.fluid ?? undefined) !== undefined;
  }

  tick(): void {
    this.tickFalling();
    this.tickFire();
    this.tickFuses();
  }

  private tickFalling(): void {
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const entry = this.falling[i];
      if (entry.delay > 0) {
        entry.delay--;
        continue;
      }
      const state = this.world.getBlock(entry.x, entry.y, entry.z);
      if (state === BLOCK.AIR || !registry.get(state).falling) {
        this.falling.splice(i, 1);
        continue;
      }
      if (this.supportedBelow(entry.x, entry.y, entry.z)) {
        this.falling.splice(i, 1);
        this.markFalling(entry.x, entry.y + 1, entry.z);
        continue;
      }
      // Move one block down and keep falling from there.
      this.write(entry.x, entry.y, entry.z, BLOCK.AIR);
      this.write(entry.x, entry.y - 1, entry.z, state);
      entry.y -= 1;
      entry.delay = 1;
      if (entry.y <= 0) this.falling.splice(i, 1);
      this.markFalling(entry.x, entry.y + 1, entry.z);
    }
  }

  private tickFire(): void {
    // A hard ceiling keeps a runaway forest fire from eating the tick budget.
    if (this.fires.size > MAX_FIRE_CELLS) return;
    for (const [key, fire] of [...this.fires]) {
      if (this.world.getBlock(fire.x, fire.y, fire.z) !== BLOCK.FIRE) {
        this.fires.delete(key);
        continue;
      }
      fire.age++;
      if (fire.age > FIRE_LIFETIME) {
        this.write(fire.x, fire.y, fire.z, BLOCK.AIR);
        this.fires.delete(key);
        continue;
      }
      for (const [dx, dy, dz] of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ] as const) {
        const x = fire.x + dx,
          y = fire.y + dy,
          z = fire.z + dz;
        const state = this.world.getBlock(x, y, z);
        const def = registry.get(state);
        if (def.flammable !== undefined && this.random() * 100 < FIRE_SPREAD_CHANCE) {
          if (def.burnTicks !== undefined && def.burnTicks <= 0) {
            // Explosive: the flame primes it instead of burning it down.
            this.prime(x, y, z);
            continue;
          }
          this.catchFire(x, y, z, true);
          // Wood burns away under the flame, the way the reference consumes a burning block.
          if (this.random() * 100 < def.flammable / 4) this.write(x, y, z, BLOCK.AIR);
          continue;
        }
        // Fire only takes hold on something that can burn: it never spreads through open air.
      }
    }
  }

  private tickFuses(): void {
    for (const [key, fuse] of [...this.fuses]) {
      if (this.world.getBlock(fuse.x, fuse.y, fuse.z) !== BLOCK.TNT) {
        this.fuses.delete(key);
        continue;
      }
      fuse.left--;
      if (fuse.left > 0) continue;
      this.fuses.delete(key);
      this.write(fuse.x, fuse.y, fuse.z, BLOCK.AIR);
      const center = { x: fuse.x + 0.5, y: fuse.y + 0.5, z: fuse.z + 0.5 };
      const result = this.explode(center.x, center.y, center.z, TNT_RADIUS);
      this.onExplosion?.(result, center, TNT_RADIUS);
    }
  }

  /**
   * Explosion: every block within the radius is removed unless its hardness absorbs the blast.
   * The rule is the familiar one — resistance grows with distance, so hard stone survives the
   * edge of a blast while sand at the centre does not.
   */
  explode(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    breaksBlocks = true,
  ): ExplosionResult {
    const removed: ExplosionResult['removed'] = [];
    const drops: ExplosionResult['drops'] = [];
    const pushed: ExplosionResult['pushed'] = [];
    const r = Math.ceil(radius);
    for (let x = Math.floor(cx - r); x <= Math.floor(cx + r); x++)
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(255, Math.floor(cy + r)); y++)
        for (let z = Math.floor(cz - r); z <= Math.floor(cz + r); z++) {
          const state = this.world.getBlock(x, y, z);
          if (state === BLOCK.AIR) continue;
          const def = registry.get(state);
          if (def.protected || def.hardness < 0) continue;
          const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy, z + 0.5 - cz);
          if (distance > radius) continue;
          const strength = (1 - distance / radius) * 8;
          if (breaksBlocks && def.hardness > strength) continue;
          this.write(x, y, z, BLOCK.AIR);
          removed.push({ x, y, z, state });
          if (def.fluid) continue;
          for (const drop of def.drops ?? []) {
            if (drop.shears) continue;
            if (drop.chance !== undefined && this.random() * 100 >= drop.chance) continue;
            drops.push({ item: drop.item, count: drop.count ?? 1, x, y, z });
          }
        }
    // Everything inside the blast is pushed away from its centre.
    const span = radius + 1;
    for (let x = Math.floor(cx - span); x <= Math.floor(cx + span); x++)
      for (let y = Math.max(0, Math.floor(cy - span)); y <= Math.floor(cy + span); y++)
        for (let z = Math.floor(cz - span); z <= Math.floor(cz + span); z++) {
          const dx = x + 0.5 - cx,
            dy = y + 0.5 - cy,
            dz = z + 0.5 - cz;
          const length = Math.hypot(dx, dy, dz);
          if (length > span || length < 1e-6) continue;
          const power = (1 - length / span) * 0.6;
          pushed.push({
            x: x + 0.5,
            y: y + 0.5,
            z: z + 0.5,
            dx: dx * power,
            dy: dy * power,
            dz: dz * power,
          });
        }
    this.craters.push(...removed.map((entry) => ({ ...entry })));
    return { removed, drops, pushed };
  }

  /** Experience and drops for the blocks a blast removed are handled by the simulation. */
  get fallingCount(): number {
    return this.falling.length;
  }
  get fireCount(): number {
    return this.fires.size;
  }
  get fuseCount(): number {
    return this.fuses.size;
  }

  snapshotFalling(): SavedFalling[] {
    return this.falling.map((entry) => ({ ...entry }));
  }
  snapshotFire(): SavedFire[] {
    return [...this.fires.values()].map((entry) => ({ ...entry }));
  }
  snapshotFuses(): SavedFalling[] {
    return [...this.fuses.values()].map((entry) => ({
      x: entry.x,
      y: entry.y,
      z: entry.z,
      delay: entry.left,
    }));
  }
  restoreFalling(entries: readonly SavedFalling[]): void {
    this.falling.length = 0;
    for (const entry of entries) this.falling.push({ ...entry });
  }
  restoreFire(entries: readonly SavedFire[]): void {
    this.fires.clear();
    for (const entry of entries)
      this.fires.set(BlockSimulation.key(entry.x, entry.y, entry.z), { ...entry });
  }
  restoreFuses(entries: readonly SavedFalling[]): void {
    this.fuses.clear();
    for (const entry of entries)
      this.fuses.set(BlockSimulation.key(entry.x, entry.y, entry.z), {
        x: entry.x,
        y: entry.y,
        z: entry.z,
        left: entry.delay,
      });
  }
  clear(): void {
    this.falling.length = 0;
    this.fires.clear();
    this.fuses.clear();
  }
}
