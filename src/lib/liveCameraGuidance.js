/**
 * Present-tense, camera-first lines for continuous monitoring.
 * Indoor mode: list obstacles and steer toward clearer / more open floor space.
 */

import { obstacleSpokenLabel } from "./obstacleLabels.js";

function formatM(m) {
  if (m >= 10) return `${Math.round(m)} m`;
  return `${Math.round(m * 10) / 10} m`;
}

/**
 * Short TTS when scene updates but we should not repeat the long "go outside" monologue.
 * @param {"indoor_exit" | "outdoor_route" | "mixed"} mode
 * @param {{ combined?: string } | null | undefined} routeHints
 * @param {string} [routeStepSnip] - next map instruction
 */
export function buildShortObstacleVoice(
  obstacles,
  mode,
  routeHints,
  routeStepSnip = "",
  brightnessHint = null,
  destination = ""
) {
  const snip = (routeStepSnip || "").slice(0, 100);
  const sorted = [...obstacles].sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, 3);
  const parts = sorted.map(
    (o) => `${obstacleSpokenLabel(o)} about ${formatM(o.distanceMeters)} ${o.zone}`
  );
  const destShort = destination || "your destination";

  if (mode === "indoor_exit") {
    return buildIndoorSceneGuidance(
      obstacles,
      brightnessHint,
      { dest: destShort, map: "", gpsAccuracyM: null, off: null },
      true
    );
  }

  if (mode === "outdoor_route") {
    const bits = [];
    bits.push(`Goal: reach your destination.`);
    bits.push(`Where to go: ${snip || "Follow the blue line."}.`);
    if (routeHints?.combined) bits.push(routeHints.combined);
    if (obstacles.length) bits.push(`Obstacles: ${parts.join(", ")}.`);
    else bits.push("Camera: path clear in the list.");
    return bits.join(" ");
  }

  if (mode === "mixed") {
    const bits = [];
    bits.push(`Goal: reach your destination.`);
    bits.push(`Where to go: ${snip || "Follow the map."}.`);
    if (routeHints?.combined) bits.push(routeHints.combined);
    if (obstacles.length) bits.push(`Obstacles: ${parts.join(", ")}.`);
    else bits.push("Camera: nothing flagged.");
    return bits.join(" ");
  }

  if (!obstacles.length) return "Path looks clear in the camera view.";
  return `Update: ${parts.join(", ")}.`;
}

/**
 * Urgent cue. Indoor: steer around the obstacle toward open space; outside: map + destination.
 * @param {"indoor_exit" | "outdoor_route" | "mixed"} [mode]
 */
export function buildUrgentVoice(nearest, destination, routeStep, mode = "mixed") {
  const dest = destination || "your destination";
  const map = (routeStep || "").trim().slice(0, 120) || "Follow the map.";
  const d = formatM(nearest.distanceMeters);
  if (mode === "indoor_exit") {
    const z = nearest.zone;
    const steer =
      z === "left"
        ? "Bear right or step right to go around it toward clearer space."
        : z === "right"
          ? "Bear left or step left to go around it toward clearer space."
          : "Slow down and step slightly left or right to pass, then move toward where the floor looks more open.";
    return `Watch out—${obstacleSpokenLabel(nearest)} about ${d} ahead on your ${z}. ${steer}`;
  }
  return `Watch out—${obstacleSpokenLabel(nearest)} about ${d} ${nearest.zone}. Keep heading toward ${dest}. Next: ${map}`;
}

/**
 * @param {number | null | undefined} gpsAccuracyM
 * @param {number | null | undefined} distanceToPath
 * @param {{ forceIndoorRoom?: boolean }} [opts] - user says they are inside a room (object + empty-space guidance).
 * @returns {"indoor_exit" | "outdoor_route" | "mixed"}
 */
export function guidanceMode(gpsAccuracyM, distanceToPath, opts = {}) {
  if (opts.forceIndoorRoom) return "indoor_exit";

  const g = gpsAccuracyM;
  const d = distanceToPath;

  if (g != null && g > 42) return "indoor_exit";
  if (d != null && d > 70) return "indoor_exit";
  if (g != null && d != null && g > 30 && d > 52) return "indoor_exit";

  if (g != null && g <= 34 && d != null && d <= 42) return "outdoor_route";

  return "mixed";
}

function isPerson(o) {
  return String(o.class).toLowerCase() === "person";
}

