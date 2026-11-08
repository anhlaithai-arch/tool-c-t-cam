// Ánh xạ thời gian video <-> giờ thật (port từ app/core/sync.py). Logic thuần.
// Sample: {videoS, wall: giây|null, text}. offset = wall - videoS.
// Đồng hồ hiện tới giây (làm tròn xuống) => offset thật T thỏa max(o_i) <= T < min(o_i) + 1.

import { secToIso } from './clock.mjs';

const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const off = (s) => (s.wall === null || s.wall === undefined ? null : s.wall - s.videoS);

/** Tách các mẫu thành đoạn liên tục; mẫu lệch đơn lẻ coi là OCR sai. Trả về {groups, warnings}. */
export function splitSegments(samples, tolS = 1.5) {
  const valid = samples.filter((s) => off(s) !== null);
  const warnings = [];
  if (!valid.length) return { groups: [], warnings: ['Không đọc được đồng hồ ở mẫu nào'] };
  const groups = [[valid[0]]];
  for (let i = 1; i < valid.length; i++) {
    const s = valid[i];
    const cur = groups[groups.length - 1];
    const ref = median(cur.map(off));
    if (Math.abs(off(s) - ref) <= tolS) { cur.push(s); continue; }
    const nxt = valid[i + 1];
    if (nxt && Math.abs(off(nxt) - ref) <= tolS) {
      warnings.push(`Bỏ mẫu ${s.videoS.toFixed(1)}s: đọc "${s.text}" lệch, có thể đọc sai`);
    } else {
      warnings.push(`Đồng hồ nhảy ${(off(s) - ref >= 0 ? '+' : '') + (off(s) - ref).toFixed(1)}s trong khoảng video ` +
        `${cur[cur.length - 1].videoS.toFixed(1)}s–${s.videoS.toFixed(1)}s (mất hình hoặc nối video)`);
      groups.push([s]);
    }
  }
  return { groups, warnings };
}

/** {offset, uncertainty, warnings} từ các mẫu làm tròn xuống tới giây. */
export function coarseOffset(group) {
  const offs = group.map(off);
  const lo = Math.max(...offs), hi = Math.min(...offs) + 1;
  if (lo >= hi) {
    return {
      offset: median(offs) + 0.5,
      uncertainty: (Math.max(...offs) - Math.min(...offs)) / 2 + 0.5,
      warnings: [`Offset trong đoạn không nhất quán (dao động ${(lo - hi + 1).toFixed(2)}s) – có thể đồng hồ trôi`],
    };
  }
  return { offset: (lo + hi) / 2, uncertainty: (hi - lo) / 2, warnings: [] };
}

/** Kết quả đồng bộ của một video. segments: [{videoStart, videoEnd, offset, uncertainty, method, nSamples}] */
export class SyncResult {
  constructor({ durationS, segments = [], samples = [], warnings = [] }) {
    Object.assign(this, { durationS, segments, samples, warnings });
  }

  toWall(videoS) {
    const seg = this.segments.find((g) => g.videoStart <= videoS && videoS <= g.videoEnd);
    return seg ? seg.offset + videoS : null;
  }

  /** {videoS|null, note, uncertainty?} */
  toVideo(wallSec) {
    for (const g of this.segments) {
      const v = wallSec - g.offset;
      if (v >= g.videoStart - 1e-6 && v <= g.videoEnd + 1e-6) return { videoS: v, uncertainty: g.uncertainty, note: `±${g.uncertainty.toFixed(2)}s (${g.method})` };
    }
    if (this.segments.length) {
      const first = this.segments[0], last = this.segments[this.segments.length - 1];
      if (wallSec < first.offset + first.videoStart) return { videoS: null, note: 'trước khi video bắt đầu' };
      if (wallSec > last.offset + last.videoEnd) return { videoS: null, note: 'sau khi video kết thúc' };
    }
    return { videoS: null, note: 'rơi vào khoảng đồng hồ nhảy/chưa xác định giữa hai đoạn' };
  }

  /** Khoảng giờ thật mỗi đoạn, dạng chuỗi để hiển thị. */
  describe() {
    return this.segments.map((g) => ({
      ...g,
      wallStart: secToIso(g.offset + g.videoStart, true),
      wallEnd: secToIso(g.offset + g.videoEnd, true),
    }));
  }

  toJSON() {
    return { durationS: this.durationS, segments: this.segments, samples: this.samples, warnings: this.warnings };
  }

  static fromJSON(o) { return new SyncResult(o); }
}

/**
 * Ghép đoạn từ mẫu. refine(group) (tùy chọn) trả {offset, uncertainty} chính xác hơn hoặc null.
 */
export async function buildSync(samples, durationS, { tolS = 1.5, refine = null } = {}) {
  const { groups, warnings } = splitSegments(samples, tolS);
  const segments = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const c = coarseOffset(g);
    warnings.push(...c.warnings);
    let { offset, uncertainty } = c, method = 'ocr-coarse';
    if (refine) {
      const fine = await refine(g);
      if (fine && Math.abs(fine.offset - offset) <= uncertainty + 0.1) {
        ({ offset, uncertainty } = fine);
        method = 'ocr+tick';
      } else if (fine) {
        warnings.push(`Căn khung hình đoạn ${gi + 1} lệch so với OCR (${(fine.offset - offset).toFixed(2)}s), giữ kết quả OCR`);
      }
    }
    segments.push({
      videoStart: gi === 0 ? 0 : g[0].videoS,
      videoEnd: gi === groups.length - 1 ? durationS : g[g.length - 1].videoS,
      offset, uncertainty, method, nSamples: g.length,
    });
  }
  return new SyncResult({ durationS, segments, samples, warnings });
}
