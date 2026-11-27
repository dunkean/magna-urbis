import type { PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import { hasRuralInstallation } from './ruralInstallations';
import { partTrade } from './ruralTrades';
import { roleFamily as serviceFamily } from './cityRoles';
import { roleFamily } from './city/planLook';
import type { FrontDesign, HouseFront } from './houseFrontKit';

/** The engine can split a single rural monument into a nave, belfry, boundary walls, etc. */
export interface SitePart {
  use: string;
  form: string;
  installation?: boolean;
  passage?: boolean;
}
export type SiteUse = 'home' | 'workshop' | 'stores' | 'birds' | 'gate' | 'sanctuary' | 'hall' | 'marker';
export type SiteBuilding = PlacedBuilding & { sitePart?: SitePart; programme?: { role?: string | null; archetype?: string | null; landmark?: boolean | null; fungalFarm?: boolean } };

function ruralUse(part: SitePart): SiteUse | undefined {
  const form = part.form.replaceAll('_', '-'),
    use = part.use.replaceAll('_', '-');
  if (form === 'silo') return; // The bin has a discharge gate in place of a human-scale loading bay.
  if (/(?:^|-)(?:ruin|rubble)(?:$|-)/.test(form)) return;
  if (part.installation || hasRuralInstallation(form) || /(?:^|-)(?:wall|mound|kerb|cairn|grove|hayrick|wellhead|well|standing-stone|menhir|dolmen|altar|court|terrace|step|plinth)(?:$|-)/.test(form)) return;
  if (/column|obelisk|stele|wayside-cross|calvary-cross/.test(form)) return 'marker';
  if (part.passage || /gatehouse|watch-tower|beacon-tower|keep/.test(form)) return 'gate';
  if (/pigeon|dovecote/.test(use)) return 'birds';
  const trade = partTrade(use, form);
  if (trade === 'lodging' && /dwelling|hut|cell/.test(form)) return 'home';
  // Small human entrances take the same fitted cultural joinery as town craft halls.
  // The wide cart doors of barns and warehouses retain their clear loading bay.
  if (trade && !['lodging', 'grain', 'store', 'birds', 'trough', 'guard', 'shrine', 'memorial'].includes(trade)) return 'workshop';
  if (/barn|byre|stable|store|granary|shed|workshop|mill|kiln|smithy|cook-house|bakehouse|dryer|cultivation/.test(form)) return 'stores';
  if (/oratory|chapel|nave|shrine|sanctuary|prayer-hall|temple|aedicula|marabout/.test(form)) return 'sanctuary';
  if (/dovecote|pigeon-tower/.test(form)) return 'birds';
  if (/watchtower|outpost|guardpost|gatehouse|signal-tower|^tower$|farm-tower/.test(use)) return 'gate';
  if (/shrine|temple|monastery|sanctuary|chapel|hermitage|oratory|prayer-hall|buddhist-hall|hof-hall/.test(use)) return 'sanctuary';
  if (/granary|barn|shed|byre|store|mill|stable|workshop|kiln|smithy|bakehouse/.test(use)) return 'stores';
  if (/house|hut|dwelling|cottage|ger$|yurt|lodge|shelter|tent|cabin/.test(use)) return 'home';
  if (/hall|pavilion|domed|inn|guest|baths/.test(form + ' ' + use)) return 'hall';
  if (/monument|marker|memorial/.test(form)) return 'marker';
  if (trade === 'memorial') return 'marker';
  if (trade === 'lodging') return 'hall';
  if (trade === 'guard') return 'gate';
  if (trade === 'shrine') return 'sanctuary';
  if (trade) return 'stores';
}

export function architectureUse(b: SiteBuilding): SiteUse | undefined {
  if (b.sitePart) return ruralUse(b.sitePart);
  const role = b.programme?.role ?? '',
    family = roleFamily(role, b.function);
  if (/ruin|abandoned/.test(role) || /cemetery|graveyard|pyre/.test(role)) return;
  if (family === 'defence') return 'gate';
  if (family === 'worship') return 'sanctuary';
  if (/granary|warehouse|barn|mill/.test(role)) return 'stores';
  if ((family === 'civic' && role) || (b.programme?.landmark && family !== 'garden')) return 'hall';
  if (family === 'dwelling' && (b.function === 'domestic' || b.function === 'mixed')) return 'home';
}

const timber = 'city3d:detail:hewn-timber@79624c',
  iron = 'city3d:detail:ironwork@525654';

function loadingBay(g: HouseFront, family?: string) {
  const half = g.width / 2,
    edge = half * 0.91,
    depth = g.depth * 0.91;
  const h = Math.min(g.height - 0.08, (g.doorHeight ?? Math.min(2, g.height * 0.65)) + 0.5);
  const headroom = Math.min(h, ...(g.windows ?? []).filter(w => w.bottom > (g.doorHeight ?? 1.85)).map(w => w.bottom - 0.08));
  if (headroom < (g.doorHeight ?? 1.1) + 0.12 || edge < (g.doorWidth ?? 0.85) / 2 + 0.11) return;
  const steel = ['modernist', 'contemporary', 'industrial', 'futuristic'].includes(family ?? '');
  const masonry = ['classical', 'islamic', 'ancient', 'andean'].includes(family ?? '');
  const eastAsian = family === 'japanese' || family === 'chinese';
  const frame = steel ? iron : timber;
  const drop = Math.min(0.32, headroom - (g.doorHeight ?? 1.1) - 0.1);
  for (const sign of [-1, 1]) {
    const x = sign * edge;
    const y = depth - 0.12,
      z = headroom - drop;
    const radius = Math.min(masonry ? 0.14 : 0.085, (edge - (g.doorWidth ?? 0.85) / 2) * 0.8);
    g.post(x, y, -g.floor, z, radius, masonry ? g.wall : frame, masonry ? 8 : 4);
    if (masonry) {
      g.box(x - radius * 1.2, x + radius * 1.2, y - radius * 1.2, y + radius * 1.2, z - 0.16, z, g.wall);
    } else if (eastAsian) {
      for (const [level, reach] of [
        [0.19, 0.15],
        [0.1, 0.23],
      ])
        g.box(x - reach, x + reach, y - 0.085, y + 0.085, z - level, z - level + 0.085, frame);
    } else g.beam([x, depth - 0.1, headroom - drop - 0.36], [x, depth * 0.54, headroom - drop], 0.085, frame);
  }
  g.box(-edge, edge, depth - 0.16, depth, headroom - drop - 0.075, headroom - drop, frame);
  const pan = (x0: number, x1: number, z0: number, z1: number) => {
    g.face(
      [
        [x0, 0, z0],
        [x1, 0, z1],
        [x1, depth, z1 - drop],
        [x0, depth, z0 - drop],
      ],
      g.cover,
    );
    g.face(
      [
        [x0, depth, z0 - drop],
        [x1, depth, z1 - drop],
        [x1, depth, z1 - drop - 0.085],
        [x0, depth, z0 - drop - 0.085],
      ],
      frame,
    );
  };
  // Vented ridge or a continuous lean-to. The cover and grain come from the farm's own massing.
  const rise = Math.min(g.height - headroom, half * 0.28, 0.46);
  if (g.seed & 1 && rise > 0.1) {
    pan(-half, 0, headroom, headroom + rise);
    pan(0, half, headroom + rise, headroom);
  } else pan(-half, half, headroom, headroom);
  // A projecting hoist on the centreline, above the cart opening.
  if (g.height > headroom + 0.45 && g.seed & 2) {
    g.beam([0, 0, headroom + 0.4], [0, depth, headroom + 0.4], 0.13, frame);
    g.post(0, depth - 0.07, headroom + 0.12, headroom + 0.35, 0.026, iron);
  }
}

/** The passage remains open between the two cheeks. The head can be corbelled, braced or arched. */
function gate(g: HouseFront, culture: string) {
  const half = g.width / 2,
    throat = (g.doorWidth ?? Math.min(2.4, half * 1.1)) / 2 + 0.06;
  const shoulder = Math.min(half - throat, 0.52);
  const spring = (g.doorHeight ?? Math.min(3.6, g.height * 0.59)) + 0.04;
  const top = Math.min(g.height, ...(g.windows ?? []).filter(w => Math.abs(w.x) < throat + w.width / 2 && w.bottom >= spring).map(w => w.bottom - 0.05));
  if (shoulder < 0.08 || top < spring + 0.12) return;
  const family = serviceFamily(culture);
  const timberGate = ['japanese', 'chinese', 'steppe', 'native', 'norse', 'clan', 'insular'].includes(family ?? '');
  const deep = g.depth * (0.42 + 0.09 * (g.seed % 3)),
    wall = timberGate ? timber : g.wall;
  for (const sign of [-1, 1]) {
    const x = sign * (throat + shoulder / 2);
    g.box(x - shoulder / 2, x + shoulder / 2, 0.015, deep, -g.floor, spring, wall);
    g.box(x - shoulder * 0.53, x + shoulder * 0.53, 0.01, deep + 0.05, spring - 0.14, spring, wall);
  }
  if (timberGate) {
    g.box(-half, half, 0.015, deep + 0.08, spring, spring + 0.12, timber);
    for (const s of [-1, 1]) g.beam([s * (throat + shoulder * 0.5), deep, spring], [s * throat * 0.45, deep, Math.min(top, spring + 0.42)], 0.1, timber);
    g.box(-half, half, 0, deep + 0.09, Math.min(top - 0.08, spring + 0.42), Math.min(top, spring + 0.5), g.cover);
  } else if (['industrial', 'modernist', 'contemporary', 'futuristic', 'alien'].includes(family ?? '')) {
    // A folded gate canopy with exposed steel ribs and a recessed soffit.
    const lip = Math.min(g.depth, deep * 1.5),
      high = Math.min(top, spring + 0.44);
    for (const x of [-throat, throat]) g.beam([x, 0.04, high], [x, lip, spring + 0.08], 0.1, iron);
    g.face(
      [
        [-half, 0, high],
        [half, 0, high],
        [half, lip, spring + 0.11],
        [-half, lip, spring + 0.11],
      ],
      g.cover,
    );
    g.box(-half, half, lip - 0.055, lip, spring + 0.04, spring + 0.11, iron);
  } else if (family === 'andean' || family === 'mesoamerican' || family === 'indian' || /dwarven|duergar|giant/.test(culture)) {
    const courses = 2 + (g.seed % 3),
      lift = Math.min(0.88, top - spring);
    for (let i = 0; i < courses; i++) {
      const clear = throat * (1 - (0.55 * (i + 1)) / courses),
        z = spring + (lift * i) / courses;
      for (const sign of [-1, 1]) {
        const a = sign * clear,
          c = sign * (throat + shoulder);
        g.box(Math.min(a, c), Math.max(a, c), 0.012, deep + 0.03 * i, z, z + lift / courses, wall);
      }
    }
    g.box(-half, half, 0.012, deep + 0.07, spring + lift * 0.83, spring + lift, g.cover);
  } else if (family === 'african' && /earth|adobe|mud|plaster/.test(wall)) {
    g.box(-half, half, 0.012, deep, spring, Math.min(top, spring + 0.26), wall);
    for (const sign of [-1, 1]) {
      const x = sign * (throat + shoulder / 2),
        height = Math.min(top, spring + 0.72);
      g.box(x - shoulder * 0.31, x + shoulder * 0.31, 0.02, deep * 0.85, spring, height, wall);
      for (const z of [spring * 0.42, spring * 0.8]) g.beam([x, 0.04, z], [x, deep + 0.17, z], 0.1, timber);
    }
  } else {
    const rise = Math.min((top - spring) * 0.7, throat * (family === 'islamic' ? 1.14 : 0.77));
    const n = 7 + 2 * (g.seed % 3);
    for (let i = 0; i < n; i++) {
      const point = (j: number, outer: boolean, y: number): [number, number, number] => {
        const t = (Math.PI * j) / n,
          r = outer ? Math.min(shoulder * 0.78, top - spring - rise) : 0;
        return [(throat + r) * Math.cos(t), y, spring + (rise + r) * Math.sin(t)];
      };
      const j = i + 1;
      g.face([point(j, true, deep), point(i, true, deep), point(i, false, deep), point(j, false, deep)], wall);
      g.face([point(i, false, deep), point(i, false, 0.012), point(j, false, 0.012), point(j, false, deep)], wall);
      g.face([point(i, true, 0.012), point(i, true, deep), point(j, true, deep), point(j, true, 0.012)], wall);
    }
  }
}

function pigeonLoft(g: HouseFront) {
  const count = Math.min(5, Math.floor(g.width / 0.66));
  const z = Math.min(g.height - 0.26, (g.doorHeight ?? 1.75) + 0.24);
  if (!count || z < (g.doorHeight ?? 0.9)) return;
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * 0.52;
    if (g.windows?.some(w => Math.abs(w.x - x) < w.width / 2 + 0.21 && w.bottom < z + 0.25 && w.top > z - 0.08)) continue;
    g.box(x - 0.12, x + 0.12, 0.012, 0.035, z, z + 0.24, 'city3d:detail:flight-hole@4a4036');
    g.box(x - 0.18, x + 0.18, 0.01, 0.24, z - 0.055, z, timber);
  }
}

export function fittedSiteFront(use: SiteUse, culture: string, regional: FrontDesign): FrontDesign | undefined {
  switch (use) {
    case 'gate':
      return g => gate(g, culture);
    case 'workshop':
      return g => ((g.doorWidth ?? 1.2) > 2.15 ? loadingBay(g, serviceFamily(culture)) : regional(g));
    case 'stores':
      return g => loadingBay(g, serviceFamily(culture));
    case 'birds':
      return pigeonLoft;
    case 'home':
    case 'hall':
    case 'sanctuary':
      return regional;
    case 'marker':
      return undefined;
  }
}
