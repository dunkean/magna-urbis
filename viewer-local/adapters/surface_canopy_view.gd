class_name SurfaceCanopyView
extends RefCounted

const CROWN_DIAMETER_M=11.4378640776699
const TRANSITION_M=4.0*CROWN_DIAMETER_M
const FOOTPRINT_F32_RELATIVE_MARGIN=.001

static func _minimum_affine_norm(ax:float,ay:float,bx:float,by:float,low:float,high:float)->float:
	var square=ax*ax+ay*ay
	var at=clampf(-(ax*bx+ay*by)/square,low,high) if square>1e-30 else low
	return sqrt(pow(ax*at+bx,2)+pow(ay*at+by,2))

# A finite1m difference, not a differential Jacobian. Its numerator is affine
# in the *other* horizontal coordinate; its minimum may be inside an edge.
static func footprint_bound(vp:Projection,viewport:Vector2,reference_y:float,origin:Dictionary,bounds:Dictionary)->Dictionary:
	var x0=float(bounds.minX)-float(origin.x);var x1=float(bounds.maxX)-float(origin.x)
	var z0=float(bounds.minZ)-float(origin.z);var z1=float(bounds.maxZ)-float(origin.z)
	var a=float(vp.x.w);var b=float(vp.z.w);var c=float(vp.y.w)*reference_y+float(vp.w.w)
	var d=float(vp.x.x);var e=float(vp.z.x);var f=float(vp.y.x)*reference_y+float(vp.w.x)
	var g=float(vp.x.y);var h=float(vp.z.y);var j=float(vp.y.y)*reference_y+float(vp.w.y)
	var sx=float(viewport.x)*.5;var sy=float(viewport.y)*.5
	var w_min=INF;var w_max=-INF
	for x in [x0,x1]:
		for z in [z0,z1]:var w=a*x+b*z+c;w_min=minf(w_min,w);w_max=maxf(w_max,w)
	if w_min<=0 or w_min+a<=0 or w_min+b<=0:return {"valid":false,"upperBoundM":INF,"reason":"finite-step endpoint at/behind camera"}
	var east_min=_minimum_affine_norm((d*b-a*e)*sx,(g*b-a*h)*sy,(d*c-a*f)*sx,(g*c-a*j)*sy,z0,z1)
	var south_min=_minimum_affine_norm((e*a-b*d)*sx,(h*a-b*g)*sy,(e*c-b*f)*sx,(h*c-b*j)*sy,x0,x1)
	if east_min<=0 or south_min<=0:return {"valid":false,"upperBoundM":INF,"reason":"degenerate horizontal projection"}
	var east=w_max*(w_max+absf(a))/east_min;var south=w_max*(w_max+absf(b))/south_min
	# Exact cancellation when a projection axis has constant W avoids an
	# unnecessarily loose numerator/denominator separation (current north camera).
	if a==0.0:east=w_max/maxf(sqrt(pow(d*sx,2)+pow(g*sy,2)),1e-30)
	if b==0.0:south=w_max/maxf(sqrt(pow(e*sx,2)+pow(h*sy,2)),1e-30)
	return {"valid":true,"upperBoundM":maxf(east,south)*(1.0+FOOTPRINT_F32_RELATIVE_MARGIN)+.000001,"eastBoundM":east,"southBoundM":south,"minimumW":w_min,"maximumW":w_max,"relativeF32Margin":FOOTPRINT_F32_RELATIVE_MARGIN,"method":"finite-step homography; analytic minimum affine numerator norm over full frustum rectangle"}

# The shader evaluates visible transmittance with at most8x8 source texels.
# A global phase cap prevents ANY native/impostor geometry when the active
# atlas cannot supply the same dyadic kernel as total coverage. Full C mips
# remain useful at phase1. This certificate uses active, not requested spacing.
static func certify_filter(guard:Dictionary,active_spacing:float,grid_size:Vector2)->Dictionary:
	var result=guard.duplicate(true)
	var minimum=maxi(1,int(minf(grid_size.x,grid_size.y)))
	var maximum_level=mini(3,floori(log(float(minimum))/log(2.0)))
	var allowed=pow(2.0,float(maximum_level))
	var footprint=float(guard.get("maximumPixelFootprintM",INF))
	var valid=is_finite(active_spacing) and active_spacing>0 and is_finite(footprint) and footprint>0
	var ratio=footprint/active_spacing if valid else INF
	var compatible=valid and ratio<=allowed
	result["activeAtlasSpacingM"]=active_spacing
	result["maximumPixelFootprintM"]=footprint
	result["geometryFilterRatio"]=ratio
	result["geometryFilterMaximumRatio"]=allowed
	result["geometryFilterCompatible"]=compatible
	result["geometryFilterBudgetLimited"]=not compatible
	result["geometryFilterCertificate"]="active atlas spacing; analytic finite-step homography bound over full frustum height-envelope rectangle; shared dyadic kernel<=8x8"
	if not compatible:result.safePhase=minf(float(result.safePhase),1.0)
	return result

# All viewport rays use the same physical reference plane as canopy LOD.
# A second plane includes the declared maximum crown height in oblique views.
static func evaluate(camera:Camera3D, viewport_size:Vector2, reference_y:float, origin:Dictionary, bounds:Dictionary, halo_m:float, crown_height_m:float=20.0,height_range:Vector2=Vector2(NAN,NAN))->Dictionary:
	if bounds.is_empty():return {"safePhase":0.0,"reason":"No complete tree page"}
	var planes=[reference_y,reference_y+crown_height_m]
	if height_range.is_finite():planes=[height_range.x,height_range.y+crown_height_m]
	var points=[]
	var maximum_footprint=0.0
	var projection=camera.get_camera_projection()*Projection(camera.get_camera_transform().affine_inverse())
	for corner in [Vector2.ZERO,Vector2(viewport_size.x,0),viewport_size,Vector2(0,viewport_size.y),Vector2(viewport_size.x*.5,0),Vector2(viewport_size.x,viewport_size.y*.5),Vector2(viewport_size.x*.5,viewport_size.y),Vector2(0,viewport_size.y*.5),viewport_size*.5]:
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
	var analytic=footprint_bound(projection,viewport_size,reference_y,origin,view)
	return {"maximumPixelFootprintM":maxf(maximum_footprint,float(analytic.upperBoundM)),"sampledMaximumPixelFootprintM":maximum_footprint,"analyticFootprintBound":analytic,"safePhase":2.0*smoothstep(0.0,TRANSITION_M,margin),"reason":"complete-frustum-plus-halo" if margin>=0 else "tree-page-does-not-cover-frustum-plus-halo","frustumBounds":view,"pageBounds":bounds,"marginM":margin,"haloM":halo_m,"transitionM":TRANSITION_M,"heightEnvelopeWorld":[float(planes[0])+float(origin.y),float(planes[1])+float(origin.y)],"referenceY":reference_y+float(origin.y),"crownHeightEnvelopeM":crown_height_m}

static func expanded(bounds:Dictionary,margin_m:float)->Dictionary:
	return {"minX":float(bounds.minX)-margin_m,"minZ":float(bounds.minZ)-margin_m,"maxX":float(bounds.maxX)+margin_m,"maxZ":float(bounds.maxZ)+margin_m}

static func intersection(a:Dictionary,b:Dictionary)->Dictionary:
	return {"minX":maxf(float(a.minX),float(b.minX)),"minZ":maxf(float(a.minZ),float(b.minZ)),"maxX":minf(float(a.maxX),float(b.maxX)),"maxZ":minf(float(a.maxZ),float(b.maxZ))}
