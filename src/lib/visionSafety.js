/**
 * Safety decision layer: bridge from 2D vision outputs to navigation *priority*.
 *
 * Coordinate pipeline (full detail in blindDetection.js):
 * 1. **Detector** → axis-aligned bbox `[x, y, w, h]` in **full video pixel space** (overlay + logic share this).
 * 2. **Horizontal thirds** → `zone`: bbox center `cx = x + w/2` compared to `frameWidth/3` and `2*frameWidth/3`.
 *    - Maps image-left / image-center / image-right to spoken "left" | "center" | "right" (user's camera FOV).
 * 3. **Distance** → pinhole-style estimate from bbox height/width vs assumed real-world size (meters along view axis).
 * 4. **Actions (TTS / monitor line)** → `liveCameraGuidance.js` turns `(zone, distanceMeters, class)` into
 *    "bear left / slow / step aside" phrases. This module only decides **when map/GPS guidance must yield** to those cues.
 *
 * When `shouldSuppressMapNavigation` is true, voice gating skips wrong-way, route-bucket, and path-alignment speech
 * so the user hears obstacle handling first—map steps resume once the path is clear enough.
 */

/** Any zone: this close, treat as immediate hazard corridor (aligns with urgent TTS band). */
export const SAFETY_ANY_ZONE_OVERRIDE_M = 2.9;

/** Center FOV strip: blocking object within this range overrides map-first narration. */
export const SAFETY_CENTER_CORRIDOR_OVERRIDE_M = 4.6;

/**
 * @param {Array<{ distanceMeters: number, zone: string }>} obstacles
 * @returns {boolean}
 */
export function shouldSuppressMapNavigation(obstacles) {
  if (!obstacles?.length) return false;
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    const d = Number(o.distanceMeters);
    if (!Number.isFinite(d)) continue;
    if (d < SAFETY_ANY_ZONE_OVERRIDE_M) return true;
    if (o.zone === "center" && d < SAFETY_CENTER_CORRIDOR_OVERRIDE_M) return true;
  }
  return false;
}

/**
 * Nearest obstacle that triggered suppression (for logging / future HUD).
 * @param {Array<{ distanceMeters: number, zone: string }>} obstacles
 * @returns {object | null}
 */
export function primarySafetyObstacle(obstacles) {
  if (!obstacles?.length) return null;
  let best = null;
  let bestScore = Infinity;
  for (const o of obstacles) {
    const d = Number(o.distanceMeters);
    if (!Number.isFinite(d)) continue;
    const centerPenalty = o.zone === "center" ? 0 : 0.35;
    const score = d + centerPenalty;
    if (score < bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return best;
}
