const JAPANESE_SCRIPT_PATTERN = /[\u3040-\u30ff\u3400-\u9fff]/u;
const JAPANESE_CHAR_PATTERN = /[\u3040-\u30ff\u3400-\u9fff]/;
const TERMINAL_PUNCTUATION_PATTERN = /[。！？!?]$/u;
const MEANINGFUL_PUNCTUATION_PATTERN = /[、。！？!?.,]/gu;
const JAPANESE_DISCOURSE_MARKER_PATTERN = new RegExp(
  `([^、。！？!?\\s])(?=(ちなみに)${JAPANESE_CHAR_PATTERN.source})`,
  "gu",
);
const JAPANESE_DISCOURSE_COMMA_PATTERN = new RegExp(
  `(^|[、。！？!?])ちなみに(?=${JAPANESE_CHAR_PATTERN.source})`,
  "gu",
);
const JAPANESE_SOFT_SENTENCE_END_PATTERN = new RegExp(
  `(ないね|ですね|ますね|だね|ください|お願いします)(?=(?![と、。！？!?])${JAPANESE_CHAR_PATTERN.source})`,
  "gu",
);
const JAPANESE_TRAILING_NE_PATTERN =
  /ね(?=(こんな|これ|この|そう|それ|あと|ちなみに))/gu;
const JAPANESE_CONNECTIVE_COMMA_PATTERN = new RegExp(
  `(だけど|けど|ですが|けれども|けれど|なので|ので)(?=${JAPANESE_CHAR_PATTERN.source})`,
  "gu",
);

function containsJapaneseScript(text: string): boolean {
  return JAPANESE_SCRIPT_PATTERN.test(text);
}

function normalizeJapaneseSpacing(text: string): string {
  let normalized = text;
  let previous: string;
  do {
    previous = normalized;
    normalized = normalized.replace(
      new RegExp(
        `(${JAPANESE_CHAR_PATTERN.source})\\s+(${JAPANESE_CHAR_PATTERN.source})`,
        "gu",
      ),
      "$1$2",
    );
  } while (normalized !== previous);
  return normalized;
}

function normalizeJapanesePunctuation(text: string): string {
  return text
    .replace(/[口苦駆]読点/g, "句読点")
    .replace(/([。！？!?])\.+$/u, "$1")
    .replace(/([。！？!?])。+$/u, "$1")
    .replace(new RegExp(`(${JAPANESE_CHAR_PATTERN.source})\\?`, "gu"), "$1？")
    .replace(new RegExp(`(${JAPANESE_CHAR_PATTERN.source})!`, "gu"), "$1！")
    .replace(new RegExp(`(${JAPANESE_CHAR_PATTERN.source}),`, "gu"), "$1、")
    .replace(
      new RegExp(`(${JAPANESE_CHAR_PATTERN.source})\\.(?=\\s*$)`, "u"),
      "$1。",
    );
}

function addJapanesePunctuationHints(text: string): string {
  return text
    .replace(JAPANESE_DISCOURSE_MARKER_PATTERN, "$1。")
    .replace(JAPANESE_DISCOURSE_COMMA_PATTERN, "$1ちなみに、")
    .replace(JAPANESE_SOFT_SENTENCE_END_PATTERN, "$1。")
    .replace(JAPANESE_TRAILING_NE_PATTERN, "ね。")
    .replace(JAPANESE_CONNECTIVE_COMMA_PATTERN, "$1、");
}

export function countMeaningfulTranscriptionPunctuation(text: string): number {
  return (text.match(MEANINGFUL_PUNCTUATION_PATTERN) ?? []).length;
}

export function shouldPreservePunctuatedTranscript(
  currentTranscript: string,
  candidateTranscript: string,
): boolean {
  const current = currentTranscript.trim();
  const candidate = candidateTranscript.trim();
  if (current.length < 20 || candidate.length < 20) {
    return false;
  }

  const currentPunctuation = countMeaningfulTranscriptionPunctuation(current);
  const candidatePunctuation =
    countMeaningfulTranscriptionPunctuation(candidate);
  if (currentPunctuation < 1 || candidatePunctuation >= currentPunctuation) {
    return false;
  }

  const lengthRatio = candidate.length / current.length;
  if (lengthRatio < 0.75 || lengthRatio > 1.25) {
    return false;
  }

  return (
    candidatePunctuation === 0 ||
    candidatePunctuation <= Math.floor(currentPunctuation * 0.5)
  );
}

export function applyTranscriptionCleanupIfEnabled(
  text: string,
  options: {
    enablePunctuation: boolean;
    skipLightweightCleanup: boolean;
    language?: string;
  },
): string {
  if (options.skipLightweightCleanup || !options.enablePunctuation) {
    return text;
  }

  return applyLightweightTranscriptionCleanup(text, {
    language: options.language,
  });
}

/**
 * Deterministic cleanup for final dictation text when LLM formatting is
 * disabled. This stays conservative, but adds a few Japanese punctuation hints
 * around common dictation boundaries so pasted text is not one long run-on.
 */
export function applyLightweightTranscriptionCleanup(
  text: string,
  options: { language?: string } = {},
): string {
  void options;

  let cleaned = text
    .replace(/[ \t\u3000]+/g, " ")
    .replace(/\s+([、。！？!?.,])/g, "$1")
    .replace(/([、。！？!?.,])\s+/g, "$1")
    .trim();

  const shouldUseJapanesePunctuation = containsJapaneseScript(cleaned);

  if (!shouldUseJapanesePunctuation || !cleaned) {
    return cleaned;
  }

  cleaned = normalizeJapaneseSpacing(cleaned);
  cleaned = normalizeJapanesePunctuation(cleaned);
  cleaned = addJapanesePunctuationHints(cleaned);

  if (!TERMINAL_PUNCTUATION_PATTERN.test(cleaned)) {
    cleaned += "。";
  }

  return cleaned;
}
