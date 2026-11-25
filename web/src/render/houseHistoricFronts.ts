import type { HouseFront } from './houseFrontKit';
import { historicPorchFamily } from './houseHistoricVariants';

type Point = [number, number, number];
type Profile = [number, number][];
const material = (kind: string, tint: string) => `city3d:wall:${kind}@${tint}`;
const lime = material('plaster', 'e5d8b8');
const limestone = material('ashlar', 'cbbca0');
const chalk = material('plaster', 'eee2cc');
const timber = material('wood', '644533');
const cedar = material('wood', '875838');
const basalt = material('stone', '777169');
const tile = material('brick', 'ab6248');
const reed = material('wattle', 'bb965d');
const deepWindow = material('opening', '504639');

/** Coordinates in a frontage bay. One unit spans its width, projection or height.
 * Keep domestic entrances human-sized even on a long wall or a tower. */
function bay(g: HouseFront, maxWidth = 5.6, maxHeight = 3.45, mirror = false, fitDoor = true) {
  const w = Math.min(g.width, maxWidth), d = Math.min(g.depth, 1.65), h = Math.min(g.height, maxHeight);
  const direction = mirror ? -1 : 1;
  const halfDoor = fitDoor && g.doorWidth ? Math.min(w / 2, g.doorWidth / 2) : undefined;
  const doorTop = fitDoor && g.doorHeight ? Math.min(h, g.doorHeight) : undefined;
  const jamb = halfDoor === undefined ? Math.min(.34, Math.max(.13, .61 / w)) : Math.min(.34, halfDoor / w);
  const head = Math.min(.86, (doorTop ?? 2.17) / h);
  // On a tight frontage use the remaining wall for mouldings instead of shrinking the clear opening.
  const across = (x: number) => {
    if (halfDoor === undefined || halfDoor <= .34 * w) return x * w;
    const u = Math.min(.5, Math.abs(x));
    return Math.sign(x) * (u <= jamb ? halfDoor * u / jamb : halfDoor + (w / 2 - halfDoor) * (u - jamb) / (.5 - jamb));
  };
  const up = (z: number) => doorTop === undefined || doorTop <= .86 * h ? z * h :
    z <= head ? z * doorTop / head : doorTop + (h - doorTop) * (Math.min(1, z) - head) / (1 - head);
  const point = ([x, y, z]: Point): Point => [direction * across(x), y * d, up(z)];
  const face = (p: Point[], mat: string) => g.face((mirror ? [...p].reverse() : p).map(point), mat);
  const box = (l: number, r: number, back: number, front: number, sill: number, head: number, mat: string) =>
    g.box(across(mirror ? -r : l), across(mirror ? -l : r), back * d, front * d, up(sill), up(head), mat);
  const beam = (a: Point, b: Point, thickness: number, mat: string) => {
    const width = Math.min(thickness, w * .047, d * .19, h * .06);
    const inset = width * Math.SQRT1_2;
    const end = (p: Point): Point => {
      const [x, y, z] = point(p);
      return [Math.max(-w / 2 + inset, Math.min(w / 2 - inset, x)),
              Math.max(inset, Math.min(d - inset, y)), Math.max(inset, Math.min(h - inset, z))];
    };
    g.beam(end(a), end(b), width, mat);
  };
  const post = (x: number, y: number, base: number, top: number, radius: number, mat: string, sides = 6) => {
    const r = Math.min(radius, w * .047, d * .19);
    g.post(Math.max(-w / 2 + r, Math.min(w / 2 - r, direction * across(x))),
           Math.max(r, Math.min(d - r, y * d)), up(base), up(top), r, mat, sides);
  };
  // Closed prism with its section in the elevation plane. All callers pass convex sections.
  const relief = (section: Profile, back: number, front: number, mat: string) => {
    const at = (y: number): Point[] => section.map(([x, z]) => [x, y, z]);
    const inner = at(back), outer = at(front);
    face([...outer].reverse(), mat);
    if (back > 0) face(inner, mat);
    for (let i = 0; i < section.length; i++) {
      const j = (i + 1) % section.length;
      face([inner[i], outer[i], outer[j], inner[j]], mat);
    }
  };
  return { w, h, d, box, face, relief, beam, post, jamb, head };
}
type Bay = ReturnType<typeof bay>;

