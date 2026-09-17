import bwip from 'bwip-js';
import { Canvas } from './browser-mocks.mjs';
export const examples = [
  ['Code128', 'code128', 'SCANOPS-123'], ['Code39', 'code39', 'SCANOPS39'],
  ['Code93', 'code93', 'SCANOPS93'], ['EAN13', 'ean13', '5901234123457'],
  ['EAN8', 'ean8', '96385074'], ['UPCA', 'upca', '036000291452'],
  ['UPCE', 'upce', '04252614'], ['ITF', 'interleaved2of5', '1234567890'],
  ['Codabar', 'rationalizedCodabar', 'A123456B'],
];
export function barcodeImage(example = examples[0], { x = 70, y = 80, scale = 2, rotate = false, blank = false } = {}) {
  const image = new Canvas(); image.width = 960; image.height = 640;
  image.pixels = new Uint8ClampedArray(image.width * image.height * 4).fill(255);
  const raw = bwip.raw({ bcid: example[1], text: example[2], includecheck: example[0] === 'Code93' })[0];
  let offset = 0;
  if (!blank) raw.sbs.forEach((width, i) => {
    if (i % 2 === 0) for (let dy = 0; dy < 100; dy++) for (let dx = 0; dx < width * scale; dx++) {
      const px = x + (rotate ? dy : offset + dx), py = y + (rotate ? offset + dx : dy);
      if (px >= image.width || py >= image.height) throw new Error('Fixture outside frame');
      const p = (py * image.width + px) * 4;
      image.pixels[p] = image.pixels[p + 1] = image.pixels[p + 2] = 0;
    }
    offset += width * scale;
  });
  return image;
}
