import { COLOR_GROUPS, paletteColors, supportsRenderColor, type RenderColorKey, type RenderColors } from '../render/customColors';
import type { Palette } from '../render/styles';
import './renderSettingsPanel.css';

export const RENDER_SECTIONS = {
  general: ['Map presentation', 'Présentation de la carte'],
  relief: ['Relief and shadows', 'Relief et ombres'],
  ground: ['Ground colours and style', 'Sol : couleurs et style'],
  cover: ['Land cover and contours', 'Couverture du sol et courbes'],
  roads: ['Roads and streets', 'Routes et rues'],
  water: ['Rivers, lakes and sea', 'Rivières, lacs et mer'],
  buildings: ['Buildings and city plan', 'Bâtiments et plan de ville'],
  diagnostics: ['Diagnostics', 'Diagnostics'],
} as const;
export type RenderSection = keyof typeof RENDER_SECTIONS;
export type RenderText = (element: HTMLElement, en: string, fr: string) => void;
export interface RenderSettingsPanel {
  root: HTMLDetailsElement;
  popup: HTMLElement;
  sections: Record<RenderSection, HTMLDetailsElement>;
  bodies: Record<RenderSection, HTMLElement>;
  dispose(): void;
}
/** Common shell: adapters supply existing live controls, preserving their handlers and state. */
export function mountRenderSettingsPanel(host: HTMLElement, text: RenderText): RenderSettingsPanel {
  const root = document.createElement('details'); root.className = 'render-settings-panel';
  const title = document.createElement('summary'); text(title, 'Appearance', 'Apparence'); root.append(title);
  const popup = document.createElement('div'); popup.className = 'render-settings-popup';
  const help = document.createElement('p'); help.className = 'render-settings-help';
  text(help, 'Adjust each layer without regenerating the map.', 'Ajustez chaque couche sans régénérer la carte.'); popup.append(help); root.append(popup);
  const sections = {} as RenderSettingsPanel['sections'], bodies = {} as RenderSettingsPanel['bodies'];
  for (const [key, labels] of Object.entries(RENDER_SECTIONS) as [RenderSection, readonly [string, string]][]) {
    const section = document.createElement('details'); section.className = 'render-settings-section'; section.dataset.renderSection = key;
    section.open = key === 'general' || key === 'ground';
    const summary = document.createElement('summary'); text(summary, ...labels);
    const body = document.createElement('div'); body.className = 'render-settings-fields';
    section.append(summary, body); popup.append(section); sections[key] = section; bodies[key] = body;
  }
  host.append(root);
  const layout = () => {
    if (!root.open) return;
    popup.style.translate = '';
    const bounds = popup.getBoundingClientRect(), width = document.documentElement.clientWidth;
    const shift = bounds.x < 12 ? 12 - bounds.x : bounds.right > width - 12 ? width - 12 - bounds.right : 0;
    popup.style.translate = `${shift}px 0`;
    popup.style.maxHeight = `${Math.max(120, Math.min(760, window.innerHeight - bounds.top - 12))}px`;
  };
  root.addEventListener('toggle', layout); window.addEventListener('resize', layout);
  const dismiss = (event: PointerEvent) => { if (root.open && !root.contains(event.target as Node)) root.open = false; };
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && root.open) { root.open = false; title.focus(); } };
  document.addEventListener('pointerdown', dismiss); root.addEventListener('keydown', escape);
  return { root, popup, sections, bodies, dispose() { document.removeEventListener('pointerdown', dismiss); root.removeEventListener('keydown', escape); root.removeEventListener('toggle', layout); window.removeEventListener('resize', layout); root.remove(); } };
}
export const COLOR_LABELS: Record<RenderColorKey, readonly [string, string]> = {
  paper: ['Map background', 'Fond de carte'], groundLow: ['Low ground', 'Sol bas'], groundHigh: ['High ground', 'Sol élevé'],
  contour: ['Contour lines', 'Courbes de niveau'], forest: ['Forest', 'Forêt'], meadow: ['Meadows', 'Prairies'], field: ['Fields', 'Champs'],
  road: ['Road surface', 'Chaussée'], roadEdge: ['Road edges', 'Bords des routes'], track: ['Tracks', 'Chemins'],
  waterShore: ['Shallow water', 'Eau peu profonde'], waterDeep: ['Deep water', 'Eau profonde'], river: ['Rivers', 'Rivières'],
  building: ['Roofs / footprints', 'Toits / emprises'], buildingEdge: ['Building outlines', 'Contours des bâtiments'],
};
export interface RenderColorBindings {
  getColors(): RenderColors | undefined;
  getPalette(): Palette;
  getStyle(): string;
  setColor(key: RenderColorKey, value: string | undefined): void;
  isAvailable?(key: RenderColorKey): boolean;
}
export function mountRenderColorControls(panel: RenderSettingsPanel, text: RenderText, bindings: RenderColorBindings): { sync(): void } {
  const controls: { key: RenderColorKey; input: HTMLInputElement; reset: HTMLButtonElement; row: HTMLElement }[] = [];
  for (const [group, keys] of Object.entries(COLOR_GROUPS) as [keyof typeof COLOR_GROUPS, readonly RenderColorKey[]][]) {
    const grid = document.createElement('div'); grid.className = 'render-color-grid'; panel.bodies[group].append(grid);
    for (const key of keys) {
      const row = document.createElement('div'); row.className = 'render-color-row'; row.dataset.colorKey = key;
      const label = document.createElement('label'), caption = document.createElement('span'); text(caption, ...COLOR_LABELS[key]);
      const input = document.createElement('input'); input.type = 'color'; input.dataset.renderColor = key; label.append(caption, input);
      const reset = document.createElement('button'); reset.type = 'button'; text(reset, 'Reset', 'Rétablir');
      input.addEventListener('input', () => { bindings.setColor(key, input.value); sync(); });
      reset.addEventListener('click', () => { bindings.setColor(key, undefined); sync(); });
      row.append(label, reset); grid.append(row); controls.push({ key, input, reset, row });
    }
    const note = document.createElement('small'); note.className = 'render-color-note';
    text(note, 'Unavailable colours are controlled by the selected materials or diagnostic. Your custom colours are retained when switching styles.', 'Les couleurs indisponibles dépendent des matériaux ou du diagnostic choisi. Vos couleurs sont conservées lors des changements de style.');
    grid.append(note);
  }
  function sync(): void {
    const overrides = bindings.getColors(), defaults = paletteColors(bindings.getPalette()), style = bindings.getStyle();
    for (const { key, input, reset, row } of controls) {
      input.value = overrides?.[key] ?? defaults[key];
      input.disabled = !supportsRenderColor(key, style) || bindings.isAvailable?.(key) === false; reset.disabled = overrides?.[key] === undefined;
      row.classList.toggle('render-color-unavailable', input.disabled);
    }
    for (const grid of Array.from(panel.root.querySelectorAll('.render-color-grid'))) (grid.lastElementChild as HTMLElement).hidden = !grid.querySelector('.render-color-unavailable');
  }
  sync(); return { sync };
}
