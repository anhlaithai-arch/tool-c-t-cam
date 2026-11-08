/**
 * Webapp: bắn mã đơn, tra giờ packing, nhận và hiển thị kết quả đếm kiện.
 * Hợp đồng API: docs/KIEN_TRUC_WEBAPP.md
 *
 * Lần đầu: chạy setup() trong trình soạn thảo Apps Script, rồi Deploy > Web app
 * (Execute as: Me, Who has access: Anyone). setup() in ra API_TOKEN và VIEW_KEY trong Log.
 */

var RESULT_SHEET_NAME = 'KetQua';
// Spreadsheet người dùng chỉ định để lưu kết quả (2026-11-08).
var DEFAULT_RESULT_SHEET_ID = '1AZWK0I4AULUeV5GziXlDQ4ucHemw_aelaAneK16sjJc';
var RESULT_COLUMNS = [
  'id', 'orderCode', 'packingTime', 'sessionId', 'bagId', 'camera', 'videoFile',
  'videoTimeS', 'wallTime', 'orderIndex', 'total', 'sessionClosed', 'status',
  'note', 'evidence', 'updatedAt'
];
var VALID_STATUS = ['xac_nhan', 'can_kiem_tra', 'da_sua'];
var VALID_KIND = ['full', 'marked', 'crop'];
var MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Cài đặt
// ---------------------------------------------------------------------------
function setup() {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('API_TOKEN')) p.setProperty('API_TOKEN', Utilities.getUuid().replace(/-/g, ''));
  if (!p.getProperty('VIEW_KEY')) p.setProperty('VIEW_KEY', Utilities.getUuid().slice(0, 8));
  if (!p.getProperty('RESULT_SHEET_ID')) p.setProperty('RESULT_SHEET_ID', DEFAULT_RESULT_SHEET_ID);
  if (!p.getProperty('EVIDENCE_FOLDER_ID')) {
    p.setProperty('EVIDENCE_FOLDER_ID', DriveApp.createFolder('Bang chung dem kien').getId());
  }
  getResultSheet_();
  Logger.log('API_TOKEN=%s', p.getProperty('API_TOKEN'));
  Logger.log('VIEW_KEY=%s', p.getProperty('VIEW_KEY'));
  Logger.log('Sheet: https://docs.google.com/spreadsheets/d/%s', p.getProperty('RESULT_SHEET_ID'));
}

