import { registerMessages, setText } from './i18n';
import './desktopModules.css';
import modelCatalog from '../../../rust/models/neural-earth/catalog.json';

type Component = 'terrain' | 'illustration';
type Action = 'setup-illustration' | 'setup-terrain' | 'probe-illustration' | 'probe-terrain' | 'start-illustration' | 'start-terrain' | 'download-original' | 'download-distilled';
type Status = {
  uv: boolean; dataDir: string; cacheDir: string; busy: boolean; log?: string;
  components: { component: Component; installed: boolean; online: boolean; python: string; configured: boolean; earth?: string }[];
  lastOperation?: { action: string; success: boolean; message: string } | null;
};
type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

registerMessages({
  'Optional desktop modules': { en: 'Optional desktop modules', fr: 'Modules facultatifs pour ordinateur' },
  'Manage optional Python services and models. Setup and model downloads can require several GB. Starting and checking do not install anything.': { en: 'Manage optional Python services and models. Setup and model downloads can require several GB. Starting and checking do not install anything.', fr: 'Gérez les services Python et modèles facultatifs. L’installation et le téléchargement des modèles peuvent nécessiter plusieurs Go. Démarrer et vérifier ne lancent aucune installation.' },
  'Local models currently require an NVIDIA GPU with a compatible driver. Check verifies CUDA; model inference is checked separately. A configured manual interpreter remains selected after managed installation.': { en: 'Local models currently require an NVIDIA GPU with a compatible driver. Check verifies CUDA; model inference is checked separately. A configured manual interpreter remains selected after managed installation.', fr: 'Les modèles locaux nécessitent actuellement un GPU NVIDIA avec un pilote compatible. Vérifier contrôle CUDA ; l’inférence des modèles est vérifiée séparément. Un interpréteur manuel configuré reste sélectionné après une installation gérée.' },
  'Neural terrain': { en: 'Neural terrain', fr: 'Terrain neuronal' },
  'Illustration': { en: 'Illustration', fr: 'Illustration' },
  'Python path (empty uses managed Python)': { en: 'Python path (empty uses managed Python)', fr: 'Chemin Python (vide : Python géré)' },
  'Neural Earth source path (optional)': { en: 'Neural Earth source path (optional)', fr: 'Chemin des sources Neural Earth (facultatif)' },
  'Save paths': { en: 'Save paths', fr: 'Enregistrer les chemins' },
  'Install managed dependencies (several GB)': { en: 'Install managed dependencies (several GB)', fr: 'Installer les dépendances gérées (plusieurs Go)' },
  'Check': { en: 'Check', fr: 'Vérifier' },
  'Start': { en: 'Start', fr: 'Démarrer' },
  'Download original model (several GB)': { en: 'Download original model (several GB)', fr: 'Télécharger le modèle original (plusieurs Go)' },
  'Distilled model repository': { en: 'Distilled model repository', fr: 'Dépôt du modèle distillé' },
  'Immutable revision (commit hash)': { en: 'Immutable revision (commit hash)', fr: 'Révision immuable (empreinte du commit)' },
  'Download distilled model (several GB)': { en: 'Download distilled model (several GB)', fr: 'Télécharger le modèle distillé (plusieurs Go)' },
  'Enter a repository and a 40-character commit hash.': { en: 'Enter a repository and a 40-character commit hash.', fr: 'Indiquez un dépôt et une empreinte de commit de 40 caractères.' },
  'Refresh status': { en: 'Refresh status', fr: 'Actualiser l’état' },
  'Reload app to detect started services': { en: 'Reload app to detect started services', fr: 'Recharger l’application pour détecter les services démarrés' },
  'Working…': { en: 'Working…', fr: 'Opération en cours…' },
  'Environment installed': { en: 'Environment installed', fr: 'Environnement installé' },
  'Environment not installed': { en: 'Environment not installed', fr: 'Environnement non installé' },
  'Service online': { en: 'Service online', fr: 'Service actif' },
  'Service offline': { en: 'Service offline', fr: 'Service hors ligne' },
  'Configured': { en: 'Configured', fr: 'Configuré' },
  'Not configured': { en: 'Not configured', fr: 'Non configuré' },
  'Bundled uv available': { en: 'Bundled uv available', fr: 'uv intégré disponible' },
  'Bundled uv unavailable': { en: 'Bundled uv unavailable', fr: 'uv intégré indisponible' },
  'Data folder': { en: 'Data folder', fr: 'Dossier de données' },
  'Cache folder': { en: 'Cache folder', fr: 'Dossier de cache' },
  'Last operation succeeded': { en: 'Last operation succeeded', fr: 'Dernière opération réussie' },
  'Last operation failed': { en: 'Last operation failed', fr: 'Dernière opération échouée' },
  'Activity log': { en: 'Activity log', fr: 'Journal d’activité' },
});

