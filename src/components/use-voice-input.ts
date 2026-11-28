"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

/** Browser speech-to-text. Calls `onTranscript` with each finished phrase and toggles off cleanly on repeat click. */
export function useVoiceInput(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const callbackRef = useRef(onTranscript);

  useEffect(() => {
    callbackRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        // Ignore browser cleanup errors on unmount.
      }
      recognitionRef.current = null;
    };
  }, []);

  function start() {
    if (listening && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        recognitionRef.current = null;
        setListening(false);
      }
      return;
    }

    const speechWindow = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      toast.error("Voice input isn't supported in this browser. Type your message instead, or try Chrome or Edge.");
      return;
    }
    try {
      const recognition = new Recognition();
      recognitionRef.current = recognition;
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onstart = () => setListening(true);
      recognition.onend = () => {
        recognitionRef.current = null;
        setListening(false);
      };
      recognition.onerror = (event) => {
        recognitionRef.current = null;
        setListening(false);
        if (event?.error && event.error !== "aborted" && event.error !== "no-speech") {
          toast.error("Could not turn on the microphone. Allow microphone access in your browser, then try again.");
        }
      };
      recognition.onresult = (event) => {
        const transcript = event.results[0]?.[0]?.transcript;
        if (transcript) callbackRef.current(transcript);
      };
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setListening(false);
      toast.error("Could not turn on the microphone. Allow microphone access in your browser, then try again.");
    }
  }

  return { listening, start };
}
