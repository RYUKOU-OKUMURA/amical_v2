import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsService } from "../../src/services/settings-service";
import type { TranscribeContext } from "../../src/pipeline/core/pipeline-types";

vi.mock("../../src/main/logger", () => ({
  logger: {
    transcription: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

vi.mock("../../src/utils/http-client", () => ({
  getUserAgent: () => "test-agent",
}));

import { OpenAICompatibleSpeechProvider } from "../../src/pipeline/providers/transcription/openai-compatible-speech-provider";

const FRAME_SIZE = 512;

function audioFrame(fill = 0.1): Float32Array {
  const frame = new Float32Array(FRAME_SIZE);
  frame.fill(fill);
  return frame;
}

function baseContext(): TranscribeContext {
  return {
    sessionId: "session-1",
    vocabulary: [],
    accessibilityContext: null,
    aggregatedTranscription: undefined,
    language: "ja",
  };
}

function createProvider(
  timing?: ConstructorParameters<
    typeof OpenAICompatibleSpeechProvider
  >[1]["timing"],
): OpenAICompatibleSpeechProvider {
  const settingsService = {
    getDefaultSpeechModel: vi.fn(async () => "test-whisper-model"),
  } as unknown as SettingsService;

  return new OpenAICompatibleSpeechProvider(settingsService, {
    name: "test-api",
    displayName: "Test API",
    defaultBaseURL: "https://speech.test/openai/v1",
    defaultModel: "test-whisper-model",
    modelPrefix: "test-",
    hotwords: [],
    timing,
    getConfig: async () => ({
      apiKey: "test-key",
      baseURL: "https://speech.test/openai/v1",
    }),
    missingKeyTitle: "Missing key",
    missingKeyMessage: "Missing key",
  });
}

async function feedFrames(
  provider: OpenAICompatibleSpeechProvider,
  speechFrames: number,
  silenceFrames: number,
) {
  let result = { text: "" };

  for (let i = 0; i < speechFrames; i++) {
    result = await provider.transcribe({
      audioData: audioFrame(0.1),
      speechProbability: 1,
      context: baseContext(),
    });
  }

  for (let i = 0; i < silenceFrames; i++) {
    result = await provider.transcribe({
      audioData: audioFrame(0),
      speechProbability: 0,
      context: baseContext(),
    });
  }

  return result;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      text: "こんにちは",
      segments: [{ text: "こんにちは", no_speech_prob: 0.01 }],
    }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAICompatibleSpeechProvider chunk timing", () => {
  it("keeps the default API timing buffered for short speech plus short silence", async () => {
    const provider = createProvider();

    const result = await feedFrames(provider, 63, 16);

    expect(result).toEqual({ text: "" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows Groq-tuned low-latency timing to transcribe after a shorter silence window", async () => {
    const provider = createProvider({
      minAudioDurationMs: 1600,
      maxAudioDurationMs: 4000,
      minSilenceDurationMs: 384,
    });

    const result = await feedFrames(provider, 50, 12);

    expect(result).toEqual({ text: "こんにちは" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("transcribes at the low-latency maximum duration even without silence", async () => {
    const provider = createProvider({
      minAudioDurationMs: 1600,
      maxAudioDurationMs: 4000,
      minSilenceDurationMs: 384,
    });

    const result = await feedFrames(provider, 125, 0);

    expect(result).toEqual({ text: "こんにちは" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
