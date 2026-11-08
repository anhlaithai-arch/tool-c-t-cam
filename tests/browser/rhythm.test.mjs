import test from 'node:test';
import assert from 'node:assert/strict';
import { rhythmScore, simplePeaks, regionFromZ, dedupe } from '../../browser/core/rhythm.mjs';

test('rhythmScore: peaks following scans score high, random peaks low', () => {
  const scanV = Array.from({ length: 30 }, (_, i) => 10 + i * 2.1);
  const good = scanV.map((v) => v + 0.6 + 0.2 * Math.sin(v));
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const random = Array.from({ length: 30 }, () => 5 + rnd() * 70).sort((a, b) => a - b);
  const g = rhythmScore(scanV, good, 80), r = rhythmScore(scanV, random, 80);
  assert.equal(g.hits, 30);
  assert.ok(Math.abs(g.offset) <= 0.5);
  assert.ok(g.z > 5 && g.z > r.z + 3, `good ${g.z} random ${r.z}`);
});

test('simplePeaks + dedupe', () => {
  const t = [], s = [];
  for (let i = 0; i < 200; i++) { t.push(i * 0.08); s.push([40, 41, 100].includes(i) ? 0.3 : 0.01); }
  assert.deepEqual(simplePeaks(t, s).map((x) => Math.round(x * 100) / 100), [3.2, 8]);
  assert.deepEqual(dedupe([1, 1.2, 2, 2.9]), [1, 2, 2.9]);
});

test('regionFromZ grows best cell into neighbours above threshold', () => {
  const nx = 5, ny = 4, z = new Float64Array(nx * ny).fill(0);
  z[1 * nx + 2] = 6; z[1 * nx + 3] = 5.5; z[2 * nx + 2] = 5.2; z[3 * nx + 0] = 5.9; // ô (0,3) cao nhưng không liền kề
  const r = regionFromZ(z, nx, ny, 6, 12);
  assert.equal(r.zmax, 6);
  assert.deepEqual(r.box, { x: 12, y: 6, w: 18, h: 18 });
});
