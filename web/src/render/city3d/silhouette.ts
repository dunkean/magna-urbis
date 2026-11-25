/**
 * Silhouette footprints converted to display building volumes. Called by the City 3D scene adapter and sibling mesh builders.
 * Reads/writes: Reads source building, massing and height/water samplers; constructs local roof/volume records without changing the source.
 */
import { mushroomDwellingCap } from '../city3dMushroom';
import type { ArchitectureVolume, PlacedBuilding } from '../../../../rust/bridge/urbanArchitecture';
import { surfaceTriangles, MINOR_VOLUME_ROLE, type OverviewVolume, type SeatedVolume } from '../urbanBuildingGeometry';
import { pieceTerrace, pieceVolumes, readMassing, scaledRing, shedWalls, stiltDeck, stiltSupports, volumeRoof } from '../cityMassing';
import { lightCrowns } from '../cityTrees';
import { City3dHeight } from './types';
import { surfaceArea, ringCentre, RoofBuilder, flatRoof, orientedBox, ringArea, ridgeRoof, insetRoof } from './roofGeometry';
import { massingSlots, WALLS, COVERS, paletteSlots, TREE_CROWNS, slots, WALL_ID, COVER_ID } from './materials';
import { silhouetteMassing, Programme, hash, CITY3D_LEVEL_M } from './massing';
import { CITY3D_FOOTING_DEPTH_M, CITY3D_POST_SINK_M, footprintTerrain, massingSeats, shapedTo, terraceFooting, wholeSeat, type PieceSeat, type SeatGround } from './terrainSeat';
import { treeDetails, stiltPosts } from './treeDwelling';
import { baseVolume } from './volume';
import { featureBox, overhang, standingFeatures } from './features';
import { volumeDetails } from './volumeDetails';

const PLANAR_ROOFS = new Set(['gable', 'hip', 'pyramid', 'shed', 'ring']);

/** Ground drop under a body from which its openings look at the ground along its walls, m. */
const OPENINGS_DROP_M = 0.3;
/** The seats last computed for a building: the ground is shaped to them before its mesh stands on them. */
const SEATS = new WeakMap<PlacedBuilding, { ground?: SeatGround; waterAt?: City3dHeight; seats: PieceSeat[] }>();
/** Seats of the footprint pieces of a silhouette on the natural ground (massing pieces, else the whole footprint). */
export function silhouetteSeats(building: PlacedBuilding, ground?: SeatGround, waterAt?: City3dHeight): PieceSeat[] {
  const known = SEATS.get(building);
  if (known && known.ground === ground && known.waterAt === waterAt) return known.seats;
  const massing = readMassing((building as PlacedBuilding & { programme?: unknown }).programme, building.footprint);
  let seats: PieceSeat[];
  if (massing) seats = massingSeats(building, massing, ground, waterAt);
  else {
    const seat = wholeSeat(building, silhouetteMassing(building, surfaceArea(building.footprint)).floors * CITY3D_LEVEL_M, ground);
    seats = building.footprint.map(() => seat);
  }
  if (ground) SEATS.set(building, { ground, waterAt, seats });
  return seats;
}

/** Extruded silhouette: walls of `floors × 3 m`, a gable or hip roof on
 * rectangular shapes, a pitched border elsewhere, a foundation down to the lowest
 * terrain sample under the whole footprint so no wall floats above a slope or a cliff. `terraces`: false drops the
 * built terraces of the massing (Advanced › "Built terraces"), each piece then standing on its own footing. `ground`: the
 * natural ground the floors are cut into (terrainSeat.ts); `heightAt` is the ground as drawn around them. */
