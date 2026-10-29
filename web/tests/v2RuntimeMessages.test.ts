import { describe, expect, it } from 'vitest';
import { RUNTIME_MESSAGE_COUNT, runtimeDiagnosticLabel, translateRuntimeMessage as message } from '../src/v2/runtimeMessages';

describe('V2 bilingual runtime messages', () => {
  it('defaults to English and translates real generation/loading messages in both directions', () => {
    expect(message('Recherche du relief et de l’hydrologie conservés…')).toBe('Looking for retained terrain and hydrology…');
    expect(message('Loading the native Rust urban engine…', 'fr')).toBe('Chargement du moteur urbain Rust natif…');
    expect(message('Python : chargement des modeles PyTorch sur CUDA', 'en')).toBe('Python: loading PyTorch models on CUDA');
    expect(message('Neural WASM · transferring weights to the GPU', 'fr')).toBe('Neuronal WASM · transfert des poids vers le GPU');
    expect(RUNTIME_MESSAGE_COUNT).toBeGreaterThan(150);
  });

  it('retains names, identifiers, URLs and numbers in explicit message slots', () => {
    const name = 'Le Pont : Forêt / GPU 3';
    expect(message(`${name} : plan, rues, parcelles et bâtiments…`, 'en')).toBe(`${name}: plan, streets, parcels and buildings…`);
    expect(message('Lieu inconnu : main/layout-abc/building', 'en')).toBe('Unknown settlement: main/layout-abc/building');
    expect(message('Neuronal WASM · base · 150.5 Mo', 'en')).toBe('Neural WASM · base · 150.5 MB');
    expect(message('Rust · houses 3/17…', 'fr')).toBe('Rust · maisons 3/17…');
    expect(message('Cannot download decoder weights: HTTP 404', 'fr')).toBe('Impossible de télécharger les poids decoder : HTTP 404');
    expect(message('Neural service unreachable (http://127.0.0.1:8793): run “npm run neural:python” from web/', 'fr')).toBe('Service neuronal inaccessible (http://127.0.0.1:8793) : lancez « npm run neural:python » depuis web/');
  });

  it('translates every new terrain-water and regional progress headline in both directions', () => {
    const phases = [
      ['Conditionnement du relief avant drainage…', 'Conditioning the terrain before drainage…'],
      ['Hydrologie vectorielle · bilan hydrique, lacs et cours d’eau…', 'Vector hydrology · water budget, lakes and streams…'],
      ['Hydrologie Rust · préparation du drainage…', 'Rust hydrology · preparing drainage…'],
      ['Hydrologie Rust · rivières, lacs et érosion…', 'Rust hydrology · rivers, lakes and erosion…'],
      ['Routage des routes entre les sites conservés…', 'Routing roads between retained sites…'],
      ['Rust · évaluation des sites d’implantation régionaux…', 'Rust · evaluating regional settlement sites…'],
      ['Rust · projection des routes régionales et des franchissements…', 'Rust · projecting regional routes and crossings…'],
      ['Implantations et routes régionales prêtes', 'Regional settlements and roads ready'],
      ['Chargement des poids…', 'Loading model weights…'],
    ] as const;
    for (const [fr, en] of phases) { expect(message(fr, 'en')).toBe(en); expect(message(en, 'fr')).toBe(fr); }
    expect(message('Relief et eau terminés · rust-wasm-cpu · biomes ensuite', 'en')).toBe('Terrain and water complete · rust-wasm-cpu · biomes next');
    expect(message('Terrain and water complete · rust-wasm-cpu · biomes next', 'fr')).toBe('Relief et eau terminés · rust-wasm-cpu · biomes ensuite');
  });

  it('preserves unknown scientific diagnostics and arbitrary map names verbatim', () => {
    for (const value of ['Sancens', 'Le territoire', 'Le Pont de la Rivière', 'Maison de la Forêt', 'Quartier des Jardins', 'Parcelle du Pont', 'main/parcel-001/building', '{"seed":"Forêt"}', 'Physical solver constraint 781: footprint does not fit.']) {
      expect(message(value, 'en')).toBe(value);
      expect(message(value, 'fr')).toBe(value);
    }
    expect(runtimeDiagnosticLabel('en')).toBe('Engine diagnostic (source text)');
    expect(runtimeDiagnosticLabel('fr')).toBe('Diagnostic du moteur (texte source)');
  });

  it('localizes validation templates without changing numeric data or contract field names', () => {
    expect(message('population : nombre attendu entre 0 et 5000000.', 'en')).toBe('population: expected a number between 0 and 5000000.');
    expect(message('height: unknown value.', 'fr')).toBe('height : valeur inconnue.');
    expect(message('Grille flow incompatible.', 'en')).toBe('Incompatible flow grid.');
    expect(message('étendue : nombre attendu entre 600 et 40000.', 'en')).toBe('extent: expected a number between 600 and 40000.');
    expect(message('Relief et hydrologie réutilisés · memory', 'en')).toBe('Terrain and hydrology reused · memory');
    expect(message('Recette des peuplements importée sur le territoire actuel. Implantations, routes et villes à reconstruire ; 7 modification(s) géométrique(s) non fusionnée(s).', 'en')).toBe('Settlement recipe imported onto the current territory. Rebuild sites, roads and towns; 7 geometry edit(s) were not merged.');
  });

  it('translates counts and inspector templates while retaining embedded names and native identifiers', () => {
    expect(message('6 km de côté · selon les peuplements demandés')).toBe('6 km per side · adapted to the requested settlements');
    expect(message('2 lieux implantés · 1 construits')).toBe('2 settlements placed · 1 built');
    expect(message('3 cours d’eau\n2 peuplements')).toBe('3 watercourses\n2 settlements');
    expect(message('160 hab. · harbor')).toBe('160 people · harbor');
    expect(message('1,234,567 hab. · harbor')).toBe('1,234,567 people · harbor');
    expect(message('1\u202f234\u202f567 hab. · harbor')).toBe('1\u202f234\u202f567 people · harbor');
    expect(message('3 quartiers · 80 parcelles · 39 bâtiments')).toBe('3 quarters · 80 parcels · 39 buildings');
    expect(message('Rapport du moteur · 0 refus')).toBe('Engine report · 0 refusals');
    expect(message('Étape : buildings · rust-wasm-cpu. 1 demande(s) de maison recalculée(s) au dernier passage.')).toBe('Stage: buildings · rust-wasm-cpu. 1 house request(s) recomputed in the last run.');
    expect(message('Territoire › Le Pont de la Forêt')).toBe('Territory › Le Pont de la Forêt');
    expect(message('Identifiant du moteur : main/layout-abc')).toBe('Engine identifier: main/layout-abc');
    expect(message('Maison layout-abc/block-123/parcel-456/building')).toBe('House layout-abc/block-123/parcel-456/building');
    expect(message('Le calcul GPU demandé a échoué : GPU indisponible. Choisissez CPU ou Automatique.')).toBe('The requested GPU computation failed: GPU unavailable. Choose CPU or Automatic.');
  });

  it('preserves error classes, nested diagnostic payloads and source line endings', () => {
    const source = 'TypeError: Graine invalide.\r\n    at seed.ts:12:4\nOriginal terrain value: Forêt';
    expect(message(source, 'en')).toBe('TypeError: Invalid seed.\r\n    at seed.ts:12:4\nOriginal terrain value: Forêt');
    expect(message('Python : dernier calcul en echec : cuda error 17 [GPU:0]', 'en')).toBe('Python: the last computation failed: cuda error 17 [GPU:0]');
  });
});
