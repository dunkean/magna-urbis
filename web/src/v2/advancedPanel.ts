import { setText, registerMessages } from './i18n';

registerMessages({ 'Advanced': { en: 'Advanced', fr: 'Avancé' }, 'Close': { en: 'Close', fr: 'Fermer' } });
let nextId = 0;
/** Rehome live controls, retaining their form handlers and inheritance. */
export function advancedPanel(host: HTMLElement, title: string) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'advanced-open';
  setText(button, 'Advanced');
  const panel = document.createElement('section'); panel.id = `workbench-advanced-${++nextId}`;
  panel.popover = 'auto'; panel.className = 'workbench-advanced'; panel.setAttribute('aria-label', title);
  const header = document.createElement('header'), heading = document.createElement('h2'), close = document.createElement('button');
  setText(heading, title); close.type = 'button'; setText(close, 'Close'); header.append(heading, close);
  const grid = document.createElement('div'); grid.className = 'advanced-grid'; panel.append(header, grid);
  host.append(button, panel); button.setAttribute('aria-controls', panel.id); button.setAttribute('aria-expanded', 'false');
  button.onclick = () => panel.togglePopover(); close.onclick = () => panel.hidePopover();
  panel.addEventListener('toggle', () => button.setAttribute('aria-expanded', String(panel.matches(':popover-open'))));
  return { button, panel, grid };
}

export function organizeUrbanForm(root: HTMLElement): void {
  const sections = Array.from(root.querySelectorAll<HTMLDetailsElement>(':scope > .urban-control-section'));
  if (!sections.length) return;
  const advanced = advancedPanel(root, 'Advanced');
  const main = document.createElement('div'); main.className = 'urban-primary'; root.prepend(main);
  const primary = /^(architecture|through|layout\.(culture|tissue|density|recipe|phases)|parcels\.(culture|operator|density)|houses\.culture|buildingCulture|houseConfig\.(pack|recipe|mode)|overrides\.(roof|floors)|culture|tissue|zone|density|role|function|households|recipe|pack|era|seed|salt)$/;
  for (const field of Array.from(root.querySelectorAll<HTMLElement>('[data-field-path=architecture],[data-field-path=through]'))) main.append(field);
  for (const section of sections) {
    for (const field of Array.from(section.querySelectorAll<HTMLElement>('[data-field-path]'))) {
      if (primary.test(field.dataset.fieldPath!)) main.append(field);
    }
    section.open = true; advanced.grid.append(section);
  }
}

/** Keep editable JSON and diagnostic details available beside the primary object controls. */
export function organizeInspector(host: HTMLElement): void {
  const details = Array.from(host.querySelectorAll<HTMLDetailsElement>('details.section'))
    .filter(node => !node.closest('.workbench-advanced'));
  const textareas = Array.from(host.querySelectorAll<HTMLTextAreaElement>('textarea'))
    .filter(node => !node.closest('details,.workbench-advanced'));
  const stages=Array.from(host.querySelectorAll<HTMLElement>('.section:has(>.urban-stage-buttons)')).filter(node=>!node.closest('.workbench-advanced'));
  if (!details.length && !textareas.length && !stages.length) return;
  const advanced = advancedPanel(host, 'Advanced');
  advanced.grid.append(...stages);
  for (const detail of details) { detail.open = true; advanced.grid.append(detail); }
  for (const textarea of textareas) {
    const card = document.createElement('section'); card.className = 'advanced-card';
    const label = textarea.previousElementSibling;
    if (label?.matches('label')) card.append(label);
    const hint = textarea.nextElementSibling;
    card.append(textarea);
    if (hint?.matches('p.hint')) card.append(hint);
    advanced.grid.append(card);
  }
}
