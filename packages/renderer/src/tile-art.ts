/**
 * Hand-drawn 16×16 art for the classic block tiles (0–145): stones with real shapes, ores with
 * shaded veins, furniture fronts, transparent crop and redstone sprites. Everything is painted in
 * code from small palettes (original art, no external assets) and is fully deterministic, so the
 * atlas is identical on every machine. Tiles without a painter here keep their older source.
 */
import { pixelNoise } from './pixel-art';
import { Tile, planks, WOOD, DIRT, type Palette } from './block-art';

const N = (x: number, y: number, seed: number) => pixelNoise(x, y, seed);
type Field = (x: number, y: number) => number;

/* ------------------------------------------------------------------ noise tools */
/** Value noise on a lattice of `cx`×`cy` pixels that wraps every 16 pixels (tiles seamlessly). */
function wn(x: number, y: number, cx: number, cy: number, seed: number): number {
  const nx = 16 / cx,
    ny = 16 / cy,
    gx = x / cx,
    gy = y / cy,
    x0 = Math.floor(gx),
    y0 = Math.floor(gy),
    fx = gx - x0,
    fy = gy - y0,
    sx = fx * fx * (3 - 2 * fx),
    sy = fy * fy * (3 - 2 * fy);
  const at = (i: number, j: number) => N(((i % nx) + nx) % nx, ((j % ny) + ny) % ny, seed);
  const a = at(x0, y0),
    b = at(x0 + 1, y0),
    c = at(x0, y0 + 1),
    d = at(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
/** Re-maps a field to its rank (0‥1), so palettes get exact, predictable proportions. */
function ranked(fn: Field, seed = 0): Field {
  const values: number[] = [];
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) values.push(fn(x, y) + N(x, y, seed + 991) * 1e-6);
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const rank = new Float64Array(256);
  order.forEach((index, k) => (rank[index] = k / 255));
  return (x, y) => rank[y * 16 + x];
}
const pick = (p: Palette, v: number) => p[Math.min(p.length - 1, Math.floor(v * p.length))];

interface Cell {
  id: number;
  /** Distance margin to the neighbouring cell: < ~1 means "on a crack". */
  gap: number;
  /** Pixel offset from the cell centre (wrapped). */
  dx: number;
  dy: number;
}
/** Seamless jittered-grid Voronoi: the stones of cobble, gravel, glowstone and magma. */
function cells(grid: number, seed: number, jitter = 0.75): (x: number, y: number) => Cell {
  const size = 16 / grid,
    points: [number, number][] = [];
  for (let j = 0; j < grid; j++)
    for (let i = 0; i < grid; i++)
      points.push([
        (i + 0.5 + (N(i, j, seed) - 0.5) * jitter) * size,
        (j + 0.5 + (N(i, j, seed + 1) - 0.5) * jitter) * size,
      ]);
  return (x, y) => {
    let d1 = Infinity,
      d2 = Infinity,
      id = 0,
      dx = 0,
      dy = 0;
    points.forEach(([px, py], index) => {
      for (const ox of [-16, 0, 16])
        for (const oy of [-16, 0, 16]) {
          const ex = x + 0.5 - (px + ox),
            ey = y + 0.5 - (py + oy),
            d = Math.hypot(ex * 1.08, ey);
          if (d < d1) {
            d2 = d1;
            d1 = d;
            id = index;
            dx = ex;
            dy = ey;
          } else if (d < d2) d2 = d;
        }
    });
    return { id, gap: d2 - d1, dx, dy };
  };
}
function paint(fn: (x: number, y: number) => number | null, alpha = 255): Tile {
  return new Tile().fill(fn, alpha);
}
/** Draws an ASCII map on a tile; `.` and space are left untouched. */
function art(rows: readonly string[], pal: Record<string, number>, base = new Tile()): Tile {
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.' || ch === ' ') return;
      const c = pal[ch];
      if (c === undefined) throw new Error(`tile-art: no colour for '${ch}'`);
      base.set(x, y, c);
    }),
  );
  return base;
}
function rect(t: Tile, x: number, y: number, w: number, h: number, c: number | Field): void {
  for (let j = y; j < y + h; j++)
    for (let i = x; i < x + w; i++) t.set(i, j, typeof c === 'number' ? c : c(i, j));
}
/** Bevelled frame: light top/left, dark bottom/right. */
function bevel(t: Tile, x: number, y: number, w: number, h: number, light: number, dark: number) {
  for (let i = x; i < x + w; i++) {
    t.set(i, y, light);
    t.set(i, y + h - 1, dark);
  }
  for (let j = y; j < y + h; j++) {
    t.set(x, j, light);
    t.set(x + w - 1, j, dark);
  }
}
function copy(t: Tile): Tile {
  const out = new Tile();
  out.data.set(t.data);
  return out;
}

/* ------------------------------------------------------------------ stones */
const STONE: Palette = [0x656565, 0x717171, 0x7c7c7c, 0x878787, 0x949494];
function stone(seed = 3): Tile {
  // Horizontally stretched blotches, like layered rock; a few dark pits.
  const f = ranked(
    (x, y) =>
      wn(x, y, 8, 4, seed) * 0.42 + wn(x, y, 4, 2, seed + 1) * 0.3 + N(x, y, seed + 2) * 0.28,
    seed,
  );
  return paint((x, y) => (N(x, y, seed + 5) > 0.975 ? 0x5f5f5f : pick(STONE, f(x, y))));
}
function cobble(p: Palette, mortar: number, seed: number, grid = 3): Tile {
  const at = cells(grid, seed);
  return paint((x, y) => {
    const c = at(x, y);
    if (c.gap < 0.9) return mortar;
    const tone = N(c.id, 0, seed + 2),
      light = -(c.dx + c.dy) / 5 + (N(x, y, seed + 3) - 0.5) * 0.7;
    const base = tone < 0.33 ? 1 : tone < 0.72 ? 2 : 3;
    const shade = c.gap < 1.9 && c.dx + c.dy > 0 ? -1 : light > 0.55 ? 1 : light < -0.6 ? -1 : 0;
    return p[Math.max(0, Math.min(p.length - 1, base + shade))];
  });
}
const COBBLE: Palette = [0x5a5a5a, 0x6c6c6c, 0x7c7c7c, 0x8b8b8b, 0x9f9f9f];
const cobblestone = () => cobble(COBBLE, 0x4a4a4a, 9);

