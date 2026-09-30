import type { WorldBackend, WorldMeta, WorldRecord } from './backend';
import {
  sealWorld,
  verifyWorld,
  parseWorldFile,
  envelopeBytes,
  type WorldPayload,
  type WorldEnvelope,
} from './format';
import { SaveError, storageError } from './errors';
export interface OpenWorld {
  meta: WorldMeta;
  file: WorldEnvelope;
  recovered: boolean;
}
function uniqueID(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
function recover(record: WorldRecord): { file: WorldEnvelope; recovered: boolean } {
  try {
    return { file: verifyWorld(record.current), recovered: false };
  } catch (error) {
    // Unknown versions must never silently roll back into an older, incomplete schema.
    if (error instanceof SaveError && error.code === 'UNSUPPORTED') throw error;
    if (record.previous) {
      try {
        return { file: verifyWorld(record.previous), recovered: true };
      } catch {
        /* report corruption below */
      }
    }
    throw new SaveError(
      'CORRUPT',
      'Основная и резервная копии не прошли проверку. Записи не изменены и не удалены.',
    );
  }
}
export class WorldRepository {
  constructor(
    readonly backend: WorldBackend,
    private readonly now = () => Date.now(),
  ) {}
  async list() {
    return (await this.backend.list()).sort(
      (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
    );
  }
  async load(id: string): Promise<OpenWorld> {
    const record = await this.backend.read(id);
    if (!record) throw new SaveError('NOT_FOUND', 'Мир не найден в этом браузере.');
    const result = recover(record);
    return { meta: structuredClone(record.meta), ...result };
  }
  async create(payload: WorldPayload): Promise<OpenWorld> {
    const id = uniqueID();
    return this.commit(id, 0, payload);
  }
  async commit(id: string, expected: number, raw: WorldPayload): Promise<OpenWorld> {
    try {
      const file = sealWorld(raw); // Validation/hash occurs BEFORE opening a read-write transaction.
      const previousRecord = await this.backend.read(id);
      if ((previousRecord?.meta.revision ?? 0) !== expected)
        throw new SaveError(
          'CONFLICT',
          'Мир уже изменён в другой вкладке. Сохрани свою версию отдельной копией.',
        );
      const previous = previousRecord ? recover(previousRecord).file : null;
      const meta: WorldMeta = {
        id,
        name: file.payload.name,
        createdAt: file.payload.createdAt,
        updatedAt: file.payload.savedAt,
        revision: expected + 1,
        seed: file.payload.core.generator.seed,
        preset: file.payload.core.generator.preset,
        tick: file.payload.core.tick,
        changedBlocks: file.payload.core.overrides.length,
        bytes: envelopeBytes(file) + (previous ? envelopeBytes(previous) : 0),
      };
      await this.backend.compareAndSwap(id, expected, { meta, current: file, previous });
      return { meta, file, recovered: false };
    } catch (error) {
      throw storageError(error);
    }
  }
  async rename(id: string, name: string): Promise<OpenWorld> {
    const world = await this.load(id);
    return this.commit(id, world.meta.revision, {
      ...world.file.payload,
      name: name.trim(),
      savedAt: this.now(),
    });
  }
  async duplicate(id: string): Promise<OpenWorld> {
    const source = await this.load(id);
    const time = this.now();
    return this.create({
      ...source.file.payload,
      name: `${source.file.payload.name.slice(0, 54)} — копия`,
      createdAt: time,
      savedAt: time,
    });
  }
  async import(text: string): Promise<OpenWorld> {
    const file = parseWorldFile(text);
    // An imported document never chooses or replaces a local record ID.
    return this.create({ ...file.payload, savedAt: this.now() });
  }
  async remove(id: string, expected: number) {
    await this.backend.remove(id, expected);
  }
  async export(id: string) {
    return JSON.stringify((await this.load(id)).file);
  }
}
