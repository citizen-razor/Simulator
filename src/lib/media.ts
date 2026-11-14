/**
 * Turns dropped files into something Claude can read, entirely in the browser:
 *  - images: downscaled so the long edge is ≤ 1568px (Claude's sweet spot; bigger costs more and isn't sharper)
 *  - videos: sampled twice a second; a frame is kept whenever the screen changes noticeably,
 *            so a screen recording becomes a short sequence of distinct screenshots
 *  - PDFs / Word docs: sent as-is (base64); the server or API extracts the text
 *  - anything else: read as text (source code, HTML, Markdown, CSV, JSON, logs...)
 */

export interface PreparedImage {
  kind: "image";
  name: string;
  mediaType: "image/png" | "image/jpeg";
  data: string; // base64
  width: number;
  height: number;
  source?: string;
  preview: string; // object URL for thumbnails
}
export interface PreparedText {
  kind: "text";
  name: string;
  content: string;
}
export interface PreparedBinary {
  kind: "pdf" | "docx";
  name: string;
  data: string;
}
export type Prepared = PreparedImage | PreparedText | PreparedBinary;

const MAX_EDGE = 1568;
const MAX_TEXT_CHARS = 400_000;
const MAX_VIDEO_FRAMES = 16;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function canvasToImage(canvas: HTMLCanvasElement, name: string, source?: string): Promise<PreparedImage> {
  const toBlob = (type: string, q?: number) =>
    new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), type, q));
  // PNG keeps UI text crisp; fall back to JPEG for photo-like images that are large as PNG.
  let blob = await toBlob("image/png");
  let mediaType: PreparedImage["mediaType"] = "image/png";
  if (blob.size > 1_500_000) {
    blob = await toBlob("image/jpeg", 0.88);
    mediaType = "image/jpeg";
  }
  return {
    kind: "image",
    name,
    mediaType,
    data: await blobToBase64(blob),
    width: canvas.width,
    height: canvas.height,
    source,
    preview: URL.createObjectURL(blob),
  };
}

function drawScaled(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d")!.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function prepareImage(file: File | Blob, name: string): Promise<PreparedImage> {
  const bmp = await createImageBitmap(file);
  const canvas = drawScaled(bmp, bmp.width, bmp.height);
  bmp.close();
  return canvasToImage(canvas, name);
}

/** Tiny grayscale thumbnail used to compare frames. */
function signature(video: HTMLVideoElement): Float32Array {
  const c = document.createElement("canvas");
  c.width = 48;
  c.height = 27;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, c.width, c.height);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const out = new Float32Array(c.width * c.height);
  for (let i = 0; i < out.length; i++) out[i] = (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 765;
  return out;
}

function difference(a: Float32Array, b: Float32Array): number {
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 0.08) changed++;
  return changed / a.length;
}

export async function extractVideoFrames(file: File, onProgress?: (pct: number) => void): Promise<PreparedImage[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = url;
  await new Promise<void>((res, rej) => {
    video.onloadeddata = () => res();
    video.onerror = () => rej(new Error(`${file.name}: this browser can't decode the video. Try MP4 (H.264) or WebM.`));
  });
  const seek = (t: number) =>
    new Promise<void>((res) => {
      video.onseeked = () => res();
      video.currentTime = t;
    });

  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const interval = 0.5;
  const kept: { t: number; sig: Float32Array }[] = [];
  let lastSig: Float32Array | null = null;
  for (let t = 0; t <= duration; t += interval) {
    await seek(Math.min(t, Math.max(0, duration - 0.05)));
    const sig = signature(video);
    // Keep the first frame, then any frame where >6% of the picture changed.
    if (!lastSig || difference(sig, lastSig) > 0.06) {
      kept.push({ t, sig });
      lastSig = sig;
    }
    onProgress?.(duration ? t / duration : 1);
  }
  // Too many changes (e.g. scrolling): spread the frames we keep evenly.
  let chosen = kept;
  if (kept.length > MAX_VIDEO_FRAMES) {
    chosen = Array.from({ length: MAX_VIDEO_FRAMES }, (_, i) => kept[Math.round((i * (kept.length - 1)) / (MAX_VIDEO_FRAMES - 1))]);
  }
  const frames: PreparedImage[] = [];
  for (const [i, { t }] of chosen.entries()) {
    await seek(Math.min(t, Math.max(0, duration - 0.05)));
    const canvas = drawScaled(video, video.videoWidth, video.videoHeight);
    frames.push(await canvasToImage(canvas, `${file.name} frame ${i + 1}`, `video "${file.name}" frame ${i + 1} at ${t.toFixed(1)}s`));
  }
  URL.revokeObjectURL(url);
  return frames;
}

const looksBinary = (s: string) => {
  const sample = s.slice(0, 4000);
  let bad = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c === 0 || c === 0xfffd) bad++;
  }
  return bad > sample.length * 0.02;
};

export async function prepareFile(file: File, onProgress?: (pct: number) => void): Promise<Prepared[]> {
  const lower = file.name.toLowerCase();
  if (file.type.startsWith("image/")) return [await prepareImage(file, file.name)];
  if (file.type.startsWith("video/")) return extractVideoFrames(file, onProgress);
  if (file.type === "application/pdf" || lower.endsWith(".pdf")) {
    if (file.size > 25_000_000) throw new Error(`${file.name}: PDFs must be under 25 MB.`);
    return [{ kind: "pdf", name: file.name, data: await blobToBase64(file) }];
  }
  if (lower.endsWith(".docx")) return [{ kind: "docx", name: file.name, data: await blobToBase64(file) }];
  const content = await file.text();
  if (looksBinary(content)) throw new Error(`${file.name}: unsupported file type.`);
  if (content.length > MAX_TEXT_CHARS) {
    throw new Error(`${file.name}: too large (${Math.round(content.length / 1000)}k characters, max ${MAX_TEXT_CHARS / 1000}k). Upload the relevant files only.`);
  }
  return [{ kind: "text", name: file.name, content }];
}
