import profiles from '../../../config/execution.json';
import { LOCALE_KEY, savedLocale, type Locale } from './shellLocale';

export interface ExecutionRuntime { profile: 'web' | 'local'; server: string }
declare global { interface Window { magnaExecutionRuntime?: ExecutionRuntime } }
export { profiles as executionProfiles };

const executionText: Record<Locale, { label: string; aria: string; stale: string; staleTitle: string; connected: string; offline: string; offlineTitle: string }> = {
  fr: { label:'Exécution', aria:'Profil d’exécution', stale:'à actualiser', staleTitle:'Moteur Rust connecté mais ancien. Reconstruisez le moteur local puis relancez les bancs.', connected:'Moteur Rust natif connecté · villes et maisons disponibles', offline:'hors ligne', offlineTitle:'Lancez npm run start:local depuis web/.' },
  en: { label:'Execution', aria:'Execution profile', stale:'update needed', staleTitle:'The connected Rust engine is outdated. Rebuild the local engine and restart the workshops.', connected:'Native Rust engine connected · cities and houses available', offline:'offline', offlineTitle:'Run npm run start:local from web/.' },
  zh: { label:'运行方式', aria:'运行配置', stale:'需要更新', staleTitle:'已连接的 Rust 引擎版本过旧。请重新构建本地引擎并重启工作坊。', connected:'原生 Rust 引擎已连接 · 城市和房屋可用', offline:'离线', offlineTitle:'在 web/ 目录中运行 npm run start:local。' },
  es: { label:'Ejecución', aria:'Perfil de ejecución', stale:'actualización necesaria', staleTitle:'El motor Rust conectado es antiguo. Recompila el motor local y reinicia los talleres.', connected:'Motor Rust nativo conectado · ciudades y casas disponibles', offline:'sin conexión', offlineTitle:'Ejecuta npm run start:local desde web/.' },
  pt: { label:'Execução', aria:'Perfil de execução', stale:'atualização necessária', staleTitle:'O motor Rust conectado está desatualizado. Recompile o motor local e reinicie os ateliês.', connected:'Motor Rust nativo conectado · cidades e casas disponíveis', offline:'desconectado', offlineTitle:'Execute npm run start:local em web/.' },
};

/** Embedded ateliers use the shell's profile, even when their URL is older. */
function executionHost(): Window {
  try {
    if (window.parent !== window && window.parent.document.querySelector('.shell-header')) return window.parent;
  } catch { /* Standalone file origins may restrict access to the parent. */ }
  return window;
}

function readRuntime(): ExecutionRuntime {
  if (typeof window === 'undefined') return { profile: 'web', server: profiles.local.server };
  const host = executionHost();
  if (host.magnaExecutionRuntime) return host.magnaExecutionRuntime;
  const params = new URLSearchParams(host.location.search);
  const route = new URLSearchParams(host.location.hash.includes('?') ? host.location.hash.slice(host.location.hash.indexOf('?') + 1) : '');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(host.location.hostname);
  // Local startup belongs to the host, not an old map's embedded Web profile.
  // The picker writes an explicit host query when Web is deliberately selected.
  const requestedProfile = params.get('profile') ?? (loopback ? null : route.get('profile'));
  const profile = requestedProfile === 'local' || requestedProfile === 'web' ? requestedProfile : loopback ? 'local' : 'web';
  let retainedServer: string | null = null;
  const explicitServer = params.get('localServer') ?? route.get('localServer');
  try {
    retainedServer = sessionStorage.getItem('magna-local-server');
    if (explicitServer) sessionStorage.setItem('magna-local-server', explicitServer);
  } catch { /* Workers and private/file origins may not expose storage. */ }
  return { profile, server: (explicitServer ?? retainedServer ?? profiles.local.server).replace(/\/+$/, '') };
}
export const executionRuntime = readRuntime();
if (typeof window !== 'undefined') window.magnaExecutionRuntime = executionRuntime;

/** Execution belongs to the host; geometry parameters and neural models stay explicit. */
export function applyExecutionProfile(url: URL, runtime = executionRuntime): URL {
  const previousProfile = url.searchParams.get('profile');
  if (previousProfile && previousProfile !== runtime.profile) {
    url.searchParams.delete('compute'); url.searchParams.delete('generation');
  }
  url.searchParams.set('profile', runtime.profile);
  if (runtime.profile === 'local') url.searchParams.set('localServer', runtime.server);
  else {
    url.searchParams.delete('localServer');
    if (url.searchParams.get('generation') === 'native') url.searchParams.delete('generation');
  }
  return url;
}

