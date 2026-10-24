extends SceneTree
func _initialize()->void:RenderingServer.call_on_render_thread(compile_shaders)
func compile_shaders()->void:
	var rd=RenderingServer.get_rendering_device()
	if rd==null:finish.call_deferred({"error":"RenderingDevice unavailable"});return
	var layout:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://shaders/shader_layout.json"))
	var report:Dictionary={}
	for name in layout.programs:
		var source:=RDShaderSource.new();var program:Dictionary=layout.programs[name]
		source.source_vertex=FileAccess.get_file_as_string("res://shaders/"+program.vertex)
		source.source_fragment=FileAccess.get_file_as_string("res://shaders/"+program.fragment)
		var spirv=rd.shader_compile_spirv_from_source(source)
		var errors:Array=[]
		for stage in [RenderingDevice.SHADER_STAGE_VERTEX,RenderingDevice.SHADER_STAGE_FRAGMENT]:
			var error=spirv.get_stage_compile_error(stage)
			if not error.is_empty():errors.append(error)
		report[name]=errors
	finish.call_deferred(report)
func finish(report:Dictionary)->void:
	print(JSON.stringify({"event":"original-render-compile","report":report}))
	var success=not report.has("error")
	for value in report.values():if value is Array and not value.is_empty():success=false
	quit(0 if success else 1)
