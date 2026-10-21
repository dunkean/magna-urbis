import { encodeRecipe, decodeRecipe, type MapRecipe, type RecipeStage, type RecipeTerrain } from './recipe';
import { encodeDecorAsync, decodeDecorAsync, type Decor } from './decor';
import { saveHistory } from './benchHistory';
import { encodeSketch, readStoredSketch, placeSketchInFragment } from './terrainSketchSharing';
import { cropTerrain } from './benchTerrainTransfer';
import './recipeSharing.css';

declare global { interface Window { magnaRecipe?: { capture(): Promise<MapRecipe>; terrain?(): Promise<Decor> } } }

async function portableQuery(query: string): Promise<URLSearchParams> {
  const params = new URLSearchParams(query);
  if (params.has('heightmap')) {
    params.set('sketch', encodeSketch(await readStoredSketch(params.get('heightmap')!)));
    params.delete('heightmap');
  }
  return params;
}

/** Resolve browser-local inputs so a code also works in another browser or machine. */
export async function portableRecipe(stage: RecipeStage, query: string, decor?: Decor): Promise<MapRecipe> {
  const params = await portableQuery(query);
  const retainUrban = (stage === 'urban' || stage === 'settlements') && !!decor?.meta.pipeline?.urban?.layouts?.length;
  if (decor) {
    params.set('artifact', decor.meta.id); if (stage === 'urban') params.set('decor', decor.meta.id);
    if (stage === 'urban' && decor.meta.pipeline?.urban?.layouts) params.delete('workshop');
    // Applied city plans require their exact sites, cadastre and native scene in
    // either city view. Other states retain the existing procedural replay.
    decor = { ...decor, meta: { ...decor.meta,
      ...(stage === 'settlements' && !retainUrban ? { settlements: [], roads: null, roadConfig: null } : {}),
      pipeline: decor.meta.pipeline && { ...decor.meta.pipeline, ...(stage === 'urban' || retainUrban ? {} : { urban: undefined }) },
    } };
  }
  if (params.has('artifact') && !decor) throw new Error('Attendez le chargement du terrain conservé.');
  if (decor?.meta.regeneration && !retainUrban) {
    const source = await portableQuery(decor.meta.regeneration.query);
    for (const key of ['artifact', 'stage', 'pipeline', 'pins', 'view', 'showPins', 'settlements', 'roads', 'urban']) source.delete(key);
    source.set('auto', '0');
    const { waterSvg: _water, waterMaterialSvg: _waterMaterial, waterMaterial: _neutralWater, regeneration, ...meta } = decor.meta;
    meta.query = (await portableQuery(meta.query)).toString();
    return { stage, query: params.toString(), terrain: { query: source.toString(), crops: regeneration.crops, meta } };
  }
  return { stage, query: params.toString(), ...(decor ? { decor: await encodeDecorAsync(decor) } : {}) };
}

/** Run the existing terrain bench offscreen, then repeat cell-aligned crops in order. */
async function regenerateTerrain(source: RecipeTerrain, signal?: AbortSignal): Promise<Decor> {
  const iframe = document.createElement('iframe'); iframe.setAttribute('aria-hidden', 'true'); iframe.tabIndex = -1;
  iframe.style.cssText = 'position:fixed;left:-20000px;top:0;width:1400px;height:900px;visibility:hidden;border:0';
  const params = new URLSearchParams(source.query);
  for (const key of ['artifact', 'stage', 'pipeline']) params.delete(key);
  params.set('auto', '0');
  iframe.src = recipeUrl({ stage: 'terrain', query: params.toString() }).href;
  document.body.append(iframe);
  try {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      const child = iframe.contentWindow;
      if (child?.magnaRecipe?.terrain && child.magnaBenchContext?.ready()) {
        let decor = await child.magnaRecipe.terrain();
        for (const crop of source.crops) decor = cropTerrain(decor, crop.x, crop.y, crop.width);
        return { raster: decor.raster, meta: { ...decor.meta, ...source.meta, regeneration: { query: source.query, crops: source.crops } } };
      }
      const error = child?.document.querySelector<HTMLElement>('#status[data-error=true]')?.textContent;
      if (error) throw new Error(error);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Délai dépassé pendant la reconstruction du terrain.');
  } finally { iframe.remove(); }
}

export async function restoreRecipe(recipe: MapRecipe, signal?: AbortSignal): Promise<MapRecipe> {
  if (recipe.decor || recipe.terrain) {
    const decor = recipe.terrain ? await regenerateTerrain(recipe.terrain, signal) : await decodeDecorAsync(recipe.decor!), params = new URLSearchParams(recipe.query);
    signal?.throwIfAborted();
    if (params.get('artifact') !== decor.meta.id || (recipe.stage === 'urban' && params.get('decor') !== decor.meta.id)) throw new Error('Le terrain intégré ne correspond pas à la recette.');
    const saved = await saveHistory(decor, false, recipe.terrain ? undefined : recipe.decor);
    params.set('artifact', saved.meta.id); if (recipe.stage === 'urban') params.set('decor', saved.meta.id);
    return { ...recipe, query: params.toString() };
  } else if (new URLSearchParams(recipe.query).has('artifact')) throw new Error('Terrain conservé absent du code.');
  return recipe;
}

export function recipeUrl(recipe: MapRecipe): URL {
  const page = recipe.stage === 'urban' ? 'urbanbench.html' : recipe.stage === 'houses' ? 'housebench.html' : 'terrainbench.html';
  const url = new URL(page, location.href); url.search = recipe.query;
  if (executionRuntime.profile === 'local' && url.searchParams.get('profile') === 'local') applyExecutionProfile(url);
  if (recipe.stage === 'settlements') url.searchParams.set('stage', 'settlements');
  return placeSketchInFragment(url);
}