function isStaticIndoor(o) {
  const c = String(o.class).toLowerCase();
  return /chair|bench|couch|potted plant|suitcase|backpack|dining table|bed|toilet|refrigerator|tv|sink|microwave|oven|clock|vase|book|laptop|mouse|keyboard|remote|cell phone|bottle|cup|bowl|banana|apple|orange|handbag|umbrella|toaster|hair drier|teddy bear|scissors/.test(
    c
  );
}

function isVehicleLike(o) {
  const c = String(o.class).toLowerCase();
  return /^(car|truck|bus|motorcycle|bicycle|train|boat|airplane)$/.test(c);
}

/** People first (safety), then furniture (routing), then other objects. */
export function prioritizeIndoorObstacles(obstacles) {
  const rank = (o) => {
    if (isPerson(o)) return 0;
    if (isStaticIndoor(o)) return 1;
    return 2;
  };
  return [...obstacles].sort((a, b) => {
    const dr = rank(a) - rank(b);
    if (dr !== 0) return dr;
    return a.distanceMeters - b.distanceMeters;
  });
}

/**
 * @param {Array<{ class: string, distanceMeters: number, zone: string }>} obstacles
 * @param {object} ctx
 * @param {string} ctx.destination
 * @param {string} ctx.routeStep
 * @param {{ distanceToPath?: number|null } | null} ctx.navContext
 * @param {number | null | undefined} [ctx.gpsAccuracyM]
 * @param {boolean} [ctx.forceIndoorRoom]
 * @param {{ lateral: string, strength: number } | null} [ctx.brightnessHint] — from camera (upper frame light)
 */
export function buildLiveMonitorLine(
  obstacles,
  {
    destination,
    routeStep,
    navContext,
    gpsAccuracyM = null,
    forceIndoorRoom = false,
    brightnessHint = null,
  }
) {
  const dest = destination || "your destination";
  const map = routeStep?.trim() || "Follow the blue line on the map.";
  const off = typeof navContext?.distanceToPath === "number" ? navContext.distanceToPath : null;
  const mode = guidanceMode(gpsAccuracyM, off, { forceIndoorRoom });

  if (mode === "indoor_exit") {
    return buildIndoorSceneGuidance(obstacles, brightnessHint, { dest, map, gpsAccuracyM, off }, false);
  }
  if (mode === "outdoor_route") {
    return buildOutdoorPathNarration(obstacles, { dest, map, navContext, gpsAccuracyM, off });
  }
  return buildMixedNarration(obstacles, { dest, map, navContext, gpsAccuracyM, off });
}

function groupByZone(obstacles) {
  const left = [];
  const center = [];
  const right = [];
  for (const o of obstacles) {
    if (o.zone === "left") left.push(o);
    else if (o.zone === "right") right.push(o);
    else center.push(o);
  }
  return { left, center, right };
}

function nearestInZone(zoneArr) {
  if (!zoneArr.length) return null;
  return zoneArr.reduce((a, b) => (a.distanceMeters <= b.distanceMeters ? a : b));
}

function zoneOpennessScore(zoneArr) {
  if (!zoneArr.length) return 100;
  const nearest = nearestInZone(zoneArr);
  const dist = nearest.distanceMeters;
  const count = zoneArr.length;
  return dist * 2.0 - count * 1.4;
}

function summarizeZoneShort(zoneArr, label) {
  if (!zoneArr.length) return "";
  const n = nearestInZone(zoneArr);
  const names = [...new Set(zoneArr.slice(0, 4).map((o) => obstacleSpokenLabel(o)))].join(", ");
  return `${names} on your ${label} (nearest about ${formatM(n.distanceMeters)})`;
}

/**
 * Camera-driven indoor guidance: obstacle list + steer toward the zone that scores as more open.
 * Optional brightness hint (window / open area). No door detection.
 * @param {boolean} short — one or two sentences for TTS
 */
