const EARTH_M = 6371000;

function toRad(d) {
  return (d * Math.PI) / 180;
}

function toDeg(r) {
  return (r * 180) / Math.PI;
}

/** Initial bearing from point 1 to point 2, degrees 0–360 (clockwise from north). */
export function bearingDegrees(lat1, lng1, lat2, lng2) {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return (toDeg(θ) + 360) % 360;
}

export function angleDiffDegrees(a, b) {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(a));
}

function projectPointOnSegment(lat, lng, lat1, lng1, lat2, lng2) {
  const x = (lng - lng1) * Math.cos(toRad((lat1 + lat) / 2));
  const y = lat - lat1;
  const xs = (lng2 - lng1) * Math.cos(toRad((lat1 + lat2) / 2));
  const ys = lat2 - lat1;
  const len2 = xs * xs + ys * ys;
  let t = len2 > 1e-12 ? (x * xs + y * ys) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return {
    lat: lat1 + t * (lat2 - lat1),
    lng: lng1 + t * (lng2 - lng1),
  };
}

/**
 * @param {number} lat
 * @param {number} lng
 * @param {Array<[number, number]>} polyline [[lat,lng], ...]
 */
export function projectOntoPolyline(lat, lng, polyline) {
  if (!polyline || polyline.length < 2) return null;

  let bestDist = Infinity;
  let bestAlong = 0;
  let cumulative = 0;

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const segLen = haversineMeters(a[0], a[1], b[0], b[1]);
    const proj = projectPointOnSegment(lat, lng, a[0], a[1], b[0], b[1]);
    const d = haversineMeters(lat, lng, proj.lat, proj.lng);
    const alongSeg = haversineMeters(a[0], a[1], proj.lat, proj.lng);
    const along = cumulative + alongSeg;
    if (d < bestDist) {
      bestDist = d;
      bestAlong = along;
    }
    cumulative += segLen;
  }

  return {
    distanceAlong: bestAlong,
    distanceToPath: bestDist,
  };
}

/**
 * Closest point on polyline plus segment index (for direction / ahead helpers).
 */
export function projectOntoPolylineDetailed(lat, lng, polyline) {
  if (!polyline || polyline.length < 2) return null;

  let bestDist = Infinity;
  let bestAlong = 0;
  let bestSeg = 0;
  let bestProj = null;
  let cumulative = 0;

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const segLen = haversineMeters(a[0], a[1], b[0], b[1]);
    const proj = projectPointOnSegment(lat, lng, a[0], a[1], b[0], b[1]);
    const d = haversineMeters(lat, lng, proj.lat, proj.lng);
    const alongSeg = haversineMeters(a[0], a[1], proj.lat, proj.lng);
    const along = cumulative + alongSeg;
    if (d < bestDist) {
      bestDist = d;
      bestAlong = along;
      bestSeg = i;
      bestProj = proj;
    }
    cumulative += segLen;
  }

  return {
    distanceAlong: bestAlong,
    distanceToPath: bestDist,
    segmentIndex: bestSeg,
    projected: bestProj,
  };
}

/**
 * Point `aheadMeters` along the polyline from the user's projected position (toward destination).
 */
export function pointAheadOnPolyline(polyline, userLat, userLng, aheadMeters) {
  const det = projectOntoPolylineDetailed(userLat, userLng, polyline);
  if (!det) return null;
  const targetAlong = det.distanceAlong + Math.max(5, aheadMeters);
  let cumulative = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const segLen = haversineMeters(a[0], a[1], b[0], b[1]);
    if (cumulative + segLen >= targetAlong) {
      const t = segLen > 1e-6 ? (targetAlong - cumulative) / segLen : 0;
      const tt = Math.max(0, Math.min(1, t));
      return {
        lat: a[0] + tt * (b[0] - a[0]),
        lng: a[1] + tt * (b[1] - a[1]),
      };
    }
    cumulative += segLen;
  }
  const last = polyline[polyline.length - 1];
  return { lat: last[0], lng: last[1] };
}

/**
 * Distance along the polyline from the start to each OSRM step maneuver point.
 * @param {Array<[number, number]>} polyline [[lat,lng], ...]
 * @param {object[]} steps OSRM leg steps
 */
export function maneuverAlongDistances(polyline, steps) {
  if (!steps?.length) return [];
  return steps.map((step) => {
    const loc = step.maneuver?.location;
    if (!loc || loc.length < 2) return 0;
    const lng = loc[0];
    const lat = loc[1];
    const p = projectOntoPolyline(lat, lng, polyline);
    return p ? p.distanceAlong : 0;
  });
}

/**
 * Find next step index whose maneuver is ahead of the user along the path.
 * Returns { nextIndex, distanceToManeuverMeters, distanceToPath, arrived }
 */
export function getNextManeuver(polyline, steps, userLat, userLng) {
  if (!polyline?.length || !steps?.length) {
    return { nextIndex: -1, distanceToManeuverMeters: null, distanceToPath: null, arrived: false };
  }

  const user = projectOntoPolyline(userLat, userLng, polyline);
  if (!user) {
    return { nextIndex: -1, distanceToManeuverMeters: null, distanceToPath: null, arrived: false };
  }

  const alongs = maneuverAlongDistances(polyline, steps);
  const userAlong = user.distanceAlong;
  const lastIdx = steps.length - 1;
  const lastStep = steps[lastIdx];
  const lastAlong = alongs[lastIdx] ?? 0;

  if (lastStep?.maneuver?.type === "arrive" && userAlong >= lastAlong - 15) {
    return {
      nextIndex: lastIdx,
      distanceToManeuverMeters: Math.max(0, lastAlong - userAlong),
      distanceToPath: user.distanceToPath,
      arrived: userAlong >= lastAlong - 10,
    };
  }

  let nextIndex = -1;
  for (let i = 0; i < steps.length; i++) {
    if (alongs[i] > userAlong + 3) {
      nextIndex = i;
      break;
    }
  }

  if (nextIndex < 0) {
    return {
      nextIndex: lastIdx,
      distanceToManeuverMeters: 0,
      distanceToPath: user.distanceToPath,
      arrived: true,
    };
  }

  return {
    nextIndex,
    distanceToManeuverMeters: Math.max(0, alongs[nextIndex] - userAlong),
    distanceToPath: user.distanceToPath,
    arrived: false,
  };
}
