import type { SettingsService } from "../../../services/settings-service";
import { OpenAICompatibleSpeechProvider } from "./openai-compatible-speech-provider";

const AQUA_DICTATION_HOTWORDS = [
  "Amical",
  "Aqua",
  "Aqua Voice",
  "Avalon",
  "Avalon 1.5",
  "Groq",
  "Whisper",
  "API",
  "large-v3",
  "large-v3-turbo",
  "V3 Turbo",
];

export class AquaProvider extends OpenAICompatibleSpeechProvider {
  constructor(settingsService: SettingsService) {
    super(settingsService, {
      name: "aqua",
      displayName: "Aqua Avalon",
      defaultBaseURL: "https://api.aquavoice.com/api/v1",
      defaultModel: "avalon-v1.5",
      modelPrefix: "aqua-",
      hotwords: AQUA_DICTATION_HOTWORDS,
      getConfig: (service) => service.getAquaConfig(),
      missingKeyTitle: "Aqua API key missing",
      missingKeyMessage:
        "Add your Aqua/Avalon API key in AI Models before dictating.",
    });
  }
}
