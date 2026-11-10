// Kiểm thử luồng mã đơn -> station + TO (API 1) -> danh sách đơn của TO (API 2) qua Worker, với UrlFetchApp giả.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../../gas/Code.js', import.meta.url), 'utf8');
const calls = [];
let replies = {};
const ctx = {
  Utilities: {
    formatDate: (d, tz) => {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
      return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
    },
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
  UrlFetchApp: {
    fetch: (url, opt) => {
      const body = JSON.parse(opt.payload);
      calls.push({ url, body });
      const r = replies[body.type];
      return { getResponseCode: () => r.code ?? 200, getContentText: () => JSON.stringify(r.json) };
    },
  },
};
vm.createContext(ctx);
vm.runInContext(code, ctx);
ctx.fmsCookie_ = () => ({ mini: 'spx_uid=u; spx_uk=k; spx_st=1; spx_cid=VN', full: '' });

const plain = (x) => JSON.parse(JSON.stringify(x)); // mảng tạo trong vm khác realm
const ORDER = 'SPXVN06307979309B', TO = 'TO20261110ABCDE', HUB = '22-BNH Thuan Thanh 2 Hub';
const t0 = 1794300000; // giây
const tracking = {
  success: true, worker_version: 'tracking-station-outbound-v1', columns: ['station_name', 'TO_number'],
  results: [{ id: ORDER, rows: [['10-VPC Vinh Tuong Hub', 'TO20261109XXXXX'], [HUB, TO]] }],
};
const outbound = {
  status: 'OK',
  data: { total: 3, dest_station_name: 'BN A Mega SOC', list: [
    { fleet_order_id: 'SPXVN000000003B', ctime: t0 + 20 },
    { fleet_order_id: ORDER, ctime: t0 + 5 },
    { fleet_order_id: 'SPXVN000000001B', ctime: t0 },
    { fleet_order_id: ORDER, ctime: t0 + 7 }, // quét lại: lấy lần mới nhất
  ] },
};

test('API 1: mã đơn -> các station kèm TO', () => {
  replies = { tracking: { json: tracking } };
  const r = ctx.uiFmsStations(' spxvn06307979309b ');
  assert.deepEqual(plain(r.stations.map((s) => [s.station, s.to])), [['10-VPC Vinh Tuong Hub', 'TO20261109XXXXX'], [HUB, TO]]);
  assert.equal(calls.at(-1).body.type, 'tracking');
  assert.deepEqual(calls.at(-1).body.items, [ORDER]);
  assert.match(calls.at(-1).body.cookie, /spx_uid=u/);
});

test('Export TO: đơn sắp theo giờ quét, đơn đầu = bắt đầu đếm, đơn cuối = dừng', () => {
  replies = { tracking: { json: tracking }, outbound: { json: outbound } };
  const r = ctx.uiFmsFetch(ORDER, HUB);
  assert.equal(r.ok, true);
  assert.equal(r.to, TO);
  assert.deepEqual(calls.at(-1).body, { type: 'outbound', items: [TO], cookie: 'spx_uid=u; spx_uk=k; spx_st=1; spx_cid=VN' });
  assert.deepEqual(plain(r.rows.map((x) => x[0])), ['SPXVN000000001B', ORDER, 'SPXVN000000003B']);
  assert.equal(r.first.order, 'SPXVN000000001B');
  assert.equal(r.last.order, 'SPXVN000000003B');
  assert.equal(r.rows[1][1], ctx.fmsLocalIso_(t0 + 7));
  assert.equal(r.missingTime, 0);
});

test('Station không có TO -> báo rõ station nào có', () => {
  replies = { tracking: { json: tracking } };
  const r = ctx.uiFmsFetch(ORDER, 'Hub khác');
  assert.equal(r.ok, false);
  assert.match(r.message, /22-BNH Thuan Thanh 2 Hub \(TO20261110ABCDE\)/);
});

test('Cookie sai / Worker cũ -> lỗi dễ hiểu', () => {
  replies = { tracking: { code: 401, json: { error: 'INVALID_SPX_COOKIE' } } };
  assert.throws(() => ctx.uiFmsStations(ORDER), /Cookie FMS hết hạn/);
  replies = { tracking: { json: { ...tracking, worker_version: 'old' } } };
  assert.throws(() => ctx.uiFmsStations(ORDER), /deploy lại/);
});
