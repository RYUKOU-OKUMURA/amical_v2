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
import { buildWhisperPrompt } from "./whisper-prompt";

interface GroqTranscriptionResponse {
  text?: string;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

const SAMPLE_RATE = 16000;
const FRAME_SIZE = 512;
const MIN_AUDIO_DURATION_MS = 1400;

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
  }

  private shouldTranscribe(): boolean {
    const audioDurationMs =
      ((this.frameBuffer.length * FRAME_SIZE) / SAMPLE_RATE) * 1000;

    return audioDurationMs >= MIN_AUDIO_DURATION_MS;
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
    const prompt = buildWhisperPrompt({
      vocabulary: context.vocabulary,
      previousTranscription: context.aggregatedTranscription,
      beforeText:
        context.accessibilityContext?.context?.textSelection?.preSelectionText,
    });

    const formData = new FormData();
    formData.append("file", toWavBlob(speechAudio), "dictation.wav");
    formData.append("model", model);
    formData.append("response_format", "json");
    formData.append("temperature", "0");
    if (context.language) {
      formData.append("language", context.language);
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

    const text = body?.text ?? "";
    logger.transcription.info("Groq transcription completed", {
      textLength: text.length,
      duration,
      audioDurationMs: (speechAudio.length / SAMPLE_RATE) * 1000,
    });

    return { text };
  }
}
