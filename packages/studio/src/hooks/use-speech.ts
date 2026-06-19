import { useState, useCallback, useRef, useEffect } from "react";
import { isNativeRuntime } from "../lib/mobile-runtime";

export interface SpeechOptions {
  readonly rate?: number;    // 0.5 - 2.0, default 1.0
  readonly pitch?: number;   // 0 - 2, default 1.0
  readonly volume?: number;  // 0 - 1, default 1.0
  readonly voice?: SpeechSynthesisVoice | null;
}

export interface SpeechState {
  readonly isSpeaking: boolean;
  readonly isPaused: boolean;
  readonly currentSentence: number;
  readonly totalSentences: number;
}

const useNativeTts = isNativeRuntime();

export function useSpeech() {
  const [state, setState] = useState<SpeechState>({
    isSpeaking: false,
    isPaused: false,
    currentSentence: 0,
    totalSentences: 0,
  });

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const sentencesRef = useRef<string[]>([]);
  const currentIndexRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef(false);

  // Check if speech synthesis is supported
  const isSupported = useNativeTts
    ? true  // Android always has TTS via native API
    : typeof window !== "undefined" && "speechSynthesis" in window;

  // ── Native TTS (Android) ──
  const nativeSpeak = useCallback(async (text: string, options?: SpeechOptions) => {
    abortRef.current = false;
    try {
      await fetch("/__cap_tts/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, rate: options?.rate ?? 1.0 }),
      });
      setState({ isSpeaking: true, isPaused: false, currentSentence: 0, totalSentences: 0 });

      // Poll status for progress
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = setInterval(async () => {
        if (abortRef.current) return;
        try {
          const res = await fetch("/__cap_tts/status");
          const data = await res.json() as { speaking: boolean; paused: boolean; progress: number; totalChars: number; spokenChars: number; ready: boolean };
          if (!data.ready) {
            setState((prev) => ({ ...prev, isSpeaking: false, isPaused: false }));
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            return;
          }
          setState((prev) => ({
            ...prev,
            isSpeaking: data.speaking,
            isPaused: data.paused,
            currentSentence: data.spokenChars,
            totalSentences: data.totalChars,
          }));
          if (!data.speaking && !data.paused) {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          }
        } catch {
          // polling error, ignore
        }
      }, 300);
    } catch (e) {
      console.error("Native TTS speak failed:", e);
    }
  }, []);

  // Get available voices (native TTS has no voice selection API exposed)
  const getVoices = useCallback((): SpeechSynthesisVoice[] => {
    if (useNativeTts) return [];
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
    return window.speechSynthesis.getVoices();
  }, []);

  // Get Chinese voices
  const getChineseVoices = useCallback((): SpeechSynthesisVoice[] => {
    return getVoices().filter((voice) =>
      voice.lang.startsWith("zh") || voice.lang.startsWith("cmn")
    );
  }, [getVoices]);

  // Split text into sentences
  const splitSentences = useCallback((text: string): string[] => {
    const sentences = text
      .split(/(?<=[。！？；\n])/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return sentences;
  }, []);

  // ── Web Speech API (Desktop) ──
  const webSpeak = useCallback((text: string, options?: SpeechOptions) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();

    const sentences = splitSentences(text);
    sentencesRef.current = sentences;
    currentIndexRef.current = 0;

    setState({
      isSpeaking: true,
      isPaused: false,
      currentSentence: 0,
      totalSentences: sentences.length,
    });

    const speakNext = (index: number) => {
      if (index >= sentences.length) {
        setState((prev) => ({ ...prev, isSpeaking: false, isPaused: false }));
        return;
      }
      currentIndexRef.current = index;
      setState((prev) => ({ ...prev, currentSentence: index }));

      const utterance = new SpeechSynthesisUtterance(sentences[index]);
      utterance.rate = options?.rate ?? 1.0;
      utterance.pitch = options?.pitch ?? 1.0;
      utterance.volume = options?.volume ?? 1.0;

      const chineseVoice = options?.voice ?? getChineseVoices()[0];
      if (chineseVoice) utterance.voice = chineseVoice;

      utterance.onend = () => speakNext(index + 1);
      utterance.onerror = (event) => {
        if (event.error !== "canceled") {
          console.error("Speech error:", event.error);
          setState((prev) => ({ ...prev, isSpeaking: false, isPaused: false }));
        }
      };

      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    };

    speakNext(0);
  }, [splitSentences, getChineseVoices]);

  // ── Public API (unified) ──
  const speak = useCallback((text: string, options?: SpeechOptions) => {
    if (useNativeTts) {
      nativeSpeak(text, options);
    } else {
      webSpeak(text, options);
    }
  }, [useNativeTts, nativeSpeak, webSpeak]);

  const pause = useCallback(() => {
    if (useNativeTts) {
      fetch("/__cap_tts/pause", { method: "POST" }).catch(() => {});
      setState((prev) => ({ ...prev, isPaused: true }));
    } else if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.pause();
      setState((prev) => ({ ...prev, isPaused: true }));
    }
  }, [useNativeTts]);

  const resume = useCallback(() => {
    if (useNativeTts) {
      fetch("/__cap_tts/resume", { method: "POST" }).catch(() => {});
      setState((prev) => ({ ...prev, isPaused: false }));
    } else if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.resume();
      setState((prev) => ({ ...prev, isPaused: false }));
    }
  }, [useNativeTts]);

  const stop = useCallback(() => {
    abortRef.current = true;
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (useNativeTts) {
      fetch("/__cap_tts/stop", { method: "POST" }).catch(() => {});
    } else if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setState({ isSpeaking: false, isPaused: false, currentSentence: 0, totalSentences: 0 });
  }, [useNativeTts]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current = true;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (useNativeTts) {
        fetch("/__cap_tts/stop", { method: "POST" }).catch(() => {});
      } else if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [useNativeTts]);

  return {
    ...state,
    isSupported,
    speak,
    pause,
    resume,
    stop,
    getVoices,
    getChineseVoices,
  };
}
