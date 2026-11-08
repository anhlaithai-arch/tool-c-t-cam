// AI tự tìm chỗ bỏ kiện (bao) của một phiếu TO: chia khung thành lưới ô, đo chuyển động từng ô quanh khoảng quét,
// ô nào có đỉnh chuyển động trùng nhịp các lần quét nhất là chỗ bỏ kiện. Chạy trong trình duyệt.
// Đã thử trên 2 phiếu TO thật: tìm đúng bao của người bắn hàng ở cả hai (z 5,1 và 6,3; trúng 28/28 và 49/49).
import { seek } from './video.mjs';
import { rhythmScore, simplePeaks, regionFromZ } from './core/rhythm.mjs';

const DOWN = 4, CELL = 12, STEP = 6; // ô 12x12 trên khung thu nhỏ 4 lần = 48x48 px gốc

/**
 * scanV: thời điểm quét đã đổi sang thời gian video (giây). Trả {box (px gốc, nên dùng làm vùng khoanh), z, offset, hits, n, heat}.
 */
export async function findBagForScans(video, scanV, { fps = 12.5, padS = 15, lag = 1.5, maxOff = 3, onProgress, signal } = {}) {
  const W = Math.floor(video.videoWidth / DOWN), H = Math.floor(video.videoHeight / DOWN);
  const nx = Math.floor((W - CELL) / STEP) + 1, ny = Math.floor((H - CELL) / STEP) + 1;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const t0 = Math.max(0, Math.min(...scanV) - padS), t1 = Math.min(video.duration - 0.05, Math.max(...scanV) + padS);
  const times = [], series = Array.from({ length: nx * ny }, () => []);
  let prev = null;
  const integ = new Float32Array((W + 1) * (H + 1));
  for (let t = t0; t <= t1; t += 1 / fps) {
    if (signal?.aborted) throw new DOMException('Đã hủy', 'AbortError');
    await seek(video, t, 5000, { waitFrame: false });
    ctx.drawImage(video, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    const g = new Uint8Array(W * H);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (prev) {
      // ảnh nhị phân điểm đổi > 18 -> ảnh tích phân -> tổng từng ô
      for (let y = 0; y < H; y++) {
        let row = 0;
        for (let x = 0; x < W; x++) {
          row += Math.abs(g[y * W + x] - prev[y * W + x]) > 18 ? 1 : 0;
          integ[(y + 1) * (W + 1) + x + 1] = integ[y * (W + 1) + x + 1] + row;
        }
      }
      const I = (x, y) => integ[y * (W + 1) + x];
      let k = 0;
      for (let cy = 0; cy < ny; cy++) {
        for (let cx = 0; cx < nx; cx++, k++) {
          const xa = cx * STEP, ya = cy * STEP, xb = xa + CELL, yb = ya + CELL;
          series[k].push((I(xb, yb) - I(xa, yb) - I(xb, ya) + I(xa, ya)) / (CELL * CELL));
        }
      }
      times.push(t);
    }
    prev = g;
    if (onProgress && times.length % 10 === 0) onProgress(t - t0, t1 - t0);
  }
  const span = times[times.length - 1] - times[0];
  const zmap = new Float64Array(nx * ny).fill(-9), offs = new Float64Array(nx * ny), hits = new Int32Array(nx * ny);
  for (let k = 0; k < series.length; k++) {
    const pk = simplePeaks(times, series[k]);
    const r = rhythmScore(scanV, pk, span, { lag, maxOff });
    zmap[k] = r.z; offs[k] = r.offset; hits[k] = r.hits;
  }
  const reg = regionFromZ(zmap, nx, ny, STEP, CELL);
  const pad = 6; // nới chút để chắc trùm miệng bao
  const box = {
    x: Math.max(0, (reg.box.x - pad) * DOWN), y: Math.max(0, (reg.box.y - pad) * DOWN),
    w: Math.min(video.videoWidth, (reg.box.w + 2 * pad) * DOWN), h: Math.min(video.videoHeight, (reg.box.h + 2 * pad) * DOWN),
  };
  return { box, z: reg.zmax, offset: offs[reg.best], hits: hits[reg.best], n: scanV.length, heat: { zmap, nx, ny, step: STEP * DOWN, cell: CELL * DOWN } };
}
