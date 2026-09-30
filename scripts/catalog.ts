// Prints a machine-checked catalog of what the game contains (counts and names), for docs/x10.
import { BLOCKS, registry } from '../packages/content/src/blocks';
import { ITEMS } from '../packages/content/src/items';
import { RECIPES, SMELTING } from '../packages/core/src/crafting';
import { MOBS } from '../packages/core/src/mobs';
import { BIOMES_V5 } from '../packages/core/src/worldgen/biomes-v5';
import { ENCHANTMENTS } from '../packages/core/src/stations';
import { EFFECTS } from '../packages/core/src/effects';

const kinds = (xs: readonly string[]) => [...new Set(xs)].sort();
console.log(
  'block definitions:',
  BLOCKS.length,
  '| registered states:',
  (registry as unknown as { size?: number }).size ?? '?',
);
console.log('items:', ITEMS.length);
const cnt = (f: (i: (typeof ITEMS)[number]) => unknown) => ITEMS.filter((i) => f(i)).length;
console.log(
  'item classes:',
  JSON.stringify({
    tools: cnt((i) => i.tool),
    armor: cnt((i) => i.armor),
    food: cnt((i) => i.food),
    weapons: cnt((i) => i.attack),
    potions: cnt((i) => i.potion),
    carts: cnt((i) => i.cart),
    enchanted: cnt((i) => i.enchant),
    seeds: cnt((i) => i.plants),
    buckets: cnt((i) => i.bucket),
    fuel: cnt((i) => i.fuelTicks),
  }),
);
console.log('recipes:', RECIPES.length, '| smelting:', SMELTING.length);
console.log(
  'mobs (' + MOBS.length + '):',
  MOBS.map((m) => `${m.kind.replace('lab:', '')}${m.hostile ? '*' : ''}`).join(', '),
);
console.log('biomes (' + BIOMES_V5.length + '):', BIOMES_V5.map((b) => b.key).join(', '));
console.log(
  'tree kinds:',
  kinds(BIOMES_V5.flatMap((b) => b.treeKinds.map((t) => t[0]))).join(', '),
);
const opens = kinds(BLOCKS.map((b) => b.opens ?? '').filter(Boolean));
console.log('interactive blocks (opens):', opens.join(', '));
console.log(
  'block layers:',
  JSON.stringify(
    BLOCKS.reduce<Record<string, number>>((a, b) => ((a[b.layer] = (a[b.layer] ?? 0) + 1), a), {}),
  ),
);
console.log(
  'light emitters:',
  BLOCKS.filter((b) => (b as unknown as { light?: number }).light).length,
);
console.log(
  'enchantments (' + ENCHANTMENTS.length + '):',
  ENCHANTMENTS.map((e) => `${e.id}:${e.maxLevel}`).join(', '),
);
console.log('status effects (' + EFFECTS.length + '):', EFFECTS.map((e) => e.id).join(', '));
