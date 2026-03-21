function formatDistanceSpeech(m) {
  if (m == null || Number.isNaN(m)) return "";
  if (m >= 1000) {
    const km = m / 1000;
    return km >= 10 ? `${Math.round(km)} kilometers` : `${km.toFixed(1)} kilometers`;
  }
  if (m >= 100) return `${Math.round(m / 10) * 10} meters`;
  return `${Math.round(m)} meters`;
}

function formatDurationSpeech(s) {
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return `${h} hour${h === 1 ? "" : "s"} and ${m} minutes`;
  }
  if (s >= 60) return `${Math.round(s / 60)} minutes`;
  return `${Math.round(s)} seconds`;
}

function streetName(step) {
  const n = step.name;
  if (n && String(n).trim()) return n;
  return "the path ahead";
}

export function stepToSpeechLine(step, index1, total) {
  const m = step.maneuver || {};
  const type = m.type || "continue";
  const name = streetName(step);
  const d = formatDistanceSpeech(step.distance);
  const modifier = (m.modifier || "").trim();

  if (type === "depart") {
    return `Step ${index1} of ${total}. Start on ${name}. Go ${d}.`;
  }
  if (type === "continue") {
    if (modifier && modifier !== "straight" && modifier !== "uturn") {
      return `Step ${index1} of ${total}. Continue with a ${modifier} on ${name} for ${d}.`;
    }
    return `Step ${index1} of ${total}. Continue on ${name} for ${d}.`;
  }
  if (type === "turn") {
    const turn = modifier ? `Turn ${modifier}` : "Turn";
    return `Step ${index1} of ${total}. ${turn} onto ${name}. Then continue for ${d}.`;
  }
  if (type === "arrive") {
    return "You have arrived.";
  }
  if (type === "roundabout" || type === "rotary") {
    const exit = modifier ? `take ${modifier}` : "take the correct exit";
    return `Step ${index1} of ${total}. Enter the roundabout and ${exit} toward ${name}. Continue for ${d}.`;
  }
  if (type === "exit roundabout" || type === "exit rotary") {
    return `Step ${index1} of ${total}. Exit the roundabout onto ${name}. Continue for ${d}.`;
  }
  if (type === "fork") {
    return `Step ${index1} of ${total}. At the fork, keep ${modifier || "straight"} toward ${name}. Continue for ${d}.`;
  }
  if (type === "merge") {
    return `Step ${index1} of ${total}. Merge ${modifier || ""} onto ${name}. Continue for ${d}.`.replace(/\s+/g, " ");
  }
  if (type === "end of road") {
    return `Step ${index1} of ${total}. At the end of the road, turn ${modifier || "where the path goes"} onto ${name}. Continue for ${d}.`;
  }
  return `Step ${index1} of ${total}. Continue along ${name} for ${d}.`;
}

export function buildSpeechLines(route, destinationLabel) {
  const leg = route?.legs?.[0];
  const steps = leg?.steps || [];
  const intro = `Navigating to ${destinationLabel}. Total distance ${formatDistanceSpeech(route.distance)}. About ${formatDurationSpeech(route.duration)}.`;
  const lines = [intro];
  const max = 28;
  const slice = steps.slice(0, max);
  const total = steps.length;
  for (let i = 0; i < slice.length; i++) {
    lines.push(stepToSpeechLine(slice[i], i + 1, total));
  }
  if (steps.length > max) {
    lines.push(
      `The route has ${steps.length - max} more steps. Follow the blue line on the map until you arrive.`
    );
  }
  if (!steps.length) {
    lines.push("Follow the blue line on the map toward your destination.");
  }
  return lines;
}

export function getStepDisplayLines(route, limit = 8) {
  const leg = route?.legs?.[0];
  const steps = leg?.steps || [];
  const total = steps.length;
  const slice = steps.slice(0, limit);
  return slice.map((s, i) => stepToSpeechLine(s, i + 1, total));
}
