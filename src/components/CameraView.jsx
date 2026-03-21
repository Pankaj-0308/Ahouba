import { useRef, useEffect, useLayoutEffect, useState, useCallback } from "react";

const videoConstraints = {
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
  audio: false,
};

export default function CameraView({ children, onVideoReady, topOverlay }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(true);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);
    setStarting(true);
    stopStream();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError("Camera API not available in this browser.");
      setStarting(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(videoConstraints);
      streamRef.current = stream;
      const el = videoRef.current;
      if (el) {
        el.srcObject = stream;
        await el.play().catch(() => {});
      }
      setStarting(false);
    } catch (e) {
      setError(e.message || "Could not open camera. Allow access or use HTTPS.");
      setStarting(false);
    }
  }, [stopStream]);

  useEffect(() => {
    startCamera();
    return () => stopStream();
  }, [startCamera, stopStream]);

  useLayoutEffect(() => {
    if (!onVideoReady) return;
    onVideoReady(videoRef.current);
    return () => onVideoReady(null);
  }, [onVideoReady]);

  return (
    <div className="camera-stack">
      <div className="camera-panel" aria-label="Live camera preview">
        <video ref={videoRef} className="camera-video" autoPlay playsInline muted />
        {topOverlay}
        {starting && !error && (
          <div className="camera-overlay muted" role="status">
            Starting camera…
          </div>
        )}
        {error && (
          <div className="camera-overlay camera-overlay--error" role="alert">
            <p>{error}</p>
            <button type="button" className="btn-retry" onClick={startCamera}>
              Try camera again
            </button>
          </div>
        )}
      </div>
      <div className="guidance-panel">{children}</div>
    </div>
  );
}
