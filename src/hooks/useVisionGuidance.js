import { useEffect, useRef, useCallback } from "react";
import { analyzeScene, captureVideoFrameDataUrl } from "../lib/visionApi.js";

/** Obstacle + map refresh (COCO is local; avoid spamming speech) */
const DEFAULT_INTERVAL_MS = 10000;

/**
 * Cloud vision if configured; else continuous COCO obstacle distances + map context (no generic scene chat).
 */
export function useVisionGuidance({
  videoEl,
  enabled,
  speakNow,
  onText,
  onError,
  destination,
  getRouteStep,
  getGpsAccuracy,
  getHeading,
  getNavContext,
  intervalMs = DEFAULT_INTERVAL_MS,
}) {
  const lastSpokenRef = useRef(0);
  const lastHashRef = useRef("");
  const inFlightRef = useRef(false);

  const runAnalysis = useCallback(
    async (withVoice) => {
      if (!videoEl || inFlightRef.current) return;
      const dataUrl = captureVideoFrameDataUrl(videoEl);
      if (!dataUrl) return;

      inFlightRef.current = true;
      try {
        const text = await analyzeScene({
          imageDataUrl: dataUrl,
          video: videoEl,
          destination: destination || "Unknown",
          routeStep: typeof getRouteStep === "function" ? getRouteStep() : "",
          gpsAccuracy: typeof getGpsAccuracy === "function" ? getGpsAccuracy() : null,
          heading: typeof getHeading === "function" ? getHeading() : null,
          navContext: typeof getNavContext === "function" ? getNavContext() : null,
        });
        onText?.(text);
        onError?.(null);

        if (withVoice) {
          const hash = text.slice(0, 160);
          const now = Date.now();
          if (now - lastSpokenRef.current > 12000 && hash !== lastHashRef.current) {
            lastHashRef.current = hash;
            lastSpokenRef.current = now;
            speakNow(text);
          }
        }
      } catch (e) {
        const msg = e.message || "Vision request failed";
        onError?.(msg);
      } finally {
        inFlightRef.current = false;
      }
    },
    [videoEl, destination, getRouteStep, getGpsAccuracy, getHeading, getNavContext, speakNow, onText, onError]
  );

  const analyzeNow = useCallback(() => runAnalysis(true), [runAnalysis]);

  useEffect(() => {
    if (!enabled || !videoEl) return;

    const t0 = window.setTimeout(() => runAnalysis(true), 2000);
    const id = window.setInterval(() => runAnalysis(true), intervalMs);
    return () => {
      clearTimeout(t0);
      clearInterval(id);
    };
  }, [enabled, videoEl, intervalMs, runAnalysis]);

  return { analyzeNow };
}
