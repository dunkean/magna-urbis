import { urbanText } from './urbanPanelLocale';

const DISMISSED = 'magna-angle-d3d11-notice';

/** One dismissible banner per browser: on ANGLE/D3D11 the natural looks compile in about a minute,
 * against a second with the Vulkan or OpenGL backend, which only the user can choose. */
export function showAngleD3D11Notice(): void {
  if (typeof document === 'undefined' || document.getElementById('angleNotice')) return;
  try { if (localStorage.getItem(DISMISSED)) return; } catch { /* storage blocked: show it */ }
  const banner = document.createElement('div');
  banner.id = 'angleNotice'; banner.setAttribute('role', 'status');
  banner.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483000;max-width:min(560px,calc(100vw - 32px));'
    + 'background:#fffbe8;color:#3b3220;border:1px solid #d8c88f;border-radius:8px;padding:10px 12px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.18);display:flex;gap:10px;align-items:flex-start';
  const text = document.createElement('span');
  text.textContent = urbanText([
    'Ce navigateur dessine via Direct3D 11 : les rendus naturels (Render v2, forêts) mettent environ une minute à compiler la première fois. Avec Vulkan, c’est une seconde : ouvrez chrome://flags/#use-angle (ou edge://flags/#use-angle), choisissez Vulkan, puis relancez le navigateur.',
    'This browser draws through Direct3D 11: natural looks (Render v2, forests) take about a minute to compile the first time. With Vulkan it takes a second: open chrome://flags/#use-angle (or edge://flags/#use-angle), choose Vulkan, then restart the browser.',
    '此浏览器通过 Direct3D 11 绘制：自然渲染（Render v2、森林）首次编译约需一分钟。使用 Vulkan 只需一秒：打开 chrome://flags/#use-angle（或 edge://flags/#use-angle），选择 Vulkan，然后重启浏览器。',
    'Este navegador dibuja con Direct3D 11: los renderizados naturales (Render v2, bosques) tardan cerca de un minuto en compilarse la primera vez. Con Vulkan tarda un segundo: abra chrome://flags/#use-angle (o edge://flags/#use-angle), elija Vulkan y reinicie el navegador.',
    'Este navegador desenha via Direct3D 11: as renderizações naturais (Render v2, florestas) levam cerca de um minuto para compilar na primeira vez. Com Vulkan leva um segundo: abra chrome://flags/#use-angle (ou edge://flags/#use-angle), escolha Vulkan e reinicie o navegador.',
  ]);
  const close = document.createElement('button');
  close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', urbanText(['Fermer', 'Close', '关闭', 'Cerrar', 'Fechar']));
  close.style.cssText = 'border:0;background:none;font:18px/1 system-ui,sans-serif;cursor:pointer;color:inherit;padding:0 2px';
  close.onclick = () => { banner.remove(); try { localStorage.setItem(DISMISSED, '1'); } catch { /* not remembered */ } };
  banner.append(text, close);
  (document.body ? Promise.resolve() : new Promise(resolve => addEventListener('DOMContentLoaded', resolve, { once: true }))).then(() => document.body.append(banner));
}
