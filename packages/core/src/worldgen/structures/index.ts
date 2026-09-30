/**
 * Where the v5 structures go and how a chunk gets its share of them.
 *
 * Villages, temples and mineshafts use the reference's region grid: one candidate position per
 * region, kept a few chunks away from the region's far edges so two neighbours never crowd each
 * other. Strongholds sit on fixed rings. A candidate becomes a plan (a list of pieces) the first
 * time any chunk near it is generated; plans are pure functions of the seed and are cached.
 */
import { Rng } from '../rng';
import type { BiomeV5 } from '../biomes-v5';
import { intersects2, type Box, type Canvas, type Piece } from './pieces';
import type { PlanContext } from './context';
import { planVillage, villageStyle } from './villages';
/** Extra spots a village cell tries when the first is in the wrong biome. */
const VILLAGE_RETRIES = 3;
import { planTemple } from './temples';
import { planMineshaft } from './mineshafts';
import { planStronghold, strongholdPositions } from './strongholds';

export type StructureKindV5 = 'village' | 'temple' | 'mineshaft' | 'stronghold';
export interface StructureV5 {
  readonly kind: StructureKindV5;
  /** Where the structure was started: a village's well, a temple's middle and so on. */
  readonly x: number;
  readonly z: number;
  readonly pieces: readonly Piece[];
  /** Horizontal extent of all pieces. */
  readonly bounds: Box;
  /** A label for the interface: the temple kind or the village style. */
  readonly label: string;
}

interface Grid {
  readonly kind: Exclude<StructureKindV5, 'stronghold'>;
  /** Region size and the part of it a candidate may not use, in chunks. */
  readonly spacing: number;
  readonly separation: number;
  readonly salt: number;
  /** How far the structure may reach from its start, in chunks. */
  readonly reach: number;
  readonly chance: number;
}
const GRIDS: readonly Grid[] = [
  { kind: 'village', spacing: 20, separation: 6, salt: 0x71a6, reach: 8, chance: 1 },
  { kind: 'temple', spacing: 20, separation: 6, salt: 0x7e3b, reach: 2, chance: 1 },
  { kind: 'mineshaft', spacing: 14, separation: 4, salt: 0x3a1f, reach: 7, chance: 0.6 },
];
const STRONGHOLD_REACH = 9;

function boundsOf(pieces: readonly Piece[]): Box {
  let x0 = Infinity,
    z0 = Infinity,
    x1 = -Infinity,
    z1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (const p of pieces) {
    x0 = Math.min(x0, p.box.x0);
    z0 = Math.min(z0, p.box.z0);
    y0 = Math.min(y0, p.box.y0);
    x1 = Math.max(x1, p.box.x1);
    z1 = Math.max(z1, p.box.z1);
    y1 = Math.max(y1, p.box.y1);
  }
  return { x0, y0, z0, x1, y1, z1 };
}

