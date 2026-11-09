# 色块标注（BlockMark）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个零依赖的手机网页应用：选图 → 添加矩形/圆形/三角形半透明色块 → 移动与八向拉伸 → 导出带编号的原分辨率 PNG，交给 AI 改图时指明要改的区域。

**Architecture:** 原生 ES 模块 + 原生 DOM/SVG，无框架、无构建、无 npm 依赖。图片铺底，SVG 图层画形状，DOM 图层画选中框与控制点；导出时用离屏 Canvas 按原图像素重绘。所有几何数据以图片显示区域为基准、存 0～1 比例值。

**Tech Stack:** JavaScript（ESM）、SVG、Canvas 2D、Pointer Events、Service Worker；测试用 Node 内置 `node:test`；图标用 Python + Pillow 生成。

**设计文档：** `docs/superpowers/specs/2026-11-10-blockmark-design.md`

---

## 全局约定

- 运行环境：Node 24（已装），无 `npm install`
- 测试命令：`node --test tests/`
- 本地预览：`node server.mjs . 4173` → http://localhost:4173
- 截图核验：`& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=3000 --window-size=390,844 --screenshot="<输出路径>" "http://localhost:4173/<页面>"`
- 颜色常量：`#FF3B30` `#0A84FF` `#34C759` `#FF9F0A` `#BF5AF2` `#FFFFFF`
- 填充透明度固定 0.36；屏幕描边 2px；最小尺寸 28 屏幕像素
- 所有坐标 `x,y,w,h` 都是相对图片显示区域的 0～1 比例
- 每个 Task 结束都要 `git add -A && git commit`

## 文件结构

```
blockmark/
├── index.html                 应用外壳
├── manifest.webmanifest       PWA 清单
├── sw.js                      离线缓存
├── server.mjs                 零依赖静态服务器（可被测试 import）
├── package.json               仅声明 type=module 与脚本
├── icons/                     192 / 512 / apple-touch-icon
├── scripts/make-icons.py      Pillow 生成图标
├── dev/preview.html           视觉预览床（不是产品页面）
├── src/
│   ├── main.js                装配、加载图片、导出流程
│   ├── shapes.js              纯几何 + 颜色工具
│   ├── state.js               状态 / 选中 / 编号 / 撤销
│   ├── view.js                图片适配、SVG 形状、选中框与控制点
│   ├── gestures.js            指针状态机（点选 / 移动 / 八向拉伸）
│   ├── export.js              导出尺寸决策、绘制、分享下载
│   ├── ui.js                  工具栏、色板、计数、toast
│   └── styles.css
├── tests/
│   ├── server.test.js
│   ├── shapes.test.js
│   ├── state.test.js
│   ├── export.test.js
│   └── markup.test.js
└── docs/superpowers/…         设计文档与实施计划
```

职责边界：`shapes.js` 只做纯函数（无 DOM），`state.js` 只管理数据与历史（无 DOM），`view.js` 只读状态渲染，`gestures.js` 只把指针事件翻译成 state 调用，`export.js` 只做导出（纯函数与 DOM 绘制分离），`main.js` 负责把它们接起来。

---

### Task 1: 项目骨架与本地静态服务器

**Files:**
- Create: `package.json`
- Create: `server.mjs`
- Create: `tests/server.test.js`

- [ ] **Step 1: 写失败的测试**

`tests/server.test.js`：

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/server.test.js`
Expected: FAIL —— `Cannot find module '…/server.mjs'`

- [ ] **Step 3: 写实现**

`server.mjs`：

```js
import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { networkInterfaces } from 'node:os';
import { pathToFileURL } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export function createServer(root) {
  const base = resolve(root);
  return createHttpServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const rel = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
      const file = resolve(base, `.${rel}`);
      if (file !== base && !file.startsWith(base + sep)) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }
      const data = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(data);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  });
}

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
}

