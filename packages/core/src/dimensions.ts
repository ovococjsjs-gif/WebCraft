/**
 * The three dimensions of the game and the rules that differ between them.
 *
 * The world keeps one column set per dimension, and this table is the single place that says how
 * a dimension behaves: how far a block falls, whether water survives, whether a bed may be slept
 * in, how the sky looks and how the coordinates map between the Overworld and the Nether.
 */
export const DIMENSIONS = ['overworld', 'nether', 'end'] as const;
export type DimensionId = (typeof DIMENSIONS)[number];
/** The dimension a new world opens in. */
export const DEFAULT_DIMENSION: DimensionId = 'overworld';
export function isDimensionId(value: unknown): value is DimensionId {
  return typeof value === 'string' && (DIMENSIONS as readonly string[]).includes(value);
}
export interface DimensionInfo {
  readonly id: DimensionId;
  readonly name: string;
  /** Short name for the interface and the diagnostics panel. */
  readonly short: string;
  /** Floor and ceiling of the dimension, in blocks. */
  readonly minY: number;
  readonly maxY: number;
  /** Height of the lava ocean where one exists, or -1. */
  readonly lavaSeaLevel: number;
  /** Daylight and a sky: the End has neither, the Nether has no sky at all. */
  readonly hasSky: boolean;
  readonly hasDaylight: boolean;
  /** Water placed here evaporates instead of flowing. */
  readonly waterEvaporates: boolean;
  /** A bed used here explodes instead of sleeping. */
  readonly bedExplodes: boolean;
  /** Distance the compass points to the world origin from; -1 disables it. */
  readonly compassWorks: boolean;
  /** Weather is only simulated where the sky is open. */
  readonly hasWeather: boolean;
  /** Ambient light of the dimension, added to the light of the blocks. */
  readonly ambientLight: number;
  /**
   * How many Overworld blocks one block of this dimension means when travelling through a
   * portal. The Nether is eight times smaller, the End is its own place.
   */
  readonly coordinateScale: number;
  /** Ticks a player has to stand in a portal of this dimension before it carries them away. */
  readonly portalDelayTicks: number;
  /** Text shown while travelling. */
  readonly arrivalMessage: string;
}
export const DIMENSION_INFO: Readonly<Record<DimensionId, DimensionInfo>> = Object.freeze({
  overworld: Object.freeze({
    id: 'overworld',
    name: 'Верхний мир',
    short: 'Верхний мир',
    minY: 0,
    maxY: 255,
    lavaSeaLevel: -1,
    hasSky: true,
    hasDaylight: true,
    waterEvaporates: false,
    bedExplodes: false,
    compassWorks: true,
    hasWeather: true,
    ambientLight: 0,
    coordinateScale: 1,
    portalDelayTicks: 80,
    arrivalMessage: 'Верхний мир',
  }),
  nether: Object.freeze({
    id: 'nether',
    name: 'Нижний мир',
    short: 'Нижний мир',
    minY: 0,
    maxY: 127,
    lavaSeaLevel: 31,
    hasSky: false,
    hasDaylight: false,
    waterEvaporates: true,
    bedExplodes: true,
    compassWorks: false,
    hasWeather: false,
    ambientLight: 0,
    coordinateScale: 8,
    portalDelayTicks: 80,
    arrivalMessage: 'Нижний мир',
  }),
  end: Object.freeze({
    id: 'end',
    name: 'Край',
    short: 'Край',
    minY: 0,
    maxY: 255,
    lavaSeaLevel: -1,
    hasSky: true,
    hasDaylight: false,
    waterEvaporates: false,
    bedExplodes: true,
    compassWorks: false,
    hasWeather: false,
    ambientLight: 1,
    coordinateScale: 1,
    portalDelayTicks: 1,
    arrivalMessage: 'Край',
  }),
});
export function dimensionInfo(id: DimensionId): DimensionInfo {
  return DIMENSION_INFO[id];
}
/** How long a player stands in a portal of the dimension they are leaving. */
export function portalDelay(id: DimensionId): number {
  return DIMENSION_INFO[id].portalDelayTicks;
}
/**
 * Maps a position from one dimension to the other. Only the horizontal axes scale: the Nether is
 * eight times smaller than the Overworld, so one block there is eight blocks here.
 */
export function scalePosition(
  from: DimensionId,
  to: DimensionId,
  position: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const factor = DIMENSION_INFO[from].coordinateScale / DIMENSION_INFO[to].coordinateScale;
  return {
    x: Math.floor(position.x * factor) + 0.5,
    y: position.y,
    z: Math.floor(position.z * factor) + 0.5,
  };
}
/** Ceiling of the Nether: portals never open above it, and nothing may be built past it. */
export const NETHER_CEILING = 127;
export const NETHER_FLOOR = 1;
/** How far a portal looks for a partner before it builds a new one. */
export const PORTAL_SEARCH_RADIUS = 128;
/** Blocks a portal never opens on. */
export const PORTAL_SAFE_Y = { min: 4, max: 122 } as const;
