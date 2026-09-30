export const SECTION_SIZE = 16;
export const SECTION_VOLUME = 4096;
export const MIN_Y = 0;
export const MAX_Y = 255;
export const WORLD_LIMIT = 30_000_000;
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export const chunkCoord = (value: number): number => Math.floor(value / SECTION_SIZE);
export const localCoord = (value: number): number => ((value % 16) + 16) % 16;
export const columnKey = (cx: number, cz: number): string => `${cx},${cz}`;
export const sectionKey = (cx: number, sy: number, cz: number): string => `${cx},${sy},${cz}`;
export const sectionIndex = (x: number, y: number, z: number): number => x | (z << 4) | (y << 8);
export function decodeIndex(index: number): Vec3 {
  return { x: index & 15, y: index >>> 8, z: (index >>> 4) & 15 };
}
export function validBlockPosition(x: number, y: number, z: number): boolean {
  return (
    Number.isSafeInteger(x) &&
    Number.isSafeInteger(y) &&
    Number.isSafeInteger(z) &&
    y >= MIN_Y &&
    y <= MAX_Y &&
    Math.abs(x) < WORLD_LIMIT &&
    Math.abs(z) < WORLD_LIMIT
  );
}
