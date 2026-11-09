import {
  containRect, shapeGeometry, hexToRgba, textColorFor, quadOf, deformedOutline, auxPoint,
  BADGE_ALPHA, BADGE_TEXT_ALPHA,
} from './shapes.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function createView({ stage, frame, img, svg, overlay }) {
  let display = { w: 1, h: 1 };
  let lastState = { shapes: [], selectedId: null, deformMode: false };

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

  function styleShape(el, shape) {
    el.setAttribute('fill', hexToRgba(shape.color, 0.36));
    el.setAttribute('stroke', shape.color);
    el.setAttribute('stroke-width', '2');
    el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('vector-effect', 'non-scaling-stroke');
    el.setAttribute('class', 'shape');
    el.dataset.id = shape.id;
  }

  function shapeElement(shape) {
    const outline = deformedOutline(shape);
    if (outline) {
      const polygon = document.createElementNS(SVG_NS, 'polygon');
      polygon.setAttribute('points', outline.map(([x, y]) => `${x * 100},${y * 100}`).join(' '));
      styleShape(polygon, shape);
      return polygon;
    }

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
    styleShape(el, shape);
    return el;
  }

  function renderBadges(shapes, selectedId) {
    const r = 8.5;
    shapes.forEach((shape, index) => {
      if (shape.id === selectedId) return;
      const el = document.createElement('span');
      el.className = 'badge';
      el.textContent = String(index + 1);
      el.style.background = hexToRgba(shape.color, BADGE_ALPHA);
      el.style.color = textColorFor(shape.color, BADGE_TEXT_ALPHA);
      const maxX = Math.max(r, display.w - r);
      const maxY = Math.max(r, display.h - r);
      el.style.left = `${Math.min(Math.max(shape.x * display.w, r), maxX)}px`;
      el.style.top = `${Math.min(Math.max(shape.y * display.h, r), maxY)}px`;
      overlay.append(el);
    });
  }

  function auxBox() {
    const stageRect = stage.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const offsetX = frameRect.left - stageRect.left;
    const offsetY = frameRect.top - stageRect.top;
    return {
      minX: -offsetX + 4,
      minY: -offsetY + 4,
      maxX: stageRect.width - offsetX - 4,
      maxY: stageRect.height - offsetY - 4,
    };
  }

  function coarsePointer() {
    return window.matchMedia?.('(pointer: coarse)').matches ?? false;
  }

  function connector(from, to) {
    const sx = 100 / display.w;
    const sy = 100 / display.h;
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', from.x * sx);
    line.setAttribute('y1', from.y * sy);
    line.setAttribute('x2', to.x * sx);
    line.setAttribute('y2', to.y * sy);
    line.setAttribute('class', 'handle-line');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(line);
  }

  function placeHandle(truePx, centerPx, dataset, extraClass = '') {
    let { x, y } = truePx;
    const touch = coarsePointer();
    if (touch) {
      [x, y] = auxPoint([truePx.x, truePx.y], [centerPx.x, centerPx.y], auxBox());
      connector(truePx, { x, y });
    }
    const handle = document.createElement('div');
    handle.className = `handle${touch ? ' touch' : ''}${extraClass ? ` ${extraClass}` : ''}`;
    handle.style.left = `${x}px`;
    handle.style.top = `${y}px`;
    Object.assign(handle.dataset, dataset);
    overlay.append(handle);
  }

  function renderDeformSelection(shape) {
    const quad = quadOf(shape);
    const outline = document.createElementNS(SVG_NS, 'polygon');
    outline.setAttribute('points', quad.map(([x, y]) => `${x * 100},${y * 100}`).join(' '));
    outline.setAttribute('fill', 'none');
    outline.setAttribute('stroke', 'rgba(255,255,255,.92)');
    outline.setAttribute('stroke-width', '1.5');
    outline.setAttribute('stroke-dasharray', '6 5');
    outline.setAttribute('vector-effect', 'non-scaling-stroke');
    outline.setAttribute('class', 'sel-outline');
    svg.append(outline);

    const centerPx = {
      x: (quad.reduce((sum, [x]) => sum + x, 0) / quad.length) * display.w,
      y: (quad.reduce((sum, [, y]) => sum + y, 0) / quad.length) * display.h,
    };
    quad.forEach(([x, y], index) => {
      placeHandle(
        { x: x * display.w, y: y * display.h },
        centerPx,
        { handle: `c${index}` },
        'corner',
      );
    });
  }

  function renderSelection(shape) {
    if (!shape) return;
    const left = shape.x * display.w;
    const top = shape.y * display.h;
    const right = (shape.x + shape.w) * display.w;
    const bottom = (shape.y + shape.h) * display.h;

    const box = document.createElement('div');
    box.className = 'sel-box';
    box.style.left = `${shape.x * 100}%`;
    box.style.top = `${shape.y * 100}%`;
    box.style.width = `${shape.w * 100}%`;
    box.style.height = `${shape.h * 100}%`;
    overlay.append(box);

    const centerPx = { x: (left + right) / 2, y: (top + bottom) / 2 };
    for (const dir of HANDLES) {
      const x = dir.includes('w') ? left : dir.includes('e') ? right : centerPx.x;
      const y = dir.includes('n') ? top : dir.includes('s') ? bottom : centerPx.y;
      placeHandle({ x, y }, centerPx, { handle: dir }, `handle-${dir}`);
    }
  }

  function render(state) {
    lastState = state;
    const selected = state.shapes.find((s) => s.id === state.selectedId) || null;
    svg.replaceChildren(...state.shapes.map(shapeElement));
    overlay.replaceChildren();
    renderBadges(state.shapes, state.selectedId);
    if (selected && state.deformMode) renderDeformSelection(selected);
    else renderSelection(selected);
  }

  new ResizeObserver(() => {
    fit();
    render(lastState);
  }).observe(stage);

  return { fit, setImage, render, display: () => display };
}
