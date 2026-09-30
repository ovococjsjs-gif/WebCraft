/**
 * Caves and ravines, ported from the 1.12 carvers. Every chunk within eight chunks may start a
 * cave system; its tunnels wander with the same steering rules, branch once in the middle, and
 * carve ellipsoids that never break into water. Below y 11 a cave fills with lava.
 */
import { BLOCK, BLOCK_X } from '../../../content/src/blocks';
import { Rng } from './rng';
import { idx } from './terrain-v5';
import { biomeV5 } from './biomes-v5';

const RANGE = 8;
const CARVABLE = new Set<number>([
  BLOCK.STONE,
  BLOCK.DIRT,
  BLOCK.GRASS,
  BLOCK.SAND,
  BLOCK.GRAVEL,
  BLOCK.SANDSTONE,
  BLOCK_X.RED_SAND,
  BLOCK_X.PODZOL,
  BLOCK_X.COARSE_DIRT,
  BLOCK_X.MYCELIUM,
  BLOCK_X.GRASS_SNOWY,
  BLOCK.SNOW,
  BLOCK_X.TERRACOTTA,
  BLOCK_X.TERRACOTTA_ORANGE,
  BLOCK_X.TERRACOTTA_YELLOW,
  BLOCK_X.TERRACOTTA_WHITE,
  BLOCK_X.TERRACOTTA_LIGHT_GRAY,
  BLOCK_X.TERRACOTTA_BROWN,
  BLOCK_X.TERRACOTTA_RED,
]);
const TOPSOIL = new Set<number>([BLOCK.GRASS, BLOCK_X.MYCELIUM, BLOCK_X.PODZOL]);

interface Target {
  cx: number;
  cz: number;
  blocks: Uint16Array;
  biomes: Uint8Array;
}

function dig(t: Target, x: number, y: number, z: number, topFound: boolean): void {
  const i = idx(x, y, z);
  const state = t.blocks[i];
  if (!CARVABLE.has(state)) return;
  // Sand and gravel resting on the carved roof would fall; the reference leaves them standing,
  // but a hovering beach looks broken, so the carver keeps them as the roof instead.
  const above = y < 255 ? t.blocks[idx(x, y + 1, z)] : BLOCK.AIR;
  if (above === BLOCK.WATER) return;
  if (
    (state === BLOCK.SAND || state === BLOCK.GRAVEL || state === BLOCK_X.RED_SAND) &&
    above === BLOCK.AIR
  )
    return;
  t.blocks[i] = y < 11 ? BLOCK.LAVA : BLOCK.AIR;
  if (topFound && y > 0 && t.blocks[idx(x, y - 1, z)] === BLOCK.DIRT)
    t.blocks[idx(x, y - 1, z)] = biomeV5(t.biomes[x + z * 16]).top;
}

function carveEllipsoid(
  t: Target,
  x: number,
  y: number,
  z: number,
  radius: number,
  vertical: number,
  ravine?: Float32Array,
): void {
  const ox = t.cx * 16,
    oz = t.cz * 16;
  let x0 = Math.floor(x - radius) - ox - 1,
    x1 = Math.floor(x + radius) - ox + 1,
    y0 = Math.floor(y - vertical) - 1,
    y1 = Math.floor(y + vertical) + 1,
    z0 = Math.floor(z - radius) - oz - 1,
    z1 = Math.floor(z + radius) - oz + 1;
  if (x0 < 0) x0 = 0;
  if (x1 > 16) x1 = 16;
  if (y0 < 1) y0 = 1;
  if (y1 > 248) y1 = 248;
  if (z0 < 0) z0 = 0;
  if (z1 > 16) z1 = 16;
  if (x0 >= x1 || z0 >= z1) return;
  // Never open into water: a shell of the box touching water cancels this step.
  for (let bx = x0; bx < x1; bx++)
    for (let bz = z0; bz < z1; bz++)
      for (let by = y1 + 1; by >= y0 - 1; by--) {
        if (by < 0 || by >= 256) continue;
        if (t.blocks[idx(bx, by, bz)] === BLOCK.WATER) return;
        if (by !== y0 - 1 && bx !== x0 && bx !== x1 - 1 && bz !== z0 && bz !== z1 - 1) by = y0;
      }
  for (let bx = x0; bx < x1; bx++) {
    const dx = (bx + ox + 0.5 - x) / radius;
    for (let bz = z0; bz < z1; bz++) {
      const dz = (bz + oz + 0.5 - z) / radius;
      if (dx * dx + dz * dz >= 1) continue;
      let topFound = false;
      for (let by = y1 - 1; by >= y0; by--) {
        const dy = (by - 1 + 0.5 - y) / vertical;
        const inside = ravine
          ? (dx * dx + dz * dz) * ravine[by - 1 < 0 ? 0 : by - 1] + (dy * dy) / 6 < 1
          : dy > -0.7 && dx * dx + dy * dy + dz * dz < 1;
        if (!inside) continue;
        const state = t.blocks[idx(bx, by, bz)];
        if (TOPSOIL.has(state)) topFound = true;
        dig(t, bx, by, bz, topFound);
      }
    }
  }
}

