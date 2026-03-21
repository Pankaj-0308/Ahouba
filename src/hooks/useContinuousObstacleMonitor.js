import { useEffect, useRef } from "react";
import {
  buildLiveMonitorLine,
  buildShortObstacleVoice,
  buildUrgentVoice,
  guidanceMode,
} from "../lib/liveCameraGuidance.js";
import { computeRouteHintSignature } from "../lib/routeGuidanceHints.js";
import { decideVoiceUtterance, initialVoiceState } from "../lib/voiceGating.js";

/** How often we run COCO on the camera (continuous monitoring). */
const TICK_MS = 300;

/**
 * Blind-navigation style: keep sampling the camera and updating obstacles + a live line.
 * Voice uses stable scene signatures + cooldowns so small tilts do not re-trigger TTS.
 */
export function useContinuousObstacleMonitor({
  videoEl,
  enabled,
  destination,
  getRouteStep,
  getNavContext,
  getGpsAccuracy,
  getHeading,
  onLiveUpdate,
  speakNow,
  voiceEnabled,
  /** When true, guidance is door-first inside a room (overrides outdoor-style hints). */
  forceIndoorRoom = false,
}) {
  const inFlightRef = useRef(false);
  const voiceStateRef = useRef(initialVoiceState());

  useEffect(() => {
    if (!enabled) {
      voiceStateRef.current = initialVoiceState();
    }
  }, [enabled]);

  useEffect(() => {
    voiceStateRef.current = initialVoiceState();
  }, [forceIndoorRoom]);

  useEffect(() => {
    if (!enabled || !videoEl) {
      onLiveUpdate?.({ obstacles: [], line: "" });
      return;
    }

    let cancelled = false;

    async function tick() {
      if (cancelled || inFlightRef.current || !videoEl) return;
      if (videoEl.readyState < 2) return;
      inFlightRef.current = true;
      try {
        const { detectNavigationObstacles } = await import("../lib/blindDetection.js");
        const obstacles = await detectNavigationObstacles(videoEl);
        const routeStep = typeof getRouteStep === "function" ? getRouteStep() : "";
        const navContext = typeof getNavContext === "function" ? getNavContext() : null;
        const gpsAccuracyM =
          typeof getGpsAccuracy === "function" ? getGpsAccuracy() : null;

        const line = buildLiveMonitorLine(obstacles, {
          destination: destination || "",
          routeStep,
          navContext,
          gpsAccuracyM,
          forceIndoorRoom,
        });
        if (!cancelled) onLiveUpdate?.({ obstacles, line });

        if (!voiceEnabled || typeof speakNow !== "function" || cancelled) return;

        const off = typeof navContext?.distanceToPath === "number" ? navContext.distanceToPath : null;
        const mode = guidanceMode(gpsAccuracyM, off, { forceIndoorRoom });
        const textShort = buildShortObstacleVoice(
          obstacles,
          mode,
          navContext?.routeHints,
          routeStep
        );

        // Outside / mixed: speak the same rich line as the screen (where to go + path + obstacles).
        // Indoor: keep shorter obstacle-only updates so we do not repeat the long room paragraph.
        const textForNonUrgent =
          mode === "outdoor_route" || mode === "mixed" ? line : textShort;

        const routeHintSig =
          computeRouteHintSignature(
            navContext?.distanceToPath,
            typeof getHeading === "function" ? getHeading() : null
          ) + `|step:${(routeStep || "").slice(0, 48)}`;

        const decision = decideVoiceUtterance({
          now: Date.now(),
          obstacles,
          gpsAccuracyM,
          navContext,
          lineFull: line,
          textShort: textForNonUrgent,
          makeUrgentText: (nearest) =>
            buildUrgentVoice(nearest, destination || "", routeStep, mode),
          routeHintSig,
          state: voiceStateRef.current,
          forceIndoorRoom,
        });

        if (decision.speak && decision.text) {
          voiceStateRef.current = decision.nextState;
          speakNow(decision.text);
        }
      } catch {
        if (!cancelled) onLiveUpdate?.({ obstacles: [], line: "Live scan paused—follow the map." });
      } finally {
        inFlightRef.current = false;
      }
    }

    const id = window.setInterval(() => {
      tick();
    }, TICK_MS);
    tick();

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [
    enabled,
    videoEl,
    destination,
    getRouteStep,
    getNavContext,
    getGpsAccuracy,
    getHeading,
    onLiveUpdate,
    speakNow,
    voiceEnabled,
    forceIndoorRoom,
  ]);
}