/** A band with a clear opening underneath. The scaled ordinates retain the
 * horseshoe's overhang or a pointed arch's central cusp even at small LOD. */
const archShapes = {
  round: [[-1, 0], [-.92, .38], [-.71, .71], [-.38, .92], [0, 1], [.38, .92], [.71, .71], [.92, .38], [1, 0]],
  pointed: [[-1, 0], [-.92, .32], [-.73, .6], [-.43, .81], [0, 1], [.43, .81], [.73, .6], [.92, .32], [1, 0]],
  horseshoe: [[-.86, 0], [-1, .28], [-.94, .59], [-.68, .85], [0, 1], [.68, .85], [.94, .59], [1, .28], [.86, 0]],
  ogee: [[-1, 0], [-.92, .28], [-.74, .5], [-.49, .57], [-.22, .69], [0, 1], [.22, .69], [.49, .57], [.74, .5], [.92, .28], [1, 0]],
};
function arch(b: Bay, shape: keyof typeof archShapes, cx: number, r: number, spring: number, rise: number,
              ring: number, back: number, front: number, mat: string, accent = mat) {
  const curve = archShapes[shape];
  const at = (i: number, outer: boolean, y: number): Point => {
    const [x, z] = curve[i];
    const thickness = Math.min(ring * b.w / b.h, 1 - spring - rise);
    return [cx + x * (r + (outer ? ring : 0)), y, spring + z * (rise + (outer ? thickness : 0))];
  };
  for (let i = 1; i < curve.length; i++) {
    const a = i - 1, stone = i % 2 ? mat : accent;
    b.face([at(a, true, front), at(i, true, front), at(i, false, front), at(a, false, front)], stone);
    if (back > 0) b.face([at(a, false, back), at(i, false, back), at(i, true, back), at(a, true, back)], stone);
    b.face([at(a, false, back), at(a, false, front), at(i, false, front), at(i, false, back)], stone);
    b.face([at(a, true, back), at(i, true, back), at(i, true, front), at(a, true, front)], stone);
  }
}
function roofSlope(b: Bay, l: number, r: number, reach: number, top: number, eave: number, mat: string) {
  const t = .036;
  b.face([[l, 0, top], [r, 0, top], [r, reach, eave], [l, reach, eave]], mat);
  b.face([[l, reach, eave], [r, reach, eave], [r, reach, eave - t], [l, reach, eave - t]], mat);
  b.face([[l, 0, top - t], [l, 0, top], [l, reach, eave], [l, reach, eave - t]], mat);
  b.face([[r, reach, eave - t], [r, reach, eave], [r, 0, top], [r, 0, top - t]], mat);
  b.face([[l, reach, eave - t], [r, reach, eave - t], [r, 0, top - t], [l, 0, top - t]], mat);
}
function buttress(b: Bay, x: number, half: number, foot: number, top: number, mat: string) {
  b.relief([[x - half, 0], [x + half, 0], [x + half * .62, top], [x - half * .62, top]], 0, foot, mat);
}
function brackets(b: Bay, l: number, r: number, front: number, low: number, high: number, mat: string) {
  for (const x of [l, r]) b.beam([x, .04, low], [x, front, high], .13, mat);
}
function hipPorch(b: Bay, l: number, r: number, eave: number, cover: string) {
  const reach = .94, h = .99, cut = (r - l) * .22;
  b.face([[l, 0, eave], [l + cut, 0, h], [l, reach, eave]], cover);
  b.face([[l + cut, 0, h], [r - cut, 0, h], [r, reach, eave], [l, reach, eave]], cover);
  b.face([[r - cut, 0, h], [r, 0, eave], [r, reach, eave]], cover);
  b.face([[l, reach, eave - .036], [r, reach, eave - .036], [r, 0, eave - .036], [l, 0, eave - .036]], reed);
  for (const x of [l, r]) {
    const edge: Point[] = [[x, 0, eave], [x, reach, eave], [x, reach, eave - .036], [x, 0, eave - .036]];
    b.face(x === l ? edge : edge.reverse(), cover);
  }
  b.box(l, r, reach - .055, reach, eave - .04, eave, cover);
}
function medina(g: HouseFront) {
  const b = bay(g, 3.8), r = b.jamb / .86, spring = b.head;
  for (const s of [-1, 1]) {
    const x = s * (b.jamb + .034);
    b.box(x - .035, x + .035, 0, .28, 0, spring, lime);
  }
  arch(b, 'horseshoe', 0, r, spring, .96 - spring - .026, .022, 0, .28, lime);
  const edge = Math.min(.48, r + .095);
  roofSlope(b, -edge, edge, .57, .997, .951, material('brick', '547969'));
  brackets(b, -edge * .86, edge * .86, .43, .85, .948, cedar);
}
function roman(g: HouseFront) {
  const b = bay(g, 4.1), x = b.jamb + .067, red = material('plaster', 'a24936');
  for (const s of [-1, 1]) {
    b.box(s * x - .056, s * x + .056, 0, .29, 0, b.head, limestone);
    b.box(s * x - .068, s * x + .068, 0, .34, b.head - .045, b.head, chalk);
    const l = s < 0 ? -.48 : x + .065, r = s < 0 ? -x - .065 : .48;
    b.box(l, r, 0, .075, 0, .22, red);
  }
  b.box(-x - .07, x + .07, 0, .34, b.head, b.head + .046, limestone);
  b.box(-x - .09, x + .09, 0, .42, b.head + .046, b.head + .074, chalk);
  if (g.seed % 3 !== 0) b.relief([[-x - .07, b.head + .074], [x + .07, b.head + .074], [0, .995]], 0, .34, tile);
  else roofSlope(b, -x - .09, x + .09, .64, .995, b.head + .08, tile);
}
type Opening = { x: number; bottom: number; top: number; width: number };

