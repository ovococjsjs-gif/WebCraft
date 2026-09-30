import { icon } from '@ui/icons';

/** What the on-screen controls ask the game to do; the page wires these to the same commands
 * the keyboard and mouse send, so a phone and a computer play by exactly the same rules. */
export interface TouchActions {
  look(dx: number, dy: number): void;
  mine(active: boolean): void;
  use(): void;
  hold(active: boolean): void;
  holdsUse(): boolean;
  jumpTap(): void;
  inventory(): void;
  pause(): void;
  drop(): void;
  chat(): void;
  changed(): void;
}
export interface TouchMove {
  forward: number;
  strafe: number;
  jump: boolean;
  crouch: boolean;
  sprint: boolean;
}

/** A tap shorter than this, which barely moved, uses the item; a longer press breaks. */
const TAP_MS = 260;
const TAP_SLOP = 12;
const STICK_RADIUS = 56;
/** Touch look turns more per pixel than a mouse: a thumb covers a small distance. */
const LOOK_GAIN = 2.2;

interface LookTouch {
  id: number;
  x: number;
  y: number;
  start: number;
  moved: number;
  mining: boolean;
  timer: number;
}

/**
 * Phone controls in the manner of the pocket edition: a floating stick on the left half, look by
 * dragging anywhere else, hold on the world to break, tap to place or use, and a thumb cluster for
 * jumping, sneaking and the two actions for those who prefer explicit buttons.
 */
export class TouchControls {
  readonly root: HTMLElement;
  private enabled = false;
  private stick: { id: number; ox: number; oy: number; dx: number; dy: number } | null = null;
  private looks = new Map<number, LookTouch>();
  private jump = false;
  private crouch = false;
  private buttonTouches = new Map<number, HTMLElement>();
  private readonly knob: HTMLElement;
  private readonly base: HTMLElement;

