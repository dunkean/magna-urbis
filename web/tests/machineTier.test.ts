/** Pure machine-tier policy checks: optional hints are neutral, combined constraints demote, explicit style protection wins. */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { decideMachineTier, forcedMachineTier, machineDefaultPreset } from '../src/v2/machineTier';
import { machineViewDefaults } from '../src/v2/machineView';
import { TREE_DISTANCE_MIN, TREE_DISTANCE_DEFAULT } from '../src/ui/terrain3dTrees';
import { VIEW_DEPTH_DEFAULT } from '../src/render/world/viewDepth';
afterEach(() => vi.unstubAllGlobals());
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
  it('applies runtime compositor limits despite style protection and restores the hardware tier after recovery', async () => {
    vi.resetModules();
    vi.stubGlobal('location', { search: '' });
    vi.stubGlobal('navigator', { hardwareConcurrency: 16, deviceMemory: 8 });
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ getExtension: () => null, getParameter: () => 'Hardware GPU' }) }) });
    const policy = await import('../src/v2/machineTier');
    await policy.inspectMachine();
    policy.protectMachineStyle();
    policy.reportMachineCompositor(false);
    expect(policy.machineDecision().tier).toBe('capable');
    await Promise.resolve();
    expect(policy.machineDecision()).toEqual({ tier: 'veryslow', reason: 'compositor' });
    policy.reportMachineCompositor(true);
    await Promise.resolve();
    expect(policy.machineDecision().tier).toBe('capable');
  });
  it('forces detection and maps the normal style to its fast variant', () => {
    expect(forcedMachineTier('very-slow')).toBeUndefined();
    for (const tier of ['capable', 'slow', 'veryslow'] as const) {
      expect(forcedMachineTier(tier)).toBe(tier);
      expect(decideMachineTier({ webgl2: false }, tier)).toEqual({ tier, reason: 'forced' });
    }
    expect(machineDefaultPreset('capable', 'satellite')).toBe('satellite');
    expect(machineDefaultPreset('slow', 'satellite')).toBe('satellite-light');
    expect(machineDefaultPreset('slow', 'parchment')).toBe('parchment-light');
    expect(machineDefaultPreset('veryslow', 'satellite')).toBe('minimal');
  });
  it('publishes measured demotion after the compositor frame returns', async () => {
    vi.resetModules();
    vi.stubGlobal('location', { search: '' });
    vi.stubGlobal('navigator', { hardwareConcurrency: 16, deviceMemory: 8 });
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ getExtension: () => null, getParameter: () => 'Hardware GPU' }) }) });
    const policy = await import('../src/v2/machineTier');
    await policy.inspectMachine();
    const listener = vi.fn();
    policy.onMachineDecision(listener);
    for (let i = 0; i < 20; i++) policy.reportMachineFrame(90);
    expect(listener).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(policy.machineDecision()).toEqual({ tier: 'veryslow', reason: 'frames' });
    expect(listener).toHaveBeenCalledOnce();
  });
  it('keeps an explicit choice protected from later measurements', async () => {
    vi.resetModules();
    const policy = await import('../src/v2/machineTier');
    expect(policy.machineStyleProtected()).toBe(false);
    policy.protectMachineStyle();
    expect(policy.machineStyleProtected()).toBe(true);
    for (let i = 0; i < 20; i++) policy.reportMachineFrame(100);
    expect(policy.machineDecision().tier).toBe('capable');
  });
});
