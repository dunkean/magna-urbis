import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { STAGES, FAMILIES, SETTINGS_PANEL_CONTROLS, stagesForControl, stageDocUrl, stageForProgress, stagesForAction, GENERATION_STAGE_ROWS, type StageContext } from '../src/v2/stageRegistry';
import { allTerrainFields, terrainProceduralStageFields } from '../src/v2/terrainControlSchema';
import { regionControlFields } from '../src/v2/regionControls';
import { urbanControlFields } from '../src/v2/urbanControlSchema';
import { renderControlFields, RENDER_SECTION_FIELDS } from '../src/v2/renderControls';
import { GENERATION_STAGES, validateProceduralRecipe } from '../../rust/bridge/terrainGenerationRecipe';
import { writeSettingPath } from '../src/v2/parameterForm';
import { HEIGHTMAP_LIBRARY } from '../src/v2/heightmapLibrary';

const once = (id: string) => expect(stagesForControl(id), id).toHaveLength(1);
const MAIN_CONTROLS = ['town-count', 'population', 'culture', 'urban-backend', 'sprawl', 'walls', 'moat', 'castle', 'cathedral', 'palace', 'monasteries', 'port', 'arena', 'activities', 'suburbs'];
const URBAN_EXTRAS = ['header', 'phases', 'archetypes', 'mixtures', 'catalogue'];

describe('V2 generation stage registry', () => {
  it('uses exactly the stage ids of docs/stage-registry-contract.md, in order', () => {
    const contract = readFileSync(new URL('../../docs/stage-registry-contract.md', import.meta.url), 'utf8');
    const ids = Array.from(contract.matchAll(/^\| ([a-z]+-[a-z-]+) \|/gm), match => match[1]);
    expect(STAGES.map(stage => stage.id)).toEqual(ids);
    expect(new Set(STAGES.map(stage => stage.family))).toEqual(new Set(FAMILIES.map(family => family.id)));
  });
  it('assigns every existing control to exactly one stage (or the Settings panel)', () => {
    for (const field of [...allTerrainFields, ...terrainProceduralStageFields]) once(field.path);
    for (const field of regionControlFields) once(`region.${field.path}`);
    const urbanSections = new Set(urbanControlFields().map(field => field.section));
    for (const section of urbanSections) once(`urban-section:${section}`);
    for (const extra of URBAN_EXTRAS) once(`urban-extra:${extra}`);
    for (const field of renderControlFields) {
      const path = field.path.replace('appearance.', ''), sections = Object.entries(RENDER_SECTION_FIELDS).filter(([, paths]) => paths.includes(path));
      expect(sections, path).toHaveLength(1);
      once(`render-section:${sections[0][0]}`);
    }
    for (const id of MAIN_CONTROLS) once(`main:${id}`);
    for (const id of SETTINGS_PANEL_CONTROLS) expect(stagesForControl(id)).toEqual(['settings']);
  });
  it('lets every row act: quick controls belong to the row, toggles target optional stages', () => {
    for (const stage of STAGES) {
      for (const id of stage.quick) if (!/^(widget|toggle|seg|urban)[:.]/.test(id)) expect(stagesForControl(id), `${stage.id} quick ${id}`).toEqual([stage.id]);
      expect(!!stage.toggle, stage.id).toBe(stage.optional);
      if (stage.toggle?.path?.startsWith('terrain.procedural.enabled.')) {
        const id = stage.toggle.path.split('.').at(-1)!;
        expect(GENERATION_STAGES.find(([key]) => key === id)?.[2], id).toBe(true);
      }
    }
    for (const row of Object.values(GENERATION_STAGE_ROWS)) expect(STAGES.some(stage => stage.id === row), row).toBe(true);
  });
  it('shows source-specific relief rows only for their source', () => {
    const ctx = (relief: StageContext['relief']): StageContext => ({ relief, classicTerrain: false, finiteRelief: false, urban: 'rust', hasTerrain: false, hasRegion: false });
    const visible = (relief: StageContext['relief']) => STAGES.filter(stage => stage.family === 'relief' && stage.when(ctx(relief))).map(stage => stage.id);
    expect(visible('neural')).toEqual(expect.arrayContaining(['relief-source', 'relief-neural-coarse', 'relief-neural-base', 'relief-neural-decoder', 'relief-coasts']));
    expect(visible('neural')).not.toContain('relief-regional');
    expect(visible('heightmap')).toEqual(['relief-source', 'relief-heightmap-fit', 'relief-refine']);
    expect(visible('procedural')).not.toContain('relief-heightmap-fit');
  });
  it('links each row to its atlas section in the app language and maps run actions', () => {
    expect(stageDocUrl('relief-regional', 'en')).toBe('./scientific/index.html#stage-relief-regional');
    expect(stageDocUrl('relief-regional', 'fr')).toBe('./scientific/fr.html#stage-relief-regional');
    expect(stageForProgress('terrain-water')).toBe('water-hydrology');
    expect(stageForProgress('pipeline:regional')).toBe('relief-regional');
    expect(stagesForAction('town', 'parcels')).toEqual(['city-composition', 'city-quarters', 'city-trim', 'city-parcels']);
    expect(stagesForAction('roads')).toEqual(['settle-roads']);
  });
  it('accepts every procedural stage bound in the recipe validator', () => {
    for (const field of terrainProceduralStageFields) for (const bound of [field.min, field.max]) {
      if (bound === undefined) continue;
      const settings = { terrain: {} as Record<string, unknown> };
      writeSettingPath(settings, field.path, bound);
      expect(() => validateProceduralRecipe(settings.terrain.procedural as never), `${field.path} = ${bound}`).not.toThrow();
    }
  });
  it('describes a bundled heightmap library with metre ranges and licence', () => {
    expect(HEIGHTMAP_LIBRARY.length).toBeGreaterThanOrEqual(6);
    for (const entry of HEIGHTMAP_LIBRARY) {
      expect(entry.license).toBe('generated by Magna Urbis');
      expect(entry.verticalRangeM[1]).toBeGreaterThan(entry.verticalRangeM[0]);
      expect(entry.extentM).toBeGreaterThanOrEqual(500);
      expect(readFileSync(new URL(`../src/v2/assets/heightmaps/${entry.file}`, import.meta.url)).subarray(1, 4).toString()).toBe('PNG');
    }
  });
});
