extends SceneTree
const Plan=preload("res://adapters/surface_visibility_plan.gd")
const Geometry=preload("res://adapters/surface_geometry.gd")
var checks=0
func _initialize()->void:call_deferred("run")
func verify(value:bool,message:String)->void:
	checks+=1
	if not value:push_error(message);quit(1);assert(value,message)
func terrain(n:int,spacing:float,offset:float=0.0,cubic:bool=false)->Dictionary:
	var heights=PackedFloat32Array();heights.resize(n*n)
	for z in n:
		for x in n:heights[z*n+x]=0.0
	return {"originX":offset-float(n-1)*spacing*.5,"originZ":offset-float(n-1)*spacing*.5,"width":n,"height":n,"spacingM":spacing,"heights":heights,"reconstruction":"cubic-bspline-controls" if cubic else "bilinear-samples","source":{"id":"test-real-height-array","version":"1","nativeSpacingM":spacing}}
func world_for(g:Dictionary)->Dictionary:
	return {"id":"authored-control-test","terrain":g,"bounds":{"minX":g.originX,"minZ":g.originZ,"maxX":float(g.originX)+(int(g.width)-1)*float(g.spacingM),"maxZ":float(g.originZ)+(int(g.height)-1)*float(g.spacingM)},"canonicalContextRef":{"id":"context-a"},"versions":{"terrain":"height-a"}}
