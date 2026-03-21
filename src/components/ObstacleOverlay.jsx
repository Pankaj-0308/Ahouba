import { useEffect, useRef } from "react";



/**

 * Draws detection boxes on top of the video (Blind-Navigation style overlay).

 */

export default function ObstacleOverlay({ videoEl, obstacles }) {

  const canvasRef = useRef(null);



  useEffect(() => {

    const canvas = canvasRef.current;

    const video = videoEl;

    if (!canvas || !video) return;



    function draw() {

      const ctx = canvas.getContext("2d");

      if (!ctx) return;

      const vw = video.videoWidth;

      const vh = video.videoHeight;

      if (!vw || !vh) return;



      canvas.width = vw;

      canvas.height = vh;

      ctx.clearRect(0, 0, vw, vh);



      for (const o of obstacles) {

        if (!o.bbox) continue;

        const [x, y, w, h] = o.bbox;

        const isCenter = o.zone === "center";

        ctx.strokeStyle = isCenter ? "rgba(255, 80, 80, 0.95)" : "rgba(80, 160, 255, 0.95)";

        ctx.lineWidth = Math.max(2, Math.round(vw / 400));

        ctx.strokeRect(x, y, w, h);



        const label = `${o.class} ~${o.distanceMeters}m`;

        ctx.font = `${Math.max(12, Math.round(vw / 90))}px system-ui, sans-serif`;

        const tw = Math.min(ctx.measureText(label).width + 10, vw - x);

        const lh = Math.max(18, Math.round(vh / 40));

        ctx.fillStyle = "rgba(0,0,0,0.75)";

        ctx.fillRect(x, Math.max(0, y - lh), tw, lh);

        ctx.fillStyle = "#fff";

        ctx.fillText(label, x + 5, Math.max(12, y - 5));

      }

    }



    draw();

    const onMeta = () => draw();

    video.addEventListener("loadeddata", onMeta);

    const ro = new ResizeObserver(draw);

    ro.observe(video);

    return () => {

      video.removeEventListener("loadeddata", onMeta);

      ro.disconnect();

    };

  }, [videoEl, obstacles]);



  if (!videoEl) return null;

  return <canvas className="obstacle-overlay" aria-hidden="true" ref={canvasRef} />;

}

