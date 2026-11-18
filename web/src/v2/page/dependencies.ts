/** The page dependency boundary. Retains main.ts's import/CSS evaluation order so splitting mounts does not reorder registration side effects. */
import { setHTML, insertHTML, setText, setUserText, setDynamicText, bindTree, translate, getLanguage, setLanguage, onLanguageChange, initializeLanguage, numberLocale, nameHTML, numberHTML, registerMessages, LANGUAGES, type Language } from '../i18n';
import { getDistanceUnit, setDistanceUnit, onUnitsChange, formatDistance, unitFactor, type DistanceUnit } from '../units';
import { mapPresentation, settlementDisplayName, featureDisplayName } from '../mapPresentation';
import '../ui.css';
import '../editing.css';
import '../workbench.css';
import { mountWorkbenchLayout, groupCultureSelector } from '../workbenchLayout';
import { organizeInspector } from '../advancedPanel';
import { localFactsHtml, type LocalFactsInput } from '../localFacts';
import { firstPendingGeneration, runRemainingGeneration } from '../fullGeneration';
import { activitySitesOf } from '../activitySites';
import { demographicClass, DEMOGRAPHIC_CLASSES } from '../../../../rust/bridge/settlementDemography';
import { mountSceneControls } from '../sceneControls';
import { mountRoadDisplayControl } from '../roadDisplayControl';
import { applySceneClock, DEFAULT_SCENE } from '../sceneClock';
import { mountEditingTools } from '../editingTools';
import logo from '../../ui/assets/logo-magna-urbis.png';
import { CULTURE_LABELS, SITE_ARCHETYPES, type Options } from '../../gen/options';
import { STYLE_LIST, type MapStyle } from '../../render/styles';
import { mountRenderControls, currentComposition, writeAppearanceControl, PRESET_OPTIONS } from '../renderControls';
import { MAP_GPU_FAILED_EVENT, MAP_GPU_LIGHTER_EVENT, MAP_GPU_LIGHTER_MESSAGE, isMapContextLost, type MapContextLostError } from '../../ui/glContextRecovery';
import { showBrowserAdvice } from '../../ui/browserAdvice';
import { ruralSemanticLegend } from '../../render/semanticLayer';
import { resolveSettingsAppearance, resolvedDisplayOptions } from '../appearance';
import { applyAppearancePatch } from '../../render/appearanceRecipe';
import { nativeCityRecords } from '../nativeProducts';
import { cityReachedPopulation, populationText, populationShortfallText } from '../../render/cityPopulation';
import { nameNeighbourWarning } from '../townNeighbours';
import type { World, UrbanBuilding } from '../../gen/types';
import { screenToWorld } from '../../render/view';
import { EXPORT_LAYER_NAMES, type ExportLayers } from '../../render/exportLayers';
import { chooseExportArea, chooseExportCrop } from '../../ui/exportCrop';
import { canvasPng, cropCanvasPng } from '../../ui/canvasExport';
import { supportsSvgExport } from '../exportOptions';
import { exportPng } from '../../ui/pngExport';
import { readHeightmap } from '../../ui/heightmap';
import { acceptHeightmap, imageHeightmap } from '../heightmapModel';
import { StudioClient, type Action } from '../client';
import { defaultSettings, adaptedExtent } from '../settings';
import { validateSettings } from '../project';
import type { V2Settings, V2Progress, V2TownStage } from '../contracts';
import { type QuarterOverride, type BlockOverride, type ParcelOverride } from '../../../../rust/bridge/urbanConfig';
import { houseControlDefaults, urbanField } from '../urbanControlSchema';
import { urbanParameterHelp } from '../urbanParameterHelp';
import { mountParameterForm } from '../parameterForm';
import { compatibleBuildingTypes, forcedUseRefusal, polygonArea } from '../urbanEditOptions';
import { mergedOutline, type LotShape } from '../parcelMerge';
import { massingRoofs } from '../../../../rust/bridge/urbanHouseEdits';
import { blockEditId } from '../../../../rust/bridge/urbanBlockEdits';
import { pointInRing } from '../../gen/geo/poly';
import { runtimeOptions, runtimeWorkerOptions, loopbackServer } from '../platform';
import { applyBuildingEdits, buildingAt, nearestSettlement, townUrban, buildingSignature, validateBuildingPatch, type BuildingEdit } from '../edits';
import ExportWorker from '../export.worker?worker';
import ProjectWorker from '../project.worker?worker';
import { isBinaryProject, MAX_BINARY_PROJECT_BYTES } from '../projectBinary';
import { projectFileMessages } from '../projectFileMessages';
import { resultTransferBuffers } from '../transfer';
import ComposeWorker from '../compose.worker?worker';
import type { RustTownSnapshot } from '../rustUrban';
import { mountTerrainControls } from '../terrainControls';
import { batchUrbanSync, mountUrbanControls, writeUrbanControl, type UrbanControls, type UrbanControlParts } from '../urbanControls';
import { mountStageChain, type StageChain } from '../stageChain';
import { stagesForAction, stageById, type StageDef, type StageFamily } from '../stageRegistry';
import { mountHeightmapSource } from '../heightmapLibrary';
import { mountSettingsPanel, refreshBackends, backendStatus } from '../settingsPanel';
import { backendAlternative, backendFailure, resolveAutoBackend, F as RUNTIME_FALLBACK } from '../runtimeChoices';
import { isNativeConnectionFailure } from '../../../../rust/bridge/nativeAvailability';
import { mountNeuralModelManager } from '../neuralModelManager';
import { mountDesktopNeural } from '../desktopNeural';
import { mountDesktopModules } from '../desktopModules';
import { mountDesktopReleaseLink, mountDesktopUpdates } from '../desktopUpdates';
import { mountV2Illustration } from '../illustration';
import { iconUrl, type IconId } from '../stageIcons';
import { mountRegionControls } from '../regionControls';
import { effectiveRegion } from '../regionSettings';
import { cityStageValidityKeys } from '../stageValidity';
import { SmallPlaceQueue, boundedSmallPlaceRun } from '../smallPlaces';
import { mountMapControls } from '../mapControls';
import { mountNameOriginControls } from '../nameOriginControls';
import { mountMapLabelEditor } from '../mapLabelEditor';
import { mountPlaceRename } from '../placeRename';
import { applyLabelEdits } from '../mapLabels';
import { mountNetworkEditor } from '../networkEditor';
import { mountTownMoveEditor } from '../townMoveEditor';
import { translateLand } from '../../ui/urbanSnapshot';
import { mountSubdivisionActions, mountDeletedSubdivisions } from '../localUrbanEditor';
import { createSelectionOverlay } from '../selectionOverlay';
import { mountMeasureTool } from '../measureTool';
import { mountViewLoadingIndicator, watchDisplayPending } from '../viewLoadingIndicator';
import { resetSubdivisionChildren, rerollSubdivisionBuildings } from '../subdivisionEdits';
import { siteQuarter, siteBlock } from '../../../../rust/bridge/urbanHouseEdits';
import { renameMap } from '../mapNaming';
import type { V2Urban3d } from '../urban3d';
import { migrateUrbanSeeds, rerollUrbanSeeds, rerollSettlement } from '../urbanSeeds';
import { resetRegionalChildren, resetUrbanChildren, regionalParentKey } from '../generationEdits';
import type { UrbanSeedStage } from '../contracts';
import { rerollSeed } from '../../../../rust/bridge/generationSeed';
import { mountCityCodeSharing } from '../cityCodeSharing';
import { mountV2TestHook } from '../testHook';
import { armAutosave, takeAutosave, scheduleAutosave, saveAutosaveNow, mountNewButton } from '../autosave';
import { resetSettings, markAllStagesStale, RESET_LABEL, RESET_TITLE, RESET_CONFIRM, RESET_DONE } from '../settingsReset';
export {
  setHTML,
  insertHTML,
  setText,
  setDynamicText,
  bindTree,
  translate,
  getLanguage,
  setLanguage,
  onLanguageChange,
  initializeLanguage,
  numberLocale,
  nameHTML,
  numberHTML,
  registerMessages,
  LANGUAGES,
  getDistanceUnit,
  onUnitsChange,
  formatDistance,
  unitFactor,
  mapPresentation,
  settlementDisplayName,
  featureDisplayName,
  mountWorkbenchLayout,
  groupCultureSelector,
  organizeInspector,
  localFactsHtml,
  firstPendingGeneration,
  runRemainingGeneration,
  activitySitesOf,
  demographicClass,
  DEMOGRAPHIC_CLASSES,
  mountSceneControls,
  mountRoadDisplayControl,
  applySceneClock,
  DEFAULT_SCENE,
  mountEditingTools,
  logo,
  CULTURE_LABELS,
  STYLE_LIST,
  mountRenderControls,
  currentComposition,
  writeAppearanceControl,
  PRESET_OPTIONS,
  MAP_GPU_FAILED_EVENT,
  MAP_GPU_LIGHTER_EVENT,
  MAP_GPU_LIGHTER_MESSAGE,
  isMapContextLost,
  showBrowserAdvice,
  ruralSemanticLegend,
  resolveSettingsAppearance,
  resolvedDisplayOptions,
  applyAppearancePatch,
  nativeCityRecords,
  cityReachedPopulation,
  populationText,
  populationShortfallText,
  nameNeighbourWarning,
  screenToWorld,
  EXPORT_LAYER_NAMES,
  chooseExportArea,
  chooseExportCrop,
  canvasPng,
  cropCanvasPng,
  supportsSvgExport,
  exportPng,
  readHeightmap,
  acceptHeightmap,
  imageHeightmap,
  StudioClient,
  defaultSettings,
  adaptedExtent,
  validateSettings,
  houseControlDefaults,
  urbanField,
  urbanParameterHelp,
  mountParameterForm,
  compatibleBuildingTypes,
  forcedUseRefusal,
  polygonArea,
  mergedOutline,
  massingRoofs,
  blockEditId,
  pointInRing,
  runtimeOptions,
  runtimeWorkerOptions,
  loopbackServer,
  applyBuildingEdits,
  buildingAt,
  nearestSettlement,
  townUrban,
  buildingSignature,
  validateBuildingPatch,
  ExportWorker,
  ProjectWorker,
  isBinaryProject,
  MAX_BINARY_PROJECT_BYTES,
  projectFileMessages,
  resultTransferBuffers,
  ComposeWorker,
  mountTerrainControls,
  batchUrbanSync,
  mountUrbanControls,
  writeUrbanControl,
  mountStageChain,
  stagesForAction,
  stageById,
  mountHeightmapSource,
  mountSettingsPanel,
  refreshBackends,
  backendStatus,
  backendAlternative,
  backendFailure,
  resolveAutoBackend,
  RUNTIME_FALLBACK,
  isNativeConnectionFailure,
  mountNeuralModelManager,
  mountDesktopNeural,
  mountDesktopModules,
  mountDesktopReleaseLink,
  mountDesktopUpdates,
  mountV2Illustration,
  iconUrl,
  mountRegionControls,
  effectiveRegion,
  cityStageValidityKeys,
  SmallPlaceQueue,
  boundedSmallPlaceRun,
  mountMapControls,
  mountNameOriginControls,
  mountMapLabelEditor,
  mountPlaceRename,
  applyLabelEdits,
  mountNetworkEditor,
  mountTownMoveEditor,
  translateLand,
  mountSubdivisionActions,
  mountDeletedSubdivisions,
  createSelectionOverlay,
  mountMeasureTool,
  mountViewLoadingIndicator,
  watchDisplayPending,
  resetSubdivisionChildren,
  siteQuarter,
  siteBlock,
  renameMap,
  migrateUrbanSeeds,
  rerollUrbanSeeds,
  rerollSettlement,
  resetRegionalChildren,
  resetUrbanChildren,
  regionalParentKey,
  rerollSeed,
  mountCityCodeSharing,
  mountV2TestHook,
  armAutosave,
  takeAutosave,
  scheduleAutosave,
  saveAutosaveNow,
  mountNewButton,
  resetSettings,
  markAllStagesStale,
  RESET_LABEL,
  RESET_TITLE,
  RESET_CONFIRM,
  RESET_DONE,
};
export type {
  Language,
  DistanceUnit,
  LocalFactsInput,
  Options,
  MapContextLostError,
  World,
  UrbanBuilding,
  ExportLayers,
  Action,
  V2Settings,
  V2Progress,
  V2TownStage,
  QuarterOverride,
  BlockOverride,
  ParcelOverride,
  LotShape,
  BuildingEdit,
  UrbanControls,
  UrbanControlParts,
  StageChain,
  StageDef,
  StageFamily,
  IconId,
  V2Urban3d,
  UrbanSeedStage,
};
