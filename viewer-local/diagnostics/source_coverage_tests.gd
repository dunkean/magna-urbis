extends SceneTree
const Data=preload("res://adapters/surface_data.gd")
const Coverage=preload("res://adapters/surface_source_coverage.gd")
var checks=0
func check(value:bool,message:String):
	checks+=1
	if not value:push_error(message);quit(1)
func _initialize():
	var source={"id":"infinite:retained-registration","version":"fixed-generation"}
	var origin={"x":1000000000.0,"z":-1000000000.0}
	var grid={"source":source,"originX":origin.x+10,"originZ":origin.z+10,"width":11,"height":11,"spacingM":1.0}
	var parent_grid=grid.duplicate();parent_grid.originX=origin.x+40
	var a={"minX":origin.x+10.0,"maxX":origin.x+20.0,"minZ":origin.z+10.0,"maxZ":origin.z+20.0}
	var b={"minX":origin.x+40.0,"maxX":origin.x+50.0,"minZ":origin.z+10.0,"maxZ":origin.z+20.0}
	var world={"terrain":grid,"bounds":a,"canonicalContextRef":{"id":"ctx"},"_terrainParents":[{"terrain":parent_grid,"bounds":b,"canonicalContextId":"ctx"}]}
	var before=var_to_bytes(world)
	var domains=Coverage.domains(world)
	check(domains.size()==2,"two disjoint valid source domains")
	check(Coverage.contains(domains,origin.x+15,origin.z+15),"child interior")
	check(Coverage.contains(domains,origin.x+45,origin.z+15),"parent interior")
	check(not Coverage.contains(domains,origin.x+30,origin.z+15),"gap must remain outside, not bounding-box union")
	check(not Coverage.contains(domains,origin.x+9.999,origin.z+15),"outside source boundary")
	check(Coverage.contains(domains,origin.x+10,origin.z+10),"exact source corner retained")
	var point=Coverage.nearest_point(domains,origin.x+30,origin.z+15)
	check(point.x==origin.x+20 and point.z==origin.z+15,"deterministic closest boundary")
	point=Coverage.nearest_point(domains,origin.x+46,origin.z+40)
	check(point.x==origin.x+46 and point.z==origin.z+20,"parent edge clamp rather than distant child")
	var rects=Coverage.rebased_rects(domains,origin)
	check(rects.size()==7,"fixed bounded shader array")
	check(rects[0]==Vector4(10,10,20,20),"double rebase before float32 storage")
	check(rects[1]==Vector4(40,10,50,20),"parent rebase")
	check(rects[6]==Vector4.ZERO,"unused entries zero")
	check(before==var_to_bytes(world),"source dictionaries/IDs/coordinates unchanged")
	var invalid=world.duplicate(true);invalid._terrainParents[0].terrain.source.id="different-generation"
	check(Coverage.domains(invalid).is_empty(),"reject mismatched source lineage")
	invalid=world.duplicate(true);invalid._terrainParents[0].canonicalContextId="other-context"
	check(Coverage.domains(invalid).is_empty(),"reject mismatched canonical binding")
	invalid=world.duplicate(true);invalid.bounds.minX=NAN
	check(Coverage.domains(invalid).is_empty(),"reject nonfinite bounds")
	invalid=world.duplicate(true);invalid.bounds.maxX+=1.0
	check(Coverage.domains(invalid).is_empty(),"reject source coverage beyond actual retained samples")
	invalid=world.duplicate(true)
	for i in 6:invalid._terrainParents.append({"terrain":grid,"bounds":b})
	check(Coverage.domains(invalid).is_empty(),"reject over-budget source domain union")
	# Real Data.prepare on an analytic source plane. No synthetic generation claim:
	# this fixture checks representation buffers and retained native hole controls.
	var heights=PackedFloat32Array([10,11,12,12,13,14,14,15,16])
	var plane_grid={"width":3,"height":3,"originX":0.0,"originZ":0.0,"spacingM":1.0,"heights":heights,"source":source,"reconstruction":"bilinear-samples"}
	var plane_world={"id":"analytic-plane-test","terrain":plane_grid,"bounds":{"minX":0.0,"maxX":2.0,"minZ":0.0,"maxZ":2.0},"fields":{},"_surfaceLayersValidation":{"available":false}}
	var source_bytes=heights.to_byte_array()
	var prepared=Data.prepare(plane_world,{"x":0.0,"y":10.0,"z":0.0},4.0,0,{},true)
	var inside_max=0.0;var edge_max=0.0;var wrong_holes=0
	for row in prepared.height.get_height():
		for col in prepared.height.get_width():
			var x=float(prepared.localStart.x)+col*float(prepared.spacing)
			var z=float(prepared.localStart.z)+row*float(prepared.spacing)
			var inside=x>=0.0 and x<=2.0 and z>=0.0 and z<=2.0
			var expected=clampf(x,0.0,2.0)+2.0*clampf(z,0.0,2.0)
			var error=absf(prepared.height.get_pixel(col,row).r-expected)
			if inside:inside_max=maxf(inside_max,error)
			else:edge_max=maxf(edge_max,error)
			var bytes=PackedByteArray();bytes.resize(4);bytes.encode_float(0,prepared.control.get_pixel(col,row).r)
			if bool(bytes.decode_u32(0)&4)==inside:wrong_holes+=1
	check(inside_max==0.0,"all inside-source represented plane heights remain exact")
	check(edge_max==0.0,"off-domain tessellation support clamps exactly to source plane boundary")
	check(wrong_holes==0,"all native control holes remain present only outside the real source")
	check(source_bytes==heights.to_byte_array(),"source Float32 height bytes unchanged")
	check(prepared.sourceCoverageCount==1,"prepared packet exposes exactly one source domain")
	print(JSON.stringify({"status":"PASS","checks":checks,"scope":"CPU exact domain union/rebase/nearest boundary and source immutability; GPU boundary image is a separate pending proof"}));quit()
