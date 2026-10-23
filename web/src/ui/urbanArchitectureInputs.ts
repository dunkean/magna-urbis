/** Architecture may wait for roads/parcels, but an invalidated run must never
 * wake up and dispatch against their replacement inputs. */
export async function waitForArchitectureInputs(options: { pending(): boolean; current(): boolean;
  wait?(): Promise<void>; intervalMs?: number; maxWaitMs?: number }): Promise<void> {
  const interval = options.intervalMs ?? 250, limit = options.maxWaitMs ?? 600_000;
  const check = () => { if (!options.current()) throw new DOMException('Calcul remplacé', 'AbortError'); };
  for (let elapsed = 0; options.pending() && elapsed < limit; elapsed += interval) {
    check(); await (options.wait?.() ?? new Promise<void>(resolve => setTimeout(resolve, interval)));
  }
  check();
  if (options.pending()) throw new Error('Les routes ou le plan sont encore en cours de calcul.');
}
