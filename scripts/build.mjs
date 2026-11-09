import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
const files = ['index.html', 'manifest.webmanifest', 'sw.js', 'src', 'icons'];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const entries = [];
for (const name of files) {
  await cp(join(root, name), join(out, name), { recursive: true });
  const info = await stat(join(out, name));
  entries.push(`${name}${info.isDirectory() ? '/' : ''}`);
}
console.log(`构建完成：dist/（${entries.join(' ')}）`);
