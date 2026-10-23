import { sketchQuery, placeSketchInFragment } from './terrainSketchSharing';
import { captureBenchUi, restoreBenchUi, type BenchUiContext } from './benchContext';
import { installRecipeSharing } from './recipeSharing';
import { executionRuntime, applyExecutionProfile, installExecutionProfile } from './executionProfile';

installExecutionProfile(document.querySelector('.shell-header')!);

const benches = {
  terrain: { title: 'Terrain · 1–3', path: 'terrainbench.html', query: '' },
  settlements: { title: 'Settlements · 4–5', path: 'terrainbench.html', query: 'stage=settlements' },
  city: { title: 'Ville', path: 'citybench.html', query: '' },
  urban: { title: 'Urbanisme', path: 'urbanbench.html', query: '' },
  houses: { title: 'Maisons', path: 'housebench.html', query: '' },
} as const;
type Bench = keyof typeof benches;
const home = document.querySelector<HTMLElement>('#home')!;
const frames = document.querySelector<HTMLElement>('#frames')!;
const actions = document.querySelector<HTMLElement>('.shell-actions')!;
const standalone = document.querySelector<HTMLAnchorElement>('#standalone')!;
const share = document.querySelector<HTMLButtonElement>('#share')!;
const announcement = document.querySelector<HTMLElement>('#announcement')!;
const loaded = new Map<Bench, HTMLIFrameElement>();
const loading = new Set<Bench>();
const sessionKey = `magna-bench-context-v1${executionRuntime.profile === 'local' ? '-local' : ''}`;
const contexts = new Map<Bench, string>();
const uiKey = `${sessionKey}-ui`;
const uiContexts = new Map<Bench, BenchUiContext>();
const restoring = new Set<Bench>();
try {
  const saved = JSON.parse(sessionStorage.getItem(sessionKey) ?? '{}');
  for (const bench of Object.keys(benches) as Bench[]) if (typeof saved[bench] === 'string') contexts.set(bench, saved[bench]);
} catch { /* Navigation still retains live frames when browser storage is unavailable. */ }
try {
  const saved = JSON.parse(sessionStorage.getItem(uiKey) ?? '{}');
  for (const bench of Object.keys(benches) as Bench[]) if (saved[bench]?.fields && saved[bench]?.panels) uiContexts.set(bench, saved[bench]);
} catch { /* The applied URLs remain available independently of UI drafts. */ }
let active: Bench | undefined;

function persistUi(): void {
  try { sessionStorage.setItem(uiKey, JSON.stringify(Object.fromEntries(uiContexts))); } catch { /* Storage unavailable or full. */ }
}
function rememberUi(bench: Bench): void {
  if (loading.has(bench) || restoring.has(bench)) return;
  try {
    const frame = loaded.get(bench), doc = frame?.contentDocument;
    if (doc?.defaultView?.magnaBenchContext?.ready()) {
      const snapshot = captureBenchUi(doc);
      // Hidden documents have no scroll boxes; retain the position captured
      // before hiding the atelier instead of replacing it with zeroes.
      if (frame?.hidden && uiContexts.has(bench)) snapshot.scroll = uiContexts.get(bench)!.scroll;
      uiContexts.set(bench, snapshot); persistUi();
    }
  } catch { /* File origins may restrict access to the child document. */ }
}
function resumeUi(bench: Bench, frame: HTMLIFrameElement): void {
  let doc: Document | null;
  try { doc = frame.contentDocument; } catch { return; }
  if (!doc) return;
  const document = doc;
  // With no snapshot to restore, pagehide must still capture edits made just
  // after the page becomes ready and before this readiness poll runs again.
  if (uiContexts.has(bench)) restoring.add(bench);
  const restore = (): void => {
    if (frame.contentDocument !== document) return;
    const hook = document.defaultView?.magnaBenchContext;
    if (!hook?.ready()) { setTimeout(restore, 100); return; }
    const snapshot = uiContexts.get(bench);
    if (snapshot) restoreBenchUi(document, snapshot);
    restoring.delete(bench);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = (): void => { clearTimeout(timer); timer = setTimeout(() => { if (frame.contentDocument === document) rememberUi(bench); }, 200); };
    for (const event of ['input', 'change', 'click', 'toggle', 'scroll']) document.addEventListener(event, save, true);
  };
  restore();
}

function remember(bench: Bench, query: string): void {
  contexts.set(bench, query);
  try { sessionStorage.setItem(sessionKey, JSON.stringify(Object.fromEntries(contexts))); } catch { /* Private mode or storage quota. */ }
}

function currentUrl(bench: Bench): URL | undefined {
  const frame = loaded.get(bench)!;
  try {
    const url = new URL(frame.contentWindow!.location.href);
    if (url.href !== 'about:blank') return url;
  } catch { return undefined; /* File origins can prevent reading applied settings. */ }
  return new URL(frame.src);
}

function updateStandalone(): void {
  if (!active) return;
  const url = currentUrl(active);
  const target = new URL(url?.href ?? loaded.get(active)!.src);
  target.searchParams.set('standalone', '1');
  standalone.href = target.href;
  share.disabled = !url;
  share.title = 'Copier le code unique de la carte affichée';
}

function syncRoute(): void {
  if (!active) return;
  // Blurring a child input can post its saved URL after a tab click has already
  // changed the hash, but before hashchange activates the destination.
  if (location.hash.slice(1).split('?')[0] !== active) return;
  const url = currentUrl(active);
  const params = url ? sketchQuery(url).toString() : contexts.get(active) ?? sketchQuery(new URL(loaded.get(active)!.src)).toString();
  remember(active, params);
  // Mark visited history entries: returning to one resumes its live atelier,
  // even if its old URL predates the latest edits in that atelier.
  history.replaceState({ ...history.state, magnaBenchContext: true }, '', `#${active}${params ? `?${params}` : ''}`);
  updateStandalone();
}

