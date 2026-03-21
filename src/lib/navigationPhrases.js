function streetName(step) {
  const n = step?.name;
  if (n && String(n).trim()) return n;
  return "the path";
}

function distSpeech(m) {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} kilometers`;
  if (m >= 100) return `${Math.round(m / 10) * 10} meters`;
  return `${Math.round(m)} meters`;
}

/**
 * Short spoken hint for the upcoming maneuver at `step`, `distM` meters before it.
 */
export function phraseForApproach(step, distM) {
  const m = step?.maneuver || {};
  const type = m.type || "continue";
  const name = streetName(step);
  const mod = (m.modifier || "").trim();
  const d = distSpeech(distM);

  if (type === "arrive") {
    return distM < 12 ? "You have arrived." : `In ${d}, you will arrive.`;
  }

  if (distM < 10) {
    if (type === "turn") {
      return mod ? `Turn ${mod} now onto ${name}.` : `Turn now onto ${name}.`;
    }
    if (type === "continue") {
      if (mod && mod !== "straight") return `Now continue with a ${mod} on ${name}.`;
      return `Continue on ${name}.`;
    }
    if (type === "depart") {
      return `Start on ${name}.`;
    }
    if (type === "roundabout" || type === "rotary") {
      return mod ? `Enter the roundabout, ${mod} now.` : `Enter the roundabout now toward ${name}.`;
    }
    return `Proceed onto ${name}.`;
  }

  if (type === "turn") {
    return mod ? `In ${d}, turn ${mod} onto ${name}.` : `In ${d}, turn onto ${name}.`;
  }
  if (type === "continue") {
    if (mod && mod !== "straight") {
      return `In ${d}, continue with a ${mod} on ${name}.`;
    }
    return `In ${d}, continue on ${name}.`;
  }
  if (type === "depart") {
    return `In ${d}, begin on ${name}.`;
  }
  if (type === "roundabout" || type === "rotary") {
    return `In ${d}, enter the roundabout toward ${name}.`;
  }
  if (type === "exit roundabout" || type === "exit rotary") {
    return `In ${d}, exit onto ${name}.`;
  }
  return `In ${d}, follow ${name}.`;
}
