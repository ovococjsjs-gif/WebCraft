import { WeatherView } from './weather-view';
import * as THREE from 'three';
import type { FarReach } from './quality';
import { FarTerrain, type FarReply, type FarRequest } from './far-terrain';
import { TerrainMaterials } from './terrain-material';
import { EntityModels } from './entity-models';
import { Atmosphere } from './environment';
import { RigBatches, ItemBatch } from './instance-batches';
import { VoxelParticles } from './particles';
import { HAND_FOV, HeldView, HELD_LAYER } from './held-view';
import { AvatarPreview } from './avatar-preview';
import { CameraRoom, PlayerAvatar, type AvatarFrame, type CameraMode } from './player-avatar';
import { BUILTIN_SKINS, type PlayerSkin } from './player-skins';
import { ARMOR_SLOT_ORDER, itemRegistry } from '../../content/src/items';
import { PoseTrack, PresentationClock, damp, type Pose } from './animation';
import {
  AdaptiveResolution,
  FrameStats,
  DEFAULT_QUALITY,
  QUALITY,
  sanitizeQuality,
  type QualitySettings,
} from './quality';
import { crackPixels, pixelCanvas, pixelNoise } from './pixel-art';
import { meshBytes } from './mesh-batches';
import { registry } from '../../content/src/blocks';
import { mobDefinition } from '../../core/src/mobs';
import type { SimulationSnapshot } from '../../core/src/simulation';
import { EYE_HEIGHT } from '../../core/src/player';
import type { SectionMesh, MeshEmitter } from './mesher';
import { createAtlas, itemTile } from './textures';
interface Body {
  group: THREE.Group;
  track: PoseTrack;
  kind: string;
  hurt: boolean;
  seen: number;
  radius: number;
  grounded: boolean;
}
type MobFrame = {
  id: number;
  kind: string;
  health: number;
  hurt: boolean;
  attack?: number;
  fuse?: number;
  baby?: boolean;
  grounded?: boolean;
  aggressive?: boolean;
  burning?: boolean;
  variant?: number;
  sheared?: boolean;
  eating?: number;
  climbing?: boolean;
  charge?: number;
  swimming?: boolean;
  love?: boolean;
  panic?: boolean;
} & Pose;
type EntityFrame = { id: number } & Pose;
interface TerrainEntry {
  group: THREE.Group;
  revision: number;
  faces: number;
  bytes: number;
  emitters: readonly MeshEmitter[];
}
/** The host owns presentation only. Physics, actions, inventory and the 20-minute clock stay authoritative in the Worker. */
/** Another player as the renderer needs it: where, looking where, holding what. */
export interface RemotePlayerView {
  id: number;
  name: string;
  skin: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  held: string | null;
  crouching: boolean;
  flying: boolean;
  onGround: boolean;
  swings: number;
  /** False while the player is in another dimension. */
  visible?: boolean;
}
const NO_ARMOR: readonly (string | null)[] = [null, null, null, null];
/** A floating name over a player's head, drawn in the game font on a dark plate. */
function nameTag(name: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d')!;
  const font = "24px 'Pixelify Sans', monospace";
  g.font = font;
  const width = Math.ceil(g.measureText(name).width) + 16;
  canvas.width = width;
  canvas.height = 34;
  g.font = font;
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(0, 0, width, 34);
  g.fillStyle = '#ffffff';
  g.textBaseline = 'middle';
  g.fillText(name, 8, 18);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  sprite.scale.set((width / 34) * 0.32, 0.32, 1);
  sprite.renderOrder = 10;
  return sprite;
}
/** Points along the fishing line (enough for a smooth sag). */
const FISHING_LINE_POINTS = 12;
/** Where the tip of the held rod shows in first person, in normalised screen coordinates. */
const ROD_TIP_SCREEN = [0.58, -0.03] as const;
export class VoxelRenderer {
  /** Home/pause scenes redraw only after a visual change; game rendering stays continuous. */
  needsFrame = true;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(72, 1, 0.05, 420);
  readonly atlas = createAtlas();
  readonly frameStats = new FrameStats();
  readonly adaptive = new AdaptiveResolution();
  readonly clock = new PresentationClock();
  private readonly atmosphere: Atmosphere;
  private readonly terrain = new THREE.Group();
  private readonly meshes = new Map<string, TerrainEntry>();
  private readonly terrainMaterials: TerrainMaterials;
  private readonly far: FarTerrain;
  private readonly models: EntityModels;
  private readonly skin: THREE.CanvasTexture;
  private readonly batches: RigBatches;
  private readonly remotes = new Map<
    number,
    {
      avatar: PlayerAvatar;
      tag: THREE.Sprite;
      view: RemotePlayerView;
      x: number;
      y: number;
      z: number;
      yaw: number;
      pitch: number;
      swings: number;
    }
  >();
  private readonly drops: ItemBatch;
  private readonly particles: VoxelParticles;
  private readonly weatherView: WeatherView;
  private weather: { rain: number; thunder: number } = { rain: 0, thunder: 0 };
  /** A strike landed at this distance: the host plays the thunder. */
  onThunder: ((distance: number) => void) | null = null;
  // Camera feel, all presentation-only and off under reduced motion.
  private readonly eyeBase = new THREE.Vector3();
  private yaw = 0;
  /** Raises the first-person eye for the title-screen panorama; zero while playing. */
  panoramaLift = 0;
  private pitch = 0;
  private baseFov = 70;
  /** Draws only the hand layer: same pose as the world camera, fixed field of view. */
  private readonly handCamera = (() => {
    const camera = new THREE.PerspectiveCamera(HAND_FOV, 16 / 9, 0.01, 20);
    camera.layers.set(HELD_LAYER);
    camera.matrixAutoUpdate = false;
    camera.matrixWorldAutoUpdate = false;
    return camera;
  })();
  private fovBoost = 1;
  private walkSpeed = 0;
  private bobPhase = 0;
  private bobAmount = 0;
  private hurtKick = 0;
  private landDip = 0;
  private lastHealth = -1;
  private sprinting = false;
  private flying = false;
  private lastChip = -1;
  private readonly held: HeldView;
  private readonly outline: THREE.LineSegments;
  /** The fishing bobber (red over white, as in the reference) and the line to the rod. */
  private readonly bobber = new THREE.Group();
  private readonly fishingLine: THREE.Line;
  private readonly bobberFrom = new THREE.Vector3();
  private readonly bobberTo = new THREE.Vector3();
  private bobberDip = 0;
  private bobberBite = false;
  private bobberAt = -1;
  private readonly breakOverlay: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  private readonly cracks: THREE.CanvasTexture[] = [];
  private readonly shadows: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly shadowTexture: THREE.CanvasTexture;
  private readonly mobs = new Map<number, Body>();
  private readonly arrows = new Map<number, Body>();
  private readonly orbs = new Map<number, Body>();
  private readonly special = new Map<string, Body>();
  private readonly items = new Map<number, { track: PoseTrack; tile: number; seen: number }>();
  private retiring: { body: Body; left: number }[] = [];
  private deathCues: SimulationSnapshot['visualEvents'] = [];
  private lastLanding = 0;
  private ambientTurn = 0;
  private readonly nearEmitters: MeshEmitter[] = [];
  private lastPhase = 0;
  private readonly colors = new Map<number, THREE.Color>();
  private readonly desiredPosition = new THREE.Vector3();
  /** Feet positions the camera moves between: where it was when the last tick arrived, and that tick. */
  private readonly tickFrom = new THREE.Vector3();
  private readonly tickTo = new THREE.Vector3();
  private tickAt = 0;
  private tickInterval = 50;
  private lastTick = -1;
  /** Eye height eases between standing and sneaking instead of snapping. */
  private eyeHeight = EYE_HEIGHT;
  private readonly frustum = new THREE.Frustum();
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly sphere = new THREE.Sphere();
  private readonly shadowRotation = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-Math.PI / 2, 0, 0),
  );
  private readonly resizeObserver: ResizeObserver;
  private settings: QualitySettings = { ...DEFAULT_QUALITY };
  private positioned = false;
  private playing = false;
  private yEye = EYE_HEIGHT;
  private dimension = 'overworld';
  private medium = 'air';
  private tick = 0;
  private syncVersion = 0;
  private faces = 0;
  private bufferBytes = 0;
  private lastAmbient = 0;
  private currentTime = 6000;
  reducedMotion = false;
  radius = 3;
  /** F1 hides the first-person hand with the interface. */
  handVisible = true;
  private viewMode: CameraMode = 'first';
  private readonly avatar: PlayerAvatar;
  private readonly room = new CameraRoom();
  /** Current third-person camera distance: grows smoothly, shrinks at once against walls. */
  private cameraDistance = 0;
  private avatarState: SimulationSnapshot | null = null;
  private readonly lookDir = new THREE.Vector3();
  private readonly previews = new Set<AvatarPreview>();
  private playerVariant = 0;
  private readonly eyeNow = new THREE.Vector3();
  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.scene.add(this.terrain, this.camera);
    this.terrainMaterials = new TerrainMaterials(this.atlas.mipTexture);
    this.atmosphere = new Atmosphere(this.scene, this.terrainMaterials.light);
    this.far = new FarTerrain(this.terrainMaterials.light, this.atlas.mipTexture);
    this.scene.add(this.far.group);
    // The held view is drawn in its own pass (see render()); the world's lights light it too.
    this.atmosphere.hemisphere.layers.enable(HELD_LAYER);
    this.atmosphere.keyLight.layers.enable(HELD_LAYER);
    // Two render calls per frame: statistics are reset once per frame, not once per call.
    this.renderer.info.autoReset = false;
    const pixels = new Uint8ClampedArray(1024);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const n = 218 + Math.floor(pixelNoise(Math.floor(x / 2), Math.floor(y / 2), 9) * 37);
        pixels.set([n, n, n, 255], (y * 16 + x) * 4);
      }
    this.skin = new THREE.CanvasTexture(pixelCanvas(pixels));
    this.skin.colorSpace = THREE.SRGBColorSpace;
    this.skin.magFilter = THREE.NearestFilter;
    this.skin.minFilter = THREE.NearestFilter;
    this.skin.generateMipmaps = false;
    this.models = new EntityModels(this.skin);
    this.batches = new RigBatches(this.scene, this.models.geometry);
    this.drops = new ItemBatch(this.scene, this.atlas.texture);
    this.weatherView = new WeatherView(this.scene);
    this.weatherView.onSplash = (x, y, z) => this.particles.ambient(x, y, z, 'splash');
    this.weatherView.onStrike = (x, z) =>
      this.onThunder?.(Math.hypot(x - this.camera.position.x, z - this.camera.position.z));
    this.particles = new VoxelParticles(this.scene, this.models.geometry, (id) =>
      this.blockColor(id),
    );
    this.held = new HeldView(this.camera, this.atlas);
    this.avatar = new PlayerAvatar(this.models, this.atlas.texture, (key) => this.held.model(key));
    for (const extra of this.avatar.extras) this.scene.add(extra);
    const box = new THREE.BoxGeometry(1.006, 1.006, 1.006);
    this.outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(box),
      new THREE.LineBasicMaterial({ color: '#fff4c8', transparent: true, opacity: 0.82 }),
    );
    box.dispose();
    this.outline.visible = false;
    this.scene.add(this.outline);
    {
      const box = new THREE.BoxGeometry(0.22, 0.11, 0.22);
      const red = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0xc8302a }));
      const white = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0xe8e4dc }));
      red.position.y = 0.055;
      white.position.y = -0.055;
      const tip = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.1, 0.06),
        new THREE.MeshBasicMaterial({ color: 0x2a2a2a }),
      );
      tip.position.y = 0.16;
      this.bobber.add(red, white, tip);
      this.bobber.visible = false;
      const points = new Float32Array(FISHING_LINE_POINTS * 3);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
      this.fishingLine = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ color: 0x1d1d1d, transparent: true, opacity: 0.85 }),
      );
      this.fishingLine.frustumCulled = false;
      this.fishingLine.visible = false;
      this.scene.add(this.bobber, this.fishingLine);
    }
    for (let i = 0; i < 8; i++) {
      const tex = new THREE.CanvasTexture(pixelCanvas(crackPixels(i)));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      this.cracks.push(tex);
    }
    this.breakOverlay = new THREE.Mesh(
      new THREE.BoxGeometry(1.004, 1.004, 1.004),
      new THREE.MeshBasicMaterial({
        map: this.cracks[0],
        transparent: true,
        alphaTest: 0.1,
        opacity: 0.9,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    this.breakOverlay.visible = false;
    this.scene.add(this.breakOverlay);
    const shadowPixels = new Uint8ClampedArray(1024);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5) / 7.5;
        shadowPixels.set([18, 29, 24, Math.round(Math.max(0, 1 - d) * 180)], (y * 16 + x) * 4);
      }
    this.shadowTexture = new THREE.CanvasTexture(pixelCanvas(shadowPixels));
    this.shadowTexture.magFilter = this.shadowTexture.minFilter = THREE.NearestFilter;
    this.shadowTexture.generateMipmaps = false;
    this.shadows = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(),
      new THREE.MeshBasicMaterial({
        map: this.shadowTexture,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
      256,
    );
    this.shadows.count = 0;
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 1;
    this.shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.shadows);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement!);
    this.applyResolution();
  }
  private resize() {
    this.needsFrame = true;
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.handCamera.aspect = w / h;
    this.handCamera.updateProjectionMatrix();
    this.held.aspect = w / h;
    this.renderer.setSize(w, h, false);
  }
  private applyResolution() {
    this.needsFrame = true;
    this.renderer.setPixelRatio(
      Math.min(globalThis.devicePixelRatio || 1, QUALITY[this.settings.preset].dpr) *
        this.settings.scale *
        this.adaptive.scale,
    );
    this.resize();
  }
  setQuality(settings: QualitySettings) {
    this.settings = sanitizeQuality(settings);
    this.terrainMaterials.setShaders(this.settings.shaders);
    this.far.setShaders(this.settings.shaders);
    this.applyFarReach();
    this.needsFrame = true;
    this.adaptive.reset();
    this.frameStats.reset();
    this.applyResolution();
  }
  get quality() {
    return {
      ...this.settings,
      adaptiveScale: this.adaptive.scale,
      pixelRatio: this.renderer.getPixelRatio(),
      width: this.canvas.width,
      height: this.canvas.height,
    };
  }
  get uploadBudget() {
    return QUALITY[this.settings.preset].uploadMs;
  }
  measure(frameMs: number, cpuMs: number, eligible: boolean) {
    if (!eligible) return;
    this.frameStats.add(frameMs, cpuMs);
    if (this.adaptive.sample(frameMs / 1000, frameMs, cpuMs, this.settings)) this.applyResolution();
  }
  setDistance(radius: number) {
    this.needsFrame = true;
    this.radius = radius;
    this.atmosphere.radius = radius;
    this.far.chunkRadius = radius;
  }
  setFov(fov: number) {
    this.needsFrame = true;
    this.baseFov = fov;
    this.camera.fov = fov * this.fovBoost;
    this.camera.updateProjectionMatrix();
  }
  setHeldItem(item: string | null) {
    this.held.setItem(item);
  }
  setPaused(paused: boolean) {
    this.clock.paused = paused;
  }
  setPlaying(playing: boolean) {
    this.needsFrame = true;
    if (playing && !this.playing) this.frameStats.reset();
    this.playing = playing;
    this.clock.paused = !playing;
    if (!playing) {
      this.outline.visible = false;
      this.breakOverlay.visible = false;
    }
  }
  /** Development aid for tuning how items sit in the hand. */
  tuneHeld(kind: string, patch: Record<string, unknown>) {
    this.held.tunePose(kind as never, patch);
  }
  /** Upper bound of the horizon for this device (a phone keeps it at 512 blocks). */
  private farCap: FarReach = 2048;
  setFarCap(cap: FarReach) {
    this.farCap = cap;
    this.applyFarReach();
  }
  private applyFarReach() {
    // The economy profile keeps the horizon modest too: 512 blocks at most.
    const cap = this.settings.preset === 'economy' ? Math.min(this.farCap, 512) : this.farCap;
    this.far.setReach(Math.min(this.settings.far, cap) as FarReach);
  }
  setDimension(dimension: string, time: number) {
    this.dimension = dimension;
    this.far.dimension = dimension;
    this.setTimeOfDay(time);
  }
  setTimeOfDay(time: number) {
    this.clock.time = time;
    this.clock.elapsed = 0;
    this.currentTime = time;
  }
  get timeOfDay() {
    return (((this.currentTime % 24000) + 24000) % 24000) / 24000;
  }
  setBreakProgress(progress: number | null) {
    this.breakOverlay.visible = progress !== null && progress > 0 && this.playing;
    if (this.breakOverlay.visible)
      this.breakOverlay.material.map = this.cracks[Math.min(7, Math.floor(progress! * 8))];
  }
  get faceCount() {
    return this.faces;
  }
  get meshCount() {
    return this.meshes.size;
  }
  receive(mesh: SectionMesh) {
    this.needsFrame = true;
    const previous = this.meshes.get(mesh.key);
    if (previous && previous.revision >= mesh.revision) return;
    if (previous) this.disposeTerrain(previous);
    this.far.markColumn(mesh.cx, mesh.cz, true);
    const group = new THREE.Group();
    group.position.set(mesh.cx * 16, mesh.sy * 16, mesh.cz * 16);
    for (const [name, layer] of Object.entries(mesh.layers)) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(layer.positions, 3));
      geometry.setAttribute(
        'normal',
        new THREE.BufferAttribute(layer.normals, 3, layer.normals instanceof Int8Array),
      );
      geometry.setAttribute(
        'uv',
        new THREE.BufferAttribute(layer.uvs, 2, layer.uvs instanceof Uint16Array),
      );
      geometry.setAttribute(
        'color',
        new THREE.BufferAttribute(layer.colors, 3, layer.colors instanceof Uint8Array),
      );
      geometry.setAttribute(
        'voxelLight',
        new THREE.BufferAttribute(layer.lights, 2, layer.lights instanceof Uint8Array),
      );
      geometry.setAttribute('voxelVisual', new THREE.BufferAttribute(layer.visuals, 2));
      geometry.setIndex(new THREE.BufferAttribute(layer.indices, 1));
      geometry.computeBoundingSphere();
      const object = new THREE.Mesh(geometry, this.terrainMaterials.layers[name]);
      if (name === 'transparent') object.renderOrder = 2;
      group.add(object);
    }
    const bytes = meshBytes(mesh);
    this.terrain.add(group);
    this.meshes.set(mesh.key, {
      group,
      revision: mesh.revision,
      faces: mesh.faces,
      bytes,
      emitters: mesh.emitters ?? [],
    });
    this.faces += mesh.faces;
    this.bufferBytes += bytes;
  }
  private disposeTerrain(entry: TerrainEntry) {
    entry.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    entry.group.removeFromParent();
    this.faces -= entry.faces;
    this.bufferBytes -= entry.bytes;
  }
  evict(cx: number, cz: number) {
    this.far.markColumn(cx, cz, false);
    for (const [key, entry] of this.meshes) {
      const [x, , z] = key.split(',').map(Number);
      if (x === cx && z === cz) {
        this.disposeTerrain(entry);
        this.meshes.delete(key);
      }
    }
  }
  private body(kind: string, pose: Pose, radius: number, create: () => THREE.Group): Body {
    const group = create();
    group.userData.kind = kind;
    return {
      group,
      track: new PoseTrack(pose, this.tick),
      kind,
      hurt: false,
      seen: this.syncVersion,
      radius,
      grounded: false,
    };
  }
  private put<T extends string | number>(
    map: Map<T, Body>,
    id: T,
    kind: string,
    pose: Pose,
    radius: number,
    create: () => THREE.Group,
  ) {
    let body = map.get(id);
    if (!body || body.kind !== kind) {
      body = this.body(kind, pose, radius, create);
      body.group.userData.seed = Number(typeof id === 'number' ? id : 0) * 0.713;
      map.set(id, body);
    } else body.track.push(pose, this.tick);
    body.seen = this.syncVersion;
    if (this.clock.paused) body.track.snap();
    return body;
  }
  private sweep<T extends string | number>(map: Map<T, Body>) {
    for (const [id, b] of map) if (b.seen !== this.syncVersion) map.delete(id);
  }
  syncMobs(list: readonly MobFrame[]) {
    this.syncVersion++;
    for (const e of list) {
      const def = mobDefinition(e.kind),
        variant = e.variant ?? 0,
        b = this.put(this.mobs, e.id, e.kind, e, def?.height ?? 2, () =>
          this.models.mob(e.kind, variant),
        );
      // A sheep's wool colour is part of its skin, so a different colour is a different rig.
      if (
        (b.group.userData.variant ?? 0) !== variant &&
        (e.kind === 'lab:sheep' || e.kind === 'lab:villager')
      ) {
        const seed = b.group.userData.seed;
        b.group = this.models.mob(e.kind, variant);
        b.group.userData.seed = seed;
      }
      if (e.hurt && !b.hurt) b.group.userData.hitAt = this.clock.phase;
      b.hurt = e.hurt;
      b.grounded = e.grounded ?? true;
      Object.assign(b.group.userData, {
        attack: e.attack ?? 0,
        fuse: e.fuse ?? 0,
        grounded: e.grounded ?? true,
        baby: !!e.baby,
        baseScale: e.baby ? 0.5 : 1,
        aggressive: !!e.aggressive,
        burning: !!e.burning,
        sheared: !!e.sheared,
        eating: e.eating ?? 0,
        climbing: !!e.climbing,
        charge: e.charge ?? 0,
        swimming: !!e.swimming,
        love: !!e.love,
        panic: e.panic ? 1 : 0,
      });
    }
    for (const [id, body] of this.mobs)
      if (body.seen !== this.syncVersion) {
        if (
          !this.reducedMotion &&
          this.retiring.length < 16 &&
          this.deathCues.some(
            (e) =>
              e.kind === 'death' &&
              this.tick - e.tick < 4 &&
              (e.x - body.track.to.x) ** 2 + (e.z - body.track.to.z) ** 2 < 2,
          )
        )
          this.retiring.push({ body, left: 1 });
        this.mobs.delete(id);
      }
  }
  syncArrows(list: readonly (EntityFrame & { kind?: string })[]) {
    this.syncVersion++;
    for (const e of list) {
      const kind = e.kind ?? 'arrow';
      this.put(this.arrows, e.id, kind, e, 0.6, () => {
        const g = new THREE.Group();
        if (kind === 'ghast_fireball') {
          // A block-sized ball of fire: bright core, darker spinning shell.
          g.add(this.models.box(0.8, 0.8, 0.8, '#ffc23a', true));
          const shell = this.models.box(0.62, 0.62, 1.0, '#e0521e', true);
          shell.rotation.z = Math.PI / 4;
          g.add(shell);
          g.userData.spin = 5;
          return g;
        }
        if (kind === 'fireball') {
          // A glowing ember with a darker shell, spinning as it flies.
          g.add(this.models.box(0.3, 0.3, 0.3, '#ffcf4a', true));
          const shell = this.models.box(0.22, 0.22, 0.4, '#e2622a', true);
          shell.rotation.z = Math.PI / 4;
          g.add(shell);
          g.userData.spin = 9;
          return g;
        }
        if (kind === 'egg') {
          g.add(this.models.box(0.2, 0.25, 0.2, '#efe3c6'));
          g.userData.spin = 6;
          return g;
        }
        g.add(this.models.box(0.04, 0.04, 0.7, '#cabb96'));
        const tip = this.models.box(0.08, 0.07, 0.12, '#788785');
        tip.position.z = -0.34;
        g.add(tip);
        return g;
      });
    }
    this.sweep(this.arrows);
  }
  syncOrbs(list: readonly EntityFrame[]) {
    this.syncVersion++;
    for (const e of list)
      this.put(this.orbs, e.id, 'orb', e, 0.3, () => {
        const g = new THREE.Group();
        g.add(this.models.box(0.15, 0.15, 0.15, '#b4da71', true));
        return g;
      });
    this.sweep(this.orbs);
  }
  syncItems(list: readonly ({ id: number; item: string } & Pose)[]) {
    this.syncVersion++;
    for (const e of list) {
      let entry = this.items.get(e.id);
      if (!entry) {
        entry = { track: new PoseTrack(e, this.tick), tile: itemTile(e.item), seen: 0 };
        this.items.set(e.id, entry);
      } else entry.track.push(e, this.tick);
      entry.tile = itemTile(e.item);
      entry.seen = this.syncVersion;
      if (this.clock.paused) entry.track.snap();
    }
    for (const [id, entry] of this.items)
      if (entry.seen !== this.syncVersion) this.items.delete(id);
  }
  private syncSpecial(state: SimulationSnapshot) {
    this.syncVersion++;
    for (const e of state.bosses) {
      const b = this.put(
        this.special,
        `boss:${e.id}`,
        e.kind,
        e,
        e.kind === 'ender_dragon' ? 12 : 3,
        () => this.models.boss(e.kind),
      );
      b.hurt = e.hurt;
      b.group.userData.phase = e.phase;
    }
    for (const e of state.crystals)
      this.put(this.special, `crystal:${e.id}`, 'crystal', e, 2, () => this.models.crystal());
    for (const e of state.carts)
      this.put(this.special, `cart:${e.id}`, `cart:${e.kind}`, e, 1, () =>
        this.models.cart(e.kind),
      );
    for (const e of state.skulls)
      this.put(this.special, `skull:${e.id}`, 'skull', e, 0.6, () => {
        const g = new THREE.Group();
        g.add(this.models.box(0.42, 0.42, 0.42, '#658292', true, false));
        return g;
      });
    this.sweep(this.special);
  }
  snapshot(state: SimulationSnapshot) {
    this.needsFrame = true;
    this.tick = state.tick;
    this.dimension = state.dimension;
    // The horizon belongs to the Overworld: it hides in the Nether and the End.
    this.far.dimension = state.dimension;
    this.medium = state.cameraMedium ?? 'air';
    this.clock.sync(state.tick, state.time, state.dimension);
    const p = state.player.position;
    this.desiredPosition.set(p.x, p.y, p.z);
    const now = performance.now();
    if (!this.positioned || this.tickTo.distanceToSquared(this.desiredPosition) > 64) {
      // First frame, a teleport or a portal: no glide across the world.
      this.tickFrom.copy(this.desiredPosition);
      this.tickTo.copy(this.desiredPosition);
      this.eyeHeight = this.yEye;
      this.eyeBase.set(p.x, p.y + this.eyeHeight, p.z);
      this.camera.position.copy(this.eyeBase);
      this.positioned = true;
      this.lastTick = state.tick;
      this.tickAt = now;
    } else if (state.tick !== this.lastTick) {
      // Interpolate from wherever the camera is now to the new tick over one measured tick
      // interval, the reference's partial-tick rendering: a late or early message never jumps.
      this.tickFrom.lerpVectors(this.tickFrom, this.tickTo, this.tickAlpha(now));
      this.tickTo.copy(this.desiredPosition);
      const gap = (now - this.tickAt) / Math.max(1, state.tick - this.lastTick);
      this.tickInterval = Math.max(30, Math.min(90, this.tickInterval * 0.8 + gap * 0.2));
      this.tickAt = now;
      this.lastTick = state.tick;
    } else this.tickTo.copy(this.desiredPosition);
    this.avatarState = state;
    this.room.set(state.near);
    for (const p of this.previews) this.dressPreview(p, state);
    this.weather = state.weather ?? { rain: 0, thunder: 0 };
    this.weatherView.sync(state.weather, state.tick);
    const v = state.player.velocity;
    this.walkSpeed = state.player.onGround && !state.player.flying ? Math.hypot(v.x, v.z) : 0;
    this.sprinting = Math.hypot(v.x, v.z) > 5.2 && !state.player.inWater;
    this.flying = state.player.flying;
    const health = state.survival.health;
    if (this.lastHealth >= 0 && health < this.lastHealth && !state.survival.dead) this.hurtKick = 1;
    this.lastHealth = health;
    // Chips fly off the block being mined, a couple every few ticks.
    if (
      state.mining &&
      state.mining.ticks > 0 &&
      state.tick !== this.lastChip &&
      state.tick % 3 === 0
    ) {
      this.lastChip = state.tick;
      const m = state.mining;
      const block =
        state.target && state.target.x === m.x && state.target.y === m.y && state.target.z === m.z
          ? state.target.state
          : undefined;
      if (block !== undefined) {
        const cx = m.x + 0.5,
          cy = m.y + 0.5,
          cz = m.z + 0.5;
        const d = this.position.set(
          this.camera.position.x - cx,
          this.camera.position.y - cy,
          this.camera.position.z - cz,
        );
        const ax = Math.abs(d.x),
          ay = Math.abs(d.y),
          az = Math.abs(d.z);
        // Out of the face turned to the player.
        const fx = ax >= ay && ax >= az ? Math.sign(d.x) * 0.52 : 0,
          fy = ay > ax && ay >= az ? Math.sign(d.y) * 0.52 : 0,
          fz = az > ax && az > ay ? Math.sign(d.z) * 0.52 : 0;
        for (let k = 0; k < 2; k++) this.particles.chip(cx + fx, cy + fy, cz + fz, block);
      }
    }
    this.outline.visible =
      this.playing && !state.container && !!state.target && !state.survival.dead;
    if (state.target)
      this.outline.position.set(state.target.x + 0.5, state.target.y + 0.5, state.target.z + 0.5);
    if (state.mining && state.mining.ticks > 0) {
      this.breakOverlay.position.set(
        state.mining.x + 0.5,
        state.mining.y + 0.5,
        state.mining.z + 0.5,
      );
      this.setBreakProgress(state.mining.progress / state.mining.ticks);
    } else this.setBreakProgress(null);
    this.deathCues = state.visualEvents ?? [];
    this.syncMobs(state.mobs);
    this.syncItems(state.items);
    this.syncArrows(state.arrows);
    this.syncOrbs(state.orbs);
    this.syncSpecial(state);
    this.syncBobber(state.bobber ?? null);
    this.held.snapshot(state);
    this.particles.enabled = this.settings.particles && !this.reducedMotion;
    this.particles.limit = QUALITY[this.settings.preset].particles;
    this.particles.consume(state.visualEvents ?? [], state.tick, this.camera.position);
    for (const event of state.visualEvents ?? [])
      if (event.kind === 'land' && event.id > this.lastLanding && state.tick - event.tick < 2) {
        this.lastLanding = event.id;
        this.held.land(event.strength);
        this.landDip = Math.min(0.22, 0.05 + event.strength * 0.05);
      }
  }
  /** Where the eye is this frame (observability for the latency probe). */
  get eye() {
    const c = this.camera.position;
    return { x: c.x, y: c.y, z: c.z };
  }
  private tickAlpha(now: number) {
    return Math.max(0, Math.min(1, (now - this.tickAt) / this.tickInterval));
  }
  look(yaw: number, pitch: number, crouch = false) {
    this.yaw = yaw;
    this.pitch = pitch;
    this.camera.rotation.set(pitch, yaw, 0, 'YXZ');
    this.yEye = crouch ? 1.47 : EYE_HEIGHT;
  }
  /**
   * The camera's small motions, like the reference's: the head bobs with each step, the view
   * widens when sprinting, rolls when hurt, and dips on a hard landing.
   */
  private updateCameraFeel(dt: number) {
    const still = this.reducedMotion || this.clock.paused;
    const d = this.clock.paused ? 0 : dt;
    this.bobAmount = damp(this.bobAmount, still ? 0 : Math.min(1, this.walkSpeed / 4.3), d, 8);
    this.bobPhase += d * this.walkSpeed * 1.9;
    this.hurtKick = Math.max(0, this.hurtKick - d * 2.4);
    this.landDip = damp(this.landDip, 0, d, 7);
    const bobY = Math.abs(Math.cos(this.bobPhase)) * 0.055 * this.bobAmount;
    const bobX = Math.sin(this.bobPhase) * 0.03 * this.bobAmount;
    const roll =
      Math.sin(this.bobPhase) * 0.012 * this.bobAmount +
      (still ? 0 : Math.sin(this.hurtKick * Math.PI) * 0.1 * this.hurtKick);
    const boost = still ? 1 : this.sprinting ? (this.flying ? 1.12 : 1.1) : 1;
    this.fovBoost = damp(this.fovBoost, boost, d, 9);
    const fov = this.baseFov * this.fovBoost;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.rotation.set(this.pitch, this.yaw, roll, 'YXZ');
    // Sideways sway along the camera's right, so it follows the view.
    this.camera.position.set(
      this.eyeBase.x + Math.cos(this.yaw) * bobX,
      this.eyeBase.y +
        bobY -
        0.03 * this.bobAmount -
        (still ? 0 : this.landDip) +
        this.panoramaLift,
      this.eyeBase.z - Math.sin(this.yaw) * bobX,
    );
  }
  punch() {
    this.held.punch();
    this.avatar.punch(this.clock.phase);
  }
  get cameraMode(): CameraMode {
    return this.viewMode;
  }
  /** F5: first person, over the shoulder from behind, or facing the player. */
  set cameraMode(mode: CameraMode) {
    if (mode === this.viewMode) return;
    this.viewMode = mode;
    this.cameraDistance = 0;
    this.needsFrame = true;
  }
  /** Wears a skin: the rig variant for the body, its colours for the first-person arm. */
  setPlayerSkin(variant: number, skin: PlayerSkin) {
    this.playerVariant = variant;
    this.avatar.setVariant(variant);
    for (const p of this.previews) p.setVariant(variant);
    this.held.wearSkin(skin);
    this.needsFrame = true;
  }
  /** A figure of the player for the inventory or the settings; call `start()` when it is shown. */
  createAvatarPreview(canvas: HTMLCanvasElement) {
    const preview = new AvatarPreview(
      canvas,
      this.models,
      this.atlas.texture,
      (key) => this.held.model(key),
      this.playerVariant,
    );
    this.previews.add(preview);
    if (this.avatarState) this.dressPreview(preview, this.avatarState);
    return preview;
  }
  private wornArmor(s: SimulationSnapshot) {
    const armor: (string | null)[] = [null, null, null, null];
    for (let i = 36; i < 40; i++) {
      const key = s.inventory[i]?.[0];
      const piece = key ? itemRegistry.find(key)?.armor?.slot : undefined;
      if (key && piece) armor[ARMOR_SLOT_ORDER.indexOf(piece)] = key;
    }
    return armor;
  }
  private dressPreview(p: AvatarPreview, s: SimulationSnapshot) {
    p.dress(s.inventory[s.selected]?.[0] ?? null, s.inventory[40]?.[0] ?? null, this.wornArmor(s));
  }
  /** Repaints the uploaded-skin variants of the player rig. */
  wearCustomSkin(skin: PlayerSkin) {
    this.models.wearCustom(skin);
    this.needsFrame = true;
  }
  /** Places a third-person camera behind or in front of the eye, stopped short of walls. */
  private thirdPerson(dt: number) {
    if (this.viewMode === 'first') return;
    const front = this.viewMode === 'front';
    this.lookDir.set(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    if (!front) this.lookDir.negate();
    this.eyeNow.copy(this.eyeBase);
    const room = this.room.distance(this.eyeNow, this.lookDir, 4);
    this.cameraDistance =
      room < this.cameraDistance || this.reducedMotion || this.clock.paused
        ? room
        : Math.min(room, this.cameraDistance + Math.max(0.5, room - this.cameraDistance) * dt * 6);
    this.camera.position.copy(this.eyeNow).addScaledVector(this.lookDir, this.cameraDistance);
    this.camera.rotation.set(
      front ? -this.pitch : this.pitch,
      this.yaw + (front ? Math.PI : 0),
      0,
      'YXZ',
    );
  }
  /**
   * Other players of a network game. Poses arrive about ten times a second; bodies glide to them
   * so a friend walks smoothly instead of stepping from update to update.
   */
  setRemotePlayers(list: readonly RemotePlayerView[]) {
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.id);
      let r = this.remotes.get(p.id);
      if (!r) {
        const avatar = new PlayerAvatar(
          this.models,
          this.atlas.texture,
          (key) => this.held.model(key),
          p.skin < BUILTIN_SKINS.length ? p.skin : 0,
        );
        for (const extra of avatar.extras) this.scene.add(extra);
        const tag = nameTag(p.name);
        this.scene.add(tag);
        r = {
          avatar,
          tag,
          view: p,
          x: p.x,
          y: p.y,
          z: p.z,
          yaw: p.yaw,
          pitch: p.pitch,
          swings: p.swings,
        };
        this.remotes.set(p.id, r);
      }
      r.view = p;
    }
    for (const [id, r] of this.remotes)
      if (!seen.has(id)) {
        for (const extra of r.avatar.extras) this.scene.remove(extra);
        this.scene.remove(r.tag);
        r.tag.material.map?.dispose();
        r.tag.material.dispose();
        r.avatar.dispose();
        this.remotes.delete(id);
      }
    this.needsFrame = true;
  }
  get remoteCount() {
    return this.remotes.size;
  }
  private drawRemotes(dt: number, time: number) {
    const k = 1 - Math.exp(-dt * 12);
    for (const r of this.remotes.values()) {
      const v = r.view;
      // A teleport or a portal is a jump, not a glide across the map.
      if (Math.hypot(v.x - r.x, v.y - r.y, v.z - r.z) > 8) {
        r.x = v.x;
        r.y = v.y;
        r.z = v.z;
      } else {
        r.x += (v.x - r.x) * k;
        r.y += (v.y - r.y) * k;
        r.z += (v.z - r.z) * k;
      }
      r.yaw += Math.atan2(Math.sin(v.yaw - r.yaw), Math.cos(v.yaw - r.yaw)) * k;
      r.pitch += (v.pitch - r.pitch) * k;
      if (v.swings !== r.swings) {
        r.swings = v.swings;
        r.avatar.punch(time);
      }
      const visible = v.visible !== false;
      r.tag.visible = visible;
      if (!visible) {
        for (const extra of r.avatar.extras) extra.visible = false;
        continue;
      }
      const g = r.avatar.update(
        {
          x: r.x,
          y: r.y,
          z: r.z,
          yaw: r.yaw,
          pitch: r.pitch,
          onGround: v.onGround,
          flying: v.flying,
          crouching: v.crouching,
          sprinting: false,
          riding: false,
          using: null,
          held: v.held,
          offhand: null,
          armor: NO_ARMOR,
          mining: false,
          dead: false,
        },
        dt,
        time,
        this.reducedMotion,
      );
      this.batches.add(g, false);
      r.tag.position.set(r.x, r.y + (v.crouching ? 2.05 : 2.25), r.z);
      if (v.onGround && this.shadows.count < 256) {
        this.position.set(r.x, r.y + 0.014, r.z);
        this.scale.set(0.84, 0.78, 1);
        this.matrix.compose(this.position, this.shadowRotation, this.scale);
        this.shadows.setMatrixAt(this.shadows.count++, this.matrix);
      }
    }
  }
  /** Poses and batches the player's own body when a third-person camera can see it. */
  private drawAvatar(dt: number, time: number) {
    const s = this.avatarState;
    const show = this.viewMode !== 'first' && !!s && this.playing;
    if (!show || !s) {
      for (const extra of this.avatar.extras) extra.visible = false;
      return;
    }
    const slot = (i: number) => s.inventory[i]?.[0] ?? null;
    const armor = this.wornArmor(s);
    const held = slot(s.selected);
    const use = s.use;
    const frame: AvatarFrame = {
      x: this.eyeBase.x,
      y: this.eyeBase.y - this.eyeHeight,
      z: this.eyeBase.z,
      yaw: this.yaw,
      pitch: this.pitch,
      onGround: s.player.onGround,
      flying: s.player.flying,
      crouching: !!s.motion?.crouching,
      sprinting: !!s.motion?.sprinting,
      riding: !!s.motion?.riding,
      using: use?.active
        ? use.eating
          ? 'eat'
          : use.blocking
            ? 'block'
            : held && itemRegistry.find(held)?.use === 'bow'
              ? 'bow'
              : null
        : null,
      held,
      offhand: slot(40),
      armor,
      mining: !!s.mining,
      dead: s.survival.dead,
    };
    const g = this.avatar.update(frame, dt, time, this.reducedMotion);
    this.batches.add(g, this.hurtKick > 0.35 && !this.reducedMotion);
    if (s.player.onGround && this.shadows.count < 256) {
      this.position.set(frame.x, frame.y + 0.014, frame.z);
      this.scale.set(0.84, 0.78, 1);
      this.matrix.compose(this.position, this.shadowRotation, this.scale);
      this.shadows.setMatrixAt(this.shadows.count++, this.matrix);
    }
  }
  private blockColor(id: number) {
    let color = this.colors.get(id);
    if (!color) {
      const tile = registry.get(id).textures[1];
      const pixels = this.atlas.canvas
        .getContext('2d')!
        .getImageData((tile % 16) * 18 + 1, Math.floor(tile / 16) * 18 + 1, 16, 16).data;
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i + 3] > 128) {
          r += pixels[i];
          g += pixels[i + 1];
          b += pixels[i + 2];
          n++;
        }
      color = new THREE.Color().setRGB(
        r / Math.max(1, n) / 255,
        g / Math.max(1, n) / 255,
        b / Math.max(1, n) / 255,
        THREE.SRGBColorSpace,
      );
      this.colors.set(id, color);
    }
    return color;
  }
  /** Creatures turn their head towards a nearby viewer, within what a neck allows. */
  private lookAtViewer(
    g: THREE.Group,
    p: { x: number; y: number; z: number; yaw: number },
    kind: string,
  ) {
    const c = this.camera.position,
      dx = c.x - p.x,
      dz = c.z - p.z,
      flat = Math.hypot(dx, dz);
    if (flat > 8 || flat < 0.3) return undefined;
    const rel = Math.atan2(
      Math.sin(Math.atan2(-dx, -dz) - p.yaw),
      Math.cos(Math.atan2(-dx, -dz) - p.yaw),
    );
    if (Math.abs(rel) > 1.9) return undefined;
    const eye = p.y + (mobDefinition(kind)?.height ?? 1.6) * 0.85 * g.scale.y;
    return {
      yaw: Math.max(-1.1, Math.min(1.1, rel)),
      pitch: Math.max(-0.6, Math.min(0.6, Math.atan2(c.y - eye, flat))),
    };
  }
  private updateBodies(
    map: Map<number, Body> | Map<string, Body>,
    dt: number,
    time: number,
    ambient: boolean,
  ) {
    for (const b of map.values()) {
      const p = b.track.advance(dt),
        g = b.group;
      g.position.set(p.x, p.y, p.z);
      g.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
      if (b.kind === 'orb' && !this.reducedMotion) {
        g.position.y += Math.sin(time * 3 + g.userData.seed) * 0.035;
        g.rotation.y = time;
        g.rotation.z = 0.25;
      }
      if (b.kind === 'skull' && !this.reducedMotion) g.rotation.set(time * 2, time * 3, time);
      if (g.userData.spin && !this.reducedMotion)
        g.rotation.set(time * g.userData.spin, time * g.userData.spin * 0.7, 0);
      g.userData.travel = b.track.walked;
      if (b.kind.startsWith('lab:')) g.userData.look = this.lookAtViewer(g, p, b.kind);
      this.models.animate(g, time, b.track.speed, this.reducedMotion, dt);
      this.sphere.center.set(p.x, p.y + b.radius * 0.4, p.z);
      this.sphere.radius = b.radius;
      const far = b.radius >= 3 ? 150 : Math.max(48, this.radius * 16 + 20);
      if (
        this.sphere.center.distanceToSquared(this.camera.position) > far * far ||
        !this.frustum.intersectsSphere(this.sphere)
      )
        continue;
      this.batches.add(
        g,
        b.hurt && !this.reducedMotion,
        this.reducedMotion ? 0 : (g.userData.glow ?? 0),
      );
      if (b.grounded && this.shadows.count < 256) {
        this.position.set(p.x, p.y + 0.014, p.z);
        const width = mobDefinition(b.kind)?.width ?? 0.6;
        this.scale.set(width * 1.4, width * 1.3, 1);
        this.matrix.compose(this.position, this.shadowRotation, this.scale);
        this.shadows.setMatrixAt(this.shadows.count++, this.matrix);
      }
      if (
        ambient &&
        ((b.kind === 'arrow' && b.track.speed > 0.5) ||
          b.kind === 'skull' ||
          b.kind === 'fireball' ||
          b.kind === 'ghast_fireball' ||
          b.kind === 'lab:blaze' ||
          b.kind === 'lab:magma_cube')
      )
        this.particles.ambient(
          p.x,
          p.y +
            (b.kind === 'fireball' ? 0 : b.kind === 'lab:blaze' ? 0.3 + this.jitter() * 1.2 : 0.3),
          p.z,
          b.kind === 'lab:blaze' ||
            b.kind === 'fireball' ||
            b.kind === 'ghast_fireball' ||
            b.kind === 'lab:magma_cube'
            ? 'fire'
            : b.kind === 'skull'
              ? 'portal'
              : 'trail',
        );
      if (ambient && b.kind.startsWith('lab:')) this.creatureParticles(b, p);
    }
  }
  private jitterSeq = 0;
  /** Presentation-only scatter: deterministic and never the gameplay RNG. */
  private jitter() {
    return pixelNoise(++this.jitterSeq, 91);
  }
  /** Flames on a burning creature, the enderman's motes, hearts over animals in love. */
  private creatureParticles(b: Body, p: { x: number; y: number; z: number }) {
    const ud = b.group.userData,
      def = mobDefinition(b.kind),
      h = (def?.height ?? 1.5) * (ud.baseScale ?? 1),
      w = (def?.width ?? 0.6) * (ud.baseScale ?? 1);
    const at = (k: number) => (this.jitter() - 0.5) * w * k;
    if (ud.burning) {
      for (let i = 0; i < 2; i++)
        this.particles.ambient(p.x + at(1), p.y + this.jitter() * h, p.z + at(1), 'fire');
      if (this.jitter() < 0.3) this.particles.ambient(p.x, p.y + h, p.z, 'smoke');
    }
    if (b.kind === 'lab:enderman' && this.jitter() < (ud.aggressive ? 0.9 : 0.4))
      this.particles.ambient(p.x + at(2), p.y + this.jitter() * h, p.z + at(2), 'portal');
    if (b.kind === 'lab:blaze' && ud.charge > 0)
      this.particles.ambient(p.x + at(2), p.y + this.jitter() * h, p.z + at(2), 'smoke');
    if (ud.love && this.jitter() < 0.18) this.particles.ambient(p.x, p.y + h + 0.1, p.z, 'heart');
  }
  render(dt: number, _wallTime = 0) {
    this.needsFrame = false;
    this.currentTime = this.clock.advance(dt);
    const time = this.clock.phase;
    const step = this.clock.paused ? 0 : Math.max(0, Math.min(1, time - this.lastPhase));
    this.lastPhase = time;
    const alpha = this.clock.paused ? 1 : this.tickAlpha(performance.now());
    this.eyeHeight =
      this.clock.paused || this.reducedMotion ? this.yEye : damp(this.eyeHeight, this.yEye, dt, 18);
    this.eyeBase.lerpVectors(this.tickFrom, this.tickTo, alpha);
    this.eyeBase.y += this.eyeHeight;
    this.updateCameraFeel(dt);
    this.thirdPerson(dt);
    this.camera.updateMatrixWorld();
    this.drawBobber(alpha, dt);
    this.atmosphere.update(
      this.camera,
      this.currentTime,
      time,
      this.dimension,
      this.settings,
      this.reducedMotion,
      this.medium,
      { rain: this.weather.rain, thunder: this.weather.thunder, flash: this.weatherView.flash },
    );
    const e = this.atmosphere.state;
    this.far.update(this.camera.position);
    const reach = this.far.distance;
    this.atmosphere.farDistance = reach;
    const far = Math.max(420, reach * 1.5 + 96);
    if (this.camera.far !== far) {
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
    this.terrainMaterials.sky.value = e.sky;
    this.terrainMaterials.ambient.value = e.ambient;
    this.terrainMaterials.time.value = time;
    this.terrainMaterials.motion.value = this.reducedMotion ? 0 : 1;
    this.matrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.matrix);
    this.batches.begin();
    this.shadows.count = 0;
    const ambient =
      !this.clock.paused &&
      !this.reducedMotion &&
      this.settings.particles &&
      time - this.lastAmbient > 0.11;
    if (ambient) this.lastAmbient = time;
    this.updateBodies(this.mobs, step, time, ambient);
    this.updateBodies(this.arrows, step, time, ambient);
    this.updateBodies(this.orbs, step, time, false);
    this.updateBodies(this.special, step, time, ambient);
    for (let i = this.retiring.length - 1; i >= 0; i--) {
      const r = this.retiring[i];
      r.left -= step;
      if (r.left <= 0 || this.reducedMotion) {
        this.retiring.splice(i, 1);
        continue;
      }
      // The reference death: a red creature tips onto its side over twenty ticks, then
      // vanishes in a puff (the puff is the death event's particles).
      const g = r.body.group;
      g.rotation.z = Math.min(1, Math.sqrt((1 - r.left) * 1.6)) * Math.PI * 0.5;
      this.batches.add(g, true);
    }
    this.drawAvatar(dt, time);
    this.drawRemotes(dt, time);
    this.batches.finish();
    this.shadows.visible = this.shadows.count > 0;
    if (this.shadows.count) {
      this.shadows.instanceMatrix.clearUpdateRanges();
      this.shadows.instanceMatrix.addUpdateRange(0, this.shadows.count * 16);
      this.shadows.instanceMatrix.needsUpdate = true;
    }
    this.drops.begin();
    const limit = QUALITY[this.settings.preset].visibleDrops;
    for (const [id, item] of this.items) {
      const p = item.track.advance(step);
      this.position.set(
        p.x,
        p.y + 0.13 + (this.reducedMotion ? 0 : Math.sin(time * 2.6 + id) * 0.025),
        p.z,
      );
      if (
        this.drops.mesh.count >= limit ||
        this.position.distanceToSquared(this.camera.position) > 48 * 48
      )
        continue;
      this.sphere.center.copy(this.position);
      this.sphere.radius = 0.4;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      this.scale.setScalar(1);
      this.matrix.compose(this.position, this.camera.quaternion, this.scale);
      this.drops.add(this.matrix, item.tile);
    }
    this.drops.finish();
    this.particles.enabled = this.settings.particles && !this.reducedMotion;
    this.particles.limit = QUALITY[this.settings.preset].particles;
    if (ambient) {
      // Every emitter in reach gets its turn: a rotating window over them, not the first few.
      this.ambientTurn++;
      const near = this.nearEmitters;
      near.length = 0;
      const c = this.camera.position;
      for (const entry of this.meshes.values())
        for (const p of entry.emitters)
          if ((p.x - c.x) ** 2 + (p.y - c.y) ** 2 + (p.z - c.z) ** 2 < 14 ** 2) near.push(p);
      const budget = Math.min(near.length, 14);
      for (let k = 0; k < budget; k++) {
        const p = near[(this.ambientTurn * budget + k) % near.length];
        // Drips and lava pops come now and then, flames every time.
        const every =
          p.kind === 'drip-water' || p.kind === 'drip-lava' ? 9 : p.kind === 'lava' ? 3 : 1;
        if ((this.ambientTurn + Math.floor(p.x * 3 + p.z * 5)) % every !== 0) continue;
        this.particles.ambient(p.x, p.y, p.z, p.kind);
      }
    }
    if (ambient && this.medium === 'water') {
      // Air escaping in water: a few bubbles rising in front of the eyes.
      const c = this.camera.position;
      this.position.set(0, 0, -1.2).applyQuaternion(this.camera.quaternion);
      for (let k = 0; k < 2; k++)
        this.particles.ambient(
          c.x + this.position.x + Math.sin(time * 7 + k * 2) * 0.5,
          c.y - 0.6,
          c.z + this.position.z + Math.cos(time * 5 + k * 3) * 0.5,
          'bubble',
        );
    }
    this.weatherView.advance(
      step,
      time,
      this.camera,
      QUALITY[this.settings.preset].particles / 320,
      this.reducedMotion || !this.settings.particles,
    );
    this.particles.advance(step);
    this.held.animate(step, time, this.playing, this.reducedMotion);
    if (!this.handVisible || this.viewMode !== 'first') this.held.root.visible = false;
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
    if (this.held.root.visible) {
      // Like the reference, the hand gets a fresh depth buffer: arm and item hide each other
      // properly (the fist closes over the handle) yet never sink into a wall in front of you.
      const autoClear = this.renderer.autoClear;
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      // Its own camera at the same place, with a fixed field of view: the arm keeps its size and
      // corner when the player widens the view or the sprint zoom kicks in.
      this.handCamera.matrixWorld.copy(this.camera.matrixWorld);
      this.handCamera.matrixWorldInverse.copy(this.camera.matrixWorldInverse);
      this.renderer.render(this.scene, this.handCamera);
      this.renderer.autoClear = autoClear;
    }
  }
  private syncBobber(b: { x: number; y: number; z: number; bite: boolean } | null) {
    if (!b) {
      this.bobber.visible = this.fishingLine.visible = false;
      this.bobberAt = -1;
      return;
    }
    const fresh = this.bobberAt < 0;
    this.bobberAt = this.tick;
    if (fresh) this.bobberFrom.set(b.x, b.y, b.z);
    else this.bobberFrom.lerp(this.bobberTo, 1);
    this.bobberTo.set(b.x, b.y, b.z);
    if (fresh) this.bobberFrom.copy(this.bobberTo);
    this.bobberBite = b.bite;
    this.bobber.visible = this.fishingLine.visible = true;
  }
  /** Moves the bobber between ticks and hangs the line from the rod tip to it, sagging. */
  private drawBobber(alpha: number, dt: number) {
    if (!this.bobber.visible) return;
    // A bite pulls the bobber under for a moment.
    this.bobberDip = damp(this.bobberDip, this.bobberBite ? 0.28 : 0, dt, 14);
    this.bobber.position.lerpVectors(this.bobberFrom, this.bobberTo, alpha);
    this.bobber.position.y -= this.bobberDip;
    // The rod tip: in first person just right of the view, as the held rod ends there;
    // otherwise above the player's right hand.
    const tip = this.position;
    if (this.viewMode === 'first') {
      // The held rod is drawn by the hand camera, so its tip sits at a fixed place on the
      // screen whatever the field of view: find the world point one block along that ray.
      tip.set(ROD_TIP_SCREEN[0], ROD_TIP_SCREEN[1], 0.5).unproject(this.camera);
      tip.sub(this.camera.position).normalize().add(this.camera.position);
    } else {
      const yaw = this.avatarState?.look.yaw ?? 0;
      tip.set(this.eyeBase.x, this.eyeBase.y - 0.1, this.eyeBase.z);
      tip.x += -Math.sin(yaw) * 1.1 - Math.cos(yaw) * 0.35;
      tip.z += -Math.cos(yaw) * 1.1 + Math.sin(yaw) * 0.35;
    }
    const end = this.bobber.position;
    const attribute = this.fishingLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const span = Math.hypot(end.x - tip.x, end.z - tip.z);
    const sag = Math.min(1.2, span * 0.045);
    for (let i = 0; i < FISHING_LINE_POINTS; i++) {
      const t = i / (FISHING_LINE_POINTS - 1);
      attribute.setXYZ(
        i,
        tip.x + (end.x - tip.x) * t,
        // Slack, but never through the water under the bobber.
        Math.max(end.y + 0.12, tip.y + (end.y + 0.16 - tip.y) * t - Math.sin(Math.PI * t) * sag),
        tip.z + (end.z - tip.z) * t,
      );
    }
    attribute.needsUpdate = true;
    this.needsFrame = true;
  }
  reset() {
    this.needsFrame = true;
    for (const entry of this.meshes.values()) this.disposeTerrain(entry);
    this.meshes.clear();
    this.far.clearMask();
    this.mobs.clear();
    this.arrows.clear();
    this.orbs.clear();
    this.special.clear();
    this.retiring = [];
    this.deathCues = [];
    this.lastLanding = 0;
    this.lastPhase = 0;
    this.items.clear();
    this.faces = this.bufferBytes = 0;
    this.batches.reset();
    this.drops.begin();
    this.drops.finish();
    this.particles.reset();
    this.weatherView.reset();
    this.lastHealth = -1;
    this.hurtKick = this.landDip = this.bobAmount = 0;
    this.held.reset();
    this.avatar.reset();
    this.shadows.count = 0;
    this.shadows.visible = false;
    this.positioned = false;
    this.outline.visible = this.breakOverlay.visible = false;
    this.clock.reset();
    this.lastAmbient = 0;
    this.frameStats.reset();
  }
  get environment() {
    return {
      dimension: this.dimension,
      sunVisible: this.atmosphere.sun.visible,
      moonVisible: this.atmosphere.moon.visible,
      starsOpacity: this.atmosphere.stars.material.opacity,
      cloudsVisible: this.atmosphere.clouds.visible,
      cloudDrawCalls: this.atmosphere.clouds.visible ? 1 : 0,
      daylight: this.terrainMaterials.sky.value,
      time: this.currentTime,
      medium: this.medium,
    };
  }
  get resourceStats() {
    return {
      renderFrame: this.renderer.info.render.frame,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      programs: this.renderer.info.programs?.length ?? 0,
      entityObjects: this.mobs.size + this.arrows.size + this.orbs.size + this.special.size,
      entityDrawCalls: this.batches.draws,
      entityParts: this.batches.visibleParts,
      particles: this.particles.active,
      terrainBytes: this.bufferBytes,
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      droppedItemDrawCalls: this.drops.mesh.visible ? 1 : 0,
    };
  }
  get animationStats() {
    return {
      phase: this.clock.phase,
      paused: this.clock.paused,
      held: this.held.animation,
      mobs: [...this.mobs.entries()].slice(0, 6).map(([id, b]) => ({
        id,
        position: { ...b.track.value },
        authoritative: { ...b.track.to },
        speed: b.track.speed,
      })),
      particles: this.particles.active,
      emitters: [...this.meshes.values()].reduce((n, e) => n + e.emitters.length, 0),
      weather: {
        ...this.weather,
        drops: this.weatherView.drops.count,
        flash: this.weatherView.flash,
      },
      camera: { fov: this.camera.fov, bob: this.bobAmount },
    };
  }
  /** The seed and preset whose horizon to draw, or null where there is no far terrain. */
  setFarWorld(world: { seed: string; preset: string } | null) {
    this.needsFrame = true;
    this.far.setWorld(world);
  }
  /** Wires the far-terrain worker: requests go out through `post`, replies come in here. */
  connectFar(post: (request: FarRequest) => void) {
    this.far.post = post;
  }
  receiveFar(reply: FarReply) {
    this.needsFrame = true;
    this.far.receive(reply);
  }
  get farStats() {
    return { active: this.far.active, tiles: this.far.tileCount, vertices: this.far.vertexCount };
  }
  dispose() {
    this.far.disposeAll();
    this.reset();
    this.resizeObserver.disconnect();
    this.batches.dispose();
    this.drops.dispose();
    this.particles.dispose();
    this.weatherView.dispose();
    this.models.dispose();
    this.held.dispose();
    this.atmosphere.dispose();
    this.terrainMaterials.dispose();
    this.skin.dispose();
    this.outline.geometry.dispose();
    (this.outline.material as THREE.Material).dispose();
    this.breakOverlay.geometry.dispose();
    this.breakOverlay.material.dispose();
    for (const t of this.cracks) t.dispose();
    this.avatar.dispose();
    for (const p of this.previews) p.dispose();
    this.shadows.dispose();
    this.shadows.geometry.dispose();
    this.shadows.material.dispose();
    this.shadowTexture.dispose();
    this.atlas.texture.dispose();
    this.renderer.dispose();
  }
}
