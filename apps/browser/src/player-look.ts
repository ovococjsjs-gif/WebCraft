import { BUILTIN_SKINS, skinFromImage, validSkinImage, detectSlim } from '@renderer/player-skins';
import type { VoxelRenderer } from '@renderer/scene';
import { $ } from '@ui/ui';

/** Which skin the player wears; an uploaded PNG is kept as a data URL on this device. */
interface Look {
  skin: string;
  custom?: string;
  slim?: boolean;
}
const KEY = 'voxel:player-look';
function load(): Look {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Look>;
    if (v && typeof v.skin === 'string') return v as Look;
  } catch {
    /* Malformed preference: the default traveller. */
  }
  return { skin: 'traveller' };
}
function save(look: Look) {
  try {
    localStorage.setItem(KEY, JSON.stringify(look));
    return true;
  } catch {
    return false;
  }
}
function decode(url: string): Promise<ImageData | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true });
      if (!g) return resolve(null);
      g.drawImage(img, 0, 0);
      resolve(g.getImageData(0, 0, c.width, c.height));
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** The settings' «Персонаж» group, the inventory figure and the skin worn in the world. */
export function installPlayerLook(renderer: VoxelRenderer) {
  const look = load();
  const select = $<HTMLSelectElement>('#player-skin');
  const slim = $<HTMLInputElement>('#skin-slim');
  const status = $('#skin-file-status');
  const previews = ['#settings-avatar', '#inventory-avatar'].map((id) =>
    renderer.createAvatarPreview($<HTMLCanvasElement>(id)),
  );
  // Each preview draws only while visible and stops itself; this re-wakes the shown ones.
  setInterval(() => {
    for (const p of previews) p.start();
  }, 250);
  let image: ImageData | null = null;
  const apply = () => {
    const builtin = BUILTIN_SKINS.findIndex((s) => s.id === look.skin);
    if (look.skin === 'custom' && image) {
      const skin = skinFromImage(image, !!look.slim);
      renderer.wearCustomSkin(skin);
      renderer.setPlayerSkin(BUILTIN_SKINS.length + (skin.slim ? 1 : 0), skin);
    } else {
      const i = Math.max(0, builtin);
      renderer.setPlayerSkin(i, BUILTIN_SKINS[i]);
    }
    select.value = look.skin === 'custom' && !image ? 'traveller' : look.skin;
    slim.checked = !!look.slim;
    slim.disabled = look.skin !== 'custom';
  };
  const useUrl = async (url: string, fresh: boolean) => {
    const data = await decode(url);
    if (!data || !validSkinImage(data)) {
      status.textContent = 'Нужен PNG 64×64 или 64×32 в раскладке Minecraft';
      return false;
    }
    image = data;
    if (fresh) look.slim = detectSlim(data);
    look.skin = 'custom';
    look.custom = url;
    status.textContent = save(look) ? 'Скин загружен и сохранён' : 'Скин загружен до перезагрузки';
    apply();
    return true;
  };
  select.addEventListener('change', () => {
    if (select.value === 'custom' && !image) {
      $<HTMLInputElement>('#skin-file').click();
      select.value = look.skin;
      return;
    }
    look.skin = select.value;
    save(look);
    apply();
  });
  slim.addEventListener('change', () => {
    look.slim = slim.checked;
    save(look);
    apply();
  });
  $<HTMLInputElement>('#skin-file').addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => void useUrl(String(reader.result), true);
    reader.readAsDataURL(file);
    (e.target as HTMLInputElement).value = '';
  });
  apply();
  if (look.skin === 'custom' && look.custom) void useUrl(look.custom, false);
  return { previews };
}
