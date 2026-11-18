/**
 * Silhouette footprints converted to display building volumes. Called by the City 3D scene adapter and sibling mesh builders.
 * Reads/writes: Reads source building, massing and height/water samplers; constructs local roof/volume records without changing the source.
 */
import { mushroomDwellingCap } from '../city3dMushroom';
import type { PlacedBuilding } from '../../../../rust/bridge/urbanArchitecture';
import { surfaceTriangles, MINOR_VOLUME_ROLE } from '../urbanBuildingGeometry';
import { pieceVolumes, readMassing, scaledRing, stiltDeck, stiltSupports, volumeRoof } from '../cityMassing';
import { lightCrowns } from '../cityTrees';
import { City3dHeight } from './types';
import { surfaceArea, ringCentre, RoofBuilder, flatRoof, orientedBox, ringArea, ridgeRoof, insetRoof } from './roofGeometry';
import { massingSlots, WALLS, COVERS, paletteSlots, TREE_CROWNS, slots, WALL_ID, COVER_ID } from './materials';
import { silhouetteMassing, Programme, hash, CITY3D_LEVEL_M } from './massing';
import { footprintTerrain, terrainSeat } from './terrainSeat';
import { treeDetails, stiltPosts } from './treeDwelling';
import { baseVolume } from './volume';
import { featureBox, overhang, standingFeatures } from './features';
import { volumeDetails } from './volumeDetails';

/** Extruded silhouette: walls of `floors × 3 m`, a gable or hip roof on
 * rectangular shapes, a pitched border elsewhere, a foundation down to the lowest
 * terrain sample under the whole footprint so no wall floats above a slope or a cliff. */
