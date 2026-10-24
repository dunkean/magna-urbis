extends RefCounted
## Original Render draw calls replayed on Godot's main RenderingDevice.
## No SurfaceWorld, 3D scene, material replacement or CPU readback during navigation.
signal capture_completed(record:Dictionary)
var output_texture:Texture2DRD
var ready:=false
var failed:=""
var scene:Dictionary={}
var layout:Dictionary={}
var scene_directory:=""
var shader_directory:="res://shaders"
var size:=Vector2i(1280,800)
var rd:RenderingDevice
var programs:Dictionary={}
var textures:Dictionary={}
var samplers:Dictionary={}
var targets:Dictionary={}
var jobs:Array=[]
var resources:Array[RID]=[]
var river_buffer:RID
var gpu_ready:=false
var pending_view:Dictionary={}
var mutex:=Mutex.new()
var draw_queued:=false
var serial:=0
var rendered_serial:=-1
var draw_count:=0
var last_submit_ms:=0.0
var initial_source:=""
var released:=false

func configure(path:String,pixels:Vector2i)->bool:
	scene_directory=path.get_base_dir();size=pixels
	var parsed=JSON.parse_string(FileAccess.get_file_as_string(path))
	if not parsed is Dictionary or parsed.get("format")!="magna-render-original-fixture" or parsed.get("version")!=1:
		failed="Expected an exact original Render fixture";return false
	scene=parsed
	var shader_layout=shader_directory.path_join("shader_layout.json")
	var parsed_layout=JSON.parse_string(FileAccess.get_file_as_string(shader_layout))
	if not parsed_layout is Dictionary or not parsed_layout.get("programs") is Dictionary:
		failed="Original Render GLSL layout missing";return false
	layout=parsed_layout
	if scene.get("draws",[]).is_empty():failed="Original Render fixture has no recorded draw calls";return false
	for draw in scene.draws:
		if draw.program=="terrain":
			var uniforms:Dictionary=draw.uniforms
			if int(uniforms.get("uMode",-1))!=2 or int(uniforms.get("uEnhanced3d",0))!=0 or int(uniforms.get("uGroundCapture",0))!=0:
				failed="Only the original 2D Render layer is accepted";return false
	initial_source=str(scene.get("source",{}).get("sourceHead",""))
	var inputs:Dictionary=scene.get("inputs",{})
	pending_view={"origin":inputs.get("origin",[0.0,0.0]),"mpp":float(inputs.get("metresPerPixel",40000.0/size.x)),"serial":0}
	RenderingServer.call_on_render_thread(_initialize_gpu)
	return true

func keep(rid:RID)->RID:
	if rid.is_valid():resources.append(rid)
	return rid

func _gpu_fail(message:String)->void:
	_publish_failure.call_deferred(message)

func _publish_failure(message:String)->void:
	failed=message;ready=false;push_error(message)

func _format(name:String)->int:
	match name:
		"RF","R32F":return RenderingDevice.DATA_FORMAT_R32_SFLOAT
		"RGF","RG32F":return RenderingDevice.DATA_FORMAT_R32G32_SFLOAT
		"R8":return RenderingDevice.DATA_FORMAT_R8_UNORM
		_:return RenderingDevice.DATA_FORMAT_R8G8B8A8_UNORM

func _texture(width:int,height:int,format_name:String,mips:int,bytes:PackedByteArray,attachment:=false)->RID:
	var description:=RDTextureFormat.new()
	description.width=width;description.height=height;description.format=_format(format_name);description.mipmaps=mips
	description.usage_bits=RenderingDevice.TEXTURE_USAGE_SAMPLING_BIT|RenderingDevice.TEXTURE_USAGE_CAN_COPY_FROM_BIT|RenderingDevice.TEXTURE_USAGE_CAN_UPDATE_BIT
	if attachment:description.usage_bits|=RenderingDevice.TEXTURE_USAGE_COLOR_ATTACHMENT_BIT
	var data:Array[PackedByteArray]=[]
	if not bytes.is_empty():data.append(bytes)
	return keep(rd.texture_create(description,RDTextureView.new(),data))

