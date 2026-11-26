import { handheldDevice } from '../../../rust/bridge/deviceClass';
import { onLanguageChange, setText, translate } from '../v2/i18n';

const DISMISSED = 'magna-browser-advice-closed';

export type BrowserKind = 'chrome' | 'edge' | 'other';
export interface BrowserEnv {
  userAgent: string;
  brave?: boolean;
  brands?: readonly string[];
  tauri?: boolean;
  /** `navigator.maxTouchPoints`: iPadOS reports a Mac user agent, only its touch points tell it apart. */
  touchPoints?: number;
}

/** Plain Chrome or Edge; Brave, Opera, Vivaldi, Firefox, Safari and the rest are 'other'. */
export function browserKind(env: BrowserEnv): BrowserKind {
  const ua = env.userAgent,
    brands = env.brands ?? [];
  if (env.brave || /OPR\/|Opera|Vivaldi|SamsungBrowser|Firefox|FxiOS|Brave/i.test(ua) || brands.some(b => /Brave|Opera|Vivaldi/i.test(b))) return 'other';
  if (/Edg(e|A|iOS)?\//.test(ua) || brands.some(b => /Microsoft Edge/i.test(b))) return 'edge';
  return /Chrome\/|Chromium\//.test(ua) ? 'chrome' : 'other';
}
/** iPhone, iPad or iPod: every browser there is WebKit, whatever its name (CriOS, FxiOS, EdgiOS). */
export function appleMobile(env: BrowserEnv): boolean {
  return /iPhone|iPad|iPod|CriOS|FxiOS|EdgiOS/.test(env.userAgent) || (/Macintosh/.test(env.userAgent) && (env.touchPoints ?? 0) > 1);
}
/** Chrome/Edge get no advice (their map runs on WebGPU); every other browser is advised to use Chrome or Edge, except on iOS where there is no other engine. */
export function adviceFor(env: BrowserEnv): { kind: BrowserKind } | null {
  if (env.tauri || appleMobile(env)) return null;
  const kind = browserKind(env);
  return kind === 'other' ? { kind } : null;
}

function readEnv(): BrowserEnv {
  const nav = navigator as Navigator & { brave?: unknown; userAgentData?: { brands?: { brand: string }[] } };
  const w = window as unknown as Record<string, unknown>;
  return { userAgent: nav.userAgent, brave: nav.brave !== undefined, brands: nav.userAgentData?.brands?.map(b => b.brand), tauri: '__TAURI_INTERNALS__' in w || '__TAURI__' in w, touchPoints: nav.maxTouchPoints };
}

let shown = false;
/** A fixed, non-blocking banner, once per visit; the close button hides it for the session. At the top on desktop; on a
 * handheld at the bottom, above the bottom controls, so it never covers the header's buttons. */
export function showBrowserAdvice(): void {
  if (shown || typeof document === 'undefined' || typeof navigator === 'undefined') return;
  const advice = adviceFor(readEnv());
  if (!advice) return;
  try {
    if (sessionStorage.getItem(DISMISSED)) return;
  } catch {
    /* storage blocked: show it */
  }
  shown = true;
  const banner = document.createElement('div');
  banner.id = 'browserAdvice';
  banner.setAttribute('role', 'status');
  banner.style.cssText =
    (handheldDevice() ? 'position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom, 0px) + 84px);' : 'position:fixed;left:50%;top:12px;') +
    'transform:translateX(-50%);z-index:2147483000;max-width:min(640px,calc(100vw - 32px));' +
    'background:#fffbe8;color:#3b3220;border:1px solid #d8c88f;border-radius:8px;padding:10px 12px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.18);display:flex;gap:10px;align-items:flex-start';
  const text = document.createElement('span');
  setText(text, 'For the best performance, use Chrome or Edge.');
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', translate('Close'));
  close.style.cssText = 'border:0;background:none;font:18px/1 system-ui,sans-serif;cursor:pointer;color:inherit;padding:0 2px' + (handheldDevice() ? ';min-width:40px;min-height:40px;margin:-10px -8px -10px 0' : '');
  const offLanguage = onLanguageChange(() => {
    setText(text, 'For the best performance, use Chrome or Edge.');
    close.setAttribute('aria-label', translate('Close'));
  });
  close.onclick = () => {
    offLanguage();
    banner.remove();
    try {
      sessionStorage.setItem(DISMISSED, '1');
    } catch {
      /* not remembered */
    }
  };
  banner.append(text, close);
  (document.body ? Promise.resolve() : new Promise(resolve => addEventListener('DOMContentLoaded', resolve, { once: true }))).then(() => document.body.append(banner));
}
