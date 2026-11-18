/** HTML helpers and option tables of the page shell and the inspectors. No DOM access at load. */
import type { ExportLayers } from '../../render/exportLayers';
import { iconUrl, type IconId } from '../stageIcons';

export const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
export const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const icon = (id: IconId, size = 22): string => `<img class="v2-icon" src="${iconUrl(id) ?? ''}" alt="" width="${size}" height="${size}" aria-hidden="true">`;
type Item = string | readonly [string, string];
export function options(items: readonly Item[]): string {
  return items
    .map(item => {
      const [value, label] = typeof item === 'string' ? [item, item] : item;
      return `<option value="${esc(value)}">${esc(label)}</option>`;
    })
    .join('');
}
export function field(label: string, key: string, items?: readonly Item[], attrs = ''): string {
  const id = `option-${key.replace(/\./g, '-')}`;
  return `<label class="label" for="${id}">${label}</label>${items ? `<select id="${id}" data-option="${key}">${options(items)}</select>` : `<input id="${id}" data-option="${key}" ${attrs || 'type="number"'}>`}`;
}
export const tri: Item[] = [
  ['auto', 'Automatic'],
  ['yes', 'Yes'],
  ['no', 'No'],
];
/** Fortification styles (`urban/fortifications.json`): the culture's own, or one style for the town or the region. */
export const wallStyles: Item[] = [
  ['auto', 'Follow the culture'],
  ['palisade', 'Palisade'],
  ['gord', 'Earth and timber rampart (gord)'],
  ['hedge', 'Thorn hedge'],
  ['curtain', 'Curtain wall'],
  ['flanked', 'Wall flanked by towers'],
  ['concentric', 'Concentric walls'],
  ['rammed-earth', 'Rammed-earth wall'],
  ['wengcheng', 'Wall with barbicans (wengcheng)'],
  ['bastioned', 'Bastioned fortification'],
];
export const layerNames: Record<keyof ExportLayers, string> = {
  background: 'Map background',
  terrain: 'Relief & contours',
  water: 'Hydrography',
  landuse: 'Vegetation & farmland',
  city: 'Buildings & grounds',
  streets: 'Streets & urban bridges',
  roads: 'Regional roads',
  labels: 'Place names',
  decor: 'Frame & legend',
};
