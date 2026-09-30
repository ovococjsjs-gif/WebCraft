import type { GameMode, JourneyGoal } from './gameplay';
import { registry } from '../../content/src/blocks';
import { columnKey, chunkCoord, type Vec3 } from './coordinates';
import type { PlayerState } from './player';
import type { WorldPreset } from './terrain';
import type { ScheduledEvent } from './clock';
import type { SlotData } from './inventory';
import type { SavedItemEntity } from './entities';
import type { SavedMob } from './mobs';
import type { SavedArrow, SavedOrb } from './projectiles';
import type { SavedSurvival } from './survival';
import type { SavedFluid } from './fluids';
import type { SavedFalling, SavedFire } from './blocksim';
import type { SavedComponent } from './redstone';
import type { SavedEnchantment, BrewingState } from './stations';
import type { SavedCart } from './vehicles';
import type { DimensionId } from './dimensions';
import type { DimensionState } from './simulation';
import type { SavedBossState } from './bosses';

/**
 * Changing this generator requires an explicit migration or keeping the old implementation.
 * Version 2 is the biome generator; its the two scenic fixtures kept their version 1 output
 * byte for byte, so an old flat or valley save still loads and still regenerates the same world.
 */
export const GENERATOR_ID = 'voxel-lab:terrain';
/**
 * v3 adds strongholds; v4 fixes outer-city cells and fortress headroom; v5 is the 1.12-style
 * overworld of `worldgen/`. Old paths stay available and are pinned by the golden fingerprints.
 */
export const GENERATOR_VERSION = 5;
export type GeneratorVersion = 1 | 2 | 3 | 4 | 5;
/** Generator version every save written before the biome worlds carries. */
export const SCENIC_GENERATOR_VERSION = 1;
export type SavedOverride = [
  x: number,
  y: number,
  z: number,
  blockKey: string,
  dimension?: DimensionId,
];
/** One dimension as it waits while the player is somewhere else. */
export interface SavedDimension {
  dimension: DimensionId;
  state: DimensionState;
}
/** One block container as it travels through a save file. */
export interface SavedContainer {
  key: string;
  kind: 'chest' | 'furnace' | 'hopper' | 'dispenser';
  slots: SlotData[];
  /** Furnaces keep their burn, cook and experience counters so a smelt resumes after loading. */
  furnace?: { burn: number; burnTotal: number; cook: number; xp: number; perItem?: number };
}
export interface SavedInventory {
  selected: number;
  slots: SlotData[];
}
export interface CoreCheckpoint {
  gameMode?: GameMode;
  journey?: JourneyGoal[];
  generator: {
    id: typeof GENERATOR_ID;
    version: GeneratorVersion;
    seed: string;
    preset: WorldPreset;
  };
  dimension: DimensionId;
  /** The dimensions the player is not in: creatures, chests, fire and redstone of each. */
  dimensions: SavedDimension[];
  /** The dragon, the wither and the crystals of the dimension the player is in. */
  bosses: SavedBossState;
  tick: number;
  /** Time of day in ticks, 0..23999. */
  time: number;
  spawn: Vec3;
  player: PlayerState;
  look: { yaw: number; pitch: number };
  /** 36 main/hotbar slots, 4 armour slots and 1 off-hand slot. */
  inventory: SavedInventory;
  /** Stack carried by the interface cursor; preserved separately in a checkpoint. */
  cursor: SlotData;
  containers: SavedContainer[];
  /** Dropped items still lying in the world. */
  items: SavedItemEntity[];
  /** Health, hunger, air, experience, effects, difficulty and the respawn point. */
  survival: SavedSurvival;
  /** Living test creatures; full mob AI arrives later, their state does not change. */
  mobs: SavedMob[];
  /** Arrows in flight or stuck in the ground. */
  arrows: SavedArrow[];
  /** Experience orbs waiting to be collected. */
  orbs: SavedOrb[];
  /**
   * State of the world systems: fluid cells still to be evaluated, burning fire, fuses of
   * primed TNT, blocks in the middle of falling and every redstone component's power.
   */
  blocks: {
    fluids: SavedFluid[];
    fire: SavedFire[];
    fuses: SavedFalling[];
    falling: SavedFalling[];
    redstone: SavedComponent[];
  };
  /** Legacy pre-v6 upgrades; migrated to each existing instance on import. */
  enchantments: SavedEnchantment[];
  /** Brewing stands, their bottles and the brews left in them. */
  brewing: { key: string; state: BrewingState }[];
  /** Minecarts standing on rails. */
  carts: SavedCart[];
  editCount: number;
  overrides: SavedOverride[];
  scheduler: { sequence: number; events: ScheduledEvent[] };
}

/** Independent of the loaded chunk cache: also retains edits to evicted chunks. */
export class OverrideJournal {
  revision = 0;
  constructor(readonly dimension: DimensionId = 'overworld') {}
  private readonly columns = new Map<
    string,
    Map<string, { x: number; y: number; z: number; state: number }>
  >();
  set(x: number, y: number, z: number, state: number): void {
    const key = columnKey(chunkCoord(x), chunkCoord(z));
    let column = this.columns.get(key);
    if (!column) {
      column = new Map();
      this.columns.set(key, column);
    }
    const pos = `${x},${y},${z}`;
    if (column.get(pos)?.state === state) return;
    column.set(pos, { x, y, z, state });
    this.revision++;
  }
  has(x: number, y: number, z: number): boolean {
    return (
      this.columns.get(columnKey(chunkCoord(x), chunkCoord(z)))?.has(`${x},${y},${z}`) ?? false
    );
  }
  forColumn(cx: number, cz: number) {
    return this.columns.get(columnKey(cx, cz))?.values() ?? [];
  }
  snapshot(): SavedOverride[] {
    const result: SavedOverride[] = [];
    for (const column of this.columns.values())
      // The Overworld is the default dimension: its entries carry no tag, so a world that never
      // leaves home keeps exactly the file it had before the dimensions existed.
      for (const e of column.values())
        result.push(
          this.dimension === 'overworld'
            ? [e.x, e.y, e.z, registry.get(e.state).key]
            : [e.x, e.y, e.z, registry.get(e.state).key, this.dimension],
        );
    return result.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
  }
  restore(entries: SavedOverride[]): void {
    this.columns.clear();
    for (const [x, y, z, key] of entries) {
      const block = registry.find(key);
      if (!block) throw new Error(`Unknown persisted block: ${key}`);
      this.set(x, y, z, block.id);
    }
  }
  get size(): number {
    let size = 0;
    for (const c of this.columns.values()) size += c.size;
    return size;
  }
}
