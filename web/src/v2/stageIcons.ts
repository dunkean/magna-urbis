/** Painted V2 icons generated with ImageGen (see assets/icons/PROVENANCE.md and manifest.json). */
const files = import.meta.glob('./assets/icons/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export type IconId =
  | 'family-relief' | 'family-water' | 'family-settlements' | 'family-city' | 'family-display'
  | 'source-procedural' | 'source-neural' | 'source-heightmap' | 'source-library'
  | 'display-palette' | 'display-layers' | 'display-2d' | 'display-3d' | 'display-buildings' | 'display-roads' | 'display-ground' | 'display-labels' | 'display-light'
  | 'backend-cpu' | 'backend-gpu' | 'backend-wasm-single' | 'backend-wasm-threads' | 'backend-pool' | 'backend-native' | 'backend-python' | 'backend-webgpu' | 'settings-gear';

export const iconUrl = (id: IconId): string | undefined => files[`./assets/icons/${id}.webp`];

/** Decorative by default: the adjacent text names the control. */
export function iconImg(id: IconId, size = 22, className = 'v2-icon'): HTMLElement {
  const url = iconUrl(id);
  if (!url) { const dot = document.createElement('span'); dot.className = `${className} v2-icon-missing`; dot.setAttribute('aria-hidden', 'true'); return dot; }
  const img = document.createElement('img'); img.src = url; img.alt = ''; img.width = img.height = size; img.className = className;
  img.decoding = 'async'; img.draggable = false; img.setAttribute('aria-hidden', 'true'); return img;
}
