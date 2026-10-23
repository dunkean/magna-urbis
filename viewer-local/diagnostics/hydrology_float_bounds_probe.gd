extends SceneTree
const Data=preload("res://adapters/surface_data.gd")
const Hydro=preload("res://adapters/surface_hydrology.gd")
const Sweep=preload("res://adapters/surface_hydrology_sweep.gd")
const Geometry=preload("res://adapters/surface_geometry.gd")
func _initialize():call_deferred("run")
static func half_ulp(value:float)->float:
	return pow(2.0,-150.0) if absf(value)<1.17549435082229e-38 else pow(2.0,floorf(log(absf(value))/log(2.0))-24.0)
static func bounded_level(water:Dictionary,origin:Dictionary,p:Vector3)->float:
	var x=float(origin.x)+p.x;var z=float(origin.z)+p.z;var spacing=float(water.width)/int(water.n)
	var low_x=float(water.originX)-spacing*.5;var low_z=float(water.originZ)-spacing*.5;var high_x=low_x+float(water.width);var high_z=low_z+float(water.width)
	var eps_x=half_ulp(p.x)+absf(float(origin.x))*2.220446049250313e-16;var eps_z=half_ulp(p.z)+absf(float(origin.z))*2.220446049250313e-16
	if x<low_x-eps_x or x>high_x+eps_x or z<low_z-eps_z or z>high_z+eps_z:return NAN
	return Hydro._level(water,clampf(x,low_x,high_x),clampf(z,low_z,high_z))
