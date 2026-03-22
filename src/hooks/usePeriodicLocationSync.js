import { useEffect, useRef } from "react";
import { getPersonUserId } from "../lib/personUserId.js";

const LOCATION_INTERVAL_MS = 30 * 1000;

function locationsUrl() {
  const base = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
  return base ? `${base}/api/locations` : "/api/locations";
}

/**
 * Upserts location for this user every 30s (personUserId, lat, lng, timestamp, isOnline).
 * Set VITE_PERSON_USER_ID to a fixed MongoDB ObjectId string per device/user if you assign ids server-side.
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
      const personUserId = getPersonUserId();
      if (!personUserId) return;
      const timestamp = new Date().toISOString();
      try {
        await fetch(locationsUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            personUserId,
            lat: c.lat,
            lng: c.lng,
            timestamp,
            isOnline: true,
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
