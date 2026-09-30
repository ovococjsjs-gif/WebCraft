import type { SavedItemEntity } from './entities';
import { populateStructureLoot } from './structure-loot';
import { findSafeSpawn, safeStanding } from './safe-spawn';
import type { GameMode } from './gameplay';
import { BLOCK, registry } from '../../content/src/blocks';
import { VoxelWorld, type ChunkColumn } from './world';
import { Simulation } from './simulation';
import { generateColumn, spawnPoint, type WorldPreset } from './terrain';
import { generateNetherColumn } from './nether';
import { endPillarTops, generateEndColumn } from './end';
import { endFountainHome } from './bosses';
import {
  DIMENSION_INFO,
  dimensionInfo,
  isDimensionId,
  scalePosition,
  type DimensionId,
} from './dimensions';
import type { PortalLookup, PortalPoint } from './portals';
import {
  END_PLATFORM,
  buildEndPlatform,
  netherArrival,
  overworldArrival,
  type Arrival,
} from './portals';
import { EMPTY_INPUT } from './player';
import { PLAYER_SLOTS } from './inventory';
import { DIFFICULTIES } from './survival';
import { itemRegistry } from '../../content/src/items';
import { CHEST_SLOTS, FURNACE_SLOTS } from './containers';
import {
  OverrideJournal,
  GENERATOR_ID,
  GENERATOR_VERSION,
  type CoreCheckpoint,
  type SavedOverride,
} from './persistence';

