"""Deterministic scene descriptions; the procedural world remains authoritative."""
import math

STYLES = {
    "parchment": "hand-drawn cartography on warm aged parchment, fine ink lines, restrained earth pigments, consistent paper texture",
    "cadastre": "cadastral cartography, precise parcel boundaries and building footprints, crisp fine ink lines, neutral paper, restrained colors and clear road hierarchy",
    "geographic": "physical geographic map, legible relief shading and elevation colors, natural terrain, clear coastlines, rivers and vegetation patterns",
    "satellite": "realistic overhead satellite imagery, natural surface colors, physically plausible terrain and vegetation textures, clearly resolved roads, roofs and water",
    "engraving": "fine copperplate engraving, delicate hatching, monochrome ink, precise architectural linework",
    "watercolor": "fine-art watercolor, translucent washes, textured paper, delicate architectural details",
    "fineart": "fine-art landscape painting, carefully observed architecture, rich natural materials and atmospheric light",
    "photorealistic": "photorealistic landscape and architectural visualization, physically plausible materials, natural light",
    "atlas": "finely illustrated geographic atlas, clear terrain and settlement hierarchy, restrained natural colors",
}
FIDELITY = {
    "strong": "Preserve the exact framing, projection, shoreline, river courses, bridges, major roads, walls, building footprints and landmark positions. Add surface detail without redesigning the geography or urban plan.",
    "balanced": "Preserve the framing, geography, settlement layout and important landmarks. Interpret materials and small details freely.",
    "free": "Keep the geographic identity and principal composition, with artistic freedom in details.",
}


def clean(value, depth=0):
    if depth > 8:
        return None
    if isinstance(value, dict):
        return {str(k)[:80]: clean(v, depth + 1) for k, v in list(value.items())[:80]
                if not any(x in str(k).lower() for x in ("password", "token", "apikey", "api_key", "secret"))}
    if isinstance(value, (list, tuple)):
        return [clean(v, depth + 1) for v in value[:40]]
    if isinstance(value, str):
        return value[:3000]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value if isinstance(value, (str, int, float, bool, type(None))) else str(value)[:300]


def resolve_style(style, source):
    if style != "auto":
        if style not in STYLES:
            raise ValueError("Style inconnu.")
        return style
    source = str(source).lower()
    if "cadastre" in source or "cadastral" in source:
        return "cadastre"
    if "satellite" in source:
        return "satellite"
    if "fantasy-color" in source:
        return "watercolor"
    if any(x in source for x in ("parchment", "parchemin", "fantasy-ink", "illuminated")):
        return "parchment"
    if any(x in source for x in ("engraving", "gravure", "blueprint")):
        return "engraving"
    if any(x in source for x in ("geographic", "topographic", "copernicus", "relief", "biomes")):
        return "geographic"
    return "photorealistic" if "render" in source or "real" in source else "atlas"


def words(value):
    """Human-readable labels, never a serialized configuration object."""
    return " ".join(str(value or "").replace("_", " ").replace("-", " ").split())[:300]


def record(value):
    return value if isinstance(value, dict) else {}


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def culture_name(value, label=None):
    names = {"roman-core": "Roman", "roman": "Roman", "inca": "Inca", "european-organic": "medieval European",
             "medieval": "medieval European", "japanese-jokamachi": "Japanese",
             "chinese": "Chinese", "javanese-courts": "Javanese", "medina": "North African",
             "elven": "elven", "dwarven": "dwarven"}
    return names.get(value) or words(label or value)


def settlement_kind(population=None, size=None):
    population = number(population)
    if population is not None and population > 0:
        return next(kind for limit, kind in [(200, "hamlet"), (1200, "village"), (20000, "town"), (100000, "city"), (1000000, "metropolis"), (math.inf, "megacity")] if population < limit)
    return {"hamlet": "hamlet", "village": "village", "town": "town", "city": "city", "capital": "city"}.get(size, "settlement")


