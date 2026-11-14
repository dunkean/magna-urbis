// Renders the Atlas of methods (index.html in English, fr.html in French).
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, REPO } from './shell.mjs';
import { diagram } from './diagrams.mjs';
import { stages } from './stages.mjs';

const dir = dirname(fileURLToPath(import.meta.url));
const byId = new Map(stages.map(s => [s.id, s]));

function figure(name, caption, wide, lang) {
  return `<figure class="section-figure${wide ? ' wide' : ''}"><div class="plate">${diagram(name, lang)}</div><figcaption>${caption}</figcaption></figure>`;
}
const img = (file, alt, caption, wide = false) => `<figure class="section-figure${wide ? ' wide' : ''}"><img src="assets/atlas/${file}" alt="${esc(alt)}" loading="lazy" width="960" height="686"><figcaption>${caption}</figcaption></figure>`;
function gallery(spec) {
  const items = spec.split(';').map(x => x.split('|'));
  return `<div class="section-figure wide gallery">${items.map(([f, c]) => `<figure><img src="assets/atlas/${f}" alt="${esc(c)}" loading="lazy" width="960" height="686"><figcaption>${c}</figcaption></figure>`).join('')}</div>`;
}

function card(id, m, lang) {
  const s = byId.get(id); if (!s) throw new Error(`Missing stage card ${id}`);
  const d = s[lang], L = m.labels;
  const gist = d.what.replace(/<[^>]+>/g, '').split(/(?<=\.)\s/)[0];
  const rows = [['what', d.what], ['how', d.how], ['io', d.io], ['ctl', d.ctl], ['cost', d.cost]].filter(([, v]) => v);
  const code = (s.code ?? []).map(p => `<a href="${REPO}${p}">${esc(p)}</a>`).join(', ');
  return `<details class="stage" id="stage-${id}" data-stage="${id}">
<summary><span class="name">${esc(s.name[lang])}</span><code>${id}</code><span class="gist">${gist}</span></summary>
<div class="stage-body"><div class="chips"><span class="chip">${esc(L.when[s.when] ?? s.when)}</span><span class="chip${s.opt ? '' : ' req'}">${esc(s.opt ? L.optional : L.required)}</span></div>
<dl>${rows.map(([k, v]) => `<dt>${esc(L[k])}</dt><dd>${v}</dd>`).join('')}${code ? `<dt>${esc(L.code)}</dt><dd class="code-links">${code}</dd>` : ''}</dl></div>
</details>`;
}

export async function render(lang) {
  const { meta: m, chapters } = await import(`./atlas.${lang}.mjs`);
  const refs = await readFile(resolve(dir, `refs.${lang}.html`), 'utf8');
  const parts = { region: m.partRegion, settle: m.partSettle, town: m.partTown, map: m.partMap, more: m.partMore };
  const used = new Set(chapters.flatMap(c => c.stages));
  for (const s of stages) if (!used.has(s.id)) throw new Error(`Stage ${s.id} is not placed in any chapter`);

  const expand = body => body
    .replace(/\[\[(fig|wide):([\w-]+)\|([^\]]*)\]\]/g, (_, k, n, c) => figure(n, c, k === 'wide', lang))
    .replace(/\[\[img:([^|\]]+)\|([^|\]]+)\|([^\]]*)\]\]/g, (_, f, a, c) => img(f, a, c))
    .replace(/\[\[gallery:([^\]]+)\]\]/g, (_, spec) => gallery(spec))
    .replace('[[refs]]', refs);

  let lastPart = '';
  const route = chapters.map((c, i) => {
    const head = c.part !== lastPart ? `<li class="part">${esc(parts[c.part])}</li>` : ''; lastPart = c.part;
    return `${head}<li><a href="#${c.id}">${esc(c.title)}</a></li>`;
  }).join('');
  const rail = `<nav aria-label="Chapters"><ol class="route">${route}</ol></nav>
<div class="filter"><label for="filter">${esc(m.filter)}</label><input id="filter" type="search" placeholder="${esc(m.filterPh)}" data-filter=".chapter, details.stage" autocomplete="off"><p class="filter-status" id="filter-status" role="status" data-template="${esc(m.filterStatus)}"></p></div>
<p class="note">${esc(m.railNote)}</p>`;

  const hero = `<header class="hero"><h1>${esc(m.heroTitle)}</h1><p class="lead">${esc(m.lead)}</p>
<figure class="section-figure wide"><div class="plate">${diagram('section', lang)}</div><figcaption>${esc(m.heroCaption)}</figcaption></figure>
<div class="facts">${m.facts.map(([v, l]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div></header>`;

  const body = hero + chapters.map((c, i) => `
<section class="chapter" id="${c.id}">
<div class="chapter-head"><div class="chapter-no" aria-hidden="true">${String(i + 1).padStart(2, '0')}</div><div><h2>${esc(c.title)}</h2><p class="kicker">${esc(c.kicker)}</p></div></div>
<div class="prose">${expand(c.body)}</div>
${c.stages.length ? `<div class="stages"><h3>${esc(m.stagesHead)}</h3>${c.stages.map(id => card(id, m, lang)).join('\n')}</div>` : ''}
</section>`).join('\n');
  return { title: m.title, description: m.description, rail, body };
}
