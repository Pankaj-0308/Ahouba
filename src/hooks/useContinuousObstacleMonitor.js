import { useEffect, useRef } from "react";
import {
  buildLiveMonitorLine,
  buildPathAlignmentHint,
  buildShortObstacleVoice,
  buildUrgentVoice,
  guidanceMode,
} from "../lib/liveCameraGuidance.js";
import { analyzeDirectionalBrightness } from "../lib/indoorCameraHints.js";
import { createFrameChangeTracker } from "../lib/cameraFrameChange.js";
import { decideVoiceUtterance, initialVoiceState } from "../lib/voiceGating.js";

/** How often we run COCO on the camera (continuous monitoring). */
const TICK_MS = 300;

/**
 * Blind-navigation style: keep sampling the camera and updating obstacles + a live line.
 * Voice: obstacle scene + (outdoor/mixed) route/GPS buckets; full monitor line is spoken when either
 * changes. Voice state is always persisted so debouncers advance each tick.
 */
export function useContinuousObstacleMonitor({
  videoEl,
  enabled,
  destination,
  getRouteStep,
  getNavContext,
  getGpsAccuracy,
  onLiveUpdate,
  speakNow,
  voiceEnabled,
  /** When true, use indoor obstacle + empty-space guidance (overrides outdoor-style hints). */
  forceIndoorRoom = false,
}) {
  const inFlightRef = useRef(false);
  const voiceStateRef = useRef(initialVoiceState());
  const frameTrackerRef = useRef(null);

  useEffect(() => {
    if (!enabled) {
      voiceStateRef.current = initialVoiceState();
      frameTrackerRef.current = null;
    }
  }, [enabled]);

  useEffect(() => {
    voiceStateRef.current = initialVoiceState();
    frameTrackerRef.current = null;
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

        const off = typeof navContext?.distanceToPath === "number" ? navContext.distanceToPath : null;
        const mode = guidanceMode(gpsAccuracyM, off, { forceIndoorRoom });
        const brightnessHint = mode === "indoor_exit" ? analyzeDirectionalBrightness(videoEl) : null;

        const line = buildLiveMonitorLine(obstacles, {
          destination: destination || "",
          routeStep,
          navContext,
          gpsAccuracyM,
          forceIndoorRoom,
          brightnessHint,
        });
        if (!cancelled) onLiveUpdate?.({ obstacles, line });

        if (!voiceEnabled || typeof speakNow !== "function" || cancelled) return;

        if (!frameTrackerRef.current) frameTrackerRef.current = createFrameChangeTracker();
        const viewChangeScore = frameTrackerRef.current(videoEl);
        const pathAlignmentText = buildPathAlignmentHint(
          navContext,
          destination || "",
          mode
        );

        const textShort = buildShortObstacleVoice(
          obstacles,
          mode,
          navContext?.routeHints,
          routeStep,
          brightnessHint,
          destination || ""
        );

        // Outside / mixed: speak the same rich line as the screen (where to go + path + obstacles).
        // Indoor: keep shorter obstacle-only updates so we do not repeat the long room paragraph.
        const textForNonUrgent =
          mode === "outdoor_route" || mode === "mixed" ? line : textShort;

        const decision = decideVoiceUtterance({
          now: Date.now(),
          obstacles,
          gpsAccuracyM,
          navContext,
          lineFull: line,
          textShort: textForNonUrgent,
          makeUrgentText: (nearest) =>
            buildUrgentVoice(nearest, destination || "", routeStep, mode),
          state: voiceStateRef.current,
          forceIndoorRoom,
          viewChangeScore,
          pathAlignmentText,
          wrongWayText: navContext?.wrongWayHint ?? null,
          wrongWaySignature: navContext?.wrongWaySignature ?? "",
        });

        voiceStateRef.current = decision.nextState;
        if (decision.speak && decision.text) {
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
    onLiveUpdate,
    speakNow,
    voiceEnabled,
    forceIndoorRoom,
  ]);
}
