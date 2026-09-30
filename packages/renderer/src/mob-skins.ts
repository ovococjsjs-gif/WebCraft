import * as THREE from 'three';

/**
 * Procedural pixel skins for creatures. Every body part of every creature is a cuboid of the one
 * shared unit geometry; its six faces are rectangles in a single atlas. The rectangles live in a
 * small float texture indexed by (face, part), so the whole crowd — cows, zombies and spiders
 * mixed — is one instanced draw with one material and one texture. Pixels are painted into typed
 * arrays (no DOM), which keeps the painter usable from unit tests and workers.
 */
export type FaceName = 'px' | 'nx' | 'top' | 'bottom' | 'back' | 'front';
/** BoxGeometry emits faces in this order: +x, −x, +y, −y, +z, −z. Creatures look towards −z. */
export const FACE_ORDER: readonly FaceName[] = ['px', 'nx', 'top', 'bottom', 'back', 'front'];
export type Rgb = readonly [number, number, number];
export const ATLAS_SIZE = 512;
export const MAX_SKIN_PARTS = 256;

export function rgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function shade(c: Rgb, k: number): Rgb {
  return [
    Math.max(0, Math.min(255, Math.round(c[0] * k))),
    Math.max(0, Math.min(255, Math.round(c[1] * k))),
    Math.max(0, Math.min(255, Math.round(c[2] * k))),
  ];
}
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}
function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** One face of one part, addressed in picture coordinates as seen from outside (0,0 top-left). */
export class SkinFace {
  private seed: number;
  constructor(
    private readonly atlas: SkinAtlas,
    private readonly x0: number,
    private readonly y0: number,
    readonly w: number,
    readonly h: number,
    readonly name: FaceName,
    seedText: string,
  ) {
    this.seed = hash(seedText) || 1;
  }
  get side() {
    return this.name === 'px' || this.name === 'nx';
  }
  random() {
    this.seed ^= this.seed << 13;
    this.seed ^= this.seed >>> 17;
    this.seed ^= this.seed << 5;
    return (this.seed >>> 0) / 4294967296;
  }
  px(x: number, y: number, c: Rgb | null, glow = 0) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.atlas.set(this.x0 + x, this.y0 + y, c, glow);
  }
  get(x: number, y: number): Rgb {
    return this.atlas.get(this.x0 + x, this.y0 + y);
  }
  rect(x: number, y: number, w: number, h: number, c: Rgb | null, glow = 0) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c, glow);
  }
  /** Base colour with per-pixel brightness jitter: the grain every Minecraft skin has. */
  fill(c: Rgb, noise = 0.07) {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) this.px(x, y, shade(c, 1 + (this.random() * 2 - 1) * noise));
  }
  /** Mottled fill picking from a weighted palette (creeper skin, wool, spider hair). */
  mottle(palette: readonly (readonly [Rgb, number])[]) {
    const total = palette.reduce((s, [, w]) => s + w, 0);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        let r = this.random() * total;
        for (const [c, w] of palette) {
          r -= w;
          if (r <= 0) {
            this.px(x, y, c);
            break;
          }
        }
      }
  }
  /** Darkens (k<1) or lightens the pixels already painted in a rectangle. */
  tone(x: number, y: number, w: number, h: number, k: number) {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const xx = x + i,
          yy = y + j;
        if (xx < 0 || yy < 0 || xx >= this.w || yy >= this.h) continue;
        this.px(xx, yy, shade(this.get(xx, yy), k));
      }
  }
  /** Soft irregular patch, used for cow spots and dirt. */
  blob(cx: number, cy: number, r: number, c: Rgb, noise = 0.05) {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++)
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        const d = Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 1.1);
        if (d < r - 0.4 + this.random() * 0.9)
          this.px(x, y, shade(c, 1 + (this.random() * 2 - 1) * noise));
      }
  }
}
export type SkinPainter = (face: SkinFace) => void;

