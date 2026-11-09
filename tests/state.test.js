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
  assert.equal(s.canUndo(), true);
});

test('换图清空形状与历史', () => {
  const s = createStore();
  s.addShape('rect');
  s.setImage({ url: 'blob:x', w: 100, h: 100 });
  assert.equal(s.get().shapes.length, 0);
  assert.equal(s.canUndo(), false);
  assert.equal(s.get().image.url, 'blob:x');
});

test('进入变形模式会给形状补上四角数据', () => {
  const s = createStore();
  s.addShape('rect');
  s.setDeformMode(true);
  const shape = s.get().shapes[0];
  assert.equal(shape.quad.length, 4);
  assert.deepEqual(shape.quad[0], [0.35, 0.35]);
  assert.equal(s.get().deformMode, true);
});

test('切换选中会退出变形模式', () => {
  const s = createStore();
  s.addShape('rect');
  s.addShape('ellipse');
  s.setDeformMode(true);
  s.select('s_1');
  assert.equal(s.get().deformMode, false);
});

test('角点拖动可以撤销回拖动前', () => {
  const s = createStore();
  s.addShape('rect');
  s.setDeformMode(true);
  const before = s.beginEdit();
  s.updateShape('s_1', { x: 0.2, y: 0.2, w: 0.6, h: 0.5, quad: [[0.2, 0.2], [0.6, 0.2], [0.8, 0.7], [0.2, 0.5]] });
  s.endEdit(before);
  assert.equal(s.get().shapes[0].quad[2][0], 0.8);
  s.undo();
  assert.deepEqual(s.get().shapes[0].quad[2], [0.65, 0.65]);
});

test('复位清掉四边形且可撤销', () => {
  const s = createStore();
  s.addShape('rect');
  s.setDeformMode(true);
  const before = s.beginEdit();
  s.updateShape('s_1', { x: 0.2, y: 0.2, w: 0.6, h: 0.5, quad: [[0.2, 0.2], [0.6, 0.2], [0.8, 0.7], [0.2, 0.5]] });
  s.endEdit(before);
  s.resetQuad();
  assert.equal(s.get().shapes[0].quad, undefined);
  assert.equal(s.get().deformMode, false);
  s.undo();
  assert.ok(s.get().shapes[0].quad);
});