export interface TravelResult {
  readonly from: DimensionId;
  readonly to: DimensionId;
  readonly position: { x: number; y: number; z: number };
  /** True when the arrival had to build a portal platform because none was found. */
  readonly built: boolean;
  readonly message: string;
}
/** The block key a portal block is stored under, so a save can register its portals again. */
const PORTAL_BLOCK_KEY = registry.get(BLOCK.NETHER_PORTAL).key;
/** Owns serializable gameplay state, never graphics, DOM or database handles. */
export class WorldSession {
  readonly worlds = new Map<DimensionId, VoxelWorld>();
  readonly simulation: Simulation;
  private readonly journals = new Map<DimensionId, OverrideJournal>();
  private replaying = false;
  /** Every portal block the world has seen, per dimension, for the arrival search. */
  private readonly portals = new Map<
    DimensionId,
    Map<string, { x: number; y: number; z: number }>
  >();
  /** How many times a portal has moved the player; the host reloads the world on every trip. */
  travelCount = 0;
  readonly generatorVersion: CoreCheckpoint['generator']['version'];
  constructor(
    readonly seed: string,
    readonly preset: WorldPreset,
    checkpoint?: CoreCheckpoint,
    gameMode: GameMode = preset === 'flat' || preset === 'valley' ? 'lab' : 'survival',
  ) {
    this.generatorVersion = checkpoint?.generator.version ?? GENERATOR_VERSION;
    if (
      checkpoint &&
      (checkpoint.generator.id !== GENERATOR_ID ||
        ![1, 2, 3, 4, 5].includes(checkpoint.generator.version) ||
        (checkpoint.generator.version === 1 && !['flat', 'valley'].includes(preset)) ||
        checkpoint.generator.seed !== seed ||
        checkpoint.generator.preset !== preset)
    )
      throw new Error('Incompatible generator checkpoint');
    const startDimension: DimensionId = isDimensionId(checkpoint?.dimension)
      ? (checkpoint?.dimension as DimensionId)
      : 'overworld';
    const first = new VoxelWorld(seed, startDimension);
    this.worlds.set(startDimension, first);
    this.simulation = new Simulation(
      first,
      checkpoint ? { ...checkpoint.spawn } : spawnPoint(seed, preset, this.generatorVersion),
      {
        preset,
        generatorVersion: this.generatorVersion,
        ensureArea: (x, z) => this.ensureAround(this.dimension, x, z, 1),
      },
    );
    this.simulation.gameMode = checkpoint?.gameMode ?? gameMode;
    if (!checkpoint && preset !== 'flat' && preset !== 'valley') first.time = 6000;
    for (const goal of checkpoint?.journey ?? []) this.simulation.journey.add(goal);
    this.watchWorld(first);
    this.simulation.setInput({
      ...EMPTY_INPUT,
      yaw: preset === 'flat' ? 0 : 1.48,
      pitch: preset === 'flat' ? -0.32 : -0.3,
    });
    if (checkpoint) {
      this.simulation.restoreDimensions(checkpoint.dimensions ?? []);
      this.simulation.restoreBosses(checkpoint.bosses);
      this.world.tick = checkpoint.tick;
      this.world.scheduler.restore(checkpoint.scheduler);
      Object.assign(this.simulation.player, structuredClone(checkpoint.player));
      this.simulation.setInput({ ...EMPTY_INPUT, ...checkpoint.look });
      this.simulation.restoreInventory(checkpoint.inventory);
      this.simulation.restoreCursor(checkpoint.cursor);
      this.simulation.restoreContainerData(checkpoint.containers);
      this.simulation.entities.restore(checkpoint.items);
      this.simulation.restoreSurvival(checkpoint.survival);
      this.simulation.restoreMobs(checkpoint.mobs);
      this.simulation.restoreArrows(checkpoint.arrows);
      this.simulation.restoreOrbs(checkpoint.orbs);
      this.simulation.restoreBlockData(checkpoint.blocks ?? {});
      this.simulation.restoreEnchantments(checkpoint.enchantments ?? []);
      this.simulation.restoreBrewingData(checkpoint.brewing ?? []);
      this.simulation.restoreCarts(checkpoint.carts ?? []);
      this.world.time = checkpoint.time;
      this.simulation.edits = checkpoint.editCount;
      // The journal of a dimension is replaced as a whole, so the entries are grouped first.
      const byDimension = new Map<DimensionId, SavedOverride[]>();
      for (const entry of checkpoint.overrides) {
        const dimension = isDimensionId(entry[4]) ? (entry[4] as DimensionId) : 'overworld';
        const list = byDimension.get(dimension) ?? [];
        list.push(entry);
        byDimension.set(dimension, list);
        if (entry[3] === PORTAL_BLOCK_KEY) this.notePortal(dimension, entry[0], entry[1], entry[2]);
      }
      for (const [dimension, entries] of byDimension) this.journalFor(dimension).restore(entries);
    }
  }
  /** The dimension the player is in right now. */
  get dimension(): DimensionId {
    return this.world.dimensionID;
  }
  get world(): VoxelWorld {
    return this.simulation.world;
  }
  /** Told of every block this session changes itself (not replays or edits from the network). */
  onEdit?: (dimension: DimensionId, x: number, y: number, z: number, state: number) => void;
  private applyingRemote = false;
  /**
   * Applies blocks another player changed: recorded in the journal so a column loaded later has
   * them, and set at once where the column is loaded. They are not reported back through onEdit.
   */
  applyRemote(entries: readonly SavedOverride[]): number {
    let applied = 0;
    this.applyingRemote = true;
    try {
      for (const [x, y, z, key, dim] of entries) {
        const block = registry.find(key);
        if (!block) continue;
        const dimension: DimensionId = dim ?? 'overworld';
        const world = this.worlds.get(dimension);
        if (world?.column(Math.floor(x / 16), Math.floor(z / 16))) {
          if (world.getBlock(x, y, z) !== block.id && world.setBlock(x, y, z, block.id)) applied++;
        } else this.journalFor(dimension).set(x, y, z, block.id);
      }
    } finally {
      this.applyingRemote = false;
    }
    return applied;
  }
  /** The journal of block edits of one dimension; created on first use. */
  journalFor(dimension: DimensionId): OverrideJournal {
    let journal = this.journals.get(dimension);
    if (!journal) {
      journal = new OverrideJournal(dimension);
      this.journals.set(dimension, journal);
    }
    return journal;
  }
  /** Kept for callers that ask for the edits of the dimension the player is in. */
  get overrides(): OverrideJournal {
    return this.journalFor(this.dimension);
  }
  /** Every edit of every dimension, in save order. */
  allOverrides(): ReturnType<OverrideJournal['snapshot']> {
    const result: ReturnType<OverrideJournal['snapshot']> = [];
    for (const dimension of [...this.journals.keys()].sort())
      result.push(...this.journalFor(dimension).snapshot());
    return result;
  }
  /**
   * The world of a dimension, generated on first use. Time and tick follow the dimension the
   * player is in, so a clock and a bed behave the same wherever he stands.
   */
  worldFor(dimension: DimensionId): VoxelWorld {
    let world = this.worlds.get(dimension);
    if (!world) {
      world = new VoxelWorld(this.seed, dimension);
      world.tick = this.world.tick;
      world.time = this.world.time;
      this.worlds.set(dimension, world);
      this.watchWorld(world);
    }
    return world;
  }
  private watchWorld(world: VoxelWorld): void {
    world.onBlockChange = (edit) => {
      const dimension = world.dimensionID;
      if (!this.replaying) this.journalFor(dimension).set(edit.x, edit.y, edit.z, edit.state);
      if (!this.replaying && !this.applyingRemote)
        this.onEdit?.(dimension, edit.x, edit.y, edit.z, edit.state);
      if (edit.state === BLOCK.NETHER_PORTAL) this.notePortal(dimension, edit.x, edit.y, edit.z);
      else if (edit.before === BLOCK.NETHER_PORTAL)
        this.forgetPortal(dimension, edit.x, edit.y, edit.z);
    };
  }
  /** Portals are few and important: every one the world has ever seen is remembered. */
  private notePortal(dimension: DimensionId, x: number, y: number, z: number): void {
    let list = this.portals.get(dimension);
    if (!list) {
      list = new Map();
      this.portals.set(dimension, list);
    }
    list.set(`${x},${y},${z}`, { x, y, z });
  }
  private forgetPortal(dimension: DimensionId, x: number, y: number, z: number): void {
    this.portals.get(dimension)?.delete(`${x},${y},${z}`);
  }
  /** The recorded portals of a dimension inside a radius, for the arrival search. */
  private portalPoints = (dimension: DimensionId): PortalLookup => {
    return (x, z, radius) => {
      const list = this.portals.get(dimension);
      if (!list) return [];
      const result: PortalPoint[] = [];
      for (const portal of list.values())
        if (Math.hypot(portal.x - x, portal.z - z) <= radius) result.push(portal);
      return result;
    };
  };
  /** Generates the columns of one dimension, with the right generator for it. */
  private generate(cx: number, cz: number, dimension: DimensionId): ChunkColumn {
    if (dimension === 'nether')
      return generateNetherColumn(cx, cz, this.seed, this.generatorVersion).column;
    if (dimension === 'end') return generateEndColumn(cx, cz, this.seed, this.generatorVersion);
    return generateColumn(cx, cz, this.seed, this.preset, this.generatorVersion);
  }
  /** Makes sure the columns around a point exist, so a portal can be read or built there. */
  ensureAround(dimension: DimensionId, x: number, z: number, radius = 2): void {
    const world = this.worldFor(dimension);
    const cx = Math.floor(x / 16),
      cz = Math.floor(z / 16);
    void world;
    for (let ox = -radius; ox <= radius; ox++)
      for (let oz = -radius; oz <= radius; oz++) this.loadColumn(cx + ox, cz + oz, dimension);
  }
  /**
   * Carries the player through a portal. The target depends on the dimension he is leaving and
   * on the portal block he stood in: the session asks the simulation for both.
   */
  travel(): TravelResult | undefined {
    const target = this.simulation.pendingTravel;
    if (!target) return undefined;
    this.simulation.pendingTravel = null;
    return this.travelTo(target);
  }
  travelTo(to: DimensionId): TravelResult {
    const from = this.dimension;
    const position = this.simulation.player.position;
    const destination = this.worldFor(to);
    let arrival: Arrival;
    if (to === 'end') {
      // The End is empty until the first traveller: load the arrival area, then lay the pad.
      this.ensureAround('end', END_PLATFORM.x, END_PLATFORM.z, 3);
      arrival = { position: buildEndPlatform(destination), built: true };
    } else if (from === 'end' && to === 'overworld') {
      arrival = { position: this.safeHome(), built: false };
    } else if (to === 'nether') {
      const scaled = scalePosition(from, 'nether', position);
      this.ensureAround('nether', scaled.x, scaled.z);
      arrival = netherArrival(
        destination,
        this.seed,
        scaled.x,
        scaled.y,
        scaled.z,
        this.portalPoints('nether'),
      );
    } else {
      const scaled = scalePosition(from, 'overworld', position);
      this.ensureAround('overworld', scaled.x, scaled.z);
      const y = findSafeSpawn(destination, scaled)?.y ?? 65;
      arrival = overworldArrival(
        destination,
        scaled.x,
        scaled.z,
        y,
        this.portalPoints('overworld'),
      );
    }
    this.simulation.travelTo(destination, arrival.position);
    for (const column of destination.columns.values()) this.populateLoot(column);
    // The first arrival in the End starts the fight, once the traveller is standing there.
    if (
      to === 'end' &&
      !this.simulation.bosses.dragonEncountered &&
      !this.simulation.bosses.dragonDefeated
    ) {
      this.simulation.bosses.spawnBoss('ender_dragon', endFountainHome());
      for (const top of endPillarTops())
        this.simulation.bosses.addCrystal({ x: top.x + 0.5, y: top.y, z: top.z + 0.5 });
    }
    this.travelCount++;
    return {
      from,
      to,
      position: { ...arrival.position },
      built: arrival.built,
      message: DIMENSION_INFO[to].arrivalMessage,
    };
  }
  /** Respawn points (including beds) belong to the Overworld, never to the current dimension. */
  private safeHome() {
    const sim = this.simulation;
    const world = this.worldFor('overworld');
    for (const preferred of [sim.survival.spawn, sim.spawn]) {
      this.ensureAround('overworld', preferred.x, preferred.z, 1);
      const at = findSafeSpawn(world, preferred);
      if (at) return at;
    }
    const x = Math.floor(sim.spawn.x),
      z = Math.floor(sim.spawn.z),
      y = Math.max(8, Math.min(250, Math.floor(sim.spawn.y)));
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        world.setBlock(x + dx, y - 1, z + dz, BLOCK.STONE);
        world.setBlock(x + dx, y, z + dz, BLOCK.AIR);
        world.setBlock(x + dx, y + 1, z + dz, BLOCK.AIR);
      }
    return { x: x + 0.5, y: y + 0.01, z: z + 0.5 };
  }
  respawn(): TravelResult {
    const from = this.dimension,
      point = this.safeHome();
    if (from !== 'overworld') this.simulation.travelTo(this.worldFor('overworld'), point);
    this.simulation.respawn(point);
    this.simulation.cancelActions();
    this.simulation.player.flying = false;
    this.travelCount++;
    return {
      from,
      to: 'overworld',
      position: point,
      built: false,
      message: 'Возрождение в Верхнем мире',
    };
  }
  orientNewPlayer(): void {
    if (this.preset === 'flat' || this.preset === 'valley') return;
    const sim = this.simulation,
      origin = sim.player.position;
    let best = -Infinity,
      chosen = { ...origin },
      yaw = sim.input.yaw;
    const distance = (p: typeof origin, a: number) => {
      for (let d = 1; d <= 22; d++)
        if (
          registry.get(
            this.world.getBlock(
              Math.floor(p.x - Math.sin(a) * d),
              Math.floor(p.y + 1.5),
              Math.floor(p.z - Math.cos(a) * d),
            ),
          ).occludes
        )
          return d;
      return 22;
    };
    for (const dx of [-8, -4, 0, 4, 8])
      for (const dz of [-8, -4, 0, 4, 8]) {
        const x = Math.floor(origin.x) + dx,
          z = Math.floor(origin.z) + dz;
        let at: typeof origin | undefined;
        for (
          let y = Math.min(100, Math.floor(origin.y) + 12);
          y >= Math.max(2, Math.floor(origin.y) - 4);
          y--
        ) {
          const floor = this.world.getBlock(x, y - 1, z);
          if ([BLOCK.LEAVES, BLOCK.LOG, BLOCK.BIRCH].includes(floor as never)) continue;
          const candidate = { x: x + 0.5, y: y + 0.01, z: z + 0.5 };
          if (safeStanding(this.world, candidate)) {
            at = candidate;
            break;
          }
        }
        if (!at) continue;
        for (let i = 0; i < 24; i++) {
          const angle = (i * Math.PI) / 12;
          const space =
            [-0.45, -0.22, 0, 0.22, 0.45].reduce(
              (sum, offset) => sum + distance(at!, angle + offset),
              0,
            ) / 5;
          const score = space - Math.hypot(dx, dz) * 0.16 - Math.abs(at.y - origin.y) * 0.1;
          if (score > best) {
            best = score;
            chosen = at;
            yaw = angle;
          }
        }
      }
    sim.player.position = chosen;
    sim.player.velocity = { x: 0, y: 0, z: 0 };
    sim.player.onGround = true;
    Object.assign(sim.spawn, chosen);
    sim.survival.setSpawn(chosen);
    sim.setInput({ ...EMPTY_INPUT, yaw, pitch: -0.12 });
  }
  persistenceStamp(): string {
    return this.simulation.persistenceStamp(
      [...this.journals].map(([key, journal]) => [key, journal.revision]),
    );
  }
  /** How long the player still has to stand in a portal, for the interface. */
  get portalProgress(): number {
    const ticks = this.simulation.portalTicks;
    return Math.min(1, ticks / Math.max(1, this.simulation.portalDelayTicks));
  }
  /** The name of the dimension, for the notice shown on arrival. */
  get dimensionName(): string {
    return dimensionInfo(this.dimension).name;
  }
  loadColumn(cx: number, cz: number, dimension: DimensionId = this.dimension): void {
    const world = this.worldFor(dimension);
    if (world.column(cx, cz)) return;
    world.addColumn(this.generate(cx, cz, dimension));
    this.replaying = true;
    try {
      for (const e of this.journalFor(dimension).forColumn(cx, cz))
        world.setBlock(e.x, e.y, e.z, e.state);
    } finally {
      this.replaying = false;
    }
    if (dimension === this.dimension) this.populateLoot(world.column(cx, cz)!);
  }
  private populateLoot(column: ChunkColumn): void {
    populateStructureLoot(this.world, column, this.simulation.containers, (x, y, z) =>
      this.overrides.has(x, y, z),
    );
  }
  /** Called synchronously in the Worker between ticks, so no partial mutation is observed. */
  checkpoint(): CoreCheckpoint {
    const sim = this.simulation;
    // The crafting grid is interface state; its items go back into the inventory first so a
    // save taken while the interface is open can never lose them.
    const items = sim.captureItems();
    return {
      generator: {
        id: GENERATOR_ID,
        version: this.generatorVersion,
        seed: this.seed,
        preset: this.preset,
      },
      gameMode: sim.gameMode,
      journey: [...sim.journey],
      dimension: this.dimension,
      dimensions: sim.dimensionSnapshot(),
      bosses: sim.bosses.snapshot(),
      tick: this.world.tick,
      time: this.world.time,
      spawn: { ...sim.spawn },
      player: structuredClone(sim.player),
      look: { yaw: sim.input.yaw, pitch: sim.input.pitch },
      inventory: { selected: sim.selected, slots: items.slots },
      cursor: items.cursor,
      containers: sim.containerData(),
      items: [
        ...sim.entities.snapshot(),
        ...items.overflow
          .filter((slot): slot is NonNullable<typeof slot> => !!slot)
          .map((slot) => {
            const at = sim.player.position;
            return [
              slot.item,
              slot.count,
              slot.damage ?? 0,
              at.x,
              at.y + 0.5,
              at.z,
              0,
              ...(slot.enchantments ? [slot.enchantments] : []),
            ] as SavedItemEntity;
          }),
      ],
      survival: sim.survival.snapshot(),
      mobs: sim.savedMobs(),
      arrows: sim.savedArrows(),
      orbs: sim.savedOrbs(),
      blocks: sim.blockData(),
      enchantments: sim.savedEnchantments(),
      brewing: sim.brewingData(),
      carts: sim.savedCarts(),
      editCount: sim.edits,
      overrides: this.allOverrides(),
      scheduler: this.world.scheduler.snapshot(),
    };
  }
  /**
   * Guard for interfaces and saves: every place that can hold items is checked for a valid
   * shape, so a corrupt file is rejected before it can lose anything.
   */
  validateState(): string[] {
    const problems: string[] = [];
    const sim = this.simulation;
    const slots = sim.inventoryData();
    if (slots.length !== PLAYER_SLOTS) problems.push(`Инвентарь: ${slots.length} слотов`);
    for (const [index, slot] of slots.entries()) {
      if (!slot) continue;
      if (!itemRegistry.find(slot[0]))
        problems.push(`Инвентарь: неизвестный предмет «${slot[0]}» в слоте ${index}`);
      else if (!Number.isInteger(slot[1]) || slot[1] < 1 || slot[1] > 64)
        problems.push(`Инвентарь: неверное количество в слоте ${index}`);
    }
    if (sim.cursor && !itemRegistry.find(sim.cursor.item))
      problems.push(`Курсор: неизвестный предмет «${sim.cursor.item}»`);
    for (const block of sim.containers.snapshotEntries()) {
      const expected = block.kind === 'chest' ? CHEST_SLOTS : FURNACE_SLOTS;
      if (block.slots.length !== expected)
        problems.push(
          `Контейнер ${block.key}: ${block.slots.length} слотов, ожидалось ${expected}`,
        );
      for (const slot of block.slots)
        if (slot && !itemRegistry.find(slot[0]))
          problems.push(`Контейнер ${block.key}: неизвестный предмет «${slot[0]}»`);
    }
    if (!DIFFICULTIES.includes(sim.survival.difficulty))
      problems.push(`Сложность: неизвестное значение «${sim.survival.difficulty}»`);
    if (
      !Number.isFinite(sim.survival.health) ||
      sim.survival.health < 0 ||
      sim.survival.health > 20
    )
      problems.push(`Здоровье: неверное значение ${sim.survival.health}`);
    if (!Number.isFinite(sim.survival.food) || sim.survival.food < 0 || sim.survival.food > 20)
      problems.push(`Голод: неверное значение ${sim.survival.food}`);
    if (!Number.isFinite(sim.survival.xp) || sim.survival.xp < 0)
      problems.push(`Опыт: неверное значение ${sim.survival.xp}`);
    for (const mob of sim.mobs.list) {
      if (!Number.isFinite(mob.position.x + mob.position.y + mob.position.z))
        problems.push('Существо: неверные координаты');
      if (!(mob.health > 0)) problems.push(`Существо ${mob.kind}: здоровье ${mob.health}`);
    }
    for (const arrow of sim.arrows.list) {
      if (!Number.isFinite(arrow.position.x + arrow.position.y + arrow.position.z))
        problems.push('Стрела: неверные координаты');
      if (!(arrow.damage >= 0)) problems.push('Стрела: неверный урон');
    }
    for (const orb of sim.orbs.list)
      if (!Number.isInteger(orb.value) || orb.value < 1)
        problems.push(`Опыт на земле: неверное значение ${orb.value}`);
    for (const entity of sim.entities.list) {
      if (!itemRegistry.find(entity.item)) problems.push(`Предмет на земле: «${entity.item}»`);
      else if (!Number.isInteger(entity.count) || entity.count < 1)
        problems.push(`Предмет на земле: неверное количество ${entity.count}`);
      else if (!Number.isFinite(entity.position.x + entity.position.y + entity.position.z))
        problems.push('Предмет на земле: неверные координаты');
    }
    return problems;
  }
}
