import { GameAudio } from './audio';
import {
  isGameMode,
  GAME_MODE_NAMES,
  JOURNEY_GOALS,
  JOURNEY_TEXT,
  type GameMode,
} from '@core/gameplay';
import { ENCHANTMENTS } from '@core/stations';
import { ingredientName } from '@core/crafting';
import { TRADE_MAX_USES } from '@core/trading';
import { APP_VERSION } from '@content/version';
import {
  controls,
  graphics,
  installClientSettings,
  captureBinding,
  cancelBinding,
  refreshControlLabels,
} from './client-settings';
import { WheelSelector } from '@ui/controls';
import { renderInterval } from '@renderer/quality';
const wheelSelector = new WheelSelector();
import '@ui/app.css';
import { mountUI, $ } from '@ui/ui';
import { VoxelRenderer } from '@renderer/scene';
import { installPlayerLook } from './player-look';
import { Navigation } from './navigation';
import { itemIcon } from '@renderer/textures';
import type { SectionMesh } from '@renderer/mesher';
import { ITEMS, itemDurability, itemRegistry } from '@content/items';
import { registry } from '@content/blocks';
import { CREATIVE_TABS, creativeItems, type CreativeTab } from '@content/creative';
import { icon as uiIcon } from '@ui/icons';
import { EMPTY_INPUT, type PlayerInput } from '@core/player';
import { DEFAULT_PRESET, PRESET_LABELS, isWorldPreset, type WorldPreset } from '@core/terrain';
import type {
  ContainerView,
  OpenContainerKind,
  SimulationSnapshot,
  SlotClickOptions,
} from '@core/simulation';
import type { SlotData } from '@core/inventory';
import type { HostCommand, WorkerEvent } from '@network/protocol';
import type { runCoreFixture } from '@core/fixture';
import type { CoreCheckpoint } from '@core/persistence';
import type { OpenWorld } from '@storage/repository';
import type { ClientCheckpoint } from '@storage/format';
import { mountWorldUI, renderSaveStatus } from '@ui/worlds';
import { SaveCoordinator, type CaptureTicket } from './saves';
import { installWorldActions } from './world-actions';
import { TouchControls } from './touch-controls';
import { OnlineClient } from './online';
import { cleanName, serverURL, DEFAULT_PORT, type NetPlayer } from '@network/multiplayer';
import { BUILTIN_SKINS } from '@renderer/player-skins';

mountUI();
mountWorldUI();
const audio = new GameAudio();
let showJourney = true,
  reducedMotion = false;
try {
  const preferences = JSON.parse(localStorage.getItem('voxel:accessibility') ?? '{}');
  audio.setVolume(preferences.volume ?? 0.35);
  audio.setMusicVolume(preferences.music ?? 0.5);
  showJourney = preferences.showJourney !== false;
  reducedMotion =
    preferences.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
} catch {
  /* Opaque previews have no localStorage. */
}
function savePreferences() {
  try {
    localStorage.setItem(
      'voxel:accessibility',
      JSON.stringify({
        volume: audio.volume,
        music: audio.musicVolume,
        showJourney,
        reducedMotion,
      }),
    );
  } catch {
    /* Keep the in-memory choices. */
  }
}
$<HTMLInputElement>('#volume').value = String(Math.round(audio.volume * 100));
$('#volume-label').textContent = `${Math.round(audio.volume * 100)}%`;
$<HTMLInputElement>('#music-volume').value = String(Math.round(audio.musicVolume * 100));
$('#music-volume-label').textContent = `${Math.round(audio.musicVolume * 100)}%`;
$<HTMLInputElement>('#show-journey').checked = showJourney;
$<HTMLInputElement>('#reduce-motion').checked = reducedMotion;
document.body.classList.toggle('reduced-motion', reducedMotion);
window.addEventListener('pointerdown', () => void audio.unlock(), { passive: true });
window.addEventListener('keydown', () => void audio.unlock(), { passive: true });

type View = 'home' | 'game' | 'pause' | 'worlds' | 'palette' | 'create' | 'multiplayer' | 'about';
/** Whether the pause journal was opened from the title screen (settings) rather than the game. */
let menuFromHome = false;
/** The title screen slowly turns the view around the spawn, as a living panorama. */
let panoramaYaw = 0;
let view: View = 'home';
let ready = false,
  workerReady = false,
  session = 0;
// ?seed=/?preset= request a world; with no explicit request the last saved world opens.
const query = new URLSearchParams(location.search);
let seed = query.get('seed')?.trim().slice(0, 64) || '642018';
const requestedPreset = query.get('preset');
// A world type asked for in the address bar wins; otherwise every new world is a real one.
let preset: WorldPreset = isWorldPreset(requestedPreset) ? requestedPreset : DEFAULT_PRESET;
// Real chunks around the player: six on a computer (the far terrain takes over from 96 blocks),
// three on a phone. Worlds keep the distance they were saved with.
let radius = /^[2-8]$/.test(query.get('radius') || '')
  ? Number(query.get('radius'))
  : initialDevice() === 'phone'
    ? 3
    : 6;
// ?spawns=off keeps the automatic creature spawns away; the regression suite pins the world.
const naturalSpawning = query.get('spawns') !== 'off';
let yaw = 1.48,
  pitch = -0.3,
  sensitivity = 0.0019;
let state: SimulationSnapshot | null = null;
let workerJobs = { generationMs: 0, meshMs: 0, lightMs: 0, stampMs: 0, lightColumns: 0 };
let tps = 0,
  tickMs = 0,
  backlog = 0,
  droppedMs = 0,
  fps = 0;
let selected = 0,
  toastTimer = 0,
  pointerWasLocked = false;
let ignoreLookUntil = 0;
let ignoreNextLockedMove = true;
let drag: {
  x: number;
  y: number;
  moved: number;
  button: number;
  /** True for a fallback right-button press, which may end as a use instead of a look. */
  useClick: boolean;
} | null = null;
let mineButton = false;
let lastJumpTap = 0;
/** Arm swings so far; other players of a network game see each one. */
let swings = 0;
/** Interfaces open after a round trip through the worker: a lost pointer lock in that
 *  window must not be mistaken for the player pressing Escape. */
let quietMenuUntil = 0;
let panelRequestUntil = 0;
let panelSignature = '';
let panelOpen = false;
let hoveredSlot: { id: string | null; index: number } | null = null;
let cursorDrag: { button: number; visited: Set<string> } | null = null;
let recipeQuery = '';
let recipeOnlyCraftable = false;
const keys = new Set<string>();
let survivalSignature = '';
let useButton = false;
/** True while the fallback (no pointer lock) right button is holding a food, bow or shield. */
let holdSent = false;
/** When the held right button last placed a block: holding it builds every four ticks. */
let lastUseAt = 0;
/** F1: a clean view without the interface and the hand, for looking and screenshots. */
let hudHidden = false;
let screenshotPending = false;
let lastHealth = 20;
let flashTimer = 0;
const messages: string[] = [];
const uploads: SectionMesh[] = [];
const canvas = $<HTMLCanvasElement>('#world');
/** On-screen controls for phones; created hidden and switched on by the device choice. */
const touchControls = new TouchControls(canvas, {
  look: (dx, dy) => look(dx, dy),
  mine: (active) => {
    if (active && (view !== 'game' || !ready || openPanel() || panelPending())) return;
    if (active === mineButton) return;
    mineButton = active;
    send({ type: 'mine', active });
    if (active) act('hit');
  },
  use: () => act('use'),
  hold: (active) => {
    if (active === holdSent) return;
    holdSent = active;
    send({ type: 'hold', active });
  },
  holdsUse: () => holdsUse(),
  jumpTap: () => jumpTapped(),
  inventory: () => {
    if (openPanel() || panelPending()) requestClosePanel();
    else openInventory();
  },
  pause: () => menu(),
  drop: () => send({ type: 'drop', all: false }),
  chat: () => openChat(),
  changed: () => emitInput(true),
});
const fixtureRequests = new Map<
  number,
  {
    resolve: (result: ReturnType<typeof runCoreFixture>) => void;
    reject: (error: Error) => void;
    timer: number;
  }
>();
const captureRequests = new Map<
  number,
  { resolve: (ticket: CaptureTicket) => void; reject: (error: Error) => void; timer: number }
>();
let requestID = 0;
let worldRenderer: VoxelRenderer;
// The HUD markup exists once the UI module has been imported; the compass reads it here.
const navigation = new Navigation();
const worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), {
  type: 'module',
  name: 'WebCraft simulation + meshing',
});
const send = (command: HostCommand) => worker.postMessage(command);
// The horizon: far terrain is sampled from the generator in a worker of its own.
const farWorker = new Worker(new URL('./far.worker.ts', import.meta.url), {
  type: 'module',
  name: 'WebCraft far terrain',
});

function fail(message: string) {
  $('#fatal').hidden = false;
  $('#fatal-message').textContent = message;
  worker.terminate();
}
try {
  worldRenderer = new VoxelRenderer(canvas);
  worldRenderer.connectFar((request) => farWorker.postMessage(request));
  farWorker.onmessage = (event) => worldRenderer.receiveFar(event.data);
  worldRenderer.onThunder = (distance) => audio.thunder(distance);
  installClientSettings((settings) => worldRenderer.setQuality(settings), clearInput);
  installPlayerLook(worldRenderer);
  for (const [id, key] of [
    ['#nav-compass', 'compass'],
    ['#nav-coords', 'coords'],
  ] as const) {
    const box = $<HTMLInputElement>(id);
    box.checked = navigation.settings[key];
    box.addEventListener('change', () => navigation.setPrefs({ [key]: box.checked }));
  }
  worldRenderer.reducedMotion = reducedMotion;
} catch (error) {
  fail(
    `Включи аппаратное ускорение или открой страницу в современном настольном браузере. ${error instanceof Error ? error.message : String(error)}`,
  );
  throw error;
}
function toast(message: string, error = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.hidden = true;
  }, 2400);
  messages.push(message);
  if (messages.length > 30) messages.shift();
}
/* --------------------------------------------------------------------- hotbar and HUD */
function icon(itemKey: string): string {
  return itemIcon(itemKey, worldRenderer.atlas.canvas);
}
function slotMarkup(id: string, index: number, slot: SlotData, className = ''): string {
  const item = slot ? itemRegistry.find(slot[0]) : undefined;
  const damage = slot?.[2] ?? 0;
  const durability = itemDurability(item);
  const left = durability ? durability - damage : 0;
  const ratio = durability ? left / durability : 1;
  const enchantText = Object.entries(slot?.[3] ?? {})
    .map(([key, level]) => `${ENCHANTMENTS.find((e) => e.id === key)?.name ?? key} ${level}`)
    .join(' · ');
  const bar = durability
    ? `<span class="slot-durability ${ratio < 0.25 ? 'critical' : ratio < 0.5 ? 'low' : ''}"><i style="width:${Math.max(0, ratio * 100).toFixed(1)}%"></i></span>`
    : '';
  return `<div class="slot-cell ${slot ? '' : 'empty'} ${slot?.[3] ? 'enchanted' : ''} ${className}" role="button" tabindex="0" data-slot-id="${id}" data-slot-index="${index}" aria-label="${item ? item.name : 'Пустой слот'}" data-tip="${item ? item.name : ''}" data-tip-sub="${[enchantText, durability ? `Прочность: ${left} / ${durability}` : ''].filter(Boolean).join('\n')}">${
    item ? `<img alt="${item.name}" draggable="false" src="${icon(item.key)}"/>` : ''
  }${slot && slot[1] > 1 ? `<span class="slot-count">${slot[1]}</span>` : ''}${bar}</div>`;
}
let hotbarSignature = '';
let selectedShown = -1;
let selectedNameTimer = 0;
function renderHotbar() {
  const signature = JSON.stringify([selected, state?.inventory.slice(0, 9)]);
  if (signature === hotbarSignature) return;
  hotbarSignature = signature;
  const inventory = state?.inventory ?? [];
  const slots = inventory.slice(0, 9);
  $('#hotbar').innerHTML = slots
    .map((slot, i) => {
      const item = slot ? itemRegistry.find(slot[0]) : undefined;
      const label = item ? item.name : 'Пусто';
      return `<button class="slot ${i === selected ? 'selected' : ''}" data-slot="${i}" title="${i + 1} · ${label}" aria-label="Слот ${i + 1}: ${label}" aria-pressed="${i === selected}"><span class="slot-number">${i + 1}</span>${
        item ? `<img alt="" draggable="false" src="${icon(item.key)}"/>` : ''
      }${slot && slot[1] > 1 ? `<span class="slot-count">${slot[1]}</span>` : ''}</button>`;
    })
    .join('');
  const held = slots[selected];
  const heldItem = held ? itemRegistry.find(held[0]) : undefined;
  const nameEl = $('#selected-name');
  const heldName = heldItem ? heldItem.name : 'Пусто';
  // The held item's name surfaces above the bars for a moment after each change, then fades.
  if (nameEl.textContent !== heldName || selectedShown !== selected) {
    nameEl.textContent = heldName;
    selectedShown = selected;
    nameEl.classList.toggle('show', !!heldItem);
    window.clearTimeout(selectedNameTimer);
    selectedNameTimer = window.setTimeout(() => nameEl.classList.remove('show'), 1600);
  }
  worldRenderer.setHeldItem(heldItem ? heldItem.key : null);
  refreshControlLabels();
}
function palette() {
  if (state?.gameMode === 'survival') {
    toast('Палитра доступна в творчестве и лаборатории. В выживании пригодится книга рецептов.');
    openInventory();
    return;
  }
  if (state?.gameMode === 'creative') {
    openInventory();
    return;
  }
  $('#palette-grid').innerHTML = ITEMS.map(
    (item) =>
      `<button class="palette-block" data-item="${item.key}" title="Выдать ${item.name}"><img alt="" src="${icon(item.key)}"/><span>${item.name}</span></button>`,
  ).join('');
  setView('palette');
}
/* --------------------------------------------------------------------- world panels */
const PANEL_TITLES: Record<string, string> = {
  crafting: 'Инвентарь и крафт',
  crafting_table: 'Верстак 3×3',
  chest: 'Сундук',
  furnace: 'Печь',
  enchanting: 'Стол зачарований',
  brewing: 'Варочная стойка',
  anvil: 'Наковальня',
  dispenser: 'Раздатчик',
  dropper: 'Выбрасыватель',
  hopper: 'Воронка',
  trade: 'Торговля',
};
/** Kinds whose own slots live in the world: a chest, a furnace, a funnel or a dispenser. */
const BLOCK_CONTAINERS = ['chest', 'furnace', 'dispenser', 'dropper', 'hopper'];
/** Kinds that show a station block: the table, the stand and the anvil. */
const STATION_KINDS = ['enchanting', 'brewing', 'anvil', 'trade'];
function isBlockContainer(kind: string): boolean {
  return BLOCK_CONTAINERS.includes(kind);
}
function isStation(kind: string): boolean {
  return STATION_KINDS.includes(kind);
}
function container(): ContainerView | null {
  return state?.container ?? null;
}
function openPanel(): boolean {
  return panelOpen && !!container();
}
function requestClosePanel() {
  if (!state?.container && !panelPending()) return;
  panelRequestUntil = 0;
  send({ type: 'close-container' });
  panelOpen = false;
  panelSignature = '';
  play();
}
/** Flame, remaining burn time and cooking progress: refreshed on every snapshot by itself. */
function updateFurnaceGauge(view: ContainerView) {
  if (view.kind !== 'furnace' || !view.furnace) return;
  $('#furnace-flame').className = view.furnace.lit ? 'lit' : '';
  $('#furnace-status').textContent = view.furnace.lit
    ? `Горит: ${Math.ceil(view.furnace.burn / 20)} с`
    : 'Нет топлива';
  $('#furnace-cook').textContent =
    `Плавка: ${Math.round((view.furnace.cook / view.furnace.cookTotal) * 100)}%`;
}
/* ------------------------------------------------------------------ creative catalogue */
let creativeTab: CreativeTab | 'search' = 'building';
let creativeSignature = '';
const CREATIVE_HINT =
  'ЛКМ — стак · ПКМ — один · Shift — сразу в инвентарь · клик по каталогу с предметом — удалить';
