/** The page's 2D padlock combines the saved preference with the machine's 3D capability.
 * Capability changes only affect the effective lock: only a user's click writes the preference. */
import type { Viewer } from '../../ui/viewer';
import { insertHTML, registerMessages, translate } from '../i18n';
import { machineDecision, onMachineDecision } from '../machineTier';
import { machineViewDefaults } from '../machineView';
import { $ } from './dom';
import { isFirefox } from '../../ui/firefox';

const STORAGE_KEY = 'magna-urbis-v2-lock-2d';
const UNAVAILABLE = '3D needs a graphics card; this browser cannot use hardware graphics.';
export const FIREFOX_3D_UNAVAILABLE = 'Firefox cannot start 3D on this device. Try opening this map in Chrome or Edge.';
const LOCKED = 'The map is locked in 2D: unlock it with the padlock to tilt it.';
const PADLOCK_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="3" y="7" width="10" height="7.5" rx="1.5" fill="currentColor"/><path data-shackle d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

registerMessages({
  'Lock the map in 2D': { en: 'Lock the map in 2D', fr: 'Verrouiller la carte en 2D' },
  'Unlock the 3D view': { en: 'Unlock the 3D view', fr: 'Déverrouiller la vue 3D' },
  [LOCKED]: { en: LOCKED, fr: 'La carte est verrouillée en 2D : déverrouillez-la avec le cadenas pour l’incliner.' },
  [UNAVAILABLE]: { en: UNAVAILABLE, fr: 'La 3D nécessite une carte graphique ; ce navigateur ne peut pas utiliser l’accélération graphique.' },
  [FIREFOX_3D_UNAVAILABLE]: { en: FIREFOX_3D_UNAVAILABLE, fr: 'Firefox ne peut pas démarrer la 3D sur cet appareil. Essaie d’ouvrir cette carte dans Chrome ou Edge.' },
});

function label(element: Element, attribute: 'title' | 'aria-label', source: string | undefined): void {
  if (source === undefined) {
    element.removeAttribute(`data-i18n-${attribute}`);
    element.removeAttribute(attribute);
    return;
  }
  element.setAttribute(`data-i18n-${attribute}`, source);
  element.setAttribute(attribute, translate(source));
}

export function mountViewLock(viewer: Viewer): void {
  insertHTML($('#view3d'), 'beforebegin', `<button id="view-lock2d" type="button" aria-pressed="false">${PADLOCK_ICON}</button>`);
  const lock = $<HTMLButtonElement>('#view-lock2d'),
    button = $<HTMLButtonElement>('#view3d'),
    shackle = lock.querySelector('[data-shackle]')!;
  let preferred = false;
  try {
    preferred = globalThis.localStorage?.getItem(STORAGE_KEY) === '1';
  } catch {
    /* Optional storage. */
  }
  const apply = (): void => {
    const decision = machineDecision(),
      available = machineViewDefaults(decision.tier).available,
      locked = !available || preferred;
    viewer.setTiltLocked(locked);
    lock.disabled = !available;
    lock.setAttribute('aria-pressed', String(locked));
    // Open shackle while unlocked: the right arm lifted off the body.
    shackle.setAttribute('d', locked ? 'M5 7V5a3 3 0 0 1 6 0v2' : 'M5 7V5a3 3 0 0 1 6 0v-1');
    const action = !available ? UNAVAILABLE : locked ? 'Unlock the 3D view' : 'Lock the map in 2D';
    label(lock, 'title', action);
    label(lock, 'aria-label', action);
    // Keep the explanation reachable on touchscreens and in Firefox.
    const unavailable = isFirefox() ? FIREFOX_3D_UNAVAILABLE : UNAVAILABLE;
    button.disabled = available ? preferred : !decision.handheld && !isFirefox();
    label(button, 'title', !available ? unavailable : locked ? LOCKED : undefined);
  };
  onMachineDecision(apply);
  apply();
  lock.onclick = () => {
    if (lock.disabled) return;
    preferred = !preferred;
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, preferred ? '1' : '0');
    } catch {
      /* Optional storage. */
    }
    apply();
  };
}
