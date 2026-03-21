import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import MapView from "./components/MapView.jsx";
import CameraView from "./components/CameraView.jsx";
import ObstacleOverlay from "./components/ObstacleOverlay.jsx";
import { useWatchPosition } from "./hooks/useWatchPosition.js";
import { useSpeech } from "./hooks/useSpeech.js";
import { useContinuousGuidance } from "./hooks/useContinuousGuidance.js";
import { useVisionGuidance } from "./hooks/useVisionGuidance.js";
import { useContinuousObstacleMonitor } from "./hooks/useContinuousObstacleMonitor.js";
import { useVoiceDestination } from "./hooks/useVoiceDestination.js";
import { isVisionConfigured } from "./lib/visionApi.js";
import {
  geocodePhoton,
  fetchOsrmRoute,
  formatDistanceMeters,
  formatDurationSeconds,
} from "./lib/routing.js";
import { getNextManeuver } from "./lib/routeProgress.js";
import { computeRouteGuidanceHints } from "./lib/routeGuidanceHints.js";
import { phraseForApproach } from "./lib/navigationPhrases.js";

const cloudVision = isVisionConfigured();

const speechSupported =
  typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined";

export default function App() {
  const { loading: geoLoading, error: geoError, coords, heading, restart } = useWatchPosition(true);
  const { speakNow, cancel, speaking } = useSpeech();
  const { listen, listening, supported: voiceInputSupported } = useVoiceDestination();

  const [destination, setDestination] = useState("");
  const [profile, setProfile] = useState("foot");
  const [status, setStatus] = useState({ text: "", error: false });
  const [routing, setRouting] = useState(false);
  const [routeLatLngs, setRouteLatLngs] = useState(null);
  const [routeRaw, setRouteRaw] = useState(null);
  const [destCoords, setDestCoords] = useState(null);
  const [activeDestination, setActiveDestination] = useState("");
  const [guidanceEnabled, setGuidanceEnabled] = useState(false);
  const [videoEl, setVideoEl] = useState(null);
  const [visionOn, setVisionOn] = useState(true);
  const [visionText, setVisionText] = useState("");
  const [visionError, setVisionError] = useState(null);
  const [liveLine, setLiveLine] = useState("");
  const [liveObstacles, setLiveObstacles] = useState([]);
  /** Door-first room mode: prioritize finding a door before street-map guidance. */
  const [insideRoomDoorFirst, setInsideRoomDoorFirst] = useState(false);
  const lastVisionRef = useRef("");

  const onVideoReady = useCallback((el) => setVideoEl(el), []);

  const canSubmit = useMemo(
    () => coords && destination.trim().length > 0 && !geoLoading && !routing,
    [coords, destination, geoLoading, routing]
  );

  const hasRoute = routeLatLngs && routeLatLngs.length > 0;

  const liveNav = useMemo(() => {
    if (!routeRaw || !routeLatLngs || !coords) return null;
    const steps = routeRaw.legs?.[0]?.steps;
    if (!steps?.length) return null;
    return getNextManeuver(routeLatLngs, steps, coords.lat, coords.lng);
  }, [routeRaw, routeLatLngs, coords]);

  const getRouteStep = useCallback(() => {
    if (!routeRaw || !liveNav || liveNav.nextIndex < 0) return "";
    const steps = routeRaw.legs?.[0]?.steps;
    if (!steps?.length) return "";
    const step = steps[liveNav.nextIndex];
    if (!step) return "";
    return phraseForApproach(step, liveNav.distanceToManeuverMeters ?? 0);
  }, [routeRaw, liveNav]);

  const getGpsAccuracy = useCallback(() => coords?.accuracy ?? null, [coords?.accuracy]);
  const getHeading = useCallback(() => heading ?? null, [heading]);

  const getNavContext = useCallback(() => {
    if (!routeRaw || !liveNav || liveNav.nextIndex < 0) return null;
    const steps = routeRaw.legs?.[0]?.steps;
    const step = steps?.[liveNav.nextIndex];
    if (!step) return null;
    const m = step.maneuver || {};
    const routeHints =
      coords && routeLatLngs?.length
        ? computeRouteGuidanceHints({
            userLat: coords.lat,
            userLng: coords.lng,
            polyline: routeLatLngs,
            heading,
            distanceToPath: liveNav.distanceToPath,
          })
        : null;
    return {
      distanceToManeuverMeters: liveNav.distanceToManeuverMeters ?? null,
      distanceToPath: liveNav.distanceToPath ?? null,
      maneuverType: m.type || "continue",
      modifier: (m.modifier || "").trim(),
      routeHints,
    };
  }, [routeRaw, liveNav, coords, routeLatLngs, heading]);

  useEffect(() => {
    if (!routeRaw) {
      setGuidanceEnabled(false);
      return;
    }
    setGuidanceEnabled(false);
    const t = window.setTimeout(() => setGuidanceEnabled(true), 1600);
    return () => clearTimeout(t);
  }, [routeRaw]);

  const useGpsVoice = Boolean(
    hasRoute && guidanceEnabled && speechSupported && routeRaw && !visionOn
  );

  useContinuousGuidance({
    route: routeRaw,
    polyline: routeLatLngs,
    coords,
    speakNow,
    enabled: useGpsVoice,
  });

  const onVisionText = useCallback((t) => {
    setVisionText(t);
    lastVisionRef.current = t;
  }, []);

  const onLiveUpdate = useCallback(
    ({ obstacles, line }) => {
      setLiveObstacles(obstacles);
      setLiveLine(line);
      if (!cloudVision) lastVisionRef.current = line;
    },
    [cloudVision]
  );

  useContinuousObstacleMonitor({
    videoEl,
    enabled: Boolean(hasRoute && visionOn && activeDestination && videoEl && !cloudVision),
    destination: activeDestination,
    getRouteStep,
    getNavContext,
    getGpsAccuracy,
    getHeading,
    onLiveUpdate,
    speakNow,
    voiceEnabled: speechSupported && visionOn && !cloudVision,
    forceIndoorRoom: insideRoomDoorFirst,
  });

  const { analyzeNow } = useVisionGuidance({
    videoEl,
    enabled: Boolean(
      hasRoute && visionOn && speechSupported && activeDestination && videoEl && cloudVision
    ),
    speakNow,
    onText: onVisionText,
    onError: setVisionError,
    destination: activeDestination,
    getRouteStep,
    getGpsAccuracy,
    getHeading,
    getNavContext,
  });

  async function onSubmit(e) {
    e.preventDefault();
    if (!coords || !destination.trim()) return;
    cancel();
    setVisionText("");
    setVisionError(null);
    setLiveLine("");
    setLiveObstacles([]);
    setInsideRoomDoorFirst(false);
    setRouting(true);
    setStatus({ text: "Loading route…", error: false });
    setRouteLatLngs(null);
    setRouteRaw(null);
    setDestCoords(null);
    setActiveDestination("");

    try {
      const dest = await geocodePhoton(destination.trim());
      setDestCoords({ lat: dest.lat, lon: dest.lon });
      const route = await fetchOsrmRoute(profile, coords.lng, coords.lat, dest.lon, dest.lat);
      const geom = route.geometry;
      if (!geom || geom.type !== "LineString" || !geom.coordinates) {
        throw new Error("Unexpected route shape.");
      }
      const latLngs = geom.coordinates.map((pair) => [pair[1], pair[0]]);
      setRouteLatLngs(latLngs);
      setRouteRaw(route);
      const d = route.distance;
      const t = route.duration;
      const label = destination.trim();
      setActiveDestination(label);
      setStatus({
        text: `${formatDistanceMeters(d)}, about ${formatDurationSeconds(t)}.`,
        error: false,
      });

      if (speechSupported) {
        const extra = visionOn
          ? cloudVision
            ? " Camera uses your cloud vision API with the route."
            : " Continuous obstacle monitoring is on—first run downloads the detection model."
          : " Turn on AI camera for scene + route voice, or leave it off for GPS-only voice.";
        speakNow(
          `Route to ${label}. About ${formatDistanceMeters(d)}, ${formatDurationSeconds(t)}.${extra}`
        );
      }
    } catch (err) {
      setStatus({ text: err.message || "Something went wrong.", error: true });
    } finally {
      setRouting(false);
    }
  }

  function repeatCurrent() {
    if (!speechSupported) return;
    if (visionOn && lastVisionRef.current) {
      speakNow(lastVisionRef.current);
      return;
    }
    if (!routeRaw || !liveNav || liveNav.nextIndex < 0) return;
    const steps = routeRaw.legs[0].steps;
    const step = steps[liveNav.nextIndex];
    if (!step) return;
    speakNow(phraseForApproach(step, liveNav.distanceToManeuverMeters ?? 0));
  }

  function onVoiceDestination() {
    listen((text) => setDestination(text));
  }

  const offRoute =
    liveNav && typeof liveNav.distanceToPath === "number" && liveNav.distanceToPath > 40;

  return (
    <div className="app app-shell">
      <aside className="app-sidebar" aria-label="Route and controls">
        <div className="app-brand">
          <h1 className="app-title">Live navigation</h1>
          <p className="subtitle">
            Map and controls on the left; live camera and guidance use the rest of the screen. On-device obstacle
            detection with optional cloud vision.
          </p>
        </div>

      <form className="toolbar" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="destination">
          Destination
        </label>
        <input
          id="destination"
          type="text"
          autoComplete="street-address"
          placeholder="Where to?"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          required
        />
        {voiceInputSupported && (
          <button
            type="button"
            className="btn-toolbar"
            onClick={onVoiceDestination}
            disabled={listening}
            title="Speak your destination"
          >
            {listening ? "Listening…" : "Say destination"}
          </button>
        )}
        <select value={profile} onChange={(e) => setProfile(e.target.value)} aria-label="Travel mode">
          <option value="foot">Walk</option>
          <option value="car">Drive</option>
          <option value="bike">Bike</option>
        </select>
        <button type="submit" disabled={!canSubmit}>
          {routing ? "…" : "Go"}
        </button>
        {hasRoute && speechSupported && (
          <button type="button" className="btn-toolbar" onClick={speaking ? cancel : repeatCurrent}>
            {speaking ? "Stop voice" : "Repeat last"}
          </button>
        )}
        {hasRoute && (
          <label className="toggle-obs">
            <input type="checkbox" checked={visionOn} onChange={(e) => setVisionOn(e.target.checked)} />
            AI camera + route voice
          </label>
        )}
        {hasRoute && visionOn && (
          <label className="toggle-obs" title="Prioritize finding a door inside the room; then use the map outside">
            <input
              type="checkbox"
              checked={insideRoomDoorFirst}
              onChange={(e) => setInsideRoomDoorFirst(e.target.checked)}
            />
            Inside room — door first
          </label>
        )}
        {hasRoute && visionOn && cloudVision && (
          <button type="button" className="btn-toolbar" onClick={() => analyzeNow()}>
            Cloud analyze
          </button>
        )}
        {hasRoute && visionOn && !cloudVision && liveLine && (
          <button type="button" className="btn-toolbar" onClick={() => speakNow(liveLine)}>
            Speak live view
          </button>
        )}
      </form>

      <p className="geo-line" aria-live="polite">
        {geoLoading && <span className="muted">Location…</span>}
        {!geoLoading && geoError && <span className="error-text">{geoError}</span>}
        {!geoLoading && coords && (
          <>
            <span className="muted">Tracking:</span>{" "}
            <span className="mono">
              {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
            </span>
            {typeof heading === "number" && (
              <span className="muted"> · heading {Math.round(heading)}°</span>
            )}
            {typeof coords.accuracy === "number" && (
              <span className="muted"> · GPS ±{Math.round(coords.accuracy)} m</span>
            )}
            <button type="button" className="linkish" onClick={restart} disabled={geoLoading}>
              Restart GPS
            </button>
          </>
        )}
      </p>

      <p className={`status ${status.error ? "error" : ""}`} role="status" aria-live="polite">
        {status.text}
        {speaking && <span className="speaking-badge"> Voice…</span>}
        {offRoute && hasRoute && <span className="error-text"> · Off route—return to the blue line.</span>}
      </p>

      <section className="sidebar-map" aria-labelledby="map-label">
        <h2 id="map-label" className="split__label">
          Map & path
        </h2>
        <MapView userCoords={coords} destCoords={destCoords} routeLatLngs={routeLatLngs} />
        <p className="col-foot muted">
          © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ·{" "}
          <a href="https://project-osrm.org/">OSRM</a> · <a href="https://photon.komoot.io">Photon</a>
        </p>
      </section>
      </aside>

      <main className="app-main">
        <section className="app-camera-section" aria-labelledby="camera-label">
          <h2 id="camera-label" className="split__label">
            Live camera
          </h2>
          <CameraView
            onVideoReady={onVideoReady}
            topOverlay={
              hasRoute && visionOn && !cloudVision && videoEl ? (
                <ObstacleOverlay videoEl={videoEl} obstacles={liveObstacles} />
              ) : null
            }
          >
            <h3 className="guidance-title">What to do</h3>
            {!hasRoute && (
              <p className="guidance-text">
                Set a destination and tap <strong>Go</strong>. With AI camera on, guidance leads with the map step, then
                nearby obstacles and distances (on-device, or cloud if you add a key).
              </p>
            )}
            {hasRoute && activeDestination && routeRaw && liveNav && liveNav.nextIndex >= 0 && (
              <>
                <p className="guidance-dest">
                  To <strong>{activeDestination}</strong>
                </p>
                <p className="guidance-sub muted">Map / GPS next step</p>
                <p className="live-guidance" role="status" aria-live="polite">
                  {phraseForApproach(
                    routeRaw.legs[0].steps[liveNav.nextIndex],
                    liveNav.distanceToManeuverMeters ?? 0
                  )}
                </p>
                {visionOn && (
                  <>
                    <p className="guidance-sub muted">
                      {cloudVision ? "Cloud AI summary" : "Continuous obstacle monitor (on-device)"}
                    </p>
                    {visionError && (
                      <p className="guidance-text error-text" role="alert">
                        {visionError}
                      </p>
                    )}
                    {!cloudVision && liveLine && (
                      <p className="live-monitor" role="status" aria-live="polite">
                        {liveLine}
                      </p>
                    )}
                    {cloudVision && visionText && (
                      <p className="vision-block" role="status" aria-live="polite">
                        {visionText}
                      </p>
                    )}
                  </>
                )}
                {!speechSupported && (
                  <p className="guidance-text error-text" role="alert">
                    Enable speech synthesis for voice output.
                  </p>
                )}
                <p className="guidance-hint">
                  {visionOn
                    ? cloudVision
                      ? "Cloud runs on a timer; live COCO overlay is off to save CPU."
                      : "Voice only when the scene meaningfully changes or something is close—small camera tilts won't re-read everything. Readout below still updates live."
                    : "Turn on AI camera for continuous obstacle monitoring, or leave it off for GPS-only voice."}
                </p>
              </>
            )}
          </CameraView>
        </section>
      </main>
    </div>
  );
}
