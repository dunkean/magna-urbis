import { generateUrbanLanduse, type UrbanLanduseRequest, type UrbanLanduseResponse } from './urbanLanduseData';

self.onmessage = async (event: MessageEvent<UrbanLanduseRequest>): Promise<void> => {
  const { id, input } = event.data;
  let response: UrbanLanduseResponse;
  try { response = { id, scene: await generateUrbanLanduse(input) }; }
  catch (error) { response = { id, error: error instanceof Error ? error.message : String(error) }; }
  self.postMessage(response);
};
