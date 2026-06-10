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
      recordingStartedAt: 1,
      recordingStoppedAt: 13_001,
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

  it("keeps chunk transcript when Groq long-form final pass is much shorter", async () => {
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
      transcribeFullAudio: vi.fn().mockResolvedValue({
        text: "短すぎます。",
      }),
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
      recordingStartedAt: 1,
      recordingStoppedAt: 13_001,
    };

    await expect(
      service.runGroqLongFormFinalPass({
        provider,
        session,
        audioFilePath: "/tmp/test.wav",
        rawTranscription:
          "これは十分に長いチャンク結果です。短すぎる final pass では、この内容を置き換えてはいけません。これは十分に長いチャンク結果です。短すぎる final pass では、この内容を置き換えてはいけません。",
      }),
    ).resolves.toBeNull();
  });

  it("accepts a Groq long-form final pass that is slightly shorter", async () => {
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

    const rawTranscription = "あ".repeat(100);
    const finalPassText = "あ".repeat(98);
    const provider = {
      name: "groq",
      transcribe: vi.fn(),
      flush: vi.fn(),
      reset: vi.fn(),
      transcribeFullAudio: vi.fn().mockResolvedValue({ text: finalPassText }),
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
      recordingStartedAt: 1,
      recordingStoppedAt: 13_001,
    };

    await expect(
      service.runGroqLongFormFinalPass({
        provider,
        session,
        audioFilePath: "/tmp/test.wav",
        rawTranscription,
      }),
    ).resolves.toBe(finalPassText);
  });

  it("accepts a shorter Groq long-form final pass that removes duplicated text", async () => {
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

    const finalPassText =
      "YouTubeのテロップを入れるアプリを作ってみてるんだけどかなり工数が減っていい";
    const provider = {
      name: "groq",
      transcribe: vi.fn(),
      flush: vi.fn(),
      reset: vi.fn(),
      transcribeFullAudio: vi.fn().mockResolvedValue({ text: finalPassText }),
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
      recordingStartedAt: 1,
      recordingStoppedAt: 13_001,
    };

    await expect(
      service.runGroqLongFormFinalPass({
        provider,
        session,
        audioFilePath: "/tmp/test.wav",
        rawTranscription:
          "YouTubeのテロップを入れるアプリを作ってみてるんだけどかなり工数が減っていい かなり工数が減っていい",
      }),
    ).resolves.toBe(finalPassText);
  });

  it("accepts non-empty Groq long-form final pass when chunk transcript is empty", async () => {
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
      transcribeFullAudio: vi.fn().mockResolvedValue({
        text: "チャンクが空だった場合は最終パスの非空結果を採用します。",
      }),
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
      recordingStartedAt: 1,
      recordingStoppedAt: 13_001,
    };

    await expect(
      service.runGroqLongFormFinalPass({
        provider,
        session,
        audioFilePath: "/tmp/test.wav",
        rawTranscription: "",
      }),
    ).resolves.toBe("チャンクが空だった場合は最終パスの非空結果を採用します。");
  });

  it("skips Groq low-latency final pass for short dictations", async () => {
    const service = createTranscriptionServiceForTest() as unknown as {
      runGroqFinalPass: (options: {
        provider: TranscriptionProvider | null;
        session: StreamingSession;
        audioFilePath?: string;
        rawTranscription: string;
      }) => Promise<string | null>;
    };

    const provider = {
      name: "groq",
      transcribe: vi.fn(),
      flush: vi.fn(),
      reset: vi.fn(),
      transcribeFullAudio: vi.fn().mockResolvedValue({ text: "unused" }),
    } as unknown as TranscriptionProvider;
    const context = {
      ...createDefaultContext("session-1"),
      isPartial: true,
      isFinal: false,
    } satisfies StreamingPipelineContext;
    const session: StreamingSession = {
      context,
      transcriptionResults: [],
      dictationProfile: "low-latency",
      recordingStartedAt: 1,
      recordingStoppedAt: 3_001,
    };

    await expect(
      service.runGroqFinalPass({
        provider,
        session,
        audioFilePath: "/tmp/test.wav",
        rawTranscription: "短い入力です",
      }),
    ).resolves.toBeNull();
    expect(provider.transcribeFullAudio).not.toHaveBeenCalled();
  });

  it("accepts Groq low-latency final pass for longer dictations", async () => {
    const service = createTranscriptionServiceForTest() as unknown as {
      readWavAsFloat32: (filePath: string) => Promise<Float32Array>;
      computeVadProbabilitiesForAudio: (
        audioData: Float32Array,
        signal: AbortSignal,
      ) => Promise<number[]>;
      runGroqFinalPass: (options: {
        provider: TranscriptionProvider | null;
        session: StreamingSession;
        audioFilePath?: string;
        rawTranscription: string;
      }) => Promise<string | null>;
    };
    service.readWavAsFloat32 = vi
      .fn()
      .mockResolvedValue(new Float32Array(16_000 * 9).fill(0.1));
    service.computeVadProbabilitiesForAudio = vi
      .fn()
      .mockResolvedValue(new Array(9 * 32).fill(1));

    const finalPassText =
      "今の入力速度は維持したまま文字起こしの精度をもう少し上げたいです。";
    const provider = {
      name: "groq",
      transcribe: vi.fn(),
      flush: vi.fn(),
      reset: vi.fn(),
      transcribeFullAudio: vi.fn().mockResolvedValue({ text: finalPassText }),
    } as unknown as TranscriptionProvider;
    const context = {
      ...createDefaultContext("session-1"),
      isPartial: true,
      isFinal: false,
    } satisfies StreamingPipelineContext;
    const session: StreamingSession = {
      context,
      transcriptionResults: [],
      dictationProfile: "low-latency",
      recordingStartedAt: 1,
      recordingStoppedAt: 9_001,
    };

    await expect(
      service.runGroqFinalPass({
        provider,
        session,
        audioFilePath: "/tmp/test.wav",
        rawTranscription:
          "今の入力速度は維持したまま文字起こしの精度をもう少し上げたいです",
      }),
    ).resolves.toBe(finalPassText);
  });

  it("accepts a shorter Groq low-latency final pass that removes chunk noise", async () => {
    const service = createTranscriptionServiceForTest() as unknown as {
      readWavAsFloat32: (filePath: string) => Promise<Float32Array>;
      computeVadProbabilitiesForAudio: (
        audioData: Float32Array,
        signal: AbortSignal,
      ) => Promise<number[]>;
      runGroqFinalPass: (options: {
        provider: TranscriptionProvider | null;
        session: StreamingSession;
        audioFilePath?: string;
        rawTranscription: string;
      }) => Promise<string | null>;
    };
    service.readWavAsFloat32 = vi
      .fn()
      .mockResolvedValue(new Float32Array(16_000 * 12).fill(0.1));
    service.computeVadProbabilitiesForAudio = vi
      .fn()
      .mockResolvedValue(new Array(12 * 32).fill(1));

    const finalPassText =
      "トグルで要点モードと整理モード、セリフモードを切り替えると思うんだけど、デフォルトをセリフモードにしておいてもらっていい?";
    const provider = {
      name: "groq",
      transcribe: vi.fn(),
      flush: vi.fn(),
      reset: vi.fn(),
      transcribeFullAudio: vi.fn().mockResolvedValue({ text: finalPassText }),
    } as unknown as TranscriptionProvider;
    const context = {
      ...createDefaultContext("session-1"),
      isPartial: true,
      isFinal: false,
    } satisfies StreamingPipelineContext;
    const session: StreamingSession = {
      context,
      transcriptionResults: [],
      dictationProfile: "low-latency",
      recordingStartedAt: 1,
      recordingStoppedAt: 12_001,
    };

    await expect(
      service.runGroqFinalPass({
        provider,
        session,
        audioFilePath: "/tmp/test.wav",
        rawTranscription:
          "あとToggleで要点モードと整理モードを選択してください。 セリフモードを切り替えると思うんだけど、 デフォルトをセリフモードに変えてみます。セリフモードにしておいてもらっていい?",
      }),
    ).resolves.toBe(finalPassText);
  });

  it("keeps chunk transcript when Groq low-latency final pass is much shorter", async () => {
    const service = createTranscriptionServiceForTest() as unknown as {
      readWavAsFloat32: (filePath: string) => Promise<Float32Array>;
      computeVadProbabilitiesForAudio: (
        audioData: Float32Array,
        signal: AbortSignal,
      ) => Promise<number[]>;
      runGroqFinalPass: (options: {
        provider: TranscriptionProvider | null;
        session: StreamingSession;
        audioFilePath?: string;
        rawTranscription: string;
      }) => Promise<string | null>;
    };
    service.readWavAsFloat32 = vi
      .fn()
      .mockResolvedValue(new Float32Array(16_000 * 9).fill(0.1));
    service.computeVadProbabilitiesForAudio = vi
      .fn()
      .mockResolvedValue(new Array(9 * 32).fill(1));

    const provider = {
      name: "groq",
      transcribe: vi.fn(),
      flush: vi.fn(),
      reset: vi.fn(),
      transcribeFullAudio: vi.fn().mockResolvedValue({
        text: "短すぎます。",
      }),
    } as unknown as TranscriptionProvider;
    const context = {
      ...createDefaultContext("session-1"),
      isPartial: true,
      isFinal: false,
    } satisfies StreamingPipelineContext;
    const session: StreamingSession = {
      context,
      transcriptionResults: [],
      dictationProfile: "low-latency",
      recordingStartedAt: 1,
      recordingStoppedAt: 9_001,
    };

    await expect(
      service.runGroqFinalPass({
        provider,
        session,
        audioFilePath: "/tmp/test.wav",
        rawTranscription:
          "これは十分に長い通常入力のチャンク結果です。最終パスが短すぎる場合は採用しません。これは十分に長い通常入力のチャンク結果です。",
      }),
    ).resolves.toBeNull();
  });

  it("reuses streamed VAD probabilities without recomputing them", async () => {
    const service = createTranscriptionServiceForTest() as unknown as {
      readWavAsFloat32: (filePath: string) => Promise<Float32Array>;
      computeVadProbabilitiesForAudio: (
        audioData: Float32Array,
        signal?: AbortSignal,
      ) => Promise<number[]>;
      runGroqFinalPass: (options: {
        provider: TranscriptionProvider | null;
        session: StreamingSession;
        audioFilePath?: string;
        rawTranscription: string;
      }) => Promise<string | null>;
    };
    service.readWavAsFloat32 = vi
      .fn()
      .mockResolvedValue(new Float32Array(16_000 * 9).fill(0.1));
    service.computeVadProbabilitiesForAudio = vi
      .fn()
      .mockResolvedValue(new Array(9 * 32).fill(1));

    const finalPassText =
      "今の入力速度は維持したまま文字起こしの精度をもう少し上げたいです。";
    const transcribeFullAudio = vi
      .fn()
      .mockResolvedValue({ text: finalPassText });
    const provider = {
      name: "groq",
      transcribe: vi.fn(),
      flush: vi.fn(),
      reset: vi.fn(),
      transcribeFullAudio,
    } as unknown as TranscriptionProvider;
    const context = {
      ...createDefaultContext("session-1"),
      isPartial: true,
      isFinal: false,
    } satisfies StreamingPipelineContext;
    const streamedProbabilities = new Array(9 * 32).fill(0.8);
    const session: StreamingSession = {
      context,
      transcriptionResults: [],
      dictationProfile: "low-latency",
      recordingStartedAt: 1,
      recordingStoppedAt: 9_001,
      speechProbabilities: streamedProbabilities,
    };

    await expect(
      service.runGroqFinalPass({
        provider,
        session,
        audioFilePath: "/tmp/test.wav",
        rawTranscription:
          "今の入力速度は維持したまま文字起こしの精度をもう少し上げたいです",
      }),
    ).resolves.toBe(finalPassText);

    expect(service.computeVadProbabilitiesForAudio).not.toHaveBeenCalled();
    expect(transcribeFullAudio).toHaveBeenCalledWith(
      expect.objectContaining({ speechProbabilities: streamedProbabilities }),
    );
  });

  it("carries the detected language into the final pass when language is auto", async () => {
    const service = createTranscriptionServiceForTest() as unknown as {
      readWavAsFloat32: (filePath: string) => Promise<Float32Array>;
      computeVadProbabilitiesForAudio: (
        audioData: Float32Array,
        signal?: AbortSignal,
      ) => Promise<number[]>;
      runGroqFinalPass: (options: {
        provider: TranscriptionProvider | null;
        session: StreamingSession;
        audioFilePath?: string;
        rawTranscription: string;
      }) => Promise<string | null>;
    };
    service.readWavAsFloat32 = vi
      .fn()
      .mockResolvedValue(new Float32Array(16_000 * 9).fill(0.1));
    service.computeVadProbabilitiesForAudio = vi
      .fn()
      .mockResolvedValue(new Array(9 * 32).fill(1));

    const finalPassText =
      "今の入力速度は維持したまま文字起こしの精度をもう少し上げたいです。";
    const transcribeFullAudio = vi
      .fn()
      .mockResolvedValue({ text: finalPassText });
    const provider = {
      name: "groq",
      transcribe: vi.fn(),
      flush: vi.fn(),
      reset: vi.fn(),
      transcribeFullAudio,
    } as unknown as TranscriptionProvider;
    const context = {
      ...createDefaultContext("session-1"),
      isPartial: true,
      isFinal: false,
    } satisfies StreamingPipelineContext;
    const session: StreamingSession = {
      context,
      transcriptionResults: [],
      detectedLanguage: "ja",
      dictationProfile: "low-latency",
      recordingStartedAt: 1,
      recordingStoppedAt: 9_001,
    };

    await expect(
      service.runGroqFinalPass({
        provider,
        session,
        audioFilePath: "/tmp/test.wav",
        rawTranscription:
          "今の入力速度は維持したまま文字起こしの精度をもう少し上げたいです",
      }),
    ).resolves.toBe(finalPassText);
    expect(transcribeFullAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ language: "ja" }),
      }),
    );

    // An explicit user preference always wins over the detected language.
    transcribeFullAudio.mockClear();
    session.context.sharedData.userPreferences.language = "en";
    await expect(
      service.runGroqFinalPass({
        provider,
        session,
        audioFilePath: "/tmp/test.wav",
        rawTranscription:
          "今の入力速度は維持したまま文字起こしの精度をもう少し上げたいです",
      }),
    ).resolves.toBe(finalPassText);
    expect(transcribeFullAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ language: "en" }),
      }),
    );
  });

  it("does not let slow VAD recomputation consume the final pass deadline", async () => {
    vi.useFakeTimers();
    try {
      const service = createTranscriptionServiceForTest() as unknown as {
        readWavAsFloat32: (filePath: string) => Promise<Float32Array>;
        computeVadProbabilitiesForAudio: (
          audioData: Float32Array,
          signal?: AbortSignal,
        ) => Promise<number[]>;
        runGroqFinalPass: (options: {
          provider: TranscriptionProvider | null;
          session: StreamingSession;
          audioFilePath?: string;
          rawTranscription: string;
        }) => Promise<string | null>;
      };
      service.readWavAsFloat32 = vi
        .fn()
        .mockResolvedValue(new Float32Array(16_000 * 9).fill(0.1));
      // VAD recompute takes far longer than the 5s low-latency deadline
      service.computeVadProbabilitiesForAudio = vi.fn(
        () =>
          new Promise<number[]>((resolve) => {
            setTimeout(() => resolve(new Array(9 * 32).fill(1)), 8_000);
          }),
      );

      const finalPassText =
        "今の入力速度は維持したまま文字起こしの精度をもう少し上げたいです。";
      const provider = {
        name: "groq",
        transcribe: vi.fn(),
        flush: vi.fn(),
        reset: vi.fn(),
        transcribeFullAudio: vi.fn().mockResolvedValue({ text: finalPassText }),
      } as unknown as TranscriptionProvider;
      const context = {
        ...createDefaultContext("session-1"),
        isPartial: true,
        isFinal: false,
      } satisfies StreamingPipelineContext;
      const session: StreamingSession = {
        context,
        transcriptionResults: [],
        dictationProfile: "low-latency",
        recordingStartedAt: 1,
        recordingStoppedAt: 9_001,
      };

      const resultPromise = service.runGroqFinalPass({
        provider,
        session,
        audioFilePath: "/tmp/test.wav",
        rawTranscription:
          "今の入力速度は維持したまま文字起こしの精度をもう少し上げたいです",
      });
      const assertion = expect(resultPromise).resolves.toBe(finalPassText);
      await vi.advanceTimersByTimeAsync(8_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
