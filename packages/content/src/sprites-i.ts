/** Round I item sprites (0.13), continuing the table of `sprites-h.ts`. The art is in the renderer. */
import { H_SPRITE_COUNT } from './sprites-h';

/** The three dyes round H left out: grey, black and brown (white is bone meal, blue is lapis). */
export const EXTRA_DYES = [
  ['gray', 'Серый краситель', 0x4a4f54],
  ['black', 'Чёрный краситель', 0x1d1d21],
  ['brown', 'Коричневый краситель', 0x835432],
] as const;

export const SPRITE_I = {
  grayDye: H_SPRITE_COUNT,
  blackDye: H_SPRITE_COUNT + 1,
  brownDye: H_SPRITE_COUNT + 2,
  inkSac: H_SPRITE_COUNT + 3,
  rawRabbit: H_SPRITE_COUNT + 4,
  cookedRabbit: H_SPRITE_COUNT + 5,
  rabbitHide: H_SPRITE_COUNT + 6,
  rabbitFoot: H_SPRITE_COUNT + 7,
  rabbitStew: H_SPRITE_COUNT + 8,
} as const;
export const I_SPRITE_COUNT = H_SPRITE_COUNT + 9;