const PANEL_HINT = 'ЛКМ — взять · ПКМ — половину · Shift — перенести · 1–9 — в слот';
/** Mouse words in hints become touch words on a phone. */
function forDevice(text: string) {
  if (device !== 'phone') return text;
  return text
    .replace(/удерживайте ЛКМ/g, 'удерживайте палец на экране')
    .replace(/удерживайте ПКМ/g, 'удерживайте «Ставить»')
    .replace(/ЛКМ/g, 'удержание пальца')
    .replace(/ПКМ/g, '«Ставить»');
}
function renderCreative(show: boolean) {
  $('#panel-creative-block').hidden = !show;
  $<HTMLElement>('.panel-recipes').hidden = show;
  $('#panel-hint').textContent =
    device === 'phone'
      ? show
        ? 'Коснись предмета в каталоге — взять стак · коснись слота — положить'
        : 'Коснись — взять или положить · перетаскивать не нужно'
      : show
        ? CREATIVE_HINT
        : PANEL_HINT;
  if (!show) {
    creativeSignature = '';
    return;
  }
  const query = $<HTMLInputElement>('#creative-search').value;
  const signature = `${creativeTab}|${query}`;
  if (signature === creativeSignature) return;
  creativeSignature = signature;
  const tabs = [...CREATIVE_TABS, { id: 'search' as const, name: 'Поиск', icon: '' }];
  $('#creative-tabs').innerHTML = tabs
    .map(
      (tab) =>
        `<button class="creative-tab ${tab.id === creativeTab ? 'active' : ''}" role="tab" aria-selected="${tab.id === creativeTab}" data-creative-tab="${tab.id}" data-tip="${tab.name}" aria-label="${tab.name}">${
          tab.icon
            ? `<img alt="" draggable="false" src="${icon(tab.icon)}"/>`
            : uiIcon('search', 24)
        }</button>`,
    )
    .join('');
  const items = creativeItems(creativeTab, query);
  $('#creative-title').textContent =
    creativeTab === 'search'
      ? `Поиск · ${items.length}`
      : `${CREATIVE_TABS.find((tab) => tab.id === creativeTab)?.name ?? ''} · ${items.length}`;
  $('#panel-creative-block').classList.toggle('searching', creativeTab === 'search');
  const cells = items.map(
    (item) =>
      `<div class="slot-cell creative-cell" role="button" tabindex="0" data-creative-item="${item.key}" aria-label="${item.name}" data-tip="${item.name}"><img alt="" draggable="false" src="${icon(item.key)}"/></div>`,
  );
  const total = Math.max(45, Math.ceil(cells.length / 9) * 9);
  while (cells.length < total) cells.push('<div class="slot-cell creative-cell empty"></div>');
  $('#creative-grid').innerHTML = cells.join('');
  $('#creative-grid').scrollTop = 0;
}
function creativeClick(event: MouseEvent | KeyboardEvent, button: number) {
  const target = event.target as Element;
  if (target.closest('#creative-trash')) {
    send({ type: 'creative-trash', all: event.shiftKey });
    return true;
  }
  const cell = target.closest<HTMLElement>('.creative-cell');
  if (!cell) return false;
  const item = cell.dataset.creativeItem;
  if (!item) {
    // Dropping a carried stack onto the catalogue deletes it, like the reference.
    if (state?.cursor) send({ type: 'creative-trash', all: false });
    return true;
  }
  send({
    type: 'creative-take',
    item,
    mode: event.shiftKey ? 'inventory' : button === 2 ? 'one' : 'stack',
  });
  return true;
}
$('#creative-tabs').addEventListener('click', (event) => {
  const tab = (event.target as Element).closest<HTMLElement>('[data-creative-tab]')?.dataset
    .creativeTab;
  if (!tab) return;
  creativeTab = tab as CreativeTab | 'search';
  if (creativeTab !== 'search') $<HTMLInputElement>('#creative-search').value = '';
  renderCreative(true);
  if (creativeTab === 'search') $('#creative-search').focus();
});
$('#creative-search').addEventListener('input', () => {
  creativeTab = 'search';
  renderCreative(true);
});
$('#panel-creative-block').addEventListener('mousedown', (event) => {
  if (event.button !== 0 && event.button !== 2) return;
  if (creativeClick(event, event.button)) event.preventDefault();
});
$('#panel-creative-block').addEventListener('keydown', (event) => {
  if (event.code !== 'Enter' && event.code !== 'Space') return;
  if (event.target instanceof HTMLInputElement) return;
  if (creativeClick(event, 0)) {
    event.preventDefault();
    event.stopPropagation();
  }
});
$('#panel-creative-block').addEventListener('contextmenu', (event) => event.preventDefault());
function renderPanel(force = false) {
  const active =
    document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLElement>('[data-slot-id]')
      : null;
  const focused =
    active && $('#panel-overlay').contains(active)
      ? { id: active.dataset.slotId!, index: active.dataset.slotIndex! }
      : null;
  const firstShow = $('#panel-overlay').hidden;
  const view = container();
  if (view) panelRequestUntil = 0;
  if (!view) {
    if (panelPending()) return;
    $('#panel-overlay').hidden = true;
    $('#cursor-item').hidden = true;
    panelOpen = false;
    return;
  }
  if (!panelOpen) clearInput();
  panelOpen = true;
  // The furnace flame and cooking progress change every tick, so they are kept out of the
  // signature: rebuilding the markup twenty times a second would replace the very cell the
  // player is about to click. They are refreshed separately, right below.
  const { furnace, ...stable } = view;
  void furnace;
  const signature = JSON.stringify([stable, state?.inventory, state?.selected, state?.cursor]);
  $('#panel-overlay').hidden = false;
  // A locked canvas swallows every mouse button, so a container opened from the crosshair would
  // be unusable until the player presses Escape. The cursor belongs to the panel while it is open.
  if (document.pointerLockElement) document.exitPointerLock();
  if (!force && signature === panelSignature) {
    updateFurnaceGauge(view);
    updateCursorItem();
    return;
  }
  panelSignature = signature;
  const hasContainer = isBlockContainer(view.kind);
  const hasGrid =
    view.kind === 'furnace' || view.kind === 'crafting' || view.kind === 'crafting_table';
  const station = isStation(view.kind);
  const creative = view.kind === 'crafting' && state?.gameMode === 'creative';
  renderCreative(creative);
  // A villager's window is about its offers; the recipe book has nothing to do there.
  if (view.kind === 'trade') $<HTMLElement>('.panel-recipes').hidden = true;
  // A world container names itself, so a joined pair shows up as a large chest right away.
  $('#panel-title').textContent = creative
    ? 'Творческий инвентарь'
    : hasContainer || station
      ? view.title
      : (PANEL_TITLES[view.kind] ?? 'Контейнер');
  $('#panel-eyebrow').textContent = creative
    ? 'ТВОРЧЕСТВО · ВСЕ ПРЕДМЕТЫ'
    : hasContainer
      ? 'БЛОЧНЫЙ КОНТЕЙНЕР'
      : station
        ? view.kind === 'trade'
          ? 'ТОРГОВЛЯ · ИЗУМРУДЫ'
          : 'РАБОЧЕЕ МЕСТО'
        : 'ИНВЕНТАРЬ ИГРОКА';
  // The own slots of a chest, a hopper or a dispenser all use the same grid.
  $('#panel-container-block').hidden = !hasContainer || view.kind === 'furnace';
  $('#panel-container').hidden = false;
  $('#panel-furnace-block').hidden = view.kind !== 'furnace';
  $('#panel-station-block').hidden = !station;
  $('#panel-crafting-block').hidden = hasContainer || station || creative;
  $('#panel-container-label').textContent =
    view.container.length > 27
      ? `${view.container.length} слота · две половины`
      : `${view.container.length} слотов`;
  $('#panel-container').className = `slot-grid ${view.container.length > 27 ? 'wide' : ''}`;
  if (hasContainer && view.kind !== 'furnace')
    $('#panel-container').innerHTML = view.container
      .map((slot, index) => slotMarkup('container', index, slot))
      .join('');
  renderStation(view);
  if (hasGrid) {
    const size = view.gridSize;
    $('#craft-size').textContent = `${size}×${size}`;
    $('#craft-grid').className = `slot-grid craft-grid ${size === 3 ? 'size-3' : ''}`;
    $('#craft-grid').innerHTML = Array.from({ length: size * size }, (_, index) =>
      slotMarkup('grid', index, view.grid[index] ?? null),
    ).join('');
    $('#craft-result').outerHTML = slotMarkup('result', 0, view.result, 'result-cell').replace(
      'class="slot-cell ',
      'id="craft-result" class="slot-cell ',
    );
  }
  if (view.kind === 'furnace' && view.furnace) {
    updateFurnaceGauge(view);
    // Look the cells up inside the furnace block, not by their slot id: the redraw replaces the
    // whole cell, so a query by the previous id would stop finding anything after the first paint.
    $('#panel-furnace-block')
      .querySelectorAll<HTMLElement>('[data-slot-id]')
      .forEach((el) => {
        const index = Number(el.dataset.slotIndex);
        const slot = view.container[index] ?? null;
        el.outerHTML = slotMarkup('container', index, slot);
      });
  }
  const inventory = state?.inventory ?? [];
  $('#player-main').innerHTML = inventory
    .slice(9, 36)
    .map((slot, i) => slotMarkup(null as unknown as string, 9 + i, slot))
    .join('')
    .replaceAll('data-slot-id="null"', 'data-slot-id="player"');
  $('#player-hotbar').innerHTML = inventory
    .slice(0, 9)
    .map((slot, i) => slotMarkup('player', i, slot))
    .join('');
  $('#player-armor').innerHTML = inventory
    .slice(36)
    .map((slot, i) => slotMarkup('player', 36 + i, slot, 'reserved-cell'))
    .join('');
  renderRecipes(view);
  updateCursorItem();
  if (focused) {
    const selector = `[data-slot-id="${CSS.escape(focused.id)}"][data-slot-index="${CSS.escape(focused.index)}"]`;
    [...$('#panel-overlay').querySelectorAll<HTMLElement>(selector)]
      .find((el) => el.getClientRects().length > 0)
      ?.focus({ preventScroll: true });
  } else if (firstShow) $('#close-panel').focus({ preventScroll: true });
}
/**
 * Enchanting table, brewing stand and anvil. The station slots of the stand belong to the world
 * container, so they keep the `container` id the core understands.
 */
