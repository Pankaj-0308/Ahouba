/**
 * Continuous obstacle detection + coarse distance (from Blind-Navigation pattern).
 * COCO-SSD + assumed camera FOV + typical object sizes — approximate only.
 */

import * as tf from "@tensorflow/tfjs";
import { load as loadCocoSsd } from "@tensorflow-models/coco-ssd";

const CAMERA_HORIZONTAL_FOV_DEG = 65;

const TYPICAL_OBJECT_HEIGHT_M = {
  person: 1.7,
  car: 1.5,
  truck: 2.6,
  bus: 3.0,
  motorcycle: 1.2,
  bicycle: 1.1,
  dog: 0.5,
  cat: 0.25,
  chair: 1.0,
  bench: 0.9,
  "traffic light": 1.2,
  "stop sign": 0.75,
  "fire hydrant": 0.9,
  "parking meter": 1.2,
  backpack: 0.45,
  suitcase: 0.6,
  "potted plant": 0.8,
};

const TYPICAL_OBJECT_WIDTH_M = {
  person: 0.5,
  car: 1.8,
  truck: 2.5,
  bus: 2.6,
  motorcycle: 0.8,
  bicycle: 0.6,
  dog: 0.3,
  cat: 0.18,
  chair: 0.45,
  bench: 1.2,
  "traffic light": 0.4,
  "stop sign": 0.6,
  "fire hydrant": 0.4,
  "parking meter": 0.25,
  backpack: 0.35,
  suitcase: 0.4,
  "potted plant": 0.5,
};

/** Only classes that matter for path safety — not food, screens, sports, etc. */
const NAV_RELEVANT = new Set(
  Object.keys(TYPICAL_OBJECT_HEIGHT_M).map((k) => k.toLowerCase())
);

const DISTANCE_EMA_ALPHA = 0.35;
const distanceSmoothing = new Map();

function estimateDistanceMeters(det, frameWidth, frameHeight) {
  const objectLabel = det.class.toLowerCase();
  const realHeightM = TYPICAL_OBJECT_HEIGHT_M[objectLabel];
  const realWidthM = TYPICAL_OBJECT_WIDTH_M[objectLabel];

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

const MIN_SCORE = 0.38;

/**
 * @returns {Promise<Array<{ class: string, distanceMeters: number, zone: string, bbox: [number,number,number,number] }>>}
 */
export async function detectNavigationObstacles(video) {
  if (!video || video.readyState < 2 || video.videoWidth < 16) return [];

  const w = video.videoWidth;
  const h = video.videoHeight;
  const model = await getModel();
  const predictions = await model.detect(video, 24, MIN_SCORE);

  const rows = [];
  for (let i = 0; i < predictions.length; i++) {
    const pred = predictions[i];
    const cls = pred.class.toLowerCase();
    if (!NAV_RELEVANT.has(cls)) continue;
    if (pred.score < MIN_SCORE) continue;

    const [x, y, bw, bh] = pred.bbox;
    const centerX = x + bw / 2;
    const zone = horizontalZone(centerX, w);
    const raw = estimateDistanceMeters(pred, w, h);
    const smoothKey = `${cls}_${Math.round(centerX / 80)}`;
    const distanceMeters = getSmoothedDistance(smoothKey, raw);
    if (distanceMeters == null) continue;

    rows.push({
      class: pred.class,
      distanceMeters: Math.round(distanceMeters * 10) / 10,
      zone,
      sortKey: distanceMeters - pred.score * 0.5,
      bbox: [x, y, bw, bh],
    });
  }

  rows.sort((a, b) => a.sortKey - b.sortKey);
  return rows.map(({ class: c, distanceMeters: d, zone: z, bbox }) => ({
    class: c,
    distanceMeters: d,
    zone: z,
    bbox,
  }));
}
