import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PORT = Number(process.env.CDP_PORT || 9333);
const BASE = process.env.BASE || 'http://localhost:4173';
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.superpowers', 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Page.javascriptDialogOpening') {
        this.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      }
    };
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = (e) => reject(new Error(`ws error: ${e.message || 'unknown'}`));
    });
    return new CDP(ws);
  }

  send(method, params = {}) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, 15000);
    });
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }

  async shot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(OUT_DIR, name), Buffer.from(data, 'base64'));
  }

  async mouse(type, x, y, extra = {}) {
    await this.send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: type === 'mouseMoved' ? 'none' : 'left',
      buttons: type === 'mousePressed' || type === 'mouseMoved' ? 1 : 0,
      clickCount: type === 'mouseMoved' ? 0 : 1,
      ...extra,
    });
  }

  async drag(from, to, steps = 6) {
    await this.mouse('mousePressed', from.x, from.y);
    for (let i = 1; i <= steps; i += 1) {
      await this.mouse('mouseMoved', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
      await sleep(16);
    }
    await this.mouse('mouseReleased', to.x, to.y);
    await sleep(120);
  }
}

async function pageTarget() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch {
      /* chrome not up yet */
    }
    await sleep(250);
  }
  throw new Error('找不到 Chrome 调试目标，先启动 chrome --remote-debugging-port');
}

async function waitFor(cdp, expression, label, timeout = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      if (await cdp.eval(expression)) return;
    } catch {
      /* page still navigating */
    }
    await sleep(120);
  }
  throw new Error(`等待超时: ${label}`);
}

const main = async () => {
  await mkdir(OUT_DIR, { recursive: true });
  const target = await pageTarget();
  const cdp = await CDP.connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  const report = {};

  await cdp.send('Page.navigate', { url: `${BASE}/` });
  await waitFor(cdp, `document.readyState === 'complete'`, '首页加载');
  await sleep(400);
  await cdp.shot('01-empty.png');
  report.empty = await cdp.eval(`(() => ({
    toolbarHidden: document.getElementById('toolbar').hidden,
    emptyVisible: !document.getElementById('empty').hidden,
    exportDisabled: document.getElementById('btn-export').disabled
  }))()`);

  await cdp.send('Page.navigate', { url: `${BASE}/?demo=1` });
  await waitFor(cdp, `window.__blockmark && window.__blockmark.store.get().shapes.length === 3`, 'demo 载入');
  await sleep(500);
  await cdp.shot('02-demo.png');
  report.demo = await cdp.eval(`(() => ({
    shapes: window.__blockmark.store.get().shapes,
    frame: (() => { const r = document.getElementById('frame').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })(),
    count: document.getElementById('count').textContent,
    exportDisabled: document.getElementById('btn-export').disabled
  }))()`);

  const frame = report.demo.frame;
  const ellipse = report.demo.shapes.find((s) => s.type === 'ellipse');
  const center = {
    x: frame.x + (ellipse.x + ellipse.w / 2) * frame.w,
    y: frame.y + (ellipse.y + ellipse.h / 2) * frame.h,
  };
  await cdp.drag(center, { x: center.x + 30, y: center.y + 40 });

  const moved = await cdp.eval(`(() => {
    const s = window.__blockmark.store.get().shapes.find(x => x.type === 'ellipse');
    const r = document.getElementById('frame').getBoundingClientRect();
    return { shape: { ...s }, frame: { x: r.x, y: r.y, w: r.width, h: r.height } };
  })()`);
  const east = await cdp.eval(`(() => {
    const el = document.querySelector('.handle[data-handle="e"]');
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  await cdp.drag(east, { x: east.x + 25, y: east.y });

  report.afterMove = moved.shape;
  report.afterDrag = await cdp.eval(`(() => {
    const s = window.__blockmark.store.get().shapes.find(x => x.type === 'ellipse');
    return { x: s.x, y: s.y, w: s.w, h: s.h, undo: !!window.__blockmark.store.canUndo() };
  })()`);
  await cdp.shot('03-after-drag.png');

  await cdp.eval(`document.getElementById('btn-deform').click()`);
  await sleep(250);
  const deformed = await cdp.eval(`(() => {
    const s = window.__blockmark.store.get().shapes.find(x => x.type === 'ellipse');
    const r = document.getElementById('frame').getBoundingClientRect();
    return { quad: s.quad, frame: { x: r.x, y: r.y, w: r.width, h: r.height }, deformMode: window.__blockmark.store.get().deformMode };
  })()`);
  const from = await cdp.eval(`(() => {
    const el = document.querySelector('.handle[data-handle="c2"]');
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  await cdp.drag(from, { x: from.x - 20, y: from.y - 30 });
  report.deform = await cdp.eval(`(() => {
    const s = window.__blockmark.store.get().shapes.find(x => x.type === 'ellipse');
    return { quad: s.quad, box: { x: s.x, y: s.y, w: s.w, h: s.h } };
  })()`);
  await cdp.shot('04-deform.png');

  report.export = await cdp.eval(`(async () => {
    const out = await window.__blockmark.exportPng();
    return { size: out.blob.size, W: out.W, H: out.H, scaled: out.scaled };
  })()`);

  await cdp.eval(`(async () => {
    const out = await window.__blockmark.exportPng();
    const img = document.createElement('img');
    img.id = 'export-preview';
    img.src = URL.createObjectURL(out.blob);
    img.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;object-fit:contain;background:#000;z-index:99';
    document.body.append(img);
    await img.decode();
    return true;
  })()`);
  await sleep(300);
  await cdp.shot('05-export.png');
  await cdp.eval(`document.getElementById('export-preview').remove()`);

  report.reset = await cdp.eval(`(() => {
    document.getElementById('btn-reset').click();
    const s = window.__blockmark.store.get().shapes.find(x => x.type === 'ellipse');
    return { hasQuad: !!s.quad, deformMode: window.__blockmark.store.get().deformMode };
  })()`);

  report.undo = await cdp.eval(`(() => {
    window.__blockmark.store.undo();
    const s = window.__blockmark.store.get().shapes.find(x => x.type === 'ellipse');
    return { w: s.w };
  })()`);

  console.log(JSON.stringify(report, null, 2));
  cdp.ws.close();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
