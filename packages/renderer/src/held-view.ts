import * as THREE from 'three';
import { FirstPersonArm } from './first-person-arm';
import { BUILTIN_SKINS, type PlayerSkin } from './player-skins';
import { registry } from '../../content/src/blocks';
import { itemRegistry } from '../../content/src/items';
import type { SimulationSnapshot } from '../../core/src/simulation';
import { ATLAS_COLS, ATLAS_ROWS, TILE_STRIDE } from './mesher';
import { itemTile } from './textures';
import { heldPose, damp } from './animation';
import { renderBoxes, type Box } from '../../content/src/shapes';
/** The bow sprite's string runs along its (−1, 1) diagonal. */
const BOW_STRING = new THREE.Vector3(-1, 1, 0).normalize();
/** How far the limb turns about the string at full draw (radians). */
let BOW_TURN = 0.35;
/** Drawing brings the bow in toward the centre of the view and up a little. */
let DRAW_IN = 0.3,
  DRAW_UP = 0.12;
/** The nocked arrow, in view space: from the fist toward the crosshair, tip ahead of the bow. */
const ARROW_DIR = new THREE.Vector3(-0.45, 0.3, -1).normalize();
const ARROW_OFFSET = new THREE.Vector3(-0.04, 0.07, 0);
let ARROW_REACH = 0.34,
  ARROW_PULL = 0.18,
  ARROW_SCALE = 0.65;
/** Turns the arrow sprite's (1, 1) diagonal onto ARROW_DIR, its flat side toward the right. */
const ARROW_AIM = (() => {
  const a = new THREE.Vector3(1, 1, 0).normalize(),
    z = new THREE.Vector3(0, 0, 1);
  const source = new THREE.Matrix4().makeBasis(a, z.clone().cross(a), z);
  const n = new THREE.Vector3(0.8, 0.2, 0.6);
  n.addScaledVector(ARROW_DIR, -n.dot(ARROW_DIR)).normalize();
  const target = new THREE.Matrix4().makeBasis(ARROW_DIR, n.clone().cross(ARROW_DIR), n);
  return new THREE.Quaternion().setFromRotationMatrix(target.multiply(source.transpose()));
})();
/** Render layer of the first-person view: drawn in a second pass over a cleared depth buffer. */
export const HELD_LAYER = 1;
/** Where the arm rests: reaching in from the lower right, the fist a little right of centre. */
/**
 * Where the arm rests, for the hand camera's fixed 70° view: the shoulder just off the lower
 * right corner and the fist in the lower right quarter, well clear of the crosshair — like the
 * reference, not reaching into the middle of the screen.
 */
const REST_POSITION = new THREE.Vector3(0.86, -0.72, -0.52);
const REST_ROTATION = new THREE.Euler(0.36, 0.2, -0.06, 'YXZ');
/** The hand is drawn with this vertical field of view whatever the player's setting. */
export const HAND_FOV = 70;
/**
 * The rest pose is tuned for 16:9. A narrower or wider window moves the arm sideways so the fist
 * keeps its place on screen (x of the fist ≈ 0.48 of the half-width at a depth of 1.2).
 */
