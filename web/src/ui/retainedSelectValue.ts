/** Preserve a retained enum/profile token even when this UI's catalogue is older.
 * HTMLSelectElement.value silently becomes empty for a missing option. This
 * helper shows that token explicitly; only the native consumer decides support. */
export function retainSelectValue(select: HTMLSelectElement, value: string, label = 'Valeur conservée hors des choix UI'): void {
  for (const option of Array.from(select.options)) if (option.dataset.retainedUnknown === 'true') option.remove();
  if (!Array.from(select.options).some(option => option.value === value)) {
    const option = select.ownerDocument.createElement('option'); option.value = value; option.textContent = `${label} · ${value || '(vide)'}`;
    option.dataset.retainedUnknown = 'true'; option.title = 'Conservée sans substitution ; validité native à vérifier.'; select.add(option);
  }
  select.value = value;
}
