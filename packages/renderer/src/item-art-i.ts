/**
 * Round I item sprites (0.13): the three missing dyes, the squid's ink sac and everything a
 * rabbit gives. Same part-map painter as `item-art.ts`; the kit is handed over so both files
 * share one look. Original art, deterministic.
 */
import { EXTRA_DYES, SPRITE_I } from '../../content/src/sprites-i';
import type { ArtKit } from './item-art-h';

type Ramp = readonly [number, number, number, number, number];
const ramp = (c: number, darken: ArtKit['darken']): Ramp => {
  const lift = (f: number) => {
    const ch = (v: number) => Math.min(255, Math.round(v * f + (f - 1) * 40));
    return (ch((c >> 16) & 255) << 16) | (ch((c >> 8) & 255) << 8) | ch(c & 255);
  };
  return [darken(c, 0.3), darken(c, 0.72), c, lift(1.2), lift(1.45)];
};

const DYE = [
  '................',
  '................',
  '................',
  '................',
  '........a.......',
  '.......aaa......',
  '......aaaaa.....',
  '.....aaaaaaa....',
  '....aaaaaaaaa...',
  '....aaaaaaaaa...',
  '....aaaaaaaaa...',
  '.....aaaaaaa....',
  '......aaaaa.....',
  '................',
  '................',
  '................',
];
/** A small drawstring bag with a droplet: the ink sac. */
const INK = [
  '................',
  '................',
  '......tttt......',
  '.......tt.......',
  '.....bbbbbb.....',
  '....bbbbbbbb....',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '....bbbbbbbb....',
  '.....bbbbbb.....',
  '................',
  '................',
  '................',
  '................',
];
/** A haunch: a round of meat on a short bone. */
const HAUNCH = [
  '................',
  '................',
  '................',
  '.......mmmm.....',
  '.....mmmmmmm....',
  '....mmmmmmmmm...',
  '....mmmmmmmmm...',
  '....mmmmmmmmm...',
  '.....mmmmmmm..b.',
  '......mmmmm..bb.',
  '.......mm...bb..',
  '........bbbb....',
  '.........bb.....',
  '................',
  '................',
  '................',
];
/** A patch of pelt with a ragged edge. */
const HIDE = [
  '................',
  '................',
  '....pp..........',
  '...pppppp...pp..',
  '..pppppppppppp..',
  '..pppppppppppp..',
  '..pppppppppppp..',
  '...ppppppppppp..',
  '...pppppppppp...',
  '....pppppppp....',
  '.....pp.pppp....',
  '................',
  '................',
  '................',
  '................',
  '................',
];
/** A small furry foot on a short cord. */
const FOOT = [
  '................',
  '................',
  '......c.........',
  '......c.........',
  '.....fff........',
  '....ffffff......',
  '...fffffffff....',
  '...fffffffff....',
  '...ffffffffff...',
  '....fffffffff...',
  '.....fff.ff.f...',
  '................',
  '................',
  '................',
  '................',
  '................',
];
const STEW = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '..bbbbbbbbbbbb..',
  '..bsssssssssb...',
  '..bssrssgssrb...',
  '...bsssrsssb....',
  '....bbbbbbb.....',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];

export function roundISprites(kit: ArtKit): Record<number, () => Uint8ClampedArray> {
  const { sprite, darken } = kit;
  const r = (c: number) => ramp(c, darken);
  const out: Record<number, () => Uint8ClampedArray> = {};
  const indices = [SPRITE_I.grayDye, SPRITE_I.blackDye, SPRITE_I.brownDye];
  EXTRA_DYES.forEach(([, , color], i) => {
    out[indices[i]] = () => sprite(DYE, { a: r(color) }, { speckle: 'a', seed: 170 + i });
  });
  out[SPRITE_I.inkSac] = () =>
    sprite(
      INK,
      { b: r(0x23232e), t: [0x120c06, 0x3a2a1a, 0x5a4026, 0x7a5a36, 0x987448] },
      { speckle: 'b', seed: 175, bare: 't' },
    );
  out[SPRITE_I.rawRabbit] = () =>
    sprite(
      HAUNCH,
      { m: r(0xd9806e), b: [0x4a3a26, 0xb8a27e, 0xd8c7a0, 0xeee2c2, 0xfff8e4] },
      { speckle: 'm', seed: 176 },
    );
  out[SPRITE_I.cookedRabbit] = () =>
    sprite(
      HAUNCH,
      { m: r(0x9a5a30), b: [0x4a3a26, 0xb8a27e, 0xd8c7a0, 0xeee2c2, 0xfff8e4] },
      { speckle: 'm', seed: 177 },
    );
  out[SPRITE_I.rabbitHide] = () => sprite(HIDE, { p: r(0xb58d5e) }, { speckle: 'p', seed: 178 });
  out[SPRITE_I.rabbitFoot] = () =>
    sprite(
      FOOT,
      { f: r(0xc9a071), c: [0x1a120a, 0x5a3c1e, 0x7a5228, 0x9a6a34, 0xb8823e] },
      { speckle: 'f', seed: 179, bare: 'c' },
    );
  out[SPRITE_I.rabbitStew] = () =>
    sprite(
      STEW,
      {
        b: [0x1e1e1e, 0x55505a, 0x766f7a, 0x968f9a, 0xb7b0ba],
        s: r(0xa0683a),
        r: r(0xe2742a),
        g: r(0x55a038),
      },
      { speckle: 's', seed: 180 },
    );
  return out;
}