const ARM_WIDEN = 0.48 * 1.21 * Math.tan(((HAND_FOV / 2) * Math.PI) / 180);
function aspectShift(aspect: number) {
  return ARM_WIDEN * (Math.min(2.6, Math.max(0.5, aspect)) - 16 / 9);
}
interface HoldPose {
  /** The item's own "up" (handle → head for tools), in its local units. */
  axis: [number, number, number];
  /** Where that axis points, as a blend of the arm's direction, view up and view right. */
  along: number;
  up: number;
  right: number;
  /** Which way the item's face turns (view space; +z is toward the camera). */
  face: [number, number, number];
  scale: number;
  /** The point of the item that sits in the fist, in the item's own units. */
  point: [number, number, number];
}
const HOLD: Record<'tool' | 'item' | 'plant' | 'block' | 'bow', HoldPose> = {
  // Tools and swords: gripped low on the handle (sprite pixel ≈ 3,12), a full-size blade or head
  // leaning up, left and away from the fist toward the crosshair, its flat turned to the eye —
  // the reference's diagonal, now with the hand around the handle.
  tool: {
    axis: [1, 1, 0],
    along: 1,
    up: 0.6,
    right: -0.3,
    face: [0.3, 0.3, 1],
    scale: 0.75,
    point: [-0.28, -0.28, 0],
  },
  item: {
    axis: [0, 1, 0],
    along: 0.6,
    up: 1,
    right: -0.1,
    face: [0.3, 0.3, 1],
    scale: 0.55,
    point: [0, -0.3, 0],
  },
  // Torches, flowers and rails: held by the bottom of the stem.
  plant: {
    axis: [0, 1, 0],
    along: 0.8,
    up: 1,
    right: -0.2,
    face: [0.4, 0.1, 1],
    scale: 0.7,
    point: [0, -0.36, 0],
  },
  // A block rests on the palm, its lower face in the hand.
  block: {
    axis: [0, 1, 0],
    along: 0.25,
    up: 1,
    right: 0,
    face: [-0.6, 0.2, 1],
    scale: 1,
    point: [0, -0.11, 0.02],
  },
  // Upright at the right of the view, the string toward the player, as in the reference.
  bow: {
    axis: [-1, 1, 0],
    along: 0,
    up: 1,
    right: 0.3,
    face: [0.2, 0, 1],
    scale: 1,
    point: [0.12, 0.17, 0],
  },
};
/** Pixel sprites have real side walls: tools no longer turn into paper when they swing. */
export function extrudeItem(atlas: HTMLCanvasElement, tile: number): THREE.BufferGeometry {
  const x = (tile % ATLAS_COLS) * TILE_STRIDE + 1,
    y = Math.floor(tile / ATLAS_COLS) * TILE_STRIDE + 1,
    pixels = atlas.getContext('2d')!.getImageData(x, y, 16, 16).data;
  const p: number[] = [],
    uv: number[] = [],
    n: number[] = [],
    colors: number[] = [],
    index: number[] = [];
  const quad = (v: number[][], t: number[][], normal: number[], shade = 1) => {
    const base = p.length / 3;
    for (let i = 0; i < 4; i++) {
      p.push(...v[i]);
      uv.push(...t[i]);
      n.push(...normal);
      colors.push(shade, shade, shade);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const texture = (u: number, v: number) => [
    (x + 0.5 + u * 15) / atlas.width,
    1 - (y + 15.5 - v * 15) / atlas.height,
  ];
  const z = 0.035;
  quad(
    [
      [-0.5, -0.5, z],
      [0.5, -0.5, z],
      [0.5, 0.5, z],
      [-0.5, 0.5, z],
    ],
    [texture(0, 0), texture(1, 0), texture(1, 1), texture(0, 1)],
    [0, 0, 1],
  );
  quad(
    [
      [0.5, -0.5, -z],
      [-0.5, -0.5, -z],
      [-0.5, 0.5, -z],
      [0.5, 0.5, -z],
    ],
    [texture(1, 0), texture(0, 0), texture(0, 1), texture(1, 1)],
    [0, 0, -1],
    0.85,
  );
  const solid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < 16 && y < 16 && pixels[(y * 16 + x) * 4 + 3] > 100;
  for (let py = 0; py < 16; py++)
    for (let px = 0; px < 16; px++) {
      if (!solid(px, py)) continue;
      const left = px / 16 - 0.5,
        right = (px + 1) / 16 - 0.5,
        top = 0.5 - py / 16,
        bottom = 0.5 - (py + 1) / 16,
        t = [(x + px + 0.5) / atlas.width, 1 - (y + py + 0.5) / atlas.height];
      if (!solid(px - 1, py))
        quad(
          [
            [left, bottom, -z],
            [left, bottom, z],
            [left, top, z],
            [left, top, -z],
          ],
          [t, t, t, t],
          [-1, 0, 0],
          0.6,
        );
      if (!solid(px + 1, py))
        quad(
          [
            [right, bottom, z],
            [right, bottom, -z],
            [right, top, -z],
            [right, top, z],
          ],
          [t, t, t, t],
          [1, 0, 0],
          0.75,
        );
      if (!solid(px, py - 1))
        quad(
          [
            [left, top, z],
            [right, top, z],
            [right, top, -z],
            [left, top, -z],
          ],
          [t, t, t, t],
          [0, 1, 0],
          1,
        );
      if (!solid(px, py + 1))
        quad(
          [
            [left, bottom, -z],
            [right, bottom, -z],
            [right, bottom, z],
            [left, bottom, z],
          ],
          [t, t, t, t],
          [0, -1, 0],
          0.6,
        );
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(index);
  return g;
}
export class HeldView {
  readonly root = new THREE.Group();
  private readonly block: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  private readonly blockGeometries = new Map<number, THREE.BufferGeometry>();
  private readonly arm = new THREE.Group();
  // Drawn after the held item (1001), so the fist closes over a handle instead of under it.
  private readonly fpArm = new FirstPersonArm(1002);
  /** A point inside the fist that every held item hangs from, so items move with the hand. */
  private readonly grip = new THREE.Group();
  /** The grip's transform in held-view space at the rest pose. */
  private readonly gripRest = new THREE.Matrix4();
  private readonly tool: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  private readonly unit = new THREE.BoxGeometry();
  private readonly offhand = new THREE.Group();
  private readonly bow = new THREE.Group();
  private readonly bowSprite: THREE.Mesh;
  /** The bow's resting orientation under the grip; drawing turns it about the string. */
  private readonly bowRest = new THREE.Quaternion();
  private readonly bowTurn = new THREE.Quaternion();
  private readonly gripNow = new THREE.Matrix4();
  private readonly arrow: THREE.Mesh;
  private readonly materials = new Set<THREE.Material>();
  private readonly geometries = new Map<number, THREE.BufferGeometry>();
  private key: string | null = null;
  private swing = 0;
  private equip = 0;
  private bowCharge = 0;
  private landing = 0;
  private moving = 0;
  private state: SimulationSnapshot | null = null;
  constructor(
    camera: THREE.Camera,
    private readonly atlas: { texture: THREE.Texture; canvas: HTMLCanvasElement },
  ) {
    // Per-face shade baked into the unit box, so arm and shield read as solid blocks even under
    // flat light (the reference shades its faces the same way).
    const faceShade = [0.78, 0.78, 1, 0.55, 0.9, 0.66];
    const shades: number[] = [];
    for (const f of faceShade) for (let i = 0; i < 4; i++) shades.push(f, f, f);
    this.unit.setAttribute('color', new THREE.Float32BufferAttribute(shades, 3));
    const mat = (color: string) => {
      const m = new THREE.MeshLambertMaterial({
        color,
        vertexColors: true,
        fog: false,
        depthTest: true,
        depthWrite: true,
      });
      this.materials.add(m);
      return m;
    };
    const box = (w: number, h: number, d: number, color: string) => {
      const mesh = new THREE.Mesh(this.unit, mat(color));
      mesh.scale.set(w, h, d);
      mesh.renderOrder = 1000;
      return mesh;
    };
    // The arm reaches in from the lower right like the reference's: the worn skin's own arm and
    // sleeve, pivoting at the shoulder just off screen with the fist ahead and a little left.
    this.fpArm.group.rotation.x = Math.PI / 2;
    this.fpArm.wear(BUILTIN_SKINS[0]);
    this.arm.add(this.fpArm.group);
    this.arm.position.copy(REST_POSITION);
    this.arm.rotation.copy(REST_ROTATION);
    this.root.add(this.arm);
    // Near the end of the arm and up at the top of the fist (group −z faces up once the arm is
    // raised), so a held item rises out of the hand instead of from inside the forearm.
    this.grip.position.set(0, -11 * FirstPersonArm.PX, -1.5 * FirstPersonArm.PX);
    this.fpArm.group.add(this.grip);
    for (const o of [this.arm, this.fpArm.group, this.grip]) o.updateMatrix();
    this.gripRest
      .copy(this.arm.matrix)
      .multiply(this.fpArm.group.matrix)
      .multiply(this.grip.matrix);
    const blockMat = new THREE.MeshLambertMaterial({
      map: atlas.texture,
      vertexColors: true,
      alphaTest: 0.35,
      fog: false,
      depthTest: true,
      depthWrite: true,
    });
    this.materials.add(blockMat);
    this.block = new THREE.Mesh(new THREE.BufferGeometry(), blockMat);
    this.block.renderOrder = 1001;
    this.block.visible = false;
    const toolMat = new THREE.MeshLambertMaterial({
      map: atlas.texture,
      vertexColors: true,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
      fog: false,
      depthTest: true,
      depthWrite: true,
    });
    this.materials.add(toolMat);
    this.tool = new THREE.Mesh(new THREE.BufferGeometry(), toolMat);
    this.geometries.set(-1, this.tool.geometry);
    this.tool.renderOrder = 1001;
    this.tool.visible = false;
    const shield = box(0.29, 0.4, 0.06, '#a28a63');
    shield.position.z = 0.01;
    const rim = box(0.34, 0.45, 0.045, '#84969a');
    this.offhand.add(rim, shield);
    this.offhand.position.set(-0.52, -0.49, -0.65);
    this.offhand.rotation.y = 0.28;
    this.offhand.visible = false;
    // The bow is its own sprite held at the middle of the limb; while drawing, an arrow sprite
    // lies across it and slides back with the string.
    this.bowSprite = new THREE.Mesh(new THREE.BufferGeometry(), toolMat);
    this.bowSprite.renderOrder = 1001;
    this.arrow = new THREE.Mesh(new THREE.BufferGeometry(), toolMat);
    this.arrow.renderOrder = 1001;
    this.arrow.visible = false;
    this.arrow.scale.setScalar(ARROW_SCALE);
    this.arrow.quaternion.copy(ARROW_AIM);
    this.bow.add(this.bowSprite);
    // The nocked arrow lives in view space, not on the limb: it always points from the fist
    // toward the crosshair however the bow turns, as in the reference.
    this.root.add(this.arrow);
    this.hold(this.bow, HOLD.bow);
    this.bowRest.copy(this.bow.quaternion);
    this.bow.visible = false;
    this.grip.add(this.block, this.tool, this.bow);
    this.root.add(this.offhand);
    camera.add(this.root);
    this.root.visible = false;
    this.root.traverse((object) => object.layers.set(HELD_LAYER));
  }
  setItem(key: string | null) {
    if (key === this.key) return;
    this.key = key;
    this.equip = 1;
    const item = key ? itemRegistry.find(key) : undefined;
    this.block.visible = false;
    this.tool.visible = false;
    this.bow.visible = item?.use === 'bow';
    if (this.bow.visible) {
      this.bowSprite.geometry = this.spriteGeometry(itemTile(key!));
      this.arrow.geometry = this.spriteGeometry(itemTile('lab:arrow'));
    }
    if (!item || this.bow.visible) return;
    if (item.block === undefined) {
      this.tool.visible = true;
      this.hold(this.tool, item.tool ? HOLD.tool : HOLD.item);
      const tile = itemTile(key!);
      let g = this.geometries.get(tile);
      if (!g) {
        g = extrudeItem(this.atlas.canvas, tile);
        this.geometries.set(tile, g);
      }
      this.tool.geometry = g;
      return;
    }
    const def = registry.get(item.block);
    const flat =
      def.shape || def.climbable || def.model?.kind === 'pane' || def.model?.kind === 'door';
    if (flat) {
      // Flowers, saplings, torches, rails, panes and doors are held as their sprite, like tools:
      // a cube of a see-through texture was drawn as a black box.
      const tile = def.textures[def.model?.kind === 'pane' ? 1 : 0];
      let g = this.geometries.get(tile);
      if (!g) {
        g = extrudeItem(this.atlas.canvas, tile);
        this.geometries.set(tile, g);
      }
      this.tool.geometry = g;
      this.hold(this.tool, HOLD.plant);
      this.tool.visible = true;
      return;
    }
    this.block.geometry = this.blockGeometry(item.block);
    this.hold(this.block, HOLD.block);
    this.block.visible = true;
  }
  /** The geometry an item is held as, for the third-person body (shared with the first-person caches). */
  model(key: string): { geometry: THREE.BufferGeometry; kind: 'block' | 'sprite' | 'tool' } | null {
    const item = itemRegistry.find(key);
    if (!item) return null;
    const sprite = (tile: number) => {
      let g = this.geometries.get(tile);
      if (!g) {
        g = extrudeItem(this.atlas.canvas, tile);
        this.geometries.set(tile, g);
      }
      return g;
    };
    if (item.block === undefined)
      return {
        geometry: sprite(itemTile(key)),
        kind: item.tool || item.use === 'bow' ? 'tool' : 'sprite',
      };
    const def = registry.get(item.block);
    if (def.shape || def.climbable || def.model?.kind === 'pane' || def.model?.kind === 'door')
      return { geometry: sprite(def.textures[def.model?.kind === 'pane' ? 1 : 0]), kind: 'sprite' };
    return { geometry: this.blockGeometry(item.block), kind: 'block' };
  }
  /**
   * Puts an item in the fist. `pose` says how it should look at rest (rotation and scale in view
   * space) and which point of the item (in its own units) sits in the grip; the local transform
   * under the grip is solved from that, so the item keeps its look and follows every arm motion.
   */
  private hold(object: THREE.Object3D, pose: HoldPose) {
    const fist = new THREE.Vector3().setFromMatrixPosition(this.gripRest);
    const arm = fist.clone().sub(REST_POSITION).normalize();
    // Target frame in view space: the item's axis → d, its face normal → n.
    const d = arm
      .multiplyScalar(pose.along)
      .add(new THREE.Vector3(pose.right, pose.up, 0))
      .normalize();
    const n = new THREE.Vector3(...pose.face);
    n.addScaledVector(d, -n.dot(d)).normalize();
    const target = new THREE.Matrix4().makeBasis(d, n.clone().cross(d), n);
    const a = new THREE.Vector3(...pose.axis).normalize(),
      z = new THREE.Vector3(0, 0, 1);
    const source = new THREE.Matrix4().makeBasis(a, z.clone().cross(a), z);
    const q = new THREE.Quaternion().setFromRotationMatrix(target.multiply(source.transpose()));
    const offset = new THREE.Vector3(...pose.point).multiplyScalar(pose.scale).applyQuaternion(q);
    const desired = new THREE.Matrix4().compose(
      fist.sub(offset),
      q,
      new THREE.Vector3().setScalar(pose.scale),
    );
    this.gripRest
      .clone()
      .invert()
      .multiply(desired)
      .decompose(object.position, object.quaternion, object.scale);
  }
  private spriteGeometry(tile: number): THREE.BufferGeometry {
    let g = this.geometries.get(tile);
    if (!g) {
      g = extrudeItem(this.atlas.canvas, tile);
      this.geometries.set(tile, g);
    }
    return g;
  }
  /** Development aid: changes a hold pose live and re-equips the current item. */
  tunePose(kind: keyof typeof HOLD, patch: Partial<HoldPose>) {
    Object.assign(HOLD[kind], patch);
    if (kind === 'bow') {
      this.bow.quaternion.identity();
      this.hold(this.bow, HOLD.bow);
      this.bowRest.copy(this.bow.quaternion);
    }
    const turn = (patch as { turn?: number }).turn;
    if (turn !== undefined) BOW_TURN = turn;
    const drawIn = (patch as { drawIn?: number }).drawIn,
      drawUp = (patch as { drawUp?: number }).drawUp;
    if (drawIn !== undefined) DRAW_IN = drawIn;
    if (drawUp !== undefined) DRAW_UP = drawUp;
    const extra = patch as { reach?: number; pull?: number; arrow?: number };
    if (extra.reach !== undefined) ARROW_REACH = extra.reach;
    const off = (patch as { off?: [number, number, number] }).off;
    if (off) ARROW_OFFSET.set(...off);
    if (extra.pull !== undefined) ARROW_PULL = extra.pull;
    if (extra.arrow !== undefined) this.arrow.scale.setScalar((ARROW_SCALE = extra.arrow));
    const key = this.key;
    this.key = null;
    this.setItem(key);
  }
  /** Paints the first-person arm with the worn skin. */
  wearSkin(skin: PlayerSkin) {
    this.fpArm.wear(skin);
  }
  /** The held block drawn from the same boxes as the world: slabs, stairs and fences keep their shape. */
  private blockGeometry(state: number): THREE.BufferGeometry {
    const cached = this.blockGeometries.get(state);
    if (cached) return cached;
    const def = registry.get(state);
    const boxes: readonly Box[] = def.model ? renderBoxes(def.model) : [[0, 0, 0, 1, 1, 1]];
    const positions: number[] = [],
      uvs: number[] = [],
      colors: number[] = [],
      index: number[] = [];
    const tileUV = (tile: number, u: number, v: number): [number, number] => {
      const col = tile % ATLAS_COLS,
        row = Math.floor(tile / ATLAS_COLS);
      return [
        (col * TILE_STRIDE + 1 + u * 16) / (ATLAS_COLS * TILE_STRIDE),
        1 - (row * TILE_STRIDE + 1 + (1 - v) * 16) / (ATLAS_ROWS * TILE_STRIDE),
      ];
    };
    const quad = (
      corners: [number, number, number][],
      normal: [number, number, number],
      tile: number,
      uv: [number, number][],
      shade: number,
    ) => {
      const [a, b, c] = corners;
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
        e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cross = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const facing = cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2] > 0;
      const base = positions.length / 3;
      corners.forEach((corner, i) => {
        positions.push(corner[0] - 0.5, corner[1] - 0.5, corner[2] - 0.5);
        uvs.push(...tileUV(tile, uv[i][0], uv[i][1]));
        colors.push(shade, shade, shade);
      });
      if (facing) index.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else index.push(base, base + 2, base + 1, base, base + 3, base + 2);
    };
    const [top, side, bottom] = [def.textures[0], def.textures[1], def.textures[2]];
    for (const [x0, y0, z0, x1, y1, z1] of boxes) {
      quad(
        [
          [x0, y1, z0],
          [x1, y1, z0],
          [x1, y1, z1],
          [x0, y1, z1],
        ],
        [0, 1, 0],
        top,
        [
          [x0, 1 - z0],
          [x1, 1 - z0],
          [x1, 1 - z1],
          [x0, 1 - z1],
        ],
        1,
      );
      quad(
        [
          [x0, y0, z0],
          [x1, y0, z0],
          [x1, y0, z1],
          [x0, y0, z1],
        ],
        [0, -1, 0],
        bottom,
        [
          [x0, z0],
          [x1, z0],
          [x1, z1],
          [x0, z1],
        ],
        0.55,
      );
      quad(
        [
          [x0, y0, z1],
          [x1, y0, z1],
          [x1, y1, z1],
          [x0, y1, z1],
        ],
        [0, 0, 1],
        side,
        [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
        ],
        0.86,
      );
      quad(
        [
          [x1, y0, z0],
          [x0, y0, z0],
          [x0, y1, z0],
          [x1, y1, z0],
        ],
        [0, 0, -1],
        side,
        [
          [1 - x1, y0],
          [1 - x0, y0],
          [1 - x0, y1],
          [1 - x1, y1],
        ],
        0.86,
      );
      quad(
        [
          [x1, y0, z1],
          [x1, y0, z0],
          [x1, y1, z0],
          [x1, y1, z1],
        ],
        [1, 0, 0],
        side,
        [
          [1 - z1, y0],
          [1 - z0, y0],
          [1 - z0, y1],
          [1 - z1, y1],
        ],
        0.72,
      );
      quad(
        [
          [x0, y0, z0],
          [x0, y0, z1],
          [x0, y1, z1],
          [x0, y1, z0],
        ],
        [-1, 0, 0],
        side,
        [
          [z0, y0],
          [z1, y0],
          [z1, y1],
          [z0, y1],
        ],
        0.72,
      );
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    // Stairs show their step to the camera, not the empty corner.
    if (def.model?.kind === 'stairs') g.rotateY(Math.PI);
    g.scale(0.26, 0.26, 0.26);
    this.blockGeometries.set(state, g);
    return g;
  }
  snapshot(state: SimulationSnapshot) {
    this.state = state;
    this.moving = Math.hypot(state.player.velocity.x, state.player.velocity.z);
  }
  land(strength: number) {
    this.landing = Math.min(1, strength);
  }
  punch() {
    this.swing = 1;
  }
  /** The visible held item (block, sprite or bow), for tests and tools. */
  get heldObject(): THREE.Object3D | null {
    return [this.block, this.tool, this.bow].find((o) => o.visible) ?? null;
  }
  /** The fist point items hang from. */
  get gripPoint(): THREE.Object3D {
    return this.grip;
  }
  /** The bare arm's box group (its origin is the shoulder), for tests and tools. */
  get armBox(): THREE.Object3D {
    return this.fpArm.group;
  }
  /** Width over height of the view; the scene keeps it current. */
  aspect = 16 / 9;
  animate(dt: number, time: number, playing: boolean, reduced: boolean) {
    const s = this.state;
    this.root.visible = playing && !s?.container && !s?.survival.dead;
    if (!this.root.visible) return;
    if (s?.mining && this.swing <= 0) this.swing = 1;
    this.swing = Math.max(0, this.swing - dt * 3.7);
    this.equip = damp(this.equip, 0, dt, 14);
    this.landing = damp(this.landing, 0, dt, 12);
    this.bowCharge = damp(
      this.bowCharge,
      s?.use.bowCharge ? Math.min(1, s.use.bowCharge / s.use.bowTotal) : 0,
      dt,
      18,
    );
    // The arm swings around its own shoulder and carries whatever is in the fist with it.
    // A bare fist punches up toward the crosshair; with something in it the arm chops instead —
    // the fist dips toward the centre and the item tips forward, so the head leads the swing
    // rather than falling back behind the forearm. Drawing a bow brings it in a little.
    const strike = Math.sin(Math.min(1, this.swing) * Math.PI),
      chop = this.key ? strike : 0,
      punch = this.key ? 0 : strike,
      draw = this.bow.visible ? this.bowCharge : 0;
    const widen = aspectShift(this.aspect);
    this.arm.position.set(
      REST_POSITION.x + widen - punch * 0.12 - chop * 0.12 - draw * DRAW_IN,
      REST_POSITION.y + punch * 0.04 - chop * 0.03 + draw * DRAW_UP,
      REST_POSITION.z - punch * 0.08 - chop * 0.06 + draw * 0.03,
    );
    this.arm.rotation.set(
      REST_ROTATION.x + punch * 0.42 - chop * 0.7 + draw * 0.08,
      REST_ROTATION.y + punch * 0.38 + chop * 0.32 + draw * 0.16,
      REST_ROTATION.z - punch * 0.3 - chop * 0.2,
      'YXZ',
    );
    const pose = heldPose({
      time,
      speed: this.moving,
      swing: 0,
      equip: this.equip,
      eating: !!s?.use.eating,
      bow: 0,
      blocking: !!s?.use.blocking && this.key === 'lab:shield',
      landing: this.landing,
      reduced,
    });
    this.root.position.set(pose.x, pose.y, pose.z);
    this.root.rotation.set(pose.rx, pose.ry, pose.rz);
    this.offhand.visible = s?.inventory[40]?.[0] === 'lab:shield' && this.key !== 'lab:shield';
    const block = s?.use.blocking ? 1 : 0;
    this.offhand.position.set(-0.52 - widen + block * 0.14, -0.49 + block * 0.15, -0.65);
    this.offhand.rotation.z = block * -0.15;
    if (this.bow.visible) {
      // The arrow points along the sprite's (1, 1) diagonal, away from the string.
      // Turn the limb away about the string so the nocked arrow points into the view.
      this.bowTurn.setFromAxisAngle(BOW_STRING, this.bowCharge * BOW_TURN);
      this.bow.quaternion.copy(this.bowRest).multiply(this.bowTurn);
      // Nocked with its tip past the limb, sliding back toward the string as it is drawn.
      this.arrow.visible = this.bowCharge > 0.02;
      this.arm.updateMatrix();
      this.gripNow
        .copy(this.arm.matrix)
        .multiply(this.fpArm.group.matrix)
        .multiply(this.grip.matrix);
      const reach = ARROW_REACH - this.bowCharge * ARROW_PULL;
      this.arrow.position
        .setFromMatrixPosition(this.gripNow)
        .addScaledVector(ARROW_DIR, reach)
        .add(ARROW_OFFSET);
    } else this.arrow.visible = false;
  }
  reset() {
    this.swing = this.landing = this.equip = this.bowCharge = 0;
    this.state = null;
    this.root.visible = false;
  }
  get animation() {
    return {
      item: this.key,
      swing: this.swing,
      bow: this.bowCharge,
      equip: this.equip,
      visible: this.root.visible,
    };
  }
  dispose() {
    for (const g of this.geometries.values()) g.dispose();
    this.unit.dispose();
    this.fpArm.dispose();
    for (const g of this.blockGeometries.values()) g.dispose();
    for (const m of this.materials) m.dispose();
    this.root.removeFromParent();
  }
}
