import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { goldenCases } from '../helpers/generator-golden';

const fixture = JSON.parse(readFileSync('fixtures/generator-golden.json', 'utf8')) as {
  hashes: Record<string, string>;
};

describe('frozen generators', () => {
  const cases = goldenCases();
  it('pins every case that the fixture knows', () => {
    expect(cases.map((entry) => entry.id).sort()).toEqual(Object.keys(fixture.hashes).sort());
  });
  it('regenerates versions 1–4 byte for byte', () => {
    const changed = cases.filter((entry) => entry.make() !== fixture.hashes[entry.id]);
    expect(changed.map((entry) => entry.id)).toEqual([]);
  }, 120_000);
});
