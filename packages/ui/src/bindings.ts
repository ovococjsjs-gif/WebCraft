/** One source for keyboard handling and all on-screen key labels. */
export const BINDINGS = {
  inventory: { codes: ['KeyE', 'KeyF'], label: 'E / F' },
  palette: { codes: ['KeyP'], label: 'P' },
  flight: { codes: ['KeyG'], label: 'G' },
  drop: { codes: ['KeyQ'], label: 'Q' },
  menu: { codes: ['Escape'], label: 'Esc' },
} as const;
export function matchesBinding(name: keyof typeof BINDINGS, code: string): boolean {
  return (BINDINGS[name].codes as readonly string[]).includes(code);
}
