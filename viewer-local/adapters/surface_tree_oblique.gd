class_name SurfaceTreeOblique
extends RefCounted
const Views=preload("res://adapters/surface_tree_oblique_library.gd")
const Trees=preload("res://adapters/surface_tree_library.gd")
const Visibility=preload("res://adapters/surface_visibility_plan.gd")
const Canopy=preload("res://adapters/surface_canopy.gd")

static func _visible(box:AABB,planes:Array)->bool:
	var centre=box.get_center();var half=box.size*.5
	for plane:Vector4 in planes:
		if Vector3(plane.x,plane.y,plane.z).dot(centre)+plane.w < -Vector3(plane.x,plane.y,plane.z).abs().dot(half)-.001:return false
	return true

# Complete source tree data, packed on the worker. No100k Dictionary expansion.
static func prepare(data:Dictionary,camera:Dictionary,origin:Dictionary,high_bounds:AABB,high_triangles:int,max_high:int=14)->Dictionary:
	if not data.get("available",false) or camera.is_empty():return {"available":false,"reason":data.get("reason","missing-source-camera")}
	var values:PackedFloat64Array=data.values;var names:PackedStringArray=data.ids
	var planes=Visibility._planes(camera);var candidates=[];var visible_support=0;var maximum_error=0.0;var grid=Views.directions()
	var source_view:Basis=camera.basis.inverse();var projection:Projection=camera.projection
	for i in int(data.count):
		var at=i*6;var h=values[at+3];var radius=float(data.radii[i])
		var delta=Vector3(values[at]-float(camera.position.x),values[at+1]-float(camera.position.y)+h*.5,values[at+2]-float(camera.position.z))
		var view=source_view*delta;var denominator=1.0 if projection.w.w>.5 else maxf(.001,-view.z)
		var pixels=2.0*radius*absf(projection.y.y)*float(camera.viewport.y)/(2.0*denominator)
		# The complete proxy support includes non-alpha card parts. It may yield
		# false positives, never a centre-only rejection of a visible crown.
		var bound=AABB(Vector3(-1.132,-.632,-1.132),Vector3(2.264,2.264,2.264))
		var local=Vector3(values[at]-float(camera.position.x),values[at+1]-float(camera.position.y),values[at+2]-float(camera.position.z))
		var support=Transform3D(Basis(Vector3.UP,values[at+4]).scaled(Vector3.ONE*h),local)*bound
		if not _visible(support,planes):continue
		visible_support+=1
		var to_eye=Basis(Vector3.UP,-values[at+4])*(-delta)
		var selected=Views.nearest(to_eye,grid);maximum_error=maxf(maximum_error,rad_to_deg(acos(clampf(to_eye.normalized().dot(grid[selected]),-1,1))))
		if pixels<500:continue
		var c={"stableId":names[i],"family":"tree","x":values[at],"y":values[at+1],"z":values[at+2],"size":h,"crownRadiusM":radius,"orientation":values[at+4],"rank":values[at+5],"canopyClass":Canopy.radius_class(radius),"sourceIndex":i,"physicalPixels":pixels}
		if _visible(Trees.transformed_support(c,camera.position,high_bounds),planes):candidates.append(c)
	if maximum_error>30.0:return {"available":false,"reason":"source-view-outside-qualified-direction-grid","maximumViewErrorDegrees":maximum_error}
	candidates.sort_custom(func(a,b):return a.physicalPixels>b.physicalPixels if a.physicalPixels!=b.physicalPixels else a.stableId<b.stableId)
	var chosen={};var high=[]
	for i in mini(mini(max_high,2000000/maxi(high_triangles,1)),candidates.size()):high.append(candidates[i]);chosen[int(candidates[i].sourceIndex)]=true
	var buffer=PackedFloat32Array();buffer.resize((int(data.count)-high.size())*20)
	var row=0;var low=Vector3(INF,INF,INF);var upper=Vector3(-INF,-INF,-INF)
	for i in int(data.count):
		if chosen.has(i):continue
		var source=i*6;var at=row*20;row+=1;var h=values[source+3];var r=float(data.radii[i]);var horizontal=r/.42;var c=cos(values[source+4]);var s=sin(values[source+4])
		var p=Vector3(values[source]-float(origin.x),values[source+1]-float(origin.y),values[source+2]-float(origin.z))
		# Bake already contains radius/height.42. Runtime scale is UNIFORM height.
		buffer[at]=c*horizontal;buffer[at+1]=0;buffer[at+2]=s*horizontal;buffer[at+3]=p.x
		buffer[at+4]=0;buffer[at+5]=h;buffer[at+6]=0;buffer[at+7]=p.y
		buffer[at+8]=-s*horizontal;buffer[at+9]=0;buffer[at+10]=c*horizontal;buffer[at+11]=p.z
		buffer[at+12]=1;buffer[at+13]=1;buffer[at+14]=1;buffer[at+15]=1
		buffer[at+16]=h;buffer[at+17]=Canopy.radius_class(r);buffer[at+18]=values[source+5];buffer[at+19]=r
		low=low.min(p+Vector3(-1.601,-.632,-1.601)*h);upper=upper.max(p+Vector3(1.601,1.632,1.601)*h)
	return {"available":true,"count":int(data.count),"high":high,"middleBuffer":buffer,"middleCount":row,"middleBounds":AABB(low,upper-low) if row else AABB(),"highTriangles":high.size()*high_triangles,"impostorTriangles":row*2,"sourceInventorySha256":data.sourceInventorySha256,"visibleSupportAabbCount":visible_support,"maximumViewErrorDegrees":maximum_error,"camera":camera,"scope":"all physically supported source IDs, no rank thinning; uniform physical impostor scale; high source scale unchanged"}
