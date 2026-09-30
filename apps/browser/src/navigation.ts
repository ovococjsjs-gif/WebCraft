import type { SimulationSnapshot } from '@core/simulation';
import { $ } from '@ui/ui';

/**
 * Finding the way back: a compass strip across the top of the screen with the respawn point,
 * the place of the last death and up to nine of the player's own marks (B), the villages nearby, plus an optional
 * coordinates line. Marks and the death point belong to one world and one dimension and live on
 * this device, like the other client preferences; the world save format stays untouched.
 */
interface Mark {
  x: number;
  y: number;
  z: number;
  dim: string;
  n: number;
}
interface Stored {
  marks: Mark[];
  death: Omit<Mark, 'n'> | null;
}
interface Prefs {
  compass: boolean;
  coords: boolean;
}
type MarkerKind = 'home' | 'death' | 'mark' | 'village';

const PREFS = 'voxel:navigation';
const MARK_COLORS = [
  '#ffd257',
  '#6fd3ff',
  '#9cff6f',
  '#ff8fd8',
  '#ffa45c',
  '#c4a7ff',
  '#6fffd2',
  '#ff6f6f',
  '#ffffff',
];
const MAX_MARKS = 9;
/** The strip shows half a turn; its width is set in CSS. */
const SPAN = Math.PI / 2;
const CARDINALS: [number, string][] = [
  [0, 'С'],
  [Math.PI / 4, 'СЗ'],
  [Math.PI / 2, 'З'],
  [(3 * Math.PI) / 4, 'ЮЗ'],
  [Math.PI, 'Ю'],
  [(-3 * Math.PI) / 4, 'ЮВ'],
  [-Math.PI / 2, 'В'],
  [-Math.PI / 4, 'СВ'],
];
const SIDE = [
  'Север',
  'Северо-запад',
  'Запад',
  'Юго-запад',
  'Юг',
  'Юго-восток',
  'Восток',
  'Северо-восток',
];

const wrap = (a: number) => {
  a = (a + Math.PI) % (Math.PI * 2);
  return (a < 0 ? a + Math.PI * 2 : a) - Math.PI;
};
/** Yaw of a horizontal direction; yaw 0 looks along −z (north), positive yaw turns left (west). */
export const bearing = (dx: number, dz: number) => Math.atan2(-dx, -dz);
/** Where a bearing lands on the strip, −1 (left edge) … 1 (right edge), or null when behind. */
export function stripOffset(target: number, yaw: number): number | null {
  const rel = wrap(target - yaw);
  return Math.abs(rel) > SPAN ? null : -rel / SPAN;
}

function loadPrefs(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Partial<Prefs>;
    return { compass: v.compass !== false, coords: v.coords !== false };
  } catch {
    return { compass: true, coords: true };
  }
}

