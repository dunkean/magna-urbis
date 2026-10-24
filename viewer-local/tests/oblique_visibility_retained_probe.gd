extends SceneTree
# CPU only. Read retained packet + original metrics; do not generate/register NN.
const Data=preload("res://adapters/surface_data.gd")
const Plan=preload("res://adapters/surface_visibility_plan.gd")
const Canopy=preload("res://adapters/surface_canopy.gd")
func _initialize()->void:call_deferred("run")
func physical_hash(world:Dictionary)->String:
	var hash=HashingContext.new();hash.start(HashingContext.HASH_SHA256)
	for layer in preload("res://adapters/surface_geometry.gd").prepare_height_layers(world):hash.update(layer.terrain.heights.to_byte_array())
	for fields in [world.fields,world.get("canonicalContext",{}).get("fields",{})]:
		var keys=fields.keys();keys.sort()
		for key in keys:
			hash.update(str(key).to_utf8_buffer())
			var value=fields[key]
			if value.size()>0:
				if value is PackedByteArray:hash.update(value)
				elif value is Array:hash.update(var_to_bytes(value))
				else:hash.update(value.to_byte_array())
	return hash.finish().hex_encode()
func run()->void:
	var args=OS.get_cmdline_user_args()
	if args.size()<3 or args.size()>4:push_error("packet.surfacebin old-oblique-metrics.json output.json [--prepare-resident]");quit(2);return
	var bytes=FileAccess.get_file_as_bytes(args[0]);var packet=Data.decode_packet(bytes)
	if packet.is_empty():push_error("Invalid retained packet");quit(2);return
	var world=Data.unpack_world(packet);var context_id=str(world.get("canonicalContextRef",{}).get("id",""));var parents=[]
	for parent in packet.get("terrainParents",[]):
		if str(parent.get("canonicalContextId",context_id))!=context_id or parent.terrain.source.id!=world.terrain.source.id or parent.terrain.source.version!=world.terrain.source.version:push_error("Parent binding mismatch");quit(2);return
		parents.append(parent)
	world["_terrainParents"]=parents
	var physical_before=physical_hash(world)
	var metrics=Data.read_json(args[1]);var focus:Dictionary=metrics.renderedSnapshot.focusAtApply;var width_m=160.0
	var size=Vector2(float(metrics.resolution[0]),float(metrics.resolution[1]))
	var spacing=Data.display_spacing(world.terrain,width_m)
	var snap_step=spacing*64.0;var ox=float(world.terrain.originX)+round((float(focus.x)-float(world.terrain.originX))/snap_step)*snap_step;var oz=float(world.terrain.originZ)+round((float(focus.y)-float(world.terrain.originZ))/snap_step)*snap_step
	var origin={"x":ox,"y":Data.height_at(world,ox,oz),"z":oz}
	var viewport=SubViewport.new();viewport.size=Vector2i(size);viewport.render_target_update_mode=SubViewport.UPDATE_DISABLED;root.add_child(viewport)
	var camera=Camera3D.new();viewport.add_child(camera);camera.current=true;camera.fov=48
	var target=Vector3(float(focus.x)-ox,Data.height_at(world,float(focus.x),float(focus.y))-float(origin.y),float(focus.y)-oz)
	var distance=width_m/(2.0*tan(deg_to_rad(camera.fov)*.5)*size.aspect())
	camera.position=target+Vector3(0,.73,.68).normalized()*distance
	var camera_ground=Data.height_at(world,float(camera.position.x)+ox,float(camera.position.z)+oz)-float(origin.y)
	camera.position.y=maxf(camera.position.y,camera_ground+maxf(.05,width_m*.003))
	var distance_to_target=camera.position.distance_to(target);camera.near=maxf(.01,distance_to_target*.01)
	camera.far=maxf(maxf(camera.near+100.0,distance_to_target+width_m*3.0),camera.position.y-(float(world._heightRange.x)-float(origin.y))+width_m*.1)
	camera.look_at(target,Vector3.UP)
	var tick=Time.get_ticks_usec();var display=Data.build_display_source(world,spacing);var display_ms=(Time.get_ticks_usec()-tick)/1000.0
	var cases=[];var resident_measurement={}
	for crown in [20.0,32.0]:
		tick=Time.get_ticks_usec()
		var plan=Plan.build(world,display,Plan.snapshot(camera,size,origin),origin,spacing,Canopy.tree_page(packet),{"crownHeightM":crown,"haloM":40.0})
		var elapsed=(Time.get_ticks_usec()-tick)/1000.0
		var info=Plan.describe(plan);info["buildMs"]=elapsed
		if plan.get("available",false):
			var safe=preload("res://adapters/surface_canopy_view.gd").intersection(plan.residentBounds,plan.atlasBounds)
			var guard=Plan.guard(plan,world,Plan.snapshot(camera,size,origin),safe,40.0,Data.height_at(world,float(focus.x),float(focus.y)))
			info["guard"]=preload("res://adapters/surface_canopy_view.gd").certify_filter(guard,float(plan.atlasGridEstimate.spacingM),Vector2(plan.atlasGridEstimate.width,plan.atlasGridEstimate.height))
			if args.size()==4 and args[3]=="--prepare-resident" and crown==32.0:
				tick=Time.get_ticks_usec()
				var resident=Data.prepare(world,plan.residentOrigin,width_m,1,packet,true,display,false,{"visibilityResidentImageSize":plan.residentImageSize})
				var elapsed_ms=(Time.get_ticks_usec()-tick)/1000.0;var maximum_error=0.0
				var side=int(plan.residentImageSize)
				var points=[2,int(side/16),int(side/4),int(side/2),int(side*3/4),int(side*15/16),side-4]
				for iz in points:
					for ix in points:
						var x=float(plan.residentOrigin.x)+float(resident.localStart.x)+ix*spacing;var z=float(plan.residentOrigin.z)+float(resident.localStart.z)+iz*spacing
						var expected=Data.height_at(display,x,z)-float(plan.residentOrigin.y)
						maximum_error=maxf(maximum_error,absf(float(resident.height.get_pixel(ix,iz).r)-expected))
				resident_measurement={"prepareMs":elapsed_ms,"size":resident.height.get_width(),"spacingM":resident.spacing,"sampleChecks":49,"maximumRfStorageErrorM":maximum_error,"heightBytes":side*side*4,"controlBytes":side*side*4,"rfFormatValidated":resident.height.get_format()==Image.FORMAT_RF and resident.control.get_format()==Image.FORMAT_RF,"loadedHeightRangeWorld":[resident.loadedHeightRangeWorld.x,resident.loadedHeightRangeWorld.y],"scope":"CPU Data.prepare only; no Terrain3D import/GPU or navigation latency claim"}
		cases.append(info)
	var hash=HashingContext.new();hash.start(HashingContext.HASH_SHA256);hash.update(bytes)
	var physical_after=physical_hash(world)
	var report={"scope":"CPU retained source-control plan only; no GPU/import/instance qualification; old V12 phase0 counterexample unchanged","sourcePacket":args[0],"sourceSha256":hash.finish().hex_encode(),"physicalBeforeSha256":physical_before,"physicalAfterSha256":physical_after,"physicalHeightAndFieldBytesUnchanged":physical_before==physical_after,"oldMetrics":args[1],"oldPhase":metrics.canopyView.phase,"oldMarginM":metrics.canopyView.marginM,"origin":origin,"focus":focus,"resolution":[size.x,size.y],"widthM":width_m,"displaySpacingM":spacing,"displaySourceBuildMs":display_ms,"cases":cases,"residentPreparation":resident_measurement}
	var file=FileAccess.open(args[2],FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));file.close()
	print(JSON.stringify({"test":"retained-oblique-visibility","output":args[2],"cases":[{"available":cases[0].available,"reason":cases[0].reason,"ms":cases[0].buildMs},{"available":cases[1].available,"reason":cases[1].reason,"ms":cases[1].buildMs}],"scope":report.scope}));quit()