export class SkinAtlas {
  readonly pixels = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
  readonly glow = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
  readonly rects = new Float32Array(6 * 4 * MAX_SKIN_PARTS);
  readonly texture: THREE.DataTexture;
  readonly glowTexture: THREE.DataTexture;
  readonly rectTexture: THREE.DataTexture;
  private readonly parts = new Map<string, number>();
  /** Where each face of each part was painted, so a worn skin can be repainted in place. */
  private readonly faceRects = new Map<string, [number, number, number, number, FaceName][]>();
  private cursorX = 1;
  private cursorY = 1;
  private rowHeight = 0;
  constructor() {
    const pixelTexture = (data: Uint8Array) => {
      const t = new THREE.DataTexture(data, ATLAS_SIZE, ATLAS_SIZE, THREE.RGBAFormat);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      return t;
    };
    this.texture = pixelTexture(this.pixels);
    this.glowTexture = pixelTexture(this.glow);
    this.rectTexture = new THREE.DataTexture(
      this.rects,
      6,
      MAX_SKIN_PARTS,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.rectTexture.magFilter = THREE.NearestFilter;
    this.rectTexture.minFilter = THREE.NearestFilter;
    this.rectTexture.generateMipmaps = false;
    this.rectTexture.needsUpdate = true;
  }
  get partCount() {
    return this.parts.size;
  }
  /** Data rows run bottom-up so that uv v=1 is the top of a painted face. */
  private offset(x: number, y: number) {
    return ((ATLAS_SIZE - 1 - y) * ATLAS_SIZE + x) * 4;
  }
  set(x: number, y: number, c: Rgb | null, glow = 0) {
    const o = this.offset(x, y);
    if (!c) {
      this.pixels[o + 3] = 0;
      this.glow.fill(0, o, o + 4);
      return;
    }
    this.pixels[o] = c[0];
    this.pixels[o + 1] = c[1];
    this.pixels[o + 2] = c[2];
    this.pixels[o + 3] = 255;
    const g = Math.max(0, Math.min(1, glow));
    this.glow[o] = Math.round(c[0] * g);
    this.glow[o + 1] = Math.round(c[1] * g);
    this.glow[o + 2] = Math.round(c[2] * g);
    this.glow[o + 3] = 255;
  }
  get(x: number, y: number): Rgb {
    const o = this.offset(x, y);
    return [this.pixels[o], this.pixels[o + 1], this.pixels[o + 2]];
  }
  private allocate(w: number, h: number) {
    if (this.cursorX + w + 1 > ATLAS_SIZE) {
      this.cursorX = 1;
      this.cursorY += this.rowHeight + 2;
      this.rowHeight = 0;
    }
    if (this.cursorY + h + 1 > ATLAS_SIZE) throw new Error('creature skin atlas is full');
    const at = [this.cursorX, this.cursorY] as const;
    this.cursorX += w + 2;
    this.rowHeight = Math.max(this.rowHeight, h);
    return at;
  }
  /** Copies the face border into its one-pixel gutter so nearest sampling never bleeds. */
  private gutter(x0: number, y0: number, w: number, h: number) {
    const copy = (sx: number, sy: number, dx: number, dy: number) => {
      const s = this.offset(sx, sy),
        d = this.offset(dx, dy);
      for (let i = 0; i < 4; i++) {
        this.pixels[d + i] = this.pixels[s + i];
        this.glow[d + i] = this.glow[s + i];
      }
    };
    for (let x = -1; x <= w; x++) {
      const sx = x0 + Math.max(0, Math.min(w - 1, x));
      copy(sx, y0, x0 + x, y0 - 1);
      copy(sx, y0 + h - 1, x0 + x, y0 + h);
    }
    for (let y = 0; y < h; y++) {
      copy(x0, y0 + y, x0 - 1, y0 + y);
      copy(x0 + w - 1, y0 + y, x0 + w, y0 + y);
    }
  }
  /**
   * Paints a part once and returns its index. `size` is in skin pixels (w, h, d); faces are
   * w×h (front/back), d×h (sides) and w×d (top/bottom), exactly like Minecraft box UVs.
   */
  part(key: string, size: readonly [number, number, number], paint: SkinPainter): number {
    const known = this.parts.get(key);
    if (known !== undefined) return known;
    const index = this.parts.size;
    if (index >= MAX_SKIN_PARTS) throw new Error('too many creature skin parts');
    const [w, h, d] = size.map((v) => Math.max(1, Math.round(v)));
    const dims: Record<FaceName, readonly [number, number]> = {
      px: [d, h],
      nx: [d, h],
      top: [w, d],
      bottom: [w, d],
      back: [w, h],
      front: [w, h],
    };
    const rects: [number, number, number, number, FaceName][] = [];
    FACE_ORDER.forEach((name, f) => {
      const [fw, fh] = dims[name];
      const [x0, y0] = this.allocate(fw, fh);
      rects.push([x0, y0, fw, fh, name]);
      paint(new SkinFace(this, x0, y0, fw, fh, name, `${key}/${name}`));
      this.gutter(x0, y0, fw, fh);
      const o = (index * 6 + f) * 4;
      this.rects[o] = x0 / ATLAS_SIZE;
      this.rects[o + 1] = (ATLAS_SIZE - y0 - fh) / ATLAS_SIZE;
      this.rects[o + 2] = fw / ATLAS_SIZE;
      this.rects[o + 3] = fh / ATLAS_SIZE;
    });
    this.parts.set(key, index);
    this.faceRects.set(key, rects);
    this.texture.needsUpdate = true;
    this.glowTexture.needsUpdate = true;
    this.rectTexture.needsUpdate = true;
    return index;
  }
  /** Paints an existing part again (a skin the player uploads); false for an unknown part. */
  repaint(key: string, paint: SkinPainter): boolean {
    const rects = this.faceRects.get(key);
    if (!rects) return false;
    for (const [x0, y0, fw, fh, name] of rects) {
      for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) this.set(x0 + x, y0 + y, null);
      paint(new SkinFace(this, x0, y0, fw, fh, name, `${key}/${name}`));
      this.gutter(x0, y0, fw, fh);
    }
    this.texture.needsUpdate = true;
    this.glowTexture.needsUpdate = true;
    return true;
  }
  /** The one material every creature part shares. Instances carry `skinPart`. */
  material(): THREE.MeshLambertMaterial {
    const material = new THREE.MeshLambertMaterial({
      map: this.texture,
      emissiveMap: this.glowTexture,
      emissive: 0xffffff,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });
    material.userData.skinned = true;
    const rects = this.rectTexture;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.skinRects = { value: rects };
      shader.vertexShader =
        'attribute float faceId;\nattribute float skinPart;\nuniform highp sampler2D skinRects;\n' +
        shader.vertexShader.replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
  vec4 skinRect = texelFetch(skinRects, ivec2(int(faceId + 0.5), int(skinPart + 0.5)), 0);
  vec2 skinUv = skinRect.xy + clamp(uv, 0.0005, 0.9995) * skinRect.zw;
  #ifdef USE_MAP
  vMapUv = skinUv;
  #endif
  #ifdef USE_EMISSIVEMAP
  vEmissiveMapUv = skinUv;
  #endif`,
        );
    };
    material.customProgramCacheKey = () => 'webcraft-creature-skin-1';
    return material;
  }
  dispose() {
    this.texture.dispose();
    this.glowTexture.dispose();
    this.rectTexture.dispose();
  }
}
