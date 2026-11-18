/**
 * Display policy of the 2D view of the V2.
 *
 * There is one display path: the compositor (compositor.ts), with the fallback view (v2/display/fallbackView.ts) for
 * the machines and looks it cannot serve. `?display=fallback` forces the fallback on a machine the compositor could
 * serve, so that it can be tested there; it is read once at load and is neither stored nor offered in the page.
 */
const forced = typeof location !== 'undefined' && new URLSearchParams(location.search).get('display') === 'fallback';

export const fallbackForced = (): boolean => forced;
