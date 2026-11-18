import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translateRuntimeMessage as message } from '../../src/v2/runtimeMessages';

const root = resolve(__dirname, '../..');
const sources = { 'src/v2/engine.ts': resolve(root, 'src/v2/engine.ts'), 'src/v2/engine.worker.ts': resolve(root, 'src/v2/engine.worker.ts'), 'rust/bridge/terrain.ts': resolve(root, '../rust/bridge/terrain.ts') };

describe('runtime messages are authored in English', () => {
  for (const [name, file] of Object.entries(sources)) {
    it(`${name} has no mojibake`, () => {
      const text = readFileSync(file, 'utf8');
      const bad = text
        .split(/\r?\n/)
        .map((line, index) => [index + 1, line] as const)
        .filter(([, line]) => /Ã|â€/.test(line));
      expect(bad.map(([index, line]) => `${index}: ${line.trim().slice(0, 100)}`)).toEqual([]);
    });
  }

  it('translates the English source strings to French and Spanish', () => {
    expect(message('Topography ready', 'fr')).toBe('Topographie prête');
    expect(message('Terrain settings have changed. Regenerate the topography before continuing.', 'fr')).toBe('Les paramètres du terrain ont changé. Régénérez la topographie avant de poursuivre.');
    expect(message('Tower: plan, streets, parcels and buildings…', 'fr')).toBe('Tower : plan, rues, parcelles et bâtiments…');
    expect(message('Settlement 3/12 (Tower)', 'fr')).toBe('Lieu 3/12 (Tower)');
    expect(message('Settlement 3/12 (Tower)', 'es')).toBe('Asentamiento 3/12 (Tower)');
    expect(message('Underdark · carving caverns and tunnels…', 'fr')).toBe('Outreterre · creusement des cavernes et des tunnels…');
    expect(message('Local Rust service · computing the 2048 × 2048 physical field', 'fr')).toBe('Service Rust local · calcul du champ physique 2048 × 2048');
    expect(message('Rust/WASM · 4096² physical source at 12.50 m', 'fr')).toBe('Rust/WASM · source physique 4096² à 12.50 m');
    expect(message('No map to process.', 'es')).toBe('No hay mapa para procesar.');
    expect(message('Native Rust · procedural pipeline…', 'es')).toBe('Rust nativo · pipeline procedural…');
    expect(message('Local Rust service · computing the 2048 × 2048 physical field', 'es')).toBe('Servicio Rust local · calculando el campo físico 2048 × 2048');
    expect(message('Source 1024²: the fixed GPU cost exceeds the estimated CPU compute. Rust CPU generation at 3.00 m…', 'es')).toBe('Fuente 1024²: el coste fijo de la GPU supera el cálculo estimado en CPU. Generación Rust en CPU a 3.00 m…');
    expect(message('Failed: boom', 'es')).toBe('Error: boom');
  });

  it('still maps the former French sources to English', () => {
    expect(message('Rust/WASM · champ physique 1024 × 1024', 'en')).toBe('Rust/WASM · 1024 × 1024 physical field');
    expect(message('Étape : roads · native. 3 demande(s) de maison recalculée(s) au dernier passage.', 'en')).toBe('Stage: roads · native. 3 house request(s) recomputed in the last run.');
  });
});
