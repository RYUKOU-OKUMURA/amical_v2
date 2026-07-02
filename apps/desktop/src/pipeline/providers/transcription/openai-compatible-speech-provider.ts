import {
  TranscriptionProvider,
  TranscribeParams,
  TranscribeContext,
  TranscriptionOutput,
  FullAudioTranscribeParams,
} from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import type { SettingsService } from "../../../services/settings-service";
import { AppError, ErrorCodes } from "../../../types/error";
import { convertRawToWav } from "../../../utils/audio-converter";
import { getUserAgent } from "../../../utils/http-client";
import { normalizeOpenAICompatibleBaseURL } from "../../../utils/provider-utils";
import { getSpeechModelIdFromStoredSelection } from "../../../utils/model-selection";
import { extractSpeechFromVad } from "../../utils/vad-audio-filter";
import {
  shouldDropCompleteTranscription,
  shouldDropSegment,
  type CompleteTranscriptionQuality,
} from "../../utils/segment-filter";
import { groqRateLimitCache } from "../../../services/groq-rate-limit-cache";
import { parseGroqRateLimitHeaders } from "../../../utils/groq-rate-limit";
import { buildWhisperPrompt } from "./whisper-prompt";

interface OpenAICompatibleTranscriptionSegment {
  text?: string;
  no_speech_prob?: number;
  noSpeechProb?: number;
}

interface OpenAICompatibleTranscriptionResponse {
  text?: string;
  language?: string;
  segments?: OpenAICompatibleTranscriptionSegment[];
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

/** Whisper's verbose_json reports `language` as a full lowercase English name
 * (e.g. "japanese"). Map the Whisper language set to ISO codes so the value
 * can be fed back as a `language` hint on subsequent requests. */
const WHISPER_LANGUAGE_NAME_TO_ISO: Record<string, string> = {
  english: "en",
  chinese: "zh",
  german: "de",
  spanish: "es",
  russian: "ru",
  korean: "ko",
  french: "fr",
  japanese: "ja",
  portuguese: "pt",
  turkish: "tr",
  polish: "pl",
  catalan: "ca",
  dutch: "nl",
  arabic: "ar",
  swedish: "sv",
  italian: "it",
  indonesian: "id",
  hindi: "hi",
  finnish: "fi",
  vietnamese: "vi",
  hebrew: "he",
  ukrainian: "uk",
  greek: "el",
  malay: "ms",
  czech: "cs",
  romanian: "ro",
  danish: "da",
  hungarian: "hu",
  tamil: "ta",
  norwegian: "no",
  thai: "th",
  urdu: "ur",
  croatian: "hr",
  bulgarian: "bg",
  lithuanian: "lt",
  latin: "la",
  maori: "mi",
  malayalam: "ml",
  welsh: "cy",
  slovak: "sk",
  telugu: "te",
  persian: "fa",
  latvian: "lv",
  bengali: "bn",
  serbian: "sr",
  azerbaijani: "az",
  slovenian: "sl",
  kannada: "kn",
  estonian: "et",
  macedonian: "mk",
  breton: "br",
  basque: "eu",
  icelandic: "is",
  armenian: "hy",
  nepali: "ne",
  mongolian: "mn",
  bosnian: "bs",
  kazakh: "kk",
  albanian: "sq",
  swahili: "sw",
  galician: "gl",
  marathi: "mr",
  punjabi: "pa",
  sinhala: "si",
  khmer: "km",
  shona: "sn",
  yoruba: "yo",
  somali: "so",
  afrikaans: "af",
  occitan: "oc",
  georgian: "ka",
  belarusian: "be",
  tajik: "tg",
  sindhi: "sd",
  gujarati: "gu",
  amharic: "am",
  yiddish: "yi",
  lao: "lo",
  uzbek: "uz",
  faroese: "fo",
  "haitian creole": "ht",
  pashto: "ps",
  turkmen: "tk",
  nynorsk: "nn",
  maltese: "mt",
  sanskrit: "sa",
  luxembourgish: "lb",
  myanmar: "my",
  tibetan: "bo",
  tagalog: "tl",
  malagasy: "mg",
  assamese: "as",
  tatar: "tt",
  hawaiian: "haw",
  lingala: "ln",
  hausa: "ha",
  bashkir: "ba",
  javanese: "jw",
  sundanese: "su",
  cantonese: "yue",
};

function normalizeDetectedWhisperLanguage(
  language: string | undefined,
): string | undefined {
  const trimmed = language?.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }
  if (/^[a-z]{2,3}(-[a-z0-9]+)?$/.test(trimmed)) {
    return trimmed.split("-")[0];
  }
  return WHISPER_LANGUAGE_NAME_TO_ISO[trimmed];
}

