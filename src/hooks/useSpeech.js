import { useRef, useCallback, useState, useEffect } from "react";

function pickEnglishVoice() {
  const synth = window.speechSynthesis;
  if (!synth) return null;
  const voices = synth.getVoices();
  return (
    voices.find((v) => v.lang === "en-US") ||
    voices.find((v) => v.lang?.toLowerCase().startsWith("en")) ||
    null
  );
}

export function useSpeech() {
  const [speaking, setSpeaking] = useState(false);
  const queueRef = useRef([]);

  const cancel = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    queueRef.current = [];
    setSpeaking(false);
  }, []);

  const speak = useCallback((lines) => {
    if (typeof window === "undefined" || !window.speechSynthesis || !lines?.length) return;
    window.speechSynthesis.cancel();
    queueRef.current = [...lines];
    setSpeaking(true);

    let i = 0;
    function next() {
      if (i >= queueRef.current.length) {
        setSpeaking(false);
        return;
      }
      const text = queueRef.current[i];
      const u = new SpeechSynthesisUtterance(text);
      const voice = pickEnglishVoice();
      if (voice) u.voice = voice;
      u.lang = "en-US";
      u.rate = 0.92;
      u.pitch = 1;
      u.onend = () => {
        i++;
        next();
      };
      u.onerror = () => {
        i++;
        next();
      };
      window.speechSynthesis.speak(u);
    }
    next();
  }, []);

  /** One immediate phrase (interrupts queue). Used for live navigation + alerts. */
  const speakNow = useCallback((text) => {
    if (typeof window === "undefined" || !window.speechSynthesis || !text) return;
    window.speechSynthesis.cancel();
    queueRef.current = [];
    setSpeaking(true);
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickEnglishVoice();
    if (voice) u.voice = voice;
    u.lang = "en-US";
    u.rate = 0.95;
    u.pitch = 1;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    const loadVoices = () => synth.getVoices();
    loadVoices();
    synth.addEventListener("voiceschanged", loadVoices);
    return () => {
      synth.removeEventListener("voiceschanged", loadVoices);
      cancel();
    };
  }, [cancel]);

  return { speak, speakNow, cancel, speaking };
}
