/**
 * Path-focused obstacle detection: COCO-SSD (people, vehicles, animals, traffic, furniture…)
 * plus lightweight surface heuristics for stairs / potholes (not in COCO — approximate only).
 */

import * as tf from "@tensorflow/tfjs";
import { load as loadCocoSsd } from "@tensorflow-models/coco-ssd";
import { detectSurfaceHazards } from "./surfaceHazardHeuristics.js";

const CAMERA_HORIZONTAL_FOV_DEG = 65;

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

function horizontalZone(centerX, frameWidth) {
  const t = frameWidth / 3;
  if (centerX < t) return "left";
  if (centerX > 2 * t) return "right";
  return "center";
}

let modelPromise = null;

async function getModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      await tf.ready();
      const ok = await tf.setBackend("webgl").then(() => tf.getBackend() === "webgl").catch(() => false);
      if (!ok) await tf.setBackend("cpu");
      await tf.ready();
      return loadCocoSsd({ base: "lite_mobilenet_v2" });
    })();
  }
  return modelPromise;
}

const MIN_SCORE = 0.35;
const MAX_COCO_DETECTIONS = 40;

function mergeAndSort(cocoRows, surfaceRows) {
  const combined = [...cocoRows, ...surfaceRows];
  combined.sort((a, b) => a.sortKey - b.sortKey);
  return combined.slice(0, 18).map(({ sortKey: _s, ...rest }) => rest);
}

/**
 * @returns {Promise<Array<{ class: string, distanceMeters: number, zone: string, bbox: [number,number,number,number], source?: string }>>}
 */
export async function detectNavigationObstacles(video) {
  if (!video || video.readyState < 2 || video.videoWidth < 16) return [];

  const w = video.videoWidth;
  const h = video.videoHeight;
  const model = await getModel();
  const predictions = await model.detect(video, MAX_COCO_DETECTIONS, MIN_SCORE);

  const rows = [];
  for (let i = 0; i < predictions.length; i++) {
    const pred = predictions[i];
    const cls = pred.class.toLowerCase();
    if (NAV_EXCLUDE.has(cls)) continue;
    if (pred.score < MIN_SCORE) continue;

    const [x, y, bw, bh] = pred.bbox;
    const centerX = x + bw / 2;
    const zone = horizontalZone(centerX, w);
    const raw = estimateDistanceMeters(pred, w, h);
    const smoothKey = `coco_${cls}_${Math.round(centerX / 80)}`;
    const distanceMeters = getSmoothedDistance(smoothKey, raw);
    if (distanceMeters == null) continue;

    rows.push({
      class: pred.class,
      distanceMeters: Math.round(distanceMeters * 10) / 10,
      zone,
      sortKey: distanceMeters - pred.score * 0.5,
      bbox: [x, y, bw, bh],
      source: "coco",
    });
  }

  let surfaceRows = [];
  try {
    surfaceRows = detectSurfaceHazards(video).map((o) => ({
      ...o,
      sortKey: o.distanceMeters,
    }));
  } catch {
    surfaceRows = [];
  }

  return mergeAndSort(rows, surfaceRows);
}
