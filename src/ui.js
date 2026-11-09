import { PALETTE } from './shapes.js';

let toastTimer = null;

export function toast(message, ms = 2200) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export function createUI({ store, els, onChooseImage, onExport }) {
  const { count, palette, hint, undo, redo, del, exportBtn, btnDeform, btnReset } = els;

  palette.replaceChildren(
    ...PALETTE.map((color) => {
      const btn = document.createElement('button');
      btn.className = `swatch${color === '#FFFFFF' ? ' light' : ''}`;
      btn.style.background = color;
      btn.style.color = color;
      btn.dataset.color = color;
      btn.setAttribute('aria-label', `颜色 ${color}`);
      return btn;
    }),
  );

  for (const btn of els.shapeButtons) {
    btn.addEventListener('click', () => store.addShape(btn.dataset.add));
  }
  undo.addEventListener('click', () => store.undo());
  redo.addEventListener('click', () => store.redo());
  del.addEventListener('click', () => store.deleteSelected());
  exportBtn.addEventListener('click', onExport);
  btnDeform.addEventListener('click', () => store.setDeformMode(!store.get().deformMode));
  btnReset.addEventListener('click', () => store.resetQuad());
  palette.addEventListener('click', (event) => {
    const swatch = event.target.closest('.swatch');
    if (swatch) store.setColor(swatch.dataset.color);
  });
  els.imageBtn.addEventListener('click', () => onChooseImage('library'));
  els.pickBtn.addEventListener('click', () => onChooseImage('library'));
  els.cameraBtn.addEventListener('click', () => onChooseImage('camera'));

  function render(state) {
    const selected = state.shapes.find((s) => s.id === state.selectedId) || null;
    const index = selected ? state.shapes.indexOf(selected) + 1 : 0;
    const deforming = !!selected && state.deformMode;
    count.textContent = `${state.shapes.length} 个标注`;
    undo.disabled = !store.canUndo();
    redo.disabled = !store.canRedo();
    del.disabled = !selected;
    exportBtn.disabled = !state.image || state.shapes.length === 0;
    btnDeform.disabled = !selected;
    btnDeform.textContent = deforming ? '完成' : '变形';
    btnDeform.classList.toggle('active', deforming);
    btnReset.hidden = !(selected && selected.quad);
    hint.textContent = deforming
      ? '拖 4 个角自由变形 · 拖框内移动'
      : selected
        ? `${index} 号 · 拖边单向拉伸 · 拖角自由变形`
        : '选中色块后可改色';
    palette.classList.toggle('disabled', !selected);
    for (const swatch of palette.children) {
      swatch.classList.toggle('active', !!selected && swatch.dataset.color === selected.color);
    }
  }

  return { render };
}
