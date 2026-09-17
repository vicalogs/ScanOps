'use client';
import { useState } from 'react';
import { ScanOpsView } from '@scanops/browser-sdk/react';

export default function Scanner() {
  const [text, setText] = useState('');
  return <>
    <ScanOpsView options={{ license: { key: 'YOUR_LICENSE_KEY', endpoint: 'https://your-domain.com/api/license/authorize' }, mode: 'assisted' }}
      labels={{ start: '开启摄像头', stop: '停止', starting: '正在启动…' }}
      onResult={result => { if (result.code) setText(result.code.data); }} />
    <pre aria-live="polite">{text}</pre>
  </>;
}
