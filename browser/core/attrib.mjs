import { wrists, distToPoly, polyCenter } from './pose.mjs';

function iou(a,b) {
  const intersection = Math.max(0, Math.min(a.x2,b.x2)-Math.max(a.x1,b.x1)) * Math.max(0, Math.min(a.y2,b.y2)-Math.max(a.y1,b.y1));
  const area = (r) => Math.max(0,r.x2-r.x1)*Math.max(0,r.y2-r.y1);
  const union = area(a)+area(b)-intersection;
  return union ? intersection/union : 0;
}

export function attribute(ev, frames, { packerBox, mouth, winS = 1.5, nearWinS = 0.8, nearPx = 40, minApproach = 15, throwSpeed = 900, throwCos = 0.7 }) {
  frames = frames.filter((f) => f.t >= ev.t-winS && f.t <= ev.t).sort((a,b) => a.t-b.t);
  const unknown = (reason, warning = false) => ({ kind: 'unknown', warning, decision: null, score: 0, who: null, reasons: [reason], trail: [] });
  let packer = null;
  for (const f of frames) {
    let overlap = 0.1;
    for (const p of f.people) {
      const value = packerBox ? iou(p.box, packerBox) : 0;
      if (value > overlap) { packer = p.id; overlap = value; }
    }
    if (packer !== null) break;
  }
  if (packer === null) return unknown('Không thấy người đóng – cần duyệt');
  const nearFrames = frames.filter((f) => f.t >= ev.t-nearWinS);
  const paths = new Map();
  let anyoneNear = false;
  for (const f of nearFrames) for (const p of f.people) {
    const points = wrists(p).map((pt) => ({pt, d: distToPoly(pt,mouth)})).sort((a,b) => a.d-b.d);
    if (!points.length) continue;
    if (points[0].d <= nearPx) anyoneNear = true;
    if (!paths.has(p.id)) paths.set(p.id, []);
    paths.get(p.id).push({ ...points[0], t: f.t });
  }
  const candidates = [];
  for (const [id,path] of paths) {
    const last = path.at(-1).d;
    if (last <= nearPx && path[0].d-Math.min(...path.map((p) => p.d)) >= minApproach) candidates.push({id,path,last});
  }
  candidates.sort((a,b) => a.last-b.last);
  const ownDistance = paths.get(packer)?.at(-1).d ?? Infinity;
  const otherDistance = Math.min(...[...paths].filter(([id]) => id !== packer).map(([,path]) => path.at(-1).d));
  if (ownDistance <= nearPx && otherDistance <= nearPx && Math.abs(ownDistance-otherDistance) < 10) return unknown('Người đóng và người khác cùng sát miệng bao – cần duyệt', true);
  if (candidates.length) {
    const selected = candidates[0], decision = selected.id === packer ? 1 : 0;
    if (!decision && ownDistance < selected.last) return unknown('Không có cổ tay người đóng đi về miệng bao – cần duyệt');
    const reasons = [decision ? `Cổ tay người đóng đi về miệng bao (cách ${Math.round(selected.last)}px)` : 'Người khác bỏ hàng vào bao – không phải người đóng'];
    if (decision === 1 && ev.kind === 'occlusion') reasons.push('Có che khuất – nên duyệt');
    return { kind: decision ? 'packer' : 'other', warning: !decision, decision,
      score: Math.max(0, Math.min(1, 1-selected.last/(2*nearPx))) * selected.path.length/nearFrames.length,
      who: selected.id, reasons, trail: selected.path.map(({pt,t}) => [...pt,t]) };
  }
  if (anyoneNear) return unknown('Không có cổ tay đi về miệng bao – cần duyệt');
  const center = polyCenter(mouth);
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i-1], frame = frames[i], dt = frame.t-prev.t;
    if (dt <= 0) continue;
    for (const p of frame.people) {
      if (p.id === packer) continue;
      const q = prev.people.find((v) => v.id === p.id);
      if (!q) continue;
      for (const k of [9,10]) {
        const a = q.kps[k], b = p.kps[k];
        if (!(a?.[2] >= 0.3 && b?.[2] >= 0.3)) continue;
        const dx = b[0]-a[0], dy = b[1]-a[1], len = Math.hypot(dx,dy);
        const tx = center[0]-a[0], ty = center[1]-a[1], target = Math.hypot(tx,ty);
        if (len && target && len/dt >= throwSpeed && (dx*tx+dy*ty)/(len*target) >= throwCos) {
          return { kind: 'throw', warning: true, decision: 0, score: 0, who: p.id,
            reasons: ['Nghi người khác ném hàng vào bao'], trail: [[a[0],a[1],prev.t],[b[0],b[1],frame.t]] };
        }
      }
    }
  }
  return { kind: 'fall', warning: true, decision: 0, score: 0, who: null,
    reasons: ['Hàng rơi/bay vào bao, không thấy tay ai'], trail: [] };
}
