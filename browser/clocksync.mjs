// Đồng bộ giờ camera trong trình duyệt: người dùng nhập chữ đồng hồ đang hiện ở 1 khung,
// app tự học mẫu chữ số trong ~12 giây tiếp theo, rồi đọc đồng hồ dọc video.
import { seek } from './video.mjs';
import { labelLayout, formatLike, parseClock } from './core/clock.mjs';
import { fitGrid, buildTemplates, readOsd, cellChange } from './core/osd.mjs';
import { buildSync } from './core/sync.mjs';

const DEFAULT_ROI_FRAC = { x: 0, y: 20 / 720, w: 380 / 1280, h: 70 / 720 };

export function defaultClockRoi(W, H) {
  return { x: Math.round(DEFAULT_ROI_FRAC.x * W), y: Math.round(DEFAULT_ROI_FRAC.y * H),
    w: Math.round(DEFAULT_ROI_FRAC.w * W), h: Math.round(DEFAULT_ROI_FRAC.h * H) };
}

let _c = null;
function grabGray(video, roi) {
  _c = _c || document.createElement('canvas');
  _c.width = roi.w; _c.height = roi.h;
  const ctx = _c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, roi.x, roi.y, roi.w, roi.h, 0, 0, roi.w, roi.h);
  const d = ctx.getImageData(0, 0, roi.w, roi.h).data;
  const g = new Uint8Array(roi.w * roi.h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return { w: roi.w, h: roi.h, data: g };
}

async function frameAt(video, roi, t) {
  const r = await seek(video, t);
  return { t: r.mediaTimeS ?? t, img: grabGray(video, roi) };
}

/** Tìm khung đầu tiên chữ số giây đổi sau thời điểm t. Trả {tPrev, tTick, img} hoặc null. */
async function findTick(video, roi, grid, secIdx, t, fps = 25) {
  const base = await frameAt(video, roi, t);
  let prevT = base.t;
  for (let j = 1; j <= Math.ceil(fps * 1.3); j++) {
    const f = await frameAt(video, roi, t + j / fps);
    if (f.t === prevT) continue;
    if (cellChange(base.img, f.img, grid, secIdx) > 0.35) return { tPrev: prevT, tTick: f.t, img: f.img };
    prevT = f.t;
  }
  return null;
}

/**
 * Học đồng hồ từ một khung có nhãn. label: chữ y hệt trên hình, vd "11-04-2026 Wed 16:48:42".
 * Trả {roi, grid, templates, layout}. Ném lỗi kèm hướng dẫn nếu không học được.
 */
export async function learnClock(video, label, atS, roi = defaultClockRoi(video.videoWidth, video.videoHeight)) {
  const layout = labelLayout(label.trim());
  if (!layout) throw new Error('Không hiểu chữ đồng hồ đã nhập. Nhập đúng như trên hình, vd "11-04-2026 Wed 16:48:42".');
  const f0 = await frameAt(video, roi, atS);
  const grid = fitGrid(f0.img, layout.label);
  if (!grid) throw new Error('Không thấy chữ đồng hồ trong vùng góc trên trái.');
  const secIdx = layout.groups.s.end - 1;
  const tick = await findTick(video, roi, grid, secIdx, atS);
  if (!tick) throw new Error('Không thấy chữ số giây đổi. Kiểm tra lại chữ đã nhập hoặc chọn khung khác.');
  const samples = [{ img: f0.img, text: layout.label }];
  for (let j = 0; j < 12; j++) {
    const t = tick.tTick + j + 0.5;
    if (t >= video.duration) break;
    const f = await frameAt(video, roi, t);
    samples.push({ img: f.img, text: formatLike(layout, layout.wall + 1 + j) });
  }
  const templates = buildTemplates(grid, samples);
  if (templates.missing.length) throw new Error('Chưa học đủ chữ số ' + templates.missing.join(',') + '. Chọn khung khác (cần ≥12 giây video sau đó).');
  // tự kiểm tra: đọc lại các mẫu vừa học
  for (const s of samples) {
    const r = readOsd(s.img, grid, templates);
    if (r.text !== s.text) throw new Error(`Đồng hồ không chạy liên tục sau khung đã chọn (đọc "${r.text}", mong "${s.text}"). Chọn khung khác.`);
  }
  return { roi, grid, templates, layout };
}

/** Đọc đồng hồ dọc video, trả SyncResult. */
export async function syncClock(video, clock, { stepS = 15, onProgress, signal } = {}) {
  const { roi, grid, templates, layout } = clock;
  const dur = video.duration;
  const ts = [];
  for (let t = 0.2; t < dur - 0.3; t += stepS) ts.push(t);
  ts.push(Math.max(0, dur - 0.3));
  const samples = [];
  for (let i = 0; i < ts.length; i++) {
    if (signal?.aborted) throw new DOMException('Đã hủy', 'AbortError');
    const f = await frameAt(video, roi, ts[i]);
    const r = readOsd(f.img, grid, templates);
    const wall = r.ok ? parseClock(r.text, layout.order).wall : null;
    samples.push({ videoS: f.t, wall, text: r.text });
    onProgress?.(i + 1, ts.length);
  }
  const secIdx = layout.groups.s.end - 1;
  return buildSync(samples, dur, {
    refine: async (group) => {
      const mid = group[group.length >> 1];
      const tk = await findTick(video, roi, grid, secIdx, mid.videoS);
      if (!tk) return null;
      const r = readOsd(tk.img, grid, templates);
      const wall = r.ok ? parseClock(r.text, layout.order).wall : null;
      if (wall === null) return null;
      const lo = wall - tk.tTick, hi = wall - tk.tPrev;
      return { offset: (lo + hi) / 2, uncertainty: (hi - lo) / 2 };
    },
  });
}
