/**
 * COCO-SSD has no "pothole" or "stairs" classes. Lightweight frame heuristics on the
 * lower path ROI flag *possible* surface hazards (high false positive rate — treat as hints).
 */

/**
 * @param {HTMLVideoElement} video
 * @returns {Array<{ class: string, distanceMeters: number, zone: string, bbox: [number,number,number,number], source: string }>}
 */
export function detectSurfaceHazards(video) {
  if (!video || video.readyState < 2 || video.videoWidth < 32) return [];

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const maxW = 280;
  const scale = Math.min(1, maxW / vw);
  const cw = Math.max(32, Math.round(vw * scale));
  const ch = Math.max(24, Math.round(vh * scale));

  let canvas;
  try {
    canvas = document.createElement("canvas");
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

    const yStart = Math.floor(ch * 0.52);
    const roiH = ch - yStart;

    const stair = scoreStairPattern(gray, cw, ch, yStart);
    const hole = scorePotholeDarkPatch(gray, cw, ch, yStart);

    const out = [];

    if (stair.detected) {
      const bbox = stair.bbox;
      const cx = bbox[0] + bbox[2] / 2;
      const zone = horizontalZone(cx, cw);
      const dist = estimateDistanceFromVerticalBand(bbox[1] + bbox[3] / 2, ch);
      out.push({
        class: "possible stairs",
        distanceMeters: dist,
        zone,
        bbox: scaleBboxToVideo(bbox, vw, vh, cw, ch),
        source: "heuristic",
      });
    }

    if (hole.detected && !(stair.detected && iouApprox(stair.bbox, hole.bbox) > 0.45)) {
      const bbox = hole.bbox;
      const cx = bbox[0] + bbox[2] / 2;
      const zone = horizontalZone(cx, cw);
      const dist = estimateDistanceFromVerticalBand(bbox[1] + bbox[3] / 2, ch);
      out.push({
        class: "possible pothole or dip",
        distanceMeters: dist,
        zone,
        bbox: scaleBboxToVideo(bbox, vw, vh, cw, ch),
        source: "heuristic",
      });
    }

    return out;
  } catch {
    return [];
  }
}

function horizontalZone(centerX, frameWidth) {
  const t = frameWidth / 3;
  if (centerX < t) return "left";
  if (centerX > 2 * t) return "right";
  return "center";
}

function estimateDistanceFromVerticalBand(yCenter, ch) {
  const t = Math.min(1, Math.max(0, yCenter / ch));
  const near = 2 + (1 - t) * 5.5;
  return Math.round(near * 10) / 10;
}

function scaleBboxToVideo(bbox, vw, vh, cw, ch) {
  const sx = vw / cw;
  const sy = vh / ch;
  return [bbox[0] * sx, bbox[1] * sy, bbox[2] * sx, bbox[3] * sy];
}

function iouApprox(a, b) {
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

/**
 * Horizontal edges stacked vertically (steps) in the lower frame.
 */
function scoreStairPattern(gray, cw, ch, yStart) {
  const roiH = ch - yStart;
  if (roiH < 16) return { detected: false, bbox: [0, 0, 0, 0] };

  const x0 = Math.floor(cw * 0.2);
  const x1 = Math.floor(cw * 0.8);
  const rowEdge = new Float32Array(roiH);
  for (let ry = 0; ry < roiH; ry++) {
    const y = yStart + ry;
    let acc = 0;
    let n = 0;
    for (let x = x0 + 1; x < x1 - 1; x++) {
      const i = y * cw + x;
      acc += Math.abs(gray[i] - gray[i - 1]);
      n++;
    }
    rowEdge[ry] = n > 0 ? acc / n : 0;
  }

  let mean = 0;
  for (let i = 0; i < roiH; i++) mean += rowEdge[i];
  mean /= roiH;
  let varSum = 0;
  for (let i = 0; i < roiH; i++) {
    const d = rowEdge[i] - mean;
    varSum += d * d;
  }
  const std = Math.sqrt(varSum / Math.max(1, roiH));

  let peaks = 0;
  for (let i = 2; i < roiH - 2; i++) {
    const v = rowEdge[i];
    if (
      v > mean + std * 0.55 &&
      v > rowEdge[i - 1] &&
      v > rowEdge[i + 1] &&
      v > rowEdge[i - 2] * 0.92
    ) {
      peaks++;
    }
  }

  const detected = peaks >= 5 && peaks <= 48 && std > 2.8;

  const bbox = [
    x0,
    yStart,
    x1 - x0,
    roiH,
  ];
  return { detected, bbox };
}

/**
 * Darker band in the lower-center vs sides (rough proxy for hole / wet patch / shadow).
 */
function scorePotholeDarkPatch(gray, cw, ch, yStart) {
  const y1 = ch;
  const cx0 = Math.floor(cw * 0.3);
  const cx1 = Math.floor(cw * 0.7);
  let inner = 0;
  let innerN = 0;
  let outer = 0;
  let outerN = 0;

  for (let y = yStart; y < y1; y++) {
    for (let x = 0; x < cw; x++) {
      const v = gray[y * cw + x];
      if (x >= cx0 && x < cx1) {
        inner += v;
        innerN++;
      } else {
        outer += v;
        outerN++;
      }
    }
  }

  if (innerN < 1 || outerN < 1) return { detected: false, bbox: [0, 0, 0, 0] };

  const innerMean = inner / innerN;
  const outerMean = outer / outerN;
  const delta = innerMean - outerMean;

  const detected = delta < -18 && innerMean < 118;

  const bbox = [cx0, yStart, cx1 - cx0, y1 - yStart];
  return { detected, bbox };
}
