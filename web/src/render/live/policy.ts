/**
 * Display policy of the 2D view of the V2.
 *
 * There is one display path: the compositor (compositor.ts), with the fallback view (v2/display/fallback/) for
 * the machines and looks it cannot serve. `?display=fallback` forces the fallback on a machine the compositor could
 * serve, so that it can be tested there; it is read once at load and is neither stored nor offered in the page.
 */
const forced = typeof location !== 'undefined' && new URLSearchParams(location.search).get('display') === 'fallback';

export const fallbackForced = (): boolean => forced;

/**
 * Pace of a moving view (compositor.ts): preparation shares the task of a moving frame and its units are indivisible
 * (a ground tile, a recorded band), so it runs in full only while the frames keep the display's pace.
 *
 * Intervals under PACE_MIN_GAP_MS are no display's (two draws in one display frame): taken as its best interval they
 * would hold every later gesture "behind" for hundreds of frames while the best creeps back up.
 */
export const PACE_MIN_GAP_MS = 4;
export const paceHolds = (gap: number, best: number): boolean => gap <= Math.max(best, PACE_MIN_GAP_MS) * 1.4 + 1;
/**
 * Work budget of the ground behind the display's pace: one tile (about 0.4 ms of CPU, and a 576 px square of the ground
 * shader on the GPU) on full quality, so that the edge a pan uncovers reaches its wanted tier during the pan; the
 * display without tiles drew the ground of the whole view every frame, at many times that cost. On light quality
 * (slow hardware) the ground waits for the pace or for the rest.
 */
export const groundBudgetBehindPace = (quality: 'full' | 'light'): number => (quality === 'full' ? 0.5 : 0);
