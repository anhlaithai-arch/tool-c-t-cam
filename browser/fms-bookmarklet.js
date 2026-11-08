// Bookmarklet chạy TRONG trang FMS (spx.shopee.vn) mà người dùng đang đăng nhập.
// Lý do: API tracking_info / danh sách TO có lớp chống bot, chỉ nhận yêu cầu từ trình duyệt thật đang mở FMS
// (gọi từ máy chủ GAS bị chặn 403, action_type 2). Bookmarklet dùng chính phiên của trình duyệt, KHÔNG đọc/gửi cookie đi đâu.
//
// Việc làm: hỏi mã đơn + hub -> tracking_info -> TO = dòng [TO...] cuối cùng tại hub -> danh sách đơn của TO (ctime = giờ quét)
// -> copy bảng TSV "Mã vận đơn | Thời gian quét | Mã bao" vào bộ nhớ tạm để dán vào trang Đếm.
// Hàm này được trang Đếm nhúng thành link "javascript:" (toString), nên KHÔNG được dùng import/biến ngoài.
export function fmsBookmarklet() {
  (async () => {
    const HUB_KEY = 'demkien.hub';
    if (!/spx\.shopee\.vn$/.test(location.hostname)) { alert('Mở trang FMS (spx.shopee.vn) rồi bấm lại nút này.'); return; }
    const order = (prompt('Mã đơn cần đếm:', '') || '').trim().toUpperCase();
    if (!order) return;
    const hub = (prompt('Hub (đúng tên trên FMS, để trống = TO cuối cùng):', localStorage.getItem(HUB_KEY) || '') || '').trim();
    localStorage.setItem(HUB_KEY, hub);
    const get = async (u) => {
      const r = await fetch(u, { credentials: 'include', headers: { Accept: 'application/json' } });
      const j = await r.json();
      if (j.retcode !== 0) throw new Error(j.message || ('retcode ' + j.retcode));
      return j.data;
    };
    const local = (s) => new Date(s * 1000).toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
    try {
      const d = await get('/api/fleet_order/order/detail/tracking_info?shipment_id=' + encodeURIComponent(order));
      const ev = [];
      (function walk(a) { (a || []).forEach((e) => { if (e.timestamp && e.status !== -1) ev.push(e); walk(e.children); }); })(d.tracking_list);
      ev.sort((a, b) => a.timestamp - b.timestamp);
      const withTo = ev.filter((e) => /\[(TO\w+)\]/.test(e.message || '') && (!hub || (e.station_name || '').toLowerCase() === hub.toLowerCase()));
      if (!withTo.length) {
        const st = [...new Set(ev.filter((e) => /\[TO/.test(e.message || '')).map((e) => e.station_name))].join('\n');
        alert('Không thấy TO của đơn tại hub "' + hub + '".\nCác hub có TO:\n' + st);
        return;
      }
      const last = withTo[withTo.length - 1];
      const to = /\[(TO\w+)\]/.exec(last.message)[1];
      const rows = [];
      for (let page = 1; page <= 50; page++) {
        const t = await get('/api/in-station/general_to/outbound/order/search?to_number=' + to + '&pageno=' + page + '&count=100');
        const list = t.list || [];
        list.forEach((x) => rows.push([x.shipment_id, x.ctime ? local(x.ctime) : '', to]));
        if (list.length < 100 || (t.total && rows.length >= t.total)) break;
      }
      const tsv = ['Mã vận đơn\tThời gian quét\tMã bao', ...rows.map((r) => r.join('\t'))].join('\n');
      let copied = false;
      try { await navigator.clipboard.writeText(tsv); copied = true; } catch (e) { /* trình duyệt chặn clipboard */ }
      if (!copied) { prompt('Copy bảng dưới đây (Ctrl+C) rồi dán vào trang Đếm:', tsv); return; }
      alert('Đã copy ' + rows.length + ' đơn của ' + to + ' tại ' + last.station_name + '.\nSang trang Đếm, bấm vào ô dữ liệu FMS và dán (Ctrl+V).');
    } catch (e) {
      alert('Lỗi lấy dữ liệu FMS: ' + (e && e.message || e));
    }
  })();
}

/** Logic thuần để kiểm thử: chọn TO tại hub từ danh sách sự kiện đã trải phẳng. */
export function pickToAtHub(events, hub) {
  const withTo = events.filter((e) => /\[(TO\w+)\]/.test(e.message || '') && (!hub || (e.station_name || '').toLowerCase() === hub.toLowerCase()));
  if (!withTo.length) return null;
  const last = withTo[withTo.length - 1];
  return { to: /\[(TO\w+)\]/.exec(last.message)[1], station: last.station_name };
}
