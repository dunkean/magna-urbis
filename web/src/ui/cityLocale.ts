import { installWorkshopLocale, type Locale } from './shellLocale';
type Words = readonly [string, string, string, string, string];
const locales: Locale[] = ['fr', 'en', 'zh', 'es', 'pt'];
const text: Record<string, Words> = {
  '#fit':['Carte entière','Whole map','整张地图','Mapa completo','Mapa inteiro'],
  '#focusCity':['Ville','City','城市','Ciudad','Cidade'],
  '#pipelineReturn':['Renvoyer aux settlements','Send back to settlements','发送回聚落','Devolver a asentamientos','Devolver aos povoamentos'],
  '#pipelineSave':['Conserver cet export','Keep this export','保存此导出','Guardar esta exportación','Guardar esta exportação'],
  '#pipelineDownload':['Partager .decor','Share .decor','分享 .decor','Compartir .decor','Compartilhar .decor'],
  '#situationPin':['Épingler un point','Pin a point','标记位置','Marcar un punto','Marcar um ponto'],
  '#situationCopy':['Copier le code','Copy code','复制代码','Copiar código','Copiar código'],
  '#situationLink':['Copier le lien','Copy link','复制链接','Copiar enlace','Copiar link'],
};
const checks: Record<string, Words> = {
  showBackground:['Fond de carte','Map background','地图背景','Fondo del mapa','Fundo do mapa'],
  showPlan:['Plan de ville','City plan','城市规划','Plano urbano','Plano da cidade'],
};
const labels: Record<string, Words> = {
  backgroundStyle:['Fond','Background','背景','Fondo','Fundo'],
  backgroundOpacity:['Opacité','Opacity','不透明度','Opacidad','Opacidade'],
};
const options: Record<string, Words> = {
  relief:['Relief','Relief','地形','Relieve','Relevo'],
  render:['Rendu','Render','渲染','Renderizado','Renderização'],
  parchment:['Parchemin','Parchment','羊皮纸','Pergamino','Pergaminho'],
};
export function setupCityLocale(): void {
  let current: Locale = 'fr';
  function apply(locale: Locale): void {
    current = locale; const i = locales.indexOf(locale);
    const brand = document.querySelector('.brand');
    if (brand?.firstChild?.nodeType === Node.TEXT_NODE) brand.firstChild.textContent = ['Ville ','City ','城市 ','Ciudad ','Cidade '][i];
    const subtitle = brand?.querySelector('small');
    if (subtitle) subtitle.textContent = ['routes, plan et parcelles','roads, plan and parcels','道路、规划和地块','caminos, plano y parcelas','estradas, plano e parcelas'][i];
    for (const [selector, words] of Object.entries(text)) {
      const element = document.querySelector<HTMLElement>(selector);
      if (element && element.textContent !== words[i]) element.textContent = words[i];
    }
    for (const [id, words] of Object.entries(checks)) {
      const node = document.getElementById(id)?.nextSibling;
      if (node?.nodeType === Node.TEXT_NODE && node.textContent !== words[i]) node.textContent = words[i];
    }
    for (const [id, words] of Object.entries(labels)) {
      const node = document.getElementById(id)?.closest('label')?.firstChild;
      if (node?.nodeType === Node.TEXT_NODE && node.textContent !== words[i] + ' ') node.textContent = words[i] + ' ';
    }
    const select = document.getElementById('backgroundStyle') as HTMLSelectElement | null;
    for (const option of Array.from(select?.options ?? [])) {
      const words = options[option.value];
      if (words && option.textContent !== words[i]) option.textContent = words[i];
    }
  }
  const header = document.querySelector('header');
  if (!header) return;
  installWorkshopLocale(header, apply);
  // City stages are mounted asynchronously by the workshop.
  const stages = document.querySelector('.stages');
  if (stages) new MutationObserver(() => apply(current)).observe(stages, {childList:true, subtree:true});
}
