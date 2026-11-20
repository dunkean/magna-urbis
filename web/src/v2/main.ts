/**
 * Entry of the V2 page (web/v2.html): loads the page's styles and modules, then runs the start-up below, top to
 * bottom. Each step mounts one part of the page. Every operation a control calls (`actions`) is built before the first
 * mount and runs only later (user events, runs, the boot).
 *
 * Why this order: mounts append into shared containers (the style control, the header tools, the settings dialog, the
 * chain's stages) and add listeners to the same window events (`v2-edit-mode`, pointer and key events, language
 * changes), which run in registration order. The comments below name the dependencies that are not just DOM order.
 */

// Module evaluation order. These modules inject a stylesheet, or register messages or listeners, when they load: they
// load in this order so the CSS cascade (a later sheet wins at equal specificity) and the message table (a later
// registration of the same text wins) stay as they are. A new styled or self-registering module joins this list.
import './i18n';
import './ui.css';
import './editing.css';
import './workbench.css';
import './workbenchLayout'; // with cultureBrowser, advancedPanel, cityPatternChoices, renderSettingsPanel, nameVisibilityControls, sectionIndex, renderPassControls, settlementPopulationPanel
import './localFacts';
import './sceneControls';
import './editingTools';
import '../ui/exportCrop';
import './client'; // with desktopNeural, desktopUpdates
import './urbanControlSchema'; // with urbanParameterHelp
import './terrainControls'; // with terrainSketchControls
import './urbanControls'; // with regionalExitsPanel, regionControls, styleMixEditor
import './stageChain'; // with heightmapLibrary
import './neuralModelManager';
import './desktopModules';
import './illustration';
import './nameOriginControls';
import './placeRename';
import './townMoveEditor';
import './measureTool';
import './viewLoadingIndicator';
import './autosave';
import './settingsReset';

import { createPageState } from './page/state';
import { createPageActions } from './page/actions';
import { mountPageStartup } from './page/startup';
import { mountPageShell } from './page/elements';
import { mountMapClient } from './page/mapClient';
import { mountAppearanceControls } from './page/appearance';
import { mountView3d } from './page/view3d';
import { mountGenerationControls, mountStageControls, mountUrbanStageForms } from './page/stageChain';
import { mountRuntimeSettings, mountNeuralModels } from './page/runtime';
import { mountMapEditing } from './page/mapEditing';
import { mountPlaces } from './page/places';
import { mountEditingToolbar } from './page/editingToolbar';
import { mountRecipeTracking } from './page/settings';
import { mountBackgroundPlaces } from './page/generation';
import { mountToolbar } from './page/toolbar';
import { mountProjectFiles } from './page/projects';
import { mountExports } from './page/exports';
import { mountPageDisposal } from './page/disposal';
import { mountPreferences } from './page/preferences';
import { mountPageBoot } from './page/bootstrap';

const state = createPageState();
const actions = createPageActions(state);

mountPageStartup();
mountPageShell(state.localEdition);
mountMapClient(state, actions);
// The render status (appearance) precedes the 3D buttons in the style control.
mountAppearanceControls(state, actions);
mountView3d(state, actions);
// The forms mount first; the chain, two steps below, moves them into its stage rows.
mountGenerationControls(state, actions);
mountRuntimeSettings(state, actions);
mountStageControls(state, actions);
mountMapEditing(state, actions);
// These two fill stages of the chain: the urban forms its city stages, the neural model shortcut its relief stage.
mountUrbanStageForms(state, actions);
mountNeuralModels(state, actions);
mountPlaces(state, actions);
mountEditingToolbar(state);
// Seeds the regional parent from the recipe as the forms above left it.
mountRecipeTracking(state);
mountBackgroundPlaces(state, actions);
mountToolbar(state, actions);
mountProjectFiles(state, actions);
mountExports(state, actions);
// Its beforeunload listener disposes the controls mounted above.
mountPageDisposal(state, actions);
// Mounted after every form it syncs; it also runs initializeLanguage once every language listener exists.
mountPreferences(state, actions);
await mountPageBoot(state, actions);
