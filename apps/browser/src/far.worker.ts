/**
 * Far terrain worker: samples the generator for tiles beyond the loaded chunks and turns them
 * into compact geometry. Kept apart from the simulation worker so the horizon never delays a
 * game tick or a chunk mesh; one tile at a time, nearest first (the renderer orders requests).
 */
import { farPatchV5 } from '@core/worldgen/far-v5';
import type { PresetV5 } from '@core/worldgen/generator-v5';
import { buildFarMesh } from '@renderer/far-mesher';
import type { FarRequest, FarReply } from '@renderer/far-terrain';

self.onmessage = (event: MessageEvent<FarRequest>) => {
  const request = event.data;
  const patch = farPatchV5(
    request.seed,
    request.preset as PresetV5,
    request.x0,
    request.z0,
    request.stride,
    request.cells,
  );
  const mesh = buildFarMesh(patch, request.stride, request.cells);
  const reply: FarReply = { key: request.key, epoch: request.epoch, ...mesh };
  (self as unknown as Worker).postMessage(reply, [
    mesh.positions.buffer,
    mesh.colors.buffer,
    mesh.tiles.buffer,
    mesh.indices.buffer,
  ]);
};
