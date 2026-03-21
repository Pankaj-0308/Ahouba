/**
 * Present-tense, camera-first lines for continuous monitoring.
 * Handles two modes: (1) likely inside a building—guide toward exit/door, then destination;
 * (2) outside / on route—continuous path + obstacles. COCO has no "door" class—we say "door or exit".
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
    if (!obstacles.length) {
      return "No obstacles in the list. Keep heading for a door or exit.";
    }
    return `Update: ${parts.join(", ")}. Work toward the exit when you can.`;
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

/** Urgent cue + always remind goal and next map step (user asked for both when moving). */
export function buildUrgentVoice(nearest, destination, routeStep) {
  const dest = destination || "your destination";
  const map = (routeStep || "").trim().slice(0, 120) || "Follow the map.";
  return `Watch out—${nearest.class} about ${formatM(nearest.distanceMeters)} ${nearest.zone}. Keep heading toward ${dest}. Next: ${map}`;
}

/**
 * @param {number | null | undefined} gpsAccuracyM
 * @param {number | null | undefined} distanceToPath
 * @returns {"indoor_exit" | "outdoor_route" | "mixed"}
 */
export function guidanceMode(gpsAccuracyM, distanceToPath) {
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
  return /chair|bench|couch|potted plant|suitcase|backpack/.test(c);
}

/**
 * @param {Array<{ class: string, distanceMeters: number, zone: string }>} obstacles
 * @param {object} ctx
 * @param {string} ctx.destination
 * @param {string} ctx.routeStep
 * @param {{ distanceToPath?: number|null } | null} ctx.navContext
 * @param {number | null | undefined} [ctx.gpsAccuracyM]
 */
export function buildLiveMonitorLine(obstacles, { destination, routeStep, navContext, gpsAccuracyM = null }) {
  const dest = destination || "your destination";
  const map = routeStep?.trim() || "Follow the blue line on the map.";
  const off = typeof navContext?.distanceToPath === "number" ? navContext.distanceToPath : null;
  const mode = guidanceMode(gpsAccuracyM, off);

  if (mode === "indoor_exit") {
    return buildIndoorExitNarration(obstacles, { dest, map, gpsAccuracyM, off });
  }
  if (mode === "outdoor_route") {
    return buildOutdoorPathNarration(obstacles, { dest, map, navContext, gpsAccuracyM, off });
  }
  return buildMixedNarration(obstacles, { dest, map, navContext, gpsAccuracyM, off });
}

function buildIndoorExitNarration(obstacles, { dest, map, gpsAccuracyM, off }) {
  const sentences = [];

  sentences.push(
    `You're probably still inside or GPS is weak—the map route to ${dest} is meant for outside on streets. First, get to the outdoors.`
  );

  const sorted = [...obstacles].sort((a, b) => a.distanceMeters - b.distanceMeters);
  const people = sorted.filter(isPerson);
  const rest = sorted.filter((o) => !isPerson(o));

  if (people.length) {
    const p = people[0];
    sentences.push(
      `You see a person about ${formatM(p.distanceMeters)} toward your ${p.zone}—keep distance; pass on the side that has more free space while you head for a door or exit.`
    );
  }

  if (rest.length) {
    const bits = rest
      .slice(0, 4)
      .map((o) => `${o.class} ${formatM(o.distanceMeters)} ${o.zone}`)
      .join(", ");
    const hint = rest.some(isStaticIndoor)
      ? "Move around furniture if needed and keep walking toward daylight or signs for exit."
      : "Keep scanning for a way out.";
    sentences.push(`In the room: ${bits}. ${hint}`);
  }

  if (!obstacles.length) {
    sentences.push(
      "Camera doesn't list obstacles—look for a door, stairs, or exit leading outside; then the map will match better."
    );
  }

  sentences.push(
    `Goal after you're outside: ${dest}. Next map step when GPS picks up: ${map}`
  );

  if (gpsAccuracyM != null) {
    sentences.push(`GPS about ±${Math.round(gpsAccuracyM)} m—indoors this is normal; it should tighten outside.`);
  }
  if (off != null && off > 35) {
    sentences.push(`You're about ${Math.round(off)} m off the drawn line—rejoin it once you're on the street.`);
  }

  return sentences.join(" ");
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
  const parts = sorted.slice(0, 5).map((o) => `${o.class} ${formatM(o.distanceMeters)} ${o.zone}`);

  if (urgent) {
    return `${lead}Watch out on your path—${nearest.class} about ${formatM(nearest.distanceMeters)} ${nearest.zone}. Then continue with the map step above.`;
  }

  return `${lead}On your path in view: ${parts.join(", ")}.`;
}

function buildMixedNarration(obstacles, { dest, map, navContext, gpsAccuracyM, off }) {
  const routeHints = navContext?.routeHints;

  let prefix = `Heading to ${dest}. `;
  if (routeHints?.combined) {
    prefix += routeHints.combined + " ";
  } else {
    prefix += `If you are still inside, reach a door or exit first. `;
  }

  let mid = "";
  if (!obstacles.length) {
    mid = `Live: no listed obstacles. ${map}`;
  } else {
    const sorted = [...obstacles].sort((a, b) => a.distanceMeters - b.distanceMeters);
    const nearest = sorted[0];
    const urgent =
      nearest.distanceMeters < 3.4 && (nearest.zone === "center" || nearest.distanceMeters < 2.4);
    const parts = sorted.slice(0, 5).map((o) => `${o.class} ${formatM(o.distanceMeters)} ${o.zone}`);
    mid = urgent
      ? `Watch out—${nearest.class} about ${formatM(nearest.distanceMeters)} ${nearest.zone}. Also: ${parts.slice(1).join(", ") || "stay aware"}. ${map}`
      : `Live: ${parts.join(", ")}. ${map}`;
  }

  let tail = "";
  if (gpsAccuracyM != null) tail += ` GPS ±${Math.round(gpsAccuracyM)} m.`;
  if (off != null && off > 40) tail += ` Off line ~${Math.round(off)} m—move toward the blue path.`;

  return prefix + mid + tail;
}
