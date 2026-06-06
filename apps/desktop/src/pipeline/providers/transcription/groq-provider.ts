import type { SettingsService } from "../../../services/settings-service";
import { OpenAICompatibleSpeechProvider } from "./openai-compatible-speech-provider";

const GROQ_DICTATION_HOTWORDS = [
  "Amical",
  "Groq",
  "Whisper",
  "API",
  "large-v3",
  "large-v3-turbo",
  "V3 Turbo",
];

const GROQ_LOW_LATENCY_TIMING = {
  minAudioDurationMs: 1600,
  maxAudioDurationMs: 4000,
  minSilenceDurationMs: 384,
};

const GROQ_LONG_FORM_TIMING = {
  minAudioDurationMs: 8000,
  maxAudioDurationMs: 20000,
  minSilenceDurationMs: 2500,
};

export class GroqProvider extends OpenAICompatibleSpeechProvider {
  constructor(settingsService: SettingsService) {
    super(settingsService, {
      name: "groq",
      displayName: "Groq",
      defaultBaseURL: "https://api.groq.com/openai/v1",
      defaultModel: "whisper-large-v3-turbo",
      modelPrefix: "groq-",
      hotwords: GROQ_DICTATION_HOTWORDS,
      timing: GROQ_LOW_LATENCY_TIMING,
      longFormTiming: GROQ_LONG_FORM_TIMING,
      getConfig: (service) => service.getGroqConfig(),
      missingKeyTitle: "Groq API key missing",
      missingKeyMessage: "Add your Groq API key in AI Models before dictating.",
    });
  }
}
