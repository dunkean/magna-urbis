extends SceneTree
const View=preload("res://adapters/surface_canopy_view.gd")
func _initialize():call_deferred("run")
func footprint(camera:Camera3D,point:Vector3,size:Vector2)->float:
	var vp=camera.get_camera_projection()*Projection(camera.get_camera_transform().affine_inverse());var clip=vp*Vector4(point.x,0,point.z,1);var east=vp*Vector4(point.x+1,0,point.z,1);var south=vp*Vector4(point.x,0,point.z+1,1)
	var ex=((Vector2(east.x,east.y)/east.w-Vector2(clip.x,clip.y)/clip.w)*size*.5).length();var sz=((Vector2(south.x,south.y)/south.w-Vector2(clip.x,clip.y)/clip.w)*size*.5).length();return 1/maxf(minf(ex,sz),.000001)
func run():
	var args=OS.get_cmdline_user_args();if args.size()<1:quit(2);return
	var reviewed=View;var reviewed_hash=""
	if args.size()>3:
		reviewed_hash=FileAccess.get_sha256(args[3]);var script=GDScript.new();script.source_code=FileAccess.get_file_as_string(args[3]).replace("class_name SurfaceCanopyView\n","")
		if script.reload()!=OK:quit(2);return
		reviewed=script.new()
	var main_ratio=args.size()>1 and args[1]=="main-ratio";var camera_height=float(args[2]) if args.size()>2 else 55.0;var position=Vector3(0,camera_height,camera_height*.68/.73) if main_ratio else Vector3(0,100,100);var bounds={"minX":-240.,"minZ":-240.,"maxX":240.,"maxZ":240.} if main_ratio else {"minX":-400.,"minZ":-400.,"maxX":400.,"maxZ":400.}
	var viewport=SubViewport.new();viewport.size=Vector2i(200,125);root.add_child(viewport);var camera=Camera3D.new();camera.fov=48;camera.near=.1;camera.far=2000;viewport.add_child(camera);camera.position=position;camera.look_at(Vector3.ZERO);await process_frame
	var crown_envelope=float(args[4]) if args.size()>4 else 20.0
	var size=Vector2(200,125);var guard=reviewed.evaluate(camera,size,0,{"x":0.,"y":0.,"z":0.},bounds,26.,crown_envelope);var maximum=0.;var maximum_at=Vector2.ZERO
	for y in 97:
		for x in 97:
			var pixel=Vector2(x*size.x/96,y*size.y/96);var ray=camera.project_ray_origin(pixel);var direction=camera.project_ray_normal(pixel)
			for plane in [0.0,crown_envelope]:
				var point=ray+direction*((plane-ray.y)/direction.y);var actual=footprint(camera,point,size)
				if actual>maximum:maximum=actual;maximum_at=pixel
	var spacing=.25 if main_ratio else .5;var corner_ratio=float(guard.maximumPixelFootprintM)/spacing;var actual_ratio=maximum/spacing;var current_phase=minf(float(guard.safePhase),1.0) if corner_ratio>8 else float(guard.safePhase)
	var result={"format":"independent-canopy-corner-footprint-probe","version":1,"viewport":[200,125],"cameraPosition":[position.x,position.y,position.z],"mainObliqueDirectionRatio":main_ratio,"fovDegrees":48,"atlasSpacingM":spacing,"atlasBounds":bounds,"actualFrustumBounds":guard.frustumBounds,"cornerReportedMaximumM":guard.maximumPixelFootprintM,"independentlySampledMaximumM":maximum,"sampledMaximumAtPixel":[maximum_at.x,maximum_at.y],"cornerRatio":corner_ratio,"actualMaximumRatio":actual_ratio,"rawViewSafePhase":guard.safePhase,"mainExistingCornerBudgetPhase":current_phase,"unsafeCondition":current_phase>1 and actual_ratio>8,"scope":"Headless CPU actual Camera3D projection and SurfaceCanopyView; same per-pixel main-camera one-metre secants as shader. Tests oblique far-edge midpoint missed by corner-only maximum. No GPU or claim about prior2048px captures."}
	if args.size()>3:
		var certificate=reviewed.certify_filter(guard,spacing,Vector2(2048,2048));result["reviewedViewSha256"]=reviewed_hash;result["sampleCount"]=97*97*2;result["certificate"]=certificate;result.unsafeCondition=float(certificate.safePhase)>1 and actual_ratio>8
		result["reviewedMaximumM"]=guard.maximumPixelFootprintM;result["reviewedMaximumRatio"]=corner_ratio;result["certifiedPhase"]=certificate.safePhase
		for key in ["cornerReportedMaximumM","cornerRatio","mainExistingCornerBudgetPhase"]:result.erase(key)
		if FileAccess.get_sha256(args[3])!=reviewed_hash or maximum>float(guard.maximumPixelFootprintM) or result.unsafeCondition:push_error("Independent analytic/cap proof failed");quit(1);return
	var file=FileAccess.open(args[0],FileAccess.WRITE);file.store_string(JSON.stringify(result,"  "));file=null;print(JSON.stringify(result));quit()
