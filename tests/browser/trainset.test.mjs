import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSamples, negativeTimes, sampleId, summarize } from '../../browser/core/trainset.mjs';

const matches = [
  { order: 'SPXA', index: 1, v: 10, event: { peakS: 10.6 } },
  { order: 'SPXB', index: 2, v: 12, event: { peakS: 12.5 } },
  { order: 'SPXC', index: 3, v: 15, event: null },
  { order: 'SPXD', index: 4, v: 20, event: { peakS: 21 } },
];
const meta = { bag: 'TO2026X', camera: 'Camera B', videoFile: 'v.mp4', roi: { x: 1, y: 2, w: 3, h: 4 }, offset: 0.5, signal: 'màu kiện' };

test('buildSamples: only reviewed, uses corrected time, skips unmatched without correction', () => {
  const s = buildSamples(matches, {
    SPXA: { label: 'bo_vao' },
    SPXB: { label: 'sai' },
    SPXC: { label: 'bo_vao' },            // không có lượt ghép & không sửa -> bỏ
    SPXD: { label: 'bo_vao', tS: 21.8 },  // người duyệt sửa thời điểm
  }, meta);
  assert.deepEqual(s.map((x) => [x.order, x.label, x.videoTimeS, x.corrected]), [
    ['SPXA', 'bo_vao', 10.6, false], ['SPXB', 'sai', 12.5, false], ['SPXD', 'bo_vao', 21.8, true]]);
  assert.equal(s[0].id, 'TO2026X_SPXA');
});

test('sampleId stable and safe', () => {
  assert.equal(sampleId({ bag: 'to-1', order: 'spx1', label: 'bo_vao' }), 'TO_1_SPX1');
  assert.equal(sampleId({ bag: 'TO1', label: 'khong_kien', tS: 12.34 }), 'TO1_NEG_123');
});

test('negativeTimes between confirmed drops with enough gap', () => {
  assert.deepEqual(negativeTimes([10, 11, 14, 20]), [12.5, 17]);
  assert.equal(negativeTimes([1, 5, 9, 13], { maxN: 2 }).length, 2);
});

test('summarize', () => {
  const r = summarize([{ label: 'bo_vao' }, { label: 'sai' }, { label: 'khong_ro' }, { label: 'khong_kien' }]);
  assert.equal(r.usable, 3);
  assert.equal(r.total, 4);
});
