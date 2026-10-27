/** Language preference for interfaces that opt into the shared locale. */
export const LOCALE_KEY = 'magna-urbis-locale';
export const LOCALES = ['fr', 'en', 'zh', 'es', 'pt'] as const;
export type Locale = typeof LOCALES[number];
export function resolveLocale(value: string | null | undefined): Locale {
  const base = value?.toLowerCase().split(/[-_]/)[0];
  return LOCALES.find(locale => locale === base) ?? 'fr';
}
export function savedLocale(): Locale {
  try { return resolveLocale(localStorage.getItem(LOCALE_KEY) || navigator.language); }
  catch { return resolveLocale(navigator.language); }
}

/** Add a picker for standalone workshops; embedded ones follow the shell. */
export function installWorkshopLocale(parent: Element, apply: (locale: Locale) => void): void {
  let picker: HTMLSelectElement | undefined;
  if (window.parent === window) {
    picker = document.createElement('select');
    picker.setAttribute('aria-label', 'Language / Langue');
    picker.dataset.workshopLocale = '';
    for (const [locale, label] of [['fr', 'Français'], ['en', 'English'], ['zh', '简体中文'], ['es', 'Español'], ['pt', 'Português']]) picker.add(new Option(label, locale));
    picker.value = savedLocale();
    picker.addEventListener('change', () => {
      const locale = resolveLocale(picker!.value);
      try { localStorage.setItem(LOCALE_KEY, locale); } catch { /* Storage can be unavailable. */ }
      apply(locale);
      window.dispatchEvent(new Event('magna-locale-change'));
    });
    parent.append(picker);
  }
  window.addEventListener('storage', event => {
    if (event.key !== LOCALE_KEY) return;
    const locale = savedLocale();
    if (picker) picker.value = locale;
    apply(locale);
  });
  apply(savedLocale());
}