func _sampler(settings:Dictionary)->RID:
	var state:=RDSamplerState.new()
	state.min_filter=RenderingDevice.SAMPLER_FILTER_LINEAR if str(settings.get("min","NEAREST")).begins_with("LINEAR") else RenderingDevice.SAMPLER_FILTER_NEAREST
	state.mag_filter=RenderingDevice.SAMPLER_FILTER_LINEAR if settings.get("mag")=="LINEAR" else RenderingDevice.SAMPLER_FILTER_NEAREST
	state.mip_filter=RenderingDevice.SAMPLER_FILTER_LINEAR if str(settings.get("min","")).ends_with("MIPMAP_LINEAR") else RenderingDevice.SAMPLER_FILTER_NEAREST
	if not str(settings.get("min","")).contains("MIPMAP"):state.max_lod=0.0
	var modes={"CLAMP_TO_EDGE":RenderingDevice.SAMPLER_REPEAT_MODE_CLAMP_TO_EDGE,"REPEAT":RenderingDevice.SAMPLER_REPEAT_MODE_REPEAT,"MIRRORED_REPEAT":RenderingDevice.SAMPLER_REPEAT_MODE_MIRRORED_REPEAT}
	if not modes.has(settings.get("wrapS","CLAMP_TO_EDGE")) or not modes.has(settings.get("wrapT","CLAMP_TO_EDGE")):
		_gpu_fail("Original sampler wrap mode is not supported");return RID()
	state.repeat_u=modes[settings.get("wrapS","CLAMP_TO_EDGE")];state.repeat_v=modes[settings.get("wrapT","CLAMP_TO_EDGE")];state.repeat_w=RenderingDevice.SAMPLER_REPEAT_MODE_CLAMP_TO_EDGE
	return keep(rd.sampler_create(state))

func _active_bindings(spirv:RDShaderSPIRV)->Dictionary:
	var found:Dictionary={}
	for stage in [RenderingDevice.SHADER_STAGE_VERTEX,RenderingDevice.SHADER_STAGE_FRAGMENT]:
		var bytes=spirv.get_stage_bytecode(stage);var position=20
		while position+4<=bytes.size():
			var first=bytes.decode_u32(position);var length=int(first>>16);var opcode=int(first&65535)
			if length<1:break
			# OpDecorate / Binding. All generated descriptors use set zero.
			if opcode==71 and length>=4 and bytes.decode_u32(position+8)==33:found[int(bytes.decode_u32(position+12))]=true
			position+=length*4
	return found