function ore(base: Tile, vein: readonly [number, number, number], seed: number, blobs = 4): Tile {
  const t = copy(base),
    mask = new Set<number>();
  for (let b = 0; b < blobs; b++) {
    // A compact nugget: a 2×2 core plus a few pixels grown onto its sides.
    // One nugget per quadrant (a fifth lands anywhere), so veins spread over the face.
    const q = b % 4,
      x =
        b < 4
          ? (q % 2) * 8 + 1 + Math.floor(N(b, 0, seed) * 5)
          : 1 + Math.floor(N(b, 0, seed) * 12),
      y =
        b < 4
          ? Math.floor(q / 2) * 8 + 1 + Math.floor(N(b, 1, seed) * 5)
          : 1 + Math.floor(N(b, 1, seed) * 12);
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ])
      mask.add((y + dy) * 16 + x + dx);
    const extra = 1 + Math.floor(N(b, 2, seed) * 3);
    for (let e = 0; e < extra; e++) {
      const side = Math.floor(N(b, e + 3, seed) * 8),
        [dx, dy] = [
          [-1, 0],
          [-1, 1],
          [2, 0],
          [2, 1],
          [0, -1],
          [1, -1],
          [0, 2],
          [1, 2],
        ][side];
      mask.add(Math.max(0, Math.min(15, y + dy)) * 16 + Math.max(0, Math.min(14, x + dx)));
    }
  }
  const has = (x: number, y: number) => mask.has(y * 16 + x);
  // Drop shadow first, then the vein with a highlight on its upper-left pixels.
  for (const k of mask) {
    const x = k % 16,
      y = Math.floor(k / 16);
    if (!has(x + 1, y + 1)) t.set(x + 1, y + 1, vein[0]);
  }
  for (const k of mask) {
    const x = k % 16,
      y = Math.floor(k / 16);
    t.set(x, y, !has(x - 1, y) && !has(x, y - 1) ? vein[2] : vein[1]);
  }
  return t;
}

/** Bricks with bevelled faces (stone bricks, nether bricks, end stone bricks). */
function blockBricks(p: Palette, mortar: number, seed: number, w = 8, h = 4, shift = 4): Tile {
  return paint((x, y) => {
    const row = Math.floor(y / h),
      bx = x + (row % 2) * shift,
      lx = bx % w,
      ly = y % h;
    if (ly === h - 1 || lx === w - 1) return mortar;
    const n = N(x, y, seed);
    if (ly === 0 || lx === 0) return n > 0.8 ? p[2] : p[3];
    if (ly === h - 2 || lx === w - 2) return p[0];
    const tone = N(Math.floor(bx / w), row, seed + 1);
    return n > 0.92 ? p[0] : tone > 0.6 ? p[2] : p[1];
  });
}

/* ------------------------------------------------------------------ painters */
const WOODP = WOOD.oak.planks;
const oakPlanks = () => planks(WOODP, 8);
const smooth = (p: Palette, seed: number) => {
  const f = ranked((x, y) => wn(x, y, 4, 4, seed) * 0.6 + N(x, y, seed + 1) * 0.4, seed);
  return paint((x, y) => pick(p, f(x, y)));
};
const IRON: Palette = [0x9a9a9a, 0xb9b9b9, 0xcfcfcf, 0xe4e4e4, 0xf6f6f6];
const GOLD: Palette = [0xb07b12, 0xdca226, 0xf5c93b, 0xfde26a, 0xfff6b0];
const RED = [0x8f1d16, 0xb12a1f, 0xd23a2a, 0xe8594a] as const;

