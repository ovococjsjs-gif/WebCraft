/** Original 16×16 pixel art. Small material palettes, clustered marks, never external assets. */
export const ANIMATED_TILE_BASE = 288;
export const ANIMATED_FRAMES = 4;
export function pixelNoise(x: number, y: number, seed = 1) {
  let n = Math.imul(x + 31, 374761393) ^ Math.imul(y + 71, 668265263) ^ seed;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
const hex = (n: number) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
export function terrainPixels(tile: number): Uint8ClampedArray | null {
  if (tile > 12 || tile === 11) return null;
  const palettes: number[][] = [
    [0x709947, 0x7fa653, 0x60893d, 0x8db25b],
    [0x946d47, 0x806043, 0xa47b50, 0x6d543e],
    [0x946d47, 0x806043, 0xa47b50, 0x6d543e],
    [0x8e9694, 0x818a89, 0x9ba29c, 0x727d7d],
    [0xd8c591, 0xe1cf9e, 0xceba83, 0xe8d7a9],
    [0x7e623f, 0x5e4b34, 0x96754a, 0xaf8956],
    [0xb49360, 0x9a784b, 0xc6a671, 0x806341],
    [0x538148, 0x426d3b, 0x66914c, 0x719d55],
    [0xbc945c, 0xcaa66b, 0xa67d4c, 0x795b3c],
    [0x88938b, 0x758078, 0x99a298, 0x535f59],
    [0xc9e6e2, 0xb2d5d1, 0xe9f6e8, 0x749fa5],
    [],
    [0x535b5b, 0x454f50, 0x66716c, 0x313c3e],
  ];
  const p = palettes[tile];
  const data = new Uint8ClampedArray(16 * 16 * 4);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const coarse = pixelNoise(Math.floor(x / 3), Math.floor(y / 2), tile * 149),
        fine = pixelNoise(x, y, tile + 7);
      let index = coarse > 0.72 ? 2 : coarse < 0.25 ? 1 : 0,
        alpha = 255;
      if (tile === 0) {
        index = coarse > 0.65 ? 1 : coarse < 0.25 ? 2 : 0;
        if (fine > 0.92) index = 3;
      }
      if (tile === 1 && y < 3 + Math.floor(pixelNoise(Math.floor(x / 2), 0) * 3)) {
        const c = hex([0x658f43, 0x739b4a, 0x567d36][Math.floor(fine * 3)]);
        data.set([...c, 255], (y * 16 + x) * 4);
        continue;
      }
      if (tile === 3) {
        if (y % 5 === 0 && (x + Math.floor(y / 5) * 5) % 13 < 8) index = 3;
        else if (y % 5 === 1 && fine > 0.3) index = 2;
      }
      if (tile === 4) index = coarse > 0.75 ? 2 : coarse < 0.3 ? 1 : 0;
      if (tile === 5) {
        index = (x + Math.floor(y / 7)) % 5 === 0 ? 1 : x % 5 === 1 ? 2 : 0;
        if (x % 8 === 3 && y % 7 < 3) index = 3;
      }
      if (tile === 6) {
        const d = Math.floor(Math.max(Math.abs(x - 7), Math.abs(y - 8)));
        index = d % 3 === 0 ? 1 : d % 3 === 1 ? 2 : 0;
        if (d < 2) index = 3;
      }
      if (tile === 7) {
        const cluster = pixelNoise(Math.floor((x + Math.floor(y / 4)) / 3), Math.floor(y / 3), 331);
        index = cluster < 0.23 ? 1 : cluster > 0.7 ? 2 : 0;
        if (fine > 0.91 && cluster > 0.45) index = 3;
        if (fine < 0.065) alpha = 0;
      }
      if (tile === 8) {
        index = y % 4 === 0 ? 3 : y % 4 === 1 ? 1 : coarse > 0.65 ? 2 : 0;
        if ((x + (Math.floor(y / 4) % 2) * 8) % 16 === 0) index = 3;
        if (x % 8 === 6 && y % 4 === 2) index = 2;
      }
      if (tile === 9) {
        const xx = (x + Math.floor(y / 5) * 3) % 7,
          yy = y % 5;
        index = xx === 0 || yy === 0 ? 3 : yy === 1 ? 2 : xx === 6 ? 1 : 0;
      }
      if (tile === 10) {
        alpha = 28;
        index = 0;
        if (x === 0 || y === 0 || x === 15 || y === 15) {
          index = 1;
          alpha = 185;
        }
        if ((x + y === 7 || x + y === 19) && x > 2 && x < 13) {
          index = 2;
          alpha = 140;
        }
      }
      data.set([...hex(p[index]), alpha], (y * 16 + x) * 4);
    }
  return data;
}
/** Four temporal cells use the SAME source atlas; UV animation is a cheap uniform, no uploads. */
export function animatedPixels(kind: number, frame: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(1024);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const n = pixelNoise(Math.floor(((x + frame) % 16) / 3), Math.floor(y / 3), 22);
      let color = 0,
        alpha = 255;
      if (kind === 1) {
        const wave =
          (x + Math.round(Math.sin(((y + frame * 4) * Math.PI) / 8) * 2) + frame * 3 + 36) % 12;
        color =
          wave === 0
            ? 0x70adb8
            : wave === 1
              ? 0x589aaa
              : wave > 8
                ? 0x398899
                : n > 0.6
                  ? 0x4696a4
                  : 0x408fa4;
        alpha = 174;
      }
      if (kind === 2) {
        const vein = (x + y * 2 + frame * 2) % 11;
        color = vein < 2 ? 0xffd569 : vein === 2 ? 0xf8aa42 : n > 0.6 ? 0xd15a28 : 0xe37b32;
      }
      if (kind === 3) {
        const height =
            4 + Math.round(pixelNoise(Math.floor(((x + frame) % 16) / 2), frame, 51) * 10),
          base = 15 - y;
        alpha = base > height ? 0 : 255;
        color = base > height - 2 ? 0xda6230 : base > height - 5 ? 0xf4ac48 : 0xffdf84;
      }
      if (kind === 4) {
        const r = Math.hypot((x - 7.5) * 0.8, y - 7.5),
          a = Math.atan2(y - 7.5, x - 7.5);
        const v = (Math.floor(r + a * 2 + frame * 2) + 64) % 8;
        color = [0x664580, 0x775595, 0x9466b0, 0xb18ac8, 0x8664a4, 0x6f508d, 0x76539a, 0x63427d][v];
        alpha = 225;
      }
      if (kind === 6) {
        const r = Math.floor(Math.hypot(x - 7.5, y - 7.5) + frame * 2) % 8;
        color = [0x142b33, 0x19303d, 0x283644, 0x324358, 0x28444d, 0x284a4d, 0x223944, 0x1b3040][r];
        if (pixelNoise((x + frame * 4) % 16, y, 137) > 0.975) color = 0xb5d8c8;
      }
      data.set([...hex(color), alpha], (y * 16 + x) * 4);
    }
  return data;
}
export function pixelCanvas(data: Uint8ClampedArray) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const ctx = canvas.getContext('2d')!;
  const im = ctx.createImageData(16, 16);
  im.data.set(data);
  ctx.putImageData(im, 0, 0);
  return canvas;
}
/** Hairline mineral cracks, not an opaque dark cube. Progress reveals connected branches. */
export function crackPixels(stage: number) {
  const data = new Uint8ClampedArray(1024),
    max = Math.max(0, Math.min(7, stage));
  const put = (x: number, y: number) => {
    if (x >= 0 && x < 16 && y >= 0 && y < 16) data.set([35, 31, 26, 205], (y * 16 + x) * 4);
  };
  for (let branch = 0; branch < 8; branch++) {
    if (branch > max) break;
    let x = 7,
      y = 8;
    const angle = (branch * Math.PI) / 4;
    for (let i = 0; i <= Math.min(9, 3 + max); i++) {
      x = 7 + Math.round(Math.cos(angle) * i);
      y = 8 + Math.round(Math.sin(angle) * i);
      put(x, y);
      if (i % 3 === 0) put(x + (branch % 2 ? 1 : -1), y);
    }
  }
  return data;
}
