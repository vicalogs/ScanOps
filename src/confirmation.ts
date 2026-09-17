import type { DetectedCode } from './types.js';

/** Confirmation is separate from raw decoding and geometric tracking. */
export class ConfirmationGate {
  private candidate = '';
  private count = 0;
  private lastSeen = -Infinity;
  private active = '';
  private emitted = '';
  private emittedAt = -Infinity;
  constructor(private frames: number, private windowMs: number, private repeatDelayMs: number) {}
  update(code: DetectedCode | null, now: number) {
    if (now - this.lastSeen > this.windowMs) { this.candidate = ''; this.count = 0; this.active = ''; }
    if (!code) { this.candidate = ''; this.count = 0; return { confirmed: false, emit: false }; }
    const key = JSON.stringify([code.format, code.data]);
    this.count = key === this.candidate ? this.count + 1 : 1;
    this.candidate = key; this.lastSeen = now;
    const confirmed = this.count >= this.frames;
    let emit = false;
    if (confirmed && this.active !== key) {
      this.active = key;
      if (this.emitted !== key || now - this.emittedAt >= this.repeatDelayMs) {
        this.emitted = key; this.emittedAt = now; emit = true;
      }
    }
    return { confirmed, emit };
  }
  reset() { this.candidate = ''; this.active = ''; this.emitted = ''; this.count = 0; this.lastSeen = this.emittedAt = -Infinity; }
}

/** Each distinct payload gets at most one observation per frame, regardless of order or duplicate prints. */
export class MultiConfirmationGate {
  private gates = new Map<string, { gate: ConfirmationGate; lastSeen: number }>();
  constructor(private frames: number, private windowMs: number, private repeatDelayMs: number) {}
  update(codes: DetectedCode[], now: number) {
    const key = (code: DetectedCode) => JSON.stringify([code.format, code.data]);
    const present = new Map(codes.map(code => [key(code), code]));
    const confirmed = new Set<string>(), emitted: DetectedCode[] = [];
    for (const [id, entry] of this.gates) if (!present.has(id)) {
      entry.gate.update(null, now);
      if (now - entry.lastSeen > Math.max(this.windowMs, this.repeatDelayMs)) this.gates.delete(id);
    }
    for (const [id, code] of present) {
      let entry = this.gates.get(id);
      if (!entry) {
        entry = { gate: new ConfirmationGate(this.frames, this.windowMs, this.repeatDelayMs), lastSeen: now };
        this.gates.set(id, entry);
      }
      entry.lastSeen = now;
      const state = entry.gate.update(code, now);
      if (state.confirmed) confirmed.add(id);
      if (state.emit) emitted.push(code);
    }
    return { confirmed: codes.filter(code => confirmed.has(key(code))), emitted };
  }
  reset() { this.gates.clear(); }
}
