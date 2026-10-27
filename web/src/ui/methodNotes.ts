import renderV2Note from '../../../docs/methods/render-v2.md?raw';
import groundNote from '../../../docs/methods/render3d-ground.md?raw';
import fantasyNote from '../../../docs/methods/fantasy-landuse.md?raw';
import vegetationNote from '../../../docs/methods/render3d-vegetation.md?raw';
import brushNote from '../../../docs/methods/render3d-brush.md?raw';
import parcelNote from '../../../docs/methods/urban-parcels.md?raw';
import programmeNote from '../../../docs/methods/urban-programme-allocation.md?raw';
import architectureNote from '../../../docs/methods/urban-architecture-placement.md?raw';
import urbanRenderingNote from '../../../docs/methods/urban-buildings-rendering.md?raw';
import settlementStylesNote from '../../../docs/methods/urban-settlement-styles.md?raw';
import { urbanText } from './urbanPanelLocale';
import { LOCALE_KEY } from './shellLocale';

const bundledFigures = import.meta.glob<string>('../../../docs/methods/images/*.webp', {
  eager: true, query: '?inline', import: 'default',
});
const figures = Object.fromEntries(Object.entries(bundledFigures).map(([path, image]) => [path.slice(path.indexOf('images/')), image]));

export type MethodNoteId = 'render-v2' | 'render3d-ground' | 'fantasy-landuse' | 'render3d-vegetation' | 'render3d-brush' | 'urban-parcels' | 'urban-programme-allocation' | 'urban-architecture-placement' | 'urban-buildings-rendering' | 'urban-settlement-styles';
const notes: Record<MethodNoteId, { title: string; markdown: string; images: Record<string, string> }> = {
  'render-v2': { title:'Render v2: procedural satellite environment',markdown:renderV2Note,images:{} },
  'urban-settlement-styles': { title: 'Settlement styles and independent stages', markdown: settlementStylesNote, images: {} },
  'urban-buildings-rendering': { title: 'Applied urban buildings in 2D and perspective', markdown: urbanRenderingNote, images: {} },
  'urban-parcels': { title: 'Continuous frontage and cultural parcels', markdown: parcelNote, images: {} },
  'urban-programme-allocation': { title: 'Urban programme and bounded allocation', markdown: programmeNote, images: {} },
  'urban-architecture-placement': { title: 'External architectural placement', markdown: architectureNote, images: {} },
  'render3d-brush': { title: 'Render3DBrush: biome brushes in the forest material', markdown: brushNote, images: {} },
  'fantasy-landuse': { title: 'Fantasy brushes and territory occupation', markdown: fantasyNote, images: {} },
  'render3d-vegetation': { title: 'Render3D forest field, crowns and occupation', markdown: vegetationNote, images: figures },
  'render3d-ground': {
    title: 'Multiscale terrain and ground material', markdown: groundNote,
    images: figures,
  },
};
const escape = (text: string): string => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A small, escaped Markdown renderer for bundled scientific notes. No HTML,
 * scripts or remote image execution. The source Markdown is downloadable too. */
function renderMarkdown(markdown: string, images: Record<string, string>): string {
  const inline = (text: string): string => escape(text)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, path: string) => images[path] ? `<img alt="${alt}" src="${images[path]}" loading="lazy">` : alt)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  const lines = markdown.replace(/\r/g, '').split('\n'), html: string[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```') || line.trim() === '$$') {
      const marker = line.startsWith('```') ? '```' : '$$', block: string[] = []; i++;
      while (i < lines.length && !lines[i].startsWith(marker)) block.push(lines[i++]);
      i++; html.push(`<pre><code>${escape(block.join('\n'))}</code></pre>`); continue;
    }
    const heading = /^(#{1,6}) (.*)$/.exec(line);
    if (heading) { html.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); i++; continue; }
    if (line.startsWith('|') && /^\|?[ :|-]+\|?$/.test(lines[i + 1] ?? '')) {
      const cells = (row: string): string[] => row.replace(/^\||\|$/g, '').split('|').map(v => v.trim());
      html.push('<div class="method-table"><table><thead><tr>' + cells(line).map(v => `<th>${inline(v)}</th>`).join('') + '</tr></thead><tbody>'); i += 2;
      while (i < lines.length && lines[i].startsWith('|')) html.push('<tr>' + cells(lines[i++]).map(v => `<td>${inline(v)}</td>`).join('') + '</tr>');
      html.push('</tbody></table></div>'); continue;
    }
    const list = /^(?:[-*] |\d+\. )/.test(line);
    if (list) {
      const tag = /^\d/.test(line) ? 'ol' : 'ul'; html.push(`<${tag}>`);
      while (i < lines.length && /^(?:[-*] |\d+\. )/.test(lines[i])) {
        const item = [lines[i++].replace(/^(?:[-*] |\d+\. )/, '')];
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) item.push(lines[i++].trim());
        html.push(`<li>${inline(item.join(' '))}</li>`);
        if (!lines[i]?.trim() && /^(?:[-*] |\d+\. )/.test(lines[i + 1] ?? '')) i++;
      }
      html.push(`</${tag}>`); continue;
    }
    const paragraph: string[] = [line]; i++;
    while (i < lines.length && lines[i].trim() && !/^(?:#|```|\$\$|\||[-*] |\d+\. )/.test(lines[i])) paragraph.push(lines[i++]);
    html.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }
  return html.join('\n');
}

