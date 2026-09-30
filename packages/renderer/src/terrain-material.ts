import * as THREE from 'three';
import { ATLAS_COLS, ATLAS_ROWS, TILE_STRIDE } from './mesher';
import { ANIMATED_TILE_BASE } from './pixel-art';

/**
 * Uniforms the terrain, the far terrain and the sky share: one object per value, so a single
 * write per frame reaches every program.
 */
export class SharedLight {
  readonly sky = { value: 1 };
  readonly ambient = { value: 0.08 };
  readonly time = { value: 0 };
  readonly motion = { value: 1 };
  /** Unit vector towards the sun (towards the moon at night). */
  readonly sunDir = { value: new THREE.Vector3(0, 1, 0) };
  /** Colour the fog and the sky take on around the sun: warm at dawn and dusk, pale at noon. */
  readonly glow = { value: new THREE.Color('#fff2d8') };
  /** 0‥1 strength of that glow. */
  readonly glowPower = { value: 0.3 };
  /** Daylight 0‥1 for sun highlights. */
  readonly day = { value: 1 };
  /** Colour of the sky at the horizon: what water reflects at grazing angles. */
  readonly horizon = { value: new THREE.Color('#c0d8ff') };
  uniforms() {
    return {
      voxelSky: this.sky,
      voxelAmbient: this.ambient,
      voxelTime: this.time,
      voxelMotion: this.motion,
      voxelSunDir: this.sunDir,
      voxelGlow: this.glow,
      voxelGlowPower: this.glowPower,
      voxelDay: this.day,
      voxelHorizon: this.horizon,
    };
  }
}

/** GLSL shared by the terrain and far-terrain programs: grading and the sun-tinted fog. */
export const SHARED_GLSL = /* glsl */ `
uniform vec3 voxelSunDir;uniform vec3 voxelGlow;uniform float voxelGlowPower;uniform float voxelDay;uniform vec3 voxelHorizon;
vec3 voxelGrade(vec3 c){
#ifdef VOXEL_SHADERS
  float l=dot(c,vec3(.299,.587,.114));
  c=mix(vec3(l),c,1.1);
  c=mix(c,c*c*(3.0-2.0*c),.12);
#endif
  return c;
}
vec3 voxelFogColor(vec3 fogCol,vec3 viewDir){
#ifdef VOXEL_SHADERS
  float s=max(dot(viewDir,voxelSunDir),0.0);
  fogCol=mix(fogCol,voxelGlow,(pow(s,6.0)*.85+pow(s,2.0)*.15)*voxelGlowPower);
#endif
  return fogCol;
}`;

const ATLAS_W = ATLAS_COLS * TILE_STRIDE,
  ATLAS_H = ATLAS_ROWS * TILE_STRIDE,
  MIP_W = ATLAS_COLS * 16,
  MIP_H = ATLAS_ROWS * 16;

/**
 * One shared atlas, light separation and cheap GPU animation; no screen-space passes.
 *
 * The meshes keep their UVs into the gutter atlas (18 px cells); the shader turns them into the
 * gutter-less mip atlas (16 px cells, see `mipAtlas`) and samples it with explicit gradients
 * capped at mip level 4, so a tile never blends with its neighbour. Cut-outs take their alpha
 * from level 0, keeping leaves and plants as crisp as before.
 *
 * With VOXEL_SHADERS the same programs also add a few very cheap per-pixel touches, none of
 * which needs an extra pass or render target: sunlight that depends on the face direction,
 * fog that glows towards the sun, water with a fresnel sky reflection, ripples and sun glints,
 * and a light colour grade.
 */
