import { wrists, distToPoly } from './pose.mjs';

function iou(a,b) {
  const intersection = Math.max(0, Math.min(a.x2,b.x2)-Math.max(a.x1,b.x1)) * Math.max(0, Math.min(a.y2,b.y2)-Math.max(a.y1,b.y1));
  const area = (r) => Math.max(0,r.x2-r.x1)*Math.max(0,r.y2-r.y1);
  const union = area(a)+area(b)-intersection;
  return union ? intersection/union : 0;
}

export function attribute(ev, frames, { packerBox, mouth, winS = 0.8, nearPx = 40, minApproach = 15 }) {
  frames = frames.filter((f) => f.t >= ev.t-winS && f.t <= ev.t);
  const unknown = (reason, trail = []) => ({ decision: null, score: 0, who: null, reasons: [reason], trail });
  let packer = null, overlap = 0;
  for (const p of frames[0]?.people || []) {
    const value = packerBox ? iou(p.box, packerBox) : 0;
    if (value > overlap) { packer = p.id; overlap = value; }
  }
  const paths = new Map();
  for (const f of frames) for (const p of f.people) {
    const points = wrists(p).map((pt) => ({pt, d: distToPoly(pt,mouth)})).sort((a,b) => a.d-b.d);
    if (!points.length) continue;
    if (!paths.has(p.id)) paths.set(p.id, []);
    paths.get(p.id).push({ ...points[0], t: f.t });
  }
  if (packer === null || !paths.has(packer)) return unknown('Không thấy cổ tay người đóng – cần duyệt');
  const candidates = [];
  for (const [id,path] of paths) {
    const last = path.at(-1).d;
    if (last <= nearPx && path[0].d-Math.min(...path.map((p) => p.d)) >= minApproach) candidates.push({id,path,last});
  }
  candidates.sort((a,b) => a.last-b.last);
  if (!candidates.length) return unknown('Không có cổ tay đi về miệng bao – cần duyệt');
  const own = candidates.find((c) => c.id === packer), other = candidates.find((c) => c.id !== packer);
  if (own && other && Math.abs(own.last-other.last) < 10) return unknown('Hai người cùng gần miệng bao – cần duyệt');
  const selected = candidates[0], decision = selected.id === packer ? 1 : 0;
  const reasons = [decision ? `Cổ tay người đóng đi về miệng bao (cách ${Math.round(selected.last)}px)` : 'Người khác bỏ kiện, không phải người đóng'];
  if (decision === 1 && ev.kind === 'occlusion') reasons.push('Có che khuất – nên duyệt');
  return { decision, score: Math.max(0, Math.min(1, 1-selected.last/(2*nearPx))) * selected.path.length/frames.length,
    who: selected.id, reasons, trail: selected.path.map(({pt,t}) => [...pt,t]) };
}
