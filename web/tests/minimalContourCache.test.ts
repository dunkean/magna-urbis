/** The terrain cache shares both in-flight work and retained paths, even after a renderer is disposed. */
import { afterEach, expect, it, vi } from 'vitest';
import { retainedMinimalContours } from '../src/v2/minimalContourCache';
afterEach(() => vi.unstubAllGlobals());
it('extracts once per retained height grid and reuses identical geometry', async () => {
  let extractions = 0,
    terminations = 0;
  vi.stubGlobal(
    'Worker',
    class {
      onmessage?: (event: { data: unknown[] }) => void;
      postMessage() {
        extractions++;
        queueMicrotask(() =>
          this.onmessage?.({
            data: [
              {
                layer: 'contour',
                points: [
                  { x: 0, y: 0 },
                  { x: 10, y: 10 },
                ],
              },
            ],
          }),
        );
      }
      terminate() {
        terminations++;
      }
    },
  );
  vi.stubGlobal(
    'Path2D',
    class {
      moveTo() {}
      lineTo() {}
      closePath() {}
    },
  );
  const height = { data: new Float32Array([0, 10, 20, 30]), n: 2, width: 6000, maxHeight: 30 };
  const first = retainedMinimalContours(height),
    second = retainedMinimalContours(height);
  expect(second).toBe(first);
  const geometry = await first;
  expect(await retainedMinimalContours(height)).toBe(geometry);
  expect(geometry.features).toBe(1);
  expect(extractions).toBe(1);
  expect(terminations).toBe(1);
  await retainedMinimalContours({ ...height, data: new Float32Array(height.data) });
  expect(extractions).toBe(2);
});
