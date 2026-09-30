import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  PoseTrack,
  PresentationClock,
  angleDelta,
  heldPose,
} from '../../packages/renderer/src/animation';
import { environmentAt } from '../../packages/renderer/src/environment';
import {
  AdaptiveResolution,
  DEFAULT_QUALITY,
  FrameStats,
  QUALITY,
  renderInterval,
  sanitizeQuality,
} from '../../packages/renderer/src/quality';
import { ColumnMeshCache, meshBytes, packLayer } from '../../packages/renderer/src/mesh-batches';
import {
  meshSection,
  meshTransfers,
  ATLAS_COLS,
  ATLAS_ROWS,
  ITEM_TILE_BASE,
  ITEM_TILE_BASE_2,
  type MeshLayer,
  type SectionMesh,
} from '../../packages/renderer/src/mesher';
import {
  terrainPixels,
  animatedPixels,
  crackPixels,
  ANIMATED_TILE_BASE,
} from '../../packages/renderer/src/pixel-art';
import { EntityModels } from '../../packages/renderer/src/entity-models';
import { RigBatches } from '../../packages/renderer/src/instance-batches';
import { VoxelParticles } from '../../packages/renderer/src/particles';
import { VisualEvents, cameraMedium } from '../../packages/core/src/visual-events';
import { WorldSession } from '../../packages/core/src/session';
import { VoxelWorld, ChunkColumn, DAY_TICKS } from '../../packages/core/src/world';
import { MOBS } from '../../packages/core/src/mobs';
import { BLOCK } from '../../packages/content/src/blocks';
import { SPRITE_COUNT } from '../../packages/content/src/items';
import { CONTROL_ACTIONS, ControlScheme, WheelSelector } from '../../packages/ui/src/controls';
function emptyWorld() {
  const w = new VoxelWorld('graphics-009');
  for (let x = -1; x <= 1; x++)
    for (let z = -1; z <= 1; z++) {
      const c = new ChunkColumn(x, z);
      c.status = 'ready';
      w.addColumn(c);
    }
  return w;
}
const pose = (x = 0, y = 0, z = 0, yaw = 0) => ({ x, y, z, yaw });

