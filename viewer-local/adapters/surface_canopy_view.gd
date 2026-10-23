class_name SurfaceCanopyView
extends RefCounted

const CROWN_DIAMETER_M=11.4378640776699
const TRANSITION_M=4.0*CROWN_DIAMETER_M

# All viewport rays use the same physical reference plane as canopy LOD.
# A second plane includes the declared maximum crown height in oblique views.
static func evaluate(camera:Camera3D, viewport_size:Vector2, reference_y:float, origin:Dictionary, bounds:Dictionary, halo_m:float, crown_height_m:float=20.0,height_range:Vector2=Vector2(NAN,NAN))->Dictionary:
	if bounds.is_empty():return {"safePhase":0.0,"reason":"No complete tree page"}
	var planes=[reference_y,reference_y+crown_height_m]
	if height_range.is_finite():planes=[height_range.x,height_range.y+crown_height_m]
	var points=[]
	var maximum_footprint=0.0
	var projection=camera.get_camera_projection()*Projection(camera.get_camera_transform().affine_inverse())
	for corner in [Vector2.ZERO,Vector2(viewport_size.x,0),viewport_size,Vector2(0,viewport_size.y)]:
		var ray_origin=camera.project_ray_origin(corner);var direction=camera.project_ray_normal(corner)
		if direction.y>=-0.000001:return {"safePhase":0.0,"reason":"Viewport ray does not meet the reference planes"}
		for plane_y in planes:
			var distance=(plane_y-ray_origin.y)/direction.y
			if distance<0:return {"safePhase":0.0,"reason":"Reference plane is behind viewport ray"}
			var p=ray_origin+direction*distance
			points.append({"x":float(origin.x)+float(p.x),"z":float(origin.z)+float(p.z)})
			var clip=projection*Vector4(p.x,reference_y,p.z,1)
			var east=projection*Vector4(p.x+1,reference_y,p.z,1);var south=projection*Vector4(p.x,reference_y,p.z+1,1)
			var east_pixels=((Vector2(east.x,east.y)/east.w-Vector2(clip.x,clip.y)/clip.w)*viewport_size*.5).length()
			var south_pixels=((Vector2(south.x,south.y)/south.w-Vector2(clip.x,clip.y)/clip.w)*viewport_size*.5).length()
			maximum_footprint=maxf(maximum_footprint,1.0/maxf(minf(east_pixels,south_pixels),0.000001))
	var view={"minX":INF,"minZ":INF,"maxX":-INF,"maxZ":-INF}
	for p in points:
		view.minX=minf(view.minX,p.x);view.maxX=maxf(view.maxX,p.x);view.minZ=minf(view.minZ,p.z);view.maxZ=maxf(view.maxZ,p.z)
	var margin=minf(minf(view.minX-float(bounds.minX),float(bounds.maxX)-view.maxX),minf(view.minZ-float(bounds.minZ),float(bounds.maxZ)-view.maxZ))-halo_m
	return {"maximumPixelFootprintM":maximum_footprint,"safePhase":2.0*smoothstep(0.0,TRANSITION_M,margin),"reason":"complete-frustum-plus-halo" if margin>=0 else "tree-page-does-not-cover-frustum-plus-halo","frustumBounds":view,"pageBounds":bounds,"marginM":margin,"haloM":halo_m,"transitionM":TRANSITION_M,"heightEnvelopeWorld":[float(planes[0])+float(origin.y),float(planes[1])+float(origin.y)],"referenceY":reference_y+float(origin.y),"crownHeightEnvelopeM":crown_height_m}

static func expanded(bounds:Dictionary,margin_m:float)->Dictionary:
	return {"minX":float(bounds.minX)-margin_m,"minZ":float(bounds.minZ)-margin_m,"maxX":float(bounds.maxX)+margin_m,"maxZ":float(bounds.maxZ)+margin_m}

static func intersection(a:Dictionary,b:Dictionary)->Dictionary:
	return {"minX":maxf(float(a.minX),float(b.minX)),"minZ":maxf(float(a.minZ),float(b.minZ)),"maxX":minf(float(a.maxX),float(b.maxX)),"maxZ":minf(float(a.maxZ),float(b.maxZ))}
