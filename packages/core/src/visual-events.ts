import { registry } from '../../content/src/blocks';
import type { VoxelWorld } from './world';
import { EYE_HEIGHT } from './player';
import type { Vec3 } from './coordinates';
export type VisualEventKind =
  | 'break'
  | 'place'
  | 'hit'
  | 'death'
  | 'explosion'
  | 'splash'
  | 'land'
  | 'crystal'
  | 'pickup'
  /** An enderman vanished or appeared: a puff of purple motes. */
  | 'teleport'
  /** Nothing to draw, only something to hear: `sound` names it. */
  | 'sound';
export interface VisualEvent {
  id: number;
  tick: number;
  kind: VisualEventKind;
  x: number;
  y: number;
  z: number;
  block?: number;
  strength: number;
  /** Sound cue of a `sound` event, or the creature kind of a `hit`/`death`. */
  sound?: string;
}
/** Transient, bounded, and deliberately absent from persistence and the gameplay RNG. */
export class VisualEvents {
  private sequence = 0;
  private events: VisualEvent[] = [];
  emit(tick: number, kind: VisualEventKind, p: Vec3, block?: number, strength = 1, sound?: string) {
    this.events.push({
      id: ++this.sequence,
      tick,
      kind,
      x: p.x,
      y: p.y,
      z: p.z,
      block,
      strength: Math.max(0.1, Math.min(8, strength)),
      ...(sound ? { sound } : {}),
    });
    if (this.events.length > 64) this.events.splice(0, this.events.length - 64);
  }
  snapshot(tick: number): VisualEvent[] {
    this.events = this.events.filter((e) => tick - e.tick <= 20 && tick >= e.tick);
    return this.events.map((e) => ({ ...e }));
  }
}

/** Match the visual water surface (0.88 high only at its top), not just a fluid at the feet. */
export function cameraMedium(world: VoxelWorld, p: Vec3, crouch = false): 'air' | 'water' | 'lava' {
  const eye = p.y + (crouch ? 1.47 : EYE_HEIGHT),
    x = Math.floor(p.x),
    y = Math.floor(eye),
    z = Math.floor(p.z);
  const fluid = registry.get(world.getBlock(x, y, z)).fluid;
  if (
    fluid === 'water' &&
    eye - y >= 0.88 &&
    registry.get(world.getBlock(x, y + 1, z)).fluid !== 'water'
  )
    return 'air';
  return fluid ?? 'air';
}
