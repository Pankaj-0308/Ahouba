/**
 * Real-time path obstacle detection — optimized single-shot pipeline.
 *
 * **Model:** `@tensorflow-models/coco-ssd` with **MobileNetV2** (`lite_mobilenet_v2`). That is a
 * lightweight single-stage detector in the same *latency class* as tiny YOLO variants on CPU/WebGL.
 * To swap in **YOLOv8n** (or similar), replace `getModel()` + the forward pass with ONNX Runtime Web
 * (or a TF.js–converted graph) and feed the output boxes through `predictionsToObstacleRows()` unchanged
 * so zones, distances, and the safety layer stay consistent.
 *
 * **Vision → navigation mapping (coordinates):**
 * 1. **Input frame** — We run inference on a **downscaled** canvas (max width `INFERENCE_MAX_WIDTH`) for
 *    lower GPU fill rate and faster WebGL ops; boxes are scaled **back** to full `videoWidth` × `videoHeight`
 *    so `ObstacleOverlay` and distance math match the live view.
 * 2. **BBox `[x, y, w, h]`** — Top-left origin, pixels; `centerX = x + w/2` drives lateral semantics.
 * 3. **`horizontalZone(centerX, frameWidth)`** — Divides FOV into thirds → `left` | `center` | `right`.
 *    This is the primary cue for spoken steer-left / steer-right (see `liveCameraGuidance.js`).
 * 4. **`estimateDistanceMeters`** — Uses horizontal FOV (`CAMERA_HORIZONTAL_FOV_DEG`), frame aspect, and
 *    typical object height/width (m) to invert apparent bbox size → slant range along the optical axis.
 * 5. **Downstream** — `visionSafety.js` may **suppress map-first** TTS when objects are too close in the
 *    center corridor; `voiceGating.js` prioritizes urgent obstacle speech over route hints.
 */

import * as tf from "@tensorflow/tfjs";
import { load as loadCocoSsd } from "@tensorflow-models/coco-ssd";
import { displayNameForClass } from "./obstacleLabels.js";

const CAMERA_HORIZONTAL_FOV_DEG = 65;

/** Narrower side for WebGL inference — big win for latency; boxes are re-scaled to full video space. */
const INFERENCE_MAX_WIDTH = 384;

/** Typical real-world sizes (m) — COCO class names must match model output (lowercase). */
const TYPICAL_OBJECT_HEIGHT_M = {
  person: 1.7,
  bicycle: 1.1,
  car: 1.5,
  motorcycle: 1.2,
  airplane: 3.0,
  bus: 3.0,
  train: 2.8,
  truck: 2.6,
  boat: 1.2,
  "traffic light": 1.2,
  "fire hydrant": 0.9,
  "stop sign": 0.75,
  "parking meter": 1.2,
  bench: 0.9,
  bird: 0.22,
  cat: 0.25,
  dog: 0.55,
  horse: 1.5,
  sheep: 0.9,
  cow: 1.4,
  elephant: 2.2,
  bear: 1.2,
  zebra: 1.5,
  giraffe: 2.8,
  backpack: 0.45,
  umbrella: 0.55,
  handbag: 0.35,
  suitcase: 0.6,
  frisbee: 0.03,
  skis: 1.0,
  snowboard: 1.0,
  "sports ball": 0.24,
  kite: 0.5,
  "baseball bat": 0.85,
  "baseball glove": 0.28,
  skateboard: 0.12,
  surfboard: 0.45,
  "tennis racket": 0.35,
  bottle: 0.28,
  cup: 0.12,
  bowl: 0.08,
  banana: 0.2,
  apple: 0.08,
  sandwich: 0.06,
  orange: 0.08,
  broccoli: 0.1,
  carrot: 0.08,
  "hot dog": 0.06,
  pizza: 0.04,
  donut: 0.05,
  cake: 0.12,
  chair: 1.0,
  couch: 0.85,
  "potted plant": 0.85,
  bed: 0.65,
  "dining table": 0.75,
  toilet: 0.55,
  tv: 0.55,
  laptop: 0.02,
  "cell phone": 0.16,
  microwave: 0.35,
  oven: 0.55,
  toaster: 0.22,
  sink: 0.45,
  refrigerator: 1.75,
  book: 0.28,
  clock: 0.35,
  vase: 0.45,
  scissors: 0.12,
  "teddy bear": 0.35,
  "hair drier": 0.22,
};

