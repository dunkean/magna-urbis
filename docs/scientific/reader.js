// Progressive enhancement only: all scientific content remains readable offline without JS.
const languageKey = 'magna-urbis-v2-language';
const pageLanguage = document.documentElement.lang === 'fr' ? 'fr' : 'en';
const queryLanguage = new URLSearchParams(location.search).get('lang');
let savedLanguage;
try { savedLanguage = localStorage.getItem(languageKey); } catch { /* Direct offline files can restrict storage. */ }
const selectedLanguage = queryLanguage === 'en' || queryLanguage === 'fr' ? queryLanguage
  : location.pathname.endsWith('/fr.html') ? 'fr' : savedLanguage === 'fr' ? 'fr' : 'en';
if (selectedLanguage !== pageLanguage) {
  const destination = new URL(selectedLanguage === 'fr' ? 'fr.html' : 'index.html', location.href);
  destination.searchParams.set('lang', selectedLanguage); destination.hash = location.hash;
  location.replace(destination.href);
}
try { localStorage.setItem(languageKey, selectedLanguage); } catch { /* Language links still work without persistence. */ }
const languageLinks = [...document.querySelectorAll('.atlas-language a')];
function syncLanguageLinks() {
  for (const link of languageLinks) {
    const destination = new URL(link.getAttribute('href'), location.href);
    destination.hash = location.hash; link.href = destination.href;
  }
}
languageLinks.forEach(link => link.addEventListener('click', () => {
  try { localStorage.setItem(languageKey, link.dataset.language); } catch { /* Optional persistence. */ }
}));
syncLanguageLinks(); window.addEventListener('hashchange', syncLanguageLinks);
const sections = [...document.querySelectorAll('main > section.chapter')];
const links = [...document.querySelectorAll('.sidebar nav a')];
const input = document.querySelector('#search');
const status = document.querySelector('#search-status');
const reset = document.querySelector('#show-all');
const toc = document.querySelector('.toc');
const narrow = matchMedia('(max-width:760px)');
const syncToc = () => { toc.open = !narrow.matches; };
syncToc(); narrow.addEventListener('change', syncToc);
const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function applySearch() {
  const terms = normalize(input.value.trim()).split(/\s+/).filter(Boolean);
  let count = 0;
  for (const section of sections) {
    const haystack = normalize(section.textContent);
    section.hidden = !terms.every(term => haystack.includes(term));
    if (!section.hidden) count++;
  }
  reset.hidden = terms.length === 0;
  status.textContent = !terms.length ? '' : pageLanguage === 'fr'
    ? `${count} chapitre${count > 1 ? 's' : ''} sur ${sections.length}. Recherche par mots, accents ignorés.`
    : `${count} chapter${count === 1 ? '' : 's'} out of ${sections.length}. Word search ignores accents.`;
}
input.addEventListener('input', applySearch);
reset.addEventListener('click', () => { input.value = ''; applySearch(); input.focus(); });
links.forEach(link => link.addEventListener('click', () => { input.value = ''; applySearch(); if (narrow.matches) toc.open = false; }));
document.querySelector('#print').addEventListener('click', () => window.print());
// Citations and incoming deep links can reveal a chapter hidden by a previous search.
function revealHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  const target = document.getElementById(id);
  const section = target?.closest('section.chapter');
  if (section?.hidden) { input.value = ''; applySearch(); target.scrollIntoView(); }
}
window.addEventListener('hashchange', revealHash);
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      links.forEach(link => link.hash === `#${entry.target.id}` ? link.setAttribute('aria-current', 'location') : link.removeAttribute('aria-current'));
    }
  }, { rootMargin: '-8% 0px -70% 0px', threshold: 0 });
  sections.forEach(section => observer.observe(section));
}
revealHash();
