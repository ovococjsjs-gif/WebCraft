import * as THREE from 'three';
import { daylight, solarElevation } from '../../core/src/world';
import { pixelNoise } from './pixel-art';
import type { QualitySettings } from './quality';
import { QUALITY } from './quality';
import { SHARED_GLSL, SharedLight } from './terrain-material';
import {
  MOON_ATLAS,
  buildStarField,
  glowPixels,
  meteorAt,
  moonAtlasPixels,
  moonCell,
  moonLit,
  moonPhaseAt,
} from './sky';
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/**
 * Unit vector from the eye towards the sun for a solar angle (0 = sunrise, π/2 = noon,
 * π = sunset). As in the reference, the sun rises in the east (+x) and sets in the west (−x);
 * its path leans a little towards the south (+z) in the morning and away from it in the evening.
 */
export function sunDirectionAt(angle: number, out = new THREE.Vector3()) {
  return out.set(Math.cos(angle), Math.sin(angle), Math.cos(angle) * 0.18).normalize();
}
export function environmentAt(time: number, dimension = 'overworld') {
  const elevation = solarElevation(time),
    level = daylight(time),
    normal = dimension === 'overworld';
  return {
    level: normal ? level : dimension === 'nether' ? 0.35 : 0.22,
    sky: normal ? 0.1 + level * 0.8 : 0,
    ambient: dimension === 'nether' ? 0.26 : dimension === 'end' ? 0.32 : 0.13,
    twilight: normal ? Math.pow(1 - Math.min(1, Math.abs(elevation) / 0.3), 2) : 0,
    stars: normal ? 1 - smooth(-0.18, 0.05, elevation) : 0,
    sun: normal && elevation > -0.09,
    moon: normal && elevation < 0.09,
    clouds: normal,
    elevation,
    angle: ((((time % 24000) + 24000) % 24000) / 24000) * Math.PI * 2,
  };
}
const CLOUD_MAX = 6000;
/** Stars in the buffer; each quality preset draws the first few hundred of them. */
const STAR_COUNT = 900;
/** Smooth clumps of cloud on the 12-block grid; the same cells for every player and session. */
function cloudCell(i: number, j: number): boolean {
  const lattice = (x: number, y: number, scale: number, seed: number) => {
    const gx = x / scale,
      gy = y / scale,
      x0 = Math.floor(gx),
      y0 = Math.floor(gy),
      fx = gx - x0,
      fy = gy - y0;
    const at = (a: number, b: number) => pixelNoise(a & 1023, b & 1023, seed);
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx,
      bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    return top + (bottom - top) * fy;
  };
  return lattice(i, j, 5, 131) * 0.7 + lattice(i, j, 2, 977) * 0.3 > 0.58;
}
/** Camera-centred single-pass sky. Clouds: ONE instanced draw rather than 81 meshes. */
export class Atmosphere {
  readonly group = new THREE.Group();
  private readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly sun = new THREE.Group();
  readonly moon: THREE.Mesh;
  readonly stars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly sunDisk: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly sunHalo: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly meteor: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private moonShown = -1;
  private readonly glowTexture: THREE.DataTexture;
  private readonly moonHalo: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly clouds: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  readonly hemisphere = new THREE.HemisphereLight('#e1eef2', '#718466', 2);
  readonly keyLight = new THREE.DirectionalLight('#ffecc5', 1.8);
  readonly fog = new THREE.Fog('#c0d8ff', 36, 64);
  /** Blocks of far terrain beyond the chunks (0 when it is off): the fog moves out to it. */
  farDistance = 0;
  private cloudKey = '';
  readonly light: SharedLight;
  private readonly top = new THREE.Color();
  private readonly bottom = new THREE.Color();
  private readonly mix = new THREE.Color();
  private readonly sunDirection = new THREE.Vector3();
  private readonly moonTexture: THREE.DataTexture;
  private readonly matrix = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly axisX = new THREE.Vector3();
  private readonly axisY = new THREE.Vector3();
  private readonly axisZ = new THREE.Vector3();
  state = environmentAt(6000);
  dimension = 'overworld';
  radius = 3;
  constructor(scene: THREE.Scene, light = new SharedLight()) {
    this.light = light;
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(360, 24, 14),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        uniforms: {
          top: { value: new THREE.Color() },
          bottom: { value: new THREE.Color() },
          /** 0‥1 how visible the stars are; the Milky Way fades with them. */
          nightStars: { value: 0 },
          /** Turn of the star dome (radians), so the band keeps to its stars. */
          starSpin: { value: 0 },
          ...light.uniforms(),
        },
        vertexShader:
          'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader: /* glsl */ `
          varying vec3 vP; uniform vec3 top; uniform vec3 bottom;
          uniform float nightStars; uniform float starSpin;
          ${SHARED_GLSL}
          float hash31(vec3 p){ p = fract(p * .1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
          float vnoise(vec3 x){
            vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
            return mix(
              mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x), mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
              mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x), mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y), f.z);
          }
          void main(){
            vec3 d = normalize(vP);
            float h = clamp(d.y, 0., 1.);
            vec3 c = mix(bottom, top, pow(h, .5));
            c *= 1. - clamp(-d.y * 3., 0., 1.) * .18;
            float s = max(dot(d, voxelSunDir), 0.);
            // A glow around the sun that the fog of the land shares (warm at dawn and dusk).
            c = mix(c, voxelGlow, (pow(s, 6.) * .85 + pow(s, 2.) * .15) * voxelGlowPower * (1. - h * .55));
            // Dawn and dusk: gold, rose and violet layered along the horizon.
            c = voxelTwilightBand(c, d);
            // The glare right round the sun.
            c += voxelGlow * pow(s, 40.) * (.16 + .5 * voxelTwilight) * step(.001, voxelGlowPower);
            // Night: the Milky Way, a soft mottled band along the great circle the stars crowd round.
            if (nightStars > .01 && d.y > -.05) {
              float cs = cos(starSpin), sn = sin(starSpin);
              vec3 q = vec3(cs * d.x - sn * d.z, d.y, sn * d.x + cs * d.z);
              float dist = dot(q, vec3(0., -.7833, .6216));
              float n1 = vnoise(q * 6.), n2 = vnoise(q * 15. + 7.);
              float clump = .4 + .6 * (n1 * .65 + n2 * .35);
              float core = exp(-dist * dist / .02), wide = exp(-dist * dist / .09);
              float m = (core * .75 + wide * .25) * clump * smoothstep(-.02, .2, d.y);
              c += vec3(.30, .36, .62) * m * .3 * nightStars;
              // Lanes of dust split the core.
              c -= vec3(.04, .05, .07) * core * smoothstep(.5, 1., n2 * .75 + n1 * .25) * nightStars * .8;
            }
            gl_FragColor = vec4(c, 1.);
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.sky.renderOrder = -100;
    this.group.add(this.sky);
    const disk = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 26),
      new THREE.MeshBasicMaterial({
        color: '#fff0b5',
        fog: false,
        toneMapped: false,
        depthWrite: false,
      }),
    );
    const glow = new THREE.DataTexture(glowPixels(64), 64, 64, THREE.RGBAFormat);
    glow.magFilter = THREE.LinearFilter;
    glow.minFilter = THREE.LinearFilter;
    glow.generateMipmaps = false;
    glow.needsUpdate = true;
    this.glowTexture = glow;
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(110, 110),
      new THREE.MeshBasicMaterial({
        map: glow,
        color: '#ffdd98',
        opacity: 0.5,
        transparent: true,
        blending: THREE.AdditiveBlending,
        fog: false,
        toneMapped: false,
        depthWrite: false,
      }),
    );
    halo.position.z = -0.1;
    this.sunDisk = disk;
    this.sunHalo = halo;
    this.sun.add(halo, disk);
    // A nested group's own renderOrder outranks its children's, so the group must stay at 0 or
    // the sky sphere would be painted over the disk; the order is set on the two meshes instead.
    disk.renderOrder = -90;
    halo.renderOrder = -91;
    this.group.add(this.sun);
    // Eight phases in one 4×2 atlas; the picture shown follows the day (see `update`).
    this.moonTexture = new THREE.DataTexture(
      moonAtlasPixels(),
      MOON_ATLAS.width,
      MOON_ATLAS.height,
      THREE.RGBAFormat,
    );
    this.moonTexture.colorSpace = THREE.SRGBColorSpace;
    this.moonTexture.magFilter = THREE.NearestFilter;
    this.moonTexture.minFilter = THREE.NearestFilter;
    this.moonTexture.generateMipmaps = false;
    this.moonTexture.repeat.set(1 / MOON_ATLAS.cols, 1 / MOON_ATLAS.rows);
    this.moonTexture.needsUpdate = true;
    this.moon = new THREE.Mesh(
      new THREE.PlaneGeometry(22, 22),
      new THREE.MeshBasicMaterial({
        map: this.moonTexture,
        transparent: true,
        fog: false,
        toneMapped: false,
        depthWrite: false,
      }),
    );
    this.moon.renderOrder = -90;
    this.moonHalo = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshBasicMaterial({
        map: glow,
        color: '#8fa8d8',
        opacity: 0.3,
        transparent: true,
        blending: THREE.AdditiveBlending,
        fog: false,
        toneMapped: false,
        depthWrite: false,
      }),
    );
    this.moonHalo.renderOrder = -92;
    this.moonHalo.position.z = -0.1;
    this.moon.add(this.moonHalo);
    this.group.add(this.moon);
    const field = buildStarField(STAR_COUNT);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(field.positions, 3));
    geometry.setAttribute('starColor', new THREE.BufferAttribute(field.colors, 3));
    geometry.setAttribute('starPhase', new THREE.BufferAttribute(field.phases, 1));
    geometry.setAttribute('starSize', new THREE.BufferAttribute(field.sizes, 1));
    this.stars = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        uniforms: {
          time: { value: 0 },
          opacity: { value: 1 },
          pixelRatio: { value: 1 },
          twinkle: { value: 1 },
        },
        vertexShader: /* glsl */ `
          attribute vec3 starColor; attribute float starPhase; attribute float starSize;
          uniform float time; uniform float pixelRatio; uniform float twinkle;
          varying vec3 vColor; varying float vShimmer;
          void main(){
            vColor = starColor;
            float wave = sin(time * (1.3 + starPhase * 2.4) + starPhase * 40.);
            vShimmer = 1. - twinkle * (.2 + .22 * starPhase) * (.5 + .5 * wave);
            gl_PointSize = starSize * pixelRatio;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
          }`,
        fragmentShader: /* glsl */ `
          uniform float opacity; varying vec3 vColor; varying float vShimmer;
          void main(){ gl_FragColor = vec4(vColor * vShimmer, opacity); }`,
      }),
    );
    this.stars.renderOrder = -95;
    this.group.add(this.stars);
    // A shooting star now and then: one thin additive streak, placed from a pure function.
    this.meteor = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { fade: { value: 0 } },
        vertexShader:
          'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader: /* glsl */ `
          varying vec2 vUv; uniform float fade;
          void main(){
            float along = vUv.x, across = 1. - abs(vUv.y * 2. - 1.);
            float a = pow(along, 3.) * smoothstep(0., .55, across) * fade;
            vec3 c = mix(vec3(.55, .72, 1.), vec3(1.), pow(along, 8.));
            gl_FragColor = vec4(c * a, 1.);
          }`,
      }),
    );
    this.meteor.renderOrder = -94;
    this.meteor.frustumCulled = false;
    this.meteor.visible = false;
    this.group.add(this.meteor);
    // One flat layer of 12-block cells at y 128 that drifts with the wind, as in the reference.
    // It is anchored to the world, so walking under a cloud leaves it where it is; runs of
    // cells in a row share one box, so the whole sky stays ONE instanced draw.
    this.clouds = new THREE.InstancedMesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: false,
        opacity: 1,
        depthWrite: true,
        vertexColors: true,
        fog: true,
        toneMapped: false,
      }),
      CLOUD_MAX,
    );
    const cloudNormals = this.clouds.geometry.getAttribute('normal'),
      cloudColors = [];
    for (let i = 0; i < cloudNormals.count; i++) {
      const y = cloudNormals.getY(i),
        x = cloudNormals.getX(i);
      const shade = y > 0 ? 1 : y < 0 ? 0.72 : x !== 0 ? 0.9 : 0.82;
      cloudColors.push(shade, shade, shade);
    }
    this.clouds.geometry.setAttribute('color', new THREE.Float32BufferAttribute(cloudColors, 3));
    this.clouds.frustumCulled = false;
    this.clouds.count = 0;
    scene.add(this.clouds);
    this.group.add(this.hemisphere, this.keyLight);
    scene.add(this.group);
    scene.fog = this.fog;
  }
  update(
    camera: THREE.Camera,
    time: number,
    phase: number,
    dimension: string,
    quality: QualitySettings,
    reduced: boolean,
    medium = 'air',
    weather: { rain: number; thunder: number; flash: number } = { rain: 0, thunder: 0, flash: 0 },
    /** The world tick (for the phase of the moon) and the renderer's pixel ratio (for star size). */
    extra: { tick?: number; pixelRatio?: number } = {},
  ) {
    this.dimension = dimension;
    const e = (this.state = environmentAt(time, dimension)),
      normal = dimension === 'overworld';
    const rain = normal ? weather.rain : 0,
      thunder = normal ? weather.thunder : 0,
      flash = normal ? weather.flash : 0;
    // Rain dims the daylight as in the reference, a storm dims it more; a strike lights all up.
    const dim = (1 - rain * 0.32) * (1 - thunder * 0.3);
    e.sky = e.sky * dim + flash * 0.55;
    e.ambient += flash * 0.35;
    e.level = e.level * dim;
    e.stars *= 1 - rain;
    e.sun = e.sun && rain < 0.7;
    e.moon = e.moon && rain < 0.7;
    this.group.position.copy(camera.position);
    this.top
      .set(normal ? '#101a32' : dimension === 'nether' ? '#431d23' : '#111b29')
      .lerp(this.mix.set('#78a7ff'), normal ? e.level : 0);
    this.bottom
      .set(normal ? '#1c293f' : dimension === 'nether' ? '#713b2c' : '#203a34')
      .lerp(this.mix.set('#c0d8ff'), normal ? e.level : 0);
    if (normal) this.bottom.lerp(this.mix.set('#e5a173'), e.twilight * 0.72 * (1 - rain));
    if (rain > 0) {
      // Overcast: the sky loses its blue to a flat grey of the same brightness.
      const grey = 0.1 + e.level * 0.5;
      this.top.lerp(this.mix.setRGB(grey * 0.95, grey, grey * 1.05), rain * 0.8);
      this.bottom.lerp(this.mix.setRGB(grey * 1.12, grey * 1.16, grey * 1.18), rain * 0.8);
    }
    if (flash > 0) {
      this.top.lerp(this.mix.set('#dfe6ff'), flash * 0.7);
      this.bottom.lerp(this.mix.set('#dfe6ff'), flash * 0.7);
    }
    this.sky.material.uniforms.top.value.copy(this.top);
    this.sky.material.uniforms.bottom.value.copy(this.bottom);
    this.fog.color.copy(this.bottom);
    // Clear air up to the last chunks (or far terrain), as in the reference: the fog is only a
    // soft edge of the world, not a haze over it.
    const reach = normal && this.farDistance > 0 ? this.farDistance : this.radius * 16 + 8;
    this.fog.far = reach * (1 - rain * 0.3);
    this.fog.near =
      this.fog.far * (normal && this.farDistance > 0 ? 0.35 : 0.62) * (1 - rain * 0.5);
    if (medium !== 'air') {
      this.fog.color.set(medium === 'water' ? '#2c7883' : '#b34724');
      this.fog.near = 0.6;
      this.fog.far = medium === 'water' ? 12 : 4;
    }
    sunDirectionAt(e.angle, this.sunDirection);
    const light = this.light;
    light.sunDir.value.copy(this.sunDirection);
    if (e.elevation < -0.05) light.sunDir.value.negate();
    light.day.value = normal ? e.level * (1 - rain) : 0;
    light.glow.value.set('#fff3dc').lerp(this.mix.set('#ff9d5c'), e.twilight);
    light.glowPower.value = normal
      ? (0.16 + e.twilight * 0.7) * (1 - rain) * Math.min(1, e.level * 3)
      : 0;
    light.horizon.value.copy(this.bottom);
    light.twilight.value = normal ? e.twilight * (1 - rain) : 0;
    // The sun reddens and its halo swells as it meets the horizon.
    const dusk = light.twilight.value;
    this.sunDisk.material.color.set('#fff0b5').lerp(this.mix.set('#ffab5e'), dusk * 0.85);
    this.sunHalo.material.color.set('#ffdd98').lerp(this.mix.set('#ff8f4a'), dusk);
    this.sunHalo.material.opacity = 0.42 + dusk * 0.3;
    this.sunHalo.scale.setScalar(1 + dusk * 0.9);
    this.sun.position.copy(this.sunDirection).multiplyScalar(240);
    this.sun.visible = e.sun;
    this.moon.position.copy(this.sunDirection).multiplyScalar(-245);
    this.moon.visible = e.moon;
    // lookAt expects world space, after the sky root follows the eye.
    this.group.updateMatrixWorld(true);
    this.sun.lookAt(camera.position);
    this.moon.lookAt(camera.position);
    this.stars.visible = e.stars > 0.005;
    this.stars.material.opacity = e.stars * 0.88;
    const star = this.stars.material.uniforms;
    star.opacity.value = this.stars.material.opacity;
    star.time.value = phase;
    star.pixelRatio.value = extra.pixelRatio ?? 1;
    star.twinkle.value = reduced ? 0 : 1;
    this.stars.rotation.y = e.angle * 0.25;
    const sky = this.sky.material.uniforms;
    sky.nightStars.value = e.stars * 0.88;
    sky.starSpin.value = this.stars.rotation.y;
    this.stars.geometry.setDrawRange(0, QUALITY[quality.preset].stars);
    // The moon shows the phase of the day; the atlas is 4×2 pictures.
    const moonPhase = moonPhaseAt(extra.tick ?? 0);
    if (moonPhase !== this.moonShown) {
      this.moonShown = moonPhase;
      const { col, row } = moonCell(moonPhase);
      this.moonTexture.offset.set(col / MOON_ATLAS.cols, row / MOON_ATLAS.rows);
      // A thin moon has a thin halo, a new moon none.
      this.moonHalo.material.opacity = 0.04 + 0.26 * moonLit(moonPhase);
    }
    this.placeMeteor(phase, e.stars > 0.4 && !reduced ? e.stars : 0);
    this.clouds.visible = e.clouds && quality.clouds;
    if (this.clouds.visible)
      this.layClouds(
        camera.position,
        reduced ? 0 : phase * 0.6,
        Math.max(
          QUALITY[quality.preset].clouds,
          Math.min(170, Math.round((this.farDistance * 1.6) / 12)),
        ),
      );
    this.clouds.material.color
      .set('#2e3c57')
      .lerp(this.mix.set('#ffffff'), e.level)
      .lerp(this.mix.set('#eab995'), e.twilight * 0.5 * (1 - rain))
      .lerp(
        this.mix.setRGB(0.2 + e.level * 0.42, 0.21 + e.level * 0.43, 0.22 + e.level * 0.44),
        rain * 0.85,
      );
    this.clouds.material.opacity = 1;
    this.hemisphere.intensity =
      dimension === 'end' ? 1.15 : dimension === 'nether' ? 0.85 : 0.48 + e.level * 1.5;
    this.keyLight.intensity = normal ? 0.16 + e.level * 1.7 : 0;
    this.keyLight.color.set(e.level < 0.08 ? '#aac5ee' : '#ffedca');
    this.keyLight.position.copy(this.sunDirection).multiplyScalar(e.level < 0.08 ? -100 : 100);
    this.keyLight.target.position.copy(camera.position);
    this.keyLight.target.updateMatrixWorld();
  }
  /** Puts the shooting star of the moment on the dome, or hides it. */
  private placeMeteor(seconds: number, night: number) {
    const m = night > 0 ? meteorAt(seconds) : null;
    this.meteor.visible = m !== null;
    if (!m) return;
    const radius = 300,
      length = 70;
    const head = this.pos.set(m.head[0], m.head[1], m.head[2]),
      tangent = this.scale.set(m.tangent[0], m.tangent[1], m.tangent[2]);
    // Basis of the streak: long axis along its travel, front face towards the eye.
    const z = this.axisZ.copy(head).negate(),
      x = this.axisX.copy(tangent).addScaledVector(z, -tangent.dot(z)).normalize(),
      y = this.axisY.crossVectors(z, x);
    this.matrix.makeBasis(x, y, z);
    this.meteor.quaternion.setFromRotationMatrix(this.matrix);
    this.meteor.scale.set(length, 1.3, 1);
    this.meteor.position
      .copy(head)
      .multiplyScalar(radius)
      .addScaledVector(x, -length / 2);
    this.meteor.material.uniforms.fade.value = m.fade * night;
  }
  /** Rebuilds the cloud cells only when the camera (or the wind) crosses a cell. */
  private layClouds(eye: THREE.Vector3, drift: number, size: number) {
    const cell = 12,
      ox = Math.floor((eye.x - drift) / cell) - (size >> 1),
      oz = Math.floor(eye.z / cell) - (size >> 1),
      key = `${ox},${oz},${size}`;
    this.clouds.position.set(drift, 0, 0);
    if (key === this.cloudKey) return;
    this.cloudKey = key;
    let n = 0;
    for (let j = 0; j < size && n < CLOUD_MAX; j++) {
      let run = -1;
      for (let i = 0; i <= size; i++) {
        const filled = i < size && cloudCell(ox + i, oz + j);
        if (filled && run < 0) run = i;
        if (!filled && run >= 0) {
          const length = i - run;
          this.pos.set((ox + run + length / 2) * cell, 130, (oz + j + 0.5) * cell);
          this.scale.set(length * cell, 4, cell);
          this.matrix.compose(this.pos, this.rotation, this.scale);
          this.clouds.setMatrixAt(n++, this.matrix);
          run = -1;
          if (n >= CLOUD_MAX) break;
        }
      }
    }
    this.clouds.count = n;
    this.clouds.instanceMatrix.needsUpdate = true;
  }
  dispose() {
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
      }
    });
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    this.clouds.dispose();
    this.moonTexture.dispose();
    this.glowTexture.dispose();
    this.group.removeFromParent();
  }
}
