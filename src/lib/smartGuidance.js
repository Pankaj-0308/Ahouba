/**
 * Turns raw COCO detections + OSRM route into goal-oriented guidance:
 * where to go (map), how to move (pace / clearance), and path-relevant obstacles.
 */

/** @typedef {{ class: string, distanceMeters: number, zone: string }} NavObstacle */
/** @typedef {{ distanceToManeuverMeters?: number|null, distanceToPath?: number|null, maneuverType?: string, modifier?: string }} NavContext */

function isVehicleClass(c) {
  return /^(car|truck|bus|motorcycle|bicycle|train|boat|airplane)$/i.test(String(c));
}

function isPersonClass(c) {
  return String(c).toLowerCase() === "person";
}

function formatM(m) {
  if (m >= 10) return `${Math.round(m)} meters`;
  return `${Math.round(m * 10) / 10} meters`;
}

/**
 * @param {string} routeStep
 * @param {NavContext | null} navContext
 */
export function inferTurnHint(routeStep, navContext) {
  const mod = (navContext?.modifier || "").toLowerCase();
  if (mod.includes("uturn") || mod.includes("u-turn")) return "uturn";
  if (mod.includes("left") && !mod.includes("right")) return "left";
  if (mod.includes("right")) return "right";

  const t = (routeStep || "").toLowerCase();
  if (/\buturn|u-turn|make a u/.test(t)) return "uturn";
  if (/\broundabout|rotary\b/.test(t)) return "roundabout";
  if (/\bturn\s+.*\bleft\b|\bsharp\s+left|\bslight\s+left|\bleft\s+now\b/.test(t)) return "left";
  if (/\bturn\s+.*\bright\b|\bsharp\s+right|\bslight\s+right|\bright\s+now\b/.test(t)) return "right";
  if (/\bcontinue\s+straight|\bstraight ahead|\bcontinue on\b/.test(t)) return "straight";
  if (/\bexit\s+the\s+roundabout|\bexit\s+onto\b/.test(t)) return "exit";
  return "unknown";
}

function buckets(obstacles) {
  return {
    left: obstacles.filter((o) => o.zone === "left"),
    center: obstacles.filter((o) => o.zone === "center"),
    right: obstacles.filter((o) => o.zone === "right"),
  };
}

function nearest(objs) {
  if (!objs.length) return null;
  return objs.reduce((a, b) => (a.distanceMeters <= b.distanceMeters ? a : b));
}

function describeObs(o) {
  return `${o.class} about ${formatM(o.distanceMeters)} on your ${o.zone}`;
}

/**
 * @param {object} p
 * @param {string} p.destination
 * @param {string} p.routeStep
 * @param {NavObstacle[]} p.obstacles
 * @param {NavContext | null} [p.navContext]
 * @param {number | null} [p.gpsAccuracyM]
 * @param {number | null} [p.heading]
 * @returns {string}
 */
