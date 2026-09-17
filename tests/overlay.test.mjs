import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QrOverlay } from '../dist/scanops.js';

function setup(t, options) {
  const keys = ['document', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'matchMedia'];
  const old = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let time = 0, next = 0; const queue = new Map();
  const polygon = { attributes: {}, style: {}, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; }, remove() { this.removed = true; } };
  const svg = { attributes: {}, appendChild() {}, setAttribute(name, value) { this.attributes[name] = value; } };
  const mocks = { document: { createElementNS: () => polygon }, requestAnimationFrame: callback => { queue.set(++next, callback); return next; }, cancelAnimationFrame: id => queue.delete(id), performance: { now: () => time }, matchMedia: () => ({ matches: false }) };
  for (const [key, value] of Object.entries(mocks)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const overlay = new QrOverlay(svg, options);
  t.after(() => { overlay.destroy(); for (const [key, value] of Object.entries(old)) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; } });
  return { overlay, svg, polygon, queue, step(now) { time = now; const batch = [...queue.values()]; queue.clear(); batch.forEach(callback => callback(time)); } };
}
function result(x, data = 'same', width = 640, height = 480) { return { width, height, code: { data, cornerPoints: [{ x, y: 10 }, { x: x + 80, y: 10 }, { x: x + 80, y: 90 }, { x, y: 90 }] } }; }
const firstX = polygon => Number(polygon.attributes.points.split(',')[0]);
test('overlay paints intermediate positions on animation frames and settles without a perpetual RAF loop', t => {
  const { overlay, polygon, queue, step } = setup(t, { smoothingMs: 40 });
  overlay.update(result(10)); assert.equal(firstX(polygon), 10); assert.equal(queue.size, 0);
  overlay.update(result(50)); assert.equal(firstX(polygon), 10);
  step(20); assert.equal(firstX(polygon), 30);
  step(40); assert.equal(firstX(polygon), 50); assert.equal(queue.size, 0);
});
test('large jumps, identity changes and orientation changes snap rather than animate across unrelated locations', t => {
  const { overlay, polygon, svg, queue } = setup(t);
  overlay.update(result(10)); overlay.update(result(400)); assert.equal(firstX(polygon), 400); assert.equal(queue.size, 0);
  overlay.update(result(420, 'different')); assert.equal(firstX(polygon), 420);
  overlay.update(result(10, 'different', 480, 640)); assert.equal(firstX(polygon), 10); assert.equal(svg.attributes.viewBox, '0 0 480 640');
});
test('lost targets clear the overlay immediately and destruction cancels pending animation', t => {
  const { overlay, polygon, queue, step } = setup(t);
  overlay.update(result(10)); overlay.update(result(30)); assert.equal(queue.size, 1);
  overlay.clear(); assert.equal(queue.size, 0); assert.equal(polygon.style.visibility, 'hidden');
  step(100); assert.equal(polygon.attributes.points, undefined);
  overlay.update(result(10)); overlay.update(result(30)); overlay.destroy();
  assert.equal(queue.size, 0); assert.equal(polygon.removed, true);
});
