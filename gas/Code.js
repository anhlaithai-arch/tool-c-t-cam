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
  'scanVideoS', 'roi', 'signal', 'offset', 'files', 'reviewer', 'updatedAt', 'features'];
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
  var headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), TRAIN_COLUMNS.length)).getValues()[0];
  TRAIN_COLUMNS.forEach(function (c, i) {
    if (headers.indexOf(c) < 0) sh.getRange(1, i + 1).setValue(c).setFontWeight('bold');
  });
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
    rec.features = Array.isArray(sample.features) && sample.features.length && sample.features.every(function (v) { return typeof v === 'number' && isFinite(v); }) ? JSON.stringify(sample.features) : '';
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

/**
 * Xuất mẫu đã lưu (cả nhóm) để huấn luyện, theo trang: dòng thứ offset..offset+limit-1 của sheet (bỏ 'khong_ro').
 * Trả {total (số dòng sheet), next (offset trang sau | null), samples: [{...cột sheet, roi: object, frames: [dataURL JPEG]}]}.
 * Trang Đếm ghép các trang thành file {format: 'dem-kien-train/1', samples} cho app/tools/build_dataset.py.
 */
function uiExportTrainingSamples(offset, limit) {
  var sh = getTrainSheet_();
  var total = Math.max(0, sh.getLastRow() - 1);
  offset = Math.max(0, Number(offset) || 0);
  limit = Math.max(1, Math.min(50, Number(limit) || 30));
  if (offset >= total) return { total: total, next: null, samples: [] };
  var cnt = Math.min(limit, total - offset);
  var rows = sh.getRange(2 + offset, 1, cnt, TRAIN_COLUMNS.length).getValues();
  var samples = [];
  rows.forEach(function (r) {
    var s = {};
    TRAIN_COLUMNS.forEach(function (c, i) { s[c] = r[i]; });
    if (!s.id || s.label === 'khong_ro') return;
    s.id = String(s.id); s.order = String(s.order); s.bag = String(s.bag);
    s.corrected = s.corrected === true || String(s.corrected).toUpperCase() === 'TRUE';
    try { s.roi = JSON.parse(s.roi || 'null'); } catch (e) { s.roi = null; }
    var ids = [];
    try { ids = JSON.parse(s.files || '[]'); } catch (e) { ids = []; }
    delete s.files;
    try {
      s.frames = ids.map(function (fid) {
        return 'data:image/jpeg;base64,' + Utilities.base64Encode(DriveApp.getFileById(fid).getBlob().getBytes());
      });
    } catch (e) { return; } // ảnh đã bị xóa trên Drive: bỏ mẫu
    if (s.frames.length) samples.push(s);
  });
  return { total: total, next: offset + cnt < total ? offset + cnt : null, samples: samples };
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

/** Chỉ đọc các số đặc trưng, không truy cập ảnh Drive. Offset tính theo dòng sheet. */
function uiTrainingFeatures(offset, limit) {
  var sh = getTrainSheet_(), total = Math.max(0, sh.getLastRow() - 1);
  offset = Math.max(0, Math.floor(Number(offset) || 0));
  limit = Math.max(1, Math.min(2000, Math.floor(Number(limit) || 2000)));
  if (offset >= total) return { total: total, next: null, samples: [] };
  var cnt = Math.min(limit, total - offset), samples = [];
  sh.getRange(2 + offset, 1, cnt, TRAIN_COLUMNS.length).getValues().forEach(function (r) {
    var s = {};
    TRAIN_COLUMNS.forEach(function (c, i) { s[c] = r[i]; });
    if (!s.id || TRAIN_LABELS.indexOf(s.label) < 0 || s.label === 'khong_ro') return;
    var x;
    try { x = JSON.parse(s.features || 'null'); } catch (e) { return; }
    if (!Array.isArray(x) || x.length !== 19 || !x.every(function (v) { return typeof v === 'number' && isFinite(v); })) return;
    samples.push({ id: String(s.id), label: s.label, bag: String(s.bag), features: x });
  });
  return { total: total, next: offset + cnt < total ? offset + cnt : null, samples: samples };
}

function uiSaveModel(model) {
  if (!model || !Array.isArray(model.features) || !model.features.length ||
      !model.features.every(function (v) { return typeof v === 'string'; }) ||
      !Array.isArray(model.w) || model.w.length !== model.features.length ||
      !model.w.every(function (v) { return typeof v === 'number' && isFinite(v); }) ||
      !Array.isArray(model.mu) || !Array.isArray(model.sd) ||
      model.mu.length !== model.w.length || model.sd.length !== model.w.length ||
      !model.mu.every(function (v) { return typeof v === 'number' && isFinite(v); }) ||
      !model.sd.every(function (v) { return typeof v === 'number' && isFinite(v) && v > 0; }) ||
      typeof model.b !== 'number' || !isFinite(model.b) ||
      typeof model.thr !== 'number' || !isFinite(model.thr) || model.thr < 0 || model.thr > 1 || !model.metrics) throw new Error('Mô hình không hợp lệ');
  var json = JSON.stringify(model), lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.openById(prop_('RESULT_SHEET_ID'));
    var sh = ss.getSheetByName('MoHinh') || ss.insertSheet('MoHinh');
    sh.appendRow([new Date().toISOString(), Session.getActiveUser().getEmail(), model.metrics.n,
      model.metrics.acc, model.metrics.f1, model.thr, json]);
    PropertiesService.getScriptProperties().setProperty('DROP_MODEL', json);
    return { ok: true, version: sh.getLastRow() };
  } finally { lock.releaseLock(); }
}

