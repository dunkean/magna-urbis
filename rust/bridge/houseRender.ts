import type { HouseBatch, HouseCatalogue, HouseUnit, HouseView, Surface, Point, Vertex3, HouseMaterial, MaterialPattern, Feature, Wall } from './houses';

export const PAPER = '#f4efdf';
const INK = '#393a31';
const CURVED_RF = ['RF-CONE', 'RF-DOME', 'RF-DOME-CONE', 'RF-CURVED', 'RF-SADDLE', 'RF-VAULT', 'RF-THATCH-VAULT', 'RF-SHELL', 'RF-SNOW'];
const MATERIAL_COLORS: Record<MaterialPattern, string> = {tile: '#ad7f62', thatch: '#c9b47b', wood: '#b69b72', stone: '#bbb9a9', earth: '#c5ac8a', fabric: '#dad1b4', snow: '#e5e9e4', plain: '#cfbf9b'};
export function xml(value: unknown): string { return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '�').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[char]!)); }
function n(value: number): string { return Number(value.toFixed(4)).toString(); }
export function surfacePath(surface: Surface): string {
  return surface.flatMap(polygon => [polygon.outer, ...polygon.holes]).map(ring => ring.length ? `M${ring.map(p => `${n(p.x)},${n(p.y)}`).join('L')}Z` : '').join('');
}
function ringArea(ring: Point[]): number { return Math.abs(ring.reduce((sum, point, index) => { const next = ring[(index + 1) % ring.length]; return sum + point.x * next.y - next.x * point.y; }, 0) / 2); }
export function surfaceArea(surface: Surface): number { return surface.reduce((sum, polygon) => sum + ringArea(polygon.outer) - polygon.holes.reduce((holes, ring) => holes + ringArea(ring), 0), 0); }
function bounds(points: Point[]): {x: number; y: number; width: number; height: number} {
  if (!points.length) return {x: -1, y: -1, width: 2, height: 2};
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return {x: minX, y: minY, width: Math.max(0.1, maxX - minX), height: Math.max(0.1, maxY - minY)};
}
function surfacePoints(surface: Surface): Point[] { return surface.flatMap(p => p.outer); }
function rotate(point: Point, unit: HouseUnit): Point {
  const angle = unit.transform.orientation_deg * Math.PI / 180;
  return {x: unit.transform.origin.x + point.x * Math.cos(angle) - point.y * Math.sin(angle), y: unit.transform.origin.y + point.x * Math.sin(angle) + point.y * Math.cos(angle)};
}
export function unitBounds(unit: HouseUnit): ReturnType<typeof bounds> {
  const points = [...surfacePoints(unit.lot), ...unit.roofs.vertices, ...unit.features.flatMap(f => surfacePoints(f.surface)), ...unit.site_context.flatMap(f => surfacePoints(f.surface))];
  return bounds(points.map(point => rotate(point, unit)));
}
export function commonHouseExtent(units: HouseUnit[]): number { return Math.max(8, ...units.map(unit => { const b = unitBounds(unit); return Math.max(b.width, b.height); })) * 1.16; }
function material(catalogue: HouseCatalogue, id: string): HouseMaterial | undefined { return catalogue.materials.find(m => m.id === id); }
function paint(catalogue: HouseCatalogue, id: string, prefix: string): string { const pattern = material(catalogue, id)?.pattern ?? 'plain'; return `url(#${prefix}-mat-${pattern})`; }
function patterns(prefix: string): string {
  const marks: Record<MaterialPattern, string> = {
    tile: '<path d="M0 .4H.8M.4 0V.4M0 .4V.8M.8 .4V.8"/>',
    thatch: '<path d="M.12 .08L.28 .7M.4 .05L.5 .62M.63 .12L.77 .78"/>',
    wood: '<path d="M0 .2H.8M0 .55H.8M.35 .2L.5 .3M.1 .55L.25 .64"/>',
    stone: '<path d="M0 .4H.8M.34 0V.4M.65 .4V.8"/>',
    earth: '<path d="M.08 .15H.18M.5 .55H.62"/>',
    fabric: '<path d="M0 .8L.8 0M-.4 .8L.4 0M.4 .8L1.2 0"/>',
    snow: '<circle cx=".2" cy=".25" r=".025"/><circle cx=".65" cy=".7" r=".025"/>', plain: '',
  };
  return Object.entries(MATERIAL_COLORS).map(([pattern, color]) => `<pattern id="${prefix}-mat-${pattern}" patternUnits="userSpaceOnUse" width=".8" height=".8"><rect width=".8" height=".8" fill="${color}"/><g fill="${INK}" stroke="${INK}" stroke-width=".025" opacity=".19">${marks[pattern as MaterialPattern]}</g></pattern>`).join('');
}
function drawSurface(surface: Surface, attributes: string): string { return surface.length ? `<path d="${surfacePath(surface)}" fill-rule="evenodd" ${attributes}/>` : ''; }
function title(text: string): string { return `<title>${xml(text)}</title>`; }
function featureDraw(feature: Feature, catalogue: HouseCatalogue, prefix: string, context = false): string {
  const fill = feature.kind === 'courtyard' ? PAPER : feature.kind === 'water' || feature.kind === 'impluvium' ? '#bdd0ca' : feature.kind === 'street' ? '#dbd3bc' : feature.kind === 'excavation' || feature.kind === 'rock_shelter' || feature.kind === 'rock_face' ? '#b2ada1' : paint(catalogue, feature.material, prefix);
  let axis = '';
  const vertices = feature.vertices3d;
  if (feature.kind === 'post' && vertices.length >= 6 && vertices.length % 2 === 0) {
    const mean = (ring: Vertex3[]): Vertex3 => ring.reduce((c, v) => ({x: c.x + v.x / ring.length, y: c.y + v.y / ring.length, z: c.z + v.z / ring.length}), {x: 0, y: 0, z: 0});
    const a = mean(vertices.slice(0, vertices.length / 2)), b = mean(vertices.slice(vertices.length / 2));
    if (b.z > a.z + 0.01 && Math.hypot(b.x - a.x, b.y - a.y) > 0.001) axis = `<path d="M${n(a.x)},${n(a.y)}L${n(b.x)},${n(b.y)}" fill="none" stroke="${INK}" stroke-width=".85" vector-effect="non-scaling-stroke"/>`;
  } else if ((feature.kind === 'beam' || feature.kind === 'mooring') && vertices.length === 2) axis = `<path d="M${n(vertices[0].x)},${n(vertices[0].y)}L${n(vertices[1].x)},${n(vertices[1].y)}" fill="none" stroke="${INK}" stroke-width=".75" vector-effect="non-scaling-stroke"/>`;
  const label = feature.kind === 'flue' ? 'Conduit de fumée / air' : feature.kind === 'drain' ? 'Évacuation d’eau' : feature.kind;
  return `<g data-feature-id="${xml(feature.id)}" opacity="${context ? '.46' : '.92'}">${title(`${label} · z ${n(feature.z_m)} m · hauteur ${n(feature.height_m)} m`)}${drawSurface(feature.surface, `fill="${fill}" stroke="${feature.kind === 'flue' ? '#546653' : INK}" stroke-width=".65" vector-effect="non-scaling-stroke"`)}${axis}</g>`;
}
function wallSolidDraw(wall: Wall, catalogue: HouseCatalogue, prefix: string): string {
  if (!wall.solid || wall.shell_reference) return '';
  const solid = wall.solid;
  // Project the exported faces directly. Plan sections are supplied by Rust.
  return `<g>${title(`${wall.kind} · ${wall.material}`)}${solid.faces.map(face => `<path d="M${face.map(index => `${n(solid.vertices[index].x)},${n(solid.vertices[index].y)}`).join('L')}Z" fill="${paint(catalogue, wall.material, prefix)}"/>`).join('')}</g>`;
}
function center(surface: Surface): Point {
  const b = bounds(surfacePoints(surface));
  return {x: b.x + b.width / 2, y: b.y + b.height / 2};
}
// Depth comes from the exported triangles; no roof shape is reconstructed.
function roofHeightAt(unit: HouseUnit, point: Point): number {
  let height = 0;
  for (const face of unit.roofs.faces) {
    if (face.normal[2] <= 0) continue;
    const points = face.vertices.map(index => unit.roofs.vertices[index]);
    for (let i = 1; i + 1 < points.length; i++) {
      const [a, b, c] = [points[0], points[i], points[i + 1]];
      const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
      if (Math.abs(d) < 1e-9) continue;
      const u = ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y)) / d;
      const v = ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y)) / d;
      if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6) height = Math.max(height, u * a.z + v * b.z + (1 - u - v) * c.z);
    }
  }
  return height;
}
export interface RenderOptions { width?: number; height?: number; extent?: number; prefix?: string; zoom?: number; pan?: Point; title?: boolean }
export function renderHouseSvg(unit: HouseUnit, catalogue: HouseCatalogue, view: HouseView, options: RenderOptions = {}): string {
  const width = options.width ?? 340, height = options.height ?? 286;
  const prefix = (options.prefix ?? `house-${unit.id}`).replace(/[^a-zA-Z0-9_-]/g, '-');
  const b = unitBounds(unit), extent = (options.extent ?? Math.max(b.width, b.height) * 1.18) / (options.zoom ?? 1);
  const mapHeight = height - 32, mapWidth = width - 24;
  const scale = Math.min(mapWidth, mapHeight) / Math.max(extent, 1);
  const cx = b.x + b.width / 2 + (options.pan?.x ?? 0), cy = b.y + b.height / 2 + (options.pan?.y ?? 0);
  const level = unit.levels.find(l => l.index === view.level);
  const levelPartition = unit.level_partitions.find(l => l.level === view.level);
  const roomsOnPlan = view.mode === 'plan' ? unit.rooms.filter(room => room.level === view.level) : [];
  const roomNodes = new Set(roomsOnPlan.map(room => room.access_node));
  const doorPassages = unit.access.portals.filter(portal => (portal.kind === 'door' || portal.kind === 'gate') && (roomNodes.has(portal.from) || roomNodes.has(portal.to))).flatMap(portal => portal.passage);
  const localBounds = bounds([...surfacePoints(unit.lot), ...roomsOnPlan.flatMap(room => surfacePoints(room.floor)), ...surfacePoints(doorPassages)]);
  const roomStrokeMask = view.mode === 'plan' && doorPassages.length ? `<mask id="${prefix}-room-outline" maskUnits="userSpaceOnUse" x="${n(localBounds.x - 1)}" y="${n(localBounds.y - 1)}" width="${n(localBounds.width + 2)}" height="${n(localBounds.height + 2)}"><rect x="${n(localBounds.x - 1)}" y="${n(localBounds.y - 1)}" width="${n(localBounds.width + 2)}" height="${n(localBounds.height + 2)}" fill="white"/>${doorPassages.map(polygon => drawSurface([polygon], 'fill="black"')).join('')}</mask>` : '';
  const visible = (feature: Feature) => !!level && (feature.z_m < level.z_max + 0.01 && feature.z_m + Math.max(feature.height_m, 0.01) >= level.z_min - 0.01);
  const wallIds = new Set(unit.walls.map(wall => wall.id));
  const rawWallMarker = (feature: Feature) => ['enclosure', 'fence', 'retaining'].includes(feature.kind) && wallIds.has(`wall:${feature.id}`);
  const wallOnPlan = (wall: Wall) => {
    if (!level || (wall.level !== view.level && wall.kind !== 'enclosure')) return false;
    const bodyFloor = unit.bodies.find(body => body.id === wall.body_id)?.levels.find(bodyLevel => bodyLevel.index === wall.level)?.z_m;
    const plane = (bodyFloor ?? level.z_min) + 0.01;
    return wall.z_m <= plane && wall.z_m + wall.height_m > plane;
  };
  let drawing = unit.site_context.map(feature => featureDraw(feature, catalogue, prefix, true)).join('');
  drawing += drawSurface(unit.lot, 'fill="none" stroke="#898574" stroke-width=".65" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"');
  const partition = levelPartition?.partition ?? (view.level === 0 ? unit.partition : undefined);
  if (partition) {
    drawing += drawSurface(partition.courtyards, `fill="${PAPER}" stroke="#a69b7e" stroke-width=".65" vector-effect="non-scaling-stroke"`);
    drawing += drawSurface(partition.circulation, 'fill="#e5dbc1" stroke="none"');
  }
  if (view.mode === 'plan') {
    for (const body of unit.bodies) {
      const current = body.levels.find(l => l.index === view.level);
      if (current) drawing += drawSurface(current.floor, `fill="${paint(catalogue, current.materials.base, prefix)}" stroke="none" opacity=".35"`);
    }
    for (const room of roomsOnPlan) drawing += `<g>${title(`${room.usage} · ${room.id} · ${n(surfaceArea(room.floor))} m²`)}${drawSurface(room.floor, 'fill="#ede3c9"')}${drawSurface(room.floor, `fill="none" stroke="#aca18a" stroke-width=".55" vector-effect="non-scaling-stroke"${roomStrokeMask ? ` mask="url(#${prefix}-room-outline)"` : ''}`)}</g>`;
    drawing += unit.features.filter(feature => visible(feature) && !rawWallMarker(feature)).map(feature => featureDraw(feature, catalogue, prefix)).join('');
    for (const wall of unit.walls.filter(wallOnPlan)) drawing += `<g>${title(`${wall.kind} · ${wall.material}`)}${drawSurface(wall.plan_section ?? wall.footprint, `fill="${paint(catalogue, wall.material, prefix)}" stroke="${INK}" stroke-width=".7" vector-effect="non-scaling-stroke"`)}</g>`;
    for (const portal of unit.access.portals.filter(p => !!level && (Math.min(p.from_z_m, p.to_z_m) <= level.z_max && Math.max(p.from_z_m, p.to_z_m) >= level.z_min))) {
      drawing += drawSurface(portal.opening_surface, 'fill="#c6d6c2" fill-opacity=".5" stroke="#506b55" stroke-width=".8" vector-effect="non-scaling-stroke"');
      if (portal.kind === 'door' || portal.kind === 'gate') drawing += `<path d="M${n(portal.opening[0].x)},${n(portal.opening[0].y)}L${n(portal.opening[1].x)},${n(portal.opening[1].y)}" stroke="#6b6045" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`;
    }
  } else {
    drawing += unit.walls.filter(wall => !wall.solid && (wall.kind === 'enclosure' || wall.kind === 'retaining')).map(wall => drawSurface(wall.footprint, `fill="${paint(catalogue, wall.material, prefix)}" stroke="${INK}" stroke-width=".65" vector-effect="non-scaling-stroke"`)).join('');
    drawing += unit.walls.map(wall => wallSolidDraw(wall, catalogue, prefix)).join('');
    drawing += unit.features.filter(f => !rawWallMarker(f) && !['roof_gable', 'roof_tympanum', 'stepped_gable', 'roof_riser', 'roof_pavilion', 'roof_drum', 'portal_lintel', 'floor_slab'].includes(f.kind)).map(feature => featureDraw(feature, catalogue, prefix)).join('');
    const mesh = unit.roofs;
    const groups = mesh.groups.map(group => ({group, faces: mesh.faces.filter(face => face.roof_group === group.id && face.normal[2] >= 0)})).sort((a, b) => {
      const z = (faces: typeof mesh.faces) => Math.max(0, ...faces.flatMap(face => face.vertices.map(index => mesh.vertices[index].z)));
      return z(a.faces) - z(b.faces);
    });
    for (const {group, faces} of groups) {
      const topZ = Math.max(0, ...faces.flatMap(face => face.vertices.map(index => mesh.vertices[index].z)));
      drawing += `<g>${title(`${group.rf} · ${group.body_id}`)}${drawSurface(group.domain, `fill="#343831" opacity=".12" transform="translate(${n(Math.min(0.7, topZ * 0.035))} ${n(Math.min(0.9, topZ * 0.05))})"`)}`;
      const fills = new Map<string, string[]>(), shades = new Map<string, string[]>();
      for (const face of faces.sort((a, b) => a.vertices.reduce((sum, index) => sum + mesh.vertices[index].z, 0) / a.vertices.length - b.vertices.reduce((sum, index) => sum + mesh.vertices[index].z, 0) / b.vertices.length)) {
        const points = face.vertices.map(index => mesh.vertices[index]);
        const angle = unit.transform.orientation_deg * Math.PI / 180, [nx, ny, nz] = face.normal;
        const rx = nx * Math.cos(angle) - ny * Math.sin(angle), ry = nx * Math.sin(angle) + ny * Math.cos(angle);
        const darkness = Math.max(0, Math.min(0.3, 0.16 - 0.18 * (-rx * 0.48 - ry * 0.64 + nz * 0.6)));
        const path = `M${points.map(point => `${n(point.x)},${n(point.y)}`).join('L')}Z`;
        const fill = paint(catalogue, face.material, prefix), shade = n(darkness);
        if (!fills.has(fill)) fills.set(fill, []);
        fills.get(fill)!.push(path);
        if (darkness > 0) { if (!shades.has(shade)) shades.set(shade, []); shades.get(shade)!.push(path); }
      }
      // A compound path keeps the native triangles and holes while avoiding
      // antialias gaps along their shared edges. Only mesh.edges draws seams.
      for (const [fill, paths] of fills) drawing += `<path d="${paths.join('')}" fill="${fill}"/>`;
      for (const [shade, paths] of shades) drawing += `<path d="${paths.join('')}" fill="#29332d" opacity="${shade}"/>`;
      for (const edge of mesh.edges) {
        const related = edge.faces.filter((index): index is number => index !== null).map(index => mesh.faces[index]);
        if (!related.some(face => face.roof_group === group.id && face.normal[2] >= 0)) continue;
        const samePatch = related.length === 2 && related.every(face => face.roof_group === group.id && face.material === related[0].material && face.kind === related[0].kind);
        const smoothCurve = CURVED_RF.includes(group.rf) && (edge.kind === 'crease' || edge.kind === 'hip') && samePatch && related[0].normal.reduce((dot, value, index) => dot + value * related[1].normal[index], 0) > 0.94;
        const a = mesh.vertices[edge.vertices[0]], b = mesh.vertices[edge.vertices[1]];
        drawing += `<path d="M${n(a.x)},${n(a.y)}L${n(b.x)},${n(b.y)}" fill="none" stroke="${edge.kind === 'valley' ? '#736e53' : INK}" stroke-width="${smoothCurve ? '.18' : edge.kind === 'ridge' ? '1.05' : edge.kind === 'eave' || edge.kind === 'verge' ? '.85' : '.65'}" opacity="${smoothCurve ? '.18' : '1'}" ${edge.kind === 'junction' ? 'stroke-dasharray="2 2"' : ''} vector-effect="non-scaling-stroke"/>`;
      }
      drawing += '</g>';
    }
    drawing += unit.features.filter(feature => (feature.kind === 'flue' || feature.kind === 'windcatcher') && feature.z_m + feature.height_m > roofHeightAt(unit, center(feature.surface)) + 0.01).map(feature => featureDraw(feature, catalogue, prefix)).join('');
  }
  if (view.graph) {
    const centers = new Map(unit.access.nodes.map(node => [node.id, center(node.floor)]));
    drawing += '<g stroke="#496f67" fill="#faf5df">';
    for (const portal of unit.access.portals) {
      const from = centers.get(portal.from), to = centers.get(portal.to);
      const opening = {x: (portal.opening[0].x + portal.opening[1].x) / 2, y: (portal.opening[0].y + portal.opening[1].y) / 2};
      if (from && to) drawing += `<g>${title(`${portal.kind} · ${n(portal.width_m)} m · z ${n(portal.from_z_m)} → ${n(portal.to_z_m)} · linteau ${n(portal.head_z_m ?? portal.from_z_m + 2.05)} m`)}<path d="M${n(from.x)},${n(from.y)}L${n(opening.x)},${n(opening.y)}L${n(to.x)},${n(to.y)}" stroke-width="1.1" stroke-dasharray="3 2" vector-effect="non-scaling-stroke"/></g>`;
    }
    for (const node of unit.access.nodes) { const p = centers.get(node.id)!; drawing += `<g>${title(`${node.kind} · ${node.id} · z ${n(node.z_m)} m`)}<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${n(2.8 / scale)}" stroke-width="1" vector-effect="non-scaling-stroke"/></g>`; }
    drawing += '</g>';
  }
  // Express pen weights in local metres. This also preserves their intended
  // pixel weight in SVG renderers that do not implement vector-effect.
  drawing = drawing.replace(/stroke-width="([\d.]+)"/g, (_match, weight) => `stroke-width="${n(Number(weight) / scale)}"`)
    .replace(/stroke-dasharray="([\d. ]+)"/g, (_match, values) => `stroke-dasharray="${values.split(' ').map((value: string) => n(Number(value) / scale)).join(' ')}"`)
    .replace(/ vector-effect="non-scaling-stroke"/g, '');
  const transform = `translate(${width / 2} ${mapHeight / 2 + 8}) scale(${n(scale)}) translate(${-cx} ${-cy}) translate(${n(unit.transform.origin.x)} ${n(unit.transform.origin.y)}) rotate(${n(unit.transform.orientation_deg)})`;
  const targetBar = Math.max(0.01, extent / 5), magnitude = 10 ** Math.floor(Math.log10(targetBar)), barMeters = [1, 2, 5].map(v => v * magnitude).filter(v => v <= targetBar).at(-1) ?? magnitude;
  const barWidth = barMeters * scale;
  const measured = bounds(surfacePoints(unit.partition.occupied.length ? unit.partition.occupied : unit.lot).map(point => rotate(point, unit)));
  const dimensions = view.dimensions ? `<text x="${width - 12}" y="${height - 10}" text-anchor="end" font-size="10" stroke="none">${unit.partition.occupied.length ? 'Emprise' : 'Parcelle'} ${n(measured.width)} × ${n(measured.height)} m</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xml(unit.label)}"><title>${xml(unit.label)} — ${view.mode === 'roof' ? 'toitures' : `plan niveau ${view.level}`}</title><defs>${patterns(prefix)}${roomStrokeMask}<clipPath id="${prefix}-map-clip"><rect x="8" y="8" width="${width - 16}" height="${height - 38}"/></clipPath></defs><rect width="100%" height="100%" fill="${PAPER}"/><g clip-path="url(#${prefix}-map-clip)"><g transform="${transform}">${drawing}</g></g><g fill="${INK}" stroke="${INK}" font-family="sans-serif"><path d="M15 ${height - 19}v-4M15 ${height - 21}h${n(barWidth)}M${n(15 + barWidth)} ${height - 19}v-4" fill="none" stroke-width="1"/><text x="15" y="${height - 6}" font-size="10" stroke="none">${n(barMeters)} m</text><path d="M${width - 19} 31V15m-3 5 3-5 3 5" fill="none" stroke-width="1"/><text x="${width - 19}" y="12" text-anchor="middle" font-size="9" stroke="none">N</text>${dimensions}</g></svg>`;
}
export function renderHouseSheet(batch: HouseBatch, catalogue: HouseCatalogue, view: HouseView): string {
  const columns = Math.min(5, batch.units.length), cellWidth = 340, cellHeight = 340, rows = Math.ceil(batch.units.length / columns);
  const extent = commonHouseExtent(batch.units), width = columns * cellWidth, height = 84 + rows * cellHeight;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${PAPER}"/><g fill="${INK}" font-family="serif"><text x="18" y="30" font-size="22">Magna Urbis · Atlas des maisons</text><text x="18" y="52" font-family="sans-serif" font-size="12">${xml(batch.settings.pack)} · graine ${xml(batch.settings.seed)} · ${xml(batch.generator_version)} · ${xml(batch.catalogue_version)}</text></g>${batch.units.map((unit, index) => `<g transform="translate(${index % columns * cellWidth} ${84 + Math.floor(index / columns) * cellHeight})"><text x="14" y="17" fill="${INK}" font-family="sans-serif" font-size="11">${xml(`${index + 1}. ${unit.label}`)}</text><svg x="0" y="25" width="${cellWidth}" height="290" viewBox="0 0 ${cellWidth} 290">${renderHouseSvg(unit, catalogue, view, {width: cellWidth, height: 290, extent, prefix: `sheet-${index}`}).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg></g>`).join('')}</svg>`;
}
