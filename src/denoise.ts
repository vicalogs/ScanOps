/** A 3×3 luminance median removes isolated speckles while retaining barcode edges. */
export function denoisePixels(pixels: { data: Uint8ClampedArray; width: number; height: number }) {
  const { data, width, height } = pixels;
  const output = new Uint8ClampedArray(data);
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >>> 8;
  const values = new Uint8Array(9);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const value = gray[(y + dy) * width + x + dx];
      let position = count++;
      while (position > 0 && values[position - 1] > value) { values[position] = values[position - 1]; position--; }
      values[position] = value;
    }
    const index = (y * width + x) * 4;
    output[index] = output[index + 1] = output[index + 2] = values[4];
  }
  return { data: output, width, height };
}
