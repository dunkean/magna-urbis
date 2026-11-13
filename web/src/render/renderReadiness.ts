export type RenderMilestone = 'fields-ready' | 'programs-ready' | 'first-useful-frame' | 'visible-complete' | 'capture-complete' | 'first-covered-frame';
let serial = 0;
/** Timings are request-scoped. A submitted preview is deliberately distinct from exact output.
 * Consumers can correlate every mark/measure through detail.request and target. */
export class RenderReadiness {
  readonly id = ++serial;
  readonly started = performance.now();
  private marks = new Set<RenderMilestone>();
  constructor(readonly target: '2d' | '3d' | 'capture') {
    performance.mark('v2:render:request', { detail: { request: this.id, target } });
  }
  has(phase: RenderMilestone): boolean { return this.marks.has(phase); }
  mark(phase: RenderMilestone): void {
    if (this.marks.has(phase)) return;
    this.marks.add(phase);
    const detail = { request: this.id, target: this.target };
    performance.mark(`v2:render:${phase}`, { detail });
    performance.measure(`v2:render:${phase}`, { start: this.started, detail });
    if (phase === 'visible-complete') performance.measure('v2:appearance:complete', { start: this.started, detail });
  }
}
