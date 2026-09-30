import type { GameMode } from '@core/gameplay';
import { WorldSession } from '@core/session';
import { PRESET_LABELS, type WorldPreset } from '@core/terrain';
import type { CoreCheckpoint } from '@core/persistence';
import type { SimulationSnapshot } from '@core/simulation';
import { IndexedWorldBackend, MemoryWorldBackend, type WorldMeta } from '@storage/backend';
import { WorldRepository, type OpenWorld } from '@storage/repository';
import {
  sealWorld,
  parseWorldFile,
  envelopeBytes,
  type ClientCheckpoint,
  type WorldEnvelope,
  type WorldPayload,
} from '@storage/format';
import { SaveError, storageError } from '@storage/errors';
export const AUTOSAVE_MS = 15_000;
export type SavePhase = 'opening' | 'idle' | 'saving' | 'saved' | 'error';
export interface SaveStatus {
  phase: SavePhase;
  durable: boolean;
  busy: boolean;
  dirty: boolean;
  savedAt: number | null;
  warning: string;
  error: string;
  active: WorldMeta | null;
  recovered: boolean;
}
export interface CaptureTicket {
  core: CoreCheckpoint;
  stamp: string;
}
export interface SaveBridge {
  ready(): boolean;
  current(): SimulationSnapshot | null;
  client(): ClientCheckpoint;
  capture(): Promise<CaptureTicket>;
  pause(): void;
  load(world: OpenWorld): void;
  changed(status: SaveStatus): void;
  notify(message: string, error?: boolean): void;
}
function signature(stamp: string, client: ClientCheckpoint): string {
  return JSON.stringify([stamp, client]);
}
export class SaveCoordinator {
  repository!: WorldRepository;
  active: OpenWorld | null = null;
  private phase: SavePhase = 'opening';
  private warning = '';
  private lastError: SaveError | null = null;
  private saving: Promise<boolean> | null = null;
  private operation = false;
  private committedSignature = '';
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private observedEditCount = 0;
  private touched = false;
  /** A freshly created world is not "dirty" just because the player settles onto the ground. */
  private settling = false;
  private testFailure: 'quota' | 'abort' | null = null;
  constructor(private readonly bridge: SaveBridge) {}
  get durable() {
    return this.repository?.backend.durable ?? false;
  }
  private fingerprint(): string | null {
    const s = this.bridge.current();
    if (!s || !this.bridge.ready()) return null;
    return signature(s.persistenceStamp, this.bridge.client());
  }
  get dirty(): boolean {
    if (this.settling) return false;
    const value = this.fingerprint();
    return !!value && value !== this.committedSignature;
  }
  get shouldWarnOnExit(): boolean {
    return this.durable ? this.dirty || !!this.saving : this.touched;
  }
  status(): SaveStatus {
    return {
      phase: this.phase,
      durable: this.durable,
      busy: this.operation || !!this.saving,
      dirty: this.dirty,
      savedAt: this.active?.meta.updatedAt ?? null,
      warning: this.warning,
      error: this.lastError?.message ?? '',
      active: this.active?.meta ?? null,
      recovered: this.active?.recovered ?? false,
    };
  }
  private emit() {
    this.bridge.changed(this.status());
  }
  private problem(error: unknown): SaveError {
    const e = storageError(error);
    this.lastError = e;
    this.phase = 'error';
    this.emit();
    this.bridge.notify(e.message, true);
    return e;
  }
  private makePayload(core: CoreCheckpoint, client: ClientCheckpoint): WorldPayload {
    if (!this.active) throw new SaveError('NOT_FOUND', 'Нет открытого мира.');
    return {
      name: this.active.meta.name,
      createdAt: this.active.meta.createdAt,
      savedAt: Date.now(),
      core,
      client,
    };
  }
  /**
   * Opens the requested world, else the last one. A world request in the URL only creates a new
   * world when it differs from the last one, so a plain page reload never silently spawns a copy.
   */
  async initialise(
    seed: string,
    preset: WorldPreset,
    client: ClientCheckpoint,
    requestedId: string | null,
    explicitConfig: boolean,
    gameMode?: GameMode,
  ) {
    try {
      const backend = await IndexedWorldBackend.open(
        undefined,
        undefined,
        import.meta.env.DEV
          ? {
              beforeCommit: () => {
                if (!this.testFailure) return;
                const failure = this.testFailure;
                this.testFailure = null;
                throw new DOMException(
                  'Искусственная ошибка записи для теста',
                  failure === 'quota' ? 'QuotaExceededError' : 'AbortError',
                );
              },
            }
          : {},
      );
      this.repository = new WorldRepository(backend);
    } catch {
      this.repository = new WorldRepository(new MemoryWorldBackend());
      this.warning =
        'Это окно не разрешает IndexedDB. Миры живут только до закрытия вкладки. Для постоянных сохранений открой живое превью или скачанный HTML отдельно; используй экспорт для переноса.';
    }
    try {
      let id = requestedId;
      if (!id) {
        const last = await this.repository.backend.getLast();
        if (last) {
          const meta = (await this.repository.list()).find((world) => world.id === last);
          if (!explicitConfig || (meta && meta.seed === seed && meta.preset === preset)) id = last;
        }
      }
      if (id) {
        try {
          const world = await this.repository.load(id);
          await this.activate(world);
          this.startTimer();
          return;
        } catch (error) {
          this.warning =
            error instanceof Error
              ? error.message
              : 'Последний мир не удалось открыть. Запись не удалена.';
        }
      }
      const initial = new WorldSession(seed, preset, undefined, gameMode).checkpoint();
      const now = Date.now();
      const payload: WorldPayload = {
        name: PRESET_LABELS[preset],
        createdAt: now,
        savedAt: now,
        core: initial,
        client,
      };
      let world: OpenWorld;
      try {
        world = await this.repository.create(payload);
      } catch (error) {
        // Only an unsaved new session may fall back. Existing database records remain untouched.
        this.warning = `${storageError(error).message} Новая сессия временная: экспортируй её перед выходом.`;
        this.repository.backend.close();
        this.repository = new WorldRepository(new MemoryWorldBackend());
        world = await this.repository.create(payload);
      }
      await this.activate(world);
    } catch (error) {
      throw this.problem(error);
    }
    this.startTimer();
  }
  private async activate(world: OpenWorld) {
    if (world.recovered) {
      // The catalog row still describes the damaged revision; report what is actually open.
      const restored = world.file.payload;
      world.meta = {
        ...world.meta,
        name: restored.name,
        seed: restored.core.generator.seed,
        preset: restored.core.generator.preset,
        tick: restored.core.tick,
        changedBlocks: restored.core.overrides.length,
        bytes: envelopeBytes(world.file),
      };
    }
    this.active = world;
    this.lastError = null;
    this.phase = 'idle';
    this.touched = false;
    this.settling = !world.recovered;
    this.committedSignature = '';
    this.observedEditCount = world.file.payload.core.editCount;
    try {
      await this.repository.backend.setLast(world.meta.id);
    } catch {
      this.warning =
        'Снимок доступен, но запомнить последний мир не удалось. Открой его через библиотеку.';
    }
    this.bridge.load(world);
    this.emit();
    if (world.recovered)
      this.bridge.notify(
        'Основной снимок повреждён. Открыта предыдущая проверенная копия; часть последних изменений могла быть потеряна.',
        true,
      );
  }
  private startTimer() {
    this.timer = setInterval(() => {
      if (!this.operation && !this.lastError && this.dirty) void this.save(false).catch(() => {});
    }, AUTOSAVE_MS);
  }
  /**
   * True during a network game: the world on screen belongs to the server, so nothing is written
   * to the local library until `resume()` reloads the local world.
   */
  suspended = false;
  /** Leaves a network game: the local world comes back exactly as it was last saved. */
  async resume() {
    return this.exclusive(async () => {
      this.suspended = false;
      if (this.active) await this.activate(await this.repository.load(this.active.meta.id));
    });
  }
  observe(s: SimulationSnapshot) {
    if (this.suspended) return;
    if (this.settling && this.bridge.ready()) {
      // Adopt the first settled snapshot as the baseline instead of writing it back.
      this.settling = false;
      this.committedSignature = this.fingerprint() ?? this.committedSignature;
    }
    if (this.bridge.ready() && this.dirty) this.touched = true;
    if (this.bridge.ready() && s.edits !== this.observedEditCount) {
      this.observedEditCount = s.edits;
      this.touched = true;
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => {
        if (!this.operation && !this.lastError) void this.save(false).catch(() => {});
      }, 1200);
    }
  }
  changedClient() {
    this.touched = true;
  }
  save(force = true): Promise<boolean> {
    if (this.saving) return this.saving;
    if (this.suspended || !this.active || !this.bridge.ready()) return Promise.resolve(false);
    // Autosaves skip a clean world. Explicit save ALWAYS captures a fresh checkpoint.
    if (!force && !this.dirty && !this.active.recovered) return Promise.resolve(true);
    const active = this.active;
    const task = (async () => {
      this.phase = 'saving';
      this.emit();
      const client = structuredClone(this.bridge.client());
      const { core, stamp } = await this.bridge.capture();
      if (this.active?.meta.id !== active.meta.id)
        throw new SaveError('CONFLICT', 'Сеанс сменился во время сохранения.');
      const payload = this.makePayload(core, client);
      const committed = await this.repository.commit(active.meta.id, active.meta.revision, payload);
      this.active = committed;
      this.committedSignature = signature(stamp, client);
      this.lastError = null;
      this.phase = 'saved';
      return true;
    })().catch((error) => {
      throw this.problem(error);
    });
    this.saving = task;
    void task
      .finally(() => {
        if (this.saving === task) this.saving = null;
        this.emit();
      })
      .catch(() => {});
    return task;
  }
  /** Pause first, finish any earlier snapshot, then capture the latest state again. */
  async flush() {
    this.bridge.pause();
    if (this.saving) await this.saving;
    return this.save();
  }
  async backgroundSave() {
    if (!this.operation && !this.lastError) await this.save(false);
  }
  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.operation) throw new SaveError('IO', 'Дождись завершения текущей операции.');
    this.operation = true;
    clearTimeout(this.debounce);
    this.emit();
    try {
      return await action();
    } catch (error) {
      if (error !== this.lastError) this.problem(error);
      throw error;
    } finally {
      this.operation = false;
      this.emit();
    }
  }
  async open(id: string) {
    return this.exclusive(async () => {
      await this.flush();
      await this.activate(await this.repository.load(id));
    });
  }
  async create(name: string, seed: string, preset: WorldPreset, gameMode?: GameMode) {
    return this.exclusive(async () => {
      await this.flush();
      const now = Date.now();
      const client = structuredClone(this.bridge.client());
      const core = new WorldSession(seed, preset, undefined, gameMode).checkpoint();
      const world = await this.repository.create({
        name: name.trim(),
        createdAt: now,
        savedAt: now,
        core,
        client,
      });
      await this.activate(world);
    });
  }
  async rename(id: string, name: string) {
    return this.exclusive(async () => {
      if (this.active?.meta.id === id) await this.flush();
      const result = await this.repository.rename(id, name);
      if (this.active?.meta.id === id) {
        this.active = result;
        this.emit();
      }
    });
  }
  async duplicate(id: string) {
    return this.exclusive(async () => {
      this.bridge.pause();
      if (this.active?.meta.id === id && this.bridge.ready()) {
        // A conflicting or quota-failed branch can still be copied/exported without overwriting it.
        if (this.saving) await this.saving.catch(() => {});
        const client = structuredClone(this.bridge.client());
        const { core } = await this.bridge.capture();
        const now = Date.now();
        const world = await this.repository.create({
          ...this.makePayload(core, client),
          name: `${this.active.meta.name.slice(0, 54)} — копия`,
          createdAt: now,
          savedAt: now,
        });
        await this.activate(world);
      } else {
        await this.flush();
        await this.activate(await this.repository.duplicate(id));
      }
    });
  }
  async remove(id: string, revision: number) {
    return this.exclusive(async () => {
      this.bridge.pause();
      if (this.saving) await this.saving.catch(() => {});
      const active = this.active?.meta.id === id;
      const expected = active ? this.active!.meta.revision : revision;
      await this.repository.remove(id, expected);
      if (active) {
        this.active = null;
        const next = (await this.repository.list())[0];
        if (next) await this.activate(await this.repository.load(next.id));
        else {
          const now = Date.now(),
            core = new WorldSession('642018', 'valley').checkpoint();
          const client = this.bridge.client();
          await this.activate(
            await this.repository.create({
              name: 'Долина истоков',
              createdAt: now,
              savedAt: now,
              core,
              client,
            }),
          );
        }
      }
    });
  }
  async export(id: string): Promise<WorldEnvelope> {
    this.bridge.pause();
    if (this.active?.meta.id === id && this.bridge.ready()) {
      const client = structuredClone(this.bridge.client()),
        { core } = await this.bridge.capture();
      return sealWorld(this.makePayload(core, client));
    }
    return (await this.repository.load(id)).file;
  }
  async import(text: string) {
    // Parse before flushing/creating anything: invalid files must not affect the active world.
    parseWorldFile(text);
    return this.exclusive(async () => {
      await this.flush();
      await this.activate(await this.repository.import(text));
    });
  }
  async list() {
    return this.repository ? this.repository.list() : [];
  }
  async requestPersistentStorage(): Promise<boolean> {
    try {
      return this.durable && !!(await navigator.storage?.persist?.());
    } catch {
      return false;
    }
  }
  injectFailure(kind: 'quota' | 'abort') {
    if (import.meta.env.DEV) this.testFailure = kind;
  }
  dispose() {
    clearInterval(this.timer);
    clearTimeout(this.debounce);
    this.repository?.backend.close();
  }
}