function buildIndoorSceneGuidance(obstacles, brightnessHint, { dest, map, gpsAccuracyM, off }, short) {
  const navSorted = prioritizeIndoorObstacles(obstacles);
  const { left, center, right } = groupByZone(obstacles);

  const scores = {
    left: zoneOpennessScore(left),
    center: zoneOpennessScore(center),
    right: zoneOpennessScore(right),
  };

  const order = ["left", "center", "right"].sort((a, b) => scores[b] - scores[a]);
  const best = order[0];
  const mid = order[1];
  const gapBestMid = scores[best] - scores[mid];

  const brightLine =
    brightnessHint && brightnessHint.strength >= 10
      ? brightnessHint.lateral === "left"
        ? "The upper left of the view looks brighter—you can drift or turn left toward that open or lit area."
        : brightnessHint.lateral === "right"
          ? "The upper right of the view looks brighter—you can drift or turn right toward that open or lit area."
          : "The upper center looks brighter—try moving forward toward that lighter band if the floor feels clear."
      : "";

  const centerPerson = center.find((o) => isPerson(o) && o.distanceMeters < 3.8);
  if (centerPerson) {
    const passLeft = scores.left >= scores.right;
    const move = passLeft ? "step or turn slightly left" : "step or turn slightly right";
    const avoid = passLeft ? summarizeZoneShort(right, "right") : summarizeZoneShort(left, "left");
    const a = avoid ? ` Watch ${avoid}.` : "";
    const b = short
      ? `Person ahead in the center—${move} to pass.${a}`
      : `Someone is about ${formatM(centerPerson.distanceMeters)} ahead in the middle of your view—${move} to go around them.${a}`;
    return short
      ? `${b} ${brightLine || ""}`.trim()
      : `${b} ${brightLine ? brightLine + " " : ""}When you have a GPS fix outside, use the map toward ${dest}.`.trim();
  }

  if (!obstacles.length) {
    const base = brightLine
      ? `${brightLine} Pan slowly to refresh what is in view.`
      : "Pan the camera slowly left and right; walk toward where the floor sounds and feels more open.";
    return short
      ? `${base} When outside, the map leads to ${dest || "your destination"}.`
      : `${base} Map route for later: ${map}. ${gpsAccuracyM != null ? `GPS about ±${Math.round(gpsAccuracyM)} m indoors.` : ""} ${off != null && off > 35 ? `The blue line is ~${Math.round(off)} m away when you are on the street.` : ""}`.trim();
  }

  let move = "";
  if (gapBestMid < 2.5) {
    move =
      "The floor looks equally busy on all sides—shuffle forward a little, pause, then aim toward whichever side has more empty space when the view updates.";
  } else if (best === "center") {
    const n = nearestInZone(center);
    const d = n ? formatM(n.distanceMeters) : "?";
    move = `Walk toward the open space in front of you—the center looks clearer for about ${d} before the next obstacle.`;
  } else if (best === "left") {
    move = `Move left toward more empty floor space—that side looks less blocked.`;
    if (right.length) move += ` Keep clearance from ${summarizeZoneShort(right, "right")}.`;
  } else {
    move = `Move right toward more empty floor space—that side looks less blocked.`;
    if (left.length) move += ` Keep clearance from ${summarizeZoneShort(left, "left")}.`;
  }

  const worst = order[2];
  if (scores[worst] < 25 && worst !== best) {
    const wz = worst === "left" ? "left" : worst === "right" ? "right" : "center";
    move += ` Avoid committing straight into the ${wz} where it looks tighter.`;
  }

  const sceneList = navSorted
    .slice(0, 6)
    .map((o) => `${obstacleSpokenLabel(o)} ${formatM(o.distanceMeters)} ${o.zone}`)
    .join(", ");

  if (short) {
    const bits = `${move} In view: ${sceneList}.`;
    const br = brightLine ? ` ${brightLine}` : "";
    return `${bits}${br}`.trim();
  }

  const head = `To move through the room: ${move} What the camera sees: ${sceneList}.`;
  const tail = ` When you are outside with a good GPS fix, use the map toward ${dest}: ${map}. ${gpsAccuracyM != null ? `GPS about ±${Math.round(gpsAccuracyM)} m indoors.` : ""} ${off != null && off > 35 ? `Street route is ~${Math.round(off)} m off the line when outdoors.` : ""}`;

  const brightFirst = brightLine ? `${brightLine} ` : "";
  return `${brightFirst}${head} ${tail}`.trim();
}

function buildOutdoorPathNarration(obstacles, { dest, map, navContext, gpsAccuracyM, off }) {
  const routeHints = navContext?.routeHints;

  let lead = `Where to go: ${map} Goal: ${dest}. `;

  if (routeHints?.combined) {
    lead += routeHints.combined + " ";
  } else {
    lead += `Outside toward ${dest}. `;
    if (gpsAccuracyM != null) {
      lead += `GPS about ±${Math.round(gpsAccuracyM)} m. `;
    }
    if (typeof off === "number" && off > 35) {
      lead += `You are about ${Math.round(off)} m off the blue line—step back onto the route. `;
    }
  }

  if (!obstacles.length) {
    return `${lead}Camera: nothing flagged on your path. Keep following the map for each turn.`;
  }

  const sorted = [...obstacles].sort((a, b) => a.distanceMeters - b.distanceMeters);
  const nearest = sorted[0];
  const urgent =
    nearest.distanceMeters < 3.2 && (nearest.zone === "center" || nearest.distanceMeters < 2.3);
  const parts = sorted.slice(0, 6).map(
    (o) => `${obstacleSpokenLabel(o)} ${formatM(o.distanceMeters)} ${o.zone}`
  );
  if (urgent) {
    const veh =
      isVehicleLike(nearest) || isPerson(nearest)
        ? " Give it extra space if it is traffic or a person."
        : "";
    return `${lead}Watch out on your path—${obstacleSpokenLabel(nearest)} about ${formatM(nearest.distanceMeters)} ${nearest.zone}.${veh} Then continue with the map step above.`;
  }

  return `${lead}On your path in view: ${parts.join(", ")}.`;
}

