/** Applies startup/navigation machine decisions only to the untouched default recipe.
 * Page boot calls this after autosave lookup; project imports and preset controls protect their choices immediately.
 */
import type { PageState, PageActions } from './contract';
import { machineStyleProtected, protectMachineStyle, onMachineDecision, machineDefaultPreset, type MachineDecision } from '../machineTier';
import { showMachineNotice } from '../machineNotice';
import { currentComposition } from '../renderControls';
import { presetComposition, type PresetId } from '../../render/composition';
import { setDisplayQualityPreference, setDisplayAppearanceQuality } from '../../render/displayQuality';
import { saveAutosaveNow } from '../autosave';
export function mountMachineDefault(state: PageState, actions: PageActions, choice: MachineDecision): void {
  const settings = state.settings,
    full = structuredClone(currentComposition(settings));
  let removeNotice: (() => void) | undefined;
  const apply = (next: MachineDecision): void => {
    if (machineStyleProtected() || state.settings !== settings) return;
    const preset = machineDefaultPreset(next.tier, full.preset as PresetId);
    if (currentComposition(settings).preset === preset) return;
    settings.appearance ??= { style: settings.options.style };
    settings.appearance.composition = preset === full.preset ? structuredClone(full) : presetComposition(preset);
    // Keep the independently selected scene clock when adapting the map style.
    const { season, ambience, lighting, calendar } = full.effects;
    Object.assign(settings.appearance.composition.effects, { season, ambience, lighting: { ...lighting }, ...(calendar ? { calendar: { ...calendar } } : {}) });
    setDisplayAppearanceQuality(settings.appearance.composition.quality ?? 'full');
    actions.syncDisplayWidgets();
    state.renderControls.sync();
    void actions.refreshAppearance();
    removeNotice?.();
    removeNotice = showMachineNotice(next, preset, () => {
      protectMachineStyle();
      settings.appearance!.composition = structuredClone(full);
      setDisplayQualityPreference('full');
      setDisplayAppearanceQuality('full');
      actions.syncDisplayWidgets();
      state.renderControls.sync();
      void actions.refreshAppearance();
      saveAutosaveNow();
    });
    saveAutosaveNow();
  };
  onMachineDecision(apply);
  document.addEventListener('change', () => {
    if (machineStyleProtected()) removeNotice?.();
  });
  apply(choice);
}
