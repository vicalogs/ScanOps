import type { QrCode, TrackResult } from './types.js';
/** Single-code identity tracking from decoded frames; does not predict invisible corners. */
export class Tracker {
  private sequence = 0;
  current: TrackResult | null = null;
  constructor(private lostAfterMs: number) {}
  update(code: QrCode, now: number): TrackResult {
    const same = this.current && this.current.code.data === code.data && this.current.code.format === code.format && now - this.current.lastSeen <= this.lostAfterMs;
    return this.current = { id: same ? this.current!.id : ++this.sequence, code, lastSeen: now };
  }
  expire(now: number): boolean {
    if (this.current && now - this.current.lastSeen > this.lostAfterMs) { this.current = null; return true; }
    return false;
  }
  reset(): boolean { const had = this.current !== null; this.current = null; return had; }
}