function uiGetModel() {
  var json = prop_('DROP_MODEL');
  return json ? JSON.parse(json) : null;
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
  // Mặc định gửi cookie TỐI GIẢN (G1/G2) + chỉ header Accept, giống script admin của người dùng đang chạy được.
  // G3 (tùy chọn): chuỗi Cookie đầy đủ từ trình duyệt; chỉ dùng để thử lại khi cách tối giản bị 403.
  var full = String(sh.getRange('G3').getValue() || '').trim().replace(/^cookie:\s*/i, '');
  var uid = String(sh.getRange('G1').getValue() || '').trim(), uk = String(sh.getRange('G2').getValue() || '').trim();
  var mini = uid && uk ? 'spx_uid=' + uid + '; spx_uk=' + uk + '; spx_st=1; spx_cid=VN' : '';
  if (!mini && !(full.indexOf('=') > 0)) throw new Error('Tab "' + sh.getName() + '" thiếu G1 (spx_uid) hoặc G2 (spx_uk)');
  return { mini: mini, full: full.indexOf('=') > 0 ? full : '' };
}

/** Yêu cầu FMS. alt=false: cookie tối giản + Accept (mặc định); alt=true: cookie đầy đủ G3 + header trình duyệt. */
function fmsRequest_(path, cookie, alt) {
  var c = typeof cookie === 'string' ? { mini: cookie, full: '' } : cookie;
  if (alt && c.full) {
    return { url: FMS_BASE + path, muteHttpExceptions: true, followRedirects: false, headers: {
      Cookie: c.full, Accept: 'application/json, text/plain, */*', Referer: FMS_BASE + '/', Origin: FMS_BASE, 'X-Requested-With': 'XMLHttpRequest' } };
  }
  return { url: FMS_BASE + path, muteHttpExceptions: true, followRedirects: false, headers: { Cookie: c.mini || c.full, Accept: 'application/json' } };
}

/** Đoạn đầu nội dung trả về (để biết FMS từ chối vì gì); không chứa cookie. */
function fmsBodySnippet_(res) {
  try { return String(res.getContentText() || '').replace(/\s+/g, ' ').slice(0, 300); } catch (e) { return ''; }
}

function fmsParse_(res, what) {
  var code = res.getResponseCode();
  if (code === 401 || code === 403) {
    throw new Error('FMS từ chối (' + code + ') khi ' + what + '. FMS trả: ' + (fmsBodySnippet_(res) || '(rỗng)') +
      ' — chạy fmsDiagnose() trong trình soạn thảo để so với API admin đang dùng được.');
  }
  if (code !== 200) throw new Error('FMS lỗi HTTP ' + code + ' khi ' + what + ': ' + fmsBodySnippet_(res));
  var j = JSON.parse(res.getContentText());
  if (j.retcode !== 0 && j.retcode !== undefined) throw new Error('FMS báo lỗi khi ' + what + ': ' + (j.message || j.retcode));
  return j.data;
}