function buildMixedNarration(obstacles, { dest, map, navContext, gpsAccuracyM, off }) {
  const routeHints = navContext?.routeHints;

  let prefix = `Heading to ${dest}. `;
  if (routeHints?.combined) {
    prefix += routeHints.combined + " ";
  } else {
    prefix += `Inside a building, use the live view to avoid obstacles and favor open floor space; then use the map when you are outside. `;
  }

  let mid = "";
  if (!obstacles.length) {
    mid = `Live: no listed obstacles. ${map}`;
  } else {
    const sorted = [...obstacles].sort((a, b) => a.distanceMeters - b.distanceMeters);
    const nearest = sorted[0];
    const urgent =
      nearest.distanceMeters < 3.4 && (nearest.zone === "center" || nearest.distanceMeters < 2.4);
    const parts = sorted.slice(0, 6).map(
      (o) => `${obstacleSpokenLabel(o)} ${formatM(o.distanceMeters)} ${o.zone}`
    );
    mid = urgent
      ? `Watch out—${obstacleSpokenLabel(nearest)} about ${formatM(nearest.distanceMeters)} ${nearest.zone}. Also: ${parts.slice(1).join(", ") || "stay aware"}. ${map}`
      : `Live: ${parts.join(", ")}. ${map}`;
  }

  let tail = "";
  if (gpsAccuracyM != null) tail += ` GPS ±${Math.round(gpsAccuracyM)} m.`;
  if (off != null && off > 40) tail += ` Off line ~${Math.round(off)} m—move toward the blue path.`;

  return prefix + mid + tail;
}

/**
 * When the camera shows no obstacles and you are close to the next maneuver (≤50 m),
 * remind route alignment: on/off line, facing, distance to next step.
 * @param {"indoor_exit" | "outdoor_route" | "mixed"} mode
 * @returns {string | null}
 */
export function buildPathAlignmentHint(navContext, destination, mode) {
  if (mode === "indoor_exit" || !navContext) return null;
  const dM = navContext.distanceToManeuverMeters;
  const dPath = navContext.distanceToPath;
  if (dM == null || dM > 50) return null;
  if (dPath == null) return null;
  const rh = navContext.routeHints;
  if (!rh) return null;
  const dest = destination || "your destination";
  const bits = [];
  if (dPath <= 12) bits.push("You are on the blue route line.");
  else bits.push(`About ${Math.round(dPath)} meters off the blue line—steer back toward the route.`);
  if (rh.facingLine) bits.push(rh.facingLine);
  else if (rh.pathToWalkLine) bits.push(rh.pathToWalkLine);
  bits.push(`About ${Math.round(dM)} meters to the next map step toward ${dest}.`);
  return bits.join(" ");
}

/**
 * Coarse signature for path-alignment voice (avoid re-speaking the same bucket).
 */
export function pathAlignSignature(navContext) {
  if (!navContext || navContext.distanceToManeuverMeters == null) return "";
  const dM = navContext.distanceToManeuverMeters;
  const dP = navContext.distanceToPath ?? 999;
  return `pa:${Math.floor(dM / 8)}:${Math.floor(dP / 6)}`;
}

/**
 * Coarse buckets for GPS/route state so TTS can fire when you move along the route or drift,
 * even if the camera obstacle list is unchanged.
 */
export function navDirectionVoiceSignature(navContext) {
  if (!navContext) return "";
  const dP = navContext.distanceToPath;
  const dM = navContext.distanceToManeuverMeters;
  const p =
    dP == null ? "u" : dP <= 8 ? "on" : dP <= 22 ? "n" : dP <= 45 ? "m" : "f";
  const m = dM == null ? "u" : `M${Math.floor(Math.min(dM, 400) / 15)}`;
  const w = navContext.wrongWaySignature ? "W" : "_";
  return `${p}|${m}|${w}`;
}
