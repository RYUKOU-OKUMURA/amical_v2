import {
  TranscriptionProvider,
  TranscribeParams,
  TranscribeContext,
  TranscriptionOutput,
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
  isKnownHallucinationText,
  shouldDropSegment,
} from "../../utils/segment-filter";
import { buildWhisperPrompt } from "./whisper-prompt";

interface OpenAICompatibleTranscriptionSegment {
  text?: string;
  no_speech_prob?: number;
  noSpeechProb?: number;
}

interface OpenAICompatibleTranscriptionResponse {
  text?: string;
  segments?: OpenAICompatibleTranscriptionSegment[];
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
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
  getConfig: (
    settingsService: SettingsService,
  ) => Promise<OpenAICompatibleSpeechConfig | undefined>;
  missingKeyTitle: string;
  missingKeyMessage: string;
}

const SAMPLE_RATE = 16000;
const FRAME_SIZE = 512;
const SPEECH_PROBABILITY_THRESHOLD = 0.2;
const MIN_AUDIO_DURATION_MS = 5000;
const MAX_AUDIO_DURATION_MS = 15000;
const MIN_SILENCE_DURATION_MS = 700;

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

function normalizeLanguageCode(
  language: string | undefined,
): string | undefined {
  if (!language || language === "auto") {
    return undefined;
  }

  return language.split(/[-_]/)[0]?.toLowerCase();
}

function getFilteredText(
  body: OpenAICompatibleTranscriptionResponse | null,
): string {
  const segments = body?.segments ?? [];
  if (segments.length > 0) {
    const kept = segments.filter(
      (segment) =>
        !shouldDropSegment({
          text: segment.text ?? "",
          noSpeechProb: segment.noSpeechProb ?? segment.no_speech_prob,
        }),
    );
    const text = kept.map((segment) => segment.text ?? "").join("");
    return isKnownHallucinationText(text) ? "" : text;
  }

  const text = body?.text ?? "";
  return isKnownHallucinationText(text) ? "" : text;
}

export class OpenAICompatibleSpeechProvider implements TranscriptionProvider {
  readonly name: string;

  private frameBuffer: Float32Array[] = [];
  private frameBufferSpeechProbabilities: number[] = [];
  private currentSilenceFrameCount = 0;

  constructor(
    private settingsService: SettingsService,
    private options: OpenAICompatibleSpeechProviderOptions,
  ) {
    this.name = options.name;
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

    this.frameBuffer.push(audioData);
    this.frameBufferSpeechProbabilities.push(speechProbability);

    if (speechProbability > SPEECH_PROBABILITY_THRESHOLD) {
      this.currentSilenceFrameCount = 0;
    } else {
      this.currentSilenceFrameCount++;
    }

    if (!this.shouldTranscribe()) {
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

  reset(): void {
    this.frameBuffer = [];
    this.frameBufferSpeechProbabilities = [];
    this.currentSilenceFrameCount = 0;
  }

  private shouldTranscribe(): boolean {
    const audioDurationMs =
      ((this.frameBuffer.length * FRAME_SIZE) / SAMPLE_RATE) * 1000;
    const silenceDurationMs =
      ((this.currentSilenceFrameCount * FRAME_SIZE) / SAMPLE_RATE) * 1000;

    if (audioDurationMs >= MAX_AUDIO_DURATION_MS) {
      logger.transcription.debug(
        `Transcribing ${this.options.displayName} buffer at max duration`,
        { audioDurationMs },
      );
      return true;
    }

    if (
      audioDurationMs >= MIN_AUDIO_DURATION_MS &&
      silenceDurationMs >= MIN_SILENCE_DURATION_MS
    ) {
      logger.transcription.debug(
        `Transcribing ${this.options.displayName} buffer after silence`,
        { audioDurationMs, silenceDurationMs },
      );
      return true;
    }

    return false;
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
    this.reset();

    const { audio: speechAudio } = extractSpeechFromVad(rawAudio, vadProbs);
    if (speechAudio.length === 0) {
      logger.transcription.debug(
        `Skipping ${this.options.displayName} transcription - no speech detected by VAD filter`,
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
    const prompt = buildWhisperPrompt({
      vocabulary,
      previousTranscription: context.aggregatedTranscription,
      beforeText:
        context.accessibilityContext?.context?.textSelection?.preSelectionText,
    });

    const formData = new FormData();
    formData.append("file", toWavBlob(speechAudio), "dictation.wav");
    formData.append("model", model);
    formData.append("response_format", "verbose_json");
    formData.append("timestamp_granularities[]", "segment");
    formData.append("temperature", "0");
    const language = normalizeLanguageCode(context.language);
    if (language) {
      formData.append("language", language);
    }
    if (prompt) {
      formData.append("prompt", prompt);
    }

    const startedAt = performance.now();
    const response = await fetch(`${baseURL}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "User-Agent": getUserAgent(),
      },
      body: formData,
      signal: AbortSignal.timeout(30_000),
    });

    const duration = performance.now() - startedAt;
    let body: OpenAICompatibleTranscriptionResponse | null = null;

    try {
      body = (await response.json()) as OpenAICompatibleTranscriptionResponse;
    } catch {
      body = null;
    }

    if (!response.ok) {
      const message =
        body?.error?.message ||
        body?.error?.type ||
        `${this.options.displayName} transcription failed with HTTP ${response.status}`;
      throw new AppError(message, mapStatusToErrorCode(response.status), {
        statusCode: response.status,
        uiTitle: `${this.options.displayName} transcription failed`,
        uiMessage: message,
      });
    }

    const text = getFilteredText(body);
    logger.transcription.info(
      `${this.options.displayName} transcription completed`,
      {
        textLength: text.length,
        duration,
        audioDurationMs: (speechAudio.length / SAMPLE_RATE) * 1000,
      },
    );

    return { text };
  }
}