export class StructuresV5 {
  private readonly plans = new Map<string, StructureV5 | null>();
  private readonly strongholds: readonly { x: number; z: number }[];
  constructor(readonly ctx: PlanContext) {
    this.strongholds = strongholdPositions(ctx.seed);
  }
  /** Stronghold centres, for the eye of ender. */
  strongholdCentres(): readonly { x: number; z: number }[] {
    return this.strongholds;
  }
  private plan(key: string, make: () => StructureV5 | undefined): StructureV5 | undefined {
    if (this.plans.has(key)) return this.plans.get(key) ?? undefined;
    if (this.plans.size > 4000) this.plans.clear();
    const made = make() ?? null;
    this.plans.set(key, made);
    return made ?? undefined;
  }
  /** The candidate chunk of a region, or undefined when this region has none. */
  private candidate(g: Grid, rx: number, rz: number): { cx: number; cz: number } | undefined {
    const r = Rng.of(this.ctx.seed, g.salt, rx, rz);
    const span = g.spacing - g.separation;
    const cx = rx * g.spacing + r.nextInt(span),
      cz = rz * g.spacing + r.nextInt(span);
    if (g.chance < 1 && r.nextFloat() >= g.chance) return undefined;
    // A village whose spot is in a river, an ocean or a forest tries three more spots of its
    // cell before giving up (a first spot that works keeps its place, so villages that were
    // already there stay). This roughly doubles the villages of the reference, which were so
    // rare that players walked for thousands of blocks without meeting one.
    if (g.kind === 'village' && !this.villageSpot(cx, cz))
      for (let k = 1; k <= VILLAGE_RETRIES; k++) {
        const t = Rng.of(this.ctx.seed, g.salt + 7 + k, rx, rz);
        const ax = rx * g.spacing + t.nextInt(span),
          az = rz * g.spacing + t.nextInt(span);
        if (this.villageSpot(ax, az)) return { cx: ax, cz: az };
      }
    return { cx, cz };
  }
  private villageSpot(cx: number, cz: number): boolean {
    return villageStyle(this.ctx.biome(cx * 16 + 8, cz * 16 + 8).key) !== undefined;
  }
  private build(g: Grid, cx: number, cz: number): StructureV5 | undefined {
    const x = cx * 16 + 8,
      z = cz * 16 + 8;
    const r = Rng.of(this.ctx.seed, g.salt + 1, cx, cz);
    const pieces =
      g.kind === 'village'
        ? planVillage(this.ctx, x, z, r)?.pieces
        : g.kind === 'temple'
          ? planTemple(this.ctx, x, z, r)?.pieces
          : planMineshaft(this.ctx, x, z, r)?.pieces;
    if (!pieces?.length) return undefined;
    const label =
      g.kind === 'village'
        ? `village:${this.ctx.biome(x, z).key}`
        : g.kind === 'temple'
          ? (planTempleKind(this.ctx.biome(x, z)) ?? 'temple')
          : 'mineshaft';
    return { kind: g.kind, x, z, pieces, bounds: boundsOf(pieces), label };
  }
  /** Every structure that may reach into the chunks from `cx0..cx1`, `cz0..cz1`. */
  near(
    cx0: number,
    cz0: number,
    cx1: number,
    cz1: number,
    kinds?: readonly StructureKindV5[],
  ): StructureV5[] {
    const out: StructureV5[] = [];
    for (const g of GRIDS) {
      if (kinds && !kinds.includes(g.kind)) continue;
      const rx0 = Math.floor((cx0 - g.reach - g.spacing) / g.spacing),
        rx1 = Math.floor((cx1 + g.reach) / g.spacing),
        rz0 = Math.floor((cz0 - g.reach - g.spacing) / g.spacing),
        rz1 = Math.floor((cz1 + g.reach) / g.spacing);
      for (let rx = rx0; rx <= rx1; rx++)
        for (let rz = rz0; rz <= rz1; rz++) {
          const c = this.candidate(g, rx, rz);
          if (!c) continue;
          if (
            c.cx < cx0 - g.reach ||
            c.cx > cx1 + g.reach ||
            c.cz < cz0 - g.reach ||
            c.cz > cz1 + g.reach
          )
            continue;
          const s = this.plan(`${g.kind}:${c.cx},${c.cz}`, () => this.build(g, c.cx, c.cz));
          if (s) out.push(s);
        }
    }
    for (const p of kinds && !kinds.includes('stronghold') ? [] : this.strongholds) {
      const scx = Math.floor(p.x / 16),
        scz = Math.floor(p.z / 16);
      if (scx < cx0 - STRONGHOLD_REACH || scx > cx1 + STRONGHOLD_REACH) continue;
      if (scz < cz0 - STRONGHOLD_REACH || scz > cz1 + STRONGHOLD_REACH) continue;
      const s = this.plan(`stronghold:${p.x},${p.z}`, () => {
        const hold = planStronghold(this.ctx, p.x, p.z, this.ctx.seed);
        return {
          kind: 'stronghold',
          x: p.x,
          z: p.z,
          pieces: hold.pieces,
          bounds: boundsOf(hold.pieces),
          label: 'stronghold',
        };
      });
      if (s) out.push(s);
    }
    return out;
  }
  /**
   * The ground surface structures claim around a chunk (villages and temples), as horizontal
   * boxes; decoration keeps trees and plants off it.
   */
  claims(cx: number, cz: number): Box[] {
    const area: Box = {
      x0: cx * 16 - 32,
      y0: 0,
      z0: cz * 16 - 32,
      x1: cx * 16 + 48,
      y1: 255,
      z1: cz * 16 + 48,
    };
    const out: Box[] = [];
    for (const s of this.near(cx - 2, cz - 2, cx + 3, cz + 3, ['village', 'temple'])) {
      if (s.kind !== 'village' && s.kind !== 'temple') continue;
      if (!intersects2(s.bounds, area, 2)) continue;
      for (const p of s.pieces) if (intersects2(p.box, area, 2)) out.push(p.box);
    }
    return out;
  }
  /** Draws every piece that reaches into the canvas's chunk, underground ones first. */
  draw(c: Canvas): void {
    const list = this.near(c.cx, c.cz, c.cx, c.cz);
    const order: StructureKindV5[] = ['mineshaft', 'stronghold', 'temple', 'village'];
    const chunk: Box = {
      x0: c.cx * 16,
      y0: 0,
      z0: c.cz * 16,
      x1: c.cx * 16 + 15,
      y1: 255,
      z1: c.cz * 16 + 15,
    };
    for (const kind of order)
      for (const s of list) {
        if (s.kind !== kind || !intersects2(s.bounds, chunk)) continue;
        s.pieces.forEach((p, i) => {
          if (intersects2(p.box, chunk)) p.draw(c, this.ctx.seed, 0x5700 + i);
        });
      }
  }
}
function planTempleKind(b: BiomeV5): string | undefined {
  if (b.key === 'desert' || b.key === 'desert_hills') return 'desert_pyramid';
  if (b.key === 'jungle' || b.key === 'jungle_hills') return 'jungle_temple';
  if (b.key === 'swamp') return 'witch_hut';
  if (b.key === 'ice_plains' || b.key === 'cold_taiga') return 'igloo';
  return undefined;
}
