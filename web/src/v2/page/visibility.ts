/**
 * Chrome stops animation frames in a hidden tab (a background tab, a minimised or fully covered window). The
 * computation runs in workers and goes on, but the display of its result waits for frames. A run therefore stops
 * waiting for the display while the tab is hidden: the drawing it started resumes by itself once the tab shows again,
 * and the next computation does not wait for it.
 */
export function displayedOrHidden(display: Promise<unknown>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let waiting = true;
    const finish = (): void => {
      waiting = false;
      document.removeEventListener('visibilitychange', onVisibility);
    };
    const onVisibility = (): void => {
      if (!document.hidden) return;
      finish();
      resolve();
    };
    // Once abandoned, a late failure (a drawing timeout counted while hidden) is dropped: the next display replaces it.
    display.then(
      () => {
        if (!waiting) return;
        finish();
        resolve();
      },
      error => {
        if (!waiting) return;
        finish();
        reject(error);
      },
    );
    if (document.hidden) onVisibility();
    else document.addEventListener('visibilitychange', onVisibility);
  });
}
