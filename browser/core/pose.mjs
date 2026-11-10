export const KP = ['nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear', 'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist', 'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'];
// COCO skeleton, converted from one-based to zero-based indices.
export const SKELETON = [[15,13],[13,11],[16,14],[14,12],[11,12],[5,11],[6,12],[5,6],[5,7],[6,8],[7,9],[8,10],[1,2],[0,1],[0,2],[1,3],[2,4],[3,5],[4,6]];

export function letterbox(box, size = 640) {
  if (!(box.w > 0 && box.h > 0 && size > 0)) throw new RangeError('Invalid image size');
  const scale = Math.min(size / box.w, size / box.h);
  return { scale, padX: 0, padY: 0, w: box.w * scale, h: box.h * scale };
}

export function decode(dets, kps, n, lb, box, { boxThr = 0.4, kpThr = 0.3 } = {}) {
  // Keep low-confidence keypoints intact; drawing/attribution filters by kpThr.
  const x = (v) => (v - lb.padX) / lb.scale + box.x;
  const y = (v) => (v - lb.padY) / lb.scale + box.y;
  const people = [];
  for (let i = 0; i < n; i++) {
    const j = i * 5;
    if (dets[j + 4] < boxThr) continue;
    people.push({ box: { x1: x(dets[j]), y1: y(dets[j+1]), x2: x(dets[j+2]), y2: y(dets[j+3]) }, score: dets[j+4],
      kps: Array.from({ length: 17 }, (_, k) => { const p = (i * 17 + k) * 3; return [x(kps[p]), y(kps[p+1]), kps[p+2]]; }) });
  }
  return people;
}

function segmentDistance([x,y], [ax,ay], [bx,by]) {
  const dx = bx-ax, dy = by-ay, len = dx*dx+dy*dy;
  const t = len ? Math.max(0, Math.min(1, ((x-ax)*dx+(y-ay)*dy)/len)) : 0;
  return Math.hypot(x-ax-t*dx, y-ay-t*dy);
}

export function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (segmentDistance(pt, poly[j], poly[i]) < 1e-9) return true;
    const [xi,yi] = poly[i], [xj,yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj-xi)*(pt[1]-yi)/(yj-yi)+xi) inside = !inside;
  }
  return inside;
}

export function distToPoly(pt, poly) {
  if (pointInPoly(pt, poly)) return 0;
  return poly.reduce((d, p, i) => Math.min(d, segmentDistance(pt, p, poly[(i+1)%poly.length])), Infinity);
}

export function polyCenter(poly) {
  if (!poly.length) return null;
  return poly.reduce((s,p) => [s[0]+p[0]/poly.length, s[1]+p[1]/poly.length], [0,0]);
}

export function wrists(person, kpThr = 0.3) {
  return [9,10].map((i) => person.kps[i]).filter((p) => p && p[2] >= kpThr).map(([x,y]) => [x,y]);
}

const center = ({box:b}) => [(b.x1+b.x2)/2, (b.y1+b.y2)/2];
export function track(frames, { maxDist = 80 } = {}) {
  let previous = [], nextId = 1;
  return frames.map((frame) => {
    const pairs = [];
    frame.people.forEach((p,i) => previous.forEach((q,j) => {
      const a = center(p), b = center(q), d = Math.hypot(a[0]-b[0], a[1]-b[1]);
      if (d <= maxDist) pairs.push({i,j,d});
    }));
    pairs.sort((a,b) => a.d-b.d);
    const ids = new Map(), used = new Set();
    for (const {i,j} of pairs) if (!ids.has(i) && !used.has(j)) { ids.set(i, previous[j].id); used.add(j); }
    const people = frame.people.map((p,i) => ({ ...p, id: ids.has(i) ? ids.get(i) : nextId++ }));
    previous = people;
    return { ...frame, people };
  });
}

export function pickPerson(people, [x,y]) {
  return people.filter(({box:b}) => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2)
    .reduce((best,p) => !best || area(p.box) < area(best.box) ? p : best, null);
}
function area(b) { return (b.x2-b.x1)*(b.y2-b.y1); }
