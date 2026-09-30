import * as THREE from 'three';
import { FACE_ORDER, SkinFace, type FaceName, type Rgb, type SkinAtlas } from './mob-skins';
import { partSize, type PlayerSkin } from './player-skins';

/** A 32×32 surface holding the right arm and its sleeve, painted by the worn skin's painters. */
const SIZE = 32;
class ArmSurface {
  readonly pixels = new Uint8Array(SIZE * SIZE * 4);
  private offset(x: number, y: number) {
    // Rows are stored bottom-up like the creature atlas, so the rects match its convention.
    return ((SIZE - 1 - y) * SIZE + x) * 4;
  }
  set(x: number, y: number, c: Rgb | null) {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    const o = this.offset(x, y);
    if (!c) {
      this.pixels.fill(0, o, o + 4);
      return;
    }
    this.pixels.set([c[0], c[1], c[2], 255], o);
  }
  get(x: number, y: number): Rgb {
    const o = this.offset(x, y);
    return [this.pixels[o], this.pixels[o + 1], this.pixels[o + 2]];
  }
}

/** Face rectangles of one w×12×d box inside the surface, starting at row `top`. */
function layout(w: number, d: number, top: number) {
  const h = 12;
  const at: Record<FaceName, [number, number, number, number]> = {
    px: [0, top, d, h],
    nx: [d, top, d, h],
    back: [2 * d, top, w, h],
    front: [2 * d + w, top, w, h],
    top: [2 * d + 2 * w, top, w, d],
    bottom: [2 * d + 2 * w, top + d, w, d],
  };
  return at;
}

/**
 * The first-person right arm, as the reference draws it: the skin's own arm box with the sleeve
 * layer half a pixel over it, reaching in from the lower right with the fist ahead. It uses the
 * held view's no-depth-test convention and repaints itself when the skin changes.
 */
export class FirstPersonArm {
  readonly group = new THREE.Group();
  private readonly surface = new ArmSurface();
  private readonly texture: THREE.DataTexture;
  private readonly materials: THREE.MeshLambertMaterial[] = [];
  private readonly meshes: THREE.Mesh[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private slim: boolean | null = null;
  /** One skin pixel in view units: big enough to read as a limb, as close as the reference's. */
  static readonly PX = 0.0625;
  constructor(order = 1000) {
    this.texture = new THREE.DataTexture(this.surface.pixels, SIZE, SIZE, THREE.RGBAFormat);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < 2; i++) {
      const material = new THREE.MeshLambertMaterial({
        map: this.texture,
        vertexColors: true,
        alphaTest: 0.5,
        fog: false,
        // Depth-tested within the held-view pass, which starts from a cleared depth buffer.
        depthTest: true,
        depthWrite: true,
      });
      this.materials.push(material);
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
      // The sleeve draws after the arm: without a depth test, order is what layers them.
      mesh.renderOrder = order + i;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }
  /** A box of w×12×d pixels hanging from the shoulder (y = 0) with the given rects. */
  private box(w: number, d: number, top: number, inflate: number) {
    const px = FirstPersonArm.PX;
    const g = new THREE.BoxGeometry(
      (w + inflate * 2) * px,
      (12 + inflate * 2) * px,
      (d + inflate * 2) * px,
    );
    g.translate(0, -6 * px, 0);
    const rects = layout(w, d, top);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    // Face shade baked per face like the other held boxes: top brightest, underside darkest.
    const shadeOf: Record<FaceName, number> = {
      px: 0.8,
      nx: 0.8,
      top: 1,
      bottom: 0.55,
      back: 0.66,
      front: 0.92,
    };
    const colors: number[] = [];
    FACE_ORDER.forEach((name, f) => {
      const [x0, y0, fw, fh] = rects[name];
      const rx = x0 / SIZE,
        ry = (SIZE - y0 - fh) / SIZE,
        rw = fw / SIZE,
        rh = fh / SIZE;
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        const u = Math.min(0.9995, Math.max(0.0005, uv.getX(i))),
          t = Math.min(0.9995, Math.max(0.0005, uv.getY(i)));
        uv.setXY(i, rx + u * rw, ry + t * rh);
        colors.push(shadeOf[name], shadeOf[name], shadeOf[name]);
      }
    });
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return g;
  }
  /** Paints the worn skin's right arm and sleeve; rebuilds the boxes when the arm width changes. */
  wear(skin: PlayerSkin) {
    const [w, , d] = partSize('armR', skin.slim);
    if (this.slim !== skin.slim) {
      this.slim = skin.slim;
      for (const g of this.geometries) g.dispose();
      this.geometries.length = 0;
      this.geometries.push(this.box(w, d, 0, 0), this.box(w, d, 16, 0.25));
      this.meshes.forEach((m, i) => (m.geometry = this.geometries[i]));
    }
    this.surface.pixels.fill(0);
    const surface = this.surface as unknown as SkinAtlas;
    for (const [part, top] of [
      ['armR', 0],
      ['sleeveR', 16],
    ] as const) {
      const rects = layout(w, d, top);
      for (const name of FACE_ORDER) {
        const [x0, y0, fw, fh] = rects[name];
        skin.paint[part](new SkinFace(surface, x0, y0, fw, fh, name, `arm/${part}/${name}`));
      }
    }
    this.texture.needsUpdate = true;
  }
  dispose() {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.texture.dispose();
  }
}
