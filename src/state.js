import { PALETTE, createShape } from './shapes.js';

const MAX_HISTORY = 50;

export function createStore() {
  let seq = 0;
  let state = { image: null, shapes: [], selectedId: null, undo: [], redo: [] };
  const listeners = new Set();

  const emit = () => {
    for (const fn of listeners) fn(state);
  };
  const snapshot = () => ({
    shapes: structuredClone(state.shapes),
    selectedId: state.selectedId,
  });
  const pushUndo = (snap) => {
    state.undo.push(snap);
    if (state.undo.length > MAX_HISTORY) state.undo.shift();
    state.redo = [];
  };

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get() {
      return state;
    },
    setImage(image) {
      state = { image, shapes: [], selectedId: null, undo: [], redo: [] };
      emit();
    },
    addShape(type) {
      const before = snapshot();
      const id = `s_${++seq}`;
      const color = PALETTE[state.shapes.length % PALETTE.length];
      state.shapes = [...state.shapes, createShape(type, id, color)];
      state.selectedId = id;
      pushUndo(before);
      emit();
    },
    deleteSelected() {
      if (!state.selectedId) return;
      const before = snapshot();
      state.shapes = state.shapes.filter((s) => s.id !== state.selectedId);
      state.selectedId = null;
      pushUndo(before);
      emit();
    },
    setColor(color) {
      const shape = state.shapes.find((s) => s.id === state.selectedId);
      if (!shape || shape.color === color) return;
      const before = snapshot();
      shape.color = color;
      pushUndo(before);
      emit();
    },
    select(id) {
      if (state.selectedId === id) return;
      state.selectedId = id;
      emit();
    },
    beginEdit() {
      return snapshot();
    },
    updateShape(id, rect) {
      const shape = state.shapes.find((s) => s.id === id);
      if (!shape) return;
      Object.assign(shape, { x: rect.x, y: rect.y, w: rect.w, h: rect.h });
      emit();
    },
    endEdit(before) {
      if (JSON.stringify(before.shapes) === JSON.stringify(state.shapes)) return;
      pushUndo(before);
      emit();
    },
    undo() {
      const snap = state.undo.pop();
      if (!snap) return;
      state.redo.push(snapshot());
      state.shapes = snap.shapes;
      state.selectedId = snap.selectedId;
      emit();
    },
    redo() {
      const snap = state.redo.pop();
      if (!snap) return;
      state.undo.push(snapshot());
      state.shapes = snap.shapes;
      state.selectedId = snap.selectedId;
      emit();
    },
    canUndo() {
      return state.undo.length > 0;
    },
    canRedo() {
      return state.redo.length > 0;
    },
  };
}
