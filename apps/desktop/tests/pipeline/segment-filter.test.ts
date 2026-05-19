import { describe, expect, it } from "vitest";
import {
  isKnownHallucinationText,
  shouldDropCompleteTranscription,
  shouldDropSegment,
} from "../../src/pipeline/utils/segment-filter";

describe("segment-filter", () => {
  it("detects compact Japanese video-ending hallucinations", () => {
    expect(
      isKnownHallucinationText(
        "次の動画でお会いしましょう。ありがとうございます。",
      ),
    ).toBe(true);
  });

  it("does not drop longer text that only mentions a known phrase", () => {
    expect(
      isKnownHallucinationText(
        "YouTubeの最後に次の動画でお会いしましょうと言う例を説明します",
      ),
    ).toBe(false);
  });

  it("drops known hallucination segments at the stricter no-speech threshold", () => {
    expect(
      shouldDropSegment({
        text: "ご視聴ありがとうございました",
        noSpeechProb: 0.5,
      }),
    ).toBe(true);
  });

  it("detects mixed-language Discord hallucinations", () => {
    expect(
      isKnownHallucinationText(
        "Discordharmaのゲームで放弱されatarが召喚しておきます。",
      ),
    ).toBe(true);
  });

  it("drops standalone Japanese thanks only when segment confidence is weak", () => {
    expect(
      shouldDropSegment({
        text: "ありがとうございます。",
        noSpeechProb: 0.35,
      }),
    ).toBe(true);

    expect(
      shouldDropSegment({
        text: "ありがとうございます。",
        noSpeechProb: 0.05,
      }),
    ).toBe(false);
  });

  it("drops standalone Japanese thanks only when whole-response speech quality is weak", () => {
    expect(
      shouldDropCompleteTranscription("ありがとうございます。", {
        speechDurationMs: 600,
        averageSpeechProbability: 0.2,
        maxSpeechProbability: 0.4,
      }),
    ).toBe(true);

    expect(
      shouldDropCompleteTranscription("ありがとうございます。", {
        speechDurationMs: 1400,
        averageSpeechProbability: 0.6,
        maxSpeechProbability: 0.9,
      }),
    ).toBe(false);

    expect(
      shouldDropCompleteTranscription("ありがとうございます。", {
        speechDurationMs: 700,
        averageSpeechProbability: 0.7,
        maxSpeechProbability: 0.9,
      }),
    ).toBe(false);
  });

  it("drops extended-Latin hallucinations when Japanese was requested", () => {
    expect(
      shouldDropCompleteTranscription(
        "Sæsínbannu hóa nokoste furi hóa kestemoraðir.",
        {
          requestedLanguage: "ja",
          speechDurationMs: 5000,
          averageSpeechProbability: 0.8,
          maxSpeechProbability: 0.95,
        },
      ),
    ).toBe(true);
  });

  it("keeps English or English-mixed text when Japanese was requested", () => {
    expect(
      shouldDropCompleteTranscription("OpenAI API and M4 Mac mini", {
        requestedLanguage: "ja",
        speechDurationMs: 2000,
      }),
    ).toBe(false);

    expect(
      shouldDropCompleteTranscription("Amical Remakeで音声入力しています", {
        requestedLanguage: "ja",
        speechDurationMs: 2000,
      }),
    ).toBe(false);
  });

  it("does not apply the Japanese foreign hallucination filter to other languages", () => {
    expect(
      shouldDropCompleteTranscription(
        "Sæsínbannu hóa nokoste furi hóa kestemoraðir.",
        {
          requestedLanguage: "en",
          speechDurationMs: 5000,
        },
      ),
    ).toBe(false);
  });
});
