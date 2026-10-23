extends SceneTree
# CPU-only check of saved GPU images: the roof control must cover water that was
# actually present in the same view before the layer2 receiver was introduced.
func _initialize():
	var args=OS.get_cmdline_user_args()
	if args.size()!=1:push_error("Expected captured-image directory");quit(2);return
	var before=Image.load_from_file(args[0].path_join("symbols-1_25.png"));var after=Image.load_from_file(args[0].path_join("symbols-roof.png"))
	var min_x=after.get_width();var min_y=after.get_height();var max_x=-1;var max_y=-1
	for y in after.get_height():
		for x in after.get_width():
			var c=after.get_pixel(x,y)
			if c.r>.95 and c.g<.03 and c.b<.03:min_x=mini(min_x,x);max_x=maxi(max_x,x);min_y=mini(min_y,y);max_y=maxi(max_y,y)
	var water_before=0;var water_after=0
	if min_x<max_x and min_y<max_y:
		for y in range(min_y+1,max_y):
			for x in range(min_x+1,max_x):
				var a=before.get_pixel(x,y);var b=after.get_pixel(x,y)
				if a.b>a.r+.12 and a.b>.2:water_before+=1
				if b.b>b.r+.12 and b.b>.2:water_after+=1
	var passed=water_before>0 and water_after==0
	var report={"CPUOnly":true,"passed":passed,"roofRedBoundsPx":[min_x,min_y,max_x,max_y],"sameInteriorWaterBeforeRoofPixels":water_before,"sameInteriorWaterAfterRoofPixels":water_after,"scope":"Saved identical-camera GPU images, interior of the actual red roof bounds; confirms that terrain-only symbols are occluded by layer2 geometry. No additional GPU run."}
	var file=FileAccess.open(args[0].path_join("image-evidence.json"),FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));file.close();print(JSON.stringify(report));quit(0 if passed else 1)
