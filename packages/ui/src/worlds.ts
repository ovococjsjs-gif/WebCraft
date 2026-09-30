import { PRESET_LABELS } from '../../core/src/terrain';
import { $ } from './ui';
import { icon } from './icons';
import type { WorldMeta } from '../../storage/src/backend';
export interface SaveUIStatus {
  phase: string;
  durable: boolean;
  busy: boolean;
  dirty: boolean;
  savedAt: number | null;
  warning: string;
  error: string;
  active: WorldMeta | null;
  recovered: boolean;
}
const clock = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const date = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
export const escapeHTML = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );
const bytes = (value: number) =>
  value < 1024 * 1024
    ? `${Math.max(1, Math.round(value / 1024))} КБ`
    : `${(value / 1024 / 1024).toFixed(1)} МБ`;
function text(id: string, value: string) {
  const el = $(id);
  if (el.textContent !== value) el.textContent = value;
}
export function mountWorldUI() {
  document
    .querySelector('.top-right')!
    .insertAdjacentHTML(
      'afterbegin',
      `<button id="save-quick" class="save-status" data-mode="opening" title="Сохранить мир · Ctrl+S"><i class="save-dot"></i><span id="save-status-label">Хранилище…</span></button>`,
    );
  document
    .querySelector('.tabs')!
    .insertAdjacentHTML('beforeend', '<button data-tab="saves">Сохранения</button>');
  document.querySelector('.modal-footer')!.insertAdjacentHTML(
    'beforebegin',
    `<div class="tab-content" data-content="saves" hidden>
    <div class="save-summary"><span class="save-summary-icon">${icon('save', 28)}</span><div><strong id="save-summary-title">Локальное сохранение</strong><span id="save-last-time">Ещё не записано</span></div></div>
    <div id="storage-banner" class="storage-banner" hidden><strong id="storage-heading"></strong><p id="storage-message"></p></div>
    <button id="save-now" class="primary-button">${icon('save', 17)} Сохранить сейчас <kbd>Ctrl+S</kbd></button>
    <div class="save-button-pair"><button id="export-active" class="secondary-button">${icon('report', 16)} Экспорт мира</button><button id="open-worlds-menu" class="secondary-button">${icon('folder', 16)} Мои миры</button></div>
    <button id="copy-active" class="secondary-button">${icon('copy', 16)} Сохранить отдельной копией</button>
    <div class="save-detail-list"><div><span>Автосохранение</span><strong>каждые 15 секунд</strong></div><div><span>Резервная копия</span><strong>предыдущий снимок</strong></div><div><span>Проверка целостности</span><strong>SHA-256</strong></div></div>
    <p class="warning-text">Миры привязаны к этому браузеру и адресу. Очистка данных сайта удалит их. Для переноса или надёжной резервной копии скачай файл мира.</p>
    <button id="request-persistent" class="text-button">${icon('shield', 15)} Запросить защиту от автоматической очистки</button>
  </div>`,
  );
  $('#app').insertAdjacentHTML(
    'beforeend',
    `
    <div id="worlds-overlay" class="overlay" hidden><section class="modal journal-modal worlds-modal" role="dialog" aria-modal="true" aria-labelledby="worlds-heading">
      <header class="modal-header"><span class="eyebrow">ЛОКАЛЬНАЯ БИБЛИОТЕКА</span><button id="close-worlds" class="icon-button" aria-label="Закрыть миры">${icon('close')}</button></header>
      <div class="library-title"><div><h2 id="worlds-heading">Мои миры.</h2><p id="worlds-subtitle" class="modal-description">Твои постройки остаются с тобой.</p></div><span id="storage-kind" class="local-label">INDEXED DB</span></div>
      <div id="library-warning" class="storage-banner" hidden></div>
      <div class="worlds-toolbar"><button id="new-world" class="primary-button">${icon('plus', 17)} Новый мир</button><button id="import-world" class="secondary-button">${icon('upload', 17)} Импорт файла</button></div>
      <div id="worlds-list" class="worlds-list" aria-live="polite"></div>
      <footer class="modal-footer"><span id="library-summary"></span><span>Без аккаунта и облака</span></footer>
    </section></div>
    <input id="world-file-input" type="file" accept=".json,.voxel,.webcraft,application/json" hidden/>
    <div id="world-action-overlay" class="overlay confirm-overlay" hidden><section class="modal journal-modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="world-action-title">
      <span class="eyebrow">БИБЛИОТЕКА МИРОВ</span><h2 id="world-action-title"></h2><p id="world-action-description" class="modal-description"></p>
      <input id="world-action-name" maxlength="64" autocomplete="off" aria-label="Название мира"/>
      <p id="world-action-error" class="action-error" role="alert" hidden></p>
      <div class="confirm-buttons"><button id="world-action-cancel" class="secondary-button">Отмена</button><button id="world-action-confirm" class="primary-button">Сохранить</button></div>
    </section></div>
    <div id="recovery-notice" class="recovery-notice" hidden role="status"><span>${icon('shield', 18)}</span><div><strong>Открыта резервная копия</strong><p>Основной снимок повреждён. Последние изменения могут отсутствовать. Сохрани восстановленный мир или экспортируй его.</p></div><button id="recovery-details" class="text-button">Подробнее ${icon('arrow', 14)}</button></div>
  `,
  );
}
export function renderSaveStatus(s: SaveUIStatus) {
  const mode =
    s.phase === 'opening'
      ? 'opening'
      : s.error
        ? 'error'
        : !s.durable
          ? 'temporary'
          : s.phase === 'saving'
            ? 'saving'
            : s.dirty
              ? 'pending'
              : 'saved';
  $('#save-quick').dataset.mode = mode;
  $('#save-quick').dataset.phase = s.phase;
  $('#save-quick').dataset.durable = String(s.durable);
  const timestamp = s.savedAt !== null ? clock.format(new Date(s.savedAt)) : '—';
  text(
    '#save-status-label',
    mode === 'opening'
      ? 'Хранилище…'
      : mode === 'error'
        ? 'Ошибка записи'
        : !s.durable
          ? 'Временный мир'
          : mode === 'saving'
            ? 'Сохраняем…'
            : s.dirty
              ? 'Автосохранение'
              : 'Сохранено',
  );
  $('#save-quick').title = !s.durable
    ? 'Нет постоянного хранилища. Экспортируй мир перед выходом.'
    : `Последний подтверждённый снимок: ${timestamp}. Сохранить — Ctrl+S`;
  text('#save-summary-title', s.durable ? 'Мир в этом браузере' : 'Только текущая вкладка');
  text(
    '#save-last-time',
    s.phase === 'saving'
      ? 'Запись нового снимка…'
      : !s.durable
        ? 'IndexedDB недоступна в этом окне'
        : s.savedAt
          ? `Последняя запись · ${timestamp}${s.dirty ? ' · есть изменения' : ''}`
          : 'Ожидаем первую запись',
  );
  const message =
    s.error ||
    (s.recovered
      ? 'Повреждённый снимок не использован. Восстановлена предыдущая проверенная версия. Сохранение запишет её как новую основную копию.'
      : s.warning);
  $('#storage-banner').hidden = !message;
  text(
    '#storage-heading',
    s.error
      ? 'Сохранение не подтверждено'
      : s.recovered
        ? 'Восстановление из резервной копии'
        : 'Временный режим',
  );
  text('#storage-message', message);
  $('#storage-banner').classList.toggle('is-error', !!s.error);
  $('#recovery-notice').hidden = !s.recovered;
  const footer = document.querySelector('.prototype-note') as HTMLElement;
  footer.textContent = !s.durable
    ? 'Временный режим · экспортируй мир перед выходом'
    : 'Локальные сохранения · автосохранение каждые 15 с';
  const small = document.querySelector('.bottom-left small')!;
  const label = !s.durable
    ? 'Только эта вкладка · нужен экспорт'
    : s.error
      ? 'Ошибка сохранения · открой меню'
      : 'Автосохранение · Ctrl+S — сохранить';
  small.innerHTML = `<i></i>${label}`;
  if (s.active) {
    text('#world-title', s.active.name);
    text('#menu-world-name', s.active.name);
  }
  for (const id of ['#save-now', '#save-quick', '#export-active', '#copy-active'])
    $<HTMLButtonElement>(id).disabled = s.busy || !s.active;
  $<HTMLButtonElement>('#request-persistent').disabled = !s.durable;
}
export function renderWorlds(worlds: WorldMeta[], s: SaveUIStatus) {
  text('#world-count', String(worlds.length));
  text('#storage-kind', s.durable ? 'INDEXED DB' : 'ВРЕМЕННО');
  text(
    '#worlds-subtitle',
    s.durable
      ? 'В этом браузере, на этом устройстве. Без облака.'
      : 'Только текущий сеанс. Скачай миры перед выходом.',
  );
  const warning =
    s.error ||
    s.warning ||
    (s.recovered ? 'Для текущего мира открыта предыдущая резервная копия.' : '');
  $('#library-warning').hidden = !warning;
  text('#library-warning', warning);
  text(
    '#library-summary',
    `${worlds.length} ${worlds.length === 1 ? 'мир' : 'миров'} · снимки ${bytes(worlds.reduce((sum, w) => sum + w.bytes, 0))}`,
  );
  $('#worlds-list').innerHTML = worlds.length
    ? worlds
        .map((stored) => {
          const active = stored.id === s.active?.id;
          const world =
            active && s.active
              ? {
                  ...stored,
                  name: s.active.name,
                  tick: s.active.tick,
                  changedBlocks: s.active.changedBlocks,
                }
              : stored;
          const id = escapeHTML(world.id),
            name = escapeHTML(world.name);
          const label = PRESET_LABELS[world.preset];
          return `<article class="world-row ${active ? 'is-current' : ''}" data-world="${id}" data-revision="${world.revision}">
      <div class="world-row-top"><div class="world-avatar ${world.preset}">${icon(world.preset === 'flat' ? 'cube' : 'terrain', 26)}</div><div class="world-row-name"><strong>${name}</strong><span>${label} <b>·</b> Сид ${escapeHTML(world.seed)}</span></div>${active ? '<span class="current-world-tag">ОТКРЫТ</span>' : ''}</div>
      <div class="world-row-info"><span>${date.format(new Date(world.updatedAt))}</span><span>${world.changedBlocks.toLocaleString('ru-RU')} блоков изменено</span><span>${bytes(world.bytes)}</span></div>
      <div class="world-row-actions"><button class="world-open" data-world-action="open">${icon('play', 13)} ${active ? 'Продолжить' : 'Открыть'}</button><div class="world-action-icons"><button data-world-action="rename" title="Переименовать" aria-label="Переименовать ${name}">${icon('edit', 16)}</button><button data-world-action="copy" title="Копировать и открыть" aria-label="Копировать ${name}">${icon('copy', 16)}</button><button data-world-action="export" title="Экспортировать файл мира" aria-label="Экспортировать ${name}">${icon('report', 16)}</button><button data-world-action="delete" class="danger-icon" title="Удалить мир и резервную копию" aria-label="Удалить ${name}">${icon('trash', 16)}</button></div></div>
    </article>`;
        })
        .join('')
    : '<div class="worlds-empty">Здесь появятся твои миры.</div>';
}
