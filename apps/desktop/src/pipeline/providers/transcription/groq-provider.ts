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

interface GroqTranscriptionSegment {
  text?: string;
  no_speech_prob?: number;
  noSpeechProb?: number;
}

interface GroqTranscriptionResponse {
  text?: string;
  segments?: GroqTranscriptionSegment[];
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

const SAMPLE_RATE = 16000;
const FRAME_SIZE = 512;
const SPEECH_PROBABILITY_THRESHOLD = 0.2;
const MIN_AUDIO_DURATION_MS = 5000;
const MAX_AUDIO_DURATION_MS = 15000;
const MIN_SILENCE_DURATION_MS = 700;
const GROQ_DICTATION_HOTWORDS = [
  "Amical",
  "Groq",
  "Whisper",
  "API",
  "large-v3",
  "large-v3-turbo",
  "V3 Turbo",
];

function groqModelIdFromSelection(modelId: string | undefined): string {
  if (!modelId) {
    return "whisper-large-v3-turbo";
  }

  return modelId.startsWith("groq-") ? modelId.slice("groq-".length) : modelId;
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

function mapGroqStatusToErrorCode(status: number) {
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

export class GroqProvider implements TranscriptionProvider {
  readonly name = "groq";

  private frameBuffer: Float32Array[] = [];
  private frameBufferSpeechProbabilities: number[] = [];
  private currentSilenceFrameCount = 0;

  constructor(private settingsService: SettingsService) {}

  async warmup(): Promise<void> {
    const config = await this.settingsService.getGroqConfig();
    if (!config?.apiKey) {
      throw new AppError(
        "Groq API key is not configured",
        ErrorCodes.AUTH_REQUIRED,
        {
          uiTitle: "Groq API key missing",
          uiMessage: "Add your Groq API key in AI Models before dictating.",
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
      logger.transcription.debug("Transcribing Groq buffer at max duration", {
        audioDurationMs,
      });
      return true;
    }

    if (
      audioDurationMs >= MIN_AUDIO_DURATION_MS &&
      silenceDurationMs >= MIN_SILENCE_DURATION_MS
    ) {
      logger.transcription.debug("Transcribing Groq buffer after silence", {
        audioDurationMs,
        silenceDurationMs,
      });
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
        "Skipping Groq transcription - no speech detected by VAD filter",
      );
      return { text: "" };
    }

    const config = await this.settingsService.getGroqConfig();
    if (!config?.apiKey) {
      throw new AppError(
        "Groq API key is not configured",
        ErrorCodes.AUTH_REQUIRED,
        {
          uiTitle: "Groq API key missing",
          uiMessage: "Add your Groq API key in AI Models before dictating.",
        },
      );
    }

    const baseURL = normalizeOpenAICompatibleBaseURL(
      config.baseURL || "https://api.groq.com/openai/v1",
    );
    const model = groqModelIdFromSelection(
      getSpeechModelIdFromStoredSelection(
        await this.settingsService.getDefaultSpeechModel(),
      ),
    );
    const vocabulary = [
      ...(context.vocabulary ?? []),
      ...GROQ_DICTATION_HOTWORDS,
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
    let body: GroqTranscriptionResponse | null = null;

    try {
      body = (await response.json()) as GroqTranscriptionResponse;
    } catch {
      body = null;
    }

    if (!response.ok) {
      const message =
        body?.error?.message ||
        body?.error?.type ||
        `Groq transcription failed with HTTP ${response.status}`;
      throw new AppError(message, mapGroqStatusToErrorCode(response.status), {
        statusCode: response.status,
        uiTitle: "Groq transcription failed",
        uiMessage: message,
      });
    }

    const text = getFilteredGroqText(body);
    logger.transcription.info("Groq transcription completed", {
      textLength: text.length,
      duration,
      audioDurationMs: (speechAudio.length / SAMPLE_RATE) * 1000,
    });

    return { text };
  }
}

function normalizeLanguageCode(
  language: string | undefined,
): string | undefined {
  if (!language || language === "auto") {
    return undefined;
  }

  return language.split(/[-_]/)[0]?.toLowerCase();
}

function getFilteredGroqText(body: GroqTranscriptionResponse | null): string {
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
