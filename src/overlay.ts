import type { Point, ScanResult } from './types.js';

export type OverlayOptions = { smoothingMs?: number; color?: string };
/** Renders decoded corners independently of React and the decoder's sampling loop. */
export class QrOverlay {
  private polygon: SVGPolygonElement;
  private current: Point[] = [];
  private from: Point[] = [];
  private target: Point[] = [];
  private animation?: number;
  private started = 0;
  private identity?: string;
  private size = '';
  private closed = false;
  private duration: number;
  constructor(private svg: SVGSVGElement, options: OverlayOptions = {}) {
    this.duration = options.smoothingMs ?? 35;
    if (!Number.isFinite(this.duration) || this.duration < 0 || this.duration > 100) throw new RangeError('smoothingMs must be between 0 and 100');
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) this.duration = 0;
    this.polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    this.polygon.setAttribute('fill', options.color ?? '#30e3a1'); this.polygon.setAttribute('fill-opacity', '0.22');
    this.polygon.setAttribute('stroke', options.color ?? '#30e3a1');
    this.polygon.setAttribute('stroke-width', '3'); this.polygon.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet'); svg.appendChild(this.polygon); this.clear();
  }
  update(result: Pick<ScanResult, 'code' | 'width' | 'height'>) {
    if (this.closed) return;
    if (!result.code) { this.clear(); return; }
    const { width, height, code } = result;
    if (!(width > 0 && height > 0) || code.cornerPoints.length !== 4 || code.cornerPoints.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('Invalid overlay geometry');
    const size = `${width} ${height}`, target = code.cornerPoints.map(p => ({ ...p }));
    const distance = this.current.length === 4 ? Math.max(...target.map((p, i) => Math.hypot(p.x - this.current[i].x, p.y - this.current[i].y))) : Infinity;
    const identity = JSON.stringify([code.format, code.data]);
    const snap = this.identity !== identity || this.size !== size || distance < .25 || distance > Math.hypot(width, height) * .15 || this.duration === 0;
    this.identity = identity; this.size = size; this.target = target;
    this.svg.setAttribute('viewBox', `0 0 ${size}`);
    this.polygon.style.visibility = 'visible';
    if (this.animation !== undefined) cancelAnimationFrame(this.animation);
    this.animation = undefined;
    if (snap) { this.current = target; this.draw(); return; }
    this.from = this.current.map(p => ({ ...p })); this.started = performance.now();
    this.animation = requestAnimationFrame(this.tick);
  }
  private tick = (now: number) => {
    this.animation = undefined;
    if (this.closed || !this.target.length) return;
    const progress = Math.max(0, Math.min(1, (now - this.started) / this.duration));
    this.current = this.target.map((p, i) => ({ x: this.from[i].x + (p.x - this.from[i].x) * progress, y: this.from[i].y + (p.y - this.from[i].y) * progress }));
    this.draw();
    if (progress < 1) this.animation = requestAnimationFrame(this.tick);
  };
  private draw() { this.polygon.setAttribute('points', this.current.map(p => `${p.x},${p.y}`).join(' ')); }
  clear() {
    if (this.animation !== undefined) cancelAnimationFrame(this.animation);
    this.animation = undefined; this.current = []; this.from = []; this.target = []; this.identity = undefined;
    this.polygon.style.visibility = 'hidden'; this.polygon.removeAttribute('points');
  }
  destroy() { if (this.closed) return; this.clear(); this.closed = true; this.polygon.remove(); }
}
