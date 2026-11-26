/** View capability and defaults shared by the page controls, appearance resolver and script hook.
 * Machine defaults never become persisted preferences; explicit project/browser values win. */
import { TREE_DISTANCE_DEFAULT, TREE_DISTANCE_MIN } from '../ui/terrain3dTrees';
import { VIEW_DEPTH_DEFAULT } from '../render/world/viewDepth';
import { setDisplayQualityPreference, type ResolvedDisplayQuality } from '../render/displayQuality';
import { setPerformancePreference, type MachineDecision, type MachineTier, type PerformancePreference } from './machineTier';

export function machineViewDefaults(tier: MachineTier): { available: boolean; trees3d: boolean; treeDistance: number; viewDepth: number } {
  return { available: tier !== 'veryslow', trees3d: false, treeDistance: tier === 'capable' ? TREE_DISTANCE_DEFAULT : TREE_DISTANCE_MIN, viewDepth: VIEW_DEPTH_DEFAULT };
}
export interface PerformanceKnobs {
  /** Device pixels per CSS pixel of the live canvases; captures keep the device's own. */
  pixelRatioCap: number;
  /** Display quality Auto resolves to; undefined keeps the hint/probe automatic quality. */
  quality: ResolvedDisplayQuality | undefined;
  available3d: boolean;
}
/** A handheld always follows its level. A desktop keeps its automatic quality unless it is at Economy or the user chose a level. */
export function performanceKnobs(d: Pick<MachineDecision, 'level' | 'reason' | 'handheld'>): PerformanceKnobs {
  const low = d.level === 'minimal' || d.level === 'economy';
  const quality = d.handheld ? (low ? 'light' : 'full') : d.level === 'economy' ? 'light' : d.reason === 'preference' ? 'full' : undefined;
  return { pixelRatioCap: d.handheld ? (low ? 1.5 : 2) : Infinity, quality, available3d: d.level !== 'minimal' };
}
/** The Settings › Performance choice is the single visible control: it also drops an explicit display quality. */
export function choosePerformance(preference: PerformancePreference): void {
  setDisplayQualityPreference('auto');
  setPerformancePreference(preference);
}
