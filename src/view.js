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

  function renderBadges(shapes, selectedId) {
    const r = 8.5;
    shapes.forEach((shape, index) => {
      if (shape.id === selectedId) return;
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
    renderBadges(state.shapes, state.selectedId);
    renderSelection(selected);
  }

  new ResizeObserver(() => {
    fit();
    render(lastState);
  }).observe(stage);

  return { fit, setImage, render, display: () => display };
}