/** Metric reveals. The native door and glazing are already mesh faces at y=.04.
 * Leave their complete rectangle exposed, including when adjacent openings are very close. */
function measuredFront(g: HouseFront) {
  const door: Opening | undefined = g.doorWidth && g.doorHeight
    ? { x: 0, bottom: 0, top: g.doorHeight, width: g.doorWidth } : undefined;
  const windows = g.windows ?? [], apertures = door ? [door, ...windows] : windows;
  const clear = (l: number, r: number, sill: number, head: number) =>
    l >= -g.width / 2 && r <= g.width / 2 && sill >= 0 && head <= g.height && r > l && head > sill &&
    !apertures.some(a => l < a.x + a.width / 2 - .001 && r > a.x - a.width / 2 + .001 && sill < a.top - .001 && head > a.bottom + .001);
  const box = (l: number, r: number, back: number, front: number, sill: number, head: number, mat: string) => {
    if (clear(l, r, sill, head)) g.box(l, r, back, Math.min(front, g.depth), sill, head, mat);
  };
  const frame = (a: Opening, t: number, reach: number, mat: string) => {
    const l = a.x - a.width / 2, r = a.x + a.width / 2;
    box(l - t, l, 0, reach, a.bottom, a.top, mat);
    box(r, r + t, 0, reach, a.bottom, a.top, mat);
    box(l - t, r + t, 0, reach, a.top, a.top + t, mat);
  };
  return { door, windows, clear, box, frame };
}

