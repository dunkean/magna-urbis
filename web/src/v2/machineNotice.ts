/** Dismissible notice, shown when automatic selection puts the device at the Minimal or Economy level. */
import { onLanguageChange, registerMessages, setText, translate } from './i18n';
import type { MachineDecision } from './machineTier';
const reasons = {
  forced: ['the machine tier was forced by the URL', 'le niveau de la machine a été forcé dans l’URL'],
  preference: ['it was chosen in the settings', 'il a été choisi dans les réglages'],
  software: ['graphics are rendered in software', 'le rendu graphique est logiciel'],
  webgl: ['WebGL2 is unavailable', 'WebGL2 est indisponible'],
  compositor: ['the graphics compositor is unavailable', 'le compositeur graphique est indisponible'],
  resources: ['available CPU, memory and GPU resources are limited', 'les ressources CPU, mémoire et GPU disponibles sont limitées'],
  frames: ['map navigation frames were slow', 'les images de navigation étaient lentes'],
  normal: ['hardware resources are available', 'les ressources matérielles sont disponibles'],
} as const;
const message = '{level} performance was selected for this device because {reason}.';
registerMessages(Object.fromEntries(Object.values(reasons).map(([en, fr]) => [en, { en, fr }])));
registerMessages({
  [message]: { en: message, fr: 'Le niveau de performance {level} a été choisi pour cet appareil car {reason}.' },
  'Use full quality': { en: 'Use full quality', fr: 'Utiliser la qualité complète' },
  'Dismiss machine notice': { en: 'Dismiss machine notice', fr: 'Fermer l’avis sur la machine' },
  Minimal: { en: 'Minimal', fr: 'Minimal' },
  Economy: { en: 'Economy', fr: 'Économie' },
});
export function showMachineNotice(choice: MachineDecision, full: () => void): () => void {
  const banner = document.createElement('div'),
    text = document.createElement('span'),
    restore = document.createElement('button'),
    close = document.createElement('button');
  banner.id = 'machine-notice';
  banner.setAttribute('role', 'status');
  // Narrow screens (workbench.css, max-width 720px) fix the Workshop button 16px above the bottom left: stay above it and wrap.
  const narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches;
  banner.style.cssText = `position:fixed;bottom:${narrow ? 'calc(64px + env(safe-area-inset-bottom, 0px))' : '42px'};left:50%;transform:translateX(-50%);z-index:1000;box-sizing:border-box;width:max-content;max-width:calc(100vw - ${narrow ? 24 : 40}px);padding:8px 12px;border:1px solid #c4bcac;border-radius:6px;background:#f4f1ea;color:#4c493f;font:12px/1.4 system-ui;display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center`;
  text.style.cssText = 'flex:1 1 220px;min-width:0';
  restore.type = close.type = 'button';
  close.textContent = '×';
  const sync = () => {
    text.textContent = translate(message)
      .replace('{level}', translate(choice.level === 'minimal' ? 'Minimal' : 'Economy'))
      .replace('{reason}', translate(reasons[choice.reason][0]));
    setText(restore, 'Use full quality');
    close.setAttribute('aria-label', translate('Dismiss machine notice'));
  };
  const off = onLanguageChange(sync),
    remove = () => {
      off();
      banner.remove();
    };
  restore.onclick = () => {
    remove();
    full();
  };
  close.onclick = remove;
  sync();
  banner.append(text, restore, close);
  document.body.append(banner);
  return remove;
}