function navigate(): void {
  if (active && !loading.has(active)) {
    rememberUi(active);
    const previous = currentUrl(active);
    if (previous) remember(active, sketchQuery(previous).toString());
  }
  const resume = history.state?.magnaBenchContext === true;
  let route = location.hash.slice(1);
  // Old container links enter the shared world bench instead of a second session.
  if (route === 'neural' || route.startsWith('neural?')) {
    const params = new URLSearchParams(route.includes('?') ? route.slice(route.indexOf('?') + 1) : '');
    if (!params.has('source')) params.set('source', 'neural');
    if (!params.has('width')) params.set('width', '40000');
    route = `terrain?${params}`;
    history.replaceState(null, '', `#${route}`);
  }
  const separator = route.indexOf('?');
  const key = separator < 0 ? route : route.slice(0, separator);
  active = Object.hasOwn(benches, key) ? key as Bench : undefined;
  home.hidden = !!active;
  frames.hidden = !active;
  actions.hidden = !active;
  for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>('nav [data-bench]'))) {
    if (link.dataset.bench === active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  for (const [bench, frame] of loaded) frame.hidden = bench !== active;
  document.title = `${active ? benches[active].title : 'Ateliers Rust'} · Magna Urbis`;
  if (!active) return;
  const bench = active, definition = benches[bench];
  const url = new URL(definition.path, location.href);
  url.hash = '';
  url.search = separator < 0 ? contexts.get(bench) ?? definition.query : route.slice(separator + 1);
  applyExecutionProfile(url);
  if (bench === 'settlements') url.searchParams.set('stage', 'settlements');
  if (definition.path === 'terrainbench.html') placeSketchInFragment(url);
  let frame = loaded.get(bench);
  if (!frame) {
    if (!resume && separator >= 0) { uiContexts.delete(bench); persistUi(); }
    frame = document.createElement('iframe');
    frame.title = `Atelier ${definition.title} — Magna Urbis`;
    frame.dataset.bench = bench;
    frame.allow = 'clipboard-write; fullscreen';
    loading.add(bench);
    remember(bench, sketchQuery(url).toString());
    frame.src = url.href;
    frame.addEventListener('load', () => {
      loading.delete(bench);
      const applied = currentUrl(bench);
      if (applied) remember(bench, sketchQuery(applied).toString());
      if (active === bench) syncRoute();
      resumeUi(bench, frame!);
      try {
        frame!.contentWindow!.addEventListener('hashchange', updateStandalone);
        frame!.contentWindow!.addEventListener('popstate', updateStandalone);
      } catch { /* The standalone link still works with restricted file origins. */ }
    });
    loaded.set(bench, frame);
    frames.append(frame);
  } else if (!resume && separator >= 0 && sketchQuery(currentUrl(bench) ?? new URL(frame.src)).toString() !== sketchQuery(url).toString()) {
    loading.add(bench);
    restoring.delete(bench); uiContexts.delete(bench); persistUi();
    remember(bench, sketchQuery(url).toString());
    frame.src = url.href;
  }
  frame.hidden = false;
  if (!loading.has(bench)) syncRoute();
  else updateStandalone();
  announcement.textContent = `Atelier ${definition.title}`;
}

standalone.addEventListener('pointerdown', updateStandalone);
standalone.addEventListener('focus', updateStandalone);
// Houses and nested editors also update their URL without sending a shell message.
window.addEventListener('pagehide', () => {
  for (const bench of loaded.keys()) {
    rememberUi(bench);
    if (loading.has(bench)) continue;
    const url = currentUrl(bench);
    if (url) remember(bench, sketchQuery(url).toString());
  }
});
window.addEventListener('hashchange', navigate);
window.addEventListener('message', event => {
  if (event.origin !== (location.protocol === 'file:' ? 'null' : location.origin)) return;
  const source = [...loaded].find(([, frame]) => frame.contentWindow === event.source)?.[0];
  if (!source) return;
  if (event.data?.channel === 'magna-bench-url' && typeof event.data.query === 'string') {
    if (!loading.has(source)) {
      remember(source, event.data.query);
      if (active === source) syncRoute();
    }
    return;
  }
  if (event.data?.channel !== 'magna-bench-pipeline') return;
  const { stage, query } = event.data;
  if (Object.hasOwn(benches, stage) && typeof query === 'string') {
    // A transfer deliberately loads a new input; ordinary tab/history navigation
    // only resumes a page. Do this synchronously before late child URL messages.
    history.pushState(null, '', `#${stage}?${query}`);
    navigate();
  }
});
installRecipeSharing({
  host: document.querySelector('.shell-header')!,
  capture: async () => {
    if (!active || loading.has(active)) throw new Error('Ouvrez un atelier et attendez son chargement.');
    const hook = loaded.get(active)?.contentWindow?.magnaRecipe;
    if (!hook) throw new Error('Le partage par code est indisponible dans cet atelier.');
    return hook.capture();
  },
  open: recipe => {
    const stage = recipe.stage;
    // An import must replay the recipe even when that atelier already has UI drafts.
    active = undefined;
    loaded.get(stage)?.remove(); loaded.delete(stage); loading.delete(stage); restoring.delete(stage);
    uiContexts.delete(stage); persistUi(); remember(stage, recipe.query);
    history.pushState(null, '', `#${stage}?${recipe.query}`);
    navigate();
  },
});
navigate();
