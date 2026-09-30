import * as THREE from 'three';

/**
 * The frame: a small screen-space pipeline that runs after the world and the hand are drawn.
 *
 * It works on the finished picture (the same pixels the player would have seen), so switching
 * it off gives back the exact old look and nothing in the terrain, sky or mob programs had to
 * change. What it adds: a soft glow around bright light sources (the sun, lava, torches,
 * glowstone), a vignette, a gentle colour grade that follows the time of day and the
 * dimension, the wobble of looking through water, the heat shimmer of lava and the Nether,
 * and a red flash when the player is hurt.
 *
 * The cost is bounded: one copy of the frame, six passes on quarter- and eighth-size targets
 * and one full-size composite. Everything is skipped when the option is off.
 */

export interface PostInput {
  /** 0‥1 daylight, already dimmed by rain. */
  daylight: number;
  /** 0‥1 closeness to sunrise or sunset. */
  twilight: number;
  dimension: string;
  /** What the camera is in: 'air', 'water' or 'lava'. */
  medium: string;
  rain: number;
  thunder: number;
  /** 0‥1 flash of pain, fading to 0. */
  hurt: number;
  /** 0‥1 lightning flash. */
  flash: number;
  reducedMotion: boolean;
}

export interface PostParams {
  bloom: number;
  bloomThreshold: number;
  bloomKnee: number;
  vignette: number;
  saturation: number;
  contrast: number;
  exposure: number;
  shadowTint: readonly [number, number, number];
  highlightTint: readonly [number, number, number];
  /** 0‥1 strength of the water wobble. */
  underwater: number;
  /** 0‥1 strength of the heat shimmer. */
  heat: number;
  /** Colour the whole frame is multiplied with inside water or lava. */
  mediumTint: readonly [number, number, number];
  /** 0‥1 how much of `mediumTint` applies. */
  mediumAmount: number;
  /** 0‥1 red flash of pain. */
  damage: number;
  /** Colour fringing at the edges of the picture, in uv units. */
  aberration: number;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/**
 * Every number the composite pass needs, as a pure function of the game state: easy to test,
 * and the only place where the look of the frame is decided.
 */
export function postParams(input: PostInput): PostParams {
  // A NaN that reached the GPU would blank the whole picture: every number is made finite first.
  const num = (x: number) => (Number.isFinite(x) ? x : 0);
  const overworld = input.dimension === 'overworld';
  const day = overworld ? clamp01(num(input.daylight)) : 0.5;
  const night = overworld ? 1 - smooth(0.05, 0.6, day) : 0;
  const rain = overworld ? clamp01(num(input.rain)) : 0;
  const twilight = overworld ? clamp01(num(input.twilight)) * (1 - rain) : 0;
  const flash = clamp01(num(input.flash));

  let saturation = 1.04 + 0.04 * day - 0.28 * rain - 0.1 * night;
  const contrast = 1.03 + 0.02 * night;
  const exposure = 1 + flash * 0.3;
  let vignette = 0.2 + 0.2 * night + 0.06 * rain;
  let bloom = 0.3 + 0.28 * night + 0.22 * twilight;
  let threshold = mix(0.8, 0.6, night);
  let shadow: [number, number, number] = mix3(
    [1, 1, 1],
    [0.92, 0.97, 1.07],
    night * 0.9 + (1 - day) * 0.15,
  );
  let high: [number, number, number] = mix3([1.015, 1.0, 0.975], [1.09, 0.98, 0.87], twilight);
  let heat = 0;

  if (input.dimension === 'nether') {
    saturation = 1.1;
    vignette = 0.3;
    bloom = 0.55;
    threshold = 0.62;
    shadow = [1.0, 0.92, 0.9];
    high = [1.08, 0.98, 0.92];
    heat = 1;
  } else if (input.dimension === 'end') {
    saturation = 1.06;
    vignette = 0.34;
    bloom = 0.5;
    threshold = 0.64;
    shadow = [0.96, 0.92, 1.07];
    high = [1.0, 0.97, 1.07];
  }

  let underwater = 0;
  let mediumTint: [number, number, number] = [1, 1, 1];
  let mediumAmount = 0;
  if (input.medium === 'water') {
    underwater = 1;
    mediumTint = [0.74, 1.0, 1.08];
    mediumAmount = 0.85;
    vignette += 0.22;
    bloom *= 0.6;
  } else if (input.medium === 'lava') {
    heat = 1;
    mediumTint = [1.2, 0.68, 0.45];
    mediumAmount = 0.8;
    vignette += 0.25;
  }

  const damage = clamp01(num(input.hurt));
  const motion = input.reducedMotion ? 0 : 1;
  return {
    bloom,
    bloomThreshold: threshold,
    bloomKnee: 0.22,
    vignette: clamp01(vignette),
    saturation,
    contrast,
    exposure,
    shadowTint: shadow,
    highlightTint: high,
    underwater: underwater * motion,
    heat: heat * motion,
    mediumTint,
    mediumAmount,
    damage,
    aberration: (0.006 + 0.02 * damage) * motion,
  };
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BRIGHT = /* glsl */ `
uniform sampler2D tSource; uniform vec2 texel; uniform float threshold; uniform float knee;
varying vec2 vUv;
vec3 prefilter(vec3 c){
  float lum = dot(c, vec3(.2126,.7152,.0722));
  float br = mix(lum, max(c.r, max(c.g, c.b)), .5);
  float soft = clamp(br - threshold + knee, 0., 2. * knee);
  soft = soft * soft / (4. * knee + 1e-4);
  float w = max(soft, br - threshold) / max(br, 1e-4);
  return c * w;
}
void main(){
  vec3 s = prefilter(texture2D(tSource, vUv + texel * vec2(-1., -1.)).rgb)
         + prefilter(texture2D(tSource, vUv + texel * vec2( 1., -1.)).rgb)
         + prefilter(texture2D(tSource, vUv + texel * vec2(-1.,  1.)).rgb)
         + prefilter(texture2D(tSource, vUv + texel * vec2( 1.,  1.)).rgb);
  gl_FragColor = vec4(s * .25, 1.);
}`;

const DOWN = /* glsl */ `
uniform sampler2D tSource; uniform vec2 texel;
varying vec2 vUv;
void main(){
  vec3 s = texture2D(tSource, vUv + texel * vec2(-1., -1.)).rgb
         + texture2D(tSource, vUv + texel * vec2( 1., -1.)).rgb
         + texture2D(tSource, vUv + texel * vec2(-1.,  1.)).rgb
         + texture2D(tSource, vUv + texel * vec2( 1.,  1.)).rgb;
  gl_FragColor = vec4(s * .25, 1.);
}`;

const BLUR = /* glsl */ `
uniform sampler2D tSource; uniform vec2 dir;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSource, vUv).rgb * .2270270270;
  c += texture2D(tSource, vUv + dir * 1.3846153846).rgb * .3162162162;
  c += texture2D(tSource, vUv - dir * 1.3846153846).rgb * .3162162162;
  c += texture2D(tSource, vUv + dir * 3.2307692308).rgb * .0702702703;
  c += texture2D(tSource, vUv - dir * 3.2307692308).rgb * .0702702703;
  gl_FragColor = vec4(c, 1.);
}`;

const COMPOSITE = /* glsl */ `
uniform sampler2D tScene; uniform sampler2D tBloomNear; uniform sampler2D tBloomFar;
uniform float time, aspect, bloom, vignette, saturation, contrast, exposure;
uniform float underwater, heat, mediumAmount, damage, aberration;
uniform vec3 shadowTint, highlightTint, mediumTint;
varying vec2 vUv;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main(){
  vec2 uv = vUv;
  // Looking through water or over lava: the picture wobbles a little.
  float wob = .0026 * underwater + .0011 * heat;
  uv += wob * vec2(sin(uv.y * 34. + time * 2.0), cos(uv.x * 41. + time * 1.7));
  uv = clamp(uv, vec2(.001), vec2(.999));
  vec2 c = uv - .5;
  float edge = dot(c, c);
  vec2 ab = c * edge * aberration;
  vec3 col = vec3(texture2D(tScene, uv + ab).r, texture2D(tScene, uv).g, texture2D(tScene, uv - ab).b);
  // Glow: screen-blended, so bright areas never clip.
  vec3 glow = texture2D(tBloomNear, uv).rgb * .65 + texture2D(tBloomFar, uv).rgb * .95;
  col = 1. - (1. - col) * (1. - clamp(glow * bloom, 0., .95));
  // Grade: exposure, saturation, contrast, then warm highlights over cool shadows.
  col *= exposure;
  float l = dot(col, vec3(.2126, .7152, .0722));
  col = mix(vec3(l), col, saturation);
  col = (col - .5) * contrast + .5;
  col *= mix(shadowTint, highlightTint, smoothstep(.05, .85, l));
  col = mix(col, col * mediumTint, mediumAmount);
  // Vignette, tighter when it is dark or you are underwater.
  float r = length(c * vec2(aspect, 1.) * .9);
  col *= 1. - vignette * smoothstep(.28, .95, r);
  // Pain: a red wash from the edges of the picture.
  float d = damage * smoothstep(.12, .85, length(c * vec2(aspect, 1.)) * 1.25);
  col = mix(col, vec3(.72, .05, .05), clamp(d * .62, 0., .7));
  // Dither away the banding of eight-bit gradients.
  col += (hash(gl_FragCoord.xy + fract(time) * 17.) - .5) / 255.;
  gl_FragColor = vec4(clamp(col, 0., 1.), 1.);
}`;

type PassMaterial = THREE.ShaderMaterial;

/** Runs the pipeline on a WebGL renderer that has just drawn a frame to its canvas. */
export class PostFX {
  enabled = true;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly quad: THREE.Mesh;
  private readonly bright: PassMaterial;
  private readonly down: PassMaterial;
  private readonly blur: PassMaterial;
  private readonly composite: PassMaterial;
  private frame: THREE.FramebufferTexture | null = null;
  private near: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  private far: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  private width = 0;
  private height = 0;
  private readonly size = new THREE.Vector2();

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
    );
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const make = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>): PassMaterial =>
      new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader,
        uniforms,
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending,
        toneMapped: false,
      });
    this.bright = make(BRIGHT, {
      tSource: { value: null },
      texel: { value: new THREE.Vector2() },
      threshold: { value: 0.8 },
      knee: { value: 0.22 },
    });
    this.down = make(DOWN, { tSource: { value: null }, texel: { value: new THREE.Vector2() } });
    this.blur = make(BLUR, { tSource: { value: null }, dir: { value: new THREE.Vector2() } });
    this.composite = make(COMPOSITE, {
      tScene: { value: null },
      tBloomNear: { value: null },
      tBloomFar: { value: null },
      time: { value: 0 },
      aspect: { value: 1 },
      bloom: { value: 0.3 },
      vignette: { value: 0.2 },
      saturation: { value: 1 },
      contrast: { value: 1 },
      exposure: { value: 1 },
      underwater: { value: 0 },
      heat: { value: 0 },
      mediumAmount: { value: 0 },
      damage: { value: 0 },
      aberration: { value: 0 },
      shadowTint: { value: new THREE.Vector3(1, 1, 1) },
      highlightTint: { value: new THREE.Vector3(1, 1, 1) },
      mediumTint: { value: new THREE.Vector3(1, 1, 1) },
    });
    this.quad = new THREE.Mesh(geometry, this.composite);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  private target(w: number, h: number) {
    return new THREE.WebGLRenderTarget(w, h, {
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });
  }

  /** Reallocates the buffers when the drawing buffer changed size (resize, adaptive scale). */
  private ensure(): boolean {
    this.renderer.getDrawingBufferSize(this.size);
    const w = this.size.x | 0,
      h = this.size.y | 0;
    if (w < 16 || h < 16) return false;
    if (w === this.width && h === this.height && this.frame) return true;
    this.release();
    this.width = w;
    this.height = h;
    this.frame = new THREE.FramebufferTexture(w, h);
    this.frame.minFilter = THREE.LinearFilter;
    this.frame.magFilter = THREE.LinearFilter;
    const nw = Math.max(8, w >> 2),
      nh = Math.max(8, h >> 2);
    this.near = [this.target(nw, nh), this.target(nw, nh)];
    this.far = [
      this.target(Math.max(4, nw >> 1), Math.max(4, nh >> 1)),
      this.target(Math.max(4, nw >> 1), Math.max(4, nh >> 1)),
    ];
    return true;
  }

  private release() {
    this.frame?.dispose();
    for (const t of [...(this.near ?? []), ...(this.far ?? [])]) t.dispose();
    this.frame = null;
    this.near = this.far = null;
    this.width = this.height = 0;
  }

  private draw(material: PassMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  /** Call right after the last `renderer.render` of the frame. */
  render(input: PostInput, time: number) {
    if (!this.enabled || !this.ensure()) return;
    const frame = this.frame!,
      [nearA, nearB] = this.near!,
      [farA, farB] = this.far!;
    const p = postParams(input);
    const r = this.renderer;
    const autoClear = r.autoClear,
      previous = r.getRenderTarget(),
      info = { ...r.info.render };
    r.autoClear = false;
    // The finished frame, as it stands in the canvas. three's copy writes into whatever texture
    // is bound on the ACTIVE unit, but its state cache skips the bind when it believes unit 0
    // already holds `frame` (it does, from last frame's composite pass) and so leaves another
    // unit active: the copy then hit a bloom target and raised INVALID_VALUE. Make unit 0
    // active and forget its binding so the bind is real.
    r.state.activeTexture(r.getContext().TEXTURE0);
    r.state.unbindTexture();
    r.copyFramebufferToTexture(frame);
    // Bright parts → quarter size, blurred; then eighth size, blurred again for a wide halo.
    this.bright.uniforms.tSource.value = frame;
    (this.bright.uniforms.texel.value as THREE.Vector2).set(1 / this.width, 1 / this.height);
    this.bright.uniforms.threshold.value = p.bloomThreshold;
    this.bright.uniforms.knee.value = p.bloomKnee;
    this.draw(this.bright, nearA);
    const blur = (from: THREE.WebGLRenderTarget, to: THREE.WebGLRenderTarget) => {
      (this.blur.uniforms.dir.value as THREE.Vector2).set(1 / from.width, 0);
      this.blur.uniforms.tSource.value = from.texture;
      this.draw(this.blur, to);
      (this.blur.uniforms.dir.value as THREE.Vector2).set(0, 1 / to.height);
      this.blur.uniforms.tSource.value = to.texture;
      this.draw(this.blur, from);
    };
    blur(nearA, nearB);
    this.down.uniforms.tSource.value = nearA.texture;
    (this.down.uniforms.texel.value as THREE.Vector2).set(1 / nearA.width, 1 / nearA.height);
    this.draw(this.down, farA);
    blur(farA, farB);
    // Composite straight into the canvas.
    const u = this.composite.uniforms;
    u.tScene.value = frame;
    u.tBloomNear.value = nearA.texture;
    u.tBloomFar.value = farA.texture;
    u.time.value = time;
    u.aspect.value = this.width / this.height;
    u.bloom.value = p.bloom;
    u.vignette.value = p.vignette;
    u.saturation.value = p.saturation;
    u.contrast.value = p.contrast;
    u.exposure.value = p.exposure;
    u.underwater.value = p.underwater;
    u.heat.value = p.heat;
    u.mediumAmount.value = p.mediumAmount;
    u.damage.value = p.damage;
    u.aberration.value = p.aberration;
    (u.shadowTint.value as THREE.Vector3).set(...p.shadowTint);
    (u.highlightTint.value as THREE.Vector3).set(...p.highlightTint);
    (u.mediumTint.value as THREE.Vector3).set(...p.mediumTint);
    this.draw(this.composite, null);
    r.setRenderTarget(previous);
    r.autoClear = autoClear;
    // The passes above are not scene draws: keep the diagnostics honest.
    Object.assign(r.info.render, info);
  }

  dispose() {
    this.release();
    this.bright.dispose();
    this.down.dispose();
    this.blur.dispose();
    this.composite.dispose();
    this.quad.geometry.dispose();
  }
}
