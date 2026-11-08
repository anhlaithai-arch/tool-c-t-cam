// Chấm điểm lượt bỏ kiện do tool đề xuất so với nhãn.
//   node scripts/eval-drops.mjs <events.json> <candidates.json> <labels.json>
// events.json: [{peakS, kind}] (xuất từ trang Đếm: JSON.stringify(window.__dem.st.scan.events))
// candidates.json: do app/tools/eval_drops.py tạo; labels.json: tests/fixtures/eval_labels_*.json
import { readFileSync } from 'node:fs';

const [evF, candF, labF] = process.argv.slice(2);
const events = JSON.parse(readFileSync(evF, 'utf8'));
const cands = JSON.parse(readFileSync(candF, 'utf8')).candidates;
const L = JSON.parse(readFileSync(labF, 'utf8'));
const lab = {};
for (const k of ['tp', 'fp', 'unsure', 'occ_toss', 'occ_none', 'weak_none']) for (const n of L[k]) lab[n] = k;
const isToss = (k) => k === 'tp' || k === 'occ_toss';

// ghép lượt của tool với ứng viên đã gán nhãn theo thời điểm đỉnh
const used = new Set();
const rows = events.map((e) => {
  let best = null;
  for (const c of cands) {
    const d = Math.abs(c.peakS - e.peakS);
    const inside = e.peakS >= c.startS - 0.3 && e.peakS <= c.endS + 0.3;
    if ((inside || d < 0.5) && (!best || d < best.d)) best = { c, d };
  }
  if (best) used.add(best.c.n);
  return { ...e, label: best ? lab[best.c.n] : 'unmatched', n: best?.c.n };
});
const counted = rows.filter((r) => r.kind === 'drop');
const tally = (arr) => arr.reduce((m, r) => ((m[r.label] = (m[r.label] || 0) + 1), m), {});
const tp = counted.filter((r) => isToss(r.label)).length;
const fp = counted.filter((r) => r.label === 'fp' || r.label === 'occ_none' || r.label === 'weak_none').length;
const un = counted.filter((r) => r.label === 'unsure').length;
const truthLo = L.tp.length + L.occ_toss.length, truthHi = truthLo + L.unsure.length;
const review = rows.filter((r) => r.kind !== 'drop');
const missedToss = [...L.tp, ...L.occ_toss].filter((n) => !rows.some((r) => r.n === n));
console.log(JSON.stringify({
  events: rows.length, counted: counted.length, truth: `${truthLo}..${truthHi}`,
  tp, fp, unsure: un,
  precision: +(tp / (tp + fp)).toFixed(3),
  recall: `${(tp / truthHi).toFixed(3)}..${((tp + un) / truthHi).toFixed(3)} (mẫu số ${truthHi}) / ${(tp / truthLo).toFixed(3)} (mẫu số ${truthLo})`,
  countedByLabel: tally(counted), reviewByLabel: tally(review),
  tossNotInAnyEvent: missedToss,
}, null, 1));
