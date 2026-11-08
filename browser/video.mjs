// Đọc video local trong trình duyệt: mở file (không upload), tua tới thời điểm, lấy khung hình.
// Không phụ thuộc GAS; chạy được trong trang thường lẫn iframe HtmlService.

/** Mở video từ File/Blob (input file) hoặc URL. Trả về {video, url, width, height, durationS, close()}. */
export async function openVideo(source, video = document.createElement('video')) {
  const url = typeof source === 'string' ? source : URL.createObjectURL(source);
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  await new Promise((resolve, reject) => {
    const ok = () => { cleanup(); resolve(); };
    const bad = () => { cleanup(); reject(new Error('Trình duyệt không mở được video (codec/định dạng?)')); };
    const cleanup = () => { video.removeEventListener('loadeddata', ok); video.removeEventListener('error', bad); };
    video.addEventListener('loadeddata', ok);
    video.addEventListener('error', bad);
  });
  return {
    video,
    url,
    width: video.videoWidth,
    height: video.videoHeight,
    durationS: video.duration,
    close() {
      video.removeAttribute('src');
      video.load();
      if (typeof source !== 'string') URL.revokeObjectURL(url);
    },
  };
}

/**
 * Tua tới thời điểm tS (giây) và chờ khung hình thực sự được vẽ.
 * Trả về {requestedS, mediaTimeS|null}: mediaTimeS là PTS của khung đang hiện (từ requestVideoFrameCallback nếu có).
 * Muốn lấy đúng khung có PTS = p thì truyền tS nằm giữa p và PTS khung sau.
 */
export function seek(video, tS, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => finish(null, new Error(`Tua quá ${timeoutMs}ms tại ${tS}s`)), timeoutMs);
    const finish = (mediaTime, err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      err ? reject(err) : resolve({ requestedS: tS, mediaTimeS: mediaTime });
    };
    const hasRvfc = typeof video.requestVideoFrameCallback === 'function';
    let gotFrame = null, seeked = false;
    if (hasRvfc) {
      video.requestVideoFrameCallback((_now, meta) => {
        gotFrame = meta.mediaTime;
        if (seeked) finish(gotFrame);
      });
    }
    const onSeeked = () => {
      seeked = true;
      if (!hasRvfc) return finish(null);
      if (gotFrame !== null) return finish(gotFrame);
      // Một số trình duyệt không gọi rVFC khi tua tới đúng khung đang hiện: chờ thêm 1 chút rồi chấp nhận.
      setTimeout(() => finish(gotFrame), 250);
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = tS;
  });
}

let _canvas = null;
/** Ảnh xám thu nhỏ w×h của khung đang hiện (Uint8ClampedArray, luma BT.601 giống OpenCV). */
export function grayThumb(video, w, h) {
  _canvas = _canvas || document.createElement('canvas');
  _canvas.width = w;
  _canvas.height = h;
  const ctx = _canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  }
  return out;
}

/** Chép khung đang hiện ra canvas cỡ gốc (dùng cho OCR/ảnh bằng chứng). */
export function frameCanvas(video, canvas = document.createElement('canvas')) {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  return canvas;
}

/** Sai khác trung bình tuyệt đối giữa hai ảnh xám cùng cỡ. */
export function meanAbsDiff(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}
