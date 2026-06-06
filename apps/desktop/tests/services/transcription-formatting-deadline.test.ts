import { describe, expect, it, vi } from "vitest";
import { TranscriptionService } from "../../src/services/transcription-service";
import { createDefaultContext } from "../../src/pipeline/core/context";
import type {
  FormattingProvider,
  StreamingPipelineContext,
  StreamingSession,
  TranscriptionProvider,
} from "../../src/pipeline/core/pipeline-types";

function createTranscriptionServiceForTest(): TranscriptionService {
  vi.stubGlobal("__BUNDLED_API_ENDPOINT", "http://localhost:3000");
  return new TranscriptionService(
    {} as never,
    null as never,
    {} as never,
    {
      captureException: vi.fn(),
      trackTranscriptionCompleted: vi.fn(),
    } as never,
    null,
    null,
  );
}

describe("TranscriptionService formatting deadline", () => {
  it("uses formatting results that complete within the deadline", async () => {
    const service = createTranscriptionServiceForTest() as unknown as {
      formatWithProvider: (
        provider: FormattingProvider,
        text: string,
        context: Record<string, unknown>,
      ) => Promise<{ text: string; duration: number } | null>;
    };
    const provider: FormattingProvider = {
      name: "test",
      format: vi.fn().mockResolvedValue("formatted text"),
    };

    await expect(
      service.formatWithProvider(provider, "raw text", {}),
    ).resolves.toEqual(
      expect.objectContaining({
        text: "formatted text",
      }),
    );
  });

  it("falls back when formatting exceeds the deadline", async () => {
    vi.useFakeTimers();
    const service = createTranscriptionServiceForTest() as unknown as {
      formatWithProvider: (
        provider: FormattingProvider,
        text: string,
        context: Record<string, unknown>,
      ) => Promise<{ text: string; duration: number } | null>;
    };
    let observedSignal: AbortSignal | undefined;
    const provider: FormattingProvider = {
      name: "slow-test",
      format: vi.fn((params) => {
        observedSignal = params.signal;
        return new Promise<string>(() => {});
      }),
    };

    const resultPromise = service.formatWithProvider(provider, "raw text", {});
    const assertion = expect(resultPromise).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(2_000);

    await assertion;
    expect(observedSignal?.aborted).toBe(true);
    vi.useRealTimers();
  });

  it("falls back when formatting throws", async () => {
    const service = createTranscriptionServiceForTest() as unknown as {
      formatWithProvider: (
        provider: FormattingProvider,
        text: string,
        context: Record<string, unknown>,
      ) => Promise<{ text: string; duration: number } | null>;
    };
    const provider: FormattingProvider = {
      name: "error-test",
      format: vi.fn().mockRejectedValue(new Error("rate limit")),
    };

    await expect(
      service.formatWithProvider(provider, "raw text", {}),
    ).resolves.toBeNull();
  });

  it("rejects a Groq long-form final pass that becomes too short after cleanup", async () => {
    const service = createTranscriptionServiceForTest() as unknown as {
      readWavAsFloat32: (filePath: string) => Promise<Float32Array>;
      computeVadProbabilitiesForAudio: (
        audioData: Float32Array,
        signal: AbortSignal,
      ) => Promise<number[]>;
      runGroqLongFormFinalPass: (options: {
        provider: TranscriptionProvider | null;
        session: StreamingSession;
        audioFilePath?: string;
        rawTranscription: string;
      }) => Promise<string | null>;
    };
    service.readWavAsFloat32 = vi
      .fn()
      .mockResolvedValue(new Float32Array(16_000 * 13).fill(0.1));
    service.computeVadProbabilitiesForAudio = vi
      .fn()
      .mockResolvedValue(new Array(13 * 32).fill(1));

    const provider = {
      name: "groq",
      transcribe: vi.fn(),
      flush: vi.fn(),
      reset: vi.fn(),
      transcribeFullAudio: vi
        .fn()
        .mockResolvedValue({ text: "では、".repeat(100) }),
    } as unknown as TranscriptionProvider;
    const context = {
      ...createDefaultContext("session-1"),
      isPartial: true,
      isFinal: false,
    } satisfies StreamingPipelineContext;
    const session: StreamingSession = {
      context,
      transcriptionResults: [],
      dictationProfile: "long-form",
      recordingStartedAt: 0,
      recordingStoppedAt: 13_000,
    };

    await expect(
      service.runGroqLongFormFinalPass({
        provider,
        session,
        audioFilePath: "/tmp/test.wav",
        rawTranscription:
          "これは十分に長いチャンク結果です。final pass が短いループに潰れた場合は、このチャンク結果を保持します。これは十分に長いチャンク結果です。",
      }),
    ).resolves.toBeNull();
  });
});
