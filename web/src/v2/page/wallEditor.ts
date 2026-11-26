import type { WallOverride } from '../../../../rust/bridge/urbanConfig';
import { nativeCityRecords } from '../nativeProducts';
import { chooseAction } from '../actionDialog';
import { registerMessages, setHTML, translate } from '../i18n';
import { validateSettings } from '../project';
import type { PageState, PageActions } from './contract';
import { options, tri, wallStyles } from './dom';

registerMessages({
  'Land gate target': { en: 'Land gate target', fr: 'Nombre de portes terrestres souhaité' },
  'Required road and water crossings stay open.': { en: 'Required road and water crossings stay open.', fr: 'Les passages routiers indispensables et les portes d’eau restent ouverts.' },
});

async function wallDialog(state: PageState, actions: PageActions, town: string, key: string): Promise<void> {
  const current = state.settings.urban?.local?.[town]?.layout?.overrides?.walls?.[key] ?? {};
  const form = document.createElement('form');
  setHTML(
    form,
    `<label>Fortifications<select name="present">${options(tri)}</select></label>
    <label>Fortification style<select name="style">${options([['auto', 'Automatic'], ...wallStyles.slice(1)])}</select></label>
    <label>Moat<select name="moat">${options([
      ['auto', 'Automatic'],
      ['none', 'None'],
      ['dry', 'Dry'],
      ['wet', 'Wet (water-filled)'],
    ])}</select></label>
    <label>Land gate target<input type="number" name="gates" min="0" max="64" step="1"></label>`,
  );
  form.onsubmit = e => e.preventDefault();
  const select = (name: string) => form.elements.namedItem(name) as HTMLSelectElement;
  const gates = form.elements.namedItem('gates') as HTMLInputElement;
  select('present').value = current.present === undefined ? 'auto' : current.present ? 'yes' : 'no';
  select('style').value = current.style ?? 'auto';
  select('moat').value = current.moat ?? 'auto';
  gates.value = current.gates?.toString() ?? '';
  gates.placeholder = translate('Automatic');
  const result = await chooseAction({
    id: 'wall-editor',
    title: 'Fortifications',
    message: 'Required road and water crossings stay open.',
    details: [state.world?.settlements?.find(s => s.key === town)?.name ?? town, key],
    content: form,
    choices: [
      { value: 'cancel', label: 'Cancel' },
      { value: 'apply', label: 'Apply', primary: true },
    ],
    cancelValue: 'cancel',
    accept: () => form.reportValidity(),
  });
  if (result.value !== 'apply' || state.busy) return;
  const edit: WallOverride = {};
  if (select('present').value !== 'auto') edit.present = select('present').value === 'yes';
  if (select('style').value !== 'auto') edit.style = select('style').value as WallOverride['style'];
  if (select('moat').value !== 'auto') edit.moat = select('moat').value as WallOverride['moat'];
  if (gates.value !== '') edit.gates = gates.valueAsNumber;
  if ((['present', 'style', 'moat', 'gates'] as const).every(field => edit[field] === current[field])) return;
  const urban = state.settings.urban,
    scope = urban?.local?.[town],
    walls = { ...scope?.layout?.overrides?.walls };
  if (Object.keys(edit).length) walls[key] = edit;
  else delete walls[key];
  const next = { ...state.settings, urban: { ...urban, local: { ...urban?.local, [town]: { ...scope, layout: { ...scope?.layout, overrides: { ...scope?.layout?.overrides, walls } } } } } };
  validateSettings(next);
  state.settings = next;
  actions.touchRecipe();
  await actions.generate('town', town, undefined, undefined, undefined, undefined, false, true);
}

export function editWall(state: PageState, actions: PageActions, town: string, index: number): boolean {
  const wall = nativeCityRecords(state.world)?.[town]?.layouts[0]?.enclosures?.[index];
  if (state.busy || !wall?.edit_key) return false;
  void wallDialog(state, actions, town, wall.edit_key).catch(actions.reportAppearanceError);
  return true;
}

/** A removed circuit can still be restored or reset from its town. */
export function editRemovedWalls(host: HTMLElement, state: PageState, actions: PageActions, town: string): void {
  for (const [key, edit] of Object.entries(state.settings.urban?.local?.[town]?.layout?.overrides?.walls ?? {})) {
    if (edit.present !== false) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'small';
    button.textContent = `${translate('Edit')} · ${translate('Wall')} · ${key}`;
    button.onclick = () => void wallDialog(state, actions, town, key).catch(actions.reportAppearanceError);
    host.append(button);
  }
}
