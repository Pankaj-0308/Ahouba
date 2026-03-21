/**
 * Decides when TTS should fire so slight camera tilt / detection jitter
 * does not re-trigger speech. On-screen line can still update every tick.
 *
 * Voice uses a **camera-only** coarse scene signature (no GPS/heading/route) so
 * compass and path jitter do not constantly flip the spoken scene.
 */

import { guidanceMode } from "./liveCameraGuidance.js";

/** Wider distance bins so small depth jitter does not count as a new scene. */
function distBucket(m) {
  if (m >= 10) return "f";
  if (m >= 6) return "d";
  if (m >= 3.5) return "c";
  if (m >= 1.8) return "b";
  return "a";
}

/** Left/right collapse to "side" so small panning does not flip center ↔ side. */
function zoneBucket(o) {
  if (o.distanceMeters >= 9) return "x";
  const z = o.zone;
  if (z === "center") return "c";
  return "s";
}

/**
 * Coarse, camera/obstacle-only signature for voice (no route or heading).
 * @param {Array<{ class: string, distanceMeters: number, zone: string }>} obstacles
 */
export function voiceSceneSignature(obstacles) {
  if (!obstacles.length) return "clear";
  const rows = [...obstacles]
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 5)
    .map((o) => `${String(o.class).toLowerCase()}:${distBucket(o.distanceMeters)}:${zoneBucket(o)}`);
  return rows.sort().join("|");
}

/**
 * @param {Array<{ class: string, distanceMeters: number, zone: string }>} obstacles
 */
export function stableSceneSignature(obstacles, routeHintSig = "") {
  const base = voiceSceneSignature(obstacles);
  return routeHintSig ? `${base}|${routeHintSig}` : base;
}

/**
 * @returns {{ key: string, nearest: object } | null}
 */
export function computeUrgent(obstacles) {
  if (!obstacles.length) return null;
  const sorted = [...obstacles].sort((a, b) => a.distanceMeters - b.distanceMeters);
  const n = sorted[0];
  if (n.distanceMeters >= 4.2) return null;
  const urgent =
    n.distanceMeters < 3.6 && (n.zone === "center" || n.distanceMeters < 2.6);
  if (!urgent) return null;
  const key = `${String(n.class).toLowerCase()}:${Math.floor(n.distanceMeters / 2.5)}:${zoneBucket(n)}`;
  return { key, nearest: n };
}

const URGENT_MIN_GAP_MS = 9000;
const URGENT_SAME_KEY_REPEAT_MS = 28000;
const NON_URGENT_MIN_GAP_MS = 55000;

/** Consecutive frames with the same coarse scene before we treat it as a real change. */
const SCENE_DEBOUNCE_FRAMES = 3;

/**
 * @typedef {object} VoiceState
 * @property {string} lastSig
 * @property {string | null} lastMode
 * @property {number} lastSpokeAt
 * @property {string} lastUrgentKey
 * @property {string | null} pendingSceneSig
 * @property {number} pendingSceneCount
 */

/**
 * @param {object} p
 * @param {number} p.now
 * @param {Array} p.obstacles
 * @param {number | null} p.gpsAccuracyM
 * @param {object | null} p.navContext
 * @param {string} p.lineFull
 * @param {string} p.textShort
 * @param {(nearest: object) => string} p.makeUrgentText
 * @param {VoiceState} p.state
 * @param {boolean} [p.forceIndoorRoom]
 */
export function decideVoiceUtterance({
  now,
  obstacles,
  gpsAccuracyM,
  navContext,
  lineFull,
  textShort,
  makeUrgentText,
  state,
  forceIndoorRoom = false,
}) {
  const off = typeof navContext?.distanceToPath === "number" ? navContext.distanceToPath : null;
  const mode = guidanceMode(gpsAccuracyM, off, { forceIndoorRoom });
  const sig = voiceSceneSignature(obstacles);
  const urgent = computeUrgent(obstacles);

  const nextState = { ...state };
  const timeSince = now - state.lastSpokeAt;

  // Mode change (GPS / route context) → one full re-orientation line
  if (mode !== state.lastMode) {
    nextState.lastMode = mode;
    nextState.lastSig = sig;
    nextState.pendingSceneSig = null;
    nextState.pendingSceneCount = 0;
    nextState.lastSpokeAt = now;
    nextState.lastUrgentKey = "";
    return { speak: true, text: lineFull, nextState };
  }

  // Close hazard: only when the urgent *key* changes (closer / different object / zone),
  // or same hazard repeats slowly so it is not silent forever
  if (urgent) {
    const sameKey = urgent.key === state.lastUrgentKey;
    if (sameKey && timeSince < URGENT_SAME_KEY_REPEAT_MS) {
      return { speak: false, text: null, nextState };
    }
    if (!sameKey && timeSince < URGENT_MIN_GAP_MS) {
      return { speak: false, text: null, nextState };
    }
    nextState.lastUrgentKey = urgent.key;
    nextState.lastSig = sig;
    nextState.pendingSceneSig = null;
    nextState.pendingSceneCount = 0;
    nextState.lastSpokeAt = now;
    return { speak: true, text: makeUrgentText(urgent.nearest), nextState };
  }

  nextState.lastUrgentKey = "";

  // Same coarse scene as last spoken → reset debounce accumulator
  if (sig === state.lastSig) {
    nextState.pendingSceneSig = null;
    nextState.pendingSceneCount = 0;
    return { speak: false, text: null, nextState };
  }

  // Debounce: require N consecutive ticks with the same new sig before it counts
  let pendingSig = state.pendingSceneSig ?? null;
  let pendingCount = state.pendingSceneCount ?? 0;
  if (sig !== pendingSig) {
    pendingSig = sig;
    pendingCount = 1;
  } else {
    pendingCount = Math.min(pendingCount + 1, SCENE_DEBOUNCE_FRAMES);
  }
  nextState.pendingSceneSig = pendingSig;
  nextState.pendingSceneCount = pendingCount;

  if (pendingCount < SCENE_DEBOUNCE_FRAMES) {
    return { speak: false, text: null, nextState };
  }
  if (timeSince < NON_URGENT_MIN_GAP_MS) {
    return { speak: false, text: null, nextState };
  }

  nextState.lastSig = sig;
  nextState.pendingSceneSig = null;
  nextState.pendingSceneCount = 0;
  nextState.lastSpokeAt = now;
  return { speak: true, text: textShort, nextState };
}

export function initialVoiceState() {
  return {
    lastSig: "",
    lastMode: null,
    lastSpokeAt: 0,
    lastUrgentKey: "",
    pendingSceneSig: null,
    pendingSceneCount: 0,
  };
}
