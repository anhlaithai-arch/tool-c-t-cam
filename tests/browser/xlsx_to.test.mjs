// Đọc file phiếu TO thật của FMS (.xlsx). Cần data/fms/transport_list_*.xlsx (không commit: dữ liệu đơn hàng thật).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { readXlsx } from '../../browser/core/xlsx.mjs';
import { loadScans, orderPosition } from '../../browser/core/fms.mjs';

const dir = new URL('../../data/fms/', import.meta.url);
const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^transport_list.*\.xlsx$/.test(f)) : [];

test('read real FMS TO export', { skip: !files.length && 'thiếu data/fms/transport_list_*.xlsx' }, async () => {
  const buf = readFileSync(new URL(files[0], dir));
  const sheets = await readXlsx(buf, async (d) => inflateRawSync(d));
  const r = loadScans(sheets[0].rows);
  assert.deepEqual(r.errors, []);
  assert.match(r.bag, /^TO\d{8}/);
  const total = Number(r.meta['total orders']);
  assert.equal(r.scans.length, total, 'số đơn khớp "Total Orders"');
  const sorted = [...r.scans].sort((a, b) => a.time - b.time);
  const p = orderPosition(r.scans, sorted[4].order);
  assert.equal(p.index, 5);
  assert.equal(p.total, total);
  console.log(`${files[0]}: ${r.bag}, ${r.scans.length} đơn, ${r.scans.filter((s) => s.journey && s.journey !== 'Forward').length} đơn không phải Forward`);
});
