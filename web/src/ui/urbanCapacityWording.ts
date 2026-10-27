import { urbanText } from './urbanPanelLocale';

/** Display-only qualification of the exact historical parcel-allocation
 * warning. Original archives and every numeric string remain unchanged. */
export function urbanCapacityWarningText(value: string): string {
  const match = /^Capacité : (.*) — ([0-9]+) % des ménages logés\.$/u.exec(value);
  if (!match) return value;
  const steps = match[1].replace('les îlots réels logent moins que la prévision du tissu', urbanText([
    'l’estimation parcellaire sur les îlots réels est inférieure à la prévision du tissu','the parcel estimate on actual blocks is below the fabric forecast','实际街区的地块估算低于街区结构预测','la estimación parcelaria de las manzanas reales es inferior a la previsión del tejido','a estimativa de lotes nas quadras reais é inferior à previsão do tecido',
  ]));
  return urbanText([
    `Capacité parcellaire estimée après affectation (ancien rapport) : ${steps} — ${match[2]} % du besoin en ménages couvert selon le modèle. Capacité habitante non évaluée.`,
    `Estimated parcel capacity after allocation (legacy report): ${steps} — ${match[2]}% of household need covered by the model. Housing capacity not assessed.`,
    `分配后的估计地块容量（旧报告）：${steps} — 模型覆盖 ${match[2]}% 的家庭需求。居住容量未评估。`,
    `Capacidad parcelaria estimada tras la asignación (informe antiguo): ${steps} — el modelo cubre el ${match[2]} % de la necesidad de hogares. Capacidad residencial no evaluada.`,
    `Capacidade estimada dos lotes após a alocação (relatório anterior): ${steps} — o modelo cobre ${match[2]}% da necessidade de domicílios. Capacidade residencial não avaliada.`,
  ]);
}
export const PARCEL_CAPACITY_SCOPE = 'Les valeurs parcellaires décrivent le modèle d’affectation ; elles ne prouvent pas des ménages logés.';
export const urbanCapacityScopeText = (): string => urbanText([PARCEL_CAPACITY_SCOPE,'Parcel values describe the allocation model; they do not prove that households are housed.','地块数值描述分配模型；不能证明家庭已获得住房。','Los valores parcelarios describen el modelo de asignación; no prueban que haya hogares alojados.','Os valores dos lotes descrevem o modelo de alocação; não comprovam que domicílios estejam alojados.']);