function mediterraneanLights(g: HouseFront, lagoon: boolean) {
  const f = measuredFront(g), b = bay(g, g.width, g.height, false, false);
  const stone = lagoon ? material('ashlar', 'e4dccc') : limestone;
  const t = .075 + (g.seed % 4) * .014;
  if (f.door) {
    const half = f.door.width / 2, h = f.door.top, jamb = Math.min(t * 1.3, (g.width / 2 - half) * .84);
    f.frame(f.door, jamb, .22, stone);
    const spring = h + jamb, rise = Math.min(half * (lagoon ? .91 : .8), g.height - spring - jamb - .006);
    if (rise > .065 && f.clear(-half - jamb, half + jamb, spring, spring + rise + jamb)) {
      const form = lagoon ? 'ogee' : 'round', projection = Math.min(.33, g.depth);
      // A solid tympanum sits on the existing door lintel; the hood follows its curved outer edge.
      for (let i = 1; i < archShapes[form].length; i++) {
        const [ax, az] = archShapes[form][i - 1], [bx, bz] = archShapes[form][i];
        g.face([[ax * half, .05, spring], [ax * half, .05, spring + az * rise],
                [bx * half, .05, spring + bz * rise], [bx * half, .05, spring]], lagoon ? stone : g.wall);
      }
      arch(b, form, 0, half / b.w, spring / b.h, rise / b.h, jamb / b.w, 0, projection / b.d, lagoon ? stone : tile, stone);
    }
  }
  // Window dressing is attached once per native opening by craftedArchitecture.joinery on every facade.
  // Low street-side masonry remains on plain walls. Keep the approach to the door free.
  const edge = Math.min(g.width * .48, 2.5), passage = (f.door?.width ?? 1.0) / 2 + .22;
  for (const side of [-1, 1]) {
    const l = side < 0 ? -edge : passage, r = side < 0 ? -passage : edge;
    f.box(l, r, 0, lagoon ? .57 : .41, 0, lagoon ? .145 : .21, lagoon ? stone : basalt);
    f.box(l, r, 0, lagoon ? .48 : .32, lagoon ? .145 : .21, lagoon ? .24 : .27, stone);
  }
}
function byzantine(g: HouseFront) { mediterraneanLights(g, false); }
function venetian(g: HouseFront) { mediterraneanLights(g, true); }
function persian(g: HouseFront) {
  const b = bay(g, 4.8), ochre = material('brick', 'b98457'), glaze = material('brick', '538c91');
  const r = b.jamb + .028, spring = b.head, rise = .958 - spring;
  // Deep portal with places to sit in the shade on each side.
  for (const s of [-1, 1]) {
    const l = s < 0 ? -.48 : r, right = s < 0 ? -r : .48;
    b.box(l, right, 0, .29, 0, .968, ochre);
    b.box(l + .008, right - .008, .29, .78, 0, .115, limestone);
  }
  arch(b, 'pointed', 0, r, spring, rise, .018, .01, .32, glaze);
  b.box(-.48, .48, 0, .33, .97, .995, glaze);
}
function ottoman(g: HouseFront) {
  const b = bay(g, 5.2, 5.6), sill = Math.max(.48, b.head + .01), span = .97 - sill;
  if (b.h < 3.25) {
    // Single-storey houses retain a braced entrance eave and a screened side light.
    roofSlope(b, -.455, .455, .79, .99, Math.max(.89, b.head + .045), tile);
    brackets(b, -.397, .397, .68, .62, .894, timber);
    const f = measuredFront(g), a = f.windows.find(a => Math.abs(a.x) + a.width / 2 + .07 < g.width / 2);
    if (a) f.frame(a, .065, .16, cedar);
    return;
  }
  // The upper room overhangs the street on timber struts. Three casements face out.
  brackets(b, -.36, .36, .76, sill - .15, sill, timber);
  b.box(-.41, .41, 0, .79, sill, sill + span * .1, timber);
  b.box(-.39, .39, 0, .75, sill + span * .1, .95, material('plaster', 'd9c9a7'));
  for (const x of [-.244, 0, .244]) {
    b.box(x - .091, x + .091, .751, .78, sill + span * .28, sill + span * .81, deepWindow);
    b.box(x - .006, x + .006, .78, .8, sill + span * .28, sill + span * .81, cedar);
  }
  roofSlope(b, -.45, .45, .95, .995, .954, tile);
}
function sahel(g: HouseFront) {
  const f = measuredFront(g), banco = material('earth', 'b48259');
  const half = (f.door?.width ?? 1.0) / 2;
  const thickness = Math.min(.37, (g.width / 2 - half) * .82);
  if (thickness < .026) return;
  const height = f.door?.top ?? Math.min(g.height * .64, 1.75);
  const stand = Math.min(g.height, height + .18 + (g.seed % 4) * .055);
  const b = bay(g, g.width, g.height, false, false), projection = Math.min(g.depth, .41);
  // Banco piers taper on the outer edge. Their inside faces rise vertically on the native door jambs.
  for (const s of [-1, 1]) {
    const l = s < 0 ? -half - thickness : half, r = s < 0 ? -half : half + thickness;
    if (!f.clear(l, r, 0, stand)) continue;
    const crown = thickness * .58, tip = Math.min(.17, stand * .065);
    const ll = s < 0 ? -half - crown : half, rr = s < 0 ? -half : half + crown;
    b.relief([[l / b.w, 0], [r / b.w, 0], [rr / b.w, (stand - tip) / b.h], [ll / b.w, (stand - tip) / b.h]], 0, projection / b.d, banco);
    b.relief([[ll / b.w, (stand - tip) / b.h], [rr / b.w, (stand - tip) / b.h], [(ll + rr) / (2 * b.w), stand / b.h]], 0, projection / b.d, banco);
    const x = (ll + rr) / 2, peg = Math.min(.036, crown / 4);
    for (const level of [.34, .66]) f.box(x - peg, x + peg, projection, projection + .14, height * level, height * level + peg * 1.6, timber);
  }
  if (f.door) f.box(-half, half, 0, projection * .65, height, Math.min(stand, height + .16), banco);
}
function kraal(g: HouseFront) {
  const b = bay(g, 3.3, 2.9);
  // A short woven entrance passage, splayed toward the cattle court.
  for (const s of [-1, 1]) {
    const inside = Math.max(.33, b.jamb + .046) * s, outside = .45 * s, height = .56;
    const wall: Point[] = [[inside, .02, 0], [outside, .87, 0], [outside, .87, height], [inside, .02, .68]];
    b.face(s > 0 ? wall : [...wall].reverse(), reed);
    const back: Point[] = wall.map(([x, y, z]) => [x - s * .012, y, z]);
    b.face(s > 0 ? back.reverse() : back, reed);
    for (const t of [.06, .48, .91]) {
      const x = inside + t * (outside - inside), y = .02 + t * .85;
      b.post(x, y, 0, .73 - t * .13, .055, timber, 5);
    }
    b.beam([inside, .025, .68], [outside, .87, height], .086, cedar);
  }
}
function swahili(g: HouseFront) {
  const f = measuredFront(g), coral = material('coral', 'c7b69b');
  const half = (f.door?.width ?? 1.0) / 2, t = Math.min(.145, .84 * (g.width / 2 - half));
  if (t <= .012) return;
  if (f.door) {
    f.frame(f.door, t, .176, timber);
    const h = f.door.top, depth = .205 + (g.seed % 4) * .012;
    for (const s of [-1, 1]) {
      const x = s * (half + t * .57);
      f.box(x - t * .19, x + t * .19, .176, depth, 0, h, cedar);
    }
    f.box(-half - t, half + t, .176, depth + .03, h + t * .32, h + t * .78, cedar);
  }
  const span = Math.min(g.width / 2 - .012, 2.6), inside = half + t + .025;
  for (const s of [-1, 1]) {
    const l = s < 0 ? -span : inside, r = s < 0 ? -inside : span;
    f.box(l, r, 0, .59, 0, .35, coral);
    f.box(l, r, 0, .65, .35, .43, chalk);
  }
}
function egyptian(g: HouseFront) {
  const b = bay(g, 4.1), ochre = material('earth', 'c29a6b'), wash = material('plaster', 'efd8ad');
  for (const s of [-1, 1]) {
    const x = s * (b.jamb + .044);
    b.box(x - .041, x + .041, 0, .23, 0, b.head, wash);
    const l = s < 0 ? -.47 : x + .05, r = s < 0 ? x - .05 : .47;
    b.box(l, r, 0, .31, 0, .14, ochre);
  }
  b.box(-b.jamb - .09, b.jamb + .09, 0, .26, b.head, b.head + .07, wash);
  const f = measuredFront(g), a = f.windows.find(a => Math.abs(a.x) + a.width / 2 + .07 < g.width / 2);
  if (a) f.frame(a, .06, .12, wash);
}
function nubian(g: HouseFront) {
  const b = bay(g, 3.7), mud = material('earth', 'bf8c63'), r = Math.min(.425, b.jamb + .08);
  const spring = b.head, rise = .955 - spring;
  // Brick barrel vault over a shaded approach. The transverse ribs continue into the soffit.
  for (const s of [-1, 1]) {
    const x = s * (r + .021);
    b.box(x - .021, x + .021, 0, .84, 0, spring, mud);
  }
  arch(b, 'round', 0, r, spring, rise, .033, 0, .84, mud);
  arch(b, 'round', 0, r - .009, spring, rise, .039, .84, .92, material('plaster', 'dec4a1'));
}
function mesopotamian(g: HouseFront) {
  const b = bay(g, 4.9, 3.45, (g.seed & 1) !== 0), adobe = material('earth', 'b28e68'), baked = material('brick', '9d7054');
  // A short return shields the courtyard entrance from the lane.
  b.box(-.435, -.352, 0, .91, 0, Math.max(.77, b.head), adobe);
  b.box(-.435, -b.jamb, .79, .91, 0, .77, adobe);
  b.box(-.454, -.338, 0, .944, 0, .105, baked);
  b.box(-.454, -b.jamb, .775, .944, 0, .105, baked);
  b.box(b.jamb, b.jamb + .08, 0, .33, 0, b.head, adobe);
  b.box(-.365, b.jamb + .08, 0, .35, b.head, b.head + .065, timber);
}
function levantine(g: HouseFront) {
  const b = bay(g, 4.9, 3.45, (g.seed & 1) !== 0), rock = material('stone', 'b4a185');
  // Masonry stair against one side of the street wall, up to a roof-access landing.
  for (let i = 0; i < 5; i++) {
    const y = i * .18;
    b.box(-.48, -b.jamb, y, y + .18, 0, (5 - i) * .075, rock);
  }
  b.box(b.jamb + .012, .465, 0, .49, 0, .18, rock);
  buttress(b, .411, .053, .30, .67, material('earth', 'c3a57e'));
  b.box(-b.jamb - .06, b.jamb + .065, 0, .24, b.head, b.head + .071, cedar);
}
function oasis(g: HouseFront) {
  const b = bay(g, 6.6), painted = material('wood', '718781'), brick = material('brick', 'bd9770');
  for (const x of [-.412, .412]) {
    b.box(x - .045, x + .045, .72, .935, 0, .095, brick);
    b.post(x, .825, .095, .78, .104, cedar, 8);
    b.post(x, .825, .73, .8, .158, painted, 8);
    b.box(x - .073, x + .073, .72, .93, .79, .85, cedar);
  }
  b.box(-.47, .47, .73, .92, .85, .917, painted);
  b.box(-.48, .48, 0, .96, .917, .969, material('earth', 'c9ad86'));
  for (const x of [-.26, 0, .26]) b.box(x - .017, x + .017, .96, .99, .913, .947, cedar);
}
function ksar(g: HouseFront) {
  const b = bay(g, 5), pisé = material('earth', 'b77753'), brick = material('brick', '955a42');
  for (const s of [-1, 1]) {
    const x = s * .395;
    buttress(b, x, .082, .52, .87, pisé);
    b.box(x - .055, x + .055, 0, .54, .865, .924, brick);
    for (const t of [-1, 1]) b.box(x + t * .04 - .016, x + t * .04 + .016, .03, .48, .924, .992, pisé);
    b.relief([[x - .039, .69], [x, .63], [x + .039, .69], [x, .75]], .52, .55, brick);
  }
  b.box(-.35, .35, 0, .215, Math.max(b.head, .73), Math.max(b.head, .73) + .061, pisé);
}
function yoruba(g: HouseFront) {
  const b = bay(g, 6.3), umber = material('earth', 'a16949'), indigo = material('wood', '555d69');
  // A hipped verandah shelters the raised earth benches of the family court.
  for (const s of [-1, 1]) {
    const x = s * .38;
    b.post(x, .8, 0, .834, .112, timber, 6);
    b.post(x, .8, .22, .35, .147, cedar, 6);
    b.post(x, .8, .61, .69, .148, indigo, 6);
    const l = s < 0 ? -.465 : b.jamb, r = s < 0 ? -b.jamb : .465;
    b.box(l, r, 0, .51, 0, .141, umber);
  }
  hipPorch(b, -.475, .475, Math.max(.85, b.head + .011), g.cover);
}
function andalus(g: HouseFront) {
  const b = bay(g, 5), r = Math.min(.42, b.jamb / .86 + .065);
  const spring = b.head;
  for (const s of [-1, 1]) {
    const x = s * (r * .86 + .011);
    b.post(x, .54, 0, spring - .052, .108, limestone, 8);
    b.box(x - .034, x + .034, .41, .67, spring - .052, spring, chalk);
  }
  arch(b, 'horseshoe', 0, r, spring, .94 - spring, .027, .4, .68, tile, chalk);
  roofSlope(b, -r - .075, r + .075, .75, .998, .966, tile);
}
function comune(g: HouseFront) {
  const b = bay(g, 5.8), r = .374, spring = b.head, rise = .952 - spring;
  for (const x of [-.401, .401]) {
    b.box(x - .045, x + .045, .58, .86, 0, spring, tile);
    b.box(x - .056, x + .056, .55, .9, 0, .085, limestone);
    b.box(x - .056, x + .056, .55, .9, spring - .049, spring, limestone);
  }
  arch(b, 'round', 0, r, spring, rise, .034, .55, .89, tile);
  b.box(-.464, .464, 0, .91, .971, .998, tile);
}
function caucasian(g: HouseFront) {
  const b = bay(g, 4.9, 5.9), floor = Math.max(.51, b.head + .012), rail = floor + Math.min(.14, (.942 - floor) * .57);
  if (b.h < 3.25) {
    for (const s of [-1, 1]) {
      const x = s * (b.jamb + .046);
      buttress(b, x, .052, .43, b.head, basalt);
      b.box(x - .061, x + .061, 0, .68, b.head, b.head + .043, cedar);
    }
    roofSlope(b, -.471, .471, .78, .998, b.head + .052, basalt);
    return;
  }
  const deck = floor + Math.min(.032, (rail - floor) * .38);
  brackets(b, -.33, .33, .74, floor - .185, floor, timber);
  b.box(-.43, .43, 0, .88, floor, deck, cedar);
  for (const x of [-.401, -.2, 0, .2, .401]) b.post(x, .793, deck, rail, .06, timber, 5);
  b.box(-.425, .425, .75, .84, rail, rail + .027, timber);
  for (const x of [-.402, .402]) {
    b.beam([x, .78, rail], [x, .78, .946], .093, timber);
    b.beam([x, .03, rail], [x, .78, rail], .09, cedar);
  }
  roofSlope(b, -.473, .473, .96, .994, .956, material('stone', '7e7a70'));
}
function ethiopian(g: HouseFront) {
  const b = bay(g, 4.4, 3.3), stone = material('stone', '88796a'), reach = .91;
  // A short stone plinth and a fan-shaped thatched canopy follow the round tukul wall.
  for (const s of [-1, 1]) {
    const x = s * .375;
    b.box(x - .084, x + .084, .52, .82, 0, .16, stone);
    b.post(x, .68, .16, .87, .094, cedar, 5);
  }
  const crown: Point = [0, .01, .995];
  const eaves: Point[] = [[-.465, 0, .87], [-.432, .57, .87], [-.258, .86, .86], [0, reach, .86],
                          [.258, .86, .86], [.432, .57, .87], [.465, 0, .87]];
  for (let i = 1; i < eaves.length; i++) {
    const l = eaves[i - 1], r = eaves[i];
    b.face([crown, r, l], g.cover);
    b.face([l, r, [r[0], r[1], r[2] - .055], [l[0], l[1], l[2] - .055]], reed);
  }
}
function zimbabwe(g: HouseFront) {
  const b = bay(g, 5.4), granite = material('stone', 'a19b87');
  // Splayed dry-stone passage. Each wall tapers across its thickness and turns in plan.
  for (const s of [-1, 1]) {
    const sections = [[.42, .01, .38], [.396, .36, .34], [.334, .69, .295], [.266, .94, .253]];
    const end = (i: number): Point[] => {
      const [x, y, z] = sections[i];
      return [[s * (x - .068), y, 0], [s * (x + .068), y, 0],
              [s * (x + .042), y, z], [s * (x - .042), y, z]];
    };
    for (let i = 1; i < sections.length; i++) {
      const back = end(i - 1), front = end(i);
      for (let j = 1; j <= 3; j++) {
        const next = (j + 1) % 4, side = [back[j], front[j], front[next], back[next]];
        b.face(s > 0 ? side : side.reverse(), granite);
      }
      if (i === sections.length - 1) b.face(s > 0 ? front.reverse() : front, granite);
    }
  }
}
function hausa(g: HouseFront) {
  const b = bay(g, 4.9), clay = material('earth', 'af7960'), limeClay = material('earth', 'd3a582');
  const r = b.jamb + .035, spring = b.head;
  for (const s of [-1, 1]) {
    const l = s < 0 ? -.445 : r, right = s < 0 ? -r : .445;
    b.box(l, right, 0, .68, 0, .825, clay);
    const x = (l + right) / 2;
    b.relief([[x - .046, .817], [x + .046, .817], [x + s * .034, .997]], .405, .67, clay);
    b.relief([[x - .053, .54], [x, .45], [x + .053, .54], [x, .636]], .68, .706, limeClay);
  }
  arch(b, 'pointed', 0, r, spring, .945 - spring, .032, 0, .69, limeClay);
}
function hadhrami(g: HouseFront) {
  const b = bay(g, 4.8, 14), mud = material('earth', 'a78263');
  // The lower storage floor stays plain. Repeated upper tiers carry lime surrounds and paired shutters.
  const first = Math.max(b.head + .034, .28);
  const tiers = b.h > 8 ? 3 : b.h > 4.5 ? 2 : 1, stride = (.985 - first) / tiers;
  for (let i = 0; i < tiers; i++) {
    const z = first + i * stride;
    b.box(-.45, .45, .012, .24, z, z + stride * .075, chalk);
    for (const x of [-.255, .255]) {
      b.box(x - .108, x + .108, .012, .142, z + stride * .2, z + stride * .85, lime);
      b.box(x - .079, x + .079, .143, .176, z + stride * .25, z + stride * .76, cedar);
      b.box(x - .009, x + .009, .176, .198, z + stride * .25, z + stride * .76, mud);
    }
  }
}
function indus(g: HouseFront) {
  const b = bay(g, 5.2, 3.45, (g.seed & 1) !== 0), brick = material('brick', 'a66e50'), fired = material('brick', 'bc8966');
  const l = b.jamb + .018;
  b.box(-.481, -l, 0, .70, 0, .19, brick);
  b.box(-.486, -l, 0, .76, .19, .22, fired);
  b.box(l, .479, 0, .64, 0, .21, brick);
  // Raised brick edges carry house drainage out below a short run of removable capstones.
  b.box(l, l + .025, .64, .965, 0, .086, fired);
  b.box(.451, .479, .64, .965, 0, .086, fired);
  for (const y of [.645, .81]) b.box(l, .479, y, y + .14, .086, .11, basalt);
  for (let i = 0; i < 3; i++) b.box(-l + .008, l - .008, i * .195, (i + 1) * .195, 0, (3 - i) * .035, fired);
}

const regionalFronts: Record<string, (g: HouseFront) => void> = {
  medina, 'roman-core': roman, 'byzantine-greek': byzantine, 'venetian-lagoon': venetian,
  persian, ottoman, sahel, kraal, 'swahili-stone-town': swahili, 'egyptian-planned': egyptian,
  'nubian-fortified': nubian, mesopotamian, 'levantine-tell': levantine, 'oasis-caravan': oasis,
  'ksar-oasis': ksar, yoruba, 'al-andalus': andalus, 'italian-comune': comune,
  'caucasian-highland': caucasian, 'ethiopian-highland': ethiopian, 'great-zimbabwe': zimbabwe,
  'hausa-kano': hausa, 'hadhrami-tower': hadhrami, 'indus-planned': indus,
};

export const historicFronts: Record<string, (g: HouseFront) => void> = Object.fromEntries(
  Object.entries(regionalFronts).map(([id, draw]) => [id, historicPorchFamily(id, draw)]),
);
