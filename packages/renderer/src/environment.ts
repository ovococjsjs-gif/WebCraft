import * as THREE from 'three';
import { daylight, solarElevation } from '../../core/src/world';
import { pixelNoise, pixelCanvas } from './pixel-art';
import type { QualitySettings } from './quality';
import { QUALITY } from './quality';
import { SharedLight } from './terrain-material';
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
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
  readonly stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
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
  private readonly moonTexture: THREE.CanvasTexture;
  private readonly matrix = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  state = environmentAt(6000);
  dimension = 'overworld';
  radius = 3;
  constructor(scene: THREE.Scene, light = new SharedLight()) {
    this.light = light;
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(360, 16, 10),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        uniforms: {
          top: { value: new THREE.Color() },
          bottom: { value: new THREE.Color() },
          voxelSunDir: light.sunDir,
          voxelGlow: light.glow,
          voxelGlowPower: light.glowPower,
        },
        vertexShader:
          'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader:
          // Horizon to zenith, a little darker below the horizon, and a glow around the sun that
          // the terrain fog shares (warm at dawn and dusk).
          'varying vec3 vP;uniform vec3 top;uniform vec3 bottom;uniform vec3 voxelSunDir;uniform vec3 voxelGlow;uniform float voxelGlowPower;' +
          'void main(){vec3 d=normalize(vP);float h=clamp(d.y,0.,1.);vec3 c=mix(bottom,top,pow(h,.5));' +
          'c*=1.-clamp(-d.y*3.,0.,1.)*.18;float s=max(dot(d,voxelSunDir),0.);' +
          'c=mix(c,voxelGlow,(pow(s,6.)*.85+pow(s,2.)*.15)*voxelGlowPower*(1.-h*.55));' +
          'gl_FragColor=vec4(c,1.);\n#include <colorspace_fragment>\n}',
      }),
    );
    this.sky.renderOrder = -100;
    this.group.add(this.sky);
    const disk = new THREE.Mesh(
      new THREE.PlaneGeometry(13, 13),
      new THREE.MeshBasicMaterial({
        color: '#fff0b5',
        fog: false,
        toneMapped: false,
        depthWrite: false,
      }),
    );
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 24),
      new THREE.MeshBasicMaterial({
        color: '#ffdd98',
        opacity: 0.09,
        transparent: true,
        fog: false,
        toneMapped: false,
        depthWrite: false,
      }),
    );
    halo.position.z = -0.1;
    this.sun.add(halo, disk);
    this.sun.renderOrder = -90;
    this.group.add(this.sun);
    const pixels = new Uint8ClampedArray(1024);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const crater = (x > 3 && x < 7 && y > 8 && y < 12) || (x > 9 && x < 13 && y > 3 && y < 7),
          n = crater ? 170 : pixelNoise(x, y) > 0.75 ? 210 : 231;
        pixels.set([n, Math.min(255, n + 8), Math.min(255, n + 14), 255], (y * 16 + x) * 4);
      }
    this.moonTexture = new THREE.CanvasTexture(pixelCanvas(pixels));
    this.moonTexture.colorSpace = THREE.SRGBColorSpace;
    this.moonTexture.magFilter = THREE.NearestFilter;
    this.moonTexture.minFilter = THREE.NearestFilter;
    this.moonTexture.generateMipmaps = false;
    this.moon = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 11),
      new THREE.MeshBasicMaterial({
        map: this.moonTexture,
        fog: false,
        toneMapped: false,
        depthWrite: false,
      }),
    );
    this.moon.renderOrder = -90;
    this.group.add(this.moon);
    const positions = new Float32Array(380 * 3);
    for (let i = 0; i < 380; i++) {
      const a = pixelNoise(i, 1, 47) * Math.PI * 2,
        h = 0.07 + pixelNoise(i, 2, 83) * 0.93,
        r = Math.sqrt(1 - h * h);
      positions.set([Math.cos(a) * r * 310, h * 310, Math.sin(a) * r * 310], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.stars = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: '#c3d5ed',
        size: 1.8,
        sizeAttenuation: false,
        transparent: true,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    );
    this.stars.renderOrder = -95;
    this.group.add(this.stars);
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
    this.sunDirection
      .set(-Math.cos(e.angle), Math.sin(e.angle), Math.cos(e.angle) * 0.18)
      .normalize();
    const light = this.light;
    light.sunDir.value.copy(this.sunDirection);
    if (e.elevation < -0.05) light.sunDir.value.negate();
    light.day.value = normal ? e.level * (1 - rain) : 0;
    light.glow.value.set('#fff3dc').lerp(this.mix.set('#ff9d5c'), e.twilight);
    light.glowPower.value = normal
      ? (0.16 + e.twilight * 0.7) * (1 - rain) * Math.min(1, e.level * 3)
      : 0;
    light.horizon.value.copy(this.bottom);
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
    this.stars.rotation.y = e.angle * 0.25;
    this.stars.geometry.setDrawRange(0, QUALITY[quality.preset].stars);
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
    this.group.removeFromParent();
  }
}
