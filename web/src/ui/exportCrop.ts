import './exportCrop.css';
import { clampExportRect, exportPixelSize, type ExportRect } from './exportCropGeometry';

export interface CroppedExport { blob: Blob; width: number; height: number }
const ns = 'http://www.w3.org/2000/svg';

/** Preview the captured SVG, then change only its viewport. The generated map stays intact. */
export async function chooseExportCrop(blob: Blob, longestEdge: number, localize?: (dialog:HTMLDialogElement)=>void): Promise<CroppedExport | null> {
  const doc = new DOMParser().parseFromString(await blob.text(), 'image/svg+xml');
  const svg = doc.documentElement;
  const values = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  if (svg.localName !== 'svg' || values.length !== 4 || !values.every(Number.isFinite) || values[2] <= 0 || values[3] <= 0) {
    throw new Error('Invalid SVG export bounds');
  }
  const bounds: ExportRect = { x: values[0], y: values[1], width: values[2], height: values[3] };
  let selection = { ...bounds };
  const dialog = document.createElement('dialog');
  dialog.className = 'export-crop'; dialog.setAttribute('aria-labelledby', 'export-crop-title');
  dialog.innerHTML = `<h2 id="export-crop-title">Recadrer l’export</h2>
    <p>Tracez un rectangle sur l’aperçu, puis déplacez-le ou ajustez ses dimensions.</p>
    <div class="export-crop-preview"><img alt="Aperçu de la carte à exporter"><svg aria-label="Zone de recadrage"><path fill="#000" fill-opacity=".55" fill-rule="evenodd" pointer-events="none"/><rect fill="transparent" stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke"/></svg></div>
    <div class="export-crop-fields">${[['x', 'X (m)'], ['y', 'Y (m)'], ['width', 'Largeur (m)'], ['height', 'Hauteur (m)']].map(([key, label]) => `<label>${label}<input data-field="${key}" type="number" step="any" required></label>`).join('')}</div>
    <div class="export-crop-actions"><button type="button" data-action="reset">Carte entière</button><output aria-live="polite"></output><button type="button" data-action="cancel">Annuler</button><button type="button" data-action="export">Exporter</button></div>`;
  const preview = dialog.querySelector<HTMLElement>('.export-crop-preview')!;
  const image = dialog.querySelector('img')!;
  const overlay = dialog.querySelector('svg')!;
  const frame = overlay.querySelector('rect')!;
  const mask = overlay.querySelector('path')!;
  const fields = Array.from(dialog.querySelectorAll<HTMLInputElement>('input'));
  const url = URL.createObjectURL(blob);
  image.src = url;
  // A fixed aspect ratio avoids letterboxing: pointer coordinates match the source viewBox.
  preview.style.width = `${Math.min(720, 430 * bounds.width / bounds.height)}px`;
  preview.style.aspectRatio = `${bounds.width} / ${bounds.height}`;
  overlay.setAttribute('viewBox', values.join(' '));
  const refresh = (): void => {
    for (const input of fields) {
      const key = input.dataset.field as keyof ExportRect;
      input.value = String(Number(selection[key].toFixed(3)));
      input.min = String(key === 'x' ? bounds.x : key === 'y' ? bounds.y : Math.min(1, bounds[key]));
      input.max = String(key === 'x' ? bounds.x + bounds.width - selection.width : key === 'y' ? bounds.y + bounds.height - selection.height : bounds[key]);
    }
    for (const [key, value] of Object.entries(selection)) frame.setAttribute(key, String(value));
    const { x, y, width, height } = selection;
    mask.setAttribute('d', `M${bounds.x} ${bounds.y}h${bounds.width}v${bounds.height}h${-bounds.width}Z M${x} ${y}h${width}v${height}h${-width}Z`);
    const pixels = exportPixelSize(selection, longestEdge);
    dialog.querySelector('output')!.textContent = `${pixels.width} × ${pixels.height} px`;
  };
  for (const input of fields) input.onchange = () => {
    const key = input.dataset.field as keyof ExportRect;
    if (input.value.trim() && Number.isFinite(input.valueAsNumber)) selection = clampExportRect({ ...selection, [key]: input.valueAsNumber }, bounds);
    refresh();
  };
  const point = (event: PointerEvent): { x: number; y: number } => {
    const r = overlay.getBoundingClientRect();
    return {
      x: Math.max(bounds.x, Math.min(bounds.x + bounds.width, bounds.x + (event.clientX - r.left) / r.width * bounds.width)),
      y: Math.max(bounds.y, Math.min(bounds.y + bounds.height, bounds.y + (event.clientY - r.top) / r.height * bounds.height)),
    };
  };
  let drag: { start: { x: number; y: number }; rect: ExportRect; move: boolean; id: number } | undefined;
  overlay.onpointerdown = event => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    const start = point(event);
    // The full-map rectangle initially acts as a drawing surface.
    const move = event.target === frame && (selection.width < bounds.width || selection.height < bounds.height);
    drag = { start, rect: { ...selection }, move, id: event.pointerId };
    overlay.setPointerCapture(event.pointerId);
  };
  overlay.onpointermove = event => {
    if (!drag || event.pointerId !== drag.id) return;
    const p = point(event), { start, rect, move } = drag;
    selection = clampExportRect(move ? { ...rect, x: rect.x + p.x - start.x, y: rect.y + p.y - start.y }
      : { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) }, bounds);
    refresh();
  };
  const endDrag = (event: PointerEvent): void => {
    if (drag?.id !== event.pointerId) return;
    if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId);
    drag = undefined;
  };
  overlay.onpointerup = endDrag; overlay.onpointercancel = endDrag;
  dialog.querySelector<HTMLButtonElement>('[data-action="reset"]')!.onclick = () => { selection = { ...bounds }; refresh(); };
  refresh();
  document.body.append(dialog);
  localize?.(dialog);
  return new Promise((resolve, reject) => {
    let result: CroppedExport | null = null;
    dialog.onclose = () => { URL.revokeObjectURL(url); dialog.remove(); resolve(result); };
    dialog.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.onclick = () => dialog.close();
    dialog.querySelector<HTMLButtonElement>('[data-action="export"]')!.onclick = () => {
      const pixels = exportPixelSize(selection, longestEdge);
      svg.setAttribute('viewBox', `${selection.x} ${selection.y} ${selection.width} ${selection.height}`);
      svg.setAttribute('width', String(pixels.width)); svg.setAttribute('height', String(pixels.height));
      result = { blob: new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }), ...pixels };
      dialog.close();
    };
    try { dialog.showModal(); } catch (error) { URL.revokeObjectURL(url); dialog.remove(); reject(error); }
  });
}
