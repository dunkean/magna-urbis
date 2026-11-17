/** The spinner left of the view selector (#map-style): shown while the displayed view is not completely drawn. */
import { insertHTML, registerMessages } from './i18n';
import { ViewLoadingTracker, type ViewJob } from './viewLoading';

const LABEL = 'Loading textures and view…';
registerMessages({ [LABEL]: { en: LABEL, fr: 'Chargement des textures et de la vue…' } });
/** Short loads (a cached tile, a quick redraw) do not flash the spinner. */
const SHOW_DELAY_MS = 150;

export function mountViewLoadingIndicator(select: HTMLElement): ViewLoadingTracker {
  insertHTML(select, 'beforebegin', `<span id="view-loading" class="view-loading" role="status" aria-live="polite" aria-busy="false" aria-label="${LABEL}" title="${LABEL}" hidden></span>`);
  const element = select.previousElementSibling as HTMLElement;
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  return new ViewLoadingTracker({
    onChange: busy => {
      element.setAttribute('aria-busy', String(busy));
      clearTimeout(showTimer); showTimer = undefined;
      if (busy) showTimer = setTimeout(() => { element.hidden = false; }, SHOW_DELAY_MS);
      else element.hidden = true;
    },
  });
}

/**
 * 2D tiles and textures: the renderer writes its pending work on the canvas every frame (data-render-pending).
 * A non-zero value starts a 'tiles' job, polled until the renderer reports none. A job dropped by the safety
 * timeout is not restarted until a frame reports a complete view.
 */
export function watchDisplayPending(tracker: ViewLoadingTracker, canvas: HTMLElement, pending: () => number, intervalMs = 200): void {
  let job: ViewJob | undefined, poll: ReturnType<typeof setInterval> | undefined, stuck = false;
  const stop = (): void => { if (poll !== undefined) clearInterval(poll); poll = undefined; };
  const done = (): void => { stuck = false; job?.end(); job = undefined; stop(); };
  const check = (): void => {
    if (job && !job.active) { stuck = true; job = undefined; stop(); return; }
    if (pending() === 0) done();
  };
  new MutationObserver(() => {
    if ((Number(canvas.dataset.renderPending) || 0) === 0) { done(); return; }
    if (stuck || job?.active) return;
    job = tracker.begin('tiles'); stop(); poll = setInterval(check, intervalMs);
  }).observe(canvas, { attributes: true, attributeFilter: ['data-render-pending'] });
}