function metalBlock(p: Palette, seed: number): Tile {
  const t = paint((x, y) => {
    const n = N(x, y, seed);
    return y % 5 === 4 ? p[1] : n > 0.85 ? p[3] : p[2];
  });
  bevel(t, 0, 0, 16, 16, p[4], p[0]);
  bevel(t, 1, 1, 14, 14, p[3], p[1]);
  return t;
}
function wheat(stage: number): Tile {
  const t = new Tile(),
    ripe = stage >= 7,
    stems = [2, 5, 8, 11, 13],
    height = Math.round(3 + stage * 1.55),
    green = [0x4f9a2b, 0x5aa834, 0x3f8424],
    straw = [0x9da334, 0xb0a83a, 0x8b8f2c],
    gold = [0xc9a43d, 0xdcb84e, 0xa8842a, 0xe8cc6c];
  stems.forEach((sx, i) => {
    const lean = N(i, stage, 17) > 0.5 ? 1 : -1,
      h = Math.max(2, height - Math.floor(N(i, 3, 17) * 3)),
      pal = stage >= 5 ? straw : green;
    for (let k = 0; k < h; k++) {
      const y = 15 - k,
        x = sx + (k > h * 0.6 ? lean : 0);
      t.set(x, y, pal[(k + i) % 3]);
      if (k % 3 === 1 && k < h - 2) t.set(x - lean, y - 1, pal[2]);
    }
    const topY = 16 - h,
      topX = sx + (h > 2 ? lean : 0);
    if (ripe || stage >= 5) {
      const ear = ripe ? gold : straw;
      for (let k = 0; k < (ripe ? 4 : 2); k++) {
        t.set(topX, topY + k, ear[k % 2]);
        if (ripe && k % 2 === 0) t.set(topX + 1, topY + k + 1, ear[2]);
        if (ripe && k % 2 === 1) t.set(topX - 1, topY + k, ear[3]);
      }
    }
  });
  return t;
}
function torch(flame: readonly number[], stick: readonly [number, number]): Tile {
  // Two-pixel column (x 7–8) spanning rows 6–15: the mesher maps 7/16‥9/16 × 0‥10/16 onto it.
  const t = new Tile();
  t.set(7, 6, flame[0]);
  t.set(8, 6, flame[1]);
  t.set(7, 7, flame[2]);
  t.set(8, 7, flame[3]);
  t.set(7, 8, flame[4]);
  t.set(8, 8, flame[5]);
  for (let y = 9; y <= 15; y++) {
    t.set(7, y, stick[0]);
    t.set(8, y, stick[1]);
  }
  return t;
}
function wire(power: number): Tile {
  const k = power / 15,
    mix = (a: number, b: number) => Math.round(a + (b - a) * k);
  const shade = (f: number) =>
    (Math.min(255, mix(84, 255) * f) << 16) |
    (Math.min(255, mix(6, 52) * f) << 8) |
    Math.min(255, mix(4, 24) * f);
  const t = new Tile();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const arm = (x >= 7 && x <= 8) || (y >= 7 && y <= 8),
        hub = Math.abs(x - 7.5) + Math.abs(y - 7.5) < 4.2,
        edge = (x === 6 || x === 9 || y === 6 || y === 9) && !hub;
      if (!arm && !hub) continue;
      if (edge) continue;
      const n = N(x, y, 72);
      if (n < 0.08 && !hub) continue;
      t.set(x, y, shade(n > 0.7 ? 1.15 : n < 0.3 ? 0.78 : 0.95));
    }
  return t;
}
function rails(railC: readonly [number, number], centre?: (t: Tile) => void): Tile {
  const t = new Tile(),
    tie = [0x6b5033, 0x876640, 0x4f3a24];
  for (const y0 of [1, 5, 9, 13])
    for (let x = 1; x <= 14; x++) {
      t.set(x, y0, tie[x % 5 === 0 ? 0 : 1]);
      t.set(x, y0 + 1, tie[2]);
    }
  centre?.(t);
  for (let y = 0; y < 16; y++) {
    t.set(2, y, railC[1]);
    t.set(3, y, railC[0]);
    t.set(12, y, railC[1]);
    t.set(13, y, railC[0]);
  }
  return t;
}
const STEEL = [0xc9c9c9, 0x7d7d7d] as const;
const GOLDRAIL = [0xf6d64e, 0xa77f1c] as const;
function lamp(on: boolean): Tile {
  const frame = on ? [0x7a4a1c, 0xb06a28] : [0x2e2016, 0x4a3524],
    glass = on
      ? [0xf2b94e, 0xfbd98a, 0xfff3c8, 0xe09a38]
      : [0x5c3e22, 0x6e4c2c, 0x7a5835, 0x4a3019];
  const t = paint((x, y) => {
    const n = N(x, y, on ? 101 : 100),
      centre = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    return pick(glass, Math.min(0.99, n * 0.55 + (1 - centre / 8) * 0.45));
  });
  bevel(t, 0, 0, 16, 16, frame[1], frame[0]);
  for (let i = 1; i < 15; i++) {
    t.set(i, 7, frame[0]);
    t.set(7, i, frame[0]);
    t.set(i, 8, frame[1]);
    t.set(8, i, frame[1]);
  }
  return t;
}
function smoothSlab(seed: number): Tile {
  const t = smooth([0x9b9b9b, 0xa6a6a6, 0xb0b0b0, 0xa1a1a1], seed);
  bevel(t, 0, 0, 16, 16, 0xc2c2c2, 0x7c7c7c);
  return t;
}
function redDot(t: Tile, x: number, y: number, on: boolean): void {
  const [a, b, c] = on ? [0xff5a3a, 0xffb09a, 0xc0180c] : [0x6a1a14, 0x86302a, 0x3e0e0a];
  t.set(x, y, a);
  t.set(x + 1, y, b);
  t.set(x, y + 1, c);
  t.set(x + 1, y + 1, a);
}
function repeater(on: boolean, comparator: boolean): Tile {
  const t = smoothSlab(comparator ? 98 : 96),
    dust = on ? 0xd8281a : 0x5a1410;
  for (let y = 2; y <= 13; y++) {
    t.set(7, y, dust);
    t.set(8, y, dust);
  }
  if (comparator) {
    redDot(t, 3, 3, on);
    redDot(t, 11, 3, on);
    redDot(t, 7, 11, on);
    for (let x = 4; x <= 11; x++) t.set(x, 5, dust);
  } else {
    redDot(t, 7, 3, on);
    redDot(t, 7, 9, on);
  }
  return t;
}
function piston(face: 'side' | 'top' | 'bottom' | 'head' | 'sticky'): Tile {
  const cob = cobble(COBBLE, 0x4a4a4a, 102, 3),
    wood = planks(WOODP, 103),
    iron = [0x5f5f5f, 0x8a8a8a, 0xa9a9a9] as const;
  if (face === 'side') {
    const t = copy(cob);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 16; x++) t.set(x, y, WOODP[(x + y) % 5 ? 0 : 2]);
    for (let x = 0; x < 16; x++) {
      t.set(x, 3, WOODP[3]);
      t.set(x, 4, iron[0]);
    }
    rect(t, 6, 5, 4, 11, (x, y) =>
      x === 6 ? iron[2] : x === 9 ? iron[0] : y % 4 === 0 ? iron[0] : iron[1],
    );
    return t;
  }
  if (face === 'bottom') {
    const t = copy(cob);
    rect(t, 5, 5, 6, 6, iron[1]);
    bevel(t, 5, 5, 6, 6, iron[2], iron[0]);
    return t;
  }
  const t = copy(wood);
  bevel(t, 0, 0, 16, 16, WOODP[1], WOODP[3]);
  if (face === 'top' || face === 'sticky') {
    rect(t, 6, 6, 4, 4, iron[1]);
    bevel(t, 6, 6, 4, 4, iron[2], iron[0]);
  }
  if (face === 'sticky') {
    const slime = [0x5fa84a, 0x76c35c, 0x4b8a3a, 0x94d77a];
    for (let y = 2; y < 14; y++)
      for (let x = 2; x < 14; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5) + (N(x, y, 106) - 0.5) * 2;
        if (d < 6) t.set(x, y, slime[d < 2 ? 3 : N(x, y, 107) > 0.7 ? 1 : d > 5 ? 2 : 0]);
      }
  }
  return t;
}
function mouthFront(slot: boolean, seed: number): Tile {
  const t = cobble(COBBLE, 0x4a4a4a, seed, 3);
  bevel(t, 0, 0, 16, 16, 0x8e8e8e, 0x4a4a4a);
  if (slot) {
    rect(t, 5, 6, 6, 4, 0x1a1a1a);
    bevel(t, 4, 5, 8, 6, 0x4a4a4a, 0x9a9a9a);
  } else {
    art(
      [
        '................',
        '................',
        '................',
        '.....dddddd.....',
        '....dkkkkkkl....',
        '...dkkkkkkkkl...',
        '...dkkkkkkkkl...',
        '...dkkkkkkkkl...',
        '...dkkkkkkkkl...',
        '...dkkkkkkkkl...',
        '....dkkkkkkl....',
        '.....llllll.....',
      ],
      { d: 0x404040, k: 0x161616, l: 0x9c9c9c },
      t,
    );
  }
  return t;
}
function stoneTop(seed: number): Tile {
  const t = stone(seed);
  bevel(t, 0, 0, 16, 16, 0x9a9a9a, 0x555555);
  return t;
}
function book(t: Tile, y0: number, h: number, seed: number): void {
  const colours = [
    [0x7b2222, 0xa33a33],
    [0x2c5a2c, 0x3f7a3a],
    [0x2a3f73, 0x3d5aa0],
    [0x6a4a26, 0x8a6534],
    [0x5a2a66, 0x7a3f8a],
    [0xa2822c, 0xc6a444],
  ];
  let x = 1;
  let i = 0;
  while (x < 15) {
    const w = N(i, y0, seed) > 0.65 ? 2 : 1,
      top = y0 + (N(i, y0 + 1, seed) > 0.6 ? 1 : 0),
      [dark, light] = colours[Math.floor(N(i, y0 + 2, seed) * colours.length)];
    for (let k = 0; k < w && x + k < 15; k++)
      for (let y = top; y < y0 + h; y++)
        t.set(
          x + k,
          y,
          y === top ? light : y === top + 2 ? 0xd8c99a : k === w - 1 && w > 1 ? dark : light,
        );
    x += w;
    if (N(i, y0 + 3, seed) > 0.8 && x < 14) x++; // a gap on the shelf
    i++;
  }
}
function bookshelf(): Tile {
  const t = paint((x, y) => (y % 8 === 7 || y % 8 === 0 ? WOODP[3] : WOODP[2]));
  for (const y of [0, 8])
    for (let x = 0; x < 16; x++) t.set(x, y, N(x, y, 67) > 0.7 ? WOODP[0] : WOODP[1]);
  for (const y of [7, 15]) for (let x = 0; x < 16; x++) t.set(x, y, WOODP[3]);
  for (let y = 1; y < 7; y++) for (let x = 0; x < 16; x++) t.set(x, y, 0x3a2a18);
  for (let y = 9; y < 15; y++) for (let x = 0; x < 16; x++) t.set(x, y, 0x3a2a18);
  book(t, 1, 6, 67);
  book(t, 9, 6, 68);
  for (let y = 0; y < 16; y++) {
    t.set(0, y, WOODP[3]);
    t.set(15, y, WOODP[3]);
  }
  return t;
}

