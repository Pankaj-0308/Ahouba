/**
 * Decides when TTS should fire so slight camera tilt / detection jitter
 * does not re-trigger speech. On-screen line can still update every tick.
 *
 * - Obstacle updates: one announcement per stable view; small tilts are ignored via
 *   frame-difference gating + coarse scene signature + debounce.
 * - Clear path + within 50 m of next step: periodic route-alignment reminders (outdoor/mixed).
 */

import {
  guidanceMode,
  navDirectionVoiceSignature,
  pathAlignSignature,
} from "./liveCameraGuidance.js";

/** Mean abs diff / 255; below this, treat as tilt/jitter, not a new view. */
const VIEW_CHANGE_MIN = 0.032;

/** Consecutive frames with the same coarse scene before we treat it as a real change. */
const SCENE_DEBOUNCE_FRAMES = 5;

/** Minimum time between any non-urgent speech (path hint vs obstacle line). */
const MIN_SPEECH_GAP_MS = 4000;

/** Repeat path-alignment hint while in range and camera is clear. */
const PATH_ALIGN_REPEAT_MS = 45000;

/** If route alignment buckets change, allow a sooner repeat than periodic. */
const PATH_ALIGN_SIG_CHANGE_MIN_MS = 12000;

const URGENT_MIN_GAP_MS = 9000;
const URGENT_SAME_KEY_REPEAT_MS = 28000;

/** Wrong-way alerts: priority after urgent; spaced so they are not constant. */
const WRONG_WAY_SPEECH_GAP_MS = 2800;
const WRONG_WAY_MIN_ANOTHER_MS = 8000;
const WRONG_WAY_REPEAT_MS = 42000;

/** Debounce GPS/route bucket changes before speaking the full monitor line. */
const NAV_DIRECTION_DEBOUNCE_FRAMES = 3;

/** Wider distance bins for voice-only signature. */
function distBucketCoarse(m) {
  if (m >= 8) return "f";
  if (m >= 3.5) return "m";
  return "n";
}

function zoneBucket(o) {
  if (o.distanceMeters >= 9) return "x";
  const z = o.zone;
  if (z === "center") return "c";
  return "s";
}

/**
 * Coarse, camera/obstacle-only signature for voice (no route or heading).
 * Top 3 detections only to reduce flicker.
 * @param {Array<{ class: string, distanceMeters: number, zone: string }>} obstacles
 */
export function voiceSceneSignature(obstacles) {
  if (!obstacles.length) return "clear";
  const rows = [...obstacles]
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 3)
    .map(
      (o) =>
        `${String(o.class).toLowerCase()}:${distBucketCoarse(o.distanceMeters)}:${zoneBucket(o)}`
    );
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

