/** Pure machine policy checks: optional hints are neutral, combined constraints demote, hard limits beat preferences,
 * and the handheld ladder moves by measured windows. */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { decideMachineTier, decidePerformance, forcedMachineTier, machineDefaultPreset, handheldStartLevel, handheldStruggleStep, handheldWindowStep, type LearnedPerformance } from '../src/v2/machineTier';
import { machineViewDefaults, performanceKnobs } from '../src/v2/machineView';
import { TREE_DISTANCE_MIN, TREE_DISTANCE_DEFAULT } from '../src/ui/terrain3dTrees';
import { VIEW_DEPTH_DEFAULT } from '../src/render/world/viewDepth';
afterEach(() => vi.unstubAllGlobals());
function memoryStorage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries));
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), removeItem: (key: string) => void values.delete(key) };
}
async function page(search = '', storage = memoryStorage()) {
  vi.resetModules();
  vi.stubGlobal('location', { search });
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('navigator', { hardwareConcurrency: 16, deviceMemory: 8 });
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ getExtension: () => null, getParameter: () => 'Hardware GPU' }) }) });
  const policy = await import('../src/v2/machineTier');
  await policy.inspectMachine();
  return policy;
}
describe('machine defaults', () => {
  it.each(['SwiftShader', 'Microsoft WARP', 'ANGLE (D3D11 WARP)', 'llvmpipe'])('uses minimal for %s', renderer => expect(decideMachineTier({ webgl2: true, renderer }).tier).toBe('veryslow'));
  it('requires WebGL2 and combines CPU and memory constraints', () => {
    expect(decideMachineTier({ webgl2: false }).tier).toBe('veryslow');
    expect(decideMachineTier({ webgl2: true, cores: 2, memory: 2 }).tier).toBe('veryslow');
    expect(decideMachineTier({ webgl2: true, cores: 4, memory: 4 }).tier).toBe('slow');
    expect(decideMachineTier({ webgl2: true, cores: 4 }).tier).toBe('capable');
    expect(decideMachineTier({ webgl2: true, memory: 4 }).tier).toBe('capable');
    expect(decideMachineTier({ webgl2: true }).tier).toBe('capable');
  });
  it('uses adapter identity and limits only as supporting signals', () => {
    const adapter = { maxTextureDimension2D: 8192, maxStorageBufferBindingSize: 128 * 1024 * 1024 };
    expect(decideMachineTier({ webgl2: true, adapter }).tier).toBe('capable');
    expect(decideMachineTier({ webgl2: true, adapter, memory: 4 }).tier).toBe('slow');
    expect(decideMachineTier({ webgl2: true, adapter: { name: 'Intel UHD' }, cores: 4 }).tier).toBe('slow');
    expect(decideMachineTier({ webgl2: true, adapter: { name: 'SwiftShader' } }).tier).toBe('veryslow');
  });
  it('uses sustained compositor navigation frames', () => {
    expect(decideMachineTier({ webgl2: true, frameMs: 34 }).tier).toBe('slow');
    expect(decideMachineTier({ webgl2: true, frameMs: 80 }).tier).toBe('veryslow');
  });
  it('disables 3D when the compositor is unavailable, with URL overrides still authoritative', () => {
    expect(decideMachineTier({ webgl2: true, compositor: false })).toEqual({ tier: 'veryslow', reason: 'compositor' });
    expect(decideMachineTier({ webgl2: true, compositor: false }, 'capable')).toEqual({ tier: 'capable', reason: 'forced' });
  });
  it('keeps 3D on capable and slow machines, with light defaults on constrained machines', () => {
    expect(machineViewDefaults('capable')).toEqual({ available: true, trees3d: false, treeDistance: TREE_DISTANCE_DEFAULT, viewDepth: VIEW_DEPTH_DEFAULT });
    expect(machineViewDefaults('slow')).toEqual({ available: true, trees3d: false, treeDistance: TREE_DISTANCE_MIN, viewDepth: 1 });
    expect(machineViewDefaults('veryslow')).toMatchObject({ available: false });
  });
  it('maps desktop tiers to levels and forces both through the URL', () => {
    const desktop = { preference: 'auto', handheld: false } as const;
    expect(decidePerformance({ webgl2: true }, desktop)).toEqual({ tier: 'capable', level: 'high', reason: 'normal', handheld: false });
    expect(decidePerformance({ webgl2: true, cores: 4, memory: 4 }, desktop)).toMatchObject({ tier: 'slow', level: 'economy', reason: 'resources' });
    expect(decidePerformance({ webgl2: true, frameMs: 90 }, desktop)).toMatchObject({ tier: 'veryslow', level: 'minimal', reason: 'frames' });
    expect(forcedMachineTier('very-slow')).toBeUndefined();
    for (const [tier, level] of [
      ['capable', 'high'],
      ['slow', 'economy'],
      ['veryslow', 'minimal'],
    ] as const) {
      expect(forcedMachineTier(tier)).toBe(tier);
      expect(decideMachineTier({ webgl2: false }, tier)).toEqual({ tier, reason: 'forced' });
      expect(decidePerformance({ webgl2: false }, { ...desktop, force: tier, preference: 'high' })).toEqual({ tier, level, reason: 'forced', handheld: false });
    }
  });
  it('lets hard limits beat an explicit preference, which otherwise wins over measurements', () => {
    for (const handheld of [false, true]) {
      expect(decidePerformance({ webgl2: true, compositor: false }, { preference: 'high', handheld })).toMatchObject({ level: 'minimal', tier: 'veryslow', reason: 'compositor' });
      expect(decidePerformance({ webgl2: false }, { preference: 'balanced', handheld })).toMatchObject({ level: 'minimal', reason: 'webgl' });
      expect(decidePerformance({ webgl2: true, renderer: 'SwiftShader' }, { preference: 'economy', handheld })).toMatchObject({ level: 'minimal', reason: 'software' });
      expect(decidePerformance({ webgl2: true, frameMs: 90 }, { preference: 'balanced', handheld, learned: { level: 'economy', ceiling: 'economy' } })).toEqual({ tier: 'slow', level: 'balanced', reason: 'preference', handheld });
    }
  });
  it('starts a handheld from measurement, not GPU names', () => {
    expect(handheldStartLevel(4, 4)).toBe('economy');
    expect(handheldStartLevel(4)).toBe('balanced');
    expect(handheldStartLevel(undefined, 4)).toBe('balanced');
    expect(handheldStartLevel(8, 4)).toBe('balanced');
    expect(decidePerformance({ webgl2: true, renderer: 'Mali-G78', cores: 8, memory: 8 }, { preference: 'auto', handheld: true })).toEqual({ tier: 'slow', level: 'balanced', reason: 'normal', handheld: true });
    expect(decidePerformance({ webgl2: true, cores: 4, memory: 4 }, { preference: 'auto', handheld: true })).toMatchObject({ level: 'economy', reason: 'resources' });
    expect(decidePerformance({ webgl2: true }, { preference: 'auto', handheld: true, learned: { level: 'high', ceiling: 'high' } })).toMatchObject({ level: 'high', tier: 'capable' });
  });
  it('moves a handheld by window means, with ceilings and the memory gate for High', () => {
    const at = (level: LearnedPerformance['level'], ceiling: LearnedPerformance['ceiling'] = 'high'): LearnedPerformance => ({ level, ceiling });
    expect(handheldWindowStep(at('high'), 90, true)).toEqual(at('economy', 'economy'));
    expect(handheldWindowStep(at('balanced'), 80, false)).toEqual(at('economy', 'economy'));
    expect(handheldWindowStep(at('economy'), 85, false)).toEqual(at('minimal', 'minimal'));
    expect(handheldWindowStep(at('balanced'), 40, true)).toEqual(at('economy', 'economy'));
    const economy = at('economy');
    expect(handheldWindowStep(economy, 40, false)).toBe(economy);
    expect(handheldWindowStep(at('balanced'), 25, false)).toEqual(at('balanced'));
    // A fast first window never promotes; later fast windows climb one step, up to the ceiling.
    expect(handheldWindowStep(at('balanced'), 15, true)).toEqual(at('balanced'));
    expect(handheldWindowStep(at('balanced'), 15, false)).toEqual(at('high'));
    expect(handheldWindowStep(at('economy', 'economy'), 15, false)).toEqual(at('economy', 'economy'));
    expect(handheldWindowStep(at('minimal', 'balanced'), 15, false)).toEqual(at('economy', 'balanced'));
    expect(handheldWindowStep(at('balanced'), 15, false, 4)).toEqual(at('balanced'));
    expect(handheldWindowStep(at('balanced'), 15, false, 8)).toEqual(at('high'));
    expect(handheldStruggleStep(at('high'))).toEqual(at('balanced', 'balanced'));
    expect(handheldStruggleStep(economy)).toBe(economy);
  });
  it('swaps an untouched recipe to Minimal, or to the fast Satellite/Parchment at Economy', () => {
    expect(machineDefaultPreset('high', 'satellite')).toBe('satellite');
    expect(machineDefaultPreset('balanced', 'parchment')).toBe('parchment');
    expect(machineDefaultPreset('economy', 'satellite')).toBe('satellite-light');
    expect(machineDefaultPreset('economy', 'parchment')).toBe('parchment-light');
    expect(machineDefaultPreset('economy', 'topographic')).toBe('topographic');
    expect(machineDefaultPreset('minimal', 'satellite')).toBe('minimal');
  });
  it('derives the knobs of each level', () => {
    expect(performanceKnobs({ level: 'economy', reason: 'normal', handheld: true })).toEqual({ pixelRatioCap: 1.5, quality: 'light', available3d: true });
    expect(performanceKnobs({ level: 'balanced', reason: 'normal', handheld: true })).toEqual({ pixelRatioCap: 2, quality: 'full', available3d: true });
    expect(performanceKnobs({ level: 'minimal', reason: 'frames', handheld: true })).toEqual({ pixelRatioCap: 1.5, quality: 'light', available3d: false });
    expect(performanceKnobs({ level: 'high', reason: 'normal', handheld: false })).toEqual({ pixelRatioCap: Infinity, quality: undefined, available3d: true });
    expect(performanceKnobs({ level: 'economy', reason: 'resources', handheld: false }).quality).toBe('light');
    expect(performanceKnobs({ level: 'balanced', reason: 'preference', handheld: false }).quality).toBe('full');
  });
  it('applies runtime compositor limits despite style protection and restores the hardware tier after recovery', async () => {
    const policy = await page();
    policy.protectMachineStyle();
    policy.reportMachineCompositor(false);
    expect(policy.machineDecision().tier).toBe('capable');
    await Promise.resolve();
    expect(policy.machineDecision()).toEqual({ tier: 'veryslow', level: 'minimal', reason: 'compositor', handheld: false });
    policy.reportMachineCompositor(true);
    await Promise.resolve();
    expect(policy.machineDecision().tier).toBe('capable');
  });
  it('publishes measured demotion after the compositor frame returns', async () => {
    const policy = await page();
    const listener = vi.fn();
    policy.onMachineDecision(listener);
    for (let i = 0; i < 20; i++) policy.reportMachineFrame(90);
    expect(listener).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(policy.machineDecision()).toEqual({ tier: 'veryslow', level: 'minimal', reason: 'frames', handheld: false });
    expect(listener).toHaveBeenCalledOnce();
  });
  it('keeps an explicit desktop style protected from later measurements', async () => {
    vi.resetModules();
    const policy = await import('../src/v2/machineTier');
    expect(policy.machineStyleProtected()).toBe(false);
    policy.protectMachineStyle();
    expect(policy.machineStyleProtected()).toBe(true);
    for (let i = 0; i < 20; i++) policy.reportMachineFrame(100);
    expect(policy.machineDecision().tier).toBe('capable');
  });
  it('stores the preference, and choosing Auto again forgets the learned handheld level', async () => {
    const storage = memoryStorage({ 'magna-urbis-performance-auto': JSON.stringify({ level: 'minimal', ceiling: 'minimal' }) });
    const policy = await page('?device=handheld', storage);
    // Minimal is learned for a session only: the next visit retries from Economy.
    expect(policy.machineDecision()).toMatchObject({ level: 'economy', handheld: true, reason: 'frames' });
    policy.setPerformancePreference('high');
    expect(policy.machineDecision()).toMatchObject({ level: 'high', reason: 'preference' });
    expect(storage.values.get('magna-urbis-performance')).toBe('high');
    policy.setPerformancePreference('auto');
    expect(storage.values.has('magna-urbis-performance-auto')).toBe(false);
    expect(policy.machineDecision()).toMatchObject({ level: 'balanced', reason: 'normal' });
  });
  it('learns from handheld windows and struggles, even with a protected style', async () => {
    const storage = memoryStorage();
    const policy = await page('?device=handheld', storage);
    policy.protectMachineStyle();
    // One slow window can be a burst of tile bakes: the demotion takes two in a row.
    for (let i = 0; i < 20; i++) policy.reportMachineFrame(40);
    await Promise.resolve();
    expect(policy.machineDecision().level).toBe('balanced');
    for (let i = 0; i < 20; i++) policy.reportMachineFrame(40);
    await Promise.resolve();
    expect(policy.machineDecision()).toMatchObject({ level: 'economy', tier: 'slow', reason: 'frames' });
    expect(JSON.parse(storage.values.get('magna-urbis-performance-auto')!)).toEqual({ level: 'economy', ceiling: 'economy' });
    for (let i = 0; i < 20; i++) policy.reportMachineFrame(10);
    await Promise.resolve();
    expect(policy.machineDecision().level).toBe('economy');
    policy.reportMachineStruggle();
    await Promise.resolve();
    expect(policy.machineDecision().level).toBe('economy');
  });
  it('steps a handheld down for good when the map loses its GPU context', async () => {
    const storage = memoryStorage();
    const policy = await page('?device=handheld', storage);
    policy.reportMachineGpuLoss();
    await Promise.resolve();
    expect(policy.machineDecision()).toMatchObject({ level: 'economy', reason: 'graphics' });
    expect(JSON.parse(storage.values.get('magna-urbis-performance-auto')!)).toEqual({ level: 'economy', ceiling: 'economy', graphics: true });
  });
  it('keeps a struggle for the session only', async () => {
    const storage = memoryStorage();
    const policy = await page('?device=handheld', storage);
    expect(policy.machineDecision().level).toBe('balanced');
    // Before the first measured window a struggle is warm-up.
    policy.reportMachineStruggle();
    await Promise.resolve();
    expect(policy.machineDecision().level).toBe('balanced');
    for (let i = 0; i < 20; i++) policy.reportMachineFrame(25);
    policy.reportMachineStruggle();
    await Promise.resolve();
    expect(policy.machineDecision()).toMatchObject({ level: 'economy', reason: 'frames' });
    expect(storage.values.has('magna-urbis-performance-auto')).toBe(false);
  });
});