func _initialize_gpu()->void:
	if released:return
	rd=RenderingServer.get_rendering_device()
	if rd==null:_gpu_fail("Original Render requires the Vulkan RenderingDevice");return
	for key in scene.get("data",{}):
		var info:Dictionary=scene.data[key]
		var path=scene_directory.path_join(str(info.get("file","")))
		if not FileAccess.file_exists(path):_gpu_fail("Original raster missing: "+path);return
		var bytes=FileAccess.get_file_as_bytes(path)
		textures[key]=_texture(int(info.width),int(info.height),str(info.format),maxi(1,info.get("mips",[]).size()),bytes)
		samplers[key]=_sampler(info.get("sampler",{}))
		if not samplers[key].is_valid():return
		if not textures[key].is_valid():_gpu_fail("Could not upload original raster: "+str(key));return
	textures["empty"]=_texture(1,1,"R8",1,PackedByteArray([0]));samplers["empty"]=_sampler({})
	var array_format:=RDTextureFormat.new();array_format.width=1;array_format.height=1
	array_format.format=RenderingDevice.DATA_FORMAT_R8G8B8A8_UNORM;array_format.texture_type=RenderingDevice.TEXTURE_TYPE_2D_ARRAY
	array_format.usage_bits=RenderingDevice.TEXTURE_USAGE_SAMPLING_BIT
	textures["empty-array"]=keep(rd.texture_create(array_format,RDTextureView.new(),[PackedByteArray([0,0,0,0])]))
	samplers["empty-array"]=samplers["empty"]
	var output_key=str(scene.get("outputTarget","screen"))
	var needed_targets:Dictionary={output_key:true}
	for draw in scene.draws:
		needed_targets[str(draw.get("target","screen"))]=true
		for key in draw.get("textures",{}).values():needed_targets[str(key)]=true
	for key in scene.get("targets",{}):
		if not needed_targets.has(key):continue
		textures[key]=_texture(size.x,size.y,"RGBA8",1,PackedByteArray(),true)
		samplers[key]=_sampler({"min":"LINEAR","mag":"LINEAR"})
		targets[key]=keep(rd.framebuffer_create([textures[key]]))
	if not textures.has(output_key):
		textures[output_key]=_texture(size.x,size.y,"RGBA8",1,PackedByteArray(),true)
		targets[output_key]=keep(rd.framebuffer_create([textures[output_key]]))
		samplers[output_key]=_sampler({"min":"LINEAR","mag":"LINEAR"})
	if not targets.has("screen"):targets["screen"]=targets[output_key]
	if not textures.has("screen"):textures["screen"]=textures[output_key]
	var river:Dictionary=scene.get("buffers",{}).get("rivers",{})
	var river_path=scene_directory.path_join(str(river.get("file","")))
	if not river.is_empty() and not FileAccess.file_exists(river_path):_gpu_fail("Original river buffer missing: "+river_path);return
	var river_bytes=FileAccess.get_file_as_bytes(river_path) if not river.is_empty() else PackedByteArray()
	if river_bytes.is_empty():river_bytes.resize(36)
	river_buffer=keep(rd.storage_buffer_create(river_bytes.size(),river_bytes))
	var used:Dictionary={}
	for draw in scene.draws:used[draw.program]=true
	for name in used:
		if not layout.programs.has(name):_gpu_fail("GLSL program layout missing: "+str(name));return
		var description:Dictionary=layout.programs[name]
		var source:=RDShaderSource.new()
		source.source_vertex=FileAccess.get_file_as_string(shader_directory.path_join(description.vertex))
		source.source_fragment=FileAccess.get_file_as_string(shader_directory.path_join(description.fragment))
		var spirv=rd.shader_compile_spirv_from_source(source)
		for stage in [RenderingDevice.SHADER_STAGE_VERTEX,RenderingDevice.SHADER_STAGE_FRAGMENT]:
			var error=spirv.get_stage_compile_error(stage)
			if not error.is_empty():_gpu_fail("Original "+str(name)+" shader: "+error);return
		var shader=keep(rd.shader_create_from_spirv(spirv))
		if not shader.is_valid():_gpu_fail("Could not create original shader: "+str(name));return
		programs[name]={"shader":shader,"layout":description,"bindings":_active_bindings(spirv)}
	for recorded in scene.draws:
		var program:Dictionary=programs[recorded.program]
		var description:Dictionary=program.layout
		var buffer=keep(rd.uniform_buffer_create(int(description.uniformByteLength))) if int(description.uniformByteLength)>0 else RID()
		var uniforms:Array[RDUniform]=[]
		if program.bindings.has(0):
			var item:=RDUniform.new();item.uniform_type=RenderingDevice.UNIFORM_TYPE_UNIFORM_BUFFER;item.binding=0;item.add_id(buffer);uniforms.append(item)
		for entry in description.get("samplers",[]):
			if not program.bindings.has(int(entry.binding)):continue
			var name=str(entry.name);var key=str(recorded.get("textures",{}).get(name,recorded.get("textures",{}).get(name+"[0]","empty")))
			if entry.get("type")=="sampler2DArray" and key=="empty":key="empty-array"
			if not textures.has(key):_gpu_fail("Original sampler "+name+" has no texture "+key);return
			var item:=RDUniform.new();item.uniform_type=RenderingDevice.UNIFORM_TYPE_SAMPLER_WITH_TEXTURE;item.binding=int(entry.binding);item.add_id(samplers.get(key,samplers["empty"]));item.add_id(textures[key]);uniforms.append(item)
		for entry in description.get("buffers",[]):
			if not program.bindings.has(int(entry.binding)):continue
			var item:=RDUniform.new();item.uniform_type=RenderingDevice.UNIFORM_TYPE_STORAGE_BUFFER;item.binding=int(entry.binding);item.add_id(river_buffer);uniforms.append(item)
		var uniform_set=keep(rd.uniform_set_create(uniforms,program.shader,0))
		var target=str(recorded.get("target","screen"))
		if not targets.has(target):_gpu_fail("Original framebuffer missing: "+target);return
		var pipeline=keep(_pipeline(program.shader,targets[target],recorded.get("blend",{})))
		if not uniform_set.is_valid() or not pipeline.is_valid():_gpu_fail("Original Render pipeline or descriptors invalid");return
		jobs.append({"recorded":recorded,"buffer":buffer,"set":uniform_set,"pipeline":pipeline,"layout":description,"target":target})
	gpu_ready=true
	_publish_texture.call_deferred(textures[output_key])
	_draw_latest()

