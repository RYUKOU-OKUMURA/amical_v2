import { HALLUCINATION_PHRASES } from "../../data/hallucination-phrases";

/** Lower threshold for known hallucination phrases */
const HALLUCINATION_THRESHOLD = 0.4;
const LOW_CONFIDENCE_STANDALONE_THRESHOLD = 0.25;
const COMPACT_JAPANESE_HALLUCINATION_PATTERNS = [
  "ご視聴ありがとうございました",
  "ご視聴ありがとうございます",
  "次の動画でお会いしましょう",
  "チャンネル登録お願いします",
  "チャンネル登録よろしく",
];
const LOW_CONFIDENCE_STANDALONE_PATTERNS = [
  "ありがとうございます",
  "ありがとうございました",
  "どうもありがとうございます",
  "どうもありがとうございました",
];
const LOW_CONFIDENCE_CLOSING_PATTERNS = ["さようなら", "さよなら"];
const MIXED_LANGUAGE_HALLUCINATION_PATTERNS = [
  /discordharma/i,
  /放弱.*atar.*召喚/i,
  /discord.*atar.*召喚/i,
];
const JAPANESE_SCRIPT_PATTERN = /[\u3040-\u30ff\u3400-\u9fff]/u;
const EXTENDED_LATIN_PATTERN = /[\u00c0-\u024f]/u;
const LATIN_LETTER_PATTERN = /[a-z\u00c0-\u024f]/gi;
const LOW_CONFIDENCE_MAX_AVERAGE_SPEECH_PROBABILITY = 0.35;
const LOW_CONFIDENCE_MAX_PEAK_SPEECH_PROBABILITY = 0.55;
const LOW_CONFIDENCE_MAX_SPEECH_DURATION_MS = 900;
const LOW_CONFIDENCE_CLOSING_MAX_SPEECH_DURATION_MS = 2500;

/**
 * Normalizes text for hallucination lookup:
 * - Unicode NFC normalization
 * - Lowercase
 * - Trimmed whitespace
 */
function normalizeText(text: string): string {
  return text.normalize("NFC").toLowerCase().trim();
}

