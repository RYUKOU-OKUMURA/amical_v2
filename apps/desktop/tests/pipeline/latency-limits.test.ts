import { describe, expect, it, vi } from "vitest";
import {
  DeadlineTimeoutError,
  GROQ_LOW_LATENCY_FINAL_PASS_TIMEOUT_MS,
  GROQ_LONG_FORM_FINAL_PASS_TIMEOUT_MS,
  calculateFormattingMaxTokens,
  runWithDeadline,
  shouldRunGroqLowLatencyFinalPass,
  shouldRunGroqLongFormFinalPass,
} from "../../src/pipeline/utils/latency-limits";

describe("latency limits", () => {
  it("calculates bounded formatting output token limits", () => {
    expect(calculateFormattingMaxTokens(2)).toBe(384);
    expect(calculateFormattingMaxTokens(1_000)).toBe(1_056);
    expect(calculateFormattingMaxTokens(10_000)).toBe(3_000);
  });

  it("allows Groq long-form final pass to wait up to ten seconds", () => {
    expect(GROQ_LONG_FORM_FINAL_PASS_TIMEOUT_MS).toBe(10_000);
  });

  it("keeps Groq low-latency final pass opportunistic", () => {
    expect(GROQ_LOW_LATENCY_FINAL_PASS_TIMEOUT_MS).toBe(1_500);
  });

  it("resolves operations that finish before the deadline", async () => {
    await expect(
      runWithDeadline({
        label: "test",
        timeoutMs: 100,
        operation: async () => "ok",
      }),
    ).resolves.toBe("ok");
  });

  it("aborts and rejects operations that exceed the deadline", async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | null = null;
    const promise = runWithDeadline({
      label: "slow-test",
      timeoutMs: 2_000,
      operation: (signal) => {
        observedSignal = signal;
        return new Promise<string>(() => {});
      },
    });
    const assertion =
      expect(promise).rejects.toBeInstanceOf(DeadlineTimeoutError);

    await vi.advanceTimersByTimeAsync(2_000);

    await assertion;
    expect(observedSignal?.aborted).toBe(true);
    vi.useRealTimers();
  });

  it("runs Groq final pass only for eligible long-form sessions", () => {
    const baseOptions = {
      providerName: "groq",
      hasTranscribeFullAudio: true,
      hasAudioFile: true,
    };

    expect(
      shouldRunGroqLongFormFinalPass({
        ...baseOptions,
        rawTranscriptionLength: 40,
        recordingDurationMs: 8_000,
      }),
    ).toBe(false);

    expect(
      shouldRunGroqLongFormFinalPass({
        ...baseOptions,
        rawTranscriptionLength: 40,
        recordingDurationMs: 12_000,
      }),
    ).toBe(true);

    expect(
      shouldRunGroqLongFormFinalPass({
        ...baseOptions,
        rawTranscriptionLength: 120,
        recordingDurationMs: 2_000,
      }),
    ).toBe(true);

    expect(
      shouldRunGroqLongFormFinalPass({
        ...baseOptions,
        providerName: "whisper-local",
        rawTranscriptionLength: 200,
        recordingDurationMs: 20_000,
      }),
    ).toBe(false);
  });

  it("runs Groq low-latency final pass only for medium or longer sessions", () => {
    const baseOptions = {
      providerName: "groq",
      hasTranscribeFullAudio: true,
      hasAudioFile: true,
    };

    expect(
      shouldRunGroqLowLatencyFinalPass({
        ...baseOptions,
        rawTranscriptionLength: 20,
        recordingDurationMs: 3_000,
      }),
    ).toBe(false);

    expect(
      shouldRunGroqLowLatencyFinalPass({
        ...baseOptions,
        rawTranscriptionLength: 20,
        recordingDurationMs: 4_000,
      }),
    ).toBe(true);

    expect(
      shouldRunGroqLowLatencyFinalPass({
        ...baseOptions,
        rawTranscriptionLength: 24,
        recordingDurationMs: 3_000,
      }),
    ).toBe(true);

    expect(
      shouldRunGroqLowLatencyFinalPass({
        ...baseOptions,
        providerName: "whisper-local",
        rawTranscriptionLength: 80,
        recordingDurationMs: 20_000,
      }),
    ).toBe(false);
  });
});
