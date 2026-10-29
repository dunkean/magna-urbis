import { mountRenderSettingsPanel, mountRenderColorControls, type RenderSection } from './renderSettingsPanel';
import { getBenchRenderColors, setBenchRenderColors } from './benchRenderColors';
import { urbanText } from './urbanPanelLocale';
import { isTerrainStyle, terrainStyle } from '../render/terrainStyle';
import { paletteColors, type RenderColorKey } from '../render/customColors';
import { markStyleCustomized, renderControlsCustomized } from './renderStyleCustomization';

/** Reuse the original inputs: stage owners retain state, listeners and conditional visibility. */
export function installBenchRenderSettings(): void {
  const nav = document.querySelector<HTMLElement>('body > nav');
  if (!nav || document.querySelector('#bench-render-settings')) return;
  const localized: { element: HTMLElement; en: string; fr: string }[] = [];
  const text = (element: HTMLElement, en: string, fr: string) => { localized.push({ element, en, fr }); element.textContent = urbanText([fr, en, en, en, en]); };
  const panel = mountRenderSettingsPanel(nav, text); panel.root.id = 'bench-render-settings';
  const move = (section: RenderSection, selector: string) => {
    for (const field of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      const node = field.matches('input,select,button') ? field.closest<HTMLElement>('label') ?? field : field;
      if (!panel.bodies[section].contains(node)) panel.bodies[section].append(node);
    }
  };
  const colors = mountRenderColorControls(panel, text, {
    getColors: getBenchRenderColors,
    getStyle: () => document.querySelector<HTMLSelectElement>('#style')?.value ?? 'parchment',
    getPalette: () => { const style = document.querySelector<HTMLSelectElement>('#style')?.value; return terrainStyle(isTerrainStyle(style) ? style : 'parchment').palette; },
    setColor: (key, value) => { const next = { ...getBenchRenderColors() }; if (value === undefined) delete next[key]; else next[key] = value; setBenchRenderColors(next); },
    isAvailable: key => {
      if (document.body.dataset.bench === 'city' && ['paper', 'groundLow', 'groundHigh', 'waterShore', 'waterDeep', 'river'].includes(key)) return false;
      if (['forest', 'meadow', 'field'].includes(key)) return !!document.querySelector('#landuseStyle');
      return true;
    },
  });
  const syncStyle = () => {
    const style = document.querySelector<HTMLSelectElement>('#style'), background = document.querySelector<HTMLSelectElement>('#backgroundStyle');
    const defaults = paletteColors(terrainStyle(style && isTerrainStyle(style.value) ? style.value : 'parchment').palette);
    const customColors = Object.entries(getBenchRenderColors()).some(([key, value]) => value.toLowerCase() !== defaults[key as RenderColorKey].toLowerCase());
    const customized = customColors || renderControlsCustomized(panel.root, control => {
      if (control.id === 'roadPreset' && background?.value === 'render') return 'render';
      if (control.dataset.render === 'palette' && background?.value === 'parchment') return 'parchment';
      return undefined;
    });
    for (const select of [style, background]) if (select) markStyleCustomized(select, customized);
  };
  const collect = () => {
    move('general', '#showFrame, #showLegend, #backgroundOpacity');
    move('relief', '#showShading, #lightAzimuth, #lightElevation, #lightStrength, #lightExaggeration, #resetLighting, #refinement3dControl, #perspectiveControls');
    move('ground', '#style, #showRelief, #showHypsometry, #showBackground, #backgroundStyle');
    move('cover', '#showContours, #renderV2Controls, #forestControls3d, #lightingControls fieldset');
    move('water', '#showWater, #showLakes, #showOxbows');
    move('roads', '#roadRendering, #roadShow');
    move('cover', '#showLanduse');
    move('buildings', '#showPlan');
    move('diagnostics', '#hydroOverlay');
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('[data-render-settings-category]'))) {
      const category = element.dataset.renderSettingsCategory as RenderSection;
      if (panel.bodies[category] && !panel.bodies[category].contains(element)) panel.bodies[category].append(element);
    }
    for (const body of Object.values(panel.bodies)) {
      const grid = body.querySelector(':scope > .render-color-grid'); if (grid && grid !== body.lastElementChild) body.append(grid);
    }
    const old = document.querySelector<HTMLElement>('#lightingControls'); if (old) old.hidden = true;
    const cityBlend = document.querySelector<HTMLElement>('[data-render="groundBlend"]')?.closest<HTMLElement>('label');
    if (cityBlend) cityBlend.hidden = !!document.querySelector('#roadBlend');
    colors.sync();
    syncStyle();
    for (const [category, section] of Object.entries(panel.sections) as [RenderSection, HTMLDetailsElement][]) {
      // CityBench's background is an image. Keep incompatible tokens available as disabled controls.
      section.hidden = !panel.bodies[category].children.length;
    }
  };
  // Stage modules finish binding before their controls are moved into the shared panel.
  let queued = false;
  const schedule = () => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; collect(); }); };
  const stages = document.querySelector('.stages');
  if (stages) new MutationObserver(schedule).observe(stages, { subtree: true, childList: true });
  nav.addEventListener('change', () => { colors.sync(); syncStyle(); });
  nav.addEventListener('input', syncStyle);
  nav.addEventListener('click', () => queueMicrotask(syncStyle));
  window.addEventListener('bench-render-colors-change', syncStyle);
  window.addEventListener('bench-space-change', schedule);
  window.addEventListener('magna-locale-change', () => { for (const { element, en, fr } of localized) element.textContent = urbanText([fr, en, en, en, en]); queueMicrotask(syncStyle); });
  schedule();
}
