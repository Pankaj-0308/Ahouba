import { useState, useEffect, useCallback } from "react";

const options = {
  enableHighAccuracy: true,
  timeout: 20000,
  maximumAge: 0,
};

export function useGeolocation() {
  const [state, setState] = useState({
    loading: true,
    error: null,
    coords: null,
  });

  const refresh = useCallback(() => {
    if (!navigator.geolocation) {
      setState({
        loading: false,
        error: "Geolocation is not supported.",
        coords: null,
      });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setState({
          loading: false,
          error: null,
          coords: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          },
        });
      },
      (err) => {
        let message = err.message || "Could not get location.";
        if (err.code === err.PERMISSION_DENIED) {
          message = "Allow location access to show the route from where you are.";
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          message = "Position unavailable.";
        } else if (err.code === err.TIMEOUT) {
          message = "Location timed out. Try Refresh.";
        }
        setState({ loading: false, error: message, coords: null });
      },
      options
    );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...state, refresh };
}
