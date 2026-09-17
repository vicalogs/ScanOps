import type { AutoZoomInfo, AutoZoomStatus, CameraInfo, Region, ScanResult } from './types.js';

type Zoom = NonNullable<CameraInfo['zoom']>;
type Target = { region: Region; since: number; lastSeen: number; samples: number; sharpness?: number };
const center = (r: Region) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const matches = (a: Region, b: Region) => {
  const ac = center(a), bc = center(b);
  return Math.hypot(ac.x - bc.x, ac.y - bc.y) < Math.max(.035, Math.min(a.width, a.height) * .5)
    && Math.max(a.width / b.width, b.width / a.width, a.height / b.height, b.height / a.height) < 1.5;
};

/** Deterministic policy; the scanner owns device I/O and cancels stale decisions. */
export class AutoZoomController {
  info: AutoZoomInfo = { enabled: false, status: 'off' };
  private base = 1;
  private ceiling = 1;
  private target?: Target;
  private lastSeen = 0;
  private lastDecode = -Infinity;
  private settleUntil = 0;
  private previousZoom?: number;
  private referenceSharpness?: number;
  private softFrames = 0;

  reset(enabled: boolean, zoom: Zoom | null, multiple: boolean, now: number) {
    this.info = { enabled, status: !enabled ? 'off' : multiple ? 'multi-code' : !zoom ? 'unsupported' : 'searching' };
    this.base = zoom?.value ?? 1; this.ceiling = Math.min(zoom?.max ?? 1, this.base * 3);
    this.target = undefined; this.previousZoom = undefined; this.referenceSharpness = undefined;
    this.lastSeen = now; this.lastDecode = -Infinity; this.settleUntil = now; this.softFrames = 0;
  }
  manual() { if (this.info.enabled) this.state('manual'); this.target = undefined; this.previousZoom = undefined; }
  failed() { this.state('error'); this.target = undefined; }
  private state(status: AutoZoomStatus) { this.info = { ...this.info, status }; }

  update(frame: ScanResult, zoom: Zoom, now: number): number | null {
    if (['off', 'unsupported', 'multi-code', 'manual', 'error'].includes(this.info.status)) return null;
    if (frame.candidateError) { this.failed(); return null; }
    if (frame.codes.length) {
      this.lastDecode = now; this.lastSeen = now; this.target = undefined;
      this.referenceSharpness = undefined; this.softFrames = 0;
      this.state('holding'); return null;
    }
    if (now < this.settleUntil || now - this.lastDecode < 1500) return null;
    // A throttled-out measurement isn't evidence that a target left the scene.
    if (!frame.candidateSampled) return null;
    // Finding a box alone isn't a reason to move the lens. A budget-skipped
    // candidate must get its local decode attempt on a subsequent observation.
    if (frame.candidates.length && !frame.candidates.some(c => c.decodeAttempted)) return null;
    const choices = frame.candidates.flatMap(c => {
      const r = c.scanRegion;
      if (!c.decodeAttempted || c.score < .85 || ![c.score, r.x, r.y, r.width, r.height, frame.width, frame.height].every(Number.isFinite) || frame.width <= 0 || frame.height <= 0 || r.width <= 0 || r.height <= 0 || r.x < 0 || r.y < 0 || r.x + r.width > frame.width + 1 || r.y + r.height > frame.height + 1) return [];
      return [{ candidate: c, region: { x: r.x / frame.width, y: r.y / frame.height, width: r.width / frame.width, height: r.height / frame.height } }];
    }).sort((a, b) => {
      const ac = center(a.region), bc = center(b.region);
      return Math.hypot(ac.x - .5, ac.y - .5) - Math.hypot(bc.x - .5, bc.y - .5);
    });
    const choice = this.target ? choices.find(c => matches(c.region, this.target!.region)) : choices[0];
    if (!choice) {
      this.target = undefined;
      if (now - this.lastSeen >= 1200 && zoom.value > this.base + zoom.step / 2) return this.retreat(zoom);
      this.state('searching'); return null;
    }
    const { candidate, region } = choice;
    const continuous = this.target && now - this.target.lastSeen <= 900 && matches(region, this.target.region);
    this.target = continuous ? { ...this.target!, region, samples: this.target!.samples + 1, lastSeen: now } : { region, samples: 1, since: now, lastSeen: now, sharpness: candidate.sharpness };
    this.lastSeen = now;
    if (this.referenceSharpness !== undefined && candidate.sharpness !== undefined && candidate.sharpness < this.referenceSharpness * .55) this.softFrames++;
    else this.softFrames = 0;
    if (this.softFrames >= 2 && this.previousZoom !== undefined) return this.retreat(zoom);
    const c = center(region);
    if (Math.abs(c.x - .5) > .18 || Math.abs(c.y - .5) > .18) { this.state('centering'); return null; }
    // Candidate rectangles include quiet zones. Broad/nearby targets are not
    // improved by blindly filling the frame; leave headroom for tilt and motion.
    const size = Math.max(region.width, region.height), targetSize = candidate.kind === 'linear' ? .55 : .4;
    if (size >= targetSize) { this.state('holding'); return null; }
    if (this.target.samples < 3 || now - this.target.since < 400) { this.state('stabilizing'); return null; }
    const desired = Math.min(this.ceiling, zoom.value * Math.min(1.15, targetSize / size));
    const value = stepZoom(desired, zoom);
    const factor = value / zoom.value;
    const projected = { x: .5 + (region.x - .5) * factor, y: .5 + (region.y - .5) * factor, width: region.width * factor, height: region.height * factor };
    if (projected.x < .06 || projected.y < .06 || projected.x + projected.width > .94 || projected.y + projected.height > .94) { this.state('centering'); return null; }
    if (value <= zoom.value + zoom.step / 2) { this.state('limit'); return null; }
    this.referenceSharpness = candidate.sharpness;
    this.state('zooming'); return value;
  }

  private retreat(zoom: Zoom) {
    const value = stepZoom(Math.max(this.base, this.previousZoom ?? this.base), zoom);
    // Don't repeatedly retry a magnification that just lost/degraded the target.
    this.ceiling = Math.min(this.ceiling, value);
    this.referenceSharpness = undefined; this.previousZoom = undefined;
    if (value >= zoom.value - zoom.step / 2) { this.state('limit'); return null; }
    this.state('recovering'); return value;
  }

  applied(before: number, after: number, now: number) {
    if (after > before) this.previousZoom = before;
    this.target = undefined; this.softFrames = 0;
    this.lastSeen = now; this.settleUntil = now + 500;
  }
}

/** Round down so a coarse device step cannot exceed our requested zoom or cap. */
export function stepZoom(value: number, zoom: Zoom): number {
  return Number(Math.max(zoom.min, Math.min(zoom.max, zoom.min + Math.floor((value - zoom.min) / zoom.step + 1e-7) * zoom.step)).toFixed(8));
}
