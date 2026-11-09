import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('页面包含全部关键挂载点', () => {
  const ids = [
    'stage', 'frame', 'photo', 'shapes', 'overlay', 'empty', 'toolbar',
    'count', 'palette', 'hint', 'btn-undo', 'btn-redo', 'btn-delete',
    'btn-export', 'btn-image', 'btn-pick', 'btn-camera', 'file', 'file-camera', 'toast',
    'btn-deform', 'btn-reset',
  ];
  for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), `缺少 #${id}`);
});

test('移动端视口与 PWA 元信息', () => {
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /rel="manifest"/);
  assert.match(html, /apple-mobile-web-app-capable/);
});

test('资源全部用相对路径，部署到子路径也能用', async () => {
  const offender = (html.match(/(?:href|src)="\/(?!\/)[^"]*"/g) || []).join(', ');
  assert.equal(offender, '', `发现根绝对路径: ${offender}`);

  const manifest = JSON.parse(
    await readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'),
  );
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  for (const icon of manifest.icons) assert.ok(!icon.src.startsWith('/'), `图标路径是绝对路径: ${icon.src}`);
});