/** Mount only in Tauri. Commands start work explicitly; status polling runs only while busy. */
export function mountDesktopModules(host: HTMLElement, onServicesChanged?: () => void): void {
  const internals = (window as Window & { __TAURI_INTERNALS__?: { invoke: Invoke } }).__TAURI_INTERNALS__;
  if (!internals?.invoke) return;
  const invoke: Invoke = internals.invoke;
  const panel = document.createElement('details'); panel.className = 'section desktop-modules';
  const summary = document.createElement('summary'); setText(summary, 'Optional desktop modules'); panel.append(summary);
  const intro = document.createElement('p'); intro.className = 'hint'; setText(intro, 'Manage optional Python services and models. Setup and model downloads can require several GB. Starting and checking do not install anything.'); panel.append(intro);
  const requirements = document.createElement('p'); requirements.className = 'hint'; setText(requirements, 'Local models currently require an NVIDIA GPU with a compatible driver. Check verifies CUDA; model inference is checked separately. A configured manual interpreter remains selected after managed installation.'); panel.append(requirements);
  const availability = document.createElement('p'); availability.className = 'hint';
  const dirs = document.createElement('div'); dirs.className = 'desktop-module-dirs';
  const dataLabel = document.createElement('span'); setText(dataLabel, 'Data folder');
  const dataPath = document.createElement('code');
  const cacheLabel = document.createElement('span'); setText(cacheLabel, 'Cache folder');
  const cachePath = document.createElement('code');
  dirs.append(dataLabel, dataPath, cacheLabel, cachePath); panel.append(availability, dirs);
  const controls: HTMLButtonElement[] = [];
  const statuses = new Map<Component, { installed: HTMLElement; online: HTMLElement; configured: HTMLElement; python: HTMLInputElement; earth?: HTMLInputElement }>();
  let pending = false, timer: ReturnType<typeof setTimeout> | undefined, initialized = false;
  let pollUntil = Date.now() + 60_000, previousBusy = false, operationRequested = false;
  const onlineStates = new Map<Component, boolean>();
  let refreshButton: HTMLButtonElement;
  const result = document.createElement('p'); result.className = 'desktop-module-result'; result.setAttribute('role', 'status');
  const resultText = document.createElement('span'); const resultDetail = document.createElement('span'); result.append(resultText, resultDetail);
  const logLabel = document.createElement('p'); logLabel.className = 'label'; setText(logLabel, 'Activity log');
  const log = document.createElement('pre'); log.className = 'job-log desktop-module-log';
  function button(label: string, callback: () => void): HTMLButtonElement {
    const element = document.createElement('button'); element.type = 'button'; element.className = 'small'; setText(element, label);
    element.onclick = callback; controls.push(element); return element;
  }
  function field(parent: HTMLElement, label: string): HTMLInputElement {
    const container = document.createElement('label'); container.className = 'desktop-module-field';
    const title = document.createElement('span'); setText(title, label);
    const input = document.createElement('input'); input.type = 'text'; input.spellcheck = false;
    container.append(title, input); parent.append(container); return input;
  }
  async function refresh(): Promise<void> {
    clearTimeout(timer);
    try {
      const state = await invoke<Status>('desktop_status');
      setText(availability, state.uv ? 'Bundled uv available' : 'Bundled uv unavailable');
      dataPath.textContent = state.dataDir; cachePath.textContent = state.cacheDir;
      let servicesChanged = false;
      for (const item of state.components) {
        const view = statuses.get(item.component); if (!view) continue;
        const previous = onlineStates.get(item.component);
        if (previous === undefined ? item.online : previous !== item.online) servicesChanged = true;
        onlineStates.set(item.component, item.online);
        setText(view.installed, item.installed ? 'Environment installed' : 'Environment not installed');
        setText(view.online, item.online ? 'Service online' : 'Service offline');
        setText(view.configured, item.configured ? 'Configured' : 'Not configured');
        if (!initialized) { view.python.value = item.python ?? ''; if (view.earth) view.earth.value = item.earth ?? ''; }
      }
      initialized = true;
      if (!state.busy && state.lastOperation?.success && (previousBusy || operationRequested)) servicesChanged = true;
      if (!state.busy) operationRequested = false;
      previousBusy = state.busy;
      if (servicesChanged) onServicesChanged?.();
      log.textContent = state.log ?? '';
      if (state.busy) { setText(resultText, 'Working…'); resultDetail.textContent = ''; }
      else if (state.lastOperation) { setText(resultText, state.lastOperation.success ? 'Last operation succeeded' : 'Last operation failed'); resultDetail.textContent = `: ${state.lastOperation.message}`; }
      else { setText(resultText, ''); resultDetail.textContent = ''; }
      for (const control of controls) control.disabled = control !== refreshButton && (state.busy || pending);
      if (state.busy || (Date.now() < pollUntil && state.components.some(item => item.installed && !item.online))) timer = setTimeout(() => { void refresh(); }, 1000);
    } catch (error) { setText(resultText, ''); resultDetail.textContent = String(error); for (const control of controls) control.disabled = false; }
  }
  async function perform(command: string, args: Record<string, unknown>): Promise<void> {
    if (pending) return;
    pending = true; pollUntil = Date.now() + 60_000; for (const control of controls) control.disabled = control !== refreshButton;
    if (command === 'desktop_action') operationRequested = true;
    try { await invoke(command, args); pending = false; await refresh(); }
    catch (error) { pending = false; operationRequested = false; setText(resultText, ''); resultDetail.textContent = String(error); for (const control of controls) control.disabled = false; }
  }
  function action(name: Action, args: Record<string, unknown> = {}): void { void perform('desktop_action', { action: name, ...args }); }
  for (const component of ['terrain', 'illustration'] as const) {
    const section = document.createElement('section'); section.className = 'desktop-module';
    const heading = document.createElement('h4'); setText(heading, component === 'terrain' ? 'Neural terrain' : 'Illustration');
    const state = document.createElement('p'); state.className = 'hint';
    const online = document.createElement('span'), installed = document.createElement('span'), configured = document.createElement('span'); state.append(online, ' · ', installed, ' · ', configured);
    section.append(heading, state);
    const python = field(section, 'Python path (empty uses managed Python)');
    const earth = component === 'terrain' ? field(section, 'Neural Earth source path (optional)') : undefined;
    statuses.set(component, { installed, online, configured, python, earth });
    const actions = document.createElement('div'); actions.className = 'desktop-module-actions';
    actions.append(button('Save paths', () => { void perform('desktop_configure', { component, python: python.value.trim(), earth: earth?.value.trim() ?? '' }); }),
      button('Install managed dependencies (several GB)', () => action(`setup-${component}`)),
      button('Check', () => action(`probe-${component}`)), button('Start', () => action(`start-${component}`)));
    section.append(actions); panel.append(section);
  }
  const models = document.createElement('section'); models.className = 'desktop-module';
  models.append(button('Download original model (several GB)', () => action('download-original')));
  const repo = field(models, 'Distilled model repository'), revision = field(models, 'Immutable revision (commit hash)');
  repo.value = modelCatalog.distribution.repo;
  revision.value = modelCatalog.distribution.revision;
  models.append(button('Download distilled model (several GB)', () => {
    if (!repo.value.trim() || !/^[a-f0-9]{40}$/.test(revision.value.trim())) { setText(resultText, 'Enter a repository and a 40-character commit hash.'); resultDetail.textContent = ''; return; }
    action('download-distilled', { repo: repo.value.trim(), revision: revision.value.trim() });
  }));
  const footer = document.createElement('div'); footer.className = 'desktop-module-actions';
  refreshButton = button('Refresh status', () => { pollUntil = Date.now() + 60_000; void refresh(); });
  footer.append(refreshButton, button('Reload app to detect started services', () => window.location.reload()));
  panel.append(models, footer, result, logLabel, log); host.append(panel);
  panel.addEventListener('toggle', () => { if (panel.open) { pollUntil = Date.now() + 60_000; void refresh(); } });
  window.addEventListener('beforeunload', () => clearTimeout(timer), { once: true });
  void refresh();
}
