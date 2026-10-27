import { LOCALE_KEY, savedLocale, type Locale } from './shellLocale';

type Words = readonly [string, string, string, string, string];
const languages: Locale[] = ['fr', 'en', 'zh', 'es', 'pt'];
const controls: Record<string, Words> = {
  reserve:['Réserve de croissance','Growth reserve','增长预留地','Reserva de crecimiento','Reserva de crescimento'],
  allocated:['Terre urbaine attribuée','Allocated urban land','已分配城市用地','Suelo urbano asignado','Terreno urbano atribuído'],
  centers:['Noyaux et identités de quartier','Centers and neighborhood identities','中心与街区身份','Núcleos e identidades de barrio','Núcleos e identidades de bairro'],
  domains:['Domaines réservés','Reserved areas','保留区域','Áreas reservadas','Áreas reservadas'],
  quarters:['Secteurs de calcul','Calculation sectors','计算分区','Sectores de cálculo','Setores de cálculo'],
  blocks:['Îlots','Blocks','街区','Manzanas','Quadras'],
  streets:['Rues urbaines','Urban streets','城市街道','Calles urbanas','Ruas urbanas'],
  enclosures:['Enceintes et portes','Walls and gates','城墙与城门','Murallas y puertas','Muralhas e portões'],
  parcels:['Parcelles','Parcels','地块','Parcelas','Lotes'],
  gardens:['Jardins','Gardens','花园','Jardines','Jardins'],
  places:['Places et communs','Squares and commons','广场与公共空间','Plazas y espacios comunes','Praças e espaços comuns'],
  fronts:['Façades accessibles','Accessible frontages','可达临街面','Frentes accesibles','Frentes acessíveis'],
  axes:['Axes des parcelles','Parcel axes','地块轴线','Ejes de parcelas','Eixos dos lotes'],
  access:['Statut de desserte des parcelles','Parcel access status','地块通达状态','Estado de acceso a las parcelas','Estado de acesso aos lotes'],
  textured:['Matières texturées','Textured materials','纹理材质','Materiales con textura','Materiais texturizados'],
  palette:['Palette','Palette','调色板','Paleta','Paleta'], opacity:['Opacité','Opacity','不透明度','Opacidad','Opacidade'],
  width:['Épaisseur des traits (px)','Line width (px)','线宽（像素）','Grosor de línea (px)','Espessura da linha (px)'],
};
const choices: Record<string, Words> = {
  growth:['Phases de croissance','Growth phases','增长阶段','Fases de crecimiento','Fases de crescimento'],
  atlas:['Atlas · quartiers','Atlas · neighborhoods','图集 · 街区','Atlas · barrios','Atlas · bairros'],
  ink:['Encre','Ink','墨绘','Tinta','Tinta'], terrain:['Terrain','Terrain','地形','Terreno','Terreno'],
};
const title: Words = ['⚙ Rendu · couches, palette, opacité','⚙ Rendering · layers, palette, opacity','⚙ 渲染 · 图层、调色板、不透明度','⚙ Renderizado · capas, paleta, opacidad','⚙ Renderização · camadas, paleta, opacidade'];
const hint: Words = ['Ces réglages redessinent les résultats conservés, sans appel de génération. La réserve, la terre attribuée et les enceintes sont trois objets différents.','These settings redraw retained results without generating again. The reserve, allocated land and walls are three distinct objects.','这些设置重新绘制保留的结果，无需重新生成。预留地、已分配土地和城墙是三个不同的对象。','Estos ajustes redibujan los resultados conservados sin volver a generar. La reserva, el suelo asignado y las murallas son objetos distintos.','Estas configurações redesenham os resultados mantidos sem gerar novamente. A reserva, o terreno atribuído e as muralhas são objetos distintos.'];

export function setupUrbanRenderLocale(panel: HTMLElement): void {
  function apply(): void {
    const index = languages.indexOf(savedLocale());
    const summary = panel.querySelector('summary'); if (summary) summary.textContent = title[index];
    const note = panel.querySelector('small'); if (note) note.textContent = hint[index];
    for (const [key, words] of Object.entries(controls)) {
      const control = panel.querySelector<HTMLElement>(`[data-render="${key}"]`);
      const label = control?.closest('label'); if (!control || !label) continue;
      const node = control instanceof HTMLInputElement && control.type === 'checkbox' ? control.nextSibling : label.firstChild;
      if (node?.nodeType === Node.TEXT_NODE) node.textContent = words[index];
    }
    for (const [value, words] of Object.entries(choices)) {
      const option = panel.querySelector<HTMLOptionElement>(`[data-render="palette"] option[value="${value}"]`);
      if (option) option.textContent = words[index];
    }
  }
  apply();
  window.addEventListener('magna-locale-change', apply);
  window.addEventListener('storage', event => { if (event.key === LOCALE_KEY) apply(); });
}
