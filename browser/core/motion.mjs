// Phát hiện lượt bỏ kiện vào miệng bao bằng chuyển động trong vùng khoanh. Logic thuần.
//
// Mỗi khung lấy mẫu: ảnh xám vùng khoanh (đã thu nhỏ, làm mờ). Hoạt động = tỷ lệ điểm đổi > ngưỡng
// so với khung mẫu trước. Một "lượt" = đoạn hoạt động vượt ngưỡng cao rồi yên trở lại.
// Lượt ngắn, chiếm ít diện tích -> nghi bỏ kiện. Lượt dài hoặc phủ gần hết vùng -> người đi qua/che khuất,
// vẫn giữ lại nhưng đánh dấu cần kiểm tra. AI chỉ ĐỀ XUẤT; người dùng duyệt mới tính.

/** Làm mờ hộp 3x3 (giảm nhiễu nén). img: {w,h,data:Uint8Array} */
export function boxBlur(img) {
  const { w, h, data } = img;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          s += data[yy * w + xx]; n++;
        }
      }
      out[y * w + x] = s / n;
    }
  }
  return { w, h, data: out };
}

/** Tỷ lệ điểm thay đổi > thr giữa hai ảnh cùng cỡ. */
export function changedFraction(a, b, thr = 18) {
  let n = 0;
  for (let i = 0; i < a.data.length; i++) if (Math.abs(a.data[i] - b.data[i]) > thr) n++;
  return n / a.data.length;
}

const median = (arr) => { const s = [...arr].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

export const DEFAULTS = {
  hiMin: 0.04,        // ngưỡng bật tối thiểu (tỷ lệ diện tích đổi)
  loMin: 0.02,        // ngưỡng tắt tối thiểu
  quietS: 0.4,        // phải yên ít nhất chừng này mới kết thúc lượt
  mergeGapS: 0.6,     // hai lượt cách nhau ít hơn -> gộp
  occlusionAct: 0.5,  // phủ > 50% vùng -> nghi người che
  occlusionDurS: 2.0, // kéo dài > 2s -> nghi người che / thao tác lâu
};

/**
 * times[i] (giây video), act[i] (hoạt động). Trả về danh sách lượt:
 * {id, startS, endS, peakS, peakIdx, maxAct, durationS, kind: 'drop'|'occlusion', reason}
 */
export function detectEvents(times, act, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (times.length !== act.length) throw new Error('times/act lệch độ dài');
  const med = median(act);
  const mad = median(act.map((a) => Math.abs(a - med))) + 1e-6;
  const hi = Math.max(o.hiMin, med + 6 * mad);
  const lo = Math.max(o.loMin, med + 3 * mad);

  const raw = [];
  let on = false, s = 0;
  for (let k = 0; k < act.length; k++) {
    if (!on && act[k] > hi) { on = true; s = k; continue; }
    if (on && act[k] < lo) {
      let quiet = true;
      for (let j = k; j < act.length && times[j] - times[k] < o.quietS; j++) if (act[j] >= lo) { quiet = false; break; }
      if (quiet) { raw.push([s, k]); on = false; }
    }
  }
  if (on) raw.push([s, act.length - 1]);

  const merged = [];
  for (const e of raw) {
    const last = merged[merged.length - 1];
    if (last && times[e[0]] - times[last[1]] < o.mergeGapS) last[1] = e[1];
    else merged.push([...e]);
  }

  return merged.map(([a, b]) => {
    let peakIdx = a;
    for (let k = a; k <= b; k++) if (act[k] > act[peakIdx]) peakIdx = k;
    const maxAct = act[peakIdx];
    const durationS = times[b] - times[a];
    let kind = 'drop', reason = 'Vật đi vào miệng bao';
    if (maxAct > o.occlusionAct) { kind = 'occlusion'; reason = `Phủ ${(maxAct * 100).toFixed(0)}% vùng – có thể người che/đi qua`; }
    else if (durationS > o.occlusionDurS) { kind = 'occlusion'; reason = `Kéo dài ${durationS.toFixed(1)}s – có thể thao tác lâu/người che`; }
    return {
      id: `ev_${Math.round(times[peakIdx] * 1000)}`, // ID cố định theo thời điểm, không theo thứ tự
      startS: times[a], endS: times[b], peakS: times[peakIdx], peakIdx, startIdx: a, endIdx: b,
      maxAct, durationS, kind, reason,
    };
  });
}

/**
 * Đặc trưng vị trí của một lượt, so khung đỉnh với khung ngay trước lượt (ảnh xám nhỏ của vùng khoanh):
 *  bottom = tỷ lệ điểm đổi ở 20% đáy vùng (người đứng/đi trước bao phủ cả đáy; kiện ném vào thì không)
 *  inner  = tỷ lệ điểm đổi ở lõi vùng (bỏ 15% mỗi mép)
 */
export function eventFeatures(grays, ev, thr = 18) {
  const before = grays[Math.max(0, ev.startIdx - 2)], peak = grays[ev.peakIdx];
  const { w, h } = peak;
  let bot = 0, nb = 0, inn = 0, ni = 0;
  const y80 = Math.floor(0.8 * h), x0 = Math.floor(0.15 * w), x1 = Math.ceil(0.85 * w), y0 = Math.floor(0.15 * h), y1 = Math.ceil(0.85 * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = Math.abs(peak.data[y * w + x] - before.data[y * w + x]) > thr ? 1 : 0;
      if (y >= y80) { bot += ch; nb++; }
      if (y >= y0 && y < y1 && x >= x0 && x < x1) { inn += ch; ni++; }
    }
  }
  return { bottom: nb ? bot / nb : 0, inner: ni ? inn / ni : 0 };
}