def describe_scene(context):
    environment, generation, architecture = (record(context.get(k)) for k in ("environment", "generation", "architecture"))
    settlements = [s for s in (context.get("settlements") or []) if isinstance(s, dict)]
    relief = str(environment.get("relief") or "")
    terrains = {"flat": "plain", "plain": "plain", "hills": "hilly landscape", "mountains": "mountain landscape",
                "mountain": "mountain landscape", "valley": "valley", "coast": "coastal landscape", "cavern": "underground cavern", "mixed": "varied terrain"}
    climate = str(environment.get("climate") or "")
    climates = {"mediterranean": "Mediterranean", "temperate": "temperate", "oceanic": "oceanic", "cold": "cold",
                "arid": "arid", "desert": "arid", "tropical": "tropical", "tundra": "tundra"}
    terrain, climate = terrains.get(relief, words(relief)), climates.get(climate, words(climate))
    biome = words(environment.get("biome") or context.get("biome") or generation.get("biome"))
    snow = environment.get("snowCover") is True or environment.get("snow") is True or any(term in biome.lower() for term in ("snow-covered", "snow covered", "snowy", "enneig"))
    if snow and relief in ("mountain", "mountains"):
        terrain = "snow-covered mountains"
    setting = " ".join(filter(None, [climate, terrain]))
    primary = max(settlements, key=lambda s: number(s.get("population")) or 0) if settlements else {}
    configured_city = generation.get("workflow") != "environment" and bool(generation.get("culture"))
    has_city = bool(settlements or configured_city or architecture.get("traditions"))
    culture = culture_name(primary.get("urbanCulture") or generation.get("culture"), primary.get("cultureDescription") or generation.get("cultureDescription")) if has_city else ""
    kind = settlement_kind(primary.get("population", generation.get("population")), generation.get("size"))
    city = f"{culture + ' ' if culture else ''}{kind}"
    subject = f"{'an' if city[:1].lower() in 'aeiou' and not city.startswith('European') else 'a'} {city}" if has_city else "a natural terrain landscape"
    if len(settlements) > 1:
        subject = f"a regional landscape with {len(settlements)} visible settlements"
    projection = context.get("projection", "orthographic")
    camera = {"orthographic": "A strictly top-down aerial view", "perspective": "An elevated oblique aerial view", "globe": "A globe view"}.get(projection, "A view from the source camera")
    article = "" if terrain.endswith("mountains") else "an " if setting[:1].lower() in "aeiou" else "a "
    summary = f"{camera} of {subject}" + (f" in {article}{setting}" if setting else "") + "."
    sentences = [summary]
    if biome:
        sentences.append(f"The available biome estimate is {biome}." if environment.get("biomeEvidence") else f"The landscape biome is {biome}.")
    if environment.get("environment") and environment["environment"] != "mixed":
        sentences.append(f"The surrounding ground environment is {words(environment['environment'])}.")
    if snow and relief not in ("mountain", "mountains"):
        sentences.append("Snow cover is part of the scene.")
    temperature = number(environment.get("meanTemperatureC", environment.get("temperature")))
    rain = number(environment.get("annualRainMm", environment.get("precipitation")))
    if temperature is not None:
        sentences.append(f"The reported mean temperature is approximately {temperature:g} degrees Celsius.")
    if rain is not None:
        sentences.append(f"Annual precipitation is approximately {rain:g} mm.")
    low, high = number(environment.get("minHeight")), number(environment.get("maxHeight"))
    if low is not None and high is not None:
        sentences.append(f"Reported terrain elevation ranges from {low:,.0f} to {high:,.0f} metres.")
    if environment.get("biomeEvidence"):
        sentences.append(words(environment["biomeEvidence"]).rstrip(".") + ".")
    for index, settlement in enumerate(settlements):
        name = words(settlement.get("name"))
        tradition = culture_name(settlement.get("urbanCulture"), settlement.get("cultureDescription"))
        kind = settlement_kind(settlement.get("population"))
        detail = f"The {tradition + ' ' if tradition else ''}{kind}" + (f' named "{name}"' if name else f" (visible settlement {index + 1})")
        population = number(settlement.get("population"))
        if population is not None and population > 0:
            detail += f" has approximately {population:,.0f} inhabitants in the complete settlement"
        screen = record(settlement.get("screen")); x, y = number(screen.get("x")), number(screen.get("y"))
        if x is not None and y is not None:
            if 0 <= x <= 1 and 0 <= y <= 1:
                detail += f"; its centre lies {('towards the left' if x < .33 else 'towards the right' if x > .67 else 'near the horizontal centre')} and {('towards the top' if y < .33 else 'towards the bottom' if y > .67 else 'near the vertical centre')} of the image"
            else:
                detail += "; its centre is outside the crop, so depict only its visible outskirts"
        sentences.append(detail + ".")
    if not settlements and configured_city and number(generation.get("population")):
        sentences.append(f"The configured whole-settlement population is approximately {generation['population']:,.0f} inhabitants; only the portion shown in the image should be depicted.")
    traditions = list(dict.fromkeys(culture_name(c) for c in architecture.get("traditions", []) if isinstance(c, str)))
    if traditions:
        sentences.append("Visible building traditions include " + ", ".join(traditions[:8]) + ".")
    roofs = [words(r) for r in architecture.get("roofSystems", []) if isinstance(r, str)]
    if roofs:
        sentences.append("Visible roof forms include " + ", ".join(roofs[:10]) + ".")
    materials = [words(m.get("label") or m.get("pattern")) for m in architecture.get("materials", []) if isinstance(m, dict)]
    if materials:
        sentences.append("Construction materials identified on the visible buildings include " + ", ".join(dict.fromkeys(materials)) + ".")
    storeys = [n for n in architecture.get("storeys", []) if number(n) is not None]
    if storeys:
        sentences.append(f"The sampled visible buildings have between {min(storeys):g} and {max(storeys):g} storeys.")
    if generation.get("river") and generation["river"] not in ("none", "0"):
        sentences.append("The map contains a river; reproduce its visible course from the image rather than adding a new channel.")
    if generation.get("coast") and generation["coast"] not in ("none", "0"):
        sentences.append("The map includes a coast; retain the shoreline exactly where it is visible in the image.")
    extent = record(context.get("extentMetres"))
    if number(extent.get("width")) and number(extent.get("height")):
        sentences.append(f"The captured extent is approximately {extent['width']:,.0f} by {extent['height']:,.0f} metres.")
    if not has_city:
        sentences.append("No settlement is identified in the supplied scene context; do not invent urban development.")
    return summary, " ".join(sentences)


