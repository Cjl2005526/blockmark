export const PALETTE = ['#FF3B30', '#0A84FF', '#34C759', '#FF9F0A', '#BF5AF2', '#FFFFFF'];
export const SHAPE_TYPES = ['rect', 'ellipse', 'triangle'];
export const DEFAULT_SIZE = 0.3;
export const MIN_PX = 28;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const round6 = (v) => Math.round(v * 1e6) / 1e6;

export function createShape(type, id, color) {
  const offset = (1 - DEFAULT_SIZE) / 2;
  return { id, type, x: offset, y: offset, w: DEFAULT_SIZE, h: DEFAULT_SIZE, color };
}

export function moveRect(rect, dx, dy) {
  return {
    ...rect,
    x: round6(clamp(rect.x + dx, 0, 1 - rect.w)),
    y: round6(clamp(rect.y + dy, 0, 1 - rect.h)),
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
  return {
    ...rect,
    x: round6(left),
    y: round6(top),
    w: round6(right - left),
    h: round6(bottom - top),
  };
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
  return { ...rect, x: round6(x), y: round6(y), w: round6(w), h: round6(h) };
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
