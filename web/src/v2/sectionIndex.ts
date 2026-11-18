/** Advanced views are single pages: every section is open, and a compact index jumps to each one (no accordion). */
import { registerMessages, setText, translate, onLanguageChange } from './i18n';
import './sectionIndex.css';

registerMessages({ 'Jump to a section': { en: 'Jump to a section', fr: 'Aller à une section' } });

export interface IndexedSection {
  section: HTMLElement;
  heading: HTMLElement;
}
export interface SectionIndex {
  nav: HTMLElement;
  sync(): void;
}

/** Buttons, not `#` links: the V2 keeps its project code in the URL hash. Hidden sections leave the index. */
/** `stickyTop`: height covered by sticky content at the top of the scroller (the target lands just below it). */
export function mountSectionIndex(scroller: HTMLElement, sections: () => readonly IndexedSection[], stickyTop: () => number = () => 0): SectionIndex {
  const nav = document.createElement('nav');
  nav.className = 'section-index';
  const list = document.createElement('ul');
  nav.append(list);
  const label = () => nav.setAttribute('aria-label', translate('Jump to a section'));
  label();
  onLanguageChange(label);
  let signature = '';
  function sync(): void {
    const shown = sections().filter(({ section }) => !section.hidden && !section.closest('[hidden]'));
    const next = shown.map(({ section }) => section.id).join('|');
    if (next === signature) return;
    signature = next;
    list.replaceChildren(
      ...shown.map(({ section, heading }) => {
        const item = document.createElement('li'),
          button = document.createElement('button');
        button.type = 'button';
        button.dataset.sectionTarget = section.id;
        const source = heading.dataset.i18n;
        if (source) setText(button, source);
        else {
          button.textContent = heading.textContent;
          button.dataset.l10nKeep = '';
        }
        button.onclick = () => {
          const top = section.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - stickyTop() - 8;
          scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
          heading.tabIndex = -1;
          heading.focus({ preventScroll: true });
        };
        item.append(button);
        return item;
      }),
    );
  }
  return { nav, sync };
}
