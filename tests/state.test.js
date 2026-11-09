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
