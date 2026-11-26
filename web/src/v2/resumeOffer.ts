/**
 * The map a phone or tablet left recently, rebuilt on request. Its recipe is restored at startup (cheap), but the
 * generation only runs when the user asks: a page that reloads after the browser discarded it must not start minutes
 * of work by itself, least of all while the device wakes up.
 */
let resume: (() => void) | undefined;
const listeners = new Set<() => void>();
const changed = (): void => {
  for (const listener of listeners) listener();
};
export function offerResume(run: () => void): void {
  resume = run;
  changed();
}
export const resumeOffered = (): boolean => !!resume;
/** The user takes the offer, or makes another map: either way it ends. */
export function acceptResume(): void {
  const run = resume;
  withdrawResume();
  run?.();
}
export function withdrawResume(): void {
  if (!resume) return;
  resume = undefined;
  changed();
}
export function onResumeOffer(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
