import {
  MIN_PX, moveShape, resizeShape, lockAspect, withCorner, withBox, isSimpleQuad,
} from './shapes.js';

const DRAG_THRESHOLD = 4;

export function attachGestures({ stage, frame, svg, overlay, store }) {
  let gesture = null;

  function begin(event, mode, id, handle, corner = -1) {
    const shape = store.get().shapes.find((s) => s.id === id);
    if (!shape) return;
    gesture = {
      mode,
      id,
      handle,
      corner,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      before: store.beginEdit(),
      origin: { ...shape },
    };
    stage.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  svg.addEventListener('pointerdown', (event) => {
    const el = event.target.closest('.shape');
    if (!el) {
      store.select(null);
      return;
    }
    event.stopPropagation();
    store.select(el.dataset.id);
    begin(event, 'move', el.dataset.id);
  });

  overlay.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('.handle');
    if (!handle) return;
    event.stopPropagation();
    const id = store.get().selectedId;
    if (!id) return;
    if (handle.classList.contains('corner')) {
      begin(event, 'deform', id, null, Number(handle.dataset.handle.slice(1)));
    } else {
      begin(event, 'resize', id, handle.dataset.handle);
    }
  });

  stage.addEventListener('pointerdown', (event) => {
    if (!frame.contains(event.target)) store.select(null);
  });

  stage.addEventListener('pointermove', (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const dxPx = event.clientX - gesture.startX;
    const dyPx = event.clientY - gesture.startY;
    if (!gesture.moved && Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD) return;
    gesture.moved = true;

    const rect = frame.getBoundingClientRect();
    const dx = dxPx / rect.width;
    const dy = dyPx / rect.height;

    if (gesture.mode === 'deform') {
      const point = [
        (event.clientX - rect.left) / rect.width,
        (event.clientY - rect.top) / rect.height,
      ];
      const next = withCorner(gesture.origin, gesture.corner, point);
      if (next.w * rect.width < MIN_PX || next.h * rect.height < MIN_PX) return;
      if (!isSimpleQuad(next.quad)) return;
      store.updateShape(gesture.id, next);
      return;
    }

    let next;
    if (gesture.mode === 'move') {
      next = moveShape(gesture.origin, dx, dy);
    } else {
      next = resizeShape(gesture.origin, gesture.handle, dx, dy, MIN_PX / rect.width, MIN_PX / rect.height);
      if (event.shiftKey && gesture.handle.length === 2) {
        const locked = lockAspect(next, gesture.origin, gesture.handle, rect.width, rect.height);
        next = withBox(gesture.origin, locked);
      }
    }
    store.updateShape(gesture.id, next);
  });

  function finish(event) {
    if (!gesture || (event && event.pointerId !== gesture.pointerId)) return;
    if (gesture.moved) store.endEdit(gesture.before);
    if (stage.hasPointerCapture(gesture.pointerId)) stage.releasePointerCapture(gesture.pointerId);
    gesture = null;
  }

  stage.addEventListener('pointerup', finish);
  stage.addEventListener('pointercancel', finish);
}