function renderStation(view: ContainerView) {
  if (!isStation(view.kind)) return;
  $('#station-enchant').hidden = view.kind !== 'enchanting';
  $('#station-brew').hidden = view.kind !== 'brewing';
  $('#station-anvil').hidden = view.kind !== 'anvil';
  $('#station-trade').hidden = view.kind !== 'trade';
  if (view.kind === 'trade' && view.trade) {
    const trade = view.trade;
    const stack = (slot: SlotData) => {
      const item = slot ? itemRegistry.find(slot[0]) : undefined;
      return item
        ? `<span class="trade-stack" data-tip="${item.name}"><img alt="${item.name}" draggable="false" src="${icon(item.key)}"/>${slot![1] > 1 ? `<b>${slot![1]}</b>` : ''}</span>`
        : '';
    };
    $('#trade-offers').innerHTML = trade.offers.length
      ? trade.offers
          .map(
            (offer, index) =>
              `<div class="offer trade-offer ${offer.left <= 0 ? 'sold-out' : ''}"><span class="trade-deal">${offer.give
                .map(stack)
                .join(
                  '',
                )}<span class="trade-arrow">→</span>${stack(offer.get)}</span><small class="trade-left" title="Осталось обменов до пополнения">${Math.max(0, offer.left)}/${TRADE_MAX_USES}</small><button data-trade="${index}" ${
                offer.affordable ? '' : 'disabled'
              } title="${offer.left <= 0 ? 'Житель пока не меняет это' : `Осталось обменов: ${offer.left}`}">${offer.left <= 0 ? 'Нет' : 'Обменять'}</button></div>`,
          )
          .join('')
      : '<div class="offer"><span>Житель ушёл</span></div>';
  }
  if (view.kind === 'enchanting' && view.enchant) {
    const enchant = view.enchant;
    $('#enchant-levels').textContent = `${enchant.levels} уровней`;
    $('#enchant-lapis').textContent = String(enchant.lapis);
    $('#enchant-slot').outerHTML = slotMarkup('grid', 0, enchant.item, '').replace(
      'class="slot-cell ',
      'id="enchant-slot" class="slot-cell ',
    );
    $('#enchant-offers').innerHTML = enchant.offers.length
      ? enchant.offers
          .map(
            (offer) =>
              `<div class="offer"><span>${offer.name} ${offer.level} · <b>${offer.cost}</b> ур.</span><button data-offer="${offer.id}" ${
                enchant.levels < offer.cost || enchant.lapis < 1 || !enchant.item ? 'disabled' : ''
              }>Зачаровать</button></div>`,
          )
          .join('')
      : '<div class="offer"><span>Положи предмет в слот</span></div>';
  }
  if (view.kind === 'brewing' && view.brewing) {
    const brewing = view.brewing;
    $('#brew-status').textContent = brewing.fuel > 0 ? `Топливо: ${brewing.fuel}` : 'Нет порошка';
    $('#brew-ingredient').outerHTML = slotMarkup('container', 0, brewing.ingredient, '').replace(
      'class="slot-cell ',
      'id="brew-ingredient" class="slot-cell ',
    );
    $('#brew-bottles').innerHTML = [1, 2, 3]
      .map((index) => slotMarkup('container', index, brewing.bottles[index - 1] ?? null))
      .join('');
    $('#brew-powder').outerHTML = slotMarkup('container', 4, null, '').replace(
      'class="slot-cell ',
      'id="brew-powder" class="slot-cell ',
    );
    const ratio = brewing.total ? Math.min(1, brewing.progress / brewing.total) : 0;
    $('#brew-fill').style.width = `${(ratio * 100).toFixed(1)}%`;
  }
  if (view.kind === 'anvil' && view.anvil) {
    const anvil = view.anvil;
    $('#anvil-status').textContent = anvil.message ?? 'Эти предметы не сочетаются';
    $('#anvil-first').outerHTML = slotMarkup('grid', 0, anvil.first, '').replace(
      'class="slot-cell ',
      'id="anvil-first" class="slot-cell ',
    );
    $('#anvil-second').outerHTML = slotMarkup('grid', 1, anvil.second, '').replace(
      'class="slot-cell ',
      'id="anvil-second" class="slot-cell ',
    );
    $('#anvil-result').outerHTML = slotMarkup('grid', -1, anvil.result, 'result-cell').replace(
      'class="slot-cell ',
      'id="anvil-result" class="slot-cell ',
    );
    $('#anvil-cost').textContent = String(anvil.cost);
    $<HTMLButtonElement>('#anvil-take').disabled = !anvil.result;
  }
}
function renderRecipes(view: ContainerView) {
  const list = view.recipes.filter((recipe) => {
    if (recipeOnlyCraftable && !recipe.craftable) return false;
    if (!recipeQuery) return true;
    const needle = recipeQuery.toLowerCase();
    return (
      recipe.name.toLowerCase().includes(needle) ||
      recipe.id.includes(needle) ||
      recipe.ingredients.some((entry) => ingredientName(entry.item).toLowerCase().includes(needle))
    );
  });
  $('#recipe-count').textContent = `${list.length} / ${view.recipes.length}`;
  $('#recipe-list').innerHTML = list
    .map((recipe) => {
      const item = itemRegistry.find(recipe.item);
      const ingredients = recipe.ingredients
        .map((entry) => `${ingredientName(entry.item)}×${entry.count}`)
        .join(', ');
      return `<button class="recipe-entry" data-recipe="${recipe.id}" ${recipe.craftable && recipe.needs <= view.gridSize ? '' : 'disabled'} title="${ingredients}"><img alt="" src="${icon(recipe.item)}"/><span><span>${item?.name ?? recipe.item}${recipe.count > 1 ? ` ×${recipe.count}` : ''}</span><small>${ingredients}${recipe.needs > view.gridSize ? ' · нужен верстак' : ''}</small></span></button>`;
    })
    .join('');
}
function updateCursorItem() {
  const el = $('#cursor-item');
  const slot = state?.cursor ?? null;
  const item = slot ? itemRegistry.find(slot[0]) : undefined;
  if (!item) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.innerHTML = `<img alt="" src="${icon(item.key)}"/>${slot && slot[1] > 1 ? `<span class="slot-count">${slot[1]}</span>` : ''}`;
}
/* --------------------------------------------------------------------- simulation IO */
let feedbackTimer = 0;
function actionFeedback(text: string) {
  $('#action-feedback').textContent = text;
  $('#action-feedback').classList.add('visible');
  clearTimeout(feedbackTimer);
  feedbackTimer = window.setTimeout(() => $('#action-feedback').classList.remove('visible'), 1200);
}
function updateJourneyAndBoss() {
  if (!state) return;
  const boss = state.boss,
    bar = $('#boss-bar');
  bar.hidden = !boss;
  if (boss) {
    $('#boss-name').textContent = boss.name;
    $('#boss-health').textContent = `${Math.ceil(boss.health)} / ${boss.maxHealth}`;
    $('#boss-fill').style.width = `${Math.max(0, (boss.health / boss.maxHealth) * 100)}%`;
    bar.setAttribute('aria-valuenow', String(boss.health));
    bar.setAttribute('aria-valuemax', String(boss.maxHealth));
  }
  const goal = JOURNEY_GOALS.find((goal) => !state!.journey.includes(goal));
  $('#journey-card').hidden = !showJourney || state.gameMode !== 'survival' || !goal || !!boss;
  if (goal) {
    $('#journey-title').textContent = JOURNEY_TEXT[goal].title;
    $('#journey-hint').textContent = forDevice(JOURNEY_TEXT[goal].hint);
    $('#journey-count').textContent = `${state.journey.length} / ${JOURNEY_GOALS.length}`;
  }
  $('#world-mode-label').textContent = GAME_MODE_NAMES[state.gameMode];
  document
    .querySelectorAll<HTMLElement>('[data-lab-control]')
    .forEach((el) => (el.hidden = state!.gameMode === 'survival'));
  $<HTMLButtonElement>('#respawn').disabled = state.gameMode === 'survival' && !state.survival.dead;
}
$('#volume').addEventListener('input', () => {
  audio.setVolume(Number($<HTMLInputElement>('#volume').value) / 100);
  $('#volume-label').textContent = `${Math.round(audio.volume * 100)}%`;
  savePreferences();
});
$('#music-volume').addEventListener('input', () => {
  audio.setMusicVolume(Number($<HTMLInputElement>('#music-volume').value) / 100);
  $('#music-volume-label').textContent = `${Math.round(audio.musicVolume * 100)}%`;
  savePreferences();
});
// Menu buttons click softly, as the reference does; the game world has sounds of its own.
document.addEventListener('click', (event) => {
  const button = (event.target as Element).closest('button');
  if (button && !button.disabled && !button.closest('.hotbar')) audio.play('ui');
});
$('#reduce-motion').addEventListener('change', () => {
  reducedMotion = $<HTMLInputElement>('#reduce-motion').checked;
  worldRenderer.reducedMotion = reducedMotion;
  document.body.classList.toggle('reduced-motion', reducedMotion);
  savePreferences();
});
$('#show-journey').addEventListener('change', () => {
  showJourney = $<HTMLInputElement>('#show-journey').checked;
  savePreferences();
  updateJourneyAndBoss();
});
$('#journey-dismiss').addEventListener('click', () => {
  showJourney = false;
  $<HTMLInputElement>('#show-journey').checked = false;
  savePreferences();
  updateJourneyAndBoss();
});
function clearInput() {
  keys.clear();
  controls.reset();
  wheelSelector.reset();
  drag = null;
  mineButton = false;
  useButton = false;
  holdSent = false;
  cursorDrag = null;
  send({ type: 'cancel-input' });
  send({ type: 'input', input: { ...EMPTY_INPUT, yaw, pitch } });
}
function setView(next: View) {
  const previousView = view;
  view = next;
  if (next !== 'pause') cancelBinding();
  $('#home').hidden = next !== 'home';
  $('#hud').hidden = next !== 'game';
  $('#pause-overlay').hidden = next !== 'pause';
  $('#palette-overlay').hidden = next !== 'palette';
  $('#worlds-overlay').hidden = next !== 'worlds';
  $('#create-overlay').hidden = next !== 'create';
  $('#multiplayer-overlay').hidden = next !== 'multiplayer';
  $('#about-overlay').hidden = next !== 'about';
  if (next === 'home' && previousView !== 'home') panoramaYaw = yaw;
  document.body.classList.toggle('playing', next === 'game');
  document.body.classList.toggle(
    'on-title',
    next !== 'game' && next !== 'pause' && next !== 'palette',
  );
  worldRenderer.setPlaying(next === 'game');
  clearInput();
  send({ type: 'pause', paused: next !== 'game' });
  if (next !== 'game' && document.pointerLockElement) document.exitPointerLock();
  $<HTMLButtonElement>('#step-tick').disabled = next === 'game' || !ready;
  if (next === 'pause') $<HTMLButtonElement>('#resume').disabled = !ready;
  if (next !== 'game') {
    panelOpen = false;
    $('#panel-overlay').hidden = true;
    $('#cursor-item').hidden = true;
    send({ type: 'close-container' });
  }
  updateHUD();
  if (previousView === 'game' && next !== 'game' && ready)
    void saves?.backgroundSave().catch(() => {});
}
function fallbackLook() {
  if (view === 'game') {
    $('#fallback-hint').hidden = false;
    toast('Обзор без захвата мыши: зажми правую кнопку');
  }
}
function play() {
  if (!ready) return;
  setView('game');
  ignoreNextLockedMove = true;
  if (openPanel() || !$('#debug').hidden) return;
  if (state?.survival?.dead) {
    // The death screen needs the mouse; show it at once rather than on the next snapshot.
    survivalSignature = '';
    return;
  }
  canvas.focus({ preventScroll: true });
  if (device === 'phone') {
    // A phone plays full screen and sideways; both need the tap that started the game.
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen)
      root
        .requestFullscreen({ navigationUI: 'hide' })
        .then(() =>
          (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })
            .lock?.('landscape')
            .catch(() => {}),
        )
        .catch(() => {});
    return;
  }
  if (document.pointerLockElement === canvas) return;
  // Raw mouse input (no operating-system acceleration) where the browser offers it: the view
  // then turns by exactly the distance the hand moved, as a game's camera should.
  const plain = () => {
    try {
      const result = canvas.requestPointerLock();
      if (result instanceof Promise) result.catch(fallbackLook);
    } catch {
      fallbackLook();
    }
  };
  try {
    const result = (
      canvas.requestPointerLock as (options?: { unadjustedMovement?: boolean }) => unknown
    ).call(canvas, { unadjustedMovement: true });
    if (result instanceof Promise) result.catch(plain);
  } catch {
    plain();
  }
}
/** True while an interface was requested but the snapshot with its contents is still on its way. */
function panelPending(): boolean {
  return performance.now() < panelRequestUntil && !container();
}
function openInventory() {
  if (view !== 'game' || !ready || state?.survival.dead) return;
  quietMenuUntil = performance.now() + 600;
  panelRequestUntil = performance.now() + 2000;
  clearInput();
  send({ type: 'open-crafting' });
  if (document.pointerLockElement) document.exitPointerLock();
  panelOpen = true;
  panelSignature = '';
  renderPanel(true);
}
/** Opens a container that exists in the world; the answer arrives with the next snapshot. */
function openWorldContainer(kind: OpenContainerKind, x: number, y: number, z: number) {
  if (view !== 'game' || !ready || state?.survival.dead) return;
  quietMenuUntil = performance.now() + 600;
  panelRequestUntil = performance.now() + 2000;
  clearInput();
  send({ type: 'open', kind, x, y, z });
}
function tab(name: string) {
  if (name !== 'controls') cancelBinding();
  document
    .querySelectorAll<HTMLButtonElement>('[data-tab]')
    .forEach((el) => el.classList.toggle('active', el.dataset.tab === name));
  document.querySelectorAll<HTMLElement>('[data-content]').forEach((el) => {
    el.hidden = el.dataset.content !== name;
  });
}
function menu(name = 'game') {
  // From the title screen the journal is plain settings: there is no game to return to yet.
  menuFromHome = view !== 'game' && view !== 'pause' ? true : view === 'pause' && menuFromHome;
  if (menuFromHome && name === 'game') name = 'settings';
  document.querySelector<HTMLElement>('[data-tab="game"]')!.hidden = menuFromHome;
  $('#menu-heading').textContent = menuFromHome ? 'Настройки.' : 'Привал.';
  $('#menu-eyebrow').innerHTML = menuFromHome
    ? 'ДНЕВНИК <b>·</b> НАСТРОЙКИ'
    : 'ДНЕВНИК <b>·</b> ПРИВАЛ';
  $('#menu-description').textContent = menuFromHome
    ? 'Изображение, звук, персонаж и управление.'
    : 'Мир подождёт — время остановлено.';
  tab(name);
  setView('pause');
  document.querySelector<HTMLButtonElement>(`[data-tab="${name}"]`)?.focus();
}
function debugToggle() {
  $('#debug').hidden = !$('#debug').hidden;
  if (view === 'game') {
    if (!$('#debug').hidden) {
      clearInput();
      if (document.pointerLockElement) document.exitPointerLock();
    } else if (!openPanel()) play();
  }
  updateDebug();
}
function beginWorld(opened: OpenWorld, net = false) {
  for (const pending of captureRequests.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error('Сеанс изменился'));
  }
  captureRequests.clear();
  const checkpoint = opened.file.payload.core;
  const client = opened.file.payload.client;
  seed = checkpoint.generator.seed;
  preset = checkpoint.generator.preset;
  selected = checkpoint.inventory.selected;
  radius = client.settings.radius;
  sensitivity = client.settings.sensitivity * 0.0019;
  $<HTMLSelectElement>('#distance').value = String(radius);
  $<HTMLInputElement>('#fov').value = String(client.settings.fov);
  $('#fov-label').textContent = `${client.settings.fov}°`;
  $<HTMLInputElement>('#sensitivity').value = String(client.settings.sensitivity * 10);
  $('#sensitivity-label').textContent = `${client.settings.sensitivity.toFixed(1)}×`;
  $<HTMLInputElement>('#seed-input').value = seed;
  $<HTMLSelectElement>('#preset').value = preset;
  worldRenderer.setDistance(radius);
  worldRenderer.setFov(client.settings.fov);
  // Generator 5 worlds show their horizon; older generators and the flat world do not.
  worldRenderer.setFarWorld(
    checkpoint.generator.version === 5 &&
      ['overworld', 'large-biomes', 'amplified'].includes(preset)
      ? { seed, preset }
      : null,
  );
  session++;
  ready = false;
  workerReady = false;
  state = null;
  uploads.length = 0;
  panelOpen = false;
  panelSignature = '';
  $('#panel-overlay').hidden = true;
  worldRenderer.reset();
  yaw = checkpoint.look.yaw;
  pitch = checkpoint.look.pitch;
  worldRenderer.look(yaw, pitch);
  setView('home');
  $('#loading').hidden = false;
  $('#ready-caption').hidden = true;
  $<HTMLButtonElement>('#play').disabled = true;
  $('#play-label').textContent = 'Создаём твой мир';
  $('#loading-bar').style.width = '0%';
  $('#loading-number').textContent = '0%';
  const title = opened.meta.name;
  $('#world-title').textContent = title;
  $('#menu-world-name').textContent = title;
  $('#seed-label').textContent = seed;
  navigation.open(opened.meta.id);
  send({ type: 'init', session, seed, preset, radius, naturalSpawning, checkpoint, online: net });
  try {
    if (saves.durable && !net) {
      const url = new URL(location.href);
      url.searchParams.set('world', opened.meta.id);
      url.searchParams.delete('seed');
      url.searchParams.delete('preset');
      history.replaceState(null, '', url);
    }
  } catch {
    /* The embedded file viewer may have an opaque origin. */
  }
  void worldActions?.refresh();
}
function finishLoading() {
  if (ready) return;
  ready = true;
  document.body.classList.remove('travelling');
  $('#loading').hidden = true;
  $('#ready-caption').hidden = false;
  $<HTMLButtonElement>('#play').disabled = false;
  $('#play-label').textContent = (state?.tick ?? 0) > 0 ? 'Продолжить игру' : 'Играть';
  $<HTMLButtonElement>('#resume').disabled = false;
  $<HTMLButtonElement>('#step-tick').disabled = false;
  if (state) saves.observe(state);
  updateHUD();
}
worker.onmessage = (event: MessageEvent<WorkerEvent>) => {
  const message = event.data;
  if ('session' in message && message.session !== session) return;
  switch (message.type) {
    case 'mesh': {
      const queued = uploads.findIndex((mesh) => mesh.key === message.mesh.key);
      if (queued >= 0) uploads[queued] = message.mesh;
      else uploads.push(message.mesh);
      break;
    }
    case 'evict':
      for (let i = uploads.length - 1; i >= 0; i--)
        if (uploads[i].cx === message.cx && uploads[i].cz === message.cz) uploads.splice(i, 1);
      worldRenderer.evict(message.cx, message.cz);
      break;
    case 'travel':
      audio.play('portal');
      ready = false;
      workerReady = false;
      clearInput();
      document.body.classList.add('travelling');
      // A portal moved the player: every mesh belonged to the dimension left behind.
      worldRenderer.reset();
      uploads.length = 0;
      toast(message.message + (message.built ? ' · построен портал' : ''), false);
      break;
    case 'progress': {
      const progress = message.total ? message.done / message.total : 0;
      const percent = Math.min(
        99,
        Math.round(message.phase.includes('чанки') ? progress * 36 : 36 + progress * 63),
      );
      $('#loading-bar').style.width = `${percent}%`;
      $('#loading-number').textContent = `${percent}%`;
      $('#loading-label').textContent = `${message.phase} · ${message.done}/${message.total}`;
      break;
    }
    case 'net-edits':
      if (message.session === session) onlineClient?.edits(message.edits);
      break;
    case 'ready':
      workerReady = true;
      yaw = message.look.yaw;
      pitch = message.look.pitch;
      break;
    case 'snapshot': {
      const wasDead = state?.survival.dead;
      state = {
        ...message.state,
        containers: message.state.containers ?? state?.containers ?? [],
        itemEntities: message.state.itemEntities ?? state?.itemEntities ?? [],
      };
      workerJobs = message.jobs;
      if (state.survival.dead && !wasDead) clearInput();
      navigation.observe(state, wasDead);
      const feedback = audio.observe(state, view === 'game' && ready);
      if (feedback === 'break' || feedback === 'pickup')
        actionFeedback(feedback === 'break' ? 'Блок добыт' : 'Предмет подобран');
      updateJourneyAndBoss();
      tps = message.tps;
      tickMs = message.tickMs;
      backlog = message.backlog;
      droppedMs = message.droppedMs;
      selected = state.selected;
      worldRenderer.setPaused(message.paused);
      worldRenderer.snapshot(state);
      saves?.observe(state);
      if (panelOpen || state.container) renderPanel();
      else if (!$('#panel-overlay').hidden) renderPanel(true);
      renderHotbar();
      updateHUD();
      break;
    }
    case 'notice':
      if (message.message) toast(message.message, !message.ok);
      if (message.ok && /установлен/.test(message.message)) audio.play('place');
      if (message.ok && /зачарован/iu.test(message.message)) audio.play('enchant');
      else if (message.ok && /починен|объединён/iu.test(message.message)) audio.play('anvil');
      else if (message.ok && /создан|скраф/iu.test(message.message)) audio.play('craft');
      break;
    case 'fixture-result': {
      const request = fixtureRequests.get(message.requestID);
      if (request) {
        clearTimeout(request.timer);
        request.resolve(message.result);
        fixtureRequests.delete(message.requestID);
      }
      break;
    }
    case 'checkpoint': {
      const request = captureRequests.get(message.requestID);
      if (request) {
        clearTimeout(request.timer);
        captureRequests.delete(message.requestID);
        request.resolve({ core: message.core, stamp: message.stamp });
      }
      break;
    }
    case 'capture-error': {
      const request = captureRequests.get(message.requestID);
      if (request) {
        clearTimeout(request.timer);
        captureRequests.delete(message.requestID);
        request.reject(new Error(message.message));
      }
      break;
    }
    case 'error':
      fail(`Ошибка игрового ядра: ${message.message}`);
      break;
  }
};
worker.onerror = (event) => fail(`Не удалось запустить Worker: ${event.message}`);