func _publish_texture(rid:RID)->void:
	if released:return
	output_texture=Texture2DRD.new();output_texture.texture_rd_rid=rid

func _blend_factor(name:String)->int:
	match name:
		"ONE":return RenderingDevice.BLEND_FACTOR_ONE
		"SRC_ALPHA":return RenderingDevice.BLEND_FACTOR_SRC_ALPHA
		"ONE_MINUS_SRC_ALPHA":return RenderingDevice.BLEND_FACTOR_ONE_MINUS_SRC_ALPHA
		_:return RenderingDevice.BLEND_FACTOR_ZERO

func _pipeline(shader:RID,framebuffer:RID,blend:Dictionary)->RID:
	var raster:=RDPipelineRasterizationState.new();raster.cull_mode=RenderingDevice.POLYGON_CULL_DISABLED
	var attachment:=RDPipelineColorBlendStateAttachment.new();attachment.enable_blend=bool(blend.get("enabled",false))
	attachment.src_color_blend_factor=_blend_factor(str(blend.get("srcRgb","ONE")));attachment.dst_color_blend_factor=_blend_factor(str(blend.get("dstRgb","ZERO")))
	attachment.src_alpha_blend_factor=_blend_factor(str(blend.get("srcAlpha","ONE")));attachment.dst_alpha_blend_factor=_blend_factor(str(blend.get("dstAlpha","ZERO")))
	attachment.color_blend_op=RenderingDevice.BLEND_OP_MAXIMUM if blend.get("equationRgb")=="MAX" else RenderingDevice.BLEND_OP_ADD
	attachment.alpha_blend_op=RenderingDevice.BLEND_OP_MAXIMUM if blend.get("equationAlpha")=="MAX" else RenderingDevice.BLEND_OP_ADD
	var colors:=RDPipelineColorBlendState.new();colors.attachments=[attachment]
	return rd.render_pipeline_create(shader,rd.framebuffer_get_format(framebuffer),-1,RenderingDevice.RENDER_PRIMITIVE_TRIANGLE_STRIPS,raster,RDPipelineMultisampleState.new(),RDPipelineDepthStencilState.new(),colors)

func set_view(origin:Array,metres_per_pixel:float)->void:
	if origin.size()!=2 or not is_finite(float(origin[0])) or not is_finite(float(origin[1])) or not is_finite(metres_per_pixel) or metres_per_pixel<=0:return
	ready=false
	mutex.lock();serial+=1;pending_view={"origin":origin.duplicate(),"mpp":metres_per_pixel,"serial":serial}
	var enqueue=not draw_queued;draw_queued=true;mutex.unlock()
	if enqueue:RenderingServer.call_on_render_thread(_draw_latest)

func _flatten(value)->Array:
	if value is Array:
		var result:Array=[]
		for part in value:result.append_array(_flatten(part))
		return result
	return [value]

func _uniform_bytes(description:Dictionary,values:Dictionary)->PackedByteArray:
	var bytes:=PackedByteArray();bytes.resize(int(description.uniformByteLength))
	for entry in description.get("uniforms",[]):
		var name=str(entry.name);var value=values.get(name,values.get(name+"[0]",0))
		var flattened=_flatten(value);var type=str(entry.type);var components=1
		if type.ends_with("vec2"):components=2
		elif type.ends_with("vec3"):components=3
		elif type.ends_with("vec4"):components=4
		for item in int(entry.get("count",1)):
			for component in components:
				var index=item*components+component
				var number=flattened[index] if index<flattened.size() else 0
				var offset=int(entry.offset)+item*int(entry.get("stride",components*4))+component*4
				if type=="uint" or type.begins_with("uvec"):bytes.encode_u32(offset,int(number)&0xffffffff)
				elif type=="int" or type=="bool" or type.begins_with("ivec") or type.begins_with("bvec"):bytes.encode_s32(offset,int(number))
				else:bytes.encode_float(offset,float(number))
	return bytes

