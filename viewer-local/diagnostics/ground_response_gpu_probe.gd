extends SceneTree
const Data=preload("res://adapters/surface_data.gd")
const Layers=preload("res://adapters/surface_layers.gd")
const Ground=preload("res://adapters/surface_ground_response.gd")
var failures:Array=[]
var resources:Array[RID]=[]
var rd:RenderingDevice
func _initialize():call_deferred("run")
func image_uniform(binding:int,image:Image,sampler:RID)->RDUniform:
	var format=RDTextureFormat.new();format.width=image.get_width();format.height=image.get_height();format.format=RenderingDevice.DATA_FORMAT_R32G32B32A32_SFLOAT;format.usage_bits=RenderingDevice.TEXTURE_USAGE_SAMPLING_BIT
	var texture=rd.texture_create(format,RDTextureView.new(),[image.get_data().slice(0,format.width*format.height*16)]);resources.append(texture)
	var uniform=RDUniform.new();uniform.uniform_type=RenderingDevice.UNIFORM_TYPE_SAMPLER_WITH_TEXTURE;uniform.binding=binding;uniform.add_id(sampler);uniform.add_id(texture);return uniform
func buffer_uniform(binding:int,bytes:PackedByteArray)->RDUniform:
	var buffer=rd.storage_buffer_create(bytes.size(),bytes);resources.append(buffer)
	var uniform=RDUniform.new();uniform.uniform_type=RenderingDevice.UNIFORM_TYPE_STORAGE_BUFFER;uniform.binding=binding;uniform.add_id(buffer);return uniform
func check(value:bool,message:String):
	if not value:failures.append(message)
func linear_byte(value:float)->float:
	var s=value/255.0;return s/12.92 if s<=.04045 else pow((s+.055)/1.055,2.4)
