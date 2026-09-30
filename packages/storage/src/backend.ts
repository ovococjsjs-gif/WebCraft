import type { WorldEnvelope } from './format';
import type { WorldPreset } from '../../core/src/terrain';
import { SaveError, storageError } from './errors';
export const DATABASE_NAME = 'voxel-lab-worlds';
export const DATABASE_VERSION = 1;
export interface WorldMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  seed: string;
  preset: WorldPreset;
  tick: number;
  changedBlocks: number;
  bytes: number;
}
export interface WorldRecord {
  meta: WorldMeta;
  current: WorldEnvelope;
  previous: WorldEnvelope | null;
}
export interface WorldBackend {
  readonly durable: boolean;
  read(id: string): Promise<WorldRecord | null>;
  list(): Promise<WorldMeta[]>;
  compareAndSwap(id: string, expectedRevision: number, next: WorldRecord): Promise<void>;
  remove(id: string, expectedRevision: number): Promise<void>;
  getLast(): Promise<string | null>;
  setLast(id: string): Promise<void>;
  close(): void;
}
const conflict = () =>
  new SaveError(
    'CONFLICT',
    'Мир изменён или удалён в другой вкладке. Эта версия не перезаписана. Экспортируй свои изменения или сохрани их отдельной копией.',
  );
export interface BackendOptions {
  beforeCommit?: () => void;
}

export class MemoryWorldBackend implements WorldBackend {
  readonly durable = false;
  private readonly records = new Map<string, WorldRecord>();
  private last: string | null = null;
  constructor(private readonly options: BackendOptions = {}) {}
  async read(id: string) {
    return structuredClone(this.records.get(id) ?? null);
  }
  async list() {
    return Array.from(this.records.values(), (r) => structuredClone(r.meta));
  }
  async compareAndSwap(id: string, expected: number, next: WorldRecord): Promise<void> {
    if ((this.records.get(id)?.meta.revision ?? 0) !== expected) throw conflict();
    this.options.beforeCommit?.();
    this.records.set(id, structuredClone(next));
  }
  async remove(id: string, expected: number): Promise<void> {
    if (this.records.get(id)?.meta.revision !== expected) throw conflict();
    this.options.beforeCommit?.();
    this.records.delete(id);
    if (this.last === id) this.last = null;
  }
  async getLast() {
    return this.last;
  }
  async setLast(id: string) {
    this.last = id;
  }
  close(): void {
    /* The temporary session intentionally has no persistence. */
  }
}

export class IndexedWorldBackend implements WorldBackend {
  readonly durable = true;
  private constructor(
    private readonly db: IDBDatabase,
    private readonly options: BackendOptions,
  ) {}
  static open(
    name = DATABASE_NAME,
    factory: IDBFactory = globalThis.indexedDB,
    options: BackendOptions = {},
  ): Promise<IndexedWorldBackend> {
    return new Promise((resolve, reject) => {
      if (!factory) {
        reject(new SaveError('UNAVAILABLE', 'IndexedDB недоступна.'));
        return;
      }
      let settled = false;
      const request = factory.open(name, DATABASE_VERSION);
      const timer = setTimeout(() => {
        settled = true;
        reject(
          new SaveError(
            'UNAVAILABLE',
            'Хранилище не ответило. Возможно, доступ заблокирован другой вкладкой.',
          ),
        );
      }, 5000);
      const fail = (error: unknown) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(storageError(error));
        }
      };
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('catalog'))
          db.createObjectStore('catalog', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('records'))
          db.createObjectStore('records', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('settings'))
          db.createObjectStore('settings', { keyPath: 'key' });
      };
      request.onblocked = () =>
        fail(new SaveError('UNAVAILABLE', 'Обновление хранилища заблокировано другой вкладкой.'));
      request.onerror = () => fail(request.error);
      request.onsuccess = () => {
        clearTimeout(timer);
        if (settled) {
          request.result.close();
          return;
        }
        settled = true;
        request.result.onversionchange = () => request.result.close();
        resolve(new IndexedWorldBackend(request.result, options));
      };
    });
  }
  private transaction(stores: string[], mode: IDBTransactionMode): IDBTransaction {
    try {
      return this.db.transaction(stores, mode, { durability: 'strict' });
    } catch (error) {
      if (error instanceof TypeError) return this.db.transaction(stores, mode);
      throw storageError(error);
    }
  }
  read(id: string): Promise<WorldRecord | null> {
    return new Promise((resolve, reject) => {
      const tx = this.transaction(['records'], 'readonly');
      const request = tx.objectStore('records').get(id);
      let value: WorldRecord | null = null;
      request.onsuccess = () => {
        value = request.result?.value ?? null;
      };
      tx.oncomplete = () => resolve(value);
      tx.onabort = tx.onerror = () => reject(storageError(tx.error));
    });
  }
  list(): Promise<WorldMeta[]> {
    return new Promise((resolve, reject) => {
      const tx = this.transaction(['catalog'], 'readonly');
      const request = tx.objectStore('catalog').getAll();
      tx.oncomplete = () => resolve(request.result as WorldMeta[]);
      tx.onabort = tx.onerror = () => reject(storageError(tx.error));
    });
  }
  /** Reads the revision and replaces BOTH records in one transaction, across all tabs. */
  compareAndSwap(id: string, expected: number, next: WorldRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.transaction(['catalog', 'records'], 'readwrite');
      let failure: unknown;
      const request = tx.objectStore('catalog').get(id);
      request.onsuccess = () => {
        try {
          if ((request.result?.revision ?? 0) !== expected) throw conflict();
          tx.objectStore('records').put({ id, value: next });
          tx.objectStore('catalog').put(next.meta);
          this.options.beforeCommit?.(); // Fault-injection hook: absent in production.
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(); // Never report success on an individual put request.
      tx.onabort = tx.onerror = () => reject(storageError(failure ?? tx.error));
    });
  }
  remove(id: string, expected: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.transaction(['catalog', 'records', 'settings'], 'readwrite');
      let failure: unknown;
      const request = tx.objectStore('catalog').get(id);
      request.onsuccess = () => {
        try {
          if (request.result?.revision !== expected) throw conflict();
          tx.objectStore('catalog').delete(id);
          tx.objectStore('records').delete(id);
          const last = tx.objectStore('settings').get('last-world');
          last.onsuccess = () => {
            if (last.result?.value === id) tx.objectStore('settings').delete('last-world');
          };
          this.options.beforeCommit?.();
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(storageError(failure ?? tx.error));
    });
  }
  getLast(): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const tx = this.transaction(['settings'], 'readonly'),
        request = tx.objectStore('settings').get('last-world');
      tx.oncomplete = () =>
        resolve(typeof request.result?.value === 'string' ? request.result.value : null);
      tx.onabort = tx.onerror = () => reject(storageError(tx.error));
    });
  }
  setLast(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.transaction(['settings'], 'readwrite');
      tx.objectStore('settings').put({ key: 'last-world', value: id });
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(storageError(tx.error));
    });
  }
  close() {
    this.db.close();
  }
}
