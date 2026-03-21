/**
 * Spoken/UI labels for COCO-SSD classes (model uses fixed English names).
 * "class" stays the raw COCO string for logic; "displayName" is for people.
 */

/** @type {Record<string, string>} */
export const OBJECT_DISPLAY_LABELS = {
  "dining table": "table",
  refrigerator: "wardrobe",
  "potted plant": "plant",
  "cell phone": "phone",
  tv: "TV",
  couch: "sofa",
  laptop: "laptop",
  "traffic light": "traffic light",
  "stop sign": "stop sign",
  "fire hydrant": "fire hydrant",
  "parking meter": "parking meter",
  "sports ball": "ball",
  "baseball bat": "bat",
  "baseball glove": "glove",
  "tennis racket": "racket",
  "hair drier": "hair dryer",
  "hot dog": "snack",
  suitcase: "suitcase",
  backpack: "backpack",
  handbag: "bag",
  umbrella: "umbrella",
  bench: "bench",
  bottle: "bottle",
  cup: "cup",
  bowl: "bowl",
  chair: "chair",
  bed: "bed",
  toilet: "toilet",
  sink: "sink",
  microwave: "microwave",
  oven: "oven",
  clock: "clock",
  vase: "vase",
  book: "book",
  scissors: "scissors",
  "teddy bear": "teddy bear",
  person: "person",
  bicycle: "bicycle",
  car: "car",
  motorcycle: "motorcycle",
  bus: "bus",
  truck: "truck",
  bird: "bird",
  cat: "cat",
  dog: "dog",
};

/**
 * @param {string} className
 * @returns {string}
 */
export function displayNameForClass(className) {
  const k = String(className).toLowerCase();
  return OBJECT_DISPLAY_LABELS[k] ?? className;
}

/**
 * @param {{ class?: string, displayName?: string } | null | undefined} o
 * @returns {string}
 */
export function obstacleSpokenLabel(o) {
  if (!o) return "";
  if (o.displayName && String(o.displayName).trim()) return o.displayName;
  return displayNameForClass(o.class ?? "");
}
