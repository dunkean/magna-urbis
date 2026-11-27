/** Mounted by the host page, which owns both the frame's layout and outside clicks. */
export function mountCityEmbedOverlay(frame: HTMLIFrameElement) {
  const origin = new URL(frame.src, location.href).origin;
  const events = new AbortController();
  let slot: HTMLElement | undefined;
  let originalStyle: string | null = null;
  const sendState = () => frame.contentWindow?.postMessage({ type: 'magna-urbis:frame-state', expanded: !!slot, lang: document.documentElement.lang }, origin);
  function close() {
    if (!slot) return;
    if (frame.matches(':popover-open')) frame.hidePopover();
    frame.removeAttribute('popover');
    if (originalStyle === null) frame.removeAttribute('style');
    else frame.setAttribute('style', originalStyle);
    slot.remove();
    slot = undefined;
    sendState();
  }
  function open() {
    if (slot || !frame.isConnected) return;
    const rect = frame.getBoundingClientRect();
    const layout = getComputedStyle(frame);
    originalStyle = frame.getAttribute('style');
    slot = document.createElement('span');
    Object.assign(slot.style, { display: layout.display, width: rect.width + 'px', height: rect.height + 'px', margin: layout.margin, flex: layout.flex, gridArea: layout.gridArea, verticalAlign: layout.verticalAlign });
    if (layout.position === 'absolute' || layout.position === 'fixed') slot.style.position = layout.position;
    frame.before(slot);
    frame.popover = 'manual';
    Object.assign(frame.style, { position: 'fixed', inset: '0', margin: 'auto', transform: 'none', maxWidth: 'none', maxHeight: 'none', width: 'min(90vw, 1040px)', height: 'min(82dvh, 780px)', boxSizing: 'border-box', padding: '0', boxShadow: '0 8px 32px #241e3355' });
    frame.showPopover();
    sendState();
  }
  window.addEventListener('message', event => {
    if (event.source !== frame.contentWindow || event.origin !== origin) return;
    switch (event.data?.type) {
      case 'magna-urbis:frame-ready': sendState(); break;
      case 'magna-urbis:frame-expand': open(); break;
      case 'magna-urbis:frame-close': close(); break;
    }
  }, { signal: events.signal });
  document.addEventListener('pointerdown', event => {
    if (slot && event.target !== frame) close();
  }, { capture: true, signal: events.signal });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  }, { signal: events.signal });
  return () => { close(); events.abort(); };
}
