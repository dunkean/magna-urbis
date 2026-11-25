/** Map pins (`settings.pins`): a "Drop pin" toggle in the view strip, numbered markers on the map (SVG overlay, as
 * the measure tool) and `centerOn` for the pin list. Coordinates are integer world metres; they travel in the short
 * code, the optional texts only in the project. */
import type { View } from '../render/view';
import type { ScreenProjection } from '../render/world/camera';
import type { V2Settings } from './contracts';
import { insertHTML, registerMessages, setText, translate } from './i18n';
import './pinTool.css';

registerMessages({
  'Drop pin': { en: 'Drop pin', fr: 'Poser une épingle' },
  Pins: { en: 'Pins', fr: 'Épingles' },
  'Pin text': { en: 'Pin text', fr: 'Texte de l’épingle' },
  'Remove pin': { en: 'Remove pin', fr: 'Supprimer l’épingle' },
  'Show on the map': { en: 'Show on the map', fr: 'Afficher sur la carte' },
  'Click on the map to drop a pin. Pins are shared with the map code.': { en: 'Click on the map to drop a pin. Pins are shared with the map code.', fr: 'Cliquez sur la carte pour poser une épingle. Les épingles sont partagées avec le code de la carte.' },
});

export interface PinToolApi {
  map: HTMLElement;
  canvas: HTMLCanvasElement;
  slot: HTMLElement;
  getView(): View;
  setView(view: View): void;
  /** Where the ground is on screen, in the top view or tilted. */
  projection(): ScreenProjection;
  groundAt(sx: number, sy: number): { x: number; y: number } | undefined;
  getMapSize(): number | undefined;
  getSettings(): V2Settings;
  /** The pins changed (recipe edit). */
  changed(): void;
}
const PIN_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" d="M12 21s-6-6.2-6-11a6 6 0 0 1 12 0c0 4.8-6 11-6 11z"/><circle cx="12" cy="10" r="2.2" fill="currentColor"/></svg>';
const CLICK_SLOP_PX = 5;

