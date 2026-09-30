/**
 * Creative inventory tabs, laid out like the reference 1.12 creative menu: every obtainable item
 * belongs to exactly one tab, technical blocks (portals, the lava block, farmland) to none.
 */
import { registry } from './blocks';
import { ITEMS, type ItemDefinition } from './items';

export type CreativeTab =
  | 'building'
  | 'decoration'
  | 'redstone'
  | 'transport'
  | 'misc'
  | 'food'
  | 'tools'
  | 'combat'
  | 'brewing'
  | 'materials';

export const CREATIVE_TABS: readonly { id: CreativeTab; name: string; icon: string }[] = [
  { id: 'building', name: 'Строительные блоки', icon: 'lab:stone_bricks' },
  { id: 'decoration', name: 'Декор', icon: 'lab:poppy' },
  { id: 'redstone', name: 'Редстоун', icon: 'lab:redstone' },
  { id: 'transport', name: 'Транспорт', icon: 'lab:powered_rail' },
  { id: 'misc', name: 'Разное', icon: 'lab:lava_bucket' },
  { id: 'food', name: 'Еда', icon: 'lab:apple' },
  { id: 'tools', name: 'Инструменты', icon: 'lab:iron_axe' },
  { id: 'combat', name: 'Бой', icon: 'lab:iron_sword' },
  { id: 'brewing', name: 'Зельеварение', icon: 'lab:potion_healing' },
  { id: 'materials', name: 'Материалы', icon: 'lab:iron_ingot' },
];

/** Blocks that exist in the world but are not something a builder picks from a menu. */
const HIDDEN = new Set([
  'lab:nether_portal',
  'lab:end_portal',
  'lab:lava',
  'lab:farmland',
  'lab:grass_snowy',
]);
const DECORATION_BLOCKS = new Set([
  'lab:crafting_table',
  'lab:furnace',
  'lab:chest',
  'lab:bed',
  'lab:enchanting_table',
  'lab:bookshelf',
  'lab:brewing_stand',
  'lab:anvil',
  'lab:torch',
  'lab:glowstone',
  'lab:spawner',
  'lab:end_portal_frame',
  'lab:dragon_egg',
  'lab:wither_skeleton_skull',
  'lab:pumpkin',
  'lab:melon',
  'lab:hay_block',
  'lab:cactus',
  'lab:snow_layer',
  'lab:cobweb',
  'lab:lily_pad',
  'lab:jack_o_lantern',
  'lab:ladder',
  'lab:iron_bars',
  'lab:cobblestone_wall',
  'lab:mossy_cobblestone_wall',
  'lab:nether_brick_fence',
]);
const REDSTONE_BLOCKS = new Set(['lab:hopper', 'lab:tnt', 'lab:lamp']);
const BREWING = new Set([
  'lab:blaze_powder',
  'lab:ghast_tear',
  'lab:magma_cream',
  'lab:spider_eye',
  'lab:nether_wart',
  'lab:sugar',
  'lab:speckled_melon',
  'lab:fermented_spider_eye',
  'lab:glowstone_dust',
]);
const MISC = new Set([
  'lab:bucket',
  'lab:water_bucket',
  'lab:lava_bucket',
  'lab:snowball',
  'lab:bone_meal',
  'lab:book',
  'lab:paper',
  'lab:ender_pearl',
  'lab:eye_of_ender',
  'lab:end_crystal',
  'lab:nether_star',
  'lab:seeds',
  'lab:melon_seeds',
  'lab:pumpkin_seeds',
  'lab:beetroot_seeds',
]);
const TRANSPORT = new Set(['lab:minecart', 'lab:chest_minecart', 'lab:elytra']);

export function creativeTab(item: ItemDefinition): CreativeTab | null {
  const key = item.key;
  if (HIDDEN.has(key)) return null;
  if (item.block !== undefined) {
    const def = registry.get(item.block);
    const kind = def.model?.kind;
    if (key.endsWith('_rail') || key === 'lab:rail') return 'transport';
    if (def.redstone || REDSTONE_BLOCKS.has(key) || key === 'lab:redstone_torch') return 'redstone';
    if (key === 'lab:cake') return 'food';
    if (kind === 'door' || key.endsWith('_trapdoor') || key.endsWith('_fence_gate'))
      return 'redstone';
    if (key.endsWith('_carpet')) return 'decoration';
    if (DECORATION_BLOCKS.has(key) || def.shape || kind === 'fence' || kind === 'pane')
      return 'decoration';
    if (key.endsWith('_leaves')) return 'decoration';
    return 'building';
  }
  if (TRANSPORT.has(key)) return 'transport';
  if (item.potion || key.startsWith('lab:potion') || BREWING.has(key)) return 'brewing';
  if (item.food) return 'food';
  if (item.armor || item.attack || key === 'lab:bow' || key === 'lab:arrow' || key === 'lab:shield')
    return item.tool && !key.endsWith('_sword') ? 'tools' : 'combat';
  if (
    item.tool ||
    key === 'lab:flint_and_steel' ||
    key.endsWith('_hoe') ||
    key === 'lab:fishing_rod' ||
    key === 'lab:compass' ||
    key === 'lab:clock'
  )
    return 'tools';
  if (key === 'lab:redstone') return 'redstone';
  if (MISC.has(key)) return 'misc';
  return 'materials';
}

/** Items of a tab in menu order; `query` searches every tab by name or key. */
export function creativeItems(tab: CreativeTab | 'search', query = ''): ItemDefinition[] {
  const q = query.trim().toLocaleLowerCase('ru');
  return ITEMS.filter((item) => {
    const own = creativeTab(item);
    if (!own) return false;
    if (tab === 'search')
      return !q || item.name.toLocaleLowerCase('ru').includes(q) || item.key.includes(q);
    return own === tab;
  });
}
