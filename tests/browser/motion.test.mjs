import test from 'node:test';
import assert from 'node:assert/strict';
import { detectEvents, numberEvents, nearestEvent, changedFraction, boxBlur } from '../../browser/core/motion.mjs';

function series(spec, fps = 10, dur = 20) {
  const times = [], act = [];
  for (let i = 0; i < dur * fps; i++) {
    const t = i / fps;
    times.push(t);
    let a = 0.002;
    for (const [s, e, v] of spec) if (t >= s && t <= e) a = v;
    act.push(a);
  }
  return { times, act };
}

test('detects short tosses and flags occlusion', () => {
  const { times, act } = series([[2, 2.3, 0.2], [5, 5.2, 0.15], [9, 12, 0.3], [15, 15.4, 0.8]]);
  const ev = detectEvents(times, act);
  assert.equal(ev.length, 4);
  assert.deepEqual(ev.map((e) => e.kind), ['drop', 'drop', 'occlusion', 'occlusion']);
});

test('merges flicker within one toss', () => {
  const { times, act } = series([[3, 3.1, 0.2], [3.3, 3.4, 0.2]]);
  assert.equal(detectEvents(times, act).length, 1);
});

test('quiet video -> no events', () => {
  const { times, act } = series([]);
  assert.equal(detectEvents(times, act).length, 0);
});

test('numbering, review decisions, multi-parcel and stable ids', () => {
  const { times, act } = series([[2, 2.3, 0.2], [5, 5.2, 0.15], [9, 12, 0.3], [15, 15.2, 0.2]]);
  const ev = detectEvents(times, act);
  let r = numberEvents(ev);
  assert.equal(r.total, 3); // occlusion chưa duyệt không tính
  assert.deepEqual(r.items.map((i) => i.label), ['1', '2', null, '3']);

  const [e1, e2, e3, e4] = ev;
  r = numberEvents(ev, { [e2.id]: 'reject', [e3.id]: 'accept' }, { [e3.id]: 2 });
  assert.deepEqual(r.items.map((i) => i.label), ['1', null, '2–3', '4']);
  assert.equal(r.total, 4);
  assert.equal(r.items[3].id, e4.id); // ID không đổi khi thứ tự đổi

  const near = nearestEvent(r.items, 15.5);
  assert.equal(near.item.id, e4.id);
  assert.equal(near.item.label, '4');
});

test('changedFraction & blur', () => {
  const a = { w: 4, h: 1, data: new Uint8Array([0, 0, 0, 0]) };
  const b = { w: 4, h: 1, data: new Uint8Array([0, 100, 0, 100]) };
  assert.equal(changedFraction(a, b), 0.5);
  assert.equal(boxBlur(a).data.length, 4);
});