const TYPICAL_OBJECT_WIDTH_M = {
  person: 0.5,
  bicycle: 0.6,
  car: 1.85,
  motorcycle: 0.85,
  airplane: 3.2,
  bus: 2.6,
  train: 2.6,
  truck: 2.5,
  boat: 2.0,
  "traffic light": 0.45,
  "fire hydrant": 0.4,
  "stop sign": 0.6,
  "parking meter": 0.28,
  bench: 1.25,
  bird: 0.28,
  cat: 0.2,
  dog: 0.38,
  horse: 0.65,
  sheep: 0.65,
  cow: 0.85,
  elephant: 1.2,
  bear: 0.75,
  zebra: 0.7,
  giraffe: 0.75,
  backpack: 0.35,
  umbrella: 0.55,
  handbag: 0.32,
  suitcase: 0.42,
  frisbee: 0.22,
  skis: 0.18,
  snowboard: 0.28,
  "sports ball": 0.22,
  kite: 0.55,
  "baseball bat": 0.06,
  "baseball glove": 0.22,
  skateboard: 0.22,
  surfboard: 0.55,
  "tennis racket": 0.25,
  bottle: 0.08,
  cup: 0.1,
  bowl: 0.18,
  banana: 0.05,
  apple: 0.08,
  sandwich: 0.12,
  orange: 0.08,
  broccoli: 0.12,
  carrot: 0.05,
  "hot dog": 0.04,
  pizza: 0.28,
  donut: 0.08,
  cake: 0.22,
  chair: 0.48,
  couch: 1.15,
  "potted plant": 0.45,
  bed: 1.45,
  "dining table": 1.05,
  toilet: 0.45,
  tv: 0.95,
  laptop: 0.32,
  "cell phone": 0.08,
  microwave: 0.48,
  oven: 0.55,
  toaster: 0.28,
  sink: 0.55,
  refrigerator: 0.75,
  book: 0.18,
  clock: 0.18,
  vase: 0.28,
  scissors: 0.08,
  "teddy bear": 0.28,
  "hair drier": 0.18,
};

/** Tiny / desktop clutter — not useful for walking path (model still often mis-detects these). */
const NAV_EXCLUDE = new Set([
  "fork",
  "knife",
  "spoon",
  "toothbrush",
  "wine glass",
  "mouse",
  "keyboard",
  "remote",
  "tie",
]);

const DEFAULT_HEIGHT_M = 0.5;
const DEFAULT_WIDTH_M = 0.42;

const DISTANCE_EMA_ALPHA = 0.35;
const distanceSmoothing = new Map();

/**
 * Map bbox size + assumed physical size → range along the **camera optical axis** (not map ground distance).
 * Feeds `distanceMeters` used by urgency, safety override, and spoken "about X meters".
 */
function estimateDistanceMeters(det, frameWidth, frameHeight) {
  const objectLabel = det.class.toLowerCase();
  const realHeightM = TYPICAL_OBJECT_HEIGHT_M[objectLabel] ?? DEFAULT_HEIGHT_M;
  const realWidthM = TYPICAL_OBJECT_WIDTH_M[objectLabel] ?? DEFAULT_WIDTH_M;

  const hFovRad = (CAMERA_HORIZONTAL_FOV_DEG * Math.PI) / 180;
  const aspect = frameWidth / Math.max(1, frameHeight);
  const vFovRad = 2 * Math.atan(Math.tan(hFovRad / 2) / aspect);

  const focalVyPx = (frameHeight / 2) / Math.tan(vFovRad / 2);
  const focalHxPx = (frameWidth / 2) / Math.tan(hFovRad / 2);

  const estimates = [];
  const bboxHeightPx = det.bbox[3];
  const bboxWidthPx = det.bbox[2];

  if (realHeightM && bboxHeightPx > 1) {
    estimates.push((realHeightM * focalVyPx) / bboxHeightPx);
  }
  if (realWidthM && bboxWidthPx > 1) {
    estimates.push((realWidthM * focalHxPx) / bboxWidthPx);
  }
  if (estimates.length === 0) return null;

  const invSum = estimates.reduce((acc, v) => acc + 1 / Math.max(1e-6, v), 0);
  const distanceM = estimates.length / invSum;
  return Math.min(Math.max(distanceM, 0.3), 40);
}

function getSmoothedDistance(key, rawM) {
  if (rawM == null || !Number.isFinite(rawM)) return null;
  const prev = distanceSmoothing.get(key);
  const next =
    prev == null ? rawM : DISTANCE_EMA_ALPHA * rawM + (1 - DISTANCE_EMA_ALPHA) * prev;
  distanceSmoothing.set(key, next);
  return next;
}

/**
 * Map bbox center X to a coarse **walking corridor** in the camera frame.
 * Used by TTS ("on your left") and by `visionSafety.js` (center strip = forward path).
 */
function horizontalZone(centerX, frameWidth) {
  const t = frameWidth / 3;
  if (centerX < t) return "left";
  if (centerX > 2 * t) return "right";
  return "center";
}

let modelPromise = null;
/** Reused canvas avoids per-frame allocation (GC pauses hurt real-time feel). */
let inferCanvas = null;
let inferCtx = null;