function tunnel(
  t: Target,
  seed: number,
  x: number,
  y: number,
  z: number,
  width: number,
  yaw: number,
  pitch: number,
  start: number,
  end: number,
  heightScale: number,
): void {
  const cxm = t.cx * 16 + 8,
    czm = t.cz * 16 + 8;
  let dYaw = 0,
    dPitch = 0;
  const r = new Rng(seed);
  if (end <= 0) {
    const span = RANGE * 16 - 16;
    end = span - r.nextInt(Math.floor(span / 4));
  }
  let room = false;
  if (start === -1) {
    start = Math.floor(end / 2);
    room = true;
  }
  const branchAt = r.nextInt(Math.floor(end / 2)) + Math.floor(end / 4);
  const steep = r.nextInt(6) === 0;
  for (; start < end; start++) {
    const radius = 1.5 + Math.sin((start * Math.PI) / end) * width;
    const vertical = radius * heightScale;
    const cp = Math.cos(pitch);
    x += Math.cos(yaw) * cp;
    y += Math.sin(pitch);
    z += Math.sin(yaw) * cp;
    pitch *= steep ? 0.92 : 0.7;
    pitch += dPitch * 0.1;
    yaw += dYaw * 0.1;
    dPitch *= 0.9;
    dYaw *= 0.75;
    dPitch += (r.nextFloat() - r.nextFloat()) * r.nextFloat() * 2;
    dYaw += (r.nextFloat() - r.nextFloat()) * r.nextFloat() * 4;
    if (!room && start === branchAt && width > 1 && end > 0) {
      tunnel(
        t,
        r.nextSeed(),
        x,
        y,
        z,
        r.nextFloat() * 0.5 + 0.5,
        yaw - Math.PI / 2,
        pitch / 3,
        start,
        end,
        1,
      );
      tunnel(
        t,
        r.nextSeed(),
        x,
        y,
        z,
        r.nextFloat() * 0.5 + 0.5,
        yaw + Math.PI / 2,
        pitch / 3,
        start,
        end,
        1,
      );
      return;
    }
    if (!room && r.nextInt(4) === 0) continue;
    const ddx = x - cxm,
      ddz = z - czm,
      left = end - start,
      reach = width + 2 + 16;
    if (ddx * ddx + ddz * ddz - left * left > reach * reach) return;
    if (
      x >= cxm - 16 - radius * 2 &&
      z >= czm - 16 - radius * 2 &&
      x <= cxm + 16 + radius * 2 &&
      z <= czm + 16 + radius * 2
    )
      carveEllipsoid(t, x, y, z, radius, vertical);
    if (room) break;
  }
}

