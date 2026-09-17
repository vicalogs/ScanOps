import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { ScanOpsView } from '../dist/scanops-react.js';
import { TEST_LICENSE } from './browser-mocks.mjs';

test('React entry renders during SSR without camera or DOM access and respects labels/controls', () => {
  const html = renderToString(createElement(ScanOpsView, { options: { license: TEST_LICENSE }, labels: { start: '开启摄像头', stop: '停止' } }));
  assert.match(html, /<video/); assert.match(html, /开启摄像头/); assert.match(html, /停止/);
  const custom = renderToString(createElement(ScanOpsView, { options: { license: TEST_LICENSE }, controls: false }));
  assert.doesNotMatch(custom, /<button/);
});
