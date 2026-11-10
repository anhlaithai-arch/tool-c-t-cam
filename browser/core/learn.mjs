// Hồi quy logistic thuần JavaScript, dùng chung khi thu mẫu và dự đoán.
export const FEATURES = Object.freeze([
  'durS', 'peakAct', 'meanAct', 'kindDrop', 'kindOcc', 'kindWeak',
  'parcelPeak', 'aiPos', 'aiNeg', 'aiUnk', 'aiScore', 'aiHasTrail',
  'fmsLagAbs', 'fmsMatched', 'fmsDoubt',
]);
const finite = (v) => Number.isFinite(v) ? v : 0;
const sigmoid = (z) => z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));

export function eventFeatures({ ev, scan, ai, match }) {
  let peak = 0, sum = 0, n = 0, parcel = 0;
  for (let i = 0; i < (scan?.times?.length || 0); i++) {
    const t = scan.times[i];
    if (t >= ev.startS && t <= ev.endS) {
      const a = finite(scan.act?.[i]);
      peak = n ? Math.max(peak, a) : a; sum += a; n++;
    }
    if (Math.abs(t - ev.peakS) <= 0.5) parcel = Math.max(parcel, finite(scan.parcel?.[i]));
  }
  const res = ai?.res;
  return [ev.endS - ev.startS, peak, n ? sum / n : 0,
    +(ev.kind === 'drop'), +(ev.kind === 'occlusion'), +(ev.kind === 'weak'), parcel,
    +(!!res && res.decision === 1), +(!!res && res.decision === 0), +(!!res && res.decision == null),
    res?.score, +(!!res?.trail?.length), match ? Math.min(10, Math.abs(finite(match.lag))) : 10,
    +!!match, +!!match?.doubt].map(finite);
}

export function labelOf(label) {
  return label === 'bo_vao' ? 1 : label === 'sai' || label === 'khong_kien' ? 0 : null;
}

function fit(samples, { l2, epochs, lr }) {
  const n = samples.length, d = FEATURES.length;
  const mu = Array(d).fill(0), sd = Array(d).fill(0), w = Array(d).fill(0);
  for (const { x } of samples) for (let j = 0; j < d; j++) mu[j] += x[j] / n;
  for (const { x } of samples) for (let j = 0; j < d; j++) sd[j] += (x[j] - mu[j]) ** 2 / n;
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const rows = samples.map(({ x, y }) => ({ x: x.map((v, j) => (v - mu[j]) / sd[j]), y }));
  const pos = samples.filter((s) => s.y === 1).length;
  const weights = [n / (2 * (n - pos || 1)), n / (2 * (pos || 1))];
  let b = 0;
  for (let e = 0; e < epochs; e++) {
    const g = Array(d).fill(0); let gb = 0;
    for (const { x, y } of rows) {
      const err = (sigmoid(b + w.reduce((s, v, j) => s + v * x[j], 0)) - y) * weights[y];
      gb += err / n;
      for (let j = 0; j < d; j++) g[j] += err * x[j] / n;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (g[j] + l2 * w[j]);
    b -= lr * gb;
  }
  return { features: FEATURES, mu, sd, w, b };
}

function metricsAt(rows, thr) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const { p, y } of rows) {
    if (p >= thr) { if (y) tp++; else fp++; }
    else if (y) fn++; else tn++;
  }
  const precision = tp / (tp + fp || 1), recall = tp / (tp + fn || 1);
  return { acc: (tp + tn) / rows.length, precision, recall, f1: 2 * precision * recall / (precision + recall || 1) };
}

export function train(samples, { l2 = 1e-2, epochs = 400, lr = 0.1, seed = 1 } = {}) {
  const nPos = samples.filter((s) => s.y === 1).length, nNeg = samples.filter((s) => s.y === 0).length;
  if (samples.length < 20 || !nPos || !nNeg) throw new Error(`Cần ít nhất 20 mẫu có cả đúng và sai (hiện ${samples.length} mẫu: ${nPos} đúng, ${nNeg} sai)`);
  if (samples.some((s) => !Array.isArray(s.x) || s.x.length !== FEATURES.length || !s.x.every(Number.isFinite) || (s.y !== 0 && s.y !== 1))) throw new Error('Đặc trưng mẫu không hợp lệ');
  // Khởi tạo bằng 0: không cần số ngẫu nhiên, kết quả xác định với mọi seed.
  void seed;
  const hash = (bag) => { let h = 0; for (const c of String(bag ?? '')) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0; return h; };
  let val = samples.filter((s) => hash(s.bag) % 5 === 0);
  if (!val.length || new Set(val.map((s) => s.y)).size < 2 || val.length === samples.length) val = samples.slice(-Math.ceil(samples.length * 0.2));
  const held = new Set(val), fitting = samples.filter((s) => !held.has(s));
  const options = { l2, epochs, lr }, partial = fit(fitting, options);
  const rows = val.map((s) => ({ y: s.y, p: predict(partial, s.x) }));
  let thr = 0.5, scores = metricsAt(rows, thr);
  for (const candidate of [0, 1, ...rows.map((s) => s.p)]) {
    const next = metricsAt(rows, candidate);
    if (next.f1 > scores.f1 || (next.f1 === scores.f1 && Math.abs(candidate - 0.5) < Math.abs(thr - 0.5))) { thr = candidate; scores = next; }
  }
  return { version: 1, ...fit(samples, options), thr,
    metrics: { n: samples.length, nPos, nNeg, nVal: val.length, ...scores }, trainedAt: new Date().toISOString() };
}

export function predict(model, x) {
  if (!Array.isArray(model?.features) || model.features.length !== FEATURES.length || model.features.some((f, i) => f !== FEATURES[i])) throw new Error('Mô hình cũ, hãy huấn luyện lại');
  return sigmoid(model.b + model.w.reduce((s, v, j) => s + v * (finite(x[j]) - model.mu[j]) / model.sd[j], 0));
}