/** The shell and standalone benches use the same dialog and the same applied-state capture. */
export function installRecipeSharing(options: {
  host: Element;
  capture(): Promise<MapRecipe>;
  terrain?(): Promise<Decor>;
  open?(recipe: MapRecipe): void;
  embedded?: boolean;
}): void {
  window.magnaRecipe = { capture: options.capture, terrain: options.terrain };
  const controls = document.createElement('span'); controls.className = 'recipe-actions';
  controls.innerHTML = '<button type="button" data-recipe-export>Copier code</button><button type="button" data-recipe-import>Coller code</button>';
  const existing = options.host.querySelector<HTMLButtonElement>('#copy, #share');
  if (existing) {
    existing.onclick = null;
    existing.textContent = 'Copier code'; existing.title = 'Copier le code unique de cette carte'; existing.setAttribute('aria-label', existing.title);
    existing.dataset.recipeExport = '';
    controls.querySelector('[data-recipe-export]')!.replaceWith(existing);
  }
  options.host.append(controls);
  const dialog = document.createElement('dialog'); dialog.className = 'recipe-dialog';
  dialog.innerHTML = '<form method="dialog"><strong data-title>Partager une recette</strong><button class="recipe-close" aria-label="Fermer">×</button></form><textarea aria-label="Code de la recette" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="soft"></textarea><p role="status"></p><div class="recipe-actions"><button type="button" data-copy>Copier le code</button><button type="button" data-download>Télécharger .murecipe</button><button type="button" data-load>Charger la recette</button><label class="recipe-file">Choisir un fichier<input type="file" accept=".murecipe,.txt,text/plain" data-file></label></div>';
  document.body.append(dialog);
  const field = dialog.querySelector('textarea')!, note = dialog.querySelector('p')!;
  const copy = dialog.querySelector<HTMLButtonElement>('[data-copy]')!, load = dialog.querySelector<HTMLButtonElement>('[data-load]')!;
  const download = dialog.querySelector<HTMLButtonElement>('[data-download]')!, file = dialog.querySelector<HTMLInputElement>('[data-file]')!;
  let filename = 'carte.murecipe';
  let currentImport: AbortController | undefined;
  dialog.addEventListener('close', () => currentImport?.abort());
  let mode: 'export' | 'import' = 'import';
  function show(next: typeof mode): void {
    mode = next; field.value = ''; field.readOnly = mode === 'export'; note.textContent = '';
    dialog.querySelector('[data-title]')!.textContent = mode === 'export' ? 'Code unique de la carte' : 'Coller le code d’une carte';
    copy.hidden = download.hidden = mode !== 'export'; load.hidden = mode !== 'import';
    file.parentElement!.hidden = mode !== 'import'; file.value = '';
    if (!dialog.open) dialog.showModal(); field.focus();
  }
  const error = (e: unknown): void => { note.textContent = e instanceof Error ? e.message : String(e); };
  controls.querySelector('[data-recipe-export]')!.addEventListener('click', async () => {
    show('export'); note.textContent = 'Préparation du code…'; copy.disabled = download.disabled = true;
    try {
      const recipe = await options.capture(), code = encodeRecipe(recipe);
      field.value = code; field.select(); copy.disabled = download.disabled = false;
      const seed = new URLSearchParams(recipe.query).get('seed') ?? 'carte';
      filename = `${recipe.stage}-${seed.replace(/[^\p{L}\p{N}_-]/gu, '_').slice(0, 60)}.murecipe`;
      const description = `${code.length.toLocaleString('fr-FR')} caractères · réglages, pins et vue${recipe.decor ? ' · terrain intégré' : recipe.terrain ? ' · terrain reproductible' : ''}.`;
      try { await navigator.clipboard.writeText(code); note.textContent = `Code copié. ${description}`; }
      catch { note.textContent = `Copiez le code sélectionné (Ctrl+C). ${description}`; }
    } catch (e) { error(e); }
  });
  controls.querySelector('[data-recipe-import]')!.addEventListener('click', async () => {
    show('import');
    try {
      const pasted = await navigator.clipboard.readText();
      if (dialog.open && mode === 'import' && !field.value) field.value = pasted;
    } catch { /* Ctrl+V remains available. */ }
  });
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(field.value); note.textContent = 'Code copié.'; }
    catch { field.focus(); field.select(); note.textContent = 'Copiez le texte sélectionné (Ctrl+C).'; }
  };
  download.onclick = () => {
    const url = URL.createObjectURL(new Blob([field.value + '\n'], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    note.textContent = 'Fichier téléchargé · il contient le même code.';
  };
  file.onchange = async () => {
    const selected = file.files?.[0]; if (!selected) return;
    try {
      if (selected.size > 45 * 1024 * 1024) throw new Error('Fichier trop volumineux.');
      field.value = await selected.text(); load.click();
    } catch (e) { error(e); }
  };
  load.onclick = async () => {
    load.disabled = true;
    currentImport = new AbortController(); const signal = currentImport.signal;
    note.textContent = 'Chargement de la recette et reconstruction de la carte…';
    try {
      const recipe = await restoreRecipe(decodeRecipe(field.value), signal);
      signal.throwIfAborted();
      if (options.open) options.open(recipe); else location.href = recipeUrl(recipe).href;
      dialog.close();
    } catch (e) { error(e); }
    finally { load.disabled = false; }
  };
}
import { executionRuntime, applyExecutionProfile } from './executionProfile';