function main() {
  const root = resolve(process.argv[2] || '.');
  const port = Number(process.env.PORT || process.argv[3] || 4173);
  const server = createServer(root);
  server.listen(port, '0.0.0.0', () => {
    console.log(`本机：  http://localhost:${port}`);
    for (const ip of lanAddresses()) console.log(`手机：  http://${ip}:${port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

`package.json`：

```json
{
  "name": "blockmark",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/",
    "serve": "node server.mjs . 4173"
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/server.test.js`
Expected: PASS，3 个测试通过

- [ ] **Step 5: 提交**

```bash
git add package.json server.mjs tests/server.test.js
git commit -m "feat: 零依赖静态服务器与冒烟测试"
```

---

### Task 2: 几何核心 shapes.js

**Files:**
- Create: `src/shapes.js`
- Create: `tests/shapes.test.js`

- [ ] **Step 1: 写失败的测试**

`tests/shapes.test.js`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PALETTE, createShape, moveRect, resizeRect, lockAspect,
  containRect, shapeGeometry, hexToRgba, textColorFor,
} from '../src/shapes.js';

const rect = { type: 'rect', x: 0.2, y: 0.2, w: 0.4, h: 0.4, color: '#FF3B30' };

test('新建色块居中且为 30% 大小', () => {
  const s = createShape('ellipse', 's_1', PALETTE[1]);
  assert.equal(s.type, 'ellipse');
  assert.equal(s.w, 0.3);
  assert.equal(s.h, 0.3);
  assert.equal(s.x, 0.35);
  assert.equal(s.y, 0.35);
});

test('移动被夹在图片范围内', () => {
  const far = moveRect({ ...rect, x: 0.6, w: 0.4 }, 0.5, 0);
  assert.equal(far.x, 0.6); // 右边已贴边
  const left = moveRect(rect, -5, -5);
  assert.deepEqual([left.x, left.y], [0, 0]);
});

test('拖东边只加宽，高度不变', () => {
  const r = resizeRect(rect, 'e', 0.2, 0.1);
  assert.equal(r.w, 0.6);
  assert.equal(r.h, 0.4);
  assert.equal(r.x, 0.2);
});

test('拖西边改变起点，右边界不动', () => {
  const r = resizeRect(rect, 'w', 0.1, 0);
  assert.equal(r.x, 0.3);
  assert.equal(r.w, 0.3);
});

test('拖北边不改变宽度', () => {
  const r = resizeRect(rect, 'n', 0.2, -0.1);
  assert.equal(r.w, 0.4);
  assert.equal(r.h, 0.5);
});

test('拖角同时改宽高', () => {
  const r = resizeRect(rect, 'se', 0.1, 0.1);
  assert.equal(r.w, 0.5);
  assert.equal(r.h, 0.5);
});

test('不越过最小尺寸', () => {
  const r = resizeRect(rect, 'e', -0.9, 0, 0.05, 0.05);
  assert.ok(r.w >= 0.05 - 1e-9);
  const r2 = resizeRect(rect, 'w', 0.9, 0, 0.05, 0.05);
  assert.ok(r2.w >= 0.05 - 1e-9);
});

test('不越过图片边界', () => {
  const r = resizeRect(rect, 'e', 5, 0);
  assert.equal(r.w, 0.8);
  const r2 = resizeRect(rect, 'nw', -5, -5);
  assert.deepEqual([r2.x, r2.y], [0, 0]);
});

test('Shift 等比：按视觉宽高比修正', () => {
  const start = { ...rect, w: 0.4, h: 0.2 };
  const r = lockAspect({ ...start, w: 0.6, h: 0.2 }, start, 'se', 1000, 1000);
  assert.equal(r.w, 0.6);
  assert.ok(Math.abs(r.h - 0.3) < 1e-9); // 视觉比例 2:1 → 宽 0.6 时高 0.3
});

test('containRect 等比装入并居中', () => {
  const r = containRect(4000, 3000, 390, 500);
  assert.equal(r.w, 390);
  assert.ok(Math.abs(r.h - 292.5) < 1e-9);
  assert.equal(r.x, 0);
  assert.ok(Math.abs(r.y - 103.75) < 1e-9);
});

test('三种形状的几何描述', () => {
  const s = { ...rect, x: 0.1, y: 0.2, w: 0.4, h: 0.6 };
  assert.deepEqual(shapeGeometry(s), { kind: 'rect', x: 10, y: 20, w: 40, h: 60 });
  assert.deepEqual(shapeGeometry({ ...s, type: 'ellipse' }), { kind: 'ellipse', cx: 30, cy: 50, rx: 20, ry: 30 });
  const tri = shapeGeometry({ ...s, type: 'triangle' });
  assert.equal(tri.kind, 'triangle');
  assert.deepEqual(tri.points, [[30, 20], [50, 80], [10, 80]]);
});

test('颜色工具', () => {
  assert.equal(hexToRgba('#FF3B30', 0.36), 'rgba(255,59,48,0.36)');
  assert.equal(textColorFor('#0A84FF'), '#FFFFFF');
  assert.equal(textColorFor('#FFFFFF'), '#1D1D1F');
  assert.equal(textColorFor('#FF9F0A'), '#1D1D1F');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/shapes.test.js`
Expected: FAIL —— `Cannot find module '…/src/shapes.js'`

- [ ] **Step 3: 写实现**

`src/shapes.js`：

```js
export const PALETTE = ['#FF3B30', '#0A84FF', '#34C759', '#FF9F0A', '#BF5AF2', '#FFFFFF'];
export const SHAPE_TYPES = ['rect', 'ellipse', 'triangle'];
export const DEFAULT_SIZE = 0.3;
export const MIN_PX = 28;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

export function createShape(type, id, color) {
  const offset = (1 - DEFAULT_SIZE) / 2;
  return { id, type, x: offset, y: offset, w: DEFAULT_SIZE, h: DEFAULT_SIZE, color };
}

export function moveRect(rect, dx, dy) {
  return {
    ...rect,
    x: clamp(rect.x + dx, 0, 1 - rect.w),
    y: clamp(rect.y + dy, 0, 1 - rect.h),
  };
}

export function resizeRect(rect, handle, dx, dy, minW = 0.02, minH = 0.02) {
  let left = rect.x;
  let right = rect.x + rect.w;
  let top = rect.y;
  let bottom = rect.y + rect.h;
  if (handle.includes('w')) left = clamp(left + dx, 0, right - minW);
  if (handle.includes('e')) right = clamp(right + dx, left + minW, 1);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - minH);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + minH, 1);
  return { ...rect, x: left, y: top, w: right - left, h: bottom - top };
}

export function lockAspect(rect, start, handle, frameW, frameH) {
  const ar = (start.w * frameW) / (start.h * frameH);
  const dw = Math.abs(rect.w - start.w) / start.w;
  const dh = Math.abs(rect.h - start.h) / start.h;
  let w = rect.w;
  let h = rect.h;
  if (dw >= dh) h = (w * frameW) / ar / frameH;
  else w = (h * frameH * ar) / frameW;
  w = Math.min(w, 1);
  h = Math.min(h, 1);
  let x = handle.includes('w') ? start.x + start.w - w : start.x;
  let y = handle.includes('n') ? start.y + start.h - h : start.y;
  x = clamp(x, 0, 1 - w);
  y = clamp(y, 0, 1 - h);
  return { ...rect, x, y, w, h };
}

export function containRect(imageW, imageH, boxW, boxH) {
  const scale = Math.min(boxW / imageW, boxH / imageH);
  const w = imageW * scale;
  const h = imageH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

export function shapeGeometry(shape) {
  const x = shape.x * 100;
  const y = shape.y * 100;
  const w = shape.w * 100;
  const h = shape.h * 100;
  if (shape.type === 'ellipse') {
    return { kind: 'ellipse', cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 };
  }
  if (shape.type === 'triangle') {
    return { kind: 'triangle', points: [[x + w / 2, y], [x + w, y + h], [x, y + h]] };
  }
  return { kind: 'rect', x, y, w, h };
}

export function hexToRgb(hex) {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function textColorFor(hex) {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#1D1D1F' : '#FFFFFF';
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/shapes.test.js`
Expected: PASS，12 个测试通过

- [ ] **Step 5: 提交**

```bash
git add src/shapes.js tests/shapes.test.js
git commit -m "feat: 形状几何与颜色工具"
```

---

### Task 3: 状态、编号与撤销 state.js

**Files:**
- Create: `src/state.js`
- Create: `tests/state.test.js`

- [ ] **Step 1: 写失败的测试**

`tests/state.test.js`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { PALETTE } from '../src/shapes.js';

test('新增自动选中，编号按添加顺序', () => {
  const s = createStore();
  s.addShape('rect');
  s.addShape('ellipse');
  const st = s.get();
  assert.deepEqual(st.shapes.map((x) => x.id), ['s_1', 's_2']);
  assert.equal(st.selectedId, 's_2');
  assert.deepEqual(st.shapes.map((x) => x.color), [PALETTE[0], PALETTE[1]]);
});

test('删除中间色块后编号连续（顺序即编号）', () => {
  const s = createStore();
  s.addShape('rect');
  s.addShape('rect');
  s.addShape('rect');
  s.select('s_2');
  s.deleteSelected();
  assert.deepEqual(s.get().shapes.map((x) => x.id), ['s_1', 's_3']);
  assert.equal(s.get().selectedId, null);
});

test('撤销恢复形状与选中态，重做再回来', () => {
  const s = createStore();
  s.addShape('rect');
  s.addShape('ellipse');
  s.undo();
  assert.equal(s.get().shapes.length, 1);
  s.redo();
  assert.equal(s.get().shapes.length, 2);
  assert.equal(s.get().selectedId, 's_2');
});

test('新操作清空重做栈', () => {
  const s = createStore();
  s.addShape('rect');
  s.undo();
  assert.equal(s.canRedo(), true);
  s.addShape('triangle');
  assert.equal(s.canRedo(), false);
});

test('一次拖动只入栈一次', () => {
  const s = createStore();
  s.addShape('rect');
  const before = s.beginEdit();
  s.updateShape('s_1', { x: 0.4, y: 0.4, w: 0.3, h: 0.3 });
  s.updateShape('s_1', { x: 0.45, y: 0.45, w: 0.3, h: 0.3 });
  s.endEdit(before);
  s.undo();
  assert.equal(s.get().shapes[0].x, 0.35);
  assert.equal(s.get().shapes[0].y, 0.35);
});

test('改色入栈且同色不重复入栈', () => {
  const s = createStore();
  s.addShape('rect');
  s.setColor('#0A84FF');
  s.setColor('#0A84FF');
  s.undo();
  assert.equal(s.get().shapes[0].color, PALETTE[0]);
  assert.equal(s.canUndo(), true); // 还有新增那一步
});

test('换图清空形状与历史', () => {
  const s = createStore();
  s.addShape('rect');
  s.setImage({ url: 'blob:x', w: 100, h: 100 });
  assert.equal(s.get().shapes.length, 0);
  assert.equal(s.canUndo(), false);
  assert.equal(s.get().image.url, 'blob:x');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/state.test.js`
Expected: FAIL —— `Cannot find module '…/src/state.js'`

- [ ] **Step 3: 写实现**

`src/state.js`：

```js
import { PALETTE, createShape } from './shapes.js';

const MAX_HISTORY = 50;

export function createStore() {
  let seq = 0;
  let state = { image: null, shapes: [], selectedId: null, undo: [], redo: [] };
  const listeners = new Set();

  const emit = () => {
    for (const fn of listeners) fn(state);
  };
  const snapshot = () => ({
    shapes: structuredClone(state.shapes),
    selectedId: state.selectedId,
  });
  const pushUndo = (snap) => {
    state.undo.push(snap);
    if (state.undo.length > MAX_HISTORY) state.undo.shift();
    state.redo = [];
  };

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get() {
      return state;
    },
    setImage(image) {
      state = { image, shapes: [], selectedId: null, undo: [], redo: [] };
      emit();
    },
    addShape(type) {
      const before = snapshot();
      const id = `s_${++seq}`;
      const color = PALETTE[state.shapes.length % PALETTE.length];
      state.shapes = [...state.shapes, createShape(type, id, color)];
      state.selectedId = id;
      pushUndo(before);
      emit();
    },
    deleteSelected() {
      if (!state.selectedId) return;
      const before = snapshot();
      state.shapes = state.shapes.filter((s) => s.id !== state.selectedId);
      state.selectedId = null;
      pushUndo(before);
      emit();
    },
    setColor(color) {
      const shape = state.shapes.find((s) => s.id === state.selectedId);
      if (!shape || shape.color === color) return;
      const before = snapshot();
      shape.color = color;
      pushUndo(before);
      emit();
    },
    select(id) {
      if (state.selectedId === id) return;
      state.selectedId = id;
      emit();
    },
    beginEdit() {
      return snapshot();
    },
    updateShape(id, rect) {
      const shape = state.shapes.find((s) => s.id === id);
      if (!shape) return;
      Object.assign(shape, { x: rect.x, y: rect.y, w: rect.w, h: rect.h });
      emit();
    },
    endEdit(before) {
      if (JSON.stringify(before.shapes) === JSON.stringify(state.shapes)) return;
      pushUndo(before);
      emit();
    },
    undo() {
      const snap = state.undo.pop();
      if (!snap) return;
      state.redo.push(snapshot());
      state.shapes = snap.shapes;
      state.selectedId = snap.selectedId;
      emit();
    },
    redo() {
      const snap = state.redo.pop();
      if (!snap) return;
      state.undo.push(snapshot());
      state.shapes = snap.shapes;
      state.selectedId = snap.selectedId;
      emit();
    },
    canUndo() {
      return state.undo.length > 0;
    },
    canRedo() {
      return state.redo.length > 0;
    },
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/state.test.js`
Expected: PASS，7 个测试通过

- [ ] **Step 5: 提交**

```bash
git add src/state.js tests/state.test.js
git commit -m "feat: 状态管理与撤销重做"
```

---

### Task 4: 导出纯函数

**Files:**
- Create: `src/export.js`
- Create: `tests/export.test.js`

- [ ] **Step 1: 写失败的测试**

`tests/export.test.js`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeOutputSize, exportGeometry, badgePosition, exportFilename } from '../src/export.js';

test('普通照片按原尺寸输出', () => {
  assert.deepEqual(computeOutputSize(4000, 3000), { W: 4000, H: 3000, scaled: false });
});

test('超长边降到 4096', () => {
  const r = computeOutputSize(8000, 6000);
  assert.equal(r.W, 4096);
  assert.equal(r.H, 3072);
  assert.equal(r.scaled, true);
});

test('超面积但长边不超，也降级', () => {
  const r = computeOutputSize(6000, 4000); // 2400 万像素
  assert.equal(r.scaled, true);
  assert.ok(r.W * r.H <= 16777216);
});

test('全景图只受长边约束', () => {
  const r = computeOutputSize(10000, 1000);
  assert.equal(r.W, 4096);
  assert.equal(r.H, 410);
});

test('描边与徽标按短边缩放并夹取', () => {
  const big = exportGeometry(4000, 3000);
  assert.equal(big.stroke, 10.5);
  assert.equal(big.badgeR, 64);
  const small = exportGeometry(1000, 800);
  assert.ok(Math.abs(small.stroke - 2.8) < 1e-9);
  assert.ok(Math.abs(small.badgeR - 17.6) < 1e-9);
  assert.equal(exportGeometry(200, 200).badgeR, 10);
});

test('徽标被夹在画面内', () => {
  assert.deepEqual(badgePosition({ x: 0, y: 0 }, 4000, 3000, 64), { cx: 64, cy: 64 });
  assert.deepEqual(badgePosition({ x: 1, y: 1 }, 4000, 3000, 64), { cx: 3936, cy: 2936 });
});

test('文件名带日期与分钟', () => {
  const name = exportFilename(new Date(2026, 10, 10, 9, 5));
  assert.equal(name, '标注_20261110-0905.png');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/export.test.js`
Expected: FAIL —— `Cannot find module '…/src/export.js'`

- [ ] **Step 3: 写实现**

`src/export.js`：

```js
import { shapeGeometry, hexToRgba, textColorFor } from './shapes.js';

export const MAX_EDGE = 4096;
export const MAX_AREA = 16777216;
export const FILL_ALPHA = 0.36;

export function computeOutputSize(imageW, imageH) {
  const k = Math.min(1, MAX_EDGE / Math.max(imageW, imageH), Math.sqrt(MAX_AREA / (imageW * imageH)));
  return {
    W: Math.max(1, Math.round(imageW * k)),
    H: Math.max(1, Math.round(imageH * k)),
    scaled: k < 1,
  };
}

export function exportGeometry(W, H) {
  const min = Math.min(W, H);
  return {
    stroke: Math.max(2, 0.0035 * min),
    badgeR: Math.min(64, Math.max(10, 0.022 * min)),
  };
}

export function badgePosition(shape, W, H, r) {
  return {
    cx: Math.min(Math.max(shape.x * W, r), W - r),
    cy: Math.min(Math.max(shape.y * H, r), H - r),
  };
}

export function exportFilename(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `标注_${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.png`;
}

export function tracePath(ctx, shape, W, H) {
  const g = shapeGeometry(shape);
  ctx.beginPath();
  if (g.kind === 'rect') {
    ctx.rect((g.x / 100) * W, (g.y / 100) * H, (g.w / 100) * W, (g.h / 100) * H);
  } else if (g.kind === 'ellipse') {
    ctx.ellipse((g.cx / 100) * W, (g.cy / 100) * H, (g.rx / 100) * W, (g.ry / 100) * H, 0, 0, Math.PI * 2);
  } else {
    g.points.forEach(([px, py], i) => {
      const x = (px / 100) * W;
      const y = (py / 100) * H;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
}

export function drawShapes(ctx, shapes, W, H) {
  if (!shapes.length) return;
  const { stroke, badgeR } = exportGeometry(W, H);
  shapes.forEach((shape, index) => {
    tracePath(ctx, shape, W, H);
    ctx.fillStyle = hexToRgba(shape.color, FILL_ALPHA);
    ctx.fill();
    ctx.lineWidth = stroke + 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke();
    ctx.lineWidth = stroke;
    ctx.strokeStyle = shape.color;
    ctx.stroke();

    const { cx, cy } = badgePosition(shape, W, H, badgeR);
    ctx.beginPath();
    ctx.arc(cx, cy, badgeR, 0, Math.PI * 2);
    ctx.fillStyle = shape.color;
    ctx.fill();
    ctx.fillStyle = textColorFor(shape.color);
    ctx.font = `700 ${badgeR * 1.1}px -apple-system, "PingFang SC", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), cx, cy + badgeR * 0.05);
  });
}

export async function exportPng(img, shapes) {
  const { W, H, scaled } = computeOutputSize(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(img, 0, 0, W, H);
  drawShapes(ctx, shapes, W, H);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('toBlob failed');
  return { blob, W, H, scaled };
}

export async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type || 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: '标注图' });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
      throw err;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/export.test.js`
Expected: PASS，7 个测试通过

- [ ] **Step 5: 提交**

```bash
git add src/export.js tests/export.test.js
git commit -m "feat: 导出尺寸决策与绘制"
```

---

### Task 5: 页面结构与样式

**Files:**
- Create: `index.html`
- Create: `src/styles.css`
- Create: `tests/markup.test.js`

- [ ] **Step 1: 写失败的测试**

`tests/markup.test.js`：

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/markup.test.js`
Expected: FAIL —— `ENOENT: no such file or directory, open '…/index.html'`

- [ ] **Step 3: 写实现**

`index.html`：

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="theme-color" content="#111112">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="色块标注">
<title>色块标注</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="stylesheet" href="/src/styles.css">
</head>
<body>
<div class="app">
  <header class="topbar">
    <button id="btn-image" class="icon-btn" aria-label="重新选图">‹</button>
    <span id="count" class="count">0 个标注</span>
    <button id="btn-export" class="primary-btn" disabled>导出</button>
  </header>

  <main id="stage" class="stage">
    <div id="empty" class="empty">
      <p class="empty-title">选一张要改的图</p>
      <p class="empty-sub">框出需要 AI 修改的区域，导出标注图</p>
      <button id="btn-pick" class="primary-btn big">选择图片</button>
      <button id="btn-camera" class="ghost-btn">拍照</button>
    </div>
    <div id="frame" class="frame" hidden>
      <img id="photo" alt="待标注的图片" draggable="false">
      <svg id="shapes" class="shapes" viewBox="0 0 100 100" preserveAspectRatio="none"></svg>
      <div id="overlay" class="overlay"></div>
    </div>
    <div id="spinner" class="spinner" hidden aria-label="加载中"></div>
  </main>

  <footer id="toolbar" class="toolbar" hidden>
    <div class="row">
      <div class="shape-picker" role="group" aria-label="添加形状">
        <button class="shape-btn" data-add="rect" aria-label="添加矩形">▭</button>
        <button class="shape-btn" data-add="ellipse" aria-label="添加圆形">◯</button>
        <button class="shape-btn" data-add="triangle" aria-label="添加三角形">△</button>
      </div>
      <div class="actions">
        <button id="btn-undo" class="icon-btn" aria-label="撤销" disabled>↶</button>
        <button id="btn-redo" class="icon-btn" aria-label="重做" disabled>↷</button>
        <button id="btn-delete" class="icon-btn danger" aria-label="删除" disabled>🗑</button>
      </div>
    </div>
    <div class="row">
      <div id="palette" class="palette" role="group" aria-label="色块颜色"></div>
      <span id="hint" class="hint">选中色块后可改色</span>
    </div>
  </footer>
</div>
<input id="file" type="file" accept="image/*" hidden>
<input id="file-camera" type="file" accept="image/*" capture="environment" hidden>
<div id="toast" class="toast" role="status" aria-live="polite"></div>
<script type="module" src="/src/main.js"></script>
</body>
</html>
```

`src/styles.css`：

```css
:root {
  --bg: #111112;
  --panel: #1c1c1e;
  --panel-2: #2c2c2e;
  --line: #2c2c2e;
  --text: #f2f2f7;
  --muted: #8e8e93;
  --accent: #0a84ff;
  --danger: #ff453a;
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
}

* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body { margin: 0; height: 100%; overflow: hidden; overscroll-behavior: none; background: var(--bg); }
body {
  color: var(--text);
  font: 15px/1.4 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  -webkit-user-select: none;
  user-select: none;
}
button { font: inherit; color: inherit; border: 0; background: none; touch-action: manipulation; cursor: pointer; }
button:disabled { opacity: 0.3; cursor: default; }
[hidden] { display: none !important; }

.app { display: flex; flex-direction: column; height: 100%; padding-top: var(--safe-top); }

.topbar {
  flex: none;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  border-bottom: 1px solid var(--line);
}
.icon-btn {
  width: 40px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  font-size: 17px;
}
.icon-btn.danger { color: var(--danger); }
.count { font-size: 13px; color: var(--muted); }
.primary-btn {
  background: var(--accent);
  color: #fff;
  font-weight: 600;
  font-size: 13px;
  padding: 7px 14px;
  border-radius: 15px;
}
.primary-btn.big { font-size: 16px; padding: 12px 28px; border-radius: 24px; }
.ghost-btn { color: var(--accent); font-size: 14px; padding: 10px; }

.stage {
  position: relative;
  flex: 1;
  min-height: 0;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  touch-action: none;
}
.frame { position: relative; touch-action: none; }
.frame img { display: block; width: 100%; height: 100%; pointer-events: none; -webkit-user-drag: none; }
.shapes { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.shape { cursor: move; filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.55)); }
.overlay { position: absolute; inset: 0; pointer-events: none; }

.sel-box {
  position: absolute;
  border: 1px dashed rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
}
.handle {
  position: absolute;
  width: 12px;
  height: 12px;
  margin: -6px 0 0 -6px;
  background: #fff;
  border: 1.5px solid var(--accent);
  border-radius: 3px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  pointer-events: auto;
  touch-action: none;
}
.handle::after { content: ""; position: absolute; inset: -16px; }

.badge {
  position: absolute;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  font-size: 10px;
  font-weight: 700;
  line-height: 17px;
  text-align: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}

.empty { text-align: center; padding: 24px; }
.empty-title { font-size: 19px; font-weight: 600; margin: 0 0 6px; }
.empty-sub { font-size: 13px; color: var(--muted); margin: 0 0 22px; }
.empty .primary-btn { display: block; margin: 0 auto 8px; }
.empty .ghost-btn { display: block; margin: 0 auto; }

.spinner {
  position: absolute;
  width: 26px;
  height: 26px;
  border: 2.5px solid rgba(255, 255, 255, 0.2);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.toolbar {
  flex: none;
  background: var(--panel);
  border-top: 1px solid var(--line);
  padding: 8px 12px calc(10px + var(--safe-bottom));
}
.row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.row + .row { margin-top: 8px; }
.shape-picker, .actions { display: flex; gap: 6px; }
.shape-btn {
  width: 44px;
  height: 34px;
  border-radius: 9px;
  background: var(--panel-2);
  color: var(--text);
  font-size: 16px;
}
.shape-btn:active { background: #3a3a3c; }

.palette { display: flex; gap: 8px; align-items: center; }
.palette.disabled { opacity: 0.35; pointer-events: none; }
.swatch {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
}
.swatch.light { box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25); }
.swatch.active { box-shadow: 0 0 0 2.5px var(--panel), 0 0 0 4px currentColor; }
.hint { font-size: 11px; color: var(--muted); }

.toast {
  position: fixed;
  left: 50%;
  bottom: calc(120px + var(--safe-bottom));
  transform: translate(-50%, 8px);
  max-width: 82vw;
  background: rgba(44, 44, 46, 0.96);
  color: var(--text);
  font-size: 13px;
  padding: 9px 14px;
  border-radius: 10px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.toast.show { opacity: 1; transform: translate(-50%, 0); }
```

- [ ] **Step 4: 运行测试并截图核对**

Run: `node --test tests/markup.test.js`
Expected: PASS，2 个测试通过

```bash
node server.mjs . 4173
```

另一个终端（或同一终端另起任务）：

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=2000 --window-size=390,844 --screenshot=".superpowers/shots/01-empty.png" "http://localhost:4173/"
```

用 `read_image` 看截图：应看到黑色画布区 + "选一张要改的图" + 蓝色"选择图片"按钮，底部工具条此时隐藏。

- [ ] **Step 5: 提交**

```bash
git add index.html src/styles.css tests/markup.test.js
git commit -m "feat: 页面骨架与移动端样式"
```

---

### Task 6: 视图渲染 view.js

**Files:**
- Create: `src/view.js`
- Create: `dev/preview.html`

- [ ] **Step 1: 写视图模块**

`src/view.js`：

```js
import { containRect, shapeGeometry, hexToRgba, textColorFor } from './shapes.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function createView({ stage, frame, img, svg, overlay }) {
  let display = { w: 1, h: 1 };
  let lastState = { shapes: [], selectedId: null };

  function fit() {
    if (!img.naturalWidth) return;
    const box = containRect(img.naturalWidth, img.naturalHeight, stage.clientWidth, stage.clientHeight);
    frame.style.width = `${box.w}px`;
    frame.style.height = `${box.h}px`;
    display = { w: box.w, h: box.h };
  }

  function setImage(url) {
    return new Promise((resolve, reject) => {
      img.onload = () => {
        fit();
        img.onload = null;
        img.onerror = null;
        resolve({ w: img.naturalWidth, h: img.naturalHeight });
      };
      img.onerror = () => {
        img.onload = null;
        img.onerror = null;
        reject(new Error('decode failed'));
      };
      img.src = url;
    });
  }

  function shapeElement(shape) {
    const g = shapeGeometry(shape);
    const el = document.createElementNS(SVG_NS, g.kind === 'triangle' ? 'polygon' : g.kind);
    if (g.kind === 'rect') {
      el.setAttribute('x', g.x);
      el.setAttribute('y', g.y);
      el.setAttribute('width', g.w);
      el.setAttribute('height', g.h);
    } else if (g.kind === 'ellipse') {
      el.setAttribute('cx', g.cx);
      el.setAttribute('cy', g.cy);
      el.setAttribute('rx', g.rx);
      el.setAttribute('ry', g.ry);
    } else {
      el.setAttribute('points', g.points.map(([x, y]) => `${x},${y}`).join(' '));
    }
    el.setAttribute('fill', hexToRgba(shape.color, 0.36));
    el.setAttribute('stroke', shape.color);
    el.setAttribute('stroke-width', '2');
    el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('vector-effect', 'non-scaling-stroke');
    el.setAttribute('class', 'shape');
    el.dataset.id = shape.id;
    return el;
  }

  function renderBadges(shapes) {
    const r = 8.5;
    shapes.forEach((shape, index) => {
      const el = document.createElement('span');
      el.className = 'badge';
      el.textContent = String(index + 1);
      el.style.background = shape.color;
      el.style.color = textColorFor(shape.color);
      const maxX = Math.max(r, display.w - r);
      const maxY = Math.max(r, display.h - r);
      el.style.left = `${Math.min(Math.max(shape.x * display.w, r), maxX)}px`;
      el.style.top = `${Math.min(Math.max(shape.y * display.h, r), maxY)}px`;
      overlay.append(el);
    });
  }

  function renderSelection(shape) {
    if (!shape) return;
    const box = document.createElement('div');
    box.className = 'sel-box';
    box.style.left = `${shape.x * 100}%`;
    box.style.top = `${shape.y * 100}%`;
    box.style.width = `${shape.w * 100}%`;
    box.style.height = `${shape.h * 100}%`;
    overlay.append(box);

    for (const dir of HANDLES) {
      const handle = document.createElement('div');
      handle.className = `handle handle-${dir}`;
      const cx = dir.includes('w') ? shape.x : dir.includes('e') ? shape.x + shape.w : shape.x + shape.w / 2;
      const cy = dir.includes('n') ? shape.y : dir.includes('s') ? shape.y + shape.h : shape.y + shape.h / 2;
      handle.style.left = `${cx * 100}%`;
      handle.style.top = `${cy * 100}%`;
      handle.dataset.handle = dir;
      overlay.append(handle);
    }
  }

  function render(state) {
    lastState = state;
    const selected = state.shapes.find((s) => s.id === state.selectedId) || null;
    svg.replaceChildren(...state.shapes.map(shapeElement));
    overlay.replaceChildren();
    renderBadges(state.shapes);
    renderSelection(selected);
  }

  new ResizeObserver(() => {
    fit();
    render(lastState);
  }).observe(stage);

  return { fit, setImage, render, display: () => display };
}
```

- [ ] **Step 2: 写预览床**

`dev/preview.html`（只用于截图核对，不是产品页面）：

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/src/styles.css">
<style>
  body { background: #000; }
  .stage { height: 100vh; }
  .frame { outline: 1px solid #333; }
</style>
</head>
<body>
<main id="stage" class="stage">
  <div id="frame" class="frame">
    <img id="photo" alt="">
    <svg id="shapes" class="shapes" viewBox="0 0 100 100" preserveAspectRatio="none"></svg>
    <div id="overlay" class="overlay"></div>
  </div>
</main>
<script type="module">
  import { createView } from '/src/view.js';

  const photo = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#b9dcf5"/><stop offset="0.52" stop-color="#e8f4ff"/>
    </linearGradient></defs>
    <rect width="1600" height="1200" fill="url(#sky)"/>
    <circle cx="360" cy="260" r="110" fill="#ffd166"/>
    <ellipse cx="300" cy="900" rx="520" ry="300" fill="#8fae7a"/>
    <ellipse cx="1350" cy="960" rx="560" ry="300" fill="#6f9160"/>
    <rect y="960" width="1600" height="240" fill="#5d7a4d"/>
    <text x="60" y="1140" font-family="sans-serif" font-size="48" fill="#e8f4ff" opacity="0.55">preview photo 1600×1200</text>
  </svg>`;

  const img = document.getElementById('photo');
  const view = createView({
    stage: document.getElementById('stage'),
    frame: document.getElementById('frame'),
    img,
    svg: document.getElementById('shapes'),
    overlay: document.getElementById('overlay'),
  });

  const shapes = [
    { id: 's_1', type: 'rect', x: 0.08, y: 0.18, w: 0.3, h: 0.3, color: '#FF3B30' },
    { id: 's_2', type: 'ellipse', x: 0.55, y: 0.12, w: 0.28, h: 0.34, color: '#0A84FF' },
    { id: 's_3', type: 'triangle', x: 0.34, y: 0.52, w: 0.32, h: 0.34, color: '#34C759' },
  ];

  await view.setImage(`data:image/svg+xml;utf8,${encodeURIComponent(photo)}`);
  new ResizeObserver(() => view.render({ shapes, selectedId: 's_2' })).observe(document.getElementById('stage'));
  view.render({ shapes, selectedId: 's_2' });
</script>
</body>
</html>
```

- [ ] **Step 3: 截图核对渲染**

```bash
node server.mjs . 4173
```

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=3000 --window-size=390,844 --screenshot=".superpowers/shots/02-preview.png" "http://localhost:4173/dev/preview.html"
```

用 `read_image` 看截图：应看到照片上三个半透明色块（红矩形、蓝椭圆、绿三角），左上角各有编号徽标 1/2/3，蓝椭圆外有白色虚线框与 8 个白底蓝边控制点，四边中点与四角各一个。

- [ ] **Step 4: 提交**

```bash
git add src/view.js dev/preview.html
git commit -m "feat: SVG 形状与选中控制点渲染"
```

---

### Task 7: 手势 gestures.js

**Files:**
- Create: `src/gestures.js`

- [ ] **Step 1: 写实现**

`src/gestures.js`：

```js
import { MIN_PX, moveRect, resizeRect, lockAspect } from './shapes.js';

const DRAG_THRESHOLD = 4;

export function attachGestures({ stage, frame, svg, overlay, store }) {
  let gesture = null;

  function begin(event, mode, id, handle) {
    const shape = store.get().shapes.find((s) => s.id === id);
    if (!shape) return;
    gesture = {
      mode,
      id,
      handle,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      before: store.beginEdit(),
      origin: { ...shape },
    };
    stage.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  svg.addEventListener('pointerdown', (event) => {
    const el = event.target.closest('.shape');
    if (!el) {
      store.select(null);
      return;
    }
    event.stopPropagation();
    store.select(el.dataset.id);
    begin(event, 'move', el.dataset.id);
  });

  overlay.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('.handle');
    if (!handle) return;
    event.stopPropagation();
    const id = store.get().selectedId;
    if (id) begin(event, 'resize', id, handle.dataset.handle);
  });

  stage.addEventListener('pointerdown', (event) => {
    if (!frame.contains(event.target)) store.select(null);
  });

  stage.addEventListener('pointermove', (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const dxPx = event.clientX - gesture.startX;
    const dyPx = event.clientY - gesture.startY;
    if (!gesture.moved && Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD) return;
    gesture.moved = true;

    const rect = frame.getBoundingClientRect();
    const dx = dxPx / rect.width;
    const dy = dyPx / rect.height;

    let next;
    if (gesture.mode === 'move') {
      next = moveRect(gesture.origin, dx, dy);
    } else {
      next = resizeRect(gesture.origin, gesture.handle, dx, dy, MIN_PX / rect.width, MIN_PX / rect.height);
      if (event.shiftKey && gesture.handle.length === 2) {
        next = lockAspect(next, gesture.origin, gesture.handle, rect.width, rect.height);
      }
    }
    store.updateShape(gesture.id, next);
  });

  function finish(event) {
    if (!gesture || (event && event.pointerId !== gesture.pointerId)) return;
    if (gesture.moved) store.endEdit(gesture.before);
    if (stage.hasPointerCapture(gesture.pointerId)) stage.releasePointerCapture(gesture.pointerId);
    gesture = null;
  }

  stage.addEventListener('pointerup', finish);
  stage.addEventListener('pointercancel', finish);
}
```

- [ ] **Step 2: 手工验证手势**

```bash
node server.mjs . 4173
```

浏览器打开 http://localhost:4173/dev/preview.html —— 预览床不接手势，这一步验证要等 Task 8 接上主流程。此处先用 `node --check` 确认语法：

Run: `node --check src/gestures.js`
Expected: 无输出（语法通过）

- [ ] **Step 3: 提交**

```bash
git add src/gestures.js
git commit -m "feat: 点选、拖动与八向拉伸手势"
```

---

### Task 8: 工具栏与主流程接线

**Files:**
- Create: `src/ui.js`
- Create: `src/main.js`

- [ ] **Step 1: 写 UI 模块**

`src/ui.js`：

```js
import { PALETTE } from './shapes.js';

let toastTimer = null;

export function toast(message, ms = 2200) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export function createUI({ store, els, onChooseImage, onExport }) {
  const { count, palette, hint, undo, redo, del, exportBtn } = els;

  palette.replaceChildren(
    ...PALETTE.map((color) => {
      const btn = document.createElement('button');
      btn.className = `swatch${color === '#FFFFFF' ? ' light' : ''}`;
      btn.style.background = color;
      btn.style.color = color;
      btn.dataset.color = color;
      btn.setAttribute('aria-label', `颜色 ${color}`);
      return btn;
    }),
  );

  for (const btn of els.shapeButtons) {
    btn.addEventListener('click', () => store.addShape(btn.dataset.add));
  }
  undo.addEventListener('click', () => store.undo());
  redo.addEventListener('click', () => store.redo());
  del.addEventListener('click', () => store.deleteSelected());
  exportBtn.addEventListener('click', onExport);
  palette.addEventListener('click', (event) => {
    const swatch = event.target.closest('.swatch');
    if (swatch) store.setColor(swatch.dataset.color);
  });
  els.imageBtn.addEventListener('click', () => onChooseImage('library'));
  els.pickBtn.addEventListener('click', () => onChooseImage('library'));
  els.cameraBtn.addEventListener('click', () => onChooseImage('camera'));

  function render(state) {
    const selected = state.shapes.find((s) => s.id === state.selectedId) || null;
    count.textContent = `${state.shapes.length} 个标注`;
    undo.disabled = !store.canUndo();
    redo.disabled = !store.canRedo();
    del.disabled = !selected;
    exportBtn.disabled = !state.image || state.shapes.length === 0;
    hint.textContent = selected ? '拖边单向拉伸 · 拖角自由变形' : '选中色块后可改色';
    palette.classList.toggle('disabled', !selected);
    for (const swatch of palette.children) {
      swatch.classList.toggle('active', !!selected && swatch.dataset.color === selected.color);
    }
  }

  return { render };
}
```

- [ ] **Step 2: 写主流程**

`src/main.js`：

```js
import { createStore } from './state.js';
import { createView } from './view.js';
import { attachGestures } from './gestures.js';
import { createUI, toast } from './ui.js';
import { exportPng, shareOrDownload, exportFilename } from './export.js';

const $ = (id) => document.getElementById(id);

const els = {
  stage: $('stage'),
  frame: $('frame'),
  photo: $('photo'),
  shapes: $('shapes'),
  overlay: $('overlay'),
  empty: $('empty'),
  toolbar: $('toolbar'),
  spinner: $('spinner'),
  count: $('count'),
  palette: $('palette'),
  hint: $('hint'),
  undo: $('btn-undo'),
  redo: $('btn-redo'),
  del: $('btn-delete'),
  exportBtn: $('btn-export'),
  imageBtn: $('btn-image'),
  pickBtn: $('btn-pick'),
  cameraBtn: $('btn-camera'),
  file: $('file'),
  fileCamera: $('file-camera'),
  shapeButtons: document.querySelectorAll('[data-add]'),
};

const store = createStore();
const view = createView(els);
attachGestures({ stage: els.stage, frame: els.frame, svg: els.shapes, overlay: els.overlay, store });
const ui = createUI({ store, els, onChooseImage: chooseImage, onExport: saveImage });

store.subscribe((state) => {
  view.render(state);
  ui.render(state);
});
view.render(store.get());
ui.render(store.get());

let objectUrl = null;

function chooseImage(kind) {
  const { shapes } = store.get();
  if (shapes.length && !window.confirm('换图会清空当前标注，继续？')) return;
  (kind === 'camera' ? els.fileCamera : els.file).click();
}

async function loadFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    toast('只支持图片文件');
    return;
  }
  els.spinner.hidden = false;
  try {
    const url = URL.createObjectURL(file);
    const size = await view.setImage(url);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = url;
    els.empty.hidden = true;
    els.frame.hidden = false;
    els.toolbar.hidden = false;
    store.setImage({ url, w: size.w, h: size.h });
  } catch {
    toast('这张图打不开，换一张试试');
  } finally {
    els.spinner.hidden = true;
    els.file.value = '';
    els.fileCamera.value = '';
  }
}

els.file.addEventListener('change', () => loadFile(els.file.files[0]));
els.fileCamera.addEventListener('change', () => loadFile(els.fileCamera.files[0]));

async function saveImage() {
  const { image, shapes } = store.get();
  if (!image || !shapes.length) return;
  els.exportBtn.disabled = true;
  try {
    const { blob, W, H, scaled } = await exportPng(els.photo, shapes);
    if (scaled) toast(`图片较大，已按 ${Math.max(W, H)} 边长导出`);
    await shareOrDownload(blob, exportFilename());
  } catch (err) {
    console.error(err);
    toast('导出失败，请重试');
  } finally {
    ui.render(store.get());
  }
}

window.addEventListener('beforeunload', (event) => {
  if (store.get().shapes.length) {
    event.preventDefault();
    event.returnValue = '';
  }
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
```

- [ ] **Step 3: 语法与测试**

Run: `node --check src/ui.js; node --check src/main.js; node --test tests/`
Expected: 语法无输出；全部测试 PASS

- [ ] **Step 4: 手工验证完整流程（桌面）**

```bash
node server.mjs . 4173
```

1. 打开 http://localhost:4173 ，点"选择图片"选一张本地照片
2. 点 `▭ ◯ △` 各一次 → 出现三个色块，计数显示"3 个标注"
3. 拖动矩形移动；拖圆的右边缘看是否只变宽；拖三角的角看是否同时变宽高
4. 点色板换色；`↶` 撤销回到上一步；`🗑` 删除后编号连续
5. 点"导出"→ 下载 PNG，用图片查看器打开，核对色块位置与原图一致

截图核对编辑态：

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=3000 --window-size=390,844 --screenshot=".superpowers/shots/03-editor.png" "http://localhost:4173/"
```

（此时页面是空状态；要截带色块的编辑态请用 `dev/preview.html`，或按上面的手工步骤在真浏览器里截图。）

- [ ] **Step 5: 提交**

```bash
git add src/ui.js src/main.js
git commit -m "feat: 工具栏、选图与导出流程接线"
```

---

### Task 9: PWA 清单、图标与离线缓存

**Files:**
- Create: `manifest.webmanifest`
- Create: `sw.js`
- Create: `scripts/make-icons.py`
- Create: `icons/icon-192.png` `icons/icon-512.png` `icons/apple-touch-icon.png`（由脚本生成）

- [ ] **Step 1: 写清单与 Service Worker**

`manifest.webmanifest`：

```json
{
  "name": "色块标注",
  "short_name": "色块标注",
  "description": "在图片上框出需要 AI 修改的区域，导出带编号的标注图",
  "lang": "zh-CN",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#111112",
  "theme_color": "#111112",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

`sw.js`：

```js
const CACHE = 'blockmark-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/src/styles.css',
  '/src/main.js',
  '/src/ui.js',
  '/src/state.js',
  '/src/shapes.js',
  '/src/view.js',
  '/src/gestures.js',
  '/src/export.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
      return response;
    }).catch(() => caches.match('/index.html'))),
  );
});
```

- [ ] **Step 2: 写图标脚本并生成**

`scripts/make-icons.py`：

```python
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
OUT.mkdir(exist_ok=True)


def icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = int(size * 0.22)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=(17, 17, 18, 255))

    w = max(2, int(size * 0.014))
    red = (255, 59, 48, 255)
    blue = (10, 132, 255, 255)
    green = (52, 199, 89, 255)
    fill_alpha = 150

    d.rounded_rectangle(
        [size * 0.15, size * 0.17, size * 0.46, size * 0.48],
        radius=int(size * 0.035),
        fill=(*red[:3], fill_alpha),
        outline=red,
        width=w,
    )
    d.ellipse(
        [size * 0.54, size * 0.14, size * 0.85, size * 0.45],
        fill=(*blue[:3], fill_alpha),
        outline=blue,
        width=w,
    )
    tri = [(size * 0.5, size * 0.55), (size * 0.73, size * 0.87), (size * 0.27, size * 0.87)]
    d.polygon(tri, fill=(*green[:3], fill_alpha))
    d.line(tri + [tri[0]], fill=green, width=w, joint="curve")
    return img


for size, name in [(192, "icon-192.png"), (512, "icon-512.png"), (180, "apple-touch-icon.png")]:
    icon(size).save(OUT / name)
    print("wrote", OUT / name)
```

Run: `python scripts/make-icons.py`
Expected: 输出三行 `wrote …icons/…png`

- [ ] **Step 3: 验证离线与安装**

```bash
node server.mjs . 4173
```

1. Chrome 打开 http://localhost:4173 → DevTools → Application → Manifest 能看到"色块标注"与两个图标
2. Application → Service Workers 显示已激活
3. 勾选 Offline → 刷新页面仍能打开
4. 地址栏出现安装按钮（localhost 属于安全上下文）

- [ ] **Step 4: 提交**

```bash
git add manifest.webmanifest sw.js scripts/make-icons.py icons
git commit -m "feat: PWA 清单、图标与离线缓存"
```

---

### Task 10: 收尾、README 与整体验收

**Files:**
- Create: `README.md`
- Modify: `index.html`（如截图发现间距问题）

- [ ] **Step 1: 写 README**

`README.md`：

```markdown
# 色块标注（BlockMark）