const PAINTERS: Record<number, () => Tile> = {
  3: () => stone(3),
  9: cobblestone,
  16: () => {
    const t = paint((x, y) =>
      pick(
        [0xd9d6cb, 0xe6e3d9, 0xefede5, 0xf7f5ef],
        ranked((a, b) => wn(a, b, 4, 8, 16) + N(a, b, 17) * 0.4, 16)(x, y),
      ),
    );
    for (let i = 0; i < 9; i++) {
      const y = Math.floor(N(i, 0, 18) * 16),
        x = Math.floor(N(i, 1, 18) * 16),
        len = 2 + Math.floor(N(i, 2, 18) * 3);
      for (let k = 0; k < len; k++)
        t.set((x + k) % 16, y, k === 0 || k === len - 1 ? 0x5a5852 : 0x2c2b28);
    }
    return t;
  },
  17: () => ore(stone(170), [0x2e2e2e, 0x262626, 0x4a4a4a], 17, 5),
  18: () => ore(stone(180), [0x7a624f, 0xd8ae90, 0xf0d4bd], 18),
  19: () => {
    const t = oakPlanks();
    rect(t, 0, 0, 16, 3, (x, y) => (y === 2 ? 0x5a3f22 : WOODP[(x + y) % 4 ? 2 : 3]));
    art(
      [
        '................',
        '................',
        '................',
        '................',
        '..ss.......hh...',
        '..ssss.....hh...',
        '..sssssk..kkkk..',
        '..sssssk...kk...',
        '...ssssk...kk...',
        '....sssk...kk...',
        '.......k...kk...',
        '.......k...kk...',
        '................',
      ],
      { s: 0xb9b9b9, k: 0x4a3018, h: 0x777777 },
      t,
    );
    bevel(t, 0, 0, 16, 16, WOODP[1], 0x5a3f22);
    return t;
  },
  20: () => {
    const t = oakPlanks();
    bevel(t, 0, 0, 16, 16, 0x5a3f22, 0x5a3f22);
    bevel(t, 1, 1, 14, 14, WOODP[1], WOODP[3]);
    for (const k of [5, 10])
      for (let i = 2; i < 14; i++) {
        t.set(k, i, 0x6a4b2a);
        t.set(i, k, 0x6a4b2a);
      }
    return t;
  },
  21: () => mouthFurnace(false),
  22: () => stoneTop(22),
  23: () => mouthFurnace(true),
  25: () => chest(true),
  26: () => chest(false),
  28: () => {
    const t = paint((x, y) =>
      y < 9
        ? RED[y === 0 ? 3 : N(x, y, 28) > 0.8 ? 1 : 2]
        : y === 9
          ? 0xe8e2d6
          : WOODP[y === 15 ? 3 : 1],
    );
    for (let y = 10; y < 16; y++) for (const x of [0, 1, 14, 15]) t.set(x, y, WOODP[2]);
    for (let y = 12; y < 16; y++) for (let x = 3; x < 13; x++) t.set(x, y, 0x3a2a18);
    return t;
  },
  29: () => {
    const t = paint((x, y) => RED[N(x, y, 29) > 0.85 ? 1 : (x + y) % 7 === 0 ? 3 : 2]);
    rect(t, 2, 1, 12, 4, (x, y) =>
      y === 4 || x === 13 ? 0xbfb8aa : y === 1 ? 0xffffff : 0xece6da,
    );
    for (let x = 0; x < 16; x++) t.set(x, 6, RED[0]);
    return t;
  },
  40: () => {
    const at = cells(4, 40, 0.9),
      p = [0x5f5b58, 0x6f6b67, 0x807b76, 0x928c86, 0xa39d96],
      brown = [0x6a5e54, 0x7d6f62, 0x8e8072, 0x9d8f80, 0xae9f8f];
    return paint((x, y) => {
      const c = at(x, y);
      if (c.gap < 0.7) return 0x4f4b48;
      const pal = N(c.id, 3, 41) > 0.72 ? brown : p,
        base = 1 + Math.floor(N(c.id, 0, 42) * 2.99),
        light = -(c.dx + c.dy) / 3;
      return pal[Math.max(0, Math.min(4, base + (light > 0.6 ? 1 : light < -0.6 ? -1 : 0)))];
    });
  },
  41: () => {
    const f = ranked((x, y) => wn(x, y, 4, 4, 41) * 0.7 + N(x, y, 42) * 0.3, 41);
    const t = paint((x, y) => pick([0x0e0a17, 0x140f20, 0x1a1428, 0x221a33], f(x, y)));
    for (let i = 0; i < 5; i++) {
      const x = Math.floor(N(i, 0, 43) * 14),
        y = Math.floor(N(i, 1, 43) * 14);
      t.set(x, y, 0x3c2c5c);
      t.set(x + 1, y + 1, 0x5a4488);
      t.set(x + 2, y + 2, 0x3c2c5c);
    }
    return t;
  },
  43: () => {
    const t = paint((x, y) => {
      const col = x % 4;
      return col === 0 ? RED[0] : col === 3 ? RED[1] : N(x, y, 43) > 0.85 ? RED[3] : RED[2];
    });
    rect(t, 0, 5, 16, 6, (x, y) => (y === 5 || y === 10 ? 0xbdb6a8 : 0xebe5da));
    art(['..TTT.N..N.TTT..', '...T..NN.N..T...', '...T..N.NN..T...', '...T..N..N..T...'], {
      T: 0x1c1c1c,
      N: 0x1c1c1c,
    }).data.forEach((v, i) => {
      if (i % 4 === 3 && v) {
        const k = i >> 2;
        t.set(k % 16, 6 + Math.floor(k / 16), 0x1c1c1c);
      }
    });
    return t;
  },
  44: () => tntEnd(true),
  45: () => tntEnd(false),
  46: () =>
    torch([0xfff3a8, 0xffffff, 0xffc93c, 0xffe98a, 0xd9791f, 0xf29a2e], [0x6b4a2b, 0x8c6639]),
  47: () => farmland(false),
  48: () => farmland(true),
  49: () => wheat(0),
  50: () => wheat(1),
  51: () => wheat(2),
  52: () => wheat(3),
  53: () => wheat(4),
  54: () => wheat(5),
  55: () => wheat(6),
  56: () => wheat(7),
  57: () =>
    art(
      [
        '................',
        '................',
        '......gG........',
        '....gGGgl.......',
        '...gGllGGg.l....',
        '...GGgGlGGGgl...',
        '..gGlGGgGlGGg...',
        '...gGGbGGgGG....',
        '....gGGbGlg.....',
        '......Gb.g......',
        '.......b........',
        '.......b........',
        '......bB........',
        '.......b........',
        '.......b........',
        '.......b........',
      ],
      { g: 0x2f6a1c, G: 0x3f8a26, l: 0x62b03a, b: 0x6b4a2b, B: 0x4f3620 },
    ),
  58: () => {
    const t = new Tile(),
      c = [0x86b84e, 0xa6d36a, 0x6c9a3c, 0xc9e98f];
    for (const [x0, shift] of [
      [2, 0],
      [7, 2],
      [12, 1],
    ] as const)
      for (let y = 0; y < 16; y++) {
        const node = (y + shift * 2) % 5 === 0;
        t.set(x0, y, node ? c[2] : c[0]);
        t.set(x0 + 1, y, node ? c[2] : c[1]);
        if (!node && (y + shift) % 5 === 2) t.set(x0 + 1, y, c[3]);
        if (node && y > 1) t.set(x0 + 2, y - 1, c[2]);
      }
    return t;
  },
  59: () => {
    const t = paint((x, y) => {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      return d > 6.5 ? 0x2a5a1c : d > 5.5 ? 0x5a9a3a : (x + y) % 4 === 0 ? 0x4a8a2e : 0x3f7a26;
    });
    for (const [x, y] of [
      [4, 4],
      [11, 4],
      [4, 11],
      [11, 11],
      [7, 7],
    ])
      t.set(x, y, 0xcfcf8a);
    return t;
  },
  60: () => {
    const t = paint((x, y) => {
      const col = x % 4;
      if (x === 0 || x === 15) return 0x1f4a16;
      return col === 1 ? 0x5a9a3a : col === 3 ? 0x2e641f : N(x, y, 60) > 0.85 ? 0x4a8a2e : 0x3f7a26;
    });
    for (let y = 1; y < 16; y += 4)
      for (const x of [1, 5, 9, 13]) t.set(x, y + (x % 8 ? 2 : 0), 0xe8e8b0);
    return t;
  },
  61: () => gourd([0xc9650f, 0xe38a1d, 0xf0a33c, 0xa85209], 61),
  62: () => gourdTop([0xc9650f, 0xe38a1d, 0xf0a33c, 0xa85209], 0x5a7a22, 62),
  63: () => gourd([0x4d7f1c, 0x6aa22a, 0x86bd3c, 0x3b6614], 63),
  64: () => gourdTop([0x4d7f1c, 0x6aa22a, 0x86bd3c, 0x3b6614], 0x7a5a2a, 64),
  65: () => {
    const t = PAINTERS[41]();
    rect(t, 0, 0, 16, 5, (x, y) =>
      y === 4 ? 0x5a0c0c : y === 0 ? 0xc43a2e : N(x, y, 65) > 0.8 ? 0xb02820 : 0x9a1c16,
    );
    for (const x of [0, 15]) rect(t, x, 0, 1, 5, 0x2a1a3a);
    for (let x = 2; x < 16; x += 4) t.set(x, 4, 0xe8c24a);
    return t;
  },
  66: () => {
    const t = paint((x, y) => (N(x, y, 66) > 0.85 ? 0xb02820 : 0x9a1c16));
    for (const [cx, cy] of [
      [0, 0],
      [12, 0],
      [0, 12],
      [12, 12],
    ]) {
      rect(t, cx, cy, 4, 4, 0x1a1428);
      t.set(cx + 1, cy + 1, 0x7af0e8);
      t.set(cx + 2, cy + 2, 0x3ab8b0);
    }
    art(
      [
        '................',
        '................',
        '................',
        '................',
        '................',
        '....cwwwwwwc....',
        '...cwwpwwpwwc...',
        '...cwpwwpwwwc...',
        '...cwwpwwwpwc...',
        '...cwwwwwwwwc...',
        '....cccCcccc....',
      ],
      { c: 0x6a3a1a, C: 0x3a1f0c, w: 0xf2ead2, p: 0x9a8a6a },
      t,
    );
    return t;
  },
  67: bookshelf,
  68: () => {
    const t = paint(() => 0x2b2622);
    rect(t, 0, 13, 16, 3, (x, y) => (y === 13 ? 0x8a8a8a : (x + y) % 3 ? 0x6a6a6a : 0x5a5a5a));
    rect(t, 7, 1, 2, 12, (x) => (x === 7 ? 0xf4c24a : 0xb8862a));
    art(
      [
        '................',
        '................',
        '................',
        '................',
        '................',
        '................',
        '..cc........cc..',
        '..gg........gg..',
        '.gGGg......gRRg.',
        '.gGWg......gRWg.',
        '.gGGg......gRRg.',
        '..gg........gg..',
      ],
      { c: 0x8a6a3a, g: 0xa8c8d8, G: 0x3a7ad8, R: 0xd84a6a, W: 0xffffff },
      t,
    );
    return t;
  },
  69: () => {
    const p = [0x2f2f2f, 0x3e3e3e, 0x4a4a4a, 0x575757, 0x666666];
    const t = paint(() => 0x1c1c1c);
    rect(t, 0, 0, 16, 5, (x, y) =>
      y === 0 ? p[4] : y === 4 ? p[0] : N(x, y, 69) > 0.7 ? p[3] : p[2],
    );
    rect(t, 4, 5, 8, 6, (x) => (x === 4 ? p[2] : x === 11 ? p[0] : p[1]));
    rect(t, 2, 11, 12, 5, (x, y) => (y === 11 ? p[3] : y === 15 ? p[0] : p[2]));
    return t;
  },
  70: () => {
    const p = [0x353535, 0x444444, 0x505050, 0x5e5e5e];
    const t = paint((x, y) => p[y % 4 === 0 ? 0 : N(x, y, 70) > 0.8 ? 3 : 2]);
    bevel(t, 0, 0, 16, 16, 0x6e6e6e, 0x262626);
    rect(t, 4, 3, 8, 10, (x, y) => (N(x, y, 71) > 0.5 ? 0x6a6a6a : 0x5e5e5e));
    return t;
  },
  71: () => ore(stone(710), [0x5a0808, 0xc41a12, 0xff6a5a], 71, 5),
  ...Object.fromEntries(Array.from({ length: 16 }, (_, p) => [72 + p, () => wire(p)])),
  88: () =>
    torch([0xff6a50, 0xffc0b0, 0xe8200e, 0xff5a3a, 0x9a0c06, 0xc8180c], [0x6b4a2b, 0x8c6639]),
  89: () =>
    torch([0x5a1a14, 0x6e2620, 0x4a120e, 0x5a1a14, 0x3a0c08, 0x4a120e], [0x6b4a2b, 0x8c6639]),
  90: () => lever(false),
  91: () => lever(true),
  92: () => button(false),
  93: () => button(true),
  94: () => plate(false),
  95: () => plate(true),
  96: () => repeater(false, false),
  97: () => repeater(true, false),
  98: () => repeater(false, true),
  99: () => repeater(true, true),
  100: () => lamp(false),
  101: () => lamp(true),
  102: () => piston('side'),
  103: () => piston('top'),
  104: () => piston('bottom'),
  105: () => piston('head'),
  106: () => piston('sticky'),
  107: () => mouthFront(false, 107),
  108: () => stoneTop(108),
  109: () => mouthFront(true, 109),
  110: () => stoneTop(110),
  111: () => {
    const p = [0x2a2a2a, 0x3a3a3a, 0x484848, 0x5a5a5a];
    const t = paint((x, y) => p[y % 5 === 0 ? 3 : N(x, y, 111) > 0.8 ? 2 : 1]);
    bevel(t, 0, 0, 16, 16, 0x6a6a6a, 0x1c1c1c);
    for (const x of [2, 13]) for (const y of [2, 12]) t.set(x, y, 0x7a7a7a);
    return t;
  },
  112: () => {
    const t = paint((x, y) => {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      return d > 6.5
        ? 0x5e5e5e
        : d > 5.5
          ? 0x3e3e3e
          : d > 4.5
            ? 0x262626
            : N(x, y, 112) > 0.8
              ? 0x1c1c1c
              : 0x141414;
    });
    bevel(t, 0, 0, 16, 16, 0x7a7a7a, 0x2e2e2e);
    return t;
  },
  113: () => {
    const t = PAINTERS[111]();
    rect(t, 6, 6, 4, 4, 0x121212);
    bevel(t, 5, 5, 6, 6, 0x6a6a6a, 0x2a2a2a);
    return t;
  },
  114: () => rails(STEEL),
  115: () =>
    rails(GOLDRAIL, (t) =>
      rect(t, 6, 0, 4, 16, (x, y) => (x === 6 || x === 9 ? 0x3a0c0a : y % 2 ? 0x5a1410 : 0x4a100c)),
    ),
  116: () =>
    rails(GOLDRAIL, (t) =>
      rect(t, 6, 0, 4, 16, (x, y) => (x === 6 || x === 9 ? 0x8a1a10 : y % 2 ? 0xff4a2a : 0xd8281a)),
    ),
  117: () => rails(STEEL, (t) => detectorPlate(t, false)),
  118: () => rails(STEEL, (t) => detectorPlate(t, true)),
  119: () => ore(stone(1190), [0x8a6a14, 0xf8d43a, 0xfff6a0], 119),
  120: () => metalBlock(IRON, 120),
  121: () => metalBlock(GOLD, 121),
  122: () => ore(stone(1220), [0x0e2a6a, 0x2350b8, 0x5a86e0], 122, 5),
  123: () => {
    const p = [0xcdbb86, 0xd8c793, 0xe0d09e, 0xc4b07a];
    const f = ranked((x, y) => wn(x, y, 8, 2, 123) * 0.6 + N(x, y, 124) * 0.4, 123);
    const t = paint((x, y) => pick(p, f(x, y)));
    for (let x = 0; x < 16; x++) {
      t.set(x, 0, 0xe8dcae);
      t.set(x, 15, 0xb8a46e);
    }
    return t;
  },
  124: () => {
    const f = ranked((x, y) => wn(x, y, 4, 4, 125) * 0.5 + N(x, y, 126) * 0.5, 124);
    return paint((x, y) => pick([0xbfaa74, 0xcab681, 0xd4c18d, 0xdccb99], f(x, y)));
  },
  125: () => {
    const f = ranked((x, y) => wn(x, y, 4, 4, 125) * 0.5 + N(x, y, 126) * 0.5, 125);
    return paint((x, y) => pick([0xe2ecef, 0xeef5f7, 0xf6fbfc, 0xfdffff], f(x, y)));
  },
  126: () => {
    const t = paint((x, y) => {
      const streak = (x + y * 2) % 13 === 0 || (x * 2 + y) % 17 === 0;
      return streak ? 0xd8ecff : N(x, y, 126) > 0.7 ? 0xa4c8f8 : 0x8fb8f2;
    }, 205);
    return t;
  },
  127: () => ore(stone(1270), [0x14706c, 0x4fe0e8, 0xcafffb], 127),
  128: () => blockBricks([0x5e5e5e, 0x767676, 0x7e7e7e, 0x8c8c8c], 0x4a4a4a, 128, 8, 8, 4),
  129: () => {
    const base = cobblestone(),
      moss = ranked((x, y) => wn(x, y, 8, 8, 129) * 0.7 + N(x, y, 130) * 0.3, 129);
    const g = [0x3e5f24, 0x4f7a2c, 0x62913a];
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const m = moss(x, y);
        if (m > 0.62) base.set(x, y, g[m > 0.9 ? 2 : m > 0.75 ? 1 : 0]);
      }
    return base;
  },
  130: () => {
    const t = new Tile(),
      bar = [0x1a2630, 0x2e4250, 0x4a6272];
    for (let i = 0; i < 16; i++)
      for (const k of [0, 5, 10, 15]) {
        t.set(k, i, i % 5 === 0 ? bar[2] : bar[1]);
        t.set(i, k, i % 5 === 0 ? bar[2] : bar[k === 15 ? 0 : 1]);
      }
    for (const [x, y] of [
      [7, 7],
      [8, 8],
      [2, 12],
      [12, 2],
    ])
      t.set(x, y, 0x1a1a1a);
    return t;
  },
  132: () => {
    const t = endFrame();
    art(
      [
        '................',
        '................',
        '................',
        '................',
        '.....dGGGGd.....',
        '....dGgggGGd....',
        '....GgkkggGG....',
        '....GgkkggGG....',
        '....GGggggGG....',
        '....dGGggGGd....',
        '.....dGGGGd.....',
      ],
      { d: 0x1c4a3a, G: 0x2e8a5a, g: 0x5ad08a, k: 0x0e1a14 },
      t,
    );
    return t;
  },
  133: endFrame,
  135: () => endStone(135),
  136: () => {
    const at = cells(3, 136, 0.9),
      p = [0xa86c2c, 0xd89a44, 0xf2c45a, 0xffe08a, 0xfff4c4];
    return paint((x, y) => {
      const c = at(x, y);
      if (c.gap < 0.8) return p[0];
      const light = 1 - Math.hypot(c.dx, c.dy) / 4 + (N(x, y, 137) - 0.5) * 0.6;
      return p[light > 0.75 ? 4 : light > 0.4 ? 3 : light > 0.1 ? 2 : 1];
    });
  },
  137: () => ore(netherrack(1370), [0x9c8a80, 0xe8e0d4, 0xffffff], 137, 5),
  138: () => {
    const f = ranked((x, y) => wn(x, y, 4, 4, 138) * 0.6 + N(x, y, 139) * 0.4, 138);
    const t = paint((x, y) => pick([0x3f2c22, 0x4d372a, 0x5a4232, 0x684d3b], f(x, y)));
    for (const [x, y] of [
      [2, 3],
      [9, 9],
      [10, 1],
    ]) {
      t.set(x, y, 0x21160f);
      t.set(x + 3, y, 0x21160f);
      rect(t, x + 1, y + 2, 2, 2, 0x21160f);
      t.set(x, y - 1, 0x76594a);
      t.set(x + 3, y - 1, 0x76594a);
    }
    return t;
  },
  139: () => blockBricks([0x1e0e10, 0x2e161a, 0x3a1c21, 0x4a262b], 0x140a0b, 139, 8, 4, 4),
  140: () => {
    const f = ranked((x, y) => wn(x, y, 4, 4, 140) * 0.5 + N(x, y, 141) * 0.5, 140);
    return paint((x, y) => {
      const v = f(x, y);
      return v > 0.96
        ? 0x7a4aa8
        : v > 0.88
          ? 0x3c2058
          : pick([0x0a0610, 0x100a18, 0x160e20], v / 0.88);
    });
  },
  141: () => blockBricks([0xb8ba7c, 0xd6d898, 0xdfe1a6, 0xeceeb8], 0xa2a468, 141, 8, 4, 4),
  142: () => {
    const p = [0x7e527e, 0x9a6c9a, 0xa67aa6, 0xb58bb5, 0xc9a2c9];
    return paint((x, y) => {
      const lx = x % 8,
        ly = y % 8;
      if (lx === 0 || ly === 0) return p[4];
      if (lx === 7 || ly === 7) return p[0];
      return N(x, y, 142) > 0.8 ? p[1] : N(x, y, 143) > 0.5 ? p[3] : p[2];
    });
  },
  143: () => netherrack(143),
  144: () => {
    const at = cells(3, 144, 0.9),
      p = [0x2a0c06, 0x3e140a, 0x521c0e, 0x662612];
    return paint((x, y) => {
      const c = at(x, y);
      if (c.gap < 0.7) return 0xffb43a;
      if (c.gap < 1.4) return 0xe8601a;
      const n = N(x, y, 145);
      return n > 0.94 ? 0xc84a14 : p[Math.floor(N(c.id, 0, 146) * 2.99 + (n > 0.6 ? 1 : 0)) % 4];
    });
  },
  145: () => {
    const t = paint((x, y) => pick([0x262626, 0x2e2e2e, 0x363636, 0x3e3e3e], N(x, y, 145)));
    art(
      [
        '................',
        '................',
        '................',
        '................',
        '...kkk....kkk...',
        '...kkk....kkk...',
        '...kkk....kkk...',
        '................',
        '.......kk.......',
        '................',
        '..llllllllllll..',
        '..lk.lk.lk.lk...',
        '................',
      ],
      { k: 0x0a0a0a, l: 0x505050 },
      t,
    );
    return t;
  },
};

