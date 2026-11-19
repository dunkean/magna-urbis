/** Dismissible machine-default notice, mounted only when automatic selection changes the normal default. */
import { onLanguageChange, registerMessages, setText, translate } from './i18n';
import type { MachineDecision } from './machineTier';
const reasons = {
  forced: ['the machine tier was forced by the URL', 'le niveau de la machine a été forcé dans l’URL'],
  software: ['graphics are rendered in software', 'le rendu graphique est logiciel'],
  webgl: ['WebGL2 is unavailable', 'WebGL2 est indisponible'],
  resources: ['available CPU, memory and GPU resources are limited', 'les ressources CPU, mémoire et GPU disponibles sont limitées'],
  frames: ['map navigation frames were slow', 'les images de navigation étaient lentes'],
  normal: ['hardware resources are available', 'les ressources matérielles sont disponibles'],
} as const;
const message = '{style} was selected for this machine because {reason}.';
registerMessages(Object.fromEntries(Object.values(reasons).map(([en, fr]) => [en, { en, fr }])));
registerMessages({
  [message]: { en: message, fr: '{style} a été choisi pour cette machine car {reason}.' },
  'Use full style': { en: 'Use full style', fr: 'Utiliser le style complet' },
  'Dismiss machine notice': { en: 'Dismiss machine notice', fr: 'Fermer l’avis sur la machine' },
  'Satellite (fast)': { en: 'Satellite (fast)', fr: 'Satellite (rapide)' },
  'Parchment (fast)': { en: 'Parchment (fast)', fr: 'Parchemin (rapide)' },
  Minimal: { en: 'Minimal', fr: 'Minimal' },
});
export function showMachineNotice(choice: MachineDecision, style: string, full: () => void): () => void {
  const banner = document.createElement('div'),
    text = document.createElement('span'),
    restore = document.createElement('button'),
    close = document.createElement('button');
  banner.id = 'machine-notice';
  banner.setAttribute('role', 'status');
  banner.style.cssText =
    'position:fixed;bottom:42px;left:50%;transform:translateX(-50%);z-index:1000;max-width:calc(100vw - 40px);padding:8px 12px;border:1px solid #c4bcac;border-radius:6px;background:#f4f1ea;color:#4c493f;font:12px/1.4 system-ui;display:flex;gap:12px;align-items:center';
  restore.type = close.type = 'button';
  close.textContent = '×';
  const sync = () => {
    const label = style === 'minimal' ? 'Minimal' : style === 'parchment-light' ? 'Parchment (fast)' : 'Satellite (fast)';
    text.textContent = translate(message).replace('{style}', translate(label)).replace('{reason}', translate(reasons[choice.reason][0]));
    setText(restore, 'Use full style');
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
