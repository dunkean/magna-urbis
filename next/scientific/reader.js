// Progressive enhancement for the documentation pages. Everything stays readable without it.
(() => {
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // Language switch keeps the current chapter or stage.
  for (const a of $$('a[data-lang-switch]')) a.addEventListener('click', () => { if (location.hash) a.href = a.href.split('#')[0] + location.hash; });

  // Phone menu.
  const rail = document.getElementById('rail'), toggle = document.querySelector('.menu-toggle');
  toggle?.addEventListener('click', () => { const open = rail.classList.toggle('open'); toggle.setAttribute('aria-expanded', String(open)); });
  rail?.addEventListener('click', e => { if (e.target.closest('nav a')) { rail.classList.remove('open'); toggle?.setAttribute('aria-expanded', 'false'); } });

  // Open the stage card (or any details) that a link targets, e.g. the V2 "?" buttons.
  function openTarget() {
    const id = decodeURIComponent(location.hash.slice(1)); if (!id) return;
    const el = document.getElementById(id); if (!el) return;
    for (let d = el.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
    $$('.is-target').forEach(x => x.classList.remove('is-target')); el.classList.add('is-target');
    requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
  }
  addEventListener('hashchange', openTarget); openTarget();

  // Route: highlight the chapter being read.
  const links = new Map($$('.route a[href^="#"]').map(a => [a.getAttribute('href').slice(1), a]));
  if (links.size && 'IntersectionObserver' in window) {
    const seen = new Map();
    const io = new IntersectionObserver(entries => {
      for (const e of entries) seen.set(e.target.id, e.isIntersecting ? e.boundingClientRect.top : null);
      const visible = [...seen].filter(([, top]) => top !== null).sort((a, b) => a[1] - b[1]);
      const id = visible.length ? visible[0][0] : null; if (!id) return;
      links.forEach((a, key) => a.setAttribute('aria-current', String(key === id)));
    }, { rootMargin: '-10% 0px -70% 0px' });
    for (const id of links.keys()) { const s = document.getElementById(id); if (s) io.observe(s); }
  }

  // Filter: hides chapters, stage cards or culture cards whose text does not match.
  const input = document.querySelector('[data-filter]');
  if (input) {
    const items = $$(input.dataset.filter), status = document.getElementById('filter-status');
    const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const text = new Map(items.map(el => [el, norm(el.dataset.search || el.textContent)]));
    const run = () => {
      const q = norm(input.value.trim()); let n = 0;
      for (const el of items) { const hit = !q || q.split(/\s+/).every(w => text.get(el).includes(w)); el.classList.toggle('is-filtered-out', !hit); if (hit) n++; }
      for (const g of $$('[data-group]')) g.classList.toggle('is-filtered-out', !g.querySelector(input.dataset.filter + ':not(.is-filtered-out)'));
      if (status) status.textContent = q ? (status.dataset.template || '{n}').replace('{n}', n) : '';
    };
    input.addEventListener('input', run);
  }

  // Catalogue: era chips.
  const chips = $$('[data-era-chip]');
  for (const chip of chips) chip.addEventListener('click', () => {
    const era = chip.dataset.eraChip; chips.forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
    for (const card of $$('[data-era]')) card.classList.toggle('is-hidden-era', era !== 'all' && card.dataset.era !== era);
    for (const g of $$('[data-group]')) g.classList.toggle('is-hidden-era', !g.querySelector('[data-era]:not(.is-hidden-era)'));
  });

  // Catalogue: 2D / 3D view toggles on a card.
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-view]'); if (!b) return;
    const card = b.closest('.culture'); card.dataset.show = b.dataset.view;
    $$('[data-view]', card).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });

  // Theme override (follows the system by default).
  document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
    const root = document.documentElement, dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
  });

  // Printing shows every stage card.
  addEventListener('beforeprint', () => $$('details').forEach(d => { d.dataset.wasOpen = d.open; d.open = true; }));
  addEventListener('afterprint', () => $$('details').forEach(d => { d.open = d.dataset.wasOpen === 'true'; }));
})();
