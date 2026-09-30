/**
 * Redstone: wires, torches, levers, buttons, plates, repeaters, comparators, lamps, pistons,
 * dispensers, droppers, TNT and the powered rails.
 *
 * The system keeps one record per component: its power, the direction it faces and a small
 * timer for the parts that react slowly. Every tick the *active* set is re-evaluated; when a
 * value changes, the neighbours join the set for the next pass, so a signal travels along a
 * wire at the speed of the reference tick rather than in one instant sweep. Side effects that
 * change the world (a lamp lighting up, a piston pushing) are applied at the same moment, and
 * the host callback makes sure those writes are journalled like any other edit.
 */
import { BLOCK, registry, type BlockDefinition } from '../../content/src/blocks';
import type { VoxelWorld } from './world';

export type Facing = 'north' | 'south' | 'east' | 'west';
export const MAX_POWER = 15;
/** Components evaluated in one tick; the rest wait for the following tick. */
export const REDSTONE_BUDGET = 6144;
/** Ticks a repeater waits per delay setting, following the reference at ten ticks a second. */
export const REPEATER_TICKS_PER_SETTING = 2;
/** A wooden button stays pressed for ten ticks in the reference game. */
export const BUTTON_PRESS_TICKS = 10;
/** How many blocks a piston may push; the reference allows twelve. */
export const PISTON_LIMIT = 12;

export interface SavedComponent {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly power: number;
  readonly facing: Facing;
  readonly delay: number;
  readonly mode: 'compare' | 'subtract';
  readonly timer: number;
}

export interface RedstoneHooks {
  /** Journalled block write, so edits end up in the save exactly like a player's. */
  write(x: number, y: number, z: number, state: number): void;
  /** Analog reading of a container, 0-15, used by the comparator. */
  containerSignal(x: number, y: number, z: number): number;
  /** A dispenser or dropper fires: the host moves one item out of its inventory. */
  eject(x: number, y: number, z: number, facing: Facing, kind: 'dispenser' | 'dropper'): void;
  /** A pressure plate or detector rail with something on top of it. */
  entityOn(x: number, y: number, z: number, role: string): boolean;
  /** TNT receives power. */
  prime(x: number, y: number, z: number): void;
  /** Experience and drops are handled by the host when an explosion happens elsewhere. */
}

interface Component {
  role: string;
  def: BlockDefinition;
  power: number;
  facing: Facing;
  delay: number;
  mode: 'compare' | 'subtract';
  /** Countdown for repeaters and pressed buttons. */
  timer: number;
  /** Last input seen, so edges (a dispenser firing) are only acted on once. */
  lastInput: number;
}

