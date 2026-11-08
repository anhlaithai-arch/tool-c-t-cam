// Kiểm thử phần tách dữ liệu FMS trong gas/Code.js (chạy Code.js trong vm với Utilities giả).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../../gas/Code.js', import.meta.url), 'utf8');
const ctx = {
  Utilities: {
    formatDate: (d, tz) => {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
      return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
    },
  },
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

// Rút gọn từ JSON tracking_info người dùng gửi (bỏ tên người)
const ev = (ts, station, message, status = 1) => ({ timestamp: ts, status, station_name: station, message, children: [] });
const tracking = [
  ev(1793758024, '', 'hello', 0),
  { ...ev(1793758025, '10-VPC Vinh Tuong Hub', 'Parcel assigned to Assignment Task [PT20261104Y0Q65]', 658), children: [
    ev(1793776308, '10-VPC Vinh Tuong Hub', 'Parcel received by pickup hub', 42),
    ev(1793776309, '10-VPC Vinh Tuong Hub', 'Parcel packing into TO [TO20261104FW96R]', 43),
    ev(1793776467, '10-VPC Vinh Tuong Hub', 'Parcel packed into TO [TO20261104FW96R]', 44),
    ev(1793795467, '10-VPC Vinh Tuong Hub', 'Parcel [TO20261104FW96R] added into LH Task [LT0QB452OGHV1]', 46),
    ev(1793804874, '10-VPC Vinh Tuong Hub', 'Parcel [TO20261104FW96R] transported to [BN A Mega SOC]', 48),
  ] },
  { ...ev(1793801130, 'BN A Mega SOC', '[TO20261104FW96R] arrived at [BN A Mega SOC] via Linehaul Trip [LT0QB452OGHV1]', 882), children: [
    ev(1793806165, 'BN A Mega SOC', 'Parcel packing into TO [TO20261104GFXSW]', 9),
    ev(1793806170, 'BN A Mega SOC', 'Parcel packed into TO [TO20261104GFXSW]', 33),
    { timestamp: 1793806460, status: -1, station_name: '', message: '', children: [] },
    ev(1793825013, 'BN A Mega SOC', 'Parcel [TO20261104GFXSW] transported to [20-HNI Thanh Xuan Hub]', 36),
  ] },
  { ...ev(1793951756, 'BN A Mega SOC', '[TO20261106I06L0] arrived at [BN A Mega SOC]', 882), children: [
    ev(1793954031, 'BN A Mega SOC', 'Parcel packing into TO [TO20261106ID3G8]', 9),
    ev(1793971560, 'BN A Mega SOC', 'Parcel [TO20261106ID3G8] transported to [20-HNI Ha Dong 12 Hub]', 36),
  ] },
];

test('TO tại hub = dòng [TO...] cuối cùng ở hub đó; giờ quét = packing into TO', () => {
  const events = ctx.fmsFlatten_(tracking);
  const r = ctx.fmsToAtStation_(events, '10-VPC Vinh Tuong Hub');
  assert.equal(r.to, 'TO20261104FW96R');
  assert.equal(r.scanSource, 'packing into TO');
  assert.equal(ctx.fmsLocalIso_(r.scanTs), '2026-11-04T14:11:49');
  const b = ctx.fmsToAtStation_(events, 'bn a mega soc'); // không phân biệt hoa thường
  assert.equal(b.to, 'TO20261106ID3G8');
  assert.equal(ctx.fmsLocalIso_(b.scanTs), '2026-11-06T15:33:51');
  assert.equal(ctx.fmsToAtStation_(events, 'Hub không có'), null);
  assert.equal(ctx.fmsToAtStation_(events, '').to, 'TO20261106ID3G8'); // không chọn hub -> TO cuối cùng
});

test('dò trường mã đơn / giờ trong danh sách TO', () => {
  const a = ctx.fmsPickOrder_({ shipment_id: 'SPXVN1', ctime: 1793776309 });
  assert.equal(a.order, 'SPXVN1'); assert.equal(a.time, '2026-11-04T14:11:49'); assert.equal(a.timeKey, 'ctime');
  assert.equal(ctx.fmsPickOrder_({ shipment_id: 'X', scan_time: 1793776309000 }).time, '2026-11-04T14:11:49');
  assert.equal(ctx.fmsPickOrder_({ tracking_number: 'Y', scan_time: '2026-11-07 15:47:54' }).time, '2026-11-07T15:47:54');
  assert.equal(ctx.fmsPickOrder_({ shipment_id: 'Z' }).time, null);
});
