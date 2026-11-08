// Build logic trình duyệt thành gas/LogicBundle.html (window.CountingApp) cho GAS,
// và dist/dem.html, dist/index.html để chạy thử local (không cần GAS).
//   node scripts/build-browser.mjs
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const r = await build({
  entryPoints: [join(root, 'browser/entry.mjs')],
  bundle: true, format: 'iife', globalName: 'CountingApp', target: ['chrome110', 'edge110'],
  write: false, legalComments: 'none', charset: 'utf8',
});
let js = r.outputFiles[0].text;
// không để chuỗi đóng thẻ script lọt vào trong <script>
js = js.replace(/<\/script/gi, '<\\/script');
const bundle = `<!-- FILE SINH TỰ ĐỘNG từ browser/ bằng scripts/build-browser.mjs. KHÔNG SỬA TAY. -->\n<script>\n${js}</script>\n`;
writeFileSync(join(root, 'gas/LogicBundle.html'), bundle);

// Bản local: thay scriptlet GAS bằng giá trị rỗng
mkdirSync(join(root, 'dist'), { recursive: true });
const local = (file, vars) => {
  let html = readFileSync(join(root, 'gas', file), 'utf8');
  html = html.replace("<?!= include('LogicBundle') ?>", bundle);
  for (const [k, v] of Object.entries(vars)) html = html.split(`<?= ${k} ?>`).join(v);
  if (/<\?/.test(html)) throw new Error(`${file}: còn scriptlet GAS chưa thay`);
  writeFileSync(join(root, 'dist', file.toLowerCase()), html);
};
local('Dem.html', { baseUrl: '' });
local('Index.html', { demUrl: 'dem.html' });
console.log(`LogicBundle.html: ${(bundle.length / 1024).toFixed(1)} KB; dist/dem.html, dist/index.html`);
