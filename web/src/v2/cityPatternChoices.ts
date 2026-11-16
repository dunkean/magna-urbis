import { onLanguageChange, translate } from './i18n';
import './cityPatternChoices.css';

const patterns = ['grid', 'organic', 'radial', 'terraces', 'dendritic', 'clusters'];
/** Decorative previews retain the same scalar select and generation contract as City Bench. */
export function mountCityPatternChoices(select: HTMLSelectElement): { sync(): void; dispose(): void } {
  const root = document.createElement('div'); root.className = 'city-pattern-choices';
  const buttons = patterns.flatMap((id, index) => {
    const option = Array.from(select.options).find(o => o.value === id); if (!option) return [];
    const button = document.createElement('button'); button.type = 'button'; button.dataset.cityPattern = id;
    const art = document.createElement('i'); art.setAttribute('aria-hidden', 'true');
    art.style.backgroundPosition = `${index % 3 * 50}% ${index < 3 ? 0 : 100}%`;
    const caption = document.createElement('span'); button.append(art, caption);
    button.onclick = () => { if (select.disabled) return; select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); sync(); };
    root.append(button); return [{ button, caption, option }];
  });
  // This lives beside the label: clicking a preview must never activate the label's select.
  select.closest('.parameter-field')!.after(root);
  function sync(): void {
    for (const { button, caption, option } of buttons) {
      caption.textContent = translate(option.dataset.i18n ?? option.text); button.title = caption.textContent;
      button.disabled = select.disabled; button.setAttribute('aria-pressed', String((select.dataset.resolvedValue ?? select.value) === button.dataset.cityPattern));
    }
  }
  const unsubscribe = onLanguageChange(sync); sync();
  return { sync, dispose: () => { unsubscribe(); root.remove(); } };
}