export class TerrainMaterials {
  readonly light: SharedLight;
  readonly layers: Record<string, THREE.MeshBasicMaterial>;
  private shaders = true;
  constructor(map: THREE.Texture, light = new SharedLight()) {
    this.light = light;
    const create = (kind: 'opaque' | 'cutout' | 'transparent', options = {}) => {
      const material = new THREE.MeshBasicMaterial({ map, vertexColors: true, ...options });
      material.toneMapped = false;
      const defined = material as THREE.MeshBasicMaterial & { defines: Record<string, string> };
      defined.defines = { VOXEL_SHADERS: '' };
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, this.light.uniforms());
        shader.vertexShader =
          'attribute vec2 voxelLight; attribute vec2 voxelVisual; varying vec2 vVoxelLight; varying float vVoxelKind; varying vec3 vVoxelWorld; varying vec3 vVoxelNormal; uniform float voxelTime; uniform float voxelMotion;\n' +
          shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vVoxelLight=voxelLight; vVoxelKind=voxelVisual.x; vVoxelNormal=normal;
          vec3 worldP=(modelMatrix*vec4(position,1.0)).xyz;
          float weight=voxelVisual.y/255.0*voxelMotion;
          if((voxelVisual.x>4.5 && voxelVisual.x<5.5) || voxelVisual.x>6.5) {
            transformed.x+=sin(voxelTime*1.8+worldP.x*.65+worldP.z*.45)*.045*weight;
            transformed.z+=cos(voxelTime*1.4+worldP.z*.6)*.025*weight;
          } else if(voxelVisual.x>.5 && voxelVisual.x<1.5) {
            transformed.y+=sin(voxelTime*1.6+worldP.x*.85+worldP.z*.65)*.022*weight;
          }
          vVoxelWorld=(modelMatrix*vec4(transformed,1.0)).xyz;`,
        );
        shader.fragmentShader =
          'uniform float voxelSky;uniform float voxelAmbient;uniform float voxelTime;uniform float voxelMotion;varying vec2 vVoxelLight;varying float vVoxelKind;varying vec3 vVoxelWorld;varying vec3 vVoxelNormal;\n' +
          SHARED_GLSL +
          '\n' +
          shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          `
          #ifdef USE_MAP
            // Gutter-atlas UV → tile + position inside the tile.
            vec2 atlasTexel=vec2(vMapUv.x*${ATLAS_W}.0,(1.0-vMapUv.y)*${ATLAS_H}.0);
            vec2 gx=dFdx(atlasTexel)*${16 / TILE_STRIDE},gy=dFdy(atlasTexel)*${16 / TILE_STRIDE};
            vec2 cellXY=floor(atlasTexel/${TILE_STRIDE}.0);
            vec2 inner=clamp((atlasTexel-cellXY*${TILE_STRIDE}.0-1.0)/16.0,.5/16.0,15.5/16.0);
            float tile=cellXY.x+cellXY.y*${ATLAS_COLS}.0;
            if((vVoxelKind>.5 && vVoxelKind<4.5) || (vVoxelKind>5.5 && vVoxelKind<6.5)) {
              float frame=mod(floor(voxelTime*(vVoxelKind>2.5?7.0:3.0)*voxelMotion),4.0);
              tile=${ANIMATED_TILE_BASE}.0+(floor(vVoxelKind+.5)-1.0)*4.0+frame;
            }
            vec2 mipUV=(vec2(mod(tile,${ATLAS_COLS}.0),floor(tile/${ATLAS_COLS}.0))+inner)*16.0/vec2(${MIP_W}.0,${MIP_H}.0);
            // Level 4 at most: one texel per tile, never a neighbour's.
            float footprint=max(length(gx),length(gy));
            if(footprint>16.0){gx*=16.0/footprint;gy*=16.0/footprint;}
            vec4 texel=textureGrad(map,mipUV,gx/vec2(${MIP_W}.0,${MIP_H}.0),gy/vec2(${MIP_W}.0,${MIP_H}.0));
            ${kind === 'cutout' ? 'texel.a=textureLod(map,mipUV,0.0).a;' : ''}
            diffuseColor*=texel;
          #endif`,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float skyPower=vVoxelLight.x*voxelSky;
          vec3 skyLight=vec3(.90,.96,1.0)*skyPower;
          #ifdef VOXEL_SHADERS
            // Faces that look at the sun get a little warmer light, the others a little cooler.
            float sunFacing=dot(normalize(vVoxelNormal),voxelSunDir);
            skyLight*=mix(vec3(.93,.96,1.04),vec3(1.07,1.03,.95),clamp(sunFacing*.5+.5,0.0,1.0)*voxelDay+(1.0-voxelDay)*.5);
          #endif
          vec3 lighting=vec3(voxelAmbient)+max(skyLight,vec3(1.08,.88,.68)*vVoxelLight.y);
          if((vVoxelKind>1.5 && vVoxelKind<4.5) || (vVoxelKind>5.5 && vVoxelKind<6.5)) lighting=max(lighting,vec3(.85));
          diffuseColor.rgb*=lighting;
          #ifdef VOXEL_SHADERS
          ${
            kind === 'transparent'
              ? `if(vVoxelKind>.5 && vVoxelKind<1.5 && vVoxelNormal.y>.5) {
              // Water: moving ripples, the sky mirrored at grazing angles and glints of sun.
              vec3 toEye=normalize(cameraPosition-vVoxelWorld);
              float t=voxelTime*voxelMotion;
              vec2 w=vVoxelWorld.xz;
              vec3 n=normalize(vec3(sin(w.x*1.7+t*1.9)*.05+sin(w.y*2.3-t*1.3)*.035,1.0,cos(w.y*1.9+t*1.6)*.05+cos(w.x*2.9+t*1.1)*.03));
              float fres=pow(1.0-max(dot(toEye,n),0.0),3.0);
              diffuseColor.rgb=mix(diffuseColor.rgb,voxelHorizon*max(skyPower,.08),fres*.55);
              diffuseColor.a=mix(diffuseColor.a,1.0,fres*.5);
              float spec=pow(max(dot(reflect(-toEye,n),voxelSunDir),0.0),90.0)*voxelDay*skyPower;
              diffuseColor.rgb+=voxelGlow*spec*1.4;
              diffuseColor.a=min(1.0,diffuseColor.a+spec);
            }`
              : ''
          }
          #endif
          diffuseColor.rgb=voxelGrade(diffuseColor.rgb);`,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <fog_fragment>',
          `#ifdef USE_FOG
            float fogDepth=length(vVoxelWorld.xz-cameraPosition.xz);
            float fogFactor=smoothstep(fogNear,fogFar,max(fogDepth,vFogDepth*.6));
            vec3 fogTint=voxelFogColor(fogColor,normalize(vVoxelWorld-cameraPosition));
            gl_FragColor.rgb=mix(gl_FragColor.rgb,fogTint,fogFactor);
          #endif`,
        );
      };
      material.customProgramCacheKey = () =>
        `voxel-terrain-010-${kind}-${'VOXEL_SHADERS' in defined.defines ? 's' : 'p'}`;
      return material;
    };
    this.layers = {
      opaque: create('opaque'),
      cutout: create('cutout', { alphaTest: 0.5, side: THREE.DoubleSide }),
      transparent: create('transparent', {
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    };
  }
  get sky() {
    return this.light.sky;
  }
  get ambient() {
    return this.light.ambient;
  }
  get time() {
    return this.light.time;
  }
  get motion() {
    return this.light.motion;
  }
  /** Turns the cheap shader touches on or off; recompiles the three programs once. */
  setShaders(on: boolean) {
    if (on === this.shaders) return;
    this.shaders = on;
    for (const material of Object.values(this.layers)) {
      (material as THREE.MeshBasicMaterial & { defines: Record<string, string> }).defines = on
        ? { VOXEL_SHADERS: '' }
        : {};
      material.needsUpdate = true;
    }
  }
  dispose() {
    for (const material of Object.values(this.layers)) material.dispose();
  }
}
