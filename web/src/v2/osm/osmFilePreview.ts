import { osmProjection, type OsmBounds, type OsmSquare } from './osmSources';
import type { OsmFile } from './osmFile';

export function fitOsmFile(bounds: OsmBounds, min: number, max: number): OsmSquare {
  const lat = (bounds.south + bounds.north) / 2,
    lon = (bounds.west + bounds.east) / 2;
  const project = osmProjection({ lat, lon, size: 0 }).project;
  const corner = project(bounds.south, bounds.east);
  const size = Math.min(max, Math.max(min, Math.ceil(2 * Math.max(corner.x, corner.y))));
  return { lat, lon, size };
}

export function intersectsOsmBounds(a: OsmBounds, b: OsmBounds): boolean {
  return a.south <= b.north && a.north >= b.south && a.west <= b.east && a.east >= b.west;
}

/** Draw the local extract once, then reuse it while the crop changes. */
export function osmFilePreview(canvas: HTMLCanvasElement, file: OsmFile) {
  const frame = fitOsmFile(file.bounds, 500, Infinity);
  const { project, toLatLon } = osmProjection({ ...frame, size: frame.size * 1.14 });
  const width = canvas.width,
    height = canvas.height;
  const pixel = (lat: number, lon: number) => {
    const { x, y } = project(lat, lon);
    return { x: (x * width) / (frame.size * 1.14), y: (y * height) / (frame.size * 1.14) };
  };
  const data = document.createElement('canvas');
  data.width = width;
  data.height = height;
  const ctx = data.getContext('2d')!;
  const { south, west, north, east } = file.bounds;
  const { x, y } = pixel(north, west);
  const corner = pixel(south, east);
  ctx.fillStyle = '#121b21';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#2a3a41';
  ctx.fillRect(x, y, corner.x - x, corner.y - y);
  ctx.strokeStyle = '#73909d';
  ctx.strokeRect(x, y, corner.x - x, corner.y - y);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, Math.max(1, corner.x - x), Math.max(1, corner.y - y));
  ctx.clip();
  ctx.strokeStyle = '#95b2ba';
  ctx.fillStyle = '#95b2ba';
  ctx.lineWidth = 0.75;
  const elements = file.osm.elements;
  const step = Math.max(1, Math.ceil(elements.length / 20000));
  for (let i = 0; i < elements.length; i += step) {
    const element = elements[i];
    if (element.type === 'node') {
      const p = pixel(element.lat!, element.lon!);
      ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
    } else {
      const paths = element.geometry ? [element.geometry] : (element.members ?? []).map(member => member.geometry);
      ctx.beginPath();
      for (const path of paths) {
        let previous = false;
        for (const position of path ?? []) {
          if (position) {
            const p = pixel(position.lat, position.lon);
            if (previous) ctx.lineTo(p.x, p.y);
            else ctx.moveTo(p.x, p.y);
          }
          previous = !!position;
        }
      }
      ctx.stroke();
    }
  }
  ctx.restore();

  return {
    draw(square?: OsmSquare) {
      const target = canvas.getContext('2d')!;
      target.drawImage(data, 0, 0);
      if (!square) return;
      const { bounds } = osmProjection(square);
      const topLeft = pixel(bounds.north, bounds.west),
        bottomRight = pixel(bounds.south, bounds.east);
      target.fillStyle = '#e9be5440';
      target.strokeStyle = '#f1c76b';
      target.lineWidth = 2;
      target.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
      target.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
    },
    position(fractionX: number, fractionY: number) {
      const { lat, lon } = toLatLon(fractionX * frame.size * 1.14, fractionY * frame.size * 1.14);
      return { lat: Math.max(south, Math.min(north, lat)), lon: Math.max(west, Math.min(east, lon)) };
    },
  };
}
