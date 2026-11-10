import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, eventFeatures, labelOf, train, predict } from '../../browser/core/learn.mjs';
import fs from 'node:fs';
import vm from 'node:vm';

const vector = (peakAct, positive) => eventFeatures({
  ev: { startS: 1, endS: 2, peakS: 1.5, kind: 'drop' },
  scan: { times: [1, 1.5, 2], act: [peakAct, peakAct, peakAct] },
  ai: { res: { decision: positive ? 1 : 0, score: 0.9, trail: [] } },
});
const samples = Array.from({ length: 200 }, (_, i) => {
  const y = i % 2;
  return { x: vector(y ? 0.7 + (i % 7) * 0.02 : 0.1 + (i % 5) * 0.02, y), y, bag: 'bag-' + Math.floor(i / 10) };
});

test('eventFeatures: thứ tự, one-hot, cửa sổ thời gian và giá trị hữu hạn', () => {
  const x = eventFeatures({ ev: { startS: 1, endS: 2, peakS: 1.5, kind: 'occlusion' },
    scan: { times: [0, 1, 1.5, 2, 3], act: [99, 0.2, 0.6, 0.4, 99], parcel: [99, 0.1, 0.8, 0.2, 99] },
    ai: { res: { decision: null, score: 0.3, trail: [[1, 2]] } }, match: { lag: -12, doubt: true } });
  assert.equal(x.length, FEATURES.length);
  assert.equal(FEATURES.length, 19);
  assert.ok(x.every(Number.isFinite));
  assert.equal(x[0], 1); assert.equal(x[1], 0.6); assert.ok(Math.abs(x[2] - 0.4) < 1e-10);
  assert.deepEqual(x.slice(3), [0, 1, 0, 0.8, 0, 0, 1, 0.3, 1, 10, 1, 1, 0, 0, 0, 0]);
  const absent = eventFeatures({ ev: { kind: 'weak' } });
  assert.ok(absent.every(Number.isFinite));
  assert.deepEqual(absent.slice(7, 10), [0, 0, 0]);
  assert.deepEqual(absent.slice(12), [10, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(vector(0.8, true).slice(7, 10), [1, 0, 0]);
  assert.deepEqual(vector(0.1, false).slice(7, 10), [0, 1, 0]);
  assert.deepEqual(['bo_vao', 'sai', 'khong_kien', 'khong_ro', undefined].map(labelOf), [1, 0, 0, null, null]);
});

test('warning features encode other, throw, fall and ambiguous warnings independently', () => {
  assert.deepEqual(FEATURES.slice(-4), ['aiOther', 'aiThrow', 'aiFall', 'aiWarn']);
  for (const [kind, warning, expected] of [
    ['packer', false, [0,0,0,0]], ['other', true, [1,0,0,1]],
    ['throw', true, [0,1,0,1]], ['fall', true, [0,0,1,1]],
    ['unknown', true, [0,0,0,1]], ['unknown', false, [0,0,0,0]],
  ]) {
    assert.deepEqual(eventFeatures({ev: {}, ai: {res: {kind, warning}}}).slice(-4), expected);
  }
  const legacy = {features: FEATURES.slice(0,15)};
  assert.throws(() => predict(legacy, vector(0.8,true)), /Mô hình cũ, hãy huấn luyện lại/);
});

test('train: dữ liệu tách được, predict đơn điệu, xác định và học lại toàn bộ', () => {
  const m = train(samples), again = train(samples);
  assert.ok(m.metrics.acc >= 0.9); assert.ok(m.metrics.f1 >= 0.9);
  assert.equal(m.metrics.n, 200); assert.equal(m.metrics.nPos, 100); assert.equal(m.metrics.nNeg, 100);
  assert.equal(m.metrics.nVal, samples.filter((s) => {
    let h = 0; for (const c of s.bag) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
    return h % 5 === 0;
  }).length);
  assert.deepEqual(m.w, again.w); assert.deepEqual(m.sd, again.sd);
  assert.ok(m.sd.every((v) => v > 0));
  assert.ok(Math.abs(m.mu[7] - 0.5) < 1e-12);
  const low = vector(0.1, true), high = vector(0.9, true);
  assert.ok(predict(m, high) > predict(m, low));
  assert.ok(predict(m, low) >= 0 && predict(m, high) <= 1);
  assert.ok(!Number.isNaN(Date.parse(m.trainedAt)));
  assert.throws(() => predict({ ...m, features: [...FEATURES].reverse() }, low), /Mô hình cũ, hãy huấn luyện lại/);
});

test('train: ít mẫu, một lớp, vector sai và fallback kiểm tra 20% cuối', () => {
  assert.throws(() => train(samples.slice(0, 19)), /Cần ít nhất 20 mẫu có cả đúng và sai/);
  assert.throws(() => train(samples.filter((s) => s.y)), /Cần ít nhất 20 mẫu có cả đúng và sai/);
  assert.throws(() => train(samples.map((s) => ({ ...s, x: [NaN] }))), /Đặc trưng mẫu không hợp lệ/);
  const m = train(samples.map((s) => ({ ...s, bag: 'same' })));
  assert.equal(m.metrics.nVal, 40);
  assert.ok(m.metrics.acc >= 0.9);
});

test('GAS: nâng tiêu đề cũ, phân trang đặc trưng không đọc Drive, lưu/đọc mô hình', () => {
  const headers = ['id', 'label', 'corrected', 'bag', 'order', 'index', 'camera', 'videoFile', 'videoTimeS', 'scanVideoS', 'roi', 'signal', 'offset', 'files', 'reviewer', 'updatedAt'];
  const row = (id, label, features) => [id, label, '', 'bag', '', '', '', '', '', '', '', '', '', '', '', '', features];
  // Code.js nhận vector đủ FEATURES.length (19) đặc trưng.
  const legacyVector = (peak, positive) => vector(peak, positive);
  const rows = [headers, row('a', 'bo_vao', JSON.stringify(legacyVector(0.8, true))), row('b', 'khong_ro', JSON.stringify(legacyVector(0.2, false))), row('c', 'sai', 'invalid'), row('d', 'sai', JSON.stringify(legacyVector(0.1, false)))];
  const sheet = {
    getLastColumn: () => headers.length, getLastRow: () => rows.length,
    getRange: (r, c, n = 1, d = 1) => ({ getValues: () => rows.slice(r - 1, r - 1 + n).map((v) => Array.from({ length: d }, (_, j) => v[c - 1 + j] ?? '')),
      setValue(v) { rows[r - 1][c - 1] = v; return this; }, setFontWeight() { return this; } }),
  };
  const history = [], props = new Map([['RESULT_SHEET_ID', 'sheet']]);
  const ctx = vm.createContext({ SpreadsheetApp: { openById: () => ({ getSheetByName: (name) => name === 'MauHuanLuyen' ? sheet : null,
    insertSheet: () => ({ appendRow: (r) => history.push(r), getLastRow: () => history.length }) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k), setProperty: (k, v) => props.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }, Session: { getActiveUser: () => ({ getEmail: () => 'reviewer@example.com' }) } });
  vm.runInContext(fs.readFileSync(new URL('../../gas/Code.js', import.meta.url), 'utf8'), ctx);
  const first = ctx.uiTrainingFeatures(0, 2);
  assert.equal(headers.at(-1), 'features'); assert.equal(first.next, 2); assert.equal(first.samples.length, 1);
  const last = ctx.uiTrainingFeatures(first.next, 2000);
  assert.equal(last.next, null); assert.equal(last.samples[0].id, 'd'); assert.equal(last.samples.length, 1);
  assert.equal(ctx.uiGetModel(), null);
  const model = train(samples);
  assert.equal(ctx.uiSaveModel(model).version, 1);
  assert.equal(history[0][1], 'reviewer@example.com');
  assert.equal(JSON.stringify(ctx.uiGetModel()), JSON.stringify(model));
  assert.throws(() => ctx.uiSaveModel({ ...model, w: [] }), /Mô hình không hợp lệ/);
});
