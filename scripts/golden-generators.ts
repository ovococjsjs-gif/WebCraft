/** Rewrites fixtures/generator-golden.json. Only run it when a NEW version is being pinned. */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { goldenCases } from '../tests/helpers/generator-golden';

const path = 'fixtures/generator-golden.json';
const previous: Record<string, string> = existsSync(path)
  ? JSON.parse(readFileSync(path, 'utf8')).hashes
  : {};
const hashes: Record<string, string> = {};
for (const entry of goldenCases()) {
  const hash = entry.make();
  if (previous[entry.id] && previous[entry.id] !== hash && !process.argv.includes('--force'))
    throw new Error(
      `Frozen generator changed: ${entry.id}. Refusing to overwrite without --force.`,
    );
  hashes[entry.id] = hash;
}
writeFileSync(
  path,
  JSON.stringify(
    {
      note: 'Frozen generator fingerprints. A mismatch means an old world would regenerate differently.',
      hashes,
    },
    null,
    1,
  ) + '\n',
);
console.log(`${Object.keys(hashes).length} fingerprints written`);
