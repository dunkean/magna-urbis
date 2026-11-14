import type { ActivityInstallation, ActivitySite, RoadSite, SettlementOutput } from './settlements';

/** Access line of a remote place (Rust `remote::access_line`): its open installation ending at its access point. */
export const accessLineOf = (a: ActivitySite): ActivityInstallation | undefined =>
  a.kind === 'remote' ? a.installations?.find(g => !g.closed && g.points.length >= 2 && g.points[g.points.length - 1].x === a.access.x && g.points[g.points.length - 1].y === a.access.y) : undefined;

/**
 * Road endpoints of a placement (Rust `Output::road_sites`): settlements, then activity access points.
 * A remote place carries its access line (`approach`), which the router cuts at the first road it meets.
 * The one copy of this rule: the engine, the bridge and the V2 region all import it.
 */
export function roadSitesOf(output: SettlementOutput): RoadSite[] {
  return [...output.settlements.map(s => ({ key: s.key, population: s.population, culture: s.culture, center: s.center, radius: s.radius })),
    ...(output.activities ?? []).flatMap(a => {
      if (a.accessClass === 'none') return [];
      const line = accessLineOf(a);
      return [{ key: a.id, population: 0, culture: a.culture, center: a.access, radius: 0, access: a.accessClass, parent: a.parent, ...(line ? { approach: line.points } : {}) }];
    })];
}
