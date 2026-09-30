import type { BiomeV5 } from '../biomes-v5';

/** What a structure may know while it is planned: the seed and the unfinished world's shape. */
export interface PlanContext {
  readonly seed: number;
  /** First air above the density terrain; no chunk needs to exist for it. */
  ground(x: number, z: number): number;
  biome(x: number, z: number): BiomeV5;
}
