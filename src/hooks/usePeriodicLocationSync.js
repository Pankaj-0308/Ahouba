import { useEffect, useRef } from "react";

const LOCATION_INTERVAL_MS = 30 * 1000;

function locationsUrl() {
  const base = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
  return base ? `${base}/api/locations` : "/api/locations";
}

/**
 * POSTs the latest GPS fix to the server every 30 seconds while enabled.
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

    void send();
    const id = window.setInterval(send, LOCATION_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled]);
}
