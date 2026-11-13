import { urbanText } from './urbanPanelLocale';

const DISMISSED = 'magna-browser-advice-closed';

export type BrowserKind = 'chrome' | 'edge' | 'other';
export interface BrowserEnv { userAgent: string; brave?: boolean; brands?: readonly string[]; tauri?: boolean }

/** Plain Chrome or Edge; Brave, Opera, Vivaldi, Firefox, Safari and the rest are 'other'. */
export function browserKind(env: BrowserEnv): BrowserKind {
  const ua = env.userAgent, brands = env.brands ?? [];
  if (env.brave || /OPR\/|Opera|Vivaldi|SamsungBrowser|Firefox|FxiOS|Brave/i.test(ua) || brands.some(b => /Brave|Opera|Vivaldi/i.test(b))) return 'other';
  if (/Edg(e|A|iOS)?\//.test(ua) || brands.some(b => /Microsoft Edge/i.test(b))) return 'edge';
  return /Chrome\/|Chromium\//.test(ua) ? 'chrome' : 'other';
}
/** Chrome/Edge get no advice (their map runs on WebGPU); every other browser is advised to use Chrome or Edge. */
export function adviceFor(env: BrowserEnv): { kind: BrowserKind } | null {
  if (env.tauri) return null;
  const kind = browserKind(env);
  return kind === 'other' ? { kind } : null;
}

function readEnv(): BrowserEnv {
  const nav = navigator as Navigator & { brave?: unknown; userAgentData?: { brands?: { brand: string }[] } };
  const w = window as unknown as Record<string, unknown>;
  return { userAgent: nav.userAgent, brave: nav.brave !== undefined, brands: nav.userAgentData?.brands?.map(b => b.brand), tauri: '__TAURI_INTERNALS__' in w || '__TAURI__' in w };
}

function message(): string {
  return urbanText([
    'Pour de meilleures performances, utilisez Chrome ou Edge.',
    'For the best performance, use Chrome or Edge.',
    '为获得最佳性能，请使用 Chrome 或 Edge。',
    'Para un mejor rendimiento, use Chrome o Edge.',
    'Para melhor desempenho, use Chrome ou Edge.',
  ]);
}

let shown = false;
/** A fixed, non-blocking banner at the top of the page, once per visit; the close button hides it for the session. */
export function showBrowserAdvice(): void {
  if (shown || typeof document === 'undefined' || typeof navigator === 'undefined') return;
  const advice = adviceFor(readEnv());
  if (!advice) return;
  try { if (sessionStorage.getItem(DISMISSED)) return; } catch { /* storage blocked: show it */ }
  shown = true;
  const banner = document.createElement('div');
  banner.id = 'browserAdvice'; banner.setAttribute('role', 'status');
  banner.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483000;max-width:min(640px,calc(100vw - 32px));'
    + 'background:#fffbe8;color:#3b3220;border:1px solid #d8c88f;border-radius:8px;padding:10px 12px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.18);display:flex;gap:10px;align-items:flex-start';
  const text = document.createElement('span');
  text.textContent = message();
  const close = document.createElement('button');
  close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', urbanText(['Fermer', 'Close', '关闭', 'Cerrar', 'Fechar']));
  close.style.cssText = 'border:0;background:none;font:18px/1 system-ui,sans-serif;cursor:pointer;color:inherit;padding:0 2px';
  close.onclick = () => { banner.remove(); try { sessionStorage.setItem(DISMISSED, '1'); } catch { /* not remembered */ } };
  banner.append(text, close);
  (document.body ? Promise.resolve() : new Promise(resolve => addEventListener('DOMContentLoaded', resolve, { once: true }))).then(() => document.body.append(banner));
}
