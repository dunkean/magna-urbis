import { bindTree, setText, setDynamicText, translate, onLanguageChange } from '../v2/i18n';
import { convertUnits, displayUnit, getDistanceUnit, onUnitsChange, unitInputNumber, type PhysicalUnit } from '../v2/units';

export interface ParameterChoice { value: string; label: string }
export interface ParameterField {
  path: string;
  label: string;
  help?: string;
  type: 'number' | 'select' | 'boolean' | 'text' | 'color';
  options?: readonly ParameterChoice[];
  min?: number;
  max?: number;
  step?: number | 'any';
  placeholder?: string;
  optional?: boolean;
  /** Copy for an automatic native choice; callers need not expose override storage. */
  emptyLabel?: string;
  unit?: string;
  id?: string;
  /** Display conversions (for example, fractions shown as percentages). */
  toInput?: (value: unknown) => unknown;
  fromInput?: (value: unknown) => unknown;
  suggestions?: readonly string[];
  /** number: false drops the range slider (compact rows). */
  slider?: boolean;
  /** color: value written by the automatic button; the colour reads as automatic while the value equals it. */
  resetValue?: unknown;
  /** Shown while the stored value is absent (an optional key whose absence has a meaning). */
  defaultValue?: unknown;
}
export interface ParameterFormBindings {
  getValue(path: string): unknown;
  setValue(path: string, value: unknown): void;
  disabled?: () => boolean;
  isMixed?(path: string): boolean;
}
export interface ParameterForm { sync(): void; dispose(): void }
let parameterFormSequence = 0;
function physicalUnit(field: ParameterField): PhysicalUnit | undefined {
  const unit = field.unit ?? field.label.match(/\((m|km|m²|km²)\)$/)?.[1];
  return unit === 'm' || unit === 'km' || unit === 'm²' || unit === 'km²' ? unit : undefined;
}
function inputConversion(field: ParameterField, value: unknown, inverse = false): unknown {
  const source = physicalUnit(field);
  return source && typeof value === 'number' ? inverse
    ? convertUnits(value, displayUnit(source, getDistanceUnit()), source)
    : unitInputNumber(convertUnits(value, source, displayUnit(source, getDistanceUnit()))) : value;
}
function fieldCaption(field: ParameterField): string {
  const source = physicalUnit(field), text = translate(field.label);
  return source && /\((m|km|m²|km²)\)$/.test(field.label)
    ? `${text.replace(/\s*[（(][^()（）]*[)）]\s*$/, '')} (${displayUnit(source, getDistanceUnit())})` : text;
}

