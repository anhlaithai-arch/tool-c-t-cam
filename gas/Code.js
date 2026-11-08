/**
 * Webapp: bắn mã đơn, tra giờ packing, nhận và hiển thị kết quả đếm kiện.
 * Hợp đồng API: docs/KIEN_TRUC_WEBAPP.md
 *
 * Lần đầu: chạy setup() trong trình soạn thảo Apps Script, rồi Deploy > Web app
 * (Execute as: Me, Who has access: Anyone). setup() in ra API_TOKEN trong Log (chỉ dùng cho app Python).
 * Không có khóa nhóm (bỏ 2026-11-09): ai có link webapp đều dùng được.
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
  if (!p.getProperty('RESULT_SHEET_ID')) p.setProperty('RESULT_SHEET_ID', DEFAULT_RESULT_SHEET_ID);
  if (!p.getProperty('TRAIN_FOLDER_ID')) {
    p.setProperty('TRAIN_FOLDER_ID', DriveApp.createFolder('Du lieu huan luyen dem kien').getId());
  }
  if (!p.getProperty('EVIDENCE_FOLDER_ID')) {
    p.setProperty('EVIDENCE_FOLDER_ID', DriveApp.createFolder('Bang chung dem kien').getId());
  }
  getResultSheet_();
  Logger.log('API_TOKEN=%s', p.getProperty('API_TOKEN'));
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
function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || '';
  var base = ScriptApp.getService().getUrl();
  var t;
  if (page === 'dem') {
    t = HtmlService.createTemplateFromFile('Dem');
    t.baseUrl = base;
    return t.evaluate().setTitle('Đếm kiện vào bao')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  t = HtmlService.createTemplateFromFile('Index');
  t.demUrl = base + '?page=dem';
  return t.evaluate().setTitle('Đếm kiện - tra cứu')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Dùng trong template: <?!= include('LogicBundle') ?> */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function uiSearch(query) {
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

function uiGetResult(id) {
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

/** Trang Đếm kiện lưu kết quả đánh dấu (cùng cấu trúc bản ghi với API submitResult). */
function uiSaveMark(record) {
  return submitResult_(record || {});
}

/** Trang Đếm kiện tải ảnh bằng chứng (từng ảnh một). */
function uiUploadEvidence(data) {
  return uploadEvidence_(data || {});
}

// ---------------------------------------------------------------------------
// Dữ liệu huấn luyện: mẫu đã duyệt từ trang Đếm (3 ảnh nhỏ quanh miệng bao + nhãn)
// ---------------------------------------------------------------------------
var TRAIN_SHEET_NAME = 'MauHuanLuyen';
var TRAIN_COLUMNS = ['id', 'label', 'corrected', 'bag', 'order', 'index', 'camera', 'videoFile', 'videoTimeS',
  'scanVideoS', 'roi', 'signal', 'offset', 'files', 'reviewer', 'updatedAt'];
var TRAIN_LABELS = ['bo_vao', 'sai', 'khong_ro', 'khong_kien'];

function getTrainSheet_() {
  var ss = SpreadsheetApp.openById(prop_('RESULT_SHEET_ID'));
  var sh = ss.getSheetByName(TRAIN_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(TRAIN_SHEET_NAME);
    sh.getRange(1, 1, 1, TRAIN_COLUMNS.length).setValues([TRAIN_COLUMNS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@');
    sh.getRange('E:E').setNumberFormat('@');
  }
  return sh;
}

function trainFolderFor_(bag) {
  var root = DriveApp.getFolderById(prop_('TRAIN_FOLDER_ID'));
  var name = String(bag || 'KHONG_RO').replace(/[^\w\-]/g, '_');
  var it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

/** Lưu một mẫu (ghi đè theo id): images = [{name, base64}] (JPEG nhỏ). */
function uiSaveTrainingSample(sample, images) {
  if (!sample || !sample.id) throw new Error('Thiếu id mẫu');
  if (TRAIN_LABELS.indexOf(sample.label) < 0) throw new Error('Nhãn không hợp lệ: ' + sample.label);
  if (!images || !images.length || images.length > 6) throw new Error('Cần 1-6 ảnh mỗi mẫu');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = getTrainSheet_();
    var folder = trainFolderFor_(sample.bag);
    var ids = images.map(function (im, i) {
      var bytes = Utilities.base64Decode(im.base64);
      if (bytes.length > 2 * 1024 * 1024) throw new Error('Ảnh mẫu quá lớn');
      var name = String(sample.id) + '_' + (im.name || ('f' + i)) + '.jpg';
      return folder.createFile(Utilities.newBlob(bytes, 'image/jpeg', name)).getId();
    });
    var n = sh.getLastRow(), row = -1, oldFiles = [];
    if (n >= 2) {
      var hit = sh.getRange(2, 1, n - 1, 1).createTextFinder(String(sample.id)).matchEntireCell(true).findNext();
      if (hit) {
        row = hit.getRow();
        try { oldFiles = JSON.parse(sh.getRange(row, TRAIN_COLUMNS.indexOf('files') + 1).getValue() || '[]'); } catch (e) { oldFiles = []; }
      }
    }
    var email = '';
    try { email = Session.getActiveUser().getEmail(); } catch (e) { /* không có quyền đọc email */ }
    var rec = {};
    TRAIN_COLUMNS.forEach(function (c) { rec[c] = sample[c]; });
    rec.roi = JSON.stringify(sample.roi || null);
    rec.files = JSON.stringify(ids);
    rec.reviewer = email;
    rec.updatedAt = new Date().toISOString();
    var vals = [TRAIN_COLUMNS.map(function (c) { var v = rec[c]; return v === undefined || v === null ? '' : v; })];
    if (row > 0) sh.getRange(row, 1, 1, TRAIN_COLUMNS.length).setValues(vals);
    else sh.appendRow(vals[0]);
    oldFiles.forEach(function (fid) { try { DriveApp.getFileById(fid).setTrashed(true); } catch (e) { /* đã mất */ } });
    return { ok: true, id: sample.id, files: ids.length, replaced: row > 0 };
  } finally {
    lock.releaseLock();
  }
}

/** Thống kê số mẫu theo nhãn. */
function uiTrainingStats() {
  var sh = getTrainSheet_();
  var n = sh.getLastRow();
  var out = { total: 0, bo_vao: 0, sai: 0, khong_ro: 0, khong_kien: 0 };
  if (n < 2) return out;
  sh.getRange(2, 2, n - 1, 1).getValues().forEach(function (r) { out.total++; out[r[0]] = (out[r[0]] || 0) + 1; });
  return out;
}

// ---------------------------------------------------------------------------
// Tự lấy dữ liệu FMS (SPX) bằng cookie trong sheet "🔐Cookies🔑" (G1 = spx_uid, G2 = spx_uk) của spreadsheet kết quả
// (hoặc spreadsheet FMS_COOKIE_SHEET_ID). Webapp chạy dưới tài khoản người deploy -> mọi người dùng chung cookie đó.
// ---------------------------------------------------------------------------
var FMS_BASE = 'https://spx.shopee.vn';
var FMS_TZ = 'Asia/Ho_Chi_Minh';

// Nơi để cookie (người dùng chỉ định 2026-11-09): spreadsheet "Phân quyền", tab gid 845565709, G1 = spx_uid, G2 = spx_uk.
// Ghi đè được bằng Script Properties FMS_COOKIE_SHEET_ID / FMS_COOKIE_GID.
var DEFAULT_FMS_COOKIE_SHEET_ID = '1eKffcHMQlS_YXPiAOXeDdH1tlSqMCgdPB1GDCQYMGSE';
var DEFAULT_FMS_COOKIE_GID = 845565709;

function fmsCookie_() {
  var ss = SpreadsheetApp.openById(prop_('FMS_COOKIE_SHEET_ID') || DEFAULT_FMS_COOKIE_SHEET_ID);
  var gid = Number(prop_('FMS_COOKIE_GID') || DEFAULT_FMS_COOKIE_GID);
  var sh = ss.getSheets().filter(function (x) { return x.getSheetId() === gid; })[0] ||
    ss.getSheetByName('Phân quyền') || ss.getSheetByName('🔐Cookies🔑');
  if (!sh) throw new Error('Không thấy tab chứa cookie (gid ' + gid + ' / "Phân quyền")');
  var uid = String(sh.getRange('G1').getValue() || '').trim(), uk = String(sh.getRange('G2').getValue() || '').trim();
  if (!uid || !uk) throw new Error('Tab "' + sh.getName() + '" thiếu G1 (spx_uid) hoặc G2 (spx_uk)');
  return 'spx_uid=' + uid + '; spx_uk=' + uk + '; spx_st=1; spx_cid=VN';
}

function fmsRequest_(path, cookie) {
  return { url: FMS_BASE + path, headers: { Cookie: cookie, Accept: 'application/json' }, muteHttpExceptions: true };
}

function fmsParse_(res, what) {
  var code = res.getResponseCode();
  if (code === 401 || code === 403) throw new Error('FMS từ chối (' + code + ') – cookie hết hạn? Cập nhật G1/G2 tab "Phân quyền".');
  if (code !== 200) throw new Error('FMS lỗi HTTP ' + code + ' khi ' + what);
  var j = JSON.parse(res.getContentText());
  if (j.retcode !== 0 && j.retcode !== undefined) throw new Error('FMS báo lỗi khi ' + what + ': ' + (j.message || j.retcode));
  return j.data;
}

function fmsFetch_(path, what, cookie) {
  var last;
  for (var attempt = 1; attempt <= 3; attempt++) {
    try { return fmsParse_(UrlFetchApp.fetch(FMS_BASE + path, fmsRequest_(path, cookie)), what); }
    catch (e) { last = e; if (/từ chối/.test(String(e.message))) throw e; Utilities.sleep(500 * attempt); }
  }
  throw last;
}

/** Trải phẳng tracking_list (cả children), sắp theo thời gian. */
function fmsFlatten_(list) {
  var out = [];
  (function walk(arr) {
    (arr || []).forEach(function (e) {
      if (e && e.timestamp && e.status !== -1) out.push({ ts: Number(e.timestamp), status: e.status, station: String(e.station_name || ''), message: String(e.message || '') });
      if (e && e.children && e.children.length) walk(e.children);
    });
  })(list);
  out.sort(function (a, b) { return a.ts - b.ts; });
  return out;
}

function fmsLocalIso_(ts) {
  return Utilities.formatDate(new Date(ts * 1000), FMS_TZ, "yyyy-MM-dd'T'HH:mm:ss");
}

/**
 * TO của đơn tại một hub: dòng trạng thái CUỐI CÙNG tại hub đó có "[TO...]" (vd "Parcel [TO...] added into LH Task").
 * Giờ quét = thời điểm "Parcel packing into TO [TO]" tại hub (dự phòng: "packed into TO").
 * station rỗng -> lấy hub của dòng có [TO...] cuối cùng trong toàn bộ hành trình.
 */
function fmsToAtStation_(events, station) {
  var st = String(station || '').trim().toLowerCase();
  var withTo = events.filter(function (e) { return /\[(TO\w+)\]/.test(e.message) && (!st || e.station.toLowerCase() === st); });
  if (!withTo.length) return null;
  var last = withTo[withTo.length - 1];
  var to = /\[(TO\w+)\]/.exec(last.message)[1];
  var at = last.station;
  var packing = events.filter(function (e) { return e.station === at && e.message.indexOf('packing into TO [' + to + ']') >= 0; });
  var packed = events.filter(function (e) { return e.station === at && e.message.indexOf('packed into TO [' + to + ']') >= 0; });
  var scan = packing.length ? packing[packing.length - 1] : (packed.length ? packed[packed.length - 1] : null);
  return { to: to, station: at, lastMessage: last.message, lastTs: last.ts, scanTs: scan ? scan.ts : null,
    scanSource: packing.length ? 'packing into TO' : (packed.length ? 'packed into TO' : '') };
}

function fmsStations_(events) {
  var seen = {}, out = [];
  events.forEach(function (e) { if (e.station && !seen[e.station]) { seen[e.station] = 1; out.push(e.station); } });
  return out;
}

/** Tra một đơn: TO tại hub + giờ quét. */
function fmsLookupOrder_(code, station, cookie) {
  var d = fmsFetch_('/api/fleet_order/order/detail/tracking_info?shipment_id=' + encodeURIComponent(code), 'tra đơn ' + code, cookie);
  var ev = fmsFlatten_(d && d.tracking_list);
  var r = fmsToAtStation_(ev, station);
  return { order: code, found: !!r, to: r ? r.to : null, station: r ? r.station : null,
    scanTime: r && r.scanTs ? fmsLocalIso_(r.scanTs) : null, scanSource: r ? r.scanSource : '',
    lastMessage: r ? r.lastMessage : '', stations: fmsStations_(ev) };
}

/** Lấy mã đơn và giờ quét (nếu có) từ một dòng của API danh sách TO – dò tên trường. */
function fmsPickOrder_(it) {
  var idKeys = ['shipment_id', 'lm_tracking_number', 'tracking_number', 'order_id', 'order_sn'];
  var tKeys = ['scan_time', 'packed_time', 'packing_time', 'operate_time', 'operation_time', 'ctime', 'create_time', 'add_time', 'mtime'];
  var order = '', time = null, timeKey = '';
  for (var i = 0; i < idKeys.length; i++) if (it[idKeys[i]]) { order = String(it[idKeys[i]]).trim(); break; }
  for (var k = 0; k < tKeys.length; k++) {
    var v = it[tKeys[k]];
    if (v === undefined || v === null || v === '' || v === 0) continue;
    if (typeof v === 'number' || /^\d{10,13}$/.test(String(v))) { var n = Number(v); time = fmsLocalIso_(n > 1e12 ? Math.floor(n / 1000) : n); }
    else time = String(v).replace(' ', 'T').slice(0, 19);
    timeKey = tKeys[k];
    break;
  }
  return { order: order, time: time, timeKey: timeKey };
}

/** Lấy danh sách mã đơn trong TO (lật trang). Trả {items: [{order, time|null}], fields}. */
function fmsToOrders_(to, cookie) {
  var items = [], fields = [], count = 100;
  for (var page = 1; page <= 50; page++) {
    var d = fmsFetch_('/api/in-station/general_to/outbound/order/search?to_number=' + encodeURIComponent(to) + '&pageno=' + page + '&count=' + count, 'lấy danh sách TO ' + to, cookie);
    var list = (d && (d.list || d.order_list)) || [];
    if (!list.length) break;
    if (!fields.length) fields = Object.keys(list[0]);
    list.forEach(function (it) { items.push(fmsPickOrder_(it)); });
    var total = d.total || d.total_count;
    if (list.length < count || (total && items.length >= total)) break;
  }
  return { items: items.filter(function (x) { return x.order; }), fields: fields };
}

/**
 * Giao diện: bắn mã đơn -> các hub mà đơn có TO, theo thứ tự hành trình.
 * Mỗi hub: TO cuối cùng tại hub đó + giờ quét. Người dùng chọn hub rồi mới gọi uiFmsFetch.
 */
function uiFmsStations(orderCode) {
  var code = String(orderCode || '').trim().toUpperCase();
  if (!code) throw new Error('Thiếu mã đơn');
  var d = fmsFetch_('/api/fleet_order/order/detail/tracking_info?shipment_id=' + encodeURIComponent(code), 'tra đơn ' + code, fmsCookie_());
  var ev = fmsFlatten_(d && d.tracking_list);
  var list = fmsStations_(ev).map(function (s) {
    var r = fmsToAtStation_(ev, s);
    return r ? { station: r.station, to: r.to, scanTime: r.scanTs ? fmsLocalIso_(r.scanTs) : null } : null;
  }).filter(Boolean);
  return { order: code, stations: list, allStations: fmsStations_(ev) };
}

/** Giao diện: bắn mã đơn -> TO tại hub + danh sách mọi đơn trong TO kèm giờ quét (bảng như file TO). */
function uiFmsFetch(orderCode, station) {
  var code = String(orderCode || '').trim().toUpperCase();
  if (!code) throw new Error('Thiếu mã đơn');
  var cookie = fmsCookie_();
  var st = String(station || prop_('FMS_STATION') || '').trim();
  var me = fmsLookupOrder_(code, st, cookie);
  if (!me.found) return { ok: false, order: code, stations: me.stations, message: 'Không thấy dòng có [TO...] tại hub "' + st + '". Các hub của đơn: ' + me.stations.join(', ') };
  var list = fmsToOrders_(me.to, cookie);
  var source = 'danh sách TO';
  var need = list.items.filter(function (x) { return !x.time; });
  if (need.length) {
    // danh sách TO không có giờ -> tra từng đơn (song song theo lô 10)
    source = 'tracking từng đơn';
    for (var i = 0; i < need.length; i += 10) {
      var batch = need.slice(i, i + 10);
      var res = UrlFetchApp.fetchAll(batch.map(function (x) {
        return fmsRequest_('/api/fleet_order/order/detail/tracking_info?shipment_id=' + encodeURIComponent(x.order), cookie);
      }));
      res.forEach(function (r, j) {
        try {
          var ev = fmsFlatten_((fmsParse_(r, 'tra đơn ' + batch[j].order) || {}).tracking_list);
          var hit = ev.filter(function (e) { return e.station === me.station && e.message.indexOf('packing into TO [' + me.to + ']') >= 0; });
          if (!hit.length) hit = ev.filter(function (e) { return e.station === me.station && e.message.indexOf('packed into TO [' + me.to + ']') >= 0; });
          if (hit.length) batch[j].time = fmsLocalIso_(hit[hit.length - 1].ts);
        } catch (e) { batch[j].error = String(e.message || e); }
      });
      if (i + 10 < need.length) Utilities.sleep(200);
    }
  }
  var rows = list.items.map(function (x) { return [x.order, x.time || '', me.to]; });
  if (!rows.some(function (r) { return r[0] === code; })) rows.push([code, me.scanTime || '', me.to]);
  return { ok: true, order: code, to: me.to, station: me.station, scanTime: me.scanTime, lastMessage: me.lastMessage,
    header: ['Mã đơn', 'Thời gian quét', 'Mã bao'], rows: rows, total: rows.length,
    missingTime: rows.filter(function (r) { return !r[1]; }).length, source: source, listFields: list.fields };
}

function uiPackingTime(orderCode) {
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
    // Gửi lại cùng loại ảnh -> thay ảnh cũ, không tạo trùng.
    // Thứ tự an toàn: tạo ảnh mới -> ghi tham chiếu -> mới bỏ ảnh cũ (lỗi giữa chừng không mất bằng chứng).
    var file = folder.createFile(Utilities.newBlob(bytes, mime, name));
    var old = [], keep = [];
    (rec.evidence || []).forEach(function (ev) { (ev.kind === kind ? old : keep).push(ev); });
    keep.push({ kind: kind, fileId: file.getId() });
    rec.evidence = keep;
    rec.updatedAt = new Date().toISOString();
    try {
      sh.getRange(found.row, 1, 1, RESULT_COLUMNS.length).setValues([toRow_(rec)]);
    } catch (e) {
      try { file.setTrashed(true); } catch (e2) { /* bỏ qua */ }
      throw e;
    }
    old.forEach(function (ev) {
      try { DriveApp.getFileById(ev.fileId).setTrashed(true); } catch (e) { /* đã mất */ }
    });
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

// ---------------------------------------------------------------------------
// Dữ liệu quét FMS trên Google Sheet: dán bảng xuất từ FMS (có hàng tiêu đề: mã đơn, giờ quét, mã bao)
// vào sheet "FMS" của spreadsheet kết quả, hoặc cấu hình FMS_SHEET_ID / FMS_SHEET_NAME.
// ---------------------------------------------------------------------------
function stripVi_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
}

function fmsColumns_(header) {
  var h = header.map(stripVi_);
  function pick(hints, exclude) {
    for (var j = 0; j < hints.length; j++) {
      for (var i = 0; i < h.length; i++) if (exclude.indexOf(i) < 0 && h[i].indexOf(hints[j]) >= 0) return i;
    }
    return -1;
  }
  var bag = pick(['ma bao', 'bao', 'bag', 'tui', 'sack', 'container'], []);
  var order = pick(['ma don', 'ma van don', 'van don', 'order', 'tracking', 'awb', 'shipment', 'ma kien', 'parcel'], [bag]);
  var time = pick(['thoi gian', 'gio quet', 'scan time', 'time', 'ngay gio', 'packing', 'dong goi', 'created', 'timestamp'], [bag, order]);
  return { order: order, time: time, bag: bag };
}

/** Trả {header, rows} gồm mọi lần quét thuộc (các) bao chứa đơn này; giờ dạng yyyy-MM-ddTHH:mm:ss. */
function fmsBagRows_(orderCode) {
  var code = String(orderCode || '').trim().toUpperCase();
  if (!code) throw new Error('Thiếu mã đơn');
  var sid = prop_('FMS_SHEET_ID') || prop_('RESULT_SHEET_ID');
  var sh = SpreadsheetApp.openById(sid).getSheetByName(prop_('FMS_SHEET_NAME') || 'FMS');
  if (!sh) throw new Error('Chưa có sheet "FMS" chứa dữ liệu quét (mã đơn, giờ quét, mã bao)');
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return { header: values[0] || [], rows: [] };
  var c = fmsColumns_(values[0]);
  if (c.order < 0 || c.time < 0 || c.bag < 0) throw new Error('Sheet FMS thiếu cột mã đơn / giờ quét / mã bao');
  var bags = {};
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][c.order]).trim().toUpperCase() === code) bags[String(values[i][c.bag]).trim().toUpperCase()] = true;
  }
  var rows = [];
  for (var k = 1; k < values.length; k++) {
    var b = String(values[k][c.bag]).trim().toUpperCase();
    if (bags[b]) rows.push([String(values[k][c.order]).trim(), toIsoLocal_(values[k][c.time]), b]);
  }
  return { header: ['Mã đơn', 'Thời gian quét', 'Mã bao'], rows: rows };
}

function uiFmsBag(orderCode) {
  return fmsBagRows_(orderCode);
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
