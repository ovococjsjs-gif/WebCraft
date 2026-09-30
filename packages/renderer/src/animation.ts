/** Presentation-only clocks. Never feed interpolated values back into the simulation. */
export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
export const damp = (from: number, to: number, dt: number, speed = 14) =>
  from + (to - from) * (1 - Math.exp(-Math.max(0, dt) * speed));
export function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw?: number;
  pitch?: number;
}
/** One-snapshot delay, no unbounded extrapolation. Teleports and new IDs snap immediately. */
export class PoseTrack {
  readonly from: Required<Pose>;
  readonly to: Required<Pose>;
  readonly value: Required<Pose>;
  elapsed = 0.05;
  duration = 0.05;
  speed = 0;
  distance = 0;
  walked = 0;
  private tick: number;
  constructor(p: Pose, tick = 0) {
    this.from = { x: p.x, y: p.y, z: p.z, yaw: p.yaw ?? 0, pitch: p.pitch ?? 0 };
    this.to = { ...this.from };
    this.value = { ...this.from };
    this.tick = tick;
  }
  push(p: Pose, tick: number) {
    const next = { x: p.x, y: p.y, z: p.z, yaw: p.yaw ?? 0, pitch: p.pitch ?? 0 };
    const distance = Math.hypot(next.x - this.to.x, next.z - this.to.z);
    const teleport = distance > 8 || Math.abs(next.y - this.to.y) > 8 || tick < this.tick;
    if (
      tick === this.tick &&
      !teleport &&
      Object.keys(next).every((k) => next[k as keyof Pose] === this.to[k as keyof Pose])
    )
      return;
    this.duration = Math.max(0.025, Math.min(0.15, (tick - this.tick) / 20 || 0.05));
    this.speed = teleport ? 0 : Math.min(20, distance / this.duration);
    this.distance += teleport ? 0 : distance;
    Object.assign(this.from, teleport ? next : this.value);
    Object.assign(this.to, next);
    if (teleport) Object.assign(this.value, next);
    this.tick = tick;
    this.elapsed = teleport ? this.duration : 0;
  }
  snap() {
    this.walked += Math.hypot(this.to.x - this.value.x, this.to.z - this.value.z);
    Object.assign(this.value, this.to);
    this.elapsed = this.duration;
  }
  advance(dt: number) {
    this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, dt));
    const a = clamp01(this.elapsed / this.duration),
      f = this.from,
      t = this.to,
      v = this.value;
    const oldX = v.x,
      oldZ = v.z;
    v.x = f.x + (t.x - f.x) * a;
    v.y = f.y + (t.y - f.y) * a;
    v.z = f.z + (t.z - f.z) * a;
    this.walked += Math.hypot(v.x - oldX, v.z - oldZ);
    v.yaw = f.yaw + angleDelta(f.yaw, t.yaw) * a;
    v.pitch = f.pitch + angleDelta(f.pitch, t.pitch) * a;
    if (a === 1) this.speed = damp(this.speed, 0, dt, 5);
    return v;
  }
}
/** Authoritative sky phase, smoothly interpolated by at most one 20 TPS interval. */
export class PresentationClock {
  tick = 0;
  time = 6000;
  elapsed = 0;
  paused = true;
  phase = 300;
  sync(tick: number, time: number, _dimension: string) {
    if (tick !== this.tick) this.elapsed = 0;
    this.tick = tick;
    this.time = time;
    this.phase = tick / 20 + this.elapsed;
  }
  advance(dt: number) {
    if (!this.paused) this.elapsed = Math.min(0.05, this.elapsed + Math.max(0, dt));
    this.phase = this.tick / 20 + this.elapsed;
    return (((this.time + this.elapsed * 20) % 24000) + 24000) % 24000;
  }
  reset() {
    this.elapsed = 0;
    this.phase = 0;
  }
}
export interface HeldPose {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}
export function heldPose(options: {
  time: number;
  speed: number;
  swing: number;
  equip: number;
  eating: boolean;
  bow: number;
  blocking: boolean;
  landing: number;
  reduced: boolean;
}): HeldPose {
  const { time, reduced } = options,
    m = reduced ? 0 : 1;
  const strike = Math.sin(clamp01(options.swing) * Math.PI);
  const gait = Math.min(1, options.speed / 4) * m;
  const eating = options.eating ? 1 : 0;
  return {
    x:
      -strike * 0.15 +
      Math.sin(time * 8) * gait * 0.008 -
      options.bow * 0.16 -
      (options.blocking ? 0.27 : 0) -
      eating * 0.13,
    y:
      -strike * 0.13 +
      Math.abs(Math.sin(time * 8)) * gait * 0.014 -
      options.equip * 0.28 +
      eating * (0.18 + Math.sin(time * 17) * m * 0.018) +
      (options.blocking ? 0.15 : 0) -
      options.landing * m * 0.08,
    z: -strike * 0.16 + options.bow * 0.11 + eating * 0.12,
    rx: -strike * 0.75 - options.bow * 0.3 - eating * 0.22,
    ry: -strike * 0.45 + (options.blocking ? 0.8 : 0),
    rz: strike * 0.25 + options.bow * 0.12 + (options.blocking ? -0.4 : 0) + eating * 0.23,
  };
}