/** Hearts, hunger, armour, air, experience and running effects, redrawn only on change. */
function updateSurvival() {
  const survival = state?.survival;
  const hud = $('#survival-hud');
  hud.hidden = !survival || view !== 'game';
  // Creative has no hearts, hunger or experience to show, as in the reference; effects stay.
  hud.classList.toggle('creative', state?.gameMode === 'creative');
  if (!survival) return;
  const signature = [
    survival.health,
    survival.absorption,
    survival.food,
    survival.air,
    survival.armor,
    survival.xpInto,
    survival.level,
    survival.dead,
    survival.effects
      .map((effect) => `${effect.id}${effect.amplifier}:${Math.ceil(effect.duration / 20)}`)
      .join(','),
    state?.use.eating ? 'eat' : (state?.use.bowCharge ?? 0),
    state?.use.blocking ? 'block' : '',
  ].join('|');
  if (signature === survivalSignature) return;
  survivalSignature = signature;
  if (survival.health < lastHealth && !reducedMotion) {
    const element = $('#damage-flash');
    element.style.opacity = '1';
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => {
      element.style.opacity = '';
    }, 90);
  }
  lastHealth = survival.health;
  // Absorption hearts sit in front of the health row, as golden hearts do in the reference.
  const hearts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const absorbed = survival.absorption - i * 2;
    const value = absorbed > 0 ? absorbed : survival.health - i * 2;
    const kind = absorbed > 0 ? 'absorb' : value >= 2 ? '' : value >= 1 ? 'half' : 'empty';
    hearts.push(`<i class="heart ${kind}"></i>`);
  }
  $('#health-bar').innerHTML = hearts.join('');
  const food: string[] = [];
  for (let i = 0; i < 10; i++) {
    const value = survival.food - i * 2;
    food.push(`<i class="food ${value >= 2 ? '' : value >= 1 ? 'half' : 'empty'}"></i>`);
  }
  $('#food-bar').innerHTML = food.join('');
  const armor: string[] = [];
  for (let i = 0; i < 10; i++)
    armor.push(`<i class="armor ${survival.armor - i * 2 > 0 ? '' : 'empty'}"></i>`);
  $('#armor-bar').innerHTML = armor.join('');
  const bar = $('#armor-bar');
  bar.hidden = survival.armor <= 0;
  const air: string[] = [];
  const bubbles = Math.ceil(Math.max(0, survival.air) / 30);
  for (let i = 0; i < 10; i++) air.push(`<i class="bubble ${i < bubbles ? '' : 'empty'}"></i>`);
  $('#air-bar').innerHTML = air.join('');
  $('#air-bar').hidden = survival.air >= 300;
  $<HTMLElement>('#xp-fill').style.width = `${Math.round(survival.xpFraction * 100)}%`;
  $('#xp-level').textContent = String(survival.level);
  $('#xp-level').dataset.level = String(survival.level);
  const effects = $('#effect-line');
  effects.innerHTML = survival.effects
    .map(
      (effect) =>
        `<span class="effect-chip ${effect.id === 'poison' || effect.id === 'wither' || effect.id === 'hunger' || effect.id === 'slowness' || effect.id === 'mining_fatigue' ? 'bad' : ''}">${effect.name} ${effect.amplifier + 1} · ${Math.ceil(
          effect.duration / 20,
        )} с</span>`,
    )
    .join('');
  const use = state?.use;
  const useLine = $('#use-line');
  const using = !!use && use.active && (use.eating || use.bowCharge > 0 || use.blocking);
  useLine.hidden = !using;
  if (using && use) {
    const fraction = use.eating
      ? use.ticks / use.eatTotal
      : use.bowCharge > 0
        ? use.bowCharge / use.bowTotal
        : 1;
    $<HTMLElement>('#use-fill').style.width = `${Math.round(Math.min(1, fraction) * 100)}%`;
    $('#use-label').textContent = use.eating
      ? 'Приём пищи'
      : use.bowCharge > 0
        ? 'Лук натянут'
        : 'Щит поднят';
  }
  updateDeathScreen(survival);
}
/** The death screen replaces the HUD until the player respawns. */
function updateDeathScreen(survival: NonNullable<SimulationSnapshot['survival']>) {
  const overlay = $('#death-overlay');
  if (survival.dead && view !== 'game' && view !== 'pause') {
    // A world saved at the moment of death: the title screen and its dialogs stay usable, and
    // the death screen waits until the player steps back into the world.
    overlay.hidden = true;
    survivalSignature = '';
    return;
  }
  if (!survival.dead) {
    if (!overlay.hidden) {
      overlay.hidden = true;
      survivalSignature = '';
    }
    return;
  }
  if (!overlay.hidden) return;
  overlay.hidden = false;
  // Free the mouse so the respawn button can be clicked, without the pause menu popping up;
  // Enter works too once the button has focus (a moment later, so a held key does not skip it).
  quietMenuUntil = performance.now() + 1500;
  clearInput();
  if (document.pointerLockElement) document.exitPointerLock();
  setTimeout(() => {
    if (!overlay.hidden) $('#respawn-button').focus();
  }, 700);
  const position = state?.player.position;
  $('#death-cause').textContent =
    survival.damageType === 'fall'
      ? 'Падение оказалось слишком высоким. Инвентарь и часть опыта остались на месте гибели.'
      : survival.damageType === 'drown'
        ? 'Ты захлебнулся. Инвентарь и часть опыта остались на месте гибели.'
        : survival.damageType === 'lava' || survival.damageType === 'on_fire'
          ? 'Огонь оказался сильнее. Инвентарь и часть опыта остались на месте гибели.'
          : survival.damageType === 'mob'
            ? 'Существо оказалось сильнее. Инвентарь и часть опыта остались на месте гибели.'
            : 'Инвентарь выпал там, где ты погиб.';
  $('#death-stats').innerHTML = [
    ['Здоровье', `${survival.health.toFixed(0)} / ${survival.maxHealth}`],
    ['Уровень', `${survival.level} (${survival.xp.toFixed(0)} опыта)`],
    [
      'Позиция',
      position
        ? `${position.x.toFixed(1)} / ${position.y.toFixed(1)} / ${position.z.toFixed(1)}`
        : '—',
    ],
    ['Предметов на земле', String(state?.itemEntities.length ?? 0)],
    ['Тип урона', survival.damageType ?? 'неизвестно'],
    ['Сложность', survival.difficulty],
  ]
    .map(([label, value]) => `<div><span>${label}</span><span>${value}</span></div>`)
    .join('');
  const spawn = survival.spawn;
  $('#death-spawn').textContent =
    `${spawn.x.toFixed(1)} / ${spawn.y.toFixed(1)} / ${spawn.z.toFixed(1)}`;
  if (view === 'game') menu();
}
/** The name of a dimension, for the debug panel. */
function dimensionName(dimension: string | undefined): string {
  if (dimension === 'nether') return 'Нижний мир';
  if (dimension === 'end') return 'Край';
  return 'Верхний мир';
}
function updateHUD() {
  if (saves) renderSaveStatus(saves.status());
  $('#runtime-status').textContent = !ready
    ? 'Загрузка мира'
    : view === 'game'
      ? `${tps || '…'} TPS · локально`
      : 'Локальное ядро';
  const mining = state?.mining ?? null;
  const miningEl = $('#mine-progress');
  miningEl.hidden = !mining || view !== 'game';
  if (mining && mining.ticks > 0)
    $<HTMLElement>('#mine-progress').firstElementChild!.setAttribute(
      'style',
      `width:${Math.min(100, (mining.progress / mining.ticks) * 100).toFixed(0)}%`,
    );
  if (!state) return;
  const p = state.player.position;
  $('#coordinates').textContent = `${p.x.toFixed(1)} / ${p.y.toFixed(1)} / ${p.z.toFixed(1)}`;
  $('#target-pill').hidden = !state.target;
  if (state.target) $('#target-name').textContent = registry.get(state.target.state).name;
  document.body.dataset.medium = state.cameraMedium ?? 'air';
  const held = state.inventory[state.selected],
    item = held ? itemRegistry.find(held[0]) : undefined;
  const action = item?.food
    ? 'удерживать ПКМ — есть'
    : item?.use === 'bow'
      ? 'удерживать ПКМ — натянуть; отпустить — выстрел'
      : item?.use === 'shield' || state.inventory[40]?.[0] === 'lab:shield'
        ? 'удерживать ПКМ — щит'
        : state.target && registry.get(state.target.state).opens
          ? 'ПКМ — открыть'
          : item?.block !== undefined
            ? 'ПКМ — поставить'
            : 'ПКМ — использовать';
  const hint = `ЛКМ — удар / добыча · ${action}`;
  if ($('#context-action').textContent !== hint) $('#context-action').textContent = hint;
  $('#attack-meter').hidden = state.attack.ready || state.use.active;
  $('#attack-fill').style.width = `${Math.round(state.attack.charge * 100)}%`;

  $('#flight-badge').hidden = !state.player.flying;
  updateSurvival();
  if (!$('#debug').hidden) updateDebug();
}
let lastDebugUpdate = 0;
function updateDebug() {
  const now = performance.now();
  if (now - lastDebugUpdate < 500 && $('#debug-metrics').childElementCount) return;
  lastDebugUpdate = now;
  $('#debug-state').textContent = view === 'game' ? 'RUNNING' : 'PAUSED';
  const held = state?.inventory?.[state.selected];
  const rows = [
    ['Кадров / с', String(fps)],
    [
      'Кадр p50 / p95',
      `${worldRenderer.frameStats.snapshot().p50} / ${worldRenderer.frameStats.snapshot().p95} мс`,
    ],
    ['Отправка CPU p95', `${worldRenderer.frameStats.snapshot().cpuP95} мс`],
    ['3D-разрешение', `${worldRenderer.quality.width} × ${worldRenderer.quality.height}`],
    [
      'Профиль / автомасштаб',
      `${worldRenderer.quality.preset} / ${Math.round(worldRenderer.quality.adaptiveScale * 100)}%`,
    ],
    ['Данные геометрии', `${(worldRenderer.resourceStats.terrainBytes / 1048576).toFixed(2)} МБ`],
    [
      'Дальние земли',
      worldRenderer.farStats.active
        ? `${worldRenderer.farStats.tiles} плиток / ${Math.round(worldRenderer.farStats.vertices / 1000)} тыс. вершин`
        : 'выкл.',
    ],
    [
      'Частицы / лимит',
      `${worldRenderer.resourceStats.particles} / ${graphics.preset === 'economy' ? 64 : graphics.preset === 'high' ? 320 : 160}`,
    ],
    ['Тактов / с', view === 'game' ? String(tps) : 'пауза'],
    ['Такт мира', String(state?.tick ?? 0)],
    ['Тип мира', PRESET_LABELS[preset]],
    ['Измерение', dimensionName(state?.dimension)],
    [
      'Босс',
      state?.boss
        ? `${state.boss.name} ${state.boss.health.toFixed(0)}/${state.boss.maxHealth}`
        : 'нет',
    ],
    ['Портал', state?.portal ? `ожидание ${(state.portal.progress * 100).toFixed(0)}%` : 'нет'],
    ['Чанков / секций', `${state?.columns ?? 0} / ${state?.sections ?? 0}`],
    ['Данные блоков', `${((state?.storageBytes ?? 0) / 1024 / 1024).toFixed(2)} МБ`],
    ['Загружено граней', worldRenderer.faceCount.toLocaleString('ru-RU')],
    ['Вызовов GPU', String(worldRenderer.renderer.info.render.calls)],
    ['Время такта', `${tickMs.toFixed(2)} мс`],
    ['Очередь чанков / mesh', String(backlog + uploads.length)],
    ['Изменено блоков', String(state?.edits ?? 0)],
    ['В руке', held ? `${itemRegistry.find(held[0])?.name ?? held[0]} ×${held[1]}` : 'пусто'],
    ['Предметов на земле', String(state?.items.length ?? 0)],
    [
      'Контейнеров',
      String((state?.containers ?? []).length) + (state?.cursor ? ' · курсор занят' : ''),
    ],
    ['Сложность', state?.survival?.difficulty ?? '—'],
    [
      'Здоровье / голод',
      state?.survival
        ? `${state.survival.health.toFixed(0)} / ${state.survival.food.toFixed(0)}`
        : '—',
    ],
    [
      'Броня / воздух',
      state?.survival ? `${state.survival.armor} / ${Math.round(state.survival.air)}` : '—',
    ],
    ['Уровень опыта', state?.survival ? `${state.survival.level} (${state.survival.xp})` : '—'],
    ['Существ на карте', String(state?.mobs.length ?? 0)],
    ['Стрел / сфер опыта', `${state?.arrows.length ?? 0} / ${state?.orbs.length ?? 0}`],
    [
      'Эффекты',
      state?.survival?.effects.length
        ? state.survival.effects.map((e) => e.name).join(', ')
        : 'нет',
    ],
  ];
  $('#debug-metrics').innerHTML = rows
    .map(([label, value]) => `<div><span>${label}</span><span>${value}</span></div>`)
    .join('');
  $<HTMLButtonElement>('#step-tick').disabled = view === 'game' || !ready;
}
function input(): PlayerInput {
  const k = controls.read(keys);
  if (!touchControls.active) return { ...k, yaw, pitch };
  const t = touchControls.read();
  return {
    forward: k.forward || t.forward,
    strafe: k.strafe || t.strafe,
    jump: k.jump || t.jump,
    crouch: k.crouch || t.crouch,
    sprint: k.sprint || t.sprint,
    yaw,
    pitch,
  };
}
/** Double-tapping jump toggles flight, as in the reference creative mode. */
function jumpTapped() {
  if (!state || state.gameMode === 'survival') return;
  const now = performance.now();
  if (now - lastJumpTap < 300) {
    send({ type: 'fly' });
    lastJumpTap = 0;
  } else lastJumpTap = now;
}
let lastInputSignature = '';
function emitInput(force = false) {
  const value =
    view === 'game' && ready && !openPanel() && !panelPending() && !state?.survival.dead
      ? input()
      : { ...EMPTY_INPUT, yaw, pitch };
  const signature = JSON.stringify(value),
    now = performance.now();
  if (force || signature !== lastInputSignature || now - inputTime > 500) {
    send({ type: 'input', input: value });
    lastInputSignature = signature;
    inputTime = now;
  }
}
function act(action: 'hit' | 'use' | 'pick') {
  if (view !== 'game') return;
  send({ type: 'input', input: input() });
  send({ type: 'interact', action });
  if (action === 'hit' || (action === 'use' && !holdsUse())) {
    worldRenderer.punch();
    swings++;
  }
}
function slotClick(
  id: string | null,
  index: number,
  button: number,
  options: SlotClickOptions = {},
) {
  // The markup names a block container after its kind; the core addresses it by world position,
  // so a click that is not translated here would always land on "this container is closed".
  const target =
    id === 'container' || id === 'furnace' ? ((container()?.key ?? null) as string | null) : id;
  send({ type: 'slot-click', id: target, index, button, options });
  if (target === null) send({ type: 'input', input: input() });
}
function look(dx: number, dy: number) {
  yaw -= Math.max(-500, Math.min(500, dx)) * sensitivity;
  pitch = Math.max(
    -1.54,
    Math.min(
      1.54,
      pitch -
        Math.max(-500, Math.min(500, dy)) * sensitivity * (controls.settings.invertY ? -1 : 1),
    ),
  );
}
function downloadReport() {
  const data = {
    app: 'voxel-web-lab',
    version: APP_VERSION,
    referenceTarget: 'Java Edition 1.12.2 — not yet parity-tested',
    generatedAt: new Date().toISOString(),
    seed,
    preset,
    session,
    radius,
    state,
    performance: {
      fps,
      tps,
      tickMs,
      backlog,
      droppedMs,
      faces: worldRenderer.faceCount,
      gpu: worldRenderer.resourceStats,
      environment: worldRenderer.environment,
      graphics: worldRenderer.quality,
      frameTimes: worldRenderer.frameStats.snapshot(),
      animation: worldRenderer.animationStats,
      jobs: { ...workerJobs },
      audio: audio.status,
      calls: worldRenderer.renderer.info.render.calls,
      measurement: 'Browser frame intervals and CPU submission time, not GPU timer queries',
    },
    limitations: [
      'Local saves depend on IndexedDB availability; use world export as backup',
      'Original test terrain, not the vanilla generator',
      'Single-player voxel engine: saves, AI, redstone, dimensions and bosses; not vanilla parity',
      'Item and block IDs are original lab:* keys, not Minecraft IDs',
    ],
    saving: saves?.status(),
    messages,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `webcraft-report-${Date.now()}.json`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Диагностический отчёт скачан. Это не сохранение мира.');
}
function requestFixture(): Promise<ReturnType<typeof runCoreFixture>> {
  return new Promise((resolve, reject) => {
    const id = ++requestID;
    const timer = window.setTimeout(() => {
      fixtureRequests.delete(id);
      reject(new Error('Worker fixture timeout'));
    }, 30000);
    fixtureRequests.set(id, { resolve, reject, timer });
    send({ type: 'fixture', requestID: id });
  });
}

$('#fatal-retry').addEventListener('click', () => location.reload());
$('#play').addEventListener('click', play);
$('#resume').addEventListener('click', play);
$('#brand').addEventListener('click', () => {
  if (view === 'game') menu();
  else setView('home');
});
$('#pause-button').addEventListener('click', () => menu(view === 'game' ? 'game' : 'settings'));
$('#open-settings').addEventListener('click', () => menu('settings'));
$('#pause-settings').addEventListener('click', () => tab('settings'));
$('#world-settings').addEventListener('click', () => openCreate());
function closeMenu() {
  if (ready && !menuFromHome) play();
  else setView('home');
}
$('#close-menu').addEventListener('click', closeMenu);
$('#menu-home').addEventListener('click', () => {
  if (onlineClient) void leaveOnline('Отключено от сервера.');
  else setView('home');
});
function openCreate() {
  setView('create');
  $<HTMLInputElement>('#new-world-name').focus();
  $<HTMLInputElement>('#new-world-name').select();
}
for (const id of ['#close-create', '#close-multiplayer', '#close-about', '#about-ok'])
  $(id).addEventListener('click', () => setView('home'));
$('#about-debug').addEventListener('click', () => {
  setView('home');
  debugToggle();
});
$('#random-seed').addEventListener('click', () => {
  const words = ['долина', 'утёс', 'роща', 'пик', 'бухта', 'чаща', 'остров', 'каньон'];
  const pick = words[Math.floor(Math.random() * words.length)];
  $<HTMLInputElement>('#seed-input').value = `${pick}-${Math.floor(Math.random() * 90000 + 10000)}`;
});
function chooseMode(mode: string) {
  $<HTMLSelectElement>('#game-mode').value = mode;
  document
    .querySelectorAll<HTMLElement>('[data-mode-card]')
    .forEach((el) => el.setAttribute('aria-checked', String(el.dataset.modeCard === mode)));
}
document
  .querySelectorAll<HTMLElement>('[data-mode-card]')
  .forEach((el) => el.addEventListener('click', () => chooseMode(el.dataset.modeCard!)));
/* ------------------------------------------------------------------ device: computer or phone */
type Device = 'pc' | 'phone';
function initialDevice(): Device {
  try {
    const saved = localStorage.getItem('webcraft:device');
    if (saved === 'pc' || saved === 'phone') return saved;
  } catch {
    /* Opaque previews have no localStorage. */
  }
  return matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches
    ? 'phone'
    : 'pc';
}
let device: Device = initialDevice();
function setDevice(next: Device, remember = true) {
  device = next;
  document.body.dataset.device = next;
  document
    .querySelectorAll<HTMLElement>('[data-device]')
    .forEach((el) => el.setAttribute('aria-checked', String(el.dataset.device === next)));
  if (remember)
    try {
      localStorage.setItem('webcraft:device', next);
    } catch {
      /* Opaque previews have no localStorage. */
    }
  touchControls.setEnabled(next === 'phone');
  // A phone draws the horizon to 512 blocks at most, whatever the setting says.
  worldRenderer?.setFarCap(next === 'phone' ? 512 : 2048);
}
document
  .querySelectorAll<HTMLElement>('[data-device]')
  .forEach((el) => el.addEventListener('click', () => setDevice(el.dataset.device as Device)));
setDevice(device, false);
$('#respawn').addEventListener('click', () => {
  send({ type: 'respawn' });
  play();
});
$('#respawn-button').addEventListener('click', () => {
  send({ type: 'respawn' });
  survivalSignature = '';
  lastHealth = 20;
  play();
});
$('#difficulty').addEventListener('change', () => {
  const value = $<HTMLSelectElement>('#difficulty').value;
  send({ type: 'difficulty', difficulty: value as 'peaceful' | 'easy' | 'normal' | 'hard' });
});
$('#about').addEventListener('click', () => setView('about'));
$('#debug-toggle').addEventListener('click', debugToggle);
$('#close-debug').addEventListener('click', debugToggle);
$('#download-report').addEventListener('click', downloadReport);
$('#step-tick').addEventListener('click', () => send({ type: 'step' }));
$('#close-palette').addEventListener('click', play);
$('#close-panel').addEventListener('click', requestClosePanel);
$('#hotbar').addEventListener('click', (event) => {
  const el = (event.target as Element).closest<HTMLElement>('[data-slot]');
  if (el) {
    selected = Number(el.dataset.slot);
    send({ type: 'hotbar', index: selected });
  }
});
$('#palette-grid').addEventListener('click', (event) => {
  const el = (event.target as Element).closest<HTMLElement>('[data-item]');
  if (!el?.dataset.item) return;
  send({ type: 'grant', item: el.dataset.item, count: 1 });
  play();
});
$('#recipe-search').addEventListener('input', () => {
  recipeQuery = $<HTMLInputElement>('#recipe-search').value.trim();
  const view = container();
  if (view) renderRecipes(view);
});
$('#recipe-filter').addEventListener('change', () => {
  recipeOnlyCraftable = $<HTMLInputElement>('#recipe-filter').checked;
  const view = container();
  if (view) renderRecipes(view);
});
$('#recipe-list').addEventListener('click', (event) => {
  const el = (event.target as Element).closest<HTMLElement>('[data-recipe]');
  if (!el?.dataset.recipe) return;
  send({ type: 'recipe', id: el.dataset.recipe });
});
$('#panel-overlay').addEventListener('keydown', (event) => {
  if (event.code === 'Tab') {
    const focusables = [
      ...$('#panel-overlay').querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]',
      ),
    ].filter((el) => el.getClientRects().length > 0);
    const first = focusables[0],
      last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      event.stopPropagation();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      event.stopPropagation();
      first?.focus();
    }
    return;
  }
  if (event.code !== 'Enter' && event.code !== 'Space') return;
  const target = slotTarget(event);
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  slotClick(target.id, target.index, 0, { shift: event.shiftKey });
});
$('#panel-overlay').addEventListener('focusin', (event) => {
  const target = slotTarget(event);
  hoveredSlot = target ? { id: target.id, index: target.index } : null;
});
$('#panel-overlay').addEventListener('contextmenu', (event) => {
  if ((event.target as Element).closest('[data-slot-id]')) event.preventDefault();
});
function slotTarget(
  event: Event,
): { id: string | null; index: number; element: HTMLElement } | null {
  const el = (event.target as Element).closest<HTMLElement>('[data-slot-id]');
  if (!el) return null;
  const raw = el.dataset.slotId!;
  const index = Number(el.dataset.slotIndex);
  if (!Number.isFinite(index)) return null;
  return { id: raw === 'player' ? null : raw, index, element: el };
}
function clickOptions(event: MouseEvent): SlotClickOptions {
  return {
    shift: event.shiftKey,
    double: event.detail >= 2,
  };
}
$('#brew-load').addEventListener('click', () => send({ type: 'brewing-fill' }));
$('#brew-take').addEventListener('click', () => send({ type: 'brewing-take' }));
$('#anvil-take').addEventListener('click', () => send({ type: 'anvil-take' }));
$('#trade-offers').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest('button[data-trade]');
  if (button) send({ type: 'trade', index: Number(button.getAttribute('data-trade')) });
});
$('#enchant-offers').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest('button[data-offer]');
  if (button) send({ type: 'enchant-apply', id: button.getAttribute('data-offer')! });
});
$('#panel-overlay').addEventListener('mousedown', (event) => {
  const target = slotTarget(event);
  if (!target) return;
  event.preventDefault();
  if (event.button === 0 || event.button === 2) {
    slotClick(target.id, target.index, event.button, clickOptions(event));
    cursorDrag = { button: event.button, visited: new Set([`${target.id}:${target.index}`]) };
  }
});
$('#panel-overlay').addEventListener('mouseover', (event) => {
  const target = slotTarget(event);
  hoveredSlot = target ? { id: target.id, index: target.index } : null;
  if (!target || !cursorDrag) return;
  const key = `${target.id}:${target.index}`;
  if (cursorDrag.visited.has(key)) return;
  cursorDrag.visited.add(key);
  const remaining = dragRemaining();
  if (cursorDrag.button === 0 || cursorDrag.button === 2)
    slotClick(target.id, target.index, cursorDrag.button, {
      drag: true,
      share: cursorDrag.button === 0,
      slotsLeft: remaining,
    });
});
document.addEventListener('mouseup', () => {
  cursorDrag = null;
});
function dragRemaining(): number {
  const view = container();
  if (!view) return 1;
  const total = view.kind === 'chest' ? view.container.length : view.gridSize * view.gridSize;
  return Math.max(1, total - (cursorDrag?.visited.size ?? 0));
}
$('#panel-overlay').addEventListener('mousemove', (event) => {
  const el = $('#cursor-item');
  if (!el.hidden) {
    el.style.left = `${event.clientX}px`;
    el.style.top = `${event.clientY}px`;
  }
  moveSlotTip(event, !el.hidden);
});
$('#panel-overlay').addEventListener('mouseleave', () => ($('#slot-tip').hidden = true));
/** Item tooltip in the style of the reference: follows the cursor, hidden while an item is carried. */
function moveSlotTip(event: MouseEvent, carrying: boolean) {
  const tip = $('#slot-tip');
  const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-tip]');
  const name = cell?.dataset.tip;
  if (!cell || !name || carrying) {
    tip.hidden = true;
    return;
  }
  const sub = cell.dataset.tipSub ?? '';
  const key = `${name}|${sub}`;
  if (tip.dataset.key !== key) {
    tip.dataset.key = key;
    tip.textContent = name;
    if (sub) {
      const small = document.createElement('small');
      small.textContent = sub;
      tip.append(small);
    }
  }
  tip.hidden = false;
  const x = event.clientX + 14;
  const y = event.clientY - 30;
  const w = tip.offsetWidth;
  tip.style.left = `${x + w > window.innerWidth - 8 ? event.clientX - w - 14 : x}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}
document
  .querySelectorAll<HTMLElement>('[data-tab]')
  .forEach((el) => el.addEventListener('click', () => tab(el.dataset.tab!)));
$('#regenerate').addEventListener('click', async () => {
  $<HTMLButtonElement>('#regenerate').disabled = true;
  try {
    await saves.create(
      $<HTMLInputElement>('#new-world-name').value.trim(),
      $<HTMLInputElement>('#seed-input').value.trim().slice(0, 64) || '642018',
      $<HTMLSelectElement>('#preset').value as WorldPreset,
      $<HTMLSelectElement>('#game-mode').value as GameMode,
    );
    if (view === 'create') setView('home');
  } catch {
    /* Keep the original world and the creation form; the coordinator explains the error. */
  } finally {
    $<HTMLButtonElement>('#regenerate').disabled = false;
  }
});
$('#distance').addEventListener('change', () => {
  radius = Number($<HTMLSelectElement>('#distance').value);
  worldRenderer.setDistance(radius);
  send({ type: 'radius', radius });
  saves.changedClient();
});
$('#fov').addEventListener('input', () => {
  const fov = Number($<HTMLInputElement>('#fov').value);
  $('#fov-label').textContent = `${fov}°`;
  worldRenderer.setFov(fov);
  saves.changedClient();
});
$('#sensitivity').addEventListener('input', () => {
  const value = Number($<HTMLInputElement>('#sensitivity').value) / 10;
  sensitivity = 0.0019 * value;
  $('#sensitivity-label').textContent = `${value.toFixed(1)}×`;
  saves.changedClient();
});

/** F2: the current frame as a PNG download. */
function saveScreenshot() {
  const stamp = new Date(),
    pad = (n: number) => String(n).padStart(2, '0');
  const name = `webcraft-${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}_${pad(stamp.getHours())}-${pad(stamp.getMinutes())}-${pad(stamp.getSeconds())}.png`;
  canvas.toBlob((blob) => {
    if (!blob) return toast('Снимок не удался');
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(`Снимок сохранён: ${name}`);
  }, 'image/png');
}
/** True when the held item has an action that keeps running while the button stays down. */
function holdsUse(): boolean {
  const held = state?.inventory[state.selected];
  const def = held ? itemRegistry.find(held[0]) : undefined;
  return (
    !!def?.food ||
    def?.use === 'bow' ||
    // A rod casts on one click and reels in on the next: never repeated by a held button.
    def?.use === 'fish' ||
    def?.use === 'shield' ||
    state?.inventory[40]?.[0] === 'lab:shield'
  );
}
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener('mousedown', (event) => {
  if (view !== 'game' || !ready || openPanel() || panelPending()) return;
  event.preventDefault();
  if (document.pointerLockElement === canvas) {
    if (event.button === 0) {
      mineButton = true;
      send({ type: 'mine', active: true });
      act('hit');
    }
    if (event.button === 1) act('pick');
    if (event.button === 2) {
      act('use');
      // The first repeat waits a little longer, so an unhurried click never places two blocks.
      lastUseAt = performance.now() + 100;
      // Food, a bow and a shield keep running while the button stays down.
      useButton = true;
      send({ type: 'hold', active: true });
    }
  } else {
    drag = { x: event.clientX, y: event.clientY, moved: 0, button: event.button, useClick: false };
    if (event.button === 0) {
      mineButton = true;
      send({ type: 'mine', active: true });
      act('hit');
    }
    if (event.button === 1) act('pick');
    if (event.button === 2) {
      // Without pointer lock the same button drags the view: only a click uses the item, and
      // only food, a bow or a shield are held down.
      drag!.useClick = true;
      if (holdsUse()) {
        holdSent = true;
        send({ type: 'hold', active: true });
      }
    }
  }
});
document.addEventListener('mouseup', (event) => {
  // Pointer lock hides the cursor, so a locked right click is a press and a release; without
  // lock the same button doubles as the look control and only a short drag counts as a use.
  if (view === 'game' && drag?.button === 2 && drag.moved < 5 && !holdSent) act('use');
  if (useButton || holdSent) {
    useButton = false;
    holdSent = false;
    send({ type: 'hold', active: false });
  }
  drag = null;
  if (mineButton) {
    mineButton = false;
    send({ type: 'mine', active: false });
  }
  void event;
});
document.addEventListener('mousemove', (event) => {
  if (view !== 'game') return;
  if (document.pointerLockElement === canvas) {
    if (ignoreNextLockedMove) {
      ignoreNextLockedMove = false;
      return;
    }
    if (performance.now() >= ignoreLookUntil) look(event.movementX, event.movementY);
  } else if (drag?.button === 2) {
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = event.clientX;
    drag.y = event.clientY;
    look(dx, dy);
  }
});
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (locked) ignoreLookUntil = performance.now() + 160;
  $('#fallback-hint').hidden = locked || view !== 'game';
  if (
    !locked &&
    pointerWasLocked &&
    view === 'game' &&
    $('#debug').hidden &&
    !openPanel() &&
    !panelPending() &&
    performance.now() > quietMenuUntil
  )
    menu();
  pointerWasLocked = locked;
});
document.addEventListener('pointerlockerror', fallbackLook);
window.addEventListener(
  'wheel',
  (event) => {
    if (
      view !== 'game' ||
      openPanel() ||
      (event.target instanceof Element && event.target.closest('.debug-panel,.modal'))
    )
      return;
    event.preventDefault();
    const direction = wheelSelector.step(event.deltaY, event.deltaMode, performance.now());
    if (!direction) return;
    const next = (((selected + direction) % 9) + 9) % 9;
    selected = next;
    send({ type: 'hotbar', index: next });
  },
  { passive: false },
);
window.addEventListener('keydown', (event) => {
  if (captureBinding(event)) return;
  const editable =
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLSelectElement ||
    event.target instanceof HTMLTextAreaElement;
  // Saving stays available while a field has focus: the shortcut never types a character.
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') {
    event.preventDefault();
    if (!event.repeat) void saves.save().catch(() => {});
    return;
  }
  if (editable && event.code !== 'Escape') return;
  if (
    event.code === 'Space' &&
    event.target instanceof Element &&
    event.target.closest('.debug-panel')
  )
    return;
  if (
    ['Space', 'Tab', 'F3', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(
      event.code,
    ) &&
    ((view === 'game' && !openPanel() && !panelPending()) || event.code === 'F3')
  )
    event.preventDefault();
  if (event.code === 'Escape') {
    if (openPanel()) {
      requestClosePanel();
      return;
    }
    if (!$('#world-action-overlay').hidden) {
      worldActions.closeAction();
      return;
    }
    if (view === 'worlds' || view === 'create' || view === 'multiplayer' || view === 'about') {
      setView('home');
      return;
    }
    if (view === 'game') menu();
    else if (view === 'palette') play();
    else if (view === 'pause') closeMenu();
    return;
  }
  if (event.code === 'F3' && !event.repeat) {
    debugToggle();
    return;
  }
  if (
    view === 'game' &&
    !openPanel() &&
    (event.code === 'F1' || event.code === 'F2' || event.code === 'F5')
  ) {
    event.preventDefault();
    if (event.repeat) return;
    if (event.code === 'F5') {
      // First person → from behind → facing the player, as in the reference.
      const next = { first: 'back', back: 'front', front: 'first' } as const;
      worldRenderer.cameraMode = next[worldRenderer.cameraMode];
      document.body.dataset.camera = worldRenderer.cameraMode;
    } else if (event.code === 'F1') {
      hudHidden = !hudHidden;
      document.body.classList.toggle('hud-off', hudHidden);
      worldRenderer.handVisible = !hudHidden;
    } else screenshotPending = true;
    return;
  }
  if (view === 'home' && event.code === 'Enter') {
    play();
    return;
  }
  if (
    view === 'palette' &&
    (controls.matches('palette', event.code) || controls.matches('inventory', event.code)) &&
    !event.repeat
  ) {
    play();
    return;
  }
  if (view !== 'game') return;
  if (controls.matches('inventory', event.code) && !event.repeat) {
    event.preventDefault();
    if (openPanel() || panelPending()) requestClosePanel();
    else openInventory();
    return;
  }
  if (event.repeat) {
    if (openPanel() || panelPending()) return;
    if (/^Digit[1-9]$/.test(event.code) && openPanel() && hoveredSlot) return;
    keys.add(event.code);
    return;
  }
  if (openPanel()) {
    if (/^Digit[1-9]$/.test(event.code) && hoveredSlot) {
      slotClick(hoveredSlot.id, hoveredSlot.index, 0, { number: Number(event.code.slice(5)) - 1 });
      return;
    }
    if (/^Digit[1-9]$/.test(event.code)) {
      selected = Number(event.code.slice(5)) - 1;
      send({ type: 'hotbar', index: selected });
      return;
    }
    return;
  }
  keys.add(event.code);
  controls.keyDown(event.code, event.repeat);
  if (controls.isBound(event.code) || /^Digit[1-9]$/.test(event.code)) event.preventDefault();
  emitInput(true);
  if (/^Digit[1-9]$/.test(event.code)) {
    selected = Number(event.code.slice(5)) - 1;
    send({ type: 'hotbar', index: selected });
  }
  if (controls.matches('palette', event.code)) palette();
  if (controls.matches('jump', event.code)) jumpTapped();
  if (onlineClient && (event.code === 'KeyT' || event.code === 'Enter') && !event.repeat) {
    event.preventDefault();
    openChat();
    return;
  }
  if (controls.matches('drop', event.code)) send({ type: 'drop', all: event.ctrlKey });
  if (controls.matches('waypoint', event.code) && !event.repeat && state && !state.survival.dead)
    toast(navigation.toggleMark(state));
  if (controls.matches('flight', event.code)) {
    if (state?.gameMode === 'survival') toast('Полёт доступен в творчестве и лаборатории');
    else send({ type: 'fly' });
  }
  if (controls.matches('respawn', event.code)) send({ type: 'respawn' });
});
window.addEventListener('keyup', (event) => {
  keys.delete(event.code);
  if (view === 'game') emitInput(true);
});
window.addEventListener('blur', () => {
  clearInput();
  if (view === 'game' && !openPanel()) menu();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && view === 'game') menu();
});

let previousFrame = performance.now(),
  frames = 0,
  fpsTime = previousFrame,
  inputTime = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  // Input events go straight to the Worker even at a low rendering cap.
  if (view === 'game' && ready && !openPanel() && !panelPending() && now - inputTime > 32)
    emitInput();
  const panorama = view !== 'game' && view !== 'pause' && ready && !reducedMotion;
  const interval = panorama
    ? Math.max(1000 / 30, 1000 / graphics.fpsLimit)
    : renderInterval(view === 'game' && !openPanel(), document.hidden, graphics.fpsLimit);
  if (
    document.hidden ||
    now - previousFrame < interval - 0.6 ||
    (view !== 'game' && !panorama && ready && !uploads.length && !worldRenderer.needsFrame)
  )
    return;
  const frameMs = now - previousFrame,
    dt = Math.min(0.1, frameMs / 1000);
  previousFrame = now;
  const cpuStart = performance.now(),
    uploadStart = cpuStart;
  let budget = 0;
  while (
    uploads.length &&
    budget < 4 &&
    performance.now() - uploadStart < worldRenderer.uploadBudget
  ) {
    worldRenderer.receive(uploads.shift()!);
    budget++;
  }
  if (workerReady && !uploads.length) finishLoading();
  const current = input();
  touchControls.setVisible(view === 'game' && !openPanel() && !state?.survival.dead);
  sendPose(now);
  worldRenderer.panoramaLift = panorama ? 3.5 : 0;
  if (panorama) {
    panoramaYaw += dt * 0.04;
    worldRenderer.look(panoramaYaw, -0.16);
  } else worldRenderer.look(yaw, pitch, current.crouch && view === 'game' && !state?.player.flying);
  // Holding the right button with a block keeps building, one block every four ticks.
  if (
    useButton &&
    view === 'game' &&
    !openPanel() &&
    document.pointerLockElement === canvas &&
    now - lastUseAt >= 200 &&
    !holdsUse()
  ) {
    lastUseAt = now;
    act('use');
  }
  worldRenderer.render(dt, now / 1000);
  if (view === 'game') navigation.update(state, yaw);
  if (screenshotPending) {
    // Read the frame in the same task it was drawn: no preserved drawing buffer is needed.
    screenshotPending = false;
    saveScreenshot();
  }
  worldRenderer.measure(
    frameMs,
    performance.now() - cpuStart,
    view === 'game' && ready && !openPanel() && !backlog && !uploads.length,
  );
  frames++;
  if (now - fpsTime >= 1000) {
    fps = Math.round((frames * 1000) / (now - fpsTime));
    frames = 0;
    fpsTime = now;
    if (!$('#debug').hidden) updateDebug();
  }
}
$<HTMLInputElement>('#seed-input').value = seed;
$<HTMLSelectElement>('#preset').value = preset;
$<HTMLSelectElement>('#distance').value = String(radius);
worldRenderer.setDistance(radius);
function clientCheckpoint(): ClientCheckpoint {
  return {
    settings: {
      radius,
      fov: Number($<HTMLInputElement>('#fov').value),
      sensitivity: Number($<HTMLInputElement>('#sensitivity').value) / 10,
    },
  };
}
function captureTicket(): Promise<CaptureTicket> {
  return new Promise((resolve, reject) => {
    if (!ready) {
      reject(new Error('Мир ещё загружается.'));
      return;
    }
    const id = ++requestID;
    const timer = window.setTimeout(() => {
      captureRequests.delete(id);
      reject(new Error('Ядро не ответило на запрос сохранения. Последняя запись не заменена.'));
    }, 20_000);
    captureRequests.set(id, { resolve, reject, timer });
    if (view === 'game') send({ type: 'input', input: input() });
    send({ type: 'capture', requestID: id, session });
  });
}
async function captureCore(): Promise<CoreCheckpoint> {
  return (await captureTicket()).core;
}
const saves = new SaveCoordinator({
  ready: () => ready,
  current: () => state,
  client: clientCheckpoint,
  capture: captureTicket,
  // Deliberately view-neutral: saving must never yank the player into a menu.
  pause: () => {
    clearInput();
    send({ type: 'pause', paused: true });
  },
  load: beginWorld,
  changed: (status) => renderSaveStatus(status),
  notify: toast,
});
/* ------------------------------------------------------------------ network game */
let onlineClient: OnlineClient | null = null;
let onlineSaveTimer = 0;
let lastPoseAt = 0;
let remotePlayers: NetPlayer[] = [];
const serverPage = (
  window as unknown as {
    __WEBCRAFT_SERVER__?: {
      name: string;
      host: string;
      port?: number;
      desktop?: boolean;
      addresses?: { ip: string; hint: string }[];
    };
  }
).__WEBCRAFT_SERVER__;
function storedName(): string {
  try {
    return localStorage.getItem('webcraft:mp-name') ?? '';
  } catch {
    return '';
  }
}
function skinIndex(): number {
  try {
    const look = JSON.parse(localStorage.getItem('voxel:player-look') ?? '{}') as { skin?: string };
    return Math.max(
      0,
      BUILTIN_SKINS.findIndex((s) => s.id === look.skin),
    );
  } catch {
    return 0;
  }
}
$<HTMLInputElement>('#mp-name').value = storedName();
if (serverPage) {
  // The page came from a server: joining it is one tap away.
  const [host, port] = (location.host || serverPage.host).split(':');
  $<HTMLInputElement>('#mp-host').value = host;
  $<HTMLInputElement>('#mp-port').value = port || String(DEFAULT_PORT);
  $('#server-banner').hidden = false;
  $('#server-banner-name').textContent = serverPage.name;
  // WebCraft.exe: this computer is the server; tell the player what to give friends.
  if (serverPage.desktop && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    $('#server-banner .eyebrow').textContent = 'ТВОЙ СЕРВЕР · ДЛЯ ДРУЗЕЙ';
    const info = $('#mp-host-info');
    const list = serverPage.addresses ?? [];
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    info.innerHTML = list.length
      ? `<strong>Этот компьютер — сервер.</strong> Друзья вводят адрес и порт <code>${esc(port || String(DEFAULT_PORT))}</code>:<ul>${list
          .slice(0, 4)
          .map((a) => `<li><code>${esc(a.ip)}</code>${a.hint ? ` · ${esc(a.hint)}` : ''}</li>`)
          .join(
            '',
          )}</ul>Или открывают в браузере <code>http://${esc(list[0].ip)}:${esc(port || String(DEFAULT_PORT))}</code>. Сам заходи кнопкой «Подключиться».`
      : '<strong>Этот компьютер — сервер.</strong> Включи Radmin VPN или Hamachi и перезапусти WebCraft: здесь появится адрес для друзей.';
    info.hidden = false;
    // The Node.js hosting steps are for the .mjs server; WebCraft.exe already is one.
    $<HTMLDetailsElement>('.mp-help').hidden = true;
  }
}
$('#server-join').addEventListener('click', () => {
  openMultiplayer();
  // A returning player already has a name: straight in.
  if (cleanName($<HTMLInputElement>('#mp-name').value)) void connectOnline();
});
$('#open-multiplayer').addEventListener('click', () => openMultiplayer());
function openMultiplayer() {
  setView('multiplayer');
  const status = $('#mp-status');
  status.textContent =
    location.protocol === 'https:'
      ? 'Страница открыта по https: браузер не пустит к серверу. Открой игру по адресу http://IP:порт сервера.'
      : '';
  status.dataset.kind = location.protocol === 'https:' ? 'error' : '';
  const name = $<HTMLInputElement>('#mp-name');
  (name.value ? $<HTMLInputElement>('#mp-host') : name).focus();
}
async function connectOnline() {
  const status = $('#mp-status');
  const name = cleanName($<HTMLInputElement>('#mp-name').value);
  if (!name) {
    status.textContent = 'Имя — от 2 до 16 букв или цифр.';
    status.dataset.kind = 'error';
    return;
  }
  const host = $<HTMLInputElement>('#mp-host').value.trim();
  if (!host) {
    status.textContent = 'Введи IP-адрес сервера: его даёт тот, кто запустил сервер.';
    status.dataset.kind = 'error';
    return;
  }
  try {
    localStorage.setItem('webcraft:mp-name', name);
  } catch {
    /* Opaque previews have no localStorage. */
  }
  const button = $<HTMLButtonElement>('#mp-connect');
  button.disabled = true;
  status.textContent = 'Подключаемся…';
  status.dataset.kind = '';
  try {
    // The local world is saved first and left untouched while the network game runs.
    if (ready && !saves.suspended) await saves.flush().catch(() => false);
    const client = await OnlineClient.connect(
      serverURL(host, $<HTMLInputElement>('#mp-port').value),
      name,
      skinIndex(),
      {
        edits: (edits) => send({ type: 'net-edits', edits }),
        players: (list) => {
          remotePlayers = list.filter((p) => p.id !== onlineClient?.id);
          showRemotes();
        },
        chat: (from, text, system) => chatLine(from, text, system),
        time: (time) => {
          if (state && Math.abs(state.time - time) > 100) send({ type: 'time', value: time });
        },
        closed: (reason) => void leaveOnline(reason),
      },
    );
    onlineClient = client;
    saves.suspended = true;
    document.body.classList.add('online');
    const w = client.welcome.world;
    beginWorld(
      {
        meta: { id: `online:${host}`, name: `${w.name} · сервер` },
        file: { payload: { core: client.welcome.checkpoint, client: clientCheckpoint() } },
      } as unknown as OpenWorld,
      true,
    );
    $('#menu-home').innerHTML = `${uiIcon('back', 17)} Отключиться от сервера`;
    $('#menu-description').textContent = 'Сетевая игра продолжается, пока ты в меню.';
    chatLine('', client.welcome.motd, true);
    clearInterval(onlineSaveTimer);
    onlineSaveTimer = window.setInterval(() => void saveOnline(), 20_000);
    status.textContent = '';
  } catch (error) {
    status.textContent = (error as Error).message;
    status.dataset.kind = 'error';
  } finally {
    button.disabled = false;
  }
}
$('#mp-connect').addEventListener('click', () => void connectOnline());
for (const id of ['#mp-name', '#mp-host', '#mp-port'])
  $(id).addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') void connectOnline();
  });
