/**
 * Far terrain: the land between the last loaded chunk and the horizon, as nested rings of
 * low-detail tiles (a clipmap). Each ring doubles the size of a cell and nothing more, so the
 * detail falls off smoothly: single blocks up to 128 blocks away, 2 up to 256, 4 up to 512,
 * 8 up to 1024 and 16 up to 2048. A tile is 32×32 cells, one draw call, 12 bytes a vertex, built
 * in its own worker straight from the world generator.
 *
 * Every face carries its block's atlas tile, and the shader lays the real texture over it in
 * world space (mip levels 0–4 of the gutter-free atlas, so a distant face is its tile's average,
 * exactly what the chunks show there). Next to the loaded chunks the far land therefore looks
 * like blocks, not like flat paint.
 *
 * Seams without extra geometry: every ring's program discards the pixels that the next finer
 * ring already covers, and every ring discards the pixels of chunks that are loaded (a 64×64
 * texel mask of chunk columns), so the real terrain and the far terrain never fight.
 */
import * as THREE from 'three';
import type { FarReach } from './quality';
import { SHARED_GLSL, type SharedLight } from './terrain-material';
import { ATLAS_COLS, ATLAS_ROWS } from './mesher';

export interface FarRequest {
  key: string;
  epoch: number;
  seed: string;
  preset: string;
  x0: number;
  z0: number;
  stride: number;
  cells: number;
}
export interface FarReply {
  key: string;
  epoch: number;
  positions: Int16Array;
  colors: Uint8Array;
  tiles: Uint16Array;
  indices: Uint16Array | Uint32Array;
  minY: number;
  maxY: number;
}
interface Tile {
  mesh: THREE.Mesh | null;
  level: number;
  used: number;
  vertices: number;
}

/** Cells per tile side, the same in every ring: the cell size alone doubles. */
const cellsOf = (_level: number) => 32;
/** Blocks per tile side: 32 in the finest ring (one block a cell), doubling with every ring. */
const sizeOf = (level: number) => 32 << level;
const HALF = 4,
  MAX_LEVELS = 5,
  IN_FLIGHT = 2,
  MASK = 64;
/** Rings for a reach: ring L ends 128·2^L blocks away. */
const levelsFor = (reach: FarReach) =>
  reach >= 2048 ? 5 : reach >= 1024 ? 4 : reach >= 512 ? 3 : reach >= 256 ? 2 : 0;

