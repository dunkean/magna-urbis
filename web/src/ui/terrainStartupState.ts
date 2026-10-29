import type { TerrainSource } from '../../../rust/bridge/terrain';
import type { Locale } from './shellLocale';

/** Resolve the source before the renderer, assets and engine are imported. */
export function initialTerrainSource(params: URLSearchParams, neuralDefault: string): TerrainSource {
  const requested = params.get('source');
  if (requested === 'neural' && !params.has('neural')) return 'neural-python';
  if (requested === 'procedural' || requested === 'procedural-phasor' || requested === 'neural' || requested === 'neural-wasm' || requested === 'neural-python') return requested;
  // Older saved procedural URLs omitted source; reloading under another profile
  // must not turn those maps into the default neural generator.
  if (!requested && (params.has('procedural') || params.get('engine') === 'rust' && params.has('v'))) return 'procedural';
  return neuralDefault === 'neural-python' ? 'neural-python' : 'neural-wasm';
}

export interface NeuralServiceState { state: string; message: string; loaded?: boolean }
const messages = {
  unavailable: {fr:'Service neuronal indisponible',en:'Neural service unavailable',zh:'神经服务不可用',es:'Servicio neuronal no disponible',pt:'Serviço neural indisponível'},
  loadingModels: {fr:'Chargement des modèles sur le GPU…',en:'Loading models onto the GPU…',zh:'正在将模型加载到 GPU…',es:'Cargando modelos en la GPU…',pt:'Carregando modelos na GPU…'},
  computing: {fr:'Modèles chargés · calcul sur le GPU…',en:'Models loaded · computing on GPU…',zh:'模型已加载 · GPU 计算中…',es:'Modelos cargados · cálculo en GPU…',pt:'Modelos carregados · calculando na GPU…'},
  readyGpu: {fr:'Modèles chargés · GPU prêt',en:'Models loaded · GPU ready',zh:'模型已加载 · GPU 就绪',es:'Modelos cargados · GPU lista',pt:'Modelos carregados · GPU pronta'},
  serviceReady: {fr:'Service prêt · modèles chargés au premier calcul',en:'Service ready · models load on first computation',zh:'服务就绪 · 首次计算时加载模型',es:'Servicio listo · los modelos se cargan en el primer cálculo',pt:'Serviço pronto · modelos carregados no primeiro cálculo'},
  interface: {fr:'Chargement de l’atelier',en:'Loading workshop',zh:'正在加载工作坊',es:'Cargando taller',pt:'Carregando ateliê'},
  generation: {fr:'Génération du terrain',en:'Generating terrain',zh:'正在生成地形',es:'Generando terreno',pt:'Gerando terreno'},
  rendering: {fr:'Préparation de la vue',en:'Preparing view',zh:'正在准备视图',es:'Preparando vista',pt:'Preparando visualização'},
  ready: {fr:'Terrain prêt',en:'Terrain ready',zh:'地形就绪',es:'Terreno listo',pt:'Terreno pronto'},
  error: {fr:'Chargement interrompu',en:'Loading interrupted',zh:'加载中断',es:'Carga interrumpida',pt:'Carregamento interrompido'},
  interfaceHint: {fr:'Chargement de l’interface et du moteur. La méthode choisie est déjà affichée.',en:'Loading the interface and engine. The selected method is already shown.',zh:'正在加载界面和引擎。所选方法已显示。',es:'Cargando la interfaz y el motor. El método seleccionado ya se muestra.',pt:'Carregando a interface e o motor. O método escolhido já é exibido.'},
  browserReady: {fr:'Modèles chargés · GPU du navigateur prêt',en:'Models loaded · browser GPU ready',zh:'模型已加载 · 浏览器 GPU 就绪',es:'Modelos cargados · GPU del navegador lista',pt:'Modelos carregados · GPU do navegador pronta'},
  browserWaiting: {fr:'Modèles navigateur · chargement au premier calcul',en:'Browser models · loading on first computation',zh:'浏览器模型 · 首次计算时加载',es:'Modelos del navegador · carga en el primer cálculo',pt:'Modelos do navegador · carregamento no primeiro cálculo'},
  checkCuda: {fr:'Service neuronal indisponible · vérifier Python/CUDA',en:'Neural service unavailable · check Python/CUDA',zh:'神经服务不可用 · 请检查 Python/CUDA',es:'Servicio neuronal no disponible · comprueba Python/CUDA',pt:'Serviço neural indisponível · verifique Python/CUDA'},
  loadFailed: {fr:'Impossible de charger l’atelier. Rechargez la fenêtre.',en:'Unable to load the workshop. Reload the window.',zh:'无法加载工作坊。请重新加载窗口。',es:'No se pudo cargar el taller. Recarga la ventana.',pt:'Não foi possível carregar o ateliê. Recarregue a janela.'},
  elapsed: {fr:'s écoulées',en:'s elapsed',zh:'秒已过',es:'s transcurridos',pt:'s decorridos'},
  noProgress: {fr:'étape en cours, sans nouveau message',en:'stage in progress, no new message',zh:'阶段进行中，暂无新消息',es:'etapa en curso, sin mensajes nuevos',pt:'etapa em andamento, sem nova mensagem'},
} satisfies Record<string, Record<Locale, string>>;
export type TerrainStartupMessage = keyof typeof messages;
export function terrainStartupText(key: TerrainStartupMessage, locale: Locale): string { return messages[key][locale]; }
export function neuralModelLabel(status: NeuralServiceState, locale: Locale = 'fr'): string {
  const t = (key: TerrainStartupMessage): string => terrainStartupText(key, locale);
  if (status.state === 'error') return `${t('unavailable')} · ${status.message}`;
  if (status.state === 'loading') return t('loadingModels');
  if (status.loaded) return t(status.state === 'generating' ? 'computing' : 'readyGpu');
  return status.state === 'ready' ? t('serviceReady') : status.message;
}
