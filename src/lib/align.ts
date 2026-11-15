/**
 * "Align boxes": the browser half of the box-alignment pass (server half: server/generate.ts).
 *
 * For a screen with a screenshot, draw a copy of the image with a percentage grid and
 * the current element boxes numbered on it, send both images to /api/align, and turn
 * the reply into corrected rects. Drawing happens here because the browser already
 * has a canvas, so the server needs no image library.
 */
import { mergeAlignment, type AlignOutcome } from "../../shared/layout";
import type { Rect, Screen } from "../../shared/schema";
import { assetUrl } from "../api";

export type ScreenRects = Record<string, Record<string, Rect>>;

const BOX_COLORS = ["#e8590c", "#1971c2", "#2f9e44", "#9c36b5", "#c2255c", "#0c8599", "#f08c00", "#5f3dc4"];
const SEND_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Draw the grid and numbered boxes over the screenshot. Exported for testing/inspection. */
export function drawAnnotated(img: ImageBitmap, screen: Screen): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const W = canvas.width;
  const H = canvas.height;
  const unit = Math.max(W, H) / 100; // scales strokes and text with the image

  // Grid: solid lines every 10%, faint lines every 5%.
  for (let p = 5; p < 100; p += 5) {
    const major = p % 10 === 0;
    ctx.strokeStyle = major ? "rgba(214, 51, 132, 0.75)" : "rgba(214, 51, 132, 0.3)";
    ctx.lineWidth = major ? Math.max(1, unit * 0.12) : Math.max(1, unit * 0.06);
    ctx.beginPath();
    ctx.moveTo((p / 100) * W, 0);
    ctx.lineTo((p / 100) * W, H);
    ctx.moveTo(0, (p / 100) * H);
    ctx.lineTo(W, (p / 100) * H);
    ctx.stroke();
  }
  // Grid labels along the top and left edges.
  const fs = Math.max(10, Math.round(unit * 1.3));
  ctx.font = `bold ${fs}px sans-serif`;
  ctx.textBaseline = "top";
  for (let p = 10; p < 100; p += 10) {
    const label = String(p);
    const tw = ctx.measureText(label).width;
    const pad = fs * 0.2;
    const lx = (p / 100) * W - tw / 2;
    ctx.fillStyle = "rgba(214, 51, 132, 0.95)";
    ctx.fillRect(lx - pad, 0, tw + pad * 2, fs + pad * 2);
    ctx.fillRect(0, (p / 100) * H - fs / 2 - pad, tw + pad * 2, fs + pad * 2);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, lx, pad);
    ctx.fillText(label, pad, (p / 100) * H - fs / 2);
  }

  // Current boxes, numbered 1..N in element order.
  screen.elements.forEach((el, i) => {
    const color = BOX_COLORS[i % BOX_COLORS.length];
    const x = (el.rect.x / 100) * W;
    const y = (el.rect.y / 100) * H;
    const w = (el.rect.w / 100) * W;
    const h = (el.rect.h / 100) * H;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, unit * 0.25);
    ctx.setLineDash([unit * 0.8, unit * 0.4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    const tag = String(i + 1);
    const tfs = Math.max(11, Math.round(unit * 1.5));
    ctx.font = `bold ${tfs}px sans-serif`;
    const tw = ctx.measureText(tag).width + tfs * 0.5;
    const ty = y - tfs * 1.2 >= 0 ? y - tfs * 1.2 : y; // label above the box if there's room
    ctx.fillStyle = color;
    ctx.fillRect(x, ty, tw, tfs * 1.2);
    ctx.fillStyle = "#fff";
    ctx.fillText(tag, x + tfs * 0.25, ty + tfs * 0.1);
  });
  return canvas;
}

async function canvasToPayload(canvas: HTMLCanvasElement) {
  const toBlob = (type: string, q?: number) =>
    new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), type, q));
  let blob = await toBlob("image/png");
  if (blob.size > 3_000_000) blob = await toBlob("image/jpeg", 0.9);
  return { mediaType: blob.type, data: await blobToBase64(blob) };
}

/** Ask Claude to correct every element box on one screenshot screen. */
export async function alignScreen(screen: Screen): Promise<AlignOutcome> {
  if (!screen.imageAssetId) throw new Error("This screen has no screenshot to align to.");
  if (!screen.elements.length) return { rects: {}, notFound: [] };

  const res = await fetch(assetUrl(screen.imageAssetId));
  if (!res.ok) throw new Error("Couldn't load the screenshot.");
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const annotated = await canvasToPayload(drawAnnotated(bmp, screen));
  bmp.close();
  const clean = SEND_TYPES.includes(blob.type)
    ? { mediaType: blob.type, data: await blobToBase64(blob) }
    : annotated; // unexpected type: fall back (never happens for our own uploads)

  const reply = await fetch("/api/align", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Simulator": "1" },
    body: JSON.stringify({
      screenName: screen.name,
      elements: screen.elements.map((e, i) => ({ n: i + 1, kind: e.kind, label: e.label })),
      clean,
      annotated,
    }),
  });
  const body = await reply.json().catch(() => ({}));
  if (!reply.ok) throw new Error(body.error ?? `Alignment failed (${reply.status}).`);
  return mergeAlignment(screen.elements, body.elements ?? []);
}

/** Run alignment over several screens, a few at a time. Failures are reported, not thrown. */
export async function alignScreens(
  screens: Screen[],
  onProgress: (done: number, total: number) => void,
): Promise<{ rects: ScreenRects; problems: string[] }> {
  const targets = screens.filter((s) => s.imageAssetId && s.elements.length);
  const rects: ScreenRects = {};
  const problems: string[] = [];
  let done = 0;
  onProgress(0, targets.length);
  const queue = [...targets];
  const worker = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      try {
        const out = await alignScreen(s);
        rects[s.id] = out.rects;
        if (out.notFound.length) problems.push(`${s.name}: couldn't find ${out.notFound.join(", ")} in the screenshot.`);
      } catch (e) {
        problems.push(`${s.name}: ${(e as Error).message}`);
      }
      onProgress(++done, targets.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { rects, problems };
}

/** Apply alignment results to a simulation (mutates the given object). */
export function applyRects(screens: Screen[], rects: ScreenRects) {
  for (const s of screens) {
    const r = rects[s.id];
    if (!r) continue;
    for (const el of s.elements) if (r[el.id]) el.rect = r[el.id];
  }
}