func run():
	var args=OS.get_cmdline_user_args()
	if args.size()!=2:push_error("fixture directory, output report required");quit(2);return
	rd=RenderingServer.create_local_rendering_device()
	if rd==null:push_error("An actual Vulkan RenderingDevice is required");quit(2);return
	var fixture:String=args[0];var expected=JSON.parse_string(FileAccess.get_file_as_string(fixture.path_join("expected.json")));var records=[]
	var pure=""
	for line in FileAccess.get_file_as_string("res://shaders/ground_response.gdshaderinc").split("\n"):
		if not line.begins_with("uniform "):pure+=line+"\n"
	var source=RDShaderSource.new();source.source_compute="""#version 450
layout(local_size_x=64)in;
layout(set=0,binding=0)uniform sampler2D ground_response_soil;
layout(set=0,binding=1)uniform sampler2D ground_response_processes;
layout(set=0,binding=2)uniform sampler2D ground_response_codes;
layout(set=0,binding=3)uniform sampler2D surface_ids;
layout(set=0,binding=4)uniform sampler2D surface_average;
layout(set=0,binding=5,std430)readonly buffer Constants{vec4 palette[32];vec4 ground_response_unit_colors[64];int ground_response_color_roles[32];vec4 ground_response_recipe_ids0;vec4 ground_response_recipe_ids1;vec4 map_palette[32];vec4 source_params;};
layout(set=0,binding=6,std430)readonly buffer Points{vec4 points[];};
layout(set=0,binding=7,std430)writeonly buffer Results{vec4 results[];};
const bool ground_response_enabled=true;
"""+pure+"""
void main(){uint i=gl_GlobalInvocationID.x;if(i>=points.length())return;vec2 uv=((points[i].xy-source_params.xy)/source_params.z+vec2(.5))/vec2(textureSize(surface_ids,0));ivec2 pair;float blend;vec3 mean;bool available=ground_response_sample(uv,pair,blend,mean);results[i*3]=vec4(pair,blend,available?1.:0.);results[i*3+1]=vec4(mean,1.);results[i*3+2]=vec4(mix(map_palette[pair.x].rgb,map_palette[pair.y].rgb,blend),1.);}
"""
	var spirv=rd.shader_compile_spirv_from_source(source)
	if not spirv.get_stage_compile_error(RenderingDevice.SHADER_STAGE_COMPUTE).is_empty():push_error(spirv.get_stage_compile_error(RenderingDevice.SHADER_STAGE_COMPUTE));quit(1);return
	var shader=rd.shader_create_from_spirv(spirv);var pipeline=rd.compute_pipeline_create(shader);resources.append_array([shader,pipeline])
	var sampler=rd.sampler_create(RDSamplerState.new());resources.append(sampler)
	for name in ["canonical","rebased","refined"]:
		var packet=Data.read_json(fixture.path_join(name+".surfacebin"));var world:Dictionary=packet.get("world",packet);var context=Data.context(world);var prepared=Layers.prepare(world);var bindings:Dictionary=prepared.groundResponse.bindings
		var constants:=PackedByteArray();constants.resize(2224);var offset=0
		for i in 32:
			var color=world.materials[mini(i,world.materials.size()-1)].colorLinear
			for c in 4:constants.encode_float(offset+c*4,float(color[c]) if c<3 else 1.0)
			offset+=16
		for color in bindings.ground_response_unit_colors:
			for c in 4:constants.encode_float(offset+c*4,color[c])
			offset+=16
		for role in bindings.ground_response_color_roles:constants.encode_s32(offset,role);offset+=4
		for value in [bindings.ground_response_recipe_ids0,bindings.ground_response_recipe_ids1]:
			for c in 4:constants.encode_float(offset+c*4,value[c])
			offset+=16
		# Deliberately blue presentation, unrelated to physical brown/green means.
		for i in 32:
			for c in 4:constants.encode_float(offset+c*4,[.02+float(i)/2000.,.08+float(i)/2000.,.65,1.][c])
			offset+=16
		var grid:Dictionary=context.grid;var anchor_x=float(grid.originX)+193.0;var anchor_z=float(grid.originZ)+277.0
		for value in [float(grid.originX)-anchor_x,float(grid.originZ)-anchor_z,float(grid.spacingM),0.0]:constants.encode_float(offset,value);offset+=4
		check(offset==constants.size(),"constant buffer framing")
		var samples:Array=expected.worlds[name].samples;var point_bytes:=PackedFloat32Array()
		for sample in samples:point_bytes.append_array([float(sample.x)-anchor_x,float(sample.z)-anchor_z,0.0,0.0])
		var result_bytes=PackedByteArray();result_bytes.resize(samples.size()*48)
		var uniforms:Array[RDUniform]=[image_uniform(0,bindings.ground_response_soil,sampler),image_uniform(1,bindings.ground_response_processes,sampler),image_uniform(2,bindings.ground_response_codes,sampler),image_uniform(3,prepared.groundIds,sampler),image_uniform(4,prepared.groundAverage,sampler),buffer_uniform(5,constants),buffer_uniform(6,point_bytes.to_byte_array()),buffer_uniform(7,result_bytes)]
		var uniform_set=rd.uniform_set_create(uniforms,shader,0);resources.append(uniform_set)
		var list=rd.compute_list_begin();rd.compute_list_bind_compute_pipeline(list,pipeline);rd.compute_list_bind_uniform_set(list,uniform_set,0);rd.compute_list_dispatch(list,ceili(float(samples.size())/64.0),1,1);rd.compute_list_end();rd.submit();rd.sync()
		var actual=rd.buffer_get_data(uniforms[7].get_ids()[0]).to_float32_array();var maximum=0.0;var maximum_regular=0.0;var maximum_blend=0.0;var id_mismatches=0;var quantized_points=0;var maximum_map=0.0
		for i in samples.size():
			var sample=samples[i];var base=i*12;var gx=(float(sample.x)-float(grid.originX))/float(grid.spacingM);var gz=(float(sample.z)-float(grid.originZ))/float(grid.spacingM)
			var knot=absf(gx-roundf(gx))<0.00001 and absf(gz-roundf(gz))<0.00001
			var bound=0.00002
			if knot:
				var encoded=int(context.fields.groundMaterialMeanColor[roundi(gz)*int(grid.width)+roundi(gx)]);var norm=0.0
				for c in 3:
					var b=float((encoded>>(8*c))&255);var half_step=maxf(linear_byte(minf(255,b+.5))-linear_byte(b),linear_byte(b)-linear_byte(maxf(0,b-.5)));norm+=half_step*half_step
				bound+=sqrt(norm)
			var delta=0.0
			for c in 3:delta+=pow(float(actual[base+4+c])-float(sample.mean[c]),2)
			delta=sqrt(delta);maximum=maxf(maximum,delta)
			if knot:quantized_points+=1
			else:maximum_regular=maxf(maximum_regular,delta)
			if int(actual[base])!=int(sample.primary) or int(actual[base+1])!=int(sample.secondary):id_mismatches+=1
			maximum_blend=maxf(maximum_blend,absf(float(actual[base+2])-float(sample.blend)))
			var first=int(actual[base]);var second=int(actual[base+1]);var blend=float(actual[base+2]);var mapped=[lerpf(.02+first/2000.,.02+second/2000.,blend),lerpf(.08+first/2000.,.08+second/2000.,blend),.65]
			for c in 3:maximum_map=maxf(maximum_map,absf(float(actual[base+8+c])-mapped[c]))
			check(actual[base+3]==1.0,"availability "+name)
			check(delta<bound,"mean parity "+name+":"+str(i)+" delta="+str(delta)+" bound="+str(bound))
		check(id_mismatches==0,"compact pair "+name+" mismatches="+str(id_mismatches));check(maximum_blend<0.00002,"blend "+name);check(maximum_map<0.000001,"blueprint palette "+name)
		records.append({"world":name,"samples":samples.size(),"quantizedKnotOrNearCount":quantized_points,"maximumMeanLinearNormError":maximum,"maximumRegularMeanLinearNormError":maximum_regular,"maximumBlendError":maximum_blend,"idMismatches":id_mismatches,"maximumPresentationChannelError":maximum_map,"renderOrigin":{"x":anchor_x,"z":anchor_z}})
	var report={"format":"ground-response-gpu-float32-proof","version":1,"status":"PASS" if failures.is_empty() else "FAIL","records":records,"failures":failures,"precision":"Actual Vulkan compute shader, RGBA32F input textures and Float32 output buffers; same pure GLSL function and native adapter textures. No sRGB framebuffer quantization. Canonical node means themselves retain original sRGB8 quantization.","scope":"Physical response/binding/half-texel/rebasing and independent blue presentation numerical check; actual Terrain3D raster/style screenshots are a separate probe."}
	var file=FileAccess.open(args[1],FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));file=null
	resources.reverse()
	for resource in resources:rd.free_rid(resource)
	print(JSON.stringify(report));quit(0 if failures.is_empty() else 1)
