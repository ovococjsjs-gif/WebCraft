/**
 * WebCraft server: one shared world for friends on a LAN, Radmin VPN or Hamachi.
 *
 *   node webcraft-server.mjs --port 25565 --world ./my-world --seed 1234 --mode survival
 *
 * The same port serves the game page (open http://<address>:<port> in a browser) and the game
 * connection at /ws. The world folder holds world.json (seed, time, every changed block) and
 * players.json (each player's inventory, position and health, by name).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  appendFile,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptWebSocket, type WsConnection } from './websocket';
import { openGameWindow, waitForEnter } from './desktop';
import {
  DEFAULT_PORT,
  MAX_CLIENT_MESSAGE,
  MP_PROTOCOL,
  cleanName,
  parseClientMessage,
  type NetPlayer,
  type NetWorld,
  type ServerMessage,
} from '../../../packages/network/src/multiplayer';
import { WorldSession } from '../../../packages/core/src/session';
import { isWorldPreset, type WorldPreset } from '../../../packages/core/src/terrain';
import { GAME_MODES, type GameMode } from '../../../packages/core/src/gameplay';
import type { CoreCheckpoint, SavedOverride } from '../../../packages/core/src/persistence';
import { registry } from '../../../packages/content/src/blocks';
import { APP_VERSION } from '../../../packages/content/src/version';

declare const __WEBCRAFT_GAME_HTML__: string | undefined;
declare const __WEBCRAFT_DESKTOP__: boolean | undefined;

/** WebCraft.exe: opens its own game window and keeps its data in the user's profile. */
const DESKTOP =
  (typeof __WEBCRAFT_DESKTOP__ === 'boolean' && __WEBCRAFT_DESKTOP__) ||
  process.argv.includes('--desktop');
const DATA_DIR = join(
  process.env.APPDATA ??
    join(homedir(), process.platform === 'darwin' ? 'Library' : '.local/share'),
  'WebCraft',
);
if (DESKTOP) process.title = 'WebCraft';

/* ------------------------------------------------------------------ options */
function option(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && args[at + 1] && !args[at + 1].startsWith('--')) return args[at + 1];
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
}
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`WebCraft server ${APP_VERSION}

  --port <n>         порт (по умолчанию ${DEFAULT_PORT})
  --world <папка>    папка мира (по умолчанию ${DESKTOP ? join(DATA_DIR, 'server-world') : './webcraft-world'})
  --name <текст>     название мира для новых миров
  --seed <текст>     сид нового мира
  --preset <вариант> overworld | large-biomes | amplified | valley | flat
  --mode <режим>     survival | creative
  --max-players <n>  не больше игроков одновременно (по умолчанию 8)
  --motd <текст>     приветствие при входе
  --game <файл>      свой HTML-файл игры вместо встроенного
  --desktop          открыть игру в своём окне (так работает WebCraft.exe)
  --no-window        в режиме --desktop не открывать окно`);
  process.exit(0);
}
const PORT = Number(option('port', String(DEFAULT_PORT))) || DEFAULT_PORT;
const WORLD_DIR = resolve(
  option('world', DESKTOP ? join(DATA_DIR, 'server-world') : 'webcraft-world'),
);
const MAX_PLAYERS = Math.max(1, Number(option('max-players', '8')) || 8);
const MOTD = option('motd', 'Добро пожаловать на сервер WebCraft!');

