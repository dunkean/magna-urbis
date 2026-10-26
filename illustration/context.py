"""Deterministic scene descriptions; the procedural world remains authoritative."""
import math

STYLES = {
    "parchment": "hand-drawn cartography on warm aged parchment, fine ink lines, restrained earth pigments, consistent paper texture",
    "cadastre": "cadastral cartography, precise parcel boundaries and building footprints, crisp fine ink lines, neutral paper, restrained colors and clear road hierarchy",
    "geographic": "physical geographic map, legible relief shading and elevation colors, natural terrain, clear coastlines, rivers and vegetation patterns",
    "satellite": "realistic overhead satellite imagery, natural surface colors, physically plausible terrain and vegetation textures, clearly resolved roads, roofs and water",
    "engraving": "fine copperplate engraving, delicate hatching, monochrome ink, precise architectural linework",
    "watercolor": "fine-art watercolor, translucent washes, textured paper, delicate architectural details",
    "fineart": "architectural oil painting, fine brushwork, rich restrained pigments, carefully resolved buildings, coherent natural light and soft atmospheric depth",
    "photorealistic": "photorealistic landscape and architectural visualization, physically plausible materials, natural light",
    "atlas": "finely illustrated geographic atlas, clear terrain and settlement hierarchy, restrained natural colors",
}
VISUAL_TRADITIONS = {
    "egyptian-planned": "ancient Egyptian mudbrick courtyard houses, plastered facades with doorways and small windows, roof terraces with parapets, shaded lanes, palms and riverside cultivation",
    "egyptian-organic": "ancient Egyptian mudbrick courtyard houses, plastered facades with doorways and small windows, roof terraces with parapets and shaded lanes",
    "aztec": "pre-Columbian Mesoamerican masonry and lime plaster, flat roof terraces, enclosed courtyards and pedestrian causeways",
    "inca": "pre-Columbian Andean stone buildings, carefully fitted masonry, compact courtyard compounds and stone terraces",
    "roman-core": "ancient Roman courtyard houses, plastered masonry, tiled roofs and stone-paved streets",
    "japanese": "medieval Japanese timber architecture, plastered walls, ceramic tiled roofs and enclosed gardens",
    "japanese-jokamachi": "medieval Japanese timber architecture, plastered walls, ceramic tiled roofs and enclosed gardens",
    "chinese": "traditional Chinese timber courtyard compounds, tiled roofs and clearly articulated walled precincts",
    "european-organic": "medieval European masonry and timber houses, individually resolved pitched roofs and narrow pedestrian streets",
    "medina": "North African courtyard houses, plastered masonry, roof terraces and narrow shaded lanes",
}
FIDELITY = {
    "strong": "Keep the source framing, street topology, block and parcel boundaries, shoreline, river courses, bridges and landmark positions. Freely enrich the buildings, materials, vegetation and fine details within that fixed plan, in the requested style.",
    "balanced": "Keep the source framing, street topology, urban blocks, water courses and landmark positions. Freely reinterpret architecture, materials and small details within that plan, in the requested style.",
    "free": "Keep the source plan, street topology, water courses and framing. Freely redesign the visual details, architecture, materials and atmosphere in the requested style.",
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
    names = {"roman-core": "Roman", "roman": "Roman", "inca": "Inca", "aztec": "Aztec", "egyptian-planned": "Egyptian", "egyptian-organic": "Egyptian", "european-organic": "European",
             "medieval": "European", "japanese": "Japanese", "japanese-jokamachi": "Japanese", "bastide": "European bastide",
             "chinese": "Chinese", "javanese-courts": "Javanese", "medina": "North African",
             "elven": "elven", "dwarven": "dwarven"}
    return names.get(value) or words(label or value)


def cultural_identity(value, label=None, era=None):
    # Broad art-direction periods for the application's cultural presets, not
    # invented dates for individual buildings. An applied house era wins.
    periods = {"roman-core": "ancient", "roman": "ancient", "egyptian-planned": "ancient", "egyptian-organic": "ancient", "inca": "pre-Columbian", "aztec": "pre-Columbian",
               "european-organic": "medieval", "medieval": "medieval", "bastide": "medieval",
               "japanese": "medieval", "japanese-jokamachi": "medieval", "chinese": "pre-modern",
               "medina": "medieval", "indian-temple": "pre-modern", "javanese-courts": "pre-modern",
               "byzantine-greek": "medieval", "hanseatic": "medieval", "venetian-lagoon": "medieval",
               "korean": "pre-modern", "ottoman": "Ottoman-era", "persian": "pre-modern", "sahel": "pre-modern"}
    name = culture_name(value, label)
    era = era if isinstance(era, str) else None
    period = {"A": "ancient", "M": "medieval", "ancient": "ancient", "medieval": "medieval"}.get(era)
    if not period and era and era != "any":
        period = words(era)
    period = period or periods.get(value, "")
    return f"{period} {name}" if period and period.lower() not in name.lower() else name


def describe_camera(context):
    projection, camera = context.get("projection", "orthographic"), record(context.get("camera"))
    if projection == "orthographic":
        return "A strictly top-down aerial view", "The view is an orthographic map, looking vertically down at 90 degrees; map zoom does not define a physical camera altitude."
    if projection == "globe":
        return "A globe view", "Keep the source globe curvature and framing."
    angle = number(camera.get("viewAngleDegrees"))
    pitch = number(camera.get("pitch"))
    if angle is None and pitch is not None and 0 <= pitch <= math.pi / 2:
        angle = math.degrees(pitch)
    above = number(camera.get("heightAboveTargetMetres"))
    distance = number(camera.get("distance"))
    if above is None and distance is not None and distance > 0 and angle is not None:
        above = distance * math.sin(math.radians(angle))
    view = ("A near-horizontal view" if angle is not None and angle < 15 else
            "A near-vertical aerial view" if angle is not None and angle >= 75 else "An elevated oblique aerial view")
    measurements = []
    if angle is not None and 0 <= angle <= 90:
        measurements.append(f"looking down {angle:.0f} degrees below the horizon")
    if above is not None and above >= 0:
        measurements.append(f"approximately {above:,.0f} metres above the target terrain")
    if measurements:
        view += " (" + ", ".join(measurements) + ")"
    details = []
    altitude = number(camera.get("altitudeMetres"))
    if altitude is not None:
        details.append(f"Camera altitude is approximately {altitude:,.0f} metres above the terrain datum.")
    heading = number(camera.get("azimuthDegrees"))
    if heading is not None:
        details.append(f"The viewing azimuth is {heading % 360:.0f} degrees in the map coordinate frame.")
    exaggeration = number(camera.get("exaggeration"))
    if exaggeration is not None and exaggeration != 1:
        details.append(f"The reference relief uses {exaggeration:g} times vertical exaggeration; camera clearance is measured in the rendered scene.")
    return view, " ".join(details)


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
    traditions = [c for c in architecture.get("traditions", []) if isinstance(c, str)]
    culture_id = primary.get("urbanCulture") or primary.get("culture") or generation.get("culture") or next(iter(traditions), None) or record(architecture.get("settings")).get("culture")
    house_config = record(record(architecture.get("settings")).get("house_config"))
    era = primary.get("era") or generation.get("era") or architecture.get("era") or house_config.get("era")
    culture = cultural_identity(culture_id, primary.get("cultureDescription") or generation.get("cultureDescription"), era) if has_city else ""
    population = number(primary.get("population", generation.get("population")))
    kind = settlement_kind(population, generation.get("size"))
    city = f"{culture + ' ' if culture else ''}{kind}"
    subject = f"{'an' if city[:1].lower() in 'aeiou' and not city.startswith('European') else 'a'} {city}" if has_city else "a natural terrain landscape"
    if has_city and population is not None and population > 0:
        subject += f" of approximately {population:,.0f} inhabitants"
    if len(settlements) > 1:
        subject = f"a regional landscape with {len(settlements)} visible settlements, including {subject}"
    camera, camera_details = describe_camera(context)
    article = "" if terrain.endswith("mountains") else "an " if setting[:1].lower() in "aeiou" else "a "
    summary = f"{camera} of {subject}" + (f" in {article}{setting}" if setting else "") + "."
    if biome:
        summary += f" Biome: {biome}."
    sentences = [summary] + ([camera_details] if camera_details else [])
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
        tradition = cultural_identity(settlement.get("urbanCulture") or settlement.get("culture"), settlement.get("cultureDescription"), settlement.get("era") or era)
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
    # A sampled native recipe/pack id is not a second urban culture. In particular,
    # a generic fort recipe must not turn an Aztec city into a Rajput city.
    explicit_architecture = record(architecture.get("settings")).get("culture")
    traditions = list(dict.fromkeys(cultural_identity(c, era=era) for c in traditions
                                   if not culture_id or c == culture_id or c == explicit_architecture or c in VISUAL_TRADITIONS))
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
    details = ("Preserve the relative positions and connectivity of street intersections, parcels, urban blocks, open spaces, terrain contours and water boundaries. "
               "Within that layout, create convincing complete architecture and freely develop materials, facades, roofs, vegetation and fine details appropriate to the culture and period. ")
    prompt = ("Edit the supplied source image itself, using it as the authoritative visual reference. "
              "Reproduce this same place in the requested artistic style; do not create a different scene merely inspired by the description. "
              f"\n\nScene description: {description[:18000]}\n\n"
              f"Requested style: {STYLES[style]}.\n\n"
              f"{camera} {FIDELITY[fidelity]} "
              f"{details}"
              "Achieve a finished, high-quality image in the requested style; replace neutral placeholder surfaces and simple block masses with rich, coherent visual detail. "
              "Where the description is incomplete or ambiguous, follow the source image. Do not infer weather, snow or a different biome from the culture alone. "
              "Use the specified architectural traditions without replacing the actual buildings with generic European castles or stereotypical monuments. "
              "Keep distinct cultural districts in their original locations. Only depict features visible at this scale. "
              "Do not add labels, text, legends, UI, watermarks, modern vehicles or modern infrastructure unless explicitly part of the scene. "
              f"Additional artistic request: {instruction or 'None.'}")
    # CLIP in SDXL has a short context; prioritize the concrete subject and style.
    architecture = record(context.get("architecture"))
    roofs = ", ".join(words(r) for r in architecture.get("roofSystems", [])[:2])
    materials = ", ".join(words(m.get("label") or m.get("pattern")) for m in architecture.get("materials", [])[:2] if isinstance(m, dict))
    short_architecture = (f" Roof forms: {roofs}." if roofs else "") + (f" Materials: {materials}." if materials else "")
    fast_prompt = f"{summary} {STYLES[style]}.{short_architecture} Preserve the source layout, roads, rivers and buildings. No labels. {instruction}"
    generation = record(context.get("generation"))
    settlements = [s for s in context.get("settlements", []) if isinstance(s, dict)]
    primary = max(settlements, key=lambda s: number(s.get("population")) or 0) if settlements else {}
    culture_id = (primary.get("urbanCulture") or primary.get("culture") or generation.get("culture")
                  or next(iter(architecture.get("traditions", [])), None))
    visual_tradition = VISUAL_TRADITIONS.get(culture_id, "")
    natural = "natural terrain landscape" in summary
    geometry = ("Keep the reference framing, terrain forms, shorelines, water courses and vegetation zones. "
                "Resolve natural ground textures, coherent shadows and readable relief. " if natural else
                "Keep the reference street topology, urban blocks, open squares, bridge positions, water courses and camera framing. "
                "Within that fixed plan, freely turn the placeholder masses into convincing complete buildings, with richly detailed materials, facades, roofs, gardens and coherent shadows. ")
    local_prompt = (f"Transform the supplied reference image into a finished, high-quality image in this style: {STYLES[style]}. {summary} "
                    f"{visual_tradition + '. ' if visual_tradition else ''}{short_architecture} "
                    "Depict only the visible crop of this place, not the entire settlement or a new panorama. "
                    f"{geometry}"
                    "No text, labels or interface. "
                    f"{instruction}")
    if natural:
        local_prompt += " No settlement is identified; do not invent urban development."
    reference_mode = settings.get('referenceMode', 'source')
    if reference_mode in ('source+edges', 'source+depth'):
        guide = 'white structural contours on black' if reference_mode == 'source+edges' else 'a grayscale depth map'
        local_prompt += (f" Image 1 is the source view. Image 2 is {guide} of the same scene: use it only to constrain the street layout, framing and volumes, not as an output style. "
                         "Keep the exact positions and connections of the roads and water from these aligned references while freely refining architecture and surface detail.")
    elif reference_mode == 'edges':
        local_prompt += " The reference image contains structural contours only: preserve their plan and camera framing while freely creating complete architecture in the requested style."
    # SDXL's complete caption is chunked through both CLIP encoders in local.py.
    # Put style/culture before generic preservation instructions.
    fast_prompt = (f"{STYLES[style]}. {summary} {visual_tradition + '. ' if visual_tradition else ''}{short_architecture} "
                   f"{geometry} {instruction}")
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
