extends SceneTree
const NativeMaterial=preload("res://adapters/surface_native_material.gd")
const Presentation=preload("res://adapters/surface_presentation.gd")
const Geometry=preload("res://adapters/surface_geometry.gd")
func _initialize():call_deferred("run")
func run():
	var slots={"coating":"MAT-PLASTER-LIME","infill":"MAT-BURNT-BRICK","cladding":"MAT-TILE-CLAY","roof_frame":"MAT-TIMBER-POST"};var before=slots.duplicate(true);var failures=[]
	for absent in [null,7,true,{},[]]:
		if NativeMaterial.resolve(absent,slots,"wall")!="MAT-PLASTER-LIME":failures.append("Non-string optional material bypassed native wall slots")
	for id in ["opaque:id 0/<null>","<null>","  opaque id  "]:
		if NativeMaterial.resolve(id,slots,"wall")!=id:failures.append("Opaque string ID changed")
	if NativeMaterial.resolve(null,slots,"roof")!="MAT-TILE-CLAY":failures.append("Roof fallback role changed")
	if NativeMaterial.resolve(null,{"coating":null,"infill":42,"frame":"native-frame"},"wall")!="native-frame":failures.append("Malformed slot value became a display ID")
	var triangle={"points":[[0.0,0.0,0.0],[1.0,0.0,0.0],[0.0,1.0,0.0]],"normal":[0.0,0.0,1.0],"surface":"wall","materials":slots,"material":null}
	var packet={"urban":{"buildings":[{"id":"authored-wall","nativeRealization":true,"groundHeightM":0.0,"footprint":[],"triangles":[triangle]}]}}
	var world={"id":"authored","terrain":{"width":2,"height":2,"originX":0.0,"originZ":0.0,"spacingM":1.0,"heights":PackedFloat32Array([0,0,0,0])},"bounds":{"minX":0.0,"minZ":0.0,"maxX":1.0,"maxZ":1.0}}
	var mesh=Geometry.build_urban(packet,world,{"x":0.0,"y":0.0,"z":0.0},{"x":.5,"y":.5},10.0)
	if mesh.materialGroups.is_empty() or mesh.materialGroups[0].materialId!="MAT-PLASTER-LIME":failures.append("Geometry coerced null to a literal display ID")
	var material=Presentation.building_material(null,slots,"wall",{},"aerial")
	if material.get_meta("nativeMaterialId")!="MAT-PLASTER-LIME":failures.append("Presentation disagrees with geometry fallback")
	if slots!=before or triangle.material!=null or not triangle.has("material"):failures.append("Raw source material presence/null/slots changed")
	print(JSON.stringify({"passed":failures.is_empty(),"failures":failures,"scope":"Native display material binding only; explicit opaque IDs retained, null/non-string fallback follows original role slots without mutating source"}));quit(0 if failures.is_empty() else 1)