async function getModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      await tf.ready();
      const ok = await tf.setBackend("webgl").then(() => tf.getBackend() === "webgl").catch(() => false);
      if (!ok) await tf.setBackend("cpu");
      await tf.ready();
      try {
        tf.env().set("WEBGL_PACK", true);
      } catch {
        /* ignore if env flags unavailable */
      }
      return loadCocoSsd({ base: "lite_mobilenet_v2" });
    })();
  }
  return modelPromise;
}

/**
 * Draw the current video frame into a smaller bitmap for faster SSD forward pass.
 * @returns {{ canvas: HTMLCanvasElement, vw: number, vh: number, cw: number, ch: number, sx: number, sy: number } | null}
 */
function prepareInferenceFrame(video) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const scale = vw > INFERENCE_MAX_WIDTH ? INFERENCE_MAX_WIDTH / vw : 1;
  const cw = Math.max(16, Math.round(vw * scale));
  const ch = Math.max(16, Math.round(vh * scale));
  if (!inferCanvas) {
    inferCanvas = document.createElement("canvas");
    inferCtx = inferCanvas.getContext("2d", { alpha: false });
  }
  if (!inferCtx) return null;
  if (inferCanvas.width !== cw || inferCanvas.height !== ch) {
    inferCanvas.width = cw;
    inferCanvas.height = ch;
  }
  inferCtx.drawImage(video, 0, 0, cw, ch);
  return {
    canvas: inferCanvas,
    vw,
    vh,
    cw,
    ch,
    sx: vw / cw,
    sy: vh / ch,
  };
}

/** Slightly higher to reduce spurious COCO labels. */
const MIN_SCORE = 0.35;
/** Common room furniture and floor clutter — allow slightly lower confidence so more gets named. */
const MIN_SCORE_INDOOR_OBJECT = 0.31;
const INDOOR_OBJECT_CLASS = new Set([
  "chair",
  "couch",
  "bed",
  "dining table",
  "refrigerator",
  "bottle",
  "cup",
  "bowl",
  "bench",
  "sink",
  "toilet",
  "oven",
  "microwave",
  "tv",
  "potted plant",
  "clock",
  "vase",
  "book",
  "laptop",
  "cell phone",
  "handbag",
  "backpack",
  "suitcase",
  "umbrella",
]);
const MAX_COCO_DETECTIONS = 40;

function finalizeObstacleRows(rows) {
  rows.sort((a, b) => a.sortKey - b.sortKey);
  return rows.slice(0, 18).map(({ sortKey: _s, ...rest }) => rest);
}

/**
 * Normalize raw detector boxes into navigation rows (call from SSD, YOLO, etc.).
 * @param {Array<{ class: string, score: number, bbox: [number,number,number,number] }>} predictions
 * @param {number} w - full video width (for zone + distance + overlay)
 * @param {number} h - full video height
 */
export function predictionsToObstacleRows(predictions, w, h) {
  const rows = [];
  for (let i = 0; i < predictions.length; i++) {
    const pred = predictions[i];
    const cls = pred.class.toLowerCase();
    if (NAV_EXCLUDE.has(cls)) continue;
    const minForClass = INDOOR_OBJECT_CLASS.has(cls) ? MIN_SCORE_INDOOR_OBJECT : MIN_SCORE;
    if (pred.score < minForClass) continue;

    const [x, y, bw, bh] = pred.bbox;
    const centerX = x + bw / 2;
    const zone = horizontalZone(centerX, w);
    const raw = estimateDistanceMeters(pred, w, h);
    const smoothKey = `det_${cls}_${Math.round(centerX / 80)}`;
    const distanceMeters = getSmoothedDistance(smoothKey, raw);
    if (distanceMeters == null) continue;

    rows.push({
      class: pred.class,
      displayName: displayNameForClass(pred.class),
      distanceMeters: Math.round(distanceMeters * 10) / 10,
      zone,
      sortKey: distanceMeters - pred.score * 0.5,
      bbox: [x, y, bw, bh],
      source: "coco",
    });
  }
  return finalizeObstacleRows(rows);
}

/**
 * @returns {Promise<Array<{ class: string, displayName?: string, distanceMeters: number, zone: string, bbox: [number,number,number,number], source?: string }>>}
 */
export async function detectNavigationObstacles(video) {
  if (!video || video.readyState < 2 || video.videoWidth < 16) return [];

  const frame = prepareInferenceFrame(video);
  const model = await getModel();
  const inferSource = frame?.canvas ?? video;

  const predictions = await model.detect(
    inferSource,
    MAX_COCO_DETECTIONS,
    Math.min(MIN_SCORE, MIN_SCORE_INDOOR_OBJECT)
  );

  const w = video.videoWidth;
  const h = video.videoHeight;
  const sx = frame ? frame.sx : 1;
  const sy = frame ? frame.sy : 1;

  const scaled = predictions.map((p) => {
    const [x, y, bw, bh] = p.bbox;
    return {
      class: p.class,
      score: p.score,
      bbox: [x * sx, y * sy, bw * sx, bh * sy],
    };
  });

  return predictionsToObstacleRows(scaled, w, h);
}
