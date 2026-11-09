import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PORT = Number(process.env.CDP_PORT || 9333);
const BASE = process.env.BASE || 'http://localhost:4173';
const PHOTO = process.env.PHOTO || 'C:\\Users\\25512\\文档\\deepseek-harness\\default-workspace\\bgtest.png';
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.superpowers', 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let seq = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === 'Page.javascriptDialogOpening') {
    send('Page.handleJavaScriptDialog', { accept: true });
    return;
  }
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, (msg) => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }
    }, 15000);
  });
}
async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
  return res.result?.value;
}
async function waitFor(expression, label, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      if (await evaluate(expression)) return;
    } catch {
      /* retry */
    }
    await sleep(150);
  }
  throw new Error(`等待超时: ${label}`);
}

await mkdir(OUT_DIR, { recursive: true });
await send('Page.enable');
await send('Runtime.enable');
await send('DOM.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: `${BASE}/` });
await waitFor(`document.readyState === 'complete'`, '首页');

const doc = await send('DOM.getDocument', { depth: -1 });
const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file' });
await send('DOM.setFileInputFiles', { files: [PHOTO], nodeId: input.nodeId });

await waitFor(`window.__blockmark && window.__blockmark.store.get().image !== null`, '照片载入');
await sleep(600);

const loaded = await evaluate(`(() => ({
  image: window.__blockmark.store.get().image,
  natural: [document.getElementById('photo').naturalWidth, document.getElementById('photo').naturalHeight],
  frame: (() => { const r = document.getElementById('frame').getBoundingClientRect(); return { w: r.width, h: r.height }; })(),
  toolbarHidden: document.getElementById('toolbar').hidden,
  emptyHidden: document.getElementById('empty').hidden
}))()`);

await evaluate(`(() => {
  const s = window.__blockmark.store;
  s.addShape('rect'); s.addShape('ellipse'); s.addShape('triangle');
  s.updateShape('s_1', { x: 0.1, y: 0.15, w: 0.3, h: 0.25 });
  s.updateShape('s_2', { x: 0.52, y: 0.1, w: 0.3, h: 0.35 });
  s.updateShape('s_3', { x: 0.3, y: 0.55, w: 0.35, h: 0.35 });
  return true;
})()`);
await sleep(300);

const shot = await send('Page.captureScreenshot', { format: 'png' });
await writeFile(join(OUT_DIR, '05-real-photo.png'), Buffer.from(shot.data, 'base64'));

const exported = await evaluate(`(async () => {
  const out = await window.__blockmark.exportPng();
  const bitmap = await createImageBitmap(out.blob);
  return { size: out.blob.size, W: out.W, H: out.H, bitmap: [bitmap.width, bitmap.height], scaled: out.scaled };
})()`);

console.log(JSON.stringify({ loaded, exported }, null, 2));
ws.close();