/** Shared scalar editor. It never rebuilds controls when values or language change. */
export function mountParameterForm(root: HTMLElement, fields: readonly ParameterField[], bindings: ParameterFormBindings): ParameterForm {
  root.classList.add('parameter-form');
  const namespace = root.id || `form-${++parameterFormSequence}`;
  const cleanups: (() => void)[] = [];
  const controls: { field: ParameterField; input: HTMLInputElement | HTMLSelectElement; slider?: HTMLInputElement; reset?: HTMLButtonElement }[] = [];
  for (const field of fields) {
    const label = document.createElement('label'); label.className = `parameter-field parameter-${field.type}`;
    label.dataset.fieldPath = field.path;
    const caption = document.createElement('span'); caption.className = 'parameter-caption'; setDynamicText(caption, () => fieldCaption(field)); label.append(caption);
    let input: HTMLInputElement | HTMLSelectElement;
    if (field.type === 'select' || field.type === 'boolean' && field.optional) {
      input = document.createElement('select');
      const choices = field.type === 'boolean' ? [{ value: '', label: field.emptyLabel ?? 'Automatic' }, { value: 'true', label: 'Enabled' }, { value: 'false', label: 'Disabled' }] : field.options ?? [];
      if (field.type === 'select' && field.optional) { const option = document.createElement('option'); option.value = ''; setText(option, field.emptyLabel ?? 'Automatic'); input.append(option); }
      for (const choice of choices) { const option = document.createElement('option'); option.value = choice.value; setText(option, choice.label); input.append(option); }
    } else {
      input = document.createElement('input'); input.type = field.type === 'boolean' ? 'checkbox' : field.type;
      if (field.min !== undefined) input.min = String(field.min);
      if (field.max !== undefined) input.max = String(field.max);
      if (field.step !== undefined) input.step = String(field.step);
      if (field.placeholder) input.placeholder = translate(field.placeholder);
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
    let slider: HTMLInputElement | undefined;
    if (field.type === 'number' && field.min !== undefined && field.max !== undefined && field.slider !== false) {
      slider = document.createElement('input'); slider.type = 'range'; slider.className = 'parameter-slider';
      slider.min = String(field.min); slider.max = String(field.max); slider.step = String(field.step ?? 'any');
      slider.id = `${input.id}-slider`; slider.setAttribute('aria-label', field.label); slider.dataset.sliderPath = field.path;
      if (field.help) slider.setAttribute('aria-describedby', `${input.id}-help`);
      label.append(slider);
    }
    let reset: HTMLButtonElement | undefined;
    if (field.type === 'color') {
      reset = document.createElement('button'); reset.type = 'button'; reset.className = 'parameter-reset'; setText(reset, field.emptyLabel ?? 'Automatic'); reset.setAttribute('aria-label', `${field.label} · ${field.emptyLabel ?? 'Automatic'}`);
      const onReset = () => bindings.setValue(field.path, field.resetValue); reset.addEventListener('click', onReset); cleanups.push(() => reset!.removeEventListener('click', onReset)); label.append(reset);
    }
    if (field.unit) { const unit = document.createElement('span'); unit.className = 'parameter-unit'; setDynamicText(unit, () => physicalUnit(field) ? displayUnit(physicalUnit(field)!, getDistanceUnit()) : field.unit!); label.append(unit); }
    if (field.help) { const help = document.createElement('small'); help.className = 'parameter-help'; help.id = `${input.id}-help`; setText(help, field.help); input.setAttribute('aria-describedby', help.id); label.append(help); }
    const onInput = () => {
      let value: unknown;
      if (field.type === 'boolean') value = field.optional ? input.value === '' ? undefined : input.value === 'true' : (input as HTMLInputElement).checked;
      else if (field.type === 'number') {
        if (input.value.trim() === '' && field.optional) value = undefined;
        else { value = inputConversion(field, input.value.trim() === '' ? NaN : Number(input.value), true); if (!Number.isFinite(value) || field.min !== undefined && (value as number) < field.min - 1e-6 || field.max !== undefined && (value as number) > field.max + 1e-6) { input.setAttribute('aria-invalid', 'true'); return; } }
        if (typeof value === 'number') value = Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity,value));
      } else value = field.optional && input.value === '' ? undefined : input.value;
      input.removeAttribute('aria-invalid');
      if (slider && value !== undefined) slider.value = String(inputConversion(field, value));
      bindings.setValue(field.path, field.fromInput && value !== undefined ? field.fromInput(value) : value);
    };
    const event = field.type === 'boolean' || field.type === 'select' ? 'change' : 'input';
    input.addEventListener(event, onInput); cleanups.push(() => input.removeEventListener(event, onInput));
    if (slider) {
      const onSlide = () => { input.value = slider!.value; onInput(); };
      slider.addEventListener('input', onSlide); cleanups.push(() => slider!.removeEventListener('input', onSlide));
    }
    controls.push({ field, input, slider, reset }); root.append(label);
  }
  bindTree(root);
  const sync = () => {
    for (const { field, input, slider, reset } of controls) {
      input.setAttribute('aria-label', fieldCaption(field));
      const sourceUnit = physicalUnit(field);
      if (sourceUnit) {
        const label = input.closest('label')!;
        label.querySelector('.parameter-caption')!.textContent = fieldCaption(field);
        const unitLabel = label.querySelector('.parameter-unit'); if (unitLabel) unitLabel.textContent = displayUnit(sourceUnit, getDistanceUnit());
        for (const control of [input, slider]) if (control) {
          if (field.min !== undefined) (control as HTMLInputElement).min = String(inputConversion(field, field.min));
          if (field.max !== undefined) (control as HTMLInputElement).max = String(inputConversion(field, field.max));
          (control as HTMLInputElement).step = 'any';
          control.setAttribute('aria-label', fieldCaption(field));
        }
      }
      input.disabled = bindings.disabled?.() ?? false;
      const mixed = bindings.isMixed?.(field.path) ?? false;
      if (slider) slider.hidden = mixed;
      input.dataset.mixed = String(mixed);
      if (mixed && input !== document.activeElement) {
        if (input instanceof HTMLSelectElement) {
          let option = input.querySelector<HTMLOptionElement>('option[data-mixed]');
          if (!option) { option = document.createElement('option'); option.value = '__mixed__'; option.dataset.mixed = ''; option.disabled = true; input.prepend(option); }
          setText(option, 'Different values'); input.value = '__mixed__';
        } else { input.value = ''; input.placeholder = translate('Different values'); }
        continue;
      }
      if (input instanceof HTMLInputElement) input.placeholder = field.placeholder ? translate(field.placeholder) : '';
      const raw = bindings.getValue(field.path) ?? field.defaultValue, converted = raw !== undefined && field.toInput ? field.toInput(raw) : raw;
      const value = inputConversion(field, converted);
      if (slider) {
        slider.disabled = input.disabled;
        if (slider !== document.activeElement) slider.value = String(value ?? field.min);
        slider.setAttribute('aria-valuetext', value === undefined ? (field.placeholder ? translate(field.placeholder) : '') : String(value));
      }
      if (reset) {
        const auto = value === field.resetValue; reset.disabled = input.disabled || auto; (input.closest('label') as HTMLElement).dataset.auto = String(auto);
        if (input !== document.activeElement) input.value = auto || typeof value !== 'string' ? field.placeholder ?? '#808080' : value;
        input.removeAttribute('aria-invalid'); continue;
      }
      // Preserve partial numbers and the caret while the person edits a field.
      if (input === document.activeElement) continue;
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
  cleanups.push(onUnitsChange(sync), onLanguageChange(sync));
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
