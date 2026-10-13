import { generateUrbanLanduse, type UrbanLanduseRequest, type UrbanLanduseResponse } from './urbanLanduseData';

self.onmessage = (event: MessageEvent<UrbanLanduseRequest>): void => {
  const { id, input } = event.data;
  let response: UrbanLanduseResponse;
  try { response = { id, scene: generateUrbanLanduse(input) }; }
  catch (error) { response = { id, error: error instanceof Error ? error.message : String(error) }; }
  self.postMessage(response);
};
