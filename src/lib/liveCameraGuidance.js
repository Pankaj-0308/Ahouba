/**
 * Present-tense, camera-first lines for continuous monitoring.
 * Indoor mode: door-first—find a way out of the room, then map/route applies outside.
 * COCO has no reliable "door" class—we guide the user to scan walls and openings.
 */

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
  const parts = sorted.map((o) => `${o.class} about ${formatM(o.distanceMeters)} ${o.zone}`);
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
 * Urgent cue. In indoor mode, remind door-first; outside, map + destination.
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
        ? "Bear right or step right to go around it."
        : z === "right"
          ? "Bear left or step left to go around it."
          : "Slow down and step slightly left or right to pass, then keep toward the walls for a door.";
    return `Watch out—${nearest.class} about ${d} ahead on your ${z}. ${steer} After you are outside, we follow the map to ${dest}.`;
  }
  return `Watch out—${nearest.class} about ${d} ${nearest.zone}. Keep heading toward ${dest}. Next: ${map}`;
}

/**
 * @param {number | null | undefined} gpsAccuracyM
 * @param {number | null | undefined} distanceToPath
 * @param {{ forceIndoorRoom?: boolean }} [opts] - user says they are inside a room (door-first).
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
  return /chair|bench|couch|potted plant|suitcase|backpack|dining table|bed|toilet|refrigerator|tv|sink|microwave|oven|clock|vase|book|laptop|mouse|keyboard|remote|cell phone/.test(
    c
  );
}

function isSurfaceHint(o) {
  const c = String(o.class).toLowerCase();
  return (
    o.source === "heuristic" ||
    c.includes("possible stairs") ||
    c.includes("possible pothole")
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
  const names = [...new Set(zoneArr.slice(0, 4).map((o) => o.class))].join(", ");
  return `${names} on your ${label} (nearest about ${formatM(n.distanceMeters)})`;
}

/**
 * Camera-driven directions to leave the room: turn left/right, go straight, favor a side—
 * not a fixed script. Uses obstacle zones + optional brightness (window/door light).
 * @param {boolean} short — one or two sentences for TTS
 */
