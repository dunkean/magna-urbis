import type { V2Settings } from './contracts';
import type { World } from '../gen/types';
import { roadExitReports } from './roadEditing';
import { effectiveRegionalExits, MAX_REGIONAL_EXITS, REGIONAL_EXIT_CLASSES, regionalExitResults } from './regionalExits';
import { onLanguageChange, registerMessages, setText, translate } from './i18n';
import './regionalExitsPanel.css';

const copy = (en: string, fr: string): string => { registerMessages({ [en]: { en, fr } }); return en; };
const T = {
  title: copy('Regional roads', 'Routes régionales'),
  highway: copy('Highway', 'Grande route'), main: copy('Main road', 'Route principale'),
  local: copy('Local road', 'Route locale'), track: copy('Track', 'Chemin'),
  auto: copy('Auto', 'Auto'),
  reset: copy('Restore automatic road counts', 'Rétablir les nombres de routes automatiques'),
  hint: copy('Requested roads from outside the map, via towns across the region. Terrain may prevent some connections.', 'Routes demandées depuis l’extérieur de la carte, via les lieux de toute la région. Le terrain peut empêcher certaines liaisons.'),
  limit: copy('At most 16 regional road exits can be requested.', 'Vous pouvez demander au plus 16 sorties routières régionales.'),
  result: copy('Current map: connected / requested', 'Carte actuelle : raccordées / demandées'),
  automatic: copy('Suggested from the region', 'Suggestion selon la région'),
  manual: copy('Requested count', 'Nombre demandé'),
};

export function mountRegionalExitsPanel(host: HTMLElement, api: {
  getSettings(): V2Settings; getWorld?(): World | undefined; onChange(): void; disabled?(): boolean;
}) {
  const root = document.createElement('section'); root.className = 'regional-exits'; root.dataset.fieldPath = 'roads.exits'; root.dataset.stageControl = 'settle-roads';
  const heading = document.createElement('div'); heading.className = 'regional-exits-heading';
  const title = document.createElement('h4'); setText(title, T.title);
  const reset = document.createElement('button'); reset.type = 'button'; setText(reset, T.auto); heading.append(title, reset);
  const hint = document.createElement('p'); hint.className = 'hint'; setText(hint, T.hint);
  const fields = document.createElement('fieldset'); fields.className = 'regional-exits-fields'; fields.setAttribute('aria-label', translate(T.title));
  const resultHint = document.createElement('p'); resultHint.className = 'hint'; setText(resultHint, T.result);
  root.append(heading, hint, fields, resultHint); host.append(root);
  const controls = REGIONAL_EXIT_CLASSES.map(cls => {
    const row = document.createElement('div'); row.className = 'regional-exit-row'; row.dataset.exitClass = cls;
    const label = document.createElement('label'); label.htmlFor = `regional-exit-${cls}`;
    const swatch = document.createElement('i'); swatch.className = 'regional-road-swatch'; swatch.setAttribute('aria-hidden', 'true');
    const caption = document.createElement('span'); setText(caption, T[cls]); label.append(swatch, caption);
    const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.max = '16'; input.step = '1'; input.id = label.htmlFor;
    input.dataset.settingPath = `region.roads.exits.${cls}`;
    const mode = document.createElement('small'); setText(mode, T.auto);
    const result = document.createElement('output'); result.className = 'regional-exit-result'; result.setAttribute('aria-live', 'polite');
    row.append(label, input, mode, result); fields.append(row);
    input.oninput = () => input.setCustomValidity('');
    input.onchange = () => {
      if (!input.reportValidity()) return;
      const settings = api.getSettings();
      if (settings.region?.roads === null || api.disabled?.()) return;
      const value = input.value === '' ? undefined : Number(input.value);
      const exits = { ...settings.region?.roads?.exits };
      if (value === undefined) delete exits[cls]; else exits[cls] = value;
      if (Object.values(exits).reduce((n, count) => n + (count ?? 0), 0) > MAX_REGIONAL_EXITS) {
        input.setCustomValidity(translate(T.limit)); input.reportValidity(); return;
      }
      settings.region ??= {}; settings.region.roads ??= {}; settings.region.roads.exits = exits;
      api.onChange(); sync();
    };
    return { cls, row, input, mode, result };
  });
  reset.onclick = () => {
    const settings = api.getSettings();
    if (settings.region?.roads === null || api.disabled?.()) return;
    if (settings.region?.roads) delete settings.region.roads.exits;
    controls.forEach(({ input }) => input.setCustomValidity(''));
    api.onChange(); sync();
  };
  function sync(): void {
    const settings = api.getSettings(), exits = effectiveRegionalExits(settings);
    const world=api.getWorld?.(),report=world?roadExitReports(world):undefined;
    const results = report === undefined ? undefined : regionalExitResults(report);
    resultHint.hidden = !results;
    fields.disabled = !!api.disabled?.() || settings.region?.roads === null;
    fields.setAttribute('aria-label', translate(T.title));
    reset.disabled = fields.disabled || !REGIONAL_EXIT_CLASSES.some(cls => settings.region?.roads?.exits?.[cls] !== undefined);
    reset.title = translate(T.reset); reset.setAttribute('aria-label', translate(T.reset));
    for (const { cls, row, input, mode, result } of controls) {
      const automatic = settings.region?.roads?.exits?.[cls] === undefined;
      input.value = String(exits[cls]); input.setCustomValidity('');
      input.setAttribute('aria-label', `${translate(T[cls])} · ${translate(T.manual)}`);
      input.title = translate(automatic ? T.automatic : T.manual);
      row.classList.toggle('is-auto', automatic); mode.hidden = !automatic;
      result.hidden = !results; result.title = translate(T.result);
      result.textContent = results ? `${results[cls].obtained} / ${results[cls].requested}` : '';
      result.setAttribute('aria-label', `${translate(T[cls])} · ${translate(T.result)}: ${result.textContent}`);
    }
  }
  const unsubscribe = onLanguageChange(sync); sync();
  return { sync, dispose: () => { unsubscribe(); root.remove(); } };
}
