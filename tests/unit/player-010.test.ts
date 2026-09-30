import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { VoxelWorld } from '../../packages/core/src/world';
import { generateColumn, spawnPoint } from '../../packages/core/src/terrain';
import { Simulation } from '../../packages/core/src/simulation';
import { EMPTY_INPUT } from '../../packages/core/src/player';
import { EntityModels } from '../../packages/renderer/src/entity-models';
import {
  CameraRoom,
  PlayerAvatar,
  type AvatarFrame,
} from '../../packages/renderer/src/player-avatar';
import {
  BUILTIN_SKINS,
  PLAYER_PARTS,
  detectSlim,
  skinFromImage,
  validSkinImage,
} from '../../packages/renderer/src/player-skins';

function setup() {
  const world = new VoxelWorld('test');
  for (let x = -2; x <= 2; x++)
    for (let z = -2; z <= 2; z++) world.addColumn(generateColumn(x, z, 'test', 'flat'));
  const sim = new Simulation(world, spawnPoint('test', 'flat'));
  sim.gameMode = 'survival';
  for (let i = 0; i < 10; i++) sim.step();
  return sim;
}

describe('latched sprint', () => {
  it('starts on the key, lasts while going forward and stops when forward is released', () => {
    const sim = setup();
    sim.setInput({ ...EMPTY_INPUT, forward: 1, sprint: true });
    sim.step();
    expect(sim.sprinting).toBe(true);
    sim.setInput({ ...EMPTY_INPUT, forward: 1, sprint: false });
    for (let i = 0; i < 5; i++) sim.step();
    expect(sim.sprinting).toBe(true);
    sim.setInput({ ...EMPTY_INPUT, forward: 0 });
    sim.step();
    expect(sim.sprinting).toBe(false);
  });
  it('cannot sprint while hungry or sneaking', () => {
    const sim = setup();
    sim.survival.food = 6;
    sim.setInput({ ...EMPTY_INPUT, forward: 1, sprint: true });
    sim.step();
    expect(sim.sprinting).toBe(false);
    sim.survival.food = 20;
    sim.setInput({ ...EMPTY_INPUT, forward: 1, sprint: true, crouch: true });
    sim.step();
    expect(sim.sprinting).toBe(false);
  });
  it('reports motion and the solid cells around the eye in the snapshot', () => {
    const sim = setup();
    const s = sim.snapshot();
    expect(s.motion).toEqual({ sprinting: false, crouching: false, riding: false });
    const g = s.near;
    const p = s.player.position;
    const bit = (x: number, y: number, z: number) => {
      const n = ((y - g.y) * g.size + (z - g.z)) * g.size + (x - g.x);
      return (g.bits[n >> 3] >> (n & 7)) & 1;
    };
    const fx = Math.floor(p.x),
      fy = Math.floor(p.y),
      fz = Math.floor(p.z);
    expect(bit(fx, fy - 1, fz)).toBe(1);
    expect(bit(fx, fy + 1, fz)).toBe(0);
  });
});

describe('third-person camera room', () => {
  it('stops the camera short of a wall and runs free in the open', () => {
    const size = 11;
    const bits = new Uint8Array(Math.ceil(size ** 3 / 8));
    const set = (i: number, j: number, k: number) => {
      const n = (j * size + k) * size + i;
      bits[n >> 3] |= 1 << (n & 7);
    };
    // A wall across z = 2 in world space (grid origin −5).
    for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) set(i, j, 7);
    const room = new CameraRoom();
    room.set({ x: -5, y: -5, z: -5, size, bits });
    const eye = new THREE.Vector3(0.5, 0.5, 0.5);
    const toWall = room.distance(eye, new THREE.Vector3(0, 0, 1), 4);
    expect(toWall).toBeGreaterThan(0.8);
    expect(toWall).toBeLessThan(1.5);
    // In the open the camera goes the full distance less its small clearance.
    expect(room.distance(eye, new THREE.Vector3(0, 0, -1), 4)).toBeGreaterThan(3.8);
  });
});

