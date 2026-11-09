import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { cardLines, cardFileName, viTime, zipFiles } from '../../browser/ordercard.mjs';

const info = { order: 'SPXVN06210282080B', index: 7, total: 28, bag: 'TO20261107JIZEQ', scanIso: '2026-11-07T14:11:49',
  camClock: '14:11:51', lagS: 1.43, camera: 'Cam 01', status: 'ok', closed: true };

test('viTime đổi ISO sang giờ ngày Việt', () => {
  assert.equal(viTime('2026-11-07T14:11:49'), '14:11:49 07/11/2026');
  assert.equal(viTime(''), '—');
});

test('cardLines có mã đơn, N/T, mã bao, giờ quét', () => {
  const l = cardLines(info);
  const by = Object.fromEntries(l.filter((x) => x.label).map((x) => [x.label, x.text]));
  assert.equal(by['MÃ ĐƠN'], 'SPXVN06210282080B');
  assert.equal(by['KIỆN THỨ'], '7/28');
  assert.equal(by['MÃ BAO'], 'TO20261107JIZEQ');
  assert.equal(by['GIỜ QUÉT (FMS)'], '14:11:49 07/11/2026');
  assert.equal(by['GIỜ TRÊN CAMERA'], '14:11:51');
  assert.equal(by['BỎ VÀO BAO SAU QUÉT'], '1.4 giây');
  assert.equal(by['TRẠNG THÁI'], 'Khớp lượt bỏ kiện');
});

test('cardLines: bao chưa chốt có dấu *, không thấy lượt -> cần kiểm tra', () => {
  const l = cardLines({ ...info, closed: false, status: 'none', lagS: null, camClock: '' });
  assert.equal(l.find((x) => x.label === 'KIỆN THỨ').text, '7/28*');
  assert.match(l.find((x) => x.label === 'TRẠNG THÁI').text, /cần kiểm tra/);
  assert.ok(!l.some((x) => x.label === 'BỎ VÀO BAO SAU QUÉT'));
  assert.ok(!l.some((x) => x.label === 'GIỜ TRÊN CAMERA'));
});

test('cardFileName an toàn', () => {
  assert.equal(cardFileName(info), 'SPXVN06210282080B_7-28_20261107141149.jpg');
  assert.equal(cardFileName({ order: 'a/b c', index: 1, total: 2 }), 'a_b_c_1-2.jpg');
});

test('zipFiles đóng gói, đổi tên trùng', () => {
  const z = zipFiles([
    { name: 'a.jpg', bytes: new Uint8Array([1, 2, 3]) },
    { name: 'a.jpg', bytes: new Uint8Array([4]) },
    { name: 'b.txt', bytes: new TextEncoder().encode('xin chào') },
  ]);
  const u = unzipSync(z);
  assert.deepEqual(Object.keys(u).sort(), ['a.jpg', 'a_2.jpg', 'b.txt']);
  assert.deepEqual([...u['a.jpg']], [1, 2, 3]);
  assert.equal(strFromU8(u['b.txt']), 'xin chào');
});
