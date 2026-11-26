/** Pure machine policy checks: optional hints are neutral, combined constraints demote, hard limits beat preferences,
 * and the handheld ladder moves by measured windows. */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { decideMachineTier, decidePerformance, forcedMachineTier, machineDefaultPreset, handheldStart, handheldWindowStep, prefersCpuSatelliteGround, type LearnedPerformance } from '../src/v2/machineTier';
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
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ getExtension: () => null, getParameter: () => 'Apple GPU' }) }) });
  const policy = await import('../src/v2/machineTier');
  await policy.inspectMachine();
  return policy;
}
describe('machine defaults', () => {
  it('keeps the textured economy ground on the CPU for the affected phone GPU', () => {
    const affected = 'ANGLE (Qualcomm, Adreno (TM) 619, OpenGL ES 3.2)';
    expect(prefersCpuSatelliteGround({ handheld: true, level: 'economy' }, affected)).toBe(true);
    expect(prefersCpuSatelliteGround({ handheld: true, level: 'balanced' }, affected)).toBe(false);
    expect(prefersCpuSatelliteGround({ handheld: false, level: 'economy' }, affected)).toBe(false);
    expect(prefersCpuSatelliteGround({ handheld: true, level: 'economy' }, 'Adreno (TM) 730')).toBe(false);
  });
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
      // A compositor refused at run time is a verdict on a desktop only: a handheld keeps its level and its fallback view.
      expect(decidePerformance({ webgl2: true, compositor: false }, { preference: 'high', handheld })).toMatchObject(handheld ? { level: 'high', reason: 'preference' } : { level: 'minimal', tier: 'veryslow', reason: 'compositor' });
      expect(decidePerformance({ webgl2: false }, { preference: 'balanced', handheld })).toMatchObject({ level: 'minimal', reason: 'webgl' });
      expect(decidePerformance({ webgl2: true, renderer: 'SwiftShader' }, { preference: 'economy', handheld })).toMatchObject({ level: 'minimal', reason: 'software' });
      expect(decidePerformance({ webgl2: true, frameMs: 90 }, { preference: 'balanced', handheld, learned: { level: 'economy', ceiling: 'economy' } })).toEqual({ tier: 'slow', level: 'balanced', reason: 'preference', handheld });
    }
  });
  it('starts a handheld from its GPU family: Balanced on strong families, Economy with no automatic climb on the others', () => {
    const modest = { level: 'economy', ceiling: 'economy' },
      strong = { level: 'balanced', ceiling: 'high' };
    expect(handheldStart({ renderer: 'ANGLE (Qualcomm, Adreno (TM) 619, OpenGL ES 3.2)', cores: 8, memory: 8 })).toEqual(modest);
    expect(handheldStart({ renderer: 'Adreno (TM) 720' })).toEqual(modest);
    expect(handheldStart({ renderer: 'Mali-G57 MC2' })).toEqual(modest);
    expect(handheldStart({ renderer: 'Mali-G72 MP3' })).toEqual(modest);
    expect(handheldStart({})).toEqual(modest);
    expect(handheldStart({ renderer: 'Adreno (TM) 740', cores: 8, memory: 8 })).toEqual(strong);
    expect(handheldStart({ renderer: 'Adreno (TM) 660' })).toEqual(strong);
    expect(handheldStart({ renderer: 'Mali-G78 MP14' })).toEqual(strong);
    expect(handheldStart({ renderer: 'Mali-G710 MC10' })).toEqual(strong);
    expect(handheldStart({ renderer: 'Apple GPU' })).toEqual(strong);
    expect(handheldStart({ renderer: 'Apple GPU', cores: 4, memory: 4 })).toEqual(modest);
    expect(decidePerformance({ webgl2: true, renderer: 'Adreno (TM) 619', cores: 8, memory: 8 }, { preference: 'auto', handheld: true })).toMatchObject({ level: 'economy', reason: 'resources' });
    expect(decidePerformance({ webgl2: true, renderer: 'Mali-G78', cores: 8, memory: 8 }, { preference: 'auto', handheld: true })).toEqual({ tier: 'slow', level: 'balanced', reason: 'normal', handheld: true });
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
    const storage = memoryStorage({ 'magna-urbis-performance-learned': JSON.stringify({ level: 'minimal', ceiling: 'minimal' }) });
    const policy = await page('?device=handheld', storage);
    // Minimal is learned for a session only: the next visit retries from Economy.
    expect(policy.machineDecision()).toMatchObject({ level: 'economy', handheld: true, reason: 'frames' });
    policy.setPerformancePreference('high');
    expect(policy.machineDecision()).toMatchObject({ level: 'high', reason: 'preference' });
    expect(storage.values.get('magna-urbis-performance-level')).toBe('high');
    policy.setPerformancePreference('auto');
    expect(storage.values.has('magna-urbis-performance-learned')).toBe(false);
    expect(policy.machineDecision()).toMatchObject({ level: 'balanced', reason: 'normal' });
  });
  it('keeps a handheld at its level for the session and saves what its windows measured for the next visit', async () => {
    const storage = memoryStorage();
    const policy = await page('?device=handheld', storage);
    const listener = vi.fn();
    policy.onMachineDecision(listener);
    // One slow window can be a burst of tile bakes: the demotion takes two in a row.
    for (let i = 0; i < 20; i++) policy.reportMachineFrame(40);
    expect(storage.values.has('magna-urbis-performance-learned')).toBe(false);
    for (let i = 0; i < 20; i++) policy.reportMachineFrame(40);
    await Promise.resolve();
    expect(JSON.parse(storage.values.get('magna-urbis-performance-learned')!)).toEqual({ level: 'economy', ceiling: 'economy' });
    expect(policy.machineDecision().level).toBe('balanced');
    expect(listener).not.toHaveBeenCalled();
    const next = await page('?device=handheld', storage);
    expect(next.machineDecision()).toMatchObject({ level: 'economy', tier: 'slow', reason: 'frames' });
  });
  it('keeps a handheld off Minimal when its compositor is refused at run time', async () => {
    const policy = await page('?device=handheld');
    policy.reportMachineCompositor(false);
    await Promise.resolve();
    expect(policy.machineDecision()).toMatchObject({ level: 'balanced', reason: 'normal' });
  });
  it('steps a handheld down for good when the map loses its GPU context', async () => {
    const storage = memoryStorage();
    const policy = await page('?device=handheld', storage);
    policy.setPerformancePreference('high');
    policy.reportMachineGpuLoss();
    await Promise.resolve();
    // Nothing moves while the GPU recovers; the next visit starts at Economy in Auto, whatever was chosen.
    expect(policy.machineDecision().level).toBe('high');
    expect(storage.values.get('magna-urbis-performance-level')).toBe('auto');
    expect(JSON.parse(storage.values.get('magna-urbis-performance-learned')!)).toEqual({ level: 'economy', ceiling: 'economy', graphics: true });
    for (let i = 0; i < 40; i++) policy.reportMachineFrame(10);
    expect(JSON.parse(storage.values.get('magna-urbis-performance-learned')!).graphics).toBe(true);
    const next = await page('?device=handheld', storage);
    expect(next.machineDecision()).toMatchObject({ level: 'economy', reason: 'graphics' });
  });
});
