/**
 * Reference implementation of the locator's connected-component region extraction, in
 * plain JS. The shipped engine does this in C++ (packages/engine/src/locator.cpp,
 * candidateRegions); model.test.mjs runs this over the saved ONNX-expected mask to
 * check the engine's regions match. Kept here, not in src, because it is test-only
 * since inference moved into the engine.
 */
export function candidateRois(mask, size, width, height, { confidenceThreshold, maskThreshold = .5, minArea = 30 }) {
  if (mask.length !== size * size || width <= 0 || height <= 0) throw new Error('Invalid mask or source dimensions');
  const visited = new Uint8Array(mask.length), stack = new Int32Array(mask.length), result = [];
  for (let origin = 0; origin < mask.length; origin++) {
    if (visited[origin] || mask[origin] < maskThreshold) continue;
    let head = 0, tail = 1, count = 0, total = 0, left = size, top = size, right = 0, bottom = 0;
    stack[0] = origin; visited[origin] = 1;
    while (head < tail) {
      const p = stack[head++], x = p % size, y = Math.floor(p / size);
      count++; total += mask[p]; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const i = ny * size + nx;
        if (!visited[i] && mask[i] >= maskThreshold) { visited[i] = 1; stack[tail++] = i; }
      }
    }
    const score = total / count;
    if (count < minArea || score < confidenceThreshold) continue;
    const padding = Math.max(right - left + 1, bottom - top + 1) * .2;
    const x = Math.max(0, Math.floor((left - padding) * width / size));
    const y = Math.max(0, Math.floor((top - padding) * height / size));
    const x2 = Math.min(width, Math.ceil((right + 1 + padding) * width / size));
    const y2 = Math.min(height, Math.ceil((bottom + 1 + padding) * height / size));
    result.push({ score, scanRegion: { x, y, width: x2 - x, height: y2 - y } });
  }
  return result.sort((a, b) => b.score - a.score);
}