/* ------------------------------------------------------------------ world storage */
interface WorldFile {
  format: 'webcraft-server-world';
  version: 1;
  world: NetWorld;
  createdAt: number;
  time: number;
  edits: SavedOverride[];
}
interface PlayersFile {
  format: 'webcraft-server-players';
  version: 1;
  players: Record<string, { name: string; lastSeen: number; checkpoint: CoreCheckpoint }>;
}
function readJSON<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}
/** Written beside and renamed over: a crash mid-write never leaves half a world. */
function writeJSON(file: string, value: unknown) {
  const temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify(value));
  renameSync(temp, file);
}
mkdirSync(WORLD_DIR, { recursive: true });
const worldPath = join(WORLD_DIR, 'world.json');
const playersPath = join(WORLD_DIR, 'players.json');
const loaded = readJSON<WorldFile>(worldPath);
const presetOption = option('preset', 'overworld');
const modeOption = option('mode', 'survival');
const worldFile: WorldFile = loaded ?? {
  format: 'webcraft-server-world',
  version: 1,
  world: {
    name: option('name', DESKTOP ? 'Мир для друзей' : 'Сетевой мир'),
    seed: option('seed', String(Math.floor(Math.random() * 1e9))).slice(0, 64),
    preset: isWorldPreset(presetOption) ? presetOption : 'overworld',
    mode: (GAME_MODES as readonly string[]).includes(modeOption)
      ? (modeOption as GameMode)
      : 'survival',
  },
  createdAt: Date.now(),
  time: 1000,
  edits: [],
};
const playersFile: PlayersFile = readJSON<PlayersFile>(playersPath) ?? {
  format: 'webcraft-server-players',
  version: 1,
  players: {},
};
/** Every changed block by dimension and position; the last writer wins. */
const edits = new Map<string, SavedOverride>();
const editKey = (e: SavedOverride) => `${e[4] ?? 'overworld'}|${e[0]},${e[1]},${e[2]}`;
for (const e of worldFile.edits) edits.set(editKey(e), e);
let time = worldFile.time;
let dirty = !loaded;
function saveWorld() {
  worldFile.time = time;
  worldFile.edits = [...edits.values()];
  writeJSON(worldPath, worldFile);
  writeJSON(playersPath, playersFile);
  dirty = false;
}
if (!loaded) saveWorld();

/** A fresh player: the world's own spawn, starting inventory and full health. */
function freshCheckpoint(): CoreCheckpoint {
  const w = worldFile.world;
  return new WorldSession(w.seed, w.preset as WorldPreset, undefined, w.mode).checkpoint();
}
function checkpointFor(name: string): CoreCheckpoint {
  const saved = playersFile.players[name.toLowerCase()]?.checkpoint;
  const base = saved ? structuredClone(saved) : freshCheckpoint();
  base.overrides = [...edits.values()];
  base.time = time;
  base.gameMode = worldFile.world.mode;
  return base;
}

/* ------------------------------------------------------------------ players */
interface Client {
  ws: WsConnection;
  player: NetPlayer | null;
  editBudget: number;
  chatBudget: number;
}
const clients = new Set<Client>();
let nextID = 1;
const online = () => [...clients].filter((c) => c.player).map((c) => c.player!);
function send(client: Client, message: ServerMessage) {
  // A client that cannot keep up is dropped rather than buffered without bound.
  if (client.ws.backlog > 16 * 1024 * 1024) return client.ws.close(1008, 'slow');
  client.ws.send(JSON.stringify(message));
}
function broadcast(message: ServerMessage, except?: Client) {
  const text = JSON.stringify(message);
  for (const c of clients) if (c.player && c !== except) c.ws.send(text);
}
/**
 * WebCraft.exe keeps its journal in a file: a click into a Windows console starts a selection,
 * and while it lasts every console write blocks — the server would freeze under the players.
 */
const LOG_FILE = DESKTOP ? join(DATA_DIR, 'server.log') : '';
if (DESKTOP) mkdirSync(DATA_DIR, { recursive: true });
function log(text: string) {
  const line = `[${new Date().toLocaleTimeString('ru-RU')}] ${text}`;
  if (LOG_FILE) appendFile(LOG_FILE, `${line}\n`, () => {});
  else console.log(line);
}

