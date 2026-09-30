import { VoxelWorld } from '@core/world';
import { Simulation } from '@core/simulation';
import { FixedStepClock, TICK_MS } from '@core/clock';
import { DEFAULT_PRESET, isWorldPreset, type WorldPreset } from '@core/terrain';
import { WorldSession } from '@core/session';
import { chunkCoord } from '@core/coordinates';
import { runCoreFixture } from '@core/fixture';
import { meshSection, meshTransfers } from '@renderer/mesher';
import { ColumnMeshCache, meshColumnKey } from '@renderer/mesh-batches';
const columnMeshes = new ColumnMeshCache();
const pendingColumns = new Map<string, number>();
/** When each column began waiting on queued sections, so steady edits cannot starve it. */
const pendingSince = new Map<string, number>();
/** A column that waited this long is published from the sections it already has. */
const PUBLISH_PATIENCE_MS = 1500;
function pending(key: string, delta: number) {
  const col = meshColumnKey(key);
  const count = (pendingColumns.get(col) ?? 0) + delta;
  if (count > 0) {
    if (!pendingColumns.has(col)) pendingSince.set(col, performance.now());
    pendingColumns.set(col, count);
  } else {
    pendingColumns.delete(col);
    pendingSince.delete(col);
  }
}
import type { HostCommand, WorkerEvent } from '@network/protocol';
import { registry } from '@content/blocks';
import { itemRegistry } from '@content/items';
import type { SavedOverride } from '@core/persistence';
const scope = self as unknown as DedicatedWorkerGlobalScope;
const send = (message: WorkerEvent, transfer: ArrayBuffer[] = []) =>
  scope.postMessage(message, transfer);
let world: VoxelWorld, sim: Simulation, engineSession: WorldSession;
let orientNew = false;
let session = 0,
  preset: WorldPreset = 'valley',
  radius = 4,
  paused = true,
  ready = false;
let generation: { cx: number; cz: number }[] = [],
  meshQueue: string[] = [];
const queued = new Set<string>();

const clock = new FixedStepClock();
let lastNow = performance.now(),
  lastSnapshot = 0,
  lastStats = performance.now(),
  ticksSinceStats = 0,
  tps = 0,
  tickMs = 0;
let totalGeneration = 0,
  doneGeneration = 0,
  initialMeshed = 0,
  lastArea = '';
/**
 * The game opens once the chunks this close to the player are built (the reference's "preparing
 * spawn area"); the rest of the view distance keeps streaming in while playing. Generation goes
 * one chunk further, so the edge of that area has its neighbours for light and faces.
 */
const READY_RADIUS = 3;
function nearPlayer(cx: number, cz: number, r: number): boolean {
  return (
    Math.abs(cx - chunkCoord(sim.player.position.x)) <= r &&
    Math.abs(cz - chunkCoord(sim.player.position.z)) <= r
  );
}
function innerGenerated(): boolean {
  return !generation.some((job) => nearPlayer(job.cx, job.cz, READY_RADIUS + 1));
}
function innerMeshed(): boolean {
  for (const key of meshQueue) {
    const [cx, , cz] = key.split(',').map(Number);
    if (nearPlayer(cx, cz, READY_RADIUS)) return false;
  }
  for (const key of columnMeshes.dirty) {
    const [cx, cz] = key.split(',').map(Number);
    if (nearPlayer(cx, cz, READY_RADIUS)) return false;
  }
  return true;
}
function queueMesh(key: string) {
  if (!queued.has(key)) {
    queued.add(key);
    pending(key, 1);
    meshQueue.push(key);
  }
}
function collectDirty() {
  for (const key of world.dirtySections) queueMesh(key);
  world.dirtySections.clear();
}
/**
 * The player's own edits are meshed and published at once, ahead of chunk generation and the
 * FIFO section queue: a placed or broken block must appear on the next frame, not after the
 * world around a running player has finished loading.
 */
