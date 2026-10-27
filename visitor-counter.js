// Public integration only: GoatCounter API tokens must never be shipped here.
(() => {
  const integration = document.currentScript;
  const endpoint = integration?.dataset.goatcounter;
  // Local previews and offline exports must not contribute to the live count.
  if (!endpoint || location.hostname !== 'dunkean.github.io') return;

  const site = new URL(endpoint).origin;
  const style = document.createElement('style');
  style.textContent = `
    #visitorCounter { position:absolute; z-index:4; top:10px; left:10px;
      display:flex; align-items:center; gap:6px; padding:5px 9px;
      border-radius:9px; color:var(--ink2); font:11px/1.4 system-ui,sans-serif;
      text-decoration:none; }
    #visitorCounter strong { color:var(--ink); font-variant-numeric:tabular-nums; }
    #visitorCounter:hover { color:var(--ink); }
    @media (max-width:640px) {
      #visitorCounter { top:8px; left:8px; padding:4px 7px; font-size:10px; }
    }
  `;
  document.head.append(style);

  const counter = document.createElement('a');
  counter.id = 'visitorCounter';
  counter.className = 'glass';
  counter.href = 'https://www.goatcounter.com/';
  counter.target = '_blank';
  counter.rel = 'noopener noreferrer';
  counter.title = 'GoatCounter';
  const value = document.createElement('strong');
  value.textContent = '…';
  const label = document.createElement('span');
  counter.append(value, label);
  (document.getElementById('app') || document.body).append(counter);

  function localize() {
    const language = document.documentElement.lang.split('-')[0];
    label.textContent = ({ fr: 'visites', en: 'visits', zh: '次访问', es: 'visitas', pt: 'visitas' })[language] || 'visits';
  }
  localize();
  document.addEventListener('DOMContentLoaded', localize, { once: true });
  window.addEventListener('magna-locale-change', localize);

  // Exclude map IDs, seeds and other query parameters from the statistics.
  window.goatcounter = {
    path: location.pathname.replace(/index\.html$/, ''),
    no_events: true,
  };
  const tracking = document.createElement('script');
  tracking.async = true;
  tracking.src = 'https://gc.zgo.at/count.js';
  tracking.dataset.goatcounter = endpoint;
  document.head.append(tracking);

  // TOTAL includes all recorded visits; this public endpoint needs no API key.
  fetch(`${site}/counter/TOTAL.json`, {
    credentials: 'omit',
    signal: AbortSignal.timeout(8000),
  }).then(response => {
    if (!response.ok) throw new Error('Counter unavailable');
    return response.json();
  }).then(data => {
    if (typeof data.count !== 'string' && typeof data.count !== 'number') throw new Error('Invalid counter');
    value.textContent = String(data.count);
  }).catch(() => {
    // A blocked or unavailable analytics service must not affect the map.
    value.textContent = '—';
  });
})();