function handle(client: Client, text: string) {
  const m = parseClientMessage(text);
  if (!m) return;
  if (!client.player) {
    if (m.t !== 'hello') return;
    if (m.protocol !== MP_PROTOCOL) {
      send(client, {
        t: 'reject',
        reason: `Версия протокола не совпадает: у сервера ${MP_PROTOCOL}, у игры ${m.protocol}. Обновите игру или сервер.`,
      });
      return client.ws.close();
    }
    const name = cleanName(m.name);
    if (!name) {
      send(client, { t: 'reject', reason: 'Имя должно быть от 2 до 16 букв или цифр.' });
      return client.ws.close();
    }
    if (online().some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      send(client, { t: 'reject', reason: `Игрок «${name}» уже на сервере.` });
      return client.ws.close();
    }
    if (online().length >= MAX_PLAYERS) {
      send(client, { t: 'reject', reason: `Сервер заполнен (${MAX_PLAYERS} игроков).` });
      return client.ws.close();
    }
    const checkpoint = checkpointFor(name);
    const p = checkpoint.player.position;
    client.player = {
      id: nextID++,
      name,
      skin: m.skin,
      x: p.x,
      y: p.y,
      z: p.z,
      yaw: checkpoint.look.yaw,
      pitch: checkpoint.look.pitch,
      dim: checkpoint.dimension,
      held: null,
      crouching: false,
      flying: false,
      onGround: true,
      swings: 0,
    };
    send(client, {
      t: 'welcome',
      id: client.player.id,
      world: worldFile.world,
      checkpoint,
      time,
      players: online().filter((o) => o !== client.player),
      motd: MOTD,
    });
    broadcast({ t: 'join', id: client.player.id, name }, client);
    broadcast({ t: 'chat', from: '', text: `В игре: ${name}`, system: true }, client);
    log(`+ ${name} (${online().length}/${MAX_PLAYERS})`);
    return;
  }
  const player = client.player;
  switch (m.t) {
    case 'pose': {
      const { t: _t, ...pose } = m;
      void _t;
      Object.assign(player, pose);
      break;
    }
    case 'edits': {
      // Generous for building and explosions, but a flood from one client is cut off.
      client.editBudget -= m.edits.length;
      if (client.editBudget < 0) return;
      const accepted: SavedOverride[] = [];
      for (const e of m.edits) {
        if (!registry.find(e[3])) continue;
        edits.set(editKey(e), e);
        accepted.push(e);
      }
      if (accepted.length) {
        dirty = true;
        broadcast({ t: 'edits', from: player.id, edits: accepted }, client);
      }
      break;
    }
    case 'chat':
      if (--client.chatBudget < 0) return;
      log(`<${player.name}> ${m.text}`);
      broadcast({ t: 'chat', from: player.name, text: m.text });
      break;
    case 'save': {
      const checkpoint = m.checkpoint;
      if (!checkpoint.player?.position || !checkpoint.inventory) return;
      checkpoint.overrides = [];
      playersFile.players[player.name.toLowerCase()] = {
        name: player.name,
        lastSeen: Date.now(),
        checkpoint,
      };
      dirty = true;
      break;
    }
  }
}

/* ------------------------------------------------------------------ HTTP: the game page */
function gameHTML(): string | null {
  const custom = option('game', '');
  let here = process.cwd();
  try {
    here = dirname(fileURLToPath(import.meta.url));
  } catch {
    /* CommonJS build inside WebCraft.exe: the page is embedded */
  }
  const candidates = [
    custom,
    join(here, `webcraft-${APP_VERSION}.html`),
    join(here, '../../../releases', `webcraft-${APP_VERSION}.html`),
  ].filter(Boolean);
  for (const file of candidates) if (existsSync(file)) return readFileSync(file, 'utf8');
  return typeof __WEBCRAFT_GAME_HTML__ === 'string' ? __WEBCRAFT_GAME_HTML__ : null;
}
const html = gameHTML();
/** The page learns it came from a server, so it offers to join it at once. */
function servedPage(req: IncomingMessage): string {
  const info = {
    name: worldFile.world.name,
    mode: worldFile.world.mode,
    port: listeningPort,
    host: req.headers.host ?? '',
    version: APP_VERSION,
    desktop: DESKTOP,
    addresses: DESKTOP ? lanAddresses().map(({ ip, hint }) => ({ ip, hint })) : undefined,
  };
  const tag = `<script>window.__WEBCRAFT_SERVER__=${JSON.stringify(info).replace(/</g, '\\u003c')}</script>`;
  return html!.replace('<head>', `<head>${tag}`);
}
function respond(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/status') {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
    });
    res.end(
      JSON.stringify({
        name: worldFile.world.name,
        mode: worldFile.world.mode,
        version: APP_VERSION,
        protocol: MP_PROTOCOL,
        players: online().map((p) => p.name),
        max: MAX_PLAYERS,
      }),
    );
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    if (!html) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Страница игры не найдена: запустите сервер с --game webcraft.html');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(servedPage(req));
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Не найдено');
}

