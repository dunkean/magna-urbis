// Public integration only: GoatCounter API tokens must never be shipped here.
(() => {
  const integration = document.currentScript;
  const endpoint = integration?.dataset.goatcounter;
  // Local previews and offline exports must not contribute to the live count.
  if (!endpoint || location.hostname !== 'dunkean.github.io') return;

  // Exclude map IDs, seeds and other query parameters from the statistics.
  window.goatcounter = {
    path: location.pathname.replace(/index\.html$/, ''),
    no_events: true,
  };
  const tracking = document.createElement('script');
  tracking.async = true;
  // CORS load (gc.zgo.at answers Access-Control-Allow-Origin: *): accepted
  // by cross-origin-isolated pages under COEP require-corp (Safari) as well as
  // credentialless. The hit itself is a sendBeacon, which COEP does not block.
  tracking.crossOrigin = 'anonymous';
  tracking.src = 'https://gc.zgo.at/count.js';
  tracking.dataset.goatcounter = endpoint;
  document.head.append(tracking);

})();
