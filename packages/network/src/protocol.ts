import type { CoreCheckpoint, SavedOverride } from '../../core/src/persistence';
import type { PlayerInput } from '../../core/src/player';
import type {
  OpenContainerKind,
  SimulationSnapshot,
  SlotClickOptions,
} from '../../core/src/simulation';
import type { Difficulty } from '../../core/src/survival';
import type { WorldPreset } from '../../core/src/terrain';
import type { SectionMesh } from '../../renderer/src/mesher';
import type { runCoreFixture } from '../../core/src/fixture';
import type { DimensionId } from '../../core/src/dimensions';
// Version 7: packed geometry, column batches and bounded transient visual cues. Save format stays 6.
export const PROTOCOL_VERSION = 7;
export type HostCommand =
  | {
      type: 'init';
      session: number;
      seed: string;
      preset: WorldPreset;
      radius: number;
      /** false turns the automatic creature spawns off: deterministic test worlds. */
      naturalSpawning?: boolean;
      checkpoint?: CoreCheckpoint;
      /** A network game: the Worker reports the blocks this player changes. */
      online?: boolean;
    }
  | { type: 'net-edits'; edits: SavedOverride[] }
  | { type: 'input'; input: PlayerInput }
  | { type: 'cancel-input' }
  | { type: 'interact'; action: 'hit' | 'use' | 'pick' }
  | { type: 'mine'; active: boolean }
  | { type: 'hold'; active: boolean }
  | { type: 'time'; value: number }
  // Debug hooks of the development build: raw block writes and circuit readings for the
  // regression suite. They go through the ordinary write path, so a saved world sees them.
  | { type: 'block'; x: number; y: number; z: number; state: number }
  | { type: 'probe'; x: number; y: number; z: number }
  | { type: 'press'; x: number; y: number; z: number }
  | { type: 'difficulty'; difficulty: Difficulty }
  | { type: 'mob'; kind: string | null; distance?: number }
  | { type: 'damage'; amount: number; kind?: string }
  | { type: 'time'; value: number }
  | { type: 'vitals'; health?: number; food?: number; saturation?: number; xp?: number }
  | { type: 'select'; state: number }
  | { type: 'hotbar'; index: number }
  | { type: 'grant'; item: string; count: number }
  | { type: 'creative-take'; item: string; mode: 'stack' | 'one' | 'inventory' }
  | { type: 'creative-trash'; all: boolean }
  | { type: 'teleport'; x: number; y: number; z: number }
  | { type: 'weather'; rain: number | null; thunder: number }
  | { type: 'drop'; all: boolean }
  | { type: 'die' }
  | {
      type: 'slot-click';
      /** null or 'grid'/'result' for the player interface, otherwise the container key. */
      id: string | null;
      index: number;
      button: number;
      options: SlotClickOptions;
    }
  | { type: 'open'; kind: OpenContainerKind; x: number; y: number; z: number }
  | { type: 'open-crafting' }
  | { type: 'close-container' }
  | { type: 'enchant-apply'; id: string }
  | { type: 'trade'; index: number }
  | { type: 'brewing-fill' }
  | { type: 'brewing-take' }
  | { type: 'anvil-take' }
  | { type: 'recipe'; id: string }
  | { type: 'pause'; paused: boolean }
  | { type: 'step' }
  | { type: 'fly' }
  | { type: 'respawn' }
  | { type: 'radius'; radius: number }
  /** Debug and host travel between dimensions; portals do the same on their own. */
  | { type: 'travel'; dimension: DimensionId }
  | { type: 'fixture'; requestID: number }
  | { type: 'capture'; requestID: number; session: number };
export type WorkerEvent =
  | { type: 'mesh'; session: number; mesh: SectionMesh }
  | { type: 'evict'; session: number; cx: number; cz: number }
  /** The player stepped through a portal: every mesh of the old dimension is gone. */
  | {
      type: 'travel';
      session: number;
      dimension: DimensionId;
      position: { x: number; y: number; z: number };
      built: boolean;
      message: string;
    }
  | { type: 'progress'; session: number; done: number; total: number; phase: string }
  | {
      type: 'ready';
      session: number;
      spawn: { x: number; y: number; z: number };
      look: { yaw: number; pitch: number };
    }
  | {
      type: 'snapshot';
      session: number;
      state: Omit<SimulationSnapshot, 'containers' | 'itemEntities'> &
        Partial<Pick<SimulationSnapshot, 'containers' | 'itemEntities'>>;
      jobs: {
        generationMs: number;
        meshMs: number;
        lightMs: number;
        stampMs: number;
        lightColumns: number;
        batchMs: number;
      };
      tps: number;
      tickMs: number;
      backlog: number;
      droppedMs: number;
      paused: boolean;
    }
  | { type: 'notice'; message: string; ok: boolean; picked?: number }
  | { type: 'hand-item'; item: string | null }
  | { type: 'fixture-result'; requestID: number; result: ReturnType<typeof runCoreFixture> }
  | { type: 'checkpoint'; requestID: number; session: number; core: CoreCheckpoint; stamp: string }
  | { type: 'capture-error'; requestID: number; message: string }
  | { type: 'net-edits'; session: number; edits: SavedOverride[] }
  | { type: 'error'; message: string };
