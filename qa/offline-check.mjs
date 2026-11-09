import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PORT = Number(process.env.CDP_PORT || 9336);
const BASE = process.env.BASE || 'http://localhost:4173';
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

await mkdir(OUT_DIR, { recursive: true });
await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

await send('Page.navigate', { url: `${BASE}/` });
await sleep(2500);
const online = await evaluate(`(async () => {
  const reg = await navigator.serviceWorker.ready;
  return { scope: reg.scope, controller: !!navigator.serviceWorker.controller, bg: getComputedStyle(document.body).backgroundColor };
})()`);

await send('Network.emulateNetworkConditions', {
  offline: true,
  latency: 0,
  downloadThroughput: 0,
  uploadThroughput: 0,
});
await send('Page.reload', { ignoreCache: false });
await sleep(2500);

const offline = await evaluate(`(() => ({
  ready: document.readyState,
  onLine: navigator.onLine,
  hasApp: !!document.getElementById('app'),
  hasToolbar: !!document.getElementById('toolbar'),
  buttons: document.querySelectorAll('.shape-btn').length,
  styled: getComputedStyle(document.body).backgroundColor,
  title: document.title
}))()`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
await writeFile(join(OUT_DIR, '06-offline.png'), Buffer.from(shot.data, 'base64'));

await send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
});

console.log(JSON.stringify({ online, offline }, null, 2));
ws.close();
