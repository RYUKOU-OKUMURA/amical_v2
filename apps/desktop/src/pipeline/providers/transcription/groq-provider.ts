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

export class GroqProvider extends OpenAICompatibleSpeechProvider {
  constructor(settingsService: SettingsService) {
    super(settingsService, {
      name: "groq",
      displayName: "Groq",
      defaultBaseURL: "https://api.groq.com/openai/v1",
      defaultModel: "whisper-large-v3-turbo",
      modelPrefix: "groq-",
      hotwords: GROQ_DICTATION_HOTWORDS,
      getConfig: (service) => service.getGroqConfig(),
      missingKeyTitle: "Groq API key missing",
      missingKeyMessage: "Add your Groq API key in AI Models before dictating.",
    });
  }
}
