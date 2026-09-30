import * as THREE from 'three';
import { ATLAS_COLS, ATLAS_ROWS, TILE_STRIDE } from './mesher';
interface Batch {
  mesh: THREE.InstancedMesh;
  capacity: number;
}
/** CPU rigs keep their joints; the GPU sees one draw per shared material, not per body part. */
export class RigBatches {
  private readonly batches = new Map<THREE.Material, Batch>();
  private readonly white = new THREE.Color(1, 1, 1);
  private readonly tint = new THREE.Color();
  visibleParts = 0;
  constructor(
    private readonly scene: THREE.Scene,
    private readonly geometry: THREE.BufferGeometry,
  ) {}
  begin() {
    this.visibleParts = 0;
    for (const { mesh } of this.batches.values()) mesh.count = 0;
  }
  private allocate(material: THREE.Material, capacity: number) {
    // Skinned creature parts carry a per-instance atlas part index on a private geometry copy.
    let geometry = this.geometry;
    if (material.userData.skinned) {
      geometry = this.geometry.clone();
      const parts = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
      parts.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('skinPart', parts);
    }
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, this.white);
    mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(mesh);
    return { mesh, capacity };
  }
  /** `glow` above zero brightens the whole rig: a creeper's white flash, a charging blaze. */
  add(group: THREE.Group, hurt = false, glow = 0) {
    group.updateMatrixWorld(true);
    const lift = 1 + Math.max(0, glow) * 1.6;
    this.tint.setRGB(lift, (hurt ? 0.46 : 1) * lift, (hurt ? 0.4 : 1) * lift);
    group.traverseVisible((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = object.material as THREE.Material;
      let b = this.batches.get(material);
      if (!b) {
        b = this.allocate(material, 64);
        this.batches.set(material, b);
      }
      if (b.mesh.count >= b.capacity) {
        const old = b;
        b = this.allocate(material, b.capacity * 2);
        b.mesh.count = old.mesh.count;
        b.mesh.instanceMatrix.array.set(old.mesh.instanceMatrix.array);
        b.mesh.instanceColor!.array.set(old.mesh.instanceColor!.array);
        const parts = b.mesh.geometry.getAttribute('skinPart');
        if (parts)
          (parts.array as Float32Array).set(old.mesh.geometry.getAttribute('skinPart').array);
        this.release(old.mesh);
        this.batches.set(material, b);
      }
      const i = b.mesh.count++;
      b.mesh.setMatrixAt(i, object.matrixWorld);
      b.mesh.setColorAt(i, this.tint);
      const parts = b.mesh.geometry.getAttribute('skinPart') as THREE.InstancedBufferAttribute;
      if (parts) parts.setX(i, object.userData.skinPart ?? 0);
      this.visibleParts++;
    });
  }
  finish() {
    for (const { mesh } of this.batches.values()) {
      mesh.visible = mesh.count > 0;
      if (!mesh.visible) continue;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.clearUpdateRanges();
      mesh.instanceColor!.addUpdateRange(0, mesh.count * 3);
      mesh.instanceColor!.needsUpdate = true;
      const parts = mesh.geometry.getAttribute('skinPart') as THREE.InstancedBufferAttribute;
      if (parts) {
        parts.clearUpdateRanges();
        parts.addUpdateRange(0, mesh.count);
        parts.needsUpdate = true;
      }
    }
  }
  private release(mesh: THREE.InstancedMesh) {
    mesh.removeFromParent();
    mesh.dispose();
    if (mesh.geometry !== this.geometry) mesh.geometry.dispose();
  }
  get draws() {
    let n = 0;
    for (const { mesh } of this.batches.values()) if (mesh.visible) n++;
    return n;
  }
  reset() {
    this.begin();
    this.finish();
  }
  dispose() {
    for (const { mesh } of this.batches.values()) this.release(mesh);
    this.batches.clear();
  }
}
/** All dropped items share one atlas and one instanced billboard draw, including mixed kinds. */
export class ItemBatch {
  readonly mesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly tiles = new THREE.InstancedBufferAttribute(new Float32Array(320), 1);
  constructor(scene: THREE.Scene, map: THREE.Texture) {
    const geometry = new THREE.PlaneGeometry(0.34, 0.34);
    geometry.setAttribute('spriteTile', this.tiles);
    this.tiles.setUsage(THREE.DynamicDrawUsage);
    const material = new THREE.MeshBasicMaterial({ map, alphaTest: 0.35, side: THREE.DoubleSide });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = 'attribute float spriteTile;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
      #ifdef USE_MAP
      vMapUv=vec2((mod(spriteTile,${ATLAS_COLS}.0)*${TILE_STRIDE}.0+1.5+uv.x*15.0)/${ATLAS_COLS * TILE_STRIDE}.0,1.0-(floor(spriteTile/${ATLAS_COLS}.0)*${TILE_STRIDE}.0+16.5-uv.y*15.0)/${ATLAS_ROWS * TILE_STRIDE}.0);
      #endif`,
      );
    };
    material.customProgramCacheKey = () => 'voxel-instanced-items-009';
    this.mesh = new THREE.InstancedMesh(geometry, material, 320);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
  }
  begin() {
    this.mesh.count = 0;
  }
  add(matrix: THREE.Matrix4, tile: number) {
    const i = this.mesh.count;
    if (i >= 320) return;
    this.mesh.count++;
    this.mesh.setMatrixAt(i, matrix);
    this.tiles.setX(i, tile);
  }
  finish() {
    this.mesh.visible = this.mesh.count > 0;
    if (this.mesh.count) {
      this.mesh.instanceMatrix.clearUpdateRanges();
      this.mesh.instanceMatrix.addUpdateRange(0, this.mesh.count * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
      this.tiles.clearUpdateRanges();
      this.tiles.addUpdateRange(0, this.mesh.count);
      this.tiles.needsUpdate = true;
    }
  }
  dispose() {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
