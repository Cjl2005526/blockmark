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
  const r = computeOutputSize(6000, 4000);
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
