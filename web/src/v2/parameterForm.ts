import { bindTree, setText } from './i18n';

export interface ParameterChoice { value: string; label: string }
export interface ParameterField {
  path: string;
  label: string;
  help?: string;
  type: 'number' | 'select' | 'boolean' | 'text';
  options?: readonly ParameterChoice[];
  min?: number;
  max?: number;
  step?: number | 'any';
  placeholder?: string;
  optional?: boolean;
  unit?: string;
  id?: string;
  /** Display conversions (for example, fractions shown as percentages). */
  toInput?: (value: unknown) => unknown;
  fromInput?: (value: unknown) => unknown;
  suggestions?: readonly string[];
}
export interface ParameterFormBindings {
  getValue(path: string): unknown;
  setValue(path: string, value: unknown): void;
  disabled?: () => boolean;
}
export interface ParameterForm { sync(): void; dispose(): void }
let parameterFormSequence = 0;

/** Shared scalar editor. It never rebuilds controls when values or language change. */
export function mountParameterForm(root: HTMLElement, fields: readonly ParameterField[], bindings: ParameterFormBindings): ParameterForm {
  root.classList.add('parameter-form');
  const namespace = root.id || `form-${++parameterFormSequence}`;
  const cleanups: (() => void)[] = [];
  const controls: { field: ParameterField; input: HTMLInputElement | HTMLSelectElement }[] = [];
  for (const field of fields) {
    const label = document.createElement('label'); label.className = `parameter-field parameter-${field.type}`;
    label.dataset.fieldPath = field.path;
    const caption = document.createElement('span'); caption.className = 'parameter-caption'; setText(caption, field.label); label.append(caption);
    let input: HTMLInputElement | HTMLSelectElement;
    if (field.type === 'select' || field.type === 'boolean' && field.optional) {
      input = document.createElement('select');
      const choices = field.type === 'boolean' ? [{ value: '', label: 'Inherited default' }, { value: 'true', label: 'Enabled' }, { value: 'false', label: 'Disabled' }] : field.options ?? [];
      if (field.type === 'select' && field.optional) { const option = document.createElement('option'); option.value = ''; setText(option, 'Inherited default'); input.append(option); }
      for (const choice of choices) { const option = document.createElement('option'); option.value = choice.value; setText(option, choice.label); input.append(option); }
    } else {
      input = document.createElement('input'); input.type = field.type === 'boolean' ? 'checkbox' : field.type;
      if (field.min !== undefined) input.min = String(field.min);
      if (field.max !== undefined) input.max = String(field.max);
      if (field.step !== undefined) input.step = String(field.step);
      if (field.placeholder) input.placeholder = field.placeholder;
      if (field.suggestions?.length) {
        const list = document.createElement('datalist'); list.id = `${namespace}-suggest-${field.path.replace(/[^a-z0-9]/gi, '-')}`;
        for (const value of field.suggestions) { const option = document.createElement('option'); option.value = value; list.append(option); }
        input.setAttribute('list', list.id); label.append(list);
      }
    }
    input.id = field.id ?? `${namespace}-parameter-${field.path.replace(/[^a-z0-9]/gi, '-')}`;
    input.dataset.settingPath = field.path;
    input.setAttribute('aria-label', field.label);
    label.append(input);
    if (field.unit) { const unit = document.createElement('span'); unit.className = 'parameter-unit'; setText(unit, field.unit); label.append(unit); }
    if (field.help) { const help = document.createElement('small'); help.className = 'parameter-help'; help.id = `${input.id}-help`; setText(help, field.help); input.setAttribute('aria-describedby', help.id); label.append(help); }
    const onInput = () => {
      let value: unknown;
      if (field.type === 'boolean') value = field.optional ? input.value === '' ? undefined : input.value === 'true' : (input as HTMLInputElement).checked;
      else if (field.type === 'number') {
        if (input.value.trim() === '' && field.optional) value = undefined;
        else { value = input.value.trim() === '' ? NaN : Number(input.value); if (!Number.isFinite(value) || field.min !== undefined && (value as number) < field.min || field.max !== undefined && (value as number) > field.max) { input.setAttribute('aria-invalid', 'true'); return; } }
      } else value = field.optional && input.value === '' ? undefined : input.value;
      input.removeAttribute('aria-invalid');
      bindings.setValue(field.path, field.fromInput && value !== undefined ? field.fromInput(value) : value);
    };
    const event = field.type === 'boolean' || field.type === 'select' ? 'change' : 'input';
    input.addEventListener(event, onInput); cleanups.push(() => input.removeEventListener(event, onInput));
    controls.push({ field, input }); root.append(label);
  }
  bindTree(root);
  const sync = () => {
    for (const { field, input } of controls) {
      input.disabled = bindings.disabled?.() ?? false;
      // Preserve partial numbers and the caret while the person edits a field.
      if (input === document.activeElement) continue;
      const raw = bindings.getValue(field.path), value = raw !== undefined && field.toInput ? field.toInput(raw) : raw;
      if (field.type === 'boolean' && !field.optional) (input as HTMLInputElement).checked = value === true;
      else {
        const text = value === undefined || value === null ? '' : String(value);
        if (input instanceof HTMLSelectElement && text !== '' && !Array.from(input.options).some(option => option.value === text)) {
          const retained = document.createElement('option'); retained.value = text; retained.textContent = text; retained.dataset.l10nKeep = ''; input.append(retained);
        }
        input.value = text;
      }
      input.removeAttribute('aria-invalid');
    }
  };
  sync(); return { sync, dispose: () => { cleanups.forEach(cleanup => cleanup()); root.replaceChildren(); } };
}

export function readSettingPath(root: unknown, path: string): unknown {
  let value = root;
  for (const key of path.split('.')) { if (value === null || typeof value !== 'object') return undefined; value = (value as Record<string, unknown>)[key]; }
  return value;
}
export function writeSettingPath(root: object, path: string, value: unknown): void {
  const keys = path.split('.'); let target = root as Record<string, unknown>;
  for (let index = 0; index < keys.length - 1; index++) {
    const key = keys[index];
    if (target[key] === null || typeof target[key] !== 'object') target[key] = /^\d+$/.test(keys[index + 1] ?? '') ? [] : {};
    target = target[key] as Record<string, unknown>;
  }
  if (value === undefined) delete target[keys.at(-1)!]; else target[keys.at(-1)!] = value;
}
