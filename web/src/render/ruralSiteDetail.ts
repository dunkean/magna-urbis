import type { SiteBuilding } from './siteArchitecture';
import { roleFamily } from './cityRoles';
import { hash } from './city3d/massing';
import { orientedBox, ringArea } from './city3d/roofGeometry';
import { buildHouseFront } from './houseFrontKit';
import { ruralWorkFrame } from './houseFronts';
import { drawRuralEquipment } from './ruralEquipment';
import { partTrade, ruralTrade } from './ruralTrades';
import { drawRuralInstallation, hasRuralInstallation, replaceRuralInstallation } from './ruralInstallations';
import type { OverviewVolume } from './urbanBuildingGeometry';

const barePart = /(?:^|-)(?:wall|ramp|porch|stair|steps|terrace|kerb|tail|chute|stack|ruin|rubble|plinth|apse|passage|court|gatepost)(?:-|$)/;
/** Older compound previews retained the occupation but omitted physical part names.
 * Only recognise the distinctive silhouettes within the matching kind of works. */
function legacyWorkForm(template: string | undefined, use: string, volumes: OverviewVolume[]) {
  const v = volumes[0];
  if (!template || !v) return use;
  const round = (v.footprint[0]?.outer.length ?? 0) >= 8;
  if (template === 'stone_quarry') {
    if (round && volumes.length > 1) return 'quarry-crane';
    if (volumes.every(v => v.role === 'minor')) return 'stone-stack';
  }
  if (template === 'hardrock_mine') {
    if (v.displayRoofForm === 'pyramid' && v.wall_height_m > 7) return 'headframe';
    if (volumes.every(v => v.role === 'minor')) return 'washing-floor';
    if (round && v.displayRoofForm === 'cone') return 'gin-house';
  }
  if (template === 'river_watermill' && v.displayRoofForm === 'flat' && v.wall_height_m >= 3.8) {
    const box = orientedBox(v.footprint[0].outer);
    if (box && box.half > 1.7 * box.halfWidth) return 'mill-wheel';
  }
  if (template === 'pottery_cluster') {
    if (round && v.displayRoofForm === 'dome') return 'round-kiln';
    if (ruralTrade(use) === 'kiln' || ruralTrade(use) === 'pottery') return 'shop-body';
  }
  return use;
}
type Work = NonNullable<ReturnType<typeof makeDetail>>;
const cache = new WeakMap<SiteBuilding, Map<OverviewVolume, Work> | undefined>();
export function ruralSiteDetails(b: SiteBuilding) {
  if (cache.has(b)) return cache.get(b);
  const programme = b.programme as (SiteBuilding['programme'] & { activity?: { template?: string; archetypes?: string[]; forms?: string[] }; farmstead?: { outbuildings?: string[] } }) | undefined;
  const activity = programme?.activity;
  const groups = activity?.archetypes;
  const outbuildings = programme?.farmstead?.outbuildings;
  const kind = programme?.archetype ?? '';
  const named = /^(isolated-|roadside-temple$)/.test(kind) ? kind : programme?.role === 'craft.mill' ? (ruralTrade(kind) ? kind : 'mill') : '';
  const part = b.sitePart ?? (named ? { use: named, form: named } : undefined);
  let works: Map<OverviewVolume, Work> | undefined;
  const add = (work: Work | undefined, pieces: OverviewVolume[]) => {
    if (!work) return;
    works ??= new Map();
    for (const v of work.replace ? pieces : [work.volume]) works.set(v, work);
  };
  if (!b.sitePart && (groups?.length || outbuildings?.length)) {
    const byPiece = new Map<number, OverviewVolume[]>();
    for (const v of b.volumes as OverviewVolume[]) {
      if (v.ruralPiece === undefined) continue;
      const list = byPiece.get(v.ruralPiece) ?? [];
      list.push(v);
      byPiece.set(v.ruralPiece, list);
    }
    const start = b.footprint.length - (outbuildings?.length ?? 0);
    for (const [i, volumes] of byPiece) {
      const use = groups?.[i] ?? (i >= start ? outbuildings?.[i - start] : 'house');
      if (!use) continue;
      const form = activity?.forms?.[i] ?? legacyWorkForm(activity?.template, use, volumes);
      add(makeDetail(b, { use, form }, volumes), volumes);
    }
  } else if (part) add(makeDetail(b, part, b.volumes as OverviewVolume[]), b.volumes as OverviewVolume[]);
  cache.set(b, works);
  return works;
}
function makeDetail(b: SiteBuilding, part: NonNullable<SiteBuilding['sitePart']>, volumes: OverviewVolume[]) {
  const form = part.form.replaceAll('_', '-');
  const object = hasRuralInstallation(form);
  if ((part.installation && !object) || (!object && barePart.test(form))) return;
  const trade = partTrade(part.use, form);
  if (!object && !trade) return;
  const hosts = volumes.filter(v => v.footprint[0]?.outer.length >= 3 && (object || v.role !== 'minor')).sort((a, c) => Math.abs(ringArea(c.footprint[0].outer)) - Math.abs(ringArea(a.footprint[0].outer)));
  const family = roleFamily(b.culture?.culture),
    seed = hash(b.id) >>> 0;
  for (const volume of hosts) {
    const ring = volume.footprint[0].outer;
    const kit = { seed, wall: volume.materials.coating, cover: volume.materials.cladding, floor: 0 };
    if (object) {
      const size = orientedBox(ring);
      if (!size || size.halfWidth <= 0) continue;
      const nx = -size.axis.y,
        ny = size.axis.x;
      const z = Math.min(...volumes.map(v => v.z_m));
      const frame = { x: size.center.x - size.halfWidth * nx, y: size.center.y - size.halfWidth * ny, z, nx, ny };
      const h = Math.max(0.12, ...volumes.map(v => v.z_m + v.wall_height_m + v.roof_height_m - z));
      const mesh = buildHouseFront(frame, { ...kit, width: size.half * 2, depth: size.halfWidth * 2, height: h }, g => drawRuralInstallation(g, form, family));
      return { mesh, volume, replace: replaceRuralInstallation(form) };
    }
    const frame = ruralWorkFrame(b, volume);
    if (!frame) continue;
    const tall = trade === 'hoist' || trade === 'crane' || trade === 'adit';
    const height = Math.min(tall ? 4.4 : 2.2, Math.max(0.85, frame.width * (tall ? 1.05 : 0.65)));
    const mesh = buildHouseFront(frame, { ...kit, width: frame.width, depth: frame.depth, height }, g => {
      // A stone footing with a projecting course, a raised timber sill with cross
      // ties, or a solid apron. The local equipment stands on the top.
      const familyStone = /classical|ancient|andean|mesoamerican|islamic|indian/.test(family ?? '');
      const timber = /japanese|chinese|norse|clan|insular|native|steppe/.test(family ?? '');
      const w = g.width * 0.5,
        d = g.depth;
      if (familyStone) {
        g.box(-w, w, 0, d, -0.14, -0.05, g.wall);
        g.box(-w * 0.94, w * 0.94, d * 0.035, d * 0.965, -0.05, 0, g.wall);
      } else if (timber) {
        for (const x of [-w * 0.71, 0, w * 0.71]) g.box(x - 0.055, x + 0.055, 0.035, d - 0.035, -0.17, -0.065, 'city3d:detail:joist@69533f');
        for (const y of [0.2, 0.78]) g.box(-w, w, y * d - 0.065, y * d + 0.065, -0.07, 0, 'city3d:detail:sill@897152');
      } else g.box(-w, w, 0, d, -0.12, 0, g.wall);
      drawRuralEquipment(g, trade!, family);
    });
    return { mesh, volume, replace: false };
  }
}
