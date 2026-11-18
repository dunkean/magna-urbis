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
 * `?camera=dual` keeps the two views the page had before the single camera: a 2D map that does not tilt, and a "3D"
 * button that opens the separate 3D view (ui/view3d/). Without it the map has one camera: it tilts in place and the
 * button tilts it. TEMPORARY: the switch exists only until the single camera does what the 3D view did (walk, fly,
 * building picking, captures); it is then deleted together with that view. Read once at load, neither stored nor
 * offered in the page.
 */
const dual = typeof location !== 'undefined' && new URLSearchParams(location.search).get('camera') === 'dual';

export const dualCameras = (): boolean => dual;