func run():
	var args=OS.get_cmdline_user_args();var packet=Data.read_json(args[0]);var source:Dictionary=packet.source;var geometry=Hydro._geometry(source);var original_water:Dictionary=source.water
	var results=[];var passed=true
	for case in [{"width":40000.0,"x":20038.9862060547,"z":20038.9862060547,"tx":0.0,"tz":0.0},{"width":10000.0,"x":20011.76953125,"z":20011.76953125,"tx":0.0,"tz":0.0},{"width":40000.0,"x":20102.9862060547,"z":20102.9862060547,"tx":0.0,"tz":0.0},{"width":40000.0,"x":1000020038.986206,"z":-999979961.013794,"tx":1e9,"tz":-1e9}]:
		var water=original_water.duplicate(false);water.originX=float(water.originX)+case.tx;water.originZ=float(water.originZ)+case.tz
		var origin={"x":case.x,"y":0.0,"z":case.z};var window=Geometry._window({"x":20000.0+case.tx,"y":20000.0+case.tz},case.width);var spacing=float(water.width)/int(water.n)
		window.minX=maxf(window.minX,float(water.originX)-spacing*.5);window.minZ=maxf(window.minZ,float(water.originZ)-spacing*.5);window.maxX=minf(window.maxX,float(water.originX)+(int(water.n)-.5)*spacing);window.maxZ=minf(window.maxZ,float(water.originZ)+(int(water.n)-.5)*spacing)
		var seen={};var strict_missing=0;var fixed_missing=0;var missing_area=0.0;var fixed_area=0.0;var maximum_outside=0.0;var maximum_allowed=0.0;var examples=[];var all_vertices=0
		for group in geometry.water:
			var key=hash(group);var duplicate=false
			for previous in seen.get(key,[]):
				if previous==group:duplicate=true;break
			if duplicate:continue
			if not seen.has(key):seen[key]=[]
			seen[key].append(group)
			var rings=[]
			for ring in group:
				var translated=[]
				for point in ring:translated.append({"x":float(point.x)+case.tx,"y":float(point.y)+case.tz})
				var clipped=Hydro._clip(translated,window)
				if clipped.size()>=3:rings.append(clipped)
			if rings.is_empty():continue
			var mesh=Sweep.triangulate(rings,origin,999996,12000000)
			assert(not mesh.invalid and not mesh.budgetLimited)
			for at in range(0,mesh.vertices.size(),3):
				var strict_valid=true;var fixed_valid=true;var triangle:PackedVector3Array=mesh.vertices.slice(at,at+3)
				for p in triangle:
					all_vertices+=1;var x=float(origin.x)+p.x;var z=float(origin.z)+p.z
					var raw=Hydro._level(water,x,z)
					if not is_finite(raw):
						strict_valid=false
						var fixed=Hydro._level_at_clipped_vertex(water,origin,p)
						if not is_finite(fixed):fixed_valid=false
						var outside=maxf(maxf(float(window.minX)-x,x-float(window.maxX)),maxf(float(window.minZ)-z,z-float(window.maxZ)))
						maximum_outside=maxf(maximum_outside,outside);maximum_allowed=maxf(maximum_allowed,maxf(half_ulp(p.x),half_ulp(p.z)))
						if examples.size()<8:examples.append({"canonicalX":x,"canonicalZ":z,"relativeX":p.x,"relativeZ":p.z,"outsideSupportM":outside,"halfUlpX":half_ulp(p.x),"halfUlpZ":half_ulp(p.z),"boundedLevel":fixed if is_finite(fixed) else null})
				var area=absf((triangle[1]-triangle[0]).cross(triangle[2]-triangle[0]).y)*.5
				if not strict_valid:strict_missing+=1;missing_area+=area
				if not fixed_valid:fixed_missing+=1;fixed_area+=area
		var run_packet=packet.duplicate(false);run_packet.source=source.duplicate(false);run_packet.source.water=water;run_packet.source.geometry=geometry;run_packet.source.sourceToWorldTranslation={"x":case.tx,"z":case.tz}
		var actual=Hydro.prepare(run_packet,packet.world,origin,{"x":20000.0+case.tx,"y":20000.0+case.tz},case.width,{"vertices":PackedVector3Array(),"anchor":origin,"quads":0,"sourceStride":1,"buildMs":0.0})
		passed=passed and actual.get("sourceVectorCoverageComplete",false) and actual.get("missingLevelTriangles",-1)==0
		results.append({"case":case,"productionMissingTriangles":actual.get("missingLevelTriangles"),"productionMissingAreaM2":actual.get("sourceVectorMissingAreaM2"),"productionBoundaryQueriesResolved":actual.get("sourceLevelBoundaryQueriesResolved"),"productionRoundoffM":actual.get("sourceLevelMaximumBoundaryQueryRoundoffM"),"strictMissingTriangles":strict_missing,"strictMissingAreaM2":missing_area,"boundedMissingTriangles":fixed_missing,"boundedMissingAreaM2":fixed_area,"maximumOutsideSupportM":maximum_outside,"maximumHalfUlpM":maximum_allowed,"sourceVertices":all_vertices,"examples":examples})
		passed=passed and fixed_missing==0
	var synthetic={"n":4,"width":40.0,"originX":5.0,"originZ":5.0,"classes":PackedByteArray([2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2]),"levelM":PackedFloat32Array([NAN,NAN,NAN,NAN,NAN,NAN,NAN,NAN,NAN,NAN,NAN,NAN,NAN,NAN,NAN,NAN])}
	passed=passed and not is_finite(bounded_level(synthetic,{"x":20038.9862060547,"z":20038.9862060547},Vector3(-20038.986328125,0,-20038.986328125)))
	synthetic.levelM.fill(7.0)
	passed=passed and not is_finite(bounded_level(synthetic,{"x":20038.9862060547,"z":20038.9862060547},Vector3(-20039.0,0,-20039.0)))
	var report={"sourcePacketSha256":FileAccess.get_sha256(args[0]),"hydrologyShaderAdapterSha256":FileAccess.get_sha256("res://adapters/surface_hydrology.gd"),"passed":passed,"results":results,"scope":"CPU source polygons clipped in float64 before Sweep quantization; compare original measured wet-level queries against a half-FP32-ULP boundary correction only. Interior NaN and genuine out-of-domain remain absent."}
	if args.size()>1:var file=FileAccess.open(args[1],FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "))
	print(JSON.stringify(report));quit(0 if passed else 1)