在手机上把图片里"需要 AI 修改的区域"框出来，导出一张带半透明色块和编号的 PNG，
发给会看图的 AI（GPT-Image、Nano Banana、即梦等）作为区域提示。

## 跑起来

```bash
node server.mjs . 4173
```

打开 http://localhost:4173 。手机与电脑在同一 Wi-Fi 时，用终端打印的"手机"地址打开。

零依赖：不需要 `npm install`，没有构建步骤。

## 测试

```bash
node --test tests/
```

## 用法

1. 选择图片或拍照
2. 点 `▭ ◯ △` 添加色块，拖边单向拉伸、拖角自由变形（桌面按住 Shift 锁等比）
3. 点色板换色，`↶ ↷` 撤销重做，`🗑` 删除
4. 点"导出"得到原图像素的 PNG（超大图自动降到 4096 长边）

## 已知限制

- iOS 上保存图片走系统分享面板（"存储图像"），这是网页版的限制
- 离线缓存与"安装到主屏幕"需要 HTTPS 或 localhost；手机通过局域网 HTTP 打开时功能正常，但不会注册 Service Worker
- 不做自动保存：刷新或关闭前会弹确认
- 导出仅支持 PNG 标注图，不含黑白遮罩

## 结构

- `src/shapes.js` 纯几何与颜色
- `src/state.js` 状态、编号、撤销
- `src/view.js` 图片适配与 SVG 渲染
- `src/gestures.js` 指针手势
- `src/export.js` 导出
- `server.mjs` 零依赖静态服务器
```

- [ ] **Step 2: 跑全量测试**

Run: `node --test tests/`
Expected: 全部 PASS（约 30 个断言组）

- [ ] **Step 3: 整体截图验收**

```bash
node server.mjs . 4173
```

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=3000 --window-size=390,844 --screenshot=".superpowers/shots/04-final.png" "http://localhost:4173/dev/preview.html"
```

