import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EntityModels } from '../../packages/renderer/src/entity-models';

/** Mob pass 2: poses point the right way and the state flags change what is drawn. */
function world(o: THREE.Object3D, x: number, y: number, z: number) {
  o.updateWorldMatrix(true, false);
  return new THREE.Vector3(x, y, z).applyMatrix4(o.matrixWorld);
}
describe('mob pass 2 · models and poses', () => {
  const pool = new EntityModels();
  it.each(['lab:zombie', 'lab:skeleton', 'lab:wither_skeleton'])(
    'holds the arms of an angry %s out in front, on the side of the face',
    (kind) => {
      const g = pool.mob(kind);
      g.userData.aggressive = true;
      pool.animate(g, 1, 0, true, 0.05);
      const s = kind === 'lab:wither_skeleton' ? 1.2 / 16 : 1 / 16;
      const face = world(g.getObjectByName('head')!, 0, 4 * s, -4 * s);
      for (const arm of ['arm-1', 'arm--1']) {
        const hand = world(g.getObjectByName(arm)!, 0, -10 * s, 0);
        expect(hand.z).toBeLessThan(face.z);
      }
    },
  );
  it('lets a calm skeleton hang its arms down', () => {
    const g = pool.mob('lab:skeleton');
    pool.animate(g, 1, 0, true, 0.05);
    const shoulder = world(g.getObjectByName('arm-1')!, 0, 0, 0);
    const hand = world(g.getObjectByName('arm-1')!, 0, -10 / 16, 0);
    expect(shoulder.y - hand.y).toBeGreaterThan(0.55);
  });
  it('shows the bare body of a shorn sheep and colours the wool by variant', () => {
    const white = pool.mob('lab:sheep', 0),
      black = pool.mob('lab:sheep', 1);
    const skin = (g: THREE.Group) =>
      (g.userData.woolParts as THREE.Mesh[]).map((m) => m.userData.skinPart);
    expect(skin(white)).not.toEqual(skin(black));
    white.userData.sheared = true;
    pool.animate(white, 1, 0, true, 0.05);
    expect((white.userData.woolParts as THREE.Object3D[]).every((m) => !m.visible)).toBe(true);
    expect((white.userData.shornParts as THREE.Object3D[]).every((m) => m.visible)).toBe(true);
  });
  it('opens the jaw of an angry enderman and dips the head of a grazing sheep', () => {
    const e = pool.mob('lab:enderman');
    pool.animate(e, 1, 0, true, 0.05);
    const shut = e.getObjectByName('skull')!.position.y;
    e.userData.aggressive = true;
    pool.animate(e, 1, 0, true, 0.05);
    expect(e.getObjectByName('skull')!.position.y).toBeGreaterThan(shut + 0.15);
    const sheep = pool.mob('lab:sheep');
    pool.animate(sheep, 1, 0, true, 0.05);
    const up = sheep.getObjectByName('head')!.position.y;
    sheep.userData.eating = 20;
    pool.animate(sheep, 1, 0, true, 0.05);
    expect(sheep.getObjectByName('head')!.position.y).toBeLessThan(up - 0.3);
  });
  it('swells and flashes a creeper as its fuse burns, and gives babies big heads', () => {
    const c = pool.mob('lab:creeper');
    c.userData.fuse = 5; // a white phase of the flashing
    pool.animate(c, 1, 0, false, 0.05);
    expect(c.scale.x).toBeGreaterThan(1.25);
    expect(c.userData.glow).toBeGreaterThan(0);
    const calf = pool.mob('lab:cow');
    calf.userData.baby = true;
    calf.userData.baseScale = 0.5;
    pool.animate(calf, 1, 0, true, 0.05);
    expect(calf.scale.x).toBe(0.5);
    expect(calf.getObjectByName('head')!.scale.x).toBeGreaterThan(1.3);
  });
});