export interface OpenAICompatibleSpeechConfig {
  apiKey: string;
  baseURL?: string;
}

interface OpenAICompatibleSpeechProviderOptions {
  name: string;
  displayName: string;
  defaultBaseURL: string;
  defaultModel: string;
  modelPrefix: string;
  hotwords: readonly string[];
  timing?: Partial<OpenAICompatibleSpeechTiming>;
  longFormTiming?: Partial<OpenAICompatibleSpeechTiming>;
  getConfig: (
    settingsService: SettingsService,
  ) => Promise<OpenAICompatibleSpeechConfig | undefined>;
  missingKeyTitle: string;
  missingKeyMessage: string;
}

const SAMPLE_RATE = 16000;
const FRAME_SIZE = 512;

interface OpenAICompatibleSpeechTiming {
  speechProbabilityThreshold: number;
  minAudioDurationMs: number;
  maxAudioDurationMs: number;
  minSilenceDurationMs: number;
}

const DEFAULT_TIMING: OpenAICompatibleSpeechTiming = {
  speechProbabilityThreshold: 0.2,
  minAudioDurationMs: 5000,
  maxAudioDurationMs: 15000,
  minSilenceDurationMs: 700,
};
const LOW_INFORMATION_MAX_SPEECH_DURATION_MS = 1800;
const LOW_INFORMATION_MAX_AVERAGE_SPEECH_PROBABILITY = 0.35;
const LOW_INFORMATION_MAX_PEAK_SPEECH_PROBABILITY = 0.55;
const VOCABULARY_ECHO_MIN_MATCHES = 2;
const VOCABULARY_ECHO_MATCH_RATIO = 0.7;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_TRANSCRIPTION_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [500, 1500] as const;
const MAX_RETRY_AFTER_MS = 3_000;

interface TranscriptionRequestOptions {
  baseURL: string;
  apiKey: string;
  speechAudio: Float32Array;
  model: string;
  requestedLanguage?: string;
  prompt?: string;
  mode: "chunk" | "final-pass";
  signal?: AbortSignal;
}

interface TranscriptionFetchResult {
  body: OpenAICompatibleTranscriptionResponse | null;
}

function modelIdFromSelection(
  selection: string | undefined,
  modelPrefix: string,
  defaultModel: string,
): string {
  const modelId = getSpeechModelIdFromStoredSelection(selection);
  if (!modelId) {
    return defaultModel;
  }

  return modelId.startsWith(modelPrefix)
    ? modelId.slice(modelPrefix.length)
    : modelId;
}

function toWavBlob(audioData: Float32Array): Blob {
  const rawBuffer = Buffer.from(
    audioData.buffer,
    audioData.byteOffset,
    audioData.byteLength,
  );
  const wavBuffer = convertRawToWav(rawBuffer, SAMPLE_RATE);
  const wavArrayBuffer = wavBuffer.buffer.slice(
    wavBuffer.byteOffset,
    wavBuffer.byteOffset + wavBuffer.byteLength,
  ) as ArrayBuffer;

  return new Blob([wavArrayBuffer], { type: "audio/wav" });
}

function mapStatusToErrorCode(status: number) {
  if (status === 401 || status === 403) {
    return ErrorCodes.AUTH_REQUIRED;
  }
  if (status === 429) {
    return ErrorCodes.RATE_LIMIT_EXCEEDED;
  }
  if (status >= 500) {
    return ErrorCodes.INTERNAL_SERVER_ERROR;
  }
  return ErrorCodes.NETWORK_ERROR;
}

