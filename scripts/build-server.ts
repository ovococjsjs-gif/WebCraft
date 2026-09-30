/**
 * Bundles the multiplayer server into one ESM file for Node, with the standalone game page inside:
 * `node releases/webcraft-server-<version>.mjs` is then all a host needs. Run `npm run standalone`
 * first so the page exists; without it the server asks for --game.
 */
import { build } from 'esbuild';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { APP_VERSION } from '../packages/content/src/version';

const page = `releases/webcraft-${APP_VERSION}.html`;
const html = existsSync(page) ? readFileSync(page, 'utf8') : undefined;
if (!html) console.warn(`${page} не найден: сервер будет без встроенной страницы игры.`);
const outfile = `releases/webcraft-server-${APP_VERSION}.mjs`;
await build({
  entryPoints: ['apps/server/src/main.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: true,
  legalComments: 'none',
  banner: { js: `// WebCraft server ${APP_VERSION} — node ${outfile.split('/').pop()} --help` },
  define: { __WEBCRAFT_GAME_HTML__: html ? JSON.stringify(html) : 'undefined' },
});
console.log(`${outfile}: ${(statSync(outfile).size / 1024 / 1024).toFixed(2)} МБ`);
