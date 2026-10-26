extends RefCounted
static func texture(color:Color)->ImageTexture:
	var im=Image.create(16,16,false,Image.FORMAT_RGBAF);im.fill(color);return ImageTexture.create_from_image(im)
static func plane(app:Node3D,degrees:float,azimuth:float=0.0)->Vector2:
	var gradient=Vector2(cos(azimuth),sin(azimuth))*tan(deg_to_rad(degrees))
	var image=Image.create(16,16,false,Image.FORMAT_RF);var peak=0.0
	for y in 16:
		for x in 16:
			var h=1500+gradient.dot((Vector2(x,y)+Vector2(.5,.5))/16*40000-Vector2(20000,20000));image.set_pixel(x,y,Color(h,0,0));peak=maxf(peak,h)
	app.height_image=image;app.material.set_shader_parameter("height_map",ImageTexture.create_from_image(image));app.material.set_shader_parameter("height_n",16.0)
	app.terrain_max_height=peak+5;app.terrain.custom_aabb=AABB(Vector3(-20000,0,-20000),Vector3(40000,peak+5,40000));app.vertex_height_cache.clear()
	app.set_detail_enabled(false);app.material.set_shader_parameter("meso_material_enabled",false);app.material.set_shader_parameter("original_cover_enabled",false);app.material.set_shader_parameter("ground_auto_snow",false);app.material.set_shader_parameter("ground_macro_reference",false);app.material.set_shader_parameter("water_shore_ready",false)
	app.material.set_shader_parameter("ground_indices",texture(Color(0,0,0,0)));app.material.set_shader_parameter("ground_weights",texture(Color(1,0,0,0)))
	for key in ["ground_indices_extra","ground_weights_extra","cover_indices","cover_weights","ground_water","river_footprint"]:app.material.set_shader_parameter(key,texture(Color(0,0,0,0)))
	app.material.set_shader_parameter("ground_attributes",texture(Color(0,.7,0,0)));app.material.set_shader_parameter("ground_structure",texture(Color(1,.5,1,1)))
	app.sun.shadow_enabled=false;app.focus=Vector3(20000,1500,20000);app.top_view=false;app.yaw=atan2(-gradient.x,-gradient.y) if degrees>0 else .4;app.elevation=.55 if degrees>0 else .9;app.update_camera()
	return gradient
static func steep_point(app:Node3D,lit:bool=false)->Dictionary:
	var best=0.0;var point=Vector2(21000,20000);var direction=Vector2(1,0)
	for y in range(80,1254,3):
		for x in range(80,1254,3):
			var w=app.ground_weights_image.get_pixel(x,y);var water=app.ground_water_image.get_pixel(x,y)
			if w.r+w.g<.4 or water.a>.01:continue
			var g=Vector2(app.height_image.get_pixel(x+1,y).r-app.height_image.get_pixel(x-1,y).r,app.height_image.get_pixel(x,y+1).r-app.height_image.get_pixel(x,y-1).r)*1334.0/80000
			if lit and Vector3(-g.x,1,-g.y).normalized().dot(app.sun.global_basis.z)<.45:continue
			var score=g.length()
			if score>best:best=score;point=Vector2(x+.5,y+.5)/1334*40000;direction=g
	return {"point":point,"yaw":atan2(-direction.x,-direction.y),"slopeDegrees":rad_to_deg(atan(direction.length()))}
