// "Cắt ảnh đơn hàng từ cam": khung hình gốc (khung vàng quanh miệng bao) + cột thông tin BÊN CẠNH
// (mã đơn, kiện N/T, mã bao, giờ quét FMS, giờ camera) để chữ không che hình. Tải về máy: 1 ảnh hoặc ZIP cả bao.
import { zipSync } from 'fflate';
import { seek } from './video.mjs';

const STATUS = {
  ok: ['Khớp lượt bỏ kiện', '#3ddc84'],
  doubt: ['Độ trễ bất thường – cần kiểm tra', '#ffb020'],
  none: ['Không thấy lượt bỏ kiện – cần kiểm tra', '#ff6b6b'],
};

/** "2026-11-07T14:11:49" -> "14:11:49 07/11/2026" */
export function viTime(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2}:\d{2})/.exec(String(iso || ''));
  return m ? `${m[4]} ${m[3]}/${m[2]}/${m[1]}` : String(iso || '—');
}

/**
 * Các dòng của cột thông tin (thuần, để kiểm thử).
 * info: {order, index, total, bag, scanIso, camClock, videoS, camera, status: 'ok'|'doubt'|'none', lagS, closed}
 */
export function cardLines(info) {
  const st = STATUS[info.status] || STATUS.none;
  const lines = [
    { label: 'MÃ ĐƠN', text: info.order || '—', size: 'big' },
    { label: 'KIỆN THỨ', text: `${info.index ?? '?'}/${info.total ?? '?'}${info.closed === false ? '*' : ''}`, size: 'big' },
    { label: 'MÃ BAO', text: info.bag || '—' },
    { label: 'GIỜ QUÉT (FMS)', text: viTime(info.scanIso) },
  ];
  if (info.camClock) lines.push({ label: 'GIỜ TRÊN CAMERA', text: info.camClock });
  if (Number.isFinite(info.lagS)) lines.push({ label: 'BỎ VÀO BAO SAU QUÉT', text: `${info.lagS.toFixed(1)} giây` });
  if (info.camera) lines.push({ label: 'CAMERA', text: info.camera });
  lines.push({ label: 'TRẠNG THÁI', text: st[0], color: st[1] });
  if (info.closed === false) lines.push({ label: '', text: '* bao chưa chốt, tổng có thể đổi', size: 'small' });
  return lines;
}

/** Tên file an toàn: <mã đơn>_<N>-<T>_<giờ quét>.jpg */
export function cardFileName(info) {
  const t = String(info.scanIso || '').replace(/[^\d]/g, '').slice(0, 14);
  const safe = (s) => String(s ?? '').replace(/[^\w-]/g, '_');
  return `${safe(info.order) || 'don'}_${safe(info.index)}-${safe(info.total)}${t ? '_' + t : ''}.jpg`;
}

function wrap(ctx, text, maxW) {
  const words = String(text).split(' '), out = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
}

/** Vẽ ảnh đơn hàng tại tS. Trả canvas. */
export async function orderCardCanvas(video, roi, tS, info) {
  await seek(video, tS);
  const W = video.videoWidth, H = video.videoHeight;
  const u = Math.max(1, H / 480); // đơn vị cỡ chữ theo độ phân giải
  const panelW = Math.round(Math.max(260, W * 0.36));
  const c = document.createElement('canvas');
  c.width = W + panelW; c.height = H;
  const g = c.getContext('2d');
  g.drawImage(video, 0, 0, W, H);
  if (roi) {
    g.strokeStyle = '#ffd400'; g.lineWidth = Math.max(2, W / 320);
    g.strokeRect(roi.x, roi.y, roi.w, roi.h);
  }
  g.fillStyle = '#10161e'; g.fillRect(W, 0, panelW, H);
  g.fillStyle = '#ffd400'; g.fillRect(W, 0, Math.max(3, u * 3), H);
  const pad = Math.round(14 * u), maxW = panelW - 2 * pad;
  let y = pad;
  for (const l of cardLines(info)) {
    if (l.label) {
      g.font = `600 ${Math.round(11 * u)}px sans-serif`; g.fillStyle = '#8fa1b3';
      y += Math.round(12 * u); g.fillText(l.label, W + pad, y); y += Math.round(4 * u);
    }
    const fs = Math.round((l.size === 'big' ? 22 : l.size === 'small' ? 11 : 15) * u);
    g.font = `${l.size === 'small' ? 400 : 700} ${fs}px sans-serif`;
    g.fillStyle = l.color || (l.size === 'big' ? '#ffd400' : '#ffffff');
    for (const part of wrap(g, l.text, maxW)) { y += fs + Math.round(2 * u); g.fillText(part, W + pad, y); }
    y += Math.round(6 * u);
  }
  return c;
}

/** Ảnh đơn hàng dạng dataURL JPEG. */
export async function orderCard(video, roi, tS, info, quality = 0.88) {
  return (await orderCardCanvas(video, roi, tS, info)).toDataURL('image/jpeg', quality);
}

/** dataURL -> Uint8Array */
export function dataUrlBytes(dataUrl) {
  const b64 = String(dataUrl).split(',')[1] || '';
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Gói nhiều file vào ZIP (JPEG đã nén sẵn -> chỉ lưu, không nén lại). files: [{name, bytes}] */
export function zipFiles(files) {
  const map = {}, seen = {};
  for (const f of files) {
    let n = f.name;
    if (seen[n]) n = n.replace(/(\.\w+)?$/, `_${++seen[f.name]}$1`); else seen[n] = 1;
    map[n] = [f.bytes, { level: 0 }];
  }
  return zipSync(map);
}
