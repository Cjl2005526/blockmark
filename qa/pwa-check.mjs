const PORT = Number(process.env.CDP_PORT || 9333);
const BASE = process.env.BASE || 'http://localhost:4173';
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
  return new Promise((resolve) => pending.set(id, resolve));
}

await send('Page.enable');
await send('Page.navigate', { url: `${BASE}/` });
await sleep(2000);

const probe = await send('Runtime.evaluate', {
  expression: `(async () => {
    const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
    const out = { hasSW: 'serviceWorker' in navigator };
    try {
      const reg = await withTimeout(navigator.serviceWorker.ready, 4000);
      out.scope = reg.scope;
      out.controller = !!navigator.serviceWorker.controller;
    } catch (err) {
      out.swError = String(err);
    }
    try {
      const res = await fetch('/manifest.webmanifest');
      const json = await res.json();
      out.manifest = { status: res.status, icons: json.icons.length, name: json.name };
    } catch (err) {
      out.manifest = String(err);
    }
    try {
      const keys = await caches.keys();
      out.caches = keys;
      if (keys.length) {
        const cache = await caches.open(keys[0]);
        out.cached = (await cache.keys()).length;
      }
    } catch (err) {
      out.caches = String(err);
    }
    return out;
  })()`,
  awaitPromise: true,
  returnByValue: true,
});

console.log(JSON.stringify(probe.result?.result?.value, null, 2));
ws.close();