def compile_prompt(context, settings):
    context = clean(context)
    style = resolve_style(settings.get("style", "auto"), context.get("sourceStyle", ""))
    fidelity = settings.get("fidelity", "strong")
    if fidelity not in FIDELITY:
        raise ValueError("Fidélité inconnue.")
    projection = context.get("projection", "orthographic")
    camera = ("Keep a strictly top-down orthographic map; do not introduce a horizon or perspective."
              if projection == "orthographic" else "Keep the source camera angle and projection.")
    summary, description = describe_scene(context)
    instruction = str(settings.get("instruction", "")).strip()[:3000]
    details = ("Preserve the visible details and their relative positions, orientations, shapes, proportions and density: "
               "street intersections, parcels, roof outlines, courtyards, open spaces, vegetation, terrain contours and water boundaries. "
               if fidelity == "strong" else "Retain the visible geographic identity and principal landmarks, respecting the chosen fidelity level. ")
    prompt = ("Edit the supplied source image itself, using it as the authoritative visual reference. "
              "Reproduce this same place in the requested artistic style; do not create a different scene merely inspired by the description. "
              f"Requested style: {STYLES[style]}.\n\n"
              f"{camera} {FIDELITY[fidelity]} "
              f"{details}"
              "Change the visual rendering of textures, palette, material surfaces and lighting to achieve the requested style. "
              "Where the description is incomplete or ambiguous, follow the source image. Do not infer weather, snow or a different biome from the culture alone. "
              "Use the specified architectural traditions without replacing the actual buildings with generic European castles or stereotypical monuments. "
              "Keep distinct cultural districts in their original locations. Only depict features visible at this scale. "
              "Do not add labels, text, legends, UI, watermarks, modern vehicles or modern infrastructure unless explicitly part of the scene. "
              f"\n\nScene description: {description[:18000]}\n\n"
              f"Additional artistic request: {instruction or 'None.'}")
    # CLIP in SDXL has a short context; prioritize the concrete subject and style.
    architecture = record(context.get("architecture"))
    roofs = ", ".join(words(r) for r in architecture.get("roofSystems", [])[:2])
    materials = ", ".join(words(m.get("label") or m.get("pattern")) for m in architecture.get("materials", [])[:2] if isinstance(m, dict))
    short_architecture = (f" Roof forms: {roofs}." if roofs else "") + (f" Materials: {materials}." if materials else "")
    fast_prompt = f"{summary} {STYLES[style]}.{short_architecture} Preserve the source layout, roads, rivers and buildings. No labels. {instruction}"
    local_prompt = f"{summary} {STYLES[style]}. {camera} {FIDELITY[fidelity]} {description} {instruction}"
    customized = "promptOverride" in settings
    if customized:
        override = settings["promptOverride"]
        limit = {"fast": 3000, "quality": 6000, "cloud": 28000}.get(settings.get("mode", "cloud"), 28000)
        if not isinstance(override, str) or not override.strip():
            raise ValueError("Le prompt personnalisé ne peut pas être vide.")
        if len(override) > limit:
            raise ValueError(f"Le prompt personnalisé est limité à {limit} caractères pour ce moteur.")
        prompt = fast_prompt = local_prompt = override.strip()
    return {"description": description, "prompt": prompt[:28000], "fastPrompt": fast_prompt, "localPrompt": local_prompt[:6000], "style": style,
            "customized": customized,
            "negativePrompt": "text, labels, user interface, distorted geography, misplaced bridges, redesigned street plan"}


def dimensions(width, height, pixels, multiple=16):
    if not (1 <= width <= 16384 and 1 <= height <= 16384):
        raise ValueError("Dimensions de capture invalides.")
    scale = math.sqrt(pixels / (width * height))
    w, h = max(multiple, round(width * scale / multiple) * multiple), max(multiple, round(height * scale / multiple) * multiple)
    return w, h
