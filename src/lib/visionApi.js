/**
 * Vision-language analysis via an OpenAI-compatible /v1/chat/completions API.
 * Set in .env: VITE_VISION_API_KEY, optional VITE_VISION_API_URL, VITE_VISION_MODEL.
 * For OpenRouter: VITE_VISION_API_URL=https://openrouter.ai/api/v1
 *
 * Keys in Vite are exposed to the browser—use a backend proxy in production.
 */

export function isVisionConfigured() {
  return Boolean(String(import.meta.env.VITE_VISION_API_KEY || "").trim());
}

/**
 * Cloud vision if `VITE_VISION_API_KEY` is set; otherwise map + COCO obstacle distances (see `localVision.js`).
 * @returns {Promise<string>}
 */
export async function analyzeScene(props) {
  if (isVisionConfigured()) {
    return analyzeSceneVision(props);
  }
  const { analyzeSceneLocal } = await import("./localVision.js");
  return analyzeSceneLocal(props);
}

function navContextLine(navContext) {
  if (!navContext || typeof navContext !== "object") return "";
  const bits = [];
  if (navContext.distanceToManeuverMeters != null) {
    bits.push(`Distance to next maneuver: about ${Math.round(navContext.distanceToManeuverMeters)} meters`);
  }
  if (navContext.distanceToPath != null) {
    bits.push(`Distance off route line: about ${Math.round(navContext.distanceToPath)} meters`);
  }
  if (navContext.maneuverType) bits.push(`Maneuver type: ${navContext.maneuverType}`);
  if (navContext.modifier) bits.push(`Modifier: ${navContext.modifier}`);
  return bits.length ? bits.join(". ") + "." : "";
}

export function captureVideoFrameDataUrl(video, maxWidth = 512) {
  if (!video || video.readyState < 2 || video.videoWidth < 8) return null;
  const canvas = document.createElement("canvas");
  const w = Math.min(maxWidth, video.videoWidth);
  const h = Math.max(1, Math.round(video.videoHeight * (w / video.videoWidth)));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  canvas.width = w;
  canvas.height = h;
  try {
    ctx.drawImage(video, 0, 0, w, h);
  } catch {
    return null;
  }
  return canvas.toDataURL("image/jpeg", 0.82);
}

function buildPrompt(destination, routeStep, gpsAccuracy, heading, navContext) {
  const ctx = navContextLine(navContext);
  return `You guide someone to ONE destination using the map. The image supports safety along that route only.

Destination: ${destination}
Map instruction (primary—where to go): ${routeStep || "Not available yet."}
${ctx ? `Route context: ${ctx}\n` : ""}GPS accuracy (meters): ${gpsAccuracy != null ? `${Math.round(gpsAccuracy)}` : "unknown"}
Compass (degrees): ${heading != null ? `${Math.round(heading)}` : "unknown"}

Speak under 100 words for text-to-speech. Be smart and actionable—not a list of objects:
- Start with what to do next to stay on the route toward the destination (turns, straight, roundabout).
- Tie what you see to that move: e.g. if a left turn is coming, say whether the left side looks clear; mention center-path hazards if they block forward progress.
- Say approximate left, center, or right of the frame only when it helps decide how to move toward the destination.
- Ignore irrelevant things (food, decor, distant details) unless they affect safety on the path.
- If GPS is poor, say to trust the map line. Do not invent street names.`;
}

/**
 * @returns {Promise<string>}
 */
export async function analyzeSceneVision({
  imageDataUrl,
  destination,
  routeStep,
  gpsAccuracy,
  heading,
  navContext = null,
}) {
  const key = String(import.meta.env.VITE_VISION_API_KEY || "").trim();
  if (!key) throw new Error("Vision API key not configured");

  const base = String(import.meta.env.VITE_VISION_API_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = String(import.meta.env.VITE_VISION_MODEL || "gpt-4o-mini");

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
  const referer = import.meta.env.VITE_OPENROUTER_HTTP_REFERER;
  if (referer) headers["HTTP-Referer"] = referer;

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      max_tokens: 450,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: buildPrompt(destination, routeStep, gpsAccuracy, heading, navContext) },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const err = await res.json();
      detail = err.error?.message || JSON.stringify(err);
    } catch {
      detail = await res.text();
    }
    throw new Error(detail || `Vision API error ${res.status}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty response from vision model");
  return text;
}
