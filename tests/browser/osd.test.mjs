// Kiểm thử OCR đồng hồ trên khung hình thật. Cần data/fixtures/osd_sample.json
// (tạo bằng: python -m app.tools.osd_fixture data/video/sample.mp4 data/sync/<video>.json data/fixtures/osd_sample.json).
// Không có file thì bỏ qua (dữ liệu video không commit).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fitGrid, buildTemplates, readOsd } from '../../browser/core/osd.mjs';

const FIX = new URL('../../data/fixtures/osd_sample.json', import.meta.url);
const have = existsSync(FIX);

test('OSD template OCR on real frames', { skip: !have && 'thiếu data/fixtures/osd_sample.json' }, () => {
  const fx = JSON.parse(readFileSync(FIX, 'utf8'));
  const [, , w, h] = fx.roi;
  const img = (s) => ({ w, h, data: new Uint8Array(Buffer.from(s.b64, 'base64')) });

  const first = fx.bootstrap[0];
  const grid = fitGrid(img(first), first.text);
  assert.ok(grid, 'không dò được lưới ký tự');

  const tpl = buildTemplates(grid, fx.bootstrap.map((s) => ({ img: img(s), text: s.text })));
  assert.deepEqual(tpl.missing, [], 'thiếu mẫu chữ số: ' + tpl.missing.join(','));

  let correct = 0, accepted = 0, wrongAccepted = [];
  for (const s of fx.eval) {
    const r = readOsd(img(s), grid, tpl);
    if (r.ok) accepted++;
    if (r.text === s.text) correct++;
    else if (r.ok) wrongAccepted.push({ t: s.t, got: r.text, want: s.text, minScore: r.minScore, minMargin: r.minMargin });
  }
  console.log(`grid x0=${grid.x0.toFixed(2)} pitch=${grid.pitch} y=${grid.y0}-${grid.y1}; ` +
    `đúng ${correct}/${fx.eval.length}, tự chấp nhận ${accepted}/${fx.eval.length}, chấp nhận nhưng sai ${wrongAccepted.length}`);
  assert.deepEqual(wrongAccepted, [], 'không được chấp nhận kết quả đọc sai');
  assert.ok(accepted / fx.eval.length >= 0.95, 'tỷ lệ tự chấp nhận thấp');
});
