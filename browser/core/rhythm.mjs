// Chấm "khớp nhịp quét": các đỉnh hoạt động của một vùng có trùng nhịp các lần quét FMS không. Logic thuần.
// Dùng để AI tự tìm chỗ bỏ kiện (bao) của một phiếu TO, không cần người khoanh trước.

/** Gộp các mốc thời gian sát nhau (< sepS), giữ mốc đầu. peaks: mảng số đã sắp xếp tăng. */
export function dedupe(peaks, sepS = 0.7) {
  const out = [];
  for (const p of peaks) if (!out.length || p - out[out.length - 1] >= sepS) out.push(p);
  return out;
}

/**
 * Điểm z khớp nhịp tốt nhất theo độ lệch giờ off: lần quét "trúng" nếu có đỉnh trong [v+off, v+off+lag].
 * Kỳ vọng ngẫu nhiên tính theo mật độ đỉnh (Poisson) trên khoảng spanS.
 * Trả {z, offset, hits, n, expected}.
 */
export function rhythmScore(scanV, peaks, spanS, { lag = 1.5, maxOff = 3, step = 0.25 } = {}) {
  const n = scanV.length;
  if (peaks.length < 3 || !n || spanS <= 0) return { z: -9, offset: 0, hits: 0, n, expected: 0 };
  const p = 1 - Math.exp(-(peaks.length / spanS) * lag);
  const sd = Math.sqrt(Math.max(1e-9, n * p * (1 - p)));
  let best = null;
  for (let off = -maxOff; off <= maxOff + 1e-9; off += step) {
    let hits = 0, j = 0;
    for (const v of scanV) {
      const lo = v + off;
      while (j < peaks.length && peaks[j] < lo) j++;
      if (j < peaks.length && peaks[j] <= lo + lag) hits++;
    }
    const z = (hits - n * p) / sd;
    if (!best || z > best.z || (z === best.z && Math.abs(off) < Math.abs(best.offset))) best = { z, offset: off, hits, n, expected: n * p };
  }
  return best;
}

/** Đỉnh của một chuỗi (vượt nền trượt ±win mẫu hơn max(minThr, k·MAD)); trả mảng thời gian. */
export function simplePeaks(times, sig, { k = 3, minThr = 0.03, win = 31, sepS = 0.7 } = {}) {
  const n = sig.length;
  if (n < 3) return [];
  const med = (a) => { const s = Array.from(a).sort((x, y) => x - y); return s[s.length >> 1]; };
  const ex = new Float64Array(n);
  for (let i = 0; i < n; i++) ex[i] = sig[i] - med(sig.slice(Math.max(0, i - win), i + win + 1));
  const m = med(ex);
  const mad = med(Array.from(ex, (v) => Math.abs(v - m))) + 1e-6;
  const thr = Math.max(minThr, k * mad);
  const out = [];
  let lastI = -1;
  for (let i = 1; i < n - 1; i++) {
    if (ex[i] > thr && ex[i] >= ex[i - 1] && ex[i] >= ex[i + 1]) {
      if (lastI >= 0 && times[i] - times[lastI] < sepS) { if (ex[i] > ex[lastI]) { out[out.length - 1] = times[i]; lastI = i; } }
      else { out.push(times[i]); lastI = i; }
    }
  }
  return out;
}

/**
 * Từ bản đồ điểm z (ny x nx ô, mỗi ô cách nhau `step` px, cỡ `cell` px) chọn vùng: ô tốt nhất + các ô liền kề
 * có z >= frac·zmax -> hộp bao quanh (px khung gốc).
 */
export function regionFromZ(zmap, nx, ny, step, cell, frac = 0.85) {
  let bi = 0;
  for (let i = 1; i < zmap.length; i++) if (zmap[i] > zmap[bi]) bi = i;
  const zmax = zmap[bi];
  const seen = new Uint8Array(zmap.length), q = [bi];
  seen[bi] = 1;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  while (q.length) {
    const i = q.pop(), y = Math.floor(i / nx), x = i % nx;
    x0 = Math.min(x0, x * step); y0 = Math.min(y0, y * step);
    x1 = Math.max(x1, x * step + cell); y1 = Math.max(y1, y * step + cell);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
      const j = yy * nx + xx;
      if (!seen[j] && zmap[j] >= frac * zmax) { seen[j] = 1; q.push(j); }
    }
  }
  return { best: bi, zmax, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}