// Ordered by the data-shell-i18n markers in rustbench.html.
const text: Record<Locale, readonly string[]> = {
  fr: ['ATELIERS RUST', 'Ville', 'Maisons', 'LE LABORATOIRE CARTOGRAPHIQUE', 'Du relief à la maison.', 'Un parcours par étapes : conserve un terrain, développe ses villes, puis ouvre une ville dans l’atelier Ville.', '01 / PAYSAGE', 'Étapes 1, 2 et 3 : relief, côtes et eau. Transmets toute la carte ou une portion aux settlements.', 'Terrain conservé et partage .decor', '02 / IMPLANTATIONS', 'Charge un terrain prégénéré ou conservé, place les villes, trace les routes et génère les quartiers et l’occupation du territoire. Les parcelles sont optionnelles.', 'Ouvre une ville dans l’atelier Ville', '02 bis / VILLE', 'Ville', 'Une ville avec toutes ses options : celle envoyée par Settlements, ou une des 30 cartes prégénérées (15 environnements × 2 tailles). Routes, emprise, rues, îlots, parcelles et volumes bâtis ; renvoie la ville aux settlements.', 'Explorer et déboguer la génération', '04 / ARCHITECTURE', 'Maisons', 'Parcours les traditions architecturales ou l’atelier libre. Examine les toitures, les niveaux et les accès.', 'Atlas et atelier libre', 'Chaque atelier garde sa carte, ses réglages et ses brouillons quand tu y reviens, même après rechargement de cet onglet. Les exports restent conservés dans ce navigateur ; partage le fichier .decor pour les ouvrir sur une autre machine.'],
  en: ['RUST WORKSHOPS', 'City', 'Houses', 'THE MAPMAKING LAB', 'From terrain to houses.', 'Keep a terrain, develop its settlements, then open a city in the City workshop.', '01 / LANDSCAPE', 'Stages 1, 2 and 3: terrain, coasts and water. Send the whole map or a portion to Settlements.', 'Retained terrain and .decor sharing', '02 / SETTLEMENTS', 'Load a pre-generated or retained terrain, place settlements, draw roads and generate neighborhoods and land use. Parcels are optional.', 'Open a city in the City workshop', '02b / CITY', 'City', 'Explore a city with all its options: one sent by Settlements or one of 30 pre-generated maps (15 environments × 2 sizes). Generate roads, footprint, streets, blocks, parcels and buildings; send the city back to Settlements.', 'Explore and debug generation', '04 / ARCHITECTURE', 'Houses', 'Browse architectural traditions or the free workshop. Examine roofs, floors and access.', 'Atlas and free workshop', 'Each workshop retains its map, settings and drafts when you return, even after reloading this tab. Exports remain in this browser; share the .decor file to open them on another machine.'],
  zh: ['RUST 工作坊', '城市', '房屋', '地图制作实验室', '从地形到房屋。', '分步操作：保留地形，发展聚落，然后在城市工作坊中打开城市。', '01 / 景观', '阶段 1、2 和 3：地形、海岸与水系。将整张地图或其中一部分传递给聚落工作坊。', '保留地形并共享 .decor', '02 / 聚落', '加载预生成或保留的地形，放置聚落、规划道路，并生成街区和土地利用。地块可选。', '在城市工作坊中打开城市', '02b / 城市', '城市', '探索城市的所有选项：使用聚落工作坊传来的城市，或 30 张预生成地图之一（15 种环境 × 2 种尺寸）。生成道路、城市范围、街道、街区、地块和建筑，并将城市传回聚落工作坊。', '探索和调试生成过程', '04 / 建筑', '房屋', '浏览建筑传统或自由工作坊，查看屋顶、楼层和出入口。', '图集与自由工作坊', '返回工作坊时，地图、设置和草稿都会保留，即使重新加载此标签页也是如此。导出内容保存在此浏览器中；请分享 .decor 文件，以便在另一台设备上打开。'],
  es: ['TALLERES RUST', 'Ciudad', 'Casas', 'EL LABORATORIO CARTOGRÁFICO', 'Del relieve a la casa.', 'Conserva un terreno, desarrolla sus asentamientos y abre una ciudad en el taller Ciudad.', '01 / PAISAJE', 'Etapas 1, 2 y 3: relieve, costas y agua. Envía el mapa completo o una parte a Asentamientos.', 'Terreno conservado y archivo .decor compartido', '02 / ASENTAMIENTOS', 'Carga un terreno pregenerado o conservado, sitúa asentamientos, traza caminos y genera barrios y usos del suelo. Las parcelas son opcionales.', 'Abre una ciudad en el taller Ciudad', '02 bis / CIUDAD', 'Ciudad', 'Explora una ciudad con todas sus opciones: la enviada desde Asentamientos o uno de los 30 mapas pregenerados (15 entornos × 2 tamaños). Genera caminos, perímetro, calles, manzanas, parcelas y edificios; devuelve la ciudad a Asentamientos.', 'Explorar y depurar la generación', '04 / ARQUITECTURA', 'Casas', 'Recorre las tradiciones arquitectónicas o el taller libre. Examina cubiertas, plantas y accesos.', 'Atlas y taller libre', 'Cada taller conserva su mapa, ajustes y borradores al volver, incluso después de recargar esta pestaña. Las exportaciones permanecen en este navegador; comparte el archivo .decor para abrirlas en otro equipo.'],
  pt: ['ATELIÊS RUST', 'Cidade', 'Casas', 'O LABORATÓRIO CARTOGRÁFICO', 'Do relevo à casa.', 'Guarde um terreno, desenvolva seus povoados e abra uma cidade no ateliê Cidade.', '01 / PAISAGEM', 'Etapas 1, 2 e 3: relevo, costas e água. Envie o mapa inteiro ou uma parte aos Povoamentos.', 'Terreno guardado e compartilhamento .decor', '02 / POVOAMENTOS', 'Carregue um terreno pré-gerado ou guardado, posicione povoados, trace estradas e gere bairros e uso do solo. As parcelas são opcionais.', 'Abra uma cidade no ateliê Cidade', '02b / CIDADE', 'Cidade', 'Explore uma cidade com todas as opções: a enviada por Povoamentos ou um dos 30 mapas pré-gerados (15 ambientes × 2 tamanhos). Gere estradas, perímetro, ruas, quadras, parcelas e edifícios; devolva a cidade a Povoamentos.', 'Explorar e depurar a geração', '04 / ARQUITETURA', 'Casas', 'Explore as tradições arquitetônicas ou o ateliê livre. Examine telhados, pavimentos e acessos.', 'Atlas e ateliê livre', 'Cada ateliê guarda seu mapa, configurações e rascunhos ao retornar, mesmo após recarregar esta aba. As exportações permanecem neste navegador; compartilhe o arquivo .decor para abri-las em outro computador.'],
};

