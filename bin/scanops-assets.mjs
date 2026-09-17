#!/usr/bin/env node
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pruneLegacyAssets } from './scanops-legacy.mjs';

const args = process.argv.slice(2), force = args.includes('--force');
const destinations = args.filter(value => value !== '--force');
if (destinations.length !== 1 || destinations[0].startsWith('-')) {
  console.error('Usage: scanops-assets <public-directory> [--force]'); process.exitCode = 1;
} else {
  const destination = resolve(destinations[0]);
  const source = fileURLToPath(new URL('../dist/assets/', import.meta.url));
  const marker = '.scanops-assets';
  try {
    const entries = await readdir(destination).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    if (entries.length && !force) throw new Error('Destination is not empty. Choose an empty SDK-only directory or use --force to update an existing SDK directory.');
    if (entries.length && force) {
      const previous = await readFile(join(destination, marker), 'utf8').catch(() => '');
      const legacy = await readFile(join(destination, '.smartscaner-assets'), 'utf8').catch(() => '');
      if (previous !== 'scanops-browser-sdk\n' && legacy !== 'smartscaner-browser-sdk\n') throw new Error('Refusing to overwrite a directory not created by scanops-assets. Use a new SDK-only directory.');
    }
    await mkdir(destination, { recursive: true });
    await cp(source, destination, { recursive: true });
    await writeFile(join(destination, marker), 'scanops-browser-sdk\n');
    const removed = await pruneLegacyAssets(destination);
    if (removed.length) console.log(`Removed ${removed.length} obsolete SDK runtime files; they can be regenerated from the previous SDK package.`);
    console.log(`ScanOps runtime assets copied to ${destination}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
