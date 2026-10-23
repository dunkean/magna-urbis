extends SceneTree
const Presentation=preload("res://adapters/surface_presentation.gd")
const Urban=preload("res://adapters/urban_reader.gd")
func _initialize(): call_deferred("run")
func run():
	var failures=[]
	var path=OS.get_cmdline_user_args()[0] if not OS.get_cmdline_user_args().is_empty() else ""
	var packet={"presentation":{"defaultView":"aerial","mapStyle":"source","palette":{"paper":"#ffffff","urban":{"mass":"#111111"}}}}
	if not path.is_empty():
		var catalogue=JSON.parse_string(FileAccess.get_file_as_string(path))
		for style in catalogue.terrainStyles:
			var value=Presentation.profile(Presentation.overrides(packet,style,path),"cartographic")
			if value.mapStyle!=style or value.palette!=catalogue.terrainStyles[style].palette: failures.append("shared terrain style changed:"+style)
	for legacy in [{"source":{"presentation":null}},{"presentation":null},{"presentation":{"palette":null}},{"source":null}]:
		if Presentation.profile(legacy,"cartographic").mode!="cartographic":failures.append("nullable legacy presentation")
	var env=Environment.new(); env.ssao_enabled=true; env.fog_enabled=true
	Presentation.configure_environment(env,"cartographic",packet)
	if env.ambient_light_source!=Environment.AMBIENT_SOURCE_COLOR or env.ambient_light_energy!=1.0 or env.tonemap_mode!=Environment.TONE_MAPPER_LINEAR or env.ssao_enabled: failures.append("cartographic ambient profile")
	Presentation.configure_environment(env,"aerial",packet)
	if not env.ssao_enabled or not env.fog_enabled: failures.append("aerial environment restoration")
	var one=Presentation.building_material("native",{},"roof",packet,"cartographic")
	var changed=packet.duplicate(true); changed.presentation.palette.urban.mass="#222222"
	var two=Presentation.building_material("native",{},"roof",changed,"cartographic")
	if one==two: failures.append("source palette cache collision")
	var empty={"format":"magna-urban-columns","version":1,"buildings":[],"roads":[],"positions":[],"normals":[],"surfacePositions":[],"roadPositions":[],"buildingTriangleOffsets":[0],"triangleSlots":[],"triangleMaterial":[],"triangleMaterialPresence":[],"triangleSurface":[],"surfaceShapeOffsets":[0],"shapeRingOffsets":[0],"ringPointOffsets":[0],"roadPointOffsets":[0],"materialSlotsTable":[],"materialIds":[]}
	if not Urban.validate(empty): failures.append("empty packed city")
	for value in [null,4,"malformed",{},["a"],[NAN]]:
		var broken=empty.duplicate(true); broken.positions=value
		if Urban.validate(broken): failures.append("malformed urban column accepted")
	print(JSON.stringify({"passed":failures.is_empty(),"failures":failures})); quit(0 if failures.is_empty() else 1)
