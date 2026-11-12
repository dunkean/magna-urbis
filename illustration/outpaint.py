"""Neighbouring 2D battlemap tiles, with measured overlap and protected pixels."""
import math
from PIL import Image, ImageDraw
from .context import resolve_style

DIRECTIONS = {'north': (0, -1), 'south': (0, 1), 'west': (-1, 0), 'east': (1, 0)}
OVERLAP = .2


def bounds(context):
    camera, extent = context.get('camera') or {}, context.get('extentMetres') or {}
    values = [camera.get('cx'), camera.get('cy'), extent.get('width'), extent.get('height')]
    if context.get('projection') != 'orthographic' or not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in values) or min(values[2:]) <= 0:
        raise ValueError('L’extension continue nécessite une battlemap 2D avec une échelle mesurée.')
    x, y, w, h = values
    return (x-w/2, y-h/2, x+w/2, y+h/2)


def neighbour_context(job, direction):
    if direction not in DIRECTIONS:
        raise ValueError('Direction d’extension inconnue.')
    context = job['context']
    bounds(context)
    w, h = context['extentMetres']['width'], context['extentMetres']['height']
    pw, ph = job['outputSize']
    step_x, step_y = w*(pw-round(pw*OVERLAP))/pw, h*(ph-round(ph*OVERLAP))/ph
    dx, dy = DIRECTIONS[direction]
    return {**context, 'camera': {**context['camera'], 'cx': context['camera']['cx'] + dx*step_x, 'cy': context['camera']['cy'] + dy*step_y}}


def validate_continuation(service, value, context, settings):
    if value is None:
        return None
    if not isinstance(value, dict) or settings.get('output') != 'battlemap' or settings.get('mode') != 'cloud' or settings.get('provider', 'openai') != 'openai':
        raise ValueError('L’extension est disponible pour les battlemaps OpenAI en 2D.')
    parent = service.get(value.get('parentId'))
    if parent['status'] != 'succeeded' or parent['settings'].get('output') != 'battlemap':
        raise ValueError('La battlemap voisine doit être terminée avant de la prolonger.')
    expected = neighbour_context(parent, value.get('direction'))
    for a, b in zip(bounds(context), bounds(expected)):
        if not math.isclose(a, b, rel_tol=1e-8, abs_tol=1e-5):
            raise ValueError('La capture voisine ne correspond pas au cadrage attendu. Le zoom doit rester identique et la zone rester dans la carte.')
    if context.get('sourceId') != parent['context'].get('sourceId'):
        raise ValueError('La carte a changé ; démarrez une nouvelle battlemap.')
    if resolve_style(settings.get('style', 'auto'), context.get('sourceStyle', '')) != parent.get('resolvedStyle'):
        raise ValueError('L’extension conserve le style de la battlemap initiale.')
    for key in ('grid', 'cellMetres', 'model', 'provider'):
        defaults = {'style': 'auto', 'grid': 'square', 'cellMetres': 1.5, 'model': '', 'provider': 'openai'}
        if str(settings.get(key, defaults[key])) != str(parent['settings'].get(key, defaults[key])):
            raise ValueError('L’extension conserve le style, le modèle et la grille de la battlemap initiale.')
    supplied = value.get('neighbours', [])
    if not isinstance(supplied, list) or len(supplied) > 128:
        raise ValueError('Liste des cartes voisines invalide.')
    known = [parent['id']]
    root_id = (parent.get('continuation') or {}).get('rootId', parent['id'])
    target = bounds(context)
    for job_id in supplied:
        if job_id in known:
            continue
        job = service.get(job_id)
        if job['status'] != 'succeeded' or job['context'].get('sourceId') != context.get('sourceId'):
            continue
        if job_id != root_id and (job.get('continuation') or {}).get('rootId') != root_id:
            continue
        other = bounds(job['context'])
        if max(target[0], other[0]) < min(target[2], other[2]) and max(target[1], other[1]) < min(target[3], other[3]):
            known.append(job_id)
    return {'parentId': parent['id'], 'rootId': root_id, 'direction': value['direction'], 'neighbours': known,
            'overlap': OVERLAP, 'outputSize': parent['outputSize']}


def paste_known(service, image, context, ids, mask=None):
    target = bounds(context)
    tw, th = target[2]-target[0], target[3]-target[1]
    for job_id in ids:
        job = service.get(job_id)
        other = bounds(job['context'])
        box = (max(target[0], other[0]), max(target[1], other[1]), min(target[2], other[2]), min(target[3], other[3]))
        if box[2] <= box[0] or box[3] <= box[1]:
            continue
        path = service.output / job_id / ('artwork.png' if job['settings'].get('grid', 'square') != 'none' else 'result.png')
        if not path.is_file():
            raise ValueError('La version sans grille de la carte voisine est indisponible.')
        with Image.open(path) as source:
            source = source.convert('RGB')
        x0, y0 = round((box[0]-target[0])/tw*image.width), round((box[1]-target[1])/th*image.height)
        x1, y1 = round((box[2]-target[0])/tw*image.width), round((box[3]-target[1])/th*image.height)
        if x1 <= x0 or y1 <= y0:
            continue
        crop = ((box[0]-other[0])/(other[2]-other[0])*source.width, (box[1]-other[1])/(other[3]-other[1])*source.height,
                (box[2]-other[0])/(other[2]-other[0])*source.width, (box[3]-other[1])/(other[3]-other[1])*source.height)
        crop = (max(0, crop[0]), max(0, crop[1]), min(source.width, crop[2]), min(source.height, crop[3]))
        patch = source.resize((x1-x0, y1-y0), Image.Resampling.LANCZOS, box=crop)
        image.paste(patch, (x0, y0))
        if mask is not None:
            ImageDraw.Draw(mask).rectangle((x0, y0, x1-1, y1-1), fill=(255, 255, 255, 255))
    return image


def prepare(service, source, job):
    continuation = job['continuation']
    mask = Image.new('RGBA', source.size, (0, 0, 0, 0))
    base = paste_known(service, source.copy(), job['context'], continuation['neighbours'], mask)
    return base, {'layout': source, 'mask': mask}


PROMPT = ('This is an OUTPAINTING continuation of an existing tabletop battlemap, not a new independent illustration. '
          'Image 1 contains already finished artwork in the protected opaque mask area and a procedural layout in the transparent editable area. '
          'Image 2 is the procedural layout for the entire same rectangle. Continue the finished artwork across the editable area, following image 2 for roads, buildings, water and terrain positions. '
          'Keep exactly the same top-down camera, metres-per-pixel scale, materials, palette, lighting and architectural style. The actual finished reference artwork takes priority over generic style descriptions. '
          'Connect paths, walls, roofs, waterways and shadows naturally at the boundary. Do not invent land outside the supplied world layout. '
          'Do not paint any square or hexagonal grid; the application draws a single aligned grid after assembling the artwork. ')
