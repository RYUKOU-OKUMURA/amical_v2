import type { DictationProfile } from "../core/pipeline-types";

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
const LONG_FORM_FILLER_REPEAT_PATTERN =
  /(^|[\s、。！？!?])(?:では[、。]?\s*){2,}/gu;
const ISOLATED_LONG_DASH_REPEAT_PATTERN =
  /(^|[\s、。！？!?])(?:[ーｰ—–-]{2,}[、。]?\s*){2,}/gu;
const ISOLATED_LONG_DASH_PATTERN = new RegExp(
  `(^|[\\s、。！？!?])[ーｰ—–-]{2,}(?=$|[\\s、。！？!?]|${JAPANESE_CHAR_PATTERN.source})`,
  "gu",
);
const SENTENCE_UNIT_PATTERN = /[^。！？!?]+[。！？!?]?|[。！？!?]+/gu;
const LONG_FORM_THANKS_PATTERNS = [
  "ありがとうございました",
  "ありがとうございます",
  "ご視聴ありがとうございました",
  "ご視聴ありがとうございます",
  "見てくれてありがとうございました",
];
const LONG_FORM_LOW_INFORMATION_PROMPT_MARKERS = [
  "では",
  "はい",
  "えっと",
  "あの",
  "その",
];

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

function normalizeTranscriptionSurface(text: string): string {
  return text
    .replace(/[ \t\u3000]+/g, " ")
    .replace(/\s+([、。！？!?.,])/g, "$1")
    .replace(/([、。！？!?])\s+/g, "$1")
    .trim();
}

function addJapanesePunctuationHints(text: string): string {
  return text
    .replace(JAPANESE_DISCOURSE_MARKER_PATTERN, "$1。")
    .replace(JAPANESE_DISCOURSE_COMMA_PATTERN, "$1ちなみに、")
    .replace(JAPANESE_SOFT_SENTENCE_END_PATTERN, "$1。")
    .replace(JAPANESE_TRAILING_NE_PATTERN, "ね。")
    .replace(JAPANESE_CONNECTIVE_COMMA_PATTERN, "$1、");
}

function compactForLongFormCleanup(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s、。！？!?.,「」『』（）()[\]【】"'`]/g, "");
}

function splitSentenceUnits(text: string): string[] {
  return text.match(SENTENCE_UNIT_PATTERN) ?? (text ? [text] : []);
}

function isStandaloneThanksUnit(unit: string): boolean {
  const compacted = compactForLongFormCleanup(unit);
  return LONG_FORM_THANKS_PATTERNS.some(
    (pattern) => compacted === compactForLongFormCleanup(pattern),
  );
}

function isStandaloneHaiUnit(unit: string): boolean {
  return compactForLongFormCleanup(unit) === "はい";
}

function isStandaloneFillerUnit(unit: string): boolean {
  const compacted = compactForLongFormCleanup(unit);
  return LONG_FORM_LOW_INFORMATION_PROMPT_MARKERS.includes(compacted);
}

function isStandaloneDashUnit(unit: string): boolean {
  return /^[ーｰ—–-]+$/u.test(compactForLongFormCleanup(unit));
}

function removeStandaloneLongFormHallucinationSentences(text: string): string {
  const units = splitSentenceUnits(text);
  if (units.length <= 1) {
    return text;
  }

  const removeIndices = new Set<number>();
  units.forEach((unit, index) => {
    if (
      isStandaloneThanksUnit(unit) &&
      (isStandaloneHaiUnit(units[index - 1] ?? "") ||
        isStandaloneHaiUnit(units[index + 1] ?? ""))
    ) {
      removeIndices.add(index);
    }
  });

  units.forEach((unit, index) => {
    if (!isStandaloneHaiUnit(unit)) {
      return;
    }
    if (removeIndices.has(index - 1) || removeIndices.has(index + 1)) {
      removeIndices.add(index);
    }
  });

  if (removeIndices.size === 0 || removeIndices.size === units.length) {
    return text;
  }

  return units.filter((_, index) => !removeIndices.has(index)).join("");
}

function normalizeDuplicateSentenceUnit(unit: string): string {
  let unitWithoutPrefix = unit.trim();
  let previous: string;
  do {
    previous = unitWithoutPrefix;
    unitWithoutPrefix = unitWithoutPrefix.replace(
      /^(か|はい|では|えっと|あの|その)[\s、。！？!?]+/u,
      "",
    );
  } while (unitWithoutPrefix !== previous);
  return compactForLongFormCleanup(unitWithoutPrefix);
}

function collapseAdjacentDuplicateSentences(text: string): string {
  const units = splitSentenceUnits(text);
  if (units.length <= 1) {
    return text;
  }

  const kept: string[] = [];
  let previousNormalized = "";

  for (const unit of units) {
    const normalized = normalizeDuplicateSentenceUnit(unit);
    if (
      normalized &&
      normalized.length >= 8 &&
      normalized === previousNormalized
    ) {
      continue;
    }

    kept.push(unit);
    if (normalized) {
      previousNormalized = normalized;
    }
  }

  return kept.join("");
}

export function applyLongFormTranscriptionCleanup(text: string): string {
  let cleaned = normalizeTranscriptionSurface(text);
  if (!cleaned) {
    return cleaned;
  }

  cleaned = cleaned
    .replace(ISOLATED_LONG_DASH_REPEAT_PATTERN, "$1")
    .replace(ISOLATED_LONG_DASH_PATTERN, "$1")
    .replace(LONG_FORM_FILLER_REPEAT_PATTERN, "$1では、");
  cleaned = removeStandaloneLongFormHallucinationSentences(cleaned);
  cleaned = collapseAdjacentDuplicateSentences(cleaned);
  cleaned = normalizeTranscriptionSurface(cleaned);

  if (!containsJapaneseScript(cleaned)) {
    return cleaned;
  }

  cleaned = normalizeJapaneseSpacing(cleaned);
  return normalizeJapanesePunctuation(cleaned);
}

export function applyLongFormPromptCleanup(text: string): string {
  const cleaned = applyLongFormTranscriptionCleanup(text);
  const units = splitSentenceUnits(cleaned);
  if (units.length === 0) {
    return "";
  }

  while (units.length > 0) {
    const lastUnit = units[units.length - 1] ?? "";
    if (
      isStandaloneFillerUnit(lastUnit) ||
      isStandaloneThanksUnit(lastUnit) ||
      isStandaloneDashUnit(lastUnit)
    ) {
      units.pop();
      continue;
    }
    break;
  }

  return normalizeTranscriptionSurface(units.join(""));
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
    dictationProfile?: DictationProfile;
  },
): string {
  if (options.skipLightweightCleanup) {
    return text;
  }

  if (options.dictationProfile === "long-form") {
    return applyLongFormTranscriptionCleanup(text);
  }

  if (!options.enablePunctuation) {
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

  let cleaned = normalizeTranscriptionSurface(text);

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
