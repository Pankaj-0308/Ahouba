/**
 * Compares consecutive downscaled grayscale frames to estimate how much the
 * camera view changed. Small tilts / jitter produce low scores; pans or walking
 * forward produce higher scores.
 */

/**
 * @returns {(video: HTMLVideoElement) => number} measure — ~0.004–0.02 for tiny motion, higher when the scene shifts
 */
export function createFrameChangeTracker() {
  let prev = null;
  let prevW = 0;
  let prevH = 0;

  return function measureFrameChange(video) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || video.readyState < 2) return 1;

    const target = 56;
    const scale = Math.min(target / vw, target / vh);
    const tw = Math.max(8, Math.round(vw * scale));
    const th = Math.max(8, Math.round(vh * scale));

    try {
      const canvas = document.createElement("canvas");
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return 1;
      ctx.drawImage(video, 0, 0, tw, th);
      const { data } = ctx.getImageData(0, 0, tw, th);
      const n = tw * th;
      const gray = new Uint8Array(n);
      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }

      if (!prev || prev.length !== gray.length || prevW !== tw || prevH !== th) {
        prev = new Uint8Array(gray);
        prevW = tw;
        prevH = th;
        return 1;
      }

      let sum = 0;
      for (let i = 0; i < n; i++) sum += Math.abs(gray[i] - prev[i]);
      prev.set(gray);

      const mad = sum / n / 255;
      return mad;
    } catch {
      return 1;
    }
  };
}
