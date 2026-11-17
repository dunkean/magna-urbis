import { iconUrl, type IconId } from './stageIcons';

/** Decorative paint stays separate from the live, localized button caption. */
export function editorButtonIcon(button: HTMLButtonElement, icon: IconId, badge?: '+' | '−' | '×' | '↶' | '✓'): void {
  const url = iconUrl(icon); if (!url) return;
  button.dataset.editorIcon = icon;
  button.style.setProperty('--editor-icon', `url("${url}")`);
  if (badge) button.dataset.editorBadge = badge;
}

export function networkToolIcon(button: HTMLButtonElement, tool: 'roads' | 'draw' | 'rivers'): void {
  editorButtonIcon(button, tool === 'rivers' ? 'family-water' : 'display-roads', tool === 'draw' ? '+' : tool === 'rivers' ? '×' : undefined);
}

/** Small line icons for inline row actions (visibility, reset, rename); they follow the text colour. */
export type LineIcon = 'eye' | 'eye-off' | 'reset' | 'pencil' | 'crosshair';
const LINE_PATHS: Record<LineIcon, string> = {
  eye: 'M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  'eye-off': 'M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM2.5 13.5l11-11',
  reset: 'M3 3v3.5h3.5M3.4 6.2A5 5 0 1 1 3.3 10',
  pencil: 'M10.5 2.5l3 3L6 13H3v-3zM9 4l3 3',
  crosshair: 'M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
};
export function lineIcon(icon: LineIcon): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'), path = document.createElementNS(ns, 'path');
  svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', '14'); svg.setAttribute('height', '14'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'line-icon');
  path.setAttribute('d', LINE_PATHS[icon]); path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.4'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
  svg.append(path); return svg;
}