function fmsFetch_(path, what, cookie) {
  var last;
  for (var attempt = 1; attempt <= 3; attempt++) {
    try { return fmsParse_(UrlFetchApp.fetch(FMS_BASE + path, fmsRequest_(path, cookie)), what); }
    catch (e) {
      last = e;
      if (/từ chối/.test(String(e.message))) {
        // cách tối giản bị 403 -> thử một lần bằng cookie đầy đủ (nếu có G3)
        if (cookie && cookie.full) return fmsParse_(UrlFetchApp.fetch(FMS_BASE + path, fmsRequest_(path, cookie, true)), what);
        throw e;
      }
      Utilities.sleep(500 * attempt);
    }
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
  // ctime = giờ quét vào TO (đã đối chiếu: trùng cột Scan Time của file TO xuất từ FMS). Không dùng mtime/receive_time.
  var tKeys = ['ctime', 'scan_time', 'packed_time', 'packing_time', 'operate_time', 'operation_time', 'create_time', 'add_time'];
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
 * Bản ghi đơn từ API admin tracking/list (chạy được từ GAS; tracking_info bị FMS chặn 403 chống bot).
 */
function fmsOrderRecord_(code, cookie) {
  var d = fmsFetch_('/api/admin/order/soc/tracking/list?shipment_id=' + encodeURIComponent(code) + '&count=5&page_no=1', 'tra đơn ' + code, cookie);
  var list = (d && d.list) || [];
  var rec = list.filter(function (x) { return String(x.shipment_id || '').toUpperCase() === code; })[0];
  if (!rec) throw new Error('FMS không thấy đơn ' + code);
  return rec;
}

/** Mọi mã TO xuất hiện trong bản ghi đơn (current_to_number và các trường khác nếu có), giữ thứ tự gặp. */
function fmsTosInRecord_(rec) {
  var seen = {}, out = [];
  (JSON.stringify(rec).match(/TO\d{8}[A-Z0-9]{4,6}/g) || []).forEach(function (t) { if (!seen[t]) { seen[t] = 1; out.push(t); } });
  return out;
}

/** Thông tin TO (trang 1 của API danh sách TO): station đóng TO (sender), nơi đến, giờ quét của đơn nếu có ở trang 1. */
function fmsToInfos_(tos, code, cookie) {
  if (!tos.length) return [];
  var res = UrlFetchApp.fetchAll(tos.map(function (to) {
    return fmsRequest_('/api/in-station/general_to/outbound/order/search?to_number=' + encodeURIComponent(to) + '&pageno=1&count=100', cookie);
  }));
  return tos.map(function (to, i) {
    try {
      var d = fmsParse_(res[i], 'lấy TO ' + to) || {};
      var mine = ((d.list || []).map(fmsPickOrder_).filter(function (x) { return x.order.toUpperCase() === code; })[0]) || {};
      return { to: to, station: String(d.sender || '').trim(), dest: String(d.dest_station_name || ''), status: String(d.status || ''),
        total: d.total || null, scanTime: mine.time || null };
    } catch (e) { return { to: to, station: '', error: String(e.message || e) }; }
  });
}

/**
 * Hành trình đơn (tracking_info) -> mỗi station có dòng [TO...]: TO cuối cùng tại station + giờ "packing into TO".
 * Trả {ok:false, error} nếu FMS chặn để nơi gọi lùi về API admin.
 */
function fmsTrackingStations_(code, cookie) {
  try {
    var d = fmsFetch_('/api/fleet_order/order/detail/tracking_info?shipment_id=' + encodeURIComponent(code), 'tra hành trình ' + code, cookie);
    var ev = fmsFlatten_(d && d.tracking_list);
    var stations = fmsStations_(ev).map(function (s) {
      var r = fmsToAtStation_(ev, s);
      return r ? { station: r.station, to: r.to, scanTime: r.scanTs ? fmsLocalIso_(r.scanTs) : null, lastMessage: r.lastMessage } : null;
    }).filter(Boolean);
    return { ok: true, stations: stations, allStations: fmsStations_(ev) };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 200) };
  }
}

// ---------------------------------------------------------------------------
// Gọi FMS qua Cloudflare Worker của người dùng (FMS chặn yêu cầu gửi thẳng từ GAS).
// POST {type: 'tracking' | 'outbound', items: [mã], cookie} — theo script thử của người dùng (2026-11-10).
// URL ghi đè được bằng Script Property WORKER_URL.
// ---------------------------------------------------------------------------
var DEFAULT_WORKER_URL = 'https://catcam.laithaianhcn59vnua.workers.dev/';
var WORKER_VERSION = 'tracking-station-outbound-v1';

