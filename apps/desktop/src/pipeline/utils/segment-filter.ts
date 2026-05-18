import { HALLUCINATION_PHRASES } from "../../data/hallucination-phrases";

/** Lower threshold for known hallucination phrases */
const HALLUCINATION_THRESHOLD = 0.4;
const COMPACT_JAPANESE_HALLUCINATION_PATTERNS = [
  "ご視聴ありがとうございました",
  "ご視聴ありがとうございます",
  "次の動画でお会いしましょう",
  "チャンネル登録お願いします",
  "チャンネル登録よろしく",
];

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

/**
 * Checks if text matches a known hallucination phrase
 */
export function isKnownHallucinationText(text: string): boolean {
  const normalized = normalizeText(text);
  if (HALLUCINATION_PHRASES.has(normalized)) {
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

/**
 * Determines if a segment should be dropped based on quality metrics.
 * Rules:
 * 1. noSpeechProb > 0.8 → drop (high confidence no speech)
 * 2. noSpeechProb > 0.4 AND text is a known hallucination phrase → drop
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

  return false;
}
