const LS_KEY = "ahouba_person_user_id";

/** 24 hex chars (12 random bytes) — valid MongoDB ObjectId shape for new IDs. */
function generateObjectIdHex() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function isObjectIdHex(s) {
  return typeof s === "string" && /^[a-fA-F0-9]{24}$/.test(s);
}

/**
 * Stable id for this browser: `VITE_PERSON_USER_ID` in env, else localStorage, else generated once.
 * @returns {string | null}
 */
export function getPersonUserId() {
  const env = (import.meta.env.VITE_PERSON_USER_ID || "").trim();
  if (isObjectIdHex(env)) return env;

  try {
    let id = localStorage.getItem(LS_KEY);
    if (!isObjectIdHex(id)) {
      id = generateObjectIdHex();
      localStorage.setItem(LS_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}