function fmsWorker_(type, id, cookie) {
  var url = prop_('WORKER_URL') || DEFAULT_WORKER_URL;
  var res;
  try {
    res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', muteHttpExceptions: true, followRedirects: false,
      payload: JSON.stringify({ type: type, items: [id], cookie: cookie.mini || cookie.full }) });
  } catch (e) { throw new Error('Không gọi được Worker (' + url + '): ' + e.message); }
  var code = res.getResponseCode(), d = null;
  try { d = JSON.parse(res.getContentText()); } catch (e) { /* không phải JSON */ }
  if (d && d.error === 'INVALID_SPX_COOKIE') throw new Error('Cookie FMS hết hạn/sai — cập nhật G1 (spx_uid), G2 (spx_uk) ở tab cookie.');
  if (code !== 200 || !d) throw new Error('Worker lỗi HTTP ' + code + (d && d.error ? ': ' + d.error : '') + ' khi ' + type + ' ' + id);
  if (d.error) throw new Error('Worker báo lỗi khi ' + type + ' ' + id + ': ' + d.error);
  return d;
}

/** API 1: mã đơn -> các station có TO [{station, to, scanTime, record}] theo thứ tự Worker trả. */
function fmsWorkerStations_(code, cookie) {
  var d = fmsWorker_('tracking', code, cookie);
  if (d.worker_version && d.worker_version !== WORKER_VERSION) {
    throw new Error('Worker đang chạy bản "' + d.worker_version + '", cần "' + WORKER_VERSION + '" — deploy lại SPX_Tracking_Worker.js.');
  }
  if (d.success !== true || !Array.isArray(d.columns) || !Array.isArray(d.results)) throw new Error('Worker trả dữ liệu tracking không đúng dạng');
  var hit = d.results.filter(function (x) { return x && String(x.id).toUpperCase() === code; })[0];
  var rows = (hit && hit.rows) || [];
  var timeCol = d.columns.filter(function (c) { return /scan|time/i.test(c); })[0];
  return rows.map(function (r) {
    var rec = {};
    d.columns.forEach(function (c, i) { rec[c] = r[i]; });
    var t = timeCol ? rec[timeCol] : null;
    if (t && /^\d{10,13}$/.test(String(t))) { var n = Number(t); t = fmsLocalIso_(n > 1e12 ? Math.floor(n / 1000) : n); }
    return { station: String(rec.station_name || '').trim(), to: String(rec.TO_number || '').trim(), scanTime: t ? String(t).replace(' ', 'T').slice(0, 19) : null, record: rec };
  }).filter(function (s) { return s.station && s.to; });
}

/** API 2: TO -> mọi đơn trong TO kèm giờ quét (ctime), sắp theo giờ quét. */
function fmsWorkerToOrders_(to, cookie) {
  var d = fmsWorker_('outbound', to, cookie);
  if (d.status !== 'OK' || !d.data || !Array.isArray(d.data.list)) throw new Error('Worker không trả danh sách đơn của ' + to + ' (' + (d.status || 'không rõ') + ')');
  var by = {};
  d.data.list.forEach(function (o) {
    var id = String((o && o.fleet_order_id) || '').trim().toUpperCase();
    if (!id) return;
    var t = Number(o.ctime) || 0;
    if (!by[id] || t > by[id].ctime) by[id] = { order: id, ctime: t }; // đơn quét lại: lấy lần mới nhất (như script thử)
  });
  var items = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return (a.ctime || 9e12) - (b.ctime || 9e12); });
  items.forEach(function (x) { x.time = x.ctime > 0 ? fmsLocalIso_(x.ctime) : null; });
  var total = Number(d.data.total);
  return { items: items, total: isFinite(total) && total >= items.length ? total : items.length, dest: String(d.data.dest_station_name || '') };
}

/**
 * Giao diện: bắn mã đơn -> các station đã đóng đơn vào TO (qua Worker).
 * Người dùng chọn station rồi gọi uiFmsFetch.
 */
function uiFmsStations(orderCode) {
  var code = String(orderCode || '').trim().toUpperCase();
  if (!code) throw new Error('Thiếu mã đơn');
  var cookie = fmsCookie_();
  var ws = fmsWorkerStations_(code, cookie);
  return { order: code, stations: ws, allStations: ws.map(function (s) { return s.station; }), currentStation: '', source: 'worker', errors: [] };
}

