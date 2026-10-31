import {
  loadNeuralManifest, listStoredNeuralModels, obtainNeuralModel, deleteStoredNeuralModel,
  neuralModelUrl, NEURAL_MODEL_NAMES, NeuralModelError,
  type NeuralManifest, type NeuralModelName, type StoredNeuralModel, type ModelTransfer,
} from '../../../rust/bridge/neuralModels';
import { registerMessages, setText, translate, numberLocale, onLanguageChange, getLanguage } from './i18n';
import './neuralModelManager.css';

const copy = (en: string, fr: string) => { registerMessages({ [en]: { en, fr } }); return en; };
const T = {
  title: copy('Downloaded neural models', 'Modèles neuronaux téléchargés'),
  intro: copy('Prepare browser generation now. Downloads are shared with the terrain engine; no GPU is needed to download them.', 'Préparez la génération dans le navigateur. Le moteur de relief réutilise ces téléchargements ; aucun GPU n’est nécessaire pour les télécharger.'),
  scope: copy('Stored on this device, for this browser profile and site address. Clearing site data removes the models. These files do not install Python/CUDA models.', 'Conservés sur cet appareil, pour ce profil de navigateur et cette adresse du site. Effacer les données du site supprime les modèles. Ces fichiers n’installent pas les modèles Python/CUDA.'),
  offlineScope: copy('Downloaded weights still need WebGPU and must be loaded into GPU memory at each new session. This does not make the whole application available offline.', 'Les poids téléchargés nécessitent toujours WebGPU et doivent être chargés en mémoire GPU à chaque nouvelle session. Cela ne rend pas toute l’application disponible hors connexion.'),
  nf4: copy('NF4 B75 is the distilled base network: branch B, exponential moving-average weights at 75,000 training steps, 4-bit weight compression and a two-step solver. B75 names the training checkpoint.', 'NF4 B75 est le réseau de base distillé : branche B, moyenne exponentielle des poids à 75 000 étapes d’entraînement, compression des poids sur 4 bits et solveur à deux étapes. B75 désigne le checkpoint d’entraînement.'),
  nf4Details: copy('NF4 B75 · quality and speed', 'NF4 B75 · qualité et vitesse'),
  nf4Quality: copy('Upstream CUDA evaluation on seven scenes: mean absolute difference of 22.15–24.06 m from the original BF16 base, depending on detail level. This measures agreement with that model, not accuracy against real terrain, and does not certify browser output. Excess fine grain on plains and coastal differences remain.', 'Évaluation CUDA du projet source sur sept scènes : écart absolu moyen de 22,15 à 24,06 m face à la base BF16 d’origine, selon le niveau de détail. Cela mesure l’accord avec ce modèle, pas la précision face au terrain réel, et ne certifie pas le résultat navigateur. Un excès de grain fin en plaine et des différences côtières subsistent.'),
  nf4Speed: copy('Compression reduces download size. Weights are decoded into FP16 or FP32 for GPU inference: neither faster generation nor a 150 MB GPU footprint is guaranteed. There is no B75-specific WebGPU speed benchmark or certified minimum hardware configuration.', 'La compression réduit le téléchargement. Les poids sont décodés en FP16 ou FP32 pour le calcul GPU : ni une génération plus rapide ni une mémoire GPU limitée à 150 Mo ne sont garanties. Il n’existe pas de benchmark WebGPU propre à B75 ni de configuration minimale certifiée.'),
  nf4Source: copy('Upstream release and evaluation ↗', 'Version et évaluation du projet source ↗'),
  coarse: copy('Coarse · initial terrain', 'Coarse · forme initiale du relief'),
  base: copy('Base · terrain detail', 'Base · détail du relief'),
  decoder: copy('Decoder · elevations', 'Décodeur · altitudes'),
  download: copy('Download', 'Télécharger'), remove: copy('Remove', 'Supprimer'),
  all: copy('Download missing models', 'Télécharger les modèles manquants'), clear: copy('Remove downloaded models', 'Supprimer les modèles téléchargés'),
  refresh: copy('Refresh', 'Actualiser'), cancel: copy('Cancel download', 'Annuler le téléchargement'),
  persist: copy('Keep on this device', 'Conserver sur cet appareil'),
  persistent: copy('Persistent storage granted. You can still remove models or clear site data.', 'Stockage persistant accordé. Vous pouvez toujours supprimer les modèles ou effacer les données du site.'),
  temporary: copy('Storage is not protected from automatic eviction. Request persistent storage to improve retention; the browser may refuse.', 'Le stockage n’est pas protégé contre l’effacement automatique. Demandez un stockage persistant pour améliorer la conservation ; le navigateur peut refuser.'),
  unsupported: copy('Persistent storage requests are unavailable in this browser.', 'La demande de stockage persistant est indisponible dans ce navigateur.'),
  refused: copy('The browser did not grant persistent storage. Downloaded files remain available but can be evicted.', 'Le navigateur n’a pas accordé le stockage persistant. Les fichiers téléchargés restent disponibles mais peuvent être effacés automatiquement.'),
  checking: copy('Checking downloaded models…', 'Vérification des modèles téléchargés…'),
  stored: copy('On this device', 'Sur cet appareil'), missing: copy('Not downloaded', 'Non téléchargé'),
  old: copy('Other downloaded versions', 'Autres versions téléchargées'),
  oldHelp: copy('These files are not used by the current catalogue. They may belong to another model address or version.', 'Ces fichiers ne sont pas utilisés par le catalogue actuel. Ils peuvent appartenir à une autre adresse de modèles ou à une autre version.'),
  catalogue: copy('Catalogue unavailable. Check the model address and connection. Previously downloaded files are listed below when browser storage is accessible.', 'Catalogue indisponible. Vérifiez l’adresse des modèles et la connexion. Les fichiers déjà téléchargés figurent ci-dessous si le stockage du navigateur est accessible.'),
  savedCatalogue: copy('Showing the saved catalogue: the server could not be reached or did not provide a valid catalogue.', 'Affichage du catalogue conservé : le serveur est inaccessible ou n’a pas fourni de catalogue valide.'),
  storageError: copy('Unable to access or save browser files. Check available disk space and site storage permissions, then try again. This download has not been confirmed as saved.', 'Impossible d’accéder aux fichiers du navigateur ou de les enregistrer. Vérifiez l’espace disque disponible et les autorisations de stockage du site, puis réessayez. Ce téléchargement n’a pas été confirmé comme enregistré.'),
  integrity: copy('The model is incomplete or failed its integrity check. It was not saved; try downloading again.', 'Le modèle est incomplet ou sa vérification d’intégrité a échoué. Il n’a pas été enregistré ; relancez le téléchargement.'),
  failure: copy('Download failed. Check your connection and model address, then retry. Completed downloads are retained.', 'Échec du téléchargement. Vérifiez la connexion et l’adresse des modèles, puis réessayez. Les téléchargements terminés sont conservés.'),
  complete: copy('Models verified and saved on this device.', 'Modèles vérifiés et enregistrés sur cet appareil.'),
  removed: copy('Downloaded files removed. A model already loaded in GPU memory can continue until the engine is released.', 'Fichiers téléchargés supprimés. Un modèle déjà chargé en mémoire GPU peut continuer jusqu’à la libération du moteur.'),
  cancelled: copy('Download cancelled. Completed models are retained; partial files are not saved.', 'Téléchargement annulé. Les modèles terminés sont conservés ; les fichiers partiels ne sont pas enregistrés.'),
  downloading: copy('Downloading', 'Téléchargement'), verifying: copy('Verifying integrity', 'Vérification de l’intégrité'), saving: copy('Saving on this device', 'Enregistrement sur cet appareil'),
  total: copy('Required model files', 'Fichiers de modèles requis'), local: copy('Downloaded for this profile', 'Téléchargés pour ce profil'),
  siteSpace: copy('Storage used by the whole site / browser quota', 'Stockage utilisé par tout le site / quota du navigateur'),
  address: copy('Model address', 'Adresse des modèles'), unknownSize: copy('Size unavailable', 'Taille indisponible'),
};

