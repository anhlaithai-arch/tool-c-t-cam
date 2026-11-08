// Dữ liệu quét mã từ FMS: mã đơn, giờ quét, mã bao. Logic thuần (chạy được trong Node).
// Nguồn: dán từ Excel (tab), CSV (, ;) hoặc mảng hàng từ Google Sheet.
// Giờ quét biểu diễn bằng giây kể từ 2000-01-01 theo giờ địa phương hiển thị (như clock.mjs).

import { toSec, secToIso } from './clock.mjs';

const strip = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();

/** Tách bảng văn bản: tự chọn dấu phân cách (tab > ; > ,). Hỗ trợ ô có ngoặc kép. */
export function parseTable(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '');
  if (!lines.length) return [];
  const first = lines[0];
  const delim = first.includes('\t') ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
  return lines.map((line) => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  });
}

const COL_HINTS = {
  order: ['ma don', 'ma van don', 'van don', 'order', 'tracking', 'awb', 'shipment', 'ma kien', 'parcel'],
  time: ['thoi gian', 'gio quet', 'scan time', 'time', 'ngay gio', 'packing', 'dong goi', 'created', 'timestamp'],
  bag: ['ma bao', 'bao', 'bag', 'tui', 'sack', 'container'],
};

/** Đoán cột từ tiêu đề. Trả {order, time, bag} là chỉ số cột (hoặc -1). */
export function detectColumns(header) {
  const h = header.map(strip);
  const pick = (hints, exclude = []) => {
    for (const hint of hints) {
      const i = h.findIndex((x, k) => !exclude.includes(k) && x.includes(hint));
      if (i >= 0) return i;
    }
    return -1;
  };
  const bag = pick(COL_HINTS.bag);
  const order = pick(COL_HINTS.order, [bag]);
  const time = pick(COL_HINTS.time, [bag, order]);
  return { order, time, bag };
}

/**
 * Đọc giờ: "2026-11-04 16:55:54", "04/11/2026 16:55:54" (ngày/tháng mặc định), "2026/11/04 16:55",
 * số serial Excel (45965.7…), hoặc Date. dayFirst: true = dd/mm/yyyy (mặc định ở VN).
 */
export function parseTime(v, dayFirst = true) {
  if (v instanceof Date) return toSec(v.getFullYear(), v.getMonth() + 1, v.getDate(), v.getHours(), v.getMinutes(), v.getSeconds());
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) { // serial Excel: ngày kể từ 1899-12-30
    const days = Number(s);
    const ms = Math.round((days - 36526) * 86400) ; // 36526 = 2000-01-01
    return ms;
  }
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (m) return toSec(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (m) {
    const [a, b] = [+m[1], +m[2]];
    const [d, mo] = dayFirst ? [a, b] : [b, a];
    return toSec(+m[3], mo, d, +m[4], +m[5], +(m[6] || 0)) ?? toSec(+m[3], d, mo, +m[4], +m[5], +(m[6] || 0));
  }
  m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?[ ,]+(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s); // "16:55:54 04/11/2026"
  if (m) {
    const [a, b] = [+m[4], +m[5]];
    const [d, mo] = dayFirst ? [a, b] : [b, a];
    return toSec(+m[6], mo, d, +m[1], +m[2], +(m[3] || 0));
  }
  return null;
}

const normCode = (c) => String(c ?? '').trim().toUpperCase();

/**
 * Tạo bộ dữ liệu FMS từ bảng (hàng đầu là tiêu đề). cols: ghi đè cột tự đoán.
 * Trả {scans: [{order, time, bag, row}], errors: [...], cols}
 */
export function loadScans(table, { cols = null, dayFirst = true } = {}) {
  if (!table.length) return { scans: [], errors: ['Bảng trống'], cols: null };
  const c = cols || detectColumns(table[0]);
  const errors = [];
  if (c.order < 0) errors.push('Không thấy cột mã đơn');
  if (c.time < 0) errors.push('Không thấy cột giờ quét');
  if (c.bag < 0) errors.push('Không thấy cột mã bao');
  if (errors.length) return { scans: [], errors, cols: c };
  const scans = [];
  table.slice(1).forEach((r, i) => {
    const order = normCode(r[c.order]);
    if (!order) return;
    const time = parseTime(r[c.time], dayFirst);
    if (time === null) { errors.push(`Dòng ${i + 2}: không đọc được giờ "${r[c.time]}"`); return; }
    scans.push({ order, time, bag: normCode(r[c.bag]), row: i + 2 });
  });
  return { scans, errors, cols: c };
}

/**
 * Vị trí đơn trong bao theo giờ quét.
 * Trả {order, bag, index (1..), total, time, bagScans: [{order,time,index}], duplicates} hoặc null.
 * Đơn quét nhiều lần trong cùng bao: lấy lần quét đầu, báo duplicates.
 */
export function orderPosition(scans, orderCode) {
  const code = normCode(orderCode);
  const mine = scans.filter((s) => s.order === code);
  if (!mine.length) return null;
  const first = mine.reduce((a, b) => (b.time < a.time ? b : a));
  const bagScans = bagSequence(scans, first.bag);
  const it = bagScans.find((s) => s.order === code);
  return {
    order: code, bag: first.bag, index: it.index, total: bagScans.length, time: first.time,
    timeIso: secToIso(first.time), bagScans,
    duplicates: mine.length - 1, otherBags: [...new Set(mine.map((s) => s.bag))].filter((b) => b !== first.bag),
  };
}