func _view_uniforms(job:Dictionary,view:Dictionary)->Dictionary:
	var values:Dictionary=job.recorded.uniforms.duplicate(true)
	var px=float(view.mpp);var origin:Array=view.origin
	values["uCanvas"]=[size.x,size.y];values["uOrigin"]=origin;values["uPx"]=px
	if job.recorded.program=="terrain":
		if int(values.get("uBase",0))==1:values["uQuad"]=[0.0,0.0,float(size.x),float(size.y)]
		else:
			var start:Array=values.get("uFieldOrigin",[0,0]);var cell=float(values.get("uFieldCell",1));var extent=cell*float(values.get("uFieldN",1));var inset=2*cell
			values["uQuad"]=[(start[0]+inset-origin[0])/px,(start[1]+inset-origin[1])/px,(start[0]+extent-inset-origin[0])/px,(start[1]+extent-inset-origin[1])/px]
	if job.recorded.program=="renderWater":
		var band=float(values.get("uBand",1));var maximum=maxf(4,minf(256,1.5*band/maxf(.000001,px)));var rings:Array=[]
		for k in 12:rings.append(pow(maximum,float(k)/11))
		values["uRings"]=rings;values["uRings[0]"]=rings;values["uRingCount"]=12
		var dpr=float(values.get("uDpr",1));values["uBankPx"]=minf(6*dpr,maxf(1.5*dpr,7/px))
	return values

func _draw_latest()->void:
	mutex.lock();var view=pending_view.duplicate(true);draw_queued=false;mutex.unlock()
	if not gpu_ready or released:return
	var started=Time.get_ticks_usec();var cleared:Dictionary={}
	for job in jobs:
		var values=_view_uniforms(job,view);var bytes=_uniform_bytes(job.layout,values)
		if not bytes.is_empty():rd.buffer_update(job.buffer,0,bytes.size(),bytes)
		var clear=not cleared.has(job.target);cleared[job.target]=true
		var draw_list=rd.draw_list_begin(targets[job.target],RenderingDevice.DRAW_CLEAR_COLOR_0 if clear else RenderingDevice.DRAW_DEFAULT_ALL,PackedColorArray([Color(0,0,0,0)]))
		rd.draw_list_bind_render_pipeline(draw_list,job.pipeline);rd.draw_list_bind_uniform_set(draw_list,job.set,0)
		rd.draw_list_draw(draw_list,false,int(job.recorded.get("instances",1)),4);rd.draw_list_end()
	last_submit_ms=(Time.get_ticks_usec()-started)/1000.0;draw_count+=1
	_publish_ready.call_deferred(int(view.serial))

func _publish_ready(value:int)->void:
	if released:return
	rendered_serial=value;ready=value==serial

func stats()->Dictionary:
	return {"renderer":"Render original 2D / native GLSL","ready":ready,"serial":serial,"renderedSerial":rendered_serial,"draws":draw_count,"lastCpuSubmitMs":last_submit_ms,"sourceHead":initial_source,"size":[size.x,size.y],"readbackDuringNavigation":false}

func capture_png(path:String)->Dictionary:
	if not ready:return {"error":"Original Render is not ready"}
	RenderingServer.call_on_render_thread(_capture_gpu.bind(path))
	var result:Dictionary=await capture_completed
	return result

func _capture_gpu(path:String)->void:
	var key=str(scene.get("outputTarget","screen"));var bytes=rd.texture_get_data(textures[key],0)
	_store_capture.call_deferred(path,bytes)

func _store_capture(path:String,bytes:PackedByteArray)->void:
	if bytes.size()!=size.x*size.y*4:capture_completed.emit({"error":"Original framebuffer readback size mismatch"});return
	var image=Image.create_from_data(size.x,size.y,false,Image.FORMAT_RGBA8,bytes);image.flip_y()
	var absolute=ProjectSettings.globalize_path(path);DirAccess.make_dir_recursive_absolute(absolute.get_base_dir())
	var error=image.save_png(absolute)
	if error!=OK:capture_completed.emit({"error":"Could not save Render capture","code":error});return
	capture_completed.emit({"path":absolute,"sha256":FileAccess.get_sha256(absolute),"width":size.x,"height":size.y})

func cleanup()->void:
	if released:return
	released=true
	if output_texture!=null:output_texture.texture_rd_rid=RID()
	RenderingServer.call_on_render_thread(_release_gpu)

func _release_gpu()->void:
	released=true;gpu_ready=false
	if rd!=null:
		resources.reverse()
		for rid in resources:if rid.is_valid():rd.free_rid(rid)
	resources.clear()
