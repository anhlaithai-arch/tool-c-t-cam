// Đọc file .xlsx tối giản (không thư viện ngoài): giải nén ZIP + đọc sharedStrings và các sheet.
// inflateRaw(Uint8Array) -> Promise<Uint8Array> được truyền vào (trình duyệt: DecompressionStream; Node: zlib).
// Trả về [{name, rows: [[ô...]]}]; ô là chuỗi, số hoặc boolean; ô trống = ''.

const td = new TextDecoder('utf-8');

function readZip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Không phải file .xlsx hợp lệ (thiếu mục lục ZIP)');
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = {};
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Mục lục ZIP hỏng');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), cmtLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = td.decode(buf.subarray(p + 46, p + 46 + nameLen));
    const lNameLen = dv.getUint16(local + 26, true), lExtraLen = dv.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    entries[name] = { method, data: buf.subarray(start, start + csize) };
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return entries;
}

const decodeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&');

function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref);
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function textOf(xml) { // nối mọi <t>…</t> (rich text có nhiều đoạn)
  let out = '';
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += decodeXml(m[1]);
  return out;
}

export async function readXlsx(input, inflateRaw) {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  const zip = readZip(buf);
  const get = async (name) => {
    const e = zip[name];
    if (!e) return null;
    const raw = e.method === 0 ? e.data : await inflateRaw(e.data);
    return td.decode(raw);
  };
  const shared = [];
  const ss = await get('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));

  const wb = (await get('xl/workbook.xml')) || '';
  const rels = (await get('xl/_rels/workbook.xml.rels')) || '';
  const relMap = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1], target = /Target="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) relMap[id] = target.replace(/^\/?xl\//, '').replace(/^\//, '');
  }
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decodeXml(/name="([^"]*)"/.exec(m[0])?.[1] || '');
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1];
    sheets.push({ name, path: 'xl/' + (relMap[rid] || `worksheets/sheet${sheets.length + 1}.xml`) });
  }
  if (!sheets.length) sheets.push({ name: 'Sheet1', path: 'xl/worksheets/sheet1.xml' });

  const out = [];
  for (const sh of sheets) {
    const xml = await get(sh.path);
    if (!xml) continue;
    const rows = [];
    for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
      const attrs = rm[1] || rm[3] || '';
      const rIdx = (+(/\br="(\d+)"/.exec(attrs)?.[1] || rows.length + 1)) - 1;
      const row = [];
      for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const a = cm[1], body = cm[2] || '';
        const ref = /\br="([A-Z]+\d+)"/.exec(a)?.[1];
        const ci = ref ? colIndex(ref) : row.length;
        const t = /\bt="([^"]+)"/.exec(a)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let val = '';
        if (t === 's') val = shared[+v] ?? '';
        else if (t === 'inlineStr') val = textOf(body);
        else if (t === 'b') val = v === '1';
        else if (t === 'str' || t === 'e') val = v != null ? decodeXml(v) : '';
        else if (v != null) val = isFinite(Number(v)) ? Number(v) : decodeXml(v);
        while (row.length < ci) row.push('');
        row[ci] = val;
      }
      while (rows.length < rIdx) rows.push([]);
      rows[rIdx] = row;
    }
    out.push({ name: sh.name, rows: rows.map((r) => r || []) });
  }
  return out;
}

/** inflateRaw cho trình duyệt (Chrome/Edge có DecompressionStream). */
export async function browserInflateRaw(data) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
