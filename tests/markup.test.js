import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('页面包含全部关键挂载点', () => {
  const ids = [
    'stage', 'frame', 'photo', 'shapes', 'overlay', 'empty', 'toolbar',
    'count', 'palette', 'hint', 'btn-undo', 'btn-redo', 'btn-delete',
    'btn-export', 'btn-image', 'btn-pick', 'btn-camera', 'file', 'file-camera', 'toast',
  ];
  for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), `缺少 #${id}`);
});

test('移动端视口与 PWA 元信息', () => {
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /rel="manifest"/);
  assert.match(html, /apple-mobile-web-app-capable/);
});
