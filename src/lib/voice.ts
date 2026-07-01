"use client";

// Voice I/O for the hands-free Copilot — a technician in gloves at a live panel
// dictates the fault and hears the answer. Uses the browser-native Web Speech
// API (no dependencies). HONEST about support: `supported` is false where the
// browser lacks it, so the UI hides the mic rather than showing a dead button.

import { useCallback, useEffect, useRef, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
function getSpeechRecognition(): any {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

// Speech-to-text: toggle listening; the recognized utterance is appended.
export function useDictation(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recRef = useRef<any>(null);
  const cbRef = useRef(onTranscript);
  cbRef.current = onTranscript;

  useEffect(() => {
    setSupported(Boolean(getSpeechRecognition()));
    return () => { try { recRef.current?.stop(); } catch { /* ignore */ } };
  }, []);

  const start = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) return;
    const rec = new SR();
    recRef.current = rec;
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => {
      const t = Array.from(e.results).map((r: any) => r[0]?.transcript ?? "").join(" ").trim();
      if (t) cbRef.current(t);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    try { rec.start(); setListening(true); } catch { setListening(false); }
  }, []);

  const stop = useCallback(() => { try { recRef.current?.stop(); } catch { /* ignore */ } setListening(false); }, []);
  const toggle = useCallback(() => { if (listening) stop(); else start(); }, [listening, start, stop]);

  return { listening, supported, toggle };
}

// Text-to-speech: read an answer aloud. Strips markdown so it sounds natural.
export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[#>*_~-]+/g, " ")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function speak(text: string): void {
  if (!speechSupported()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(stripMarkdown(text).slice(0, 4000));
  u.lang = "en-US";
  u.rate = 1;
  synth.speak(u);
}

export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
}
