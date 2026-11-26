/** The page side of the performance level. Every start follows it with its display quality and pixel ratio; the
 * untouched default recipe also swaps preset (machineDefaultPreset: Minimal, or the fast Satellite/Parchment at
 * Economy). That swap is never saved (the autosave keeps the user's composition) and is undone once the level recovers.
 */
import type { PageState, PageActions } from './contract';
import type { V2Settings } from '../contracts';
import { machineStyleProtected, protectMachineStyle, onMachineDecision, reportMachineStruggle, claimPerformancePreference, machineDefaultPreset, type MachineDecision } from '../machineTier';
import { choosePerformance, performanceKnobs } from '../machineView';
import { showMachineNotice } from '../machineNotice';
import { currentComposition } from '../renderControls';
import { defaultSettings } from '../settings';
import { presetComposition, type CompositionRecipe, type PresetId } from '../../render/composition';
import { onDisplayStruggle, setDisplayAppearanceQuality, setDisplayPixelRatioCap, setDisplayQualityPolicy } from '../../render/displayQuality';

/** Mounted before the machine inspection publishes, on every start including links and tests. */
export function mountPerformancePolicy(): void {
  onMachineDecision(decision => {
    const knobs = performanceKnobs(decision);
    setDisplayQualityPolicy(knobs.quality);
    // The viewer re-sizes its canvases, at the new ratio, on a window resize.
    if (setDisplayPixelRatioCap(knobs.pixelRatioCap)) window.dispatchEvent(new Event('resize'));
  });
  onDisplayStruggle(reportMachineStruggle);
}

/** A copy of the scene clock: the environment is chosen independently of the map style. */
function keepSceneClock(target: CompositionRecipe, source: CompositionRecipe): void {
  const { season, ambience, lighting, calendar } = source.effects;
  Object.assign(target.effects, { season, ambience, lighting: { ...lighting }, ...(calendar ? { calendar: { ...calendar } } : {}) });
}

let swap: { settings: V2Settings; full: CompositionRecipe; shown: PresetId } | undefined;
/** The user's composition while a machine preset stands in for it in `settings`. A picked style, or an edit that makes the
 * shown composition the user's own, ends the swap. The scene clock is edited independently of the style: it follows. */
function standing(settings: V2Settings): CompositionRecipe | undefined {
  if (!swap || swap.settings !== settings) return undefined;
  const shown = currentComposition(settings);
  if (machineStyleProtected() || shown.preset !== swap.shown) {
    swap = undefined;
    return undefined;
  }
  keepSceneClock(swap.full, shown);
  return swap.full;
}
/** The recipe the autosave keeps: never the machine's stand-in preset. */
export function persistedSettings(settings: V2Settings): V2Settings {
  const full = standing(settings);
  return full && settings.appearance ? { ...settings, appearance: { ...settings.appearance, composition: full } } : settings;
}

/** One-shot, on the first fresh start with performance levels: older saves persisted a machine-chosen Minimal or fast
 * preset; give it back its full style. */
export function repairMachinePreset(settings: V2Settings): void {
  if (!claimPerformancePreference()) return;
  const composition = settings.appearance?.composition,
    preset = composition?.preset;
  if (!composition || (preset !== 'minimal' && preset !== 'satellite-light' && preset !== 'parchment-light')) return;
  const full = presetComposition(preset === 'minimal' ? ((defaultSettings().appearance?.composition?.preset ?? 'satellite') as PresetId) : preset === 'satellite-light' ? 'satellite' : 'parchment');
  keepSceneClock(full, composition);
  settings.appearance!.composition = full;
}

export function mountMachineDefault(state: PageState, actions: PageActions, choice: MachineDecision): void {
  const settings = state.settings;
  let removeNotice: (() => void) | undefined, noticed: string | undefined;
  const show = (composition: CompositionRecipe): void => {
    settings.appearance ??= { style: settings.options.style };
    settings.appearance.composition = composition;
    setDisplayAppearanceQuality(composition.quality ?? 'full');
    actions.syncDisplayWidgets();
    state.renderControls.sync();
    void actions.refreshAppearance();
  };
  const restore = (): void => {
    const full = standing(settings);
    swap = undefined;
    if (full) show(full);
  };
  const apply = (next: MachineDecision): void => {
    const key = next.reason !== 'preference' && (next.level === 'minimal' || next.level === 'economy') ? `${next.level}|${next.reason}` : undefined;
    if (key !== noticed) {
      noticed = key;
      removeNotice?.();
      removeNotice = key
        ? showMachineNotice(next, () => {
            // A hard limit keeps the level at Minimal: only protecting the style shows the full look then.
            if (next.reason === 'software' || next.reason === 'webgl' || next.reason === 'compositor') {
              if (!machineStyleProtected()) restore();
              protectMachineStyle();
            }
            choosePerformance(next.handheld ? 'balanced' : 'high');
          })
        : undefined;
    }
    // A picked style, a loaded project or a restored autosave protects the recipe: its composition is the user's.
    if (machineStyleProtected() || state.settings !== settings) return;
    const full = standing(settings) ?? structuredClone(currentComposition(settings)),
      preset = full.preset === 'custom' ? 'custom' : machineDefaultPreset(next.level, full.preset);
    if (preset === full.preset) return restore();
    if (currentComposition(settings).preset === preset) return;
    const shown = presetComposition(preset as PresetId);
    keepSceneClock(shown, full);
    swap = { settings, full, shown: preset as PresetId };
    show(shown);
  };
  onMachineDecision(apply);
  apply(choice);
}