func run()->void:
	var viewport=SubViewport.new();viewport.size=Vector2i(200,125);viewport.render_target_update_mode=SubViewport.UPDATE_DISABLED;root.add_child(viewport)
	var camera=Camera3D.new();viewport.add_child(camera);camera.current=true;camera.fov=48;camera.near=1;camera.far=1200;camera.position=Vector3(0,80,80);camera.look_at(Vector3.ZERO)
	var g=terrain(65,16.0);g.heights[0]=-150.0
	var w=world_for(g);var original=g.heights.to_byte_array().duplicate()
	var origin={"x":0.0,"y":0.0,"z":0.0};var snap=Plan.snapshot(camera,Vector2(200,125),origin)
	var page={"complete":true,"bounds":{"minX":-500.0,"minZ":-500.0,"maxX":500.0,"maxZ":500.0}}
	var plan=Plan.build(w,w,snap,origin,.625,page,{"crownHeightM":32.0,"haloM":40.0})
	verify(plan.available,"small oblique source has a bounded plan")
	verify(plan.heightEnvelopeWorld[0]>-100.0,"offscreen valley is not substituted as a global infinite height plane")
	verify(plan.residentImageSize in [512,1024,2048],"resident size preserves Terrain3D region alignment")
	verify(Plan._encloses(plan.residentBounds,plan.atlasBounds),"same job resident contains atlas and padding")
	verify(original==g.heights.to_byte_array(),"planning does not mutate physical source")
	for z in range(-250,251,10):
		for x in range(-250,251,10):
			for y in [0.0,32.0]:
				if camera.is_position_in_frustum(Vector3(x,y,z)):
					verify(x>=float(plan.visibleBounds.minX) and x<=float(plan.visibleBounds.maxX) and z>=float(plan.visibleBounds.minZ) and z<=float(plan.visibleBounds.maxZ),"visible real source support must be included")
	var safe=Plan._intersect(plan.residentBounds,plan.atlasBounds)
	var guard=Plan.guard(plan,w,snap,safe,40.0,0.0)
	verify(guard.safePhase==2.0,"planned resident padding supplies a complete-frustum certificate")
	verify(Plan.guard(plan,w,snap,safe,40.0,100000.0).safePhase==0.0,"invalid fixed-reference homography endpoints require phase0, not merely phase1")
	var stale=snap.duplicate(true);stale.position.x+=.01
	verify(Plan.guard(plan,w,stale,plan.residentBounds,40,0).safePhase==0,"camera changed => no stale geometry")
	verify(Plan.guard(plan,w.duplicate(true),snap,plan.residentBounds,40,0).safePhase==0,"different immutable source snapshot => no stale geometry")
	verify(not Plan.build(w,w,snap,origin,.625,page,{"maxSamples":4}).available,"memory budget checked before index allocation")
	verify(Plan.build(w,w,snap,origin,.625,page,{"maxVisits":1}).reason=="visibility-node-budget","bounded walk fails explicitly")
	verify(Plan.build(w,w,snap,origin,.01,page).reason=="resident-height-budget","cannot silently enlarge resident beyond aligned cap")
	verify(Plan.build(w,w,snap,origin,.625,page,{"maxEstimatedWorkingBytes":32}).reason=="estimated-working-memory-budget","resident/atlas/index/upload estimate has an explicit fail-closed byte budget")
	verify(Plan.build(w,w,snap,origin,.625,page,{"maxResidentSide":1025}).reason=="invalid-resident-size-budget","budget cannot accidentally round up past requested side")
	verify(not Plan.build(w,w,snap,origin,.625,{"complete":true,"bounds":w.bounds}).available or Plan._encloses(w.bounds,plan.atlasBounds),"small page is never announced as complete coverage")
	var repeated=Plan.build(w,w,snap,origin,.625,page,{"crownHeightM":32.0,"haloM":40.0})
	verify(repeated.visibleBounds==plan.visibleBounds,"cached min/max hierarchy produces same exact plan")
	var cubic=terrain(9,8.0,0.0,true);cubic.heights[2*9+2]=100.0
	var index=Plan._index(cubic)
	var b={"minX":-8.0,"minZ":-8.0,"maxX":0.0,"maxZ":0.0};var interval=Plan.control_range(index,b)
	verify(interval[1]==100.0,"B-spline source range includes outer16-tap controls")
	for z in 9:
		for x in 9:
			var value=Geometry.sample_height(cubic,-8+x, -8+z)
			verify(value>=interval[0] and value<=interval[1],"positive cubic kernel lies inside contributing control extrema")
	var moved=w.duplicate(true);var offset=1000000000.125
	moved.terrain.originX+=offset;moved.terrain.originZ-=offset
	for k in ["minX","maxX"]:moved.bounds[k]+=offset
	for k in ["minZ","maxZ"]:moved.bounds[k]-=offset
	var moved_snap=snap.duplicate(true);moved_snap.position.x+=offset;moved_snap.position.z-=offset
	var moved_origin={"x":offset,"y":0.0,"z":-offset};var moved_page=page.duplicate(true)
	for k in ["minX","maxX"]:moved_page.bounds[k]+=offset
	for k in ["minZ","maxZ"]:moved_page.bounds[k]-=offset
	var translated=Plan.build(moved,moved,moved_snap,moved_origin,.625,moved_page,{"crownHeightM":32.0,"haloM":40.0})
	verify(translated.available,"double world-frame rebase remains valid")
	verify(absf(float(translated.visibleBounds.minX)-offset-float(plan.visibleBounds.minX))<.000001,"absolute1e9 origin is not rounded in Vector2")
	verify(absf(float(translated.visibleBounds.minZ)+offset-float(plan.visibleBounds.minZ))<.000001,"negative1e9 origin preserves local support")
	# Parent/child feather values are convex combinations, not either source in
	# isolation. Include both source intervals and the actual prefiltered display.
	var child=world_for(terrain(17,2.0));child.terrain.heights.fill(-40.0)
	var parent=world_for(terrain(65,16.0,0.0,true));parent.terrain.heights.fill(40.0)
	child["_terrainParents"]=[{"bounds":parent.bounds,"terrain":parent.terrain,"canonicalContextId":"context-a"}]
	var seam_plan=Plan.build(child,child,snap,origin,1.25,page,{"crownHeightM":32.0})
	verify(seam_plan.available and seam_plan.heightEnvelopeWorld[0]<=-40.0 and seam_plan.heightEnvelopeWorld[1]>=72.0,"source seam certificate unions parent and child control ranges")
	for z in range(-16,17,2):
		for x in range(-16,17,2):
			var support=Geometry.height_at(child,x,z)
			verify(support>=seam_plan.heightEnvelopeWorld[0] and support<=seam_plan.heightEnvelopeWorld[1],"real feathered support is inside source envelope")
	var filtered=w.duplicate(true);filtered.terrain.heights.fill(10.0)
	var filter_plan=Plan.build(w,filtered,snap,origin,1.25,page,{"crownHeightM":32.0})
	verify(filter_plan.available and filter_plan.heightEnvelopeWorld[1]>=42.0,"display prefilter extrema and original tree support are both bounded")
	var array_source=w.duplicate(true);array_source.terrain.heights=Array(g.heights)
	var array_plan=Plan.build(array_source,array_source,snap,origin,.625,page,{"crownHeightM":32.0,"haloM":40.0})
	verify(array_plan.available and array_plan.visibleBounds==plan.visibleBounds,"legacy JSON arrays and binary float controls produce the same certificate")
	var wrong_display=w.duplicate(true);wrong_display.terrain.source.version="other"
	verify(Plan.build(w,wrong_display,snap,origin,1.25,page).reason=="display-source-lineage-mismatch","display controls cannot bind a different source version")
	var invalid=child.duplicate(true);invalid._terrainParents[0].canonicalContextId="stale"
	verify(Plan.build(invalid,invalid,snap,origin,1.25,page).reason=="invalid-source-lineage-or-domain","parent context mismatch never makes a visibility certificate")
	invalid=w.duplicate(true);invalid.terrain.heights[0]=NAN
	verify(Plan.build(invalid,invalid,snap,origin,1.25,page).reason=="nonfinite-source-controls","unknown controls cannot be certified")
	invalid=w.duplicate(true);invalid.terrain.reconstruction="unknown"
	verify(Plan.build(invalid,invalid,snap,origin,1.25,page).reason=="unsupported-height-kernel","only declared nonnegative kernels may use control extrema")
	var token=preload("res://adapters/surface_prepare_control.gd").new(1,1,"shown","shown");token.request_cancel(2,1)
	var cancelled_world=w.duplicate(true)
	Plan.build(cancelled_world,cancelled_world,snap,origin,1.25,page,{"prepareControl":token})
	verify(token.report().reached and token.report().stage=="visibility-index-controls","index construction has an actual cancellation checkpoint")
	verify(not Plan.describe(plan).has("_world") and not Plan.describe(plan).has("camera"),"report never serializes world arrays or native projection objects")
	var unsupported=world_for(terrain(9,1.0))
	verify(Plan.build(unsupported,unsupported,snap,origin,.625,page).reason=="tree-page-has-unknown-height-support","complete tree inventory cannot invent missing parent heights")
	verify(not Plan._covered_rectangle({"minX":0,"maxX":10,"minZ":0,"maxZ":10},[{"minX":0,"maxX":4,"minZ":0,"maxZ":10},{"minX":6,"maxX":10,"minZ":0,"maxZ":10}]),"disjoint physical rectangles do not cover their bounding-box gap")
	print(JSON.stringify({"test":"oblique-visibility-plan","checks":checks,"result":"PASS","visitedNodes":plan.visitedNodes,"residentImageSize":plan.residentImageSize,"sourceHeightEnvelope":plan.heightEnvelopeWorld,"scope":"small authored CPU source controls only; retained V12 oblique/GPU remain unqualified"}));quit()
