import * as THREE from 'three';
import { MOBS, WOOL_COLORS } from '../../core/src/mobs';
import { MobRigs, PLAYER_VARIANTS } from './mob-models';
import type { PlayerSkin } from './player-skins';
import { SkinAtlas } from './mob-skins';
/** A renderer-owned pool. Every cuboid shares ONE geometry; materials are bounded by catalogue
 * colours, not entity lifetime. Removing an entity never loses an undisposed GPU allocation. */
export class EntityModels {
  readonly geometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly materials = new Map<string, THREE.Material>();
  /** Every creature skin lives in one atlas, drawn by one shared material. */
  readonly skins = new SkinAtlas();
  readonly skinMaterial: THREE.MeshLambertMaterial;
  private readonly rigs: MobRigs;
  constructor(private readonly texture?: THREE.Texture) {
    const faces = new Float32Array(this.geometry.attributes.position.count);
    for (let i = 0; i < faces.length; i++) faces[i] = Math.floor(i / 4);
    this.geometry.setAttribute('faceId', new THREE.BufferAttribute(faces, 1));
    this.skinMaterial = this.skins.material();
    this.rigs = new MobRigs(this.skins, this.geometry, this.skinMaterial);
    // Paint every catalogue skin up front so the atlas never changes during play.
    for (const def of MOBS) this.rigs.build(def.kind);
    for (let wool = 1; wool < WOOL_COLORS.length; wool++) this.rigs.build('lab:sheep', wool);
    for (let v = 0; v < PLAYER_VARIANTS; v++) this.rigs.build('lab:player', v);
  }
  /** Paints an uploaded skin onto the custom player variants. */
  wearCustom(skin: PlayerSkin) {
    return this.rigs.wearCustom(skin);
  }
  box(w: number, h: number, d: number, color: string, glow = false, fog = true): THREE.Mesh {
    const key = color + (glow ? '!' : '') + (fog ? '' : ':clear');
    let material = this.materials.get(key);
    if (!material) {
      material =
        glow || !fog
          ? new THREE.MeshBasicMaterial({
              color,
              map: glow ? null : (this.texture ?? null),
              toneMapped: false,
              fog,
            })
          : new THREE.MeshLambertMaterial({ color, map: this.texture ?? null, fog });
      this.materials.set(key, material);
    }
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.scale.set(w, h, d);
    return mesh;
  }
  private part(
    group: THREE.Group,
    w: number,
    h: number,
    d: number,
    color: string,
    x: number,
    y: number,
    z: number,
    glow = false,
  ) {
    const mesh = this.box(w, h, d, color, glow, !group.userData.unfogged);
    mesh.position.set(x, y, z);
    group.add(mesh);
    mesh.userData.restPosition = mesh.position.clone();
    return mesh;
  }
  mob(kind: string, variant = 0): THREE.Group {
    const g = this.rigs.build(kind, variant);
    this.bind(g);
    return g;
  }
  boss(kind: string): THREE.Group {
    const g = new THREE.Group();
    // Combat cues stay readable at the minimum terrain radius, not swallowed by void fog.
    g.userData.unfogged = true;
    g.userData.kind = kind;
    if (kind === 'ender_dragon') {
      this.part(g, 2.6, 2.7, 6, '#20222c', 0, 3.1, 0);
      this.part(g, 1.7, 1.4, 2.2, '#393542', 0, 3.9, -4);
      this.part(g, 1.3, 0.65, 2.4, '#262632', 0, 3.4, -5);
      for (const sign of [-1, 1]) {
        this.part(g, 0.23, 0.18, 0.18, '#dba2ff', sign * 0.83, 4.16, -4.9, true);
        this.part(g, 0.22, 0.95, 0.27, '#acaab3', sign * 0.57, 4.9, -3.7);
        const wing = new THREE.Group();
        wing.userData.unfogged = true;
        wing.name = sign < 0 ? 'wing-left' : 'wing-right';
        wing.position.set(sign * 1.2, 3.9, 0.4);
        this.part(wing, 3, 0.12, 3.8, '#51415d', sign * 1.5, 0, 0.3);
        this.part(wing, 3, 0.2, 0.2, '#9786a8', sign * 1.5, 0, -1.5);
        const tip = new THREE.Group();
        tip.name = sign < 0 ? 'wing-tip-left' : 'wing-tip-right';
        tip.userData.unfogged = true;
        tip.position.set(sign * 3, 0, 0.1);
        this.part(tip, 3, 0.09, 2.6, '#51415d', sign * 1.5, 0, 0);
        this.part(tip, 3, 0.16, 0.15, '#9786a8', sign * 1.5, 0, -1.2);
        wing.add(tip);
        g.add(wing);
        for (const z of [-1.8, 2]) this.part(g, 0.65, 1.5, 0.65, '#282833', sign * 1.1, 1.5, z);
      }
      let parent = g;
      for (let i = 0; i < 5; i++) {
        const tail = new THREE.Group();
        tail.name = `tail-${i}`;
        tail.userData.unfogged = true;
        tail.position.set(0, i === 0 ? 2.8 : -0.15, i === 0 ? 2.8 : 1.1);
        this.part(tail, 1.4 - i * 0.22, 1 - i * 0.13, 1.4, '#292934', 0, 0, 0.6);
        parent.add(tail);
        parent = tail;
      }
      const head = new THREE.Group();
      head.name = 'dragon-head';
      head.position.set(0, 3.7, -3.6);
      for (const part of [...g.children])
        if (part instanceof THREE.Mesh && part.position.z < -3) {
          g.remove(part);
          part.position.sub(head.position);
          head.add(part);
        }
      g.add(head);
    } else {
      this.part(g, 0.8, 1.8, 0.65, '#353a43', 0, 1.2, 0);
      this.part(g, 2, 0.25, 0.25, '#626571', 0, 2.05, 0);
      for (const x of [-0.8, 0, 0.8]) {
        const head = new THREE.Group();
        head.userData.unfogged = true;
        head.name = `wither-head-${x}`;
        head.position.set(x, 2.55 + (x === 0 ? 0.3 : 0), 0);
        this.part(head, 0.64, 0.64, 0.64, '#404650', 0, 0, 0);
        for (const dx of [-0.16, 0.16])
          this.part(head, 0.11, 0.08, 0.02, '#c2e1ec', dx, 0.06, -0.33, true);
        g.add(head);
      }
      for (let i = 0; i < 3; i++)
        this.part(g, 1.2 - i * 0.2, 0.1, 0.3, '#a1a8b3', 0, 1.4 - i * 0.35, -0.35);
    }
    this.bind(g);
    return g;
  }
  crystal(): THREE.Group {
    const g = new THREE.Group();
    g.userData.unfogged = true;
    this.part(g, 1, 0.16, 1, '#343c4b', 0, 0.08, 0);
    const core = this.part(g, 0.62, 0.62, 0.62, '#d590ed', 0, 1.05, 0, true);
    core.name = 'crystal';
    core.rotation.set(0.6, 0.3, 0.7);
    for (const y of [0.4, 1.65]) this.part(g, 0.85, 0.075, 0.85, '#7dbcc4', 0, y, 0, true);
    for (const x of [-0.43, 0.43])
      for (const z of [-0.43, 0.43]) this.part(g, 0.055, 1.25, 0.055, '#698fa1', x, 1, z);
    this.bind(g);
    return g;
  }
  cart(kind: string): THREE.Group {
    const g = new THREE.Group();
    g.userData.kind = kind;
    this.part(g, 0.9, 0.16, 0.9, '#555f66', 0, 0.22, 0);
    for (const x of [-0.48, 0.48]) this.part(g, 0.1, 0.4, 1, '#a6b0b4', x, 0.43, 0);
    for (const z of [-0.48, 0.48]) this.part(g, 1, 0.4, 0.1, '#8e999f', 0, 0.43, z);
    for (const x of [-0.4, 0.4])
      for (const z of [-0.32, 0.32]) {
        const wheel = this.part(g, 0.15, 0.2, 0.24, '#29333b', x, 0.12, z);
        wheel.name = 'wheel';
      }
    if (kind === 'chest') {
      this.part(g, 0.65, 0.6, 0.65, '#b98b51', 0, 0.67, 0);
      this.part(g, 0.12, 0.17, 0.02, '#f2d48e', 0, 0.75, -0.34);
    }
    this.bind(g);
    return g;
  }
  private bind(g: THREE.Group) {
    const parts: THREE.Object3D[] = [];
    g.traverse((p) => {
      if (!p.name) return;
      p.userData.restPosition = p.position.clone();
      p.userData.restRotation = p.rotation.clone();
      parts.push(p);
    });
    g.userData.animatedParts = parts;
  }
  /**
   * Poses a rig for this frame. Walking follows the reference model maths: limbs swing with
   * cos(stride · 0.6662) · 1.4 · amount, where the amount eases towards the walking speed so a
   * creature that stops does not snap its legs straight. State flags come from `syncMobs`.
   */
  animate(g: THREE.Group, time: number, speed = 0, reduced = false, dt = 0.05) {
    if (!g.userData.animatedParts) this.bind(g);
    const ud = g.userData,
      m = reduced ? 0 : 1,
      kind = ud.kind as string | undefined,
      baby = !!ud.baby;
    const target = Math.min(1, speed * 0.22) * m;
    ud.swing = reduced ? 0 : (ud.swing ?? 0) + (target - (ud.swing ?? 0)) * Math.min(1, dt * 10);
    const swing = ud.swing as number;
    // Babies take quicker steps for the same ground covered.
    ud.stride =
      typeof ud.travel === 'number'
        ? (ud.travel * 2.7) / (baby ? 0.6 : 1)
        : (ud.stride ?? 0) + Math.min(speed, 10) * dt * 2.7;
    const phase = ud.climbing ? time * 9 : (ud.stride as number);
    // A melee swing lasts six ticks from the moment the cooldown restarts at twenty.
    const since = 20 - (ud.attack ?? 0);
    const attack = ud.attack > 0 && since < 6 ? Math.sin((since / 6) * Math.PI) * m : 0;
    const aggressive = !!ud.aggressive;
    // Eating: the sheep's head dips to the grass between ticks 4 and 36 of its 40.
    const eatingTicks = ud.eating ?? 0;
    const eatTarget = eatingTicks > 4 && eatingTicks < 36 ? 1 : 0;
    ud.eat = reduced
      ? eatTarget
      : (ud.eat ?? 0) + (eatTarget - (ud.eat ?? 0)) * Math.min(1, dt * 12);
    // The enderman gapes while it is angry.
    const gapeTarget = aggressive ? 1 : 0;
    ud.gape = reduced
      ? gapeTarget
      : (ud.gape ?? 0) + (gapeTarget - (ud.gape ?? 0)) * Math.min(1, dt * 8);
    const zombieArms = kind === 'lab:zombie' || kind === 'lab:walker';
    const aiming = kind === 'lab:skeleton' && aggressive;
    const raised = kind === 'lab:wither_skeleton' && aggressive;
    for (const p of ud.animatedParts as THREE.Object3D[]) {
      p.position.copy(p.userData.restPosition);
      p.rotation.copy(p.userData.restRotation);
      if (p.name.startsWith('leg-')) {
        let x = Math.cos(phase + (p.userData.phase ?? 0)) * 1.4 * swing;
        if (kind === 'lab:enderman') x = Math.max(-0.4, Math.min(0.4, x));
        p.rotation.x = x;
      }
      if (p.name.startsWith('arm-')) {
        const side = p.position.x > 0 ? 1 : -1;
        const idleX = Math.sin(time * 1.34) * 0.05 * m,
          idleZ = side * (Math.cos(time * 1.8) * 0.05 + 0.05) * m;
        let x = Math.cos(phase + (p.userData.phase ?? 0)) * swing,
          y = 0,
          z = idleZ;
        if (kind === 'lab:enderman') x = Math.max(-0.4, Math.min(0.4, x)) * 0.8;
        if (zombieArms || raised) {
          // Arms held out in front (+x turns a hanging limb forward, towards −z), swung up
          // a little further with each blow.
          x = Math.PI / 2 + idleX + swing * 0.1 * Math.cos(phase) + attack * 0.7;
          y = side * 0.05;
          z = idleZ * 0.6;
        } else if (aiming) {
          const look = (ud.look as { yaw: number; pitch: number } | undefined) ?? {
            yaw: 0,
            pitch: 0,
          };
          // Bow arm straight at the target, the drawing arm crossed in to the string.
          x = Math.PI / 2 + (ud.headPitch ?? look.pitch) * 0.8;
          y = (side > 0 ? 0.1 : -0.5) + (ud.headYaw ?? look.yaw) * 0.5;
          z = 0;
        } else {
          x += idleX + (side > 0 ? attack * 1.2 : 0);
        }
        if (kind === 'lab:dummy') continue;
        p.rotation.x = x;
        p.rotation.y = y;
        p.rotation.z += z;
      }
      if (p.name.startsWith('spider-')) {
        const side = p.userData.side ?? 1,
          k = p.userData.phase ?? 0;
        p.rotation.y += -Math.cos(phase * 2 + k) * 0.4 * swing * side;
        p.rotation.z += side * Math.abs(Math.sin(phase + k) * 0.4) * swing;
      }
      if (p.name === 'head') {
        const look = ud.look as { yaw: number; pitch: number } | undefined,
          k = reduced ? 1 : Math.min(1, dt * 6);
        ud.headYaw = (ud.headYaw ?? 0) + ((look?.yaw ?? 0) - (ud.headYaw ?? 0)) * k;
        ud.headPitch = (ud.headPitch ?? 0) + ((look?.pitch ?? 0) - (ud.headPitch ?? 0)) * k;
        // Now and then an idle animal glances aside on its own.
        const glance =
          !look && !aggressive
            ? Math.sin(time * 0.37 + (ud.seed ?? 0) * 3) *
              Math.max(0, Math.sin(time * 0.21 + (ud.seed ?? 0)) - 0.4) *
              1.2 *
              m
            : 0;
        p.rotation.y = Math.sin(time * 0.65 + (ud.seed ?? 0)) * 0.08 * m + ud.headYaw + glance;
        p.rotation.x = Math.sin(time * 0.9) * 0.035 * m + ud.headPitch;
        if (ud.eat > 0.01) {
          const e = ud.eat as number;
          p.position.y -= e * 0.36;
          p.position.z -= e * 0.05;
          p.rotation.x = p.rotation.x * (1 - e) - e * (0.63 + 0.22 * Math.sin(time * 16) * m);
          p.rotation.y *= 1 - e;
        }
        if (kind === 'lab:chicken') p.position.z -= Math.max(0, Math.sin(phase * 2)) * swing * 0.06;
        if (kind === 'lab:enderman' && ud.gape > 0.05) {
          p.rotation.y += Math.sin(time * 47) * 0.05 * ud.gape * m;
          p.rotation.x += Math.sin(time * 39) * 0.04 * ud.gape * m;
        }
        if (kind === 'lab:blaze') p.position.y += Math.sin(time * 2.2) * 0.04 * m;
        // Young heads are big for their bodies.
        p.scale.setScalar(baby ? (kind === 'lab:chicken' ? 1.3 : 1.55) : 1);
      }
      if (p.name === 'skull') p.position.y += (ud.gape ?? 0) * 0.19;
      if (p.name.startsWith('rod-') && p.userData.rod) {
        const r = p.userData.rod as { angle: number; radius: number; y: number; speed: number },
          i = Number(p.name.slice(4)),
          spin = ud.charge > 0 ? 2.4 : 1,
          a = r.angle + time * m * r.speed * spin;
        p.position.set(
          Math.cos(a) * r.radius,
          r.y + Math.sin(time * 2 + i) * 0.05 * m,
          Math.sin(a) * r.radius,
        );
      }
      if (p.name === 'wing-left' || p.name === 'wing-right') {
        const sign = p.name === 'wing-left' ? -1 : 1;
        p.rotation.z =
          sign * (0.18 + Math.sin(time * (ud.phase === 'charging' ? 5 : 3.6)) * 0.4 * m);
        p.rotation.x = Math.sin(time * 3.6 + 1) * 0.08 * m;
      }
      if (p.name.startsWith('tail-')) {
        const i = Number(p.name.slice(5));
        p.rotation.y = Math.sin(time * 2 - i * 0.6) * 0.12 * m;
        p.rotation.x = Math.cos(time * 1.3 - i * 0.5) * 0.05 * m;
      }
      if (p.name === 'crystal') {
        p.rotation.y = 0.3 + time * 0.65 * m;
        p.position.y = 1.05 + Math.sin(time * 2) * 0.12 * m;
      }
      if (p.name.startsWith('bird-')) {
        const flapping = ud.grounded === false || (ud.panic ?? 0) > 0;
        p.rotation.z =
          (p.name === 'bird-left' ? -1 : 1) *
          (0.08 + Math.sin(time * (flapping ? 18 : 3)) * (flapping ? 0.7 : 0.07) * m);
      }
      if (p.name.startsWith('wing-tip-'))
        p.rotation.z =
          (p.name === 'wing-tip-left' ? -1 : 1) * (0.16 + Math.sin(time * 3.6 - 0.7) * 0.26 * m);
      if (p.name === 'dragon-head') {
        p.rotation.y = Math.sin(time * 0.8) * 0.09 * m;
        p.rotation.x = Math.sin(time * 1.2) * 0.055 * m;
      }
      if (p.name.startsWith('wither-head-')) {
        p.rotation.y = Math.sin(time * 0.8 + p.position.x) * 0.19 * m;
        p.rotation.x = Math.cos(time * 1.2 + p.position.x) * 0.08 * m;
      }
      if (p.name === 'animal-tail') p.rotation.z = Math.sin(time * 2.3) * 0.18 * m;
      if (p.name.startsWith('tentacle-')) {
        const k = p.userData.phase ?? 0;
        if (m) {
          p.rotation.x = 0.12 + Math.sin(time * 1.6 + k) * 0.22;
          p.rotation.z = Math.cos(time * 1.3 + k * 0.7) * 0.12;
        }
      }
      if (p.name === 'ghast-angry') p.visible = aggressive;
      // Magma slabs pull apart while the cube is in the air.
      if (p.name.startsWith('layer-'))
        p.position.y += (p.userData.layer ?? 0) * (ud.spread ?? 0) * (p.userData.step ?? 0.06);
      if (p.name === 'wheel') p.rotation.x = phase * m;
    }
    // A shorn sheep shows its bare body until the wool grows back.
    if (ud.woolParts) {
      for (const w of ud.woolParts as THREE.Object3D[]) w.visible = !ud.sheared;
      for (const w of ud.shornParts as THREE.Object3D[]) w.visible = !!ud.sheared;
    }
    // Overall scale: babies are half size; a lit creeper swells and wobbles before it blows.
    const base = ud.baseScale ?? 1;
    ud.glow = 0;
    if (kind === 'lab:creeper' && ud.fuse > 0) {
      const f = Math.max(0, Math.min(1, (30 - ud.fuse) / 30));
      const wobble = 1 + Math.sin(f * 100) * f * 0.01 * m;
      const xz = (1 + f * f * 0.4 * m) * wobble,
        y = (1 + f * 0.1 * m) / wobble;
      g.scale.set(base * xz, base * y, base * xz);
      // The white flashes come faster as the fuse burns down.
      if (Math.floor(f * 10) % 2 === 0) ud.glow = 0.55 + f * 0.35;
    } else if (/slime|magma_cube/.test(kind ?? '')) {
      // Hopping cubes stretch as they leave the ground and squash when they land.
      const air = ud.grounded === false ? 1 : 0;
      if (air && !ud.wasAir) ud.land = 0;
      if (!air && ud.wasAir) ud.land = 1;
      ud.wasAir = air;
      ud.land = Math.max(0, (ud.land ?? 0) - dt * 5);
      ud.spread = reduced ? 0 : (ud.spread ?? 0) + (air - (ud.spread ?? 0)) * Math.min(1, dt * 10);
      const stretch = kind!.startsWith('lab:magma') ? 0 : ud.spread * 0.18 - ud.land * 0.28;
      g.scale.set(base * (1 - stretch * 0.5), base * (1 + stretch), base * (1 - stretch * 0.5));
    } else g.scale.setScalar(base);
    if (kind === 'lab:blaze' && ud.charge > 0) ud.glow = 0.25 + Math.sin(time * 20) * 0.15 * m;
    // The enderman trembles while it screams; the training dummy rocks after a blow.
    if (kind === 'lab:enderman' && ud.gape > 0.3 && m) {
      g.position.x += Math.sin(time * 61) * 0.02;
      g.position.z += Math.cos(time * 53) * 0.02;
    }
    if (kind === 'lab:dummy' && typeof ud.hitAt === 'number') {
      const t = time - ud.hitAt;
      if (t >= 0 && t < 2) g.rotation.z += Math.sin(t * 14) * Math.exp(-t * 2.6) * 0.28 * m;
    }
  }
  dispose() {
    this.geometry.dispose();
    this.skinMaterial.dispose();
    this.skins.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
  }
}