/** Bản cũ: gọi FMS thẳng từ GAS (bị chặn 403), giữ lại để thử. */
function uiFmsStationsDirect(orderCode) {
  var code = String(orderCode || '').trim().toUpperCase();
  if (!code) throw new Error('Thiếu mã đơn');
  var cookie = fmsCookie_();
  var tr = fmsTrackingStations_(code, cookie);
  if (tr.ok) return { order: code, stations: tr.stations, allStations: tr.allStations, currentStation: '', source: 'tracking_info', errors: [] };
  var rec = fmsOrderRecord_(code, cookie);
  var infos = fmsToInfos_(fmsTosInRecord_(rec), code, cookie);
  var cur = String(rec.current_station_name || '');
  return { order: code, stations: infos.filter(function (x) { return x.station; }), allStations: cur ? [cur] : [], currentStation: cur,
    source: 'admin (tracking_info lỗi: ' + tr.error + ')',
    errors: infos.filter(function (x) { return x.error; }).map(function (x) { return x.to + ': ' + x.error; }),
    recordFields: Object.keys(rec).filter(function (k) { return /to_|station|_to$/i.test(k); }) };
}

/**
 * Giao diện ("Export TO"): TO của đơn tại station đã chọn (API 1) -> mọi đơn trong TO kèm giờ quét (API 2), qua Worker.
 * Đơn quét đầu = đơn đầu tiên bỏ vào bao (bắt đầu đếm); đơn quét cuối = đơn cuối (dừng đếm).
 */
function uiFmsFetch(orderCode, station) {
  var code = String(orderCode || '').trim().toUpperCase();
  if (!code) throw new Error('Thiếu mã đơn');
  var cookie = fmsCookie_();
  var st = String(station || '').trim().toLowerCase();
  var ws = fmsWorkerStations_(code, cookie);
  var hit = ws.filter(function (x) { return x.station.toLowerCase() === st; }).pop();
  if (!hit) return { ok: false, order: code, message: 'Không thấy TO của đơn tại station "' + station + '". Station có TO: ' +
    (ws.map(function (x) { return x.station + ' (' + x.to + ')'; }).join(', ') || 'không có') };
  var l = fmsWorkerToOrders_(hit.to, cookie);
  var rows = l.items.map(function (x) { return [x.order, x.time || '', hit.to]; });
  var mine = rows.filter(function (r) { return r[0] === code; })[0];
  if (!mine) rows.push([code, hit.scanTime || '', hit.to]);
  var timed = l.items.filter(function (x) { return x.time; });
  return { ok: true, order: code, to: hit.to, station: hit.station, dest: l.dest, scanTime: mine && mine[1] ? mine[1] : hit.scanTime, lastMessage: '',
    header: ['Mã đơn', 'Thời gian quét', 'Mã bao'], rows: rows, total: rows.length, apiTotal: l.total,
    first: timed.length ? { order: timed[0].order, time: timed[0].time } : null,
    last: timed.length ? { order: timed[timed.length - 1].order, time: timed[timed.length - 1].time } : null,
    missingTime: rows.filter(function (r) { return !r[1]; }).length, source: 'Worker (ctime)', listFields: [] };
}