let dialog: HTMLDialogElement | undefined;
let currentNote: MethodNoteId | undefined;
const noteTitles: Record<MethodNoteId, readonly [string,string,string,string,string]> = {
  'render-v2':['Render v2 : paysage satellite procédural','Render v2: procedural satellite environment','Render v2：程序化卫星景观','Render v2: paisaje satelital procedural','Render v2: paisagem de satélite procedural'],
  'urban-settlement-styles':['Styles d’implantation et étapes indépendantes','Settlement styles and independent stages','聚落风格与独立阶段','Estilos de asentamiento y etapas independientes','Estilos de assentamento e etapas independentes'],
  'urban-buildings-rendering':['Bâtiments urbains appliqués en 2D et perspective','Applied urban buildings in 2D and perspective','二维及透视视图中的已应用城市建筑','Edificios urbanos aplicados en 2D y perspectiva','Edifícios urbanos aplicados em 2D e perspectiva'],
  'urban-parcels':['Façades continues et parcelles culturelles','Continuous frontage and cultural parcels','连续临街面与文化地块','Fachadas continuas y parcelas culturales','Testadas contínuas e lotes culturais'],
  'urban-programme-allocation':['Programme urbain et allocation bornée','Urban programme and bounded allocation','城市规划方案与有界分配','Programa urbano y asignación acotada','Programa urbano e alocação limitada'],
  'urban-architecture-placement':['Implantation architecturale extérieure','External architectural placement','建筑外部布置','Implantación arquitectónica exterior','Implantação arquitetônica externa'],
  'render3d-brush':['Render3DBrush : motifs de biome dans la matière forestière','Render3DBrush: biome brushes in the forest material','Render3DBrush：森林材质中的生物群落画笔','Render3DBrush: pinceles de bioma en el material forestal','Render3DBrush: pincéis de bioma no material florestal'],
  'fantasy-landuse':['Motifs Fantasy et occupation du territoire','Fantasy brushes and territory occupation','幻想画笔与土地利用','Pinceles Fantasy y ocupación del territorio','Pincéis Fantasy e ocupação do território'],
  'render3d-vegetation':['Render3D : forêt, couronnes et occupation','Render3D forest field, crowns and occupation','Render3D 森林场、树冠与土地利用','Render3D: bosque, copas y ocupación','Render3D: floresta, copas e ocupação'],
  'render3d-ground':['Terrain multiscalaire et matière de sol','Multiscale terrain and ground material','多尺度地形与地面材质','Terreno multiescala y material de suelo','Terreno multiescala e material do solo'],
};
function localizeNoteControls(): void {
  if (!dialog || !currentNote) return;
  dialog.querySelector('strong')!.textContent = urbanText(noteTitles[currentNote]);
  dialog.querySelector<HTMLButtonElement>('[data-download]')!.textContent = urbanText(['Télécharger le Markdown','Download Markdown','下载 Markdown','Descargar Markdown','Baixar Markdown']);
  dialog.querySelector<HTMLButtonElement>('.method-note-bar button')!.setAttribute('aria-label', urbanText(['Fermer la note','Close note','关闭说明','Cerrar nota','Fechar nota']));
}
export function openMethodNote(id: MethodNoteId): void {
  const note = notes[id];
  currentNote = id;
  if (!dialog) {
    dialog = document.createElement('dialog'); dialog.className = 'method-note';
    dialog.setAttribute('aria-labelledby', 'methodNoteTitle');
    dialog.innerHTML = '<form method="dialog" class="method-note-bar"><strong id="methodNoteTitle"></strong><button aria-label="Fermer la note">×</button></form><article lang="en" tabindex="0"></article><footer><button type="button" data-download>Download Markdown</button></footer>';
    document.body.append(dialog);
    window.addEventListener('magna-locale-change', localizeNoteControls);
    window.addEventListener('storage', event => { if (event.key === LOCALE_KEY) localizeNoteControls(); });
    dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog!.getBoundingClientRect(); const p = event as MouseEvent; if (p.clientX < r.left || p.clientX > r.right || p.clientY < r.top || p.clientY > r.bottom) dialog!.close(); } });
  }
  localizeNoteControls();
  const article = dialog.querySelector('article')!; article.innerHTML = renderMarkdown(note.markdown, note.images); article.scrollTop = 0;
  dialog.querySelector<HTMLButtonElement>('[data-download]')!.onclick = () => {
    const url = URL.createObjectURL(new Blob([note.markdown], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${id}.md`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (!dialog.open) dialog.showModal();
  article.focus(); dialog.scrollTop = 0;
}
