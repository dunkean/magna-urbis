import { chooseExportCrop } from './exportCrop';
import { exportPng } from './pngExport';

/** Export the retained 2D representation, including its current layers. The
 * crop changes only the SVG viewport; no geometry is recalculated. */
export function installUrbanMapExports(host: Element, map: SVGSVGElement, onError: (message: string) => void): void {
  const group = document.createElement('div'); group.className = 'urban-actions';
  for (const format of ['svg', 'png'] as const) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.urbanExport = format;
    button.textContent = `Exporter le plan ${format.toUpperCase()}`; group.append(button);
    button.onclick = async () => {
      button.disabled = true;
      try {
        const copy = map.cloneNode(true) as SVGSVGElement;
        copy.style.visibility = ''; copy.style.display = ''; copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        const [x, y, width, height] = (copy.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
        if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw new Error('Générez un plan avant de l’exporter.');
        copy.setAttribute('width', String(Math.round(4096 * width / Math.max(width, height))));
        copy.setAttribute('height', String(Math.round(4096 * height / Math.max(width, height))));
        const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        for (const [key, value] of Object.entries({ x, y, width, height })) background.setAttribute(key, String(value));
        background.setAttribute('fill', getComputedStyle(map).backgroundColor || '#eee6cf'); copy.prepend(background);
        // Production rural canvases are retained pixels, not SVG children.
        const canvases = map.querySelectorAll('foreignObject');
        copy.querySelectorAll('foreignObject').forEach((node, i) => {
          const canvas = canvases[i]?.querySelector('canvas');
          if (!canvas) { node.remove(); return; }
          const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
          for (const key of ['x', 'y', 'width', 'height']) image.setAttribute(key, node.getAttribute(key) ?? '0');
          image.setAttribute('href', canvas.toDataURL('image/png')); node.replaceWith(image);
        });
        const captured = new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' });
        const crop = await chooseExportCrop(captured, 4096);
        if (!crop) return;
        const blob = format === 'png' ? await exportPng(crop.blob, crop, () => {}) : crop.blob;
        const url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url; link.download = `magna-urbis-plan.${format}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) { onError(String(error)); }
      finally { button.disabled = false; }
    };
  }
  host.append(group);
}
