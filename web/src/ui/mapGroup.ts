/**
 * Compact groups of the left « Carte » panel and of the settlement editor: one icon and one dense
 * line; a small gear at the right of the line opens the detail area in place.
 */
export const gearButton = (title = 'Réglages détaillés'): string =>
  `<button type="button" class="map-gear" aria-expanded="false" title="${title}" aria-label="${title}">⚙</button>`;

/** Wire every gear below `root`: it toggles the `.map-detail` child of its nearest `[data-map-body]`. */
export function bindGear(root: ParentNode, onToggle?: (open: boolean) => void): void {
  for (const gear of Array.from(root.querySelectorAll<HTMLButtonElement>('.map-gear'))) {
    const body = gear.closest<HTMLElement>('[data-map-body]');
    const detail = body?.querySelector<HTMLElement>(':scope > .map-detail');
    if (!detail) continue;
    const apply = (open: boolean): void => { detail.hidden = !open; gear.setAttribute('aria-expanded', String(open)); gear.classList.toggle('on', open); };
    apply(!detail.hidden);
    gear.onclick = () => { apply(detail.hidden); onToggle?.(!detail.hidden); };
  }
}
