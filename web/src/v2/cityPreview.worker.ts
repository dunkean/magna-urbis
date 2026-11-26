/// <reference lib="webworker" />
import { detailCityPreview, generateCityPreview, type CityPreviewDetail, type CityPreviewPlan } from './cityPreviewPlan';
import type { ExternalCityHints } from './externalCity/types';

type PreviewRequest = { type: 'plan'; hints: ExternalCityHints } | { type: 'detail' };
export type PreviewReply = { type: 'plan'; plan: CityPreviewPlan } | { type: 'detail'; detail: CityPreviewDetail };

const worker: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
let draft: ReturnType<typeof generateCityPreview> | undefined;
worker.onmessage = ({ data }: MessageEvent<PreviewRequest>) => {
  if (data.type === 'plan') {
    draft = generateCityPreview(data.hints);
    worker.postMessage({ type: 'plan', plan: draft.plan } satisfies PreviewReply);
  } else if (draft) {
    worker.postMessage({ type: 'detail', detail: detailCityPreview(draft) } satisfies PreviewReply);
    draft = undefined;
  }
};
