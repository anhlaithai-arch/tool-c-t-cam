import { letterbox, decode, track } from './core/pose.mjs';
import { seek } from './video.mjs';

const CHANNELS = 'RGB';
const CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
const MODEL = 'https://huggingface.co/Xenova/RTMO-m/resolve/main/onnx/model_int8.onnx';
let sessionPromise = null, runtimePromise = null;

function runtime() {
  if (window.ort) return Promise.resolve(window.ort);
  if (!runtimePromise) runtimePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${CDN}ort.min.js`;
    script.onload = () => window.ort ? resolve(window.ort) : reject(new Error('Không nạp được ONNX Runtime'));
    script.onerror = () => { script.remove(); reject(new Error('Không tải được ONNX Runtime')); };
    document.head.appendChild(script);
  }).catch((error) => { runtimePromise = null; throw error; });
  return runtimePromise;
}

async function modelBytes(onProgress) {
  // Cache Storage can be unavailable in restricted browser contexts.
  let cache = null;
  try { cache = await caches.open('catcam-models'); } catch { /* use network */ }
  const cached = await cache?.match(MODEL);
  if (cached) {
    const bytes = await cached.arrayBuffer();
    onProgress?.({ loaded: bytes.byteLength, total: bytes.byteLength, progress: 1 });
    return bytes;
  }
  const response = await fetch(MODEL);
  if (!response.ok) throw new Error(`Không tải được RTMO: HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;
  const chunks = [];
  let loaded = 0;
  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); loaded += value.byteLength;
      onProgress?.({ loaded, total, progress: total ? Math.min(1, loaded/total) : null });
    }
  } else {
    const bytes = new Uint8Array(await response.arrayBuffer());
    chunks.push(bytes); loaded = bytes.byteLength;
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
  try { await cache?.put(MODEL, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } })); } catch { /* cache quota must not block inference */ }
  onProgress?.({ loaded, total: total || loaded, progress: 1 });
  return bytes.buffer;
}

/** onProgress receives {loaded, total, progress}; progress is null without content-length. */
export function loadPoseModel({ onProgress } = {}) {
  if (!sessionPromise) sessionPromise = (async () => {
    const ort = await runtime();
    ort.env.wasm.wasmPaths = CDN;
    ort.env.wasm.numThreads = 1;
    const bytes = await modelBytes(onProgress);
    return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  })().catch((error) => { sessionPromise = null; throw error; });
  return sessionPromise;
}

export async function detectPeople(video, box, opts = {}) {
  const session = await loadPoseModel(opts);
  const lb = letterbox(box);
  // Local canvas/tensor per call prevents concurrent inference from sharing pixels.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 640;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = 'rgb(114,114,114)';
  ctx.fillRect(0,0,640,640);
  ctx.drawImage(video, box.x,box.y,box.w,box.h, lb.padX,lb.padY,lb.w,lb.h);
  const rgba = ctx.getImageData(0,0,640,640).data;
  const plane = 640*640, data = new Float32Array(plane*3);
  for (let i = 0; i < plane; i++) {
    data[i] = rgba[i*4 + (CHANNELS === 'RGB' ? 0 : 2)];
    data[plane+i] = rgba[i*4+1];
    data[2*plane+i] = rgba[i*4 + (CHANNELS === 'RGB' ? 2 : 0)];
  }
  const tensor = new window.ort.Tensor('float32', data, [1,3,640,640]);
  let outputs;
  try {
    outputs = await session.run({ [session.inputNames[0]]: tensor });
    const dets = outputs.dets || outputs[session.outputNames[0]];
    const keypoints = outputs.keypoints || outputs[session.outputNames[1]];
    return decode(dets.data, keypoints.data, dets.data.length/5, lb, box, opts);
  } finally {
    tensor.dispose?.();
    for (const value of new Set(Object.values(outputs || {}))) value.dispose?.();
  }
}

export async function posesAround(video, box, tS, { winS = 0.8, n = 10, signal } = {}) {
  if (!Number.isInteger(n) || n < 1 || winS < 0 || !Number.isFinite(tS)) throw new RangeError('Invalid sampling window');
  const abort = () => { if (signal?.aborted) throw signal.reason || new DOMException('Đã hủy', 'AbortError'); };
  const end = Math.max(0, Math.min(tS, Number.isFinite(video.duration) ? video.duration : tS));
  const start = Math.max(0,end-winS), frames = [];
  for (let i = 0; i < n; i++) {
    abort();
    const t = n === 1 ? end : start+(end-start)*i/(n-1);
    // Seeking to the current time may never emit seeked on some browsers.
    if (video.seeking || Math.abs(video.currentTime-t) > 1e-6 || video.readyState < 2) await seek(video,t,5000,{ waitFrame: false });
    abort();
    const people = await detectPeople(video,box);
    abort();
    frames.push({t,people});
  }
  return track(frames);
}
