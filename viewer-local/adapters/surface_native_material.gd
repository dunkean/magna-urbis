class_name SurfaceNativeMaterial
extends RefCounted
# Display binding only: raw optional material presence/null and native slot
# dictionaries stay unchanged in the source packet. IDs are opaque strings.
static func resolve(material_id,slots:Dictionary,surface_name:String)->String:
	if material_id is String and not material_id.is_empty():return material_id
	for slot in (["cladding","roof_frame"] if surface_name=="roof" else ["coating","infill","frame","base"]):
		var candidate=slots.get(slot)
		if candidate is String and not candidate.is_empty():return candidate
	return ""
