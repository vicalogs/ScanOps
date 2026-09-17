import { QrOverlay } from './overlay.js';
import type { OverlayOptions } from './overlay.js';
import type { DetectedCode, ScanResult } from './types.js';

/** Position-matched overlays; repeated payloads at different positions remain separate. */
export class MultiCodeOverlay {
  private entries: { code: DetectedCode; overlay: QrOverlay }[] = [];
  private closed = false;
  constructor(private svg: SVGSVGElement, private options: OverlayOptions = {}) {}
  update(result: Pick<ScanResult, 'codes' | 'width' | 'height'>) {
    if (this.closed) return;
    const unused = new Set(this.entries);
    const aspect = this.svg.getAttribute('preserveAspectRatio') ?? 'xMidYMid meet';
    this.entries = result.codes.map(code => {
      const center = (item: DetectedCode) => ({ x: item.cornerPoints.reduce((sum, p) => sum + p.x, 0) / 4, y: item.cornerPoints.reduce((sum, p) => sum + p.y, 0) / 4 });
      const target = center(code);
      const distance = (item: DetectedCode) => { const origin = center(item); return Math.hypot(origin.x - target.x, origin.y - target.y); };
      const match = [...unused].filter(item => item.code.format === code.format && item.code.data === code.data).sort((a, b) => distance(a.code) - distance(b.code))[0];
      if (match) unused.delete(match);
      const entry = match ?? { code, overlay: new QrOverlay(this.svg, this.options) };
      entry.code = code;
      entry.overlay.update({ code, width: result.width, height: result.height });
      return entry;
    });
    this.svg.setAttribute('preserveAspectRatio', aspect);
    for (const entry of unused) entry.overlay.destroy();
  }
  clear() { for (const entry of this.entries) entry.overlay.destroy(); this.entries = []; }
  destroy() { if (this.closed) return; this.clear(); this.closed = true; }
}