export class Navigation {
  private prefs = loadPrefs();
  private worldKey = '';
  private data: Stored = { marks: [], death: null };
  private readonly strip = $('#compass-strip');
  private readonly caption = $('#compass-caption');
  private readonly coords = $('#coords');
  private readonly ticks: { el: HTMLElement; at: number }[] = [];
  private readonly markers: HTMLElement[] = [];
  private lastKey = '';
  constructor() {
    for (let d = 0; d < 24; d++) {
      const at = wrap((d * Math.PI) / 12);
      const card = CARDINALS.find(([a]) => Math.abs(wrap(a - at)) < 1e-6);
      const el = document.createElement('span');
      el.className = card
        ? card[1].length === 1
          ? 'tick cardinal'
          : 'tick minor-cardinal'
        : 'tick';
      el.textContent = card ? card[1] : '';
      this.strip.append(el);
      this.ticks.push({ el, at });
    }
    this.applyPrefs();
  }
  /** Loads the marks of a world (key = world id or seed). */
  open(worldKey: string) {
    this.worldKey = `voxel:marks:${worldKey}`;
    this.data = { marks: [], death: null };
    try {
      const v = JSON.parse(localStorage.getItem(this.worldKey) ?? 'null') as Stored | null;
      if (v && Array.isArray(v.marks))
        this.data = { marks: v.marks.slice(0, MAX_MARKS), death: v.death ?? null };
    } catch {
      /* A damaged record: start without marks. */
    }
    this.lastKey = '';
  }
  private save() {
    if (!this.worldKey) return;
    try {
      localStorage.setItem(this.worldKey, JSON.stringify(this.data));
    } catch {
      /* Marks stay for this session. */
    }
  }
  get settings(): Readonly<Prefs> {
    return this.prefs;
  }
  setPrefs(next: Partial<Prefs>) {
    this.prefs = { ...this.prefs, ...next };
    try {
      localStorage.setItem(PREFS, JSON.stringify(this.prefs));
    } catch {
      /* In memory only. */
    }
    this.applyPrefs();
  }
  private applyPrefs() {
    document.body.dataset.compass = this.prefs.compass ? 'on' : 'off';
    this.coords.hidden = !this.prefs.coords;
    this.lastKey = '';
  }
  /** Remembers where the player died; walking back within three blocks clears the marker. */
  observe(state: SimulationSnapshot, wasDead: boolean | undefined) {
    const p = state.player.position,
      dim = state.dimension ?? 'overworld';
    if (state.survival.dead && !wasDead) {
      this.data.death = { x: Math.round(p.x), y: Math.floor(p.y), z: Math.round(p.z), dim };
      this.save();
    }
    const d = this.data.death;
    if (d && !state.survival.dead && d.dim === dim && Math.hypot(d.x - p.x, d.z - p.z) < 3) {
      this.data.death = null;
      this.save();
    }
  }
  /** B: a mark at the feet, or removes the nearest mark within four blocks. Returns a toast. */
  toggleMark(state: SimulationSnapshot): string {
    const p = state.player.position,
      dim = state.dimension ?? 'overworld';
    const near = this.data.marks.find(
      (m) => m.dim === dim && Math.hypot(m.x - p.x, m.y - p.y, m.z - p.z) < 4,
    );
    if (near) {
      this.data.marks = this.data.marks.filter((m) => m !== near);
      this.save();
      this.lastKey = '';
      return `Метка ${near.n} снята`;
    }
    if (this.data.marks.length >= MAX_MARKS)
      return `Не больше ${MAX_MARKS} меток: подойди к старой и нажми ещё раз, чтобы снять`;
    const used = new Set(this.data.marks.map((m) => m.n));
    let n = 1;
    while (used.has(n)) n++;
    this.data.marks.push({
      x: Math.floor(p.x) + 0.5,
      y: Math.floor(p.y),
      z: Math.floor(p.z) + 0.5,
      dim,
      n,
    });
    this.save();
    this.lastKey = '';
    return `Метка ${n} поставлена · X ${Math.floor(p.x)} Y ${Math.floor(p.y)} Z ${Math.floor(p.z)}`;
  }
  private marker(i: number) {
    let el = this.markers[i];
    if (!el) {
      el = document.createElement('b');
      this.strip.append(el);
      this.markers[i] = el;
    }
    return el;
  }
  /** Per frame: cheap, it only touches the DOM when the view has visibly changed. */
  update(state: SimulationSnapshot | null, yaw: number) {
    if (!state) return;
    const p = state.player.position,
      dim = state.dimension ?? 'overworld';
    const key = `${Math.round(yaw * 400)}:${Math.round(p.x * 2)}:${Math.round(p.y)}:${Math.round(p.z * 2)}:${dim}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    if (this.prefs.coords) {
      const side = SIDE[((Math.round(wrap(yaw) / (Math.PI / 4)) % 8) + 8) % 8];
      this.coords.textContent = `X ${Math.floor(p.x)}  Y ${Math.floor(p.y)}  Z ${Math.floor(p.z)} · ${side}`;
    }
    if (!this.prefs.compass) return;
    for (const t of this.ticks) {
      const o = stripOffset(t.at, yaw);
      t.el.style.visibility = o === null || Math.abs(o) > 0.97 ? 'hidden' : 'visible';
      if (o !== null) t.el.style.left = `${50 + o * 50}%`;
    }
    const list: {
      kind: MarkerKind;
      x: number;
      y: number;
      z: number;
      label: string;
      color: string;
    }[] = [];
    const home = state.survival.spawn;
    if (dim === 'overworld' && home)
      list.push({ kind: 'home', ...home, label: 'Точка возрождения', color: '#f4e6b0' });
    const d = this.data.death;
    if (d && d.dim === dim)
      list.push({ kind: 'death', ...d, label: 'Место гибели', color: '#ff6b5b' });
    for (const v of state.landmarks ?? [])
      list.push({ ...v, kind: 'village', label: 'Деревня', color: '#e7b35a' });
    for (const m of this.data.marks)
      if (m.dim === dim)
        list.push({
          kind: 'mark',
          ...m,
          label: `Метка ${m.n}`,
          color: MARK_COLORS[(m.n - 1) % MARK_COLORS.length],
        });
    let focus: { label: string; dist: number; dy: number; o: number } | null = null;
    list.forEach((m, i) => {
      const el = this.marker(i);
      const dx = m.x - p.x,
        dz = m.z - p.z,
        dist = Math.hypot(dx, dz);
      const o = dist < 0.8 ? null : stripOffset(bearing(dx, dz), yaw);
      el.className = `marker ${m.kind}`;
      el.style.setProperty('--c', m.color);
      el.textContent = m.kind === 'mark' ? String(m.label.slice(6)) : '';
      el.style.visibility = o === null ? 'hidden' : 'visible';
      if (o !== null) {
        el.style.left = `${50 + o * 50}%`;
        if (Math.abs(o) < 0.12 && (!focus || Math.abs(o) < Math.abs(focus.o)))
          focus = { label: m.label, dist, dy: m.y - p.y, o };
      }
    });
    for (let i = list.length; i < this.markers.length; i++)
      this.markers[i].style.visibility = 'hidden';
    const f = focus as { label: string; dist: number; dy: number } | null;
    this.caption.textContent = f
      ? `${f.label} · ${Math.round(f.dist)} м${f.dy > 3 ? ' ▲' : f.dy < -3 ? ' ▼' : ''}`
      : '';
  }
}
