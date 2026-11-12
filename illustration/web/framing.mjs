/** Ground-plane framing in metres, shared by capture metadata and the panel. */
export function groundFrame(context) {
  const positive = value => Number.isFinite(value) && value > 0;
  if (context.projection === 'orthographic') {
    const { width, height } = context.extentMetres || {};
    return positive(width) && positive(height) ? { width, height, minAcross: -width / 2, maxAcross: width / 2, minAlong: -height / 2, maxAlong: height / 2, perspective: false } : undefined;
  }
  if (context.projection !== 'perspective') return;
  const c = context.camera || {}, viewport = context.viewport || {};
  if (c.navigation === 'walk' || !positive(c.distance) || !positive(viewport.width) || !positive(viewport.height)) return;
  const above = c.heightAboveTargetMetres ?? Math.sin(c.pitch) * c.distance;
  const horizontal = Math.cos(c.pitch) * c.distance, distance = Math.hypot(horizontal, above);
  const sin = above / distance, cos = horizontal / distance;
  const fov = c.verticalFovDegrees ?? 180 / 3.7;
  if (!positive(above) || !positive(sin) || !(fov > 0 && fov < 150)) return;
  const tan = Math.tan(fov * Math.PI / 360), aspect = viewport.width / viewport.height;
  // Intersect the four image-corner rays with the horizontal target plane.
  if (sin <= tan * cos) return; // The frame includes the horizon.
  const minAlong = -tan * distance / (sin - tan * cos), maxAlong = tan * distance / (sin + tan * cos);
  const maxDepth = distance - minAlong * cos, maxAcross = tan * aspect * maxDepth;
  return { width: maxAcross * 2, height: maxAlong - minAlong, minAcross: -maxAcross, maxAcross, minAlong, maxAlong,
    perspective: true, distance, sin, cos, tan, aspect, angle: Math.atan2(above, horizontal) * 180 / Math.PI };
}

export function battlemapAvailability(context, pixels = 1048576, cellMetres = 1.5) {
  const frame = groundFrame(context || {});
  const unavailable = reason => ({ eligible: false, reason, cellMetres });
  if (!Number.isFinite(cellMetres) || cellMetres < .5 || cellMetres > 100) return unavailable('La taille des cases doit être comprise entre 0,5 et 100 mètres.');
  if (!frame) return unavailable('Une capture avec une échelle mesurée est nécessaire.');
  if (frame.perspective && frame.angle < 75) return unavailable('Passez en 2D ou inclinez la caméra 3D à au moins 75° vers le sol.');
  const viewport = context.viewport || {}, aspect = viewport.width / viewport.height || frame.width / frame.height;
  const outputHeight = Math.sqrt(Number(pixels) / aspect), outputWidth = outputHeight * aspect;
  const cellPixels = frame.perspective
    ? cellMetres * outputHeight / (2 * frame.tan * (frame.distance - frame.minAlong * frame.cos)) * frame.sin * frame.distance / (frame.distance - frame.minAlong * frame.cos)
    : cellMetres * Math.min(outputWidth / frame.width, outputHeight / frame.height);
  if (Math.min(frame.width, frame.height) < 2 * cellMetres) return unavailable('Dézoomez ou réduisez la taille des cases pour en cadrer au moins deux par côté.');
  if (Math.max(frame.width, frame.height) / cellMetres > 512 || cellPixels < 3) return unavailable('Vue trop étendue : augmentez la taille des cases ou la résolution de génération, ou zoomez légèrement (3 px minimum par case, 512 cases maximum par côté).');
  return { eligible: true, reason: '', warning: cellPixels < 12 ? 'Cases fines à cette échelle : une génération plus grande ou des cases plus larges amélioreront la lisibilité.' : '', cellMetres, cellPixels, columns: frame.width / cellMetres, rows: frame.height / cellMetres,
    approximate: frame.perspective };
}

/** Prepare an orbit camera around the same target, keeping an already readable crop. */
export function battlemapCamera(camera, viewport, pixels = 1048576, cellMetres = 1.5) {
  if (!camera || !(camera.distance > 0) || !(viewport?.width > 0 && viewport?.height > 0)
      || !Number.isFinite(pixels) || pixels <= 0 || !Number.isFinite(cellMetres) || cellMetres < .5 || cellMetres > 100) {
    throw Error('Caméra ou échelle de battlemap indisponible.');
  }
  // Captured measurements belong to the old eye position, never to the new camera.
  const { heightAboveTargetMetres, altitudeMetres, viewAngleDegrees, azimuthDegrees, ...next } = camera;
  next.navigation = 'orbit';
  next.pitch = Math.min(1.48, Math.max(80 * Math.PI / 180, Number.isFinite(camera.pitch) ? camera.pitch : 0));
  const context = { projection: 'perspective', camera: next, viewport };
  const frame = groundFrame(context), availability = battlemapAvailability(context,pixels,cellMetres);
  if (!frame) throw Error('Cadrage de battlemap indisponible.');
  if (!availability.eligible) {
    // Framing scales linearly with distance. Aim for six native pixels per cell
    // and leave space for at least four cells along the shortest side.
    const outputHeight = Math.sqrt(pixels / (viewport.width / viewport.height));
    const depth = frame.distance - frame.minAlong * frame.cos;
    const cellPixels = cellMetres * outputHeight / (2 * frame.tan * depth) * frame.sin * frame.distance / depth;
    const maximum = Math.min(cellPixels / 6, 384 * cellMetres / Math.max(frame.width,frame.height));
    const minimum = 4 * cellMetres / Math.min(frame.width,frame.height);
    next.distance *= Math.max(minimum,Math.min(1,maximum));
  }
  return next;
}
