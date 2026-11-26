/**
 * Device class shared by the display policy and the generation scheduler.
 * Handheld = a touch-first device (phone or tablet): coarse primary pointer and no hover. A desktop with a touch screen
 * keeps a fine pointer and stays a desktop. Workers have no media queries: the page passes its class in the worker name,
 * the channel `threads=` and `profile=` already use. `?device=handheld|desktop` forces the class for tests.
 */
const WORKER_TOKEN = 'device=handheld';
type Scope = { name?: unknown; location?: { search?: string }; matchMedia?: (query: string) => { matches: boolean } };

function detect(): boolean {
  const scope = globalThis as Scope;
  try {
    const forced = new URLSearchParams(scope.location?.search ?? '').get('device');
    if (forced === 'handheld') return true;
    if (forced === 'desktop') return false;
  } catch {
    /* no location */
  }
  if (typeof scope.matchMedia === 'function') return scope.matchMedia('(hover: none) and (pointer: coarse)').matches;
  return typeof scope.name === 'string' && scope.name.split(/\s+/).includes(WORKER_TOKEN);
}

let cached: boolean | undefined;
/** True on a phone or tablet, in the page and in the workers named with `deviceWorkerName`. */
export const handheldDevice = (): boolean => (cached ??= detect());
/** Page side: append the device class to a worker name (once: the name builders nest). */
export const deviceWorkerName = (name: string): string => (handheldDevice() && !name.split(/\s+/).includes(WORKER_TOKEN) ? `${name} ${WORKER_TOKEN}` : name);