/** Bản cũ: gọi FMS thẳng từ GAS (bị chặn 403), giữ lại để thử. */
function uiFmsFetchDirect(orderCode, station) {
  var code = String(orderCode || '').trim().toUpperCase();
  if (!code) throw new Error('Thiếu mã đơn');
  var cookie = fmsCookie_();
  var st = String(station || '').trim().toLowerCase();
  var tr = fmsTrackingStations_(code, cookie);
  var hit = tr.ok ? tr.stations.filter(function (x) { return x.station.toLowerCase() === st; })[0] : null;
  if (hit) {
    var l = fmsToOrders_(hit.to, cookie);
    var rs = l.items.map(function (x) { return [x.order, x.time || '', hit.to]; });
    var mn = rs.filter(function (r) { return r[0].toUpperCase() === code; })[0];
    if (!mn) rs.push([code, hit.scanTime || '', hit.to]);
    return { ok: true, order: code, to: hit.to, station: hit.station, scanTime: mn && mn[1] ? mn[1] : hit.scanTime, lastMessage: hit.lastMessage || '',
      header: ['Mã đơn', 'Thời gian quét', 'Mã bao'], rows: rs, total: rs.length,
      missingTime: rs.filter(function (r) { return !r[1]; }).length, source: 'danh sách TO', listFields: l.fields };
  }
  if (tr.ok) return { ok: false, order: code, message: 'Không thấy TO của đơn tại station "' + station + '". Station có TO: ' +
    (tr.stations.map(function (x) { return x.station + ' (' + x.to + ')'; }).join(', ') || 'không có') };
  var infos = fmsToInfos_(fmsTosInRecord_(fmsOrderRecord_(code, cookie)), code, cookie).filter(function (x) { return x.station; });
  var me = infos.filter(function (x) { return !st || x.station.toLowerCase() === st; }).pop();
  if (!me) return { ok: false, order: code, message: 'Không thấy TO của đơn tại station "' + station + '". Station tìm được: ' +
    (infos.map(function (x) { return x.station + ' (' + x.to + ')'; }).join(', ') || 'không có') };
  var list = fmsToOrders_(me.to, cookie);
  var rows = list.items.map(function (x) { return [x.order, x.time || '', me.to]; });
  var mine = rows.filter(function (r) { return r[0].toUpperCase() === code; })[0];
  if (!mine) rows.push([code, me.scanTime || '', me.to]);
  return { ok: true, order: code, to: me.to, station: me.station, scanTime: mine ? mine[1] : me.scanTime, lastMessage: '',
    header: ['Mã đơn', 'Thời gian quét', 'Mã bao'], rows: rows, total: rows.length,
    missingTime: rows.filter(function (r) { return !r[1]; }).length, source: 'danh sách TO', listFields: list.fields };
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

/**
 * Chẩn đoán FMS: chạy trong trình soạn thảo Apps Script (Run > fmsDiagnose), xem Execution log.
 * Gọi 3 API bằng cùng cookie và in mã HTTP + đoạn đầu nội dung (KHÔNG in cookie):
 *  1. API admin mà script cũ của người dùng đang chạy được
 *  2. tracking_info của một đơn
 *  3. danh sách đơn trong TO
 */
/**
 * Dò API thay cho tracking_info (bị FMS chặn 403 từ GAS): tìm API nào trả TO / hành trình theo mã đơn.
 * Chạy trong trình soạn thảo, gửi Execution log cho Claude (không in cookie).
 */
function fmsProbe(orderCode) {
  var cookie = fmsCookie_();
  var c = encodeURIComponent(orderCode || 'SPXVN06627964263B');
  var paths = [
    '/api/admin/order/soc/tracking/list?shipment_id=' + c + '&count=5&page_no=1',
    '/api/admin/order/soc/tracking/list?shipment_ids=' + c + '&count=5&page_no=1',
    '/api/admin/order/soc/tracking/list?keyword=' + c + '&count=5&page_no=1',
    '/api/in-station/general_to/outbound/order/search?shipment_id=' + c + '&pageno=1&count=10',
    '/api/in-station/general_to/outbound/search?shipment_id=' + c + '&pageno=1&count=10',
    '/api/in-station/general_to/outbound/list?shipment_id=' + c + '&pageno=1&count=10',
    '/api/fleet_order/order/detail?shipment_id=' + c,
    '/api/admin/order/soc/tracking/detail?shipment_id=' + c,
    '/api/admin/order/detail/tracking_info?shipment_id=' + c,
  ];
  var res = UrlFetchApp.fetchAll(paths.map(function (p) { return fmsRequest_(p, cookie); }));
  return paths.map(function (p, i) {
    var line = p.split('?')[0] + '?' + p.split('?')[1].split('&')[0].split('=')[0] + ' -> HTTP ' + res[i].getResponseCode() +
      ' | ' + String(res[i].getContentText() || '').replace(/\s+/g, ' ').slice(0, 700);
    Logger.log(line);
    return line;
  });
}

function fmsDiagnose(orderCode, toNumber) {
  var cookie = fmsCookie_();
  var code = orderCode || 'SPXVN06309459535B', to = toNumber || 'TO20261104FW96R';
  var paths = [
    ['admin tracking/list (script cũ)', '/api/admin/order/soc/tracking/list?order_status=1&count=1&page_no=1&station_type=2'],
    ['tracking_info', '/api/fleet_order/order/detail/tracking_info?shipment_id=' + encodeURIComponent(code)],
    ['danh sách TO', '/api/in-station/general_to/outbound/order/search?to_number=' + encodeURIComponent(to) + '&pageno=1&count=10'],
  ];
  var out = paths.map(function (p) {
    var res = UrlFetchApp.fetch(FMS_BASE + p[1], fmsRequest_(p[1], cookie));
    var line = p[0] + ': HTTP ' + res.getResponseCode() + ' | ' + fmsBodySnippet_(res);
    Logger.log(line);
    return line;
  });
  Logger.log('Cookie gồm các khóa: ' + (cookie.mini || cookie.full).split(';').map(function (x) { return x.split('=')[0].trim(); }).join(', '));
  return out;
}


/**
 * Thử luồng trang Đếm ngay trong trình soạn thảo: mã đơn -> station -> TO -> danh sách đơn trong TO.
 * Kèm in các trường của bản ghi admin có chứa TO/station để biết API có giữ TO cũ không.
 */
function testFms(orderCode) {
  var code = orderCode || 'SPXVN06210282080B';
  var cookie = fmsCookie_();
  var rec = fmsOrderRecord_(code, cookie);
  Object.keys(rec).forEach(function (k) {
    var v = JSON.stringify(rec[k]);
    if (/to|station|hub|time/i.test(k) || /TO\d{8}/.test(v)) Logger.log('rec.%s = %s', k, v.slice(0, 200));
  });
  var s = uiFmsStations(code);
  Logger.log('STATIONS: %s', JSON.stringify(s));
  s.stations.forEach(function (x) {
    var r = uiFmsFetch(code, x.station);
    Logger.log('FETCH %s: ok=%s to=%s total=%s missingTime=%s scan=%s | 3 dòng đầu: %s | %s', x.station, r.ok, r.to, r.total,
      r.missingTime, r.scanTime, JSON.stringify((r.rows || []).slice(0, 3)), r.message || '');
  });
}

/**
 * Thử tracking_info với nhiều cách gửi (cookie tối giản như script admin của người dùng / cookie đầy đủ G3, có/không header trình duyệt).
 * Không in cookie.
 */
function testTracking(orderCode) {
  var code = orderCode || 'SPXVN06210282080B';
  var ss = SpreadsheetApp.openById(prop_('FMS_COOKIE_SHEET_ID') || DEFAULT_FMS_COOKIE_SHEET_ID);
  var gid = Number(prop_('FMS_COOKIE_GID') || DEFAULT_FMS_COOKIE_GID);
  var sh = ss.getSheets().filter(function (x) { return x.getSheetId() === gid; })[0];
  var uid = String(sh.getRange('G1').getValue() || '').trim(), uk = String(sh.getRange('G2').getValue() || '').trim();
  var full = String(sh.getRange('G3').getValue() || '').trim().replace(/^cookie:\s*/i, '');
  var mini = 'spx_uid=' + uid + '; spx_uk=' + uk + '; spx_st=1; spx_cid=VN';
  var url = FMS_BASE + '/api/fleet_order/order/detail/tracking_info?shipment_id=' + encodeURIComponent(code);
  var browser = { Referer: FMS_BASE + '/', Origin: FMS_BASE, 'X-Requested-With': 'XMLHttpRequest' };
  function h(cookie, extra) { var o = { Cookie: cookie, Accept: 'application/json' }; for (var k in (extra || {})) o[k] = extra[k]; return o; }
  var cases = [
    ['A cookie tối giản G1/G2, chỉ Accept (như script admin)', h(mini)],
    ['B cookie tối giản + header trình duyệt', h(mini, browser)],
    ['C cookie đầy đủ G3, chỉ Accept', full ? h(full) : null],
    ['D cookie đầy đủ G3 + header trình duyệt (cách hiện tại)', full ? h(full, browser) : null],
  ];
  cases.forEach(function (c) {
    if (!c[1]) { Logger.log('%s: bỏ qua (G3 trống)', c[0]); return; }
    var r = UrlFetchApp.fetch(url, { headers: c[1], muteHttpExceptions: true, followRedirects: false });
    var body = String(r.getContentText() || '').replace(/\s+/g, ' ');
    var tos = (body.match(/TO\d{8}[A-Z0-9]{5}/g) || []).filter(function (t, i, a) { return a.indexOf(t) === i; });
    Logger.log('%s: HTTP %s | TO thấy: %s | %s', c[0], r.getResponseCode(), tos.join(', ') || '-', body.slice(0, 160));
  });
}