export function mountPinTool(api: PinToolApi): void {
  const { map, canvas } = api;
  const ns = 'http://www.w3.org/2000/svg';
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'pin-tool';
  button.className = 'measure-tool-button';
  button.setAttribute('aria-pressed', 'false');
  button.innerHTML = `${PIN_ICON}<span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap"></span>`;
  setText(button.querySelector('span')!, 'Drop pin');
  button.title = 'Click on the map to drop a pin. Pins are shared with the map code.';
  button.setAttribute('data-i18n-title', button.title);
  api.slot.append(button);
  insertHTML(button, 'afterend', '<button id="pins-open" type="button" aria-haspopup="dialog" aria-controls="pins-dialog" hidden>Pins</button>');
  insertHTML(
    map,
    'afterend',
    `<dialog id="pins-dialog" aria-labelledby="pins-title">
      <div class="dialog-head"><h2 id="pins-title">Pins</h2><button type="button" aria-label="Close">×</button></div>
      <ol></ol>
    </dialog>`,
  );
  const openPins = document.querySelector<HTMLButtonElement>('#pins-open')!;
  const pinDialog = document.querySelector<HTMLDialogElement>('#pins-dialog')!;
  const pinList = pinDialog.querySelector('ol')!;
  pinDialog.querySelector('button')!.onclick = () => pinDialog.close();
  const svg = document.createElementNS(ns, 'svg');
  svg.classList.add('pin-overlay');
  svg.setAttribute('aria-hidden', 'true');
  map.append(svg);

  let active = false,
    frame = 0,
    press: { id: number; x: number; y: number } | undefined;
  const pins = () => api.getSettings().pins ?? [];
  const at: [number, number] = [0, 0];
  function renderPins(): void {
    pinList.replaceChildren();
    pins().forEach((pin, index) => {
      const item = document.createElement('li');
      const locate = document.createElement('button');
      const label = document.createElement('input');
      const remove = document.createElement('button');
      locate.type = remove.type = 'button';
      locate.className = 'quiet';
      locate.textContent = `#${index + 1} x=${Math.round(pin.x)} y=${Math.round(pin.y)}`;
      locate.setAttribute('aria-label', translate('Show on the map'));
      locate.onclick = () => {
        pinDialog.close();
        api.setView({ ...api.getView(), cx: pin.x, cy: pin.y });
        schedule();
      };
      label.value = pin.text ?? '';
      label.maxLength = 80;
      label.setAttribute('aria-label', translate('Pin text'));
      label.placeholder = translate('Pin text');
      label.onchange = () => {
        if (label.value.trim()) pin.text = label.value.trim();
        else delete pin.text;
        api.changed();
      };
      remove.textContent = '×';
      remove.setAttribute('aria-label', translate('Remove pin'));
      remove.onclick = () => {
        pins().splice(index, 1);
        if (!pins().length) {
          delete api.getSettings().pins;
          pinDialog.close();
        }
        api.changed();
        renderPins();
      };
      item.append(locate, ' ', label, remove);
      pinList.append(item);
    });
  }
  openPins.onclick = () => {
    renderPins();
    pinDialog.showModal();
  };
  function draw(): void {
    frame = 0;
    const projection = api.projection(),
      list = pins();
    while (svg.childElementCount > list.length) svg.lastElementChild!.remove();
    while (svg.childElementCount < list.length) {
      const group = document.createElementNS(ns, 'g'),
        marker = document.createElementNS(ns, 'path'),
        label = document.createElementNS(ns, 'text');
      group.classList.add('pin-marker');
      marker.setAttribute('d', 'M0 0c-5-7-9-11-9-16a9 9 0 0 1 18 0c0 5-4 9-9 16z');
      label.setAttribute('y', '-13');
      label.setAttribute('text-anchor', 'middle');
      group.append(marker, label);
      svg.append(group);
    }
    list.forEach((pin, i) => {
      const group = svg.children[i] as SVGGElement;
      // A pin behind a tilted camera has no place on screen.
      group.style.display = projection.project(pin.x, pin.y, at) ? '' : 'none';
      group.setAttribute('transform', `translate(${at[0].toFixed(1)} ${at[1].toFixed(1)})`);
      group.lastElementChild!.textContent = String(i + 1);
      const title = pin.text ? `#${i + 1} ${pin.text}` : `#${i + 1}`;
      if (group.dataset.title !== title) {
        group.dataset.title = title;
        group.querySelector('title')?.remove();
        const tip = document.createElementNS(ns, 'title');
        tip.textContent = title;
        group.append(tip);
      }
    });
    // The view moves with gestures and animations: follow it while pins are shown, as the measure overlay does.
    if (list.length || active) frame = requestAnimationFrame(draw);
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };
  const setActive = (on: boolean) => {
    active = on;
    button.setAttribute('aria-pressed', String(on));
    map.querySelector('.canvas-wrap')?.classList.toggle('pinning', on);
    schedule();
  };
  button.onclick = () => {
    // One map tool at a time.
    if (!active) window.dispatchEvent(new CustomEvent('v2-edit-mode', { detail: 'navigate' }));
    setActive(!active);
  };
  window.addEventListener('v2-edit-mode', event => {
    if ((event as CustomEvent<string>).detail !== 'navigate') setActive(false);
  });
  window.addEventListener('keydown', event => {
    if (active && event.key === 'Escape') setActive(false);
  });
  canvas.addEventListener('pointerdown', e => {
    if (active && e.button === 0) press = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', e => {
    if (!active || !press || press.id !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_SLOP_PX;
    press = undefined;
    if (moved) return; // A drag pans the map.
    const r = map.getBoundingClientRect(),
      point = api.groundAt(e.clientX - r.left, e.clientY - r.top),
      size = api.getMapSize();
    if (!point || size === undefined) return;
    const { x, y } = point;
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const settings = api.getSettings();
    (settings.pins ??= []).push({ x: Math.round(x), y: Math.round(y) });
    api.changed();
    schedule();
  });
  canvas.addEventListener('pointercancel', () => (press = undefined));
  const syncPins = () => {
    openPins.hidden = pins().length === 0;
    schedule();
  };
  window.addEventListener('v2-recipe-change', syncPins);
  syncPins();
}
