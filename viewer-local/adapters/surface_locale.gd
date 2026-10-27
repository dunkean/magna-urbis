extends RefCounted

const LANGUAGES := ["fr", "en", "zh", "es", "pt"]
const HUD := {
	"fr": "MAGNA URBIS  /  SURFACE WORLD\n%.2f m de large · %.4f m/px · %s\n%s · LOD source %s / %.2f m natif\n%s · roche %d · dépôt %d · humidité %.2f · arbres %.2f\n%d / %d candidats visibles · %d images · %s\nMolette : zoom  Glisser : déplacer  O : dessus/oblique  D : diagnostics  F : inspecter  S : capture  1–7 : échelles\n%s",
	"en": "MAGNA URBIS  /  SURFACE WORLD\n%.2f m wide · %.4f m/px · %s\n%s · source LOD %s / %.2f m native\n%s · rock %d · deposit %d · wet %.2f · trees %.2f\n%d / %d candidates visible · %d frames · %s\nWheel: zoom  Drag: pan  O: top/oblique  D: diagnostics  F: inspect  S: capture  1–7: scales\n%s",
	"zh": "MAGNA URBIS  /  SURFACE WORLD\n宽 %.2f 米 · %.4f 米/像素 · %s\n%s · 源 LOD %s / 原生 %.2f 米\n%s · 岩石 %d · 沉积 %d · 湿度 %.2f · 树木 %.2f\n%d / %d 个候选可见 · %d 帧 · %s\n滚轮：缩放  拖动：平移  O：俯视/斜视  D：诊断  F：检查  S：截图  1–7：比例\n%s",
	"es": "MAGNA URBIS  /  SURFACE WORLD\n%.2f m de ancho · %.4f m/px · %s\n%s · LOD de origen %s / %.2f m nativos\n%s · roca %d · depósito %d · humedad %.2f · árboles %.2f\n%d / %d candidatos visibles · %d fotogramas · %s\nRueda: zoom  Arrastrar: mover  O: superior/oblicua  D: diagnóstico  F: inspeccionar  S: captura  1–7: escalas\n%s",
	"pt": "MAGNA URBIS  /  SURFACE WORLD\n%.2f m de largura · %.4f m/px · %s\n%s · LOD de origem %s / %.2f m nativos\n%s · rocha %d · depósito %d · umidade %.2f · árvores %.2f\n%d / %d candidatos visíveis · %d quadros · %s\nRoda: zoom  Arrastar: mover  O: superior/oblíqua  D: diagnóstico  F: inspecionar  S: captura  1–7: escalas\n%s",
}
const LABELS := {
	"fr": ["oblique", "dessus", "inconnu (conservé)", "préparation (le parent reste visible)", "prêt"],
	"en": ["oblique", "top", "unknown (retained)", "preparing (parent remains visible)", "ready"],
	"zh": ["斜视", "俯视", "未知（保留）", "准备中（父级保持可见）", "就绪"],
	"es": ["oblicua", "superior", "desconocido (conservado)", "preparando (el nivel superior sigue visible)", "listo"],
	"pt": ["oblíqua", "superior", "desconhecido (mantido)", "preparando (o nível superior permanece visível)", "pronto"],
}

static func normalize(value: String) -> String:
	var language := value.to_lower().replace("-", "_").split("_")[0]
	return language if language in LANGUAGES else "en"

static func template(locale: String) -> String:
	return HUD[normalize(locale)]

static func label(locale: String, index: int) -> String:
	return LABELS[normalize(locale)][index]