export const REFINE = {
  bottomMax: 0.3,   // đáy vùng đổi > 30% -> nghi người che
  weakAct: 0.065,   // lượt yếu ...
  weakInner: 0.02,  // ... và gần như không đổi ở lõi -> cần kiểm tra
};

/**
 * Phân loại lại lượt 'drop' bằng đặc trưng vị trí (đo trên video mẫu 2026-11-08, docs/DO_CHINH_XAC.md).
 * Không xóa lượt nào: chỉ chuyển sang 'occlusion' / 'weak' để người duyệt.
 */
export function refineEvents(events, grays, opts = {}) {
  const o = { ...REFINE, ...opts };
  return events.map((e) => {
    if (e.kind !== 'drop' || !grays[e.peakIdx]) return e;
    const f = eventFeatures(grays, e);
    const out = { ...e, features: f };
    if (f.bottom > o.bottomMax) {
      out.kind = 'occlusion';
      out.reason = `Đổi ${(f.bottom * 100).toFixed(0)}% đáy vùng – có thể người đứng/đi trước bao`;
    } else if (e.maxAct < o.weakAct && f.inner < o.weakInner) {
      out.kind = 'weak';
      out.reason = 'Chuyển động yếu ở mép vùng – cần kiểm tra';
    }
    return out;
  });
}

/**
 * Tỷ lệ điểm "màu kiện" trong vùng miệng bao: sáng và KHÔNG phải màu xanh lòng bao.
 * Lòng bao xanh, tay áo tối; kiện thường trắng/nâu/đỏ -> kiện đi vào miệng bao tạo đỉnh nhọn.
 * rgba: Uint8ClampedArray (ImageData.data).
 */
export function parcelFraction(rgba, { minV = 110, greenHue = [70, 180], greenSat = 0.235 } = {}) {
  let n = 0, tot = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    const s = mx ? d / mx : 0;
    let h = 0;
    if (d) {
      if (mx === r) h = 60 * (((g - b) / d) % 6);
      else if (mx === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
      if (h < 0) h += 360;
    }
    const green = h >= greenHue[0] && h <= greenHue[1] && s > greenSat;
    if (!green && mx > minV) n++;
    tot++;
  }
  return tot ? n / tot : 0;
}

