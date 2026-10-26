"""Generate ignored, timed adapter copies; never edit production adapters."""
from pathlib import Path

project = Path(__file__).resolve().parents[1]
output = project / "captures/native-v11-profile"
output.mkdir(parents=True, exist_ok=True)
helper = """
static var profile:Dictionary={}
static var profile_tick:int=0
static func _profile_start()->void:profile={};profile_tick=Time.get_ticks_usec()
static func _profile_mark(name:String)->void:
	profile[name]=(Time.get_ticks_usec()-profile_tick)/1000.0;profile_tick=Time.get_ticks_usec()
"""


def source(name):
    text = (project / "adapters" / name).read_text(encoding="utf-8")
    assert text.startswith("class_name ")
    return text[text.index("\n") + 1:] + helper


def change(text, before, after):
    if text.count(before) != 1:
        raise RuntimeError(f"Profile anchor changed: {before!r}")
    return text.replace(before, after)


def save(name, text):
    (output / name).write_text(text, encoding="utf-8")


s = source("surface_data.gd")
for before, after in [
    ("\tvar start := Time.get_ticks_usec()\n", "\tvar start := Time.get_ticks_usec()\n\t_profile_start()\n"),
    ("\t# Terrain3D 1.0.2 import_images floors", "\t_profile_mark(\"displaySourceMs\")\n\t# Terrain3D 1.0.2 import_images floors"),
    ("\t# Native context resolution remains", "\t_profile_mark(\"heightImagesMs\")\n\t# Native context resolution remains"),
    ("\tresult.surfaceLayers=layers", "\t_profile_mark(\"layerImagesMs\")\n\tresult.surfaceLayers=layers"),
    ("\tstate.generate_mipmaps()", "\t_profile_mark(\"contextImagesMs\")\n\tstate.generate_mipmaps()"),
    ("\t_append_scene(result,world,packet,origin,view_width,scene_request)\n\tresult.prepareMs=", "\t_profile_mark(\"contextMipsMs\")\n\t_append_scene(result,world,packet,origin,view_width,scene_request)\n\t_profile_mark(\"baseGeometryMs\")\n\tresult.prepareMs="),
    ("\t\t_append_scene(result,world,packet,origin,view_width,scene_request)\n\t\tresult.prepareMs=", "\t\t_profile_mark(\"contextSkippedMs\")\n\t\t_append_scene(result,world,packet,origin,view_width,scene_request)\n\t\t_profile_mark(\"baseGeometryMs\")\n\t\tresult.prepareMs="),
]:
    s = change(s, before, after)
save("surface_data.gd", s)

s = source("surface_canopy.gd")
for before, after in [
    ("\t# Packets are immutable snapshots.", "\t_profile_start()\n\t# Packets are immutable snapshots."),
    ("\tfor i in range(count):", "\t_profile_mark(\"setupArraysMs\")\n\tfor i in range(count):"),
    ("\tvar coverage_image :=", "\t_profile_mark(\"crownRasterMs\")\n\tvar coverage_image :="),
    ("\tvar digest=HashingContext.new();", "\t_profile_mark(\"imageMipsMs\")\n\tvar digest=HashingContext.new();"),
    ("\t_cached_atlas=atlas", "\t_profile_mark(\"hashAndMetadataMs\")\n\t_cached_atlas=atlas"),
]:
    s = change(s, before, after)
save("surface_canopy.gd", s)
save("surface_population.gd", source("surface_population.gd").replace("res://adapters/surface_canopy.gd", "res://captures/native-v11-profile/surface_canopy.gd"))

s = source("surface_hydrology.gd")
for before, after in [
    ("\tvar started:=Time.get_ticks_usec()", "\tvar started:=Time.get_ticks_usec()\n\t_profile_start()"),
    ("\tvar water=source.get(\"water\",{})", "\t_profile_mark(\"sourceGeometryDecodeMs\")\n\tvar water=source.get(\"water\",{})"),
    ("\tvar window:=Geometry._window(focus,width)", "\t_profile_mark(\"waterValidationMs\")\n\tvar window:=Geometry._window(focus,width)"),
    ("\tfor group in geometry.water:", "\t_profile_mark(\"windowSetupMs\")\n\tfor group in geometry.water:"),
    ("\t# Sea remains the exact original", "\t_profile_mark(\"vectorClipMeshLevelsMs\")\n\t# Sea remains the exact original"),
    ("\tvar bed_diagnostics:=vector_bed_diagnostics", "\t_profile_mark(\"seaUnionMs\")\n\tvar bed_diagnostics:=vector_bed_diagnostics"),
    ("\tvertices.append_array(sea.vertices)", "\t_profile_mark(\"bedDiagnosticsMs\")\n\tvertices.append_array(sea.vertices)"),
    ("\tresult.buildMs=(Time.get_ticks_usec()-started)/1000.0", "\t_profile_mark(\"metadataAndClassImageMs\")\n\tresult.buildMs=(Time.get_ticks_usec()-started)/1000.0"),
]:
    s = change(s, before, after)
save("surface_hydrology.gd", s)
s = source("surface_scene_prepare.gd")
for name in ["surface_data.gd", "surface_population.gd", "surface_hydrology.gd"]:
    s = s.replace("res://adapters/" + name, "res://captures/native-v11-profile/" + name)
save("surface_scene_prepare.gd", s)
print(output)
