import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SAVE_VERSION } from '../packages/storage/src/format';
import { GENERATOR_VERSION } from '../packages/core/src/persistence';
import { PROTOCOL_VERSION } from '../packages/network/src/protocol';
import { RECIPE_VERSION } from '../packages/core/src/crafting';
import { join } from 'node:path';

const assets = 'dist/assets';
const files = readdirSync(assets);
const mainName = files.find((name) => /^index-.*\.js$/.test(name));
const cssName = files.find((name) => /^index-.*\.css$/.test(name));
if (!mainName || !cssName) throw new Error('Build the Vite production app first.');
let main = readFileSync(join(assets, mainName), 'utf8');
/** Every worker becomes a classic Blob worker: works from file:// and opaque sandbox origins. */
const WORKERS = [
  {
    prefix: 'simulation.worker',
    variable: '__voxelWorkerURL',
    name: 'WebCraft simulation + meshing',
  },
  { prefix: 'far.worker', variable: '__webcraftFarWorkerURL', name: 'WebCraft far terrain' },
];
let prelude = '';
for (const worker of WORKERS) {
  const workerName = files.find(
    (name) => name.startsWith(worker.prefix + '-') && name.endsWith('.js'),
  );
  if (!workerName) throw new Error(`Build the Vite production app first (${worker.prefix}).`);
  const workerSource = readFileSync(join(assets, workerName), 'utf8');
  const originalURL = `new URL("/assets/${workerName}",import.meta.url)`;
  if (!main.includes(originalURL))
    throw new Error('Worker import pattern changed. Refusing to export a broken file.');
  main = main.replace(originalURL, worker.variable);
  // The emitted worker must be a self-contained leaf bundle.
  if (/\bimport\s*[({"']|\bexport\s/.test(workerSource))
    throw new Error(`Standalone worker ${worker.prefix} has module dependencies.`);
  const moduleOptions = `{type:"module",name:"${worker.name}"}`;
  if (!main.includes(moduleOptions)) throw new Error(`Worker options of ${worker.prefix} changed.`);
  main = main.replace(moduleOptions, `{name:"${worker.name}"}`);
  prelude += `const ${worker.variable}=URL.createObjectURL(new Blob([${JSON.stringify(workerSource).replace(/</g, '\\u003c')}],{type:"text/javascript"}));\n`;
}
const script = (prelude + main).replace(/<\/script/gi, '<\\/script');
const MIME: Record<string, string> = {
  woff2: 'font/woff2',
  png: 'image/png',
  svg: 'image/svg+xml',
};
// Fonts and images the stylesheet points at become data URIs: a single file has no /assets/.
const css = readFileSync(join(assets, cssName), 'utf8')
  .replace(/url\((["']?)\/assets\/([^"')]+)\1\)/g, (_all, _quote, name: string) => {
    const type = MIME[name.split('.').pop() ?? ''];
    if (!type) throw new Error(`Cannot inline stylesheet asset ${name}`);
    return `url(data:${type};base64,${readFileSync(join(assets, name)).toString('base64')})`;
  })
  .replace(/<\/style/gi, '<\\/style');
if (css.includes('/assets/')) throw new Error('Unresolved asset in standalone stylesheet.');
let html = readFileSync('dist/index.html', 'utf8');
html = html.replace(/\s*<script type="module"[^>]*src="[^"]+"[^>]*><\/script>/, '');
html = html.replace(/\s*<link rel="stylesheet"[^>]*>/, () => `<style>${css}</style>`);
// Inline module execution remains deferred until the document has been parsed.
html = html.replace('</body>', () => `<script type="module">${script}</script>\n</body>`);
const notices = readFileSync('apps/browser/public/THIRD_PARTY_NOTICES.txt', 'utf8').replace(
  /--/g,
  '—',
);
html = html.replace('</html>', () => `<!--\n${notices}\n-->\n</html>`);
if (/src="\/assets\/|href="\/assets\//.test(html))
  throw new Error('Unresolved external asset in standalone build.');
mkdirSync('releases', { recursive: true });
const version = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
const filename = `releases/webcraft-${version}.html`;
const frozen: Record<string, string> = JSON.parse(
  readFileSync('fixtures/releases-sha256.json', 'utf8'),
);
if (Object.hasOwn(frozen, filename))
  throw new Error(
    'Refusing to overwrite a preserved historical release. Increment package.json version.',
  );
const versions = {
  app: version,
  save: SAVE_VERSION,
  generator: GENERATOR_VERSION,
  protocol: PROTOCOL_VERSION,
  recipes: RECIPE_VERSION,
};
html = html.replace(
  '</head>',
  Object.entries(versions)
    .map(([name, value]) => `<meta name="webcraft-${name}-version" content="${value}">`)
    .join('\n') + '\n</head>',
);
writeFileSync(filename, html);
writeFileSync(
  `releases/webcraft-${version}.manifest.json`,
  JSON.stringify(
    {
      ...versions,
      bytes: Buffer.byteLength(html),
      sha256: createHash('sha256').update(html).digest('hex'),
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `${filename} · ${(Buffer.byteLength(html) / 1024).toFixed(0)} KiB · inline JavaScript, CSS, textures and Blob Worker`,
);
