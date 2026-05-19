const JAPANESE_SCRIPT_PATTERN = /[\u3040-\u30ff\u3400-\u9fff]/u;
const JAPANESE_CHAR_PATTERN = /[\u3040-\u30ff\u3400-\u9fff]/;
const TERMINAL_PUNCTUATION_PATTERN = /[。！？!?]$/u;

function containsJapaneseScript(text: string): boolean {
  return JAPANESE_SCRIPT_PATTERN.test(text);
}

function normalizeJapanesePunctuation(text: string): string {
  return text
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

/**
 * Minimal deterministic cleanup for final dictation text when LLM formatting is
 * disabled. This intentionally avoids sentence splitting; the LLM formatter is
 * responsible for richer punctuation and filler removal when enabled.
 */
export function applyLightweightTranscriptionCleanup(
  text: string,
  options: { language?: string } = {},
): string {
  let cleaned = text
    .replace(/[ \t\u3000]+/g, " ")
    .replace(/\s+([、。！？!?.,])/g, "$1")
    .replace(/([、。！？!?.,])\s+/g, "$1")
    .trim();

  const shouldUseJapanesePunctuation = containsJapaneseScript(cleaned);

  if (!shouldUseJapanesePunctuation || !cleaned) {
    return cleaned;
  }

  cleaned = normalizeJapanesePunctuation(cleaned);

  if (!TERMINAL_PUNCTUATION_PATTERN.test(cleaned)) {
    cleaned += "。";
  }

  return cleaned;
}
