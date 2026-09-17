import { locateCandidates } from './candidate-locator.js';

self.onmessage = ({ data }: MessageEvent) => {
  try {
    if (data.type !== 'locate') throw new Error('Unknown candidate request');
    self.postMessage({ id: data.id, result: locateCandidates(data.frame, data.qr === true, data.linear === true) });
  } catch (error) { self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) }); }
};