  constructor(
    private readonly surface: HTMLElement,
    private readonly actions: TouchActions,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'touch-controls';
    this.root.className = 'touch-controls';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="touch-stick" aria-hidden="true"><div class="touch-stick-base"></div><div class="touch-stick-knob"></div></div>
      <div class="touch-top">
        <button class="touch-button small online-only" data-touch="chat" aria-label="Чат">${icon('edit', 18)}</button>
        <button class="touch-button small" data-touch="drop" aria-label="Выбросить предмет">${icon('upload', 18)}</button>
        <button class="touch-button small" data-touch="inventory" aria-label="Инвентарь">${icon('cube', 18)}</button>
        <button class="touch-button small" data-touch="pause" aria-label="Меню">${icon('pause', 18)}</button>
      </div>
      <div class="touch-cluster">
        <button class="touch-button action" data-touch="use" aria-label="Поставить или использовать"><span class="touch-glyph">${icon('plus', 24)}</span><small>Ставить</small></button>
        <button class="touch-button action" data-touch="mine" aria-label="Ломать или бить"><span class="touch-glyph">${icon('sword', 24)}</span><small>Бить</small></button>
        <button class="touch-button round" data-touch="crouch" aria-label="Присесть" aria-pressed="false"><span class="touch-glyph">${icon('arrow', 24)}</span></button>
        <button class="touch-button round big" data-touch="jump" aria-label="Прыжок"><span class="touch-glyph">${icon('arrow', 24)}</span></button>
      </div>
      <div class="touch-hint" id="touch-hint">Левая половина — идти · тяни по экрану — смотреть · удерживай — ломать · коснись — ставить</div>`;
    surface.after(this.root);
    this.base = this.root.querySelector('.touch-stick-base')!;
    this.knob = this.root.querySelector('.touch-stick-knob')!;
    const opts = { passive: false } as const;
    surface.addEventListener('touchstart', (e) => this.worldStart(e), opts);
    window.addEventListener('touchmove', (e) => this.move(e), opts);
    window.addEventListener('touchend', (e) => this.end(e), opts);
    window.addEventListener('touchcancel', (e) => this.end(e), opts);
    this.root.addEventListener('touchstart', (e) => this.buttonStart(e), opts);
    // Buttons also answer mouse clicks, so the layout can be tried on a computer.
    this.root.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-touch]');
      if (!b || (e as PointerEvent).pointerType === 'touch') return;
      this.press(b.dataset.touch!, true);
      this.press(b.dataset.touch!, false);
    });
  }

  get active() {
    return this.enabled;
  }
  setEnabled(on: boolean) {
    this.enabled = on;
    this.root.hidden = !on;
    if (!on) this.reset();
  }
  /** Shown only while playing: menus and the inventory keep the screen to themselves. */
  setVisible(visible: boolean) {
    const shown = visible && this.enabled;
    if (shown === this.root.classList.contains('shown')) return;
    this.root.classList.toggle('shown', shown);
    if (!shown) this.reset();
  }
  reset() {
    for (const t of this.looks.values()) {
      clearTimeout(t.timer);
      if (t.mining) this.actions.mine(false);
    }
    this.looks.clear();
    this.stick = null;
    this.jump = false;
    for (const el of this.buttonTouches.values()) this.release(el);
    this.buttonTouches.clear();
    this.root.classList.remove('stick-active');
  }
  read(): TouchMove {
    let forward = 0,
      strafe = 0,
      sprint = false;
    if (this.stick) {
      const len = Math.hypot(this.stick.dx, this.stick.dy);
      const k = Math.min(1, len / STICK_RADIUS);
      if (k > 0.25) {
        // Eight-way like keys, but a full push forward runs, as sprinting does on the pocket edition.
        const a = Math.atan2(this.stick.dx, -this.stick.dy);
        forward = Math.round(Math.cos(a) * 1.2) === 0 ? 0 : Math.sign(Math.cos(a));
        strafe = Math.round(Math.sin(a) * 1.2) === 0 ? 0 : Math.sign(Math.sin(a));
        sprint = forward > 0 && strafe === 0 && k > 0.97 && len > STICK_RADIUS * 1.15;
      }
    }
    return { forward, strafe, jump: this.jump, crouch: this.crouch, sprint };
  }

  private worldStart(e: TouchEvent) {
    if (!this.enabled || !this.root.classList.contains('shown')) return;
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.clientX < window.innerWidth * 0.4 && !this.stick) {
        this.stick = { id: t.identifier, ox: t.clientX, oy: t.clientY, dx: 0, dy: 0 };
        this.root.classList.add('stick-active');
        this.base.style.transform = `translate(${t.clientX}px, ${t.clientY}px)`;
        this.knob.style.transform = `translate(${t.clientX}px, ${t.clientY}px)`;
        this.actions.changed();
        continue;
      }
      const look: LookTouch = {
        id: t.identifier,
        x: t.clientX,
        y: t.clientY,
        start: performance.now(),
        moved: 0,
        mining: false,
        timer: 0,
      };
      // Holding still on the world starts breaking, as a held mouse button does.
      look.timer = window.setTimeout(() => {
        if (look.moved < TAP_SLOP && this.looks.get(look.id) === look) {
          look.mining = true;
          this.actions.mine(true);
        }
      }, TAP_MS);
      this.looks.set(t.identifier, look);
    }
  }
  private move(e: TouchEvent) {
    if (!this.enabled) return;
    let handled = false;
    for (const t of Array.from(e.changedTouches)) {
      if (this.stick?.id === t.identifier) {
        this.stick.dx = t.clientX - this.stick.ox;
        this.stick.dy = t.clientY - this.stick.oy;
        const len = Math.hypot(this.stick.dx, this.stick.dy);
        const k = len > STICK_RADIUS ? STICK_RADIUS / len : 1;
        this.knob.style.transform = `translate(${this.stick.ox + this.stick.dx * k}px, ${this.stick.oy + this.stick.dy * k}px)`;
        this.actions.changed();
        handled = true;
        continue;
      }
      const look = this.looks.get(t.identifier);
      if (look) {
        const dx = t.clientX - look.x,
          dy = t.clientY - look.y;
        look.moved += Math.hypot(dx, dy);
        look.x = t.clientX;
        look.y = t.clientY;
        this.actions.look(dx * LOOK_GAIN, dy * LOOK_GAIN);
        handled = true;
      }
    }
    if (handled) e.preventDefault();
  }
  private end(e: TouchEvent) {
    if (!this.enabled) return;
    for (const t of Array.from(e.changedTouches)) {
      if (this.stick?.id === t.identifier) {
        this.stick = null;
        this.root.classList.remove('stick-active');
        this.actions.changed();
      }
      const look = this.looks.get(t.identifier);
      if (look) {
        clearTimeout(look.timer);
        this.looks.delete(t.identifier);
        if (look.mining) this.actions.mine(false);
        else if (look.moved < TAP_SLOP && performance.now() - look.start < TAP_MS)
          this.actions.use();
      }
      const button = this.buttonTouches.get(t.identifier);
      if (button) {
        this.buttonTouches.delete(t.identifier);
        this.release(button);
      }
    }
  }
  private buttonStart(e: TouchEvent) {
    for (const t of Array.from(e.changedTouches)) {
      const b = (t.target as Element | null)?.closest?.<HTMLElement>('[data-touch]');
      if (!b) continue;
      e.preventDefault();
      this.buttonTouches.set(t.identifier, b);
      b.classList.add('down');
      this.press(b.dataset.touch!, true);
    }
  }
  private release(b: HTMLElement) {
    b.classList.remove('down');
    this.press(b.dataset.touch!, false);
  }
  private press(kind: string, down: boolean) {
    switch (kind) {
      case 'jump':
        this.jump = down;
        if (down) this.actions.jumpTap();
        this.actions.changed();
        break;
      case 'crouch':
        if (down) {
          this.crouch = !this.crouch;
          this.root
            .querySelector('[data-touch="crouch"]')!
            .setAttribute('aria-pressed', String(this.crouch));
          this.actions.changed();
        }
        break;
      case 'mine':
        this.actions.mine(down);
        break;
      case 'use':
        if (down) {
          this.actions.use();
          if (this.actions.holdsUse()) this.actions.hold(true);
        } else this.actions.hold(false);
        break;
      case 'inventory':
        if (down) this.actions.inventory();
        break;
      case 'pause':
        if (down) this.actions.pause();
        break;
      case 'drop':
        if (down) this.actions.drop();
        break;
      case 'chat':
        if (down) this.actions.chat();
        break;
    }
  }
}