function changeExecutionProfile(profile: ExecutionRuntime['profile']): void {
  const host = executionHost();
  const runtime = { ...readRuntime(), profile };
  const url = applyExecutionProfile(new URL(host.location.href), runtime);
  // Normalize the embedded route too: links, reloads and standalone ateliers
  // must all carry the same profile, without retaining the previous defaults.
  url.searchParams.delete('compute'); url.searchParams.delete('generation');
  if (url.hash.includes('?')) {
    const separator = url.hash.indexOf('?');
    const route = applyExecutionProfile(new URL(`?${url.hash.slice(separator + 1)}`, url), runtime);
    route.searchParams.delete('compute'); route.searchParams.delete('generation');
    url.hash = `${url.hash.slice(0, separator)}?${route.searchParams}`;
  }
  // Update every live picker before navigation, including retained hidden tabs.
  host.dispatchEvent(new CustomEvent('magna-execution-profile-change', { detail: profile }));
  host.location.assign(url.href);
}

/** Small shared picker, also available when opening an atelier on its own. */
export function installExecutionProfile(parent: Element): void {
  if (parent.querySelector('[data-execution-profile]')) return;
  const label = document.createElement('label');
  label.dataset.executionProfile = '';
  label.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font:12px system-ui;white-space:nowrap';
  const labelText = document.createTextNode('');
  label.append(labelText);
  const select = document.createElement('select');
  select.add(new Option('Web', 'web'));
  select.add(new Option('Local · Rust', 'local'));
  select.value = executionRuntime.profile;
  select.style.cssText = 'font:inherit;padding:4px;border:1px solid #879887;border-radius:3px;background:#f4f1e6;color:#273d33';
  select.onchange = () => changeExecutionProfile(select.value as ExecutionRuntime['profile']);
  const host = executionHost();
  const sync = (event: Event): void => { select.value = (event as CustomEvent<ExecutionRuntime['profile']>).detail; };
  host.addEventListener('magna-execution-profile-change', sync);
  window.addEventListener('pagehide', event => {
    if (!event.persisted) host.removeEventListener('magna-execution-profile-change', sync);
  });
  label.append(select);
  parent.append(label);
  let connection: 'checking' | 'stale' | 'connected' | 'offline' = 'checking';
  let state: HTMLElement | undefined;
  const translate = (): void => {
    const words = executionText[savedLocale()];
    labelText.textContent = `${words.label} `;
    select.setAttribute('aria-label', words.aria);
    if (!state) return;
    if (connection === 'stale') { state.textContent = words.stale; state.title = words.staleTitle; }
    else if (connection === 'connected') { state.textContent = '●'; state.title = words.connected; }
    else if (connection === 'offline') { state.textContent = words.offline; state.title = words.offlineTitle; }
  };
  const onStorage = (event: StorageEvent): void => { if (event.key === LOCALE_KEY) translate(); };
  window.addEventListener('magna-locale-change', translate);
  window.addEventListener('storage', onStorage);
  window.addEventListener('pagehide', event => {
    if (!event.persisted) { window.removeEventListener('magna-locale-change', translate); window.removeEventListener('storage', onStorage); }
  });
  if (executionRuntime.profile === 'local') {
    state = document.createElement('small'); state.setAttribute('role', 'status'); label.append(state);
    const check = (): void => {
      void fetch(`${executionRuntime.server}/status`, { signal: AbortSignal.timeout(4000) }).then(async response => {
        if (!response.ok) throw new Error();
        const status = await response.json();
        if (status.service !== 'magna-urbis-local') throw new Error();
        if (!Array.isArray(status.capabilities) || !status.capabilities.includes('houses.placement')) {
          connection = 'stale';
        } else { connection = 'connected'; }
        translate();
      }).catch(() => { connection = 'offline'; translate(); });
    };
    // Synchronous workshop startup can otherwise exhaust the timeout before JSON is read.
    if (document.readyState === 'complete') check();
    else window.addEventListener('load', check, { once: true });
  }
  translate();
}
