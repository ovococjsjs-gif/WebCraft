import {
  ControlScheme,
  CONTROL_ACTIONS,
  keyLabel,
  type ControlAction,
  type ControlSettings,
} from '@ui/controls';
import { sanitizeQuality, DEFAULT_QUALITY, type QualitySettings } from '@renderer/quality';
import { $ } from '@ui/ui';
/** Machine-local presentation preferences are not world data. Save v6 and old volume/motion settings stay intact. */
const KEY = 'voxel:client-009';
let loaded: { quality?: Partial<QualitySettings>; controls?: Partial<ControlSettings> } = {};
try {
  const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  if (v && typeof v === 'object') loaded = v;
} catch {
  /* Opaque file preview or a malformed preference: safe defaults. */
}
export const controls = new ControlScheme(loaded.controls);
export let graphics = sanitizeQuality(loaded.quality ?? DEFAULT_QUALITY);
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ quality: graphics, controls: controls.settings }));
  } catch {
    /* In-memory controls keep working. */
  }
}
let capture: ControlAction | null = null;
export function refreshControlLabels() {
  document.querySelectorAll<HTMLElement>('[data-control]').forEach((el) => {
    const a = el.dataset.control as ControlAction;
    if (a in CONTROL_ACTIONS) el.textContent = controls.label(a);
  });
  document
    .querySelectorAll<HTMLElement>('[data-movement-keys]')
    .forEach(
      (el) =>
        (el.textContent = (['forward', 'left', 'backward', 'right'] as const)
          .map((a) => keyLabel(controls.primary(a)))
          .join(' ')),
    );
  document.querySelectorAll<HTMLButtonElement>('[data-bind]').forEach((el) => {
    const a = el.dataset.bind as ControlAction;
    el.textContent = capture === a ? 'Нажми клавишу…' : controls.label(a);
    el.classList.toggle('listening', capture === a);
    el.setAttribute(
      'aria-label',
      `${CONTROL_ACTIONS[a].title}: ${controls.label(a)}. Изменить клавишу`,
    );
  });
}
export function cancelBinding() {
  if (capture) {
    capture = null;
    refreshControlLabels();
  }
}
export function captureBinding(event: KeyboardEvent) {
  if (!capture) return false;
  event.preventDefault();
  event.stopPropagation();
  if (event.repeat) return true;
  if (event.code === 'Escape') {
    capture = null;
    $('#binding-status').textContent = 'Изменение отменено.';
    refreshControlLabels();
    return true;
  }
  const action = capture,
    result = controls.bind(action, event.code);
  if (!result.ok) {
    $('#binding-status').textContent =
      'Эта клавиша зарезервирована. Выбери букву, стрелку, пробел или модификатор.';
    return true;
  }
  capture = null;
  $('#binding-status').textContent = result.swapped
    ? `Клавиши «${CONTROL_ACTIONS[action].title}» и «${CONTROL_ACTIONS[result.swapped].title}» поменялись местами.`
    : `${CONTROL_ACTIONS[action].title}: ${controls.label(action)}.`;
  save();
  refreshControlLabels();
  return true;
}
export function installClientSettings(
  apply: (settings: QualitySettings) => void,
  clearInput: () => void,
) {
  $('#binding-grid').innerHTML = (
    Object.entries(CONTROL_ACTIONS) as [ControlAction, (typeof CONTROL_ACTIONS)[ControlAction]][]
  )
    .map(
      ([id, a]) =>
        `<div class="binding-row"><span>${a.title}</span><button type="button" data-bind="${id}">${controls.label(id)}</button></div>`,
    )
    .join('');
  $('#binding-grid').addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-bind]');
    if (!b) return;
    clearInput();
    capture = b.dataset.bind as ControlAction;
    $('#binding-status').textContent =
      'Нажми новую клавишу. Esc — отмена. Занятые клавиши меняются местами.';
    refreshControlLabels();
  });
  $('#reset-controls').addEventListener('click', () => {
    controls.defaults();
    capture = null;
    save();
    syncControls();
    refreshControlLabels();
    $('#binding-status').textContent = 'Стандартное управление восстановлено.';
  });
  const syncControls = () => {
    for (const [id, key] of [
      ['invert-y', 'invertY'],
      ['toggle-sprint', 'toggleSprint'],
      ['toggle-crouch', 'toggleCrouch'],
    ] as const)
      $<HTMLInputElement>('#' + id).checked = controls.settings[key];
  };
  syncControls();
  for (const [id, key] of [
    ['invert-y', 'invertY'],
    ['toggle-sprint', 'toggleSprint'],
    ['toggle-crouch', 'toggleCrouch'],
  ] as const)
    $('#' + id).addEventListener('change', () => {
      controls.settings[key] = $<HTMLInputElement>('#' + id).checked;
      controls.reset();
      save();
    });
  $<HTMLSelectElement>('#graphics-quality').value = graphics.preset;
  $<HTMLSelectElement>('#fps-limit').value = String(graphics.fpsLimit);
  $<HTMLInputElement>('#render-scale').value = String(Math.round(graphics.scale * 100));
  $('#render-scale-label').textContent = `${Math.round(graphics.scale * 100)}%`;
  for (const id of ['adaptive', 'particles', 'clouds', 'shaders', 'post'] as const)
    $<HTMLInputElement>('#' + id).checked = graphics[id];
  $<HTMLSelectElement>('#far-terrain').value = String(graphics.far);
  const update = () => {
    graphics = sanitizeQuality({
      preset: $<HTMLSelectElement>('#graphics-quality').value as QualitySettings['preset'],
      fpsLimit: Number($<HTMLSelectElement>('#fps-limit').value) as QualitySettings['fpsLimit'],
      scale: Number($<HTMLInputElement>('#render-scale').value) / 100,
      adaptive: $<HTMLInputElement>('#adaptive').checked,
      particles: $<HTMLInputElement>('#particles').checked,
      clouds: $<HTMLInputElement>('#clouds').checked,
      shaders: $<HTMLInputElement>('#shaders').checked,
      post: $<HTMLInputElement>('#post').checked,
      far: Number($<HTMLSelectElement>('#far-terrain').value) as QualitySettings['far'],
    });
    $('#render-scale-label').textContent = `${Math.round(graphics.scale * 100)}%`;
    document.body.dataset.quality = graphics.preset;
    save();
    apply(graphics);
  };
  for (const id of [
    'graphics-quality',
    'fps-limit',
    'render-scale',
    'adaptive',
    'particles',
    'clouds',
    'shaders',
    'post',
    'far-terrain',
  ])
    $('#' + id).addEventListener('change', update);
  $('#render-scale').addEventListener(
    'input',
    () => ($('#render-scale-label').textContent = `${$<HTMLInputElement>('#render-scale').value}%`),
  );
  document.body.dataset.quality = graphics.preset;
  apply(graphics);
  refreshControlLabels();
}
