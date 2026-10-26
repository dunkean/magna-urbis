extends SceneTree
# Production bake/projection A/B on actual retained source geometry, with a
# controlled flat receiver/palette. Not a Terrain3D, new-neural or style claim.
const D=preload("res://adapters/surface_data.gd")
const G=preload("res://adapters/surface_geometry.gd")
const H=preload("res://adapters/surface_hydrology.gd")
const P=preload("res://adapters/surface_water_projection.gd")
const S=preload("res://adapters/surface_water_symbols.gd")
var failures:Array=[]
func check(ok:bool,message:String):
	if not ok:failures.append(message)
func _initialize():call_deferred("run")
func image(vp:SubViewport,path:String)->Image:
	for frame in 3:await process_frame
	await RenderingServer.frame_post_draw
	var result=vp.get_texture().get_image();result.save_png(path);return result
func blue(c:Color)->bool:return c.b>c.r+.12 and c.b>.2
func blue_count(im:Image)->int:
	var n=0
	for z in im.get_height():
		for x in im.get_width():
			if blue(im.get_pixel(x,z)):n+=1
	return n

func nearby_blue(im:Image,x:int,y:int)->bool:
	for dz in range(-1,2):
		for dx in range(-1,2):
			if blue(im.get_pixel(x+dx,y+dz)):return true
	return false

func source_bank_evidence(geometry:Dictionary,old:Image,current:Image)->Dictionary:
	var width=2048;var height=1280;var mpp=40000./width
	var band=PackedByteArray();band.resize(width*height)
	var samples=0;var old_visible=0;var new_visible=0;var recovered=0;var limited=false;var examples:Array=[]
	for ring in geometry.sourceWaterContours:
		var n=ring.size()/2
		for i in n:
			var j=(i+1)%n;var ax=ring[i*2];var az=ring[i*2+1];var bx=ring[j*2];var bz=ring[j*2+1]
			var steps=maxi(1,int(ceil(sqrt((bx-ax)*(bx-ax)+(bz-az)*(bz-az))/(mpp*.5))))
			for at in steps:
				var f=(at+.5)/steps;var x=ax+(bx-ax)*f;var z=az+(bz-az)*f
				var px=int(floor((x-20000.)/mpp+width*.5));var py=int(floor((z-20000.)/mpp+height*.5))
				if px<3 or px>=width-3 or py<3 or py>=height-3:continue
				if samples>=200000:limited=true;continue
				samples+=1
				# Independent CPU band from original bank segments, not from a raster
				# dilation or an invented channel centreline. Covers AA/filter support.
				for dy in range(-2,3):
					for dx in range(-2,3):band[(py+dy)*width+px+dx]=1
				var previous=nearby_blue(old,px,py);var visible=nearby_blue(current,px,py)
				if previous:old_visible+=1
				if visible:new_visible+=1
				if not previous and visible:
					recovered+=1
					if examples.size()<32:examples.append({"sourceX":x,"sourceZ":z,"pixelX":px,"pixelY":py})
	var extra=0;var aligned=0
	for y in range(3,height-3):
		for x in range(3,width-3):
			if blue(current.get_pixel(x,y)) and not blue(old.get_pixel(x,y)):
				extra+=1
				if band[y*width+x]!=0:aligned+=1
	return {"sourceBankSamples":samples,"sampleBudget":200000,"sampleBudgetLimited":limited,"oldPostOnlyVisibleSamples":old_visible,"vectorVisibleSamples":new_visible,"recoveredSourceBankSamples":recovered,"recoveredExamples":examples,"extraVisiblePixels":extra,"extraPixelsInsideTwoPixelSourceBankBand":aligned,"scope":"Actual Float64 clipped source polygon edges, sampled at half-screen-pixel spacing; 3x3 visibility query and two-pixel AA/filter band. Not a centreline, flow/topology proof or exact area measurement."}
