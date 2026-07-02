import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { TranscriptionService } from "../../src/services/transcription-service";
import type { TranscriptionProvider } from "../../src/pipeline/core/pipeline-types";
import { AppError, ErrorCodes } from "../../src/types/error";

vi.mock("../../src/db/transcriptions", () => ({
  createTranscription: vi.fn(),
  getTranscriptionById: vi.fn(),
  updateTranscription: vi.fn(),
}));

vi.mock("../../src/db/daily-stats", () => ({
  incrementDailyStats: vi.fn(),
}));

vi.mock("../../src/db/vocabulary", () => ({
  getVocabulary: vi.fn(async () => []),
}));

import {
  createTranscription,
  getTranscriptionById,
  updateTranscription,
} from "../../src/db/transcriptions";
import { incrementDailyStats } from "../../src/db/daily-stats";

const AUDIO_SAMPLES = 16_000 * 2; // 2 seconds
const FRAME_SIZE = 512;
const FRAME_COUNT = Math.ceil(AUDIO_SAMPLES / FRAME_SIZE);

interface TestService {
  readWavAsFloat32: (filePath: string) => Promise<Float32Array>;
  selectProvider: () => Promise<TranscriptionProvider>;
  processStreamingChunk: TranscriptionService["processStreamingChunk"];
  finalizeSession: TranscriptionService["finalizeSession"];
  retryTranscription: (transcriptionId: number) => Promise<string>;
}

function createService(provider: TranscriptionProvider): TestService {
  vi.stubGlobal("__BUNDLED_API_ENDPOINT", "http://localhost:3000");
  const service = new TranscriptionService(
    { getSelectedModel: vi.fn(async () => "groq-whisper-large-v3") } as never,
    null as never,
    {
      getDictationSettings: vi.fn(async () => ({
        autoDetectEnabled: true,
        selectedLanguage: "ja",
      })),
      getFormatterConfig: vi.fn(async () => undefined),
      getTranscriptionSettings: vi.fn(async () => ({})),
    } as never,
    {
      captureException: vi.fn(),
      trackTranscriptionCompleted: vi.fn(),
    } as never,
    null,
    null,
  ) as unknown as TestService;

  service.readWavAsFloat32 = vi
    .fn()
    .mockResolvedValue(new Float32Array(AUDIO_SAMPLES).fill(0.1));
  service.selectProvider = vi.fn(async () => provider);
  return service;
}

function baseRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    text: "古い結果",
    audioFile: "/tmp/retry.wav",
    language: "auto",
    detectedLanguage: "ja",
    meta: {},
    ...overrides,
  };
}