const HORIZONTAL: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const ALL_DIRS: readonly [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export function facingVector(facing: Facing): { x: number; z: number } {
  if (facing === 'east') return { x: 1, z: 0 };
  if (facing === 'west') return { x: -1, z: 0 };
  if (facing === 'south') return { x: 0, z: 1 };
  return { x: 0, z: -1 };
}

/** Direction the player faces, snapped to one of the four compass points. */
export function facingFromYaw(yaw: number): Facing {
  const angle = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  // yaw 0 looks along -Z, which is north; every quarter turn moves one compass step clockwise.
  const index = Math.round(angle / (Math.PI / 2)) % 4;
  return (['north', 'east', 'south', 'west'] as const)[index];
}

/** Roles that only take power: they never feed the network back, as in the reference. */
const CONSUMER_ROLES = new Set(['lamp', 'piston', 'sticky_piston', 'dispenser', 'dropper', 'tnt']);

export class RedstoneSystem {
  private readonly components = new Map<string, Component>();
  private readonly active = new Set<string>();
  private writing = false;
  /**
   * Value of every dust cell. A redstone line is solved as one network, not block by block:
   * the strongest source feeds the dust next to it at full strength and every following block
   * loses one level, which is exactly how the reference wire decays. `null` means „needs a solve“.
   */
  private wireValues: Map<string, number> | null = null;
  /** Values of the solve that is currently running, so nested questions cannot loop for ever. */
  private solvingWires: Map<string, number> | null = null;
  /** Components whose power is being evaluated right now, the guard against mutual recursion. */
  private readonly evaluating = new Set<string>();
  /** Components whose countdown already ran this tick, so a repeater waits its real delay. */
  private readonly countedTimers = new Set<string>();
  /** Set when a component sends power into a block: used by lamps, pistons and TNT alike. */
  lastProcessed = 0;

  constructor(
    private readonly world: VoxelWorld,
    private readonly hooks: RedstoneHooks,
  ) {}

  private static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }
  private static parse(key: string): [number, number, number] {
    const [x, y, z] = key.split(',').map(Number);
    return [x, y, z];
  }

  /** Registers a component and schedules it; called for every placed or loaded block. */
  note(x: number, y: number, z: number, facing: Facing = 'north', delay = 1): void {
    const state = this.world.getBlock(x, y, z);
    const def = registry.get(state);
    const role = def.redstone;
    const key = RedstoneSystem.key(x, y, z);
    if (!role) {
      this.components.delete(key);
      return;
    }
    if (this.components.has(key)) {
      this.activate(key);
      return;
    }
    this.components.set(key, {
      role,
      def,
      power: 0,
      facing,
      delay,
      mode: 'compare',
      timer: 0,
      lastInput: 0,
    });
    this.activate(key);
  }

  forget(x: number, y: number, z: number): void {
    this.components.delete(RedstoneSystem.key(x, y, z));
    this.active.delete(RedstoneSystem.key(x, y, z));
    this.invalidateWires();
  }

  /** Schedules the position and everything next to it for the next evaluation pass. */
  activate(key: string): void {
    this.active.add(key);
    const [x, y, z] = RedstoneSystem.parse(key);
    for (const [dx, dy, dz] of ALL_DIRS)
      this.active.add(RedstoneSystem.key(x + dx, y + dy, z + dz));
  }

  activateAt(x: number, y: number, z: number): void {
    this.activate(RedstoneSystem.key(x, y, z));
  }

  /** Marks the dust network as stale: a source, a wire or a neighbour of them changed. */
  private invalidateWires(): void {
    this.wireValues = null;
  }

  /** Solves every dust network of the loaded world once, from its sources outwards. */
  private solveWires(): void {
    if (this.wireValues) return;
    const values = new Map<string, number>();
    this.solvingWires = values;
    try {
      const queue: string[] = [];
      for (const [key, component] of this.components) {
        if (component.role !== 'wire') continue;
        const [x, y, z] = RedstoneSystem.parse(key);
        let feed = 0;
        for (const [dx, dy, dz] of ALL_DIRS) {
          const neighbourKey = RedstoneSystem.key(x + dx, y + dy, z + dz);
          const neighbour = this.components.get(neighbourKey);
          if (!neighbour || neighbour.role === 'wire') continue;
          for (const output of this.outputs(neighbourKey))
            if (output.key === key) feed = Math.max(feed, output.power);
        }
        values.set(key, Math.min(MAX_POWER, Math.max(0, feed)));
        if (values.get(key)! > 0) queue.push(key);
      }
      // Flood outwards: horizontal dust in the same plane, and the vertical climb both ways.
      while (queue.length) {
        const key = queue.shift()!;
        const power = values.get(key) ?? 0;
        if (power <= 1) continue;
        const [x, y, z] = RedstoneSystem.parse(key);
        for (const [dx, dy, dz] of ALL_DIRS) {
          const neighbourKey = RedstoneSystem.key(x + dx, y + dy, z + dz);
          const neighbour = this.components.get(neighbourKey);
          if (!neighbour || neighbour.role !== 'wire') continue;
          const wanted = power - 1;
          if ((values.get(neighbourKey) ?? 0) >= wanted) continue;
          values.set(neighbourKey, wanted);
          queue.push(neighbourKey);
        }
      }
    } finally {
      this.solvingWires = null;
    }
    this.wireValues = values;
  }

  /** Strength of the dust at a position, solving the network when the cache is stale. */
  private wireValue(x: number, y: number, z: number): number {
    const key = RedstoneSystem.key(x, y, z);
    let values = this.wireValues ?? this.solvingWires;
    if (!values) {
      this.solveWires();
      values = this.wireValues;
    }
    return values ? (values.get(key) ?? 0) : 0;
  }

  componentAt(
    x: number,
    y: number,
    z: number,
  ): { power: number; facing: Facing; delay: number } | null {
    const component = this.components.get(RedstoneSystem.key(x, y, z));
    if (!component) return null;
    return { power: component.power, facing: component.facing, delay: component.delay };
  }

  /** Sets facing and delay of a fresh component, used when the player places it. */
  configure(x: number, y: number, z: number, facing: Facing, delay = 1): void {
    this.note(x, y, z, facing, delay);
    const component = this.components.get(RedstoneSystem.key(x, y, z));
    if (component) {
      component.facing = facing;
      component.delay = delay;
    }
  }

  cycleDelay(x: number, y: number, z: number): number {
    const component = this.components.get(RedstoneSystem.key(x, y, z));
    if (!component || (component.role !== 'repeater' && component.role !== 'comparator')) return 0;
    component.delay = (component.delay % 4) + 1;
    this.activateAt(x, y, z);
    return component.delay;
  }

  toggleMode(x: number, y: number, z: number): 'compare' | 'subtract' {
    const component = this.components.get(RedstoneSystem.key(x, y, z));
    if (!component || component.role !== 'comparator') return 'compare';
    component.mode = component.mode === 'compare' ? 'subtract' : 'compare';
    this.activateAt(x, y, z);
    return component.mode;
  }

  /** A lever, button or plate was used by the player. */
  press(x: number, y: number, z: number): boolean {
    const component = this.components.get(RedstoneSystem.key(x, y, z));
    const def = registry.get(this.world.getBlock(x, y, z));
    if (!def.redstone) return false;
    if (def.redstone === 'lever') {
      // The block that knows its darker twin is the lit one: flipping goes the other way.
      const lit = def.unlitVariant !== undefined;
      this.hooks.write(x, y, z, lit ? (def.unlitVariant ?? def.id) : (def.litVariant ?? def.id));
      this.note(x, y, z, component?.facing ?? 'north', component?.delay ?? 1);
      this.activateAt(x, y, z);
      return true;
    }
    if (def.redstone === 'button') {
      if (def.unlitVariant !== undefined) return false; // already pressed
      this.hooks.write(x, y, z, def.litVariant ?? def.id);
      this.note(x, y, z);
      const entry = this.components.get(RedstoneSystem.key(x, y, z));
      if (entry) entry.timer = BUTTON_PRESS_TICKS;
      this.activateAt(x, y, z);
      return true;
    }
    if (def.redstone === 'repeater' || def.redstone === 'comparator') {
      this.cycleDelay(x, y, z);
      if (def.redstone === 'comparator') this.toggleMode(x, y, z);
      return true;
    }
    return false;
  }

  /** Every component's current output, in the four directions plus up and down. */
  private outputs(key: string): { key: string; power: number }[] {
    const [x, y, z] = RedstoneSystem.parse(key);
    const component = this.components.get(key);
    if (component) {
      // Machines do not power their surroundings: only sources and dust carry a signal.
      if (CONSUMER_ROLES.has(component.role)) return [];
      const power = this.power(component, x, y, z);
      if (power <= 0) return [];
      if (component.role === 'repeater' || component.role === 'comparator') {
        const vector = facingVector(component.facing);
        return [{ key: RedstoneSystem.key(x + vector.x, y, z + vector.z), power }];
      }
      if (component.role === 'torch') {
        const result = HORIZONTAL.map(([dx, dz]) => ({
          key: RedstoneSystem.key(x + dx, y, z + dz),
          power,
        }));
        result.push({ key: RedstoneSystem.key(x, y + 1, z), power });
        return result;
      }
      return ALL_DIRS.map(([dx, dy, dz]) => ({
        key: RedstoneSystem.key(x + dx, y + dy, z + dz),
        power,
      }));
    }
    // A wire spreads to its horizontal neighbours and climbs one block up.
    const state = this.world.getBlock(x, y, z);
    const def = registry.get(state);
    if (def.redstone !== 'wire') return [];
    const wire = this.components.get(key);
    const power = wire?.power ?? 0;
    if (power <= 0) return [];
    const spread = Math.max(0, power - 1);
    const result = HORIZONTAL.map(([dx, dz]) => ({
      key: RedstoneSystem.key(x + dx, y, z + dz),
      power: spread,
    }));
    if (!registry.get(this.world.getBlock(x, y + 1, z)).occludes)
      result.push({ key: RedstoneSystem.key(x, y + 1, z), power: spread });
    return result;
  }

  /** Input a component receives from its neighbours. */
  private input(x: number, y: number, z: number): number {
    const into = new Map<string, number>();
    for (const [dx, dy, dz] of ALL_DIRS) {
      const key = RedstoneSystem.key(x + dx, y + dy, z + dz);
      for (const output of this.outputs(key)) {
        if (output.key !== RedstoneSystem.key(x, y, z)) continue;
        into.set(key, Math.max(into.get(key) ?? 0, output.power));
      }
    }
    let best = 0;
    for (const power of into.values()) best = Math.max(best, power);
    return best;
  }

  /**
   * Power a component currently provides. Components ask their neighbours, and neighbours may ask
   * back (a torch standing on the dust it powers), so a component that is already being evaluated
   * answers with its last known value instead of recursing for ever.
   */
  private power(component: Component, x: number, y: number, z: number): number {
    const key = RedstoneSystem.key(x, y, z);
    if (this.evaluating.has(key)) return component.power;
    this.evaluating.add(key);
    try {
      return this.powerOf(component, x, y, z);
    } finally {
      this.evaluating.delete(key);
    }
  }

  private powerOf(component: Component, x: number, y: number, z: number): number {
    // A lamp, a piston or a dispenser simply takes what reaches it from its neighbours.
    if (CONSUMER_ROLES.has(component.role)) return this.input(x, y, z);
    switch (component.role) {
      case 'lever':
        // The lever in its dark block is switched off; the lit block feeds the network.
        return component.def.unlitVariant !== undefined ? MAX_POWER : 0;
      case 'button':
        return component.timer > 0 ? MAX_POWER : 0;
      case 'plate':
        return this.hooks.entityOn(x, y, z, 'plate') ? MAX_POWER : 0;
      case 'torch': {
        // The torch hangs on the block below and turns off when that block is powered.
        const below = this.input(x, y - 1, z);
        return below > 0 ? 0 : MAX_POWER;
      }
      case 'repeater':
        return component.timer <= 0 && component.lastInput > 0 ? MAX_POWER : 0;
      case 'comparator': {
        const signal = this.comparatorInput(component, x, y, z);
        if (component.mode === 'compare') return signal >= component.lastInput ? signal : 0;
        return Math.max(0, signal - component.lastInput);
      }
      case 'wire':
        // Solved as a whole network: see `solveWires`.
        return this.wireValue(x, y, z);
      default:
        return 0;
    }
  }

  private comparatorInput(component: Component, x: number, y: number, z: number): number {
    const vector = facingVector(component.facing);
    const behind = this.inputTo(x - vector.x, y, z - vector.z);
    const container = this.hooks.containerSignal(x - vector.x, y, z - vector.z);
    return Math.max(behind, container);
  }

  private inputTo(x: number, y: number, z: number): number {
    return this.input(x, y, z);
  }

  /**
   * One redstone tick. Components are evaluated until nothing changes, which is what makes a
   * lever reach the end of a long wire in the same tick it is flipped.
   */
  tick(): number {
    this.countedTimers.clear();
    if (this.active.size === 0) {
      this.lastProcessed = 0;
      return 0;
    }
    let processed = 0;
    for (let pass = 0; pass < 24; pass++) {
      const keys = [...this.active].sort();
      this.active.clear();
      let changed = false;
      for (const key of keys) {
        if (processed >= REDSTONE_BUDGET) {
          this.active.add(key);
          continue;
        }
        const [x, y, z] = RedstoneSystem.parse(key);
        if (!this.world.isLoaded(x, z)) continue;
        const component = this.components.get(key);
        if (!component) continue;
        processed++;
        const before = component.power;
        this.tickComponent(component, x, y, z);
        const after = component.power;
        if (after !== before) {
          changed = true;
          for (const [dx, dy, dz] of ALL_DIRS)
            this.active.add(RedstoneSystem.key(x + dx, y + dy, z + dz));
        }
      }
      if (!changed) break;
    }
    this.lastProcessed = processed;
    return processed;
  }

  private tickComponent(component: Component, x: number, y: number, z: number): void {
    const state = this.world.getBlock(x, y, z);
    const def = registry.get(state);
    // The state of a two-state component lives in its block, so the definition is re-read every
    // tick: a flipped lever, a lit torch and a dark lamp all keep their role and change their block.
    if (def.redstone !== component.role) component.role = def.redstone ?? component.role;
    component.def = def;
    // Buttons release after their press time.
    if (component.role === 'button' && component.timer > 0) {
      // One tick of press per redstone tick, however many passes the network needs.
      const key = RedstoneSystem.key(x, y, z);
      if (!this.countedTimers.has(key)) {
        this.countedTimers.add(key);
        component.timer--;
        if (component.timer === 0 && this.world.getBlock(x, y, z) !== BLOCK.BUTTON_OFF)
          this.hooks.write(x, y, z, BLOCK.BUTTON_OFF);
      }
    }
    // A repeater and a comparator read only what arrives at the block behind them: the dust they
    // drive in front must never feed them back, or the component would hold itself switched on.
    const behind = facingVector(component.facing);
    const input =
      component.role === 'repeater' || component.role === 'comparator'
        ? this.powerAt(x - behind.x, y, z - behind.z)
        : this.input(x, y, z);
    if (component.role === 'repeater') {
      // A repeater waits for its delay, then follows its input.
      const key = RedstoneSystem.key(x, y, z);
      const wanted = input > 0 ? MAX_POWER : 0;
      if (wanted !== component.lastInput) {
        component.timer =
          wanted > 0 ? component.delay * REPEATER_TICKS_PER_SETTING : REPEATER_TICKS_PER_SETTING;
        component.lastInput = wanted;
      }
      if (component.timer > 0 && !this.countedTimers.has(key)) {
        this.countedTimers.add(key);
        component.timer--;
      }
    } else if (component.role === 'comparator') {
      component.lastInput = input;
    }
    const next = this.power(component, x, y, z);
    const changed = next !== component.power;
    component.power = next;
    if (changed) this.invalidateWires();
    // A running countdown keeps its own schedule: a pressed button and a waiting repeater stay
    // in the queue until they are done, however quiet their neighbours are.
    if (component.timer > 0) this.active.add(RedstoneSystem.key(x, y, z));
    this.apply(component, x, y, z, next, changed);
  }

  /** Side effects of a power change: lamps, pistons, dispensers, rails and TNT. */
  private apply(
    component: Component,
    x: number,
    y: number,
    z: number,
    power: number,
    changed: boolean,
  ): void {
    const state = this.world.getBlock(x, y, z);
    const def = registry.get(state);
    switch (component.role) {
      case 'torch': {
        // Lit unless the block it stands on is powered: the classic inverter.
        const wanted = power > 0 ? BLOCK.REDSTONE_TORCH_ON : BLOCK.REDSTONE_TORCH_OFF;
        if (state !== wanted) this.write(x, y, z, wanted);
        break;
      }
      case 'repeater': {
        const wanted = power > 0 ? BLOCK.REPEATER_ON : BLOCK.REPEATER_OFF;
        if (state !== wanted) this.write(x, y, z, wanted);
        break;
      }
      case 'comparator': {
        const wanted = power > 0 ? BLOCK.COMPARATOR_ON : BLOCK.COMPARATOR_OFF;
        if (state !== wanted) this.write(x, y, z, wanted);
        break;
      }
      case 'lamp': {
        const wanted =
          power > 0 ? (def.litVariant ?? BLOCK.LAMP_ON) : (def.unlitVariant ?? BLOCK.LAMP_OFF);
        if (state !== wanted) this.write(x, y, z, wanted);
        break;
      }
      case 'piston':
      case 'sticky_piston': {
        const sticky = component.role === 'sticky_piston';
        const extended = this.isExtended(x, y, z, component.facing);
        if (power > 0 && !extended) this.extend(component, x, y, z, sticky);
        else if (power === 0 && extended) this.retract(component, x, y, z, sticky);
        break;
      }
      case 'dispenser':
      case 'dropper':
        if (changed && power > 0) this.hooks.eject(x, y, z, component.facing, component.role);
        break;
      case 'tnt':
        if (changed && power > 0) this.hooks.prime(x, y, z);
        break;
      default:
        break;
    }
  }

  private write(x: number, y: number, z: number, state: number): void {
    if (this.writing) return;
    this.invalidateWires();
    this.writing = true;
    try {
      this.hooks.write(x, y, z, state);
    } finally {
      this.writing = false;
    }
  }

  private isExtended(x: number, y: number, z: number, facing: Facing): boolean {
    const vector = facingVector(facing);
    const head = this.world.getBlock(x + vector.x, y, z + vector.z);
    return head === BLOCK.PISTON_HEAD;
  }

  /**
   * Pushing: the block in front moves by one, then the head takes its place. Up to twelve blocks
   * line up in a row, exactly as many as the reference piston may push.
   */
  private extend(component: Component, x: number, y: number, z: number, sticky: boolean): void {
    const vector = facingVector(component.facing);
    const chain: { x: number; y: number; z: number }[] = [];
    for (let step = 1; step <= PISTON_LIMIT + 1; step++) {
      const tx = x + vector.x * step,
        ty = y,
        tz = z + vector.z * step;
      const state = this.world.getBlock(tx, ty, tz);
      if (state === BLOCK.AIR) break;
      const def = registry.get(state);
      if (def.protected || def.hardness < 0) return; // obsidian and bedrock stop a piston
      // More than twelve blocks in a row is beyond the strength of the piston: nothing moves.
      if (chain.length === PISTON_LIMIT) return;
      chain.push({ x: tx, y: ty, z: tz });
    }
    if (chain.length) {
      const last = chain[chain.length - 1];
      const beyond = { x: last.x + vector.x, y: last.y, z: last.z + vector.z };
      if (this.world.getBlock(beyond.x, beyond.y, beyond.z) !== BLOCK.AIR) return;
      for (let i = chain.length - 1; i >= 0; i--) {
        const from = chain[i];
        const to = i === chain.length - 1 ? beyond : chain[i + 1];
        const state = this.world.getBlock(from.x, from.y, from.z);
        this.write(to.x, to.y, to.z, state);
        this.write(from.x, from.y, from.z, BLOCK.AIR);
      }
    }
    this.write(x + vector.x, y, z + vector.z, BLOCK.PISTON_HEAD);
    this.write(x, y, z, sticky ? BLOCK.STICKY_PISTON_EXTENDED : BLOCK.PISTON_EXTENDED);
  }

  private retract(component: Component, x: number, y: number, z: number, sticky: boolean): void {
    const vector = facingVector(component.facing);
    const head = { x: x + vector.x, y, z: z + vector.z };
    const beyond = { x: head.x + vector.x, y, z: head.z + vector.z };
    if (this.world.getBlock(head.x, head.y, head.z) === BLOCK.PISTON_HEAD)
      this.write(head.x, head.y, head.z, BLOCK.AIR);
    const pulled = this.world.getBlock(beyond.x, beyond.y, beyond.z);
    if (sticky && pulled !== BLOCK.AIR) {
      const def = registry.get(pulled);
      if (
        !def.protected &&
        def.hardness >= 0 &&
        this.world.getBlock(head.x, head.y, head.z) === BLOCK.AIR
      ) {
        this.write(beyond.x, beyond.y, beyond.z, BLOCK.AIR);
        this.write(head.x, head.y, head.z, pulled);
      }
    }
    this.write(x, y, z, sticky ? BLOCK.STICKY_PISTON : BLOCK.PISTON);
  }

  /** Highest power delivered to a position from anywhere; used by the rails and by tests. */
  powerAt(x: number, y: number, z: number): number {
    const own = this.components.get(RedstoneSystem.key(x, y, z));
    if (own) return this.power(own, x, y, z);
    let best = 0;
    for (const [dx, dy, dz] of ALL_DIRS) {
      const key = RedstoneSystem.key(x + dx, y + dy, z + dz);
      for (const output of this.outputs(key))
        if (output.key === RedstoneSystem.key(x, y, z)) best = Math.max(best, output.power);
    }
    return best;
  }

  get size(): number {
    return this.components.size;
  }
  get activeCount(): number {
    return this.active.size;
  }

  snapshot(): SavedComponent[] {
    return [...this.components.entries()]
      .map(([key, component]) => {
        const [x, y, z] = RedstoneSystem.parse(key);
        return {
          x,
          y,
          z,
          power: component.power,
          facing: component.facing,
          delay: component.delay,
          mode: component.mode,
          timer: component.timer,
        };
      })
      .sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z);
  }

  restore(entries: readonly SavedComponent[]): void {
    this.components.clear();
    this.active.clear();
    this.invalidateWires();
    for (const entry of entries) {
      const key = RedstoneSystem.key(entry.x, entry.y, entry.z);
      const def = registry.get(this.world.getBlock(entry.x, entry.y, entry.z));
      if (!def.redstone) continue;
      this.components.set(key, {
        role: def.redstone,
        def,
        power: entry.power,
        facing: entry.facing,
        delay: entry.delay,
        mode: entry.mode,
        timer: entry.timer,
        lastInput: 0,
      });
      this.activate(key);
    }
  }

  /** Re-registers every component in the loaded world; called after a save is restored. */
  rescan(): void {
    const known = new Set<string>();
    for (const column of this.world.columns.values()) {
      if (column.status !== 'ready') continue;
      for (const [sy, section] of column.sections) {
        if (section.nonAir === 0) continue;
        for (let index = 0; index < section.indices.length; index++) {
          const state = section.get(index);
          if (!registry.get(state).redstone) continue;
          const y = sy * 16 + Math.floor(index / 256);
          const z = column.cz * 16 + (Math.floor(index / 16) % 16);
          const x = column.cx * 16 + (index % 16);
          const key = RedstoneSystem.key(x, y, z);
          known.add(key);
          this.note(x, y, z);
        }
      }
    }
    for (const key of [...this.components.keys()]) {
      if (!known.has(key)) this.components.delete(key);
    }
  }

  clear(): void {
    this.invalidateWires();
    this.components.clear();
    this.active.clear();
  }
}
