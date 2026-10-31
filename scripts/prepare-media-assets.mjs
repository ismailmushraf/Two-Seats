import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const source = dirname(require.resolve('libav-wasm'));
const destination = new URL('../public/media-codecs/0.8.12/', import.meta.url);
mkdirSync(destination, { recursive: true });
for (const name of ['worker.js', 'libav.wasm', 'libav-jspi.wasm']) {
  copyFileSync(join(source, name), new URL(name, destination));
}
