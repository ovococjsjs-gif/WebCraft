/**
 * WebCraft.exe for Windows: the game, the server and Node in one file (Node single executable
 * application). Double-click opens the game in its own window; friends can join this computer by
 * IP and port. Run `npm run standalone` first so the game page exists.
 *
 *   npm run standalone && npm run build:exe   →   releases-exe/WebCraft-<version>-windows.zip
 *
 * The SEA blob is made by this very Node, so node.exe of the same version is downloaded (and its
 * checksum verified against nodejs.org) into .cache/exe.
 */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { crc32, deflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import * as ResEdit from 'resedit';
import { inject } from 'postject';
import { APP_VERSION } from '../packages/content/src/version';

const work = '.cache/exe';
const outDir = 'releases-exe';
mkdirSync(work, { recursive: true });
mkdirSync(outDir, { recursive: true });

const page = `releases/webcraft-${APP_VERSION}.html`;
if (!existsSync(page)) throw new Error(`${page} не найден: сначала npm run standalone`);

/* 1 · node.exe of the same version as the Node that makes the blob */
const nodeVersion = process.versions.node;
const nodeExe = join(work, `node-v${nodeVersion}-win-x64.exe`);
const base = `https://nodejs.org/dist/v${nodeVersion}`;
const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
const expected = sums.match(/^([0-9a-f]{64})\s+win-x64\/node\.exe$/m)?.[1];
if (!expected) throw new Error('Нет контрольной суммы node.exe на nodejs.org');
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
if (!existsSync(nodeExe) || sha(readFileSync(nodeExe)) !== expected) {
  console.log(`Скачиваю node.exe ${nodeVersion}…`);
  const data = new Uint8Array(await (await fetch(`${base}/win-x64/node.exe`)).arrayBuffer());
  if (sha(data) !== expected) throw new Error('node.exe: контрольная сумма не совпала');
  writeFileSync(nodeExe, data);
}

/* 2 · the server as one CommonJS file with the game page inside */
const script = join(work, 'webcraft-desktop.cjs');
await build({
  entryPoints: ['apps/server/src/main.ts'],
  outfile: script,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  minify: true,
  legalComments: 'none',
  logOverride: { 'empty-import-meta': 'silent' },
  define: {
    __WEBCRAFT_GAME_HTML__: JSON.stringify(readFileSync(page, 'utf8')),
    __WEBCRAFT_DESKTOP__: 'true',
  },
});

/* 3 · the SEA blob */
const blob = join(work, 'sea-prep.blob');
const seaConfig = join(work, 'sea-config.json');
writeFileSync(
  seaConfig,
  JSON.stringify({
    main: script,
    output: blob,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
  }),
);
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

/* 4 · the game goes inside a pristine node.exe (LIEF wants the original layout) */
const injected = join(work, 'node-sea.exe');
writeFileSync(injected, readFileSync(nodeExe));
await inject(injected, 'NODE_SEA_BLOB', readFileSync(blob), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
});

/* 5 · icon and file properties; the Node.js signature no longer applies and is dropped */
const exe = ResEdit.NtExecutable.from(readFileSync(injected), { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exe);
const icon = ResEdit.Data.IconFile.from(readFileSync('apps/server/desktop/webcraft.ico'));
for (const group of ResEdit.Resource.IconGroupEntry.fromEntries(res.entries))
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    group.id,
    group.lang,
    icon.icons.map((item) => item.data),
  );
const [major, minor, patch] = APP_VERSION.split('.').map(Number);
for (const info of ResEdit.Resource.VersionInfo.fromEntries(res.entries)) {
  for (const lang of info.getAllLanguagesForStringValues()) {
    for (const key of ['LegalTrademarks', 'Comments', 'PrivateBuild', 'SpecialBuild'])
      info.removeStringValue(lang, key);
    info.setStringValues(lang, {
      CompanyName: 'WebCraft',
      FileDescription: 'WebCraft — игра и сервер',
      ProductName: 'WebCraft',
      InternalName: 'WebCraft',
      OriginalFilename: 'WebCraft.exe',
      LegalCopyright: `WebCraft ${APP_VERSION}; Node.js ${nodeVersion} (MIT)`,
      FileVersion: APP_VERSION,
      ProductVersion: APP_VERSION,
    });
  }
  info.setFileVersion(major, minor, patch, 0);
  info.setProductVersion(major, minor, patch, 0);
  info.outputToResourceEntries(res.entries);
}
res.outputResource(exe);
const exePath = join(work, 'WebCraft.exe');
writeFileSync(exePath, Buffer.from(exe.generate()));

/* 6 · a zip with a short manual (UTF-8 with BOM and CRLF, so Notepad reads it) */
const manual =
  '\ufeff' +
  readFileSync('apps/server/desktop/README.txt', 'utf8')
    .replaceAll('{version}', APP_VERSION)
    .replace(/\r?\n/g, '\r\n');
const zipPath = join(outDir, `WebCraft-${APP_VERSION}-windows.zip`);
writeFileSync(
  zipPath,
  zip([
    ['WebCraft/WebCraft.exe', readFileSync(exePath)],
    ['WebCraft/README.txt', Buffer.from(manual, 'utf8')],
  ]),
);
const mb = (file: string) => `${(statSync(file).size / 1024 / 1024).toFixed(1)} МБ`;
console.log(`${exePath}: ${mb(exePath)}\n${zipPath}: ${mb(zipPath)}`);

/** A plain deflate zip; enough for two files. */
function zip(files: [string, Buffer][]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const [name, data] of files) {
    const packed = deflateRawSync(data, { level: 9 });
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(date, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    parts.push(local, nameBytes, packed);
    offset += local.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}
