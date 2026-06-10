import { describe, expect, it } from "vitest";
import {
  buildWhisperPrompt,
  utf8ByteLength,
  DEFAULT_PREVIOUS_CJK_CHAR_COUNT,
  MAX_PREVIOUS_CONTEXT_BYTES,
  MAX_PREVIOUS_CONTEXT_BYTES_CJK,
  MAX_PROMPT_BYTES,
} from "../../src/pipeline/providers/transcription/whisper-prompt";

const JAPANESE_SENTENCE =
  "今日は天気が良いので公園まで散歩に行きました。途中で猫を見かけて写真を撮りました。" +
  "帰り道にコーヒーを買って家でゆっくり飲みながら本を読みました。";

describe("buildWhisperPrompt", () => {
  it("keeps the last N characters of Japanese prior text", () => {
    const chars = Array.from(JAPANESE_SENTENCE);
    expect(chars.length).toBeGreaterThan(DEFAULT_PREVIOUS_CJK_CHAR_COUNT);

    const prompt = buildWhisperPrompt({
      previousTranscription: JAPANESE_SENTENCE,
    });

    const expectedTail = chars.slice(-DEFAULT_PREVIOUS_CJK_CHAR_COUNT).join("");
    expect(prompt).toBe(expectedTail);
  });

  it("keeps Japanese context within the CJK byte budget without mojibake", () => {
    const longJapanese = "あ".repeat(300);
    const prompt = buildWhisperPrompt({ previousTranscription: longJapanese });

    expect(prompt).toBeDefined();
    expect(utf8ByteLength(prompt!)).toBeLessThanOrEqual(
      MAX_PREVIOUS_CONTEXT_BYTES_CJK,
    );
    expect(prompt).not.toContain("�");
    expect(Array.from(prompt!).every((c) => c === "あ")).toBe(true);
  });

  it("keeps the word-based behavior for English prior text", () => {
    const words = Array.from({ length: 30 }, (_, i) => `w${i + 1}`);
    const prompt = buildWhisperPrompt({
      previousTranscription: words.join(" "),
    });

    expect(prompt).toBe(words.slice(-10).join(" "));
    expect(utf8ByteLength(prompt!)).toBeLessThanOrEqual(
      MAX_PREVIOUS_CONTEXT_BYTES,
    );
  });

  it("stays under the total prompt byte cap with vocabulary and Japanese tail", () => {
    const vocabulary = Array.from({ length: 40 }, (_, i) => `用語${i + 1}`);
    const prompt = buildWhisperPrompt({
      vocabulary,
      previousTranscription: JAPANESE_SENTENCE,
    });

    expect(prompt).toBeDefined();
    expect(utf8ByteLength(prompt!)).toBeLessThanOrEqual(MAX_PROMPT_BYTES);
    expect(
      prompt!.endsWith(Array.from(JAPANESE_SENTENCE).slice(-10).join("")),
    ).toBe(true);
  });

  it("falls back to beforeText for Japanese document context", () => {
    const prompt = buildWhisperPrompt({
      beforeText: "それでは次の議題に移ります",
    });

    expect(prompt).toBe("それでは次の議題に移ります");
  });

  it("treats mixed Japanese and ASCII dictation as CJK", () => {
    const mixed = "このAPIはGroqのWhisper Large V3を使っています。".repeat(5);
    const prompt = buildWhisperPrompt({ previousTranscription: mixed });

    const expectedTail = Array.from(mixed.trim())
      .slice(-DEFAULT_PREVIOUS_CJK_CHAR_COUNT)
      .join("")
      // sanitizeWhisperPrompt collapses whitespace
      .replace(/\s+/g, " ")
      .trim();
    expect(prompt).toBe(expectedTail);
  });

  it("returns undefined when there is nothing to prompt with", () => {
    expect(buildWhisperPrompt({})).toBeUndefined();
    expect(buildWhisperPrompt({ vocabulary: ["  "] })).toBeUndefined();
  });
});
