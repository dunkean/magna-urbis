/** Preserve a failed navigation gate while optionally collecting independent visuals. */
export async function runSurfaceNavigationRetainingVisuals(report, enabled, runNavigation) {
  try { await runNavigation(); }
  catch (error) {
    if (report.navigation) Object.assign(report.navigation, { status: 'failed', failure: String(error) });
    if (!enabled || report.navigation?.visualRetentionEligible !== true) throw error;
    report.retainedNavigationFailure = String(error);
    report.visualsAfterNavigationFailure = {
      requested: true, navigationStatus: 'failed', overallSuccessAllowed: false,
      reason: 'Final source display and integrity checks passed; independent visuals do not repair navigation.',
    };
  }
}

export function canRetainSurfaceNavigationVisuals(phase, integrityErrors) {
  return phase.result?.finalReady === true && !!phase.finalDisplayEvidence
    && !phase.timedOut && !phase.signal
    && (phase.code === 0 || phase.code === 1 && phase.result?.status === 'failed')
    && integrityErrors.length === 0;
}

export function assertNoRetainedNavigationFailure(report) {
  if (report.retainedNavigationFailure)
    throw new Error(`Navigation FAILED; independent visuals retained: ${report.retainedNavigationFailure}`);
}