async function saveOnline() {
  if (!onlineClient || !ready) return;
  try {
    onlineClient.save(await captureCore());
  } catch {
    /* The next autosave tries again. */
  }
}
async function leaveOnline(reason: string) {
  const client = onlineClient;
  if (!client) return;
  await saveOnline();
  onlineClient = null;
  clearInterval(onlineSaveTimer);
  client.close();
  remotePlayers = [];
  showRemotes();
  document.body.classList.remove('online');
  $('#online-badge').hidden = true;
  $('#menu-home').innerHTML = `${uiIcon('back', 17)} Сохранить и выйти в меню`;
  $('#menu-description').textContent = 'Мир подождёт — время остановлено.';
  closeChat();
  toast(reason);
  setView('home');
  await saves.resume().catch(() => {});
}
function showRemotes() {
  const dimension = state?.dimension ?? 'overworld';
  worldRenderer.setRemotePlayers(
    remotePlayers.map((p) => ({ ...p, visible: p.dim === dimension })),
  );
  $('#online-badge').hidden = !onlineClient;
  $('#online-count').textContent = String(remotePlayers.length + 1);
  $('#online-badge').title = ['Ты', ...remotePlayers.map((p) => p.name)].join(', ');
}
/** Where this player stands and what he holds, ten times a second. */
function sendPose(now: number) {
  if (!onlineClient || !state || !ready || now - lastPoseAt < 100) return;
  lastPoseAt = now;
  if (mineButton && now % 300 < 100) swings++;
  const p = state.player.position;
  onlineClient.pose({
    x: p.x,
    y: p.y,
    z: p.z,
    yaw,
    pitch,
    dim: (state.dimension ?? 'overworld') as NetPlayer['dim'],
    held: state.inventory[state.selected]?.[0] ?? null,
    crouching: !!state.motion?.crouching,
    flying: state.player.flying,
    onGround: state.player.onGround,
    swings,
  });
}
/* Chat: T or Enter opens the line, Enter sends, Escape closes. */
function chatLine(from: string, text: string, system = false) {
  const log = $('#chat-log');
  const line = document.createElement('div');
  line.className = system ? 'chat-line system' : 'chat-line';
  if (from) {
    const who = document.createElement('b');
    who.textContent = `${from}: `;
    line.append(who);
  }
  line.append(text);
  log.append(line);
  while (log.children.length > 60) log.firstElementChild?.remove();
  log.scrollTop = log.scrollHeight;
  setTimeout(() => line.classList.add('old'), 9000);
}
function openChat() {
  if (!onlineClient || view !== 'game') return;
  clearInput();
  quietMenuUntil = performance.now() + 800;
  if (document.pointerLockElement) document.exitPointerLock();
  document.body.classList.add('chatting');
  const input = $<HTMLInputElement>('#chat-input');
  input.hidden = false;
  input.value = '';
  setTimeout(() => input.focus(), 0);
}
function closeChat() {
  document.body.classList.remove('chatting');
  $<HTMLInputElement>('#chat-input').hidden = true;
}
$('#chat-input').addEventListener('keydown', (event) => {
  const e = event as KeyboardEvent;
  e.stopPropagation();
  if (e.key === 'Enter') {
    const text = $<HTMLInputElement>('#chat-input').value.trim();
    if (text) onlineClient?.chat(text);
    closeChat();
    if (device === 'pc') play();
  } else if (e.key === 'Escape') {
    closeChat();
    if (device === 'pc') play();
  }
});
$('#chat-input').addEventListener('keyup', (event) => event.stopPropagation());
const worldActions = installWorldActions(saves, {
  library: () => setView('worlds'),
  home: () => setView('home'),
  menu,
  create: () => openCreate(),
  play,
  notify: toast,
});
renderSaveStatus(saves.status());
renderHotbar();
void saves
  .initialise(
    seed,
    preset,
    clientCheckpoint(),
    query.get('world'),
    query.has('seed') || query.has('preset') || query.has('mode'),
    isGameMode(query.get('mode')) ? (query.get('mode') as GameMode) : undefined,
  )
  .catch((error) => fail(error instanceof Error ? error.message : 'Не удалось открыть мир.'));
