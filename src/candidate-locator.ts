import type { Candidate, Region } from './types.js';

type Pixels = { data: Uint8ClampedArray; width: number; height: number };
type Finder = { x: number; y: number; moduleSize: number; hits: number };
type Run = { start: number; length: number; dark: boolean };

/** Bounded, conservative structural locator. It finds undecoded targets, not content.
 * QR: three cross-checked 1:1:3:1:1 finders. Linear: varied bars repeated across rows.
 * No inferred payloads, neural upscaling, or claims of calibrated confidence.
 */
export function locateCandidates(frame: Pixels, qr: boolean, linear: boolean): Candidate[] {
  const { width, height, data } = frame;
  if (width < 16 || height < 16 || width > 960 || height > 960 || data.length !== width * height * 4) return [];
  const gray = new Uint8Array(width * height), histogram = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) {
    const value = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8;
    gray[i] = value; histogram[value]++;
  }
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];
  let count = 0, partial = 0, best = 0, contrast = 0, threshold = 127;
  for (let i = 0; i < 255; i++) {
    count += histogram[i]; partial += i * histogram[i];
    if (!count || count === gray.length) continue;
    const difference = partial / count - (sum - partial) / (gray.length - count);
    const variance = count * (gray.length - count) * difference * difference;
    if (variance > best) { best = variance; contrast = Math.abs(difference); threshold = i; }
  }
  // A distant code occupies very few pixels; global variance would reject it
  // even when its individual bars are sharp black/white. Compare class means.
  if (contrast < 30) return [];
  const dark = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && gray[y * width + x] <= threshold;
  const runs = (size: number, sample: (p: number) => boolean): Run[] => {
    const result: Run[] = [];
    for (let start = 0; start < size;) {
      const value = sample(start); let end = start + 1;
      while (end < size && sample(end) === value) end++;
      result.push({ start, length: end - start, dark: value }); start = end;
    }
    return result;
  };
  const candidates: Candidate[] = [];
  const add = (region: Region, kind: 'qr' | 'linear', score: number) => {
    const x = Math.max(0, Math.floor(region.x)), y = Math.max(0, Math.floor(region.y));
    const r = Math.min(width, Math.ceil(region.x + region.width)), b = Math.min(height, Math.ceil(region.y + region.height));
    if (r <= x || b <= y) return;
    candidates.push({ score, kind, source: 'structure', scanRegion: { x, y, width: r - x, height: b - y }, sharpness: sharpness(gray, width, height, { x, y, width: r - x, height: b - y }) });
  };
  if (qr) {
    const ratio = (lengths: number[]) => {
      const moduleSize = lengths.reduce((a, b) => a + b, 0) / 7;
      return moduleSize >= 1 && lengths.every((n, i) => Math.abs(n - moduleSize * (i === 2 ? 3 : 1)) <= moduleSize * (i === 2 ? 1 : .7)) ? moduleSize : 0;
    };
    const finders: Finder[] = [];
    for (let y = 0; y < height; y++) {
      const row = runs(width, x => dark(x, y));
      for (let i = 0; i + 4 < row.length; i++) {
        if (!row[i].dark) continue;
        const moduleSize = ratio(row.slice(i, i + 5).map(r => r.length));
        if (!moduleSize || moduleSize > 24) continue;
        const x = Math.floor(row[i + 2].start + row[i + 2].length / 2);
        let top = y, bottom = y;
        while (top >= 0 && dark(x, top)) top--;
        while (bottom < height && dark(x, bottom)) bottom++;
        const lengths = [0, 0, bottom - top - 1, 0, 0];
        let a = top, b = bottom;
        while (a >= 0 && !dark(x, a) && lengths[1] < moduleSize * 3) { lengths[1]++; a--; }
        while (a >= 0 && dark(x, a) && lengths[0] < moduleSize * 3) { lengths[0]++; a--; }
        while (b < height && !dark(x, b) && lengths[3] < moduleSize * 3) { lengths[3]++; b++; }
        while (b < height && dark(x, b) && lengths[4] < moduleSize * 3) { lengths[4]++; b++; }
        const vertical = ratio(lengths), centerY = (top + bottom) / 2;
        if (!vertical || Math.abs(vertical - moduleSize) > moduleSize * .5) continue;
        const old = finders.find(f => Math.hypot(f.x - x, f.y - centerY) < moduleSize * 2 && Math.abs(f.moduleSize - moduleSize) < moduleSize);
        if (old) { old.x = (old.x * old.hits + x) / (old.hits + 1); old.y = (old.y * old.hits + centerY) / (old.hits + 1); old.hits++; }
        else if (finders.length < 96) finders.push({ x, y: centerY, moduleSize: (moduleSize + vertical) / 2, hits: 1 });
      }
    }
    const points = finders.filter(f => f.hits >= 2).sort((a, b) => b.hits - a.hits).slice(0, 24);
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) for (let k = j + 1; k < points.length; k++) {
      const group = [points[i], points[j], points[k]];
      const moduleSize = group.reduce((sum, f) => sum + f.moduleSize, 0) / 3;
      if (group.some(f => Math.abs(f.moduleSize - moduleSize) > moduleSize * .4)) continue;
      for (let pivot = 0; pivot < 3; pivot++) {
        const a = group[pivot], b = group[(pivot + 1) % 3], c = group[(pivot + 2) % 3];
        const u = { x: b.x - a.x, y: b.y - a.y }, v = { x: c.x - a.x, y: c.y - a.y };
        const lu = Math.hypot(u.x, u.y), lv = Math.hypot(v.x, v.y);
        if (Math.min(lu, lv) < moduleSize * 10 || Math.max(lu, lv) > moduleSize * 175 || lu / lv < .65 || lu / lv > 1.54 || Math.abs(u.x * v.x + u.y * v.y) / (lu * lv) > .25) continue;
        const xs = [a.x, b.x, c.x, b.x + c.x - a.x], ys = [a.y, b.y, c.y, b.y + c.y - a.y];
        const pad = moduleSize * 7.5;
        add({ x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, width: Math.max(...xs) - Math.min(...xs) + pad * 2, height: Math.max(...ys) - Math.min(...ys) + pad * 2 }, 'qr', .94);
        break;
      }
    }
  }
  if (linear) for (const vertical of [false, true]) {
    const across = vertical ? height : width, along = vertical ? width : height;
    const sample = (x: number, y: number) => vertical ? dark(y, x) : dark(x, y);
    const groups: { start: number; end: number; top: number; bottom: number; hits: number; pattern: boolean[]; moduleSize: number }[] = [];
    for (let y = 0; y < along; y += 2) {
      const row = runs(across, x => sample(x, y));
      const bars = row.filter(r => r.dark).map(r => r.length).sort((a, b) => a - b);
      const unit = bars[Math.floor(bars.length * .15)] ?? 1;
      const segments: Run[][] = [[]];
      for (const run of row) {
        if (!run.dark && run.length >= Math.max(8, unit * 6)) { if (segments.at(-1)!.length) segments.push([]); }
        else segments.at(-1)!.push(run);
      }
      for (const segment of segments) {
        if (segment.length < 30 || !segment[0].dark || !segment.at(-1)!.dark) continue;
        const sizes = segment.map(r => r.length).sort((a, b) => a - b);
        const low = sizes[Math.floor(sizes.length * .1)], high = sizes[Math.floor(sizes.length * .9)];
        const start = segment[0].start, end = segment.at(-1)!.start + segment.at(-1)!.length;
        if (high / low > 5 || high / low < 1.4 || end - start < 40) continue;
        const pattern = Array.from({ length: 64 }, (_, n) => sample(Math.min(end - 1, Math.floor(start + (n + .5) * (end - start) / 64)), y));
        const old = groups.find(g => y - g.bottom <= 4 && Math.abs(g.start - start) <= low * 2 && Math.abs(g.end - end) <= low * 2 && pattern.filter((p, n) => p === g.pattern[n]).length >= 58);
        if (old) { old.bottom = y; old.hits++; }
        else if (groups.length < 256) groups.push({ start, end, top: y, bottom: y, hits: 1, pattern, moduleSize: low });
      }
    }
    for (const g of groups) {
      const length = g.end - g.start, thickness = g.bottom - g.top + 2;
      if (g.hits < 4 || thickness < Math.max(6, length * .07) || thickness > length) continue;
      const pad = g.moduleSize * 10;
      const box = { x: g.start - pad, y: g.top - g.moduleSize * 2, width: length + pad * 2, height: thickness + g.moduleSize * 4 };
      add(vertical ? { x: box.y, y: box.x, width: box.height, height: box.width } : box, 'linear', .88);
    }
  }
  const kept: Candidate[] = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    const r = candidate.scanRegion;
    if (kept.some(c => {
      const s = c.scanRegion;
      const overlap = Math.max(0, Math.min(r.x + r.width, s.x + s.width) - Math.max(r.x, s.x)) * Math.max(0, Math.min(r.y + r.height, s.y + s.height) - Math.max(r.y, s.y));
      return overlap > .5 * Math.min(r.width * r.height, s.width * s.height);
    })) continue;
    kept.push(candidate); if (kept.length === 3) break;
  }
  return kept;
}

function sharpness(gray: Uint8Array, width: number, height: number, box: Region): number {
  let laplacian = 0, gradient = 0;
  for (let y = Math.max(1, box.y); y < Math.min(height - 1, box.y + box.height); y++) for (let x = Math.max(1, box.x); x < Math.min(width - 1, box.x + box.width); x++) {
    const i = y * width + x, c = gray[i];
    gradient += Math.abs(gray[i + 1] - c) + Math.abs(gray[i + width] - c);
    laplacian += Math.abs(gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * c);
  }
  return gradient ? laplacian / gradient : 0;
}
