import test from 'node:test';
import assert from 'node:assert/strict';
import {
  homographyOf, project, quadOf, bboxOfQuad, moveShape, resizeShape,
  withCorner, isSimpleQuad, deformedOutline, auxPoint,
} from '../src/shapes.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const trapezoid = [[0.1, 0.1], [0.9, 0.1], [1, 0.5], [0, 0.5]];
const shape = { id: 's_1', type: 'rect', x: 0.2, y: 0.2, w: 0.4, h: 0.3, color: '#FF3B30' };

test('单应变换把单位方块的四个角映射到四边形四角', () => {
  const H = homographyOf(trapezoid);
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
  corners.forEach(([u, v], i) => {
    const [x, y] = project(H, u, v);
    assert.ok(near(x, trapezoid[i][0], 1e-9), `第 ${i} 个角 x: ${x}`);
    assert.ok(near(y, trapezoid[i][1], 1e-9), `第 ${i} 个角 y: ${y}`);
  });
});

test('平行四边形（仿射）也能正确映射', () => {
  const para = [[0.1, 0.2], [0.5, 0.1], [0.9, 0.5], [0.5, 0.6]];
  const H = homographyOf(para);
  const [x, y] = project(H, 0.5, 0.5);
  const cx = (para[0][0] + para[1][0] + para[2][0] + para[3][0]) / 4;
  const cy = (para[0][1] + para[1][1] + para[2][1] + para[3][1]) / 4;
  assert.ok(near(x, cx, 1e-9));
  assert.ok(near(y, cy, 1e-9));
});

test('没有 quad 时兜底成外接框的四角', () => {
  assert.deepEqual(quadOf(shape), [
    [0.2, 0.2], [0.6, 0.2], [0.6, 0.5], [0.2, 0.5],
  ]);
});

test('bboxOfQuad 取四点包围盒', () => {
  const box = bboxOfQuad([[0.3, 0.1], [0.9, 0.2], [0.7, 0.8], [0.1, 0.6]]);
  assert.ok(near(box.x, 0.1));
  assert.ok(near(box.y, 0.1));
  assert.ok(near(box.w, 0.8));
  assert.ok(near(box.h, 0.7));
});

test('移动形状时四边形跟着走', () => {
  const deformed = { ...shape, quad: quadOf(shape) };
  const moved = moveShape(deformed, 0.1, 0.2);
  assert.ok(near(moved.x, 0.3));
  assert.ok(near(moved.y, 0.4));
  assert.ok(near(moved.quad[0][0], 0.3));
  assert.ok(near(moved.quad[0][1], 0.4));
});

test('拉伸形状时四边形按比例变形', () => {
  const deformed = { ...shape, quad: quadOf(shape) };
  const wider = resizeShape(deformed, 'e', 0.2, 0, 0.02, 0.02);
  assert.ok(near(wider.w, 0.6));
  assert.deepEqual(wider.quad[1], [0.8, 0.2]);
});

test('拖动单个角点会重算包围盒', () => {
  const deformed = { ...shape, quad: quadOf(shape) };
  const next = withCorner(deformed, 2, [0.8, 0.7]);
  assert.deepEqual(next.quad[2], [0.8, 0.7]);
  assert.ok(near(next.x, 0.2));
  assert.ok(near(next.y, 0.2));
  assert.ok(near(next.w, 0.6));
  assert.ok(near(next.h, 0.5));
});

test('角点被夹在图片范围内', () => {
  const deformed = { ...shape, quad: quadOf(shape) };
  const next = withCorner(deformed, 0, [-0.5, 1.5]);
  assert.deepEqual(next.quad[0], [0, 1]);
});

test('交叉成蝴蝶结的四边形被拒绝', () => {
  assert.equal(isSimpleQuad([[0.1, 0.1], [0.9, 0.9], [0.9, 0.1], [0.1, 0.9]]), false);
  assert.equal(isSimpleQuad(trapezoid), true);
  assert.equal(isSimpleQuad([[0.1, 0.1], [0.9, 0.1], [0.5, 0.3], [0.1, 0.9]]), true);
});

test('变形后的圆和三角按四边形重采样', () => {
  const ellipse = { ...shape, type: 'ellipse', quad: trapezoid };
  const outline = deformedOutline(ellipse);
  assert.equal(outline.length, 64);
  const box = bboxOfQuad(outline);
  assert.ok(box.w <= 0.9 + 1e-9 && box.h <= 0.4 + 1e-9);

  const triangle = { ...shape, type: 'triangle', quad: trapezoid };
  const tri = deformedOutline(triangle);
  assert.equal(tri.length, 3);
  assert.ok(near(tri[0][0], 0.5, 1e-9));
});

test('没有 quad 时不走重采样', () => {
  assert.equal(deformedOutline(shape), null);
});

test('辅助点默认浮在角的外侧', () => {
  const box = { minX: 0, minY: 0, maxX: 400, maxY: 400 };
  const [x, y] = auxPoint([100, 100], [200, 200], box);
  assert.ok(x < 100 && y < 100, '应该往左上外侧走');
  assert.ok(Math.hypot(x - 100, y - 100) > 40);
});

test('靠边放不下时辅助点翻到内侧', () => {
  const box = { minX: 0, minY: 0, maxX: 400, maxY: 400 };
  const [x, y] = auxPoint([10, 10], [100, 100], box);
  assert.ok(x > 10 && y > 10, '应该翻到内侧');
});

test('辅助点始终落在可视范围内', () => {
  const box = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const [x, y] = auxPoint([5, 5], [50, 50], box, 200, 36);
  assert.ok(x >= 0 && x <= 100);
  assert.ok(y >= 0 && y <= 100);
});
