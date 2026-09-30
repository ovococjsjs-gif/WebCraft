import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { APP_VERSION } from '../packages/content/src/version';
import { SAVE_VERSION } from '../packages/storage/src/format';
import { GENERATOR_VERSION } from '../packages/core/src/persistence';
import { PROTOCOL_VERSION } from '../packages/network/src/protocol';
import { RECIPE_VERSION } from '../packages/core/src/crafting';
const path = `releases/webcraft-${APP_VERSION}.html`;
const html = readFileSync(path, 'utf8');
const metadata = JSON.parse(readFileSync(`releases/webcraft-${APP_VERSION}.manifest.json`, 'utf8'));
const hash = (text: Buffer | string) => createHash('sha256').update(text).digest('hex');
for (const [key, value] of Object.entries({
  app: APP_VERSION,
  save: SAVE_VERSION,
  generator: GENERATOR_VERSION,
  protocol: PROTOCOL_VERSION,
  recipes: RECIPE_VERSION,
})) {
  if (!html.includes(`<meta name="webcraft-${key}-version" content="${value}">`))
    throw new Error(`Wrong ${key} version in standalone`);
}
if (metadata.sha256 !== hash(html) || metadata.bytes !== statSync(path).size)
  throw new Error('Release manifest mismatch');
if (html.includes('__VOXEL_LAB__')) throw new Error('Dev control API leaked into production');
if (/<(?:script|link|img)\b[^>]*(?:src|href)=["'](?:https?:|\/assets\/)/i.test(html))
  throw new Error('External resource in standalone');
if (/url\(["']?(?:https?:|\/assets\/)/i.test(html))
  throw new Error('Stylesheet points at a file the standalone does not carry');
const historical: Record<string, string> = JSON.parse(
  readFileSync('fixtures/releases-sha256.json', 'utf8'),
);
for (const [file, sha] of Object.entries(historical))
  if (hash(readFileSync(file)) !== sha) throw new Error(`Historical release was modified: ${file}`);
console.log(
  JSON.stringify(
    { release: path, ...metadata, historicalReleasesVerified: Object.keys(historical).length },
    null,
    2,
  ),
);