window.addEventListener('beforeunload', (event) => {
  if (saves.shouldWarnOnExit) {
    event.preventDefault();
    event.returnValue = '';
  }
});
requestAnimationFrame(frame);

// Read-only observability plus normal input commands for browser/Worker regression tests.
// It is not a game-server authority API and is removed from production builds.
if (import.meta.env.DEV) {
  window.__VOXEL_LAB__ = {
    getState: () => (state ? structuredClone(state) : null),
    getInfo: () => ({
      ready,
      view,
      online: onlineClient ? { id: onlineClient.id, remotes: worldRenderer.remoteCount } : null,
      device,
      far: worldRenderer.farStats,
      seed,
      preset,
      naturalSpawning,
      input: input(),
      fps,
      tps,
      tickMs,
      session,
      backlog,
      camera: worldRenderer.eye,
      meshes: worldRenderer.meshCount,
      faces: worldRenderer.faceCount,
      gpu: worldRenderer.resourceStats,
      environment: worldRenderer.environment,
      graphics: worldRenderer.quality,
      frameTimes: worldRenderer.frameStats.snapshot(),
      animation: worldRenderer.animationStats,
      jobs: { ...workerJobs },
      audio: audio.status,
      panel: openPanel() ? (container()?.kind ?? null) : null,
      save: saves.status(),
    }),
    fixture: requestFixture,
    capture: captureCore,
    save: () => saves.save(),
    failNextSave: (kind) => saves.injectFailure(kind),
    setLook: (nextYaw: number, nextPitch: number) => {
      yaw = nextYaw;
      pitch = Math.max(-1.54, Math.min(1.54, nextPitch));
    },
    grant: (item: string, count = 1) => send({ type: 'grant', item, count }),
    /** Debug travel: the same road a portal takes, without the walk. */
    travel: (dimension: 'overworld' | 'nether' | 'end') => send({ type: 'travel', dimension }),
    teleport: (x: number, y: number, z: number) => send({ type: 'teleport', x, y, z }),
    /** Debug: toggles creative flight without a keyboard (teleport already turns it on). */
    fly: () => send({ type: 'fly' }),
    /** Debug: camera view without the F5 key — 'first', 'back' (from behind) or 'front'. */
    camera: (mode: 'first' | 'back' | 'front') => {
      worldRenderer.cameraMode = mode;
      document.body.dataset.camera = mode;
    },
    weather: (rain: number | null, thunder = 0) => send({ type: 'weather', rain, thunder }),
    tuneHeld: (kind: string, patch: Record<string, unknown>) => worldRenderer.tuneHeld(kind, patch),
    hotbar: (index: number) => {
      selected = index;
      send({ type: 'hotbar', index });
    },
    openCrafting: () => openInventory(),
    openContainer: (kind: OpenContainerKind, x: number, y: number, z: number) =>
      openWorldContainer(kind, x, y, z),
    enchantApply: (id: string) => send({ type: 'enchant-apply', id }),
    brewingFill: () => send({ type: 'brewing-fill' }),
    brewingTake: () => send({ type: 'brewing-take' }),
    anvilTake: () => send({ type: 'anvil-take' }),
    closeContainer: () => requestClosePanel(),
    slotClick: (id: string | null, index: number, button = 0, options: SlotClickOptions = {}) =>
      slotClick(id, index, button, options),
    recipe: (id: string) => send({ type: 'recipe', id }),
    drop: (all = true) => send({ type: 'drop', all }),
    die: () => send({ type: 'die' }),
    mine: (active: boolean) => send({ type: 'mine', active }),
    hold: (active: boolean) => send({ type: 'hold', active }),
    mob: (kind: string, distance = 3) => send({ type: 'mob', kind, distance }),
    despawnMobs: () => send({ type: 'mob', kind: null }),
    /** Starts a generated piece of music now instead of after the usual silence. */
    music: () => audio.musicNow(),
    damage: (amount: number, kind = 'generic') => send({ type: 'damage', amount, kind }),
    difficulty: (difficulty: 'peaceful' | 'easy' | 'normal' | 'hard') =>
      send({ type: 'difficulty', difficulty }),
    time: (value: number) => send({ type: 'time', value }),
    block: (x: number, y: number, z: number, state: number) =>
      send({ type: 'block', x, y, z, state }),
    probe: (x: number, y: number, z: number) => send({ type: 'probe', x, y, z }),
    press: (x: number, y: number, z: number) => send({ type: 'press', x, y, z }),
    vitals: (values: { health?: number; food?: number; saturation?: number; xp?: number }) =>
      send({ type: 'vitals', ...values }),
    respawn: () => send({ type: 'respawn' }),
    hit: () => act('hit'),
    use: () => act('use'),
    pick: () => act('pick'),
  };
}
declare global {
  interface Window {
    __VOXEL_LAB__?: {
      getState: () => SimulationSnapshot | null;
      getInfo: () => {
        ready: boolean;
        view: View;
        online: { id: number; remotes: number } | null;
        device: 'pc' | 'phone';
        far: { active: boolean; tiles: number; vertices: number };
        seed: string;
        preset: WorldPreset;
        naturalSpawning: boolean;
        input: PlayerInput;
        fps: number;
        tps: number;
        tickMs: number;
        session: number;
        backlog: number;
        camera: { x: number; y: number; z: number };
        meshes: number;
        faces: number;
        jobs: {
          generationMs: number;
          meshMs: number;
          lightMs: number;
          stampMs: number;
          lightColumns: number;
        };
        environment: VoxelRenderer['environment'];
        gpu: VoxelRenderer['resourceStats'];
        graphics: VoxelRenderer['quality'];
        frameTimes: ReturnType<VoxelRenderer['frameStats']['snapshot']>;
        animation: VoxelRenderer['animationStats'];
        audio: {
          unlocked: boolean;
          running: boolean;
          volume: number;
          music: number;
          musicPlaying: boolean;
          active: number;
        };
        panel: string | null;
        save: import('./saves').SaveStatus;
      };
      fixture: () => Promise<ReturnType<typeof runCoreFixture>>;
      capture: () => Promise<CoreCheckpoint>;
      save: () => Promise<boolean>;
      failNextSave: (kind: 'quota' | 'abort') => void;
      setLook: (yaw: number, pitch: number) => void;
      grant: (item: string, count?: number) => void;
      travel: (dimension: 'overworld' | 'nether' | 'end') => void;
      teleport: (x: number, y: number, z: number) => void;
      fly: () => void;
      camera: (mode: 'first' | 'back' | 'front') => void;
      weather: (rain: number | null, thunder?: number) => void;
      tuneHeld: (kind: string, patch: Record<string, unknown>) => void;
      hotbar: (index: number) => void;
      openCrafting: () => void;
      openContainer: (kind: OpenContainerKind, x: number, y: number, z: number) => void;
      enchantApply: (id: string) => void;
      brewingFill: () => void;
      brewingTake: () => void;
      anvilTake: () => void;
      closeContainer: () => void;
      slotClick: (
        id: string | null,
        index: number,
        button?: number,
        options?: SlotClickOptions,
      ) => void;
      recipe: (id: string) => void;
      drop: (all?: boolean) => void;
      die: () => void;
      mine: (active: boolean) => void;
      hold: (active: boolean) => void;
      mob: (kind: string, distance?: number) => void;
      despawnMobs: () => void;
      music: () => void;
      damage: (amount: number, kind?: string) => void;
      difficulty: (difficulty: 'peaceful' | 'easy' | 'normal' | 'hard') => void;
      time: (value: number) => void;
      block: (x: number, y: number, z: number, state: number) => void;
      probe: (x: number, y: number, z: number) => void;
      press: (x: number, y: number, z: number) => void;
      vitals: (values: {
        health?: number;
        food?: number;
        saturation?: number;
        xp?: number;
      }) => void;
      respawn: () => void;
      hit: () => void;
      use: () => void;
      pick: () => void;
    };
  }
}
