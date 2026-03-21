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
export function buildShortObstacleVoice(obstacles, mode, routeHints, routeStepSnip = "") {
  const snip = (routeStepSnip || "").slice(0, 100);
  const sorted = [...obstacles].sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, 3);
  const parts = sorted.map((o) => `${o.class} about ${formatM(o.distanceMeters)} ${o.zone}`);

  if (mode === "indoor_exit") {
    const pri = prioritizeIndoorObstacles(obstacles)
      .slice(0, 4)
      .map((o) => `${o.class} about ${formatM(o.distanceMeters)} ${o.zone}`);
    if (!pri.length) {
      return "Step 1: Scan walls and corners for a door. Step 2: Move to the clearest wall. Step 3: Exit through the opening, then use the map outside.";
    }
    return `Steps: 1) Aim for a door on the wall. 2) Work around: ${pri.join(", ")}. 3) At the threshold, slow and check the sill. 4) Outside, follow the map.`;
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
    return `Watch out—${nearest.class} about ${d} ${nearest.zone}. Give space, then keep moving toward a door or bright opening. After you exit the room, we will follow the map to ${dest}.`;
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

/** Suggest which side may be clearer toward the wall / door search. */
function sidestepHintForDoor(sorted) {
  let left = 0;
  let right = 0;
  let center = 0;
  for (const o of sorted) {
    if (o.zone === "left") left++;
    else if (o.zone === "right") right++;
    else center++;
  }
  if (left > right + 1) {
    return "More detected objects on your left—try favoring your right side while you search the walls for a door.";
  }
  if (right > left + 1) {
    return "More detected objects on your right—try favoring your left side while you search the walls for a door.";
  }
  if (center >= 3) {
    return "The center of your view is busy—slow down, step slightly, and scan the room edges for a door or exit.";
  }
  return "Move carefully along the walls if you can; doors often sit near corners or straight wall sections.";
}

/**
 * @param {Array<{ class: string, distanceMeters: number, zone: string }>} obstacles
 * @param {object} ctx
 * @param {string} ctx.destination
 * @param {string} ctx.routeStep
 * @param {{ distanceToPath?: number|null } | null} ctx.navContext
 * @param {number | null | undefined} [ctx.gpsAccuracyM]
 * @param {boolean} [ctx.forceIndoorRoom]
 */
export function buildLiveMonitorLine(obstacles, { destination, routeStep, navContext, gpsAccuracyM = null, forceIndoorRoom = false }) {
  const dest = destination || "your destination";
  const map = routeStep?.trim() || "Follow the blue line on the map.";
  const off = typeof navContext?.distanceToPath === "number" ? navContext.distanceToPath : null;
  const mode = guidanceMode(gpsAccuracyM, off, { forceIndoorRoom });

  if (mode === "indoor_exit") {
    return buildIndoorExitNarration(obstacles, { dest, map, gpsAccuracyM, off });
  }
  if (mode === "outdoor_route") {
    return buildOutdoorPathNarration(obstacles, { dest, map, navContext, gpsAccuracyM, off });
  }
  return buildMixedNarration(obstacles, { dest, map, navContext, gpsAccuracyM, off });
}

function buildIndoorExitNarration(obstacles, { dest, map, gpsAccuracyM, off }) {
  const sorted = prioritizeIndoorObstacles(obstacles);
  const people = sorted.filter(isPerson);
  const rest = sorted.filter((o) => !isPerson(o));

  const lines = [];

  lines.push(
    `You are inside a room. Do not rely on the street map yet—the route to ${dest} is for outside. Follow these steps to leave the room safely, then we will use the map.`
  );

  let step = 1;
  lines.push(
    `Step ${step}: Pause and orient. Scan the walls from left to right, then check corners—look for a door frame, glass, a handle, a brighter opening, or an EXIT sign.`
  );
  step++;

  lines.push(
    `Step ${step}: Choose a direction. ${sidestepHintForDoor(sorted)}`
  );
  step++;

  if (people.length) {
    const p = people[0];
    const more = people.length > 1 ? ` (${people.length} people in view)` : "";
    lines.push(
      `Step ${step}: People in the room${more}: someone is about ${formatM(p.distanceMeters)} toward your ${p.zone}. Slow down, announce yourself if needed, and pass on the side with more space—do not turn your back to a door wall you are aiming for.`
    );
    step++;
  }

  if (rest.length) {
    const bits = rest
      .slice(0, 6)
      .map((o) => `${o.class} ${formatM(o.distanceMeters)} ${o.zone}`)
      .join(", ");
    let extra = " Take short segments: move forward a little, re-scan, then adjust.";
    if (rest.some(isStaticIndoor)) {
      extra +=
        " If a table or chair blocks you, sidestep and keep the wall in mind—doors sit on walls, not in the middle of the room.";
    }
    if (rest.some(isSurfaceHint)) {
      extra +=
        " If the camera flags possible stairs or a dip, stop and check with your foot or cane before stepping.";
    }
    lines.push(
      `Step ${step}: Navigate around objects in the room: ${bits}.${extra}`
    );
    step++;
  } else if (!obstacles.length) {
    lines.push(
      `Step ${step}: The camera does not list obstacles—still sweep the walls and corners; move slowly toward the wall that looks most like an exit.`
    );
    step++;
  }

  lines.push(
    `Step ${step}: When you see a clear opening, approach the threshold slowly—check for a step, sill, or swing—then move through.`
  );
  step++;

  lines.push(
    `Step ${step}: Outside the building, open space should help GPS. Then follow the map: ${map} toward ${dest}.`
  );

  if (gpsAccuracyM != null) {
    lines.push(
      `Note: GPS about ±${Math.round(gpsAccuracyM)} m indoors is normal; it should improve when you leave the building.`
    );
  }
  if (off != null && off > 35) {
    lines.push(
      `The blue line is about ${Math.round(off)} m away—use it once you are on the street, not while you are still inside.`
    );
  }

  return lines.join(" ");
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
