import { classOfPop } from '../gen/options';
import type { SettlementClass, SettlementSpec } from '../gen/options';
import { DEMOGRAPHIC_CLASSES } from '../../../rust/bridge/settlementDemography';
import { urbanText } from './urbanPanelLocale';

/** Population shortcuts; never a morphology selector or a second class enum. */
export const SETTLEMENT_KINDS: readonly { kind: SettlementClass; label: string; population: number }[] =
  DEMOGRAPHIC_CLASSES.map(c => ({ kind: c.id, label: c.label, population: c.shortcut }));
const names: Record<SettlementClass, readonly [string,string,string,string,string]> = {
  farmstead:['Ferme','Farmstead','农庄','Granja','Fazenda'], hamlet:['Hameau','Hamlet','小村','Caserío','Povoado'], village:['Village','Village','村庄','Aldea','Vila'], town:['Bourg','Town','集镇','Pueblo','Vila urbana'], city:['Ville','City','城市','Ciudad','Cidade'], metropolis:['Métropole','Metropolis','大都市','Metrópoli','Metrópole'], megacity:['Mégapole','Megacity','特大城市','Megaciudad','Megacidade'],
};
export function localizedDemographicLabel(population: number): string { return urbanText(names[classOfPop(population)]); }
/** A map limit can intersect a class below its usual shortcut (100k/250k).
 * Keep that class selectable and fill a population within the map's limit. */
export function settlementPopulationChoices(maximum = Infinity): { kind: SettlementClass; label: string; population: number }[] {
  return DEMOGRAPHIC_CLASSES.filter(c => c.minimum <= maximum).map(c => ({
    kind: c.id, population: Math.min(c.shortcut, maximum),
    label: `${urbanText(names[c.id])} · ${urbanText(['raccourci','shortcut','快捷值','valor rápido','atalho'])} ${Math.min(c.shortcut, maximum).toLocaleString()} ${urbanText(['hab.','inhabitants','名居民','hab.','hab.'])}`,
  }));
}
export function withSettlementKind(spec: SettlementSpec, kind: SettlementClass): SettlementSpec {
  if (classOfPop(spec.population) === kind) return spec;
  const choice = SETTLEMENT_KINDS.find(entry => entry.kind === kind);
  return choice ? { ...spec, population: choice.population } : spec;
}