func run():
	var args=OS.get_cmdline_user_args()
	if args.size()!=2:push_error("Usage: packet.surfacebin output-directory");quit(2);return
	DirAccess.make_dir_recursive_absolute(args[1])
	var packet=D.read_json(args[0]);var world=D.unpack_world(packet)
	var source_hash=P._sha(var_to_bytes(packet.source));var origin={"x":20000.,"y":0.,"z":20000.};var focus={"x":20000.,"y":20000.}
	var geometry=H.prepare(packet,world,origin,focus,40000.,G.build_water(world,origin,focus,40000.));geometry.anchor=origin
	check(geometry.get("authority","")=="magna-urbis-fixed-hydrology","retained source authority")
	check(geometry.get("sourceVectorMissingAreaM2",-1)==0 and geometry.get("missingLevelTriangles",-1)==0 and not geometry.get("budgetLimited",true),"complete source vector geometry before symbol generation")
	if not failures.is_empty():push_error(str(failures));quit(1);return
	var geometry_hash=P._sha(geometry.vertices.to_byte_array())
	var colors={"river":Vector3(.02,.25,.8),"lake":Vector3(.02,.25,.8),"sea":Vector3(.02,.25,.8),"fallback":Vector3(.02,.25,.8)}
	var options={"sourceKey":"retained-real-source-symbol-control","resolution":2048,"msaa":2,"minHeightM":-10000.,"maxHeightM":10000.}
	var original=await P.bake(root,geometry,origin,focus,50000.,colors,options)
	options.symbolWidthPx=1.25;options.screenMetresPerPixel=40000./2048.;options.screenScalePolicy="orthographic-map-ground-scale";options.retainSourceImage=true
	var symbolic=await P.bake(root,geometry,origin,focus,50000.,colors,options)
	if original.has("error") or symbolic.has("error"):push_error(str([original.get("error"),symbolic.get("error")]));quit(1);return
	check(geometry_hash==P._sha(geometry.vertices.to_byte_array()) and source_hash==P._sha(var_to_bytes(packet.source)),"source triangles, levels, hydro arrays and indices immutable")
	check(original.diagnostics.sourceGeometrySha256==symbolic.diagnostics.sourceGeometrySha256,"both representations identify identical geometry")
	var vp=SubViewport.new();vp.size=Vector2i(2048,1280);vp.own_world_3d=true;vp.msaa_3d=Viewport.MSAA_4X;vp.render_target_update_mode=SubViewport.UPDATE_ALWAYS;root.add_child(vp)
	var environment=WorldEnvironment.new();var settings=Environment.new();settings.background_mode=Environment.BG_COLOR;settings.background_color=Color(.2,.2,.2);settings.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR;settings.ambient_light_color=Color.WHITE;settings.ambient_light_energy=1.;settings.tonemap_mode=Environment.TONE_MAPPER_LINEAR;environment.environment=settings;vp.add_child(environment)
	var camera=Camera3D.new();camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.size=25000.;camera.near=.1;camera.far=50000.;camera.position=Vector3(0,30000,0);vp.add_child(camera);camera.look_at(Vector3.ZERO,Vector3(0,0,-1));camera.current=true
	var ground=MeshInstance3D.new();var plane=PlaneMesh.new();plane.size=Vector2(40000,25000);ground.mesh=plane;ground.layers=1
	var gray=StandardMaterial3D.new();gray.albedo_color=Color(.4,.4,.4);gray.roughness=1.;gray.metallic_specular=0.;ground.material_override=gray;vp.add_child(ground)
	var arrays=[];arrays.resize(Mesh.ARRAY_MAX);arrays[Mesh.ARRAY_VERTEX]=geometry.vertices
	var mesh=ArrayMesh.new();mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays)
	var source_item=MeshInstance3D.new();source_item.mesh=mesh;source_item.layers=2
	var tint=ShaderMaterial.new();tint.shader=load("res://shaders/water_source_map.gdshader");tint.set_shader_parameter("linear_tint",colors.fallback);source_item.material_override=tint;vp.add_child(source_item)
	var reference=await image(vp,args[1].path_join("source-reference.png"));source_item.visible=false
	var decal=P.create_decal(original,origin);vp.add_child(decal)
	var mode0=await image(vp,args[1].path_join("contours-mode0.png"));decal.queue_free();await process_frame
	var post_image=await S.post_only_reference(root,symbolic.sourceImage,S.plan(50000.,options));post_image.generate_mipmaps()
	var historical=symbolic.duplicate(false);historical.texture=ImageTexture.create_from_image(post_image)
	decal=P.create_decal(historical,origin);vp.add_child(decal)
	var post_only=await image(vp,args[1].path_join("post-only-reference.png"));decal.queue_free();await process_frame
	decal=P.create_decal(symbolic,origin);vp.add_child(decal)
	var mode125=await image(vp,args[1].path_join("symbols-1_25.png"))
	var pixel=Vector2i(1024,640);var nearest=INF
	for z in range(64,1216):
		for x in range(64,1984):
			var distance=Vector2(x-1024,z-640).length_squared()
			if distance<nearest and blue(reference.get_pixel(x,z)):nearest=distance;pixel=Vector2i(x,z)
	check(nearest<INF,"actual reference water pixel found for roof control")
	var roof=MeshInstance3D.new();var box=BoxMesh.new();box.size=Vector3(1000,10,1000);roof.mesh=box;roof.layers=2;roof.position=Vector3((pixel.x+.5)*40000./2048.-20000.,100.,(pixel.y+.5)*25000./1280.-12500.)
	var red=StandardMaterial3D.new();red.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED;red.albedo_color=Color.RED;roof.material_override=red;vp.add_child(roof)
	var roof_image=await image(vp,args[1].path_join("symbols-roof.png"));var roof_blue=0
	for z in range(pixel.y-20,pixel.y+21):
		for x in range(pixel.x-20,pixel.x+21):
			if blue(roof_image.get_pixel(x,z)):roof_blue+=1
	var baseline_count=blue_count(mode0);var symbolic_count=blue_count(mode125)
	var bank_evidence=source_bank_evidence(geometry,post_only,mode125)
	check(bank_evidence.recoveredSourceBankSamples>0,"previously raster-missed source bank samples reappear on their actual vector trace")
	check(bank_evidence.extraVisiblePixels>0 and float(bank_evidence.extraPixelsInsideTwoPixelSourceBankBand)/bank_evidence.extraVisiblePixels>.98,"new visible pixels follow source vector banks rather than arbitrary dilation")
	check(symbolic_count>baseline_count,"declared symbols increase visible source-water coverage")
	check(roof_blue==0,"symbol projector never paints layer2 roof")
	var report={"failures":failures,"backend":RenderingServer.get_current_rendering_method(),"adapter":RenderingServer.get_video_adapter_name(),"sourcePacket":args[0],"widthM":40000,"viewport":[2048,1280],"screenMetresPerPixel":40000./2048.,"sourceReferencePixels":blue_count(reference),"originalContourPixels":baseline_count,"oldPostOnlyPixels":blue_count(post_only),"symbolPixels":symbolic_count,"sourceBankEvidence":bank_evidence,"symbolRoofPixels":roof_blue,"sourceUnchanged":source_hash==P._sha(var_to_bytes(packet.source)),"geometrySha256":geometry_hash,"original":original.diagnostics,"symbolic":symbolic.diagnostics,"scope":"Actual retained source40km contours and original levels through production fill/vector outline/terrain-only projection, plus historical post-only operator at identical fill sampling; controlled flat receiver and blue palette. Not a fresh neural/Terrain3D/production-style/canopy/topology or constant-width perspective proof."}
	var file=FileAccess.open(args[1].path_join("report.json"),FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));file.close();print(JSON.stringify(report));quit(0 if failures.is_empty() else 1)
