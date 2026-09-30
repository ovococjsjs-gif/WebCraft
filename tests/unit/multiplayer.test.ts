import { describe, expect, it } from 'vitest';
import { WorldSession } from '../../packages/core/src/session';
import { BLOCK, registry } from '../../packages/content/src/blocks';
import type { SavedOverride } from '../../packages/core/src/persistence';
import {
  DEFAULT_PORT,
  MAX_EDITS_PER_MESSAGE,
  cleanName,
  parseClientMessage,
  serverURL,
  validEdit,
} from '../../packages/network/src/multiplayer';

const GOLD = registry.get(BLOCK.GOLD_BLOCK).key;
const STONE = registry.get(BLOCK.STONE).key;

function session() {
  const s = new WorldSession('mp-unit', 'flat');
  s.simulation.naturalSpawns = false;
  s.ensureAround('overworld', 8, 8, 1);
  return s;
}

describe('shared world edits', () => {
  it('reports local edits once and never echoes remote ones', () => {
    const s = session();
    const seen: [string, number, number, number, number][] = [];
    s.onEdit = (dim, x, y, z, state) => seen.push([dim, x, y, z, state]);
    s.world.setBlock(3, 12, 3, BLOCK.STONE);
    expect(seen).toEqual([['overworld', 3, 12, 3, BLOCK.STONE]]);
    seen.length = 0;
    const applied = s.applyRemote([[4, 12, 4, GOLD]]);
    expect(applied).toBe(1);
    expect(s.world.getBlock(4, 12, 4)).toBe(BLOCK.GOLD_BLOCK);
    expect(seen).toEqual([]);
    // A later local edit is reported again.
    s.world.setBlock(4, 12, 4, BLOCK.AIR);
    expect(seen).toHaveLength(1);
  });

  it('keeps remote edits of columns not yet loaded and applies them on load', () => {
    const s = session();
    expect(s.world.column(Math.floor(700 / 16), Math.floor(700 / 16))).toBeFalsy();
    expect(s.applyRemote([[700, 20, 700, GOLD]])).toBe(0);
    s.ensureAround('overworld', 700, 700, 1);
    expect(s.world.getBlock(700, 20, 700)).toBe(BLOCK.GOLD_BLOCK);
    const saved = s.checkpoint().overrides as SavedOverride[];
    expect(saved.some(([x, y, z, key]) => x === 700 && y === 20 && z === 700 && key === GOLD)).toBe(
      true,
    );
  });

  it('skips unknown blocks and unchanged cells', () => {
    const s = session();
    s.world.setBlock(5, 12, 5, BLOCK.STONE);
    expect(
      s.applyRemote([
        [5, 12, 5, STONE],
        [6, 12, 6, 'no_such_block'],
      ]),
    ).toBe(0);
    expect(s.world.getBlock(6, 12, 6)).toBe(BLOCK.AIR);
  });

  it('a fresh joiner rebuilds the host world from the edit log', () => {
    const host = session();
    const log: SavedOverride[] = [];
    host.onEdit = (_d, x, y, z, state) => log.push([x, y, z, registry.get(state).key]);
    for (let y = 9; y < 13; y++) host.world.setBlock(2, y, 8, BLOCK.GOLD_BLOCK);
    host.world.setBlock(2, 12, 8, BLOCK.AIR);
    const joiner = new WorldSession('mp-unit', 'flat', {
      ...new WorldSession('mp-unit', 'flat').checkpoint(),
      overrides: log,
    });
    joiner.ensureAround('overworld', 2, 8, 1);
    for (let y = 9; y < 12; y++) expect(joiner.world.getBlock(2, y, 8)).toBe(BLOCK.GOLD_BLOCK);
    expect(joiner.world.getBlock(2, 12, 8)).toBe(BLOCK.AIR);
  });
});

describe('protocol checks', () => {
  it('cleans player names', () => {
    expect(cleanName('  Алиса  ')).toBe('Алиса');
    expect(cleanName('Steve<script>')).toBe('Stevescript');
    expect(cleanName('a')).toBeNull();
    expect(cleanName(42)).toBeNull();
    expect(cleanName('x'.repeat(40))).toHaveLength(16);
  });

  it('accepts only well-formed messages', () => {
    expect(parseClientMessage('not json')).toBeNull();
    expect(parseClientMessage('{"t":"boom"}')).toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({ t: 'hello', protocol: 1, version: '0.9', name: 'Bob', skin: 2.7 }),
      ),
    ).toMatchObject({ t: 'hello', skin: 2 });
    expect(parseClientMessage(JSON.stringify({ t: 'chat', text: '   ' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'chat', text: 'x'.repeat(500) }))).toMatchObject({
      text: 'x'.repeat(200),
    });
    const pose = {
      t: 'pose',
      x: 1,
      y: 70,
      z: 2,
      yaw: 0.5,
      pitch: 0.1,
      dim: 'nether',
      held: null,
      crouching: false,
      flying: true,
      onGround: false,
      swings: 3,
    };
    expect(parseClientMessage(JSON.stringify(pose))).toMatchObject({ dim: 'nether', flying: true });
    expect(parseClientMessage(JSON.stringify({ ...pose, dim: 'moon' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...pose, x: 1e12 }))).toBeNull();
  });

  it('validates block edits', () => {
    expect(validEdit([1, 64, -3, 'stone'])).toBe(true);
    expect(validEdit([1, 64, -3, 'stone', 'end'])).toBe(true);
    expect(validEdit([1, 256, -3, 'stone'])).toBe(false);
    expect(validEdit([1.5, 64, -3, 'stone'])).toBe(false);
    expect(validEdit([1, 64, -3, 'stone', 'moon'])).toBe(false);
    const many = Array.from({ length: MAX_EDITS_PER_MESSAGE + 1 }, () => [0, 1, 0, 'stone']);
    expect(parseClientMessage(JSON.stringify({ t: 'edits', edits: many }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'edits', edits: many.slice(1) }))).toMatchObject({
      t: 'edits',
    });
  });

  it('builds the server address from what the player typed', () => {
    expect(serverURL('26.12.34.56', '')).toBe(`ws://26.12.34.56:${DEFAULT_PORT}/ws`);
    expect(serverURL('26.12.34.56', 25599)).toBe('ws://26.12.34.56:25599/ws');
    expect(serverURL('25.1.2.3:4000', 25565)).toBe('ws://25.1.2.3:4000/ws');
    expect(serverURL('http://192.168.0.5:25565/', 1)).toBe('ws://192.168.0.5:25565/ws');
    expect(serverURL('ws://host:9/ws', 1)).toBe('ws://host:9/ws');
    expect(serverURL('ws://host:9', 1)).toBe('ws://host:9/ws');
  });
});
