extends SceneTree

const Locale = preload("res://adapters/surface_locale.gd")

func _initialize() -> void:
	assert(Locale.normalize("zh-Hans-CN") == "zh")
	assert(Locale.normalize("pt_BR") == "pt")
	assert(Locale.normalize("de-DE") == "en")
	var values := [1.0, 2.0, "view", "source", "lod", 3.0, "family", 4, 5, 0.5, 0.6, 7, 8, 9, "ready", "warning"]
	for language in Locale.LANGUAGES:
		var result: String = Locale.template(language) % values
		assert(result.contains("source"))
		assert(result.contains("warning"))
		for index in 5:
			assert(not Locale.label(language, index).is_empty())
	print("surface locale: PASS")
	quit()
