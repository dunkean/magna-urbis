class_name SurfaceMapProjection
extends RefCounted

# Export the camera actually used by the native capture. World coordinates must
# lose their Float64 render origin BEFORE this rebased float32 camera matrix.
static func capture(camera:Camera3D, viewport:Vector2, origin:Dictionary, focus:Dictionary, world_id:String, top:bool, width_m:float)->Dictionary:
	if camera==null or world_id.is_empty() or viewport.x<1 or viewport.y<1:return {}
	for key in ["x","y","z"]:
		if not origin.has(key) or not is_finite(float(origin[key])):return {}
	if not focus.has("x") or not focus.has("y") or not is_finite(float(focus.x)) or not is_finite(float(focus.y)):return {}
	var projection=camera.get_camera_projection()
	# Camera3D's CPU projection is OpenGL clip depth. Never silently export an
	# assumed depth range if another projection/provider changes that convention.
	var near_point=projection*Vector4(0,0,-camera.near,1)
	var far_point=projection*Vector4(0,0,-camera.far,1)
	if absf(near_point.w)<1e-12 or absf(far_point.w)<1e-12 or absf(near_point.z/near_point.w+1.0)>.002 or absf(far_point.z/far_point.w-1.0)>.002:return {}
	var vp=projection*Projection(camera.get_camera_transform().affine_inverse())
	var values=[]
	for column in [vp.x,vp.y,vp.z,vp.w]:
		for component in [column.x,column.y,column.z,column.w]:
			if not is_finite(component):return {}
			values.append(float(component))
	var is_top=top and camera.projection==Camera3D.PROJECTION_ORTHOGONAL
	if not is_top and camera.projection!=Camera3D.PROJECTION_PERSPECTIVE:return {}
	var uniform_scale=null
	if is_top:
		if not is_finite(width_m) or width_m<=0:return {}
		var basis=camera.get_camera_transform().basis
		if basis.x.normalized().distance_to(Vector3.RIGHT)>.0001 or basis.y.normalized().distance_to(Vector3.FORWARD)>.0001 or basis.z.normalized().distance_to(Vector3.UP)>.0001:return {}
		var expected_height=width_m*float(viewport.y)/float(viewport.x)
		if absf(absf(projection.x.x)*width_m-2.0)>.0001 or absf(absf(projection.y.y)*expected_height-2.0)>.0001:return {}
		var height_m=width_m*float(viewport.y)/float(viewport.x)
		uniform_scale={"metresPerPixel":width_m/float(viewport.x),"bounds":{"minX":float(focus.x)-width_m*.5,"maxX":float(focus.x)+width_m*.5,"minZ":float(focus.y)-height_m*.5,"maxZ":float(focus.y)+height_m*.5},"north":"local-negative-z"}
	return {"format":"surface-map-projection","version":1,"worldId":world_id,"projectionMode":"orthographic-top" if is_top else "perspective","viewportPixels":{"width":int(viewport.x),"height":int(viewport.y)},"worldToClip":values,"renderOrigin":{"x":float(origin.x),"y":float(origin.y),"z":float(origin.z)},"clipRange":[-1,1],"focus":{"x":float(focus.x),"z":float(focus.y)},"uniformMetricScale":uniform_scale,"precision":"rebased float32 camera matrix; subtract Float64 renderOrigin before multiplying; TOP scale is the horizontal map reference frame"}