function buildIndoorSceneGuidance(obstacles, brightnessHint, { dest, map, gpsAccuracyM, off }, short) {
  const sorted = prioritizeIndoorObstacles(obstacles);
  const { left, center, right } = groupByZone(obstacles);
  const people = sorted.filter(isPerson);

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
        ? "The upper left of the view looks brighter—turn left or move forward toward that light; it may be a window or door."
        : brightnessHint.lateral === "right"
          ? "The upper right of the view looks brighter—turn right or move toward that light; it may be a window or door."
          : "The center top of the view looks brighter—go straight toward that brighter band; it may be daylight through a door or glass."
      : "";

  const centerPerson = center.find((o) => isPerson(o) && o.distanceMeters < 3.8);
  if (centerPerson) {
    const passLeft = scores.left >= scores.right;
    const move = passLeft ? "step or turn slightly left" : "step or turn slightly right";
    const avoid = passLeft ? summarizeZoneShort(right, "right") : summarizeZoneShort(left, "left");
    const a = avoid ? ` Watch ${avoid}.` : "";
    const b = short
      ? `Person ahead in the center—${move} to pass.${a}`
      : `Someone is about ${formatM(centerPerson.distanceMeters)} ahead in the middle of your view—${move} to go around them, then keep heading toward the walls to find a door.${a}`;
    return short ? `${b} ${brightLine || ""}`.trim() : `${b} ${brightLine ? brightLine + " " : ""}After you exit, use the map toward ${dest}.`.trim();
  }

  if (!obstacles.length) {
    const base = brightLine
      ? `${brightLine} If you do not see an opening, pan the camera slowly along each wall.`
      : "Pan the camera left and right along the walls—look for a door frame, glass, handle, or EXIT sign, then walk straight toward that opening.";
    return short
      ? `${base} Outside, follow the map to ${dest || "your destination"}.`
      : `${base} The route to ${dest} is for when you are outside. After you leave the building, follow: ${map}. ${gpsAccuracyM != null ? `GPS about ±${Math.round(gpsAccuracyM)} m indoors.` : ""} ${off != null && off > 35 ? `The blue line is ~${Math.round(off)} m away—use it on the street.` : ""}`.trim();
  }

  let move = "";
  if (gapBestMid < 2.5) {
    move =
      "Left, center, and right look similarly busy—move forward a short distance, stop, and let the camera refresh; then choose the side that opens up.";
  } else if (best === "center") {
    const n = nearestInZone(center);
    const d = n ? formatM(n.distanceMeters) : "?";
    move = `Go straight ahead—the middle of your view looks clearer for about ${d} before the next object.`;
  } else if (best === "left") {
    move = `Turn left or walk toward the left—that side looks more open.`;
    if (right.length) move += ` Keep space from ${summarizeZoneShort(right, "right")}.`;
  } else {
    move = `Turn right or walk toward the right—that side looks more open.`;
    if (left.length) move += ` Keep space from ${summarizeZoneShort(left, "left")}.`;
  }

  const worst = order[2];
  if (scores[worst] < 25 && worst !== best) {
    const wz = worst === "left" ? "left" : worst === "right" ? "right" : "center";
    move += ` Avoid committing straight into the ${wz} where it looks tighter.`;
  }

  const sceneList = sorted
    .slice(0, 6)
    .map((o) => `${o.class} ${formatM(o.distanceMeters)} ${o.zone}`)
    .join(", ");

  let surface = "";
  if (obstacles.some(isSurfaceHint)) {
    surface =
      " The camera hints at possible stairs or a dip—check with your foot before stepping.";
  }

  if (short) {
    const bits = `${move} Seen: ${sceneList}.${surface}`;
    const br = brightLine ? ` ${brightLine}` : "";
    return `${bits}${br}`.trim();
  }

  const head =
    `From what the camera sees right now, to get out of this room: ${move} Objects in view: ${sceneList}.${surface}`;

  const tail = ` When you are outside, use the map toward ${dest}: ${map}. ${gpsAccuracyM != null ? `GPS about ±${Math.round(gpsAccuracyM)} m indoors.` : ""} ${off != null && off > 35 ? `Street route is ~${Math.round(off)} m off the line—rejoin it outside.` : ""}`;

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
  const parts = sorted.slice(0, 6).map((o) => `${o.class} ${formatM(o.distanceMeters)} ${o.zone}`);
  const surfaceNote = sorted.some(isSurfaceHint)
    ? " Surface hints are not perfect—double-check dips and steps yourself."
    : "";

  if (urgent) {
    const veh =
      isVehicleLike(nearest) || isPerson(nearest)
        ? " Give it extra space if it is traffic or a person."
        : "";
    return `${lead}Watch out on your path—${nearest.class} about ${formatM(nearest.distanceMeters)} ${nearest.zone}.${veh} Then continue with the map step above.${surfaceNote}`;
  }

  return `${lead}On your path in view: ${parts.join(", ")}.${surfaceNote}`;
}

function buildMixedNarration(obstacles, { dest, map, navContext, gpsAccuracyM, off }) {
  const routeHints = navContext?.routeHints;

  let prefix = `Heading to ${dest}. `;
  if (routeHints?.combined) {
    prefix += routeHints.combined + " ";
  } else {
    prefix += `If you are still inside a room, your first goal is the door—then use the map. `;
  }

  let mid = "";
  if (!obstacles.length) {
    mid = `Live: no listed obstacles. ${map}`;
  } else {
    const sorted = [...obstacles].sort((a, b) => a.distanceMeters - b.distanceMeters);
    const nearest = sorted[0];
    const urgent =
      nearest.distanceMeters < 3.4 && (nearest.zone === "center" || nearest.distanceMeters < 2.4);
    const parts = sorted.slice(0, 6).map((o) => `${o.class} ${formatM(o.distanceMeters)} ${o.zone}`);
    const surf = sorted.some(isSurfaceHint)
      ? " (Camera may hint at stairs or a dip—verify underfoot.)"
      : "";
    mid = urgent
      ? `Watch out—${nearest.class} about ${formatM(nearest.distanceMeters)} ${nearest.zone}. Also: ${parts.slice(1).join(", ") || "stay aware"}. ${map}${surf}`
      : `Live: ${parts.join(", ")}.${surf} ${map}`;
  }

  let tail = "";
  if (gpsAccuracyM != null) tail += ` GPS ±${Math.round(gpsAccuracyM)} m.`;
  if (off != null && off > 40) tail += ` Off line ~${Math.round(off)} m—move toward the blue path.`;

  return prefix + mid + tail;
}
