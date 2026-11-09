const PORT = Number(process.env.CDP_PORT || 9333);
const BASE = process.env.BASE || 'http://localhost:4173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  throw new Error('no target');
}

const t = await target();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let seq = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    console.log('[exception]', d.text, d.exception?.description || '');
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    console.log('[console]', msg.params.type, msg.params.args.map((a) => a.value ?? a.description).join(' '));
  }
  if (msg.method === 'Log.entryAdded') {
    console.log('[log]', msg.params.entry.level, msg.params.entry.text);
  }
};

function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
}

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Page.navigate', { url: `${BASE}${process.argv[2] || '/?demo=1'}` });
await sleep(2500);
const probe = await send('Runtime.evaluate', {
  expression: `(() => ({
    ready: document.readyState,
    hasHook: !!window.__blockmark,
    count: document.getElementById('count')?.textContent,
    shapes: window.__blockmark ? window.__blockmark.store.get().shapes.length : -1,
    image: window.__blockmark ? window.__blockmark.store.get().image : null,
    src: document.getElementById('photo')?.src.slice(0, 60),
    natural: [document.getElementById('photo')?.naturalWidth, document.getElementById('photo')?.naturalHeight]
  }))()`,
  returnByValue: true,
});
console.log(JSON.stringify(probe.result?.result?.value, null, 2));
ws.close();