/**
 * @typedef {object} VoiceState
 * @property {string} lastSig
 * @property {string | null} lastMode
 * @property {number} lastSpokeAt
 * @property {string} lastUrgentKey
 * @property {string | null} pendingSceneSig
 * @property {number} pendingSceneCount
 * @property {string} lastPathAlignSig
 * @property {number} lastPathAlignAt
 * @property {string} lastWrongWaySig
 * @property {number} lastWrongWayAt
 * @property {string} lastNavVoiceSig
 * @property {string | null} pendingNavSig
 * @property {number} pendingNavCount
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
 * @param {number} [p.viewChangeScore] — from createFrameChangeTracker(); default 1
 * @param {string | null} [p.pathAlignmentText] — when camera clear + within 50 m of maneuver
 * @param {string | null} [p.wrongWayText]
 * @param {string} [p.wrongWaySignature]
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
  viewChangeScore = 1,
  pathAlignmentText = null,
  wrongWayText = null,
  wrongWaySignature = "",
}) {
  const off = typeof navContext?.distanceToPath === "number" ? navContext.distanceToPath : null;
  const mode = guidanceMode(gpsAccuracyM, off, { forceIndoorRoom });
  let sig = voiceSceneSignature(obstacles);
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
    nextState.lastWrongWaySig = "";
    nextState.lastWrongWayAt = 0;
    nextState.lastNavVoiceSig = "";
    nextState.pendingNavSig = null;
    nextState.pendingNavCount = 0;
    return { speak: true, text: lineFull, nextState };
  }

  // Close hazard
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

  // Wrong direction vs route (compass and/or GPS movement vs path ahead) — outdoor / mixed only
  if (
    wrongWayText &&
    wrongWaySignature &&
    (mode === "outdoor_route" || mode === "mixed")
  ) {
    const gapW = now - (state.lastWrongWayAt || 0);
    const sigCh = wrongWaySignature !== state.lastWrongWaySig;
    const timeOk = timeSince >= WRONG_WAY_SPEECH_GAP_MS;
    const speakWrong =
      timeOk &&
      ((sigCh && gapW >= WRONG_WAY_MIN_ANOTHER_MS) || gapW >= WRONG_WAY_REPEAT_MS);
    if (speakWrong) {
      nextState.lastWrongWayAt = now;
      nextState.lastWrongWaySig = wrongWaySignature;
      nextState.lastSpokeAt = now;
      nextState.pendingSceneSig = null;
      nextState.pendingSceneCount = 0;
      return { speak: true, text: wrongWayText, nextState };
    }
  }

  // Outdoor / mixed: speak full on-screen line when route position or maneuver bucket changes,
  // so users hear map + path alignment + obstacles together (not only when the camera scene changes).
  if ((mode === "outdoor_route" || mode === "mixed") && navContext) {
    const navSig = navDirectionVoiceSignature(navContext);
    if (navSig && navSig !== state.lastNavVoiceSig) {
      let pn = state.pendingNavSig ?? null;
      let pc = state.pendingNavCount ?? 0;
      if (navSig !== pn) {
        pn = navSig;
        pc = 1;
      } else {
        pc = Math.min(pc + 1, NAV_DIRECTION_DEBOUNCE_FRAMES);
      }
      nextState.pendingNavSig = pn;
      nextState.pendingNavCount = pc;
      if (pc >= NAV_DIRECTION_DEBOUNCE_FRAMES && timeSince >= MIN_SPEECH_GAP_MS) {
        nextState.lastNavVoiceSig = navSig;
        nextState.pendingNavSig = null;
        nextState.pendingNavCount = 0;
        nextState.lastSig = voiceSceneSignature(obstacles);
        nextState.pendingSceneSig = null;
        nextState.pendingSceneCount = 0;
        nextState.lastSpokeAt = now;
        return { speak: true, text: lineFull, nextState };
      }
    } else {
      nextState.pendingNavSig = null;
      nextState.pendingNavCount = 0;
    }
  }

  // Path alignment when camera is clear (no obstacles) and outdoors/mixed — within 50 m (hint text only built then)
  if (
    pathAlignmentText &&
    obstacles.length === 0 &&
    (mode === "outdoor_route" || mode === "mixed")
  ) {
    const gapAlign = now - (state.lastPathAlignAt || 0);
    const alignSig = pathAlignSignature(navContext);
    const sigChanged = alignSig !== state.lastPathAlignSig;
    const periodic = gapAlign >= PATH_ALIGN_REPEAT_MS;
    const sigChangeOk = sigChanged && gapAlign >= PATH_ALIGN_SIG_CHANGE_MIN_MS;
    if ((periodic || sigChangeOk) && timeSince >= MIN_SPEECH_GAP_MS) {
      nextState.lastPathAlignSig = alignSig;
      nextState.lastPathAlignAt = now;
      nextState.lastSpokeAt = now;
      nextState.pendingSceneSig = null;
      nextState.pendingSceneCount = 0;
      nextState.lastSig = "clear";
      return { speak: true, text: pathAlignmentText, nextState };
    }
    // In the 50 m zone with a clear camera: wait for periodic path hints—do not spam generic "path clear".
    nextState.pendingSceneSig = null;
    nextState.pendingSceneCount = 0;
    return { speak: false, text: null, nextState };
  }

  // Same scene as last spoken → idle
  if (sig === state.lastSig) {
    nextState.pendingSceneSig = null;
    nextState.pendingSceneCount = 0;
    return { speak: false, text: null, nextState };
  }

  // Detection changed but image barely moved — likely tilt / model jitter; wait for real view change
  if (obstacles.length > 0 && viewChangeScore < VIEW_CHANGE_MIN) {
    nextState.pendingSceneSig = state.pendingSceneSig ?? null;
    nextState.pendingSceneCount = state.pendingSceneCount ?? 0;
    return { speak: false, text: null, nextState };
  }

  // Debounce: N consecutive ticks with the same new sig (while view change is sufficient)
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
  if (timeSince < MIN_SPEECH_GAP_MS) {
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
    lastPathAlignSig: "",
    lastPathAlignAt: 0,
    lastWrongWaySig: "",
    lastWrongWayAt: 0,
    lastNavVoiceSig: "",
    pendingNavSig: null,
    pendingNavCount: 0,
  };
}