function urgent(budgetMs = 10) {
  if (!world.dirtySections.size) return;
  const pcx = chunkCoord(sim.player.position.x),
    pcz = chunkCoord(sim.player.position.z),
    deadline = performance.now() + budgetMs,
    columns = new Set<string>();
  for (const key of [...world.dirtySections]) {
    if (performance.now() > deadline) break;
    const [cx, sy, cz] = key.split(',').map(Number);
    if (Math.abs(cx - pcx) > 1 || Math.abs(cz - pcz) > 1 || !world.column(cx, cz)) continue;
    let lit = true;
    for (let dx = -1; dx <= 1 && lit; dx++)
      for (let dz = -1; dz <= 1 && lit; dz++) lit = sim.light.isPrepared(cx + dx, cz + dz);
    if (!lit) continue;
    world.dirtySections.delete(key);
    if (queued.has(key)) {
      queued.delete(key);
      pending(key, -1);
      const at = meshQueue.indexOf(key);
      if (at >= 0) meshQueue.splice(at, 1);
    }
    columnMeshes.set(meshSection(world, cx, sy, cz, sim.light));
    columns.add(meshColumnKey(key));
  }
  for (const key of columns) {
    const mesh = columnMeshes.build(key);
    if (mesh) send({ type: 'mesh', session, mesh }, meshTransfers(mesh));
  }
}
function updateArea(force = false) {
  const cx = chunkCoord(sim.player.position.x),
    cz = chunkCoord(sim.player.position.z),
    area = `${cx},${cz},${radius}`;
  if (!force && area === lastArea) return;
  lastArea = area;
  const todo = [];
  for (let x = cx - radius; x <= cx + radius; x++)
    for (let z = cz - radius; z <= cz + radius; z++)
      if (!world.column(x, z)) todo.push({ cx: x, cz: z });
  todo.sort((a, b) => (a.cx - cx) ** 2 + (a.cz - cz) ** 2 - ((b.cx - cx) ** 2 + (b.cz - cz) ** 2));
  generation = todo;
  totalGeneration = ready
    ? todo.length
    : todo.filter((job) => nearPlayer(job.cx, job.cz, READY_RADIUS + 1)).length;
  doneGeneration = 0;
  for (const column of world.columns.values())
    if (Math.abs(column.cx - cx) > radius + 1 || Math.abs(column.cz - cz) > radius + 1) {
      world.removeColumn(column.cx, column.cz);
      columnMeshes.evict(column.cx, column.cz);
      send({ type: 'evict', session, cx: column.cx, cz: column.cz });
    }
}
function start(command: Extract<HostCommand, { type: 'init' }>) {
  session = command.session;
  preset = isWorldPreset(command.preset) ? command.preset : DEFAULT_PRESET;
  radius = Math.max(2, Math.min(8, Math.floor(command.radius)));
  engineSession = new WorldSession(command.seed.slice(0, 64), preset, command.checkpoint);
  online = !!command.online;
  netEdits = [];
  if (online)
    engineSession.onEdit = (dimension, x, y, z, state) => {
      const key = registry.get(state).key;
      netEdits.push(dimension === 'overworld' ? [x, y, z, key] : [x, y, z, key, dimension]);
    };
  world = engineSession.world;
  sim = engineSession.simulation;
  orientNew =
    !command.checkpoint ||
    (command.checkpoint.tick === 0 &&
      command.checkpoint.editCount === 0 &&
      command.checkpoint.time === 6000);
  // A running world is alive: monsters come out in the dark and animals appear on the grass.
  // ?spawns=off boots a deterministic world for the regression suite.
  sim.naturalSpawns = command.naturalSpawning !== false;
  paused = true;
  ready = false;
  generation = [];
  meshQueue = [];
  queued.clear();
  pendingColumns.clear();
  pendingSince.clear();
  columnMeshes.clear();
  lastArea = '';
  initialMeshed = 0;
  clock.reset();
  clock.droppedMs = 0;
  lastNow = performance.now();
  lastStats = lastNow;
  ticksSinceStats = 0;
  tps = 0;
  Object.assign(jobs, {
    generationMs: 0,
    meshMs: 0,
    lightMs: 0,
    stampMs: 0,
    lightColumns: 0,
    batchMs: 0,
  });
  updateArea(true);
  snapshot();
  send({ type: 'progress', session, done: 0, total: totalGeneration, phase: 'Создаём чанки' });
}
let lastStamp = '',
  lastStampAt = 0;