export class FarTerrain {
  readonly group = new THREE.Group();
  /** Sends a request to the far worker (wired by the app). */
  post?: (request: FarRequest) => void;
  private world: { seed: string; preset: string } | null = null;
  private reach: FarReach = 1024;
  private epoch = 0;
  private frame = 0;
  private readonly tiles = new Map<string, Tile>();
  private readonly inFlight = new Set<string>();
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly maskData = new Uint8Array(MASK * MASK);
  private readonly mask = new THREE.DataTexture(
    this.maskData,
    MASK,
    MASK,
    THREE.RedFormat,
    THREE.UnsignedByteType,
  );
  private maskDirty = false;
  private readonly columns = new Set<number>();
  private readonly maskCenter = { value: new THREE.Vector2() };
  private shaders = true;
  dimension = 'overworld';
  /** Chunk radius of the real terrain, whose inside the finest ring does not need to cover. */
  chunkRadius = 4;
  vertexCount = 0;
  constructor(light: SharedLight, atlas: THREE.Texture) {
    this.group.name = 'far-terrain';
    this.mask.magFilter = this.mask.minFilter = THREE.NearestFilter;
    this.mask.needsUpdate = true;
    for (let level = 0; level < MAX_LEVELS; level++) {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
          ...light.uniforms(),
          hole: { value: new THREE.Vector4(1e9, 1e9, -1e9, -1e9) },
          chunkMask: { value: this.mask },
          maskCenter: this.maskCenter,
          useMask: { value: 1 },
          farAtlas: { value: atlas },
        },
        defines: { VOXEL_SHADERS: '' },
        fog: true,
        side: THREE.FrontSide,
        vertexShader: /* glsl */ `
          attribute vec4 farColor;
          attribute float farTile;
          varying vec3 vColor;
          varying float vKind;
          varying vec3 vWorld;
          varying float vTile;
          void main(){
            vTile=farTile;
            vec4 world=modelMatrix*vec4(position,1.0);
            // Just under the surface of the near water, so the seam between them never opens.
            if(farColor.a<.1) world.y-=.15;
            vWorld=world.xyz;
            vColor=pow(farColor.rgb,vec3(2.2));
            vKind=farColor.a;
            gl_Position=projectionMatrix*viewMatrix*world;
          }`,
        fragmentShader: /* glsl */ `
          uniform float voxelSky;uniform float voxelAmbient;uniform float voxelTime;uniform float voxelMotion;
          uniform vec3 fogColor;uniform float fogNear;uniform float fogFar;
          uniform vec4 hole;uniform sampler2D chunkMask;uniform vec2 maskCenter;uniform float useMask;
          uniform sampler2D farAtlas;
          varying vec3 vColor;varying float vKind;varying vec3 vWorld;varying float vTile;
          const vec2 ATLAS=vec2(${ATLAS_COLS}.0,${ATLAS_ROWS}.0);
          const vec2 TEXELS=vec2(${ATLAS_COLS * 16}.0,${ATLAS_ROWS * 16}.0);
          // The block texture over the face colour: world-space coordinates on the face's plane,
          // continuous gradients (no seam at block edges) clamped to mip level 4, the tile's
          // own average, so the texture only ever adds detail and never changes the colour.
          vec3 blockDetail(vec3 base){
            if(vTile>65000.0) return base;
            vec3 fn=cross(dFdx(vWorld),dFdy(vWorld));
            vec3 an=abs(fn);
            vec2 bc=an.y>=an.x&&an.y>=an.z?vWorld.xz:(an.x>=an.z?vec2(vWorld.z,-vWorld.y):vec2(vWorld.x,-vWorld.y));
            float leafy=step(32767.5,vTile);
            float t=vTile-leafy*32768.0;
            vec2 cell=vec2(mod(t,${ATLAS_COLS}.0),floor(t/${ATLAS_COLS}.0));
            vec2 gx=dFdx(bc)*16.0,gy=dFdy(bc)*16.0;
            float m=max(length(gx),length(gy));
            if(m>16.0){gx*=16.0/m;gy*=16.0/m;}
            vec2 uv=(cell+fract(bc))/ATLAS;
            vec4 tex=textureGrad(farAtlas,uv,gx/TEXELS,gy/TEXELS);
            vec4 avg=textureLod(farAtlas,(cell+.5)/ATLAS,4.0);
            // Leaves: the gaps between them are shadowed depth, not sky.
            vec3 rgb=mix(tex.rgb,mix(avg.rgb*.45,tex.rgb,tex.a),leafy);
            vec3 ref=mix(avg.rgb,mix(avg.rgb*.45,avg.rgb,avg.a),leafy);
            return base*clamp(rgb/max(ref,vec3(.02)),0.0,3.0);
          }
          ${SHARED_GLSL}
          void main(){
            vec2 p=vWorld.xz;
            if(p.x>hole.x && p.x<hole.z && p.y>hole.y && p.y<hole.w) discard;
            if(useMask>.5){
              vec2 c=floor(p/16.0),d=c-maskCenter;
              if(abs(d.x)<31.5 && abs(d.y)<31.5 && texture2D(chunkMask,(mod(c,${MASK}.0)+.5)/${MASK}.0).r>.5) discard;
            }
            vec3 c=blockDetail(vColor)*(vec3(voxelAmbient)+vec3(.90,.96,1.0)*voxelSky);
            vec3 toEye=cameraPosition-vWorld;
            float dist=length(toEye);
            toEye/=dist;
            #ifdef VOXEL_SHADERS
              if(vKind<.1){
                vec3 fn=normalize(cross(dFdx(vWorld),dFdy(vWorld)));
                if(abs(fn.y)>.9){
                  float t=voxelTime*voxelMotion;
                  vec3 n=normalize(vec3(sin(p.x*.9+t*1.3)*.04,1.0,cos(p.y*.8+t*1.1)*.04));
                  float fres=pow(1.0-max(dot(toEye,n),0.0),5.0);
                  c=mix(c,voxelHorizon*voxelSky,fres*.35);
                  c+=voxelGlow*pow(max(dot(reflect(-toEye,n),voxelSunDir),0.0),60.0)*voxelDay*.9;
                }
              }
            #endif
            c=voxelGrade(c);
            float fog=smoothstep(fogNear,fogFar,dist);
            gl_FragColor=vec4(mix(c,voxelFogColor(fogColor,-toEye),fog),1.0);
            #include <colorspace_fragment>
          }`,
      });
      material.toneMapped = false;
      this.materials.push(material);
    }
  }
  /** The world whose horizon to show, or null (old generators, flat worlds, other dimensions). */
  setWorld(world: { seed: string; preset: string } | null) {
    this.clear();
    this.world = world;
  }
  setReach(reach: FarReach) {
    if (reach === this.reach) return;
    this.reach = reach;
  }
  setShaders(on: boolean) {
    if (on === this.shaders) return;
    this.shaders = on;
    for (const material of this.materials) {
      material.defines = on ? { VOXEL_SHADERS: '' } : {};
      material.needsUpdate = true;
    }
  }
  /** Far terrain is drawn (a world is set, reach > 0, overworld). */
  get active() {
    return !!this.world && this.reach > 0 && this.dimension === 'overworld';
  }
  /** Blocks from the eye to the horizon while active, 0 otherwise. */
  get distance() {
    return this.active ? this.reach : 0;
  }
  get tileCount() {
    return this.tiles.size;
  }
  /** A chunk column now has (or no longer has) real terrain drawn. */
  markColumn(cx: number, cz: number, present: boolean) {
    const key = cx * 65536 + cz;
    if (present === this.columns.has(key)) return;
    if (present) this.columns.add(key);
    else this.columns.delete(key);
    this.maskData[(((cz % MASK) + MASK) % MASK) * MASK + (((cx % MASK) + MASK) % MASK)] = present
      ? 255
      : 0;
    this.maskDirty = true;
  }
  clearMask() {
    this.columns.clear();
    this.maskData.fill(0);
    this.maskDirty = true;
  }
  /** Picks the rings around the eye, shows what is ready and asks the worker for the rest. */
  update(eye: THREE.Vector3) {
    this.group.visible = this.active;
    if (!this.active || !this.world) return;
    this.frame++;
    if (this.maskDirty) {
      this.mask.needsUpdate = true;
      this.maskDirty = false;
    }
    this.maskCenter.value.set(Math.floor(eye.x / 16), Math.floor(eye.z / 16));
    const levels = levelsFor(this.reach);
    const wanted: { key: string; level: number; x0: number; z0: number; d: number }[] = [];
    const visible = new Set<string>();
    let previous: [number, number, number, number] | null = null,
      previousReady = true;
    const pcx = Math.floor(eye.x / 16),
      pcz = Math.floor(eye.z / 16),
      inner = Math.max(0, this.chunkRadius - 1);
    for (let level = 0; level < levels; level++) {
      const size = sizeOf(level),
        cx = Math.floor(eye.x / size + 0.5),
        cz = Math.floor(eye.z / size + 0.5);
      const rect: [number, number, number, number] = [
        (cx - HALF) * size,
        (cz - HALF) * size,
        (cx + HALF) * size,
        (cz + HALF) * size,
      ];
      const hole = this.materials[level].uniforms.hole.value as THREE.Vector4;
      if (previous && previousReady) hole.set(...previous);
      else hole.set(1e9, 1e9, -1e9, -1e9);
      let ready = true;
      for (let tz = cz - HALF; tz < cz + HALF; tz++)
        for (let tx = cx - HALF; tx < cx + HALF; tx++) {
          const x0 = tx * size,
            z0 = tz * size;
          if (
            previous &&
            x0 >= previous[0] &&
            z0 >= previous[1] &&
            x0 + size <= previous[2] &&
            z0 + size <= previous[3]
          )
            continue;
          // Rings leave out what the loaded chunks cover anyway.
          if (
            x0 >= (pcx - inner) * 16 &&
            z0 >= (pcz - inner) * 16 &&
            x0 + size <= (pcx + inner + 1) * 16 &&
            z0 + size <= (pcz + inner + 1) * 16
          )
            continue;
          const key = `${level}:${tx}:${tz}`,
            tile = this.tiles.get(key);
          if (tile) {
            tile.used = this.frame;
            visible.add(key);
          } else {
            ready = false;
            const mx = x0 + size / 2 - eye.x,
              mz = z0 + size / 2 - eye.z;
            wanted.push({ key, level, x0, z0, d: Math.max(Math.abs(mx), Math.abs(mz)) / size });
          }
        }
      previous = rect;
      previousReady = ready;
    }
    this.vertexCount = 0;
    for (const [key, tile] of this.tiles) {
      if (!tile.mesh) continue;
      tile.mesh.visible = visible.has(key);
      if (tile.mesh.visible) this.vertexCount += tile.vertices;
    }
    // Nearest first, finer rings first at equal distance.
    wanted.sort((a, b) => a.d + a.level * 0.5 - (b.d + b.level * 0.5));
    for (const w of wanted) {
      if (this.inFlight.size >= IN_FLIGHT) break;
      if (this.inFlight.has(w.key)) continue;
      this.inFlight.add(w.key);
      this.post?.({
        key: w.key,
        epoch: this.epoch,
        seed: this.world.seed,
        preset: this.world.preset,
        x0: w.x0,
        z0: w.z0,
        stride: sizeOf(w.level) / cellsOf(w.level),
        cells: cellsOf(w.level),
      });
    }
    // Keep a bounded cache of tiles the rings no longer use (walking back needs no rework).
    if (this.tiles.size > 420) {
      const idle = [...this.tiles].filter(([key]) => !visible.has(key));
      idle.sort((a, b) => a[1].used - b[1].used);
      for (const [key, tile] of idle.slice(0, this.tiles.size - 360)) {
        this.dispose(tile);
        this.tiles.delete(key);
      }
    }
  }
  receive(reply: FarReply) {
    if (reply.epoch !== this.epoch) return;
    this.inFlight.delete(reply.key);
    const [levelText, txText, tzText] = reply.key.split(':'),
      level = Number(levelText),
      size = sizeOf(level);
    const tile: Tile = { mesh: null, level, used: this.frame, vertices: 0 };
    if (reply.indices.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(reply.positions, 3));
      geometry.setAttribute('farColor', new THREE.BufferAttribute(reply.colors, 4, true));
      geometry.setAttribute('farTile', new THREE.BufferAttribute(reply.tiles, 1));
      geometry.setIndex(new THREE.BufferAttribute(reply.indices, 1));
      geometry.boundingBox = new THREE.Box3(
        new THREE.Vector3(0, reply.minY, 0),
        new THREE.Vector3(size, reply.maxY, size),
      );
      geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
      const mesh = new THREE.Mesh(geometry, this.materials[level]);
      mesh.position.set(Number(txText) * size, 0, Number(tzText) * size);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.visible = false;
      this.group.add(mesh);
      tile.mesh = mesh;
      tile.vertices = reply.positions.length / 3;
    }
    this.tiles.set(reply.key, tile);
  }
  private dispose(tile: Tile) {
    if (!tile.mesh) return;
    tile.mesh.geometry.dispose();
    tile.mesh.removeFromParent();
  }
  clear() {
    this.epoch++;
    for (const tile of this.tiles.values()) this.dispose(tile);
    this.tiles.clear();
    this.inFlight.clear();
  }
  disposeAll() {
    this.clear();
    for (const material of this.materials) material.dispose();
    this.mask.dispose();
  }
}
