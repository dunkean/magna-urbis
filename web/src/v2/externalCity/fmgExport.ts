/**
 * Snippet pasted into the Azgaar Fantasy Map Generator browser console (F12). It reads one burg from the
 * page and copies a `fmg-burg-v1` JSON object that `parseAzgaarBurg` (./azgaar.ts) reads.
 *
 * It relies on `pack` and `grid` only (the globals every FMG version has); `options` (current FMG) or the
 * classic FMG globals (`populationRate`, `urbanization`, `nameBases`, `biomesData`, `seed`, `Burgs`) are
 * used when present, with FMG's defaults otherwise. No network requests.
 *
 * Exported values: population in people, elevation in metres, temperature in °C (FMG's yearly mean at the
 * burg), precipitation in mm per year (FMG's cell value × 100, as FMG shows it), coast `sea` direction as in
 * FMG's watabou links (0 = east, 0.5 = north, 1 = west, 1.5 = south).
 */
export const FMG_EXPORT_SCRIPT = String.raw`(() => {
  const P = globalThis.pack, G = globalThis.grid;
  if (!P || !P.burgs || !P.cells || !G || !G.cells) return console.warn('Open a map in Azgaar FMG first.');
  const units = globalThis.options && globalThis.options.map ? globalThis.options.map.units : null;
  const scale = units ? units.population.scale : typeof populationRate !== 'undefined' ? +populationRate : 1000;
  const rate = units ? units.population.urbanization.rate : typeof urbanization !== 'undefined' ? +urbanization : 1;
  const exponentInput = document.getElementById('heightExponentInput');
  const exponent = units ? units.height.exponent : exponentInput ? +exponentInput.value || 2 : 2;
  const bases = typeof nameBases !== 'undefined' ? nameBases : null;
  const mapSeed = globalThis.options && globalThis.options.map ? globalThis.options.map.seed : typeof seed !== 'undefined' ? seed : '';

  // Default: the burg open in the Burg editor.
  const burgs = P.burgs.filter(b => b && b.i && !b.removed);
  const editor = document.getElementById('burgEditor');
  let openId = '';
  if (editor && editor.offsetParent !== null) {
    const entity = /burg:(\d+)/.exec(editor.dataset.entity || '');
    openId = entity ? entity[1] : editor.dataset.burgId || '';
    if (!openId && typeof elSelected !== 'undefined' && elSelected && elSelected.attr) openId = elSelected.attr('data-id') || '';
  }
  const answer = prompt('Magna Urbis export: burg name or id', openId);
  if (answer === null) return;
  const q = answer.trim().toLowerCase();
  const b = burgs.find(x => String(x.i) === q) || burgs.find(x => (x.name || '').toLowerCase() === q)
    || burgs.find(x => (x.name || '').toLowerCase().includes(q));
  if (!b) return console.warn('No burg matches "' + answer + '".');

  const c = P.cells, cell = b.cell, g = c.g[cell], h = c.h[cell];
  const biomeId = c.biome[cell];
  const biomeName = P.biomes && P.biomes[biomeId] ? P.biomes[biomeId].name
    : typeof biomesData !== 'undefined' ? biomesData.name[biomeId] : null;
  // Coast as in FMG's watabou city links: the nearest water cell (haven) of a coastline cell.
  const haven = c.t[cell] === 1 && c.haven ? c.haven[cell] : undefined;
  let coast = null;
  if (haven !== undefined && c.p[haven]) {
    const [x1, y1] = c.p[cell], [x2, y2] = c.p[haven];
    const deg = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
    const feature = P.features[c.f[haven]];
    coast = { sea: Math.round((deg <= 0 ? -deg / 180 : 2 - deg / 180) * 100) / 100, water: feature ? feature.type : null };
  }
  const culture = P.cultures[b.culture || 0] || {};
  const state = P.states && P.states[b.state || 0];
  let mfcg = b.link || null;
  try { if (!mfcg && globalThis.Burgs && Burgs.getPreview) mfcg = Burgs.getPreview(b).link || null; } catch (e) { mfcg = null; }

  const data = {
    format: 'fmg-burg-v1', i: b.i, name: b.name,
    population: Math.round((b.population || 0) * scale * rate),
    capital: !!b.capital, port: !!b.port, citadel: !!b.citadel, walls: !!b.walls, plaza: !!b.plaza, temple: !!b.temple, shanty: !!b.shanty,
    type: b.type || null,
    elevation: Math.round(h >= 20 ? (h - 18) ** exponent : 0),
    temperature: G.cells.temp[g],
    precipitation: G.cells.prec[g] * 100,
    biome: { id: biomeId, name: biomeName },
    river: !!c.r[cell], confluence: !!(c.conf && c.conf[cell]), coast,
    culture: { name: culture.name || null, base: bases && bases[culture.base] ? bases[culture.base].name : culture.base, type: culture.type || null },
    state: state && state.i ? state.name : null,
    mfcg, mfcgSeed: String(b.MFCG || mapSeed + String(b.i).padStart(4, '0')),
  };
  const json = JSON.stringify(data);
  console.log(json);
  if (typeof copy === 'function') { copy(json); console.log('Copied: paste it into Magna Urbis.'); }
  else if (navigator.clipboard) navigator.clipboard.writeText(json).then(() => console.log('Copied: paste it into Magna Urbis.'), () => console.log('Copy the line above.'));
})();`;
