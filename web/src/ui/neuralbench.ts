// The neural bench now lives in the terrain bench (source « Neuronal »). Old
// links open there with the same relief, network settings and water display,
// without the steps the neural bench did not have (conditioning, water budget,
// channel styles), so they still show what they showed.
const old = new URLSearchParams(location.search), next = new URLSearchParams({
  engine: 'rust', v: '4', source: 'neural', width: '40000', fit: 'crop',
  hydro_engine: 'vector', hydro_condMode: 'none', hydro_balance: '0', hydro_braiding: '0', hydro_anabranching: '0',
  hydro_terrainInfluence: '0', hydro_avulsions: '0', hydro_confluence: 'drainage', hydro_deltas: '0', n_reliefMode: 'scale',
});
const copy: Record<string, string> = {
  seed: 'seed', relief: 'relief', mix: 'mix', coasts: 'coasts', islands: 'islands', climate: 'climate',
  temperature: 'temperature', temperatureStd: 'temperatureStd', precipitation: 'precipitation', precipitationCv: 'precipitationCv',
  noise: 'fidelity', landScale: 'n_landScale', steps: 'n_steps', detail: 'n_detail', reliefMode: 'n_reliefMode', reliefScale: 'n_reliefScale', reliefFixed: 'n_reliefFixed',
  noiseTemperature: 'n_noiseTemperature', noiseTemperatureStd: 'n_noiseTemperatureStd', noisePrecipitation: 'n_noisePrecipitation', noisePrecipitationCv: 'n_noisePrecipitationCv',
  hydroEnabled: 'hydro_enabled', riverArea: 'hydro_riverArea', lakeDepth: 'hydro_lakeDepth', lakeArea: 'hydro_lakeArea', riverMode: 'hydro_riverMode',
  flatSlope: 'hydro_flatSlope', sinuosity: 'hydro_sinuosity', widthScale: 'hydro_vectorWidth', hydroResolution: 'hydro_vectorResolution',
  style: 'style', showContours: 'contours', showWater: 'water', showLakes: 'lakes', showOxbows: 'oxbows', showPins: 'showPins',
  pins: 'pins', view: 'view', neural: 'neural', sketch: 'sketch', auto: 'auto',
};
for (const [from, to] of Object.entries(copy)) { const value = old.get(from); if (value !== null) next.set(to, value); }
if (!old.get('riverArea')) next.set('hydro_riverArea', '5');
const histogram = [0, 1, 2, 3, 4].map(k => old.get(`h${k}`) ?? '0');
if (histogram.some(v => Number(v))) next.set('n_histogram', histogram.join(','));
const overlay = { accumulation: 'v-accumulation', basins: 'v-basins', depth: 'v-depth' }[old.get('overlay') ?? ''];
if (overlay) next.set('overlay', overlay);
location.replace(`terrainbench.html?${next}`);
