// Dữ liệu huấn luyện từ kết quả đã duyệt. Logic thuần (chạy được trong Node).
//
// Mỗi mẫu = 3 ảnh nhỏ quanh miệng bao (-0,4 / 0 / +0,4 s) + thông tin: phiếu TO, mã đơn, thời điểm, vùng, nhãn.
// Nhãn:
//   'bo_vao'     : người duyệt xác nhận đúng lúc kiện của đơn đi vào bao (mẫu dương)
//   'sai'        : khung ghép KHÔNG phải lúc bỏ kiện (mẫu âm khó – rất quý để mô hình học phân biệt)
//   'khong_ro'   : không nhìn rõ (không dùng để huấn luyện, chỉ lưu để xem lại)
//   'khong_kien' : khoảng giữa hai lượt bỏ kiện đã xác nhận, không có kiện (mẫu âm tự sinh)
// Video gốc KHÔNG tải lên; chỉ ảnh cắt nhỏ.

export const LABELS = { bo_vao: 'Đúng lúc bỏ kiện', sai: 'Sai', khong_ro: 'Không rõ', khong_kien: 'Không có kiện' };
export const FRAME_OFFSETS = [-0.4, 0, 0.4];

/** ID ổn định của mẫu: chạy lại / duyệt lại cùng đơn sẽ ghi đè, không tạo trùng. */
export function sampleId({ bag, order, label, tS }) {
  const key = label === 'khong_kien' ? `NEG_${Math.round(tS * 10)}` : String(order || '').toUpperCase();
  return `${String(bag || 'NOBAG').toUpperCase()}_${key}`.replace(/[^A-Z0-9_]/gi, '_');
}

/**
 * Từ kết quả ghép + quyết định duyệt -> danh sách mẫu cần lưu (chưa có ảnh).
 * matches: [{order, index, event: {peakS}|null, v}], reviews: {[order]: {label, tS?}} (tS: thời điểm người duyệt sửa)
 * meta: {bag, camera, videoFile, roi, offset, signal}
 */
export function buildSamples(matches, reviews, meta) {
  const out = [];
  for (const m of matches) {
    const r = reviews[m.order];
    if (!r || !r.label) continue;
    const tS = r.tS ?? (m.event ? m.event.peakS : null);
    if (tS == null) continue;
    out.push({
      id: sampleId({ bag: meta.bag, order: m.order, label: r.label, tS }),
      label: r.label, corrected: r.tS != null, order: m.order, index: m.index, bag: meta.bag,
      camera: meta.camera || '', videoFile: meta.videoFile || '', videoTimeS: Math.round(tS * 1000) / 1000,
      scanVideoS: m.v != null ? Math.round(m.v * 1000) / 1000 : null,
      roi: meta.roi, signal: meta.signal || '', offset: meta.offset ?? null,
    });
  }
  return out;
}

/**
 * Mẫu âm tự sinh: điểm giữa hai lượt bỏ kiện liên tiếp ĐÃ XÁC NHẬN, khi khoảng cách >= minGapS
 * (cách mỗi lượt >= minGapS/2 nên trong 3 khung ±0,4s không có kiện đi vào). Tối đa maxN mẫu.
 */
export function negativeTimes(confirmedTimes, { minGapS = 2.4, maxN = 50 } = {}) {
  const t = [...confirmedTimes].sort((a, b) => a - b);
  const out = [];
  for (let i = 1; i < t.length && out.length < maxN; i++) {
    if (t[i] - t[i - 1] >= minGapS) out.push(Math.round(((t[i] + t[i - 1]) / 2) * 1000) / 1000);
  }
  return out;
}

/** Thống kê để hiển thị. */
export function summarize(samples) {
  const c = { bo_vao: 0, sai: 0, khong_ro: 0, khong_kien: 0 };
  for (const s of samples) c[s.label] = (c[s.label] || 0) + 1;
  return { ...c, total: samples.length, usable: c.bo_vao + c.sai + c.khong_kien };
}
