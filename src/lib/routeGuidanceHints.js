/**
 * Where to walk relative to the blue route: on/off line, which way to turn,
 * and whether device heading matches the path direction (outdoors).
 */

import {
  angleDiffDegrees,
  bearingDegrees,
  haversineMeters,
  pointAheadOnPolyline,
  projectOntoPolylineDetailed,
} from "./routeProgress.js";

/** Degrees: if facing or moving differs this much from route-ahead bearing, treat as wrong way. */
const WRONG_WAY_ANGLE_DEG = 118;

/**
 * Coarse signature so voice can react when you drift on/off route without obstacle changes.
 */
export function computeRouteHintSignature(distanceToPath, heading) {
  const d = distanceToPath;
  const band =
    d == null ? "u" : d <= 12 ? "on" : `off${Math.min(20, Math.floor(d / 7))}`;
  const h = heading == null ? "nh" : Math.floor(heading / 28);
  return `${band}:${h}`;
}

/**
 * @param {object} p
 * @param {number} p.userLat
 * @param {number} p.userLng
 * @param {Array<[number, number]>} p.polyline
 * @param {number | null | undefined} p.heading - device compass °, if available
 * @param {number | null | undefined} p.distanceToPath
 * @returns {{ combined: string, alignmentLine: string, facingLine: string, pathToWalkLine: string }}
 */
export function computeRouteGuidanceHints({ userLat, userLng, polyline, heading, distanceToPath }) {
  const empty = {
    combined: "",
    alignmentLine: "",
    facingLine: "",
    pathToWalkLine: "",
  };

  if (!polyline?.length || userLat == null || userLng == null) return empty;

  const dist = typeof distanceToPath === "number" ? distanceToPath : 999;

  let alignmentLine = "";
  let facingLine = "";
  let pathToWalkLine = "";

  if (dist <= 12) {
    alignmentLine = "You are on the blue route—going the right way along the line.";
  } else {
    alignmentLine = `You are about ${Math.round(dist)} meters off the blue line—wrong side of the path until you rejoin it.`;

    const det = projectOntoPolylineDetailed(userLat, userLng, polyline);
    if (det?.projected && heading != null) {
      const bToPath = bearingDegrees(userLat, userLng, det.projected.lat, det.projected.lng);
      const turn = angleDiffDegrees(bToPath, heading);
      if (Math.abs(turn) < 40) {
        pathToWalkLine = "Walk straight toward the blue line—it is roughly ahead of you.";
      } else if (turn > 0) {
        pathToWalkLine = "Turn or walk right—the blue line is toward your right-front.";
      } else {
        pathToWalkLine = "Turn or walk left—the blue line is toward your left-front.";
      }
    } else if (det?.projected) {
      pathToWalkLine = "Move toward the blue line on the map until you are back on route.";
    }
  }

  if (heading != null && dist <= 20) {
    const ahead = pointAheadOnPolyline(polyline, userLat, userLng, 28);
    if (ahead) {
      const routeBearing = bearingDegrees(userLat, userLng, ahead.lat, ahead.lng);
      const delta = angleDiffDegrees(heading, routeBearing);
      if (Math.abs(delta) < 32) {
        facingLine =
          "You are facing about the direction the route goes—keep following the next map instruction.";
      } else if (delta > 32) {
        facingLine = "Turn a bit left—the path ahead on the map bends that way.";
      } else {
        facingLine = "Turn a bit right—the path ahead on the map bends that way.";
      }
    }
  }

  if (dist > 15) {
    facingLine = "";
  }

  const parts = [];
  if (alignmentLine) parts.push(alignmentLine);
  if (pathToWalkLine) parts.push(pathToWalkLine);
  if (facingLine) parts.push(facingLine);

  return {
    combined: parts.join(" "),
    alignmentLine,
    facingLine,
    pathToWalkLine,
  };
}

/**
 * Detect walking or facing opposite the route (toward destination along the blue line).
 * Uses compass when available, and/or GPS movement bearing between recent fixes.
 *
 * @param {object} p
 * @param {number} p.userLat
 * @param {number} p.userLng
 * @param {Array<[number, number]>} p.polyline
 * @param {number | null | undefined} p.heading — device compass °
 * @param {number | null | undefined} p.movementBearing — bearing of recent GPS displacement °
 * @param {number | null | undefined} p.distanceToPath
 * @param {string} [p.destination]
 * @param {boolean} [p.arrived]
 * @returns {{ text: string, signature: string } | null}
 */
export function computeWrongWayHint({
  userLat,
  userLng,
  polyline,
  heading,
  movementBearing,
  distanceToPath,
  destination = "",
  arrived = false,
}) {
  if (arrived) return null;
  if (!polyline?.length || userLat == null || userLng == null) return null;
  const dist = typeof distanceToPath === "number" ? distanceToPath : 999;
  if (dist > 28) return null;

  const ahead = pointAheadOnPolyline(polyline, userLat, userLng, 38);
  if (!ahead) return null;
  const routeBearing = bearingDegrees(userLat, userLng, ahead.lat, ahead.lng);

  const compassWrong =
    heading != null &&
    !Number.isNaN(Number(heading)) &&
    Math.abs(angleDiffDegrees(Number(heading), routeBearing)) > WRONG_WAY_ANGLE_DEG;

  const moveWrong =
    movementBearing != null &&
    !Number.isNaN(Number(movementBearing)) &&
    Math.abs(angleDiffDegrees(Number(movementBearing), routeBearing)) > WRONG_WAY_ANGLE_DEG;

  if (!compassWrong && !moveWrong) return null;

  const dest = String(destination || "").trim() || "your destination";
  const parts = [
    "You are going the wrong way for this route—stop, turn around, and follow the blue line toward your destination.",
    `Aim toward ${dest} along the path shown on the map, not away from it.`,
  ];
  if (compassWrong && moveWrong) {
    parts.push("Both your compass direction and your recent GPS movement disagree with the route ahead.");
  } else if (compassWrong) {
    parts.push("Your phone compass suggests you are facing away from where the route continues.");
  } else {
    parts.push("Your recent GPS movement is opposite the direction the route goes.");
  }

  const sig = `ww:${compassWrong ? "c" : "-"}${moveWrong ? "m" : "-"}:${Math.floor(dist / 5)}`;
  return { text: parts.join(" "), signature: sig };
}

/**
 * Track GPS displacement to estimate walking direction. Call on each fix.
 * When the user moves at least `minMeters` from the anchor, records that segment’s bearing as `lastMoveBearing`.
 * @returns {{ anchor: { lat: number, lng: number } | null, lastMoveBearing: number | null }}
 */
export function advanceWalkTracking(prev, lat, lng, minMeters = 6) {
  if (lat == null || lng == null) {
    return prev || { anchor: null, lastMoveBearing: null };
  }
  const base = prev || { anchor: null, lastMoveBearing: null };
  if (!base.anchor) {
    return { anchor: { lat, lng }, lastMoveBearing: base.lastMoveBearing };
  }
  const moved = haversineMeters(base.anchor.lat, base.anchor.lng, lat, lng);
  if (moved >= minMeters) {
    const b = bearingDegrees(base.anchor.lat, base.anchor.lng, lat, lng);
    return { anchor: { lat, lng }, lastMoveBearing: b };
  }
  return { anchor: base.anchor, lastMoveBearing: base.lastMoveBearing };
}
