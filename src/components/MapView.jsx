import { useEffect } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from "react-leaflet";

function MapViewController({ userCoords, routeLatLngs }) {
  const map = useMap();
  useEffect(() => {
    if (routeLatLngs && routeLatLngs.length > 0) {
      const b = L.latLngBounds(routeLatLngs);
      map.fitBounds(b, { padding: [40, 40] });
    } else if (userCoords && typeof userCoords.lat === "number") {
      map.setView([userCoords.lat, userCoords.lng], 14);
    }
  }, [map, userCoords, routeLatLngs]);
  return null;
}

export default function MapView({ userCoords, destCoords, routeLatLngs }) {
  const defaultCenter = [20.5937, 78.9629];
  const defaultZoom = 5;
  const hasUser = userCoords && typeof userCoords.lat === "number";
  const center = hasUser ? [userCoords.lat, userCoords.lng] : defaultCenter;
  const zoom = hasUser ? 14 : defaultZoom;

  return (
    <div className="map-wrap" aria-label="Map">
      <MapContainer center={center} zoom={zoom} scrollWheelZoom className="map-container">
        <MapViewController userCoords={userCoords} routeLatLngs={routeLatLngs} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        {hasUser && (
          <Marker position={[userCoords.lat, userCoords.lng]}>
            <Popup>You are here</Popup>
          </Marker>
        )}
        {destCoords && (
          <Marker position={[destCoords.lat, destCoords.lon]}>
            <Popup>Destination</Popup>
          </Marker>
        )}
        {routeLatLngs && routeLatLngs.length > 0 && (
          <Polyline positions={routeLatLngs} pathOptions={{ color: "#3b82f6", weight: 5, opacity: 0.9 }} />
        )}
      </MapContainer>
    </div>
  );
}
