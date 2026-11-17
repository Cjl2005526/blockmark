import {
  shapeGeometry, hexToRgba, textColorFor, deformedOutline, BADGE_ALPHA, BADGE_TEXT_ALPHA,
} from './shapes.js';

export const MAX_EDGE = 4096;
export const MAX_AREA = 16777216;
export const FILL_ALPHA = 0.36;

export function computeOutputSize(imageW, imageH) {
  const k = Math.min(1, MAX_EDGE / Math.max(imageW, imageH), Math.sqrt(MAX_AREA / (imageW * imageH)));
  return {
    W: Math.max(1, Math.round(imageW * k)),
    H: Math.max(1, Math.round(imageH * k)),
    scaled: k < 1,
  };
}

export function exportGeometry(W, H) {
  const min = Math.min(W, H);
  return {
    stroke: Math.max(2, 0.0035 * min),
    badgeR: Math.min(64, Math.max(10, 0.022 * min)),
  };
}

export function badgePosition(shape, W, H, r) {
  return {
    cx: Math.min(Math.max(shape.x * W, r), W - r),
    cy: Math.min(Math.max(shape.y * H, r), H - r),
  };
}

export function exportFilename(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `标注_${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.png`;
}

export function tracePath(ctx, shape, W, H) {
  const g = shapeGeometry(shape);
  ctx.beginPath();
  if (g.kind === 'rect') {
    ctx.rect((g.x / 100) * W, (g.y / 100) * H, (g.w / 100) * W, (g.h / 100) * H);
  } else if (g.kind === 'ellipse') {
    ctx.ellipse((g.cx / 100) * W, (g.cy / 100) * H, (g.rx / 100) * W, (g.ry / 100) * H, 0, 0, Math.PI * 2);
  } else {
    g.points.forEach(([px, py], i) => {
      const x = (px / 100) * W;
      const y = (py / 100) * H;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
}

export function drawShapes(ctx, shapes, W, H) {
  if (!shapes.length) return;
  const { stroke, badgeR } = exportGeometry(W, H);
  shapes.forEach((shape, index) => {
    const outline = deformedOutline(shape);
    if (outline) {
      ctx.beginPath();
      outline.forEach(([u, v], i) => {
        const x = u * W;
        const y = v * H;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    } else {
      tracePath(ctx, shape, W, H);
    }
    ctx.fillStyle = hexToRgba(shape.color, FILL_ALPHA);
    ctx.fill();
    ctx.lineWidth = stroke + 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke();
    ctx.lineWidth = stroke;
    ctx.strokeStyle = shape.color;
    ctx.stroke();

    const { cx, cy } = badgePosition(shape, W, H, badgeR);
    ctx.beginPath();
    ctx.arc(cx, cy, badgeR, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(shape.color, BADGE_ALPHA);
    ctx.fill();
    ctx.fillStyle = textColorFor(shape.color, BADGE_TEXT_ALPHA);
    ctx.font = `700 ${badgeR * 1.1}px -apple-system, "PingFang SC", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), cx, cy + badgeR * 0.05);
  });
}

export async function exportPng(img, shapes) {
  const { W, H, scaled } = computeOutputSize(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(img, 0, 0, W, H);
  drawShapes(ctx, shapes, W, H);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('toBlob failed');
  return { blob, W, H, scaled };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

async function saveInNativeApp(blob, filename) {
  const capacitor = globalThis.Capacitor;
  const plugins = capacitor?.Plugins;
  if (!capacitor?.isNativePlatform?.() || !plugins?.Filesystem) return false;
  try {
    const data = await blobToBase64(blob);
    const saved = await plugins.Filesystem.writeFile({
      path: `blockmark/${filename}`,
      data,
      directory: 'CACHE',
      recursive: true,
    });
    if (plugins.Share?.share) {
      try {
        await plugins.Share.share({
          title: '标注图',
          files: [saved.uri],
          dialogTitle: '保存或分享标注图',
        });
      } catch {
        await plugins.Share.share({ title: '标注图', url: saved.uri });
      }
    }
    return true;
  } catch (err) {
    console.warn('native save failed', err);
    return false;
  }
}

export async function shareOrDownload(blob, filename) {
  if (await saveInNativeApp(blob, filename)) return 'native';
  const file = new File([blob], filename, { type: blob.type || 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: '标注图' });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
      throw err;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}
