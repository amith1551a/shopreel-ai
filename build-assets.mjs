import { readdir, readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { gzipSync } from 'node:zlib';

const isBuildOnly = process.argv.includes('--build-only');

const dist = resolve('dist');
const notices = resolve(dist, 'licenses');
await mkdir(notices, { recursive: true });
for (const [source, target] of [
  [join('node_modules', 'h264-mp4-encoder', 'LICENSE.md'), 'h264-mp4-encoder-MIT.txt'],
  [join('node_modules', 'mediabunny', 'LICENSE'), 'mediabunny-MPL-2.0.txt'],
  [join('node_modules', '@mediabunny', 'mp3-encoder', 'LICENSE'), 'mp3-extension-MPL-2.0.txt'],
  [join('node_modules', '@mediabunny', 'mp3-encoder', 'licenses', 'lame', 'COPYING'), 'lame-LGPL.txt'],
  [join('node_modules', '@mediabunny', 'mp3-encoder', 'licenses', 'lame', 'LICENSE'), 'lame-notice.txt'],
  ['THIRD_PARTY_NOTICES.md', 'README.txt'],
  ['vite.config.ts', 'encoder-adapter-source.txt'],
]) await cp(resolve(source), resolve(notices, target));
async function compress(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await compress(path);
    else if (['.js', '.css', '.html', '.txt'].includes(extname(path))) {
      const source = await readFile(path);
      await writeFile(path + '.gz', gzipSync(source, { level: 9 }));
    }
  }
}
await compress(dist);
console.log('Prepared local gzip assets and third-party notices.');

// Exit explicitly in build-only mode to prevent Express server startup
if (isBuildOnly) {
  console.log('Build assets complete (--build-only mode). Exiting.');
  process.exit(0);
}
