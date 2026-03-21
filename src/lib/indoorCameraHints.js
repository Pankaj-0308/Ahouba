/**
 * Lightweight camera analysis indoors: **brighter** regions in the upper frame
 * often point toward windows or open, lit areas. Hint only—not a detector.
 */

/**
 * @returns {{ lateral: "left" | "center" | "right"; strength: number } | null}
 */
export function analyzeDirectionalBrightness(video) {
  if (!video || video.readyState < 2 || video.videoWidth < 32) return null;

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const maxW = 200;
  const scale = Math.min(1, maxW / vw);
  const cw = Math.max(32, Math.round(vw * scale));
  const ch = Math.max(24, Math.round(vh * scale));

  try {
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, cw, ch);

    const y1 = Math.floor(ch * 0.45);
    const { data } = ctx.getImageData(0, 0, cw, y1);
    const tw = cw;
    const th = y1;
    const third = Math.max(1, Math.floor(tw / 3));
    const sums = [0, 0, 0];
    const counts = [0, 0, 0];

    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const col = x < third ? 0 : x < 2 * third ? 1 : 2;
        const i = (y * tw + x) * 4;
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        sums[col] += lum;
        counts[col]++;
      }
    }

    const means = sums.map((s, i) => s / Math.max(1, counts[i]));
    const max = Math.max(means[0], means[1], means[2]);
    const min = Math.min(means[0], means[1], means[2]);
    const strength = max - min;
    if (strength < 9) return null;

    let lateral = "center";
    if (means[0] >= means[1] && means[0] >= means[2]) lateral = "left";
    else if (means[2] >= means[0] && means[2] >= means[1]) lateral = "right";

    return { lateral, strength };
  } catch {
    return null;
  }
}