function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortLikeError(error: unknown): boolean {
  const name = getErrorName(error);
  return name === "AbortError" || name === "TimeoutError";
}

function getSignalAbortReason(signal: AbortSignal): unknown {
  if (signal.reason) {
    return signal.reason;
  }
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function parseRetryAfterMs(headers: Headers): number | undefined {
  const retryAfter = headers.get("retry-after");
  if (!retryAfter) {
    return undefined;
  }

  const retryAfterSeconds = Number(retryAfter);
  if (Number.isFinite(retryAfterSeconds)) {
    return Math.max(0, retryAfterSeconds * 1000);
  }

  const retryAfterDate = Date.parse(retryAfter);
  if (Number.isNaN(retryAfterDate)) {
    return undefined;
  }

  return Math.max(0, retryAfterDate - Date.now());
}

function waitForRetry(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    if (signal?.aborted) {
      return Promise.reject(getSignalAbortReason(signal));
    }
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(getSignalAbortReason(signal));
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      cleanup();
      reject(signal ? getSignalAbortReason(signal) : undefined);
    };
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function normalizeLanguageCode(
  language: string | undefined,
): string | undefined {
  if (!language || language === "auto") {
    return undefined;
  }

  return language.split(/[-_]/)[0]?.toLowerCase();
}

function isJapaneseLanguage(language: string | undefined): boolean {
  return language === "ja";
}

function getFilteredText(
  body: OpenAICompatibleTranscriptionResponse | null,
  quality: CompleteTranscriptionQuality,
  vocabulary: readonly string[],
): string {
  // Prompt-echo hallucinations happen on near-silent audio. When speech
  // quality is strong the user genuinely said the vocabulary words, so only
  // apply the echo filter to low-information audio.
  const echoVocabulary = isLowInformationSpeech(quality) ? vocabulary : [];
  const segments = body?.segments ?? [];
  if (segments.length > 0) {
    const kept = segments.filter(
      (segment) =>
        !shouldDropSegment({
          text: segment.text ?? "",
          noSpeechProb: segment.noSpeechProb ?? segment.no_speech_prob,
        }) && !isVocabularyEcho(segment.text ?? "", echoVocabulary),
    );
    const text = kept.map((segment) => segment.text ?? "").join("");
    return shouldDropCompleteTranscription(text, quality) ||
      isVocabularyEcho(text, echoVocabulary)
      ? ""
      : text;
  }

  const text = body?.text ?? "";
  return shouldDropCompleteTranscription(text, quality) ||
    isVocabularyEcho(text, echoVocabulary)
    ? ""
    : text;
}

function getSpeechQuality(
  vadProbs: number[],
  speechSegments: Array<{ start: number; end: number }>,
  speechAudio: Float32Array,
): CompleteTranscriptionQuality {
  let speechProbabilitySum = 0;
  let speechProbabilityCount = 0;
  let maxSpeechProbability = 0;

  for (const segment of speechSegments) {
    for (let i = segment.start; i <= segment.end; i++) {
      const probability = vadProbs[i];
      if (typeof probability !== "number") {
        continue;
      }
      speechProbabilitySum += probability;
      speechProbabilityCount++;
      maxSpeechProbability = Math.max(maxSpeechProbability, probability);
    }
  }

  return {
    speechDurationMs: (speechAudio.length / SAMPLE_RATE) * 1000,
    averageSpeechProbability:
      speechProbabilityCount > 0
        ? speechProbabilitySum / speechProbabilityCount
        : undefined,
    maxSpeechProbability:
      speechProbabilityCount > 0 ? maxSpeechProbability : undefined,
  };
}

function normalizeSpeechProbabilities(
  audioData: Float32Array,
  speechProbabilities?: number[],
): number[] {
  const frameCount = Math.ceil(audioData.length / FRAME_SIZE);
  if (frameCount === 0) {
    return [];
  }

  if (!speechProbabilities || speechProbabilities.length === 0) {
    return new Array(frameCount).fill(1);
  }

  if (speechProbabilities.length === frameCount) {
    return [...speechProbabilities];
  }

  const normalized = speechProbabilities.slice(0, frameCount);
  const fillValue = normalized[normalized.length - 1] ?? 1;
  while (normalized.length < frameCount) {
    normalized.push(fillValue);
  }

  return normalized;
}

function segmentForWholeAudio(
  audioData: Float32Array,
): Array<{ start: number; end: number }> {
  const frameCount = Math.ceil(audioData.length / FRAME_SIZE);
  return frameCount > 0 ? [{ start: 0, end: frameCount - 1 }] : [];
}

function isLowInformationSpeech(
  quality: CompleteTranscriptionQuality,
): boolean {
  if (
    typeof quality.speechDurationMs === "number" &&
    quality.speechDurationMs < LOW_INFORMATION_MAX_SPEECH_DURATION_MS
  ) {
    return true;
  }

  if (
    typeof quality.averageSpeechProbability === "number" &&
    quality.averageSpeechProbability <=
      LOW_INFORMATION_MAX_AVERAGE_SPEECH_PROBABILITY
  ) {
    return true;
  }

  return (
    typeof quality.maxSpeechProbability === "number" &&
    quality.maxSpeechProbability <= LOW_INFORMATION_MAX_PEAK_SPEECH_PROBABILITY
  );
}

function normalizeVocabularyEchoToken(token: string): string {
  return token
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s、。,.!！?？「」『』（）()[\]【】"'`;；:：]/g, "")
    .trim();
}

function tokenizePotentialVocabularyEcho(text: string): string[] {
  const commaTokens = text
    .split(/[,\n、。！？!?;；]+/u)
    .map(normalizeVocabularyEchoToken)
    .filter(Boolean);
  if (commaTokens.length >= 2) {
    return commaTokens;
  }

  return text
    .split(/[\s,\n、。！？!?;；]+/u)
    .map(normalizeVocabularyEchoToken)
    .filter(Boolean);
}

function isVocabularyEcho(
  text: string,
  vocabulary: readonly string[],
): boolean {
  const normalizedVocabulary = new Set(
    vocabulary.map(normalizeVocabularyEchoToken).filter(Boolean),
  );
  if (normalizedVocabulary.size === 0) {
    return false;
  }

  const tokens = tokenizePotentialVocabularyEcho(text);
  if (tokens.length === 0) {
    return false;
  }

  const matchCount = tokens.filter((token) =>
    normalizedVocabulary.has(token),
  ).length;

  return (
    matchCount >= VOCABULARY_ECHO_MIN_MATCHES &&
    matchCount / tokens.length >= VOCABULARY_ECHO_MATCH_RATIO
  );
}

export class OpenAICompatibleSpeechProvider implements TranscriptionProvider {
  readonly name: string;

  private frameBuffer: Float32Array[] = [];
  private frameBufferSpeechProbabilities: number[] = [];
  private currentSilenceFrameCount = 0;
  private timing: OpenAICompatibleSpeechTiming;
  private longFormTiming: OpenAICompatibleSpeechTiming;

  constructor(
    private settingsService: SettingsService,
    private options: OpenAICompatibleSpeechProviderOptions,
  ) {
    this.name = options.name;
    this.timing = {
      ...DEFAULT_TIMING,
      ...options.timing,
    };
    this.longFormTiming = {
      ...this.timing,
      ...options.longFormTiming,
    };
  }

  async warmup(): Promise<void> {
    const config = await this.options.getConfig(this.settingsService);
    if (!config?.apiKey) {
      throw new AppError(
        `${this.options.displayName} API key is not configured`,
        ErrorCodes.AUTH_REQUIRED,
        {
          uiTitle: this.options.missingKeyTitle,
          uiMessage: this.options.missingKeyMessage,
        },
      );
    }
  }

  async transcribe(params: TranscribeParams): Promise<TranscriptionOutput> {
    const { audioData, speechProbability = 1, context } = params;
    const timing = this.timingForContext(context);

    this.frameBuffer.push(audioData);
    this.frameBufferSpeechProbabilities.push(speechProbability);

    if (speechProbability > timing.speechProbabilityThreshold) {
      this.currentSilenceFrameCount = 0;
    } else {
      this.currentSilenceFrameCount++;
    }

    if (!this.shouldTranscribe(context)) {
      return { text: "" };
    }

    return this.doTranscription(context);
  }

  async flush(context: TranscribeContext): Promise<TranscriptionOutput> {
    if (this.frameBuffer.length === 0) {
      return { text: "" };
    }

    return this.doTranscription(context);
  }

  async transcribeFullAudio(
    params: FullAudioTranscribeParams,
  ): Promise<TranscriptionOutput> {
    return this.transcribeAudio(
      params.audioData,
      normalizeSpeechProbabilities(
        params.audioData,
        params.speechProbabilities,
      ),
      {
        ...params.context,
        aggregatedTranscription: undefined,
        previousChunk: undefined,
      },
      "final-pass",
      params.signal,
    );
  }

  reset(): void {
    this.frameBuffer = [];
    this.frameBufferSpeechProbabilities = [];
    this.currentSilenceFrameCount = 0;
  }

  private shouldTranscribe(context: TranscribeContext): boolean {
    const timing = this.timingForContext(context);
    const audioDurationMs =
      ((this.frameBuffer.length * FRAME_SIZE) / SAMPLE_RATE) * 1000;
    const silenceDurationMs =
      ((this.currentSilenceFrameCount * FRAME_SIZE) / SAMPLE_RATE) * 1000;

    if (audioDurationMs >= timing.maxAudioDurationMs) {
      logger.transcription.debug(
        `Transcribing ${this.options.displayName} buffer at max duration`,
        { audioDurationMs, dictationProfile: context.dictationProfile },
      );
      return true;
    }

    if (
      audioDurationMs >= timing.minAudioDurationMs &&
      silenceDurationMs >= timing.minSilenceDurationMs
    ) {
      logger.transcription.debug(
        `Transcribing ${this.options.displayName} buffer after silence`,
        {
          audioDurationMs,
          silenceDurationMs,
          minAudioDurationMs: timing.minAudioDurationMs,
          minSilenceDurationMs: timing.minSilenceDurationMs,
          dictationProfile: context.dictationProfile,
        },
      );
      return true;
    }

    return false;
  }

  private timingForContext(
    context: TranscribeContext,
  ): OpenAICompatibleSpeechTiming {
    return context.dictationProfile === "long-form"
      ? this.longFormTiming
      : this.timing;
  }

  private aggregateFrames(): Float32Array {
    const totalLength = this.frameBuffer.reduce(
      (sum, frame) => sum + frame.length,
      0,
    );
    const aggregated = new Float32Array(totalLength);
    let offset = 0;

    for (const frame of this.frameBuffer) {
      aggregated.set(frame, offset);
      offset += frame.length;
    }

    return aggregated;
  }

  private async doTranscription(
    context: TranscribeContext,
  ): Promise<TranscriptionOutput> {
    const rawAudio = this.aggregateFrames();
    const vadProbs = [...this.frameBufferSpeechProbabilities];

    const result = await this.transcribeAudio(
      rawAudio,
      vadProbs,
      context,
      "chunk",
    );
    this.reset();
    return result;
  }

  private buildTranscriptionFormData(
    options: Pick<
      TranscriptionRequestOptions,
      "speechAudio" | "model" | "requestedLanguage" | "prompt"
    >,
  ): FormData {
    const formData = new FormData();
    formData.append("file", toWavBlob(options.speechAudio), "dictation.wav");
    formData.append("model", options.model);
    formData.append("response_format", "verbose_json");
    formData.append("timestamp_granularities[]", "segment");
    formData.append("temperature", "0");
    if (options.requestedLanguage) {
      formData.append("language", options.requestedLanguage);
    }
    if (options.prompt) {
      formData.append("prompt", options.prompt);
    }
    return formData;
  }

  private async fetchTranscriptionWithRetries(
    options: TranscriptionRequestOptions,
  ): Promise<TranscriptionFetchResult> {
    for (
      let attemptIndex = 0;
      attemptIndex < MAX_TRANSCRIPTION_ATTEMPTS;
      attemptIndex++
    ) {
      const requestSignal =
        options.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(`${options.baseURL}/audio/transcriptions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "User-Agent": getUserAgent(),
          },
          body: this.buildTranscriptionFormData(options),
          signal: requestSignal,
        });
      } catch (error) {
        const errorName = getErrorName(error);
        const appError = this.mapFetchError(error, options);
        const retried = await this.retryTransientFailure({
          appError,
          attemptIndex,
          mode: options.mode,
          signal: options.signal,
          errorName,
        });
        if (retried) {
          continue;
        }

        this.logTranscriptionRequestFailure(appError, options.mode, errorName);
        throw appError;
      }

      this.cacheGroqRateLimitHeaders(response);

      let body: OpenAICompatibleTranscriptionResponse | null = null;
      try {
        body = (await response.json()) as OpenAICompatibleTranscriptionResponse;
      } catch (error) {
        if (response.ok) {
          const appError = this.createParseError(response, error);
          logger.transcription.warn(
            `${this.options.displayName} transcription response JSON parse failed`,
            {
              provider: this.name,
              mode: options.mode,
              status: response.status,
              contentType: response.headers.get("content-type"),
              errorName: getErrorName(error),
              error: getErrorMessage(error),
            },
          );

          const retried = await this.retryTransientFailure({
            appError,
            attemptIndex,
            mode: options.mode,
            signal: options.signal,
            errorName: getErrorName(error),
          });
          if (retried) {
            continue;
          }

          this.logTranscriptionRequestFailure(
            appError,
            options.mode,
            getErrorName(error),
          );
          throw appError;
        }
      }

      if (!response.ok) {
        const appError = this.createHttpError(response, body);
        const retried = await this.retryTransientFailure({
          appError,
          attemptIndex,
          mode: options.mode,
          signal: options.signal,
          response,
        });
        if (retried) {
          continue;
        }

        this.logTranscriptionRequestFailure(appError, options.mode);
        throw appError;
      }

      return { body };
    }

    throw new AppError(
      `${this.options.displayName} transcription failed after retries`,
      ErrorCodes.UNKNOWN,
      {
        uiTitle: `${this.options.displayName} transcription failed`,
        uiMessage: "Transcription failed after multiple attempts.",
      },
    );
  }

  private cacheGroqRateLimitHeaders(response: Response): void {
    if (this.options.name !== "groq") {
      return;
    }

    const rateLimitStatus = parseGroqRateLimitHeaders(
      response.headers,
      "transcription",
    );
    if (rateLimitStatus) {
      groqRateLimitCache.update(rateLimitStatus);
    }
  }

  private mapFetchError(
    error: unknown,
    options: TranscriptionRequestOptions,
  ): AppError {
    if (options.signal?.aborted) {
      throw error;
    }

    if (isAbortLikeError(error)) {
      return new AppError(
        `${this.options.displayName} transcription request timed out`,
        ErrorCodes.NETWORK_TIMEOUT,
        {
          uiTitle: `${this.options.displayName} connection timed out`,
          uiMessage: `${this.options.displayName} connection timed out. Please check your internet connection and try again.`,
        },
      );
    }

    return new AppError(
      `${this.options.displayName} transcription network error: ${getErrorMessage(
        error,
      )}`,
      ErrorCodes.NETWORK_ERROR,
      {
        uiTitle: `${this.options.displayName} connection error`,
        uiMessage: `Could not connect to ${this.options.displayName}. Please check your internet connection and try again.`,
      },
    );
  }

  private createHttpError(
    response: Response,
    body: OpenAICompatibleTranscriptionResponse | null,
  ): AppError {
    const message =
      body?.error?.message ||
      body?.error?.type ||
      `${this.options.displayName} transcription failed with HTTP ${response.status}`;
    return new AppError(message, mapStatusToErrorCode(response.status), {
      statusCode: response.status,
      uiTitle: `${this.options.displayName} transcription failed`,
      uiMessage: message,
    });
  }

  private createParseError(response: Response, error: unknown): AppError {
    const message = `${this.options.displayName} transcription response could not be parsed as JSON: ${getErrorMessage(
      error,
    )}`;
    return new AppError(message, ErrorCodes.PARSE_ERROR, {
      statusCode: response.status,
      uiTitle: `${this.options.displayName} transcription failed`,
      uiMessage: `${this.options.displayName} returned an invalid transcription response. Please try again.`,
    });
  }

  private async retryTransientFailure(options: {
    appError: AppError;
    attemptIndex: number;
    mode: "chunk" | "final-pass";
    signal?: AbortSignal;
    response?: Response;
    errorName?: string;
  }): Promise<boolean> {
    const delayMs = this.getRetryDelayMs(
      options.appError,
      options.attemptIndex,
      options.response,
    );
    if (delayMs === null) {
      return false;
    }

    logger.transcription.warn(
      `${this.options.displayName} transcription retrying after transient failure`,
      {
        provider: this.name,
        mode: options.mode,
        attempt: options.attemptIndex + 1,
        nextAttempt: options.attemptIndex + 2,
        maxAttempts: MAX_TRANSCRIPTION_ATTEMPTS,
        status: options.appError.statusCode,
        errorCode: options.appError.errorCode,
        errorName: options.errorName ?? options.appError.name,
        delayMs,
      },
    );
    await waitForRetry(delayMs, options.signal);
    return true;
  }

  private getRetryDelayMs(
    appError: AppError,
    attemptIndex: number,
    response?: Response,
  ): number | null {
    if (attemptIndex >= MAX_TRANSCRIPTION_ATTEMPTS - 1) {
      return null;
    }

    const status = appError.statusCode;
    if (status === 429) {
      const retryAfterMs = response
        ? parseRetryAfterMs(response.headers)
        : undefined;
      if (retryAfterMs !== undefined) {
        return retryAfterMs <= MAX_RETRY_AFTER_MS ? retryAfterMs : null;
      }
      return RETRY_BACKOFF_MS[attemptIndex] ?? null;
    }

    if (appError.errorCode === ErrorCodes.PARSE_ERROR) {
      return RETRY_BACKOFF_MS[attemptIndex] ?? null;
    }

    if (typeof status === "number") {
      return status >= 500 ? (RETRY_BACKOFF_MS[attemptIndex] ?? null) : null;
    }

    if (appError.errorCode === ErrorCodes.NETWORK_ERROR) {
      return RETRY_BACKOFF_MS[attemptIndex] ?? null;
    }

    return null;
  }

  private logTranscriptionRequestFailure(
    appError: AppError,
    mode: "chunk" | "final-pass",
    errorName = appError.name,
  ): void {
    logger.transcription.error(
      `${this.options.displayName} transcription request failed`,
      {
        provider: this.name,
        mode,
        status: appError.statusCode,
        errorCode: appError.errorCode,
        errorName,
        error: appError.message,
      },
    );
  }

  private async transcribeAudio(
    rawAudio: Float32Array,
    vadProbs: number[],
    context: TranscribeContext,
    mode: "chunk" | "final-pass",
    signal?: AbortSignal,
  ): Promise<TranscriptionOutput> {
    const requestedLanguage = normalizeLanguageCode(context.language);
    const isJapaneseLowLatencyChunk =
      mode === "chunk" &&
      isJapaneseLanguage(requestedLanguage) &&
      context.dictationProfile !== "long-form";
    const requestedSpeechExtractionMode =
      context.speechExtractionMode ??
      (isJapaneseLowLatencyChunk ? "raw" : "vad-trim");
    const rawAudioDurationMs = (rawAudio.length / SAMPLE_RATE) * 1000;
    let speechExtractionMode = requestedSpeechExtractionMode;
    let promptMode = context.promptMode ?? "default";
    let usedRawFallback = false;
    let speechAudio: Float32Array;
    let speechSegments: Array<{ start: number; end: number }>;

    if (requestedSpeechExtractionMode === "raw") {
      speechAudio = rawAudio;
      speechSegments = segmentForWholeAudio(rawAudio);
    } else {
      const extracted = extractSpeechFromVad(rawAudio, vadProbs);
      speechAudio = extracted.audio;
      speechSegments = extracted.segments;

      if (
        speechAudio.length === 0 &&
        rawAudio.length > 0 &&
        mode === "chunk" &&
        context.dictationProfile === "long-form"
      ) {
        speechAudio = rawAudio;
        speechSegments = segmentForWholeAudio(rawAudio);
        speechExtractionMode = "raw";
        promptMode = "none";
        usedRawFallback = true;
      }
    }

    if (speechAudio.length === 0) {
      logger.transcription.debug(
        `Skipping ${this.options.displayName} transcription - no speech detected by VAD filter`,
        {
          rawAudioDurationMs,
          vadSpeechDurationMs: 0,
          droppedByVadMs: rawAudioDurationMs,
          mode,
          dictationProfile: context.dictationProfile,
          speechExtractionMode,
          promptMode,
        },
      );
      return { text: "" };
    }

    const config = await this.options.getConfig(this.settingsService);
    if (!config?.apiKey) {
      throw new AppError(
        `${this.options.displayName} API key is not configured`,
        ErrorCodes.AUTH_REQUIRED,
        {
          uiTitle: this.options.missingKeyTitle,
          uiMessage: this.options.missingKeyMessage,
        },
      );
    }

    const baseURL = normalizeOpenAICompatibleBaseURL(
      config.baseURL || this.options.defaultBaseURL,
    );
    const model = modelIdFromSelection(
      await this.settingsService.getDefaultSpeechModel(),
      this.options.modelPrefix,
      this.options.defaultModel,
    );
    const vocabulary = [
      ...(context.vocabulary ?? []),
      ...this.options.hotwords,
    ];
    const speechQuality = {
      ...getSpeechQuality(vadProbs, speechSegments, speechAudio),
      requestedLanguage,
    };
    const lowInformationSpeech =
      mode === "chunk" && isLowInformationSpeech(speechQuality);
    const shouldKeepJapaneseContextPrompt =
      lowInformationSpeech && isJapaneseLanguage(requestedLanguage);
    if (lowInformationSpeech && !shouldKeepJapaneseContextPrompt) {
      promptMode = "none";
    }
    const promptVocabulary = shouldKeepJapaneseContextPrompt ? [] : vocabulary;
    const prompt =
      promptMode === "none"
        ? undefined
        : buildWhisperPrompt({
            vocabulary: promptVocabulary,
            previousTranscription: context.aggregatedTranscription,
            beforeText:
              context.accessibilityContext?.context?.textSelection
                ?.preSelectionText,
          });

    const startedAt = performance.now();
    const { body } = await this.fetchTranscriptionWithRetries({
      baseURL,
      apiKey: config.apiKey,
      speechAudio,
      model,
      requestedLanguage,
      prompt,
      mode,
      signal,
    });
    const duration = performance.now() - startedAt;

    const text = getFilteredText(body, speechQuality, vocabulary);
    // Only report detected language from non-empty transcripts so a dropped
    // hallucination chunk can't lock the session onto a wrong language.
    const detectedLanguage = text.trim()
      ? normalizeDetectedWhisperLanguage(body?.language)
      : undefined;
    const vadSpeechDurationMs = speechQuality.speechDurationMs ?? 0;
    const droppedByVadMs =
      speechExtractionMode === "vad-trim"
        ? Math.max(0, rawAudioDurationMs - vadSpeechDurationMs)
        : 0;
    logger.transcription.info(
      `${this.options.displayName} transcription completed`,
      {
        textLength: text.length,
        duration,
        audioDurationMs: vadSpeechDurationMs,
        rawAudioDurationMs,
        vadSpeechDurationMs,
        droppedByVadMs,
        mode,
        dictationProfile: context.dictationProfile,
        speechExtractionMode,
        promptMode,
        promptApplied: Boolean(prompt),
        lowInformationPromptSuppressed:
          lowInformationSpeech && promptMode === "none",
        usedRawFallback,
        detectedLanguage,
      },
    );

    return { text, detectedLanguage };
  }
}
