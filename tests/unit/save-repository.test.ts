import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  IndexedWorldBackend,
  MemoryWorldBackend,
  type WorldBackend,
} from '../../packages/storage/src/backend';
import { WorldRepository } from '../../packages/storage/src/repository';
import { payload } from '../helpers/worlds';

for (const adapter of ['memory', 'indexeddb'] as const) {
  describe(`${adapter} transactional repository`, () => {
    async function backend(): Promise<WorldBackend> {
      return adapter === 'memory'
        ? new MemoryWorldBackend()
        : IndexedWorldBackend.open('test', new IDBFactory());
    }
    it('creates, lists and reads a validated snapshot', async () => {
      const b = await backend();
      try {
        const r = new WorldRepository(b);
        const w = await r.create(payload());
        expect((await r.list())[0].id).toBe(w.meta.id);
        expect((await r.load(w.meta.id)).file.payload).toEqual(payload());
      } finally {
        b.close();
      }
    });
    it('keeps the previous committed snapshot as a backup', async () => {
      const b = await backend();
      try {
        const r = new WorldRepository(b);
        const w = await r.create(payload());
        const p = payload();
        p.core.tick = 40;
        const newer = await r.commit(w.meta.id, 1, p);
        const record = await b.read(w.meta.id);
        expect(newer.meta.revision).toBe(2);
        expect(record?.previous?.payload.core.tick).toBe(17);
        expect(record?.current.payload.core.tick).toBe(40);
      } finally {
        b.close();
      }
    });
    it('recovers a corrupt latest snapshot without modifying either stored record', async () => {
      const b = await backend();
      try {
        const r = new WorldRepository(b);
        const w = await r.create(payload());
        const p = payload();
        p.core.tick = 40;
        await r.commit(w.meta.id, 1, p);
        const raw = (await b.read(w.meta.id))!;
        raw.current.payload.name = 'tampered';
        await b.compareAndSwap(w.meta.id, 2, raw);
        const got = await r.load(w.meta.id);
        expect(got.recovered).toBe(true);
        expect(got.file.payload.core.tick).toBe(17);
        expect((await b.read(w.meta.id))?.current.payload.name).toBe('tampered');
        const repaired = await r.commit(w.meta.id, 2, got.file.payload);
        expect(repaired.meta.revision).toBe(3);
        expect((await b.read(w.meta.id))?.previous?.payload.name).toBe('Test world');
      } finally {
        b.close();
      }
    });
    it('refuses corruption in both copies and leaves data untouched', async () => {
      const b = await backend();
      try {
        const r = new WorldRepository(b);
        const w = await r.create(payload());
        await r.commit(w.meta.id, 1, payload());
        const raw = (await b.read(w.meta.id))!;
        raw.current.checksum.value = '0'.repeat(64);
        raw.previous!.checksum.value = '0'.repeat(64);
        await b.compareAndSwap(w.meta.id, 2, raw);
        await expect(r.load(w.meta.id)).rejects.toThrow('резервная');
        expect(await b.read(w.meta.id)).not.toBeNull();
      } finally {
        b.close();
      }
    });
    it('never silently rolls back an unsupported newer file version', async () => {
      const b = await backend();
      try {
        const r = new WorldRepository(b);
        const w = await r.create(payload());
        await r.commit(w.meta.id, 1, payload());
        const raw = (await b.read(w.meta.id))!;
        (raw.current as { version: number }).version = 999;
        await b.compareAndSwap(w.meta.id, 2, raw);
        await expect(r.load(w.meta.id)).rejects.toThrow('Версия');
      } finally {
        b.close();
      }
    });
    it('resolves concurrent writes with optimistic revisions, not last-writer-wins', async () => {
      const b = await backend();
      try {
        const a = new WorldRepository(b),
          other = new WorldRepository(b);
        const w = await a.create(payload());
        const p1 = payload('A'),
          p2 = payload('B');
        const results = await Promise.allSettled([
          a.commit(w.meta.id, 1, p1),
          other.commit(w.meta.id, 1, p2),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
        expect((await a.load(w.meta.id)).meta.revision).toBe(2);
      } finally {
        b.close();
      }
    });
    it('imports and duplicates into new IDs without replacing the original', async () => {
      const b = await backend();
      try {
        const r = new WorldRepository(b);
        const w = await r.create(payload());
        const imported = await r.import(await r.export(w.meta.id));
        const copy = await r.duplicate(w.meta.id);
        expect(new Set([w.meta.id, imported.meta.id, copy.meta.id]).size).toBe(3);
        expect((await r.list()).length).toBe(3);
        expect((await r.load(w.meta.id)).meta.revision).toBe(1);
      } finally {
        b.close();
      }
    });
    it('invalid imports do not add or alter records', async () => {
      const b = await backend();
      try {
        const r = new WorldRepository(b);
        const w = await r.create(payload());
        await expect(r.import('{"fake":true}')).rejects.toThrow();
        expect((await r.list()).length).toBe(1);
        expect((await r.load(w.meta.id)).meta.revision).toBe(1);
      } finally {
        b.close();
      }
    });
    it('renames metadata and portable file together without changing blocks', async () => {
      const b = await backend();
      try {
        const r = new WorldRepository(b);
        const w = await r.create(payload());
        await r.rename(w.meta.id, 'New name');
        const got = await r.load(w.meta.id);
        expect(got.meta.name).toBe('New name');
        expect(got.file.payload.name).toBe('New name');
        expect(got.file.payload.core).toEqual(w.file.payload.core);
      } finally {
        b.close();
      }
    });
    it('deletes current and backup atomically and a stale writer cannot resurrect the world', async () => {
      const b = await backend();
      try {
        const r = new WorldRepository(b);
        const w = await r.create(payload());
        await r.commit(w.meta.id, 1, payload());
        await b.setLast(w.meta.id);
        await r.remove(w.meta.id, 2);
        expect(await b.read(w.meta.id)).toBeNull();
        expect(await b.getLast()).toBeNull();
        await expect(r.commit(w.meta.id, 2, payload())).rejects.toThrow();
        expect(await r.list()).toEqual([]);
      } finally {
        b.close();
      }
    });
  });
}

describe('IndexedDB crash/abort boundaries', () => {
  it.each(['QuotaExceededError', 'AbortError'])(
    'rolls back ALL queued writes after %s',
    async (name) => {
      let fault = false;
      const b = await IndexedWorldBackend.open('fault', new IDBFactory(), {
        beforeCommit: () => {
          if (fault) throw new DOMException('test', name);
        },
      });
      try {
        const r = new WorldRepository(b);
        const first = await r.create(payload());
        await r.commit(first.meta.id, 1, { ...payload(), name: 'Latest good' });
        const original = await b.read(first.meta.id);
        fault = true;
        await expect(
          r.commit(first.meta.id, 2, { ...payload(), name: 'Not committed' }),
        ).rejects.toThrow();
        expect(await b.read(first.meta.id)).toEqual(original);
        expect((await r.list())[0].revision).toBe(2);
        expect((await r.list())[0].name).toBe('Latest good');
      } finally {
        b.close();
      }
    },
  );
  it('persists across closing and reopening the database', async () => {
    const factory = new IDBFactory();
    const a = await IndexedWorldBackend.open('restart', factory),
      r = new WorldRepository(a);
    const w = await r.create(payload());
    await a.setLast(w.meta.id);
    a.close();
    const b = await IndexedWorldBackend.open('restart', factory);
    try {
      expect(await b.getLast()).toBe(w.meta.id);
      expect((await new WorldRepository(b).load(w.meta.id)).file.payload).toEqual(payload());
    } finally {
      b.close();
    }
  });
});
