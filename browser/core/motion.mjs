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
      startS: times[a], endS: times[b], peakS: times[peakIdx], peakIdx,
      maxAct, durationS, kind, reason,
    };
  });
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
