import { CLIMATE_VALUES } from './terrainClimate';
import { compactProfile } from './terrainPhasor';
import type { TerrainSettings, ErosionTuning } from './terrain';
export const PROCEDURAL_RECIPE_VERSION = 'procedural-stages-v3';
export const GENERATION_STAGES = [
    ['prepare', 'Préparation du backend', false], ['grids', 'Grilles et buffers', false],
    ['initialize', 'Bruits et soulèvement initial', false], ['regional', 'Cycles d’érosion régionale', true],
    ['regionalFinish', 'Relaxation et drainage finaux', true], ['reconstruct', 'Reconstruction 1024²', false],
    ['amplitude', 'Calibration de l’amplitude (p99)', true], ['ridged', 'Détail ridgé classique', true],
    ['surface', 'Érosion de surface après détail', true], ['normalize', 'Datum et plancher (p1)', true],
    ['phasor', 'Détail Phasor', true], ['posterior', 'Conditionnement fluvial a posteriori', true],
    ['wind', 'Transport éolien a posteriori', true], ['retain', 'Conservation de la surface Rust', false],
    ['coasts', 'Découpe et érosion côtières', true], ['sampling', 'Échantillonnage de l’aperçu', false],
    ['hydrology', 'Hydrologie et creusement des lits', true], ['render', 'Affichage', false],
] as const;
export type GenerationStage = typeof GENERATION_STAGES[number][0];
export interface ProceduralRecipe {
    preset?: 'classic' | 'compact';
    biome?: boolean;
    enabled?: Partial<Record<GenerationStage, boolean>>;
    reconstruction?: 'default' | 'cubic' | 'bspline';
    coastIterations?: number;
    coastIncision?: number;
    coastThermal?: number;
    coastDiffusion?: number;
    regionalN?: number;
    surfaceN?: number;
    uplift?: number;
    crest?: number;
    noiseScale?: number;
    erosionTuning?: ErosionTuning;
    regionalThermal?: boolean;
    regionalDiffusion?: boolean;
    posterior?: {
        mode?: 'none' | 'erosion' | 'breach' | 'both';
        strength?: number;
        maxDepth?: number;
        maxLength?: number;
    };
    wind?: {
        iterations?: number;
        azimuth?: number;
        transport?: number;
    };
}
export interface GenerationStageInfo {
    stage: GenerationStage;
    status: 'waiting' | 'running' | 'done' | 'skipped';
    paused?: boolean;
    detail?: string;
    elapsedMs?: number;
    n?: number;
    width?: number;
    height?: Float32Array;
}
/** Functions are passed within a worker, never serialized in the terrain recipe. */
export interface GenerationControl {
    previews?: boolean;
    before(stage: GenerationStage, detail?: string): Promise<void>;
    after(stage: GenerationStage, height?: Float32Array, detail?: string): Promise<void>;
}
export const EROSION_BIOMES = {
    temperate: { water: 1, thermal: 1, posterior: 0, wind: 0, transport: .2 },
    oceanic: { water: 1.35, thermal: 1.25, posterior: 1, wind: 0, transport: .2 },
    mediterranean: { water: 1.05, thermal: .85, posterior: .7, wind: 2, transport: .12 },
    arid: { water: .35, thermal: .65, posterior: 0, wind: 12, transport: .8 },
    cold: { water: .65, thermal: 1.6, posterior: 0, wind: 3, transport: .15 },
    tropical: { water: 1.8, thermal: 1.15, posterior: 1.5, wind: 0, transport: .1 },
} as const;
export const erosionBiome = (s: TerrainSettings) => {
    const climate = s.climate ?? 'temperate', b = EROSION_BIOMES[climate], ratio = (s.climateValues?.precipitation ?? CLIMATE_VALUES[climate].precipitation) / Math.max(1, CLIMATE_VALUES[climate].precipitation);
    return { ...b, water: b.water * Math.max(0, Math.min(2, ratio)), posterior: b.posterior * Math.max(0, Math.min(2, ratio)), transport: b.transport * Math.max(.05, Math.min(1.5, 1 - (ratio - 1) * .5)) };
};
export const stageEnabled = (s: TerrainSettings, id: GenerationStage, fallback = true) => s.procedural?.enabled?.[id] ?? fallback;
/** The old source name remains a readable alias for saved recipes. */
export const isCompactProcedural = (s: Pick<TerrainSettings, 'source' | 'procedural'>) => (!s.source || s.source==='procedural' || s.source==='procedural-phasor') && (s.procedural?.preset === 'compact' || s.procedural?.preset === undefined && s.source === 'procedural-phasor');
export function posteriorSettings(s: TerrainSettings) {
    const dose = s.procedural?.biome ? erosionBiome(s).posterior : 0, p = s.procedural?.posterior;
    return { mode: p?.mode ?? (dose ? 'erosion' : 'none'), strength: p?.strength ?? (p?.mode && p.mode !== 'none' ? (dose || 1) : dose) * s.erosion, maxDepth: p?.maxDepth ?? 12, maxLength: p?.maxLength ?? 150 } as const;
}
export function windSettings(s: TerrainSettings) {
    const b = s.procedural?.biome ? erosionBiome(s) : EROSION_BIOMES.temperate, p = s.procedural?.wind;
    return { iterations: p?.iterations ?? (s.procedural?.biome ? b.wind : 0), azimuth: p?.azimuth ?? 270, transport: p?.transport ?? b.transport * s.erosion };
}
export const PROCEDURAL_TUNING_LIMITS: Record<string, readonly [
    number,
    number
]> = { iterations: [1, 200], incision: [0, 10], incisionSlope: [.01, 2], fill: [0, 10], carve: [0, 1], finalCarve: [0, 1], talus: [.01, 3], thermal: [0, 10], diffusion: [0, 3], detail: [0, .5], warp: [0, 4], surfaceIterations: [0, 100], surfaceIncision: [0, 10], surfaceCarve: [0, 1], surfaceRouted: [0, 1], surfaceThermal: [0, 10], surfaceDiffusion: [0, 10] };
export function generationStageActive(s: TerrainSettings, id: GenerationStage): boolean {
    const compact = isCompactProcedural(s);
    if (!stageEnabled(s, id, id === 'phasor' ? compact : id === 'ridged' || id === 'surface' ? !compact || id === 'surface' && s.relief === 'canyon' : true))
        return false;
    if (id === 'posterior') {
        const p = posteriorSettings(s);
        return (p.mode === 'erosion' || p.mode === 'both') && p.strength > 0 || (p.mode === 'breach' || p.mode === 'both') && p.maxDepth > 0 && p.maxLength > 0;
    }
    if (id === 'wind') {
        const w = windSettings(s);
        return w.iterations > 0 && w.transport > 0;
    }
    if (id === 'coasts')
        return !!s.coastMask;
    if (id === 'hydrology')
        return !!s.hydrology?.enabled;
    return true;
}
export function validateProceduralRecipe(r?: ProceduralRecipe): void {
    if (r === undefined)
        return;
    if (!r || typeof r !== 'object' || Array.isArray(r))
        throw new Error('Recette procédurale invalide.');
    const allowed = ['preset', 'coastIterations', 'coastIncision', 'coastThermal', 'coastDiffusion', 'reconstruction', 'biome', 'enabled', 'regionalN', 'surfaceN', 'uplift', 'crest', 'noiseScale', 'erosionTuning', 'regionalThermal', 'regionalDiffusion', 'posterior', 'wind'];
    for (const key of Object.keys(r))
        if (!allowed.includes(key))
            throw new Error(`Paramètre procédural inconnu : ${key}`);
    for (const key of ['enabled', 'erosionTuning', 'posterior', 'wind'] as const) {
        const v = r[key];
        if (v !== undefined && (!v || typeof v !== 'object' || Array.isArray(v)))
            throw new Error(`Bloc invalide : ${key}`);
    }
    for (const [name, v] of Object.entries(r.erosionTuning ?? {})) {
        const limits = PROCEDURAL_TUNING_LIMITS[name];
        if (!limits || typeof v !== 'number' || !Number.isFinite(v) || v < limits[0] || v > limits[1] || ['iterations', 'surfaceIterations', 'surfaceRouted'].includes(name) && !Number.isInteger(v))
            throw new Error(`Érosion invalide : ${name}`);
    }
    for (const key of ['regionalThermal', 'regionalDiffusion'] as const)
        if (r[key] !== undefined && typeof r[key] !== 'boolean')
            throw new Error(`Paramètre invalide : ${key}`);
    for (const key of Object.keys(r.wind ?? {}))
        if (!['iterations', 'azimuth', 'transport'].includes(key))
            throw new Error(`Vent inconnu : ${key}`);
    for (const key of Object.keys(r.posterior ?? {}))
        if (!['mode', 'strength', 'maxDepth', 'maxLength'].includes(key))
            throw new Error(`Conditionnement inconnu : ${key}`);
    if (r.reconstruction !== undefined && !['default', 'cubic', 'bspline'].includes(r.reconstruction))
        throw new Error('Reconstruction invalide.');
    const ranges: Record<string, readonly [
        number,
        number
    ]> = { coastIterations: [0, 100], coastIncision: [0, 10], coastThermal: [0, 10], coastDiffusion: [0, 10], regionalN: [64, 640], surfaceN: [64, 1024], uplift: [0, 4], crest: [0, 1.5], noiseScale: [.25, 4] };
    for (const [key, [lo, hi]] of Object.entries(ranges)) {
        const v = r[key as keyof ProceduralRecipe];
        if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi || (key.endsWith('N') || key === 'coastIterations') && !Number.isInteger(v)))
            throw new Error(`Paramètre procédural invalide : ${key}`);
    }
    for (const [key, v] of Object.entries(r.enabled ?? {}))
        if (!GENERATION_STAGES.some(([id, _, optional]) => id === key && optional) || typeof v !== 'boolean')
            throw new Error(`Étape non désactivable : ${key}`);
    if(r.preset !== undefined && !['classic','compact'].includes(r.preset))throw new Error('Préréglage procédural invalide.');
    if (r.biome !== undefined && typeof r.biome !== 'boolean')
        throw new Error('Influence du biome invalide.');
    for (const [name, v, lo, hi] of [['wind.iterations', r.wind?.iterations, 0, 100], ['wind.azimuth', r.wind?.azimuth, 0, 360], ['wind.transport', r.wind?.transport, 0, 5], ['posterior.strength', r.posterior?.strength, 0, 5], ['posterior.maxDepth', r.posterior?.maxDepth, 0, 100], ['posterior.maxLength', r.posterior?.maxLength, 0, 2000]] as const)
        if (v !== undefined && (!Number.isFinite(v) || v < lo || v > hi))
            throw new Error(`Paramètre invalide : ${name}`);
    if (r.wind?.iterations !== undefined && !Number.isInteger(r.wind.iterations))
        throw new Error('Le nombre de passes éoliennes doit être entier.');
    if (r.posterior?.mode !== undefined && !['none', 'erosion', 'breach', 'both'].includes(r.posterior.mode))
        throw new Error('Conditionnement a posteriori invalide.');
}
/** An absent recipe preserves the original pipeline byte for byte. */
export function configureProceduralPlan(parameters: Float32Array, surface: Float32Array, s: TerrainSettings, compact: boolean, coast = false): void {
    const r = s.procedural;
    if (!r)
        return;
    validateProceduralRecipe(r);
    const t = { ...s.erosionTuning, ...r.erosionTuning };
    const oldN = parameters[2], oldSteps = parameters[13], oldCell = parameters[4];
    parameters[2] = r.regionalN ?? oldN;
    parameters[4] = s.width * 1.44 / parameters[2];
    parameters[13] = t.iterations ?? oldSteps;
    parameters[19] *= oldSteps / parameters[13] * (r.uplift ?? 1);
    parameters[22] *= parameters[4] / oldCell;
    parameters[6] *= r.noiseScale ?? 1;
    if (r.crest !== undefined)
        parameters[32] = r.crest;
    const n = r.surfaceN ?? surface[0] - 24, oldSurfaceCell = compact ? s.width / Math.max(640, Math.min(1024, Math.ceil(s.width / s.motifSize * 96))) : surface[1];
    surface[0] = n + 24;
    surface[1] = s.width / n;
    surface[2] = -12 * surface[1];
    surface[6] *= surface[1] / oldSurfaceCell;
    if (coast) {
        surface[3] = r.coastIterations ?? (compact ? 2 : 12);
        surface[5] *= r.coastThermal ?? 1;
        surface[6] *= r.coastIncision ?? 1;
        surface[7] *= r.coastDiffusion ?? 1;
    }
    else if (t.surfaceIterations !== undefined)
        surface[3] = t.surfaceIterations;
    else if (compact && stageEnabled(s, 'surface', s.relief === 'canyon'))
        surface[3] = 12;
    if (compact) { // Compact policy normally overrides these two fields after the Rust plan.
        if (t.detail !== undefined)
            parameters[16] = t.detail;
        if (t.warp !== undefined)
            parameters[38] = t.warp;
    }
    if (compact) {
        const p = compactProfile(s);
        parameters[22] /= p.incision;
        parameters[37] /= p.thermal;
    }
    if (r.biome) {
        const b = erosionBiome(s);
        parameters[22] *= b.water;
        surface[6] *= b.water;
        parameters[33] *= b.water;
        parameters[34] = Math.min(1, parameters[34] * b.water);
        parameters[35] = Math.min(1, parameters[35] * b.water);
        parameters[40] = Math.min(1, parameters[40] * b.water);
        parameters[37] *= b.thermal;
        surface[5] *= b.thermal;
    }
    if (!stageEnabled(s, 'ridged', !compact))
        parameters[16] = 0;
    if (!coast && !stageEnabled(s, 'surface', !compact || s.relief === 'canyon'))
        surface[3] = 0;
}