export function silhouetteBuilding(building: PlacedBuilding, heightAt?: City3dHeight, waterAt?: City3dHeight, lightTrees = false): PlacedBuilding {
  const footprint = building.footprint,
    area = surfaceArea(footprint),
    m = silhouetteMassing(building, area);
  const culture = building.culture.culture,
    programme = (building as PlacedBuilding & { programme?: Programme }).programme;
  const role = `${programme?.role ?? ''} ${m.family}${programme?.landmark ? ' monument' : ''}`;
  const terrain = heightAt ? footprintTerrain(footprint, heightAt) : undefined,
    low = terrain?.low ?? NaN;
  // Silhouette plans may carry a zero/centre reference, not a terrain footing.
  // A level floor clears the high side of a hillside (clamping that reference to the
  // low side buries terraces and pyramids); against a cliff it stands on a retaining plinth.
  let ground = terrain ? terrainSeat(terrain) : Number.isFinite(building.ground_z_m) ? building.ground_z_m : 0;
  const massing = readMassing((building as PlacedBuilding & { programme?: unknown }).programme, footprint, building.id);
  const raised = massing?.some((m, i) => pieceVolumes(footprint[i], m).some(v => (v.detail?.stilts_m ?? 0) > 0));
  if (raised && waterAt)
    for (const shape of footprint)
      for (const p of [...shape.outer, ringCentre(shape.outer)]) {
        const water = waterAt(p.x, p.y);
        if (Number.isFinite(water)) ground = Math.max(ground, water);
      }
  if (massing) {
    // City massing (cityMassing.ts): one volume per preview piece, its own height and roof.
    const foundation = { footprint, z_min_m: Math.min(ground, Number.isFinite(low) ? low : ground) - 0.3, z_max_m: ground };
    const volumes = footprint.flatMap((shape, i) => {
      const piece = massing[i];
      if (!piece) return [];
      return pieceVolumes(shape, piece).map((v, j) => {
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
          volume.envelope = 'open';
          return volume;
        }
        const over = v.detail?.overhang_m ?? 0,
          centre = ringCentre(v.shape.outer),
          lift = v.detail?.stilts_m ?? 0;
        const body = wallId;
        if (lift > 0) {
          stiltPosts(roof, stiltDeck(v.shape.outer), ground, lift, wallId, materials.roof_frame);
          for (const p of stiltSupports(v.shape.outer)) featureBox(roof, p.x, p.y, 0.32, 0.32, lift + 0.45, 0, ground, materials.roof_frame);
        }
        // `base` is the level the heights of the volume are measured from; its walls start `raisedBy` above it.
        const base = ground + lift,
          raisedBy = v.base_m ?? 0;
        const form = v.detail?.form,
          organic = form === 'tree' || form === 'mushroom';
        // Crowns and trunks get forest-green display materials (urbanBuilding3d.ts paints them).
        const greens = form === 'tree',
          crown = greens ? 'city3d:tree:crown@5f8247' : materials.cladding;
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
            else roof.face(points, crown);
            // Explicit pans already carry their eaves: no skirt is added to them.
            if (over > 0 && !v.pans) overhang(roof, points, base + v.eave_m, centre, over, crown);
          }
        for (const gable of v.gables ?? [])
          roof.gable(
            gable.map(p => ({ ...p, z: p.z + base })),
            wallId,
            centre,
          );
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
        } else volumeDetails(roof, v, base, body, `${building.id}:${i}:${j}`);
        const standing = roof.faces.length;
        standingFeatures(roof, v, base);
        const system = v.roof === 'flat' ? 'RF-FLAT' : v.roof === 'hip' || v.roof === 'pyramid' || v.roof === 'tent' ? 'RF-HIP' : 'RF-GABLE';
        // Ruin stubs and mounds (massing.rs `ruin_piece`) run their walls down to the footing: no plinth box, half the triangles.
        // A volume standing on another one has neither footing nor plinth: its walls run from its base to its eave.
        const ruin = v.cover === 'ruin' && lift <= 0 && !raisedBy,
          z0 = ruin ? foundation.z_min_m : base + raisedBy;
        const volume = baseVolume(
          `${building.id}:city3d:${i}:${j}`,
          [v.shape],
          base + raisedBy,
          v.eave_m - raisedBy,
          Math.max(0, v.rise_m),
          materials,
          roof.mesh(),
          system,
          { ...foundation, footprint: ruin || raisedBy ? [] : [bodyShape], z_max_m: lift > 0 ? foundation.z_min_m : ground },
          [{ index: 0, footprint: [bodyShape], z_m: z0, height_m: v.eave_m + base - z0 }],
        );
        if (form === 'battered') volume.envelope = 'open';
        // Sails and wheels stay on the overview body of the volume (urbanBuildingGeometry.ts).
        if (roof.faces.length > standing) (volume as typeof volume & { overview_faces?: [number, number] }).overview_faces = [standing, roof.faces.length];
        // The overview LOD drops small decorative volumes (urbanBuildingGeometry.ts).
        if (v.minor) volume.role = MINOR_VOLUME_ROLE;
        return volume;
      });
    });
    const treeCrowns = massing.some(p => p.volumes?.some(v => v.form === 'tree'));
    return { ...building, ground_z_m: ground, roof_footprint: treeCrowns ? volumes.flatMap(v => v.footprint) : building.roof_footprint.length ? building.roof_footprint : footprint, volumes };
  }
  const plain = slots(m.wall, m.roof),
    materials = paletteSlots(plain, culture, WALL_ID[m.wall].split(':')[1], COVER_ID[m.roof].split(':')[1], hash(building.id) / 0xffffffff, role);
  const wall = m.floors * CITY3D_LEVEL_M,
    eave = ground + wall,
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
  const foundation = { footprint, z_min_m: Math.min(ground, Number.isFinite(low) ? low : ground) - 0.3, z_max_m: ground };
  return {
    ...building,
    ground_z_m: ground,
    roof_footprint: building.roof_footprint.length ? building.roof_footprint : footprint,
    volumes: [baseVolume(`${building.id}:city3d`, footprint, ground, wall, rise, materials, roof.mesh(), m.flat ? 'RF-FLAT' : m.hip ? 'RF-HIP' : 'RF-GABLE', foundation)],
  };
}
