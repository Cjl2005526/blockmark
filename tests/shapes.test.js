import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PALETTE, createShape, moveRect, resizeRect, lockAspect,
  containRect, shapeGeometry, hexToRgba, textColorFor, BADGE_ALPHA, BADGE_TEXT_ALPHA,
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
  assert.equal(far.x, 0.6);
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
  assert.ok(Math.abs(r.h - 0.3) < 1e-9);
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

test('编号徽标也是半透明的', () => {
  assert.equal(BADGE_ALPHA, 0.7);
  assert.equal(hexToRgba('#FF3B30', BADGE_ALPHA), 'rgba(255,59,48,0.7)');
  assert.equal(textColorFor('#0A84FF', BADGE_TEXT_ALPHA), 'rgba(255,255,255,0.95)');
  assert.equal(textColorFor('#FFFFFF', BADGE_TEXT_ALPHA), 'rgba(29,29,31,0.95)');
});
