import { registeredEnglishMessages } from '../../src/v2/i18n';
import { interfaceEnglish, interfaceFrench } from '../../src/v2/interfaceMessages';
import { runtimeEnglishSources } from '../../src/v2/runtimeMessages';
import { terrainControlMessages } from '../../src/v2/terrainControlSchema';
import { localeMessages } from '../../src/v2/localeMessages';

export const TARGET_LANGUAGES = ['es', 'pt', 'zh', 'ar', 'ru', 'ja'] as const;

/** Modules whose registerMessages calls must run before collecting. Each is imported if it loads in Node. */
const FEATURE_MODULES: Record<string, () => Promise<unknown>> = {
  mapLabelEditor: () => import('../../src/v2/mapLabelEditor'),
  mapControls: () => import('../../src/v2/mapControls'),
  compositionControls: () => import('../../src/ui/compositionControls'),
  terrainControlSchema: () => import('../../src/v2/terrainControlSchema'),
  regionControls: () => import('../../src/v2/regionControls'),
  renderControls: () => import('../../src/v2/renderControls'),
  runtimeChoices: () => import('../../src/v2/runtimeChoices'),
  settingsPanel: () => import('../../src/v2/settingsPanel'),
  stageChain: () => import('../../src/v2/stageChain'),
  cityCodeSharing: () => import('../../src/v2/cityCodeSharing'),
  networkEditor: () => import('../../src/v2/networkEditor'),
  neuralModelManager: () => import('../../src/v2/neuralModelManager'),
};

/** Strings that must stay identical in every language: proper names, units, codes. */
export const UNTRANSLATED_ALLOWLIST = new Set<string>(['MU1', 'JSON', 'WebGPU', 'rust-native', 'cpu', 'gpu', 'gpu-f32', 'wasm', 'native', 'rust-wasm-cpu', 'rust-native-cpu', 'typescript-cpu', 'rust-webgpu', 'vector-cpu']);

export async function loadFeatureModules(): Promise<{ loaded: string[]; skipped: Record<string, string> }> {
  const loaded: string[] = [],
    skipped: Record<string, string> = {};
  for (const [name, load] of Object.entries(FEATURE_MODULES)) {
    try {
      await load();
      loaded.push(name);
    } catch (error) {
      skipped[name] = String((error as Error)?.message ?? error).slice(0, 120);
    }
  }
  return { loaded, skipped };
}

export function collectEnglishSources(): { interface: string[]; runtime: string[]; registered: string[]; all: string[] } {
  const ui = [...new Set([...Object.keys(interfaceFrench), ...Object.values(interfaceEnglish)])];
  const runtime = [...new Set(runtimeEnglishSources())];
  // terrainControls.ts registers these inside a function that needs the DOM, so read the schema collection directly.
  const registered = [
    ...new Set([
      ...registeredEnglishMessages(),
      ...Object.values(terrainControlMessages)
        .filter(({ en, fr }) => en !== fr && !/ · [\d.]+ MB$/.test(en))
        .map(message => message.en),
    ]),
  ];
  const all = [...new Set([...ui, ...runtime, ...registered].map(text => text.trim()).filter(Boolean))];
  return { interface: ui, runtime, registered, all };
}

export function missingTranslations(language: (typeof TARGET_LANGUAGES)[number], sources: string[]): string[] {
  const dictionary = localeMessages[language];
  return sources.filter(text => !UNTRANSLATED_ALLOWLIST.has(text) && !Object.hasOwn(dictionary, text));
}
