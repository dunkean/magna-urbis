extends SceneTree
const Hydro=preload("res://adapters/surface_hydrology.gd")
const Geometry=preload("res://adapters/surface_geometry.gd")
func _initialize(): call_deferred("run")
func run():
	var failures: Array=[]
	var classes:=PackedByteArray();classes.resize(16);classes.fill(2)
	var levels:=PackedFloat32Array();levels.resize(16);levels.fill(5.0)
	var grid={"width":4,"height":4,"originX":5.0,"originZ":5.0,"spacingM":10.0,"heights":PackedFloat32Array([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0])}
	var world={"terrain":grid,"bounds":{"minX":5.0,"minZ":5.0,"maxX":35.0,"maxZ":35.0},"fields":{"waterClass":classes,"waterLevelM":levels}}
	var outer=[{"x":10.0,"y":10.0},{"x":22.0,"y":10.0},{"x":22.0,"y":22.0},{"x":10.0,"y":22.0}]
	var hole=[{"x":14.0,"y":14.0},{"x":18.0,"y":14.0},{"x":18.0,"y":18.0},{"x":14.0,"y":18.0}]
	var river=[{"x":25.0,"y":8.0},{"x":26.0,"y":8.0},{"x":26.0,"y":32.0},{"x":25.0,"y":32.0}]
	var source={"geometry":{"water":[[outer,hole],[river]]},"water":{"n":4,"width":40.0,"originX":5.0,"originZ":5.0,"classes":classes,"levelM":levels}}
	var packet={"source":source};var origin={"x":20.0,"y":0.0,"z":20.0};var focus={"x":20.0,"y":20.0}
	var fallback=Geometry.build_water(world,origin,focus,40.0)
	var result=Hydro.prepare(packet,world,origin,focus,40.0,fallback)
	if result.get("authority","")!="magna-urbis-fixed-hydrology": failures.append("source authority absent")
	if absf(result.get("sourceVectorAreaM2",0.0)-152.0)>0.00001: failures.append("source widths or island hole area changed")
	if result.has("coverageImage"): failures.append("coarse envelope would clip native vectors")
	if not result.has("classImage") or result.classImage.get_pixel(0,0).r!=2.0: failures.append("source lake category lost")
	for p in result.vertices:
		if p.y!=5.0: failures.append("source water level changed");break
	# Archives are data-only and selective: restore the geometry attachment,
	# without interpreting any other source payload as executable SVG or tags.
	var archived=source.duplicate(false); archived.geometry=null
	archived["$surfaceSourceArchive"]={"format":"surface-source-archive-1","attachments":[{"path":["geometry"],"encoding":"json-utf8","bytes":JSON.stringify(source.geometry).to_utf8_buffer()}]}
	var restored=Hydro.prepare({"source":archived},world,origin,focus,40.0,fallback)
	if restored.vertices!=result.vertices: failures.append("archived source geometry differs")
	# Apply a large COMMON translation without losing the narrow river's width.
	var tx:=20000000.0;var tz:=-10000000.0
	var shifted=source.duplicate(true);shifted.sourceToWorldTranslation={"x":tx,"z":tz};shifted.water.originX+=tx;shifted.water.originZ+=tz
	var shifted_grid=grid.duplicate(false);shifted_grid.originX+=tx;shifted_grid.originZ+=tz
	var shifted_world=world.duplicate(false);shifted_world.terrain=shifted_grid
	var rebased=Hydro.prepare({"source":shifted},shifted_world,{"x":20.0+tx,"y":0.0,"z":20.0+tz},{"x":20.0+tx,"y":20.0+tz},40.0,{})
	if rebased.vertices!=result.vertices: failures.append("native water changes after common translation/rebase")
	var unknown=source.duplicate(true);unknown.water.levelM.fill(NAN)
	var absent=Hydro.prepare({"source":unknown},world,origin,focus,40.0,fallback)
	if not absent.vertices.is_empty() or absent.get("missingLevelTriangles",0)==0: failures.append("missing source levels invented")
	if levels[0]!=5.0 or classes[0]!=2: failures.append("source buffers mutated")
	print(JSON.stringify({"passed":failures.is_empty(),"sourceVectorAreaM2":result.get("sourceVectorAreaM2"),"triangles":result.vertices.size()/3,"failures":failures}))
	quit(0 if failures.is_empty() else 1)
