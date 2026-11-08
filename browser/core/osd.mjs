// Đọc chữ số đồng hồ OSD bằng so khớp mẫu. Logic thuần trên ảnh xám {w, h, data: Uint8Array}.
// Giả định: font OSD đều nét (monospace), vị trí cố định theo camera — đúng với đầu ghi phổ biến.
// Bố cục lưới ký tự được dò một lần từ khung hình có nhãn do người dùng nhập.

const CW = 10, CH = 20; // kích thước chuẩn hóa một ô chữ số

function percentile(data, q) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;
  let k = Math.floor(q * (data.length - 1)), acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > k) return v; }
  return 255;
}

/** Cắt vùng roi {x,y,w,h} từ ảnh xám. */
export function cropGray(img, roi) {
  const out = new Uint8Array(roi.w * roi.h);
  for (let y = 0; y < roi.h; y++) {
    const src = (roi.y + y) * img.w + roi.x;
    out.set(img.data.subarray(src, src + roi.w), y * roi.w);
  }
  return { w: roi.w, h: roi.h, data: out };
}

const isDigit = (c) => c >= '0' && c <= '9';
const isAlnum = (c) => /[0-9A-Za-z]/.test(c);

/**
 * Dò lưới ký tự: trả {x0, pitch, y0, y1, thr, score} trong tọa độ của img (thường là vùng ROI đồng hồ).
 * label: chuỗi đúng như hiển thị trên khung hình này.
 */
export function fitGrid(img, label) {
  const L = label.length;
  const thr = Math.max(170, percentile(img.data, 0.99) - 45);
  const { w, h, data } = img;

  // dải hàng chứa chữ: hàng có nhiều điểm sáng nhất, mở rộng liên tục
  const rowSum = new Float32Array(h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[y * w + x] >= thr) rowSum[y]++;
  const rmax = Math.max(...rowSum);
  if (!rmax) return null;
  let best = { len: 0, y0: 0, y1: 0 };
  for (let y = 0, start = -1, gap = 0; y <= h; y++) {
    const on = y < h && rowSum[y] > 0.1 * rmax;
    if (on) { if (start < 0) start = y; gap = 0; } else if (start >= 0 && ++gap > 1) {
      const end = y - gap + 1;
      if (end - start > best.len) best = { len: end - start, y0: start, y1: end };
      start = -1; gap = 0;
    }
  }
  const { y0, y1 } = best;
  const bandH = y1 - y0;
  if (bandH < 5) return null;

  const col = new Float32Array(w);
  for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) if (data[y * w + x] >= thr) col[x] += 1 / bandH;
  const prefix = new Float32Array(w + 1);
  for (let x = 0; x < w; x++) prefix[x + 1] = prefix[x] + col[x];
  const mean = (a, b) => {
    const lo = Math.max(0, Math.min(w, Math.round(a))), hi = Math.max(0, Math.min(w, Math.round(b)));
    return hi > lo ? (prefix[hi] - prefix[lo]) / (hi - lo) : 0;
  };

  // điểm bắt đầu các cụm cột sáng -> ứng viên căn lề
  const starts = [];
  for (let x = 0; x < w; x++) if (col[x] > 0 && (x === 0 || col[x - 1] === 0)) starts.push(x);

  const pmax = w / (L - 1), pmin = Math.max(4, bandH * 0.25);
  let top = null;
  for (let p = pmin; p <= pmax; p += 0.25) {
    for (const rs of starts) {
      for (let k = 0; k < L; k++) {
        if (!isAlnum(label[k])) continue;
        for (const lead of [0.05, 0.12, 0.2]) {
          const x0 = rs - k * p - lead * p;
          if (x0 < -p * 0.5 || x0 + L * p > w + p * 0.5) continue;
          let s = 0;
          for (let j = 0; j < L; j++) {
            const a = x0 + j * p, c = label[j];
            if (c === ' ') s -= 2 * mean(a, a + p);
            else if (isAlnum(c)) s += Math.min(mean(a + 0.2 * p, a + 0.8 * p), 0.5);
            if (j > 0 && isAlnum(c) && isAlnum(label[j - 1])) s -= 2 * mean(a - 0.08 * p, a + 0.08 * p + 1);
          }
          if (!top || s > top.score) top = { x0, pitch: p, score: s };
        }
      }
    }
  }
  return top ? { ...top, y0, y1, thr, label } : null;
}

/**
 * Vector chuẩn hóa (z-score) của ô ký tự thứ k.
 * Đầu ghi tự đổi màu chữ (trắng viền đen trên nền tối, ĐEN trên nền sáng), nên dùng độ lệch tuyệt đối
 * so với nền của ô: chữ trắng hay đen đều cho cùng hình dạng.
 */
