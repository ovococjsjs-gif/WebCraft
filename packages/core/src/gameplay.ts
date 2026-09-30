export const GAME_MODES = ['survival', 'creative', 'lab'] as const;
export type GameMode = (typeof GAME_MODES)[number];
export const GAME_MODE_NAMES: Record<GameMode, string> = {
  survival: 'Выживание',
  creative: 'Творчество',
  lab: 'Лаборатория',
};
export function isGameMode(value: unknown): value is GameMode {
  return typeof value === 'string' && (GAME_MODES as readonly string[]).includes(value);
}
export const JOURNEY_GOALS = ['wood', 'planks', 'workbench', 'pickaxe', 'furnace', 'iron'] as const;
export type JourneyGoal = (typeof JOURNEY_GOALS)[number];
export const JOURNEY_TEXT: Record<JourneyGoal, { title: string; hint: string }> = {
  wood: { title: 'Начните с дерева', hint: 'Подойдите к стволу и удерживайте ЛКМ.' },
  planks: { title: 'Превратите брёвна в доски', hint: 'E — инвентарь. Рецепты находятся справа.' },
  workbench: { title: 'Сделайте верстак', hint: 'Четыре доски открывают крафт 3×3.' },
  pickaxe: {
    title: 'Ваш первый инструмент',
    hint: 'Поставьте верстак и откройте его правой кнопкой.',
  },
  furnace: { title: 'Камень станет печью', hint: 'Добудьте киркой восемь блоков булыжника.' },
  iron: { title: 'От руды к железу', hint: 'Каменная кирка, железная руда, топливо и печь.' },
};
export function goalForItem(item: string): JourneyGoal | null {
  if (item === 'lab:oak_log' || item === 'lab:birch_log') return 'wood';
  if (item === 'lab:oak_planks') return 'planks';
  if (item === 'lab:crafting_table') return 'workbench';
  if (item.endsWith('_pickaxe')) return 'pickaxe';
  if (item === 'lab:furnace') return 'furnace';
  if (item === 'lab:iron_ingot') return 'iron';
  return null;
}
/** Compact change stamp computed in the Worker. Two independent lanes + length, not a save checksum. */
export function stateStamp(value: unknown): string {
  const text = JSON.stringify(value);
  let a = 2166136261,
    b = 5381;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b, 33) ^ c;
  }
  return `${(a >>> 0).toString(36)}:${(b >>> 0).toString(36)}:${text.length}`;
}
