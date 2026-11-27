"use client";

import { useState } from "react";
import { toast } from "sonner";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  onstart: () => void;
  onend: () => void;
  onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  start: () => void;
};

/** Browser speech-to-text. Calls `onTranscript` with each finished phrase. */
export function useVoiceInput(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);

  function start() {
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
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onstart = () => setListening(true);
      recognition.onend = () => setListening(false);
      recognition.onresult = (event) => {
        const transcript = event.results[0]?.[0]?.transcript;
        if (transcript) onTranscript(transcript);
      };
      recognition.start();
    } catch {
      setListening(false);
      toast.error("Could not turn on the microphone. Allow microphone access in your browser, then try again.");
    }
  }

  return { listening, start };
}
