import { useEffect, useRef } from "react";
import { getNextManeuver } from "../lib/routeProgress.js";
import { phraseForApproach } from "../lib/navigationPhrases.js";

const OFF_ROUTE_M = 38;
const MIN_SPEECH_GAP_MS = 2800;

/**
 * Speaks short updates as the user moves along the route.
 */
export function useContinuousGuidance({
  route,
  polyline,
  coords,
  speakNow,
  enabled,
}) {
  const announcedRef = useRef(new Set());
  const prevStepRef = useRef(-1);
  const lastSpeechRef = useRef(0);
  const offRouteLastRef = useRef(0);
  const arrivedSpokenRef = useRef(false);

  useEffect(() => {
    announcedRef.current.clear();
    prevStepRef.current = -1;
    arrivedSpokenRef.current = false;
    offRouteLastRef.current = 0;
  }, [route, polyline]);

  useEffect(() => {
    if (!enabled || !route || !polyline?.length || !coords) return;

    const steps = route.legs?.[0]?.steps;
    if (!steps?.length) return;

    const { nextIndex, distanceToManeuverMeters, distanceToPath, arrived } = getNextManeuver(
      polyline,
      steps,
      coords.lat,
      coords.lng
    );

    const now = Date.now();

    if (arrived && !arrivedSpokenRef.current) {
      arrivedSpokenRef.current = true;
      speakNow("You have arrived at your destination.");
      lastSpeechRef.current = Date.now();
      return;
    }

    if (typeof distanceToPath === "number" && distanceToPath > OFF_ROUTE_M) {
      if (now - offRouteLastRef.current > 22000) {
        offRouteLastRef.current = now;
        speakNow("You are off the route. Move back toward the blue line on the map.");
        lastSpeechRef.current = Date.now();
      }
      return;
    }

    if (nextIndex < 0 || distanceToManeuverMeters == null) return;

    if (prevStepRef.current !== nextIndex) {
      announcedRef.current.clear();
      prevStepRef.current = nextIndex;
    }

    const step = steps[nextIndex];
    const dist = distanceToManeuverMeters;

    const bands = [
      { max: 120, key: "120" },
      { max: 70, key: "70" },
      { max: 35, key: "35" },
      { max: 14, key: "14" },
    ];

    for (const band of bands) {
      const key = `${nextIndex}-${band.key}`;
      if (dist > band.max || announcedRef.current.has(key)) continue;
      const urgent = band.key === "14";
      if (!urgent && now - lastSpeechRef.current < MIN_SPEECH_GAP_MS) continue;
      announcedRef.current.add(key);
      speakNow(phraseForApproach(step, dist));
      lastSpeechRef.current = Date.now();
      break;
    }
  }, [route, polyline, coords, enabled, speakNow]);
}
