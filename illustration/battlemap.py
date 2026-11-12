"""Measured ground framing and configurable tactical grids.

Perspective grids are projected onto the horizontal plane through the camera
target. They do not claim to measure sloping terrain or elevated rooftops.
"""
import math
from PIL import ImageDraw
from .resolution import resolution_settings

CELL_METRES = 1.5


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def ground_frame(context):
    projection = context.get('projection')
    if projection == 'orthographic':
        extent = context.get('extentMetres') or {}
        width, height = extent.get('width'), extent.get('height')
        if not all(finite(v) and v > 0 for v in (width, height)):
            return None
        return dict(width=width, height=height, minAcross=-width/2, maxAcross=width/2,
                    minAlong=-height/2, maxAlong=height/2, perspective=False)
    if projection != 'perspective':
        return None
    c, viewport = context.get('camera') or {}, context.get('viewport') or {}
    distance, pitch, width, height = (c.get('distance'), c.get('pitch'), viewport.get('width'), viewport.get('height'))
    if c.get('navigation') == 'walk' or not all(finite(v) for v in (distance, pitch, width, height)) or min(distance, width, height) <= 0:
        return None
    above = c.get('heightAboveTargetMetres', math.sin(pitch) * distance)
    fov = c.get('verticalFovDegrees', 180 / 3.7)
    if not finite(above) or above <= 0 or not finite(fov) or not 0 < fov < 150:
        return None
    horizontal = math.cos(pitch) * distance
    distance = math.hypot(horizontal, above)
    sin, cos = above / distance, horizontal / distance
    tan, aspect = math.tan(math.radians(fov) / 2), width / height
    if sin <= tan * cos:
        return None
    low, high = -tan * distance / (sin - tan * cos), tan * distance / (sin + tan * cos)
    across = tan * aspect * (distance - low * cos)
    return dict(width=across*2, height=high-low, minAcross=-across, maxAcross=across,
                minAlong=low, maxAlong=high, perspective=True, distance=distance, sin=sin, cos=cos,
                tan=tan, aspect=aspect, angle=math.degrees(math.atan2(above, horizontal)))


def cell_size(settings):
    raw = settings.get('cellMetres', CELL_METRES)
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise ValueError('La taille des cases doit être comprise entre 0,5 et 100 mètres.') from None
    if isinstance(raw, bool) or not math.isfinite(value) or not .5 <= value <= 100:
        raise ValueError('La taille des cases doit être comprise entre 0,5 et 100 mètres.')
    return value


def availability(context, pixels=1048576, cell_metres=CELL_METRES):
    frame = ground_frame(context)
    def no(reason):
        return dict(eligible=False, reason=reason, cellMetres=cell_metres)
    if not frame:
        return no('Une capture avec une échelle mesurée est nécessaire.')
    if frame['perspective'] and frame['angle'] < 75:
        return no('Passez en 2D ou inclinez la caméra 3D à au moins 75° vers le sol.')
    viewport = context.get('viewport') or {}
    w, h = viewport.get('width'), viewport.get('height')
    aspect = w / h if finite(w) and finite(h) and min(w, h) > 0 else frame['width'] / frame['height']
    output_h = math.sqrt(pixels / aspect)
    if frame['perspective']:
        depth = frame['distance'] - frame['minAlong'] * frame['cos']
        cell_pixels = cell_metres * output_h / (2 * frame['tan'] * depth) * frame['sin'] * frame['distance'] / depth
    else:
        cell_pixels = cell_metres * min(output_h * aspect / frame['width'], output_h / frame['height'])
    if min(frame['width'], frame['height']) < 2 * cell_metres:
        return no('Dézoomez ou réduisez la taille des cases pour en cadrer au moins deux par côté.')
    if max(frame['width'], frame['height']) / cell_metres > 512 or cell_pixels < 3:
        return no('Vue trop étendue : augmentez la taille des cases ou la résolution de génération, ou zoomez légèrement (3 px minimum par case, 512 cases maximum par côté).')
    warning = 'Cases fines à cette échelle : une génération plus grande ou des cases plus larges amélioreront la lisibilité.' if cell_pixels < 12 else ''
    return dict(eligible=True, reason='', warning=warning, cellMetres=cell_metres, cellPixels=cell_pixels,
                columns=frame['width']/cell_metres, rows=frame['height']/cell_metres, approximate=frame['perspective'])


