/**
 * COCO-SSD has no "door" class. This uses vertical edges (door jambs) + optional interior
 * brightness to suggest a door-shaped opening — not guaranteed; verify visually.
 */

const CAMERA_HORIZONTAL_FOV_DEG = 65;
const TYPICAL_DOOR_WIDTH_M = 0.82;

export function iouApprox(a, b) {
  const ax2 = a[0] + a[2];
  const ay2 = a[1] + a[3];
  const bx2 = b[0] + b[2];
  const by2 = b[1] + b[3];
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const u = a[2] * a[3] + b[2] * b[3] - inter;
  return u > 0 ? inter / u : 0;
}

function horizontalZone(centerX, frameWidth) {
  const t = frameWidth / 3;
  if (centerX < t) return "left";
  if (centerX > 2 * t) return "right";
  return "center";
}

function estimateDistanceFromDoorWidth(bwPx, frameWidth, frameHeight) {
  if (bwPx < 4) return null;
  const hFovRad = (CAMERA_HORIZONTAL_FOV_DEG * Math.PI) / 180;
  const aspect = frameWidth / Math.max(1, frameHeight);
  const focalHxPx = (frameWidth / 2) / Math.tan(hFovRad / 2);
  const d = (TYPICAL_DOOR_WIDTH_M * focalHxPx) / bwPx;
  return Math.min(Math.max(d, 0.6), 22);
}

function scaleBboxToVideo(bbox, vw, vh, cw, ch) {
  const sx = vw / cw;
  const sy = vh / ch;
  return [bbox[0] * sx, bbox[1] * sy, bbox[2] * sx, bbox[3] * sy];
}

/**
 * @param {HTMLVideoElement} video
 * @param {Array<[number,number,number,number]>} personBoxes — video coords; skip door if overlaps person
 * @returns {Array<{ class: string, distanceMeters: number, zone: string, bbox: [number,number,number,number], source: string, sortKey: number }>}
 */
export function detectDoorLikeOpening(video, personBoxes = []) {
  if (!video || video.readyState < 2 || video.videoWidth < 48) return [];

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const maxW = 240;
  const scale = Math.min(1, maxW / vw);
  const cw = Math.max(48, Math.round(vw * scale));
  const ch = Math.max(36, Math.round(vh * scale));

  try {
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return [];
    ctx.drawImage(video, 0, 0, cw, ch);
    const { data } = ctx.getImageData(0, 0, cw, ch);
    const gray = new Float32Array(cw * ch);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }

    const y0 = Math.floor(ch * 0.12);
    const y1 = Math.floor(ch * 0.92);
    const colEdge = new Float32Array(cw).fill(0);
    for (let y = y0 + 1; y < y1; y++) {
      for (let x = 2; x < cw - 2; x++) {
        const i = y * cw + x;
        const vg =
          Math.abs(gray[i] - gray[i - cw]) * 0.65 +
          Math.abs(gray[i] - gray[i + cw]) * 0.65 +
          Math.abs(gray[i] - gray[i - 1]) * 0.2;
        colEdge[x] += vg;
      }
    }

    let maxE = 0;
    for (let x = 0; x < cw; x++) if (colEdge[x] > maxE) maxE = colEdge[x];
    if (maxE < 1e-6) return [];

    const norm = new Float32Array(cw);
    for (let x = 0; x < cw; x++) norm[x] = colEdge[x] / maxE;

    for (let pass = 0; pass < 2; pass++) {
      const tmp = new Float32Array(cw);
      for (let x = 1; x < cw - 1; x++) tmp[x] = (norm[x - 1] + norm[x] * 2 + norm[x + 1]) / 4;
      for (let x = 1; x < cw - 1; x++) norm[x] = tmp[x];
    }

    const peaks = [];
    for (let x = 3; x < cw - 3; x++) {
      if (norm[x] > norm[x - 1] && norm[x] > norm[x + 1] && norm[x] > 0.36) {
        peaks.push({ x, s: norm[x] });
      }
    }
    peaks.sort((a, b) => b.s - a.s);

    const minGap = Math.floor(cw * 0.14);
    const maxGap = Math.floor(cw * 0.48);
    let best = null;
    let bestScore = 0;

    for (let i = 0; i < Math.min(peaks.length, 12); i++) {
      for (let j = i + 1; j < Math.min(peaks.length, 12); j++) {
        const xa = Math.min(peaks[i].x, peaks[j].x);
        const xb = Math.max(peaks[i].x, peaks[j].x);
        const gap = xb - xa;
        if (gap < minGap || gap > maxGap) continue;
        const score = peaks[i].s + peaks[j].s + gap / cw;
        if (score > bestScore) {
          bestScore = score;
          best = { x0: xa, x1: xb, pi: peaks[i], pj: peaks[j] };
        }
      }
    }

    if (!best || bestScore < 0.88) return [];

    const pad = 4;
    const bx0 = Math.max(0, best.x0 - pad);
    const bx1 = Math.min(cw - 1, best.x1 + pad);
    const by0 = y0;
    const by1 = y1;
    const bboxCanvas = [bx0, by0, bx1 - bx0, by1 - by0];
    const bboxVideo = scaleBboxToVideo(bboxCanvas, vw, vh, cw, ch);

    for (const pb of personBoxes) {
      if (iouApprox(bboxVideo, pb) > 0.18) return [];
    }

    const cx = bboxVideo[0] + bboxVideo[2] / 2;
    const zone = horizontalZone(cx, vw);
    const dist = estimateDistanceFromDoorWidth(bboxVideo[2], vw, vh);
    if (dist == null) return [];

    const dm = Math.round(dist * 10) / 10;
    return [
      {
        class: "possible door",
        distanceMeters: dm,
        zone,
        bbox: bboxVideo,
        source: "door",
        sortKey: dm - 2.2,
      },
    ];
  } catch {
    return [];
  }
}
