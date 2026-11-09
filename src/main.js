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
  btnDeform: $('btn-deform'),
  btnReset: $('btn-reset'),
  exportBtn: $('btn-export'),
  imageBtn: $('btn-image'),
  pickBtn: $('btn-pick'),
  cameraBtn: $('btn-camera'),
  file: $('file'),
  fileCamera: $('file-camera'),
  shapeButtons: document.querySelectorAll('[data-add]'),
};

const store = createStore();
const view = createView({
  stage: els.stage,
  frame: els.frame,
  img: els.photo,
  svg: els.shapes,
  overlay: els.overlay,
});
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

async function applyImage(url) {
  els.spinner.hidden = false;
  try {
    const size = await view.setImage(url);
    els.empty.hidden = true;
    els.frame.hidden = false;
    els.toolbar.hidden = false;
    store.setImage({ url, w: size.w, h: size.h });
    return true;
  } catch {
    toast('这张图打不开，换一张试试');
    return false;
  } finally {
    els.spinner.hidden = true;
  }
}

async function loadFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    toast('只支持图片文件');
    return;
  }
  const url = URL.createObjectURL(file);
  const ok = await applyImage(url);
  if (ok) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = url;
  } else {
    URL.revokeObjectURL(url);
  }
  els.file.value = '';
  els.fileCamera.value = '';
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

const DEMO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#b9dcf5"/><stop offset="0.52" stop-color="#e8f4ff"/>
  </linearGradient></defs>
  <rect width="1600" height="1200" fill="url(#sky)"/>
  <circle cx="360" cy="260" r="110" fill="#ffd166"/>
  <ellipse cx="300" cy="900" rx="520" ry="300" fill="#8fae7a"/>
  <ellipse cx="1350" cy="960" rx="560" ry="300" fill="#6f9160"/>
  <rect y="960" width="1600" height="240" fill="#5d7a4d"/>
  <text x="60" y="1140" font-family="sans-serif" font-size="48" fill="#e8f4ff" opacity="0.55">demo 1600×1200</text>
</svg>`;

async function loadDemo() {
  const ok = await applyImage(`data:image/svg+xml;utf8,${encodeURIComponent(DEMO_SVG)}`);
  if (!ok) return;
  store.addShape('rect');
  store.addShape('ellipse');
  store.addShape('triangle');
  store.updateShape('s_1', { x: 0.08, y: 0.18, w: 0.3, h: 0.3 });
  store.updateShape('s_2', { x: 0.55, y: 0.12, w: 0.28, h: 0.34 });
  store.updateShape('s_3', { x: 0.34, y: 0.52, w: 0.32, h: 0.34 });
  store.select('s_2');
}

window.__blockmark = {
  store,
  view,
  els,
  exportPng: (shapes = store.get().shapes) => exportPng(els.photo, shapes),
};

if (new URLSearchParams(location.search).has('demo')) loadDemo();
