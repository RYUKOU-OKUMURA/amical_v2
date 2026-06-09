export const FORMATTER_TIMEOUT_MS = 2_000;
export const GROQ_LONG_FORM_FINAL_PASS_TIMEOUT_MS = 10_000;
export const GROQ_LONG_FORM_FINAL_PASS_MIN_DURATION_MS = 12_000;
export const GROQ_LONG_FORM_FINAL_PASS_MIN_RAW_LENGTH = 120;
export const GROQ_LOW_LATENCY_FINAL_PASS_TIMEOUT_MS = 1_500;
export const GROQ_LOW_LATENCY_FINAL_PASS_MIN_DURATION_MS = 4_000;
export const GROQ_LOW_LATENCY_FINAL_PASS_MIN_RAW_LENGTH = 24;

const FORMATTER_MIN_OUTPUT_TOKENS = 384;
const FORMATTER_MAX_OUTPUT_TOKENS = 3_000;
const FORMATTER_OUTPUT_TOKEN_LENGTH_RATIO = 0.8;
const FORMATTER_OUTPUT_TOKEN_BUFFER = 256;

export class DeadlineTimeoutError extends Error {
  constructor(
    public readonly label: string,
    public readonly timeoutMs: number,
  ) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = "DeadlineTimeoutError";
  }
}

export function calculateFormattingMaxTokens(inputLength: number): number {
  const estimatedTokens =
    Math.ceil(Math.max(0, inputLength) * FORMATTER_OUTPUT_TOKEN_LENGTH_RATIO) +
    FORMATTER_OUTPUT_TOKEN_BUFFER;

  return Math.min(
    FORMATTER_MAX_OUTPUT_TOKENS,
    Math.max(FORMATTER_MIN_OUTPUT_TOKENS, estimatedTokens),
  );
}

export function shouldRunGroqLongFormFinalPass(options: {
  providerName?: string | null;
  hasTranscribeFullAudio: boolean;
  hasAudioFile: boolean;
  rawTranscriptionLength: number;
  recordingDurationMs?: number;
}): boolean {
  if (
    options.providerName !== "groq" ||
    !options.hasTranscribeFullAudio ||
    !options.hasAudioFile
  ) {
    return false;
  }

  return (
    options.rawTranscriptionLength >=
      GROQ_LONG_FORM_FINAL_PASS_MIN_RAW_LENGTH ||
    (typeof options.recordingDurationMs === "number" &&
      options.recordingDurationMs >= GROQ_LONG_FORM_FINAL_PASS_MIN_DURATION_MS)
  );
}

export function shouldRunGroqLowLatencyFinalPass(options: {
  providerName?: string | null;
  hasTranscribeFullAudio: boolean;
  hasAudioFile: boolean;
  rawTranscriptionLength: number;
  recordingDurationMs?: number;
}): boolean {
  if (
    options.providerName !== "groq" ||
    !options.hasTranscribeFullAudio ||
    !options.hasAudioFile
  ) {
    return false;
  }

  return (
    options.rawTranscriptionLength >=
      GROQ_LOW_LATENCY_FINAL_PASS_MIN_RAW_LENGTH ||
    (typeof options.recordingDurationMs === "number" &&
      options.recordingDurationMs >=
        GROQ_LOW_LATENCY_FINAL_PASS_MIN_DURATION_MS)
  );
}

export async function runWithDeadline<T>(options: {
  label: string;
  timeoutMs: number;
  operation: (signal: AbortSignal) => Promise<T>;
}): Promise<T> {
  const controller = new AbortController();
  let timeoutHandle: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new DeadlineTimeoutError(options.label, options.timeoutMs));
    }, options.timeoutMs);
  });

  try {
    return await Promise.race([
      options.operation(controller.signal),
      timeoutPromise,
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