describe('player skins', () => {
  it('reads Minecraft-layout PNGs and detects slim arms', () => {
    const img = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4).fill(255) };
    expect(validSkinImage(img)).toBe(true);
    expect(validSkinImage({ ...img, height: 48 })).toBe(false);
    expect(detectSlim(img)).toBe(false);
    img.data[(20 * 64 + 54) * 4 + 3] = 0;
    expect(detectSlim(img)).toBe(true);
    const skin = skinFromImage(img);
    expect(skin.slim).toBe(true);
    for (const part of PLAYER_PARTS) expect(typeof skin.paint[part]).toBe('function');
    for (const s of BUILTIN_SKINS) expect(s.arm.skin).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('player avatar', () => {
  const frame = (over: Partial<AvatarFrame> = {}): AvatarFrame => ({
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    onGround: true,
    flying: false,
    crouching: false,
    sprinting: false,
    riding: false,
    using: null,
    held: null,
    offhand: null,
    armor: [null, null, null, null],
    mining: false,
    dead: false,
    ...over,
  });
  it('poses sneaking, bow aiming and armour at once under reduced motion', () => {
    const models = new EntityModels(new THREE.Texture());
    const avatar = new PlayerAvatar(models, new THREE.Texture(), () => null, 0);
    const g = avatar.update(frame({ crouching: true }), 0.05, 1, true);
    // The reference's 0.5 rad lean; our front is −z, so leaning forward is a negative x turn.
    expect(g.getObjectByName('body')!.rotation.x).toBeCloseTo(-0.5, 5);
    avatar.update(
      frame({ using: 'bow', armor: ['lab:iron_helmet', null, null, null] }),
      0.05,
      2,
      true,
    );
    // Both arms held out forward at eye height.
    for (const side of ['arm-1', 'arm--1'])
      expect(Math.abs(g.getObjectByName(side)!.rotation.x)).toBeGreaterThan(1.2);
    const shown = new Set<string>();
    g.traverse((o) => {
      const a = o.userData.armor as { slot: number; material: string } | undefined;
      if (a && o.visible) shown.add(`${a.slot}/${a.material}`);
    });
    expect([...shown]).toEqual(['0/iron']);
    avatar.dispose();
  });
});

describe('compass', () => {
  it('maps world directions onto the strip: north ahead, west to the left, behind hidden', async () => {
    const { bearing, stripOffset } = await import('../../apps/browser/src/navigation');
    // Yaw 0 looks along −z, which is north.
    expect(bearing(0, -1)).toBeCloseTo(0, 6);
    expect(stripOffset(bearing(0, -1), 0)).toBeCloseTo(0, 6);
    // West (−x) is a positive yaw and appears on the left half.
    expect(stripOffset(bearing(-1, 0), 0)!).toBeCloseTo(-1, 6);
    expect(stripOffset(bearing(-1, -1), 0)!).toBeLessThan(0);
    expect(stripOffset(bearing(1, -1), 0)!).toBeGreaterThan(0);
    expect(stripOffset(bearing(0, 1), 0)).toBeNull();
    // Across the ±π seam.
    expect(stripOffset(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2 / (Math.PI / 2), 6);
  });
});

describe('first-person arm', () => {
  it('stays on screen, in front of the camera, through a whole bare-hand swing', async () => {
    const { HeldView } = await import('../../packages/renderer/src/held-view');
    const camera = new THREE.PerspectiveCamera(72, 16 / 10, 0.05, 100);
    const held = new HeldView(camera, { texture: new THREE.Texture(), canvas: null as never });
    held.setItem(null);
    held.snapshot({
      inventory: [],
      selected: 0,
      use: {},
      survival: { dead: false },
      player: { velocity: { x: 0, y: 0, z: 0 } },
    } as never);
    held.punch();
    const fist = new THREE.Vector3();
    for (let step = 0; step < 12; step++) {
      held.animate(1 / 40, step / 40, true, false);
      camera.updateMatrixWorld(true);
      // The hand end of the arm box: 12 pixels down the limb from the shoulder.
      fist.set(0, -12 * 0.0625, 0);
      held.armBox.localToWorld(fist);
      const inView = fist.clone().applyMatrix4(camera.matrixWorldInverse);
      expect(inView.z, `step ${step}`).toBeLessThan(-0.3);
      const ndc = fist.clone().project(camera);
      expect(Math.abs(ndc.x), `step ${step}`).toBeLessThan(1);
      expect(Math.abs(ndc.y), `step ${step}`).toBeLessThan(1);
    }
  });
});

describe('first-person arm placement', () => {
  it('rests in the lower right corner, clear of the crosshair, at any window shape', async () => {
    const { HeldView, HAND_FOV } = await import('../../packages/renderer/src/held-view');
    for (const aspect of [4 / 3, 16 / 10, 16 / 9, 21 / 9, 0.6]) {
      const camera = new THREE.PerspectiveCamera(HAND_FOV, aspect, 0.05, 100);
      const held = new HeldView(camera, { texture: new THREE.Texture(), canvas: null as never });
      held.aspect = aspect;
      held.setItem(null);
      held.snapshot({
        inventory: [],
        selected: 0,
        use: {},
        survival: { dead: false },
        player: { velocity: { x: 0, y: 0, z: 0 } },
      } as never);
      held.animate(1 / 60, 0, true, true);
      camera.updateMatrixWorld(true);
      const fist = held.armBox.localToWorld(new THREE.Vector3(0, -12 * 0.0625, 0)).project(camera);
      const shoulder = held.armBox.localToWorld(new THREE.Vector3(0, 0, 0)).project(camera);
      const label = `aspect ${aspect.toFixed(2)}`;
      expect(fist.x, label).toBeGreaterThan(0.3);
      expect(fist.x, label).toBeLessThan(0.75);
      expect(fist.y, label).toBeLessThan(-0.3);
      expect(fist.y, label).toBeGreaterThan(-0.85);
      // The shoulder is off screen: the arm reaches in from the corner.
      expect(shoulder.x > 1 || shoulder.y < -1, label).toBe(true);
    }
  });
});

describe('held items', () => {
  it('sit in the fist and swing with the arm, staying in view', async () => {
    const { HeldView } = await import('../../packages/renderer/src/held-view');
    const camera = new THREE.PerspectiveCamera(72, 16 / 10, 0.05, 100);
    const held = new HeldView(camera, { texture: new THREE.Texture(), canvas: null as never });
    held.setItem('lab:cobblestone');
    held.snapshot({
      inventory: [],
      selected: 0,
      use: {},
      survival: { dead: false },
      player: { velocity: { x: 0, y: 0, z: 0 } },
    } as never);
    const item = held.heldObject!;
    expect(item).not.toBeNull();
    // Hung from the grip inside the fist, not from the view root.
    let parent = item.parent;
    while (parent && parent !== held.armBox) parent = parent.parent;
    expect(parent).toBe(held.armBox);
    held.animate(1 / 60, 0, true, false);
    camera.updateMatrixWorld(true);
    const at = (o: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    const rest = at(item);
    expect(rest.distanceTo(at(held.gripPoint))).toBeLessThan(0.2);
    held.punch();
    let moved = 0;
    for (let step = 0; step < 12; step++) {
      held.animate(1 / 40, step / 40, true, false);
      camera.updateMatrixWorld(true);
      const p = at(item);
      moved = Math.max(moved, p.distanceTo(rest));
      // Still hand-held: the item keeps its place in the fist through the swing.
      expect(p.distanceTo(at(held.gripPoint)), `step ${step}`).toBeLessThan(0.2);
      const ndc = p.clone().project(camera);
      expect(Math.abs(ndc.x), `step ${step}`).toBeLessThan(1);
      expect(Math.abs(ndc.y), `step ${step}`).toBeLessThan(1);
    }
    expect(moved).toBeGreaterThan(0.03);
  });
});