export function buildSmartGuidanceFromDetections({
  destination,
  routeStep,
  obstacles,
  navContext = null,
  gpsAccuracyM = null,
  heading = null,
}) {
  const dest = destination || "your destination";
  const step =
    routeStep && String(routeStep).trim().length > 0
      ? String(routeStep).trim()
      : "Follow the blue line on the map toward your destination.";

  const hint = inferTurnHint(step, navContext);
  const { left, center, right } = buckets(obstacles);
  const nL = nearest(left);
  const nC = nearest(center);
  const nR = nearest(right);

  const distM = navContext?.distanceToManeuverMeters;
  const offPath = navContext?.distanceToPath;

  const parts = [];

  parts.push(`Goal: ${dest}. Your map says: ${step}`);

  if (typeof offPath === "number" && offPath > 35) {
    parts.push(
      "You're off the blue route—get back on the line first, then continue toward your destination."
    );
  }

  if (gpsAccuracyM != null && !Number.isNaN(gpsAccuracyM) && gpsAccuracyM > 22) {
    parts.push(
      `GPS is fuzzy—about ${Math.round(gpsAccuracyM)} meters. If you are still inside a room, find a door first; once you are outside, lean on the map and what you see at each turn.`
    );
  }

  if (heading != null && !Number.isNaN(heading)) {
    parts.push(`Device heading about ${Math.round(heading)} degrees—use with the map, not by itself.`);
  }

  if (hint === "left") {
    if (typeof distM === "number" && distM >= 0 && distM < 40) {
      parts.push(
        `About ${formatM(distM)} from that left turn—check your left side and oncoming traffic before you commit toward ${dest}.`
      );
    } else {
      parts.push(
        "Upcoming left turn: clear your left side and yield as needed before you follow the route."
      );
    }
  } else if (hint === "right") {
    if (typeof distM === "number" && distM >= 0 && distM < 40) {
      parts.push(
        `About ${formatM(distM)} from that right turn—check mirrors, bikes, and pedestrians on your right toward ${dest}.`
      );
    } else {
      parts.push(
        "Upcoming right turn: look right and merge smoothly when it's safe to stay on the route."
      );
    }
  } else if (hint === "uturn") {
    parts.push(
      typeof distM === "number" && distM >= 0 && distM < 50
        ? `About ${formatM(distM)} from the U-turn—pick a legal gap and watch both directions.`
        : "For the U-turn, wait for a safe gap and watch both ways before you reverse toward the route."
    );
  } else if (hint === "roundabout" || hint === "exit") {
    parts.push(
      typeof distM === "number" && distM >= 0 && distM < 50
        ? `About ${formatM(distM)} from the roundabout move—yield and follow your exit toward ${dest}.`
        : "At the roundabout, yield and take the exit that matches the map toward your destination."
    );
  } else if (hint === "straight") {
    parts.push("Keep going straight along the route until the next instruction.");
  }

  if (!obstacles.length) {
    parts.push(
      "No close navigation-class obstacles flagged—still look around, but focus on that map step to reach your goal."
    );
    parts.push("Camera distances are approximate.");
    return parts.join(" ");
  }

  if (obstacles.length >= 6) {
    parts.push(
      "Many objects in view—stay predictable on the route and watch for people and vehicles."
    );
  }

  if (nC && nC.distanceMeters < 2.8) {
    if (isPersonClass(nC.class)) {
      parts.push(
        "Someone is very close ahead—slow down and give space while you still aim for the map maneuver."
      );
    } else if (isVehicleClass(nC.class)) {
      parts.push(
        "A vehicle is close ahead—don't rush; keep a safe gap while heading toward your destination."
      );
    } else {
      parts.push(
        "Something close in the center—ease off speed and steer slightly to clear it without leaving the route idea."
      );
    }
  } else if (nC && nC.distanceMeters < 5.5) {
    parts.push(`Ahead in the center: ${describeObs(nC)}. Adjust speed so you can still follow the map.`);
  } else {
    parts.push(
      "The middle of your view looks open enough—prioritize the map instruction, not random objects."
    );
  }

  if (hint === "left" && nL && nL.distanceMeters < 5) {
    parts.push(
      `On your left now: ${nL.class} about ${formatM(nL.distanceMeters)}—confirm it's clear before you turn left on the route.`
    );
  } else if (hint === "right" && nR && nR.distanceMeters < 5) {
    parts.push(
      `On your right now: ${nR.class} about ${formatM(nR.distanceMeters)}—watch bikes or people before you turn right.`
    );
  }

  if (hint === "left" && nR && nL && nR.distanceMeters < 4 && (!nL || nL.distanceMeters > nR.distanceMeters + 2)) {
    parts.push(
      "Right side looks busier than left—when you set up for the left turn, pick a line that keeps you visible."
    );
  }
  if (hint === "right" && nL && nR && nL.distanceMeters < 4 && (!nR || nR.distanceMeters > nL.distanceMeters + 2)) {
    parts.push(
      "Left side looks busier—glance over your shoulder as you prepare to turn right toward the destination."
    );
  }

  const vehicles = obstacles.filter((o) => isVehicleClass(o.class));
  const people = obstacles.filter((o) => isPersonClass(o.class));
  if (vehicles.length >= 2 && people.length >= 1) {
    parts.push(
      "Vehicles and people together—cross or merge only when both the map maneuver and traffic allow."
    );
  }

  const top = [...obstacles].sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, 2);
  if (top.length) {
    parts.push(
      `Safety snapshot: ${top.map((o) => `${o.class} ${formatM(o.distanceMeters)} ${o.zone}`).join(", ")}.`
    );
  }

  parts.push("Rough camera distances—follow the map to actually reach your destination.");

  return parts.join(" ");
}
