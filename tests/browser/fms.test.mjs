import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTable, detectColumns, parseTime, loadScans, orderPosition, matchScansToEvents, estimateOffset } from '../../browser/core/fms.mjs';
import { toSec } from '../../browser/core/clock.mjs';

const TSV = [
  'Mã vận đơn\tThời gian quét\tMã bao',
  'SPXVN001\t04/11/2026 16:55:10\tBAG-A',
  'SPXVN002\t04/11/2026 16:55:30\tBAG-A',
  'spxvn003\t04/11/2026 16:55:20\tBAG-B',
  'SPXVN004\t04/11/2026 16:56:00\tBAG-A',
  'SPXVN002\t04/11/2026 16:57:00\tBAG-A',
].join('\n');

test('parse TSV/CSV with quotes', () => {
  assert.deepEqual(parseTable('a,b\n"x, y",2'), [['a', 'b'], ['x, y', '2']]);
  assert.equal(parseTable(TSV)[0][2], 'Mã bao');
});

test('detect columns by Vietnamese/English headers', () => {
  assert.deepEqual(detectColumns(['Mã vận đơn', 'Thời gian quét', 'Mã bao']), { order: 0, time: 1, bag: 2 });
  assert.deepEqual(detectColumns(['Bag ID', 'Tracking No', 'Scan time']), { order: 1, time: 2, bag: 0 });
});

test('parse many time formats', () => {
  const want = toSec(2026, 11, 4, 16, 55, 54);
  assert.equal(parseTime('2026-11-04 16:55:54'), want);
  assert.equal(parseTime('04/11/2026 16:55:54'), want);
  assert.equal(parseTime('11/04/2026 16:55:54', false), want);
  assert.equal(parseTime('16:55:54 04/11/2026'), want);
  assert.equal(parseTime('rác'), null);
});

test('order position in bag by scan time, case-insensitive, duplicates', () => {
  const { scans, errors } = loadScans(parseTable(TSV));
  assert.deepEqual(errors, []);
  const p = orderPosition(scans, 'spxvn002');
  assert.equal(p.bag, 'BAG-A');
  assert.equal(p.index, 2);
  assert.equal(p.total, 3);
  assert.equal(p.duplicates, 1);
  assert.equal(orderPosition(scans, 'SPXVN003').total, 1);
  assert.equal(orderPosition(scans, 'KHONGCO'), null);
});

test('match scans to drop events in order, no reuse', () => {
  const scanV = [{ order: 'A', v: 10 }, { order: 'B', v: 20 }, { order: 'C', v: 22 }];
  const ev = [{ id: 'e1', peakS: 12 }, { id: 'e2', peakS: 23 }, { id: 'e3', peakS: 25 }, { id: 'x', peakS: 60 }];
  const m = matchScansToEvents(scanV, ev);
  assert.deepEqual(m.map((r) => r.event?.id), ['e1', 'e2', 'e3']);
});

test('estimate clock offset between FMS and camera', () => {
  const scanV = [0, 7, 15, 22, 31, 40].map((v, i) => ({ order: 'o' + i, v }));
  const ev = scanV.map((s, i) => ({ id: 'e' + i, peakS: s.v + 37 + 2 })); // camera lệch +37s, thả sau quét 2s
  const r = estimateOffset(scanV, ev, { lo: -60, hi: 60 });
  assert.equal(r.hits, 6);
  assert.ok(r.offset >= 35 && r.offset <= 39, 'offset ' + r.offset);
});
