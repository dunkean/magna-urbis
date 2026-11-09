import type { UrbanEngine, UrbanRequest, UrbanResponse } from '../../../rust/bridge/urban';

/** A clipped activity yard may contain its bodies but lose the programme's access envelope.
 * Continue the site's bounded placement search when the native plan cannot reserve the activity.
 * Re-run quarters so the native retained source and the displayed plan always describe the same yard. */
export async function runActivityPlacement(engine: UrbanEngine, request: UrbanRequest, current = () => true): Promise<UrbanResponse> {
  let response = await engine.run(request);
  if (request.kind !== 'quarters' || request.layoutConfig?.programme.intent !== 'activity' || request.sites?.length !== 1) return response;
  const site = request.sites[0];
  const refused = (): boolean => !response.error && !!response.layouts?.some(layout => {
    const programme = layout.programme;
    return programme?.demands.some(d => d.role === 'craft.activity' && d.deficit > 0
      && !programme.reservations.some(r => r.demandId === d.id));
  });
  for (let k = 0; k < 32 && current() && refused(); k++) {
    const radius = [70, 120, 180, 260][Math.floor(k / 8)], angle = k % 8 * Math.PI / 4;
    response = await engine.run({ ...request, raster: undefined, sites: [{ ...site,
      center: { x: site.center.x + radius * Math.cos(angle), y: site.center.y + radius * Math.sin(angle) } }] });
  }
  return response;
}
