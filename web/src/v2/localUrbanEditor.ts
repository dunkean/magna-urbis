import { createShapeEditor, type Pt } from '../ui/cityShapeEditor';
import { CULTURE_LABELS } from '../gen/options';
import type { View } from '../render/view';
import type { QuarterOverride, ParcelOverride } from '../../../rust/bridge/urbanConfig';

type Edit = QuarterOverride | ParcelOverride;
type Kind = 'quarter' | 'parcel';
const label = (fr: boolean, en: string, french: string): string => fr ? french : en;
const button = (host: HTMLElement, text: string, action: () => void): void => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'small'; b.textContent = text; b.onclick = action; host.append(b);
};

/** Direct actions preserve the other fields of the selected native override. */
export function mountSubdivisionActions(host: HTMLElement, opts: {
  kind: Kind; french: boolean; get: () => Edit | undefined; apply: (value: Edit) => void;
  shape: { outer: Pt[]; holes?: Pt[][] }; map: HTMLElement; getView: () => View;
}): void {
  const { kind, french, get, apply } = opts;
  host.classList.add('v2-edit-actions');
  const act = (patch: Edit): void => apply({ ...get(), ...patch });
  if (kind === 'quarter') {
    const select = (key: 'culture' | 'tissue' | 'role', title: string, choices: [string, string][]): void => {
      const row = document.createElement('label'); row.className = 'label'; row.textContent = title;
      const input = document.createElement('select');
      for (const [value, text] of [['', label(french, 'Inherited', 'Hérité')], ...choices]) {
        const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option);
      }
      input.value = (get() as QuarterOverride | undefined)?.[key] ?? '';
      input.onchange = () => { const next = { ...get() } as QuarterOverride; if (input.value) next[key] = input.value; else delete next[key]; apply(next); };
      row.append(input); host.append(row);
    };
    select('culture', 'Culture', CULTURE_LABELS);
    select('role', label(french, 'District role', 'Fonction du quartier'), [['civic',label(french,'Civic','Civique')],['market',label(french,'Market','Marché')],['religious',label(french,'Religious','Religieux')],['port',label(french,'Port','Port')],['elite',label(french,'Elite','Patricien')],['commoner',label(french,'Residential','Populaire')],['poor',label(french,'Poor','Pauvre')],['garrison',label(french,'Garrison','Garnison')],['gardens',label(french,'Gardens','Jardins')],['foreign',label(french,'Foreign','Étranger')],['craft',label(french,'Craft','Artisanat')]]);
    select('tissue', label(french, 'Street pattern', 'Trame'), [['culture',label(french,'Cultural','Culturelle')],['grid',label(french,'Grid','Grille')],['organic',label(french,'Organic','Organique')],['radial',label(french,'Radial','Radiale')],['terraces',label(french,'Terraces','Terrasses')],['dendritic',label(french,'Branching','Ramifiée')],['clusters',label(french,'Clusters','Groupée')]]);
  }
  button(host, label(french, 'Reroll', 'Nouvelle variation'), () => act({ salt: ((get()?.salt ?? 0) + 1) >>> 0 }));
  button(host, label(french, 'Edit outline', 'Modifier le contour'), () => {
    const shape = get()?.shape ?? opts.shape;
    editOutline(opts.map, opts.getView, shape.outer, ring => act({ shape: { outer: ring, holes: shape.holes ?? [] } }), label(french, 'Edit outline', 'Modifier le contour'));
  });
  button(host, label(french, 'Delete', 'Supprimer'), () => act(kind === 'quarter' ? { deleted: true } : { deleted: 'garden' }));
}

let stopOutline: (() => void) | undefined;
function editOutline(map: HTMLElement, getView: () => View, ring: Pt[], commit: (ring: Pt[]) => void, title: string): void {
  stopOutline?.();
  window.dispatchEvent(new CustomEvent('v2-edit-mode', { detail: 'shape' }));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-label', title);
  Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', zIndex: '12', pointerEvents: 'none', overflow: 'hidden' });
  map.append(svg);
  // The viewer listens on the canvas (a sibling of this overlay), so forward
  // wheel events over handles while allowing the canvas to zoom normally.
  svg.addEventListener('wheel', event => {
    const canvas = map.querySelector<HTMLCanvasElement>('#map-canvas');
    if (!canvas) return;
    event.preventDefault();
    canvas.dispatchEvent(new WheelEvent('wheel', { clientX: event.clientX, clientY: event.clientY,
      deltaX: event.deltaX, deltaY: event.deltaY, deltaZ: event.deltaZ, deltaMode: event.deltaMode, cancelable: true }));
  }, { passive: false });
  const editor = createShapeEditor(svg, map);
  let frame = 0, lastView = '';
  // The canvas remains available for pan/zoom, but a click must not select a
  // different object underneath the outline while this draft is active.
  const blockMapPick = (event: MouseEvent): void => {
    if (!(event.target as Element | null)?.closest('.city-shape-toolbar')) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  };
  map.addEventListener('click', blockMapPick, true);
  const dispose = (): void => { cancelAnimationFrame(frame); map.removeEventListener('click', blockMapPick, true); svg.remove(); stopOutline = undefined; };
  const updateView = (): void => {
    const view = getView(), width = map.clientWidth, height = map.clientHeight;
    const next = `${view.cx - width / (2 * view.scale)} ${view.cy - height / (2 * view.scale)} ${width / view.scale} ${height / view.scale}`;
    if (next !== lastView) { lastView = next; svg.setAttribute('viewBox', next); editor.update(); }
  };
  const update = (): void => { updateView(); frame = requestAnimationFrame(update); };
  // The initial viewBox is needed before start() computes handle sizes.
  updateView();
  editor.start({ ring, original: ring, title, onCommit: value => { dispose(); commit(value); }, onCancel: dispose });
  const layer = svg.querySelector<SVGGElement>('#cityShapeEditor');
  if (layer) layer.style.pointerEvents = 'visiblePainted';
  stopOutline = () => editor.stop(); update();
}

/** Deleted items cannot be picked from the map, so expose their saved IDs in the place inspector. */
export function mountDeletedSubdivisions(host: HTMLElement, french: boolean, entries: { kind: Kind; id: string }[], restore: (kind: Kind, id: string) => void): void {
  if (!entries.length) return;
  const details = document.createElement('details'); details.className = 'section';
  const summary = document.createElement('summary'); summary.textContent = label(french, 'Restore deleted areas', 'Restaurer les zones supprimées'); details.append(summary);
  for (const entry of entries) {
    const row = document.createElement('div'); row.className = 'control-grid';
    const name = document.createElement('span'); name.textContent = `${entry.kind === 'quarter' ? label(french, 'Quarter', 'Quartier') : label(french, 'Parcel', 'Parcelle')} · ${entry.id}`; row.append(name);
    button(row, label(french, 'Restore', 'Restaurer'), () => restore(entry.kind, entry.id)); details.append(row);
  }
  host.append(details);
}

if (typeof window !== 'undefined') window.addEventListener('v2-edit-mode', event => { if ((event as CustomEvent<string>).detail !== 'shape') stopOutline?.(); });
