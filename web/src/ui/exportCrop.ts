import './exportCrop.css';
import { clampExportRect, exportPixelSize, resizeExportRect, type ExportHandle, type ExportRect } from './exportCropGeometry';

export interface CroppedExport {
  blob: Blob;
  width: number;
  height: number;
}
export interface ExportArea {
  rect: ExportRect;
  width: number;
  height: number;
}

/** Preview the captured SVG, then change only its viewport. The generated map stays intact. */
export async function chooseExportCrop(blob: Blob, longestEdge: number, localize?: (dialog: HTMLDialogElement) => void): Promise<CroppedExport | null> {
  const doc = new DOMParser().parseFromString(await blob.text(), 'image/svg+xml');
  const svg = doc.documentElement;
  const values = (svg.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (svg.localName !== 'svg' || values.length !== 4 || !values.every(Number.isFinite) || values[2] <= 0 || values[3] <= 0) {
    throw new Error('Invalid SVG export bounds');
  }
  const bounds: ExportRect = { x: values[0], y: values[1], width: values[2], height: values[3] };
  const area = await chooseExportArea(blob, bounds, longestEdge, localize);
  if (!area) return null;
  const { rect, width, height } = area;
  svg.setAttribute('viewBox', `${rect.x} ${rect.y} ${rect.width} ${rect.height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  return { blob: new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }), width, height };
}

/** The same crop UI accepts vector and raster previews. Bounds are map metres. */
export function chooseExportArea(blob: Blob, bounds: ExportRect, longestEdge: number, localize?: (dialog: HTMLDialogElement) => void, validate?: (rect: ExportRect) => string | undefined): Promise<ExportArea | null> {
  let selection = { ...bounds };
  const dialog = document.createElement('dialog');
  dialog.className = 'export-crop';
  dialog.setAttribute('aria-labelledby', 'export-crop-title');
  dialog.setAttribute('aria-describedby', 'export-crop-help');
  dialog.innerHTML = `<div class="dialog-head">
      <h2 id="export-crop-title">Recadrer l’export</h2>
      <button type="button" data-action="cancel" aria-label="Fermer">×</button>
    </div>
    <p id="export-crop-help" class="export-crop-help">Tracez le cadre sur la carte, puis déplacez-le ou tirez ses poignées.</p>
    <div class="export-crop-stage">
      <div class="export-crop-preview">
        <img alt="Aperçu de la carte à exporter" draggable="false">
        <div class="export-crop-overlay" aria-hidden="true">
          <div class="export-crop-frame" hidden>
            ${(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map(handle => `<span data-handle="${handle}"></span>`).join('')}
          </div>
        </div>
      </div>
    </div>
    <div class="export-crop-info">
      <dl>
        <div><dt>Dimensions sur la carte</dt><dd><output data-size="map" aria-live="off"></output></dd></div>
        <div><dt>Taille en pixels</dt><dd><output data-size="pixels" aria-live="off"></output></dd></div>
      </dl>
      <button type="button" data-action="reset">Carte entière</button>
    </div>
    <details class="export-crop-details">
      <summary>Coordonnées et dimensions</summary>
      <div class="export-crop-fields">${[
        ['x', 'X (m)'],
        ['y', 'Y (m)'],
        ['width', 'Largeur (m)'],
        ['height', 'Hauteur (m)'],
      ]
        .map(([key, label]) => `<label>${label}<input data-field="${key}" type="number" step="any"></label>`)
        .join('')}</div>
    </details>
    <p class="export-crop-help" role="status" data-crop-validation hidden></p>
    <div class="dialog-actions">
      <button type="button" data-action="cancel">Annuler</button>
      <button type="button" class="primary" data-action="export">Exporter</button>
    </div>`;
  const preview = dialog.querySelector<HTMLElement>('.export-crop-preview')!;
  const image = dialog.querySelector('img')!;
  const overlay = dialog.querySelector<HTMLElement>('.export-crop-overlay')!;
  const frame = dialog.querySelector<HTMLElement>('.export-crop-frame')!;
  const mapSize = dialog.querySelector<HTMLOutputElement>('[data-size="map"]')!;
  const pixelSize = dialog.querySelector<HTMLOutputElement>('[data-size="pixels"]')!;
  const fields = Array.from(dialog.querySelectorAll<HTMLInputElement>('input'));
  const validation = dialog.querySelector<HTMLElement>('[data-crop-validation]')!;
  const submit = dialog.querySelector<HTMLButtonElement>('[data-action="export"]')!;
  const distanceFormat = new Intl.NumberFormat(document.documentElement.lang || 'fr', { maximumSignificantDigits: 4 });
  const pixelFormat = new Intl.NumberFormat(document.documentElement.lang || 'fr');
  const url = URL.createObjectURL(blob);
  image.src = url;
  preview.style.setProperty('--crop-aspect', String(bounds.width / bounds.height));
  const refresh = (): void => {
    const { x, y, width, height } = selection;
    frame.hidden = width === bounds.width && height === bounds.height;
    frame.style.left = `${((x - bounds.x) / bounds.width) * 100}%`;
    frame.style.top = `${((y - bounds.y) / bounds.height) * 100}%`;
    frame.style.width = `${(width / bounds.width) * 100}%`;
    frame.style.height = `${(height / bounds.height) * 100}%`;
    const kilometres = Math.min(width, height) >= 1000;
    const divisor = kilometres ? 1000 : 1;
    mapSize.value = `${distanceFormat.format(width / divisor)} × ${distanceFormat.format(height / divisor)} ${kilometres ? 'km' : 'm'}`;
    const pixels = exportPixelSize(selection, longestEdge);
    pixelSize.value = `${pixelFormat.format(pixels.width)} × ${pixelFormat.format(pixels.height)} px`;
    const problem = validate?.(selection);
    validation.textContent = problem ?? '';
    validation.hidden = !problem;
    submit.disabled = !!problem;
    for (const input of fields) {
      const key = input.dataset.field as keyof ExportRect;
      input.value = String(Number(selection[key].toFixed(3)));
    }
  };
  for (const input of fields)
    input.onchange = () => {
      const key = input.dataset.field as keyof ExportRect;
      if (Number.isFinite(input.valueAsNumber)) selection = clampExportRect({ ...selection, [key]: input.valueAsNumber }, bounds);
      refresh();
    };

  const point = ({ clientX, clientY }: PointerEvent) => {
    const box = overlay.getBoundingClientRect();
    return { x: bounds.x + Math.max(0, Math.min(1, (clientX - box.left) / box.width)) * bounds.width, y: bounds.y + Math.max(0, Math.min(1, (clientY - box.top) / box.height)) * bounds.height };
  };
  let drag: { id: number; mode: 'draw' | 'move' | ExportHandle; start: ReturnType<typeof point>; clientX: number; clientY: number; initial: ExportRect; changed: boolean } | undefined;

  overlay.onpointerdown = event => {
    if (event.button !== 0 || drag) return;
    const target = event.target as HTMLElement;
    const handle = target.dataset.handle as ExportHandle | undefined;
    drag = { id: event.pointerId, mode: handle ?? (frame.contains(target) ? 'move' : 'draw'), start: point(event), clientX: event.clientX, clientY: event.clientY, initial: selection, changed: false };
    overlay.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const updateDrag = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.id) return;
    if (!drag.changed && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 3) return;
    drag.changed = true;
    overlay.dataset.drag = drag.mode;
    const { x, y } = point(event);
    const { start, initial, mode } = drag;
    const dx = x - start.x,
      dy = y - start.y;
    if (mode === 'move') selection = clampExportRect({ ...initial, x: initial.x + dx, y: initial.y + dy }, bounds);
    else if (mode === 'draw') selection = clampExportRect({ x: Math.min(x, start.x), y: Math.min(y, start.y), width: Math.abs(dx), height: Math.abs(dy) }, bounds);
    else selection = resizeExportRect(initial, bounds, mode, dx, dy);
    refresh();
  };
  const endDrag = (event: PointerEvent): void => {
    if (!drag || drag.id !== event.pointerId) return;
    if (event.type === 'pointerup') updateDrag(event);
    else {
      selection = drag.initial;
      refresh();
    }
    drag = undefined;
    delete overlay.dataset.drag;
    if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId);
  };
  overlay.onpointermove = updateDrag;
  overlay.onpointerup = overlay.onpointercancel = overlay.onlostpointercapture = endDrag;
  dialog.querySelector<HTMLButtonElement>('[data-action="reset"]')!.onclick = () => {
    selection = { ...bounds };
    refresh();
  };
  refresh();
  document.body.append(dialog);
  localize?.(dialog);
  return new Promise((resolve, reject) => {
    let result: ExportArea | null = null;
    const dispose = (): void => {
      URL.revokeObjectURL(url);
      dialog.remove();
    };
    dialog.onclose = () => {
      dispose();
      resolve(result);
    };
    dialog.querySelectorAll<HTMLButtonElement>('[data-action="cancel"]').forEach(button => (button.onclick = () => dialog.close()));
    submit.onclick = () => {
      result = { rect: { ...selection }, ...exportPixelSize(selection, longestEdge) };
      dialog.close();
    };
    try {
      dialog.showModal();
    } catch (error) {
      dispose();
      reject(error);
    }
  });
}