export function mountNeuralModelManager(host: HTMLElement, getAssets: () => string): { refresh(): Promise<void>; dispose(): void } {
  const section = document.createElement('details'); section.id = 'neural-model-manager'; section.className = 'section neural-model-manager'; section.open = true;
  const summary = document.createElement('summary'); setText(summary, T.title); section.append(summary);
  const content = document.createElement('div'); content.className = 'neural-model-content'; section.append(content); host.append(section);
  const p = (text: string, parent: HTMLElement = content) => { const node = document.createElement('p'); node.className = 'hint'; setText(node, text); parent.append(node); return node; };
  p(T.intro);
  const address = p(''); address.classList.add('neural-model-address'); address.dataset.l10nKeep = '';
  const totals = p(''); totals.dataset.l10nKeep = '';
  const list = document.createElement('div'); list.className = 'neural-model-list'; content.append(list);
  const nf4 = p(T.nf4); nf4.hidden = true;
  const nf4Details = document.createElement('details'); nf4Details.className = 'neural-model-explanation'; nf4Details.hidden = true;
  const nf4Summary = document.createElement('summary'); setText(nf4Summary, T.nf4Details); nf4Details.append(nf4Summary);
  p(T.nf4Quality, nf4Details); p(T.nf4Speed, nf4Details);
  const source = document.createElement('a'); source.href = 'https://github.com/dunkean/neural-earth/blob/main/distill/BASE_COMPACT_RELEASE.md'; source.target = '_blank'; source.rel = 'noopener'; setText(source, T.nf4Source); nf4Details.append(source); content.append(nf4Details);
  const actions = document.createElement('div'); actions.className = 'neural-model-actions'; content.append(actions);
  const makeButton = (parent: HTMLElement, label: string, action: () => void) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'small'; setText(button, label); button.onclick = action; parent.append(button); return button;
  };
  const all = makeButton(actions, T.all, () => void runDownload()); all.id = 'neural-model-download-all';
  const refreshButton = makeButton(actions, T.refresh, () => void refresh()); refreshButton.id = 'neural-model-refresh';
  const clear = makeButton(actions, T.clear, () => void run(async () => { for (const model of records) await deleteStoredNeuralModel(model.url); }, T.removed)); clear.id = 'neural-model-clear';
  const cancel = makeButton(actions, T.cancel, () => controller?.abort()); cancel.id = 'neural-model-cancel'; cancel.hidden = true;
  const transfer = document.createElement('div'); transfer.className = 'neural-model-transfer'; transfer.hidden = true; content.append(transfer);
  const progressLabel = p('', transfer); progressLabel.dataset.l10nKeep = '';
  const progress = document.createElement('progress'); progress.max = 1; progress.value = 0; transfer.append(progress);
  const message = p(''); message.id = 'neural-model-message'; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  const retention = p(''), space = p(''); space.dataset.l10nKeep = '';
  const persist = makeButton(content, T.persist, () => void requestPersistence()); persist.id = 'neural-model-persist';
  p(T.scope); p(T.offlineScope);
  const other = document.createElement('div'); other.className = 'neural-model-other'; content.append(other);

  let manifest: NeuralManifest | undefined, records: StoredNeuralModel[] = [], assets = '', active = false, disposed = false;
  let controller: AbortController | undefined, persistent = false, estimate: StorageEstimate | undefined, lastTransfer: ModelTransfer | undefined;
  let refreshSequence = 0, refreshed = false;
  const currentAssets = () => { try { return getAssets(); } catch { return ''; } };
  const size = (bytes: number) => `${(bytes / 1e6).toLocaleString(numberLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${getLanguage() === 'fr' ? 'Mo' : 'MB'}`;
  const title = (name: NeuralModelName) => name === 'base' && manifest?.models.base.selection === 'nf4_b75' ? 'NF4 B75' : translate(T[name]);
  function show(text: string, error = false): void { if (disposed) return; setText(message, text); message.dataset.error = String(error); }
  function drawTransfer(): void {
    if (!lastTransfer) return;
    const { name, phase, received, total } = lastTransfer;
    progressLabel.textContent = `${translate(phase === 'download' ? T.downloading : phase === 'verify' ? T.verifying : T.saving)} · ${title(name)} · ${size(received)} / ${size(total)}`;
    progress.setAttribute('aria-label', progressLabel.textContent); progress.value = received / total;
  }
  function render(): void {
    if (disposed) return;
    address.textContent = `${translate(T.address)} : ${assets || currentAssets()}`;
    totals.textContent = manifest ? `${translate(T.total)} : ${size(NEURAL_MODEL_NAMES.reduce((n, name) => n + manifest!.models[name].bytes, 0))} · ${translate(T.local)} : ${size(records.filter(r => r.current).reduce((n, r) => n + (r.bytes ?? 0), 0))}` : '';
    nf4.hidden = nf4Details.hidden = manifest?.models.base.selection !== 'nf4_b75';
    list.replaceChildren();
    if (manifest) for (const name of NEURAL_MODEL_NAMES) {
      const entry = manifest.models[name], url = neuralModelUrl(assets, entry), saved = records.some(r => r.url === url);
      const row = document.createElement('div'); row.className = 'neural-model-row'; row.dataset.model = name; row.dataset.stored = String(saved);
      const info = document.createElement('div'), label = document.createElement('strong'); label.dataset.l10nKeep = ''; label.textContent = title(name); info.append(label);
      const detail = p('', info); detail.dataset.l10nKeep = ''; detail.textContent = `${entry.file} · ${size(entry.bytes)}`;
      const state = p(saved ? T.stored : T.missing, info); state.classList.add('neural-model-state');
      const buttons = document.createElement('div'); buttons.className = 'neural-model-actions';
      const download = makeButton(buttons, T.download, () => void runDownload(name)); download.disabled = active || saved; download.dataset.action = 'download';
      const remove = makeButton(buttons, T.remove, () => void run(() => deleteStoredNeuralModel(url), T.removed)); remove.disabled = active || !saved; remove.dataset.action = 'remove';
      row.append(info, buttons); list.append(row);
    }
    other.replaceChildren();
    const extras = records.filter(r => !r.current);
    if (extras.length) {
      const heading = document.createElement('h4'); setText(heading, T.old); other.append(heading); p(T.oldHelp, other);
      for (const model of extras) {
        const row = document.createElement('div'); row.className = 'neural-model-row';
        const label = document.createElement('span'); label.dataset.l10nKeep = ''; label.textContent = `${model.name} · ${model.bytes ? size(model.bytes) : translate(T.unknownSize)}`; label.title = model.url;
        const remove = makeButton(row, T.remove, () => void run(() => deleteStoredNeuralModel(model.url), T.removed)); remove.disabled = active; row.prepend(label); other.append(row);
      }
    }
    all.disabled = active || !manifest || NEURAL_MODEL_NAMES.every(name => records.some(r => r.url === neuralModelUrl(assets, manifest!.models[name])));
    clear.disabled = active || !records.length; refreshButton.disabled = active;
    cancel.hidden = !controller || !active;
    transfer.hidden = !active || !lastTransfer; section.setAttribute('aria-busy', String(active));
    const supported = !!navigator.storage?.persist;
    setText(retention, persistent ? T.persistent : supported ? T.temporary : T.unsupported);
    persist.disabled = active || persistent || !supported;
    space.textContent = estimate?.quota !== undefined && estimate.usage !== undefined ? `${translate(T.siteSpace)} : ${size(estimate.usage)} / ${size(estimate.quota)}` : '';
    drawTransfer();
  }
  async function inspect(): Promise<void> {
    records = await listStoredNeuralModels(assets, manifest);
    [persistent, estimate] = await Promise.all([
      navigator.storage?.persisted?.().catch(() => false) ?? false,
      navigator.storage?.estimate?.().catch(() => undefined),
    ]);
  }
  async function refresh(): Promise<void> {
    if (active || disposed) return;
    const sequence = ++refreshSequence; refreshed = true; active = true; assets = currentAssets(); manifest = undefined; records = []; lastTransfer = undefined;
    show(T.checking); render();
    try {
      let offline = false;
      try { const loaded = await loadNeuralManifest(assets); manifest = loaded.manifest; offline = loaded.offline; }
      catch { show(T.catalogue, true); }
      await inspect();
      if (manifest) show(offline ? T.savedCatalogue : '');
    } catch { show(T.storageError, true); }
    finally { if (!disposed && sequence === refreshSequence) { active = false; render(); } }
  }
  async function run(action: () => Promise<void>, success: string): Promise<void> {
    if (active || disposed) return;
    active = true; show(''); render();
    try { await action(); show(success); }
    catch (error) {
      show(controller?.signal.aborted ? T.cancelled : error instanceof NeuralModelError ? error.code === 'storage' ? T.storageError : error.code === 'integrity' ? T.integrity : T.failure : T.failure, !controller?.signal.aborted);
    } finally {
      controller = undefined; lastTransfer = undefined;
      try { await inspect(); } catch { show(T.storageError, true); }
      active = false; render();
    }
  }
  async function runDownload(name?: NeuralModelName): Promise<void> {
    if (active || !manifest) return;
    // A changed endpoint must be inspected before starting a download from its catalogue.
    if (currentAssets() !== assets) { await refresh(); return; }
    controller = new AbortController();
    const signal = controller.signal, selectedManifest = manifest;
    await run(async () => {
      const names = name ? [name] : NEURAL_MODEL_NAMES.filter(key => !records.some(r => r.url === neuralModelUrl(assets, selectedManifest.models[key])));
      for (const key of names) {
        signal.throwIfAborted();
        await obtainNeuralModel(assets, selectedManifest, key, { requireStorage: true, signal, onProgress: event => {
          lastTransfer = event; transfer.hidden = false; drawTransfer();
        } });
      }
    }, T.complete);
  }
  async function requestPersistence(): Promise<void> {
    if (active) return;
    // Invoke directly from the click so browsers can use the user activation.
    const pending = navigator.storage?.persist?.();
    await run(async () => { if (!await pending) throw new Error('Persistence refused'); }, T.persistent);
    if (!persistent) show(T.refused);
  }
  const unlisten = onLanguageChange(render);
  const dialog = host.closest('dialog');
  const observer = new MutationObserver(() => { if (dialog?.open) void refresh(); });
  if (dialog) observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
  section.addEventListener('toggle', () => { if (section.open && !refreshed && (!dialog || dialog.open)) void refresh(); });
  render();
  return { refresh, dispose() { disposed = true; refreshSequence++; controller?.abort(); observer.disconnect(); unlisten(); section.remove(); } };
}
