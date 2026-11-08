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
 * Nét chữ = điểm rất sáng HOẶC rất tối (đầu ghi đổi chữ trắng/đen theo nền). Tìm đồng thời dòng chữ (y0, cao),
 * bước ký tự và vị trí: ô ký tự có nét ở giữa, ô dấu cách và khe giữa hai ký tự phải trống
 * (nền có giấy dán tường/đồ vật sẽ bị phạt ở các ô dấu cách).
 */
export function fitGrid(img, label) {
  const L = label.length;
  const { w, h, data } = img;
  const hiT = Math.max(170, percentile(data, 0.99) - 45);
  const loT = Math.min(80, percentile(data, 0.01) + 45);
  // tổng tích lũy theo cột của mặt nạ nét: colCum[y*w + x] = số điểm nét ở cột x từ hàng 0..y-1
  const colCum = new Float32Array((h + 1) * w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = data[y * w + x];
      colCum[(y + 1) * w + x] = colCum[y * w + x] + (v >= hiT || v <= loT ? 1 : 0);
    }
  }
  const prefix = new Float32Array(w + 1);
  let top = null;
  const pmax = w / (L - 1), pmin = Math.max(5, w / (L * 1.8));
  for (let p = pmin; p <= pmax; p += 0.25) {
    for (const hf of [1.15, 1.35, 1.6]) {
      const bh = Math.round(p * hf);
      if (bh < 5 || bh > h) continue;
      for (let y0 = 0; y0 + bh <= h; y0++) {
        const y1 = y0 + bh;
        for (let x = 0; x < w; x++) prefix[x + 1] = prefix[x] + (colCum[y1 * w + x] - colCum[y0 * w + x]) / bh;
        const mean = (a, b) => {
          const lo = Math.max(0, Math.min(w, Math.round(a))), hi = Math.max(0, Math.min(w, Math.round(b)));
          return hi > lo ? (prefix[hi] - prefix[lo]) / (hi - lo) : 0;
        };
        // nét phải có cả phía trên & dưới dải: dải lệch thì hàng sát mép dải có nét -> phạt
        for (let x0 = -0.5 * p; x0 + L * p <= w + 0.5 * p; x0 += 0.5) {
          let s = 0;
          for (let j = 0; j < L; j++) {
            const a = x0 + j * p, c = label[j];
            if (c === ' ') s -= 2 * mean(a, a + p);
            else if (isAlnum(c)) s += Math.min(mean(a + 0.2 * p, a + 0.8 * p), 0.5);
            if (j > 0 && isAlnum(c) && isAlnum(label[j - 1])) s -= 2 * mean(a - 0.08 * p, a + 0.08 * p + 1);
          }
          if (!top || s > top.score) top = { x0, pitch: p, score: s, y0, y1 };
        }
      }
    }
  }
  if (!top) return null;
  // tinh chỉnh mịn bước ký tự / vị trí trên dải đã chọn (lệch nhỏ cộng dồn qua ~23 ký tự sẽ làm lệch ô các số cuối)
  {
    const { y0, y1 } = top, bh = y1 - y0;
    for (let x = 0; x < w; x++) prefix[x + 1] = prefix[x] + (colCum[y1 * w + x] - colCum[y0 * w + x]) / bh;
    const meanF = (a, b) => { // trung bình có nội suy phần lẻ
      a = Math.max(0, Math.min(w, a)); b = Math.max(0, Math.min(w, b));
      if (b <= a) return 0;
      const P = (t) => { const i = Math.floor(t), f = t - i; return i >= w ? prefix[w] : prefix[i] + f * (prefix[i + 1] - prefix[i]); };
      return (P(b) - P(a)) / (b - a);
    };
    const p0 = top.pitch, x00 = top.x0;
    // Bước ký tự = chu kỳ lặp của hồ sơ nét theo cột (font đều nét) – đo bằng tự tương quan, có nội suy phần lẻ.
    const xa0 = Math.max(0, Math.floor(x00)), xb0 = Math.min(w, Math.ceil(x00 + L * p0));
    const prof = [];
    for (let x = xa0; x < xb0; x++) prof.push(prefix[x + 1] - prefix[x]);
    const mu = prof.reduce((a, b) => a + b, 0) / Math.max(1, prof.length);
    const c = prof.map((v) => v - mu);
    const at = (t) => { const i = Math.floor(t), f = t - i; return i + 1 < c.length ? c[i] * (1 - f) + c[i + 1] * f : 0; };
    let pBest = p0, rBest = -Infinity;
    for (let lag = p0 - 1.5; lag <= p0 + 1.5; lag += 0.02) {
      let r = 0, n = 0;
      for (let x = 0; x + lag + 1 < c.length; x++) { r += c[x] * at(x + lag); n++; }
      r /= Math.max(1, n);
      if (r > rBest) { rBest = r; pBest = lag; }
    }
    let best = { score: -Infinity };
    for (let p = pBest; p <= pBest + 1e-9; p += 1) {
      for (let x0 = x00 - p0 / 2; x0 <= x00 + p0 / 2; x0 += 0.1) {
        let s = 0;
        for (let j = 0; j < L; j++) {
          const a = x0 + j * p, c = label[j];
          if (c === ' ') s -= 2 * meanF(a, a + p);
          else if (isAlnum(c)) s += Math.min(meanF(a + 0.2 * p, a + 0.8 * p), 0.5);
          if (j > 0 && isAlnum(c) && isAlnum(label[j - 1])) s -= 2 * meanF(a - 0.08 * p, a + 0.08 * p + 1);
        }
        if (s > best.score) best = { score: s, pitch: p, x0 };
      }
    }
    top = { ...top, ...best };
  }
  // tinh chỉnh dải: co/giãn mép trên/dưới tới khi hàng mép gần như không còn nét trong vùng chữ
  const xa = Math.max(0, Math.round(top.x0)), xb = Math.min(w, Math.round(top.x0 + L * top.pitch));
  const rowInk = (y) => { let n = 0; for (let x = xa; x < xb; x++) n += colCum[(y + 1) * w + x] - colCum[y * w + x]; return n / Math.max(1, xb - xa); };
  let { y0, y1 } = top;
  while (y0 > 0 && rowInk(y0 - 1) > 0.08) y0--;
  while (y1 < h && rowInk(y1) > 0.08) y1++;
  return { ...top, y0, y1, thr: hiT, label };
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
export function buildTemplates(grid, samples, { fromIndex = 0 } = {}) {
  // fromIndex: chỉ học từ ô chữ số ở vị trí này trở đi (bỏ ô ngày đè nền rối)
  const acc = {};
  for (const { img, text } of samples) {
    for (let k = fromIndex; k < text.length; k++) {
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
export function readOsd(img, grid, templates, { minScore = 0.55, minMargin = 0.08, fromIndex = 0 } = {}) {
  // fromIndex: chỉ đọc chữ số từ vị trí này (vd đầu phần giờ); phần trước giữ như nhãn (ngày đè nền rối dễ đọc sai)
  const label = grid.label;
  const out = label.split('');
  let minS = Infinity, minM = Infinity;
  for (let k = fromIndex; k < label.length; k++) {
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

/**
 * Điểm khớp trung bình (NCC, lấy cực trắng/đen tốt hơn) của một chuỗi giả định `text` trên ảnh,
 * tính trên các ô chữ số từ fromIndex. Dùng để so "giờ dự đoán" với "giờ đọc tự do".
 */
export function scoreText(img, grid, templates, text, { fromIndex = 0 } = {}) {
  let sum = 0, n = 0;
  for (let k = fromIndex; k < text.length; k++) {
    if (!isDigit(grid.label[k]) || !isDigit(text[k])) continue;
    const t = templates.digits[text[k]];
    if (!t) continue;
    sum += Math.max(ncc(cellVector(img, grid, k, 'white'), t), ncc(cellVector(img, grid, k, 'black'), t));
    n++;
  }
  return n ? sum / n : -1;
}
