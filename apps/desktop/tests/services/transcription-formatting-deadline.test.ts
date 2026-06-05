import { describe, expect, it, vi } from "vitest";
import { TranscriptionService } from "../../src/services/transcription-service";
import type { FormattingProvider } from "../../src/pipeline/core/pipeline-types";

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
});