describe("TranscriptionService retryTranscription", () => {
  beforeEach(() => {
    vi.spyOn(fs.promises, "access").mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.mocked(createTranscription).mockReset();
    vi.mocked(getTranscriptionById).mockReset();
    vi.mocked(updateTranscription).mockReset();
    vi.mocked(incrementDailyStats).mockReset();
  });

  it("uses a single full-audio pass for providers that support it", async () => {
    vi.mocked(getTranscriptionById).mockResolvedValue(baseRecord() as never);

    const transcribeFullAudio = vi.fn(async () => ({
      text: "全音声を一括で転写した結果です。",
      detectedLanguage: "ja",
    }));
    const provider = {
      name: "groq",
      transcribe: vi.fn(),
      flush: vi.fn(),
      reset: vi.fn(),
      transcribeFullAudio,
    } as unknown as TranscriptionProvider;

    const service = createService(provider);
    const result = await service.retryTranscription(1);

    expect(result).toContain("全音声を一括で転写した結果です");
    expect(transcribeFullAudio).toHaveBeenCalledTimes(1);
    expect(provider.transcribe).not.toHaveBeenCalled();
    expect(provider.flush).not.toHaveBeenCalled();

    const call = transcribeFullAudio.mock.calls[0]![0] as {
      audioData: Float32Array;
      speechProbabilities: number[];
      context: { speechExtractionMode?: string; promptMode?: string };
    };
    expect(call.audioData.length).toBe(AUDIO_SAMPLES);
    // Without a VAD service, probabilities default to 1 per frame
    expect(call.speechProbabilities).toHaveLength(FRAME_COUNT);
    expect(call.speechProbabilities.every((p) => p === 1)).toBe(true);
    expect(call.context.speechExtractionMode).toBe("raw");
    expect(call.context.promptMode).toBe("default");

    expect(updateTranscription).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        text: expect.stringContaining("全音声を一括で転写した結果です"),
      }),
    );
  });

  it("carries the stored detected language when the request language is auto", async () => {
    vi.mocked(getTranscriptionById).mockResolvedValue(
      baseRecord({ detectedLanguage: "ja" }) as never,
    );

    const transcribeFullAudio = vi.fn(async () => ({
      text: "言語ヒント付きの転写結果です。",
      detectedLanguage: "ja",
    }));
    const provider = {
      name: "groq",
      transcribe: vi.fn(),
      flush: vi.fn(),
      reset: vi.fn(),
      transcribeFullAudio,
    } as unknown as TranscriptionProvider;

    const service = createService(provider);
    await service.retryTranscription(1);

    expect(transcribeFullAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ language: "ja" }),
      }),
    );
  });

  it("falls back to the chunked path for providers without transcribeFullAudio", async () => {
    vi.mocked(getTranscriptionById).mockResolvedValue(baseRecord() as never);

    const transcribe = vi.fn(async () => ({ text: "" }));
    const flush = vi.fn(async () => ({
      text: "チャンク経路で転写した結果です。",
    }));
    const provider = {
      name: "whisper-local",
      transcribe,
      flush,
      reset: vi.fn(),
    } as unknown as TranscriptionProvider;

    const service = createService(provider);
    const result = await service.retryTranscription(1);

    expect(result).toContain("チャンク経路で転写した結果です");
    expect(transcribe).toHaveBeenCalledTimes(FRAME_COUNT);
    expect(flush).toHaveBeenCalledTimes(1);
  });
});

describe("TranscriptionService finalizeSession", () => {
  beforeEach(() => {
    vi.spyOn(fs.promises, "access").mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.mocked(createTranscription).mockReset();
    vi.mocked(getTranscriptionById).mockReset();
    vi.mocked(updateTranscription).mockReset();
    vi.mocked(incrementDailyStats).mockReset();
  });

  it("returns accumulated streaming text when flush fails after successful chunks", async () => {
    const provider = {
      name: "groq",
      transcribe: vi.fn(async () => ({
        text: "ストリーミング済みです。",
        detectedLanguage: "ja",
      })),
      flush: vi.fn(async () => {
        throw new AppError("flush failed", ErrorCodes.NETWORK_ERROR, {
          statusCode: 503,
        });
      }),
      reset: vi.fn(),
    } as unknown as TranscriptionProvider;
    const service = createService(provider);

    await service.processStreamingChunk({
      sessionId: "partial-session",
      audioChunk: new Float32Array(FRAME_SIZE).fill(0.1),
    });
    const result = await service.finalizeSession({
      sessionId: "partial-session",
    });

    expect(result).toBe("ストリーミング済みです。");
    expect(provider.flush).toHaveBeenCalledTimes(1);
  });

  it("still fails finalizeSession when flush fails before any chunk text exists", async () => {
    const provider = {
      name: "groq",
      transcribe: vi.fn(async () => ({ text: "" })),
      flush: vi.fn(async () => {
        throw new AppError("flush failed", ErrorCodes.NETWORK_ERROR, {
          statusCode: 503,
        });
      }),
      reset: vi.fn(),
    } as unknown as TranscriptionProvider;
    const service = createService(provider);

    await service.processStreamingChunk({
      sessionId: "empty-session",
      audioChunk: new Float32Array(FRAME_SIZE).fill(0.1),
    });

    await expect(
      service.finalizeSession({ sessionId: "empty-session" }),
    ).rejects.toMatchObject({
      errorCode: ErrorCodes.NETWORK_ERROR,
    });
    expect(createTranscription).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "",
        meta: expect.objectContaining({
          status: "failed",
          failureReason: ErrorCodes.NETWORK_ERROR,
        }),
      }),
    );
  });
});
