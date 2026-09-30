/** Physical codes work with a Russian keyboard layout too. Labels and handling share this model. */
export const CONTROL_ACTIONS = {
  forward: { title: 'Вперёд', codes: ['KeyW', 'ArrowUp'] },
  backward: { title: 'Назад', codes: ['KeyS', 'ArrowDown'] },
  left: { title: 'Влево', codes: ['KeyA', 'ArrowLeft'] },
  right: { title: 'Вправо', codes: ['KeyD', 'ArrowRight'] },
  jump: { title: 'Прыжок / вверх', codes: ['Space'] },
  sprint: { title: 'Бег', codes: ['ControlLeft', 'ControlRight'] },
  crouch: { title: 'Красться / вниз', codes: ['ShiftLeft', 'ShiftRight'] },
  inventory: { title: 'Инвентарь / крафт', codes: ['KeyE', 'KeyF'] },
  drop: { title: 'Выбросить предмет', codes: ['KeyQ'] },
  flight: { title: 'Полёт (не в выживании)', codes: ['KeyG'] },
  palette: { title: 'Палитра (не в выживании)', codes: ['KeyP'] },
  respawn: { title: 'Возврат (лаборатория)', codes: ['KeyR'] },
  waypoint: { title: 'Поставить / снять метку', codes: ['KeyB'] },
} as const;
export type ControlAction = keyof typeof CONTROL_ACTIONS;
export interface ControlSettings {
  bindings: Partial<Record<ControlAction, string>>;
  invertY: boolean;
  toggleSprint: boolean;
  toggleCrouch: boolean;
}
export const DEFAULT_CONTROLS: ControlSettings = {
  bindings: {},
  invertY: false,
  toggleSprint: false,
  toggleCrouch: false,
};
const allowed = (code: unknown): code is string =>
  typeof code === 'string' &&
  /^(Key[A-Z]|Space|ShiftLeft|ShiftRight|ControlLeft|ControlRight|AltLeft|AltRight|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Backquote|Minus|Equal|BracketLeft|BracketRight|Semicolon|Quote|Backslash|Comma|Period|Slash)$/.test(
    code,
  );
export function keyLabel(code: string) {
  return (
    (
      {
        Space: 'Space',
        ShiftLeft: 'Shift',
        ShiftRight: 'R Shift',
        ControlLeft: 'Ctrl',
        ControlRight: 'R Ctrl',
        AltLeft: 'Alt',
        AltRight: 'R Alt',
        ArrowUp: '↑',
        ArrowDown: '↓',
        ArrowLeft: '←',
        ArrowRight: '→',
        Backquote: '`',
        Minus: '−',
        Equal: '=',
        BracketLeft: '[',
        BracketRight: ']',
        Semicolon: ';',
        Quote: "'",
        Backslash: '\\',
        Comma: ',',
        Period: '.',
        Slash: '/',
      } as Record<string, string>
    )[code] ?? code.replace(/^Key/, '')
  );
}
export class ControlScheme {
  settings: ControlSettings = { ...DEFAULT_CONTROLS, bindings: {} };
  private sprint = false;
  private crouch = false;
  /** Double-tapping forward starts a sprint, as in the reference; it lasts while forward is held. */
  private tapSprint = false;
  private lastForward = -Infinity;
  constructor(value?: Partial<ControlSettings>) {
    if (value) {
      this.settings.invertY = value.invertY === true;
      this.settings.toggleSprint = value.toggleSprint === true;
      this.settings.toggleCrouch = value.toggleCrouch === true;
      for (const action of Object.keys(CONTROL_ACTIONS) as ControlAction[]) {
        const code = value.bindings?.[action];
        if (allowed(code)) this.bind(action, code);
      }
    }
  }
  codes(action: ControlAction): readonly string[] {
    const primary = this.settings.bindings[action];
    if (!primary || primary === CONTROL_ACTIONS[action].codes[0])
      return CONTROL_ACTIONS[action].codes;
    if (primary.endsWith('Left')) return [primary, primary.replace('Left', 'Right')];
    return [primary];
  }
  isBound(code: string) {
    return (Object.keys(CONTROL_ACTIONS) as ControlAction[]).some((a) => this.matches(a, code));
  }
  matches(action: ControlAction, code: string) {
    return this.codes(action).includes(code);
  }
  primary(action: ControlAction) {
    return this.settings.bindings[action] ?? CONTROL_ACTIONS[action].codes[0];
  }
  label(action: ControlAction) {
    return [
      ...new Set(
        this.codes(action).map((c) => keyLabel(c.replace(/^(Shift|Control)Right$/, '$1Left'))),
      ),
    ].join(' / ');
  }
  bind(action: ControlAction, code: string): { ok: boolean; swapped?: ControlAction } {
    if (!allowed(code)) return { ok: false };
    const old = this.primary(action);
    const conflict = (Object.keys(CONTROL_ACTIONS) as ControlAction[]).find(
      (a) => a !== action && this.matches(a, code),
    );
    if (conflict) this.settings.bindings[conflict] = old;
    this.settings.bindings[action] = code;
    this.reset();
    return { ok: true, swapped: conflict };
  }
  held(action: ControlAction, keys: ReadonlySet<string>) {
    return this.codes(action).some((c) => keys.has(c));
  }
  keyDown(code: string, repeat = false, now = performance.now()) {
    if (repeat) return;
    if (this.matches('forward', code)) {
      if (now - this.lastForward < 280) this.tapSprint = true;
      this.lastForward = now;
    }
    if (this.settings.toggleSprint && this.matches('sprint', code)) this.sprint = !this.sprint;
    if (this.settings.toggleCrouch && this.matches('crouch', code)) this.crouch = !this.crouch;
  }
  read(keys: ReadonlySet<string>) {
    if (this.tapSprint && !this.held('forward', keys)) this.tapSprint = false;
    return {
      forward: Number(this.held('forward', keys)) - Number(this.held('backward', keys)),
      strafe: Number(this.held('right', keys)) - Number(this.held('left', keys)),
      jump: this.held('jump', keys),
      sprint:
        (this.settings.toggleSprint ? this.sprint : this.held('sprint', keys)) || this.tapSprint,
      crouch: this.settings.toggleCrouch ? this.crouch : this.held('crouch', keys),
    };
  }
  reset() {
    this.sprint = this.crouch = this.tapSprint = false;
  }
  defaults() {
    this.settings = { ...DEFAULT_CONTROLS, bindings: {} };
    this.reset();
  }
}
/** Trackpad deltas accumulate; zero/horizontal scroll does not mysteriously change a slot. */
export class WheelSelector {
  private sum = 0;
  private last = -Infinity;
  reset() {
    this.sum = 0;
    this.last = -Infinity;
  }
  step(deltaY: number, deltaMode: number, now: number): number {
    if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
    const delta = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 100 : 1);
    if (Math.sign(delta) !== Math.sign(this.sum)) this.sum = 0;
    this.sum += delta;
    if (now - this.last < 90 || Math.abs(this.sum) < 40) return 0;
    const step = Math.sign(this.sum);
    this.sum = 0;
    this.last = now;
    return step;
  }
}