describe('G01: bounded presentation interpolation', () => {
  it('interpolates the 20 TPS pose instead of snapping at every packet', () => {
    const p = new PoseTrack(pose(), 0);
    p.push(pose(1), 1);
    expect(p.value.x).toBe(0);
    expect(p.advance(0.025).x).toBeCloseTo(0.5);
    expect(p.advance(0.025).x).toBe(1);
  });
  it('uses the shortest rotation across the ±π seam', () => {
    const a = Math.PI - 0.05,
      b = -Math.PI + 0.05;
    expect(angleDelta(a, b)).toBeCloseTo(0.1);
    const p = new PoseTrack(pose(0, 0, 0, a));
    p.push(pose(0, 0, 0, b), 1);
    expect(p.advance(0.025).yaw).toBeCloseTo(Math.PI);
  });
  it('does not restart interpolation on an identical same-tick snapshot', () => {
    const p = new PoseTrack(pose());
    p.push(pose(1), 1);
    p.advance(0.02);
    p.push(pose(1), 1);
    expect(p.elapsed).toBe(0.02);
    expect(p.advance(0.03).x).toBe(1);
  });
  it.each([pose(30), pose(0, 40), pose(0, 0, 30)])(
    'snaps on teleport without a running gait: %j',
    (p) => {
      const track = new PoseTrack(pose());
      track.push(p, 1);
      expect(track.value.x).toBe(p.x);
      expect(track.value.y).toBe(p.y);
      expect(track.speed).toBe(0);
      expect(track.walked).toBe(0);
    },
  );
  it('resets when the simulation tick rewinds', () => {
    const p = new PoseTrack(pose(), 100);
    p.push(pose(3), 0);
    expect(p.value.x).toBe(3);
  });
  it('never extrapolates past an authoritative pose during a stalled Worker', () => {
    const p = new PoseTrack(pose());
    p.push(pose(1), 1);
    expect(p.advance(10).x).toBe(1);
    expect(p.advance(10).x).toBe(1);
  });
  it('counts rendered travel equally at 30 and 120 FPS', () => {
    const a = new PoseTrack(pose()),
      b = new PoseTrack(pose());
    a.push(pose(1), 1);
    b.push(pose(1), 1);
    a.advance(0.05);
    for (let i = 0; i < 6; i++) b.advance(0.05 / 6);
    expect(a.walked).toBeCloseTo(b.walked, 9);
  });
  it('strips gameplay metadata out of a render pose', () => {
    const p = new PoseTrack({ ...pose(), id: 10, health: 20 } as ReturnType<typeof pose>);
    expect(Object.keys(p.value).sort()).toEqual(['pitch', 'x', 'y', 'yaw', 'z']);
  });
});
describe('G02: one authoritative day/night clock', () => {
  it('retains a 20 minute day', () => expect(DAY_TICKS / 20).toBe(1200));
  it.each([0, 6000, 12000, 18000, 23999, 24000, -1])(
    'all light/visibility values are finite at %s',
    (time) => {
      const e = environmentAt(time);
      expect(e.sky).toBeGreaterThanOrEqual(0);
      expect(e.sky).toBeLessThanOrEqual(1);
      expect(e.stars).toBeGreaterThanOrEqual(0);
      expect(e.stars).toBeLessThanOrEqual(1);
      expect(Number.isFinite(e.angle)).toBe(true);
    },
  );
  it('shows a sun at noon and a moon and stars at midnight', () => {
    expect(environmentAt(6000)).toMatchObject({ sun: true, moon: false, stars: 0 });
    expect(environmentAt(18000)).toMatchObject({ sun: false, moon: true, stars: 1 });
  });
  it('has continuous dawn/dusk rather than a noon/night inversion', () => {
    // Noon is held just under 1 so ACES does not wash the world out; night keeps a moonlit floor.
    expect(environmentAt(6000).sky).toBeCloseTo(0.9);
    expect(environmentAt(18000).sky).toBeCloseTo(0.1);
    expect(environmentAt(0).twilight).toBe(1);
    expect(environmentAt(12000).twilight).toBeCloseTo(1);
    expect(environmentAt(23999).sky).toBeCloseTo(environmentAt(0).sky, 3);
  });
  it.each(['nether', 'end'])('has no celestial day/night in %s', (dimension) => {
    for (const time of [0, 6000, 12000, 18000])
      expect(environmentAt(time, dimension)).toMatchObject({
        sun: false,
        moon: false,
        clouds: false,
        stars: 0,
        sky: 0,
      });
  });
  it('freezes every presentation clock in pause and wraps midnight', () => {
    const c = new PresentationClock();
    c.sync(20, 23999, 'overworld');
    c.paused = false;
    expect(c.advance(0.05)).toBe(0);
    c.paused = true;
    const phase = c.phase;
    for (let i = 0; i < 500; i++) c.advance(0.1);
    expect(c.phase).toBe(phase);
    expect(c.time).toBe(23999);
  });
  it('does not slow animations at 2 FPS or drift into future simulation time', () => {
    const c = new PresentationClock();
    c.paused = false;
    for (let tick = 1; tick <= 240; tick++) {
      c.sync(tick, 6000 + tick, 'overworld');
      if (tick % 10 === 0) c.advance(0.5);
    }
    expect(c.phase).toBeCloseTo(12.05);
    expect(c.advance(60)).toBe(6241);
  });
});
describe('G03: packed attributes and incremental column batches', () => {
  it('halves an isolated block payload without changing light/UV/normal meaning', () => {
    const w = emptyWorld();
    w.setBlock(1, 1, 1, BLOCK.STONE);
    const raw = meshSection(w, 0, 0, 0),
      layer = raw.layers.opaque!,
      packed = packLayer(layer);
    const m = { ...raw, layers: { opaque: packed } };
    expect(meshBytes(m)).toBeLessThan(meshBytes(raw) * 0.6);
    expect(packed.positions).toEqual(layer.positions);
    expect(packed.indices).toEqual(layer.indices);
    for (let i = 0; i < layer.lights.length; i++)
      expect(packed.lights[i] / 255).toBeCloseTo(layer.lights[i], 2);
    for (let i = 0; i < layer.uvs.length; i++)
      expect(Math.abs(packed.uvs[i] / 65535 - layer.uvs[i])).toBeLessThan(1 / 65535);
    for (let i = 0; i < layer.normals.length; i++)
      expect(packed.normals[i] / 127).toBeCloseTo(layer.normals[i], 2);
    expect(meshTransfers(m)).toHaveLength(7);
  });
  it('preserves unchanged sections, y offsets, faces and monotonic upload revisions', () => {
    const w = emptyWorld();
    w.setBlock(1, 1, 1, BLOCK.STONE);
    w.setBlock(2, 18, 2, BLOCK.STONE);
    const cache = new ColumnMeshCache();
    cache.set(meshSection(w, 0, 0, 0));
    cache.set(meshSection(w, 0, 1, 0));
    const first = cache.build('0,0')!;
    expect(first.faces).toBe(12);
    expect(Math.max(...first.layers.opaque!.positions)).toBe(19);
    w.setBlock(1, 1, 1, BLOCK.AIR);
    cache.set(meshSection(w, 0, 0, 0));
    const second = cache.build('0,0')!;
    expect(second.faces).toBe(6);
    expect(second.revision).toBeGreaterThan(first.revision);
    expect(cache.sections).toBe(2);
  });
  it('retains CPU cache when a finished batch is transferred and detached', () => {
    const w = emptyWorld();
    w.setBlock(1, 1, 1, BLOCK.STONE);
    const cache = new ColumnMeshCache();
    cache.set(meshSection(w, 0, 0, 0));
    const m = cache.build('0,0')!;
    structuredClone(m, { transfer: meshTransfers(m) });
    expect(m.layers.opaque!.positions.byteLength).toBe(0);
    const again = cache.build('0,0')!;
    expect(again.layers.opaque!.positions.length).toBe(72);
  });
  it('upgrades indices to 32 bit only when a column needs them', () => {
    const count = 40000,
      l: MeshLayer = {
        positions: new Float32Array(count * 3),
        normals: new Int8Array(count * 3),
        uvs: new Uint16Array(count * 2),
        colors: new Uint8Array(count * 3),
        lights: new Uint8Array(count * 2),
        visuals: new Uint8Array(count * 2),
        indices: Uint16Array.of(0, count - 2, count - 1),
      };
    const c = new ColumnMeshCache();
    const s: SectionMesh = {
      key: '0,0,0',
      cx: 0,
      sy: 0,
      cz: 0,
      revision: 1,
      faces: 1,
      layers: { opaque: l },
    };
    c.set(s);
    expect(c.build('0,0')!.layers.opaque!.indices).toBeInstanceOf(Uint16Array);
    c.set({ ...s, key: '0,1,0', sy: 1 });
    const b = c.build('0,0')!;
    expect(b.layers.opaque!.indices).toBeInstanceOf(Uint32Array);
    expect(Math.max(...b.layers.opaque!.indices)).toBe(79999);
  });
  it('clears all packed allocations on eviction and travel', () => {
    const w = emptyWorld();
    w.setBlock(1, 1, 1, BLOCK.STONE);
    const c = new ColumnMeshCache();
    c.set(meshSection(w, 0, 0, 0));
    expect(c.bytes).toBeGreaterThan(0);
    c.evict(0, 0);
    expect(c.bytes).toBe(0);
    expect(c.dirty.size).toBe(0);
    c.set(meshSection(w, 0, 0, 0));
    c.clear();
    expect(c.sections).toBe(0);
    expect(c.build('0,0')).toBeNull();
  });
  it.each([
    [BLOCK.WATER, 1],
    [BLOCK.WATER_FLOW_1, 1],
    [BLOCK.LAVA, 2],
    [BLOCK.FIRE, 3],
    [BLOCK.NETHER_PORTAL, 4],
    [BLOCK.FLOWER, 5],
    [BLOCK.END_PORTAL, 6],
    [BLOCK.LEAVES, 7],
  ])('sends correct GPU material flags for block %s', (block, kind) => {
    const w = emptyWorld();
    w.setBlock(2, 2, 2, block);
    const layers = Object.values(meshSection(w, 0, 0, 0).layers);
    expect(layers.length).toBeGreaterThan(0);
    expect(layers.every((l) => [...l.visuals].every((v, i) => i % 2 === 1 || v === kind))).toBe(
      true,
    );
  });
  it('keeps source and flowing water surfaces aligned', () => {
    const heights = [];
    for (const block of [BLOCK.WATER, BLOCK.WATER_FLOW_1]) {
      const w = emptyWorld();
      w.setBlock(2, 2, 2, block);
      heights.push(
        Math.max(
          ...[...meshSection(w, 0, 0, 0).layers.transparent!.positions].filter(
            (_, i) => i % 3 === 1,
          ),
        ),
      );
    }
    expect(heights[0]).toBeCloseTo(2.88);
    expect(heights[1]).toBe(heights[0]);
  });
  it('anchors plants and gives all shared leaf vertices the same wind weight', () => {
    const w = emptyWorld();
    w.setBlock(2, 2, 2, BLOCK.LEAVES);
    const v = meshSection(w, 0, 0, 0).layers.cutout!.visuals;
    expect([...v].filter((_, i) => i % 2 === 1).every((n) => n === 48)).toBe(true);
  });
});
describe('G04: original pixel atlases and cracks', () => {
  it('reserves non-overlapping blocks/items/animation cells', () => {
    // Two sprite runs: 96 cells before the animation frames, then the rows from 48 on.
    expect(ITEM_TILE_BASE + 96).toBeLessThanOrEqual(ANIMATED_TILE_BASE);
    expect(ITEM_TILE_BASE_2 + Math.max(0, SPRITE_COUNT - 96)).toBeLessThanOrEqual(
      ATLAS_COLS * ATLAS_ROWS,
    );
    expect(ANIMATED_TILE_BASE + 6 * 4).toBeLessThanOrEqual(ATLAS_COLS * ATLAS_ROWS);
  });
  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12])(
    'generates deterministic opaque/readable base material %s',
    (tile) => {
      const a = terrainPixels(tile)!;
      expect(a.length).toBe(1024);
      expect(a).toEqual(terrainPixels(tile));
      expect([...a].filter((_, i) => i % 4 === 3).some((alpha) => alpha > 128)).toBe(true);
    },
  );
  it.each([1, 2, 3, 4, 6])('has four distinct looping animated frames for material %s', (kind) => {
    const frames = Array.from({ length: 4 }, (_, i) =>
      Buffer.from(animatedPixels(kind, i)).toString('base64'),
    );
    expect(new Set(frames).size).toBe(4);
  });
  it('cracks grow monotonically and retain a mostly transparent surface', () => {
    let before = 0;
    for (let stage = 0; stage < 8; stage++) {
      const n = [...crackPixels(stage)].filter((v, i) => i % 4 === 3 && v > 0).length;
      expect(n).toBeGreaterThanOrEqual(before);
      expect(n).toBeLessThan(130);
      before = n;
    }
    expect(before).toBeGreaterThan(30);
  });
});
describe('G05: rigs, shared materials and bounded effects', () => {
  it.each(MOBS.map((m) => m.kind))(
    'animates a jointed %s and immediately settles reduced-motion poses',
    (kind) => {
      const pool = new EntityModels();
      try {
        const g = pool.mob(kind);
        g.userData.travel = 1;
        pool.animate(g, 2, 4, false, 0.016);
        const posed = g.userData.animatedParts as THREE.Object3D[];
        expect(posed.length).toBeGreaterThan(0);
        pool.animate(g, 4, 4, true, 0.016);
        const rest = posed.map((p) => [
          ...p.position.toArray(),
          p.rotation.x,
          p.rotation.y,
          p.rotation.z,
        ]);
        pool.animate(g, 20, 0, true, 0.2);
        expect(
          posed.map((p) => [...p.position.toArray(), p.rotation.x, p.rotation.y, p.rotation.z]),
        ).toEqual(rest);
        g.traverse((p) => {
          if (p instanceof THREE.Mesh) expect(p.geometry).toBe(pool.geometry);
        });
      } finally {
        pool.dispose();
      }
    },
  );
  it.each(['ender_dragon', 'wither'])(
    'articulates %s while preserving unfogged boss readability',
    (kind) => {
      const pool = new EntityModels();
      try {
        const g = pool.boss(kind);
        pool.animate(g, 1, 0);
        const before = (g.userData.animatedParts as THREE.Object3D[]).map((p) =>
          p.rotation.toArray(),
        );
        pool.animate(g, 2, 0);
        expect(
          (g.userData.animatedParts as THREE.Object3D[]).map((p) => p.rotation.toArray()),
        ).not.toEqual(before);
        g.traverse((p) => {
          if (p instanceof THREE.Mesh)
            expect((p.material as THREE.MeshBasicMaterial).fog).toBe(false);
        });
      } finally {
        pool.dispose();
      }
    },
  );
  it('batches a crowd by material, not by entity or body part', () => {
    const models = new EntityModels(),
      scene = new THREE.Scene(),
      batch = new RigBatches(scene, models.geometry);
    try {
      batch.begin();
      for (let i = 0; i < 20; i++) {
        const g = models.mob('lab:zombie');
        g.position.x = i;
        batch.add(g, i === 0);
      }
      batch.finish();
      // Head, body, two arms, two legs — all textured parts of one shared skin material.
      expect(batch.visibleParts).toBe(120);
      expect(batch.draws).toBe(1);
      batch.reset();
      expect(batch.draws).toBe(0);
    } finally {
      batch.dispose();
      models.dispose();
    }
  });
  it('bounds and expires transient events without touching a checkpoint or dirty stamp', () => {
    const s = new WorldSession('vfx', 'flat'),
      v = s.simulation.visualEvents,
      before = JSON.stringify(s.checkpoint()),
      stamp = s.persistenceStamp();
    for (let i = 0; i < 100; i++) v.emit(s.world.tick, 'hit', pose(i));
    expect(v.snapshot(s.world.tick)).toHaveLength(64);
    expect(JSON.stringify(s.checkpoint())).toBe(before);
    expect(s.persistenceStamp()).toBe(stamp);
    expect(v.snapshot(s.world.tick + 21)).toEqual([]);
  });
  it('bounds particles, consumes an event once, freezes in pause, and clears reduced effects', () => {
    const scene = new THREE.Scene(),
      geometry = new THREE.BoxGeometry(),
      p = new VoxelParticles(scene, geometry, () => new THREE.Color('green'));
    try {
      p.limit = 64;
      const events = new VisualEvents();
      events.emit(1, 'break', pose());
      p.consume(events.snapshot(1), 1, new THREE.Vector3());
      p.advance(0);
      const first = p.active;
      p.consume(events.snapshot(1), 1, new THREE.Vector3());
      p.advance(0);
      expect(p.active).toBe(first);
      const matrix = p.mesh.instanceMatrix.array.slice();
      p.advance(0);
      expect(p.mesh.instanceMatrix.array).toEqual(matrix);
      for (let i = 0; i < 100; i++)
        p.emit({ id: i, tick: 1, kind: 'explosion', x: 0, y: 0, z: 0, strength: 4 });
      p.advance(0);
      expect(p.active).toBe(64);
      p.advance(10);
      expect(p.active).toBe(0);
      p.emit({ id: 100, tick: 1, kind: 'hit', x: 0, y: 0, z: 0, strength: 1 });
      p.enabled = false;
      p.advance(0);
      expect(p.active).toBe(0);
    } finally {
      p.dispose();
      geometry.dispose();
    }
  });
  it('uses distinct held poses for mining, eating, bow, shield, equip and landing', () => {
    const options = {
      time: 1,
      speed: 0,
      swing: 0,
      equip: 0,
      eating: false,
      bow: 0,
      blocking: false,
      landing: 0,
      reduced: false,
    };
    const base = heldPose(options);
    for (const change of [
      { swing: 0.5 },
      { eating: true },
      { bow: 1 },
      { blocking: true },
      { equip: 1 },
      { landing: 1 },
    ])
      expect(heldPose({ ...options, ...change })).not.toEqual(base);
    expect(heldPose({ ...options, time: 12, speed: 5, reduced: true })).toEqual(
      heldPose({ ...options, time: 1, speed: 0, reduced: true }),
    );
  });
});
describe('G06: laptop graphics governor and honest diagnostics', () => {
  it('starts at the laptop profile and rejects corrupt preferences', () => {
    expect(sanitizeQuality()).toEqual(DEFAULT_QUALITY);
    expect(
      sanitizeQuality({ preset: '__proto__', scale: Infinity, fpsLimit: 999 } as never),
    ).toEqual(DEFAULT_QUALITY);
  });
  it('reduces resolution under sustained load but never below the preset floor', () => {
    const a = new AdaptiveResolution();
    for (let i = 0; i < 600; i++) a.sample(0.1, 100, 50, DEFAULT_QUALITY);
    expect(a.scale).toBe(QUALITY.laptop.minScale);
  });
  it('reacts even to a 2 FPS software renderer, but not to one isolated hitch', () => {
    const a = new AdaptiveResolution();
    a.sample(0.5, 500, 300, DEFAULT_QUALITY);
    expect(a.scale).toBe(1);
    for (let i = 0; i < 6; i++) a.sample(0.5, 500, 300, DEFAULT_QUALITY);
    expect(a.scale).toBeLessThan(1);
  });
  it('recovers slowly and does not oscillate on every frame', () => {
    const a = new AdaptiveResolution();
    for (let i = 0; i < 100; i++) a.sample(0.1, 100, 30, DEFAULT_QUALITY);
    const low = a.scale;
    for (let i = 0; i < 59; i++) a.sample(0.1, 16.6, 3, DEFAULT_QUALITY);
    expect(a.scale).toBe(low);
    for (let i = 0; i < 100; i++) a.sample(0.1, 16.6, 3, DEFAULT_QUALITY);
    expect(a.scale).toBeGreaterThan(low);
  });
  it('respects manual resolution and caps menu/hidden rendering separately', () => {
    const a = new AdaptiveResolution();
    for (let i = 0; i < 100; i++) a.sample(0.5, 500, 200, { ...DEFAULT_QUALITY, adaptive: false });
    expect(a.scale).toBe(1);
    expect(renderInterval(false, false, 60)).toBeCloseTo(1000 / 12);
    expect(renderInterval(true, false, 30)).toBeCloseTo(1000 / 30);
    expect(renderInterval(true, true, 120)).toBe(1000);
  });
  it('retains long gameplay frames instead of hiding stutters from p95', () => {
    const s = new FrameStats();
    for (let i = 0; i < 100; i++) s.add(i < 85 ? 16 : 800, i < 85 ? 4 : 600);
    expect(s.snapshot()).toMatchObject({ samples: 100, p50: 16, p95: 800, cpuP95: 600 });
    for (let i = 0; i < 1000; i++) s.add(20, 4);
    expect(s.count).toBe(240);
    s.reset();
    expect(s.snapshot().samples).toBe(0);
  });
});
describe('G07: remapping, toggles and trackpad controls', () => {
  it('keeps the established E/F, WASD/arrows and right modifiers', () => {
    const c = new ControlScheme();
    expect(c.matches('inventory', 'KeyF')).toBe(true);
    expect(c.read(new Set(['ArrowUp', 'ControlRight', 'ShiftRight']))).toMatchObject({
      forward: 1,
      sprint: true,
      crouch: true,
    });
  });
  it('swaps conflicting keys instead of losing an action', () => {
    const c = new ControlScheme();
    expect(c.bind('forward', 'KeyE')).toEqual({ ok: true, swapped: 'inventory' });
    expect(c.matches('forward', 'KeyE')).toBe(true);
    expect(c.matches('inventory', 'KeyW')).toBe(true);
    expect(c.matches('inventory', 'KeyE')).toBe(false);
  });
  it.each(['Escape', 'F3', 'Digit1', 'Tab', 'Unidentified', '<img>'])(
    'reserves/validates the key %s',
    (code) => expect(new ControlScheme().bind('forward', code).ok).toBe(false),
  );
  it('round-trips a remapped scheme without changing the assignments', () => {
    const c = new ControlScheme();
    c.bind('forward', 'KeyZ');
    c.bind('inventory', 'KeyI');
    c.bind('sprint', 'ShiftLeft');
    const saved = JSON.parse(JSON.stringify(c.settings)),
      loaded = new ControlScheme(saved);
    for (const action of Object.keys(CONTROL_ACTIONS) as (keyof typeof CONTROL_ACTIONS)[])
      expect(loaded.codes(action)).toEqual(c.codes(action));
  });
  it('toggles once per press, ignores repeat and clears latches on focus/menu loss', () => {
    const c = new ControlScheme({ toggleSprint: true, toggleCrouch: true });
    c.keyDown('ControlLeft');
    c.keyDown('ControlLeft', true);
    c.keyDown('ShiftRight');
    expect(c.read(new Set())).toMatchObject({ sprint: true, crouch: true });
    c.reset();
    expect(c.read(new Set())).toMatchObject({ sprint: false, crouch: false });
  });
  it('accumulates small trackpad deltas, ignores zero and rate limits wheel bursts', () => {
    const w = new WheelSelector();
    expect(w.step(0, 0, 0)).toBe(0);
    expect(w.step(10, 0, 1)).toBe(0);
    expect(w.step(10, 0, 2)).toBe(0);
    expect(w.step(20, 0, 3)).toBe(1);
    expect(w.step(100, 0, 5)).toBe(0);
    expect(w.step(-100, 0, 100)).toBe(-1);
    w.reset();
    expect(w.step(3, 1, 200)).toBe(1);
  });
});