用 `read_image` 对照设计稿：三种形状、半透明、编号徽标在左上角、选中态虚线框 + 8 控制点。

- [ ] **Step 4: 提交**

```bash
git add README.md index.html
git commit -m "docs: README 与验收记录"
```

---

## 交付前的自查清单

- [ ] `node --test tests/` 全绿
- [ ] `node server.mjs . 4173` 能打开，空状态正常
- [ ] 三种形状都能添加、移动、单向拉伸、自由变形
- [ ] 删除中间色块后编号连续；撤销 20 步不出错
- [ ] 导出 PNG 与原图分辨率一致、位置对齐、无界面元素
- [ ] 超大图导出有降级提示
- [ ] 手机真机走一遍全流程（用户执行）
- [ ] PWA 在 localhost 下可离线、可安装

## 与设计文档的对应关系

| 设计文档章节 | 实现位置 |
| --- | --- |
| §5 界面 | Task 5（HTML/CSS）、Task 8（状态联动） |
| §6 形状与几何 | Task 2（shapes.js）、Task 7（手势） |
| §7 颜色 | Task 2（PALETTE）、Task 8（色板） |
| §8 编号徽标 | Task 4（导出绘制）、Task 6（屏幕渲染） |
| §9 导出 | Task 4 |
| §10 状态与撤销 | Task 3 |
| §11 错误处理 | Task 8（toast/confirm）、Task 4（导出失败） |
| §12 技术方案 | Task 1/5/6/7/9 |
| §13 测试与验收 | 各 Task 的测试 + Task 10 |
