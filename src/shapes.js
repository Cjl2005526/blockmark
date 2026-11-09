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

export const ELLIPSE_STEPS = 64;

const UNIT_ELLIPSE = Array.from({ length: ELLIPSE_STEPS }, (_, i) => {
  const t = (i / ELLIPSE_STEPS) * Math.PI * 2;
  return [0.5 + 0.5 * Math.cos(t), 0.5 + 0.5 * Math.sin(t)];
});

export function quadOf(shape) {
  if (shape.quad) return shape.quad.map(([x, y]) => [x, y]);
  const right = round6(shape.x + shape.w);
  const bottom = round6(shape.y + shape.h);
  return [
    [shape.x, shape.y],
    [right, shape.y],
    [right, bottom],
    [shape.x, bottom],
  ];
}

export function bboxOfQuad(quad) {
  const xs = quad.map((p) => p[0]);
  const ys = quad.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x: round6(x),
    y: round6(y),
    w: round6(Math.max(...xs) - x),
    h: round6(Math.max(...ys) - y),
  };
}

export function homographyOf(quad) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  if ((Math.abs(dx3) < 1e-12 && Math.abs(dy3) < 1e-12) || Math.abs(den) < 1e-12) {
    return { a: x1 - x0, b: x3 - x0, c: x0, d: y1 - y0, e: y3 - y0, f: y0, g: 0, h: 0 };
  }
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const h = (dx1 * dy3 - dx3 * dy1) / den;
  return {
    a: x1 - x0 + g * x1,
    b: x3 - x0 + h * x3,
    c: x0,
    d: y1 - y0 + g * y1,
    e: y3 - y0 + h * y3,
    f: y0,
    g,
    h,
  };
}

export function project(matrix, u, v) {
  const den = matrix.g * u + matrix.h * v + 1;
  return [
    (matrix.a * u + matrix.b * v + matrix.c) / den,
    (matrix.d * u + matrix.e * v + matrix.f) / den,
  ];
}

export function moveShape(shape, dx, dy) {
  const moved = moveRect(shape, dx, dy);
  if (!shape.quad) return moved;
  const ox = moved.x - shape.x;
  const oy = moved.y - shape.y;
  return {
    ...moved,
    quad: shape.quad.map(([x, y]) => [round6(x + ox), round6(y + oy)]),
  };
}

export function withBox(shape, box) {
  if (!shape.quad) return box;
  const sx = box.w / shape.w;
  const sy = box.h / shape.h;
  return {
    ...box,
    quad: shape.quad.map(([x, y]) => [
      round6(box.x + (x - shape.x) * sx),
      round6(box.y + (y - shape.y) * sy),
    ]),
  };
}

export function resizeShape(shape, handle, dx, dy, minW, minH) {
  return withBox(shape, resizeRect(shape, handle, dx, dy, minW, minH));
}

export function withCorner(shape, index, point) {
  const quad = quadOf(shape);
  quad[index] = [round6(clamp(point[0], 0, 1)), round6(clamp(point[1], 0, 1))];
  return { ...shape, ...bboxOfQuad(quad), quad };
}

function cross(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function segmentsCross(a, b, c, d) {
  const d1 = cross(c[0], c[1], d[0], d[1], a[0], a[1]);
  const d2 = cross(c[0], c[1], d[0], d[1], b[0], b[1]);
  const d3 = cross(a[0], a[1], b[0], b[1], c[0], c[1]);
  const d4 = cross(a[0], a[1], b[0], b[1], d[0], d[1]);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function isSimpleQuad(quad) {
  if (segmentsCross(quad[0], quad[1], quad[2], quad[3])) return false;
  if (segmentsCross(quad[1], quad[2], quad[3], quad[0])) return false;
  return true;
}

export function deformedOutline(shape) {
  if (!shape.quad) return null;
  const matrix = homographyOf(shape.quad);
  if (shape.type === 'rect') return shape.quad.map(([x, y]) => [x, y]);
  if (shape.type === 'triangle') {
    return [[0.5, 0], [1, 1], [0, 1]].map(([u, v]) => project(matrix, u, v));
  }
  return UNIT_ELLIPSE.map(([u, v]) => project(matrix, u, v));
}

export function auxPoint(corner, center, box, outward = 48, inward = 36) {
  const dx = corner[0] - center[0];
  const dy = corner[1] - center[1];
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const margin = 8;
  const inside = (x, y) => x >= box.minX + margin
    && x <= box.maxX - margin
    && y >= box.minY + margin
    && y <= box.maxY - margin;

  let x = corner[0] + ux * outward;
  let y = corner[1] + uy * outward;
  if (!inside(x, y)) {
    x = corner[0] - ux * inward;
    y = corner[1] - uy * inward;
  }
  return [
    clamp(x, box.minX + 2, box.maxX - 2),
    clamp(y, box.minY + 2, box.maxY - 2),
  ];
}