function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function getResultSheet_() {
  var ss = SpreadsheetApp.openById(prop_('RESULT_SHEET_ID'));
  var sh = ss.getSheetByName(RESULT_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(RESULT_SHEET_NAME);
    sh.getRange(1, 1, 1, RESULT_COLUMNS.length).setValues([RESULT_COLUMNS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@'); // id dạng chữ
    sh.getRange('B:B').setNumberFormat('@'); // mã đơn không bị đổi thành số
  }
  return sh;
}

// ---------------------------------------------------------------------------
// Giao diện
// ---------------------------------------------------------------------------
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Đếm kiện - tra cứu')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function checkViewKey_(viewKey) {
  var k = prop_('VIEW_KEY');
  if (!k || String(viewKey || '') !== k) throw new Error('Sai khóa xem');
}

function uiCheckKey(viewKey) {
  try { checkViewKey_(viewKey); return true; } catch (e) { return false; }
}

function uiSearch(viewKey, query) {
  checkViewKey_(viewKey);
  var q = String(query || '').trim().toUpperCase();
  var rows = readAll_();
  var items;
  if (!q) {
    items = rows.slice(-50).reverse();
  } else {
    var exact = rows.filter(function (r) { return String(r.orderCode).toUpperCase() === q; });
    items = exact.length ? exact : rows.filter(function (r) {
      return String(r.orderCode).toUpperCase().indexOf(q) >= 0;
    }).slice(0, 50);
  }
  return { items: items };
}

function uiGetResult(viewKey, id) {
  checkViewKey_(viewKey);
  var found = findRow_(id);
  if (!found) throw new Error('Không tìm thấy kết quả ' + id);
  var r = found.record;
  r.images = (r.evidence || []).map(function (ev) {
    try {
      var blob = DriveApp.getFileById(ev.fileId).getBlob();
      return { kind: ev.kind, dataUrl: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
    } catch (e) {
      return { kind: ev.kind, dataUrl: null, error: 'Không mở được ảnh' };
    }
  });
  return r;
}

function uiPackingTime(viewKey, orderCode) {
  checkViewKey_(viewKey);
  return { orderCode: String(orderCode || '').trim(), packingTime: lookupPackingTime_(orderCode) };
}

// ---------------------------------------------------------------------------
// API cho app Python
// ---------------------------------------------------------------------------
function doPost(e) {
  var out;
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var token = prop_('API_TOKEN');
    if (!token || body.token !== token) throw new Error('Sai token');
    var data = body.data || {};
    switch (body.action) {
      case 'ping':
        out = { ok: true, time: new Date().toISOString() };
        break;
      case 'packingTime':
        out = { ok: true, orderCode: String(data.orderCode || '').trim(), packingTime: lookupPackingTime_(data.orderCode) };
        break;
      case 'submitResult':
        out = submitResult_(data);
        break;
      case 'uploadEvidence':
        out = uploadEvidence_(data);
        break;
      default:
        throw new Error('action không hợp lệ: ' + body.action);
    }
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function submitResult_(d) {
  if (!d.id) throw new Error('Thiếu id');
  if (!d.orderCode) throw new Error('Thiếu orderCode');
  if (d.status && VALID_STATUS.indexOf(d.status) < 0) throw new Error('status không hợp lệ: ' + d.status);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = getResultSheet_();
    var found = findRow_(d.id, sh);
    var rec = found ? found.record : {};
    RESULT_COLUMNS.forEach(function (c) {
      if (c === 'evidence' || c === 'updatedAt') return; // server quản lý
      if (d[c] !== undefined) rec[c] = d[c];
    });
    rec.id = String(d.id);
    rec.evidence = rec.evidence || [];
    rec.updatedAt = new Date().toISOString();
    var rowValues = [toRow_(rec)];
    var row;
    if (found) {
      row = found.row;
      sh.getRange(row, 1, 1, RESULT_COLUMNS.length).setValues(rowValues);
    } else {
      sh.appendRow(rowValues[0]);
      row = sh.getLastRow();
    }
    return { ok: true, id: rec.id, row: row, created: !found };
  } finally {
    lock.releaseLock();
  }
}

function uploadEvidence_(d) {
  if (!d.resultId || !d.base64) throw new Error('Thiếu resultId hoặc base64');
  var kind = d.kind || 'full';
  if (VALID_KIND.indexOf(kind) < 0) throw new Error('kind không hợp lệ: ' + kind);
  var bytes = Utilities.base64Decode(d.base64);
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error('Ảnh quá lớn');
  var mime = d.mimeType || 'image/jpeg';
  if (!/^image\//.test(mime)) throw new Error('Chỉ nhận ảnh');
  var name = String(d.resultId) + '_' + kind + '_' + String(d.fileName || 'image.jpg').replace(/[^\w.\-]/g, '_');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = getResultSheet_();
    var found = findRow_(d.resultId, sh);
    if (!found) throw new Error('Chưa có kết quả ' + d.resultId + ', gửi submitResult trước');
    var folder = DriveApp.getFolderById(prop_('EVIDENCE_FOLDER_ID'));
    var rec = found.record;
    // gửi lại cùng loại ảnh -> thay ảnh cũ, không tạo trùng
    var keep = [];
    (rec.evidence || []).forEach(function (ev) {
      if (ev.kind === kind) {
        try { DriveApp.getFileById(ev.fileId).setTrashed(true); } catch (e) { /* đã mất */ }
      } else {
        keep.push(ev);
      }
    });
    var file = folder.createFile(Utilities.newBlob(bytes, mime, name));
    keep.push({ kind: kind, fileId: file.getId() });
    rec.evidence = keep;
    rec.updatedAt = new Date().toISOString();
    sh.getRange(found.row, 1, 1, RESULT_COLUMNS.length).setValues([toRow_(rec)]);
    return { ok: true, fileId: file.getId() };
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Tra giờ packing (TẠM: đọc từ Google Sheet; thay bằng hệ thống thật khi có)
// ---------------------------------------------------------------------------
function lookupPackingTime_(orderCode) {
  var code = String(orderCode || '').trim().toUpperCase();
  if (!code) return null;
  var sid = prop_('PACKING_SHEET_ID');
  if (!sid) throw new Error('Chưa cấu hình nguồn giờ packing (PACKING_SHEET_ID)');
  var sh = SpreadsheetApp.openById(sid).getSheetByName(prop_('PACKING_SHEET_NAME') || 'Sheet1');
  if (!sh) throw new Error('Không thấy sheet giờ packing');
  var codeCol = Number(prop_('PACKING_CODE_COL') || 1);
  var timeCol = Number(prop_('PACKING_TIME_COL') || 2);
  var values = sh.getDataRange().getValues();
  for (var i = values.length - 1; i >= 1; i--) { // dòng mới nhất trước
    if (String(values[i][codeCol - 1]).trim().toUpperCase() === code) {
      return toIsoLocal_(values[i][timeCol - 1]);
    }
  }
  return null;
}

function toIsoLocal_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
  }
  var s = String(v || '').trim();
  return s || null;
}

// ---------------------------------------------------------------------------
// Sheet <-> bản ghi
// ---------------------------------------------------------------------------
function readAll_(sh) {
  sh = sh || getResultSheet_();
  var n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, RESULT_COLUMNS.length).getValues().map(fromRow_);
}

function findRow_(id, sh) {
  sh = sh || getResultSheet_();
  var n = sh.getLastRow();
  if (n < 2) return null;
  var hit = sh.getRange(2, 1, n - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  if (!hit) return null;
  var row = hit.getRow();
  return { row: row, record: fromRow_(sh.getRange(row, 1, 1, RESULT_COLUMNS.length).getValues()[0]) };
}

function toRow_(rec) {
  return RESULT_COLUMNS.map(function (c) {
    var v = rec[c];
    if (c === 'evidence') return JSON.stringify(v || []);
    if (v === undefined || v === null) return '';
    return v;
  });
}

function fromRow_(vals) {
  var rec = {};
  RESULT_COLUMNS.forEach(function (c, i) {
    var v = vals[i];
    if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
    rec[c] = v;
  });
  try { rec.evidence = rec.evidence ? JSON.parse(rec.evidence) : []; } catch (e) { rec.evidence = []; }
  rec.sessionClosed = rec.sessionClosed === true || rec.sessionClosed === 'TRUE' || rec.sessionClosed === 'true';
  return rec;
}
