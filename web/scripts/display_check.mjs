/** Publication gate: the short navigation probe supplies measurements; this module owns the acceptance policy. */
import { parseProbeArgs, runNavigationProbe } from './nav_fps_probe.mjs';
import { pathToFileURL } from 'node:url';

// Every observed display decision during a gesture must use the compositor without a fallback reason.
const MIN_ACTIVE_FRACTION = 1;
// All four required layers together must be ready without stand-ins on at least this share of submitted frames.
const MIN_LIVE_LAYER_FRACTION = 0.95;
// Whole compositor frame submission time must have a p95 strictly below this main-thread budget.
const MAX_CPU_P95_MS = 4;
// A Long Tasks API entry overlapping a gesture may take at most this many milliseconds.
const MAX_LONG_TASK_MS = 100;
// No unit of draw, preparation or exact repaint may enter LiveStats.slow during a gesture.
const MAX_SLOW_UNITS = 0;
// Page errors anywhere in generation, appearance changes or navigation invalidate the run.
const MAX_PAGE_ERRORS = 0;

const STYLES = ['satellite', 'parchment'];
const GESTURES = ['wheel-in', 'wheel-out', 'pan', 'wheel-slow'];
const LAYERS = ['ground', 'overlay', 'city', 'text'];
const percent = n => `${(n * 100).toFixed(1)}%`;

export function assessDisplay(report) {
  const rows = [];
  const problems = [];
  if (!report) problems.push('missing compositor report');
  if (report?.error) problems.push(report.error.split('\n')[0]);
  if (report?.cleanupError) problems.push('Chrome cleanup failed');
  if (report?.reloaded) problems.push('page reloaded');
  if (report?.skippedStyles?.length) problems.push(`unsupported looks: ${report.skippedStyles.join(', ')}`);
  if (!Array.isArray(report?.pageErrors)) problems.push('page error collection missing');
  if ((report?.pageErrors?.length ?? 0) > MAX_PAGE_ERRORS) problems.push(`page errors: ${report.pageErrors.join('; ')}`);
  if (problems.length) rows.push({ gesture: 'run', result: 'FAIL', failures: problems.join('; ') });
  for (const style of STYLES)
    for (const gesture of GESTURES) {
      const key = `${style}:${gesture}`;
      const row = report?.gestures?.[key];
      const failures = [];
      const live = row?.live;
      const frames = live?.frames ?? 0;
      const policy = Object.entries(live?.activeObservations ?? {});
      const observations = policy.reduce((sum, [, n]) => sum + n, 0);
      const active = observations ? (live?.activeObservations?.['true:'] ?? 0) / observations : 0;
      const fractions = LAYERS.map(name => (frames ? (live?.observations?.[name]?.live ?? 0) / frames : 0));
      const allLive = frames ? (live?.allLayersLive ?? 0) / frames : 0;
      const cpu = [...(live?.frameMs ?? [])].filter(Number.isFinite).sort((a, b) => a - b);
      const p95 = cpu.length ? cpu[Math.min(cpu.length - 1, Math.floor(cpu.length * 0.95))] : null;
      const long = row?.long?.max;
      const slow = live?.slow?.length;
      if (!row) failures.push('missing gesture');
      if (!live?.available || !frames) failures.push('no compositor frames');
      if (!live?.frameHook || !live?.policyHook || !live?.slowHook) failures.push('incomplete LiveStats instrumentation');
      if (!live?.active || live?.reason || active < MIN_ACTIVE_FRACTION || live?.inactiveWrites) failures.push('compositor inactive/reason');
      if (live?.samplesCapped || live?.presented !== frames || cpu.length !== frames || row?.dropped) failures.push('incomplete frame samples');
      for (let i = 0; i < LAYERS.length; i++) {
        if (fractions[i] < MIN_LIVE_LAYER_FRACTION || live?.observations?.[LAYERS[i]]?.observations !== frames) failures.push(`${LAYERS[i]} live ${percent(fractions[i])}`);
      }
      if (allLive < MIN_LIVE_LAYER_FRACTION) failures.push(`four layers live together ${percent(allLive)}`);
      if (p95 === null || p95 >= MAX_CPU_P95_MS) failures.push(`CPU p95 must be < ${MAX_CPU_P95_MS} ms`);
      if (!row?.longTaskSupported || !Number.isFinite(long) || long > MAX_LONG_TASK_MS) failures.push(`long task missing or > ${MAX_LONG_TASK_MS} ms`);
      if (slow === undefined || slow > MAX_SLOW_UNITS) failures.push('slow-unit journal missing/nonempty');
      rows.push({ gesture: key, result: failures.length ? 'FAIL' : 'PASS', frames, active: percent(active), 'all live': percent(allLive), 'CPU p95 ms': p95?.toFixed(3) ?? '-', 'long max ms': long ?? '-', slow: slow ?? '-', failures: failures.join('; ') });
      problems.push(...failures.map(failure => `${key}: ${failure}`));
    }
  return { rows, problems, ok: problems.length === 0 };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let exitCode = 1;
  try {
    const args = process.argv.slice(2);
    const usage = 'npm run check:display -- --origin http://127.0.0.1:5173';
    if (args.includes('--help')) {
      console.log(usage);
      exitCode = 0;
    } else {
      if (args.length !== 2 || args[0] !== '--origin') throw new Error(usage);
      const origin = new URL(args[1]);
      if (!['http:', 'https:'].includes(origin.protocol)) throw new Error(usage);
      const label = `display-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      const options = parseProbeArgs([label, '--origin', origin.href, '--styles', STYLES.join(','), '--modes', 'compositor', '--scenario', 'short']);
      const reports = await runNavigationProbe(options);
      const assessment = assessDisplay(reports.find(report => report.mode === 'compositor'));
      console.table(assessment.rows);
      for (const problem of assessment.problems) console.error(problem);
      console.log(`Display gate ${assessment.ok ? 'PASS' : 'FAIL'}; reports: out/nav-fps/${label}`);
      exitCode = assessment.ok ? 0 : 1;
    }
  } catch (error) {
    console.error(`Display gate FAIL: ${error.stack ?? error}`);
  }
  // The runner has completed its finally cleanup; timed-out Playwright transports must not keep the gate alive.
  process.exit(exitCode);
}
