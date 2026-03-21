export function geocodePhoton(query) {
  const url = "https://photon.komoot.io/api/?q=" + encodeURIComponent(query) + "&limit=1";
  return fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error("Geocoding failed");
      return r.json();
    })
    .then((data) => {
      if (!data.features || !data.features.length) {
        throw new Error("No place found for: " + query);
      }
      const c = data.features[0].geometry.coordinates;
      return { lon: c[0], lat: c[1] };
    });
}

export function fetchOsrmRoute(profile, fromLon, fromLat, toLon, toLat) {
  const coords = `${fromLon},${fromLat};${toLon},${toLat}`;
  const base = `https://router.project-osrm.org/route/v1/${profile}/${coords}`;
  const url = `${base}?overview=full&geometries=geojson&steps=true`;
  return fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error("Routing request failed");
      return r.json();
    })
    .then((data) => {
      if (data.code !== "Ok" || !data.routes || !data.routes.length) {
        throw new Error(data.message || "No route for this mode.");
      }
      return data.routes[0];
    });
}

export function formatDistanceMeters(m) {
  if (m >= 1000) return (m / 1000).toFixed(1) + " km";
  return Math.round(m) + " m";
}

export function formatDurationSeconds(s) {
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return `${h} h ${m} min`;
  }
  if (s >= 60) return `${Math.round(s / 60)} min`;
  return `${Math.round(s)} s`;
}