/** Các đơn trong một bao, sắp theo giờ quét, mỗi đơn một lần (lần quét đầu). */
export function bagSequence(scans, bag) {
  const firstBy = new Map();
  for (const s of scans) {
    if (s.bag !== bag) continue;
    const p = firstBy.get(s.order);
    if (!p || s.time < p.time) firstBy.set(s.order, s);
  }
  return [...firstBy.values()].sort((a, b) => a.time - b.time || a.row - b.row).map((s, i) => ({ ...s, index: i + 1 }));
}

/**
 * Ghép lần quét với lượt bỏ kiện trong video (cả hai theo thời gian video, giây).
 * scanV: [{order, index, v}] (v = thời điểm quét đã đổi sang thời gian video), events: [{id, peakS, kind}]
 * Mỗi lần quét nhận lượt đầu tiên sau nó trong [v + minLag, v + maxLag], không dùng lại, giữ đúng thứ tự.
 */
export function matchScansToEvents(scanV, events, { minLag = -1, maxLag = 12 } = {}) {
  const evs = [...events].sort((a, b) => a.peakS - b.peakS);
  const used = new Set();
  let cursor = 0;
  return [...scanV].sort((a, b) => a.v - b.v).map((s) => {
    let hit = null;
    for (let k = cursor; k < evs.length; k++) {
      const e = evs[k];
      if (e.peakS < s.v + minLag) continue;
      if (e.peakS > s.v + maxLag) break;
      if (!used.has(e.id)) { hit = e; used.add(e.id); cursor = k + 1; break; }
    }
    return { ...s, event: hit, lagS: hit ? hit.peakS - s.v : null };
  });
}

/**
 * Ghép tối ưu cả chuỗi (quy hoạch động, giữ thứ tự): mỗi lần quét nhận tối đa một lượt, lượt dùng tối đa một lần,
 * chi phí = |độ trễ - expLag|; bỏ qua một lần quét tốn skipCost; lượt thừa bỏ qua miễn phí.
 * Tránh lỗi dây chuyền của cách ghép tham lam khi một lượt thật bị thiếu.
 * scanV: [{order, index, v}], events: [{id, peakS}] (nên gồm cả lượt "người che"/"cần kiểm tra").
 */
export function alignScans(scanV, events, { expLag = 1, maxDev = 4, skipCost = 4 } = {}) {
  const S = [...scanV].sort((a, b) => a.v - b.v);
  const E = [...events].sort((a, b) => a.peakS - b.peakS);
  const n = S.length, m = E.length, INF = 1e18;
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(INF));
  const bt = Array.from({ length: n + 1 }, () => new Int8Array(m + 1)); // 1 bỏ quét, 2 bỏ lượt, 3 ghép
  dp[0][0] = 0;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const c = dp[i][j];
      if (c >= INF) continue;
      if (i < n && c + skipCost < dp[i + 1][j]) { dp[i + 1][j] = c + skipCost; bt[i + 1][j] = 1; }
      if (j < m && c < dp[i][j + 1]) { dp[i][j + 1] = c; bt[i][j + 1] = 2; }
      if (i < n && j < m) {
        const dev = Math.abs(E[j].peakS - S[i].v - expLag);
        if (dev <= maxDev && c + dev < dp[i + 1][j + 1]) { dp[i + 1][j + 1] = c + dev; bt[i + 1][j + 1] = 3; }
      }
    }
  }
  const out = S.map((s) => ({ ...s, event: null, lagS: null }));
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const b = bt[i][j];
    if (b === 3) { out[i - 1].event = E[j - 1]; out[i - 1].lagS = E[j - 1].peakS - S[i - 1].v; i--; j--; }
    else if (b === 1) i--;
    else j--;
  }
  return out;
}

/**
 * Ước lượng độ lệch giờ: video_time = scan_time_as_video + offset. Thử các offset trong [lo, hi] bước step,
 * chọn offset có nhiều lần quét có lượt bỏ kiện ngay sau (0..window giây) nhất; hòa thì chọn độ trễ trung vị nhỏ.
 */
export function estimateOffset(scanV, events, { lo = -180, hi = 180, step = 0.5, window = 6 } = {}) {
  const peaks = events.map((e) => e.peakS).sort((a, b) => a - b);
  let best = null;
  for (let off = lo; off <= hi; off += step) {
    let hits = 0; const lags = [];
    for (const s of scanV) {
      const v = s.v + off;
      const e = peaks.find((p) => p >= v && p <= v + window);
      if (e !== undefined) { hits++; lags.push(e - v); }
    }
    lags.sort((a, b) => a - b);
    const med = lags.length ? lags[lags.length >> 1] : Infinity;
    if (!best || hits > best.hits || (hits === best.hits && med < best.medianLag)) best = { offset: off, hits, medianLag: med };
  }
  return { ...best, total: scanV.length };
}
