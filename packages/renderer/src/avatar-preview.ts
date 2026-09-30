import * as THREE from 'three';
import type { EntityModels } from './entity-models';
import { RigBatches } from './instance-batches';
import { PlayerAvatar, type AvatarFrame, type HeldModel } from './player-avatar';

/**
 * The little figure of the player in the inventory and the settings, like the reference's: it
 * wears the chosen skin, the armour and the held item, and turns its body and head towards the
 * mouse. It draws with its own small WebGL context only while its canvas is on screen, sharing
 * the skin atlas and materials with the world (three.js uploads them once per context).
 */
export class AvatarPreview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(26, 1, 0.1, 20);
  private readonly batches: RigBatches;
  private readonly avatar: PlayerAvatar;
  private frame: AvatarFrame = {
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
  };
  private raf = 0;
  private last = 0;
  private mouse = { x: 0, y: 0 };
  private readonly onMove = (e: MouseEvent) => {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = e.clientX - (r.left + r.width / 2);
    this.mouse.y = e.clientY - (r.top + r.height * 0.28);
  };
  constructor(
    readonly canvas: HTMLCanvasElement,
    models: EntityModels,
    atlas: THREE.Texture,
    heldModel: (key: string) => HeldModel | null,
    variant: number,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.batches = new RigBatches(this.scene, models.geometry);
    this.avatar = new PlayerAvatar(models, atlas, heldModel, variant);
    for (const extra of this.avatar.extras) this.scene.add(extra);
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x4a4038, 2.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(-2, 4, -3);
    this.scene.add(sun);
    // The figure faces −z; the camera stands in front of it.
    this.camera.position.set(0, 1.12, -5.7);
    this.camera.lookAt(0, 1.0, 0);
    window.addEventListener('mousemove', this.onMove);
  }
  setVariant(variant: number) {
    this.avatar.setVariant(variant);
  }
  /** Worn armour and hand items from the latest snapshot. */
  dress(held: string | null, offhand: string | null, armor: readonly (string | null)[]) {
    this.frame.held = held;
    this.frame.offhand = offhand;
    this.frame.armor = armor;
  }
  private visible() {
    return (
      this.canvas.isConnected && this.canvas.offsetParent !== null && this.canvas.clientWidth > 0
    );
  }
  start() {
    if (this.raf) return;
    const loop = (now: number) => {
      this.raf = 0;
      if (!this.visible()) return;
      this.raf = requestAnimationFrame(loop);
      if (now - this.last < 30) return;
      const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
      this.last = now;
      this.draw(dt, now / 1000);
    };
    this.raf = requestAnimationFrame(loop);
  }
  private draw(dt: number, time: number) {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * devicePixelRatio)) {
      this.renderer.setPixelRatio(devicePixelRatio);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    // The reference's inventory figure: the head turns atan(dx/40)·40° and tilts atan(dy/40)·20°;
    // the body follows the head by itself, up to its own idle limit.
    this.frame.yaw = -Math.atan(this.mouse.x / 40) * ((40 * Math.PI) / 180);
    this.frame.pitch = -Math.atan(this.mouse.y / 40) * ((20 * Math.PI) / 180);
    this.batches.begin();
    const g = this.avatar.update(this.frame, dt, time, false);
    this.batches.add(g);
    this.batches.finish();
    this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('mousemove', this.onMove);
    this.batches.dispose();
    this.avatar.dispose();
    this.renderer.dispose();
  }
}
