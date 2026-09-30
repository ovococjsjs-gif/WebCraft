import { $ } from '@ui/ui';
import { renderWorlds } from '@ui/worlds';
import { exportFilename, MAX_FILE_BYTES, type WorldEnvelope } from '@storage/format';
import type { WorldMeta } from '@storage/backend';
import { storageError } from '@storage/errors';
import type { SaveCoordinator } from './saves';
interface ActionsBridge {
  library(): void;
  home(): void;
  menu(tab: string): void;
  create(): void;
  play(): void;
  notify(message: string, error?: boolean): void;
}
export function installWorldActions(saves: SaveCoordinator, bridge: ActionsBridge) {
  let worlds: WorldMeta[] = [];
  let action: { type: 'rename' | 'delete'; world: WorldMeta } | null = null;
  async function refresh() {
    worlds = await saves.list();
    renderWorlds(worlds, saves.status());
  }
  const report = (error: unknown) => {
    const e = storageError(error);
    bridge.notify(e.message, true);
    return e;
  };
  async function open() {
    bridge.library();
    await saves.flush().catch(() => {});
    try {
      await refresh();
    } catch (error) {
      report(error);
    }
  }
  function download(file: WorldEnvelope) {
    const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
    const url = URL.createObjectURL(blob),
      anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = exportFilename(file.payload.name);
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    bridge.notify('Файл мира подготовлен. Проверь загрузки браузера.');
  }
  async function exportWorld(id: string) {
    try {
      download(await saves.export(id));
    } catch (error) {
      report(error);
    }
  }
  function closeAction() {
    $('#world-action-overlay').hidden = true;
    action = null;
  }
  function dialog(type: 'rename' | 'delete', world: WorldMeta) {
    action = { type, world };
    $('#world-action-overlay').hidden = false;
    $('#world-action-title').textContent = type === 'rename' ? 'Новое название.' : 'Удалить мир?';
    $('#world-action-description').textContent =
      type === 'rename'
        ? `Название для «${world.name}». Сид и постройки не изменятся.`
        : `«${world.name}» и его резервная копия будут удалены из этого хранилища. Сначала экспортируй мир, если он ещё нужен.`;
    const field = $<HTMLInputElement>('#world-action-name');
    field.hidden = type !== 'rename';
    field.value = world.name;
    $('#world-action-overlay').classList.toggle('is-danger', type === 'delete');
    $('#world-action-confirm').textContent = type === 'rename' ? 'Сохранить имя' : 'Удалить мир';
    $('#world-action-error').hidden = true;
    if (type === 'rename') {
      field.focus();
      field.select();
    }
  }
  $('#open-worlds').addEventListener('click', () => void open());
  $('#open-worlds-menu').addEventListener('click', () => void open());
  $('#close-worlds').addEventListener('click', bridge.home);
  $('#new-world').addEventListener('click', () => bridge.create());
  for (const id of ['#import-world', '#quick-import'])
    $(id).addEventListener('click', () => $<HTMLInputElement>('#world-file-input').click());
  $('#world-file-input').addEventListener('change', async () => {
    const input = $<HTMLInputElement>('#world-file-input');
    const file = input.files?.[0];
    if (!file) return;
    input.value = ''; // Allow re-selecting the same file later.
    bridge.library();
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('Максимальный размер файла мира — 16 МБ.');
      await saves.import(await file.text());
      bridge.notify('Мир импортирован отдельной записью. Существующие миры не заменены.');
      await refresh();
    } catch (error) {
      const e = report(error);
      $('#library-warning').hidden = false;
      $('#library-warning').textContent = e.message;
    }
  });
  $('#save-now').addEventListener(
    'click',
    () =>
      void saves
        .save()
        .then((ok) => {
          if (ok)
            bridge.notify(
              saves.durable
                ? 'Мир записан в этом браузере.'
                : 'Снимок только в памяти вкладки. Для переноса нужен экспорт.',
            );
        })
        .catch(() => {}),
  );
  $('#save-quick').addEventListener('click', () => {
    if (!saves.durable || saves.status().error) bridge.menu('saves');
    else void saves.save().catch(() => {});
  });
  $('#export-active').addEventListener('click', () => {
    if (saves.active) void exportWorld(saves.active.meta.id);
  });
  $('#copy-active').addEventListener('click', async () => {
    if (!saves.active) return;
    try {
      await saves.duplicate(saves.active.meta.id);
      await refresh();
      bridge.notify('Открыта отдельная копия мира.');
    } catch (error) {
      report(error);
    }
  });
  $('#recovery-details').addEventListener('click', () => bridge.menu('saves'));
  $('#request-persistent').addEventListener('click', async () =>
    bridge.notify(
      (await saves.requestPersistentStorage())
        ? 'Браузер разрешил постоянное хранение. Резервный экспорт всё равно полезен.'
        : 'Браузер не предоставил защиту от очистки. Сохраняй резервные файлы мира.',
    ),
  );
  $('#worlds-list').addEventListener('click', async (event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-world-action]');
    const row = button?.closest<HTMLElement>('[data-world]');
    if (!button || !row) return;
    const world = worlds.find((w) => w.id === row.dataset.world);
    if (!world) return;
    const type = button.dataset.worldAction;
    if (type === 'rename' || type === 'delete') {
      dialog(type, world);
      return;
    }
    try {
      if (type === 'open') {
        if (saves.active?.meta.id === world.id) bridge.play();
        else await saves.open(world.id);
      }
      if (type === 'copy') {
        await saves.duplicate(world.id);
        bridge.notify('Создана и открыта копия мира.');
      }
      if (type === 'export') await exportWorld(world.id);
      await refresh();
    } catch (error) {
      report(error);
    }
  });
  $('#world-action-cancel').addEventListener('click', closeAction);
  $('#world-action-confirm').addEventListener('click', async () => {
    if (!action) return;
    const current = action;
    $<HTMLButtonElement>('#world-action-confirm').disabled = true;
    try {
      if (current.type === 'rename')
        await saves.rename(
          current.world.id,
          $<HTMLInputElement>('#world-action-name').value.trim(),
        );
      else await saves.remove(current.world.id, current.world.revision);
      closeAction();
      await refresh();
    } catch (error) {
      $('#world-action-error').hidden = false;
      $('#world-action-error').textContent = storageError(error).message;
    } finally {
      $<HTMLButtonElement>('#world-action-confirm').disabled = false;
    }
  });
  $('#world-action-name').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      $<HTMLButtonElement>('#world-action-confirm').click();
    }
  });
  return { refresh, open, closeAction };
}
