import { useState, useEffect, useCallback, useRef } from "react";

const watchOptions = {
  enableHighAccuracy: true,
  maximumAge: 2000,
  timeout: 15000,
};

export function useWatchPosition(active = true) {
  const [state, setState] = useState({
    loading: true,
    error: null,
    coords: null,
    heading: null,
  });
  const idRef = useRef(null);

  const clearWatch = useCallback(() => {
    if (idRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(idRef.current);
      idRef.current = null;
    }
  }, []);

  const startWatch = useCallback(() => {
    if (!navigator.geolocation) {
      setState({ loading: false, error: "Geolocation not supported.", coords: null, heading: null });
      return;
    }
    clearWatch();
    setState((s) => ({ ...s, loading: true, error: null }));

    idRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const h = pos.coords.heading;
        setState({
          loading: false,
          error: null,
          coords: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          },
          heading: typeof h === "number" && !Number.isNaN(h) ? h : null,
        });
      },
      (err) => {
        let message = err.message || "Could not get location.";
        if (err.code === err.PERMISSION_DENIED) message = "Allow location for continuous guidance.";
        setState({ loading: false, error: message, coords: null, heading: null });
      },
      watchOptions
    );
  }, [clearWatch]);

  useEffect(() => {
    if (active) startWatch();
    else clearWatch();
    return () => clearWatch();
  }, [active, startWatch, clearWatch]);

  return { ...state, restart: startWatch };
}
