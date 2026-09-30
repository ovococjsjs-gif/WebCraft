import { DEPENDENTS, isSupported, supportReason, supportRule } from './support';
import {
  WeatherSchedule,
  WEATHER_GRID_RADIUS,
  precipitationFor,
  type WeatherLevel,
  type WeatherSnapshot,
} from './weather';
import { biomeV5 } from './worldgen/biomes-v5';
import { strongholdPositions } from './worldgen/structures/strongholds';
import { END_FOUNTAIN, endPillarTops } from './end';
import { VisualEvents, cameraMedium } from './visual-events';
import { copyEnchantments, type EnchantmentId } from './item-metadata';
import { stateStamp, goalForItem, type GameMode, type JourneyGoal } from './gameplay';
import {
  BLOCK,
  BLOCK_X,
  blockBoxes,
  doorState,
  isSoil,
  registry,
  slabState,
  stairsState,
  toggledDoor,
} from '../../content/src/blocks';
import { facingOfYaw, oppositeFacing, type Facing as ShapeFacing } from '../../content/src/shapes';
import { bodyBox, boxHitsWorld, cellBoxes } from './collision';
import { itemRegistry, type ItemDefinition } from '../../content/src/items';
import { VoxelWorld } from './world';
import {
  createPlayer,
  EMPTY_INPUT,
  sanitizeInput,
  tickPlayer,
  playerOverlapsBlock,
  EYE_HEIGHT,
  onLadder,
  type BodyMods,
  type PlayerInput,
} from './player';
import { lookDirection, raycast, type BlockHit } from './raycast';
import type { Vec3 } from './coordinates';
import {
  BITE_HOLD_MIN,
  BITE_HOLD_SPAN,
  FISHING_REACH,
  castBobber,
  fishingCatch,
  nextWait,
  type Bobber,
} from './fishing';
import {
  ItemContainer,
  PlayerInventory,
  PLAYER_MAIN,
  PLAYER_HOTBAR,
  PLAYER_ARMOR,
  PLAYER_OFFHAND,
  PLAYER_MAIN_SLOTS,
  PLAYER_SLOTS,
  addItems,
  addStack,
  clickSlot,
  cloneSlots,
  countItem,
  decodeSlots,
  definition,
  dragPlace,
  dragShare,
  encodeSlots,
  gatherSame,
  hotbarSwap,
  removeItem,
  sameKind,
  slotAccepts,
  stack,
  stacksEqual,
  type Container,
  type Slot,
  type SlotData,
} from './inventory';
import { breakTicks, damageTool, instantBreak, rollDrops, type DroppedStack } from './mining';
import {
  ContainerStore,
  tickFurnaces,
  chestObstructed,
  chestPlacementAllowed,
  CHEST_SLOTS,
  FURNACE_SLOTS,
  FURNACE_OUTPUT,
  FURNACE_INPUT,
  FURNACE_FUEL,
  CONTAINER_VIEW_REGIONS,
  positionKey,
} from './containers';
import type { SavedContainer } from './persistence';
import { ItemEntityStore, withinPickupRange, type SavedItemEntity } from './entities';
import {
  Survival,
  attackStatsOf,
  difficultyDamageScale,
  DIFFICULTIES,
  DIFFICULTY_NAMES,
  MAX_FOOD,
  type DamageType,
  type Difficulty,
  type SavedSurvival,
} from './survival';
import {
  ARROW_SPEED,
  BOW_CHARGE_TICKS,
  BOW_MIN_CHARGE_TICKS,
  CRITICAL_MULTIPLIER,
  ENTITY_REACH,
  armorOf,
  armorSlotFor,
  armorWearFor,
  arrowDamage,
  attackCharge,
  isCritical,
  ARROW_GRAVITY,
  KNOCKBACK_VERTICAL,
  knockbackVector,
  shieldBlocks,
  sweepTargets,
} from './combat';
import {
  MAX_MOBS,
  MOB_GROW_TICKS,
  MobStore,
  mobDefinition,
  woolItem,
  type MobDeath,
  type MobEntity,
  type SavedMob,
} from './mobs';
import {
  ArrowStore,
  GHAST_FIREBALL_DAMAGE,
  OrbStore,
  type ArrowHit,
  type ArrowTarget,
  type ProjectileLanding,
  type SavedArrow,
  type SavedOrb,
} from './projectiles';
import { dayTime, isNight, DAY_TICKS } from './world';
import { effectDefinition } from './effects';
import { MAX_HEALTH } from './survival';
import { CartStore, type SavedCart } from './vehicles';
import type {
  SavedFalling,
  SavedFire,
  SavedFluid,
  SavedComponent,
  SavedEnchantment,
  BrewingState,
} from './saved-types';
import { BREW_TICKS } from './stations';
import { FluidSystem } from './fluids';
import { BlockSimulation } from './blocksim';
import { LightEngine } from './lighting';
import { PlantSystem } from './farming';
import { isBiomePreset } from './overworld';
import { generatorV5 } from './worldgen/generator-v5';
import { villageHomes } from './worldgen/structures/villages';
import {
  PROFESSION_NAMES,
  TRADE_MAX_USES,
  VILLAGER_PROFESSIONS,
  professionOf,
  tradesFor,
} from './trading';
import { LeafDecay, isLog } from './leaf-decay';
import { RedstoneSystem, facingFromYaw, facingVector, type Facing } from './redstone';
import {
  BossStore,
  dragonEggSpot,
  endFountainHome,
  type BossDeath,
  type BossEntity,
  type SavedBossState,
} from './bosses';
import { buildExitPortal } from './portals';
import { portalDelay, type DimensionId } from './dimensions';
import { structuresNear } from './structures';
import { seedHash } from './random';
import { DEFAULT_PRESET, type WorldPreset } from './terrain';
import {
  END_FRAME_RING,
  endPortalComplete,
  fitEye,
  lightPortalNear,
  openEndPortal,
} from './portals';
import {
  BREW_FUEL_PER_POWDER,
  BrewingContainer,
  BrewingStore,
  BLAZE_POWDER_ITEM,
  EnchantmentTable,
  ENCHANT_LAPIS_PER_OFFER,
  anvilResult,
  type EnchantOffer,
} from './stations';
import {
  consumeGrid,
  gridResult,
  planFor,
  recipeBook,
  ingredientMatches,
  fuelTicks,
  smeltingFor,
  recipeById,
  type RecipeEntry,
} from './crafting';
/** Villages within this distance of the player get their villagers. */
const VILLAGE_POPULATE_RADIUS = 56;
/** Villages this close show on the compass strip. */
const LANDMARK_RADIUS = 512;
/** Ticks between two villagers moving into a village that lost some. */
const VILLAGE_TOP_UP_TICKS = 2400;
export interface Edit {
  x: number;
  y: number;
  z: number;
  before: number;
  state: number;
}
export interface InteractionResult {
  ok: boolean;
  reason?: string;
  edit?: Edit;
  picked?: number;
  message?: string;
  opened?: OpenContainerKind | null;
  dropped?: number;
  /** Damage dealt to a creature, for tests and messages. */
  damage?: number;
  killed?: string;
}
export type OpenContainerKind =
  | 'crafting'
  | 'crafting_table'
  | 'chest'
  | 'furnace'
  | 'enchanting'
  | 'brewing'
  | 'anvil'
  | 'dispenser'
  | 'dropper'
  | 'hopper'
  | 'trade';