const jobs = { generationMs: 0, meshMs: 0, lightMs: 0, stampMs: 0, lightColumns: 0, batchMs: 0 };
function snapshot(forceStamp = true) {
  const refresh = forceStamp || performance.now() - lastStampAt >= 500;
  if (refresh) {
    const start = performance.now();
    lastStamp = engineSession.persistenceStamp();
    lastStampAt = performance.now();
    jobs.stampMs = Math.max(jobs.stampMs, lastStampAt - start);
  }
  const { containers, itemEntities, ...frame } = sim.snapshot(refresh);
  jobs.lightColumns = sim.light.cachedColumns;
  send({
    type: 'snapshot',
    session,
    state: {
      ...frame,
      ...(refresh ? { containers, itemEntities } : {}),
      persistenceStamp: lastStamp,
    },
    jobs: { ...jobs },
    tps: paused ? 0 : tps,
    tickMs,
    backlog: generation.length + meshQueue.length + columnMeshes.dirty.size,
    droppedMs: clock.droppedMs,
    paused,
  });
}
/**
 * Clears everything the host knows about the world and starts again around the player. Called
 * after a portal carried him to another dimension: no mesh of the old one may survive.
 */
function reloadDimension(previous: VoxelWorld, message: string, built = false) {
  for (const column of previous.columns.values())
    send({ type: 'evict', session, cx: column.cx, cz: column.cz });
  if (previous !== world) {
    for (const column of [...previous.columns.values()])
      previous.removeColumn(column.cx, column.cz);
    previous.dirtySections.clear();
  }
  ready = false;
  sim.cancelActions();
  clock.reset();
  initialMeshed = 0;
  meshQueue = [];
  queued.clear();
  pendingColumns.clear();
  pendingSince.clear();
  columnMeshes.clear();
  lastArea = '';
  updateArea(true);
  for (const column of world.columns.values()) world.markColumn(column.cx, column.cz);
  collectDirty();
  send({
    type: 'travel',
    session,
    dimension: engineSession.dimension as never,
    position: { ...sim.player.position },
    built,
    message,
  });
}
let lastEdits = -1;
/** A network game reports the blocks this player's world changed, a few times a second. */
let online = false;
let netEdits: SavedOverride[] = [];
let netFlushedAt = 0;
function flushNetEdits() {
  if (!online || !netEdits.length || performance.now() - netFlushedAt < 100) return;
  netFlushedAt = performance.now();
  for (let i = 0; i < netEdits.length; i += 4096)
    send({ type: 'net-edits', session, edits: netEdits.slice(i, i + 4096) });
  netEdits = [];
}
function step() {
  const before = performance.now();
  if (!ready) return;
  sim.step();
  const trip = engineSession.travel();
  if (trip) {
    const previous = world;
    world = engineSession.world;
    sim = engineSession.simulation;
    reloadDimension(previous, trip.message, trip.built);
  }
  tickMs = tickMs * 0.9 + (performance.now() - before) * 0.1;
  ticksSinceStats++;
  // Mining finishes inside a tick: that block, too, disappears on the next frame.
  if (sim.edits !== lastEdits) {
    lastEdits = sim.edits;
    urgent(6);
  }
  updateArea();
  // Furnaces relight blocks and mining hides items: geometry must follow every tick.
  collectDirty();
  flushNetEdits();
}
scope.onmessage = (event: MessageEvent<HostCommand>) => {
  try {
    const c = event.data;
    if (c.type === 'fixture') {
      send({ type: 'fixture-result', requestID: c.requestID, result: runCoreFixture() });
      return;
    }
    if (c.type === 'init') {
      start(c);
      return;
    }
    if (c.type === 'capture') {
      if (!sim || !ready || c.session !== session)
        send({
          type: 'capture-error',
          requestID: c.requestID,
          message: 'Мир ещё загружается или сеанс уже изменился.',
        });
      else {
        // The grid and the cursor are interface state: fold them back before a snapshot.
        send({
          type: 'checkpoint',
          requestID: c.requestID,
          session,
          core: engineSession.checkpoint(),
          stamp: engineSession.persistenceStamp(),
        });
        snapshot();
      }
      return;
    }
    if (!sim) return;
    if (c.type === 'net-edits') {
      if (engineSession.applyRemote(c.edits) > 0) {
        urgent(6);
        collectDirty();
      }
      return;
    }
    switch (c.type) {
      case 'cancel-input':
        sim.cancelActions();
        snapshot();
        break;
      case 'input':
        if (!paused && ready) sim.setInput(c.input);
        break;
      case 'select':
        if (sim.gameMode !== 'survival' || import.meta.env.DEV) sim.creativeSelect(c.state);
        snapshot();
        break;
      case 'hotbar':
        if (sim.select(c.index)) snapshot();
        break;
      case 'creative-take':
      case 'creative-trash': {
        const result =
          c.type === 'creative-take' ? sim.creativeTake(c.item, c.mode) : sim.creativeTrash(c.all);
        if (
          !result.ok ||
          (c.type === 'creative-take' && c.mode === 'inventory') ||
          c.type === 'creative-trash'
        )
          send({ type: 'notice', ok: result.ok, message: result.reason ?? result.message ?? '' });
        snapshot();
        break;
      }
      case 'grant': {
        if (sim.gameMode === 'survival' && !import.meta.env.DEV) {
          send({
            type: 'notice',
            ok: false,
            message: 'Выдача предметов доступна в творчестве и лаборатории',
          });
          break;
        }
        const result = sim.grant(c.item, c.count);
        send({
          type: 'notice',
          ok: typeof result === 'number',
          message:
            typeof result === 'number'
              ? `Выдано: ${itemRegistry.find(c.item)?.name ?? c.item} ×${result}`
              : result,
        });
        snapshot();
        break;
      }
      case 'drop':
        if (!paused) {
          const dropped = sim.dropSelected(c.all);
          send({
            type: 'notice',
            ok: dropped.ok,
            message: dropped.reason ?? dropped.message ?? '',
          });
          snapshot();
        }
        break;
      case 'die': {
        const dropped = sim.die();
        send({ type: 'notice', ok: true, message: `При смерти выпало предметов: ${dropped}` });
        updateArea(true);
        snapshot();
        break;
      }
      case 'mine':
        sim.setMining(c.active && !paused && ready);
        break;
      case 'hold': {
        const result = sim.setUseHold(c.active && !paused && ready);
        if (!result.ok && result.reason)
          send({ type: 'notice', ok: false, message: result.reason });
        snapshot();
        break;
      }
      case 'difficulty': {
        const ok = sim.setDifficulty(c.difficulty);
        send({ type: 'notice', ok, message: ok ? 'Сложность изменена' : 'Неизвестная сложность' });
        snapshot();
        break;
      }
      case 'time': {
        sim.setTime(c.value);
        snapshot();
        break;
      }
      case 'block': {
        // Debug hook: a raw block state, written through the same journal a player's edit uses.
        sim.setBlockState(c.x, c.y, c.z, c.state);
        snapshot();
        break;
      }
      case 'probe': {
        const state = world.getBlock(c.x, c.y, c.z);
        send({
          type: 'notice',
          ok: true,
          message: `Проба ${c.x},${c.y},${c.z}: блок ${state}, сигнал ${sim.redstone.powerAt(c.x, c.y, c.z)}`,
        });
        snapshot();
        break;
      }
      case 'press': {
        const changed = sim.redstone.press(c.x, c.y, c.z);
        send({
          type: 'notice',
          ok: changed,
          message: `Рычаг ${c.x},${c.y},${c.z}: ${world.getBlock(c.x, c.y, c.z)}`,
        });
        snapshot();
        break;
      }
      case 'mob': {
        if (c.kind === null) {
          sim.clearMobs();
          snapshot();
          break;
        }
        const result = sim.spawnMob(c.kind, c.distance ?? 3);
        send({ type: 'notice', ok: result.ok, message: result.reason ?? result.message ?? '' });
        snapshot();
        break;
      }
      case 'vitals': {
        // Test and debug helper: set the survival bar directly instead of simulating hours.
        if (typeof c.health === 'number') sim.survival.health = Math.max(0, Math.min(20, c.health));
        if (typeof c.food === 'number') sim.survival.food = Math.max(0, Math.min(20, c.food));
        if (typeof c.saturation === 'number')
          sim.survival.saturation = Math.max(0, Math.min(20, c.saturation));
        if (typeof c.xp === 'number') sim.survival.addXp(c.xp - sim.survival.xp);
        sim.survival.dead = sim.survival.health <= 0 ? sim.survival.dead : false;
        snapshot();
        break;
      }
      case 'damage': {
        const applied = sim.damagePlayer(
          c.amount,
          (c.kind ?? 'generic') as Parameters<typeof sim.damagePlayer>[1],
        );
        send({ type: 'notice', ok: true, message: `Получено урона: ${applied.toFixed(1)}` });
        snapshot();
        break;
      }
      case 'slot-click': {
        const result = sim.slotClick(c.id, c.index, c.button, c.options);
        if (!result.ok && result.reason)
          send({ type: 'notice', ok: false, message: result.reason });
        snapshot();
        break;
      }
      case 'open':
        sim.openContainer(c.kind, c.x, c.y, c.z);
        snapshot();
        break;
      case 'open-crafting':
        sim.openCrafting();
        snapshot();
        break;
      case 'close-container':
        sim.closeContainer();
        snapshot();
        break;
      case 'trade': {
        const result = sim.trade(Math.floor(Number(c.index)));
        send({ type: 'notice', ok: result.ok, message: result.message ?? result.reason ?? '' });
        snapshot();
        break;
      }
      case 'enchant-apply': {
        const result = sim.enchantApply(c.id);
        send({ type: 'notice', ok: result.ok, message: result.message ?? result.reason ?? '' });
        snapshot();
        break;
      }
      case 'brewing-fill': {
        const result = sim.brewingFill();
        send({ type: 'notice', ok: result.ok, message: result.message ?? result.reason ?? '' });
        snapshot();
        break;
      }
      case 'brewing-take': {
        const result = sim.brewingTake();
        send({ type: 'notice', ok: result.ok, message: result.message ?? result.reason ?? '' });
        snapshot();
        break;
      }
      case 'anvil-take': {
        const result = sim.anvilTake();
        send({ type: 'notice', ok: result.ok, message: result.message ?? result.reason ?? '' });
        snapshot();
        break;
      }
      case 'recipe': {
        const result = sim.autoFill(c.id);
        send({
          type: 'notice',
          ok: result.ok,
          message: result.reason ?? result.message ?? 'Рецепт разложен',
        });
        snapshot();
        break;
      }
      case 'pause':
        paused = c.paused;
        sim.cancelActions();
        clock.reset();
        lastNow = performance.now();
        snapshot();
        break;
      case 'step':
        if (paused && ready) {
          step();
          snapshot();
        }
        break;
      case 'fly':
        if (sim.gameMode === 'survival' && !import.meta.env.DEV) {
          send({ type: 'notice', ok: false, message: 'В выживании полёт недоступен' });
          break;
        }
        sim.player.flying = !sim.player.flying;
        sim.player.velocity.y = 0;
        snapshot();
        break;
      case 'respawn': {
        if (sim.gameMode === 'survival' && !sim.survival.dead && !import.meta.env.DEV) break;
        const previous = world,
          trip = engineSession.respawn();
        world = engineSession.world;
        sim = engineSession.simulation;
        reloadDimension(previous, trip.message);
        snapshot();
        break;
      }
      case 'teleport': {
        // Debug and lab only: move the player and fly, so the new ground can load under them.
        if (sim.gameMode === 'survival' && !import.meta.env.DEV) break;
        sim.player.position = { x: c.x, y: c.y, z: c.z };
        sim.player.velocity = { x: 0, y: 0, z: 0 };
        sim.player.flying = true;
        updateArea(true);
        snapshot();
        break;
      }
      case 'weather':
        // Lab tool: force a sky, or hand it back to the seed's schedule with null.
        sim.weatherOverride =
          c.rain === null
            ? null
            : {
                rain: Math.max(0, Math.min(1, c.rain)),
                thunder: Math.max(0, Math.min(1, c.thunder)),
              };
        snapshot();
        break;
      case 'travel': {
        const previous = world;
        const trip = engineSession.travelTo(c.dimension);
        world = engineSession.world;
        sim = engineSession.simulation;
        reloadDimension(previous, trip.message, trip.built);
        break;
      }
      case 'radius':
        radius = Math.max(2, Math.min(8, Math.floor(c.radius)));
        updateArea(true);
        break;
      case 'interact': {
        if (paused || !ready) return;
        const result =
          c.action === 'use' ? sim.use() : c.action === 'hit' ? sim.attack() : sim.pick();
        urgent();
        collectDirty();
        send({
          type: 'notice',
          ok: result.ok,
          message:
            result.reason ??
            result.message ??
            (c.action === 'hit'
              ? 'Блок разрушен'
              : c.action === 'use'
                ? 'Использовано'
                : 'Блок выбран'),
          picked: result.picked,
        });
        snapshot();
        break;
      }
    }
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
function pump() {
  if (!world) {
    setTimeout(pump, 100);
    return;
  }
  try {
    const now = performance.now(),
      elapsed = now - lastNow;
    lastNow = now;
    // The frame state goes out the moment a tick finishes, before any meshing or generation,
    // so the host interpolates between consecutive ticks instead of aliased timer samples.
    if (ready && !paused && clock.advance(elapsed, step) > 0) {
      snapshot(false);
      lastSnapshot = now;
    }
    if (now - lastStats >= 1000) {
      tps = Math.round((ticksSinceStats * 1000) / (now - lastStats));
      ticksSinceStats = 0;
      lastStats = now;
    }
    const deadline = performance.now() + 9;
    // Before the game opens, generation stops at the ready area so meshing can finish it; later,
    // generation and meshing share each pump so near chunks show while far ones generate.
    const inner = innerGenerated();
    const generationDeadline = inner ? (ready ? performance.now() + 5 : 0) : deadline;
    while (performance.now() < generationDeadline && generation.length) {
      const job = generation.shift()!;
      const jobStart = performance.now();
      engineSession.loadColumn(job.cx, job.cz);
      jobs.generationMs = Math.max(jobs.generationMs, performance.now() - jobStart);
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) world.markColumn(job.cx + dx, job.cz + dz);
      doneGeneration++;
      if (!ready)
        send({
          type: 'progress',
          session,
          done: Math.min(doneGeneration, totalGeneration),
          total: totalGeneration,
          phase: 'Создаём чанки',
        });
    }
    if (generation.length === 0 || innerGenerated()) {
      collectDirty();
      while (performance.now() < deadline && meshQueue.length) {
        const key = meshQueue.shift()!;
        queued.delete(key);
        pending(key, -1);
        const [cx, sy, cz] = key.split(',').map(Number);
        if (!world.column(cx, cz)) continue;
        // Each lighting dependency is one bounded queue job, not nine hidden flood fills.
        let warmed = false;
        prepareLight: for (let dx = -1; dx <= 1; dx++)
          for (let dz = -1; dz <= 1; dz++) {
            if (sim.light.isPrepared(cx + dx, cz + dz)) continue;
            const lightStart = performance.now();
            sim.light.prepare(cx + dx, cz + dz);
            jobs.lightMs = Math.max(jobs.lightMs, performance.now() - lightStart);
            warmed = true;
            break prepareLight;
          }
        if (warmed) {
          meshQueue.unshift(key);
          queued.add(key);
          pending(key, 1);
          continue;
        }
        const jobStart = performance.now();
        const mesh = meshSection(world, cx, sy, cz, sim.light);
        jobs.meshMs = Math.max(jobs.meshMs, performance.now() - jobStart);
        columnMeshes.set(mesh);
        initialMeshed++;
        if (!ready)
          send({
            type: 'progress',
            session,
            done: initialMeshed,
            total: initialMeshed + meshQueue.length,
            phase: 'Собираем геометрию',
          });
      }
      // Only publish a column after its queued section work has finished; at most two uploads
      // per pump. This also coalesces edits while retaining all unchanged cached sections.
      let sent = 0;
      for (const key of columnMeshes.dirty) {
        // Growing crops and flowing water keep re-queueing sections; on a slow machine that
        // would hold a whole column back forever, so an old enough wait publishes what is ready.
        if (pendingColumns.has(key)) {
          const since = pendingSince.get(key) ?? 0;
          if (performance.now() - since < PUBLISH_PATIENCE_MS) continue;
          pendingSince.set(key, performance.now());
        }
        // One upload per pump always goes out, even when meshing spent the whole budget.
        if (sent >= 2 || (sent >= 1 && performance.now() >= deadline)) break;
        const batchStart = performance.now();
        const mesh = columnMeshes.build(key);
        if (mesh) send({ type: 'mesh', session, mesh }, meshTransfers(mesh));
        jobs.batchMs = Math.max(jobs.batchMs, performance.now() - batchStart);
        sent++;
      }
      if (!ready && innerGenerated() && innerMeshed()) {
        ready = true;
        if (orientNew) {
          engineSession.orientNewPlayer();
          orientNew = false;
        }
        snapshot();
        send({
          type: 'ready',
          session,
          spawn: { ...sim.player.position },
          look: { yaw: sim.input.yaw, pitch: sim.input.pitch },
        });
      }
    }
    if (ready && now - lastSnapshot >= (paused ? 1000 : 50)) {
      snapshot(false);
      lastSnapshot = now;
    }
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    paused = true;
    generation = [];
    meshQueue = [];
  }
  // Wake up for the next tick on time rather than up to one timer period late.
  const untilTick = Math.max(1, TICK_MS * (1 - clock.alpha) - (performance.now() - lastNow));
  setTimeout(
    pump,
    paused && ready && !generation.length && !meshQueue.length && !columnMeshes.dirty.size
      ? 100
      : Math.min(10, untilTick),
  );
}
setTimeout(pump, 10);
