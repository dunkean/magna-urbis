/** Position editing owns its selection: selecting a place must not open its city inspector. */
export function mountTownMoveSelection(api: { panel: HTMLElement; exists(key: string): boolean; busy(): boolean; focus(key: string): void; changed(): void }) {
  let active = false,
    selected: string | undefined;
  function syncRows(): void {
    if (!active) return;
    api.panel.querySelectorAll<HTMLElement>('[data-town]').forEach(row => {
      const pressed = String(row.dataset.town === selected);
      if (row.getAttribute('aria-pressed') !== pressed) row.setAttribute('aria-pressed', pressed);
    });
  }
  function select(key: string, fromList = false): boolean {
    if (!active || api.busy() || !api.exists(key)) return false;
    selected = key;
    syncRows();
    if (fromList) api.focus(key);
    api.changed();
    return true;
  }
  // Capture also handles keyboard-generated clicks and rows replaced by updateWorld().
  api.panel.addEventListener(
    'click',
    event => {
      if (!active) return;
      const target = event.target as Element | null;
      const choice = target?.closest('.settlement-choice');
      const row = target?.closest<HTMLElement>('[data-town]') ?? choice?.querySelector<HTMLElement>('[data-town]');
      const key = row?.dataset.town;
      if (!key) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      select(key, true);
    },
    true,
  );
  // Background city arrivals can replace the list while a position is selected.
  const observer = new MutationObserver(syncRows);
  observer.observe(api.panel, { childList: true, subtree: true });
  return {
    key: () => selected,
    select,
    syncRows,
    setActive(value: boolean): void {
      if (active === value) return;
      if (!value) api.panel.querySelectorAll('[data-town]').forEach(row => row.setAttribute('aria-pressed', 'false'));
      active = value;
      selected = undefined;
      syncRows();
    },
  };
}
