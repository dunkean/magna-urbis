import { classOfPop } from '../gen/options';
import type { SettlementClass, SettlementSpec } from '../gen/options';
import { DEMOGRAPHIC_CLASSES } from '../../../rust/bridge/settlementDemography';

/** Population shortcuts; never a morphology selector or a second class enum. */
export const SETTLEMENT_KINDS: readonly { kind: SettlementClass; label: string; population: number }[] =
  DEMOGRAPHIC_CLASSES.map(c => ({ kind: c.id, label: c.label, population: c.shortcut }));
/** A map limit can intersect a class below its usual shortcut (100k/250k).
 * Keep that class selectable and fill a population within the map's limit. */
export function settlementPopulationChoices(maximum = Infinity): { kind: SettlementClass; label: string; population: number }[] {
  return DEMOGRAPHIC_CLASSES.filter(c => c.minimum <= maximum).map(c => ({
    kind: c.id, population: Math.min(c.shortcut, maximum),
    label: `${c.labelFr} · raccourci ${Math.min(c.shortcut, maximum).toLocaleString('fr-FR')} hab.`,
  }));
}
export function withSettlementKind(spec: SettlementSpec, kind: SettlementClass): SettlementSpec {
  if (classOfPop(spec.population) === kind) return spec;
  const choice = SETTLEMENT_KINDS.find(entry => entry.kind === kind);
  return choice ? { ...spec, population: choice.population } : spec;
}
