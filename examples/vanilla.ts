import { ScanOps } from '@scanops/browser-sdk';

const video = document.querySelector<HTMLVideoElement>('#camera')!;
const result = document.querySelector<HTMLElement>('#result')!;
const scanner = new ScanOps({ license: { key: 'YOUR_LICENSE_KEY', endpoint: 'https://your-domain.com/api/license/authorize' }, mode: 'assisted', assetBaseUrl: '/scanops/' });
scanner.on('result', value => { if (value.code) result.textContent = value.code.data; });
scanner.on('error', error => { result.textContent = error.message; });
document.querySelector('#start')!.addEventListener('click', () => { void scanner.start(video).catch(() => {}); });
document.querySelector('#stop')!.addEventListener('click', () => scanner.stop());
window.addEventListener('pagehide', () => scanner.stop());
// For SPA routes: call scanner.destroy() when the route is unmounted.
