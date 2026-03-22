import { useEffect, useRef } from "react";

const HALF_HOUR_MS = 30 * 60 * 1000;

function locationsUrl() {
  const base = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
  return base ? `${base}/api/locations` : "/api/locations";
}

/**
 * POSTs the latest GPS fix to the server every 30 minutes while enabled.
 * Requires MongoDB + POST /api/locations on the same origin (prod) or Vite proxy (dev).
 */
export function usePeriodicLocationSync(coords, enabled = true) {
  const coordsRef = useRef(null);
  coordsRef.current = coords;

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;

    async function send() {
      const c = coordsRef.current;
      if (!c || cancelled) return;
      try {
        await fetch(locationsUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat: c.lat,
            lng: c.lng,
            accuracy: c.accuracy,
            source: "web",
          }),
        });
      } catch {
        /* offline or server down */
      }
    }

    const id = window.setInterval(send, HALF_HOUR_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled]);
}
