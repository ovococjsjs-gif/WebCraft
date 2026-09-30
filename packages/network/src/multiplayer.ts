/**
 * Network protocol of WebCraft multiplayer, version 1: JSON text frames over one WebSocket.
 *
 * The server owns the shared world: its seed and variant, the journal of every changed block, the
 * time of day and each player's saved state (inventory, position, health), keyed by name. Every
 * client simulates the world around itself with the same generator, sends the blocks it changed
 * and receives the blocks others changed. See docs/MULTIPLAYER.md.
 */
import type { CoreCheckpoint, SavedOverride } from '../../core/src/persistence';
import type { GameMode } from '../../core/src/gameplay';

export const MP_PROTOCOL = 1;
export const DEFAULT_PORT = 25565;
export const MAX_NAME = 16;
export const MAX_CHAT = 200;
/** One batch of edits; a client that changes more at once sends several. */
export const MAX_EDITS_PER_MESSAGE = 4096;
/** A client message larger than this is refused; checkpoints are the largest. */
export const MAX_CLIENT_MESSAGE = 4 * 1024 * 1024;
export const DIMENSIONS = ['overworld', 'nether', 'end'] as const;
export type NetDimension = (typeof DIMENSIONS)[number];

export interface NetPlayer {
  id: number;
  name: string;
  /** Index of a built-in skin; custom skins stay on their owner's device in version 1. */
  skin: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  dim: NetDimension;
  held: string | null;
  crouching: boolean;
  flying: boolean;
  onGround: boolean;
  /** Increments on every swing, so a swing between two updates is not lost. */
  swings: number;
}
export type NetPose = Omit<NetPlayer, 'id' | 'name' | 'skin'>;
export interface NetWorld {
  name: string;
  seed: string;
  preset: string;
  mode: GameMode;
}

export type ClientMessage =
  | { t: 'hello'; protocol: number; version: string; name: string; skin: number }
  | ({ t: 'pose' } & NetPose)
  | { t: 'edits'; edits: SavedOverride[] }
  | { t: 'chat'; text: string }
  | { t: 'save'; checkpoint: CoreCheckpoint };

export type ServerMessage =
  | {
      t: 'welcome';
      id: number;
      world: NetWorld;
      /** The player's own saved state, or a fresh one; its overrides are the shared journal. */
      checkpoint: CoreCheckpoint;
      time: number;
      players: NetPlayer[];
      motd: string;
    }
  | { t: 'edits'; from: number; edits: SavedOverride[] }
  | { t: 'players'; list: NetPlayer[] }
  | { t: 'join'; id: number; name: string }
  | { t: 'leave'; id: number; name: string }
  | { t: 'chat'; from: string; text: string; system?: boolean }
  | { t: 'time'; time: number }
  | { t: 'reject'; reason: string };

const finite = (v: unknown, limit = 3e7): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit;
const bool = (v: unknown): v is boolean => typeof v === 'boolean';
const dimension = (v: unknown): v is NetDimension =>
  typeof v === 'string' && (DIMENSIONS as readonly string[]).includes(v);

/** A readable player name: letters, digits, space, dash and underscore; trimmed and bounded. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);
  return name.length >= 2 ? name : null;
}
export function validEdit(e: unknown): e is SavedOverride {
  if (!Array.isArray(e) || (e.length !== 4 && e.length !== 5)) return false;
  const [x, y, z, key, dim] = e as unknown[];
  return (
    Number.isInteger(x) &&
    Number.isInteger(z) &&
    Number.isInteger(y) &&
    finite(x) &&
    finite(z) &&
    (y as number) >= 0 &&
    (y as number) < 256 &&
    typeof key === 'string' &&
    key.length <= 64 &&
    (dim === undefined || dimension(dim))
  );
}

/** Runtime check of everything a client may send; anything else is dropped by the server. */
export function parseClientMessage(text: string): ClientMessage | null {
  if (text.length > MAX_CLIENT_MESSAGE) return null;
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(text);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;
  switch (m.t) {
    case 'hello':
      return finite(m.protocol) &&
        typeof m.version === 'string' &&
        typeof m.name === 'string' &&
        finite(m.skin, 64)
        ? {
            t: 'hello',
            protocol: m.protocol,
            version: m.version.slice(0, 32),
            name: m.name,
            skin: Math.max(0, Math.floor(m.skin)),
          }
        : null;
    case 'pose':
      return finite(m.x) &&
        finite(m.y, 4096) &&
        finite(m.z) &&
        finite(m.yaw, 1e6) &&
        finite(m.pitch, 4) &&
        dimension(m.dim) &&
        (m.held === null || (typeof m.held === 'string' && m.held.length <= 64)) &&
        bool(m.crouching) &&
        bool(m.flying) &&
        bool(m.onGround) &&
        finite(m.swings, 1e9)
        ? {
            t: 'pose',
            x: m.x,
            y: m.y,
            z: m.z,
            yaw: m.yaw,
            pitch: m.pitch,
            dim: m.dim,
            held: m.held as string | null,
            crouching: m.crouching,
            flying: m.flying,
            onGround: m.onGround,
            swings: m.swings,
          }
        : null;
    case 'edits':
      return Array.isArray(m.edits) &&
        m.edits.length <= MAX_EDITS_PER_MESSAGE &&
        m.edits.every(validEdit)
        ? { t: 'edits', edits: m.edits as SavedOverride[] }
        : null;
    case 'chat':
      return typeof m.text === 'string' && m.text.trim()
        ? { t: 'chat', text: m.text.trim().slice(0, MAX_CHAT) }
        : null;
    case 'save':
      return m.checkpoint && typeof m.checkpoint === 'object'
        ? { t: 'save', checkpoint: m.checkpoint as CoreCheckpoint }
        : null;
    default:
      return null;
  }
}

/** The WebSocket address of a server typed as «host», «host:port» or a full ws/http URL. */
export function serverURL(host: string, port: number | string): string {
  let h = host.trim();
  if (/^wss?:\/\//i.test(h)) return h.replace(/\/?$/, '').replace(/(\/ws)?$/, '/ws');
  h = h.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const hasPort = /^\[.*\]:\d+$/.test(h) || /^[^:]+:\d+$/.test(h);
  return `ws://${hasPort ? h : `${h}:${Number(port) || DEFAULT_PORT}`}/ws`;
}
