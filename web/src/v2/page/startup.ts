/** Browser recovery, message registration and the initial recipe. main.ts calls the mounts at the original startup positions to preserve page side effects. */
import type { PageState } from './state';
import type { PageActions } from './actions';
import { translate, numberLocale, registerMessages, settlementDisplayName, DEMOGRAPHIC_CLASSES, applySceneClock, DEFAULT_SCENE, showBrowserAdvice, defaultSettings, runtimeOptions, projectFileMessages, resolveAutoBackend } from './dependencies';

/** Browser recovery, message registration and the initial recipe. Called by main.ts in startup order. */
export function mountPageStartup(state: PageState, actions: PageActions): void {
  showBrowserAdvice();

  // A redeploy replaces the hashed chunks: a page opened before it fails to load a lazy module ("Failed to fetch
  // dynamically imported module"). Reload once to pick up the new build instead of breaking the view.
  window.addEventListener('vite:preloadError', event => {
    let reloaded = false;
    try {
      reloaded = sessionStorage.getItem('magna-chunk-reload') === '1';
      sessionStorage.setItem('magna-chunk-reload', '1');
    } catch {
      /* storage blocked */
    }
    if (reloaded) return;
    event.preventDefault();
    location.reload();
  });

  // Forget the guard once the fresh page has run a while, so a later redeploy is handled again (never a reload loop).
  window.addEventListener('load', () =>
    setTimeout(() => {
      try {
        sessionStorage.removeItem('magna-chunk-reload');
      } catch {
        /* storage blocked */
      }
    }, 60_000),
  );

  for (const cls of DEMOGRAPHIC_CLASSES) registerMessages({ [cls.id]: { en: cls.label, fr: cls.labelFr } });

  registerMessages({ 'Modifier villes, quartiers et bâtiments': { en: 'Edit towns, districts & buildings', fr: 'Modifier villes, quartiers et bâtiments' } });

  registerMessages({
    'Changes pending. Regenerate to apply them to this area and its descendants.': { en: 'Changes pending. Regenerate to apply them to this area and its descendants.', fr: 'Modifications en attente. Régénérer les applique à cette zone et à ses descendants.' },
    'Regenerate keeps the seed. The dice creates a new random layout and descendants.': { en: 'Regenerate keeps the seed. The dice creates a new random layout and descendants.', fr: 'Régénérer conserve la graine. Le dé crée un nouveau plan aléatoire et ses descendants.' },
    Block: { en: 'Block', fr: 'Îlot' },
    'Regenerate area': { en: 'Regenerate area', fr: 'Régénérer la zone' },
    'Regenerate building': { en: 'Regenerate building', fr: 'Régénérer le bâtiment' },
    'Use parent settings': { en: 'Use parent settings', fr: 'Réglages du parent' },
    'Remove local overrides and regenerate using the parent settings.': { en: 'Remove local overrides and regenerate using the parent settings.', fr: 'Retirer les réglages locaux et régénérer avec ceux du parent.' },
    'Regenerate this area and its descendants. Display settings stay unchanged.': { en: 'Regenerate this area and its descendants. Display settings stay unchanged.', fr: 'Régénère cette zone et ses descendants. Le mode de rendu est conservé.' },
    'Local editing requires the Rust engine.': { en: 'Local editing requires the Rust engine.', fr: 'L’édition locale nécessite le moteur Rust.' },
    House: { en: 'House', fr: 'Maison' },
    'Always show this name': { en: 'Always show this name', fr: 'Toujours afficher ce nom' },
    'Back to city': { en: 'Back to city', fr: 'Retour à la ville' },
    'Reroll house': { en: 'Reroll house', fr: 'Nouvelle variation' },
    'Apply selection': { en: 'Apply selection', fr: 'Appliquer à la sélection' },
    'Choose a style, roof or storeys, then apply.': { en: 'Choose a style, roof or storeys, then apply.', fr: 'Choisissez un style, un toit ou des étages, puis appliquez.' },
    'Update the Rust engine to edit the roof or storeys while retaining the existing footprint.': {
      en: 'Update the Rust engine to edit the roof or storeys while retaining the existing footprint.',
      fr: 'Actualisez le moteur Rust pour modifier le toit ou les étages en conservant l’emprise.',
    },
    'This model does not fit the parcel. The previous building is retained.': { en: 'This model does not fit the parcel. The previous building is retained.', fr: 'Ce modèle ne tient pas dans la parcelle. Le bâtiment précédent est conservé.' },
    'Replace descendant overrides': { en: 'Replace descendant overrides', fr: 'Remplacer les réglages des descendants' },
    'Local choices take priority unless replaced. Only affected stages are rebuilt.': {
      en: 'Local choices take priority unless replaced. Only affected stages are rebuilt.',
      fr: 'Les choix locaux restent prioritaires, sauf remplacement. Seules les étapes concernées sont recalculées.',
    },
    'House edit refused. The previous buildings have been retained.': { en: 'House edit refused. The previous buildings have been retained.', fr: 'Modification refusée. Les bâtiments précédents sont conservés.' },
  });

  registerMessages({
    'Cartographic maps': { en: 'Cartographic maps', fr: 'Cartes graphiques' },
    'Terrain materials': { en: 'Terrain materials', fr: 'Matériaux du terrain' },
    'Painted fantasy maps': { en: 'Painted fantasy maps', fr: 'Cartes fantasy peintes' },
    Diagnostics: { en: 'Diagnostics', fr: 'Diagnostics' },
    'Fantasy · Encre N&B': { en: 'Fantasy · Black & white ink', fr: 'Fantasy · Encre N&B' },
    'Fantasy · Aquarelle': { en: 'Fantasy · Watercolour', fr: 'Fantasy · Aquarelle' },
    'Elevation · DEM': { en: 'Elevation · DEM', fr: 'Altitude · DEM' },
    'SVG · map / embedded render': { en: 'SVG · map / embedded render', fr: 'SVG · carte / rendu intégré' },
  });

  registerMessages({
    'Render3D · Multiscale': { en: 'Render3D · Multiscale', fr: 'Render3D · Multi-échelle' },
    'Render v2 - Satellite': { en: 'Render v2 - Satellite', fr: 'Render v2 - Satellite' },
    'Render v2 - Substrate': { en: 'Render v2 - Substrate', fr: 'Render v2 - Substrat' },
    'Render v2 - Moisture': { en: 'Render v2 - Moisture', fr: 'Render v2 - Humidité' },
    'Render v2 - Vegetation': { en: 'Render v2 - Vegetation', fr: 'Render v2 - Végétation' },
    'Render v2 - Snow / ice': { en: 'Render v2 - Snow / ice', fr: 'Render v2 - Neige / glace' },
  });

  registerMessages({
    Réglages: { en: 'Settings', fr: 'Réglages' },
    'Réglages, moteurs et activité': { en: 'Settings, engines and activity', fr: 'Réglages, moteurs et activité' },
    'Toute la chaîne': { en: 'Whole chain', fr: 'Toute la chaîne' },
    'Générer toute la chaîne : relief, peuplements et villes': { en: 'Generate the whole chain: relief, settlements and cities', fr: 'Générer toute la chaîne : relief, peuplements et villes' },
    'Implanter et construire': { en: 'Place and build', fr: 'Implanter et construire' },
    'Recette JSON': { en: 'Recipe JSON', fr: 'Recette JSON' },
    'Les lieux': { en: 'Places', fr: 'Les lieux' },
    'Replier la liste': { en: 'Collapse the list', fr: 'Replier la liste' },
    'Créer le relief': { en: 'Create the relief', fr: 'Créer le relief' },
    'Redraw the map': { en: 'Redraw the map', fr: 'Redessiner la carte' },
    'Implanter et relier': { en: 'Place and connect', fr: 'Implanter et relier' },
    'Construire tous les lieux': { en: 'Build every place', fr: 'Construire tous les lieux' },
    Courbes: { en: 'Contours', fr: 'Courbes' },
    Milieux: { en: 'Land cover', fr: 'Milieux' },
    Noms: { en: 'Names', fr: 'Noms' },
    'Adresses des modèles et services': { en: 'Model and service addresses', fr: 'Adresses des modèles et services' },
    'Chaîne de génération': { en: 'Generation chain', fr: 'Chaîne de génération' },
    'Réglages & moteurs': { en: 'Settings & engines', fr: 'Réglages & moteurs' },
  });

  registerMessages({ 'Full generation': { en: 'Full generation', fr: 'Génération complète' } });

  state.settings = defaultSettings();

  applySceneClock(state.settings, DEFAULT_SCENE);

  state.world = undefined;

  state.pristine = undefined;

  /** Inspection can replace the display without discarding the completed project. */
  state.previewBase = undefined;

  registerMessages({
    'Stage output': { en: 'Stage output', fr: 'Sortie de l’étape' },
    'Elevations from this stage. Later stages remain to be run.': { en: 'Elevations from this stage. Later stages remain to be run.', fr: 'Altitudes de cette étape. Les étapes suivantes restent à exécuter.' },
  });

  state.mods = [];

  /** Background build of small places (assigned with the generation helpers below). */
  state.smallPlaces = undefined;

  /** City recipe key of the map produced by the last run that built towns; undefined = no background pass on this map. */
  state.smallPlaceRecipe = undefined;

  state.lastGesture = 0;

  state.selectedTown = 'main';

  state.cityScope = 'all';

  state.selectedCities = new Set<string>();

  registerMessages({
    'Build targeted cities': { en: 'Build targeted cities', fr: 'Construire les villes ciblées' },
    'Select all': { en: 'Select all', fr: 'Tout sélectionner' },
    'Clear selection': { en: 'Clear selection', fr: 'Vider la sélection' },
    '{count} selected': { en: '{count} selected', fr: '{count} sélectionnées' },
    'Select {name} for generation': { en: 'Select {name} for generation', fr: 'Sélectionner {name} pour la génération' },
    'Select at least one city in the list on the right.': { en: 'Select at least one city in the list on the right.', fr: 'Sélectionnez au moins une ville dans la liste à droite.' },
    'Placed · no urban plan': { en: 'Placed · no urban plan', fr: 'Implantée · sans plan urbain' },
    'Stage: roads & quarters': { en: 'Stage: roads & quarters', fr: 'Étape : routes et quartiers' },
    'Stage: parcels': { en: 'Stage: parcels', fr: 'Étape : parcelles' },
    'Stage: programme': { en: 'Stage: programme', fr: 'Étape : programme' },
    'Stage: houses': { en: 'Stage: houses', fr: 'Étape : maisons' },
  });

  registerMessages({
    '{count} inh.': { en: '{count} inh.', fr: '{count} hab.' },
    '{count} inh. (target {target})': { en: '{count} inh. (target {target})', fr: '{count} hab. (cible {target})' },
    'Capacity shortfall: {households} households (≈ {people} inh.) not housed.': { en: 'Capacity shortfall: {households} households (≈ {people} inh.) not housed.', fr: 'Capacité insuffisante : {households} ménages (≈ {people} hab.) non logés.' },
    'Absorbed by {name}': { en: 'Absorbed by {name}', fr: 'Absorbé par {name}' },
  });

  state.placeName = (key: string): string => (state.world && settlementDisplayName(state.world, key, state.settings)) || key;

  state.popFormat = () => ({ t: translate, locale: numberLocale() });

  state.selectedBuilding = null;

  state.selectedSubdivision = undefined;

  state.busy = false;
  state.cancelled = false;
  state.currentTab = 'terrain';
  state.toastTimer = undefined;

  state.elapsedTimer = undefined;

  state.logs = [];

  state.projectRevision = 0;

  state.bootRuntime = runtimeOptions();

  state.localEdition = state.bootRuntime.profile === 'local';

  state.connectLocal = state.localEdition;

  // The installed launcher already owns a ready native service; avoid loading WASM for the same CPU work.
  if (state.localEdition) {
    state.settings.generation = 'procedural';
    state.settings.runtime = { ...state.settings.runtime!, backend: 'native', source: 'procedural', localServer: state.bootRuntime.localServer, pythonServer: state.bootRuntime.pythonServer };
    delete state.settings.runtime.autoBackend;
  } else resolveAutoBackend(state.settings);

  registerMessages(projectFileMessages);
}
