extends SceneTree
var viewport:SubViewport
func _initialize()->void:call_deferred("run")
func run()->void:
 var args=OS.get_cmdline_user_args();var output=args[0];DirAccess.make_dir_recursive_absolute(output)
 viewport=SubViewport.new();viewport.size=Vector2i(256,256);viewport.own_world_3d=true;viewport.render_target_update_mode=SubViewport.UPDATE_ALWAYS;root.add_child(viewport)
 var environment=WorldEnvironment.new();environment.environment=Environment.new();environment.environment.background_mode=Environment.BG_COLOR;environment.environment.background_color=Color.BLACK;environment.environment.tonemap_mode=Environment.TONE_MAPPER_LINEAR;viewport.add_child(environment)
 var camera=Camera3D.new();camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.size=1;camera.position.z=2;viewport.add_child(camera)
 var shader=Shader.new();shader.code='shader_type spatial;render_mode unshaded,cull_disabled;\n#include "res://shaders/forest_alpha_hash.gdshaderinc"\nuniform float coverage;uniform float coordinate_scale;uniform uint seed;varying vec3 p;void vertex(){p=VERTEX*coordinate_scale;}void fragment(){if(coverage<forest_alpha_threshold(p,p,seed))discard;ALBEDO=vec3(1);}'
 var material=ShaderMaterial.new();material.shader=shader
 var node=MeshInstance3D.new();var mesh=QuadMesh.new();mesh.size=Vector2.ONE;node.mesh=mesh;node.material_override=material;viewport.add_child(node)
 var rows=[];var maximum_error=0.0
 for scale in [.25,1.0,3.7,29.0]:
  for coverage in [0.0,.1,.25,.5,.75,1.0]:
   var total=0
   for seed_value in [0,1341,482919,1905266606]:
    material.set_shader_parameter("coverage",coverage);material.set_shader_parameter("coordinate_scale",scale);material.set_shader_parameter("seed",seed_value)
    await process_frame;await RenderingServer.frame_post_draw
    var image=viewport.get_texture().get_image();var count=0
    for y in 256:
     for x in 256:
      if image.get_pixel(x,y).r>.5:count+=1
    total+=count
   var observed=float(total)/(256*256*4);var error=absf(observed-coverage);maximum_error=maxf(maximum_error,error)
   rows.append({"scale":scale,"coverage":coverage,"observed":observed,"error":error})
 var report={"rows":rows,"maximumCoverageError":maximum_error,"adapter":RenderingServer.get_video_adapter_name(),"result":"PASS" if maximum_error<=.02 else "FAIL","scope":"actual shader constant-alpha minification marginal coverage on authored planar receivers, four seeds; not correlated real-forest opacity/3D visibility proof"}
 var file=FileAccess.open(output.path_join("report.json"),FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));file.close()
 print(JSON.stringify(report));quit(0 if maximum_error<=.02 else 1)