function mouthFurnace(lit: boolean): Tile {
  const t = cobble(COBBLE, 0x4a4a4a, lit ? 23 : 21, 3);
  bevel(t, 0, 0, 16, 16, 0x8e8e8e, 0x4a4a4a);
  rect(t, 3, 2, 10, 2, (x) => (x % 2 ? 0x3a3a3a : 0x5a5a5a));
  rect(t, 3, 8, 10, 6, 0x151515);
  bevel(t, 2, 7, 12, 8, 0x3a3a3a, 0x9a9a9a);
  if (lit)
    art(
      [
        '................',
        '................',
        '................',
        '................',
        '................',
        '................',
        '................',
        '................',
        '.....y....y.....',
        '....yoy..yoy....',
        '...yoOoyyoOoy...',
        '...oOwOooOwOo...',
        '...rOwwOOwwOr...',
        '...rroOOOOorr...',
      ],
      { y: 0xffd84a, o: 0xf28a1c, O: 0xffb030, w: 0xfff4c0, r: 0xb0400c },
      t,
    );
  return t;
}
function chest(front: boolean): Tile {
  const p = [0x5a3812, 0x8a5a22, 0xa86e2c, 0xbd8238];
  const t = paint((x, y) => (y % 4 === 3 ? p[1] : N(x, y, front ? 25 : 26) > 0.8 ? p[3] : p[2]));
  bevel(t, 0, 0, 16, 16, p[0], p[0]);
  if (front) {
    for (let x = 1; x < 15; x++) {
      t.set(x, 5, p[0]);
      t.set(x, 6, 0x3a240c);
    }
    rect(t, 7, 4, 2, 4, 0xc8c8c8);
    t.set(7, 7, 0x8a8a8a);
    t.set(8, 7, 0x8a8a8a);
  } else bevel(t, 1, 1, 14, 14, p[3], p[1]);
  return t;
}
function tntEnd(top: boolean): Tile {
  const t = paint((x, y) => RED[N(x, y, top ? 44 : 45) > 0.8 ? 1 : 2]);
  for (const [cx, cy] of [
    [3.5, 3.5],
    [11.5, 3.5],
    [3.5, 11.5],
    [11.5, 11.5],
    [7.5, 7.5],
  ])
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d < 2.9) t.set(x, y, d > 2 ? RED[0] : d > 1.2 ? RED[3] : top ? 0x3a3a3a : RED[1]);
      }
  if (top) {
    t.set(7, 7, 0x8a8a8a);
    t.set(8, 7, 0x6a6a6a);
    t.set(8, 6, 0xa0a0a0);
  }
  return t;
}
function farmland(wet: boolean): Tile {
  const p = wet ? [0x3e2a1a, 0x4a3322, 0x553c28, 0x2e1f13] : DIRT.map((c) => c);
  return paint((x, y) => {
    if (y % 4 === 3) return wet ? 0x24170e : 0x5a4332;
    if (y % 4 === 0) return p[2];
    return pick(p.slice(0, 3), N(x, y, wet ? 48 : 47));
  });
}
function gourd(p: Palette, seed: number): Tile {
  return paint((x, y) => {
    const col = x % 4;
    if (col === 0) return p[3];
    if (col === 1) return p[0];
    if (col === 2) return N(x, y, seed) > 0.85 ? p[2] : p[1];
    return p[2];
  });
}
function gourdTop(p: Palette, stalk: number, seed: number): Tile {
  const t = paint((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    return Math.floor(d) % 3 === 0 ? p[0] : N(x, y, seed) > 0.8 ? p[2] : p[1];
  });
  rect(t, 7, 7, 2, 2, stalk);
  t.set(7, 6, stalk);
  return t;
}
function lever(on: boolean): Tile {
  const t = new Tile();
  rect(t, 5, 4, 6, 8, (x, y) => (N(x, y, 90) > 0.6 ? 0x8a8a8a : 0x767676));
  bevel(t, 5, 4, 6, 8, 0xa0a0a0, 0x505050);
  const from = on ? 8 : 1,
    to = on ? 14 : 7;
  for (let y = from; y <= to; y++) {
    t.set(7, y, 0x6b4a2b);
    t.set(8, y, 0x8c6639);
  }
  const tip = on ? 14 : 1;
  t.set(7, tip, 0x4a3018);
  t.set(8, tip, 0x5a3a1e);
  return t;
}
function button(on: boolean): Tile {
  const t = new Tile();
  rect(t, 5, 6, 6, 4, on ? 0x6a6a6a : 0x8a8a8a);
  bevel(t, 5, 6, 6, 4, on ? 0x7a7a7a : 0xb0b0b0, 0x4a4a4a);
  return t;
}
function plate(on: boolean): Tile {
  const t = new Tile();
  rect(t, 1, 1, 14, 14, (x, y) => (on ? 0x6e6e6e : N(x, y, 94) > 0.8 ? 0x8a8a8a : 0x7e7e7e));
  bevel(t, 1, 1, 14, 14, on ? 0x808080 : 0xa6a6a6, 0x4e4e4e);
  return t;
}
function detectorPlate(t: Tile, on: boolean): void {
  rect(t, 5, 5, 6, 6, 0x7e7e7e);
  bevel(t, 5, 5, 6, 6, 0xa6a6a6, 0x4e4e4e);
  redDot(t, 7, 7, on);
}
function endStone(seed: number): Tile {
  const f = ranked((x, y) => wn(x, y, 4, 4, seed) * 0.5 + N(x, y, seed + 1) * 0.5, seed);
  const t = paint((x, y) => pick([0xcfd292, 0xdadd9f, 0xe2e5aa, 0xeaedb8], f(x, y)));
  for (let i = 0; i < 7; i++) {
    const x = Math.floor(N(i, 0, seed + 2) * 15),
      y = Math.floor(N(i, 1, seed + 2) * 15);
    t.set(x, y, 0xa8ab6c);
    t.set(x + 1, y + 1, 0xf4f6cc);
  }
  return t;
}
function endFrame(): Tile {
  const t = endStone(133),
    g = [0x2e5a4a, 0x3e7462, 0x1e3e32];
  for (let i = 0; i < 16; i++)
    for (const k of [0, 1, 14, 15]) {
      t.set(i, k, g[k === 0 ? 1 : k === 15 ? 2 : 0]);
      t.set(k, i, g[k === 0 ? 1 : k === 15 ? 2 : 0]);
    }
  for (const x of [4, 11]) for (const y of [0, 15]) t.set(x, y, 0x8ad8b8);
  return t;
}
function netherrack(seed: number): Tile {
  const f = ranked((x, y) => wn(x, y, 2, 4, seed) * 0.5 + N(x, y, seed + 1) * 0.5, seed);
  return paint((x, y) => pick([0x4e1616, 0x622020, 0x6f2828, 0x7c3030, 0x8c3a3a], f(x, y)));
}

/** Pixels for a classic tile from the hand-drawn set, or null to keep the older source. */
export function classicTilePixels(tile: number): Uint8ClampedArray | null {
  const painter = PAINTERS[tile];
  return painter ? painter().data : null;
}
/** Tiles covered by `classicTilePixels` (for tests and tools). */
export const CLASSIC_TILES: readonly number[] = Object.keys(PAINTERS)
  .map(Number)
  .sort((a, b) => a - b);
