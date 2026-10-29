/** Keep preset identifiers and translated option text intact; only decorate the displayed label. */
export function markStyleCustomized(select: HTMLSelectElement, customized: boolean): void {
  for (const option of Array.from(select.options)) option.label = `${option.text}${customized && option.selected ? ' *' : ''}`;
  select.dataset.styleCustomized = String(customized);
}
type Control = HTMLInputElement | HTMLSelectElement;
/** Bench owners declare canonical defaults for controls created dynamically. */
export function renderControlsCustomized(root: ParentNode, defaultOf?: (control: Control) => string | boolean | undefined): boolean {
  return Array.from(root.querySelectorAll<Control>('input,select')).some(control => {
    if (['style', 'backgroundStyle'].includes(control.id) || control.matches('[type=color],[type=file],[type=button],[type=submit]')) return false;
    const declared = defaultOf?.(control) ?? control.dataset.renderDefault;
    if (control instanceof HTMLInputElement && control.type === 'checkbox')
      return control.checked !== (declared === undefined ? control.defaultChecked : declared === true || declared === 'true');
    const fallback = control instanceof HTMLSelectElement ? (Array.from(control.options).find(option => option.defaultSelected) ?? control.options[0])?.value ?? '' : control.defaultValue;
    const expected = declared === undefined ? fallback : String(declared);
    return control instanceof HTMLInputElement && ['number', 'range'].includes(control.type)
      ? Number(control.value) !== Number(expected) : control.value !== expected;
  }) || Array.from(root.querySelectorAll<HTMLElement>('[data-render-value][data-render-default]')).some(element => element.dataset.renderValue !== element.dataset.renderDefault);
}
