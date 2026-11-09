import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.mjs';

async function start() {
  const dir = await mkdtemp(join(tmpdir(), 'blockmark-'));
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>色块标注</title>');
  await writeFile(join(dir, 'app.js'), 'console.log(1)');
  const server = createServer(dir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

test('静态服务器返回首页', async () => {
  const server = await start();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<title>色块标注<\/title>/);
  server.close();
});

test('JS 文件带正确 MIME', async () => {
  const server = await start();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/app.js`);
  assert.equal(res.headers.get('content-type'), 'text/javascript; charset=utf-8');
  server.close();
});

test('不存在的路径返回 404', async () => {
  const server = await start();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/nope.js`);
  assert.equal(res.status, 404);
  server.close();
});
