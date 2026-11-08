// Quét video trong vùng khoanh để tìm lượt bỏ kiện, và lấy ảnh bằng chứng. Chạy trong trình duyệt.
import { seek } from './video.mjs';
import { boxBlur, changedFraction, detectEvents, refineEvents } from './core/motion.mjs';

const MAX_W = 160; // thu nhỏ vùng khoanh để quét nhanh

function grayOf(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return { w, h, data: g };
}

/**
 * roi: {x,y,w,h} pixel trên khung gốc. Trả {times, act, events}.
 * signal: AbortSignal để hủy. onProgress(doneS, totalS).
 */
export async function scanRange(video, roi, { startS = 0, endS = video.duration, fps = 12.5, onProgress, signal, opts } = {}) {
  const scale = Math.min(1, MAX_W / roi.w);
  const w = Math.max(8, Math.round(roi.w * scale)), h = Math.max(8, Math.round(roi.h * scale));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const times = [], act = [], grays = [];
  let prev = null;
  const dt = 1 / fps;
  for (let t = startS; t <= endS; t += dt) {
    if (signal?.aborted) throw new DOMException('Đã hủy', 'AbortError');
    await seek(video, Math.min(t, video.duration - 0.001), 5000, { waitFrame: false });
    const mt = t;
    ctx.drawImage(video, roi.x, roi.y, roi.w, roi.h, 0, 0, w, h);
    const g = boxBlur(grayOf(ctx, w, h));
    times.push(mt);
    grays.push(g);
    act.push(prev ? changedFraction(prev, g) : 0);
    prev = g;
    if (onProgress && times.length % 10 === 0) onProgress(t - startS, endS - startS);
  }
  onProgress?.(endS - startS, endS - startS);
  const events = refineEvents(detectEvents(times, act, opts), grays, opts);
  return { times, act, events };
}

/** Vùng ngữ cảnh quanh vùng khoanh (rộng thêm 60%), kẹp trong khung hình. */
export function contextBox(roi, W, H, grow = 0.6) {
  const cx = roi.x + roi.w / 2, cy = roi.y + roi.h / 2;
  const w = Math.min(W, roi.w * (1 + grow) + 40), h = Math.min(H, roi.h * (1 + grow) + 40);
  const x = Math.max(0, Math.min(W - w, cx - w / 2)), y = Math.max(0, Math.min(H - h, cy - h / 2));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

function toJpeg(canvas, quality = 0.82) { return canvas.toDataURL('image/jpeg', quality); }

/** Ảnh nhỏ vùng ngữ cảnh tại tS (để duyệt nhanh). */
export async function snapshot(video, roi, tS, maxW = 240) {
  await seek(video, tS);
  const box = contextBox(roi, video.videoWidth, video.videoHeight);
  const s = Math.min(1, maxW / box.w);
  const c = document.createElement('canvas');
  c.width = Math.round(box.w * s); c.height = Math.round(box.h * s);
  const ctx = c.getContext('2d');
  ctx.drawImage(video, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);
  ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 2;
  ctx.strokeRect((roi.x - box.x) * s, (roi.y - box.y) * s, roi.w * s, roi.h * s);
  return toJpeg(c, 0.75);
}

/**
 * Ảnh bằng chứng cho một lượt: full (khung gốc), marked (khung gốc + khung vàng + nhãn), crop (vùng ngữ cảnh).
 * labelLines: các dòng chữ ghi lên ảnh đánh dấu.
 */
export async function evidence(video, roi, tS, labelLines = []) {
  await seek(video, tS);
  const W = video.videoWidth, H = video.videoHeight;
  const full = document.createElement('canvas');
  full.width = W; full.height = H;
  full.getContext('2d').drawImage(video, 0, 0);

  const marked = document.createElement('canvas');
  marked.width = W; marked.height = H;
  const m = marked.getContext('2d');
  m.drawImage(full, 0, 0);
  m.strokeStyle = '#ffd400'; m.lineWidth = Math.max(2, W / 400);
  m.strokeRect(roi.x, roi.y, roi.w, roi.h);
  const fs = Math.max(14, Math.round(H / 32));
  m.font = `bold ${fs}px sans-serif`;
  const pad = 6, lh = fs + 4;
  const tw = Math.max(0, ...labelLines.map((l) => m.measureText(l).width));
  const bx = Math.min(W - tw - 2 * pad, roi.x), by = Math.max(0, roi.y - labelLines.length * lh - 2 * pad);
  m.fillStyle = 'rgba(0,0,0,.7)';
  m.fillRect(bx, by, tw + 2 * pad, labelLines.length * lh + 2 * pad);
  m.fillStyle = '#ffd400';
  labelLines.forEach((l, i) => m.fillText(l, bx + pad, by + pad + (i + 1) * lh - 4));

  const box = contextBox(roi, W, H);
  const crop = document.createElement('canvas');
  crop.width = box.w; crop.height = box.h;
  crop.getContext('2d').drawImage(full, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);

  return { full: toJpeg(full), marked: toJpeg(marked), crop: toJpeg(crop, 0.9) };
}