def validate(context, settings):
    output = settings.get('output', 'illustration')
    if output not in ('illustration', 'battlemap'):
        raise ValueError('Type d’illustration inconnu.')
    if settings.get('grid', 'square') not in ('square', 'hex', 'none'):
        raise ValueError('Grille inconnue.')
    sizes = resolution_settings(settings)
    result = availability(context, sizes['pixels'], cell_size(settings))
    if output == 'battlemap' and not result['eligible']:
        raise ValueError('Battlemap indisponible : ' + result['reason'])
    return result


def draw_grid(image, context, settings=None):
    settings = settings or {}
    grid, cell_metres = settings.get('grid', 'square'), cell_size(settings)
    if grid == 'none':
        return image.convert('RGB')
    if grid not in ('square', 'hex'):
        raise ValueError('Grille inconnue.')
    frame = ground_frame(context)
    if not frame:
        raise ValueError('Échelle de grille indisponible.')
    image = image.convert('RGB')
    draw = ImageDraw.Draw(image, 'RGBA')
    width, height = image.size
    def project(across, along):
        if frame['perspective']:
            depth = frame['distance'] - along * frame['cos']
            return ((.5 + across / (2*depth*frame['tan']*frame['aspect'])) * width,
                    (.5 + along*frame['sin'] / (2*depth*frame['tan'])) * height)
        return ((.5 + across/frame['width']) * width, (.5 + along/frame['height']) * height)
    # In 2D align with world metres; in 3D align with the camera's ground axes.
    camera = context.get('camera') or {}
    origins = (0, 0) if frame['perspective'] else (camera.get('cx', 0), camera.get('cy', 0))
    stroke = max(1, round(min(width, height) / 1800))
    def line(points):
        # One stroke only, with no light outline or second grid. Shared hex
        # edges are owned by one cell so they never become twice as dark.
        draw.line([(round(x), round(y)) for x, y in points], fill=(22, 29, 27, 115), width=stroke)
    if grid == 'hex':
        # Flat-top hexagons. cell_metres is the distance between opposite
        # faces, also the distance between neighbouring cell centres.
        radius = cell_metres / math.sqrt(3)
        q0 = math.floor((frame['minAcross'] + origins[0]) / (1.5 * radius)) - 2
        q1 = math.ceil((frame['maxAcross'] + origins[0]) / (1.5 * radius)) + 2
        r0 = math.floor((frame['minAlong'] + origins[1]) / cell_metres) - 2
        r1 = math.ceil((frame['maxAlong'] + origins[1]) / cell_metres) + 2
        if max(q1-q0, r1-r0) > 610:
            raise ValueError('Grille trop dense.')
        for q in range(q0, q1 + 1):
            for r in range(r0, r1 + 1):
                x, y = q * radius * 1.5 - origins[0], (r + (q % 2) * .5) * cell_metres - origins[1]
                vertices = [(x + radius, y), (x + radius / 2, y + cell_metres / 2),
                            (x - radius / 2, y + cell_metres / 2), (x - radius, y)]
                # Three of six edges suffice over the expanded lattice.
                for a, b in zip(vertices, vertices[1:]):
                    line([project(*a), project(*b)])
        return image
    for axis, low, high, origin in [('across', frame['minAcross'], frame['maxAcross'], origins[0]),
                                     ('along', frame['minAlong'], frame['maxAlong'], origins[1])]:
        start, end = math.ceil((low + origin) / cell_metres), math.floor((high + origin) / cell_metres)
        if end - start > 514:
            raise ValueError('Grille trop dense.')
        for i in range(start, end + 1):
            value = i * cell_metres - origin
            points = [project(value, frame['minAlong']), project(value, frame['maxAlong'])] if axis == 'across' else [project(frame['minAcross'], value), project(frame['maxAcross'], value)]
            line(points)
    return image