export function silhouetteBuilding(
  building: PlacedBuilding,
  heightAt?: City3dHeight,
  waterAt?: City3dHeight,
  lightTrees = false,
  terraces = true,
  ground: SeatGround | undefined = heightAt && { at: heightAt, cut: true },
): PlacedBuilding {
  const footprint = building.footprint,
    area = surfaceArea(footprint),
    m = silhouetteMassing(building, area);
  const culture = building.culture.culture,
    programme = (building as PlacedBuilding & { programme?: Programme }).programme;
  const compound = programme && ('activity' in programme || 'farmstead' in programme);
  const role = `${programme?.role ?? ''} ${m.family}${programme?.landmark ? ' monument' : ''}`;
  const cut = !!shapedTo(ground, heightAt).cutGround;
  // The ground as drawn around the building may be cut below the natural one: a footing reaches under both.
  const drawnLow = heightAt && ground && ground.at !== heightAt ? (footprintTerrain(footprint, heightAt)?.low ?? Infinity) : Infinity;
  const massing = readMassing((building as PlacedBuilding & { programme?: unknown }).programme, footprint, building.id);
  if (massing) {
    // City massing (cityMassing.ts): one volume per preview piece, its own height and roof. Each body is seated on the
    // ground under it (a barn downhill of its house stands on its own ground, not lifted to the house floor); on a stilt
    // site every piece stays above the water under it.
    const pieces = footprint.map((shape, i) => pieceVolumes(shape, massing[i]));
    const seats = silhouetteSeats(building, ground, waterAt);
    // The building's ground is its highest seat: the terrain cut under the footprint (urbanBuildingGround.ts) never digs
    // below a floor, and a piece seated lower names its own ground (SeatedVolume).
    let site = -Infinity;
    for (const { seat } of seats) site = Math.max(site, seat);
    const terraceFootings: ArchitectureVolume['foundation'][] = [];
    const volumes = footprint.flatMap((shape, i) => {
      const piece = massing[i],
        { seat: ground, low, high } = seats[i],
        source = terraces ? pieceTerrace(piece) : undefined,
        terrace = source && terraceFooting(source, ground, heightAt, cut),
        openingGround = high - low > OPENINGS_DROP_M ? heightAt : undefined;
      const foundation = { footprint, z_min_m: Math.min(low, drawnLow) - CITY3D_FOOTING_DEPTH_M, z_max_m: ground };
      // A terraced piece stands on its terrace (drawn as a structural foundation): no footing of its own.
      if (terrace) terraceFootings.push(terrace);
      return pieces[i].map((v, j) => {
        const plain = massingSlots(v.wall, v.cover, WALLS[v.wall] ?? m.wall, COVERS[v.cover] ?? m.roof),
          roof = new RoofBuilder();
        const materials = paletteSlots(plain, culture, v.wall, v.cover, v.tone, role + (v.wall === 'stone' ? ' monument' : ''), v.tint),
          wallId = materials.coating;
        if (v.tree) {
          const tree = lightTrees ? { ...v.tree, light: true } : v.tree;
          // Closely related greens per crown, independent of its height.
          for (const c of tree.light ? lightCrowns(tree) : tree.crowns)
            for (const face of volumeRoof({ ...v, tree: { ...tree, crowns: [c] } }, i, j))
              roof.face(
                face.points.map(p => ({ ...p, z: p.z + ground })),
                TREE_CROWNS[Math.min(TREE_CROWNS.length - 1, Math.floor(c.tone * TREE_CROWNS.length))],
              );
          const trunk = treeDetails(roof, tree, ground, 'city3d:tree:trunk@4b5a36', 'city3d:tree:crown@5f8247'),
            bodyShape = { outer: trunk, holes: [] };
          const volume = baseVolume(`${building.id}:city3d:${i}:${j}`, [v.shape], ground, v.eave_m, v.rise_m, materials, roof.mesh(), 'RF-DOME', { ...foundation, footprint: [bodyShape] }, [
            { index: 0, footprint: [{ outer: scaledRing(v.shape.outer, v.tree.trunkRadius / v.tree.radius), holes: [] }], z_m: ground, height_m: v.eave_m },
          ]);
          if (compound) (volume as OverviewVolume).ruralPiece = i;
          if (ground < site) (volume as SeatedVolume).ground_m = ground;
          volume.envelope = 'open';
          if (culture === 'elven') (volume as OverviewVolume).displayTree = tree;
          return volume;
        }
        const over = v.detail?.overhang_m ?? 0,
          centre = ringCentre(v.shape.outer),
          lift = v.detail?.stilts_m ?? 0;
        const body = wallId;
        if (lift > 0) {
          // A post stands on its own ground (the downhill posts of a hillside house are the longer ones), never on the floor's seat.
          const footAt = (x: number, y: number): number => {
            const h = heightAt?.(x, y);
            return Number.isFinite(h) ? Math.min(ground, h!) - CITY3D_POST_SINK_M : ground;
          };
          stiltPosts(roof, stiltDeck(v.shape.outer), ground, lift, wallId, materials.roof_frame, footAt);
          for (const p of stiltSupports(v.shape.outer)) {
            const foot = footAt(p.x, p.y);
            featureBox(roof, p.x, p.y, 0.32, 0.32, ground + lift + 0.45 - foot, 0, foot, materials.roof_frame);
          }
        }
        // `base` is the level the heights of the volume are measured from; its walls start `raisedBy` above it.
        const base = ground + lift,
          raisedBy = v.base_m ?? 0;
        const form = v.detail?.form,
          organic = form === 'tree' || form === 'mushroom';
        // Crowns and trunks get forest-green display materials (urbanBuilding3d.ts paints them).
        const greens = form === 'tree',
          crown = greens ? 'city3d:tree:crown@5f8247' : materials.cladding,
          roofStart = roof.faces.length;
        // Myconid dwellings: a cap of the Underdark mushroom family instead of the dome (city3dMushroom.ts).
        if (form === 'mushroom') mushroomDwellingCap(roof, v.shape.outer, base, v.eave_m, Math.max(0, v.rise_m), `${building.id}:${i}:${j}`, materials.cladding, !!programme?.landmark);
        else
          for (const face of volumeRoof(v, i, j)) {
            const points = face.points.map(p => ({ ...p, z: p.z + base }));
            if (face.holes?.length)
              for (const triangle of surfaceTriangles([{ outer: points, holes: face.holes }]))
                roof.face(
                  triangle.map(p => ({ ...p, z: points[0].z })),
                  crown,
                );
            else roof.face(points, crown, face.hiddenEdge);
            // Explicit pans already carry their eaves: no skirt is added to them.
            if (over > 0 && !v.pans) overhang(roof, points, base + v.eave_m, centre, over, crown);
          }
        for (const gable of [...(v.gables ?? []), ...shedWalls(v)])
          roof.gable(
            gable.map(p => ({ ...p, z: p.z + base })),
            wallId,
            centre,
          );
        const roofEnd = roof.faces.length;
        const bodyShape = organic ? { outer: scaledRing(v.shape.outer, form === 'tree' ? 0.22 : 0.3), holes: [] } : v.shape;
        if (organic) {
          if (form !== 'mushroom') flatRoof(roof, [v.shape], base + v.eave_m, crown);
          volumeDetails(roof, { ...v, shape: bodyShape, detail: { ...v.detail, overhang_m: 0.1 } }, base, greens ? 'city3d:tree:trunk@4b5a36' : body, `${building.id}:${i}:${j}`);
        } else if (form === 'battered') {
          const bottom = v.shape.outer,
            top = scaledRing(bottom, 0.92);
          for (let k = 0; k < bottom.length; k++) {
            const n = (k + 1) % bottom.length;
            roof.face(
              [
                { ...bottom[k], z: base + raisedBy },
                { ...bottom[n], z: base + raisedBy },
                { ...top[n], z: base + v.eave_m },
                { ...top[k], z: base + v.eave_m },
              ],
              wallId,
            );
          }
          volumeDetails(roof, v, base, body, `${building.id}:${i}:${j}`);
        } else volumeDetails(roof, v, base, body, `${building.id}:${i}:${j}`, lift > 0 ? undefined : openingGround, !terrace);
        const standing = roof.faces.length;
        standingFeatures(roof, v, base);
        const system = v.roof === 'flat' ? 'RF-FLAT' : v.roof === 'hip' || v.roof === 'pyramid' || v.roof === 'tent' ? 'RF-HIP' : 'RF-GABLE';
        // Ruin stubs and mounds (massing.rs `ruin_piece`) run their walls down to the footing: no plinth box, half the triangles.
        // A volume standing on another one has neither footing nor plinth: its walls run from its base to its eave.
        const ruin = v.cover === 'ruin' && lift <= 0 && !raisedBy,
          z0 = ruin ? foundation.z_min_m : base + raisedBy;
        const volume: OverviewVolume = baseVolume(
          `${building.id}:city3d:${i}:${j}`,
          [v.shape],
          base + raisedBy,
          v.eave_m - raisedBy,
          Math.max(0, v.rise_m),
          materials,
          roof.mesh(),
          system,
          { ...foundation, footprint: ruin || raisedBy || terrace ? [] : [bodyShape], z_max_m: lift > 0 ? foundation.z_min_m : ground },
          [{ index: 0, footprint: [bodyShape], z_m: z0, height_m: v.eave_m + base - z0 }],
        );
        // The display skirts extend past the silhouette's source footprint.
        if (compound) volume.ruralPiece = i;
        volume.overhang_m = over;
        if (lift > 0) volume.stiltHeight_m = lift;
        volume.displayRoofForm = v.roof;
        if (ground < site) (volume as SeatedVolume).ground_m = ground;
        if (form === 'battered') volume.envelope = 'open';
        // Keep the main pans and gables without the small details added to the roof and facade.
        if (!organic && form !== 'battered' && v.rise_m > 0.05 && PLANAR_ROOFS.has(v.roof) && roofEnd > roofStart) volume.overview_roof_faces = [roofStart, roofEnd];
        // Sails and wheels stay on the overview body of the volume (urbanBuildingGeometry.ts).
        if (roof.faces.length > standing) volume.overview_faces = [standing, roof.faces.length];
        // The overview LOD drops small decorative volumes (urbanBuildingGeometry.ts).
        if (v.minor) volume.role = MINOR_VOLUME_ROLE;
        return volume;
      });
    });
    const treeCrowns = massing.some(p => p.volumes?.some(v => v.form === 'tree'));
    return {
      ...building,
      ...shapedTo(ground, heightAt),
      ground_z_m: site,
      roof_footprint: treeCrowns ? volumes.flatMap(v => v.footprint) : building.roof_footprint.length ? building.roof_footprint : footprint,
      volumes,
      ...(terraceFootings.length ? { structural_foundations: [...(building.structural_foundations ?? []), ...terraceFootings] } : {}),
    };
  }
  const { seat: floor, low } = wholeSeat(building, m.floors * CITY3D_LEVEL_M, ground);
  const plain = slots(m.wall, m.roof),
    materials = paletteSlots(plain, culture, WALL_ID[m.wall].split(':')[1], COVER_ID[m.roof].split(':')[1], hash(building.id) / 0xffffffff, role);
  const wall = m.floors * CITY3D_LEVEL_M,
    eave = floor + wall,
    roof = new RoofBuilder();
  let rise = 0;
  for (const shape of footprint) {
    const box = orientedBox(shape.outer);
    if (!box) continue;
    const pitch = Math.tan((m.pitchDeg * Math.PI) / 180);
    const shapeRise = m.flat || box.halfWidth < 1.2 ? 0 : Math.min(box.halfWidth * pitch, 12);
    rise = Math.max(rise, shapeRise);
    if (shapeRise <= 0.05) {
      flatRoof(roof, [shape], eave, materials.cladding);
      continue;
    }
    const rectangular = !shape.holes.length && Math.abs(ringArea(shape.outer)) >= 0.82 * box.area;
    if (rectangular) {
      const half = m.hip ? Math.max(0, box.half - box.halfWidth) : box.half,
        c = box.center,
        u = box.axis;
      ridgeRoof(
        roof,
        shape.outer,
        [
          [
            { x: c.x - u.x * half, y: c.y - u.y * half },
            { x: c.x + u.x * half, y: c.y + u.y * half },
          ],
        ],
        eave,
        eave + shapeRise,
        materials.cladding,
      );
    } else insetRoof(roof, [shape], eave, Math.min(shapeRise, 4), materials.cladding);
  }
  const foundation = { footprint, z_min_m: Math.min(low, drawnLow) - CITY3D_FOOTING_DEPTH_M, z_max_m: floor };
  return {
    ...building,
    ...shapedTo(ground, heightAt),
    ground_z_m: floor,
    roof_footprint: building.roof_footprint.length ? building.roof_footprint : footprint,
    volumes: [baseVolume(`${building.id}:city3d`, footprint, floor, wall, rise, materials, roof.mesh(), m.flat ? 'RF-FLAT' : m.hip ? 'RF-HIP' : 'RF-GABLE', foundation)],
  };
}
