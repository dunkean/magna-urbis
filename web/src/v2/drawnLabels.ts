/** Ids of the map labels the 2D renderer actually drew in its last frame (any renderer path reports here),
 * so the Names and labels panel can tell which names are visible at the current view. */
let drawn: Set<string> | undefined;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

export function reportDrawnLabels(ids: Iterable<string | undefined>): void {
  const next = new Set<string>();
  for (const id of ids) if (id) next.add(id);
  if (drawn && drawn.size === next.size && [...next].every(id => drawn!.has(id))) return;
  drawn = next;
  // Views change every frame during gestures: listeners hear once the frame settles.
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(() => { timer = undefined; listeners.forEach(listener => listener()); }, 250);
}
/** Undefined until a renderer has reported a frame. */
export function drawnLabelIds(): ReadonlySet<string> | undefined { return drawn; }
export function onDrawnLabelsChange(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