const server = createServer(respond);
server.on('upgrade', (req, socket) => {
  if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') return socket.destroy();
  const ws = acceptWebSocket(req, socket, MAX_CLIENT_MESSAGE);
  if (!ws) return;
  const client: Client = { ws, player: null, editBudget: 20000, chatBudget: 5 };
  clients.add(client);
  ws.onmessage = (text) => {
    try {
      handle(client, text);
    } catch (error) {
      log(`Ошибка сообщения: ${(error as Error).message}`);
    }
  };
  ws.onclose = () => {
    clients.delete(client);
    if (client.player) {
      broadcast({ t: 'leave', id: client.player.id, name: client.player.name });
      broadcast({
        t: 'chat',
        from: '',
        text: `Покинул(а) игру: ${client.player.name}`,
        system: true,
      });
      log(`− ${client.player.name}`);
    }
  };
  // Nobody may sit connected without saying who they are.
  setTimeout(() => {
    if (!client.player) ws.close(1008, 'hello');
  }, 10000);
});

/* ------------------------------------------------------------------ clocks */
setInterval(() => {
  time = (time + 1) % 24000;
}, 50);
setInterval(() => {
  const list = online();
  if (list.length) broadcast({ t: 'players', list });
  for (const c of clients) {
    c.editBudget = Math.min(20000, c.editBudget + 400);
    c.chatBudget = Math.min(5, c.chatBudget + 0.5);
  }
}, 100);
setInterval(() => broadcast({ t: 'time', time }), 5000);
setInterval(() => {
  if (dirty) saveWorld();
}, 30000);
function shutdown() {
  log('Сохраняем мир и выключаемся…');
  broadcast({ t: 'chat', from: '', text: 'Сервер выключается', system: true });
  saveWorld();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// Windows: the console's close button and Ctrl+Break.
process.on('SIGHUP', shutdown);
process.on('SIGBREAK', shutdown);

/** Addresses friends can reach this computer at: Radmin VPN, Hamachi and the local network. */
function lanAddresses(): { ip: string; hint: string; name: string }[] {
  const found: { ip: string; hint: string; name: string }[] = [];
  for (const [name, list] of Object.entries(networkInterfaces()))
    for (const a of list ?? [])
      // 169.254.x.x is what Windows assigns when nothing answers: nobody can reach it.
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) {
        const hint = a.address.startsWith('26.')
          ? 'Radmin VPN'
          : a.address.startsWith('25.')
            ? 'Hamachi'
            : /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)
              ? 'локальная сеть'
              : '';
        found.push({ ip: a.address, hint, name });
      }
  // The VPN addresses are the ones friends need; list them first.
  const rank = (h: string) => (h === 'Radmin VPN' || h === 'Hamachi' ? 0 : h ? 1 : 2);
  return found.sort((a, b) => rank(a.hint) - rank(b.hint));
}

