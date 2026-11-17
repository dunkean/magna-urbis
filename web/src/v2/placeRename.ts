import type { V2Settings } from './contracts';
import { registerMessages, translate } from './i18n';
import { lineIcon } from './editorIcons';
import { renameToponym, TOPONYM_MAX_LENGTH } from './toponymOverrides';

registerMessages({
  'Rename this settlement': { en: 'Rename this settlement', fr: 'Renommer cette localité' },
  'Settlement name': { en: 'Settlement name', fr: 'Nom de la localité' },
});

/** A pencil beside a settlement card's title: it turns the title into a text field.
 * Enter or leaving the field renames (same override store as Names and labels); Escape cancels;
 * empty text keeps the current name. */
export function mountPlaceRename(title: HTMLElement, api: { key: string; getSettings(): V2Settings; getName(): string | undefined; changed(): void }): void {
  const pencil = document.createElement('button'); pencil.type = 'button'; pencil.className = 'place-title-rename'; pencil.id = 'place-rename';
  pencil.append(lineIcon('pencil')); pencil.title = translate('Rename this settlement'); pencil.setAttribute('aria-label', pencil.title);
  title.append(pencil);
  pencil.onclick = () => {
    const shown = title.querySelector<HTMLElement>(':scope > span'); if (!shown) return;
    const field = document.createElement('input'); field.type = 'text'; field.className = 'place-title-input'; field.id = 'place-rename-input';
    field.maxLength = TOPONYM_MAX_LENGTH; field.value = api.getName() ?? shown.textContent ?? ''; field.setAttribute('aria-label', translate('Settlement name'));
    let done = false;
    const close = (commit: boolean): void => {
      if (done) return; done = true;
      const before = shown.textContent ?? '';
      if (commit && field.value.trim() !== before.trim() && renameToponym(api.getSettings(), { id: `settlement:${api.key}`, town: api.key }, field.value)) {
        shown.textContent = field.value.trim(); shown.removeAttribute('data-i18n'); shown.setAttribute('data-l10n-keep', '');
        api.changed();
      }
      field.replaceWith(shown); pencil.hidden = false; pencil.focus({ preventScroll: true });
    };
    field.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); close(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); } };
    field.onblur = () => close(true);
    shown.replaceWith(field); pencil.hidden = true; field.focus(); field.select();
  };
}
