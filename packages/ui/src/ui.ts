import { APP_VERSION, BUILD_LABEL } from '../../content/src/version';
import { BINDINGS } from './bindings';
import { icon, logo } from './icons';
import { GENERATOR_VERSION } from '../../core/src/persistence';
export const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing UI element ${selector}`);
  return element;
};
export function mountUI() {
  $('#app').innerHTML = `
    <canvas id="world" tabindex="-1" aria-label="Игровой воксельный мир"></canvas>
    <div class="world-vignette"></div><div id="medium-overlay" aria-hidden="true"></div>
    <header class="topbar">
      <button class="brand" id="brand" aria-label="Главное меню">${logo}<span>Web<span class="brand-dot">Craft</span></span></button>
      <span class="edition">BETA</span>
      <div class="top-right"><span class="version">${BUILD_LABEL} · ${APP_VERSION}</span><span class="runtime"><i></i><span id="runtime-status">Загрузка ядра</span></span><button class="icon-button" id="pause-button" title="Меню · Esc" aria-label="Открыть меню">${icon('pause', 18)}</button></div>
    </header>
    <section id="home" class="home title-screen">
      <div class="title-column">
        <div class="title-logo" aria-label="WebCraft">${logo.replace('width="36" height="36"', 'width="72" height="72"')}<span class="title-word">Web<b>Craft</b></span></div>
        <h1 class="splash">Всё начинается с одного блока!</h1>
        <div class="title-card journal-page">
          <div id="server-banner" class="server-banner" hidden><span class="server-banner-icon">${icon('players', 18)}</span><div><span class="eyebrow">СЕРВЕР · ИГРА ПО СЕТИ</span><strong id="server-banner-name">Сетевой мир</strong></div><button id="server-join" class="secondary-button">Войти →</button></div>
          <div class="world-choice"><div class="world-choice-icon">${icon('terrain', 24)}</div><div class="world-choice-text"><span class="eyebrow">ПОСЛЕДНИЙ МИР</span><strong id="world-title">Долина истоков</strong><span><span id="world-mode-label">Выживание</span> <b>·</b> сид <span id="seed-label">642018</span></span></div></div>
          <button class="start-button" id="play" disabled><span class="play-icon">${icon('play', 18)}</span><span id="play-label">Создаём твой мир</span><span class="start-arrow">${icon('arrow', 18)}</span></button>
          <div id="loading"><div class="loading-track"><i id="loading-bar"></i></div><div class="loading-caption"><span id="loading-label">Запускаем локальное ядро</span><span id="loading-number">0%</span></div></div>
          <div class="ready-caption" id="ready-caption" hidden><span class="pc-only">Нажми <kbd>Enter</kbd>, чтобы продолжить</span><span class="phone-only">Коснись «Играть», чтобы продолжить</span></div>
          <div class="title-grid">
            <button id="open-worlds" class="title-button">${icon('folder', 18)}<span>Мои миры</span><span id="world-count" class="count-badge">—</span></button>
            <button id="world-settings" class="title-button">${icon('plus', 18)}<span>Новый мир</span></button>
            <button id="open-multiplayer" class="title-button">${icon('players', 18)}<span>Сетевая игра</span></button>
            <button id="open-settings" class="title-button">${icon('settings', 18)}<span>Настройки</span></button>
          </div>
          <div class="device-switch" role="radiogroup" aria-label="Устройство"><span class="device-label">Играю на</span><button role="radio" data-device="pc" aria-checked="true">${icon('screen', 18)}<span>Компьютере</span></button><button role="radio" data-device="phone" aria-checked="false">${icon('phone', 18)}<span>Телефоне</span></button></div>
          <div class="title-links"><button id="about" class="text-button">${icon('help', 12)} Об игре</button><button id="quick-import" class="text-button" title="Импортировать мир из файла" aria-label="Импортировать мир">${icon('upload', 12)} Открыть файл мира</button></div>
        </div>
      </div>
      <footer class="home-footer"><span><i></i> WebCraft ${APP_VERSION} · без аккаунта</span><span class="prototype-note">Автосохранение и экспорт мира</span></footer>
    </section>
    <div id="travel-status" role="status"><span>Переходим в другой мир</span><small>Подготавливаем безопасное прибытие…</small></div>
    <section id="hud" class="hud" hidden>
      <div class="compass" id="compass" aria-hidden="true"><div class="compass-strip" id="compass-strip"></div><i class="compass-needle"></i><span class="compass-caption" id="compass-caption"></span></div>
      <div class="coords" id="coords"></div>
      <div id="boss-bar" role="progressbar" aria-label="Здоровье босса" hidden><div><strong id="boss-name"></strong><span id="boss-health"></span></div><div class="boss-track"><i id="boss-fill"></i></div></div>
      <aside id="journey-card" hidden><span class="eyebrow">ПЕРВЫЕ ШАГИ <b id="journey-count"></b></span><strong id="journey-title"></strong><p id="journey-hint"></p><button id="journey-dismiss" aria-label="Скрыть первые шаги">×</button></aside>
      <div id="action-feedback" aria-live="polite"></div>
      <div id="chat" class="chat"><div id="chat-log" class="chat-log" aria-live="polite"></div><input id="chat-input" class="chat-input" maxlength="200" autocomplete="off" placeholder="Сообщение · Enter — отправить · Esc — закрыть" hidden/></div>
      <div id="online-badge" class="online-badge" hidden>${icon('players', 12)}<span id="online-count">1</span></div>
      <div id="crosshair" class="crosshair"><i></i><i></i><span class="attack-meter" id="attack-meter"><b id="attack-fill"></b></span></div>
      <div class="target-pill" id="target-pill" hidden><span id="target-name"></span><kbd>ЛКМ</kbd><span class="target-action">разрушить</span></div>
      <div id="flight-badge" class="flight-badge" hidden>${icon('flight', 15)} Полёт <kbd data-control="flight">G</kbd></div>
      <div id="fallback-hint" class="fallback-hint" hidden>Для обзора зажми ПКМ · короткий клик ПКМ ставит блок</div>
      <div id="mine-progress" class="mine-progress" hidden><i></i></div>
      <div class="survival-hud" id="survival-hud" hidden>
        <div class="status-line">
          <div class="icon-bar" id="health-bar" aria-label="Здоровье"></div>
          <div class="icon-bar armor-line" id="armor-bar" aria-label="Броня"></div>
        </div>
        <div class="status-line">
          <div class="icon-bar" id="food-bar" aria-label="Голод"></div>
          <div class="icon-bar air-line" id="air-bar" aria-label="Воздух"></div>
        </div>
        <div class="xp-line" id="xp-line">
          <div class="xp-track"><i id="xp-fill"></i></div>
          <span class="xp-level" id="xp-level">0</span>
        </div>
        <div class="effect-line" id="effect-line"></div>
        <div class="use-line" id="use-line" hidden><i id="use-fill"></i><span id="use-label"></span></div>
      </div>
      <div class="damage-flash" id="damage-flash"></div>
      <div class="hotbar-area"><div class="selected-caption"><span id="selected-name" class="selected-name">Пусто</span><span class="palette-key"><kbd data-control="inventory">${BINDINGS.inventory.label}</kbd> Инвентарь · <kbd data-control="drop">Q</kbd> выбросить</span></div><div class="hotbar" id="hotbar"></div><div class="hotbar-hint"><span id="context-action">ЛКМ — добывать · ПКМ — использовать</span> <span>·</span> Колесо — выбрать <span>·</span> <kbd data-control="inventory">${BINDINGS.inventory.label}</kbd> — инвентарь / крафт</div></div>
      <div class="bottom-left"><span><kbd data-movement-keys>W A S D</kbd> ходить <kbd data-control="jump">Space</kbd> прыгать</span><span><kbd data-control="sprint">Ctrl</kbd> бег <kbd data-control="crouch">Shift</kbd> красться <span data-lab-control><kbd data-control="flight">G</kbd> полёт</span></span><span><kbd data-control="inventory">${BINDINGS.inventory.label}</kbd> инвентарь <kbd data-control="drop">Q</kbd> выбросить <span data-lab-control><kbd data-control="palette">P</kbd> палитра</span></span><small><i></i> Мир сохраняется локально</small></div>
      <div class="bottom-right"><span class="coordinates-label">ПОЗИЦИЯ В МИРЕ</span><span id="coordinates">0 / 0 / 0</span><button id="debug-toggle" class="subtle-button"><kbd>F3</kbd> Диагностика</button></div>
    </section>
    <div id="pause-overlay" class="overlay" hidden><section class="modal journal-modal pause-modal" role="dialog" aria-modal="true" aria-labelledby="menu-heading">
      <header class="modal-header"><span class="eyebrow" id="menu-eyebrow">ДНЕВНИК <b>·</b> ПРИВАЛ</span><button class="icon-button" id="close-menu" aria-label="Закрыть меню">${icon('close')}</button></header>
      <h2 id="menu-heading">Привал.</h2><p class="modal-description" id="menu-description">Мир подождёт — время остановлено.</p>
      <nav class="tabs" aria-label="Разделы меню"><button data-tab="game" class="active">Мир</button><button data-tab="settings">Настройки</button><button data-tab="controls">Управление</button></nav>
      <div class="tab-content" data-content="game">
        <div class="menu-world"><div class="mini-landscape">${icon('terrain', 30)}</div><div><strong id="menu-world-name">Долина истоков</strong><span>Собственный генератор · версия ${GENERATOR_VERSION}</span></div><span class="local-label">LOCAL</span></div>
        <button class="primary-button" id="resume">${icon('play', 18)} Вернуться в игру</button>
        <div class="menu-grid"><button class="secondary-button" id="respawn">${icon('reset', 17)} К точке появления</button><button class="secondary-button" id="pause-settings">${icon('settings', 17)} Настройки</button></div>
        <button class="secondary-button" id="menu-home">${icon('back', 17)} Сохранить и выйти в меню</button>
      </div>
      <div class="tab-content" data-content="settings" hidden>
        <div class="settings-group"><div class="settings-section-title">Изображение</div>
          <div class="setting-row"><label for="graphics-quality">Качество<span>Ноутбук — рекомендуемый баланс</span></label><select id="graphics-quality"><option value="economy">Экономичный</option><option value="laptop" selected>Для ноутбука</option><option value="high">Высокое</option></select></div>
          <div class="setting-row"><label for="fps-limit">Ограничение кадров<span>Меньше расход батареи и нагрев</span></label><select id="fps-limit"><option value="30">30 FPS</option><option value="60" selected>60 FPS</option><option value="120">120 FPS</option></select></div>
          <div class="setting-row"><label for="distance">Дальность прорисовки<span>Больше чанков — выше нагрузка</span></label><select id="distance"><option value="2">2 чанка</option><option value="3">3 чанка</option><option value="4" selected>4 чанка</option><option value="5">5 чанков</option><option value="6">6 чанков</option><option value="8">8 чанков</option></select></div>
          <div class="range-heading"><label for="render-scale">Базовый масштаб 3D</label><output id="render-scale-label">100%</output></div><input type="range" id="render-scale" min="60" max="100" step="5" value="100"/>
          <div class="setting-row"><label for="adaptive">Автомасштаб<span>Снижает разрешение под нагрузкой. Интерфейс остаётся чётким</span></label><input id="adaptive" type="checkbox" checked/></div>
          <div class="range-heading"><label for="fov">Поле зрения</label><output id="fov-label">72°</output></div><input type="range" id="fov" min="55" max="100" value="72"/>
          <div class="setting-row"><label for="particles">Частицы<span>Сколы, брызги, дым, попадания и порталы</span></label><input id="particles" type="checkbox" checked/></div>
          <div class="setting-row"><label for="clouds">Облака<span>Один пакет отрисовки на всё небо</span></label><input id="clouds" type="checkbox" checked/></div>
          <div class="setting-row"><label for="far-terrain">Дальние земли<span>Упрощённый рельеф за чанками: горы и берега до горизонта</span></label><select id="far-terrain"><option value="0">Выкл</option><option value="256">256 блоков</option><option value="512">512 блоков</option><option value="1024" selected>1024 блока</option><option value="2048">2048 блоков</option></select></div>
          <div class="setting-row"><label for="shaders">Лёгкие шейдеры<span>Солнечный свет, блики на воде, свечение у горизонта. Почти бесплатно</span></label><input id="shaders" type="checkbox" checked/></div>
          <div class="setting-row"><label for="post">Кинематографичный кадр<span>Свечение солнца, лавы и факелов, виньетка, цвет по времени суток, вода и боль. Один проход поверх кадра</span></label><input id="post" type="checkbox" checked/></div>
        </div>
        <div class="settings-group"><div class="settings-section-title">Персонаж</div>
          <div class="skin-row"><canvas id="settings-avatar" class="avatar-canvas" aria-label="Облик персонажа"></canvas><div class="skin-controls">
            <div class="setting-row"><label for="player-skin">Облик<span>Виден в инвентаре и с камеры от третьего лица (F5)</span></label><select id="player-skin"><option value="traveller">Путник</option><option value="miner">Рудокоп</option><option value="ranger">Следопыт</option><option value="custom">Свой скин</option></select></div>
            <div class="setting-row"><label for="skin-file">Свой скин<span id="skin-file-status">PNG 64×64 или 64×32 в раскладке Minecraft</span></label><label class="text-button file-button">Выбрать PNG<input id="skin-file" type="file" accept="image/png" hidden/></label></div>
            <div class="setting-row"><label for="skin-slim">Тонкие руки<span>Руки в три пикселя, как у модели «Алекс»</span></label><input id="skin-slim" type="checkbox"/></div>
          </div></div>
        </div>
        <div class="settings-group"><div class="settings-section-title">Игра</div>
          <div class="setting-row"><label for="difficulty">Сложность<span>Влияет на голод, урон и враждебных существ</span></label><select id="difficulty"><option value="peaceful">Мирная</option><option value="easy">Легко</option><option value="normal" selected>Обычно</option><option value="hard">Сложно</option></select></div>
          <div class="range-heading"><label for="sensitivity">Чувствительность мыши</label><output id="sensitivity-label">1.0×</output></div><input type="range" id="sensitivity" min="3" max="25" value="10"/>
          <div class="setting-row"><label for="nav-compass">Компас<span>Стороны света, точка возрождения, место гибели и метки (B)</span></label><input id="nav-compass" type="checkbox" checked/></div>
          <div class="setting-row"><label for="nav-coords">Координаты<span>Строка X · Y · Z и направление взгляда</span></label><input id="nav-coords" type="checkbox" checked/></div>
          <div class="setting-row"><label for="show-journey">Первые шаги<span>Ненавязчивые подсказки по выживанию</span></label><input id="show-journey" type="checkbox" checked/></div>
        </div>
        <div class="settings-group"><div class="settings-section-title">Звук и удобство</div>
          <div class="range-heading"><label for="volume">Звуки мира</label><output id="volume-label">35%</output></div><input type="range" id="volume" min="0" max="100" value="35"/>
          <div class="range-heading"><label for="music-volume">Музыка</label><output id="music-volume-label">50%</output></div><input type="range" id="music-volume" min="0" max="100" value="50"/>
          <div class="setting-row"><label for="reduce-motion">Меньше движения<span>Без частиц, покачивания рук, ветра и вспышек</span></label><input id="reduce-motion" type="checkbox"/></div>
        </div>
        <div class="settings-note">${icon('screen', 23)}<p>Управление для компьютера или телефона выбирается на главном экране и в разделе «Управление». Цель совместимости — Java Edition 1.12.2.</p></div>
      </div>
      <div class="tab-content" data-content="controls" hidden>
        <div class="setting-row"><label>Устройство<span>Сенсорные кнопки на экране или клавиатура и мышь</span></label><div class="device-switch compact" role="radiogroup" aria-label="Устройство"><button role="radio" data-device="pc" aria-checked="true">${icon('screen', 18)}<span>ПК</span></button><button role="radio" data-device="phone" aria-checked="false">${icon('phone', 18)}<span>Телефон</span></button></div></div>
        <p class="controls-intro">Нажми на клавишу, чтобы назначить свою. Раскладка языка не влияет на движение.</p>
        <div id="binding-grid" class="binding-grid"></div>
        <p id="binding-status" class="binding-status" role="status" aria-live="polite">Esc — отменить назначение. Цифры 1–9, F3 и Esc зарезервированы.</p>
        <button id="reset-controls" class="text-button">Восстановить клавиши</button>
        <div class="setting-row"><label for="invert-y">Инверсия мыши по Y</label><input id="invert-y" type="checkbox"/></div>
        <div class="setting-row"><label for="toggle-sprint">Бег по нажатию<span>Повторное нажатие выключает бег</span></label><input id="toggle-sprint" type="checkbox"/></div>
        <div class="setting-row"><label for="toggle-crouch">Приседание по нажатию<span>Меню и потеря фокуса сбрасывают оба переключателя</span></label><input id="toggle-crouch" type="checkbox"/></div>
        <div class="control-list"><div><span>Добывать / атаковать</span><kbd>ЛКМ</kbd></div><div><span>Ставить / использовать / есть / натянуть лук</span><kbd>ПКМ</kbd></div><div><span>Слоты / выбрать блок под прицелом</span><kbd>1–9 · колесо / СКМ</kbd></div><div><span>Быстрый перенос в инвентаре</span><kbd>Shift + клик</kbd></div><div><span>Навигация по слотам / взять предмет</span><kbd>Tab / Enter</kbd></div><div><span>Сохранение / диагностика / меню</span><kbd>Ctrl+S / F3 / Esc</kbd></div><div><span>Бег</span><kbd>W дважды · Ctrl</kbd></div><div><span>Скрыть интерфейс / снимок экрана / вид камеры</span><kbd>F1 / F2 / F5</kbd></div></div>
        <p class="warning-text">Без захвата мыши: удерживай ПКМ для обзора, короткий клик — использовать. Еду, лук и щит можно удерживать. Настройки управления сохраняются на этом устройстве.</p>
      </div>
      <footer class="modal-footer"><span>WEBCRAFT <b>·</b> ${APP_VERSION}</span><span id="menu-footer-hint"><kbd>Esc</kbd> закрыть</span></footer>
    </section></div>
    <div id="create-overlay" class="overlay" hidden><section class="modal journal-modal create-modal" role="dialog" aria-modal="true" aria-labelledby="create-heading">
      <header class="modal-header"><span class="eyebrow">ДНЕВНИК <b>·</b> НОВАЯ ЭКСПЕДИЦИЯ</span><button class="icon-button" id="close-create" aria-label="Закрыть">${icon('close')}</button></header>
      <h2 id="create-heading">Новый мир.</h2><p class="modal-description">Текущий мир сохранится и останется в «Моих мирах».</p>
      <div class="world-config">
        <label for="new-world-name">Название</label><input id="new-world-name" maxlength="64" value="Мой новый мир" aria-label="Имя нового мира"/>
        <label>Режим игры</label>
        <div class="mode-cards" role="radiogroup" aria-label="Режим игры"><button role="radio" data-mode-card="survival" aria-checked="true">${icon('heart', 18)}<strong>Выживание</strong><span>Добыча, голод и опасности</span></button><button role="radio" data-mode-card="creative" aria-checked="false">${icon('cube', 18)}<strong>Творчество</strong><span>Все блоки, полёт, без урона</span></button></div>
        <select id="game-mode" hidden aria-hidden="true"><option value="survival">Выживание</option><option value="creative">Творчество</option><option value="lab">Лаборатория</option></select>
        <label for="preset">Вариант мира</label><select id="preset"><option value="overworld">Обычный мир</option><option value="large-biomes">Крупные биомы</option><option value="amplified">Усиленный рельеф</option><option value="valley">Долина истоков</option><option value="flat">Плоский мир</option></select>
        <label for="seed-input">Сид мира <span class="label-hint">— одинаковый сид даёт одинаковый мир</span></label><div class="seed-row"><input id="seed-input" maxlength="64" value="642018" autocomplete="off" spellcheck="false"/><button id="random-seed" title="Случайный сид" aria-label="Случайный сид">${icon('reset', 18)}</button></div>
      </div>
      <button class="primary-button" id="regenerate">${icon('plus', 18)} Создать мир</button>
    </section></div>
    <div id="multiplayer-overlay" class="overlay" hidden><section class="modal journal-modal multiplayer-modal" role="dialog" aria-modal="true" aria-labelledby="mp-heading">
      <header class="modal-header"><span class="eyebrow">ДНЕВНИК <b>·</b> СЕТЕВАЯ ИГРА</span><button class="icon-button" id="close-multiplayer" aria-label="Закрыть">${icon('close')}</button></header>
      <h2 id="mp-heading">Сетевая игра.</h2><p class="modal-description">Подключение по IP и порту — в локальной сети, через Radmin VPN или Hamachi.</p>
      <div class="mp-body" id="mp-body">
        <label for="mp-name">Твоё имя в игре</label><input id="mp-name" maxlength="16" autocomplete="nickname" spellcheck="false" placeholder="Например, Стив"/>
        <div class="mp-row"><div class="mp-host"><label for="mp-host">IP-адрес сервера</label><input id="mp-host" autocomplete="off" spellcheck="false" placeholder="26.123.45.67"/></div><div class="mp-port"><label for="mp-port">Порт</label><input id="mp-port" inputmode="numeric" maxlength="5" value="25565"/></div></div>
        <button class="primary-button" id="mp-connect">${icon('players', 18)} Подключиться</button>
        <p id="mp-status" class="mp-status" role="status" aria-live="polite"></p>
        <div id="mp-host-info" class="mp-host-info" hidden></div>
        <details class="mp-help"><summary>${icon('help', 12)} Как открыть свой мир для друзей</summary><ol>
          <li>Установи <b>Node.js 20</b> или новее — nodejs.org.</li>
          <li>Возьми файл <code>webcraft-server-${APP_VERSION}.mjs</code> из папки <code>releases</code>.</li>
          <li>Запусти в папке с ним: <code>node webcraft-server-${APP_VERSION}.mjs</code> (порт по умолчанию 25565).</li>
          <li>Включи <b>Radmin VPN</b> или <b>Hamachi</b> и зайди с друзьями в одну сеть.</li>
          <li>Дай друзьям свой IP из Radmin/Hamachi и порт. Они открывают <code>http://IP:25565</code> в браузере — или вводят IP здесь.</li>
          <li>Сам играешь в браузере по адресу <code>http://localhost:25565</code>.</li>
        </ol></details>
      </div>
    </section></div>
    <div id="about-overlay" class="overlay" hidden><section class="modal journal-modal about-modal" role="dialog" aria-modal="true" aria-labelledby="about-heading">
      <header class="modal-header"><span class="eyebrow">ДНЕВНИК <b>·</b> ОБ ИГРЕ</span><button class="icon-button" id="close-about" aria-label="Закрыть">${icon('close')}</button></header>
      <h2 id="about-heading">WebCraft.</h2><p class="modal-description">Песочница из блоков, которая целиком работает в браузере.</p>
      <div class="about-list"><div>${icon('cube', 18)}<span>Мир из чанков: биомы, пещеры, деревни, храмы и шахты</span></div><div>${icon('sword', 18)}<span>Выживание, творчество, Незер и Энд</span></div><div>${icon('save', 18)}<span>Миры хранятся в этом браузере. Экспорт — в «Моих мирах»</span></div><div>${icon('players', 18)}<span>Сетевая игра по IP с друзьями</span></div></div>
      <div class="confirm-buttons"><button class="secondary-button" id="about-debug">${icon('report', 16)} Диагностика</button><button class="primary-button" id="about-ok">Понятно</button></div>
    </section></div>
    <div id="palette-overlay" class="overlay" hidden><section class="modal stone-modal palette-modal" role="dialog" aria-modal="true" aria-labelledby="palette-heading"><header class="modal-header"><span class="eyebrow">МАТЕРИАЛЫ ДЛЯ ПЕРВЫХ ИДЕЙ</span><button class="icon-button" id="close-palette" aria-label="Закрыть палитру">${icon('close')}</button></header><h2 id="palette-heading">Палитра предметов.</h2><p class="modal-description">Выбранный предмет попадёт в активный слот. Это тестовый инструмент сборки, а не обычная игра.</p><div class="palette-grid" id="palette-grid"></div><footer class="modal-footer"><span>Тестовая палитра: предмет попадает в активный слот</span><kbd>P / Esc</kbd></footer></section></div>
    <aside id="debug" class="debug-panel" hidden><header><span>${icon('cube', 16)} Снимок системы</span><button class="icon-button" id="close-debug" aria-label="Скрыть диагностику">${icon('close', 15)}</button></header><div class="debug-build">GRAPHICS 009 <span id="debug-state">PAUSED</span></div><div class="debug-metrics" id="debug-metrics"></div><div class="debug-actions"><button id="step-tick">+1 такт</button><button id="download-report">${icon('report', 14)} Отчёт</button></div><p>Рендер — в окне. Симуляция и геометрия — в Worker. Это тест ядра, не проверка полной совместимости.</p></aside>
    <div id="death-overlay" class="overlay death-overlay" hidden><section class="modal death-modal" role="alertdialog" aria-modal="true" aria-labelledby="death-title">
      <h2 id="death-title">Ты погиб!</h2>
      <p class="modal-description" id="death-cause">Инвентарь выпал там, где ты погиб.</p>
      <div class="death-stats" id="death-stats"></div>
      <button class="primary-button" id="respawn-button">Возродиться</button>
      <p class="warning-text">Точка возрождения: <span id="death-spawn">точка появления мира</span></p>
    </section></div>
    <div id="panel-overlay" class="overlay panel-overlay" hidden><section class="modal stone-modal panel-modal" role="dialog" aria-modal="true" aria-labelledby="panel-title">
      <header class="modal-header"><span class="eyebrow" id="panel-eyebrow">ИНВЕНТАРЬ И КОНТЕЙНЕРЫ</span><button class="icon-button" id="close-panel" aria-label="Закрыть интерфейс">${icon('close')}</button></header>
      <h2 id="panel-title">Инвентарь</h2>
      <div class="panel-body">
        <div class="panel-main">
          <div class="panel-block" id="panel-container-block" hidden><span class="panel-label" id="panel-container-label">Сундук</span><div class="slot-grid" id="panel-container"></div></div>
          <div class="panel-block" id="panel-furnace-block" hidden>
            <span class="panel-label">Печь</span>
            <div class="furnace-row"><div class="slot-cell" data-slot-id="container" data-slot-index="0"></div><div class="furnace-gauge" id="furnace-gauge"><i id="furnace-flame"></i><span id="furnace-status">Нет топлива</span><b id="furnace-cook"></b></div><div class="slot-cell" data-slot-id="container" data-slot-index="2"></div></div>
            <div class="furnace-row"><div class="slot-cell" data-slot-id="container" data-slot-index="1"></div><span class="panel-note">Топливо: уголь, доски, палки…</span></div>
          </div>
          <div class="panel-block" id="panel-station-block" hidden>
            <div id="station-enchant">
              <span class="panel-label">Стол зачарований <em id="enchant-levels">0 уровней</em> · лазурит: <em id="enchant-lapis">0</em></span>
              <div class="station-row"><div class="slot-cell" data-slot-id="grid" data-slot-index="0" id="enchant-slot"></div><span class="panel-note">Положи инструмент, броню или лук</span></div>
              <div class="offer-list" id="enchant-offers"></div>
            </div>
            <div id="station-trade" hidden>
              <span class="panel-label">Предложения <em id="trade-note">изумруды — валюта деревни</em></span>
              <div class="offer-list trade-list" id="trade-offers"></div>
            </div>
            <div id="station-brew" hidden>
              <span class="panel-label">Варочная стойка <em id="brew-status">Пусто</em></span>
              <div class="brew-row">
                <div class="slot-cell" data-slot-id="station" data-slot-index="0" id="brew-ingredient"></div>
                <div class="brew-bottles" id="brew-bottles"></div>
                <div class="slot-cell" data-slot-id="station" data-slot-index="4" id="brew-powder"></div>
              </div>
              <div class="brew-track"><i id="brew-fill"></i></div>
              <div class="station-buttons"><button id="brew-load" class="text-button">Загрузить воду и порошок</button><button id="brew-take" class="text-button">Забрать зелья</button></div>
            </div>
            <div id="station-anvil" hidden>
              <span class="panel-label">Наковальня <em id="anvil-status">Нужны два предмета</em></span>
              <div class="station-row">
                <div class="slot-cell" data-slot-id="grid" data-slot-index="0" id="anvil-first"></div>
                <span class="craft-arrow">${icon('arrow', 18)}</span>
                <div class="slot-cell" data-slot-id="grid" data-slot-index="1" id="anvil-second"></div>
                <span class="craft-arrow">${icon('arrow', 18)}</span>
                <div class="slot-cell result-cell" data-slot-id="anvil" data-slot-index="0" id="anvil-result"></div>
              </div>
              <div class="station-buttons"><button id="anvil-take" class="text-button">Забрать за <em id="anvil-cost">1</em> уровень</button></div>
            </div>
          </div>
          <div class="panel-block creative-block" id="panel-creative-block" hidden>
            <div class="creative-tabs" id="creative-tabs" role="tablist" aria-label="Разделы творческого каталога"></div>
            <div class="creative-head"><span class="panel-label" id="creative-title">Строительные блоки</span><input id="creative-search" placeholder="Поиск предметов" autocomplete="off" spellcheck="false" aria-label="Поиск предметов"/><div class="slot-cell trash-cell" id="creative-trash" role="button" tabindex="0" aria-label="Корзина" data-tip="Удалить предмет" data-tip-sub="Shift — очистить весь инвентарь">${icon('trash', 20)}</div></div>
            <div class="slot-grid creative-grid" id="creative-grid"></div>
          </div>
          <div class="panel-block" id="panel-crafting-block" hidden>
            <span class="panel-label">Крафт <em id="craft-size">2×2</em></span>
            <div class="craft-row"><div class="slot-grid craft-grid" id="craft-grid"></div><span class="craft-arrow">${icon('arrow', 18)}</span><div class="slot-cell result-cell" data-slot-id="result" data-slot-index="0" id="craft-result"></div></div>
          </div>
          <div class="panel-block"><span class="panel-label">Инвентарь <em>36 слотов</em> · 4 слота брони · левая рука для щита</span>
            <div class="player-body">
              <div class="slot-grid armor-grid" id="player-armor"></div>
              <canvas id="inventory-avatar" class="avatar-canvas" aria-hidden="true"></canvas>
              <div class="player-column"><div class="slot-grid player-grid" id="player-main"></div><div class="slot-grid hotbar-grid" id="player-hotbar"></div></div>
            </div>
          </div>
        </div>
        <aside class="panel-recipes">
          <div class="recipes-head"><span>Книга рецептов</span><span id="recipe-count">0</span></div>
          <input id="recipe-search" placeholder="Поиск по названию" autocomplete="off" spellcheck="false"/>
          <label class="recipe-filter"><input type="checkbox" id="recipe-filter"/> Только доступные</label>
          <div class="recipe-list" id="recipe-list"></div>
        </aside>
      </div>
      <footer class="modal-footer"><span id="panel-hint">ЛКМ — взять · ПКМ — половину · Shift — перенести · 1–9 — в слот</span><kbd>E / Esc</kbd></footer>
    </section></div>
    <div id="cursor-item" class="cursor-item" hidden></div>
    <div id="toast" class="toast" role="status" hidden></div>
    <div id="slot-tip" class="slot-tip" role="tooltip" hidden></div>
    <div id="fatal" class="fatal" hidden><div><span class="eyebrow">НЕ ПОЛУЧИЛОСЬ ЗАПУСТИТЬ МИР</span><h2>Нужен WebGL 2.</h2><p id="fatal-message"></p><button id="fatal-retry" class="primary-button">Попробовать снова</button></div></div>
  `;
}
