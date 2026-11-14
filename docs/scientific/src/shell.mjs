// Shared page shell for the atlas and the catalogue (both languages).
export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const REPO = 'https://github.com/dunkean/magna-urbis/blob/main/';

/** Page names per language; the switch keeps the reader on the same page and chapter. */
export const PAGES = {
  atlas: { en: 'index.html', fr: 'fr.html' },
  catalogue: { en: 'catalogue-architecture.html', fr: 'catalogue-architecture-fr.html' },
};

const UI = {
  en: { skip: 'Skip to content', atlas: 'Atlas of methods', catalogue: 'Architectural styles', menu: 'Menu', theme: 'Theme', sub: 'How the generator works', subCat: 'Architectural styles' },
  fr: { skip: 'Aller au contenu', atlas: 'Atlas des méthodes', catalogue: 'Styles architecturaux', menu: 'Menu', theme: 'Thème', sub: 'Comment fonctionne le générateur', subCat: 'Styles architecturaux' },
};

/**
 * @param {{lang:'en'|'fr', page:'atlas'|'catalogue', title:string, description:string, rail:string, body:string, updated:string}} o
 */
export function page(o) {
  const u = UI[o.lang], other = o.lang === 'en' ? 'fr' : 'en';
  const switchLang = `<a href="${PAGES[o.page].en}" hreflang="en" lang="en" data-lang-switch${o.lang === 'en' ? ' aria-current="page"' : ''}>English</a><a href="${PAGES[o.page].fr}" hreflang="fr" lang="fr" data-lang-switch${o.lang === 'fr' ? ' aria-current="page"' : ''}>Français</a>`;
  const switchPage = `<a href="${PAGES.atlas[o.lang]}"${o.page === 'atlas' ? ' aria-current="page"' : ''}>${u.atlas}</a><a href="${PAGES.catalogue[o.lang]}"${o.page === 'catalogue' ? ' aria-current="page"' : ''}>${u.catalogue}</a>`;
  return `<!doctype html>
<html lang="${o.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="alternate" hreflang="${other}" href="${PAGES[o.page][other]}">
<link rel="icon" href="assets/logo.png">
<link rel="stylesheet" href="styles.css">
<script src="reader.js" defer></script>
</head>
<body>
<a class="skip" href="#content">${u.skip}</a>
<div class="frame">
<aside class="rail" id="rail">
  <a class="brand" href="${PAGES.atlas[o.lang]}"><img src="assets/logo.png" width="64" height="64" alt=""><span>Magna Urbis<small>${o.page === 'atlas' ? u.sub : u.subCat}</small></span></a>
  <button class="menu-toggle" type="button" aria-controls="rail" aria-expanded="false">${u.menu}</button>
  <div class="switches" role="group" aria-label="${u.atlas}">${switchPage}</div>
  <div class="switches" role="group" aria-label="Language">${switchLang}</div>
  ${o.rail}
</aside>
<main id="content">
${o.body}
<footer class="site">${o.updated} <a href="https://github.com/dunkean/magna-urbis">github.com/dunkean/magna-urbis</a></footer>
</main>
</div>
</body>
</html>
`;
}
