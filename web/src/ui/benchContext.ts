/** Page-owned state supplements the DOM snapshot without applying draft inputs. */
export interface BenchContextHook {
  ready(): boolean;
  capture?(): unknown;
  restore?(state: any): void;
  refresh?(): void;
}
declare global { interface Window { magnaBenchContext?: BenchContextHook } }
export interface BenchUiContext {
  fields: { selector: string; value: string; checked?: boolean }[];
  panels: { selector: string; open: boolean }[];
  scroll: { selector: string; x: number; y: number }[];
  extra?: unknown;
}
function selector(element: Element): string {
  if (element.id) return `#${CSS.escape(element.id)}`;
  const parent = element.parentElement;
  if (!parent) return element.localName;
  const siblings = Array.from(parent.children).filter(child => child.localName === element.localName);
  return `${selector(parent)} > ${element.localName}:nth-of-type(${siblings.indexOf(element) + 1})`;
}
export function captureBenchUi(doc: Document): BenchUiContext {
  const fields = Array.from(doc.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea'))
    .filter(field => !field.matches('[type=file],[type=password]'))
    .map(field => ({ selector: selector(field), value: field.value, ...(field.localName === 'input' ? { checked: (field as HTMLInputElement).checked } : {}) }));
  const panels = Array.from(doc.querySelectorAll<HTMLDetailsElement | HTMLDialogElement>('details,dialog')).map(panel => ({ selector: selector(panel), open: panel.open }));
  const scroll = Array.from(doc.querySelectorAll<HTMLElement>('body,main,aside,section,form,dialog,details,div')).filter(element => element.scrollTop || element.scrollLeft)
    .map(element => ({ selector: selector(element), x: element.scrollLeft, y: element.scrollTop }));
  return { fields, panels, scroll, extra: doc.defaultView?.magnaBenchContext?.capture?.() };
}
export function restoreBenchUi(doc: Document, context: BenchUiContext): void {
  doc.defaultView?.magnaBenchContext?.restore?.(context.extra);
  for (const saved of context.fields) {
    const field = doc.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(saved.selector);
    if (!field || field.matches('[type=file],[type=password]')) continue;
    if (field.localName !== 'select' || Array.from((field as HTMLSelectElement).options).some(option => option.value === saved.value)) field.value = saved.value;
    if (saved.checked !== undefined) (field as HTMLInputElement).checked = saved.checked;
  }
  for (const saved of context.panels) {
    const panel = doc.querySelector<HTMLDetailsElement | HTMLDialogElement>(saved.selector);
    if (!panel) continue;
    if (panel.localName === 'dialog') {
      if (saved.open && !panel.open) (panel as HTMLDialogElement).showModal();
      else if (!saved.open && panel.open) (panel as HTMLDialogElement).close();
    } else panel.open = saved.open;
  }
  doc.defaultView?.magnaBenchContext?.refresh?.();
  doc.defaultView?.requestAnimationFrame(() => {
    for (const saved of context.scroll) doc.querySelector(saved.selector)?.scrollTo(saved.x, saved.y);
  });
}