function compactText(text: string): string {
  return normalizeText(text).replace(
    /[\s、。,.!！?？「」『』（）()[\]【】"'`]/g,
    "",
  );
}

function matchesCompactPattern(text: string, patterns: string[]): boolean {
  const compacted = compactText(text);
  return patterns.some((phrase) => compacted === compactText(phrase));
}

function isMixedLanguageHallucinationText(text: string): boolean {
  return MIXED_LANGUAGE_HALLUCINATION_PATTERNS.some((pattern) =>
    pattern.test(text),
  );
}

function isLowConfidenceStandaloneHallucinationText(text: string): boolean {
  return matchesCompactPattern(text, LOW_CONFIDENCE_STANDALONE_PATTERNS);
}

function isLowConfidenceStandaloneClosingText(text: string): boolean {
  return matchesCompactPattern(text, LOW_CONFIDENCE_CLOSING_PATTERNS);
}

function isWeakSpeechQuality(quality: CompleteTranscriptionQuality): boolean {
  const { averageSpeechProbability, maxSpeechProbability } = quality;
  return (
    typeof averageSpeechProbability === "number" &&
    typeof maxSpeechProbability === "number" &&
    averageSpeechProbability <= LOW_CONFIDENCE_MAX_AVERAGE_SPEECH_PROBABILITY &&
    maxSpeechProbability <= LOW_CONFIDENCE_MAX_PEAK_SPEECH_PROBABILITY
  );
}

function isJapaneseRequestedForeignHallucinationText(
  text: string,
  quality: CompleteTranscriptionQuality,
): boolean {
  if (!quality.requestedLanguage?.toLowerCase().startsWith("ja")) {
    return false;
  }

  const compacted = compactText(text);
  if (
    !compacted ||
    JAPANESE_SCRIPT_PATTERN.test(compacted) ||
    !EXTENDED_LATIN_PATTERN.test(compacted)
  ) {
    return false;
  }

  const latinLetterCount = compacted.match(LATIN_LETTER_PATTERN)?.length ?? 0;
  if (latinLetterCount < 12) {
    return false;
  }

  const extendedLatinCount =
    compacted.match(new RegExp(EXTENDED_LATIN_PATTERN.source, "gu"))?.length ??
    0;

  return (
    extendedLatinCount >= 2 ||
    isWeakSpeechQuality(quality) ||
    (typeof quality.speechDurationMs === "number" &&
      quality.speechDurationMs <= 6000)
  );
}

/**
 * Checks if text matches a known hallucination phrase
 */
export function isKnownHallucinationText(text: string): boolean {
  const normalized = normalizeText(text);
  if (HALLUCINATION_PHRASES.has(normalized)) {
    return true;
  }

  if (isMixedLanguageHallucinationText(text)) {
    return true;
  }

  const compacted = compactText(text);
  return COMPACT_JAPANESE_HALLUCINATION_PATTERNS.some((phrase) => {
    const compactedPhrase = compactText(phrase);
    return (
      compacted.includes(compactedPhrase) &&
      compacted.length <= compactedPhrase.length + 12
    );
  });
}

interface Segment {
  text: string;
  noSpeechProb?: number;
}

export interface CompleteTranscriptionQuality {
  speechDurationMs?: number;
  averageSpeechProbability?: number;
  maxSpeechProbability?: number;
  requestedLanguage?: string;
}

/**
 * Determines if a segment should be dropped based on quality metrics.
 * Rules:
 * 1. noSpeechProb > 0.8 → drop (high confidence no speech)
 * 2. noSpeechProb > 0.4 AND text is a known hallucination phrase → drop
 * 3. noSpeechProb > 0.25 AND text is a short standalone no-speech phrase → drop
 */
export function shouldDropSegment(segment: Segment): boolean {
  // Rule 1: High noSpeechProb
  if (segment.noSpeechProb !== undefined && segment.noSpeechProb > 0.8) {
    return true;
  }

  // Rule 2: Lower threshold for known hallucination phrases
  if (
    segment.noSpeechProb !== undefined &&
    segment.noSpeechProb > HALLUCINATION_THRESHOLD &&
    isKnownHallucinationText(segment.text)
  ) {
    return true;
  }

  // Rule 3: Short standalone phrases commonly emitted from trailing silence.
  if (
    segment.noSpeechProb !== undefined &&
    segment.noSpeechProb > LOW_CONFIDENCE_STANDALONE_THRESHOLD &&
    (isLowConfidenceStandaloneHallucinationText(segment.text) ||
      isLowConfidenceStandaloneClosingText(segment.text))
  ) {
    return true;
  }

  return false;
}

/**
 * Applies whole-response filtering for APIs that return only `text`, or after
 * segment filtering has reassembled the final text. Short phrases such as
 * "ありがとうございます" are dropped only when the captured speech quality also
 * looks weak, so legitimate short dictations are less likely to be removed.
 */
export function shouldDropCompleteTranscription(
  text: string,
  quality: CompleteTranscriptionQuality = {},
): boolean {
  if (isKnownHallucinationText(text)) {
    return true;
  }

  if (isJapaneseRequestedForeignHallucinationText(text, quality)) {
    return true;
  }

  if (isLowConfidenceStandaloneClosingText(text)) {
    const { speechDurationMs, averageSpeechProbability, maxSpeechProbability } =
      quality;
    const hasSpeechProbabilityMetrics =
      typeof averageSpeechProbability === "number" &&
      typeof maxSpeechProbability === "number";
    const hasShortSpeech =
      typeof speechDurationMs === "number" &&
      speechDurationMs <= LOW_CONFIDENCE_CLOSING_MAX_SPEECH_DURATION_MS;

    if (hasSpeechProbabilityMetrics) {
      return hasShortSpeech && isWeakSpeechQuality(quality);
    }

    return (
      typeof speechDurationMs === "number" &&
      speechDurationMs <= LOW_CONFIDENCE_MAX_SPEECH_DURATION_MS
    );
  }

  if (!isLowConfidenceStandaloneHallucinationText(text)) {
    return false;
  }

  const { speechDurationMs, averageSpeechProbability, maxSpeechProbability } =
    quality;
  const hasSpeechProbabilityMetrics =
    typeof averageSpeechProbability === "number" &&
    typeof maxSpeechProbability === "number";
  const hasWeakSpeechProbability = isWeakSpeechQuality(quality);

  if (
    typeof speechDurationMs === "number" &&
    speechDurationMs <= LOW_CONFIDENCE_MAX_SPEECH_DURATION_MS &&
    (!hasSpeechProbabilityMetrics || hasWeakSpeechProbability)
  ) {
    return true;
  }

  if (hasSpeechProbabilityMetrics) {
    return hasWeakSpeechProbability;
  }

  return false;
}