/**
 * Đỉnh màu kiện: vượt nền trượt (trung vị ±winS) hơn max(minThr, k·MAD), cực đại cục bộ, cách nhau >= sepS.
 * Đo trên video thật (TO 28 đơn, camera B): k=2.5 bắt đủ 28/28 lượt bỏ kiện của người bắn hàng.
 */
export function detectColorPeaks(times, sig, { k = 2.5, minThr = 0.035, winS = 2.5, sepS = 0.7, madWindow = null } = {}) {
  const n = sig.length;
  if (n < 3) return [];
  const base = new Float64Array(n);
  let lo = 0, hi = 0;
  for (let i = 0; i < n; i++) {
    while (times[lo] < times[i] - winS) lo++;
    while (hi < n && times[hi] <= times[i] + winS) hi++;
    base[i] = median(sig.slice(lo, hi));
  }
  const ex = sig.map((v, i) => v - base[i]);
  // Ngưỡng tính trong khoảng đang bỏ kiện (vd quanh các lần quét FMS) để đoạn dựng/buộc bao không đẩy ngưỡng lên
  const exW = madWindow ? ex.filter((_, i) => times[i] >= madWindow[0] && times[i] <= madWindow[1]) : ex;
  const ref = exW.length >= 10 ? exW : ex;
  const med = median(ref);
  const mad = median(ref.map((v) => Math.abs(v - med))) + 1e-6;
  const thr = Math.max(minThr, k * mad);
  const peaks = [];
  for (let i = 1; i < n - 1; i++) {
    if (ex[i] > thr && ex[i] >= ex[i - 1] && ex[i] >= ex[i + 1]) {
      const last = peaks[peaks.length - 1];
      if (last && times[i] - times[last] < sepS) { if (ex[i] > ex[last]) peaks[peaks.length - 1] = i; }
      else peaks.push(i);
    }
  }
  return peaks.map((i) => ({
    id: `pk_${Math.round(times[i] * 1000)}`, startS: times[Math.max(0, i - 2)], endS: times[Math.min(n - 1, i + 2)],
    peakS: times[i], peakIdx: i, maxAct: ex[i], durationS: 0, kind: 'drop', reason: 'Kiện (màu) đi vào miệng bao',
  }));
}

/**
 * Đánh thứ tự cho các lượt đã duyệt. decisions: {[id]: 'accept'|'reject'|undefined}; count: {[id]: số kiện} (mặc định 1).
 * Lượt 'drop' chưa duyệt mặc định được tính (đề xuất của AI), 'occlusion' chưa duyệt mặc định không tính.
 * Trả {items: [{...event, counted, firstIndex, lastIndex, label}], total}
 */
export function numberEvents(events, decisions = {}, counts = {}) {
  const sorted = [...events].sort((a, b) => a.peakS - b.peakS);
  let n = 0;
  const items = sorted.map((e) => {
    const d = decisions[e.id];
    const counted = d === 'accept' || (d === undefined && e.kind === 'drop');
    const c = counted ? Math.max(1, counts[e.id] || 1) : 0;
    const first = counted ? n + 1 : null;
    n += c;
    const last = counted ? n : null;
    return { ...e, decision: d || 'pending', counted, count: c, firstIndex: first, lastIndex: last,
      label: counted ? (first === last ? String(first) : `${first}–${last}`) : null };
  });
  return { items, total: n };
}

/** Lượt gần thời điểm tS nhất (ưu tiên lượt được tính). */
export function nearestEvent(items, tS, maxDistS = 10) {
  let best = null;
  for (const it of items) {
    const d = tS < it.startS ? it.startS - tS : tS > it.endS ? tS - it.endS : 0;
    const score = d + (it.counted ? 0 : 0.5);
    if (d <= maxDistS && (!best || score < best.score)) best = { item: it, distS: d, score };
  }
  return best;
}