const shellLabels = {
  fr: { home: 'Ateliers Rust', city: 'Ville', houses: 'Maisons', workshop: 'Atelier', copy: 'Copier code', copyTitle: 'Copier le code unique de la carte affichée', open: 'Ouvrir ↗', openTitle: 'Ouvrir le banc seul dans un nouvel onglet', nav: 'Bancs de génération', homeLabel: 'Magna Urbis — accueil des ateliers' },
  en: { home: 'Rust workshops', city: 'City', houses: 'Houses', workshop: 'Workshop', copy: 'Copy code', copyTitle: 'Copy the unique code of the displayed map', open: 'Open ↗', openTitle: 'Open this workshop in a new tab', nav: 'Generation workshops', homeLabel: 'Magna Urbis — workshops home' },
  zh: { home: 'Rust 工作坊', city: '城市', houses: '房屋', workshop: '工作坊', copy: '复制代码', copyTitle: '复制当前地图的唯一代码', open: '打开 ↗', openTitle: '在新标签页中打开此工作坊', nav: '生成工作坊', homeLabel: 'Magna Urbis — 工作坊首页' },
  es: { home: 'Talleres Rust', city: 'Ciudad', houses: 'Casas', workshop: 'Taller', copy: 'Copiar código', copyTitle: 'Copiar el código único del mapa mostrado', open: 'Abrir ↗', openTitle: 'Abrir este taller en una pestaña nueva', nav: 'Talleres de generación', homeLabel: 'Magna Urbis — inicio de talleres' },
  pt: { home: 'Ateliês Rust', city: 'Cidade', houses: 'Casas', workshop: 'Ateliê', copy: 'Copiar código', copyTitle: 'Copiar o código único do mapa exibido', open: 'Abrir ↗', openTitle: 'Abrir este ateliê em uma nova aba', nav: 'Ateliês de geração', homeLabel: 'Magna Urbis — início dos ateliês' },
} satisfies Record<Locale, Record<string, string>>;
export type ShellLabel = keyof typeof shellLabels.fr;
let currentLocale: Locale | undefined;
export function shellLabel(key: ShellLabel): string { return shellLabels[currentLocale ?? savedLocale()][key]; }

export function setupShellLocale(): void {
  const select = document.querySelector<HTMLSelectElement>('#shell-language');
  const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-shell-i18n]'));
  if (!select) return;
  function apply(locale: Locale): void {
    currentLocale = locale;
    document.documentElement.lang = locale === 'zh' ? 'zh-Hans' : locale;
    select!.value = locale;
    elements.forEach((element, index) => {
      // Footers contain an aria-hidden arrow; keep it in the DOM.
      if (element.classList.contains('card-footer')) element.firstChild!.textContent = text[locale][index] + ' ';
      else element.textContent = text[locale][index];
    });
    const labels = shellLabels[locale];
    const share = document.querySelector<HTMLElement>('#share');
    const standalone = document.querySelector<HTMLElement>('#standalone');
    if (share) { share.textContent = labels.copy; share.title = labels.copyTitle; }
    if (standalone) { standalone.textContent = labels.open; standalone.title = labels.openTitle; }
    document.querySelector('nav')?.setAttribute('aria-label', labels.nav);
    document.querySelector('.wordmark')?.setAttribute('aria-label', labels.homeLabel);
    window.dispatchEvent(new Event('magna-locale-change'));
  }
  apply(savedLocale());
  select.addEventListener('change', () => {
    const locale = resolveLocale(select.value);
    try { localStorage.setItem(LOCALE_KEY, locale); } catch { /* Private browsing may disable storage. */ }
    apply(locale);
  });
}
