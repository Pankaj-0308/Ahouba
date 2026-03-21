/**
 * Where to walk relative to the blue route: on/off line, which way to turn,
 * and whether device heading matches the path direction (outdoors).
 */

import {
  angleDiffDegrees,
  bearingDegrees,
  pointAheadOnPolyline,
  projectOntoPolylineDetailed,
} from "./routeProgress.js";

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
