// Phân tích chuỗi đồng hồ OSD camera, vd "11-04-2026 Wed 16:48:42". Logic thuần (chạy được trong Node).
// Giờ thật biểu diễn bằng "giây kể từ 2000-01-01 00:00:00" theo giờ hiển thị trên camera (không múi giờ),
// tránh trình duyệt tự đổi múi giờ.

const EPOCH_MS = Date.UTC(2000, 0, 1);
// getUTCDay(): CN=0, T2=1, ...
const WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const CLOCK_RE = /(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})\s*([A-Za-z]{3})?[A-Za-z]*\s*(\d{1,2}):(\d{2}):(\d{2})/d;

export function toSec(y, mo, d, h = 0, mi = 0, s = 0) {
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  const t = new Date(ms);
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d ||
      t.getUTCHours() !== h || t.getUTCMinutes() !== mi || t.getUTCSeconds() !== s) return null;
  return (ms - EPOCH_MS) / 1000;
}

export function fromSec(sec) {
  const t = new Date(EPOCH_MS + Math.round(sec * 1000));
  return {
    y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(),
    h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds(), ms: t.getUTCMilliseconds(),
    weekday: t.getUTCDay(),
  };
}

const p2 = (n) => String(n).padStart(2, '0');

/** "YYYY-MM-DDTHH:MM:SS" (+ ".mmm" nếu withMs). */
export function secToIso(sec, withMs = false) {
  const f = fromSec(sec);
  const base = `${f.y}-${p2(f.mo)}-${p2(f.d)}T${p2(f.h)}:${p2(f.mi)}:${p2(f.s)}`;
  return withMs ? `${base}.${String(f.ms).padStart(3, '0')}` : base;
}

/** Nhận "YYYY-MM-DD HH:MM:SS" hoặc có "T", có thể có phần nghìn giây. */
export function isoToSec(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(String(iso).trim());
  if (!m) return null;
  const base = toSec(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
  return base === null ? null : base + (m[7] ? Number('0.' + m[7]) : 0);
}

export function normalizeText(parts) {
  let s = (Array.isArray(parts) ? parts : [parts]).map((p) => String(p).trim()).join(' ');
  s = s.replace(/\s*-\s*-?\s*/g, '-').replace(/\s*:\s*/g, ':');
  s = s.replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, '0');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Trả về {wall: giây|null, ambiguous, order: 'YMD'|'MDY'|'DMY'|null}.
 * Thứ trong tuần (nếu có) dùng để phân biệt tháng-ngày/ngày-tháng; prefer dùng khi vẫn mơ hồ.
 */
export function parseClock(text, prefer = 'MDY') {
  const m = CLOCK_RE.exec(text);
  if (!m) return { wall: null, ambiguous: false, order: null };
  const [a, b, c] = [+m[1], +m[2], +m[3]];
  const wd = m[4] ? WEEKDAYS[m[4].toLowerCase()] : undefined;
  const [hh, mm, ss] = [+m[5], +m[6], +m[7]];
  const orders = { YMD: [a, b, c], MDY: [c, a, b], DMY: [c, b, a] };
  let cands = {};
  for (const [name, [y, mo, d]] of Object.entries(orders)) {
    if (y < 2000) continue;
    const sec = toSec(y, mo, d, hh, mm, ss);
    if (sec !== null) cands[name] = sec;
  }
  if (wd !== undefined) {
    const matched = Object.fromEntries(Object.entries(cands).filter(([, s]) => fromSec(s).weekday === wd));
    if (Object.keys(matched).length) cands = matched;
  }
  const names = Object.keys(cands);
  if (!names.length) return { wall: null, ambiguous: false, order: null };
  const distinct = new Set(Object.values(cands));
  if (distinct.size === 1) {
    const order = names.includes(prefer) ? prefer : names.sort()[0];
    return { wall: cands[order], ambiguous: false, order };
  }
  const order = names.includes(prefer) ? prefer : names.sort()[0];
  return { wall: cands[order], ambiguous: true, order };
}

/**
 * Mô tả bố cục của nhãn OSD người dùng nhập, để tạo lại chuỗi đúng định dạng cho giờ khác.
 * Trả về null nếu nhãn không đọc được.
 */
export function labelLayout(label, prefer = 'MDY') {
  const m = CLOCK_RE.exec(label);
  if (!m) return null;
  const parsed = parseClock(label, prefer);
  if (parsed.wall === null) return null;
  const idx = m.indices;
  const group = (i) => ({ start: idx[i][0], end: idx[i][1] });
  return {
    label,
    order: parsed.order,
    wall: parsed.wall,
    ambiguous: parsed.ambiguous,
    groups: { a: group(1), b: group(2), c: group(3), wd: m[4] ? group(4) : null, h: group(5), mi: group(6), s: group(7) },
  };
}

/** Tạo chuỗi OSD cho giờ `sec` theo đúng bố cục nhãn. */
export function formatLike(layout, sec) {
  const f = fromSec(sec);
  const parts = { YMD: [f.y, f.mo, f.d], MDY: [f.mo, f.d, f.y], DMY: [f.d, f.mo, f.y] }[layout.order];
  const g = layout.groups;
  const chars = layout.label.split('');
  const put = (grp, val) => {
    const w = grp.end - grp.start;
    const s = String(val).padStart(w, '0').slice(-w);
    for (let i = 0; i < w; i++) chars[grp.start + i] = s[i];
  };
  put(g.a, parts[0]); put(g.b, parts[1]); put(g.c, parts[2]);
  put(g.h, f.h); put(g.mi, f.mi); put(g.s, f.s);
  if (g.wd) {
    const orig = layout.label.slice(g.wd.start, g.wd.end);
    let name = WEEKDAY_NAMES[f.weekday];
    if (orig === orig.toUpperCase()) name = name.toUpperCase();
    put(g.wd, name);
  }
  return chars.join('');
}
