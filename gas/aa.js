const SPX_TRACKING_CONFIG = Object.freeze({
  workerUrl: 'https://TEN-WORKER.TAI-KHOAN.workers.dev/',
  configSheet: '🔐Cookies🔑',
  testShipmentId: 'SPXVN06041770742B'
});

function getShipmentData() {
  const config = SPX_TRACKING_CONFIG;
  if (!/^https:\/\//i.test(config.workerUrl) || config.workerUrl.includes('TEN-WORKER')) {
    throw new Error('Điền URL HTTPS của Worker mới vào workerUrl.');
  }

  const active = SpreadsheetApp.getActiveSpreadsheet();
  const settings = active && active.getSheetByName(config.configSheet);
  if (!settings) throw new Error('Không tìm thấy tab ' + config.configSheet);

  const [[uid, , fullCookie], [uk]] = settings.getRange('A1:C2').getDisplayValues();
  const cookie = fullCookie.trim() || (uid.trim() && uk.trim()
    ? 'spx_uid=' + uid.trim() + '; spx_uk=' + uk.trim() + '; spx_st=1; spx_cid=VN'
    : '');
  if (!cookie) throw new Error('Nhập cookie ở C1 hoặc điền spx_uid ở A1 và spx_uk ở A2.');
  const id = config.testShipmentId;
  console.log('Bắt đầu tra tracking cho ' + id);
  const result = fetchSpxTracking_(config.workerUrl, cookie, [id]);
  const rows = result.byId.get(id);
  if (!Array.isArray(rows) || !rows.length) {
    console.log(JSON.stringify({ shipment_id: id, status: result.error || 'NO_WORKER_RESULT' }));
    return;
  }

  for (const row of rows) {
    const record = Object.fromEntries(result.columns.map((column, position) => [column, row[position]]));
    console.log(JSON.stringify(record));
  }
}

function fetchSpxTracking_(url, cookie, ids) {
  const failed = error => ({ byId: new Map(), error });
  let response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ type: 'tracking', items: ids, cookie }),
      muteHttpExceptions: true,
      followRedirects: false
    });
  } catch {
    return failed('WORKER_FETCH_FAILED');
  }

  const status = response.getResponseCode();
  let data;
  try {
    data = JSON.parse(response.getContentText());
  } catch {
    return failed(status === 200 ? 'WORKER_INVALID_JSON' : 'WORKER_HTTP_' + status);
  }
  if (status !== 200) {
    return failed(data && data.error === 'INVALID_SPX_COOKIE'
      ? 'INVALID_SPX_COOKIE'
      : 'WORKER_HTTP_' + status);
  }
  if (!data || data.success !== true || !Array.isArray(data.columns) ||
    !data.columns.includes('TO_number') || !Array.isArray(data.results)) {
    return failed('WORKER_INVALID_RESPONSE');
  }
  return {
    columns: data.columns,
    byId: new Map(data.results.filter(item => item && item.id).map(item => [item.id, item.rows]))
  };
}
