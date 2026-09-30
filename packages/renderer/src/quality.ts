export type QualityPreset = 'economy' | 'laptop' | 'high';
export interface QualitySettings {
  preset: QualityPreset;
  adaptive: boolean;
  fpsLimit: 30 | 60 | 120;
  scale: number;
  particles: boolean;
  clouds: boolean;
  /** Cheap per-pixel touches in the terrain programs (no extra passes). */
  shaders: boolean;
  /** The finished frame: glow, vignette, colour grade, water and pain effects (see postfx.ts). */
  post: boolean;
  /** Far terrain reach in blocks beyond the chunks; 0 turns it off. */
  far: FarReach;
}
export type FarReach = 0 | 256 | 512 | 1024 | 2048;
export const FAR_REACHES: readonly FarReach[] = [0, 256, 512, 1024, 2048];
export const DEFAULT_QUALITY: QualitySettings = {
  preset: 'laptop',
  adaptive: true,
  fpsLimit: 60,
  scale: 1,
  particles: true,
  clouds: true,
  shaders: true,
  post: true,
  far: 1024,
};
export const QUALITY = {
  economy: {
    dpr: 1,
    minScale: 0.65,
    particles: 64,
    stars: 160,
    /** Cloud grid: cells per side (12 blocks each). */
    clouds: 48,
    visibleDrops: 80,
    uploadMs: 2,
  },
  laptop: {
    dpr: 1.25,
    minScale: 0.7,
    particles: 160,
    stars: 480,
    clouds: 72,
    visibleDrops: 160,
    uploadMs: 3,
  },
  high: {
    dpr: 1.75,
    minScale: 0.75,
    particles: 320,
    stars: 900,
    clouds: 110,
    visibleDrops: 320,
    uploadMs: 4,
  },
} as const;
export function sanitizeQuality(value: Partial<QualitySettings> = {}): QualitySettings {
  return {
    preset: value.preset && Object.hasOwn(QUALITY, value.preset) ? value.preset : 'laptop',
    adaptive: value.adaptive !== false,
    fpsLimit: [30, 60, 120].includes(value.fpsLimit ?? 0) ? value.fpsLimit! : 60,
    scale: Math.max(0.6, Math.min(1, Number.isFinite(value.scale) ? value.scale! : 1)),
    particles: value.particles !== false,
    clouds: value.clouds !== false,
    shaders: value.shaders !== false,
    post: value.post !== false,
    far: FAR_REACHES.includes(value.far as FarReach) ? value.far! : DEFAULT_QUALITY.far,
  };
}
/** Bounded rolling diagnostics: no per-frame sorting or growing performance log. */
export class FrameStats {
  private frame = new Float32Array(240);
  private cpu = new Float32Array(240);
  private offset = 0;
  count = 0;
  add(frameMs: number, cpuMs: number) {
    if (!Number.isFinite(frameMs) || !Number.isFinite(cpuMs) || frameMs <= 0 || frameMs > 10000)
      return;
    this.frame[this.offset] = frameMs;
    this.cpu[this.offset] = cpuMs;
    this.offset = (this.offset + 1) % this.frame.length;
    this.count = Math.min(this.count + 1, this.frame.length);
  }
  reset() {
    this.offset = 0;
    this.count = 0;
  }
  snapshot() {
    const f = [...this.frame.slice(0, this.count)].sort((a, b) => a - b),
      c = [...this.cpu.slice(0, this.count)].sort((a, b) => a - b);
    const pct = (a: number[], p: number) =>
      Math.round((a[Math.min(a.length - 1, Math.floor(a.length * p))] ?? 0) * 10) / 10;
    return { samples: this.count, p50: pct(f, 0.5), p95: pct(f, 0.95), cpuP95: pct(c, 0.95) };
  }
}
/** Slow hysteresis: at most one resolution change per 3 seconds, 8 seconds to recover.
 * Measurements taken in menus/loading/hidden tabs must never enter this controller. */
export class AdaptiveResolution {
  scale = 1;
  private slow = 0;
  private fast = 0;
  private sinceChange = 0;
  reset() {
    this.scale = 1;
    this.slow = this.fast = this.sinceChange = 0;
  }
  sample(dt: number, frameMs: number, cpuMs: number, settings: QualitySettings): boolean {
    if (!settings.adaptive) return false;
    const budget = 1000 / settings.fpsLimit,
      elapsed = Math.min(Math.max(dt, 0), 0.5);
    this.sinceChange += elapsed;
    const overloaded = frameMs > budget * 1.3 || cpuMs > budget * 0.9;
    this.slow = overloaded ? this.slow + elapsed : Math.max(0, this.slow - elapsed * 2);
    this.fast =
      !overloaded && frameMs < budget * 1.08 && cpuMs < budget * 0.6 ? this.fast + elapsed : 0;
    const previous = this.scale;
    if (this.sinceChange >= 3 && this.slow >= 1.2)
      this.scale = Math.max(
        QUALITY[settings.preset].minScale,
        this.scale - (frameMs > budget * 3 ? 0.15 : 0.1),
      );
    else if (this.sinceChange >= 8 && this.fast >= 6) this.scale = Math.min(1, this.scale + 0.05);
    this.scale = Math.round(this.scale * 100) / 100;
    if (previous !== this.scale) {
      this.sinceChange = this.slow = this.fast = 0;
      return true;
    }
    return false;
  }
}
export function renderInterval(playing: boolean, hidden: boolean, fpsLimit: number) {
  return hidden ? 1000 : playing ? 1000 / fpsLimit : 1000 / 12;
}