/** Every cave system that reaches the target chunk, from the chunks around it. */
export function carveCaves(t: Target, seed: number): void {
  for (let sx = t.cx - RANGE; sx <= t.cx + RANGE; sx++)
    for (let sz = t.cz - RANGE; sz <= t.cz + RANGE; sz++) {
      const r = Rng.of(seed, 0xca7e, sx, sz);
      let systems = r.nextInt(r.nextInt(r.nextInt(15) + 1) + 1);
      if (r.nextInt(7) !== 0) systems = 0;
      for (let n = 0; n < systems; n++) {
        const x = sx * 16 + r.nextInt(16),
          y = r.nextInt(r.nextInt(120) + 8),
          z = sz * 16 + r.nextInt(16);
        let tunnels = 1;
        if (r.nextInt(4) === 0) {
          tunnel(t, r.nextSeed(), x, y, z, 1 + r.nextFloat() * 6, 0, 0, -1, -1, 0.5);
          tunnels += r.nextInt(4);
        }
        for (let k = 0; k < tunnels; k++) {
          const yaw = r.nextFloat() * Math.PI * 2;
          const pitch = ((r.nextFloat() - 0.5) * 2) / 8;
          let width = r.nextFloat() * 2 + r.nextFloat();
          if (r.nextInt(10) === 0) width *= r.nextFloat() * r.nextFloat() * 3 + 1;
          tunnel(t, r.nextSeed(), x, y, z, width, yaw, pitch, 0, 0, 1);
        }
      }
    }
}

function ravine(
  t: Target,
  seed: number,
  x: number,
  y: number,
  z: number,
  width: number,
  yaw: number,
  pitch: number,
  heightScale: number,
): void {
  const r = new Rng(seed);
  const cxm = t.cx * 16 + 8,
    czm = t.cz * 16 + 8;
  let dYaw = 0,
    dPitch = 0;
  const span = RANGE * 16 - 16;
  const end = span - r.nextInt(Math.floor(span / 4));
  const walls = new Float32Array(256);
  let f = 1;
  for (let i = 0; i < 256; i++) {
    if (i === 0 || r.nextInt(3) === 0) f = 1 + r.nextFloat() * r.nextFloat();
    walls[i] = f * f;
  }
  for (let step = 0; step < end; step++) {
    let radius = 1.5 + Math.sin((step * Math.PI) / end) * width;
    let vertical = radius * heightScale;
    radius *= r.nextFloat() * 0.25 + 0.75;
    vertical *= r.nextFloat() * 0.25 + 0.75;
    const cp = Math.cos(pitch);
    x += Math.cos(yaw) * cp;
    y += Math.sin(pitch);
    z += Math.sin(yaw) * cp;
    pitch *= 0.7;
    pitch += dPitch * 0.05;
    yaw += dYaw * 0.05;
    dPitch *= 0.8;
    dYaw *= 0.5;
    dPitch += (r.nextFloat() - r.nextFloat()) * r.nextFloat() * 2;
    dYaw += (r.nextFloat() - r.nextFloat()) * r.nextFloat() * 4;
    if (r.nextInt(4) === 0) continue;
    const ddx = x - cxm,
      ddz = z - czm,
      left = end - step,
      reach = width + 2 + 16;
    if (ddx * ddx + ddz * ddz - left * left > reach * reach) return;
    if (
      x >= cxm - 16 - radius * 2 &&
      z >= czm - 16 - radius * 2 &&
      x <= cxm + 16 + radius * 2 &&
      z <= czm + 16 + radius * 2
    )
      carveEllipsoid(t, x, y, z, radius, vertical, walls);
  }
}

/** Ravines: one chunk in fifty starts a long, narrow, very deep cut. */
export function carveRavines(t: Target, seed: number): void {
  for (let sx = t.cx - RANGE; sx <= t.cx + RANGE; sx++)
    for (let sz = t.cz - RANGE; sz <= t.cz + RANGE; sz++) {
      const r = Rng.of(seed, 0x4a71, sx, sz);
      if (r.nextInt(50) !== 0) continue;
      const x = sx * 16 + r.nextInt(16),
        y = r.nextInt(r.nextInt(40) + 8) + 20,
        z = sz * 16 + r.nextInt(16);
      const yaw = r.nextFloat() * Math.PI * 2;
      const pitch = ((r.nextFloat() - 0.5) * 2) / 8;
      const width = (r.nextFloat() * 2 + r.nextFloat()) * 2;
      ravine(t, r.nextSeed(), x, y, z, width, yaw, pitch, 3);
    }
}