/** Slots a station shows before the player inventory: ingredient, bottles, fuel, and so on. */
export const STATION_SLOTS: Record<string, number> = {
  enchanting: 1,
  brewing: 5,
  anvil: 3,
};
export interface OpenContainer {
  kind: OpenContainerKind;
  key: string | null;
  gridSize: 2 | 3;
  /** View for container kinds that live in the world. */
  view: Container | null;
  title: string;
}
export interface MiningState {
  x: number;
  y: number;
  z: number;
  progress: number;
  ticks: number;
  state: number;
}
export interface FurnaceView {
  burn: number;
  burnTotal: number;
  cook: number;
  cookTotal: number;
  lit: boolean;
  /** Experience banked in this furnace; the survival stage will award it. */
  xp: number;
}
export interface ContainerView {
  kind: OpenContainerKind;
  title: string;
  key: string | null;
  container: SlotData[];
  gridSize: 2 | 3;
  grid: SlotData[];
  result: SlotData;
  furnace: FurnaceView | null;
  /** Brewing stand: ingredient, three bottles, fuel charges and progress. */
  brewing: {
    ingredient: SlotData;
    bottles: SlotData[];
    fuel: number;
    progress: number;
    total: number;
  } | null;
  /** Anvil: the two inputs and what taking the result would cost. */
  anvil: {
    first: SlotData;
    second: SlotData;
    result: SlotData;
    cost: number;
    message: string | null;
  } | null;
  /** Enchanting table: the offers for the item in its slot. */
  enchant: {
    item: SlotData;
    offers: EnchantOffer[];
    levels: number;
    lapis: number;
    /** Item kind a given offer would enchant, or null when the slot is empty. */
    target: string | null;
  } | null;
  /** A villager's offers: what each costs, what it gives, whether it can be paid now. */
  trade: {
    profession: string;
    offers: {
      give: SlotData[];
      get: SlotData;
      affordable: boolean;
      left: number;
    }[];
  } | null;
  recipes: RecipeEntry[];
  /** Region layout of the combined view, so the interface can place slots without guessing. */
  regions: readonly { name: string; from: number; to: number }[];
}
export interface SlotClickOptions {
  shift?: boolean;
  /** Double click gathers every stack of the same kind onto the cursor. */
  double?: boolean;
  /** Dragging over slots; `share` splits a left-drag stack evenly. */
  drag?: boolean;
  share?: boolean;
  slotsLeft?: number;
  /** Number key pressed while hovering a slot: swap with that hotbar slot. */
  number?: number;
}
export interface SimulationOptions {
  readonly seedRandom?: () => number;
  /** The world preset, so the eye of ender asks the generator that built this world. */
  readonly preset?: WorldPreset;
  readonly generatorVersion?: number;
  readonly ensureArea?: (x: number, z: number) => void;
}
/** Everything that lives in the coordinates of one dimension, kept while the player is away. */
export interface DimensionState {
  mobs: SavedMob[];
  arrows: SavedArrow[];
  orbs: SavedOrb[];
  items: SavedItemEntity[];
  containers: SavedContainer[];
  blocks: Partial<ReturnType<Simulation['blockData']>>;
  brewing: { key: string; state: BrewingState }[];
  carts: SavedCart[];
  bosses: SavedBossState;
}
/** Ticks the reference spends eating one item. */
export const EAT_TICKS = 32;
/** Ticks between two blocks broken by a held button in creative. */
const CREATIVE_BREAK_DELAY = 5;
export class Simulation {
  readonly visualEvents = new VisualEvents();
  readonly player;
  readonly inventory = new PlayerInventory();
  readonly containers = new ContainerStore();
  readonly entities = new ItemEntityStore();
  readonly mobs = new MobStore();
  readonly arrows = new ArrowStore();
  /** The dragon, the wither, the crystals on the pillars and the skulls in the air. */
  readonly bosses = new BossStore();
  readonly orbs = new OrbStore();
  readonly survival: Survival;
  /** Light levels for crops, creature spawns and lamps; rebuilt per dimension. */
  light!: LightEngine;
  /** Water and lava: sources, flows and the spread rules between them. */
  fluids!: FluidSystem;
  /** Falling blocks, fire and explosions. */
  blockSim!: BlockSimulation;
  /** Crops, saplings, cane and cacti on random ticks. */
  plants!: PlantSystem;
  /** Crowns that lost their trunk fall apart over the next seconds. */
  leafDecay!: LeafDecay;
  /** Redstone components, their power and their side effects. */
  redstone!: RedstoneSystem;
  /** The preset this world was generated with. */
  readonly worldPreset: WorldPreset;
  readonly generatorVersion: number;
  private readonly ensureArea?: (x: number, z: number) => void;
  /** Ticks the player has been standing in a block that carries them to another dimension. */
  portalTicks = 0;
  /** Set when a portal has held the player long enough; the session performs the move. */
  pendingTravel: DimensionId | null = null;
  /** What each dimension left behind: creatures, drops, chests, burning fire, redstone. */
  private readonly dimensionState = new Map<DimensionId, DimensionState>();
  /** Enchantments the player has applied at a table, remembered per item kind. */
  readonly enchantments = new EnchantmentTable();
  /** Brewing stands and what is cooking in them. */
  readonly brewing = new BrewingStore();
  /** The anvil interface: two inputs and the result the player may take. */
  anvilFirst: Slot = null;
  anvilSecond: Slot = null;
  /** Minecarts on rails, and which one carries the player. */
  readonly carts = new CartStore();
  /** Ticks until the next automatic creature spawn attempt. */
  private spawnCooldown = 0;
  /** Villages whose villagers were placed this session, and when one was last added. */
  private readonly villagesSeen = new Map<string, number>();
  /** The fishing bobber in the water (not saved, as in the reference). */
  private bobber: Bobber | null = null;
  private villageClock = 0;
  /**
   * Natural creature spawns: on in the game, off in tests, so that the population of a test is
   * exactly what the scenario placed. The browser client switches them on when it starts a world.
   */
  naturalSpawns = false;
  input: PlayerInput = { ...EMPTY_INPUT };
  /** What status effects and slime do to the body this tick; `tickPlayer` reads and fills it. */
  readonly body: BodyMods = {};
  cursor: Slot = null;
  /** Ticks until held creative mining may break the next block (the reference waits five). */
  private creativeBreakDelay = 0;
  mining: MiningState | null = null;
  open: OpenContainer | null = null;
  grid: ItemContainer = new ItemContainer(4, [{ name: 'container', from: 0, to: 4 }]);
  edits = 0;
  messages: string[] = [];
  private miningActive = false;
  private random: () => number;
  /** Ticks since the last melee swing, for the attack charge. */
  attackTicks = 120;
  /** Right mouse button is held: eating, drawing a bow or raising a shield. */
  useHeld = false;
  /** Ticks the current use action has been running. */
  useTicks = 0;
  /** Ticks a bow has been drawn. */
  bowCharge = 0;
  /** Set while a finished action is running, so a partial one can be reported. */
  private eating = false;
  private deathHandled = false;
  private explicitTimeRevision = 0;
  private storageProjection: {
    containers: SavedContainer[];
    itemEntities: SavedItemEntity[];
  } | null = null;
  gameMode: GameMode = 'survival';
  readonly journey = new Set<JourneyGoal>();
  constructor(
    /** The dimension the player is in; swapped when a portal carries them away. */
    public world: VoxelWorld,
    readonly spawn: Vec3,
    options: SimulationOptions = {},
  ) {
    this.worldPreset = options.preset ?? DEFAULT_PRESET;
    this.generatorVersion = options.generatorVersion ?? 4;
    this.ensureArea = options.ensureArea;
    this.player = createPlayer(spawn);
    this.survival = new Survival(spawn);
    this.random = options.seedRandom ?? Math.random;
    this.attachWorld();
  }
  /**
   * Builds every system that is bound to one world. Called for the first dimension and again
   * whenever a portal moves the player, so a dimension always has systems of its own.
   */
  private attachWorld(): void {
    this.light = new LightEngine(this.world);
    this.fluids = new FluidSystem(this.world);
    this.blockSim = new BlockSimulation(this.world, () => this.random());
    this.plants = new PlantSystem({
      world: this.world,
      light: this.light,
      isNight: () => this.isNight,
      random: () => this.random(),
    });
    this.leafDecay = new LeafDecay(this.world, () => this.random());
    this.redstone = new RedstoneSystem(this.world, {
      write: (x, y, z, state) => void this.setBlockState(x, y, z, state),
      containerSignal: (x, y, z) => this.containerSignalAt(x, y, z),
      eject: (x, y, z, facing, kind) => this.ejectFrom(x, y, z, facing, kind),
      entityOn: (x, y, z) => this.entityOnBlock(x, y, z),
      prime: (x, y, z) => this.blockSim.prime(x, y, z),
    });
    // Every system that writes on its own (fluids, explosions) reports back here, so the
    // journal, the mesh invalidation and the redstone network all see the change.
    this.fluids.onWrite = (x, y, z, before, state) => this.afterBlockChange(x, y, z, before, state);
    this.blockSim.onWrite = (x, y, z, before, state) =>
      this.afterBlockChange(x, y, z, before, state);
    this.blockSim.onPrime = (x, y, z) => this.sound('fuse', x + 0.5, y + 0.5, z + 0.5);
    // A primed charge turns its crater into drops and experience, and pushes what stands near.
    this.blockSim.onExplosion = (result, center, radius) => {
      this.spawnBlastLoot(result);
      this.applyExplosion(center, radius, result.pushed);
      if (result.removed.length > 0) this.note('Взрыв');
    };
  }
  /** The dimension state as it is now, ready to be put away. */
  private captureDimension(): DimensionState {
    return {
      mobs: this.savedMobs(),
      arrows: this.savedArrows(),
      orbs: this.savedOrbs(),
      items: this.entities.snapshot(),
      containers: this.containerData(),
      blocks: this.blockData(),
      brewing: this.brewingData(),
      carts: this.savedCarts(),
      bosses: this.bosses.snapshot(),
    };
  }
  /** Puts a stored dimension back in place, or empties every store for a fresh one. */
  private applyDimensionState(state: DimensionState | undefined): void {
    const empty: DimensionState = {
      mobs: [],
      arrows: [],
      orbs: [],
      items: [],
      containers: [],
      blocks: {},
      brewing: [],
      carts: [],
      bosses: { bosses: [], crystals: [] },
    };
    const data = state ?? empty;
    this.restoreMobs(data.mobs);
    this.restoreArrows(data.arrows);
    this.restoreOrbs(data.orbs);
    this.entities.restore(data.items);
    this.restoreContainerData(data.containers);
    this.restoreBrewingData(data.brewing);
    this.restoreCarts(data.carts);
    this.bosses.restore(data.bosses);
    this.restoreBlockData(data.blocks ?? {});
  }
  /**
   * Moves the player to another dimension. Everything that lives in the coordinates of the old
   * dimension is put aside: a chest, a creature or a burning fire in the Nether may share
   * coordinates with one in the Overworld, and each keeps its own state.
   */
  changeDimension(world: VoxelWorld, position: Vec3, look?: { yaw: number; pitch: number }): void {
    this.returnGrid();
    this.returnCursor();
    this.closeContainer();
    this.cancelActions();
    this.storageProjection = null;
    if (world.dimensionID !== this.world.dimensionID) {
      this.dimensionState.set(this.world.dimensionID, this.captureDimension());
      // There is one travelling player's clock, not a rewind every time an old World is reused.
      world.time = this.world.time;
      world.tick = this.world.tick;
      this.world = world;
      this.attachWorld();
      this.applyDimensionState(this.dimensionState.get(world.dimensionID));
      this.dimensionState.delete(world.dimensionID);
    }
    this.portalTicks = 0;
    this.pendingTravel = null;
    this.open = null;
    this.player.position = { ...position };
    this.player.velocity = { x: 0, y: 0, z: 0 };
    this.player.onGround = false;
    if (look) {
      this.input.yaw = look.yaw;
      this.input.pitch = look.pitch;
    }
  }
  /**
   * Which dimension a portal block leads to. A Nether portal always leads to the other side of
   * the Nether, an End portal to the End, and each of them back to the Overworld.
   */
  private portalTarget(state: number): DimensionId | null {
    if (state === BLOCK.NETHER_PORTAL)
      return this.world.dimensionID === 'nether' ? 'overworld' : 'nether';
    if (state === BLOCK.END_PORTAL) return this.world.dimensionID === 'end' ? 'overworld' : 'end';
    return null;
  }
  /** Every fight ticks, even while the player is dead: a boss does not wait. */
  private tickBosses(): void {
    this.bosses.tick({
      world: this.world,
      playerPosition: this.player.position,
      playerDead: this.survival.dead,
      hurtPlayer: (amount, type, from) => void this.damagePlayer(amount, type, from),
      explode: (x, y, z, radius) => {
        if (radius > 0) this.blockSim.explode(x, y, z, radius);
      },
      random: () => this.random(),
    });
  }
  /** Bosses within reach of the crosshair, for a melee swing. */
  private bossInFront(): BossEntity | undefined {
    if (!this.bosses.count) return undefined;
    const eye = this.eyePosition();
    const direction = lookDirection(this.input.yaw, this.input.pitch);
    const blockHit = this.target();
    let limit = ENTITY_REACH + 2;
    if (blockHit)
      limit = Math.min(
        limit,
        Math.hypot(blockHit.x + 0.5 - eye.x, blockHit.y + 0.5 - eye.y, blockHit.z + 0.5 - eye.z),
      );
    for (let distance = 0.1; distance <= limit; distance += 0.2) {
      const point = {
        x: eye.x + direction.x * distance,
        y: eye.y + direction.y * distance,
        z: eye.z + direction.z * distance,
      };
      for (const boss of this.bosses.list) {
        const half = boss.kind === 'ender_dragon' ? 5 : 0.9;
        const height = boss.kind === 'ender_dragon' ? 6 : 2.6;
        if (
          point.x >= boss.position.x - half &&
          point.x <= boss.position.x + half &&
          point.y >= boss.position.y &&
          point.y <= boss.position.y + height &&
          point.z >= boss.position.z - half &&
          point.z <= boss.position.z + half
        )
          return boss;
      }
    }
    return undefined;
  }
  private crystalInFront() {
    const eye = this.eyePosition(),
      direction = lookDirection(this.input.yaw, this.input.pitch);
    const block = this.target();
    const limit = Math.min(ENTITY_REACH + 1, block?.distance ?? Infinity);
    for (let d = 0.1; d <= limit; d += 0.15) {
      const x = eye.x + direction.x * d,
        y = eye.y + direction.y * d,
        z = eye.z + direction.z * d;
      const crystal = this.bosses.crystals.find(
        (c) =>
          Math.abs(c.position.x - x) < 0.65 &&
          Math.abs(c.position.z - z) < 0.65 &&
          y >= c.position.y &&
          y <= c.position.y + 1.8,
      );
      if (crystal) return crystal;
    }
    return undefined;
  }
  hurtCrystal(id: number): boolean {
    const crystal = this.bosses.crystals.find((c) => c.id === id);
    if (!crystal) return false;
    this.bosses.hurtCrystal(crystal, {
      world: this.world,
      playerPosition: this.player.position,
      playerDead: this.survival.dead,
      hurtPlayer: (amount, type, from) => void this.damagePlayer(amount, type, from),
      explode: (x, y, z, radius) => void this.blockSim.explode(x, y, z, radius),
      random: this.random,
    });
    this.visualEvents.emit(this.world.tick, 'crystal', crystal.position, undefined, 3);
    this.note('Кристалл разрушен');
    return true;
  }
  /** Damage a boss, with everything a death leaves behind. Melee, arrows and tests use it. */
  hurtBoss(boss: BossEntity, amount: number): BossDeath | null {
    const death = this.bosses.hurt(boss, amount);
    this.visualEvents.emit(
      this.world.tick,
      'hit',
      { ...boss.position, y: boss.position.y + 2 },
      undefined,
      2,
    );
    if (death) this.onBossDeath(death);
    return death;
  }
  /** The dragon's death: the egg on the fountain, the exit portal, and a rain of experience. */
  private onDragonDeath(death: BossDeath): void {
    const world = this.world;
    this.ensureArea?.(END_FOUNTAIN.x, END_FOUNTAIN.z);
    buildExitPortal(world);
    // The egg lands on the middle of the exit portal once the portal has been built: it would
    // otherwise be swept away by the blocks the portal clears for itself.
    const egg = dragonEggSpot();
    if (world.getBlock(egg.x, egg.y, egg.z) === BLOCK.AIR)
      world.setBlock(egg.x, egg.y, egg.z, BLOCK.DRAGON_EGG);
    this.orbs.spawn(1200, { x: death.position.x, y: death.position.y, z: death.position.z });
    for (let i = 0; i < 4; i++)
      this.orbs.spawn(500, {
        x: death.position.x + (this.random() - 0.5) * 4,
        y: death.position.y,
        z: death.position.z + (this.random() - 0.5) * 4,
      });
    this.note('Дракон Края побеждён! Открыт выход из Края');
  }
  /** Explicit repeat fight: place four crystals at the cardinal edges of the exit fountain. */
  checkDragonRitual(): boolean {
    if (this.world.dimensionID !== 'end' || !this.bosses.dragonDefeated || this.bosses.dragon)
      return false;
    const ritual = [
      [-3, 0],
      [3, 0],
      [0, -3],
      [0, 3],
    ].map(([dx, dz]) =>
      this.bosses.crystals.find(
        (c) =>
          Math.floor(c.position.x) === END_FOUNTAIN.x + dx &&
          Math.floor(c.position.z) === END_FOUNTAIN.z + dz &&
          c.position.y >= END_FOUNTAIN.y + 1 &&
          c.position.y <= END_FOUNTAIN.y + 5,
      ),
    );
    if (ritual.some((c) => !c)) return false;
    for (const c of ritual) this.bosses.crystals.splice(this.bosses.crystals.indexOf(c!), 1);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        if (this.world.getBlock(dx, END_FOUNTAIN.y, dz) === BLOCK.END_PORTAL)
          this.setBlockState(dx, END_FOUNTAIN.y, dz, BLOCK.AIR);
    this.bosses.spawnBoss('ender_dragon', endFountainHome());
    for (const top of endPillarTops())
      this.bosses.addCrystal({ x: top.x + 0.5, y: top.y, z: top.z + 0.5 });
    this.note('Дракон призван снова');
    return true;
  }
  private onWitherDeath(death: BossDeath): void {
    this.entities.spawn('lab:nether_star', 1, {
      x: death.position.x,
      y: death.position.y + 0.5,
      z: death.position.z,
    });
    this.orbs.spawn(50, { x: death.position.x, y: death.position.y, z: death.position.z });
    this.note('Иссушитель побеждён');
  }
  private onBossDeath(death: BossDeath): void {
    if (death.kind === 'ender_dragon') this.onDragonDeath(death);
    else this.onWitherDeath(death);
  }
  /**
   * The wither ritual: a T of four soul sand (three in a row with one stacked on the middle)
   * and three skulls on top of it. The last skull placed starts the fight.
   */
  private checkWitherRitual(sx: number, sy: number, sz: number): void {
    if (this.bosses.wither) return;
    for (const [dx, dz] of [
      [1, 0],
      [0, 1],
    ] as const)
      for (const offset of [-1, 0, 1]) {
        const cx = sx - offset * dx,
          cz = sz - offset * dz,
          y = sy - 2;
        const soul = [
          [cx, y, cz],
          [cx - dx, y + 1, cz - dz],
          [cx, y + 1, cz],
          [cx + dx, y + 1, cz + dz],
        ];
        const skulls = [-1, 0, 1].map((n) => [cx + n * dx, y + 2, cz + n * dz]);
        if (
          !soul.every(([x, y, z]) => this.world.getBlock(x, y, z) === BLOCK.SOUL_SAND) ||
          !skulls.every(([x, y, z]) => this.world.getBlock(x, y, z) === BLOCK.WITHER_SKELETON_SKULL)
        )
          continue;
        const spot = { x: cx + 0.5, y: y + 3.2, z: cz + 0.5 };
        this.bosses.spawnBoss('wither', spot, spot);
        for (const [x, y, z] of [...soul, ...skulls]) this.setBlockState(x, y, z, BLOCK.AIR);
        this.note('Иссушитель пробудился!');
        return;
      }
  }
  /** Standing inside a portal for long enough asks the session to move the player. */
  private updatePortalStanding(): void {
    if (this.survival.dead) {
      this.portalTicks = 0;
      return;
    }
    const target = this.portalBlockTarget();
    if (!target) {
      this.portalTicks = 0;
      return;
    }
    this.portalTicks++;
    if (this.portalTicks >= this.portalDelayTicks) this.pendingTravel = target;
  }
  /** How long the player must stand in the block under him, in ticks. The End is instant. */
  get portalDelayTicks(): number {
    return this.portalBlockTarget() === 'end' ? 1 : portalDelay(this.world.dimensionID);
  }
  private portalBlockTarget(): DimensionId | null {
    const p = this.player.position;
    const x = Math.floor(p.x),
      z = Math.floor(p.z);
    for (const y of [Math.floor(p.y), Math.floor(p.y + 1)]) {
      const target = this.portalTarget(this.world.getBlock(x, y, z));
      if (target) return target;
    }
    return null;
  }
  /** Leaves the world in place and puts the player where the portal rules send him. */
  travelTo(world: VoxelWorld, position: Vec3, look?: { yaw: number; pitch: number }): void {
    this.changeDimension(world, position, look);
  }
  /** Every dimension the player has left, as the save file carries it. */
  dimensionSnapshot(): { dimension: DimensionId; state: DimensionState }[] {
    return [...this.dimensionState].map(([dimension, state]) => ({ dimension, state }));
  }
  restoreDimensions(entries: readonly { dimension: DimensionId; state: DimensionState }[]): void {
    this.dimensionState.clear();
    for (const entry of entries) this.dimensionState.set(entry.dimension, entry.state);
  }
  get time(): number {
    return this.world.time;
  }
  private weatherSchedule?: WeatherSchedule;
  /** Lab and debug only: forces the sky instead of the seed's schedule. Never saved. */
  weatherOverride: WeatherLevel | null = null;
  private weatherTops?: { key: string; tops: number[]; ox: number; oz: number };
  /** Rain and thunder now; only the overworld has weather. */
  weatherLevel(): WeatherLevel {
    if (this.world.dimensionID !== 'overworld') return { rain: 0, thunder: 0 };
    if (this.weatherOverride) return this.weatherOverride;
    this.weatherSchedule ??= new WeatherSchedule(seedHash(this.world.seed));
    return this.weatherSchedule.at(this.world.tick);
  }
  /** Ticks until the scheduled weather changes. */
  weatherChangesIn(): number {
    this.weatherSchedule ??= new WeatherSchedule(seedHash(this.world.seed));
    return this.weatherSchedule.changesIn(this.world.tick);
  }
  private weatherSnapshot(): WeatherSnapshot {
    const level = this.weatherLevel();
    const p = this.player.position;
    const bx = Math.floor(p.x),
      by = Math.floor(p.y),
      bz = Math.floor(p.z);
    const column = this.world.column(bx >> 4, bz >> 4);
    const biomeId = column?.biomes?.[(bx & 15) + (bz & 15) * 16];
    const kind =
      biomeId === undefined
        ? 'rain'
        : (() => {
            const b = biomeV5(biomeId);
            return precipitationFor(b.temperature, b.rainfall, by);
          })();
    if (level.rain <= 0) return { ...level, kind, ox: bx, oz: bz };
    // Where drops stop: the top rain-stopping block of each column around the player, looked for
    // in a band around the eyes. Refreshed every half second or when the player changes block.
    const key = `${bx},${by},${bz},${Math.floor(this.world.tick / 10)}`;
    if (this.weatherTops?.key !== key) {
      const r = WEATHER_GRID_RADIUS,
        tops: number[] = [];
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          let y = by + 24;
          for (; y >= by - 20; y--) {
            const def = registry.get(this.world.getBlock(bx + dx, y, bz + dz));
            if (def.solid || def.fluid !== undefined) break;
          }
          tops.push(y + 1);
        }
      this.weatherTops = { key, tops, ox: bx, oz: bz };
    }
    this.weatherSchedule ??= new WeatherSchedule(seedHash(this.world.seed));
    const forced = this.weatherOverride;
    const lightning = this.weatherSchedule.lightning(
      this.world.tick,
      p.x,
      p.z,
      forced ? () => forced.thunder : undefined,
    );
    return {
      ...level,
      kind,
      tops: this.weatherTops.tops,
      ox: this.weatherTops.ox,
      oz: this.weatherTops.oz,
      ...(lightning ? { lightning } : {}),
    };
  }
  get isNight(): boolean {
    return isNight(this.world.time);
  }
  get difficulty(): Difficulty {
    return this.survival.difficulty;
  }
  setDifficulty(difficulty: Difficulty): boolean {
    if (!DIFFICULTIES.includes(difficulty)) return false;
    this.survival.setDifficulty(difficulty);
    this.note(`Сложность: ${DIFFICULTY_NAMES[difficulty]}`);
    return true;
  }
  /** Everything a projectile can hit: the player box and every creature. */
  private arrowTargets(): ArrowTarget[] {
    const targets: ArrowTarget[] = [
      {
        id: -1,
        kind: 'player',
        position: this.player.position,
        halfWidth: 0.3,
        height: 1.8,
      },
    ];
    for (const mob of this.mobs.list) {
      const definition = mobDefinition(mob.kind);
      if (!definition) continue;
      targets.push({
        id: mob.id,
        kind: 'mob',
        position: mob.position,
        halfWidth: definition.width / 2,
        height: definition.height,
      });
    }
    for (const boss of this.bosses.list)
      targets.push({
        id: boss.id,
        kind: 'boss',
        position: boss.position,
        halfWidth: boss.kind === 'ender_dragon' ? 5 : 0.9,
        height: boss.kind === 'ender_dragon' ? 6 : 2.6,
      });
    for (const crystal of this.bosses.crystals)
      targets.push({
        id: crystal.id,
        kind: 'crystal',
        position: crystal.position,
        halfWidth: 0.65,
        height: 1.8,
      });
    return targets;
  }
  get selected(): number {
    return this.inventory.selected;
  }
  get heldItem(): Slot {
    return this.inventory.selectedSlot();
  }
  get heldDefinition(): ItemDefinition | undefined {
    const held = this.heldItem;
    return held ? definition(held) : undefined;
  }
  /**
   * The reference's latched sprint: it starts when the sprint key (or a double tap forward) is
   * pressed while moving forward and then lasts until the player stops going forward, sneaks,
   * runs into a wall, gets hungry (6 food or less) or enters water; holding the key is optional.
   */
  sprinting = false;
  private updateSprint(): void {
    const i = this.input,
      p = this.player;
    const hungry =
      this.gameMode === 'survival' && !p.flying && this.survival.food <= 6 && !this.survival.dead;
    const blocked = i.forward <= 0 || (i.crouch && !p.flying) || hungry || (p.inWater && !p.flying);
    if (blocked || this.survival.dead) this.sprinting = false;
    else if (i.sprint) this.sprinting = true;
  }
  private nearCache: { key: string; value: NearSolid } | null = null;
  /**
   * Which cells around the eye stop a camera: an 11³ bit grid centred on the eye's cell. The
   * host's third-person camera casts against it at frame rate with its own, newer look angles.
   * Rebuilt only when the player changes cell or the world changes.
   */
  nearSolid(): NearSolid {
    const p = this.player.position;
    const cx = Math.floor(p.x),
      cy = Math.floor(p.y + 1.62),
      cz = Math.floor(p.z);
    const key = `${cx},${cy},${cz},${this.world.revision}`;
    if (this.nearCache?.key === key) return this.nearCache.value;
    const size = NEAR_SIZE,
      r = (size - 1) / 2,
      bits = new Uint8Array(Math.ceil((size * size * size) / 8));
    let i = 0;
    for (let y = 0; y < size; y++)
      for (let z = 0; z < size; z++)
        for (let x = 0; x < size; x++, i++)
          if (cellBoxes(this.world, cx - r + x, cy - r + y, cz - r + z).length)
            bits[i >> 3] |= 1 << (i & 7);
    const value = { x: cx - r, y: cy - r, z: cz - r, size, bits };
    this.nearCache = { key, value };
    return value;
  }
  setInput(input: PlayerInput): void {
    this.input = sanitizeInput(input);
  }
  select(slot: number): boolean {
    return this.inventory.select(slot);
  }
  /** Rotates the hotbar without wrapping the inventory. */
  scrollSelection(delta: number): void {
    const next = (((this.inventory.selected + delta) % 9) + 9) % 9;
    this.inventory.select(next);
  }
  private note(message: string): void {
    this.messages.push(message);
    if (this.messages.length > 20) this.messages.shift();
  }
  step(): void {
    this.world.tick++;
    if (this.world.tick % 20 === 0)
      for (const slot of this.inventory.slots) if (slot) this.noteItem(slot.item);
    this.world.time = dayTime(this.world.time + 1);
    this.world.scheduler.due(this.world.tick);
    if (this.attackTicks < 400) this.attackTicks++;
    const wasOnGround = this.player.onGround;
    const wasInWater = this.player.inWater,
      fallSpeed = this.player.velocity.y;
    this.updateSprint();
    const wasSprinting = this.sprinting;
    if (!this.survival.dead) {
      const walled = tickPlayer(
        this.world,
        this.player,
        { ...this.input, sprint: this.sprinting },
        this.movementSpeedScale(),
        this.body,
      );
      // Running into a wall ends a sprint, as it does in the reference.
      if (walled && this.sprinting && !this.player.flying) this.sprinting = false;
    } else this.player.velocity = { x: 0, y: 0, z: 0 };
    if (wasOnGround && this.input.jump && !this.player.flying)
      this.survival.addExhaustion(wasSprinting ? 0.2 : 0.05);
    if (wasSprinting && this.player.onGround)
      this.survival.addExhaustion(
        0.1 * Math.hypot(this.player.velocity.x, this.player.velocity.z) * 0.05,
      );
    if (!this.survival.dead) {
      if (!wasInWater && this.player.inWater)
        this.visualEvents.emit(
          this.world.tick,
          'splash',
          this.player.position,
          BLOCK.WATER,
          Math.max(1, -fallSpeed / 5),
        );
      if (!wasOnGround && this.player.onGround && fallSpeed < -4)
        this.visualEvents.emit(
          this.world.tick,
          'land',
          this.player.position,
          this.world.getBlock(
            Math.floor(this.player.position.x),
            Math.floor(this.player.position.y - 0.1),
            Math.floor(this.player.position.z),
          ),
          -fallSpeed / 8,
        );
    }
    this.trackFall();
    if (!this.survival.dead) {
      this.advanceMining();
      this.advanceUse();
    }
    const smelted = tickFurnaces(this.containers, this.world);
    if (smelted > 0) this.note(`Печь: готово изделий — ${smelted}`);
    if (!this.survival.dead) this.tickWorldSystems();
    this.tickBosses();
    this.updatePortalStanding();
    this.entities.tick(
      this.world,
      (item) => {
        const def = itemRegistry.find(item.item);
        if (!def) return 0;
        // Pickup never fills the armour or off-hand slots.
        const leftover = addStack(this.inventory, item, 0, PLAYER_MAIN_SLOTS);
        if (item.count > (leftover?.count ?? 0)) {
          this.noteItem(item.item);
          this.visualEvents.emit(this.world.tick, 'pickup', {
            ...this.player.position,
            y: this.player.position.y + 0.5,
          });
        }
        return item.count - (leftover?.count ?? 0);
      },
      (entity) => !this.survival.dead && withinPickupRange(this.player.position, entity),
    );
    if (!this.survival.dead) {
      this.collectArrows();
      this.orbs.tick({
        world: this.world,
        playerPosition: this.player.position,
        playerAlive: true,
        sink: (value) => {
          const gained = this.survival.addXp(value);
          if (gained.levels > 0) this.note(`Опыт: уровень ${gained.level}`);
          return value;
        },
      });
      this.tickSurvival();
      this.tickMobs();
      this.tickArrows();
    } else {
      // A dead player still watches arrows land and orbs drift, but takes no damage.
      this.tickArrows();
    }
    if (this.open && this.open.key && this.open.kind !== 'crafting') {
      const position = this.openPosition();
      if (position && Math.abs(position.x + 0.5 - this.player.position.x) > 6)
        this.closeContainer();
    }
  }
  /**
   * The single write path for blocks changed by the world itself: fluids, explosions, pistons
   * and rails all come through here, so the override journal, the mesh invalidation and the
   * redstone network see exactly the same change a player's edit would produce.
   */
  setBlockState(x: number, y: number, z: number, state: number): boolean {
    const before = this.world.getBlock(x, y, z);
    if (!this.world.setBlock(x, y, z, state)) return false;
    this.afterBlockChange(x, y, z, before, state);
    this.edits++;
    return true;
  }
  private hearingCache: {
    tick: number;
    sky: number;
    lava: { x: number; y: number; z: number } | null;
  } | null = null;
  /**
   * What the sound engine needs to know about the surroundings: how open the sky is at the eyes
   * (caves ring, meadows have birds) and the nearest lava that can be heard bubbling. Scanned
   * twice a second, not every tick.
   */
  private hearingData() {
    const p = this.player.position;
    const cache = this.hearingCache;
    if (!cache || this.world.tick - cache.tick >= 10 || this.world.tick < cache.tick) {
      const ex = Math.floor(p.x),
        ey = Math.floor(p.y + 1.62),
        ez = Math.floor(p.z);
      let lava: { x: number; y: number; z: number } | null = null;
      let best = Infinity;
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -6; dx <= 6; dx++)
          for (let dz = -6; dz <= 6; dz++) {
            const y = ey + dy;
            if (y < 0 || y > 255) continue;
            const def = registry.get(this.world.getBlock(ex + dx, y, ez + dz));
            if (def.fluid !== 'lava') continue;
            const d = dx * dx + dy * dy + dz * dz;
            if (d < best) {
              best = d;
              lava = { x: ex + dx, y, z: ez + dz };
            }
          }
      this.hearingCache = {
        tick: this.world.tick,
        sky: ey >= 0 && ey < 256 ? this.light.skyLight(ex, ey, ez) : 15,
        lava,
      };
    }
    const { sky, lava } = this.hearingCache!;
    return { sky, lava, crouch: this.input.crouch };
  }
  /** A cue for the client's sound engine; drawn by nobody and never saved. */
  private sound(name: string, x: number, y: number, z: number, block?: number): void {
    this.visualEvents.emit(this.world.tick, 'sound', { x, y, z }, block, 1, name);
  }
  /** State changes that make a noise of their own: doors, switches, pistons, fire, buckets. */
  private soundForChange(x: number, y: number, z: number, before: number, state: number): void {
    const was = registry.get(before);
    const def = registry.get(state);
    const cx = x + 0.5,
      cy = y + 0.5,
      cz = z + 0.5;
    if (def.model?.kind === 'door' && was.model?.kind === 'door') {
      if (!def.model.upper && def.model.open !== was.model.open)
        this.sound(def.model.open ? 'door_open' : 'door_close', cx, cy, cz, state);
      return;
    }
    if (def.unlitVariant === before || was.unlitVariant === state) {
      // Lamps light silently; switches and plates click, higher when they turn on.
      if (!def.key.startsWith('lab:lamp'))
        this.sound(def.unlitVariant === before ? 'click_on' : 'click_off', cx, cy, cz, state);
      return;
    }
    const extended = (key: string) => key.endsWith('piston_extended');
    if (/piston$|piston_extended$/.test(def.key) && /piston$|piston_extended$/.test(was.key)) {
      if (extended(def.key) !== extended(was.key))
        this.sound(extended(def.key) ? 'piston_out' : 'piston_in', cx, cy, cz, state);
      return;
    }
    const source = (d: typeof def) => !!d.fluid && (d.fluidLevel ?? 0) === 0;
    if (state === BLOCK.FIRE && before !== BLOCK.FIRE) this.sound('ignite', cx, cy, cz);
    else if (before === BLOCK.FIRE && state === BLOCK.AIR) this.sound('extinguish', cx, cy, cz);
    // A source appearing out of nothing is a poured bucket; a source vanishing, a filled one.
    else if (source(def) && !was.fluid)
      this.sound(def.fluid === 'lava' ? 'bucket_lava' : 'bucket_water', cx, cy, cz, state);
    else if (source(was) && state === BLOCK.AIR)
      this.sound(was.fluid === 'lava' ? 'fill_lava' : 'fill_water', cx, cy, cz, before);
  }
  private afterBlockChange(x: number, y: number, z: number, before: number, state: number): void {
    const def = registry.get(state);
    if (before !== state) this.soundForChange(x, y, z, before, state);
    // A skull placed in the T of soul sand wakes the wither, exactly as in the reference.
    if (state === BLOCK.WITHER_SKELETON_SKULL) this.checkWitherRitual(x, y, z);
    this.fluids.mark(x, y, z);
    this.blockSim.onBlockChange(x, y, z);
    if (isLog(before) && !isLog(state))
      this.leafDecay.blockRemoved(x, y, z, before, this.world.tick);
    this.light.noteEmitter(x, y, z);
    if (def.redstone) this.redstone.note(x, y, z);
    else this.redstone.forget(x, y, z);
    // A neighbour that just got power has to be reconsidered as well.
    for (const [dx, dy, dz] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ] as const)
      if (registry.get(this.world.getBlock(x + dx, y + dy, z + dz)).redstone)
        this.redstone.activateAt(x + dx, y + dy, z + dz);
    // A broken container or brewing stand gives its contents back to the world.
    if (before === BLOCK.BREWING_STAND) {
      const stand = this.brewing.remove(x, y, z);
      for (const bottle of [stand?.ingredient ?? null, ...(stand?.bottles ?? [])])
        if (bottle)
          this.entities.spawn(
            bottle.item,
            bottle.count,
            { x: x + 0.5, y: y + 0.5, z: z + 0.5 },
            bottle.damage ?? 0,
            undefined,
            bottle.enchantments,
          );
    }
    // Plants, torches, rails and the like around the change may have lost what held them.
    if (before !== state) this.checkSupportAround(x, y, z);
    if (before === BLOCK.HOPPER) {
      const hopper = this.containers.remove(x, y, z);
      if (hopper)
        for (const slot of hopper.slots.slots)
          if (slot)
            this.entities.spawn(
              slot.item,
              slot.count,
              { x: x + 0.5, y: y + 0.5, z: z + 0.5 },
              slot.damage ?? 0,
              undefined,
              slot.enchantments,
            );
    }
  }
  /**
   * Pops every neighbour of (x, y, z) that no longer has its support (see support.ts): it breaks
   * with its particles and drops what breaking it by hand would give. Each pop is a change of its
   * own, so a stalk of cane or cactus comes down block by block.
   */
  private checkSupportAround(x: number, y: number, z: number): void {
    const get = (bx: number, by: number, bz: number) => this.world.getBlock(bx, by, bz);
    for (const [dx, dy, dz] of DEPENDENTS) {
      const nx = x + dx,
        ny = y + dy,
        nz = z + dz;
      if (ny < 0 || ny > 255 || !this.world.isLoaded(nx, nz)) continue;
      const state = get(nx, ny, nz);
      if (!supportRule(state) || isSupported(get, nx, ny, nz, state)) continue;
      if (!this.setBlockState(nx, ny, nz, BLOCK.AIR)) continue;
      this.visualEvents.emit(
        this.world.tick,
        'break',
        { x: nx + 0.5, y: ny + 0.5, z: nz + 0.5 },
        state,
      );
      const def = registry.get(state);
      // Only the lower half of a door drops the door.
      if (def.model?.kind === 'door' && def.model.upper) continue;
      this.spawnFor(nx, ny, nz, rollDrops(state, null, this.random));
    }
  }
  /** Ticks the world systems: fluids, falling blocks, fire, redstone, plants and machines. */
  private tickWorldSystems(): void {
    this.fluids.tick();
    this.blockSim.tick();
    this.redstone.tick();
    const brewed = this.brewing.tick();
    if (brewed > 0) this.note(`Варочная стойка: готово зелий — ${brewed}`);
    this.plants.tickActive(this.world.tick, this.player.position);
    this.tickLeafDecay();
    this.tickHoppers();
    this.tickMinecarts();
    this.tickNaturalSpawns();
    this.tickVillages();
    this.tickFishing();
    this.tickSpawners();
  }
  /** Leaves without a trunk vanish and drop what breaking them by hand would give. */
  private tickLeafDecay(): void {
    for (const leaf of this.leafDecay.due(this.world.tick)) {
      if (!this.setBlockState(leaf.x, leaf.y, leaf.z, BLOCK.AIR)) continue;
      this.spawnFor(leaf.x, leaf.y, leaf.z, rollDrops(leaf.state, null, this.random));
    }
  }
  /** Ticks left before each generated spawner may call up creatures again, by position. */
  private readonly spawnerDelay = new Map<string, number>();
  /**
   * Spawners of the v5 structures work as in the reference: with a player within sixteen
   * blocks, every ten to forty seconds one calls up one to four of its creature on open,
   * dark ground around it, unless six of them are already close by.
   */
  private tickSpawners(): void {
    if (!this.naturalSpawns || this.survival.dead || this.survival.difficulty === 'peaceful')
      return;
    if (this.world.tick % 20 !== 0) return;
    const p = this.player.position;
    const pcx = Math.floor(p.x / 16),
      pcz = Math.floor(p.z / 16);
    for (let cx = pcx - 1; cx <= pcx + 1; cx++)
      for (let cz = pcz - 1; cz <= pcz + 1; cz++) {
        const column = this.world.column(cx, cz);
        if (!column?.spawners) continue;
        for (const [index, kind] of column.spawners) {
          const x = cx * 16 + (index & 15),
            y = index >> 8,
            z = cz * 16 + ((index >> 4) & 15);
          if (Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y, z + 0.5 - p.z) > 16) continue;
          if (this.world.getBlock(x, y, z) !== BLOCK.SPAWNER) continue;
          const key = `${x},${y},${z}`;
          const left = this.spawnerDelay.get(key) ?? 20 + Math.floor(this.random() * 180);
          if (left > 0) {
            this.spawnerDelay.set(key, left - 20);
            continue;
          }
          this.spawnerDelay.set(key, 200 + Math.floor(this.random() * 600));
          const def = mobDefinition(kind);
          if (!def) continue;
          const nearby = this.mobs.list.filter(
            (m) =>
              m.kind === kind &&
              Math.abs(m.position.x - x) < 9 &&
              Math.abs(m.position.y - y) < 5 &&
              Math.abs(m.position.z - z) < 9,
          ).length;
          let budget = Math.min(1 + Math.floor(this.random() * 4), 6 - nearby);
          for (let attempt = 0; attempt < 12 && budget > 0; attempt++) {
            const sx = Math.floor(x + (this.random() - this.random()) * 4 + 0.5),
              sy = y + Math.floor(this.random() * 3) - 1,
              sz = Math.floor(z + (this.random() - this.random()) * 4 + 0.5);
            if (!registry.get(this.world.getBlock(sx, sy - 1, sz)).solid) continue;
            const clear = Array.from({ length: Math.ceil(def.height) }, (_, dy) => dy).every(
              (dy) => !registry.get(this.world.getBlock(sx, sy + dy, sz)).solid,
            );
            if (!clear || this.light.lightAt(sx, sy, sz, true) > 9) continue;
            this.mobs.spawn(kind, { x: sx + 0.5, y: sy, z: sz + 0.5 });
            this.visualEvents.emit(
              this.world.tick,
              'explosion',
              { x: sx + 0.5, y: sy + 0.5, z: sz + 0.5 },
              undefined,
              0.2,
            );
            budget--;
          }
        }
      }
  }
  /** Minecarts follow their rails; a powered rail speeds them up, a plain one slows them. */
  private tickMinecarts(): void {
    this.carts.tick(this.world, {
      powered: (x, y, z) => {
        const state = this.world.getBlock(x, y, z);
        if (state === BLOCK.POWERED_RAIL_ON) return true;
        if (state === BLOCK.POWERED_RAIL_OFF) return this.redstone.powerAt(x, y, z) > 0;
        if (state === BLOCK.DETECTOR_RAIL_OFF || state === BLOCK.DETECTOR_RAIL_ON)
          return this.entityOnBlock(x, y + 1, z);
        return false;
      },
      moveRider: (position) => {
        this.player.position.x = position.x;
        this.player.position.y = position.y;
        this.player.position.z = position.z;
        this.player.velocity.x = 0;
        this.player.velocity.z = 0;
      },
    });
  }

  /** Hoppers move one item every eight ticks, into the container below them. */
  private tickHoppers(): void {
    if (this.world.tick % 8 !== 0) return;
    for (const [key, block] of this.containers.entries()) {
      if (block.kind !== 'hopper') continue;
      const [x, y, z] = parseKey(key);
      // A container that was never opened still takes items: the block below decides what it is.
      const below = this.containerBelow(x, y - 1, z);
      if (!below) continue;
      const source = block.slots.slots.findIndex((slot) => slot !== null);
      if (source < 0) continue;
      const slot = block.slots.slots[source]!;
      const target =
        below.kind === 'furnace'
          ? below.slots.slots[0] === null
            ? 0
            : -1
          : below.slots.slots.findIndex(
              (entry) =>
                entry === null ||
                (sameKind(entry, slot) && entry.count < definition(slot).maxStack),
            );
      if (target < 0) continue;
      const destination = below.slots.slots[target];
      if (destination && sameKind(destination, slot)) {
        below.slots.set(target, { ...destination, count: destination.count + 1 });
      } else {
        below.slots.set(target, { ...slot, count: 1 });
      }
      block.slots.set(source, slot.count > 1 ? { ...slot, count: slot.count - 1 } : null);
    }
  }
  /** The container a funnel can pour into: created on demand from the block in the world. */
  private containerBelow(x: number, y: number, z: number): ReturnType<ContainerStore['get']> {
    const known = this.containers.get(x, y, z);
    if (known) return known;
    const state = this.world.getBlock(x, y, z);
    if (state === BLOCK.CHEST) return this.containers.ensure('chest', x, y, z);
    if (state === BLOCK.HOPPER) return this.containers.ensure('hopper', x, y, z);
    if (state === BLOCK.FURNACE || state === BLOCK.FURNACE_LIT)
      return this.containers.ensure('furnace', x, y, z);
    if (state === BLOCK.DISPENSER || state === BLOCK.DROPPER)
      return this.containers.ensure('dispenser', x, y, z);
    return undefined;
  }

  /** Everything standing on a spot: the player, a creature or an item entity. */
  private entityOnBlock(x: number, y: number, z: number): boolean {
    const p = this.player.position;
    if (
      Math.floor(p.x) === x &&
      (Math.floor(p.y) === y || Math.floor(p.y + 1) === y) &&
      Math.floor(p.z) === z
    )
      return true;
    for (const mob of this.mobs.list)
      if (
        Math.floor(mob.position.x) === x &&
        Math.floor(mob.position.y) === y + 1 &&
        Math.floor(mob.position.z) === z
      )
        return true;
    for (const entity of this.entities.list)
      if (
        Math.floor(entity.position.x) === x &&
        Math.floor(entity.position.y) === y + 1 &&
        Math.floor(entity.position.z) === z
      )
        return true;
    return false;
  }
  /** Analog reading a comparator takes from a container behind it, 0-15. */
  private containerSignalAt(x: number, y: number, z: number): number {
    const block = this.containers.get(x, y, z);
    if (!block) return 0;
    const slots = block.slots.slots;
    let filled = 0;
    let capacity = 0;
    for (const slot of slots) {
      capacity += 64;
      if (slot) filled += slot.count;
    }
    if (capacity === 0) return 0;
    return Math.round((filled / capacity) * 15);
  }
  /** A dispenser or dropper spits one item out, dispensed items being used as such. */
  private ejectFrom(
    x: number,
    y: number,
    z: number,
    facing: Facing,
    kind: 'dispenser' | 'dropper',
  ): void {
    const vector = facingVector(facing);
    const block = this.containers.ensure('dispenser', x, y, z);
    const index = block.slots.slots.findIndex((slot) => slot !== null);
    if (index < 0) return;
    const slot = block.slots.slots[index]!;
    const target = { x: x + 0.5 + vector.x, y: y + 0.5, z: z + 0.5 + vector.z };
    block.slots.set(index, slot.count > 1 ? { ...slot, count: slot.count - 1 } : null);
    const item = itemRegistry.find(slot.item);
    // A dispenser uses what it can: buckets pour, flint and steel lights, arrows fly.
    if (kind === 'dispenser' && item?.bucket && item.bucket !== 'empty') {
      const state = item.bucket === 'water' ? BLOCK.WATER : BLOCK.LAVA;
      const tx = Math.floor(target.x),
        ty = Math.floor(target.y),
        tz = Math.floor(target.z);
      if (this.world.getBlock(tx, ty, tz) === BLOCK.AIR) {
        this.setBlockState(tx, ty, tz, state);
        block.slots.set(index, { item: 'lab:bucket', count: 1, damage: 0 });
        return;
      }
    }
    if (kind === 'dispenser' && item?.use === 'ignite') {
      const tx = Math.floor(target.x),
        ty = Math.floor(target.y),
        tz = Math.floor(target.z);
      if (this.blockSim.ignite(tx, ty, tz)) return;
    }
    if (kind === 'dispenser' && item?.key === 'lab:arrow') {
      this.arrows.spawn(
        { x: x + 0.5 + vector.x * 0.6, y: y + 0.5, z: z + 0.5 + vector.z * 0.6 },
        { x: vector.x * 1.1, y: 0.1, z: vector.z * 1.1 },
        3,
        'mob',
        false,
      );
      return;
    }
    this.entities.spawn(
      slot.item,
      slot.count,
      target,
      slot.damage ?? 0,
      kind === 'dispenser' ? { x: vector.x * 0.4, y: 0.1, z: vector.z * 0.4 } : undefined,
      slot.enchantments,
    );
  }
  /** Drops and experience of the blocks an explosion removed. */
  private spawnBlastLoot(result: {
    drops: { item: string; count: number; x: number; y: number; z: number }[];
    removed: { x: number; y: number; z: number; state: number }[];
  }): void {
    for (const drop of result.drops)
      this.entities.spawn(drop.item, drop.count, {
        x: drop.x + 0.5,
        y: drop.y + 0.5,
        z: drop.z + 0.5,
      });
    let xp = 0;
    for (const entry of result.removed) {
      const def = registry.get(entry.state);
      if (!def.xp) continue;
      xp += def.xp[0] + Math.floor(this.random() * (def.xp[1] - def.xp[0] + 1));
    }
    if (xp > 0) {
      const center = result.removed[0] ?? { x: 0, y: 0, z: 0 };
      this.orbs.spawnSplit(
        xp,
        { x: center.x + 0.5, y: center.y + 0.5, z: center.z + 0.5 },
        this.random,
      );
    }
  }

  /** Items pushed into the player by a blast, with fall damage afterwards. */
  private applyExplosion(
    center: Vec3,
    radius: number,
    pushed: { x: number; y: number; z: number; dx: number; dy: number; dz: number }[],
  ): void {
    void pushed;
    this.visualEvents.emit(this.world.tick, 'explosion', center, undefined, radius);
    const p = this.player.position;
    const distance = Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z);
    if (distance <= radius + 0.5) {
      const strength = Math.max(0, 1 - distance / (radius + 0.5));
      // Power scales the harm: a creeper or TNT hits for up to 24, a ghast's fireball for 8.
      this.damagePlayer(
        Math.max(1, Math.round(strength * Math.min(24, 8 * radius))),
        'explosion',
        center,
      );
      const direction = {
        x: (p.x - center.x) / Math.max(0.2, distance),
        y: (p.y - center.y) / Math.max(0.2, distance),
        z: (p.z - center.z) / Math.max(0.2, distance),
      };
      this.player.velocity.x += direction.x * strength * 14;
      this.player.velocity.y += direction.y * strength * 9 + 3 * strength;
      this.player.velocity.z += direction.z * strength * 14;
    }
    for (const mob of [...this.mobs.list]) {
      const mobDistance = Math.hypot(
        mob.position.x - center.x,
        mob.position.y - center.y,
        mob.position.z - center.z,
      );
      if (mobDistance > radius + 0.5) continue;
      const strength = Math.max(0, 1 - mobDistance / (radius + 0.5));
      const death = this.mobs.hurt(
        mob,
        Math.max(1, Math.round(strength * Math.min(30, 10 * radius))),
        {
          x: ((mob.position.x - center.x) / Math.max(0.2, mobDistance)) * strength * 12,
          y: strength * 8,
          z: ((mob.position.z - center.z) / Math.max(0.2, mobDistance)) * strength * 12,
        },
      );
      if (death) this.spawnMobDeath(death);
    }
  }
  /** Random creature spawns: hostiles in the dark at night, animals on lit grass by day. */
  private tickNaturalSpawns(): void {
    if (!this.naturalSpawns) return;
    if (this.survival.dead) return;
    if (this.spawnCooldown > 0) {
      this.spawnCooldown--;
      return;
    }
    this.spawnCooldown = 200;
    const hostiles = this.mobs.list.filter((mob) => mobDefinition(mob.kind)?.hostile).length;
    // Villagers belong to their villages and do not crowd out the animals.
    const villagers = this.mobs.list.filter((mob) => mob.kind === 'lab:villager').length;
    const passives = this.mobs.list.length - hostiles - villagers;
    const dimension = this.world.dimensionID,
      night = dimension !== 'overworld' || this.isNight;
    if (night && (hostiles >= 24 || this.survival.difficulty === 'peaceful')) return;
    if (!night && passives >= 16) return;
    for (let attempt = 0; attempt < 16; attempt++) {
      const angle = this.random() * Math.PI * 2,
        distance = 12 + this.random() * 16;
      const x = Math.floor(this.player.position.x + Math.cos(angle) * distance),
        z = Math.floor(this.player.position.z + Math.sin(angle) * distance);
      if (!this.world.isLoaded(x, z)) continue;
      let y = this.surfaceY(x, z);
      if (dimension === 'nether') {
        // The fortress floor first; otherwise the highest open ground under the roof.
        y = -1;
        let open = -1;
        for (let yy = 116; yy >= 33; yy--) {
          if (![0, 1, 2].every((d) => this.world.getBlock(x, yy + d, z) === BLOCK.AIR)) continue;
          const below = this.world.getBlock(x, yy - 1, z);
          if (below === BLOCK.NETHER_BRICK) {
            y = yy;
            break;
          }
          if (open < 0 && registry.get(below).solid) open = yy;
        }
        if (y < 0) y = open;
      }
      if (y <= 0 || this.world.getBlock(x, y, z) !== BLOCK.AIR) continue;
      const ground = this.world.getBlock(x, y - 1, z),
        light = this.light.lightAt(x, y, z, night);
      let candidates = night
        ? ['lab:zombie', 'lab:skeleton', 'lab:creeper', 'lab:spider', 'lab:enderman']
        : ['lab:cow', 'lab:sheep', 'lab:pig', 'lab:chicken'];
      if (dimension === 'nether') {
        candidates =
          ground === BLOCK.NETHER_BRICK
            ? ['lab:blaze', 'lab:wither_skeleton', 'lab:blaze', 'lab:magma_cube_medium']
            : [
                'lab:ghast',
                'lab:ghast',
                'lab:magma_cube',
                'lab:magma_cube_medium',
                'lab:magma_cube_small',
              ];
      } else if (dimension === 'end') candidates = ['lab:enderman'];
      else if (night && y > 50 && y < 70 && this.biomeKeyAt(x, z) === 'swamp')
        // Swamps breed slimes on dark nights.
        candidates = [...candidates, 'lab:slime', 'lab:slime_medium', 'lab:slime_small'];
      const kind = candidates[Math.floor(this.random() * candidates.length)],
        def = mobDefinition(kind)!;
      if (night && dimension === 'overworld' && light > (def.spawnLightMax ?? 7)) continue;
      if (!night && (light < 9 || !isSoil(ground))) continue;
      if (
        !Array.from({ length: Math.ceil(def.height) }, (_, dy) => dy).every(
          (dy) => !registry.get(this.world.getBlock(x, y + dy, z)).solid,
        )
      )
        continue;
      if (kind === 'lab:ghast') {
        // A ghast needs open air: it appears a few blocks up, in a free 4×4×4 space.
        const at = { x: x + 0.5, y: y + 3, z: z + 0.5 };
        const ghasts = this.mobs.list.filter((mob) => mob.kind === 'lab:ghast').length;
        if (ghasts >= 3 || boxHitsWorld(this.world, bodyBox(at, def.width + 0.5, def.height + 1)))
          continue;
        this.mobs.spawn(kind, at);
        return;
      }
      this.mobs.spawn(kind, { x: x + 0.5, y, z: z + 0.5 });
      return;
    }
  }
  /** The biome key of a column, if it has biome data (generator 5). */
  private biomeKeyAt(x: number, z: number): string | undefined {
    const id = this.world.column(x >> 4, z >> 4)?.biomes?.[(x & 15) + (z & 15) * 16];
    return id === undefined ? undefined : biomeV5(id).key;
  }
  /** First free spot above the ground at a column, which is where a spawn lands. */
  private surfaceY(x: number, z: number): number {
    for (let y = 250; y > 1; y--) {
      const state = this.world.getBlock(x, y, z);
      if (state === BLOCK.AIR) continue;
      if (registry.get(state).solid) return y + 1;
    }
    return -1;
  }

  /** Fall distance and landing damage, with water and flight resetting it. */
  private trackFall(): void {
    const survival = this.survival;
    if (
      this.player.flying ||
      this.player.inWater ||
      this.gameMode === 'creative' ||
      onLadder(this.world, this.player.position)
    ) {
      survival.fallDistance = 0;
      return;
    }
    if (this.body.bounced) {
      // Thrown back up by slime: the fall is over, and it did no harm.
      survival.fallDistance = 0;
      return;
    }
    if (this.player.onGround) {
      const distance = survival.fallDistance;
      survival.fallDistance = 0;
      if (distance > 3 && !survival.dead) {
        const armor = armorOf(this.inventory.slots);
        const damage = survival.landingDamage(distance);
        // Prototype Feather Falling: equipped enchanted boots halve landing damage.
        const boots = this.inventory.get(PLAYER_ARMOR.to - 1);
        const softened = this.enchantments.protectedFromFall(
          boots ? definition(boots) : undefined,
          boots,
        );
        const result = survival.hurt(softened ? damage * 0.5 : damage, 'fall', {
          armor: armor.points,
          toughness: armor.toughness,
        });
        this.applyDamageResult(result, null, damage);
      }
      return;
    }
    if (this.player.velocity.y < 0) survival.fallDistance += -this.player.velocity.y * 0.05;
  }
  private survivalContext() {
    const p = this.player.position;
    const feet = this.world.getBlock(Math.floor(p.x), Math.floor(p.y + 0.1), Math.floor(p.z));
    const eyes = this.world.getBlock(
      Math.floor(p.x),
      Math.floor(p.y + EYE_HEIGHT),
      Math.floor(p.z),
    );
    const eyeDef = registry.get(eyes);
    return {
      position: p,
      onGround: this.player.onGround,
      flying: this.player.flying,
      inWater: this.player.inWater,
      headInWater: eyeDef.fluid === 'water',
      inLava:
        feet === BLOCK.LAVA ||
        eyes === BLOCK.LAVA ||
        registry.get(feet).fluid === 'lava' ||
        registry.get(eyes).fluid === 'lava',
      inFire: feet === BLOCK.FIRE || eyes === BLOCK.FIRE,
      suffocating: eyeDef.solid && !this.player.flying,
      difficulty: this.survival.difficulty,
      effects: this.survival.effects,
    };
  }
  private tickSurvival(): void {
    if (this.gameMode === 'creative') {
      if (this.player.position.y < -64) {
        this.die();
        return;
      }
      this.survival.health = 20;
      this.survival.food = 20;
      this.survival.air = 300;
      return;
    }
    const events = this.survival.tick(this.survivalContext());
    for (const expired of events.effects) this.note(`Эффект закончился: ${expired}`);
    if (events.damage && events.damage.applied > 0) {
      this.applyDamageResult(events.damage, null, events.damage.applied);
    }
  }
  /** Shared tail of every damage source: messages, armour wear and death. */
  private applyDamageResult(
    result: { applied: number; died: boolean; type: DamageType },
    from: Vec3 | null,
    raw: number,
  ): void {
    if (result.applied <= 0) return;
    if (raw > 0) this.wearArmor(raw, armorOf(this.inventory.slots).pieces);
    void from;
    if (result.died) {
      this.note('Игрок погиб');
      this.die();
    }
  }
  private wearArmor(damage: number, pieces: readonly number[]): void {
    const wear = armorWearFor(damage);
    for (const index of pieces) {
      const slot = this.inventory.get(index);
      const durability = slot ? (definition(slot).armor?.durability ?? 0) : 0;
      if (!slot || durability <= 0) continue;
      let actualWear = 0;
      for (let i = 0; i < wear; i++)
        if (this.random() * 100 >= this.enchantments.unbreakingChance(definition(slot), slot))
          actualWear++;
      const next = (slot.damage ?? 0) + actualWear;
      if (next >= durability) {
        this.inventory.set(index, null);
        this.note(`${definition(slot).name} сломался`);
      } else this.inventory.set(index, { ...slot, damage: next });
    }
  }
  /** Arrows that are stuck in the ground come back to the player. */
  private collectArrows(): void {
    for (const arrow of this.arrows.collectable(this.player.position, 1.2)) {
      if (addItems(this.inventory, 'lab:arrow', 1, 0, PLAYER_MAIN_SLOTS) > 0) continue;
      this.arrows.free(arrow.id);
    }
  }
  private tickMobs(): void {
    const deaths = this.mobs.tick({
      world: this.world,
      playerPosition: this.player.position,
      playerAlive: !this.survival.dead,
      playerIgnored: this.gameMode === 'creative',
      playerEye: this.eyePosition(),
      playerLook: lookDirection(this.input.yaw, this.input.pitch),
      damageScale: difficultyDamageScale(this.survival.difficulty),
      random: this.random,
      holdingItem: this.heldItem?.item,
      hurtPlayer: (amount, from, kind) => {
        const dealt = this.damagePlayer(amount, 'mob', from);
        // The wither skeleton's blow withers the player for ten seconds.
        if (dealt > 0 && kind === 'lab:wither_skeleton')
          this.survival.effects.apply('wither', 200, 0);
      },
      shootArrow: (from, to) => {
        // 1.6 blocks a tick like the reference skeleton, aimed high enough to cancel the drop.
        const dx = to.x - from.x,
          dy = to.y - from.y,
          dz = to.z - from.z;
        const length = Math.max(1e-6, Math.hypot(dx, dy, dz));
        const speed = 1.6;
        const lift = ARROW_GRAVITY * 0.5 * (length / speed);
        this.arrows.spawn(
          from,
          {
            x: (dx / length) * speed,
            y: (dy / length) * speed + lift,
            z: (dz / length) * speed,
          },
          3,
          'mob',
          false,
        );
      },
      shootGhastFireball: (from, to) => {
        const dx = to.x - from.x,
          dy = to.y - from.y,
          dz = to.z - from.z;
        const length = Math.max(1e-6, Math.hypot(dx, dy, dz));
        const speed = 0.75;
        this.arrows.spawn(
          from,
          { x: (dx / length) * speed, y: (dy / length) * speed, z: (dz / length) * speed },
          GHAST_FIREBALL_DAMAGE,
          'mob',
          false,
          'ghast_fireball',
        );
      },
      shootFireball: (from, to) => {
        const dx = to.x - from.x,
          dy = to.y - from.y,
          dz = to.z - from.z;
        const length = Math.max(1e-6, Math.hypot(dx, dy, dz));
        const speed = 1;
        // A little scatter, like the reference: a burst of three fans out.
        const spread = () => (this.random() - 0.5) * 0.08;
        this.arrows.spawn(
          from,
          {
            x: (dx / length + spread()) * speed,
            y: (dy / length + spread()) * speed,
            z: (dz / length + spread()) * speed,
          },
          5,
          'mob',
          false,
          'fireball',
        );
      },
      lightAt: (x, y, z) => this.light.lightAt(x, y, z, this.isNight),
      rainAt: (x, y, z) => this.weatherLevel().rain > 0.2 && this.light.skyLight(x, y, z) >= 15,
      dropItem: (item, count, position) =>
        this.entities.spawnDrops(
          [{ item, count }],
          Math.floor(position.x),
          Math.floor(position.y),
          Math.floor(position.z),
          this.random,
        ),
      setBlock: (x, y, z, state) => {
        this.setBlockState(x, y, z, state);
      },
      event: (type, entity, position) => {
        const cue: Record<string, string> = {
          teleport: 'mob_teleport',
          graze: 'mob_graze',
          egg: 'mob_egg',
          leap: 'mob_leap',
          scream: 'enderman_scream',
          fireball: 'blaze_shoot',
          charge: 'blaze_charge',
          hop: 'slime_jump',
          squish: 'slime_land',
          ghast_warn: 'ghast_warn',
          ghast_shoot: 'ghast_shoot',
        };
        if (cue[type]) this.sound(cue[type], position.x, position.y, position.z);
        if (type === 'teleport')
          this.visualEvents.emit(this.world.tick, 'teleport', { ...position, y: position.y + 1.4 });
        if (type === 'graze')
          this.visualEvents.emit(
            this.world.tick,
            'break',
            { x: position.x, y: position.y + 0.1, z: position.z },
            BLOCK.GRASS,
            0.4,
          );
        void entity;
      },
      explode: (position, radius) => {
        const result = this.blockSim.explode(position.x, position.y, position.z, radius);
        this.spawnBlastLoot(result);
        this.applyExplosion(position, radius, result.pushed);
        this.note('Крипер взорвался');
      },
      burnsAt: (position, kind) => {
        const definition = mobDefinition(kind);
        if (!definition?.burnsInDaylight) return false;
        if (this.isNight) return false;
        // Rain puts a burning zombie out and keeps it from catching fire at all.
        if (this.weatherLevel().rain > 0.2) return false;
        const x = Math.floor(position.x),
          y = Math.floor(position.y + 1),
          z = Math.floor(position.z);
        return this.light.skyLight(x, y, z) >= 12 && this.light.blockLight(x, y, z) < 8;
      },
    });
    for (const death of deaths) this.spawnMobDeath(death);
  }
  private tickArrows(): void {
    this.arrows.tick({
      world: this.world,
      targets: this.arrowTargets(),
      landed: (landing) => this.projectileLanded(landing),
      hit: (hit: ArrowHit) => {
        if (hit.kind === 'ghast_fireball') {
          this.ghastFireballHit(hit);
          return;
        }
        if (hit.kind === 'egg') {
          if (hit.target.kind === 'mob') {
            const mob = this.mobs.byId(hit.target.id);
            if (mob) this.mobs.hurt(mob, 0, knockbackVector(hit.from, mob.position, false));
          }
          this.projectileLanded({
            kind: 'egg',
            position: hit.from,
            cell: {
              x: Math.floor(hit.from.x),
              y: Math.floor(hit.from.y),
              z: Math.floor(hit.from.z),
            },
          });
          return;
        }
        if (hit.target.kind === 'player') {
          if (hit.kind === 'fireball') {
            this.damagePlayer(hit.damage, 'fire', hit.from);
            if (!this.survival.effects.has('fire_resistance'))
              this.survival.fireTicks = Math.max(this.survival.fireTicks, 100);
            this.sound('ignite', hit.from.x, hit.from.y, hit.from.z);
            return;
          }
          this.damagePlayer(hit.damage, 'arrow', hit.from);
          return;
        }
        if (hit.target.kind === 'crystal') {
          this.hurtCrystal(hit.target.id);
          return;
        }
        if (hit.target.kind === 'boss') {
          const boss = this.bosses.byId(hit.target.id);
          if (!boss) return;
          const bossDeath = this.hurtBoss(boss, hit.damage);
          if (!bossDeath) this.note(`Босс: −${hit.damage.toFixed(1)}`);
          return;
        }
        const mob = this.mobs.byId(hit.target.id);
        if (!mob) return;
        if (hit.kind === 'fireball' && !mobDefinition(mob.kind)?.fireImmune)
          mob.fireTicks = Math.max(mob.fireTicks, 100);
        const death = this.mobs.hurt(
          mob,
          hit.damage,
          knockbackVector(hit.from, mob.position, false),
        );
        if (death) this.spawnMobDeath(death);
        else this.note(`${mobDefinition(mob.kind)?.name}: −${hit.damage.toFixed(1)}`);
      },
    });
  }
  /**
   * A ghast's fireball strikes: six damage to whatever it hit, then a small explosion (power 1)
   * that sets fire around it. Sent back into a ghast, it kills it outright, as in 1.12.
   */
  private ghastFireballHit(hit: ArrowHit): void {
    const target = hit.target;
    if (target.kind === 'player') this.damagePlayer(hit.damage, 'fire', hit.from);
    else if (target.kind === 'crystal') this.hurtCrystal(target.id);
    else if (target.kind === 'boss') {
      const boss = this.bosses.byId(target.id);
      if (boss) this.hurtBoss(boss, hit.damage);
    } else {
      const mob = this.mobs.byId(target.id);
      if (mob) {
        const death = this.mobs.hurt(
          mob,
          mob.kind === 'lab:ghast' ? 1000 : hit.damage,
          knockbackVector(hit.from, mob.position, false),
        );
        if (death) {
          this.spawnMobDeath(death);
          if (mob.kind === 'lab:ghast') this.note('Гаст сражён собственным огнём!');
        }
      }
    }
    this.ghastBlast(hit.from);
  }
  private ghastBlast(position: Vec3): void {
    const result = this.blockSim.explode(position.x, position.y, position.z, 1);
    this.spawnBlastLoot(result);
    this.applyExplosion(position, 1, result.pushed);
    // Fire takes on a few of the cells around the blast.
    for (let i = 0; i < 5; i++) {
      const x = Math.floor(position.x + (this.random() * 2 - 1) * 1.6),
        y = Math.floor(position.y + (this.random() * 2 - 1) * 1.2),
        z = Math.floor(position.z + (this.random() * 2 - 1) * 1.6);
      if (
        this.world.getBlock(x, y, z) === BLOCK.AIR &&
        registry.get(this.world.getBlock(x, y - 1, z)).solid
      )
        this.blockSim.ignite(x, y, z);
    }
  }
  /** A fireball sets the block it strikes alight; an egg may hatch a chick. */
  private projectileLanded(landing: ProjectileLanding): void {
    const { position, cell } = landing;
    if (landing.kind === 'ghast_fireball') {
      this.ghastBlast(position);
      return;
    }
    if (landing.kind === 'fireball') {
      const x = Math.floor(position.x),
        y = Math.floor(position.y),
        z = Math.floor(position.z);
      if (this.world.getBlock(x, y, z) === BLOCK.AIR) this.blockSim.ignite(x, y, z);
      else this.blockSim.ignite(cell.x, cell.y + 1, cell.z);
      this.sound('ignite', position.x, position.y, position.z);
      return;
    }
    this.visualEvents.emit(this.world.tick, 'break', position, BLOCK_X.SNOW_LAYER, 0.3);
    this.sound('mob_egg', position.x, position.y, position.z);
    // One throw in eight hatches a chick; one of those in thirty-two hatches four.
    if (this.random() < 1 / 8) {
      const chicks = this.random() < 1 / 32 ? 4 : 1;
      for (let i = 0; i < chicks && this.mobs.size < MAX_MOBS; i++) {
        const chick = this.mobs.spawn('lab:chicken', {
          x: position.x,
          y: position.y,
          z: position.z,
        });
        chick.baby = true;
        chick.growth = -MOB_GROW_TICKS;
      }
    }
  }
  /** Damage that arrives at the player, after armour, shielding and effects. */
  damagePlayer(amount: number, type: DamageType, from: Vec3 | null = null): number {
    if (this.survival.dead || this.gameMode === 'creative') return 0;
    const armor = armorOf(this.inventory.slots);
    const enchantArmor = armor.pieces.reduce((total, index) => {
      const slot = this.inventory.get(index);
      return total + this.enchantments.armorBonus(slot ? definition(slot) : undefined, slot);
    }, 0);
    const blocking =
      this.isBlocking() && shieldBlocks(true, from, this.player.position, this.input.yaw);
    if (blocking) {
      // A raised shield stops the whole hit, wearing itself down instead of the player.
      this.wearShield();
      this.note('Щит принял удар');
      if (from) this.playerKnockback(from, 0.2);
      return 0;
    }
    const result = this.survival.hurt(amount, type, {
      armor: armor.points + enchantArmor,
      toughness: armor.toughness,
      bypassArmor: false,
      healthFloor: type === 'poison' ? 1 : 0,
    });
    if (result.applied > 0) {
      this.visualEvents.emit(
        this.world.tick,
        'hit',
        { ...this.player.position, y: this.player.position.y + 1 },
        undefined,
        0.5,
      );
      this.wearArmor(amount, armor.pieces);
      if (from) this.playerKnockback(from);
      this.note(`Получено урона: ${result.applied.toFixed(1)}`);
    }
    if (result.died) {
      this.note('Игрок погиб');
      this.die();
    }
    return result.applied;
  }
  /**
   * Reference knockback on the player: the motion in hand is halved, the impulse is added, and
   * the upward part stops at the 0.4 per tick cap. `scale` damps a hit that a shield absorbed.
   */
  private playerKnockback(from: Vec3, scale = 1): void {
    const push = knockbackVector(from, this.player.position, false);
    this.player.velocity.x = this.player.velocity.x / 2 + push.x * scale;
    this.player.velocity.z = this.player.velocity.z / 2 + push.z * scale;
    this.player.velocity.y = Math.min(
      KNOCKBACK_VERTICAL,
      this.player.velocity.y / 2 + push.y * scale,
    );
  }
  private wearShield(): void {
    for (const index of [PLAYER_OFFHAND.from, this.inventory.selected]) {
      const slot = this.inventory.get(index);
      const def = slot ? definition(slot) : undefined;
      if (!slot || def?.use !== 'shield') continue;
      const durability = def.armor?.durability ?? 336;
      if (this.random() * 100 < this.enchantments.unbreakingChance(definition(slot), slot)) return;
      const next = (slot.damage ?? 0) + 1;
      if (next >= durability) {
        this.inventory.set(index, null);
        this.note('Щит сломался');
      } else this.inventory.set(index, { ...slot, damage: next });
      return;
    }
  }
  /** A shield in either hand counts; the off-hand one wins. */
  isBlocking(): boolean {
    if (!this.useHeld) return false;
    const offhand = this.inventory.get(PLAYER_OFFHAND.from);
    if (offhand && definition(offhand).use === 'shield') return true;
    const held = this.heldItem;
    return !!held && definition(held).use === 'shield';
  }
  private spawnMobDeath(death: MobDeath): void {
    const name = mobDefinition(death.entity.kind)?.name ?? death.entity.kind;
    this.note(`${name} побеждён`);
    const position = death.entity.position;
    this.visualEvents.emit(
      this.world.tick,
      'death',
      { ...position, y: position.y + 0.5 },
      undefined,
      1,
      death.entity.kind,
    );
    for (const drop of death.drops) {
      this.entities.spawnDrops(
        [drop],
        Math.floor(position.x),
        Math.floor(position.y),
        Math.floor(position.z),
        this.random,
      );
    }
    if (death.xp > 0) this.orbs.spawnSplit(death.xp, { ...position }, this.random);
  }
  respawn(at?: Vec3): void {
    this.deathHandled = false;
    const point = at ?? this.survival.spawn;
    this.player.position = { ...point };
    this.player.velocity = { x: 0, y: 0, z: 0 };
    this.player.onGround = false;
    this.mining = null;
    this.useHeld = false;
    this.eating = false;
    this.bowCharge = 0;
    this.survival.respawn();
    this.note('Возрождение на точке появления');
  }
  target(fluids: 'none' | 'sources' = 'none'): BlockHit | null {
    const p = this.player.position;
    return raycast(
      this.world,
      {
        x: p.x,
        y: p.y + EYE_HEIGHT - (this.input.crouch && !this.player.flying ? 0.15 : 0),
        z: p.z,
      },
      lookDirection(this.input.yaw, this.input.pitch),
      6,
      fluids,
    );
  }
  setMining(active: boolean): void {
    this.miningActive = active;
    if (!active) this.mining = null;
  }
  private advanceMining(): void {
    if (this.creativeBreakDelay > 0) this.creativeBreakDelay--;
    if (!this.miningActive) {
      this.mining = null;
      return;
    }
    if (this.gameMode === 'creative' && (this.creativeBreakDelay > 0 || this.holdsSword())) {
      this.mining = null;
      return;
    }
    const hit = this.target();
    if (!hit) {
      this.mining = null;
      return;
    }
    const def = registry.get(hit.state);
    const required =
      this.gameMode === 'creative'
        ? 1
        : breakTicks(hit.state, this.heldItem, this.miningSpeedScale());
    if (!Number.isFinite(required)) {
      this.mining = null;
      return;
    }
    if (
      !this.mining ||
      this.mining.x !== hit.x ||
      this.mining.y !== hit.y ||
      this.mining.z !== hit.z
    )
      this.mining = {
        x: hit.x,
        y: hit.y,
        z: hit.z,
        state: hit.state,
        progress: 0,
        ticks: required,
      };
    this.mining.progress++;
    this.mining.ticks = required;
    if (this.mining.progress >= required) {
      const at = { ...this.mining };
      this.mining = null;
      this.breakBlock(at.x, at.y, at.z, at.state);
      if (this.gameMode === 'creative') this.creativeBreakDelay = CREATIVE_BREAK_DELAY;
    }
    void def;
  }
  /** One hit: instant for plants, otherwise a single tick of progress. */
  hitBlock(): InteractionResult {
    const hit = this.target();
    if (!hit) return { ok: false, reason: 'Подойди ближе к блоку' };
    if (this.gameMode === 'creative') {
      // A sword never breaks blocks in creative, like the reference: it is for fighting.
      if (this.holdsSword()) return { ok: false, reason: 'Мечом в творчестве блоки не ломаются' };
      this.breakBlock(hit.x, hit.y, hit.z, hit.state);
      this.creativeBreakDelay = CREATIVE_BREAK_DELAY;
      return { ok: true, message: 'Блок разрушен' };
    }
    if (instantBreak(hit.state, this.heldItem)) {
      this.breakBlock(hit.x, hit.y, hit.z, hit.state);
      return { ok: true, message: 'Блок разрушен' };
    }
    const required = breakTicks(hit.state, this.heldItem, this.miningSpeedScale());
    if (!Number.isFinite(required)) return { ok: false, reason: 'Основание мира защищено' };
    this.mining = {
      x: hit.x,
      y: hit.y,
      z: hit.z,
      state: hit.state,
      progress: 1,
      ticks: required,
    };
    return { ok: true, message: 'Добываем блок — удерживай кнопку' };
  }
  /** Speed and slowness effects scale walking, not flight, as in the reference game. */
  private movementSpeedScale(): number {
    if (this.player.flying) return 1;
    const speed = this.survival.effects.level('speed');
    const slowness = this.survival.effects.level('slowness');
    let scale = 1;
    if (speed > 0) scale *= 1 + 0.2 * speed;
    if (slowness > 0) scale *= Math.max(0.1, 1 - 0.15 * slowness);
    return scale;
  }
  /** Haste, mining fatigue and the Efficiency enchantment scale the mining speed. */
  private miningSpeedScale(): number {
    const haste = this.survival.effects.level('haste');
    const fatigue = this.survival.effects.level('mining_fatigue');
    let scale = 1;
    if (haste > 0) scale *= 1 + 0.2 * haste;
    if (fatigue > 0) scale *= Math.max(0.1, 1 - 0.1 * fatigue);
    scale *= this.enchantments.miningScale(this.heldDefinition, this.heldItem);
    return scale;
  }
  private holdsSword(): boolean {
    return this.heldItem?.item.endsWith('_sword') ?? false;
  }
  private damageHeldTool(allowNonTool = false): void {
    if (this.gameMode === 'creative') return;
    const held = this.heldItem;
    if (!held || (!definition(held).tool && !allowNonTool)) return;
    // Unbreaking rolls once per point of damage; a success means no wear at all.
    if (this.random() * 100 < this.enchantments.unbreakingChance(definition(held), held)) return;
    const result = damageTool(held);
    this.inventory.set(this.inventory.selected, result.stack);
    if (result.broke) this.note(`${definition(held).name} сломался`);
  }
  private spawnFor(x: number, y: number, z: number, drops: readonly DroppedStack[]): void {
    if (!drops.length) return;
    this.entities.spawnDrops(drops, x, y, z, this.random);
  }
  breakBlock(x: number, y: number, z: number, expected?: number): boolean {
    const state = this.world.getBlock(x, y, z);
    if (expected !== undefined && state !== expected) return false;
    const def = registry.get(state);
    if (def.protected || state === BLOCK.AIR) return false;
    const held = this.heldItem;
    const drops: { item: string; count: number }[] = rollDrops(state, held, this.random).map(
      (entry) => ({ ...entry }),
    );
    const fortune = this.enchantments.fortuneLevel(held ? definition(held) : undefined, held);
    if (fortune > 0 && def.drops)
      for (const drop of def.drops) {
        if (drop.shears !== undefined || drop.replaces) continue;
        if (this.random() * 100 >= (fortune * 100) / 3) continue;
        const existing = drops.find((entry) => entry.item === drop.item);
        if (existing) existing.count += 1;
        else drops.push({ item: drop.item, count: 1 });
      }
    if (!this.setBlockState(x, y, z, BLOCK.AIR)) return false;
    if (def.model?.kind === 'door') {
      // A door is one object: the other half goes with it and only the lower half drops.
      const other = def.model.upper ? y - 1 : y + 1;
      if (registry.get(this.world.getBlock(x, other, z)).model?.kind === 'door') {
        this.setBlockState(x, other, z, BLOCK.AIR);
        if (def.model.upper) drops.push({ item: registry.get(def.base ?? state).key, count: 1 });
      }
    }
    if (state === BLOCK_X.SNOW_LAYER && this.world.getBlock(x, y - 1, z) === BLOCK_X.GRASS_SNOWY)
      this.setBlockState(x, y - 1, z, BLOCK.GRASS);
    this.visualEvents.emit(this.world.tick, 'break', { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, state);
    // Creative breaking leaves nothing behind: no block item and no experience. Container
    // contents still spill out, as in the reference.
    const creative = this.gameMode === 'creative';
    if (!creative) this.spawnFor(x, y, z, drops);
    if (def.xp && !creative) {
      const value = def.xp[0] + Math.floor(this.random() * (def.xp[1] - def.xp[0] + 1));
      if (value > 0)
        this.orbs.spawnSplit(value, { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, this.random);
    }
    const container = this.containers.remove(x, y, z);
    if (container)
      for (const slot of container.slots.slots)
        if (slot)
          this.entities.spawn(
            slot.item,
            slot.count,
            { x: x + 0.5, y: y + 0.5, z: z + 0.5 },
            slot.damage ?? 0,
            undefined,
            slot.enchantments,
          );
    this.damageHeldTool();
    this.survival.addExhaustion(0.005);
    return true;
  }
  /**
   * Right click. Food, a bow and a shield start a held action; a container or a bed acts at
   * once; anything else places the held block.
   */
  use(): InteractionResult {
    if (this.survival.dead) return { ok: false, reason: 'Игрок погиб' };
    // A villager in front answers the right button with its offers, whatever is in the hand.
    if (!this.input.crouch) {
      const facing = this.mobInFront();
      if (facing?.kind === 'lab:villager' && !facing.baby) return this.openTrade(facing);
    }
    const held = this.heldItem;
    const heldDef = held ? definition(held) : undefined;
    // Carrots, potatoes and seeds go into farmland before anyone thinks of eating them.
    if (heldDef?.plants !== undefined) {
      const aim = this.target();
      if (
        aim &&
        aim.normal.y === 1 &&
        this.plants.plantSeeds(aim.x, aim.y + 1, aim.z, heldDef.plants)
      ) {
        if (this.gameMode !== 'creative')
          this.inventory.set(
            this.inventory.selected,
            held!.count > 1 ? { ...held!, count: held!.count - 1 } : null,
          );
        return { ok: true, message: `${registry.get(heldDef.plants).name} · посажено` };
      }
    }
    if (heldDef?.use === 'fish') return this.fish();
    if (heldDef?.use === 'inspect') return this.inspect(heldDef.key);
    if (heldDef?.food) {
      if (this.survival.food >= MAX_FOOD) return { ok: false, reason: 'Ты сыт' };
      this.startUse();
      this.eating = true;
      return { ok: true, message: `Едим: ${heldDef.name}` };
    }
    if (heldDef?.use === 'bow') {
      if (countItem(this.inventory, 'lab:arrow') <= 0) return { ok: false, reason: 'Нет стрел' };
      this.startUse();
      return { ok: true, message: 'Лук натягивается' };
    }
    if (heldDef?.use === 'shield' || this.offhandShield()) {
      this.startUse();
      return { ok: true, message: 'Щит поднят' };
    }
    // A minecart under the crosshair is mounted; a creature in front is fed or sheared.
    const cart = this.carts.nearest(this.player.position, 2.5);
    if (cart) {
      this.carts.mount(cart.id);
      return { ok: true, message: 'В вагонетке' };
    }
    if (heldDef && this.mobInFront()) {
      const mob = this.mobInFront()!;
      const outcome = this.mobs.feed(mob, heldDef.key);
      if (outcome !== 'refused') {
        if (held!.count > 1)
          this.inventory.set(this.inventory.selected, { ...held!, count: held!.count - 1 });
        else this.inventory.set(this.inventory.selected, null);
        return {
          ok: true,
          message: outcome === 'bred' ? 'Появился детёныш' : 'Животное накормлено',
        };
      }
    }
    if (heldDef && this.mobInFront()) {
      const mob = this.mobInFront()!;
      if (heldDef.key === 'lab:shears') {
        const wool = this.mobs.shear(mob, this.random);
        if (wool > 0) {
          this.entities.spawnDrops(
            [{ item: woolItem(mob.variant), count: wool }],
            Math.floor(mob.position.x),
            Math.floor(mob.position.y + 0.8),
            Math.floor(mob.position.z),
            this.random,
          );
          this.damageHeldTool(true);
          this.sound('shear', mob.position.x, mob.position.y + 0.8, mob.position.z);
          return { ok: true, message: 'Овца острижена' };
        }
      }
      if (heldDef.key === 'lab:bucket' && this.mobs.milkable(mob)) {
        this.inventory.set(this.inventory.selected, {
          item: 'lab:milk_bucket',
          count: 1,
          damage: 0,
        });
        this.sound('milk', mob.position.x, mob.position.y + 0.8, mob.position.z);
        return { ok: true, message: 'Корова подоена' };
      }
    }
    if (heldDef?.use === 'drink') return this.drink(heldDef);
    if (heldDef?.use === 'throw') {
      const eye = this.eyePosition();
      const look = lookDirection(this.input.yaw, this.input.pitch);
      this.arrows.spawn(
        { x: eye.x + look.x * 0.4, y: eye.y - 0.1 + look.y * 0.4, z: eye.z + look.z * 0.4 },
        { x: look.x * 1.5, y: look.y * 1.5 + 0.1, z: look.z * 1.5 },
        0,
        'player',
        false,
        'egg',
      );
      if (this.gameMode !== 'creative') {
        const current = this.heldItem!;
        this.inventory.set(
          this.inventory.selected,
          current.count > 1 ? { ...current, count: current.count - 1 } : null,
        );
      }
      this.sound('throw', eye.x, eye.y, eye.z);
      return { ok: true, message: 'Яйцо брошено' };
    }
    if (heldDef?.use === 'bottle') return this.fillBottle();
    // An empty bucket reaches the still water the crosshair looks through.
    const hit =
      this.target() ??
      (heldDef?.use === 'bucket' && heldDef.bucket === 'empty' ? this.target('sources') : null);
    if (!hit) return { ok: false, reason: 'Подойди ближе к блоку' };
    const def = registry.get(hit.state);
    // Redstone parts answer to the right button before anything generic happens.
    if (def.redstone && !this.input.crouch && this.redstone.press(hit.x, hit.y, hit.z))
      return { ok: true, message: `${def.name}: переключено` };
    if (heldDef) {
      const specialised = this.useItemOnBlock(held!, hit, def);
      if (specialised) return specialised;
    }
    if (def.model?.kind === 'door' && !this.input.crouch)
      return this.toggleDoor(hit.x, hit.y, hit.z, hit.state);
    if (def.toggle !== undefined && !this.input.crouch) {
      this.setBlockState(hit.x, hit.y, hit.z, def.toggle);
      const open = registry.get(def.toggle).key.includes('_open');
      this.sound(open ? 'door_open' : 'door_close', hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      return { ok: true, message: `${def.name}: ${open ? 'открыто' : 'закрыто'}` };
    }
    if (def.bite !== undefined && !this.input.crouch)
      return this.eatCake(hit.x, hit.y, hit.z, def.bite);
    if (def.opens && !this.input.crouch) {
      if (def.opens === 'bed') return this.sleep(hit.x, hit.y, hit.z);
      if (
        def.opens === 'chest' &&
        chestObstructed(this.containers, this.world, hit.x, hit.y, hit.z)
      )
        return { ok: false, reason: 'Сундук завален — освободи место над ним' };
      // A crafting table is the 3×3 station; 'crafting' alone is the 2×2 grid of the inventory.
      const kind = def.opens === 'crafting' ? 'crafting_table' : def.opens;
      const opened = this.openContainer(kind, hit.x, hit.y, hit.z);
      if (!opened.ok) return opened;
      return { ok: true, opened: kind, message: `Открыто: ${def.name}` };
    }
    return this.placeBlock(hit);
  }
  /**
   * Items that act on the block in front instead of placing themselves: a hoe tills, seeds
   * plant, bone meal fertilises, flint and steel lights, buckets move fluids, a minecart goes
   * onto rails and a potion is drunk. Returns null when the item has no such use here.
   */
  private useItemOnBlock(
    held: Slot,
    hit: BlockHit,
    def: { key: string; solid: boolean },
  ): InteractionResult | null {
    if (!held) return null;
    const item = definition(held);
    const spend = () => {
      const current = this.heldItem;
      if (!current) return;
      this.inventory.set(
        this.inventory.selected,
        current.count > 1 ? { ...current, count: current.count - 1 } : null,
      );
    };
    if (item.tool?.kind === 'hoe' && (hit.state === BLOCK.GRASS || hit.state === BLOCK.DIRT)) {
      if (this.plants.till(hit.x, hit.y, hit.z)) {
        this.damageHeldTool();
        return { ok: true, message: 'Земля вспахана' };
      }
      return { ok: false, reason: 'Над землёй что-то стоит' };
    }
    if (item.key === 'lab:seeds' && this.plants.plantSeeds(hit.x, hit.y + hit.normal.y, hit.z)) {
      spend();
      return { ok: true, message: 'Пшеница посажена' };
    }
    if (item.key === 'lab:bone_meal') {
      const target = {
        x: hit.x,
        y: hit.y + (registry.get(hit.state).shape === 'cross' ? 0 : 1),
        z: hit.z,
      };
      if (this.plants.fertilize(target.x, target.y, target.z)) {
        spend();
        return { ok: true, message: 'Урожай подрос' };
      }
      const sapling = registry.get(hit.state).sapling;
      if (sapling) {
        // As in the reference, each dose is spent and grows the tree about one time in three.
        spend();
        this.visualEvents.emit(
          this.world.tick,
          'break',
          { x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5 },
          hit.state,
        );
        if (this.random() < 0.35 && this.plants.buildTree(hit.x, hit.y, hit.z, sapling))
          return { ok: true, message: 'Дерево выросло' };
        return { ok: true, message: 'Саженец подрос' };
      }
    }
    if (item.use === 'ignite') {
      // Flint and steel lights the block in front, or primes a fuse.
      if (hit.state === BLOCK.TNT) {
        this.blockSim.prime(hit.x, hit.y, hit.z);
        this.damageHeldTool(true);
        return { ok: true, message: 'Фитиль горит' };
      }
      const x = hit.x + hit.normal.x,
        y = hit.y + hit.normal.y,
        z = hit.z + hit.normal.z;
      // An obsidian frame around the hit becomes a lit Nether portal.
      if (
        lightPortalNear(this.world, x, y, z) ??
        lightPortalNear(this.world, hit.x, hit.y, hit.z)
      ) {
        this.damageHeldTool(true);
        return { ok: true, message: 'Портал в Нижний мир зажжён' };
      }
      if (this.blockSim.ignite(x, y, z) || this.blockSim.ignite(hit.x, hit.y, hit.z)) {
        this.damageHeldTool(true);
        return { ok: true, message: 'Огонь разожжён' };
      }
      return { ok: false, reason: 'Здесь нечему гореть' };
    }
    if (item.use === 'crystal') {
      // An end crystal on obsidian or bedrock: the crystal that heals the dragon.
      const x = hit.x + hit.normal.x,
        y = hit.y + hit.normal.y,
        z = hit.z + hit.normal.z;
      if (!this.bosses.crystalPlaceAllowed(this.world, x, y, z))
        return { ok: false, reason: 'Кристалл ставят на обсидиан или бедрок' };
      this.bosses.addCrystal({ x: x + 0.5, y, z: z + 0.5 });
      spend();
      const summoned = this.checkDragonRitual();
      return { ok: true, message: summoned ? 'Дракон призван снова' : 'Кристалл Края установлен' };
    }
    if (item.use === 'eye') {
      // Anywhere but a frame the eye is thrown: it flies towards the nearest stronghold and falls
      // back to the ground as an item, which is how a player finds the fortress in the first place.
      if (hit.state !== BLOCK.END_PORTAL_FRAME) return this.throwEyeOfEnder();
      if (!fitEye(this.world, hit.x, hit.y, hit.z))
        return { ok: false, reason: 'В этой раме уже есть глаз' };
      spend();
      for (const [dx, dz] of END_FRAME_RING) {
        const cx = hit.x - dx,
          cz = hit.z - dz;
        if (!endPortalComplete(this.world, cx, hit.y, cz)) continue;
        openEndPortal(this.world, cx, hit.y, cz);
        return { ok: true, message: 'Портал в Край открыт!' };
      }
      return { ok: true, message: 'Глаз вставлен в раму' };
    }
    if (item.use === 'bucket') {
      if (item.bucket === 'empty') {
        // The crosshair looks through fluids; the bucket looks for the nearest still one.
        const source = this.target('sources') ?? hit;
        const state = this.world.getBlock(source.x, source.y, source.z);
        const fluid = registry.get(state).fluid;
        if (fluid && registry.get(state).fluidSource) {
          this.setBlockState(source.x, source.y, source.z, BLOCK.AIR);
          this.inventory.set(this.inventory.selected, {
            item: fluid === 'water' ? 'lab:water_bucket' : 'lab:lava_bucket',
            count: 1,
            damage: 0,
          });
          return { ok: true, message: fluid === 'water' ? 'Ведро воды' : 'Ведро лавы' };
        }
        return { ok: false, reason: 'Здесь нет источника' };
      }
      const x = hit.x + hit.normal.x,
        y = hit.y + hit.normal.y,
        z = hit.z + hit.normal.z;
      if (this.world.getBlock(x, y, z) !== BLOCK.AIR) return { ok: false, reason: 'Место занято' };
      if (!this.setBlockState(x, y, z, item.bucket === 'water' ? BLOCK.WATER : BLOCK.LAVA))
        return { ok: false, reason: 'Сюда нельзя налить' };
      this.inventory.set(this.inventory.selected, { item: 'lab:bucket', count: 1, damage: 0 });
      return { ok: true, message: item.bucket === 'water' ? 'Вода разлита' : 'Лава разлита' };
    }
    if (item.use === 'drink') return this.drink(item);
    if (item.cart) {
      const state = this.world.getBlock(hit.x, hit.y, hit.z);
      if (!registry.get(state).key.includes('rail'))
        return { ok: false, reason: 'Вагонетку ставят на рельсы' };
      this.carts.spawn(item.cart, { x: hit.x + 0.5, y: hit.y + 0.0625, z: hit.z + 0.5 });
      spend();
      return { ok: true, message: 'Вагонетка поставлена' };
    }
    if (def.solid && hit.state === BLOCK.HOPPER) return null;
    return null;
  }
  /** Potions and milk are drunk wherever the player looks; milk washes every effect away. */
  /** A glass bottle aimed at water becomes a bottle of water; the water stays, as in 1.12. */
  private fillBottle(): InteractionResult {
    const water = this.target('sources');
    if (!water || registry.get(water.state).fluid !== 'water')
      return { ok: false, reason: 'Набери воду: наведи бутылку на воду' };
    const held = this.heldItem!;
    const filled = { item: 'lab:potion_water', count: 1, damage: 0 };
    if (held.count === 1) this.inventory.set(this.inventory.selected, filled);
    else {
      this.inventory.set(this.inventory.selected, { ...held, count: held.count - 1 });
      this.giveOrDrop(filled.item);
    }
    this.sound('fill_water', water.x + 0.5, water.y + 0.5, water.z + 0.5);
    return { ok: true, message: 'Бутылка наполнена водой' };
  }
  /** Puts one item into the inventory, or at the player's feet when it is full. */
  private giveOrDrop(item: string): void {
    if (addItems(this.inventory, item, 1) === 0) return;
    const p = this.player.position;
    this.entities.spawn(item, 1, { x: p.x, y: p.y + 0.5, z: p.z });
  }
  private drink(item: ItemDefinition): InteractionResult {
    const creative = this.gameMode === 'creative';
    if (item.key === 'lab:milk_bucket') {
      for (const effect of [...this.survival.effects.list]) this.survival.effects.remove(effect.id);
      if (!creative)
        this.inventory.set(this.inventory.selected, { item: 'lab:bucket', count: 1, damage: 0 });
      return { ok: true, message: 'Молоко выпито: эффекты сняты' };
    }
    if (!creative) {
      // The empty bottle comes back into the hand, as in the reference.
      const current = this.heldItem;
      if (current && current.count > 1) {
        this.inventory.set(this.inventory.selected, { ...current, count: current.count - 1 });
        this.giveOrDrop('lab:glass_bottle');
      } else if (current)
        this.inventory.set(this.inventory.selected, {
          item: 'lab:glass_bottle',
          count: 1,
          damage: 0,
        });
    }
    const potion = item.potion;
    if (potion) {
      if (potion.instant && potion.effect === 'instant_health') {
        this.survival.heal(4);
        return { ok: true, message: 'Зелье исцеления выпито' };
      }
      this.survival.effects.apply(potion.effect, potion.duration, potion.amplifier);
      return { ok: true, message: `Зелье выпито: ${effectName(potion.effect)}` };
    }
    return { ok: true, message: 'Тусклое зелье выпито' };
  }
  /** Leaves the cart the player is riding; the cart stays where it stopped. */
  dismountCart(): InteractionResult {
    const cart = this.carts.dismount();
    if (!cart) return { ok: false, reason: 'Ты не в вагонетке' };
    this.player.position.x = cart.position.x + 1;
    this.player.position.y = cart.position.y + 0.2;
    this.player.position.z = cart.position.z;
    return { ok: true, message: 'Ты вышел из вагонетки' };
  }
  private offhandShield(): boolean {
    const slot = this.inventory.get(PLAYER_OFFHAND.from);
    return !!slot && definition(slot).use === 'shield';
  }
  private startUse(): void {
    this.useHeld = true;
    this.useTicks = 0;
    this.bowCharge = 0;
  }
  private cancelUse(): void {
    this.useHeld = false;
    this.useTicks = 0;
    this.bowCharge = 0;
    this.eating = false;
  }
  /**
   * Called while the right button is held. Only the actions that take time start here; a block
   * is placed once on the press, so holding the button never builds a tower by accident.
   */
  setUseHold(active: boolean): InteractionResult {
    if (!active) return this.releaseUse();
    if (this.survival.dead) return { ok: false, reason: 'Игрок погиб' };
    if (this.useHeld) return { ok: true };
    const held = this.heldItem;
    const heldDef = held ? definition(held) : undefined;
    // Holding the button over farmland with a root in hand plants it, it does not eat it.
    if (heldDef?.plants !== undefined) {
      const aim = this.target();
      if (
        aim &&
        aim.normal.y === 1 &&
        (aim.state === BLOCK.FARMLAND || aim.state === BLOCK.FARMLAND_WET)
      )
        return { ok: true };
    }
    if (heldDef?.food) {
      if (this.survival.food >= MAX_FOOD) return { ok: false, reason: 'Ты сыт' };
      this.startUse();
      this.eating = true;
      return { ok: true, message: `Едим: ${heldDef.name}` };
    }
    if (heldDef?.use === 'bow') {
      if (countItem(this.inventory, 'lab:arrow') <= 0) return { ok: false, reason: 'Нет стрел' };
      this.startUse();
      return { ok: true, message: 'Лук натягивается' };
    }
    if (heldDef?.use === 'shield' || this.offhandShield()) {
      this.startUse();
      return { ok: true, message: 'Щит поднят' };
    }
    return { ok: true };
  }
  private advanceUse(): void {
    if (!this.useHeld) return;
    const held = this.heldItem;
    const def = held ? definition(held) : undefined;
    this.useTicks++;
    if (this.eating) {
      if (!def?.food) {
        this.cancelUse();
        return;
      }
      if (this.useTicks >= EAT_TICKS) this.finishEating(def.name, def.food);
      return;
    }
    if (def?.use === 'bow') {
      this.bowCharge = Math.min(BOW_CHARGE_TICKS, this.bowCharge + 1);
      return;
    }
  }
  private finishEating(name: string, food: NonNullable<ItemDefinition['food']>): void {
    const held = this.heldItem;
    if (!held) return this.cancelUse();
    if (!this.survival.eat(definition(held))) {
      this.cancelUse();
      return;
    }
    this.inventory.set(
      this.inventory.selected,
      held.count > 1 ? { ...held, count: held.count - 1 } : null,
    );
    if (food.effect && this.random() * 100 < food.effect.chance)
      this.survival.effects.apply(food.effect.id, food.effect.duration, food.effect.amplifier);
    const leaves = definition(held).leaves;
    if (leaves) {
      if (!this.heldItem)
        this.inventory.set(this.inventory.selected, { item: leaves, count: 1, damage: 0 });
      else this.giveOrDrop(leaves);
    }
    this.note(`Съедено: ${name}`);
    this.cancelUse();
  }
  /** Releases the right button: a drawn bow fires, a half-finished meal is cancelled. */
  releaseUse(): InteractionResult {
    const held = this.heldItem;
    const def = held ? definition(held) : undefined;
    if (this.eating) {
      this.cancelUse();
      return { ok: false, reason: 'Приём пищи прерван' };
    }
    if (def?.use === 'bow' && this.bowCharge > 0) {
      const charge = Math.min(1, this.bowCharge / BOW_CHARGE_TICKS);
      const drawn = this.bowCharge;
      this.cancelUse();
      if (drawn < BOW_MIN_CHARGE_TICKS) return { ok: false, reason: 'Лук почти не натянут' };
      const arrow = removeItem(this.inventory, 'lab:arrow', 1);
      if (arrow === 0) return { ok: false, reason: 'Нет стрел' };
      const eye = this.eyePosition();
      const direction = lookDirection(this.input.yaw, this.input.pitch);
      const speed = ARROW_SPEED * charge;
      this.arrows.spawn(
        { x: eye.x, y: eye.y - 0.1, z: eye.z },
        { x: direction.x * speed, y: direction.y * speed, z: direction.z * speed },
        arrowDamage(charge) * (1 + 0.25 * (this.heldItem?.enchantments?.power ?? 0)),
        'player',
        charge >= 1,
      );
      this.damageHeldTool(true);
      this.survival.addExhaustion(0.05);
      return { ok: true, message: `Выстрел (${Math.round(charge * 100)}%)` };
    }
    this.cancelUse();
    return { ok: true };
  }
  private eyePosition(): Vec3 {
    const p = this.player.position;
    return {
      x: p.x,
      y: p.y + EYE_HEIGHT - (this.input.crouch && !this.player.flying ? 0.15 : 0),
      z: p.z,
    };
  }
  /**
   * Left click: a creature in front takes the hit, otherwise mining starts. The attack
   * charge, critical and sweeping rules live in `combat.ts`.
   */
  attack(): InteractionResult {
    if (this.survival.dead) return { ok: false, reason: 'Игрок погиб' };
    // A blow at a ghast's fireball sends it back.
    if (this.arrows.deflect(this.eyePosition(), lookDirection(this.input.yaw, this.input.pitch))) {
      this.attackTicks = 0;
      this.sound(
        'mob_leap',
        this.player.position.x,
        this.player.position.y + 1.5,
        this.player.position.z,
      );
      return { ok: true, message: 'Огненный шар отбит' };
    }
    const crystal = this.crystalInFront();
    if (crystal) {
      this.hurtCrystal(crystal.id);
      this.attackTicks = 0;
      return { ok: true, damage: 1, message: 'Кристалл разрушен' };
    }
    const boss = this.bossInFront();
    if (boss) {
      const heldBoss = this.heldItem;
      const itemBoss = heldBoss ? definition(heldBoss) : undefined;
      const chargeBoss = attackCharge(this.attackTicks, itemBoss);
      const damage =
        (attackStatsOf(itemBoss).damage + this.enchantments.attackBonus(itemBoss, heldBoss)) *
          chargeBoss.multiplier || 1;
      this.attackTicks = 0;
      const death = this.hurtBoss(boss, damage);
      if (heldBoss && itemBoss?.tool) this.damageHeldTool();
      if (!death)
        this.note(
          `${boss.kind === 'ender_dragon' ? 'Дракон Края' : 'Иссушитель'}: −${damage.toFixed(1)}`,
        );
      return {
        ok: true,
        damage,
        message: `${boss.kind === 'ender_dragon' ? 'Дракон' : 'Иссушитель'}: удар`,
      };
    }
    const mob = this.mobInFront();
    if (!mob) return this.hitBlock();
    const held = this.heldItem;
    const itemDef = held ? definition(held) : undefined;
    const stats = attackStatsOf(itemDef);
    const charge = attackCharge(this.attackTicks, itemDef);
    const sprinting = this.sprinting;
    const critical = isCritical({
      onGround: this.player.onGround,
      fallDistance: this.survival.fallDistance,
      inWater: this.player.inWater,
      inLava:
        this.world.getBlock(
          Math.floor(this.player.position.x),
          Math.floor(this.player.position.y),
          Math.floor(this.player.position.z),
        ) === BLOCK.LAVA,
      sprinting,
      hasBlindness: this.survival.effects.has('blindness'),
    });
    // Sharpness adds to the weapon damage before charge and critical multipliers apply.
    let damage = (stats.damage + this.enchantments.attackBonus(itemDef, held)) * charge.multiplier;
    const strength = this.survival.effects.level('strength');
    if (strength > 0) damage += 3 * strength;
    if (critical) damage *= CRITICAL_MULTIPLIER;
    this.attackTicks = 0;
    this.survival.addExhaustion(0.1);
    const knockback = knockbackVector(this.player.position, mob.position, sprinting);
    // A sprinting blow spends the run, as in the reference.
    if (sprinting) this.sprinting = false;
    const death = this.mobs.hurt(mob, damage, knockback);
    this.visualEvents.emit(
      this.world.tick,
      'hit',
      { ...mob.position, y: mob.position.y + (mobDefinition(mob.kind)?.height ?? 1.8) * 0.6 },
      undefined,
      critical ? 2 : 1,
      mob.kind,
    );
    const name = mobDefinition(mob.kind)?.name ?? mob.kind;
    if (held && definition(held).tool) this.damageHeldTool();
    // A sword that is neither sprinting nor critical sweeps everything next to the target.
    if (itemDef?.tool?.kind === 'sword' && !sprinting && !critical) {
      const sweeps = sweepTargets(
        mob.id,
        mob.position,
        this.mobs.list.map((entity) => ({ id: entity.id, position: entity.position })),
        stats.damage,
      );
      for (const sweep of sweeps) {
        const entity = this.mobs.byId(sweep.id);
        if (!entity) continue;
        const swept = this.mobs.hurt(entity, sweep.damage, sweep.knockback);
        if (swept) this.spawnMobDeath(swept);
      }
    }
    if (death) {
      this.spawnMobDeath(death);
      return {
        ok: true,
        damage,
        killed: name,
        message: `${name} побеждён`,
        dropped: death.drops.reduce((sum, drop) => sum + drop.count, 0),
      };
    }
    return { ok: true, damage, message: `${name}: −${damage.toFixed(1)}` };
  }
  /** The closest creature whose box the look ray enters, before any block in the way. */
  private mobInFront(): MobEntity | undefined {
    if (!this.mobs.size) return undefined;
    const eye = this.eyePosition();
    const direction = lookDirection(this.input.yaw, this.input.pitch);
    const blockHit = this.target();
    let limit = ENTITY_REACH;
    if (blockHit) {
      limit = Math.min(
        limit,
        Math.hypot(blockHit.x + 0.5 - eye.x, blockHit.y + 0.5 - eye.y, blockHit.z + 0.5 - eye.z),
      );
    }
    for (let distance = 0.1; distance <= limit; distance += 0.12) {
      const point = {
        x: eye.x + direction.x * distance,
        y: eye.y + direction.y * distance,
        z: eye.z + direction.z * distance,
      };
      for (const mob of this.mobs.list) {
        const definition = mobDefinition(mob.kind);
        if (!definition) continue;
        const half = definition.width / 2;
        if (
          point.x >= mob.position.x - half &&
          point.x <= mob.position.x + half &&
          point.y >= mob.position.y &&
          point.y <= mob.position.y + definition.height &&
          point.z >= mob.position.z - half &&
          point.z <= mob.position.z + half
        )
          return mob;
      }
    }
    return undefined;
  }
  /** Sleeping needs night, a clear bed and no hostile creature nearby. */
  sleep(x: number, y: number, z: number): InteractionResult {
    if (this.survival.dead) return { ok: false, reason: 'Игрок погиб' };
    if (!isNight(this.world.time)) return { ok: false, reason: 'Спать можно только ночью' };
    if (!this.player.onGround) return { ok: false, reason: 'Нужно стоять на земле' };
    if (this.mobs.hostileNear(this.player.position, 8))
      return { ok: false, reason: 'Рядом чудовища — не до сна' };
    if (
      registry.get(this.world.getBlock(x, y + 1, z)).solid ||
      registry.get(this.world.getBlock(x, y + 2, z)).solid
    )
      return { ok: false, reason: 'Над кроватью нет места' };
    this.survival.setSpawn({ x: x + 0.5, y: y + 1, z: z + 0.5 });
    // Waking up at dawn of the next day, as the reference does.
    this.world.time = 0;
    this.note('Вы выспались: точка возрождения у кровати');
    return { ok: true, message: 'Сон · точка возрождения обновлена' };
  }
  /** Sets the day time directly; the sleeping rules and the debug hooks use it. */
  setTime(value: number): void {
    this.explicitTimeRevision++;
    if (!Number.isFinite(value)) return;
    this.world.time = ((Math.floor(value) % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
  }
  /** Test helper: removes every creature, used by the debug hooks and by world resets. */
  clearMobs(): void {
    this.mobs.clear();
  }
  /** Debug and test helper: a creature appears in front of the player. */
  spawnMob(kind: string, distance = 3): InteractionResult {
    const definition = mobDefinition(kind);
    if (!definition) return { ok: false, reason: `Нет существа «${kind}»` };
    const eye = this.eyePosition();
    const direction = lookDirection(this.input.yaw, this.input.pitch);
    const flat = Math.hypot(direction.x, direction.z) || 1;
    const position = {
      x: eye.x + (direction.x / flat) * distance,
      y: this.player.position.y,
      z: eye.z + (direction.z / flat) * distance,
    };
    const mob = this.mobs.spawn(kind, position);
    return { ok: true, message: `Создано: ${definition.name}`, picked: mob.id };
  }
  placeBlock(hit: BlockHit): InteractionResult {
    const held = this.heldItem;
    if (!held) return { ok: false, reason: 'В руке ничего нет' };
    const itemDef = definition(held);
    if (itemDef.block === undefined) return { ok: false, reason: 'Этот предмет нельзя поставить' };
    const blockDef = registry.get(itemDef.block);
    if (!blockDef.placeable) return { ok: false, reason: 'Этот блок нельзя поставить' };
    const hitDef = registry.get(hit.state);
    // A slab on the matching slab completes the block instead of stacking a new one.
    if (
      blockDef.placement === 'slab' &&
      hitDef.base === itemDef.block &&
      hitDef.model?.kind === 'slab' &&
      hit.normal.y === (hitDef.model.half === 'bottom' ? 1 : -1) &&
      blockDef.doubleSlab !== undefined
    )
      return this.finishPlacement(held, hit.x, hit.y, hit.z, hit.state, blockDef.doubleSlab);
    // Snow cover, grass and ferns give way: the block goes into their cell.
    const replaceHit = hitDef.replaceable === true;
    const x = replaceHit ? hit.x : hit.x + hit.normal.x,
      y = replaceHit ? hit.y : hit.y + hit.normal.y,
      z = replaceHit ? hit.z : hit.z + hit.normal.z;
    if (!this.world.isLoaded(x, z)) return { ok: false, reason: 'Чанк ещё загружается' };
    const before = this.world.getBlock(x, y, z);
    const beforeDef = registry.get(before);
    // The other half of a slab already in the cell: complete it.
    if (
      blockDef.placement === 'slab' &&
      beforeDef.base === itemDef.block &&
      beforeDef.model?.kind === 'slab' &&
      blockDef.doubleSlab !== undefined
    )
      return this.finishPlacement(held, x, y, z, before, blockDef.doubleSlab);
    if ((beforeDef.solid || beforeDef.model) && !beforeDef.replaceable)
      return { ok: false, reason: 'Место уже занято' };
    const state = this.orientedState(itemDef.block, hit);
    if (blockDef.placement === 'ladder' && hit.normal.y !== 0)
      return { ok: false, reason: 'Лестницу вешают на стену' };
    if (blockDef.placement === 'door') {
      const above = this.world.getBlock(x, y + 1, z);
      const aboveDef = registry.get(above);
      if ((aboveDef.solid || aboveDef.model) && !aboveDef.replaceable)
        return { ok: false, reason: 'Двери нужно два блока высоты' };
      if (!registry.get(this.world.getBlock(x, y - 1, z)).solid)
        return { ok: false, reason: 'Дверь ставят на твёрдый блок' };
    }
    if (
      blockDef.placement !== 'door' &&
      !isSupported((bx, by, bz) => this.world.getBlock(bx, by, bz), x, y, z, state)
    )
      return { ok: false, reason: supportReason(state) };
    if (blockDef.solid && this.stateOverlapsPlayer(state, x, y, z))
      return { ok: false, reason: 'Нельзя поставить блок внутри игрока' };
    if (blockDef.placement === 'door') {
      const facing = facingOfYaw(this.input.yaw);
      if (!this.setBlockState(x, y + 1, z, doorState(itemDef.block, facing, false, true)))
        return { ok: false, reason: 'Сюда нельзя поставить' };
    }
    if (blockDef.placement) return this.finishPlacement(held, x, y, z, before, state);
    if (blockDef.opens === 'chest' && !chestPlacementAllowed(this.containers, this.world, x, y, z))
      return { ok: false, reason: 'Здесь уже есть большой сундук' };
    if (!this.setBlockState(x, y, z, itemDef.block))
      return { ok: false, reason: 'Сюда нельзя поставить' };
    this.visualEvents.emit(
      this.world.tick,
      'place',
      { x: x + 0.5, y: y + 0.5, z: z + 0.5 },
      itemDef.block,
    );
    if (blockDef.redstone && blockDef.redstone !== 'wire')
      this.redstone.configure(x, y, z, facingFromYaw(this.input.yaw));
    if (this.gameMode !== 'creative') {
      if (held.count > 1)
        this.inventory.set(this.inventory.selected, { ...held, count: held.count - 1 });
      else this.inventory.set(this.inventory.selected, null);
    }
    return {
      ok: true,
      edit: { x, y, z, before, state: itemDef.block },
      message: `${blockDef.name} · установлен`,
    };
  }
  /** The state an item places for the aimed face and the direction the player looks. */
  private orientedState(block: number, hit: BlockHit): number {
    const def = registry.get(block);
    const facing = facingOfYaw(this.input.yaw);
    // The upper half of the aimed face, or the underside of a block, puts it upside down.
    const upperHalf =
      hit.normal.y === -1 ||
      (hit.normal.y === 0 &&
        hit.point !== undefined &&
        hit.point.y - Math.floor(hit.point.y) > 0.5);
    const half = upperHalf ? 'top' : 'bottom';
    if (def.placement === 'stairs') return stairsState(block, facing, half);
    if (def.placement === 'slab') return slabState(block, half);
    if (def.placement === 'door') return doorState(block, facing, false, false);
    // The wall a ladder or a trapdoor hinge rests on is the block that was clicked.
    const wall: ShapeFacing | null =
      hit.normal.x === 1
        ? 'west'
        : hit.normal.x === -1
          ? 'east'
          : hit.normal.z === 1
            ? 'north'
            : hit.normal.z === -1
              ? 'south'
              : null;
    const order: readonly ShapeFacing[] = ['north', 'east', 'south', 'west'];
    if (def.placement === 'ladder') return block + order.indexOf(wall ?? oppositeFacing(facing));
    if (def.placement === 'trapdoor')
      return block + (upperHalf ? 8 : 0) + order.indexOf(wall ?? oppositeFacing(facing));
    if (def.placement === 'gate') return block + order.indexOf(facing);
    return block;
  }
  /** One slice of cake: two hunger points, as in the reference; the last slice takes the cake. */
  private eatCake(x: number, y: number, z: number, next: number): InteractionResult {
    if (this.gameMode !== 'creative') {
      if (this.survival.food >= MAX_FOOD) return { ok: false, reason: 'Ты сыт' };
      this.survival.eat({
        id: -1,
        key: 'lab:cake_slice',
        name: 'Кусок торта',
        maxStack: 1,
        food: { nutrition: 2, saturation: 0.4 },
      });
    }
    this.setBlockState(x, y, z, next === 0 ? BLOCK.AIR : next);
    this.sound('eat', x + 0.5, y + 0.5, z + 0.5);
    return { ok: true, message: next === 0 ? 'Торт съеден' : 'Кусок торта съеден' };
  }
  /** Compass and clock: the way to the spawn point, or the hour of the day. */
  private inspect(key: string): InteractionResult {
    if (key === 'lab:clock') {
      const hours = Math.floor(((this.world.time / DAY_TICKS) * 24 + 6) % 24);
      const minutes = Math.floor(((this.world.time / DAY_TICKS) * 24 * 60) % 60);
      const part = isNight(this.world.time) ? 'ночь' : hours < 12 ? 'утро' : 'день';
      const hh = String(hours).padStart(2, '0'),
        mm = String(minutes).padStart(2, '0');
      return { ok: true, message: `Часы: ${hh}:${mm} — ${part}` };
    }
    if (this.world.dimensionID !== 'overworld')
      return { ok: true, message: 'Стрелка компаса бешено крутится' };
    const home = this.survival.spawn,
      p = this.player.position;
    const dx = home.x - p.x,
      dz = home.z - p.z,
      distance = Math.round(Math.hypot(dx, dz));
    if (distance < 3) return { ok: true, message: 'Компас: ты на точке появления' };
    // Bearing relative to the view: yaw 0 looks north (-z), positive yaw turns west.
    const bearing = Math.atan2(-dx, -dz) - this.input.yaw;
    const sector = ((Math.round(bearing / (Math.PI / 4)) % 8) + 8) % 8;
    const words = [
      'прямо',
      'впереди слева',
      'слева',
      'сзади слева',
      'сзади',
      'сзади справа',
      'справа',
      'впереди справа',
    ];
    return { ok: true, message: `Компас: точка появления ${words[sector]}, ${distance} бл.` };
  }
  private stateOverlapsPlayer(state: number, x: number, y: number, z: number): boolean {
    if (!registry.get(state).model) return playerOverlapsBlock(this.player, x, y, z);
    const body = bodyBox(this.player.position, 0.6, 1.8);
    const boxes = blockBoxes(
      state,
      (bx, by, bz) => this.world.getBlock(bx, by, bz),
      x,
      y,
      z,
      'collision',
    );
    return boxes.some(
      (b) =>
        body.maxX > x + b[0] + 1e-6 &&
        body.minX < x + b[3] - 1e-6 &&
        body.maxY > y + b[1] + 1e-6 &&
        body.minY < y + b[4] - 1e-6 &&
        body.maxZ > z + b[2] + 1e-6 &&
        body.minZ < z + b[5] - 1e-6,
    );
  }
  private finishPlacement(
    held: NonNullable<Slot>,
    x: number,
    y: number,
    z: number,
    before: number,
    state: number,
  ): InteractionResult {
    if (!this.setBlockState(x, y, z, state)) return { ok: false, reason: 'Сюда нельзя поставить' };
    this.visualEvents.emit(this.world.tick, 'place', { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, state);
    if (this.gameMode !== 'creative') {
      if (held.count > 1)
        this.inventory.set(this.inventory.selected, { ...held, count: held.count - 1 });
      else this.inventory.set(this.inventory.selected, null);
    }
    const def = registry.get(state);
    return { ok: true, edit: { x, y, z, before, state }, message: `${def.name} · установлен` };
  }
  /** Opens or closes both halves of a door. */
  private toggleDoor(x: number, y: number, z: number, state: number): InteractionResult {
    const def = registry.get(state);
    if (def.model?.kind !== 'door') return { ok: false, reason: 'Это не дверь' };
    const other = def.model.upper ? y - 1 : y + 1;
    this.setBlockState(x, y, z, toggledDoor(state));
    const otherState = this.world.getBlock(x, other, z);
    if (registry.get(otherState).model?.kind === 'door')
      this.setBlockState(x, other, z, toggledDoor(otherState));
    return { ok: true, message: def.model.open ? 'Дверь закрыта' : 'Дверь открыта' };
  }
  /**
   * Throws an eye of ender. The eye flies towards the stronghold the world generator placed and
   * lands as an item, so its trail points the way; the world itself is never revealed.
   */
  private throwEyeOfEnder(): InteractionResult {
    const target = this.nearestStronghold();
    if (!target || this.generatorVersion < 3)
      return {
        ok: false,
        reason:
          this.generatorVersion < 3
            ? 'В этом старом генераторе нет крепостей. Новый мир сохраняет старый отдельно.'
            : 'Око Края не чувствует крепость',
      };
    const p = this.player.position;
    const dx = target.x - p.x,
      dz = target.z - p.z;
    const distance = Math.hypot(dx, dz) || 1;
    // The eye always drifts the same way: it points at the stronghold and dips to the ground.
    const flight = Math.min(14, distance);
    this.entities.spawn('lab:eye_of_ender', 1, { x: p.x, y: p.y + 1.4, z: p.z }, 0, {
      x: (dx / distance) * flight * 0.4,
      y: 0.32,
      z: (dz / distance) * flight * 0.4,
    });
    const side =
      Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'восток' : 'запад') : dz > 0 ? 'юг' : 'север';
    this.note(`Око Края летит на ${side}: ${Math.round(distance)} м`);
    return { ok: true, message: `Око Края указывает: ${side}, ${Math.round(distance)} м` };
  }
  /** The stronghold the eye of ender points at: the nearest one the generator planned. */
  nearestStronghold(): { x: number; z: number } | undefined {
    const p = this.player.position;
    if (this.generatorVersion >= 5) {
      if (this.worldPreset === 'flat' || this.worldPreset === 'valley') return undefined;
      let near: { x: number; z: number } | undefined;
      for (const s of strongholdPositions(seedHash(this.world.seed)))
        if (!near || Math.hypot(s.x - p.x, s.z - p.z) < Math.hypot(near.x - p.x, near.z - p.z))
          near = s;
      return near;
    }
    const cell = 512;
    const reach = 6;
    let best: { x: number; z: number } | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    const gx = Math.floor(p.x / cell),
      gz = Math.floor(p.z / cell);
    for (let ox = gx - reach; ox <= gx + reach; ox++)
      for (let oz = gz - reach; oz <= gz + reach; oz++) {
        const box = { x0: ox * cell, z0: oz * cell };
        const preset = this.worldPreset;
        if (preset === 'flat' || preset === 'valley') continue;
        for (const plan of structuresNear(
          box.x0,
          box.z0,
          box.x0,
          box.z0,
          seedHash(this.world.seed),
          preset,
        )) {
          if (plan.kind !== 'stronghold') continue;
          const distance = Math.hypot(plan.x - p.x, plan.z - p.z);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = { x: plan.x, z: plan.z };
          }
        }
      }
    return best;
  }
  /** Middle click: put the aimed block into the selected hotbar slot when it is owned. */
  pick(): InteractionResult {
    const hit = this.target();
    if (!hit) return { ok: false, reason: 'Подойди ближе к блоку' };
    const item = itemRegistry.ofBlock(hit.state);
    if (!item) return { ok: false, reason: 'У этого блока нет предмета' };
    const slot = this.findItemSlot(item.key);
    if (slot < 0 && this.gameMode !== 'survival') {
      // Creative pick block conjures the block: an empty hand takes it, else the first free
      // hotbar slot, else it replaces what is held.
      const selected = this.inventory.selected;
      let target = selected;
      if (this.inventory.get(selected)) {
        for (let i = 0; i < 9; i++)
          if (!this.inventory.get(i)) {
            target = i;
            break;
          }
      }
      this.inventory.set(target, stack(item.key, item.maxStack));
      this.inventory.select(target);
      return { ok: true, picked: hit.state, message: `${item.name} · выбран` };
    }
    if (slot < 0) return { ok: false, reason: `Нет предмета «${item.name}» в инвентаре` };
    if (slot !== this.inventory.selected) {
      const current = this.inventory.get(this.inventory.selected);
      const source = this.inventory.get(slot);
      this.inventory.set(this.inventory.selected, source);
      this.inventory.set(slot, current);
    }
    return { ok: true, picked: hit.state, message: `${item.name} · выбран` };
  }
  /** First slot holding `key`, hotbar first; a `#tag` accepts any item of its family. */
  private findItemSlot(key: string): number {
    const fits = (i: number) => {
      const item = this.inventory.get(i)?.item;
      return item !== undefined && ingredientMatches(key, item);
    };
    for (let i = 0; i < 9; i++) if (fits(i)) return i;
    for (let i = 9; i < this.inventory.size; i++) if (fits(i)) return i;
    return -1;
  }
  /** Debug/creative helper used by the test palette and the in-game palette. */
  grant(item: string, count = 1): number | string {
    if (!itemRegistry.find(item)) return `Нет предмета «${item}»`;
    return count - addItems(this.inventory, item, count);
  }
  /** `Q` drops one item, `Ctrl+Q` the whole stack. */
  dropSelected(all = true): InteractionResult {
    const held = this.heldItem;
    if (!held) return { ok: false, reason: 'В руке ничего нет' };
    const count = all ? held.count : 1;
    this.entities.spawnStack(
      { ...held, count },
      {
        x: this.player.position.x,
        y: this.player.position.y + 1.2,
        z: this.player.position.z,
      },
      { x: -Math.sin(this.input.yaw) * 0.2, y: 0.1, z: -Math.cos(this.input.yaw) * 0.2 },
    );
    this.inventory.set(
      this.inventory.selected,
      held.count > count ? { ...held, count: held.count - count } : null,
    );
    return { ok: true, message: `${definition(held).name} · выброшено`, dropped: count };
  }
  /**
   * Death drops: every item the player carries, including the interface cursor and the
   * crafting grid, lands in the world. Nothing is deleted, which is what E07-11 checks.
   */
  die(): number {
    if (this.deathHandled) return 0;
    for (const value of [
      ...this.inventory.slots,
      ...this.grid.slots,
      this.cursor,
      this.anvilFirst,
      this.anvilSecond,
    ])
      if (value) stack(value.item, value.count, value.damage ?? 0, value.enchantments);
    let dropped = 0;
    const drop = (slot: Slot, x: number, y: number, z: number) => {
      if (!slot) return;
      this.entities.spawnStack(slot, { x, y, z });
      dropped += slot.count;
    };
    const at = this.player.position;
    this.cancelUse();
    this.miningActive = false;
    this.mining = null;
    this.returnGrid();
    this.returnCursor();
    this.closeContainer();
    for (let i = 0; i < this.inventory.size; i++) {
      const slot = this.inventory.get(i);
      if (!slot) continue;
      drop(slot, at.x, at.y + 0.6, at.z);
      this.inventory.set(i, null);
    }
    // The reference drops at most a hundred experience points and clears the level bar.
    const payout = this.survival.xpToDrop();
    if (payout > 0) this.orbs.spawnSplit(payout, { x: at.x, y: at.y + 0.6, z: at.z }, this.random);
    this.survival.xp = 0;
    this.survival.level = 0;
    this.survival.die();
    this.deathHandled = true;
    return dropped;
  }
  openContainer(kind: OpenContainerKind, x: number, y: number, z: number): InteractionResult {
    this.cancelActions();
    if (kind === 'crafting') {
      this.closeContainer();
      this.grid = new ItemContainer(4, [{ name: 'container', from: 0, to: 4 }]);
      this.open = { kind, key: null, gridSize: 2, view: null, title: 'Инвентарь' };
      return { ok: true };
    }
    // Only a real block in the world may be opened: the interface can never invent a chest.
    const state = this.world.getBlock(x, y, z);
    const def = registry.get(state);
    const expected = kind === 'crafting_table' ? 'crafting' : kind;
    if (def.opens !== expected) return { ok: false, reason: 'Здесь нет такого блока' };
    if (!this.world.isLoaded(x, z)) return { ok: false, reason: 'Чанк не загружен' };
    if (!withinReach(this.player.position, x, y, z)) return { ok: false, reason: 'Слишком далеко' };
    if (kind === 'chest' && chestObstructed(this.containers, this.world, x, y, z))
      return { ok: false, reason: 'Сундук накрыт блоком' };
    if (kind === 'crafting_table') {
      this.closeContainer();
      this.grid = new ItemContainer(9, [{ name: 'container', from: 0, to: 9 }]);
      this.open = {
        kind,
        key: positionKey(x, y, z),
        gridSize: 3,
        view: null,
        title: registry.get(BLOCK.CRAFTING_TABLE).name,
      };
      return { ok: true };
    }
    if (kind === 'chest') {
      this.closeContainer();
      const view = this.containers.chestView(this.world, x, y, z);
      const partner = this.containers.doubleChestFor(this.world, x, y, z);
      this.open = {
        kind,
        key: positionKey(x, y, z),
        gridSize: 2,
        view,
        title: partner ? 'Большой сундук' : registry.get(BLOCK.CHEST).name,
      };
      return { ok: true };
    }
    if (kind === 'enchanting') {
      this.closeContainer();
      this.grid = new ItemContainer(1, [{ name: 'container', from: 0, to: 1 }]);
      this.open = {
        kind,
        key: positionKey(x, y, z),
        gridSize: 2,
        view: null,
        title: registry.get(BLOCK.ENCHANTING_TABLE).name,
      };
      return { ok: true };
    }
    if (kind === 'anvil') {
      this.closeContainer();
      this.grid = new ItemContainer(2, [{ name: 'container', from: 0, to: 2 }]);
      this.open = {
        kind,
        key: positionKey(x, y, z),
        gridSize: 2,
        view: null,
        title: registry.get(BLOCK.ANVIL).name,
      };
      return { ok: true };
    }
    if (kind === 'brewing') {
      this.closeContainer();
      const stand = this.brewing.ensure(x, y, z);
      this.open = {
        kind,
        key: positionKey(x, y, z),
        gridSize: 2,
        view: new BrewingContainer(stand),
        title: registry.get(BLOCK.BREWING_STAND).name,
      };
      return { ok: true };
    }
    if (kind === 'dispenser' || kind === 'dropper' || kind === 'hopper') {
      this.closeContainer();
      const block = this.containers.ensure(kind === 'dropper' ? 'dispenser' : kind, x, y, z);
      const names: Record<string, string> = {
        dispenser: registry.get(BLOCK.DISPENSER).name,
        dropper: registry.get(BLOCK.DROPPER).name,
        hopper: registry.get(BLOCK.HOPPER).name,
      };
      this.open = {
        kind,
        key: positionKey(x, y, z),
        gridSize: 2,
        view: block.slots,
        title: names[kind],
      };
      return { ok: true };
    }
    this.closeContainer();
    const block = this.containers.ensure('furnace', x, y, z);
    this.open = {
      kind: 'furnace',
      key: positionKey(x, y, z),
      gridSize: 2,
      view: block.slots,
      title: registry.get(BLOCK.FURNACE).name,
    };
    return { ok: true };
  }
  openCrafting(): void {
    this.openContainer('crafting', 0, 0, 0);
  }
  private openPosition(): Vec3 | null {
    if (!this.open?.key) return null;
    const [x, y, z] = this.open.key.split(',').map(Number);
    return { x, y, z };
  }
  closeContainer(): void {
    if (!this.open) return;
    this.open = null;
    this.returnGrid();
    this.returnCursor();
  }
  /** The crafting grid is interface state: its items go back to the inventory. */
  private returnGrid(): void {
    for (let i = 0; i < this.grid.size; i++) {
      const value = this.grid.get(i);
      if (!value) continue;
      const rest = addStack(this.inventory, value, 0, PLAYER_MAIN_SLOTS);
      if (rest)
        this.entities.spawnStack(rest, {
          x: this.player.position.x,
          y: this.player.position.y + 1,
          z: this.player.position.z,
        });
      this.grid.set(i, null);
    }
  }
  returnCursor(): void {
    const held = this.cursor;
    if (!held) return;
    const rest = addStack(this.inventory, held, 0, PLAYER_MAIN_SLOTS);
    if (rest)
      this.entities.spawnStack(rest, {
        x: this.player.position.x,
        y: this.player.position.y + 1,
        z: this.player.position.z,
      });
    this.cursor = null;
  }
  /**
   * The items a checkpoint has to carry. The crafting grid lives only while an interface is open,
   * so its stacks are folded into a *copy* of the player's slots: saving never disturbs an open
   * panel, and a reload still finds every item instead of silently dropping the grid.
   */
  captureItems(): { slots: SlotData[]; cursor: SlotData; overflow: Slot[] } {
    const overflow: Slot[] = [];
    const copy = new ItemContainer(PLAYER_SLOTS, [
      { name: 'container', from: 0, to: PLAYER_SLOTS },
    ]);
    copy.slots.splice(0, PLAYER_SLOTS, ...cloneSlots(this.inventory.slots));
    for (let i = 0; i < this.grid.size; i++) {
      const slot = this.grid.get(i);
      if (!slot) continue;
      let rest = addStack(copy, slot, PLAYER_MAIN.from, PLAYER_MAIN.to);
      if (rest) rest = addStack(copy, rest, PLAYER_HOTBAR.from, PLAYER_HOTBAR.to);
      if (rest) rest = addStack(copy, rest, PLAYER_OFFHAND.from, PLAYER_OFFHAND.to);
      // Overflow exists as a dropped item in the checkpoint ONLY. The live grid is untouched.
      if (rest) overflow.push(rest);
    }
    return {
      overflow,
      slots: encodeSlots(copy.slots),
      cursor: this.cursor ? encodeSlots([this.cursor])[0] : null,
    };
  }
  /** Restores the stack that was on the interface cursor when the world was saved. */
  restoreCursor(saved: SlotData): void {
    this.cursor = saved ? decodeSlots([saved])[0] : null;
  }
  containerFor(id: string | null): Container | null {
    if (id === null) return this.inventory;
    if (id === 'grid')
      return this.open && this.open.kind !== 'chest' && this.open.kind !== 'furnace'
        ? this.grid
        : null;
    // The interface calls the world container simply «container»; the core keeps the position key.
    if (id === 'container' && this.open?.view) return this.open.view;
    if (this.open?.key === id && this.open.view) return this.open.view;
    return null;
  }
  quickOrderFor(id: string | null): string[] {
    if (id === null) return ['main', 'hotbar'];
    if (id === 'grid') return ['main', 'hotbar'];
    return ['container', 'hotbar', 'main'];
  }
  /**
   * Shift-click inside the crafting grid: the stack travels to the inventory in the order the
   * quick-move rules declare for that interface, and a full inventory leaves the rest behind.
   */
  private shiftOutOfGrid(index: number): void {
    let left: Slot = this.grid.get(index);
    for (const name of this.quickOrderFor('grid')) {
      if (!left) break;
      const region = PLAYER_INVENTORY_REGIONS.find((entry) => entry.name === name);
      if (!region) continue;
      left = addStack(this.inventory, left, region.from, region.to);
    }
    this.grid.set(index, left);
  }
  /** Every slot click in the game, including crafting results, goes through here. */
  slotClick(
    id: string | null,
    index: number,
    button: number,
    options: SlotClickOptions = {},
  ): InteractionResult {
    const cursor = this.cursor;
    const commit = (outcome: { cursor: Slot }): InteractionResult => {
      this.cursor = outcome.cursor;
      return { ok: true };
    };
    if (id === null) {
      if (options.double) return commit(gatherSame(this.inventory, index, cursor));
      if (options.drag) return commit(this.dragInto(this.inventory, index, options));
      if (options.number !== undefined) {
        if (
          !this.armorSlotAccepts(index, cursor) ||
          !this.armorSlotAccepts(options.number, this.inventory.get(index))
        )
          return { ok: false, reason: 'В этот слот подходит только своя часть брони' };
        return commit(hotbarSwap(this.inventory, index, this.inventory, options.number, cursor));
      }
      // Armour slots only take the matching piece; everything else stays on the cursor.
      if (!this.armorSlotAccepts(index, cursor))
        return { ok: false, reason: 'В этот слот подходит только своя часть брони' };
      // Shift-clicking armour equips it, as in the reference game.
      if (options.shift && !cursor && index >= PLAYER_ARMOR.from && index < PLAYER_ARMOR.to) {
        const slot = this.inventory.get(index);
        if (slot) {
          const target = armorSlotFor(slot.item);
          if (target >= 0 && target !== index && !this.inventory.get(target)) {
            this.inventory.set(index, null);
            this.inventory.set(target, slot);
            return { ok: true, message: `${definition(slot).name} · надето` };
          }
        }
      }
      // With a chest or a furnace open, shift-click hands the stack over to it.
      if (options.shift && !cursor && index < PLAYER_ARMOR.from && this.shiftIntoOpen(index))
        return { ok: true };
      if (options.shift && !cursor && armorSlotFor(this.inventory.get(index)?.item ?? '') >= 0) {
        const target = armorSlotFor(this.inventory.get(index)!.item);
        if (target >= 0 && !this.inventory.get(target)) {
          const slot = this.inventory.get(index)!;
          this.inventory.set(index, null);
          this.inventory.set(target, slot);
          return { ok: true, message: `${definition(slot).name} · надето` };
        }
      }
      return commit(
        clickSlot(this.inventory, index, cursor, {
          right: button === 2,
          shift: options.shift,
          quickOrder: ['main', 'hotbar'],
        }),
      );
    }
    if (id === 'result') return this.takeResult(button, !!options.shift);
    if (id === 'grid') {
      if (!this.open || this.open.kind === 'chest' || this.open.kind === 'furnace')
        return { ok: false, reason: 'Нет сетки крафта' };
      if (options.drag) return commit(this.dragInto(this.grid, index, options));
      // The grid carries no player slots of its own, so shift-clicking an ingredient has to
      // hand the stack over to the inventory here instead of quick-moving inside one container.
      if (options.shift && !cursor) {
        this.shiftOutOfGrid(index);
        return { ok: true };
      }
      return commit(
        clickSlot(this.grid, index, cursor, {
          right: button === 2,
          shift: options.shift,
          quickOrder: ['main', 'hotbar'],
        }),
      );
    }
    const view =
      this.open?.key === id || (id === 'container' && this.open?.view)
        ? (this.open?.view ?? null)
        : null;
    if (!view) return { ok: false, reason: 'Этот контейнер закрыт' };
    if (options.shift && !cursor && this.open?.kind !== 'brewing') {
      // Shift-click takes the stack out into the player's hotbar, then the main inventory;
      // the furnace pays out its banked experience for what left the output slot.
      const before = view.get(FURNACE_OUTPUT)?.count ?? 0;
      this.shiftOutOfOpen(view, index);
      if (this.open?.kind === 'furnace' && index === FURNACE_OUTPUT)
        this.awardFurnaceXp(before - (view.get(FURNACE_OUTPUT)?.count ?? 0));
      return { ok: true };
    }
    if (this.open?.kind === 'furnace' && index === FURNACE_OUTPUT) {
      const before = view.get(FURNACE_OUTPUT)?.count ?? 0;
      const outcome = this.furnaceClick(view, index, button, options, cursor);
      this.awardFurnaceXp(before - (view.get(FURNACE_OUTPUT)?.count ?? 0));
      return outcome;
    }
    if (options.double) return commit(gatherSame(view, index, cursor));
    if (options.drag) return commit(this.dragInto(view, index, options));
    if (options.number !== undefined)
      return commit(hotbarSwap(view, index, this.inventory, options.number, cursor));
    return commit(
      clickSlot(view, index, cursor, {
        right: button === 2,
        shift: options.shift,
        quickOrder: ['hotbar', 'main'],
      }),
    );
  }
  /**
   * Shift-click from the player inventory into the open block container: a furnace takes
   * what it can smelt into the input and what burns into the fuel slot, a chest takes anything.
   * Returns false when the container wants nothing of it, so the stack moves inside the
   * inventory instead, as in the reference game.
   */
  private shiftIntoOpen(index: number): boolean {
    const view = this.open?.view;
    const moving = this.inventory.get(index);
    if (!view || !moving || this.open?.kind === 'brewing') return false;
    let from = 0,
      to = view.size;
    if (this.open?.kind === 'furnace') {
      const slot = smeltingFor(moving)
        ? FURNACE_INPUT
        : fuelTicks(moving.item) > 0
          ? FURNACE_FUEL
          : -1;
      if (slot < 0) return false;
      from = slot;
      to = slot + 1;
    }
    const left = addStack(view, moving, from, to, (i) => slotAccepts(view, i, moving));
    if (left?.count === moving.count) return this.open?.kind !== 'furnace';
    this.inventory.set(index, left);
    return true;
  }
  /** Shift-click from the open block container back into the hotbar, then the inventory. */
  private shiftOutOfOpen(view: Container, index: number): void {
    let left: Slot = view.get(index);
    for (const name of ['hotbar', 'main']) {
      if (!left) break;
      const region = PLAYER_INVENTORY_REGIONS.find((entry) => entry.name === name)!;
      left = addStack(this.inventory, left, region.from, region.to);
    }
    view.set(index, left);
  }
  /** The furnace output behaves like every other slot, with experience added on take-out. */
  private furnaceClick(
    view: Container,
    index: number,
    button: number,
    options: SlotClickOptions,
    cursor: Slot,
  ): InteractionResult {
    if (options.double) return { ok: true } as InteractionResult;
    const outcome = options.shift
      ? clickSlot(view, index, cursor, { shift: true, quickOrder: ['hotbar', 'main'] })
      : clickSlot(view, index, cursor, { right: button === 2, quickOrder: ['hotbar', 'main'] });
    this.cursor = outcome.cursor;
    return { ok: true };
  }
  /**
   * The reference grants a furnace's banked experience when its output is taken out; the
   * amount is proportional to how many items the click removed.
   */
  private awardFurnaceXp(taken: number): void {
    if (taken <= 0 || !this.open?.key) return;
    const block = this.containers.get(...parseKey(this.open.key));
    const furnace = block?.furnace;
    if (!furnace || furnace.xp <= 0) return;
    const perItem = furnace.perItem > 0 ? furnace.perItem : 0.1;
    const granted = Math.min(furnace.xp, perItem * taken);
    furnace.xp = Math.max(0, furnace.xp - granted);
    if (granted <= 0) return;
    // Experience points are fractional: a single iron ingot is worth 0.7 of a point.
    const gained = this.survival.addXp(granted);
    this.note(
      gained.levels > 0
        ? `Опыт: +${granted.toFixed(1)} · уровень ${gained.level}`
        : `Опыт: +${granted.toFixed(1)}`,
    );
  }
  /** Armour slots accept only the matching piece; a shield goes to the off hand. */
  private armorSlotAccepts(index: number, incoming: Slot): boolean {
    if (index < PLAYER_ARMOR.from || index >= PLAYER_ARMOR.to) return true;
    if (!incoming) return true;
    const target = armorSlotFor(incoming.item);
    return target === index;
  }
  private dragInto(
    container: Container,
    index: number,
    options: SlotClickOptions,
  ): { cursor: Slot } {
    return options.share
      ? dragShare(container, index, this.cursor, options.slotsLeft ?? 1)
      : dragPlace(container, index, this.cursor);
  }
  private takeResult(button: number, shift: boolean): InteractionResult {
    if (!this.open || this.open.kind === 'chest' || this.open.kind === 'furnace')
      return { ok: false, reason: 'Нет сетки крафта' };
    const size = this.open.gridSize;
    let crafted = 0;
    const craftOnce = (left: Slot): Slot => {
      const result = gridResult(this.grid.slots, size);
      if (!result) return left;
      if (left && (!sameKind(left, stack(result.item, 1)) || left.count + result.count > 64))
        return left;
      consumeGrid(this.grid, size);
      crafted++;
      return left
        ? { ...left, count: left.count + result.count }
        : { ...stack(result.item, 1), count: result.count };
    };
    if (shift) {
      // Shift-clicking the result crafts as long as the ingredients and space last.
      let guard = 0;
      let carried: Slot = null;
      while (guard++ < 64) {
        const before = crafted;
        carried = craftOnce(carried);
        if (crafted === before) break;
        const moved = addStack(this.inventory, carried!)?.count ?? 0;
        if (moved > 0) {
          this.cursor = { ...carried!, count: moved };
          carried = null;
          break;
        }
        carried = null;
      }
      if (carried) this.cursor = carried;
    } else {
      this.cursor = craftOnce(this.cursor);
      if (crafted === 0)
        return { ok: false, reason: 'Не хватает материалов', message: 'Не хватает материалов' };
    }
    if (crafted === 0) return { ok: false, reason: 'Не хватает материалов' };
    for (const slot of [...this.inventory.slots, this.cursor]) if (slot) this.noteItem(slot.item);
    return { ok: true, message: `Создано: ${crafted}`, dropped: crafted };
  }
  /**
   * Creative inventory catalogue click. `stack` puts a full stack on the cursor, `one` a single
   * item (again on the same item adds one more), `inventory` sends a full stack straight into
   * the inventory. Clicking the catalogue while carrying something else deletes it.
   */
  creativeTake(key: string, mode: 'stack' | 'one' | 'inventory'): InteractionResult {
    if (this.gameMode === 'survival') return { ok: false, reason: 'Каталог доступен в творчестве' };
    const item = itemRegistry.find(key);
    if (!item) return { ok: false, reason: `Нет предмета «${key}»` };
    if (mode === 'inventory') {
      const left = addItems(this.inventory, key, item.maxStack);
      if (left >= item.maxStack) return { ok: false, reason: 'В инвентаре нет места' };
      return { ok: true, message: `${item.name} ×${item.maxStack - left}` };
    }
    const cursor = this.cursor;
    if (cursor) {
      if (mode === 'one' && cursor.item === key && !cursor.enchantments) {
        if (cursor.count < item.maxStack) this.cursor = stack(key, cursor.count + 1);
        return { ok: true };
      }
      this.cursor = null;
      return { ok: true, message: 'Удалено' };
    }
    this.cursor = stack(key, mode === 'one' ? 1 : item.maxStack);
    return { ok: true };
  }
  /** Creative trash slot: deletes the cursor stack; with `all`, empties the whole inventory. */
  creativeTrash(all = false): InteractionResult {
    if (this.gameMode === 'survival') return { ok: false, reason: 'Корзина доступна в творчестве' };
    this.cursor = null;
    if (all) for (let i = 0; i < this.inventory.size; i++) this.inventory.set(i, null);
    return { ok: true, message: all ? 'Инвентарь очищен' : 'Удалено' };
  }
  /** Creative palette helper: puts a block's item into the active hotbar slot. */
  creativeSelect(state: number): boolean {
    const item = itemRegistry.ofBlock(state);
    if (!item) return false;
    this.inventory.set(this.inventory.selected, stack(item.key, item.maxStack));
    return true;
  }
  /** Recipe book: move the needed ingredients from the inventory into the grid. */
  autoFill(recipeId: string): InteractionResult {
    if (!this.open || this.open.kind === 'chest' || this.open.kind === 'furnace')
      return { ok: false, reason: 'Открой верстак или инвентарь' };
    const recipe = recipeById(recipeId);
    if (!recipe) return { ok: false, reason: 'Нет такого рецепта' };
    if (recipe.needs > this.open.gridSize) return { ok: false, reason: 'Нужен верстак 3×3' };
    // Return whatever is already in the grid, then lay the recipe out.
    for (let i = 0; i < this.grid.size; i++) {
      const slot = this.grid.get(i);
      if (!slot) continue;
      const rest = addStack(this.inventory, slot)?.count ?? 0;
      this.grid.set(i, rest ? { ...slot, count: rest } : null);
      if (rest > 0) return { ok: false, reason: 'В инвентаре нет места' };
    }
    const plan = planFor(recipe, this.open.gridSize);
    for (const entry of plan) {
      const from = this.findItemSlot(entry.item);
      if (from < 0) {
        this.clearGrid();
        return { ok: false, reason: 'Не хватает материалов' };
      }
      const source = this.inventory.get(from)!;
      this.grid.set(entry.slot, { ...source, count: 1 });
      this.inventory.set(from, source.count > 1 ? { ...source, count: source.count - 1 } : null);
    }
    return { ok: true, message: 'Рецепт разложен' };
  }
  private clearGrid(): void {
    for (let i = 0; i < this.grid.size; i++) {
      const slot = this.grid.get(i);
      if (!slot) continue;
      const rest = addStack(this.inventory, slot)?.count ?? 0;
      this.grid.set(i, rest ? { ...slot, count: rest } : null);
    }
  }
  containerView(): ContainerView | null {
    if (!this.open) return null;
    const open = this.open;
    const result =
      open.kind === 'chest' || open.kind === 'furnace'
        ? null
        : gridResult(this.grid.slots, open.gridSize);
    const furnaceBlock = open.key ? this.containers.get(...parseKey(open.key)) : undefined;
    return {
      kind: open.kind,
      title: open.title,
      key: open.key,
      container: open.view ? encodeSlots(collect(open.view)) : [],
      gridSize: open.gridSize,
      grid: open.kind === 'chest' || open.kind === 'furnace' ? [] : encodeSlots(this.grid.slots),
      result: result ? encodeSlots([{ item: result.item, count: result.count }])[0] : null,
      furnace: furnaceBlock?.furnace
        ? {
            burn: furnaceBlock.furnace.burn,
            burnTotal: furnaceBlock.furnace.burnTotal,
            cook: furnaceBlock.furnace.cook,
            cookTotal: 200,
            lit: furnaceBlock.furnace.lit,
            xp: furnaceBlock.furnace.xp,
          }
        : null,
      brewing: this.brewingView(open),
      anvil: this.anvilView(open),
      enchant: this.enchantView(open),
      trade: this.tradeView(open),
      recipes: recipeBook(this.inventory),
      regions: open.view
        ? CONTAINER_VIEW_REGIONS(open.view.size)
        : STATION_SLOTS[open.kind]
          ? stationRegions(STATION_SLOTS[open.kind])
          : PLAYER_INVENTORY_REGIONS,
    };
  }
  /** The brewing stand's own slots as the interface sees them. */
  private brewingView(open: OpenContainer): ContainerView['brewing'] {
    if (open.kind !== 'brewing' || !open.key) return null;
    const stand = this.brewing.get(...parseKey(open.key));
    if (!stand) return null;
    return {
      ingredient: stand.ingredient ? encodeSlots([stand.ingredient])[0] : null,
      bottles: encodeSlots(stand.bottles),
      fuel: stand.fuel,
      progress: stand.progress,
      total: BREW_TICKS,
    };
  }
  /** Water bottles and powder loaded in one go, for the interface button and for tests. */
  brewingFill(): InteractionResult {
    if (this.open?.kind !== 'brewing' || !this.open.key)
      return { ok: false, reason: 'Стойка не открыта' };
    const stand = this.brewing.ensure(...parseKey(this.open.key));
    let moved = 0;
    for (const index of [0, 1, 2]) {
      if (stand.bottles[index]) continue;
      if (removeItem(this.inventory, 'lab:potion_water', 1) === 0) break;
      stand.bottles[index] = { item: 'lab:potion_water', count: 1, damage: 0 };
      moved++;
    }
    if (
      stand.powder === null &&
      stand.fuel <= 0 &&
      removeItem(this.inventory, BLAZE_POWDER_ITEM, 1) > 0
    ) {
      stand.powder = { item: BLAZE_POWDER_ITEM, count: 1, damage: 0 };
      stand.fuel = BREW_FUEL_PER_POWDER;
      stand.powder = null;
      moved++;
    }
    if (moved === 0) return { ok: false, reason: 'Нужны зелья воды и огненный порошок' };
    return { ok: true, message: `Загружено в стойку: ${moved}` };
  }
  /** Pours every finished potion from the stand into the inventory. */
  brewingTake(): InteractionResult {
    if (this.open?.kind !== 'brewing' || !this.open.key)
      return { ok: false, reason: 'Стойка не открыта' };
    const stand = this.brewing.ensure(...parseKey(this.open.key));
    let moved = 0;
    for (const [index, bottle] of stand.bottles.entries()) {
      if (!bottle) continue;
      if (addStack(this.inventory, bottle, 0, PLAYER_MAIN_SLOTS)) continue;
      stand.bottles[index] = null;
      moved++;
    }
    if (moved === 0) return { ok: false, reason: 'Нечего забирать' };
    return { ok: true, message: `Забрано зелий: ${moved}` };
  }
  private anvilView(open: OpenContainer): ContainerView['anvil'] {
    if (open.kind !== 'anvil') return null;
    const first = this.grid.get(0);
    const second = this.grid.get(1);
    const result = anvilResult(first, second);
    return {
      first: first ? encodeSlots([first])[0] : null,
      second: second ? encodeSlots([second])[0] : null,
      result: result ? encodeSlots([result.stack])[0] : null,
      cost: result?.cost ?? 0,
      message: result?.message ?? null,
    };
  }
  private enchantView(open: OpenContainer): ContainerView['enchant'] {
    if (open.kind !== 'enchanting') return null;
    const item = this.grid.get(0);
    const definition = item ? itemRegistry.find(item.item) : undefined;
    return {
      item: item ? encodeSlots([item])[0] : null,
      offers: definition ? this.offersFor(definition) : [],
      levels: this.survival.progress.level,
      lapis: countItem(this.inventory, 'lab:lapis'),
      target: item?.item ?? null,
    };
  }
  /** Three offers for an item; the same item always shows the same three. */
  offersFor(item: ItemDefinition): EnchantOffer[] {
    let seed = 0;
    for (const character of item.key) seed = (seed * 31 + character.charCodeAt(0)) % 2147483647;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    return this.enchantments.offers(item, random);
  }
  /** Spends levels and lapis on one offer; the item stays in the table slot. */
  /** Opens a villager's offers. The key names the creature so the view can follow it. */
  private openTrade(mob: MobEntity): InteractionResult {
    this.cancelActions();
    this.closeContainer();
    const profession = PROFESSION_NAMES[professionOf(mob.variant)];
    this.open = {
      kind: 'trade',
      key: `mob:${mob.id}`,
      gridSize: 2,
      view: null,
      title: `Житель · ${profession}`,
    };
    this.sound('villager', mob.position.x, mob.position.y + 1.6, mob.position.z);
    return { ok: true, message: `Торговля: ${profession.toLocaleLowerCase('ru')}` };
  }
  /** The villager the open trade belongs to, while it is alive and within reach. */
  private tradePartner(): MobEntity | undefined {
    if (this.open?.kind !== 'trade' || !this.open.key) return undefined;
    const id = Number(this.open.key.slice(4));
    const mob = this.mobs.list.find((entry) => entry.id === id);
    if (!mob) return undefined;
    const p = this.player.position;
    if (Math.hypot(mob.position.x - p.x, mob.position.y - p.y, mob.position.z - p.z) > 8)
      return undefined;
    return mob;
  }
  private tradeView(open: OpenContainer): ContainerView['trade'] {
    if (open.kind !== 'trade') return null;
    const mob = this.tradePartner();
    if (!mob) return { profession: '', offers: [] };
    return {
      profession: PROFESSION_NAMES[professionOf(mob.variant)],
      offers: tradesFor(mob.variant).map((trade, index) => {
        const left = TRADE_MAX_USES - (mob.tradeUses[index] ?? 0);
        return {
          give: encodeSlots(trade.give.map(([item, count]) => ({ item, count }))),
          get: encodeSlots([{ item: trade.get[0], count: trade.get[1] }])[0],
          affordable:
            left > 0 &&
            trade.give.every(([item, count]) => countItem(this.inventory, item) >= count),
          left,
        };
      }),
    };
  }
  /** Pays for one of the open villager's offers and takes the goods. */
  trade(index: number): InteractionResult {
    if (this.open?.kind !== 'trade') return { ok: false, reason: 'Торговля не открыта' };
    const mob = this.tradePartner();
    if (!mob) return { ok: false, reason: 'Житель ушёл' };
    const trade = tradesFor(mob.variant)[index];
    if (!trade) return { ok: false, reason: 'Нет такого предложения' };
    if ((mob.tradeUses[index] ?? 0) >= TRADE_MAX_USES)
      return { ok: false, reason: 'Житель пока не меняет это: загляни позже' };
    for (const [item, count] of trade.give)
      if (countItem(this.inventory, item) < count) {
        this.sound('villager_no', mob.position.x, mob.position.y + 1.6, mob.position.z);
        return { ok: false, reason: `Не хватает: ${itemRegistry.find(item)?.name ?? item}` };
      }
    for (const [item, count] of trade.give) removeItem(this.inventory, item, count);
    const [item, count] = trade.get;
    const def = itemRegistry.find(item);
    // What does not fit falls at the feet.
    const left = addItems(this.inventory, item, count);
    if (left > 0)
      this.entities.spawnDrops(
        [{ item, count: left }],
        Math.floor(this.player.position.x),
        Math.floor(this.player.position.y + 1),
        Math.floor(this.player.position.z),
        this.random,
      );
    while (mob.tradeUses.length <= index) mob.tradeUses.push(0);
    mob.tradeUses[index]++;
    this.survival.addXp(3);
    this.sound('villager_yes', mob.position.x, mob.position.y + 1.6, mob.position.z);
    return { ok: true, message: `Обмен: ${def?.name ?? item} ×${count}` };
  }
  /**
   * Villages near the player get their villagers: the first visit fills a village (one per
   * house and farm, a smith in the smithy, a librarian in the library, a priest in the church),
   * later a missing one moves in every two minutes or so, as villagers breed in the reference.
   */
  private tickVillages(): void {
    if (++this.villageClock % 40 !== 0) return;
    if (!this.naturalSpawns || this.survival.dead) return;
    if (this.generatorVersion < 5 || this.world.dimensionID !== 'overworld') return;
    const preset = this.worldPreset;
    if (!isBiomePreset(preset)) return;
    const p = this.player.position;
    const cx = Math.floor(p.x / 16),
      cz = Math.floor(p.z / 16);
    const villages = generatorV5(this.world.seed, preset).structures.near(
      cx - 3,
      cz - 3,
      cx + 3,
      cz + 3,
      ['village'],
    );
    for (const village of villages) {
      if (Math.hypot(village.x + 0.5 - p.x, village.z + 0.5 - p.z) > VILLAGE_POPULATE_RADIUS)
        continue;
      const key = `${village.x},${village.z}`;
      const homes = villageHomes(village.pieces);
      const target = Math.min(12, Math.max(3, homes.length));
      const residents = this.mobs.list.filter(
        (mob) =>
          mob.kind === 'lab:villager' &&
          mob.home &&
          Math.abs(mob.home.x - (village.x + 0.5)) < 1 &&
          Math.abs(mob.home.z - (village.z + 0.5)) < 1,
      ).length;
      const last = this.villagesSeen.get(key);
      if (residents >= target) {
        if (last === undefined) this.villagesSeen.set(key, this.villageClock);
        continue;
      }
      // Saved villagers mean the village was settled before: only top it up slowly.
      const first = last === undefined && residents === 0;
      if (!first && last !== undefined && this.villageClock - last < VILLAGE_TOP_UP_TICKS) continue;
      if (!first && last === undefined) {
        this.villagesSeen.set(key, this.villageClock);
        continue;
      }
      let wanted = first ? target - residents : 1;
      let placed = 0;
      for (let i = 0; i < homes.length * 2 && wanted > 0; i++) {
        const home = homes[(i + residents) % homes.length];
        const spot = this.villagerSpot(home.box);
        if (!spot) continue;
        if (this.mobs.list.length >= MAX_MOBS) break;
        const mob = this.mobs.spawn('lab:villager', spot);
        mob.variant = VILLAGER_PROFESSIONS.indexOf(
          home.profession ?? (i % 3 === 2 ? 'butcher' : 'farmer'),
        );
        mob.home = { x: village.x + 0.5, y: spot.y, z: village.z + 0.5 };
        mob.yaw = ((placed * 2.39996 + (village.x & 7)) % 6.2832) - Math.PI;
        wanted--;
        placed++;
      }
      if (placed > 0 || first) this.villagesSeen.set(key, this.villageClock);
    }
  }
  /** Right click with a rod: cast the bobber, or pull it in (with the catch, on a bite). */
  private fish(): InteractionResult {
    const b = this.bobber;
    const eye = this.eyePosition();
    if (!b) {
      this.bobber = castBobber(eye, lookDirection(this.input.yaw, this.input.pitch), this.random);
      this.sound('throw', eye.x, eye.y, eye.z);
      return { ok: true, message: 'Удочка заброшена' };
    }
    this.bobber = null;
    this.sound('throw', eye.x, eye.y, eye.z);
    if (b.inWater && b.bite > 0) {
      const loot = fishingCatch(this.random);
      const def = itemRegistry.find(loot.item);
      const left = addItems(this.inventory, loot.item, loot.count);
      if (left > 0)
        this.entities.spawnDrops(
          [{ item: loot.item, count: left }],
          Math.floor(this.player.position.x),
          Math.floor(this.player.position.y + 1),
          Math.floor(this.player.position.z),
          this.random,
        );
      this.visualEvents.emit(this.world.tick, 'splash', { x: b.x, y: b.y, z: b.z }, undefined, 1);
      this.survival.addXp(1 + Math.floor(this.random() * 6));
      this.damageHeldTool(true);
      const what = loot.kind === 'treasure' ? 'Сокровище' : 'Улов';
      return { ok: true, message: `${what}: ${def?.name ?? loot.item}` };
    }
    // Tearing the hook out of a block wears the rod twice.
    if (b.stuck) {
      this.damageHeldTool(true);
      this.damageHeldTool(true);
    }
    return {
      ok: true,
      message: b.inWater ? 'Сорвалось: тяни, когда поплавок нырнёт' : 'Удочка смотана',
    };
  }
  /** The bobber flies, sinks to the surface of the water and waits for a bite. */
  private tickFishing(): void {
    const b = this.bobber;
    if (!b) return;
    const held = this.heldItem;
    const p = this.player.position;
    if (
      !held ||
      definition(held).use !== 'fish' ||
      this.survival.dead ||
      Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z) > FISHING_REACH ||
      b.y < -64
    ) {
      this.bobber = null;
      return;
    }
    b.age++;
    const water = (x: number, y: number, z: number) =>
      registry.get(this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))).fluid ===
      'water';
    const solid = (x: number, y: number, z: number) =>
      registry.get(this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))).solid;
    if (b.stuck) {
      // A hook in a block stays until the block goes.
      if (b.hold && solid(b.hold[0], b.hold[1], b.hold[2])) return;
      b.stuck = false;
      b.hold = undefined;
    }
    if (water(b.x, b.y, b.z)) {
      if (!b.inWater) {
        this.visualEvents.emit(
          this.world.tick,
          'splash',
          { x: b.x, y: b.y, z: b.z },
          undefined,
          0.5,
        );
        b.inWater = true;
      }
      const fy = Math.floor(b.y);
      const surface = water(b.x, fy + 1, b.z) ? fy + 1.5 : fy + 0.86;
      b.vx *= 0.6;
      b.vz *= 0.6;
      b.vy = Math.max(-0.1, Math.min(0.1, (surface - b.y) * 0.35));
      b.x += b.vx;
      b.z += b.vz;
      b.y += b.vy;
    } else {
      if (b.inWater && !water(b.x, b.y - 0.3, b.z)) b.inWater = false;
      b.vy -= 0.04;
      b.vx *= 0.97;
      b.vz *= 0.97;
      b.vy *= 0.98;
      if (!b.inWater)
        for (let k = 0; k < 4; k++) {
          const nx = b.x + b.vx / 4,
            ny = b.y + b.vy / 4,
            nz = b.z + b.vz / 4;
          if (solid(nx, ny, nz)) {
            b.stuck = true;
            b.hold = [Math.floor(nx), Math.floor(ny), Math.floor(nz)];
            b.vx = b.vy = b.vz = 0;
            break;
          }
          b.x = nx;
          b.y = ny;
          b.z = nz;
          if (water(b.x, b.y, b.z)) break;
        }
    }
    if (!b.inWater) return;
    if (b.bite > 0) {
      if (--b.bite === 0) b.wait = nextWait(this.random);
      return;
    }
    // Rain on the water makes the fish bite sooner.
    const rain =
      this.weatherLevel().rain > 0.2 &&
      this.light.skyLight(Math.floor(b.x), Math.floor(b.y) + 1, Math.floor(b.z)) >= 15;
    b.wait -= rain ? 2 : 1;
    if (b.wait > 0) return;
    b.bite = BITE_HOLD_MIN + Math.floor(this.random() * BITE_HOLD_SPAN);
    this.visualEvents.emit(this.world.tick, 'splash', { x: b.x, y: b.y, z: b.z }, undefined, 0.8);
  }
  private landmarkCache: {
    x: number;
    z: number;
    dim: string;
    list: { kind: 'village'; x: number; y: number; z: number }[];
  } | null = null;
  /**
   * The villages within LANDMARK_RADIUS: their well, where the roads start. Planned from the seed,
   * so a village shows on the compass before its chunks load (as it does on the far terrain).
   * Recomputed when the player has moved 32 blocks.
   */
  private landmarks(): { kind: 'village'; x: number; y: number; z: number }[] {
    const p = this.player.position,
      dim = this.world.dimensionID;
    const c = this.landmarkCache;
    if (c && c.dim === dim && Math.hypot(c.x - p.x, c.z - p.z) < 32) return c.list;
    const list: { kind: 'village'; x: number; y: number; z: number }[] = [];
    const preset = this.worldPreset;
    if (this.generatorVersion >= 5 && dim === 'overworld' && isBiomePreset(preset)) {
      const r = Math.ceil(LANDMARK_RADIUS / 16),
        cx = Math.floor(p.x / 16),
        cz = Math.floor(p.z / 16);
      for (const v of generatorV5(this.world.seed, preset).structures.near(
        cx - r,
        cz - r,
        cx + r,
        cz + r,
        ['village'],
      )) {
        if (Math.hypot(v.x - p.x, v.z - p.z) > LANDMARK_RADIUS) continue;
        const well = v.pieces[0]?.box;
        list.push({ kind: 'village', x: v.x + 0.5, y: well ? well.y1 : 64, z: v.z + 0.5 });
      }
    }
    this.landmarkCache = { x: p.x, z: p.z, dim, list };
    return list;
  }
  /** A free standing place inside a building's box: floor under the feet, two cells of air. */
  private villagerSpot(b: {
    x0: number;
    y0: number;
    z0: number;
    x1: number;
    y1: number;
    z1: number;
  }): Vec3 | undefined {
    const mx = (b.x0 + b.x1) >> 1,
      mz = (b.z0 + b.z1) >> 1;
    if (!this.world.isLoaded(mx, mz)) return undefined;
    const cells: [number, number][] = [];
    for (let x = b.x0; x <= b.x1; x++) for (let z = b.z0; z <= b.z1; z++) cells.push([x, z]);
    cells.sort((a, c) => Math.hypot(a[0] - mx, a[1] - mz) - Math.hypot(c[0] - mx, c[1] - mz));
    const free = (x: number, y: number, z: number) =>
      !registry.get(this.world.getBlock(x, y, z)).solid;
    for (const [x, z] of cells) {
      if (!this.world.isLoaded(x, z)) continue;
      for (let y = b.y0; y <= b.y0 + 4; y++)
        if (
          registry.get(this.world.getBlock(x, y - 1, z)).solid &&
          free(x, y, z) &&
          free(x, y + 1, z) &&
          registry.get(this.world.getBlock(x, y, z)).fluid === undefined
        )
          return { x: x + 0.5, y, z: z + 0.5 };
    }
    return undefined;
  }
  enchantApply(offerId: string): InteractionResult {
    if (this.open?.kind !== 'enchanting') return { ok: false, reason: 'Стол не открыт' };
    const item = this.grid.get(0);
    const definition = item ? itemRegistry.find(item.item) : undefined;
    if (!definition) return { ok: false, reason: 'Положи предмет в слот' };
    const offer = this.offersFor(definition).find((entry) => entry.id === offerId);
    if (!offer) return { ok: false, reason: 'Нет такого предложения' };
    const levels = this.survival.progress.level;
    if (levels < offer.cost) return { ok: false, reason: `Нужно уровней: ${offer.cost}` };
    const lapis = countItem(this.inventory, 'lab:lapis');
    if (lapis < ENCHANT_LAPIS_PER_OFFER) return { ok: false, reason: 'Нужен лазурит' };
    if ((item?.enchantments?.[offer.id as EnchantmentId] ?? 0) >= offer.level)
      return { ok: false, reason: 'Такое зачарование уже есть на этом предмете' };
    this.grid.set(0, {
      ...item!,
      enchantments: copyEnchantments({ ...item?.enchantments, [offer.id]: offer.level }),
    });
    removeItem(this.inventory, 'lab:lapis', ENCHANT_LAPIS_PER_OFFER);
    this.survival.spendLevels(offer.cost);
    this.note(`${definition.name}: ${offer.name} ${offer.level}`);
    return { ok: true, message: `${definition.name}: ${offer.name} ${offer.level}` };
  }
  /** Takes the anvil result, paying its level cost. */
  anvilTake(): InteractionResult {
    if (this.open?.kind !== 'anvil') return { ok: false, reason: 'Наковальня не открыта' };
    const result = anvilResult(this.grid.get(0), this.grid.get(1));
    if (!result) return { ok: false, reason: 'Эти предметы не сочетаются' };
    if (this.survival.progress.level < result.cost)
      return { ok: false, reason: `Нужно уровней: ${result.cost}` };
    const stack = result.stack!;
    const leftover = addStack(this.inventory, stack, 0, PLAYER_MAIN_SLOTS)?.count ?? 0;
    if (leftover > 0) return { ok: false, reason: 'Освободи место в инвентаре' };
    this.survival.spendLevels(result.cost);
    this.grid.set(0, null);
    this.grid.set(1, null);
    this.note(result.message);
    return { ok: true, message: `${result.message}, уровней: ${result.cost}` };
  }
  /** Fills the brewing stand with water bottles and blaze powder, as a player would. */
  private brewingInsertOld(): InteractionResult {
    if (this.open?.kind !== 'brewing' || !this.open.key)
      return { ok: false, reason: 'Стойка не открыта' };
    const stand = this.brewing.ensure(...parseKey(this.open.key));
    let moved = 0;
    for (const index of [0, 1, 2]) {
      if (stand.bottles[index]) continue;
      const taken = removeItem(this.inventory, 'lab:potion_water', 1);
      if (taken === 0) break;
      stand.bottles[index] = { item: 'lab:potion_water', count: 1, damage: 0 };
      moved++;
    }
    const powder = removeItem(this.inventory, BLAZE_POWDER_ITEM, 1);
    if (powder > 0) {
      stand.fuel += BREW_FUEL_PER_POWDER;
      moved++;
    }
    if (moved === 0) return { ok: false, reason: 'Нужны зелья воды и огненный порошок' };
    return { ok: true, message: `Загружено в стойку: ${moved}` };
  }
  /** Pours the finished potions back into the inventory. */
  private brewingCollectOld(): InteractionResult {
    if (this.open?.kind !== 'brewing' || !this.open.key)
      return { ok: false, reason: 'Стойка не открыта' };
    const stand = this.brewing.ensure(...parseKey(this.open.key));
    let moved = 0;
    for (const [index, bottle] of stand.bottles.entries()) {
      if (!bottle) continue;
      if (addStack(this.inventory, bottle, 0, PLAYER_MAIN_SLOTS)) continue;
      stand.bottles[index] = null;
      moved++;
    }
    if (moved === 0) return { ok: false, reason: 'Нечего забирать' };
    return { ok: true, message: `Забрано зелий: ${moved}` };
  }
  inventoryData(): SlotData[] {
    return encodeSlots(this.inventory.slots);
  }
  /** Items in the world, for the renderer only. */
  itemData(): { id: number; item: string; x: number; y: number; z: number }[] {
    return this.entities.renderPositions();
  }
  amountOf(item: string): number {
    return countItem(this.inventory, item);
  }
  consume(item: string, count = 1): boolean {
    if (countItem(this.inventory, item) < count) return false;
    removeItem(this.inventory, item, count);
    return true;
  }
  /** Non-null when the player is inside reach of the block position. */
  reachable(x: number, y: number, z: number): boolean {
    return withinReach(this.player.position, x, y, z);
  }
  restoreInventory(data: { selected: number; slots: SlotData[] }): void {
    if (data.slots.length !== this.inventory.size)
      throw new Error(
        `Saved inventory has ${data.slots.length} slots, expected ${this.inventory.size}`,
      );
    const slots = decodeSlots(data.slots);
    for (let i = 0; i < slots.length; i++) this.inventory.set(i, slots[i]);
    this.inventory.selected = Math.max(0, Math.min(8, Math.floor(data.selected)));
  }
  containerData(): SavedContainer[] {
    return this.containers.snapshotEntries();
  }
  restoreContainerData(entries: readonly SavedContainer[]): void {
    this.containers.restoreEntries(entries);
  }
  /** Everything a save file carries about items, in one comparable shape. */
  itemState(): {
    inventory: SlotData[];
    selected: number;
    cursor: SlotData;
    containers: SavedContainer[];
    items: SavedItemEntity[];
  } {
    return {
      inventory: this.inventoryData(),
      selected: this.selected,
      cursor: this.cursor ? encodeSlots([this.cursor])[0] : null,
      containers: this.containerData(),
      items: this.entities.snapshot(),
    };
  }
  /** Everything the interface needs to draw survival, combat and the day cycle. */
  survivalData(): {
    health: number;
    maxHealth: number;
    absorption: number;
    food: number;
    saturation: number;
    exhaustion: number;
    air: number;
    xp: number;
    level: number;
    xpInto: number;
    xpNeeded: number;
    xpFraction: number;
    armor: number;
    difficulty: Difficulty;
    dead: boolean;
    damageType: DamageType | null;
    effects: { id: string; name: string; amplifier: number; duration: number }[];
    spawn: Vec3;
  } {
    const survival = this.survival;
    const progress = survival.progress;
    const armor = armorOf(this.inventory.slots);
    return {
      health: survival.health,
      maxHealth: MAX_HEALTH,
      absorption: survival.absorption,
      food: survival.food,
      saturation: survival.saturation,
      exhaustion: survival.exhaustion,
      air: survival.air,
      xp: survival.xp,
      level: progress.level,
      xpInto: progress.into,
      xpNeeded: progress.needed,
      xpFraction: progress.fraction,
      armor: armor.points,
      difficulty: survival.difficulty,
      dead: survival.dead,
      damageType: survival.lastDamageType,
      effects: survival.effects.list.map((effect) => ({
        id: effect.id,
        name: effectName(effect.id),
        amplifier: effect.amplifier,
        duration: effect.duration,
      })),
      spawn: { ...survival.spawn },
    };
  }
  mobData(): {
    id: number;
    kind: string;
    name: string;
    x: number;
    y: number;
    z: number;
    yaw: number;
    health: number;
    hurt: boolean;
    attack: number;
    fuse: number;
    baby: boolean;
    grounded: boolean;
    aggressive: boolean;
    burning: boolean;
    variant: number;
    sheared: boolean;
    eating: number;
    climbing: boolean;
    charge: number;
    swimming: boolean;
    love: boolean;
    panic: boolean;
  }[] {
    return this.mobs.list.map((mob) => ({
      id: mob.id,
      kind: mob.kind,
      name: mobDefinition(mob.kind)?.name ?? mob.kind,
      x: mob.position.x,
      y: mob.position.y,
      z: mob.position.z,
      yaw: mob.yaw,
      health: mob.health,
      hurt: mob.hurtTime > 0,
      attack: mob.attackCooldown,
      fuse: mob.fuse,
      baby: mob.baby,
      grounded: mob.onGround,
      aggressive: mob.aggressive,
      burning: mob.fireTicks > 0,
      variant: mob.variant,
      sheared: mob.sheared,
      eating: mob.eating,
      climbing: mob.climbing,
      charge: mob.charge,
      swimming: mob.inWater,
      love: mob.loveTicks > 0,
      panic: mob.panic > 0,
    }));
  }
  savedMobs(): SavedMob[] {
    return this.mobs.snapshot();
  }
  restoreMobs(data: readonly SavedMob[]): number {
    return this.mobs.restore(data);
  }
  savedArrows(): SavedArrow[] {
    return this.arrows.snapshot();
  }
  restoreArrows(data: readonly SavedArrow[]): number {
    return this.arrows.restore(data);
  }
  /** The world systems' own state, for the save file. */
  blockData(): {
    fluids: SavedFluid[];
    fire: SavedFire[];
    fuses: SavedFalling[];
    falling: SavedFalling[];
    redstone: SavedComponent[];
  } {
    return {
      fluids: this.fluids.snapshot(),
      fire: this.blockSim.snapshotFire(),
      fuses: this.blockSim.snapshotFuses(),
      falling: this.blockSim.snapshotFalling(),
      redstone: this.redstone.snapshot(),
    };
  }
  restoreBlockData(data: {
    fluids?: readonly SavedFluid[];
    fire?: readonly SavedFire[];
    fuses?: readonly SavedFalling[];
    falling?: readonly SavedFalling[];
    redstone?: readonly SavedComponent[];
  }): void {
    this.fluids.restore(data.fluids ?? []);
    this.blockSim.restoreFire(data.fire ?? []);
    this.blockSim.restoreFuses(data.fuses ?? []);
    this.blockSim.restoreFalling(data.falling ?? []);
    this.redstone.restore(data.redstone ?? []);
    // A restored world may hold components the save did not list; rescannning finds them.
    if (!data.redstone?.length) this.redstone.rescan();
  }
  savedEnchantments(): SavedEnchantment[] {
    return this.enchantments.snapshot();
  }
  restoreEnchantments(data: readonly SavedEnchantment[]): number {
    return this.enchantments.restore(data);
  }
  brewingData(): { key: string; state: BrewingState }[] {
    return this.brewing.snapshot();
  }
  restoreBrewingData(data: readonly { key: string; state: BrewingState }[]): void {
    this.brewing.restore(data);
  }
  savedCarts(): SavedCart[] {
    return this.carts.snapshot();
  }
  restoreCarts(data: readonly SavedCart[]): number {
    return this.carts.restore(data);
  }
  restoreBosses(data: SavedBossState | undefined): void {
    this.bosses.restore(data);
  }
  savedOrbs(): SavedOrb[] {
    return this.orbs.snapshot();
  }
  restoreOrbs(data: readonly SavedOrb[]): number {
    return this.orbs.restore(data);
  }
  restoreSurvival(data: SavedSurvival): void {
    this.deathHandled = data.dead;
    this.survival.restore(data);
  }
  private noteItem(item: string): void {
    const goal = goalForItem(item);
    if (goal) this.journey.add(goal);
  }
  cancelActions(): void {
    this.player.velocity.x = 0;
    this.player.velocity.z = 0;
    if (this.player.flying) this.player.velocity.y = 0;
    this.setInput({ ...EMPTY_INPUT, yaw: this.input.yaw, pitch: this.input.pitch });
    this.setMining(false);
    this.useHeld = false;
    this.useTicks = 0;
    this.bowCharge = 0;
    this.eating = false;
  }
  persistenceStamp(journals: unknown): string {
    return stateStamp({
      journals,
      dimension: this.world.dimensionID,
      dimensions: this.dimensionSnapshot(),
      player: this.player,
      look: { yaw: this.input.yaw, pitch: this.input.pitch },
      inventory: this.inventoryData(),
      selected: this.selected,
      cursor: this.cursor,
      grid: this.grid.slots,
      anvil: [this.anvilFirst, this.anvilSecond],
      survival: this.survival.snapshot(),
      containers: this.containerData(),
      items: this.entities.snapshot(),
      mobs: this.savedMobs(),
      arrows: this.savedArrows(),
      orbs: this.savedOrbs(),
      bosses: this.bosses.snapshot(),
      blocks: this.blockData(),
      brewing: this.brewingData(),
      carts: this.savedCarts(),
      enchantments: this.savedEnchantments(),
      scheduler: this.world.scheduler.snapshot(),
      explicitTimeRevision: this.explicitTimeRevision,
      minute: Math.floor(this.world.time / 1200),
      gameMode: this.gameMode,
      journey: [...this.journey],
    });
  }
  snapshot(refreshStorage = true) {
    if (refreshStorage || !this.storageProjection)
      this.storageProjection = {
        containers: this.containerData(),
        itemEntities: this.entities.snapshot(),
      };
    return {
      persistenceStamp: '',
      visualEvents: this.visualEvents.snapshot(this.world.tick),
      cameraMedium: cameraMedium(this.world, this.player.position, this.input.crouch),
      gameMode: this.gameMode,
      journey: [...this.journey],
      tick: this.world.tick,
      time: this.world.time,
      dimension: this.world.dimensionID,
      weather: this.weatherSnapshot(),
      /** The boss bar: the nearest fight, its health and how it is doing. */
      boss: (() => {
        const boss = this.bosses.nearest(this.player.position);
        if (!boss) return null;
        return {
          kind: boss.kind,
          name: boss.kind === 'ender_dragon' ? 'Дракон Края' : 'Иссушитель',
          health: boss.health,
          maxHealth: boss.maxHealth,
          phase: boss.phase,
        };
      })(),
      portal: this.portalBlockTarget()
        ? { progress: Math.min(1, this.portalTicks / Math.max(1, this.portalDelayTicks)) }
        : null,
      night: this.isNight,
      /** Villages within sight of the horizon, for the compass strip. */
      landmarks: this.landmarks(),
      /** The fishing bobber, and whether a fish is on it right now. */
      bobber: this.bobber
        ? { x: this.bobber.x, y: this.bobber.y, z: this.bobber.z, bite: this.bobber.bite > 0 }
        : null,
      look: { yaw: this.input.yaw, pitch: this.input.pitch },
      hearing: this.hearingData(),
      /** Block under the feet, for footsteps of the right material. */
      ground: this.world.getBlock(
        Math.floor(this.player.position.x),
        Math.floor(this.player.position.y - 0.2),
        Math.floor(this.player.position.z),
      ),
      player: {
        ...this.player,
        position: { ...this.player.position },
        velocity: { ...this.player.velocity },
      },
      target: this.target(),
      selected: this.inventory.selected,
      edits: this.edits,
      columns: this.world.columns.size,
      sections: this.world.sectionCount,
      storageBytes: this.world.storageBytes,
      revision: this.world.revision,
      inventory: this.inventoryData(),
      cursor: this.cursor ? encodeSlots([this.cursor])[0] : null,
      containers: this.storageProjection.containers,
      itemEntities: this.storageProjection.itemEntities,
      mining: this.mining ? { ...this.mining } : null,
      items: this.itemData(),
      container: this.containerView(),
      survival: this.survivalData(),
      mobs: this.mobData(),
      arrows: this.arrows.renderPositions(),
      carts: this.carts.renderPositions(),
      bosses: this.bosses.list.map((b) => ({
        id: b.id,
        kind: b.kind,
        x: b.position.x,
        y: b.position.y,
        z: b.position.z,
        yaw: b.yaw,
        hurt: b.hurtTime > 0,
        phase: b.phase,
      })),
      crystals: this.bosses.crystals.map((c) => ({ id: c.id, ...c.position })),
      skulls: this.bosses.skulls.map((c) => ({ id: c.id, ...c.position })),
      orbs: this.orbs.renderPositions(),
      use: {
        active: this.useHeld,
        eating: this.eating,
        ticks: this.useTicks,
        eatTotal: EAT_TICKS,
        bowCharge: this.bowCharge,
        bowTotal: BOW_CHARGE_TICKS,
        blocking: this.isBlocking(),
      },
      /** Posture of the player's own body, for the third-person model and the camera. */
      motion: {
        sprinting: this.sprinting,
        crouching: this.input.crouch && !this.player.flying,
        riding: this.carts.riding !== null,
      },
      near: this.nearSolid(),
      attack: {
        charge: attackCharge(this.attackTicks, this.heldDefinition).charge,
        ready: attackCharge(this.attackTicks, this.heldDefinition).ready,
      },
      messages: this.messages.slice(-4),
    };
  }
}
/** Edge of the solid-cell grid sent to the host for camera collision (odd: centred). */
export const NEAR_SIZE = 11;
export interface NearSolid {
  x: number;
  y: number;
  z: number;
  size: number;
  bits: Uint8Array;
}
/** The same reach the raycast uses for mining; a container further away cannot be opened. */
export const REACH_DISTANCE = 6;
export function withinReach(position: Vec3, x: number, y: number, z: number): boolean {
  const dx = x + 0.5 - position.x;
  const dy = y + 0.5 - (position.y + 1.62 - 1.62);
  const dz = z + 0.5 - position.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) <= REACH_DISTANCE;
}
/** Slot regions of a station view: its own slots first, then the player inventory. */
export function stationRegions(stationSize: number): { name: string; from: number; to: number }[] {
  return [
    { name: 'container', from: 0, to: stationSize },
    { name: 'hotbar', from: stationSize, to: stationSize + 9 },
    { name: 'main', from: stationSize + 9, to: stationSize + 36 },
    { name: 'armor', from: 36, to: 40 },
    { name: 'offhand', from: 40, to: 41 },
  ];
}
export const PLAYER_INVENTORY_REGIONS = [
  { name: 'hotbar', from: 0, to: 9 },
  { name: 'main', from: 9, to: 36 },
  { name: 'armor', from: 36, to: 40 },
  { name: 'offhand', from: 40, to: 41 },
] as const;
export type SimulationSnapshot = ReturnType<Simulation['snapshot']>;
export function parseKey(key: string): [number, number, number] {
  const [x, y, z] = key.split(',').map(Number);
  return [x, y, z];
}
function collect(view: Container): Slot[] {
  const slots: Slot[] = [];
  for (let i = 0; i < view.size; i++) slots.push(view.get(i));
  return slots;
}
function effectName(id: string): string {
  return effectDefinition(id)?.name ?? id;
}
export { decodeSlots, stacksEqual, CHEST_SLOTS, FURNACE_SLOTS, CONTAINER_VIEW_REGIONS };