function banner(port: number) {
  const addresses = lanAddresses().map(
    ({ ip, hint, name }) => `  http://${ip}:${port}${hint ? ` (${hint})` : ''}  [${name}]`,
  );
  const mode = worldFile.world.mode === 'creative' ? 'творчество' : 'выживание';
  if (DESKTOP) {
    const windowed = !process.argv.includes('--no-window');
    console.log(`
  WebCraft ${APP_VERSION}

${
  windowed
    ? `  Игра открыта в отдельном окне. Закроешь окно игры — WebCraft сохранит всё и выключится.
  Это окно — сервер для игры по сети, его не закрывай, пока играешь.`
    : `  Сервер без окна игры. Играть: http://localhost:${port}
  Ctrl+C или закрыть это окно — сохранить и выключить.`
}

  Сетевой мир «${worldFile.world.name}» (${mode}, сид ${worldFile.world.seed}).
  Друзья подключаются по одному из адресов (IP и порт ${port}):
${addresses.join('\n') || '  (адресов нет: включи Radmin VPN или Hamachi и перезапусти WebCraft)'}

  Данные: ${DATA_DIR}
  Журнал входов и чата: ${LOG_FILE}
`);
    return;
  }
  console.log(`
  WebCraft server ${APP_VERSION} — «${worldFile.world.name}»
  Режим: ${mode} · сид ${worldFile.world.seed}
  Папка мира: ${WORLD_DIR}

  Сам играй здесь:  http://localhost:${port}
  Друзьям дай один из адресов:
${addresses.join('\n') || '  (сетевых адресов не найдено)'}

  Друг открывает адрес в браузере или вводит IP и порт в «Сетевой игре».
  Ctrl+C — сохранить и выключить.
`);
}

function openWindow(port: number) {
  if (!DESKTOP || process.argv.includes('--no-window')) return;
  const how = openGameWindow(`http://localhost:${port}/`, join(DATA_DIR, 'browser'), () => {
    log('Окно игры закрыто.');
    shutdown();
  });
  if (how === 'browser')
    console.log(
      `  Edge или Chrome не найден: игра открыта в браузере по умолчанию (http://localhost:${port}).\n  Чтобы выключить WebCraft, закрой это окно.\n`,
    );
}

/** Another WebCraft already answers on this port? Then this launch only opens a window. */
async function isWebCraft(port: number): Promise<boolean> {
  try {
    const reply = await fetch(`http://127.0.0.1:${port}/status`, {
      signal: AbortSignal.timeout(1500),
    });
    const status = (await reply.json()) as { protocol?: number };
    return typeof status.protocol === 'number';
  } catch {
    return false;
  }
}

function listen(port: number, attempt = 0) {
  const onError = async (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EADDRINUSE') throw error;
    if (DESKTOP && (await isWebCraft(port))) {
      const windowed = !process.argv.includes('--no-window');
      console.log(
        windowed
          ? '\n  WebCraft уже запущен — открываю его окно.'
          : `\n  WebCraft уже запущен на порту ${port}.`,
      );
      if (windowed)
        openGameWindow(`http://localhost:${port}/`, join(DATA_DIR, 'browser'), () => {});
      setTimeout(() => process.exit(0), 2500);
      return;
    }
    if (DESKTOP && attempt < 5) {
      console.log(`  Порт ${port} занят другой программой, пробую ${port + 1}…`);
      listen(port + 1, attempt + 1);
      return;
    }
    console.error(`\n  Порт ${port} занят. Запусти с другим портом: --port 25570`);
    if (DESKTOP) await waitForEnter('Нажми Enter, чтобы закрыть окно.');
    process.exit(1);
  };
  server.once('error', onError);
  server.listen(port, '0.0.0.0', () => {
    server.off('error', onError);
    listeningPort = port;
    banner(port);
    openWindow(port);
  });
}
let listeningPort = PORT;
if (DESKTOP)
  process.on('uncaughtException', async (error) => {
    console.error(`\n  Ошибка: ${error.stack ?? error.message}`);
    try {
      saveWorld();
    } catch {
      /* nothing more to save */
    }
    await waitForEnter('Нажми Enter, чтобы закрыть окно.');
    process.exit(1);
  });
listen(PORT);