export function cellVector(img, grid, k, polarity = 'white') {
  const { x0, pitch, y0, y1 } = grid;
  const xa = x0 + k * pitch, ya = y0, cw = pitch, ch = y1 - y0;
  const bg = cellBackground(img, xa, ya, cw, ch);
  const sign = polarity === 'black' ? -1 : 1, gap = 20, span = 50;
  const v = new Float32Array(CW * CH);
  for (let j = 0; j < CH; j++) {
    for (let i = 0; i < CW; i++) {
      // lấy trung bình vùng nhỏ (area sampling)
      const xs = xa + (i / CW) * cw, xe = xa + ((i + 1) / CW) * cw;
      const ys = ya + (j / CH) * ch, ye = ya + ((j + 1) / CH) * ch;
      let s = 0, n = 0;
      for (let y = Math.floor(ys); y < Math.max(Math.floor(ys) + 1, Math.ceil(ye)); y++) {
        for (let x = Math.floor(xs); x < Math.max(Math.floor(xs) + 1, Math.ceil(xe)); x++) {
          if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
          const g = img.data[y * img.w + x];
          s += Math.min(1, Math.max(0, (sign * (g - bg) - gap) / span)); n++;
        }
      }
      v[j * CW + i] = n ? s / n : 0;
    }
  }
  let mass = 0; for (const x of v) mass += x;
  const out = zNorm(v);
  out.mass = mass / v.length; // tỷ lệ điểm thuộc nét chữ theo cực này
  return out;
}

/** Vector theo cực có nhiều nét chữ hơn (chữ trắng hay chữ đen). */
export function cellVectorAuto(img, grid, k) {
  const w = cellVector(img, grid, k, 'white'), b = cellVector(img, grid, k, 'black');
  return w.mass >= b.mass ? w : b;
}

/** Nền của ô = trung vị điểm ảnh trong ô (chữ chiếm ít hơn nửa diện tích ô). */
function cellBackground(img, xa, ya, cw, ch) {
  const vals = [];
  for (let y = Math.max(0, Math.floor(ya)); y < Math.min(img.h, Math.ceil(ya + ch)); y++) {
    for (let x = Math.max(0, Math.floor(xa)); x < Math.min(img.w, Math.ceil(xa + cw)); x++) vals.push(img.data[y * img.w + x]);
  }
  if (!vals.length) return 0;
  vals.sort((a, b) => a - b);
  return vals[vals.length >> 1];
}

function zNorm(v) {
  let m = 0; for (const x of v) m += x; m /= v.length;
  let sd = 0; for (const x of v) sd += (x - m) ** 2; sd = Math.sqrt(sd / v.length) || 1;
  const o = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) o[i] = (v[i] - m) / sd;
  return o;
}

export function ncc(a, b) {
  let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s / a.length;
}

/** Học mẫu chữ số từ các khung có chữ đã biết: samples = [{img, text}]. Trả {digits: {"0": Float32Array,...}}. */
export function buildTemplates(grid, samples) {
  const acc = {};
  for (const { img, text } of samples) {
    for (let k = 0; k < text.length; k++) {
      const c = text[k];
      if (!isDigit(c) || !isDigit(grid.label[k])) continue;
      const v = cellVectorAuto(img, grid, k);
      (acc[c] = acc[c] || []).push(v);
    }
  }
  const digits = {};
  for (const [c, vs] of Object.entries(acc)) {
    const m = new Float32Array(vs[0].length);
    for (const v of vs) for (let i = 0; i < m.length; i++) m[i] += v[i] / vs.length;
    digits[c] = zNorm(m);
  }
  return { digits, missing: '0123456789'.split('').filter((d) => !digits[d]) };
}

/**
 * Đọc lại chuỗi OSD: chữ số đọc bằng mẫu, ký tự khác giữ như nhãn.
 * Trả {text, minScore, minMargin, ok}.
 */
export function readOsd(img, grid, templates, { minScore = 0.55, minMargin = 0.08 } = {}) {
  const label = grid.label;
  const out = label.split('');
  let minS = Infinity, minM = Infinity;
  for (let k = 0; k < label.length; k++) {
    if (!isDigit(label[k])) continue;
    // thử cả chữ trắng lẫn chữ đen, lấy cực khớp mẫu tốt nhất
    let b1 = -Infinity, b2 = -Infinity, d1 = '?';
    for (const pol of ['white', 'black']) {
      const v = cellVector(img, grid, k, pol);
      let p1 = -Infinity, p2 = -Infinity, pd = '?';
      for (const [d, t] of Object.entries(templates.digits)) {
        const s = ncc(v, t);
        if (s > p1) { p2 = p1; p1 = s; pd = d; } else if (s > p2) p2 = s;
      }
      if (p1 > b1) { b1 = p1; b2 = p2; d1 = pd; }
    }
    out[k] = d1;
    minS = Math.min(minS, b1);
    minM = Math.min(minM, b1 - (b2 === -Infinity ? -1 : b2));
  }
  return { text: out.join(''), minScore: minS, minMargin: minM, ok: minS >= minScore && minM >= minMargin };
}

/** Độ khác giữa hai ảnh tại ô k (1 - ncc), dùng để phát hiện chữ số giây đổi. */
export function cellChange(imgA, imgB, grid, k) {
  return 1 - ncc(cellVectorAuto(imgA, grid, k), cellVectorAuto(imgB, grid, k));
}
