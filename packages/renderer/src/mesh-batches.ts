import type { RenderLayer } from '../../content/src/blocks';
import type { MeshLayer, SectionMesh } from './mesher';
/** Signed/unsigned normalized attributes retain <= 1/255 light error, without changing topology. */
export function packLayer(l: MeshLayer): MeshLayer {
  // TypedArray.from(mapFn) takes a slow callback/iterator path on this workload. Tight indexed
  // loops are substantially cheaper and produce exactly the same normalized integer values.
  let normals = l.normals,
    uvs = l.uvs,
    colors = l.colors,
    lights = l.lights;
  if (!(normals instanceof Int8Array)) {
    const out = new Int8Array(normals.length);
    for (let i = 0; i < out.length; i++) out[i] = Math.round(normals[i] * 127);
    normals = out;
  }
  if (!(uvs instanceof Uint16Array)) {
    const out = new Uint16Array(uvs.length);
    for (let i = 0; i < out.length; i++) out[i] = Math.round(uvs[i] * 65535);
    uvs = out;
  }
  if (!(colors instanceof Uint8Array)) {
    const out = new Uint8Array(colors.length);
    for (let i = 0; i < out.length; i++) out[i] = Math.round(colors[i] * 255);
    colors = out;
  }
  if (!(lights instanceof Uint8Array)) {
    const out = new Uint8Array(lights.length);
    for (let i = 0; i < out.length; i++) out[i] = Math.round(lights[i] * 255);
    lights = out;
  }
  const small = l.positions.length / 3 <= 65535;
  const indices = small
    ? l.indices instanceof Uint16Array
      ? l.indices
      : new Uint16Array(l.indices)
    : l.indices instanceof Uint32Array
      ? l.indices
      : new Uint32Array(l.indices);
  return { positions: l.positions, normals, uvs, colors, lights, visuals: l.visuals, indices };
}
export function meshBytes(mesh: SectionMesh) {
  return Object.values(mesh.layers).reduce(
    (sum, l) =>
      sum +
      l.positions.byteLength +
      l.normals.byteLength +
      l.uvs.byteLength +
      l.colors.byteLength +
      l.lights.byteLength +
      l.visuals.byteLength +
      l.indices.byteLength,
    0,
  );
}
export const meshColumnKey = (key: string) => {
  const [cx, , cz] = key.split(',');
  return `${cx},${cz}`;
};
/** Incremental sections stay cheap to rebuild; only completed columns are published in batches.
 * No 256-high atomic remesh. Eviction/travel release both CPU cache and host geometry. */
export class ColumnMeshCache {
  private columns = new Map<string, Map<number, SectionMesh>>();
  readonly dirty = new Set<string>();
  private sequence = 0;
  set(mesh: SectionMesh) {
    const key = `${mesh.cx},${mesh.cz}`;
    let col = this.columns.get(key);
    if (!col) {
      col = new Map();
      this.columns.set(key, col);
    }
    const layers: SectionMesh['layers'] = {};
    for (const [name, layer] of Object.entries(mesh.layers))
      layers[name as RenderLayer] = packLayer(layer);
    col.set(mesh.sy, { ...mesh, layers });
    this.dirty.add(key);
  }
  evict(cx: number, cz: number) {
    const key = `${cx},${cz}`;
    this.columns.delete(key);
    this.dirty.delete(key);
  }
  clear() {
    this.columns.clear();
    this.dirty.clear();
    this.sequence = 0;
  }
  get bytes() {
    let n = 0;
    for (const col of this.columns.values()) for (const mesh of col.values()) n += meshBytes(mesh);
    return n;
  }
  get sections() {
    let n = 0;
    for (const col of this.columns.values()) n += col.size;
    return n;
  }
  build(key: string): SectionMesh | null {
    const col = this.columns.get(key);
    if (!col) return null;
    const [cx, cz] = key.split(',').map(Number),
      layers: SectionMesh['layers'] = {};
    const parts = [...col.values()].sort((a, b) => a.sy - b.sy);
    for (const name of ['opaque', 'cutout', 'transparent'] as const) {
      let vertices = 0,
        indices = 0;
      for (const s of parts) {
        const l = s.layers[name];
        if (l) {
          vertices += l.positions.length / 3;
          indices += l.indices.length;
        }
      }
      if (!vertices) continue;
      const l: MeshLayer = {
        positions: new Float32Array(vertices * 3),
        normals: new Int8Array(vertices * 3),
        uvs: new Uint16Array(vertices * 2),
        colors: new Uint8Array(vertices * 3),
        lights: new Uint8Array(vertices * 2),
        visuals: new Uint8Array(vertices * 2),
        indices: vertices <= 65535 ? new Uint16Array(indices) : new Uint32Array(indices),
      };
      let v = 0,
        i = 0;
      for (const s of parts) {
        const a = s.layers[name];
        if (!a) continue;
        l.positions.set(a.positions, v * 3);
        if (s.sy !== 0)
          for (let j = 1; j < a.positions.length; j += 3) l.positions[v * 3 + j] += s.sy * 16;
        l.normals.set(a.normals, v * 3);
        l.uvs.set(a.uvs, v * 2);
        l.colors.set(a.colors, v * 3);
        l.lights.set(a.lights, v * 2);
        l.visuals.set(a.visuals, v * 2);
        if (v === 0) {
          l.indices.set(a.indices, i);
          i += a.indices.length;
        } else for (let j = 0; j < a.indices.length; j++) l.indices[i++] = a.indices[j] + v;
        v += a.positions.length / 3;
      }
      layers[name] = l;
    }
    this.dirty.delete(key);
    return {
      key: `${cx},0,${cz}`,
      cx,
      sy: 0,
      cz,
      revision: ++this.sequence,
      layers,
      emitters: parts.flatMap((s) => s.emitters ?? []),
      faces: parts.reduce((n, s) => n + s.faces, 0),
    };
  }
}
