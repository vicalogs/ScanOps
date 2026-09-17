import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

if (!process.argv[2]) throw new Error('Usage: node scripts/verify-install.mjs <sdk.tgz>');
const archive = resolve(process.argv[2]);
const root = await mkdtemp(join(tmpdir(), 'scanops-install-'));
const require = createRequire(import.meta.url);
for (const manager of ['npm', 'yarn', 'pnpm']) {
  const cwd = join(root, manager); await mkdir(cwd);
  await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: `sdk-${manager}-consumer`, version: '1.0.0', private: true, type: 'module' }));
  const args = manager === 'npm'
    ? ['install', archive, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', join(root, 'npm-cache')]
    : manager === 'yarn'
      ? ['add', archive, '--offline', '--ignore-scripts', '--non-interactive', '--cache-folder', join(root, 'yarn-cache')]
      : ['add', archive, '--offline', '--ignore-scripts', '--store-dir', join(root, 'pnpm-store'), '--config.auto-install-peers=false'];
  execFileSync(manager, args, { cwd, stdio: 'pipe' });
  execFileSync(process.execPath, ['--input-type=module', '-e', "import {ScanOps,SDK_VERSION} from '@scanops/browser-sdk'; if(typeof ScanOps!=='function'||SDK_VERSION!=='0.1.0-beta.3') throw Error('Invalid SDK exports');"], { cwd });
  execFileSync(join(cwd, 'node_modules/.bin/scanops-assets'), [join(cwd, 'public/scanops')], { cwd });
  const entry = join(cwd, 'main.ts');
  await writeFile(entry, "import {ScanOps,type ScanResult} from '@scanops/browser-sdk';\nexport const scannerFactory=()=>{const scanner=new ScanOps({formats:['QRCode','Code128']});scanner.on('result',(r:ScanResult)=>console.log(r.code?.format,r.code?.data));return scanner;};\n");
  await writeFile(join(cwd, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, types: [], noEmit: true }, include: ['main.ts'] }));
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', join(cwd, 'tsconfig.json')], { cwd, stdio: 'inherit' });
  await build({ absWorkingDir: cwd, entryPoints: [entry], outfile: join(cwd, 'build/main.js'), bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent' });
  const meta = JSON.parse(await readFile(join(cwd, 'public/scanops/scanops-manifest.json'), 'utf8'));
  if (meta.sdk !== '0.1.0-beta.3') throw new Error('Wrong asset version');
  if (meta.assetLayout !== 'scanops-v1') throw new Error('Wrong asset layout');
  await readFile(join(cwd, 'public/scanops/scanops-barcode.worker.js'));
  await readFile(join(cwd, 'public/scanops/scanops-barcode.wasm'));
  await readFile(join(cwd, 'public/scanops/scanops-engine.wasm'));
  console.log(`${manager}: local tarball install, core SSR import, TypeScript consumer, browser bundle and asset CLI passed`);
}
console.log(`Consumer fixtures retained at ${root}`);
