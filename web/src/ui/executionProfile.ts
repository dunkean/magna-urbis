import profiles from '../../../config/execution.json';

export interface ExecutionRuntime { profile: 'web' | 'local'; server: string }
export { profiles as executionProfiles };

function readRuntime(): ExecutionRuntime {
  if (typeof location === 'undefined') return { profile: 'web', server: profiles.local.server };
  const params = new URLSearchParams(location.search);
  const route = new URLSearchParams(location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?') + 1) : '');
  const profile = (params.get('profile') ?? route.get('profile')) === 'local' ? 'local' : 'web';
  let retainedServer: string | null = null;
  const explicitServer = params.get('localServer') ?? route.get('localServer');
  try {
    retainedServer = sessionStorage.getItem('magna-local-server');
    if (explicitServer) sessionStorage.setItem('magna-local-server', explicitServer);
  } catch { /* Workers and private/file origins may not expose storage. */ }
  return { profile, server: (explicitServer ?? retainedServer ?? profiles.local.server).replace(/\/+$/, '') };
}
export const executionRuntime = readRuntime();

/** Execution belongs to the host; geometry parameters and neural models stay explicit. */
export function applyExecutionProfile(url: URL, runtime = executionRuntime): URL {
  url.searchParams.set('profile', runtime.profile);
  if (runtime.profile === 'local') url.searchParams.set('localServer', runtime.server);
  else {
    url.searchParams.delete('localServer');
    if (url.searchParams.get('generation') === 'native') url.searchParams.delete('generation');
  }
  return url;
}

/** Small shared picker, also available when opening an atelier on its own. */
export function installExecutionProfile(parent: Element): void {
  if (parent.querySelector('[data-execution-profile]')) return;
  const label = document.createElement('label');
  label.dataset.executionProfile = '';
  label.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font:12px system-ui;white-space:nowrap';
  label.append('Exécution ');
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Profil d’exécution');
  select.add(new Option('Web', 'web'));
  select.add(new Option('Local · Rust', 'local'));
  select.value = executionRuntime.profile;
  select.style.cssText = 'font:inherit;padding:4px;border:1px solid #879887;border-radius:3px;background:#f4f1e6;color:#273d33';
  select.onchange = () => {
    let host: Window = window;
    try { if (window.parent !== window && window.parent.document.querySelector('.shell-header')) host = window.parent; } catch { /* Standalone file origins. */ }
    const url = applyExecutionProfile(new URL(host.location.href), { ...executionRuntime, profile: select.value as ExecutionRuntime['profile'] });
    // Each profile has its own defaults. Keep applied map inputs in the URL.
    for (const params of [url.searchParams, ...(url.hash.includes('?') ? [new URLSearchParams(url.hash.slice(url.hash.indexOf('?') + 1))] : [])]) {
      params.delete('compute'); params.delete('generation');
      if (params !== url.searchParams) url.hash = `${url.hash.slice(0, url.hash.indexOf('?'))}?${params}`;
    }
    host.location.assign(url.href);
  };
  label.append(select);
  parent.append(label);
  if (executionRuntime.profile === 'local') {
    const state = document.createElement('small'); state.setAttribute('role', 'status'); label.append(state);
    void fetch(`${executionRuntime.server}/status`, { signal: AbortSignal.timeout(4000) }).then(async response => {
      if (!response.ok) throw new Error();
      const status = await response.json();
      if (status.service !== 'magna-urbis-local') throw new Error();
      state.textContent = '●'; state.title = 'Moteur Rust natif connecté';
    }).catch(() => { state.textContent = 'hors ligne'; state.title = 'Lancez npm run start:local depuis web/.'; });
  }
}
