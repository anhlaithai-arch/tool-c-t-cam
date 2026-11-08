import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, parseClock, toSec, secToIso, isoToSec, labelLayout, formatLike } from '../../browser/core/clock.mjs';
import { splitSegments, coarseOffset, SyncResult } from '../../browser/core/sync.mjs';

const S = (y, mo, d, h, mi, s) => toSec(y, mo, d, h, mi, s);

test('normalize RapidOCR fragments', () => {
  assert.equal(normalizeText(['11-', '-04-2026', 'Wed', '16', ':48:42']), '11-04-2026 Wed 16:48:42');
});

test('weekday disambiguates MDY', () => {
  const r = parseClock('11-04-2026 Wed 16:48:42');
  assert.equal(r.wall, S(2026, 11, 4, 16, 48, 42));
  assert.equal(r.ambiguous, false);
  assert.equal(r.order, 'MDY');
});

test('weekday picks DMY when it matches', () => {
  const r = parseClock('04-11-2026 Wed 16:48:42');
  assert.equal(r.wall, S(2026, 11, 4, 16, 48, 42));
  assert.equal(r.order, 'DMY');
});

test('ambiguous without weekday', () => {
  const r = parseClock('11-04-2026 16:48:42');
  assert.equal(r.ambiguous, true);
  assert.equal(r.wall, S(2026, 11, 4, 16, 48, 42));
});

test('garbage and invalid dates', () => {
  assert.equal(parseClock('Camera 01').wall, null);
  assert.equal(toSec(2026, 2, 30), null);
});

test('iso roundtrip', () => {
  const s = isoToSec('2026-11-04T16:55:54.250');
  assert.equal(secToIso(s, true), '2026-11-04T16:55:54.250');
  assert.equal(isoToSec('2026-11-04 16:55:54'), S(2026, 11, 4, 16, 55, 54));
});

test('formatLike keeps layout and rolls over midnight/weekday', () => {
  const lay = labelLayout('11-04-2026 Wed 23:59:59');
  assert.equal(formatLike(lay, lay.wall + 1), '11-05-2026 Thu 00:00:00');
  assert.equal(formatLike(lay, lay.wall), '11-04-2026 Wed 23:59:59');
});

const wallAt = (T, v) => Math.floor(T + v);
const smp = (v, wall) => ({ videoS: v, wall, text: '' });

test('continuous video -> one segment, tight offset', () => {
  const T = S(2026, 11, 4, 16, 48, 24) + 0.37;
  const samples = [0, 15.2, 30.04, 45.6, 60.8, 75.9].map((v) => smp(v, wallAt(T, v)));
  const { groups, warnings } = splitSegments(samples);
  assert.equal(groups.length, 1);
  assert.equal(warnings.length, 0);
  const c = coarseOffset(groups[0]);
  assert.ok(Math.abs(c.offset - T) <= c.uncertainty + 1e-9);
  assert.ok(c.uncertainty < 0.5);
});

test('clock jump -> two segments', () => {
  const T1 = 1000, T2 = 1300;
  const samples = [0, 15, 30].map((v) => smp(v, wallAt(T1, v))).concat([45, 60, 75].map((v) => smp(v, wallAt(T2, v))));
  const { groups, warnings } = splitSegments(samples);
  assert.deepEqual(groups.map((g) => g.length), [3, 3]);
  assert.ok(warnings.some((w) => w.includes('nhảy')));
});

test('single OCR error dropped', () => {
  const samples = [0, 15, 30, 45].map((v) => smp(v, wallAt(1000, v)));
  samples[2] = smp(30, wallAt(4600, 30));
  const { groups, warnings } = splitSegments(samples);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 3);
  assert.ok(warnings.some((w) => w.includes('đọc sai')));
});

test('toVideo roundtrip and gap', () => {
  const base = S(2026, 11, 4, 16, 0, 0);
  const r = new SyncResult({
    durationS: 100,
    segments: [
      { videoStart: 0, videoEnd: 40, offset: base, uncertainty: 0.02, method: 'ocr+tick', nSamples: 3 },
      { videoStart: 45, videoEnd: 100, offset: base + 300, uncertainty: 0.02, method: 'ocr+tick', nSamples: 4 },
    ],
  });
  assert.ok(Math.abs(r.toVideo(base + 10).videoS - 10) < 1e-6);
  assert.ok(Math.abs(r.toVideo(base + 350).videoS - 50) < 1e-6);
  const gap = r.toVideo(base + 120);
  assert.equal(gap.videoS, null);
  assert.match(gap.note, /nhảy/);
});