describe('G08: water surface continuity', () => {
  it('culls invisible source/flow interfaces', () => {
    const w = emptyWorld();
    w.setBlock(2, 2, 2, BLOCK.WATER);
    w.setBlock(3, 2, 2, BLOCK.WATER_FLOW_1);
    expect(meshSection(w, 0, 0, 0).faces).toBe(10);
  });
  it('does not open a 0.12-block seam through a vertical water column', () => {
    const w = emptyWorld();
    w.setBlock(2, 2, 2, BLOCK.WATER);
    w.setBlock(2, 3, 2, BLOCK.WATER_FLOW_1);
    const l = meshSection(w, 0, 0, 0).layers.transparent!;
    const ys = [...l.positions].filter((_, i) => i % 3 === 1);
    expect(ys.some((y) => Math.abs(y - 2.88) < 0.001)).toBe(false);
    expect(ys).toContain(3);
    for (let i = 0; i < l.positions.length / 3; i++)
      if (l.positions[i * 3 + 1] === 3) expect(l.visuals[i * 2 + 1]).toBe(0);
    expect(Math.max(...ys)).toBeCloseTo(3.88);
  });
  it('only applies underwater fog when the eyes really cross the visible surface', () => {
    const w = emptyWorld();
    w.setBlock(2, 2, 2, BLOCK.WATER);
    expect(cameraMedium(w, { x: 2.5, y: 2.95 - 1.62, z: 2.5 })).toBe('air');
    expect(cameraMedium(w, { x: 2.5, y: 2.6 - 1.62, z: 2.5 })).toBe('water');
    w.setBlock(2, 3, 2, BLOCK.WATER);
    expect(cameraMedium(w, { x: 2.5, y: 2.95 - 1.62, z: 2.5 })).toBe('water');
  });
});
