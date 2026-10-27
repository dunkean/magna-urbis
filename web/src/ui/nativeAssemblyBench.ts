/** CityBench's explicit experimental selected-parent dialog. This view owns one
 * native group only; the applied city/stream/edits/counts never receive it. */
import type { ExecutionRuntime } from './executionProfile';
import type { AssemblePairRequest, NativeAssemblyApi, RetainedNativeAssembly } from '../../../rust/bridge/nativeAssemblyContract';
import { nativeAssemblyApi } from '../../../rust/bridge/architecture';
import { UrbanBuildingLodRenderer } from '../render/urbanBuildingLod';
import { surfacePath, xml } from '../../../rust/bridge/houseRender';
import { nativeAssemblyWindow, type NativeAssemblyMemberVisual, type NativeAssemblySelection } from './nativeAssemblyProjection';
import { attemptSelectedNativeAssembly, type AssemblyExperimentState } from './nativeAssemblyExperiment';
import { assemblyInputFingerprint, openNativeAssemblyArtifactBackend, parseAssemblyArtifact, readNativeAssemblyArtifact,
  stageNativeAssembly, type NativeAssemblyArtifact } from './nativeAssemblyStore';
import { urbanText } from './urbanPanelLocale';
import { assemblyText } from './nativeAssemblyLocale';
const amount = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? `${value.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} m²` : 'inconnu';
export function assemblyParentRows(native: RetainedNativeAssembly): [string, string][] {
  const p = native.programme, n = p.housing_floor_need, m = n?.model, o = native.outcome;
  return [['Statut', 'Proposition expérimentale NON APPLIQUÉE à la ville'], ['Contrat attesté', native.capability],
    ['Composition demandée conservée', p.composition ?? 'inconnue'], ['Composition obtenue', 'Paire de membres natifs liés ; grammaire culturelle complète non certifiée'],
    ['Programme parent', 'Compté une seule fois'], ['Ménages demandés du modèle', typeof p.households === 'number' ? String(p.households) : 'inconnus'],
    ['Emprise des corps mesurée', amount(o.body_footprint.actual_m2)], ['Brut des niveaux retenus mesuré', amount(o.gross_floor_m2)],
    ['Besoin utile indicatif du modèle', amount(o.requested_useful_m2)], ['Déficit nécessaire du modèle', amount(o.useful_shortfall_lower_bound_m2)],
    ['Modèle conservé', n ? `${n.version} · ${m?.family} · ${m?.profile_provenance} · ${m?.calibration}` : 'inconnu'],
    ['Base utile / facteur du modèle', m ? `${m.floor_m2_per_household} ${urbanText(['m² utiles/ménage','usable m²/household','实用平方米 / 家庭','m² útiles/hogar','m² úteis/família'])} × ${m.wealth_factor}` : 'inconnus'],
    ['Capacité résidentielle / utile réel', 'inconnus ; aucune conversion m² → ménages'],
    ['Circulation', `${native.circulation.construction_status} ; ${urbanText(['construction et accessibilité non certifiées','construction and accessibility not certified','建设与可达性未经认证','construcción y accesibilidad no certificadas','construção e acessibilidade não certificadas'])}`]];
}
function download(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' })), a = document.createElement('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}
export async function openNativeAssemblyBench(options: {
  runtime?: ExecutionRuntime; parentId: string; load(): Promise<AssemblePairRequest>; isCurrent?(): boolean;
}): Promise<void> {
  const dialog = document.createElement('dialog'); dialog.dataset.nativeAssemblyBench = '';
  dialog.style.cssText = 'width:min(900px,92vw);max-height:90vh;overflow:auto';
  dialog.innerHTML = `<h2>Assemblage natif · proposition expérimentale NON APPLIQUÉE</h2>
    <p>Un parent sélectionné, deux membres natifs au maximum. Cet essai ne remplace pas la ville et ne représente pas une grammaire culturelle complète.</p>
    <p>Une sauvegarde commencée peut finir comme archive historique après un changement de source. Elle reste NON APPLIQUÉE et n’est pas réutilisée comme proposition courante.</p>
    <p>Comparaison ville, 3D et édition partielle de groupe non prises en charge ici ; aucune conversion en Single n’est effectuée.</p>
    <small data-assembly-status role="status"></small><p data-assembly-origin></p>
    <div><button data-assembly-attempt>Essayer sur le parent sélectionné</button><button data-assembly-restore>Relire la dernière proposition archivée</button>
      <label>Importer une proposition<input type="file" data-assembly-import accept="application/json,.json"></label>
      <button data-assembly-export disabled>Exporter l’archive exacte</button><button data-assembly-realize disabled>Réaliser et exporter les extérieurs natifs</button>
      <button data-assembly-parent disabled>Sélectionner le parent</button><button data-assembly-close>Fermer</button></div>
    <canvas data-assembly-canvas hidden style="width:100%;max-width:680px" aria-label="Vue propre de la proposition, indépendante de la ville"></canvas>
    <section data-assembly-inspection></section>`;
  document.body.append(dialog); if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.open = true;
  const $ = <T extends HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
  const api: NativeAssemblyApi = nativeAssemblyApi(options.runtime), life = new AbortController();
  let alive = true, busy = false, state: AssemblyExperimentState = 'ready', statusOverride: string | undefined, artifact: NativeAssemblyArtifact | undefined,
    native: RetainedNativeAssembly | undefined, view: ReturnType<typeof nativeAssemblyWindow> | undefined,
    selection: NativeAssemblySelection | undefined, renderer: UrbanBuildingLodRenderer<NativeAssemblyMemberVisual> | undefined,
    backend: Awaited<ReturnType<typeof openNativeAssemblyArtifactBackend>> | undefined;
  const current = () => alive && (options.isCurrent?.() ?? true);
  const storage = async () => backend ??= await openNativeAssemblyArtifactBackend();
  const setState = (next: AssemblyExperimentState, text?: string) => {
    if (!alive) return;
    state = next; statusOverride = text; dialog.dataset.nativeAssemblyState = next;
    $('[data-assembly-status]').textContent = assemblyText(text ?? ({ ready: 'Choisir une action explicite.', 'loading-site': 'Lecture bornée du vrai site et de ses voisins…',
      assembling: 'Essai natif en cours…', retained: 'Parent Single conservé ; aucun nouveau groupe enregistré.',
      proposed: 'Proposition archivée, NON APPLIQUÉE à la ville.', stale: 'Origine native non liée ou remplacée ; une archive éventuelle reste historique NON APPLIQUÉE et ne sert pas de proposition courante.', error: 'Essai refusé.' }[next]));
    $<HTMLButtonElement>('[data-assembly-export]').disabled = !artifact || busy;
    $<HTMLButtonElement>('[data-assembly-realize]').disabled = !artifact || state !== 'proposed' || busy;
    $<HTMLButtonElement>('[data-assembly-parent]').disabled = !view || busy;
  };
  const inspect = () => {
    if (!native || !view || !selection) return;
    dialog.dataset.parentId = native.id; dialog.dataset.selectionKind = selection.kind;
    dialog.dataset.memberKey = selection.kind === 'member' ? selection.member_key : '';
    dialog.dataset.memberId = selection.kind === 'member' ? selection.member_id : '';
    const selected = selection;
    const member = selected.kind === 'member' ? native.members.find(m => m.key === selected.member_key) : undefined;
    const rows = member ? [['Parent de programme', native.id], ['Membre réel', member.plan.id], ['Clé native', member.key],
      ['Source native', `${member.plan.recipe_id} · ${member.plan.variant_id}`], ['Sol propre', `${member.plan.ground_z_m} m`],
      ['Corps / niveaux retenus', `${member.plan.volumes.length} / ${member.plan.volumes.reduce((n, body) => n + body.levels.length, 0)}`],
      ['Programme / capacité du membre', 'aucun programme parent copié ; capacité inconnue']] : assemblyParentRows(native);
    const summary = urbanText([`1 résultat parent · ${view.counts.members} membres natifs · ${view.counts.bodies} corps retenus`, `1 parent result · ${view.counts.members} native members · ${view.counts.bodies} retained volumes`, `1 个父级结果 · ${view.counts.members} 个原生成员 · ${view.counts.bodies} 个保留体量`, `1 resultado principal · ${view.counts.members} miembros nativos · ${view.counts.bodies} volúmenes conservados`, `1 resultado principal · ${view.counts.members} membros nativos · ${view.counts.bodies} volumes mantidos`]);
    $('[data-assembly-inspection]').innerHTML = `<p>${xml(summary)}</p><dl>${rows.map(([label, value]) => `<dt>${xml(assemblyText(label))}</dt><dd>${xml(assemblyText(value))}</dd>`).join('')}</dl>`;
  };
  const canvas = $<HTMLCanvasElement>('[data-assembly-canvas]');
  const staticNodes = [dialog.querySelector('h2')!, ...Array.from(dialog.querySelectorAll(':scope > p')).slice(0, 3), ...Array.from(dialog.querySelectorAll('button'))];
  const originalText = staticNodes.map(node => node.textContent ?? '');
  const importLabel = $<HTMLInputElement>('[data-assembly-import]').parentElement!.firstChild!;
  const localize = () => {
    staticNodes.forEach((node, index) => { node.textContent = assemblyText(originalText[index]); });
    importLabel.textContent = assemblyText('Importer une proposition');
    canvas.setAttribute('aria-label', assemblyText('Vue propre de la proposition, indépendante de la ville'));
    setState(state, statusOverride); inspect();
    if (native && artifact) $('[data-assembly-origin]').textContent = urbanText([`Parent natif ${native.id} · archive ${artifact.archive.sha256} · proposition non appliquée`, `Native parent ${native.id} · archive ${artifact.archive.sha256} · proposal not applied`, `原生父级 ${native.id} · 存档 ${artifact.archive.sha256} · 提案未应用`, `Elemento principal nativo ${native.id} · archivo ${artifact.archive.sha256} · propuesta no aplicada`, `Elemento principal nativo ${native.id} · arquivo ${artifact.archive.sha256} · proposta não aplicada`]);
  };
  window.addEventListener('magna-locale-change', localize);
  let camera = { x: 0, y: 0, mpp: 1 };
  const paint = () => {
    if (!view || !renderer) return; const w = 680, h = 420, dpr = Math.min(2, window.devicePixelRatio || 1), b = view.bounds;
    camera.mpp = Math.max((b.maxX - b.minX) / 620, (b.maxY - b.minY) / 360, .01);
    camera.x = (b.minX + b.maxX) / 2 - w * camera.mpp / 2; camera.y = (b.minY + b.maxY) / 2 - h * camera.mpp / 2;
    canvas.width = w * dpr; canvas.height = h * dpr; canvas.hidden = false;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.fillStyle = '#f4efdf'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr / camera.mpp, 0, 0, dpr / camera.mpp, -camera.x * dpr / camera.mpp, -camera.y * dpr / camera.mpp);
    for (const branch of native!.circulation.branches) { ctx.fillStyle = '#c9bea4'; ctx.fill(new Path2D(surfacePath(branch.path)), 'evenodd'); }
    renderer.draw(ctx, { viewport: { minX: camera.x, minY: camera.y, maxX: camera.x + w * camera.mpp, maxY: camera.y + h * camera.mpp },
      metresPerPixel: camera.mpp, appearance: { style: 'cartographic', diagnostic: 'none' }, selectedId: selection?.kind === 'member' ? selection.member_id : undefined });
  };
  const show = (a: NativeAssemblyArtifact, n: RetainedNativeAssembly) => {
    if (!alive) return;
    artifact = a; native = n; view = nativeAssemblyWindow(n); selection = { kind: 'parent', parent_id: n.id };
    renderer = new UrbanBuildingLodRenderer(view.scene, { raster: false, maxCachedBuildings: 2, maxFacetBuildings: 2 });
    dialog.dataset.archiveSha256 = a.archive.sha256; dialog.dataset.inputSha256 = a.input_sha256;
    $('[data-assembly-origin]').textContent = urbanText([`Parent natif ${n.id} · archive ${a.archive.sha256} · proposition non appliquée`, `Native parent ${n.id} · archive ${a.archive.sha256} · proposal not applied`, `原生父级 ${n.id} · 存档 ${a.archive.sha256} · 提案未应用`, `Elemento principal nativo ${n.id} · archivo ${a.archive.sha256} · propuesta no aplicada`, `Elemento principal nativo ${n.id} · arquivo ${a.archive.sha256} · proposta não aplicada`]);
    inspect(); paint();
  };
  const act = async (run: () => Promise<void>) => {
    if (busy || !alive) return; busy = true; setState(state);
    for (const b of Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not([data-assembly-close])'))) b.disabled = true;
    try { await run(); } catch (error) { if (alive) setState(!current() ? 'stale' : 'error', String(error)); }
    finally { busy = false; if (alive) { $('[data-assembly-attempt]').removeAttribute('disabled'); $('[data-assembly-restore]').removeAttribute('disabled'); setState(state); } }
  };
  $('[data-assembly-attempt]').onclick = () => { void act(async () => {
    if (!current()) { setState('stale'); return; }
    const result = await attemptSelectedNativeAssembly({ parentId: options.parentId, api, backend: await storage(), current,
      load: options.load, state: setState, signal: life.signal });
    if (!current()) { setState('stale'); return; }
    if (result.state === 'proposed') show(result.artifact, result.native);
    setState(result.state, `${result.state === 'proposed' ? 'Proposition NON APPLIQUÉE archivée.' : 'Parent Single conservé.'} ${result.report.reason}`);
  }); };
  $('[data-assembly-restore]').onclick = () => { void act(async () => {
    await api.require(); const value = await readNativeAssemblyArtifact(await storage(), api);
    if (!value) throw new Error(assemblyText('Aucune proposition archivée.')); show(value.artifact, value.native); setState('stale');
  }); };
  $<HTMLInputElement>('[data-assembly-import]').onchange = event => { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
    void act(async () => { if (file.size > 32 * 1024 * 1024) throw new Error(assemblyText('Archive supérieure à 32 MiB.')); await api.require();
      const a = parseAssemblyArtifact(await file.text()), staged = await stageNativeAssembly(await storage(), a, api, { current: () => alive, signal: life.signal });
      await staged.commit(); show(staged.artifact, staged.native); setState('stale'); }); };
  $('[data-assembly-export]').onclick = () => { if (artifact) download(artifact, 'native-assembly-proposal-not-applied.json'); };
  $('[data-assembly-realize]').onclick = () => { void act(async () => {
    if (!artifact || state !== 'proposed' || !current()) throw new Error(assemblyText('Proposition périmée ou non liée.'));
    const saved = artifact, realized = await api.realize(saved.archive);
    if (!current() || artifact !== saved) { setState('stale'); return; }
    if (realized.id !== saved.parent_id || realized.parcel_id !== saved.parcel_id || realized.members.length !== 2) throw new Error(assemblyText('Identité native réalisée contradictoire.'));
    download({ application: 'proposal_not_applied', archive_sha256: saved.archive.sha256, native: realized }, 'native-assembly-realized-not-applied.json');
    setState('proposed', 'Deux extérieurs natifs réalisés et exportés ; la proposition reste NON APPLIQUÉE à la ville.');
  }); };
  $('[data-assembly-parent]').onclick = () => { if (native) { selection = { kind: 'parent', parent_id: native.id }; inspect(); paint(); } };
  canvas.onclick = event => { if (!view) return; const rect = canvas.getBoundingClientRect();
    selection = view.pick({ x: camera.x + (event.clientX - rect.left) * 680 / rect.width * camera.mpp,
      y: camera.y + (event.clientY - rect.top) * 420 / rect.height * camera.mpp }); inspect(); paint(); };
  const timer = setInterval(() => { if (alive && state !== 'stale' && !current()) { life.abort(new DOMException('Origine remplacée', 'AbortError')); setState('stale'); } }, 250);
  const close = () => { if (!alive) return; alive = false; clearInterval(timer); life.abort(); window.removeEventListener('magna-locale-change', localize); backend?.close(); renderer = undefined; native = undefined; view = undefined; dialog.remove(); };
  $('[data-assembly-close]').onclick = () => { if (typeof dialog.close === 'function') dialog.close(); close(); };
  dialog.addEventListener('close', close); localize();
}
